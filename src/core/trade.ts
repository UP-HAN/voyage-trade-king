/**
 * 무역 시계·배치표 자동 진행 — 호스트 리듀서 훅 (PRD 4.2.2, 4.3, 7.7, 7.8) — 작업 123.
 *
 * `createTradeHooks(base?)` → `{ onTick, onHostGap, onTeacherAction, validateName }`을
 * `hostReduce`/`createSessionReducer`에 넣으면:
 * - 틱(1초): 자동 진행이면 배치표 시각(`at`, 무역 경과 초)이 된 항목을 발동한다(구간 표지 → `startStage`, 사건 → `fireEvent`
 *   (짧은 형태면 short), 라운드 → `startRound`, 학습지 → `openWorksheet`). 끝 시각이 지난 차단형 활동·학습지는 닫는다.
 *   10초 안 항목은 `schedule.upcoming` + 교사 알림 'UPCOMING'. 수동 진행이면 발동하지 않고 `schedule.waiting`만 둔다.
 *   무역 시간 25%(또는 첫 구간 끝 중 먼저)에 모든 학생의 도약 기준 자산을 기록한다.
 *   시간 끝: 라운드 중이면 즉시 무역 끝(항해 정산). 차단형 활동 중이면 'TIME_UP' 알림 → 활동이 끝나거나 2분 뒤 무역 끝.
 *   무역 끝 → 마무리(`phase:'wrapup'`), 남은 편지 만료, 마무리 항목 목록(`schedule.wrapup`).
 * - 교사 행동: startTrade, pause, resume, extend, shorten, setRoundSec, setItemForm, postpone, skipItem, fireNow,
 *   setProgressMode, finishNow, startRoundNow(작업 134 — 사전 활동 건너뛰고 라운드를 지금, 뒤 항목은 당겨 다시 배치).
 *   수동 진행의 fireNow([발동])는 떠 있는 차단형 활동(표지·카드·학습지)을 끝내고 다음 항목을 연다(작업 134). 배치표를 바꾸면 `reschedule`(아직 시작 안 한 항목만) → `schedule.version` + 1.
 * - 교사 화면 끊김(`hostGap`, 5초 이상): 일시정지로 처리(무역 시계·라운드 타이머를 그만큼 뒤로).
 *
 * 라운드 시작·편지 도착·사건 효과는 반드시 `hostReduce`를 거친다(학생별 편지 문항 고정 `lettersDelivered`,
 * 라운드 끝 항해 처리, 사건 개인 효과). 그래서 이 파일은 학급 상태를 직접 고치지 않고 교사 행동을 `hostReduce`로 넣는다.
 */
import { eventsById } from '../data/events';
import * as clock from './clock';
import { hostReduce, type HostHooks } from './host';
import { applyTeacherAction, EVENT_RESULT_SHOW_SEC, hasResultView, isBlocking, resultShowing } from './lesson';
import {
  blockingIn,
  buildWrapup,
  findItem,
  inputFromClass,
  LINKED_EVENTS,
  reschedule,
  rescheduleEarlyEnd,
  toScheduleState,
  tradeWorksheets,
  tryBuildSchedule,
  type RescheduleChange,
} from './schedule';
import { recordBaseAssets } from './scoring';
import type { WorksheetId } from '../data/types';
import type { ClassState, HostOutput, HostSnapshot, ItemForm, ScheduleItem, ScheduleState, TeacherAction } from './types';

/** 예고(초 전) */
export const UPCOMING_SEC = 10;
/** 차단형 활동 중 시간이 끝났을 때 기다리는 최대 초(기본 '이 활동 끝나고') */
export const TIME_UP_GRACE_SEC = 120;
/** [1분 미루기] */
export const POSTPONE_DEFAULT_SEC = 60;
/** 도약 기준 자산 기록 시점(무역 시간 비율) */
export const BASE_ASSET_RATIO = 0.25;
/** 라운드를 계획보다 이만큼(초) 이상 일찍 끝내면 남은 시간으로 다시 배치(PRD 4.3.7 v0.3.3) */
export const EARLY_END_SEC = 10;
/** 이만큼(초) 넘게 늦게 발동한 활동은 실제 시작 시각부터 제 시간을 준다 */
const LATE_RESET_SEC = 2;

/** 돌발 사건·예보·역전 장치 항목 발동기(작업 125·127이 등록). 처리했으면 새 스냅숏 */
export type ItemFirer = (snapshot: HostSnapshot, item: ScheduleItem, now: number) => { snapshot: HostSnapshot; outputs?: HostOutput[] };
export const itemFirers: Partial<Record<ScheduleItem['kind'], ItemFirer>> = {};

interface Ctx {
  snap: HostSnapshot;
  outputs: HostOutput[];
  now: number;
  inner: HostHooks;
}

// ─── 작은 도구 ────────────────────────────────────────────

const cls = (ctx: Ctx): ClassState => ctx.snap.class;
const setClass = (ctx: Ctx, c: ClassState) => (ctx.snap = { ...ctx.snap, class: c });
const setSchedule = (ctx: Ctx, s: ScheduleState) => setClass(ctx, { ...cls(ctx), schedule: s });

function notice(ctx: Ctx, code: string, message?: string, action?: TeacherAction): void {
  ctx.outputs.push({ to: 'teacher', kind: 'notice', code, ...(action ? { action } : {}), ...(message ? { message } : {}) });
}

/** 교사 행동을 hostReduce 로 넣는다(오류면 코드, 아니면 null) */
function act(ctx: Ctx, action: TeacherAction): string | null {
  const pre = applyTeacherAction(cls(ctx), action, ctx.now);
  if (pre.error) return pre.error;
  if (pre.needsConfirm) return pre.needsConfirm;
  const r = hostReduce(ctx.snap, { type: 'teacher', action }, ctx.now, ctx.inner);
  ctx.snap = r.snapshot;
  // 공개·개인 상태는 바깥 hostReduce 가 바뀐 것만 다시 만든다. 연출 이벤트·알림만 옮긴다
  for (const o of r.outputs) if (o.kind === 'events' || o.kind === 'notice') ctx.outputs.push(o);
  return null;
}

function patchItems(ctx: Ctx, fn: (it: ScheduleItem) => ScheduleItem): void {
  const s = cls(ctx).schedule;
  let changed = false;
  const items = s.items.map((it) => {
    const n = fn(it);
    if (n !== it) changed = true;
    return n;
  });
  if (changed) setSchedule(ctx, { ...s, items });
}

function mark(ctx: Ctx, id: string, status: ScheduleItem['status'], extra: Partial<ScheduleItem> = {}): void {
  patchItems(ctx, (it) => (it.id === id && (it.status !== status || Object.keys(extra).length) ? { ...it, ...extra, status } : it));
}

const elapsed = (ctx: Ctx) => clock.elapsedSec(cls(ctx).clock, ctx.now);
const firable = (it: ScheduleItem) => it.status === 'pending' && it.form !== 'dropped' && it.kind !== 'letter';
const sameIds = (a: readonly string[] | null, b: readonly string[]) => !!a && a.length === b.length && a.every((x, i) => x === b[i]);

// ─── 상태 맞추기 ──────────────────────────────────────────

/** 학급 상태(라운드 번호·현재 사건·학습지)에 맞춰 항목 상태를 맞춘다 */
function syncStatuses(ctx: Ctx): void {
  const c = cls(ctx);
  const e = elapsed(ctx);
  patchItems(ctx, (it) => {
    if (it.kind === 'round' && typeof it.round === 'number' && (it.status === 'pending' || it.status === 'live') && it.round <= c.round) {
      const st = it.round < c.round || c.phase !== 'round' ? 'done' : 'live';
      return st === it.status ? it : { ...it, status: st };
    }
    if (it.kind === 'letter' && it.status === 'pending') {
      if (c.letters.skipped.includes(it.refId)) return { ...it, status: 'skipped' };
      if (typeof it.round === 'number' && it.round <= c.round) return { ...it, status: 'done' };
      return it;
    }
    if (it.status !== 'live') return it;
    if ((it.kind === 'event' || (it.kind === 'stageCover' && it.variant !== 'summary'))) {
      const ce = c.currentEvent;
      if (!ce || ce.id !== it.refId || ce.closed) return { ...it, status: 'done' };
    }
    if (it.kind === 'stageCover' && it.variant === 'summary' && e >= it.at + it.durSec) return { ...it, status: 'done' };
    if (it.kind === 'worksheet') {
      const ids = it.refIds ?? [it.refId];
      const open = sameIds(c.worksheet.current, ids) || c.worksheet.pending.some((p) => sameIds(p, ids));
      if (!open) return { ...it, status: 'done' };
    }
    return it;
  });
}

/**
 * (작업 111) 결과가 있는 사건(확인 퀴즈·결정·투표)은 칸 끝보다 결과 표시 시간만큼 먼저 마감한다 —
 * 결과(정답률·분포 막대)가 칸 안에서 보이고 끝나므로 뒤 항목 시각·판 끝(≤ T)이 그대로다. 칸이 너무 짧으면(결과 시간의 2배 미만) 칸 끝에 마감.
 */
function closeAtSec(it: ScheduleItem): number {
  const def = it.kind === 'event' ? eventsById[it.refId] : undefined;
  if (def && hasResultView(def) && it.durSec >= EVENT_RESULT_SHOW_SEC * 2) return it.at + it.durSec - EVENT_RESULT_SHOW_SEC;
  return it.at + it.durSec;
}

/** 차단형 사건을 마감한 뒤 결과를 보여 주는 중인가(이 동안 다음 항목을 발동하지 않고 계획 끝으로 보지 않음) */
function resultHold(ctx: Ctx): boolean {
  const c = cls(ctx);
  if (!resultShowing(c, ctx.now)) return false;
  const def = eventsById[c.currentEvent!.id];
  return !!def && isBlocking(def, c.currentEvent!.short);
}

/** 끝 시각이 지난 활동·학습지 닫기(자동 진행) */
function closeExpired(ctx: Ctx, e: number): void {
  for (const it of cls(ctx).schedule.items) {
    if (it.status !== 'live' || e < closeAtSec(it)) continue;
    const c = cls(ctx);
    if (it.kind === 'event' || (it.kind === 'stageCover' && it.variant !== 'summary')) {
      if (c.currentEvent && c.currentEvent.id === it.refId && !c.currentEvent.closed) act(ctx, { type: 'closeEvent', reveal: true });
      mark(ctx, it.id, 'done');
    } else if (it.kind === 'stageCover') {
      mark(ctx, it.id, 'done');
    } else if (it.kind === 'worksheet') {
      if (sameIds(c.worksheet.current, it.refIds ?? [it.refId])) act(ctx, { type: 'closeWorksheet' });
      mark(ctx, it.id, 'done');
    }
  }
}

// ─── 항목 발동 ────────────────────────────────────────────

type FireResult = 'fired' | 'wait' | 'skipped';

/** 항목 하나 발동. now=true 이면 [지금](시각 무시) */
function fireItem(ctx: Ctx, it: ScheduleItem, e: number, manualNow: boolean): FireResult {
  const c = cls(ctx);
  const late = e - it.at;
  const startAt = manualNow || late > LATE_RESET_SEC ? Math.floor(e) : it.at;
  switch (it.kind) {
    case 'round': {
      if (typeof it.round === 'number' && it.round <= c.round) {
        mark(ctx, it.id, c.phase === 'round' && it.round === c.round ? 'live' : 'done');
        return 'fired';
      }
      if (c.phase === 'round' || c.phase === 'event' || c.phase === 'worksheet') return 'wait';
      const durationSec = manualNow ? it.durSec : Math.max(30, Math.round(it.at + it.durSec - e));
      const err = act(ctx, { type: 'startRound', durationSec });
      if (err) return 'wait';
      mark(ctx, it.id, 'live', manualNow ? { at: startAt, durSec: durationSec } : {});
      return 'fired';
    }
    case 'stageCover': {
      if (it.variant === 'summary') {
        if (c.phase === 'round' || c.phase === 'event' || c.phase === 'worksheet') return 'wait';
        mark(ctx, it.id, 'live', { at: startAt });
        return 'fired';
      }
      if (c.phase === 'round' || c.phase === 'event' || c.phase === 'worksheet') return 'wait';
      const err = act(ctx, { type: 'startStage', stage: it.stage });
      if (err === 'STAGE_ALREADY_STARTED' || err === 'STAGE_BACKWARD' || err === 'NOT_IN_SCOPE') {
        mark(ctx, it.id, 'skipped');
        return 'skipped';
      }
      if (err) return 'wait';
      const mode = cls(ctx).schedule.stageModes?.[it.stage];
      if (mode) setClass(ctx, { ...cls(ctx), worksheet: { ...cls(ctx).worksheet, mode } });
      mark(ctx, it.id, 'live', { at: startAt });
      return 'fired';
    }
    case 'event': {
      const def = eventsById[it.refId];
      if (!def) {
        mark(ctx, it.id, 'skipped');
        return 'skipped';
      }
      const form: ItemForm = it.form === 'dropped' ? 'full' : it.form;
      const blocking = blockingIn(def, form);
      if (c.phase === 'worksheet' || (blocking && (c.phase === 'round' || c.phase === 'event'))) return 'wait';
      const err = act(ctx, { type: 'fireEvent', id: it.refId, short: form === 'short' });
      if (err === 'ROUND_IN_PROGRESS' || err === 'WORKSHEET_OPEN') return 'wait';
      if (err) {
        mark(ctx, it.id, 'skipped');
        notice(ctx, err, it.refId);
        return 'skipped';
      }
      mark(ctx, it.id, 'live', { form, ...(blocking && startAt !== it.at ? { at: startAt } : {}) });
      return 'fired';
    }
    case 'worksheet': {
      if (c.phase === 'round' || c.phase === 'event' || c.phase === 'worksheet') return 'wait';
      const during = it.placement === 'during';
      const err = act(ctx, {
        type: 'openWorksheet', ids: (it.refIds ?? [it.refId]) as WorksheetId[],
        ...(during ? { during: true, ...(it.afterNews ? { afterNews: true } : {}) } : {}),
      });
      if (err) return 'wait';
      mark(ctx, it.id, 'live', startAt !== it.at ? { at: startAt } : {});
      return 'fired';
    }
    case 'letter':
      return 'fired'; // 편지는 그 라운드 startRound 가 배달한다(hostReduce 의 lettersDelivered)
    default: {
      const firer = itemFirers[it.kind];
      if (firer) {
        const r = firer(ctx.snap, it, ctx.now);
        ctx.snap = r.snapshot;
        if (r.outputs) ctx.outputs.push(...r.outputs);
      }
      mark(ctx, it.id, 'done');
      return 'fired';
    }
  }
}

function fireDue(ctx: Ctx, e: number): void {
  for (let guard = 0; guard < 200; guard++) {
    const next = cls(ctx).schedule.items.find(firable);
    if (!next || next.at > e + 1e-6) return;
    if (fireItem(ctx, next, e, false) === 'wait') return;
  }
}

// ─── 기준 자산·예고·시간 끝 ─────────────────────────────────

function maybeRecordBase(ctx: Ctx, e: number): void {
  const c = cls(ctx);
  if (c.schedule.baseRecorded) return;
  const first = c.settings.scope[0];
  const firstEnd = c.schedule.items
    .filter((it) => it.stage === first && it.form !== 'dropped' && it.kind !== 'letter')
    .reduce((m, it) => Math.max(m, it.at + it.durSec), 0);
  const threshold = Math.min(c.clock.durationSec * BASE_ASSET_RATIO, firstEnd > 0 ? firstEnd : Infinity);
  if (e < threshold && c.stage === first) return;
  ctx.snap = { ...ctx.snap, players: recordBaseAssets(ctx.snap.players) };
  setSchedule(ctx, { ...cls(ctx).schedule, baseRecorded: true });
}

function updateUpcoming(ctx: Ctx, e: number): void {
  const s = cls(ctx).schedule;
  if (s.mode === 'manual') {
    const w = s.items.find(firable);
    // (작업 134) 라운드가 끝나야 시작할 수 있는 항목은 교사를 기다리지 않는다(라운드를 기다림) — [발동]을 눌러도 안 되는 버튼을 보이지 않게
    const afterRound = !!w && cls(ctx).phase === 'round' && blocksRound(w);
    const waiting = w && w.at <= e && !afterRound ? w.id : null;
    if ((s.waiting ?? null) !== waiting || (s.upcoming ?? []).length) setSchedule(ctx, { ...s, waiting, upcoming: [] });
    return;
  }
  const ids = s.items.filter((it) => firable(it) && it.at > e && it.at - e <= UPCOMING_SEC).map((it) => it.id);
  const prev = s.upcoming ?? [];
  if (sameIds(prev, ids) && (s.waiting ?? null) === null) return;
  for (const id of ids) if (!prev.includes(id)) notice(ctx, 'UPCOMING', id);
  setSchedule(ctx, { ...s, upcoming: ids, waiting: null });
}

/** 범위 안 무역 학습지 중 아직 띄우지 않은 번호(마무리 '끝나고 쓰기'로) */
function unwrittenWorksheets(c: ClassState): WorksheetId[] {
  if (c.settings.worksheetMode === 'off') return [];
  const shown = new Set<string>();
  // '지금 쓰기'(★ 칸) 팝업은 번호를 띄운 것으로 세지 않는다 — ③·⑭는 끝나고 쓰기에 그대로 남는다(PRD 4.3.3.1 규칙 7)
  for (const it of c.schedule.items) if (it.kind === 'worksheet' && it.placement !== 'during' && (it.status === 'live' || it.status === 'done')) (it.refIds ?? [it.refId]).forEach((w) => shown.add(w));
  return c.settings.scope.flatMap(tradeWorksheets).filter((w) => !shown.has(w));
}

/** 무역 끝 → 마무리 */
function finishTrade(ctx: Ctx): void {
  const err = act(ctx, { type: 'endTrade' });
  if (err && err !== 'TRADE_ENDED') {
    notice(ctx, err);
    return;
  }
  syncStatuses(ctx);
  patchItems(ctx, (it) => (it.status === 'pending' && it.form !== 'dropped' ? { ...it, status: 'skipped' } : it.status === 'live' ? { ...it, status: 'done' } : it));
  const c = cls(ctx);
  const wrapup = buildWrapup(ctx.snap.meta.playUnit, c.settings.scope, unwrittenWorksheets(c));
  setSchedule(ctx, { ...c.schedule, wrapup, timeUp: null, upcoming: [], waiting: null });
  notice(ctx, 'TRADE_ENDED');
}

function handleTimeUp(ctx: Ctx): void {
  const c = cls(ctx);
  const busy = c.phase === 'event' || c.phase === 'worksheet' || resultHold(ctx);
  if (!busy) return finishTrade(ctx);
  const tu = c.schedule.timeUp ?? null;
  if (!tu) {
    setSchedule(ctx, { ...c.schedule, timeUp: { at: ctx.now } });
    notice(ctx, 'TIME_UP', '무역 시간이 끝났어요 — [지금 결산] [이 활동 끝나고(최대 2분)]');
    return;
  }
  if (ctx.now - tu.at >= TIME_UP_GRACE_SEC * 1000) finishTrade(ctx);
}

/** 틱 처리 본체 */
function advance(ctx: Ctx): void {
  // 결과 표시 시간이 지난 사건은 resultUntil을 지워 보낸다 — 시계가 어긋난 기기(공용 화면)도 이 상태 변화로 결과를 끝낸다(작업 111 수정 2회차)
  const ce0 = cls(ctx).currentEvent;
  if (ce0 && ce0.closed && typeof ce0.resultUntil === 'number' && ce0.resultUntil <= ctx.now) {
    const { resultUntil: _r, ...rest } = ce0;
    void _r;
    setClass(ctx, { ...cls(ctx), currentEvent: rest });
  }
  const c0 = cls(ctx);
  if (c0.clock.startedAt === null || c0.tradeEnded || c0.phase === 'ended') return;
  syncStatuses(ctx);
  if (cls(ctx).paused) return;
  const e = elapsed(ctx);
  const auto = cls(ctx).schedule.mode === 'auto';
  if (auto && !cls(ctx).schedule.timeUp) closeExpired(ctx, e);
  if (e >= cls(ctx).clock.durationSec) {
    handleTimeUp(ctx);
    return;
  }
  maybeRecordBase(ctx, e);
  // 마감한 차단형 사건의 결과를 보여 주는 동안에는 다음 항목을 발동하지 않고, 계획이 끝났다고 보지 않는다(작업 111)
  const hold = resultHold(ctx);
  if (auto && !hold) fireDue(ctx, e);
  syncStatuses(ctx);
  if (auto && !hold && planFinished(ctx, e)) {
    // 일찍 끝낸 라운드로 마지막 구간 계획이 무역 시간보다 먼저 끝났다 → 결산으로(PRD 4.3.7, 2회차 결정)
    notice(ctx, 'PLAN_DONE');
    finishTrade(ctx);
    return;
  }
  updateUpcoming(ctx, e);
}

/** 남은 계획 항목이 없고(빠진 활동 제외) 진행 중인 것도 없다 */
function planFinished(ctx: Ctx, _e: number): boolean {
  const c = cls(ctx);
  if (c.phase !== 'between') return false;
  // 끝난(done·skipped) 항목의 계획 길이는 보지 않는다 — 남은(pending·live) 계획 항목이 없으면 끝
  const items = c.schedule.items.filter((it) => it.form !== 'dropped' && it.kind !== 'letter');
  return items.length > 0 && !items.some((it) => it.status === 'pending' || it.status === 'live');
}

// ─── 다시 배치 ────────────────────────────────────────────

function replan(ctx: Ctx, change: RescheduleChange): string | null {
  const c = cls(ctx);
  const r = reschedule(c.schedule, c, ctx.now, change, { playUnit: ctx.snap.meta.playUnit, scope: c.settings.scope });
  if (r.error) return r.error;
  setSchedule(ctx, r.schedule);
  return null;
}

// ─── 교사 행동 ────────────────────────────────────────────

const started = (c: ClassState) => c.clock.startedAt !== null;

function teacherAction(ctx: Ctx, action: TeacherAction): boolean {
  const fail = (code: string) => (notice(ctx, code, undefined, action), true);
  const c = cls(ctx);
  switch (action.type) {
    case 'startTrade': {
      if (started(c)) return fail('TRADE_STARTED');
      if (c.tradeEnded || c.phase === 'ended') return fail('TRADE_ENDED');
      const r = tryBuildSchedule(inputFromClass(c, ctx.snap.meta.playUnit, ctx.snap.meta.scope));
      if (!r.ok) {
        notice(ctx, r.error, r.message, action);
        return true;
      }
      const plan = r.schedule;
      let ck = clock.startTrade(clock.idleClock(plan.input.tradeMinutes * 60), ctx.now);
      if (c.paused) ck = clock.pause(ck, ctx.now);
      const first = plan.input.scope[0];
      setClass(ctx, {
        ...c,
        clock: ck,
        phase: c.phase === 'prep' ? 'between' : c.phase,
        settings: { ...c.settings, tradeMinutes: plan.input.tradeMinutes },
        schedule: toScheduleState(plan, c.schedule, c.settings.progressMode),
        worksheet: { ...c.worksheet, mode: plan.worksheetModes[first] ?? c.worksheet.mode },
      });
      for (const w of plan.warnings) notice(ctx, 'SCHEDULE_WARNING', w);
      advance(ctx);
      return true;
    }
    case 'endRound': {
      // 일찍 끝낸 라운드(PRD 4.3.7): 10초 이상 일찍이면 남은 무역 시간으로 다시 배치하고 다음 항목을 바로 잇는다
      if (!started(c) || c.tradeEnded || c.phase !== 'round') return false;
      const live = c.schedule.items.find((it) => it.kind === 'round' && it.round === c.round && it.status === 'live');
      const early = live ? live.at + live.durSec - elapsed(ctx) : 0;
      const err = act(ctx, action);
      if (err) return fail(err);
      syncStatuses(ctx);
      if (early >= EARLY_END_SEC) {
        // 그 라운드에 붙은 비차단 활동(임무·결정 패널)도 라운드와 함께 닫는다
        const e = Math.floor(elapsed(ctx));
        const oldEnd = live ? live.at + live.durSec : null;
        if (live) mark(ctx, live.id, 'done', { durSec: Math.max(0, e - live.at) });
        for (const it of cls(ctx).schedule.items) {
          // (작업 132) 라운드 안에서 먼저 끝난(done) 결정 패널도 계획 길이를 라운드 끝까지로 줄인다 — 판 끝 계산이 실제와 같게
          if (it.kind === 'event' && it.status === 'done' && !it.blocking && live && oldEnd !== null && it.at >= live.at && it.at + it.durSec === oldEnd && e < oldEnd) {
            mark(ctx, it.id, 'done', { durSec: Math.max(0, e - it.at) });
            continue;
          }
          if (it.kind !== 'event' || it.status !== 'live' || it.blocking) continue;
          const ce = cls(ctx).currentEvent;
          if (ce && ce.id === it.refId && !ce.closed) act(ctx, { type: 'closeEvent', reveal: true });
          mark(ctx, it.id, 'done', { durSec: Math.max(0, e - it.at) });
        }
        const c2 = cls(ctx);
        // 아낀 초 = 계획 끝 − 내림한 지금(정수)
        const savedInt = live ? live.at + live.durSec - e : Math.floor(early);
        const r = rescheduleEarlyEnd(c2.schedule, c2, ctx.now, savedInt, { playUnit: ctx.snap.meta.playUnit, scope: c2.settings.scope });
        if (r.error) notice(ctx, r.error, undefined, action);
        else {
          setSchedule(ctx, r.schedule);
          if (cls(ctx).schedule.mode === 'auto') advance(ctx);
        }
      }
      return true;
    }
    case 'pause': {
      const err = act(ctx, action);
      if (err) return fail(err);
      return true;
    }
    case 'resume': {
      const err = act(ctx, action);
      if (err) return fail(err);
      setClass(ctx, { ...cls(ctx), clock: clock.syncEnds(cls(ctx).clock) });
      return true;
    }
    case 'extend':
    case 'shorten': {
      const s = Math.round(Number(action.sec));
      if (!Number.isFinite(s) || s <= 0) return fail('BAD_SEC');
      if (c.tradeEnded || c.phase === 'ended') return fail('TRADE_ENDED');
      if (!started(c)) {
        const T = c.clock.durationSec + (action.type === 'extend' ? s : -s);
        if (T < 5 * 60 || T > 90 * 60) return fail('BAD_SEC');
        setClass(ctx, { ...c, clock: { ...c.clock, durationSec: T }, settings: { ...c.settings, tradeMinutes: T / 60 } });
        return true;
      }
      const ck = action.type === 'extend' ? clock.extend(c.clock, s) : clock.shorten(c.clock, s, ctx.now);
      if (!ck) return fail('CANNOT_SHORTEN');
      setClass(ctx, {
        ...c,
        clock: ck,
        settings: { ...c.settings, tradeMinutes: ck.durationSec / 60 },
        schedule: { ...c.schedule, timeUp: clock.isTimeUp(ck, ctx.now) ? (c.schedule.timeUp ?? null) : null },
      });
      const err = replan(ctx, { type: 'time' });
      if (err) return fail(err);
      return true;
    }
    case 'setRoundSec': {
      const err = act(ctx, { type: 'updateSettings', settings: { roundSec: action.sec } });
      if (err) return fail(err);
      setSchedule(ctx, { ...cls(ctx).schedule, roundSecAuto: false });
      if (started(c) && !c.tradeEnded) {
        const e2 = replan(ctx, { type: 'roundSec' });
        if (e2) return fail(e2);
      }
      return true;
    }
    case 'setItemForm': {
      if (!['full', 'short', 'dropped'].includes(action.form)) return fail('BAD_FORM');
      if (!started(c)) {
        const lead = LINKED_EVENTS[action.id] ?? action.id.replace(/^ev:/, '');
        const def = eventsById[lead];
        if (!def) return fail('NO_ITEM');
        if (def.tier === 1 && action.form === 'dropped') return fail('TIER1_CANNOT_DROP');
        setSchedule(ctx, { ...c.schedule, overrides: { ...(c.schedule.overrides ?? {}), [lead]: action.form } });
        return true;
      }
      const err = replan(ctx, { type: 'itemForm', id: action.id, form: action.form });
      if (err) return fail(err);
      return true;
    }
    case 'postpone': {
      if (!started(c)) return fail('NOT_STARTED');
      const err = replan(ctx, { type: 'postpone', id: action.id, sec: action.sec ?? POSTPONE_DEFAULT_SEC });
      if (err) return fail(err);
      return true;
    }
    case 'skipItem': {
      if (!started(c)) return fail('NOT_STARTED');
      const it = findItem(c.schedule.items, action.id);
      if (!it) return fail('NO_ITEM');
      if (it.status !== 'pending') return fail('ALREADY_STARTED');
      if (it.kind === 'stageCover') return fail('CANNOT_SKIP');
      if (it.kind === 'letter') {
        const err = act(ctx, { type: 'skipLetterSlot', slotId: it.refId });
        if (err) return fail(err);
        mark(ctx, it.id, 'skipped');
        return true;
      }
      if (it.kind === 'event') {
        const def = eventsById[LINKED_EVENTS[it.refId] ?? it.refId];
        if (def && (def.tier === 1 || def.required) && !action.confirm) {
          notice(ctx, 'NEEDS_CONFIRM', 'REQUIRED_EVENT', action);
          return true;
        }
      }
      const err = replan(ctx, { type: 'skip', id: it.id });
      if (err) return fail(err);
      return true;
    }
    case 'fireNow': {
      if (!started(c)) return fail('NOT_STARTED');
      if (c.tradeEnded) return fail('TRADE_ENDED');
      const it = findItem(c.schedule.items, action.id);
      if (!it) return fail('NO_ITEM');
      if (it.status !== 'pending') return fail('ALREADY_STARTED');
      if (it.kind === 'letter') return fail('LETTER_ARRIVES_WITH_ROUND');
      // (작업 134) 수동 진행의 [발동]: 지금 떠 있는 차단형 활동(표지·사건 카드·학습지)을 끝내고 다음 항목을 시작한다.
      // 수동 진행에서는 끝 시각이 지나도 저절로 닫히지 않아, 이것이 없으면 표지에서 판이 멈춘다(리허설 d)
      if (c.schedule.mode === 'manual' && needsClear(c, it)) clearCurrent(ctx);
      const r = fireItem(ctx, it, elapsed(ctx), true);
      if (r === 'wait') return fail('CANNOT_FIRE_NOW');
      syncStatuses(ctx);
      // (작업 134) 기다리는 항목 표시를 바로 다음 것으로(다음 틱까지 같은 항목이 남아 보이지 않게)
      updateUpcoming(ctx, elapsed(ctx));
      return true;
    }
    case 'setProgressMode': {
      if (action.mode !== 'auto' && action.mode !== 'manual') return fail('BAD_MODE');
      const err = act(ctx, { type: 'updateSettings', settings: { progressMode: action.mode } });
      if (err) return fail(err);
      setSchedule(ctx, { ...cls(ctx).schedule, mode: action.mode, waiting: null, upcoming: [] });
      return true;
    }
    case 'finishNow': {
      if (c.tradeEnded || c.phase === 'ended') return fail('TRADE_ENDED');
      finishTrade(ctx);
      return true;
    }
    case 'startRoundNow':
      return startRoundNow(ctx, action, fail);
    default:
      return false;
  }
}

// ─── (작업 134) 지금 떠 있는 차단형 활동 끝내기·[지금 라운드 시작] ─────────

/** 이 항목을 지금 시작하려면 떠 있는 차단형 활동(사건 카드·표지·학습지 팝업)을 먼저 끝내야 하는가 */
function needsClear(c: ClassState, it: ScheduleItem): boolean {
  if (c.phase === 'worksheet') return !!c.worksheet.current;
  if (c.phase !== 'event' || !c.currentEvent || c.currentEvent.closed) return false;
  return blocksRound(it);
}

/** 라운드·차단형 활동과 함께 띄울 수 없는 항목(라운드·표지·학습지·차단형 사건) */
function blocksRound(it: ScheduleItem): boolean {
  if (it.kind === 'letter') return false;
  if (it.kind !== 'event') return true;
  const def = eventsById[it.refId];
  return !!def && blockingIn(def, it.form === 'dropped' ? 'full' : it.form);
}

/** 떠 있는 학습지 팝업·차단형 사건(표지 포함)을 닫고 그 항목을 끝냄(계획 길이 = 실제)으로. 결과 보여 주기도 끝낸다 */
function clearCurrent(ctx: Ctx): void {
  const e = Math.floor(elapsed(ctx) + 1e-9);
  const c = cls(ctx);
  if (c.phase === 'worksheet' && c.worksheet.current) {
    const ids = c.worksheet.current;
    act(ctx, { type: 'closeWorksheet' });
    const live = cls(ctx).schedule.items.find((it) => it.kind === 'worksheet' && it.status === 'live' && sameIds(ids, it.refIds ?? [it.refId]));
    if (live) mark(ctx, live.id, 'done', { durSec: Math.max(0, e - live.at) });
  }
  const ce = cls(ctx).currentEvent;
  if (ce && !ce.closed && cls(ctx).phase === 'event') {
    const live = cls(ctx).schedule.items.find((it) => it.status === 'live' && (it.kind === 'event' || it.kind === 'stageCover') && it.refId === ce.id);
    act(ctx, { type: 'closeEvent', reveal: true });
    if (live) mark(ctx, live.id, 'done', { durSec: Math.max(0, e - live.at) });
  }
  if (resultShowing(cls(ctx), ctx.now)) act(ctx, { type: 'endResult' });
}

/** [지금 라운드 시작]을 지금 누를 수 없는 이유 */
export type RoundNowBlock = 'NOT_STARTED' | 'TRADE_ENDED' | 'ROUND_IN_PROGRESS' | 'WORKSHEET_OPEN' | 'PAUSED' | 'TIME_IS_UP' | 'NO_NEXT_ROUND';

/** [지금 라운드 시작]이 하는 일(순수 계산 — 교사 화면 확인 창과 core 가 같은 것을 쓴다) */
export interface RoundNowPlan {
  block: RoundNowBlock | null;
  /** 열 라운드 항목 */
  round: ScheduleItem | null;
  /** 계획상 라운드까지 남은 초(지금 경과 기준, 0 이하면 이미 차례) */
  waitSec: number;
  /** 건너뛸 사전 항목(아직 시작 안 함) */
  skip: ScheduleItem[];
  /** 지금 떠 있어서 닫을 활동(사건 ID, 없으면 null) */
  closing: string | null;
  /** 다른 구간의 라운드면 그 구간 표지(바로 넘김 — 항구·기능 열기는 그대로) */
  cover: ScheduleItem | null;
  /** 1등급(핵심) 활동인데 빠지거나 일찍 닫히는 것 — 확인 창에 이름으로 */
  tier1: { id: string; title: string; live: boolean }[];
  /** (수정 1회차) 건너뛰어 '끝나고 쓰기'(또는 뒤 항목)로 옮겨지는 학습지 번호(지금 쓰기 ★ 제외) */
  movedWorksheets: WorksheetId[];
  /** 확인 창이 필요한가(1등급 활동이 빠지거나 학습지 번호가 옮겨짐) */
  needsConfirm: boolean;
}

type RoundNowClass = Pick<ClassState, 'clock' | 'schedule' | 'phase' | 'paused' | 'tradeEnded' | 'stage' | 'currentEvent' | 'worksheet'>;

const leadDef = (refId: string) => eventsById[LINKED_EVENTS[refId] ?? refId] ?? eventsById[refId];

/** 지금 [지금 라운드 시작]을 누르면 무엇이 일어나는가 */
export function roundNowPlan(c: RoundNowClass, now: number): RoundNowPlan {
  const empty: RoundNowPlan = { block: null, round: null, waitSec: 0, skip: [], closing: null, cover: null, tier1: [], movedWorksheets: [], needsConfirm: false };
  if (c.clock.startedAt === null) return { ...empty, block: 'NOT_STARTED' };
  if (c.tradeEnded || c.phase === 'wrapup' || c.phase === 'ended') return { ...empty, block: 'TRADE_ENDED' };
  if (c.phase === 'round') return { ...empty, block: 'ROUND_IN_PROGRESS' };
  const items = c.schedule.items;
  const idx = items.findIndex((it) => it.kind === 'round' && it.status === 'pending' && it.form !== 'dropped');
  const round = idx >= 0 ? items[idx]! : null;
  const e = clock.elapsedSec(c.clock, now);
  const base: RoundNowPlan = { ...empty, round, waitSec: round ? round.at - e : 0 };
  if (!round) return { ...base, block: 'NO_NEXT_ROUND' };
  if (c.paused) return { ...base, block: 'PAUSED' };
  if (c.schedule.timeUp) return { ...base, block: 'TIME_IS_UP' };
  // 학습지 팝업은 쓰는 시간을 지킨다(PRD 7.7) — 선생님이 학습지 시간을 끝낸 뒤에
  if (c.phase === 'worksheet' || c.worksheet.current) return { ...base, block: 'WORKSHEET_OPEN' };
  const pre = items.filter((it, i) => {
    if (it === round || it.status !== 'pending' || it.form === 'dropped' || it.kind === 'letter') return false;
    // 라운드에 붙은 비차단 활동(결정 패널·임무)은 라운드와 함께 열린다
    if (it.kind === 'event' && it.blocking === false && it.at >= round.at) return false;
    return it.at < round.at || (it.at === round.at && i < idx);
  });
  const cover = round.stage !== c.stage ? pre.find((it) => it.kind === 'stageCover' && it.variant !== 'summary' && it.stage === round.stage) ?? null : null;
  const skip = pre.filter((it) => it !== cover);
  const ce = c.currentEvent;
  const closing = ce && !ce.closed && c.phase === 'event' ? ce.id : null;
  const tier1: RoundNowPlan['tier1'] = [];
  for (const it of skip) {
    if (it.kind !== 'event') continue;
    const def = leadDef(it.refId);
    if (def && (def.tier === 1 || def.required) && !def.isCover) tier1.push({ id: it.refId, title: def.title, live: false });
  }
  if (closing) {
    const def = eventsById[closing];
    if (def && def.tier === 1 && !def.isCover) tier1.push({ id: closing, title: def.title, live: true });
  }
  const movedWorksheets = [...new Set(skip.filter((it) => it.kind === 'worksheet' && it.placement !== 'during').flatMap((it) => (it.refIds ?? [it.refId]) as WorksheetId[]))];
  return { ...base, skip, closing, cover, tier1, movedWorksheets, needsConfirm: tier1.length > 0 || movedWorksheets.length > 0 };
}

/**
 * 다음 라운드까지(학생·교사 화면 표시용, 순수). 라운드 중·무역 전·끝이면 null.
 * sec = 계획상 남은 초(올림, 0 이상). manual = 수동 진행(선생님이 [발동]해야 열림). first = 아직 라운드를 한 번도 안 함.
 */
export function nextRoundWait(
  c: Pick<ClassState, 'clock' | 'schedule' | 'phase' | 'tradeEnded' | 'round'>,
  now: number,
): { round: number; sec: number; manual: boolean; first: boolean } | null {
  if (c.clock.startedAt === null || c.tradeEnded || c.phase === 'round' || c.phase === 'wrapup' || c.phase === 'ended' || c.phase === 'prep') return null;
  const r = c.schedule.items.find((it) => it.kind === 'round' && it.status === 'pending' && it.form !== 'dropped');
  if (!r) return null;
  const sec = Math.max(0, Math.ceil(r.at - clock.elapsedSec(c.clock, now) - 1e-9));
  return { round: r.round ?? c.round + 1, sec, manual: c.schedule.mode === 'manual', first: c.round === 0 };
}

/**
 * [무역 시작] 확인 창 안내(작업 134, 교사 결정 3): 배치표에서 라운드 1 앞의 활동과 라운드 1 시각.
 * activities = 라운드 1 전에 하는 활동·학습지 항목(표지·요약 카드·편지 제외), atSec = 라운드 1 시작(무역 경과 초).
 */
export function firstRoundPreview(items: readonly ScheduleItem[]): { atSec: number; round: number; activities: ScheduleItem[] } | null {
  const idx = items.findIndex((it) => it.kind === 'round' && it.form !== 'dropped');
  if (idx < 0) return null;
  const r = items[idx]!;
  const activities = items.filter((it, i) => (it.kind === 'event' || it.kind === 'worksheet') && it.form !== 'dropped'
    && !(it.kind === 'event' && it.blocking === false && it.at >= r.at)
    && (it.at < r.at || (it.at === r.at && i < idx)));
  return { atSec: r.at, round: r.round ?? 1, activities };
}

/**
 * 마무리 '끝나고 쓰기' 학습지 = 범위 안 무역 학습지 중 배치표에 학습지 항목(지금 쓰기 제외, 상태 무관 — 건너뛴 항목은
 * reschedule 과 같이 '띄운 것'으로 봄)이 없는 번호.
 */
function rebuildAfterWorksheets(ctx: Ctx): void {
  const c = cls(ctx);
  if (c.settings.worksheetMode === 'off') return;
  const scope = c.settings.scope;
  const accounted = new Set<string>();
  for (const it of c.schedule.items) if (it.kind === 'worksheet' && it.placement !== 'during') (it.refIds ?? [it.refId]).forEach((w) => accounted.add(w));
  const after = scope.flatMap(tradeWorksheets).filter((w) => !accounted.has(w));
  setSchedule(ctx, { ...c.schedule, wrapup: buildWrapup(ctx.snap.meta.playUnit, scope, after) });
}

function startRoundNow(ctx: Ctx, action: Extract<TeacherAction, { type: 'startRoundNow' }>, fail: (code: string) => boolean): boolean {
  const plan = roundNowPlan(cls(ctx), ctx.now);
  if (plan.block) return fail(plan.block);
  if (plan.needsConfirm && !action.confirm) {
    notice(ctx, 'NEEDS_CONFIRM', 'ROUND_NOW_TIER1', action);
    return true;
  }
  const R = plan.round!;
  const e = Math.floor(elapsed(ctx) + 1e-9);
  // 1. 떠 있는 활동 닫기
  clearCurrent(ctx);
  // 2. 사전 항목 건너뛰기. 학습지(지금 쓰기 제외)는 항목만 지워 번호가 뒤(또는 끝나고 쓰기)로 넘어가게 한다(누락 0)
  const skipIds = new Set(plan.skip.map((it) => it.id));
  const skippedEvents = new Set(plan.skip.filter((it) => it.kind === 'event').map((it) => it.refId));
  const s0 = cls(ctx).schedule;
  const items0 = s0.items
    .filter((it) => !(skipIds.has(it.id) && it.kind === 'worksheet' && it.placement !== 'during'))
    .map((it) => {
      if (skipIds.has(it.id)) return { ...it, status: 'skipped' as const };
      // 따라가는 활동(L3-E2 ↔ L3-E5)도 함께
      const lead = it.kind === 'event' ? LINKED_EVENTS[it.refId] : undefined;
      if (lead && skippedEvents.has(lead) && it.status === 'pending') return { ...it, status: 'skipped' as const };
      return it;
    });
  setSchedule(ctx, { ...s0, items: items0 });
  // 3. 다른 구간의 라운드면 그 구간 표지를 띄우고 바로 넘긴다(항구·기능 열기는 그대로)
  if (plan.cover) {
    const cov = findItem(cls(ctx).schedule.items, plan.cover.id);
    if (cov && cov.status === 'pending' && fireItem(ctx, cov, elapsed(ctx), true) === 'fired') {
      clearCurrent(ctx);
      mark(ctx, cov.id, 'done', { at: e, durSec: 0 });
    }
  }
  // 4. 라운드를 지금으로 당기고 뒤 항목 다시 배치(일찍 끝낸 라운드와 같은 규칙: 판 끝 ≤ T, 정수 초, 라운드 ≥ 90초, 새 라운드 없음)
  const saved = R.at - e;
  if (saved > 0) {
    const c2 = cls(ctx);
    const r = rescheduleEarlyEnd(c2.schedule, c2, ctx.now, saved, { playUnit: ctx.snap.meta.playUnit, scope: c2.settings.scope });
    if (r.error) return fail(r.error);
    setSchedule(ctx, r.schedule);
  } else if (saved < 0) {
    // 계획보다 늦음(수동 진행 등): 라운드에 붙은 비차단 활동도 라운드와 같이 옮긴다
    const shift = -saved;
    patchItems(ctx, (it) => (it.status === 'pending' && it.kind === 'event' && it.blocking === false && it.at >= R.at && it.at < R.at + R.durSec ? { ...it, at: it.at + shift } : it));
  }
  // (수정 1회차) 마무리 목록을 다시 만든다 — 지운 학습지 번호가 누른 직후부터 '끝나고 쓰기'에 보이게(누락 0)
  rebuildAfterWorksheets(ctx);
  // 5. 라운드 열기 + 지금 시각에 붙은 비차단 활동
  const R2 = findItem(cls(ctx).schedule.items, R.id);
  if (!R2 || R2.status !== 'pending') return fail('NO_NEXT_ROUND');
  const fr = fireItem(ctx, R2, elapsed(ctx), saved <= 0);
  if (fr !== 'fired') return fail('CANNOT_FIRE_NOW');
  for (let guard = 0; guard < 20; guard++) {
    const next = cls(ctx).schedule.items.find((it) => firable(it) && it.kind === 'event' && it.blocking === false && it.at <= e + 1e-6);
    if (!next || fireItem(ctx, next, elapsed(ctx), false) !== 'fired') break;
  }
  syncStatuses(ctx);
  updateUpcoming(ctx, elapsed(ctx));
  return true;
}

// ─── 훅 ───────────────────────────────────────────────────

/**
 * 무역 시계·배치표 훅. `base`의 validateName 등은 그대로 쓴다.
 * 예: `createSessionReducer(createTradeHooks({ validateName: validateCompanyName }))`
 */
export function createTradeHooks(base: HostHooks = {}): HostHooks {
  const inner: HostHooks = base.validateName ? { validateName: base.validateName } : {};
  return {
    ...base,
    onTick: (snapshot, now) => {
      const ctx: Ctx = { snap: snapshot, outputs: [], now, inner };
      advance(ctx);
      let snap = ctx.snap;
      let outputs = ctx.outputs;
      if (base.onTick) {
        const r = base.onTick(snap, now);
        snap = r.snapshot;
        if (r.outputs) outputs = [...outputs, ...r.outputs];
      }
      return { snapshot: snap, outputs };
    },
    onHostGap: (snapshot, gapMs, now) => {
      const sec = gapMs / 1000;
      let snap = snapshot;
      if (sec >= clock.HOST_GAP_MIN_SEC) {
        const c = snap.class;
        const ck = clock.hostGap(c.clock, sec);
        const shiftRound = !c.paused && c.roundEndsAt !== null;
        const tu = c.schedule.timeUp ?? null;
        if (ck !== c.clock || shiftRound || tu) {
          snap = {
            ...snap,
            class: {
              ...c,
              clock: ck,
              roundEndsAt: shiftRound ? (c.roundEndsAt as number) + gapMs : c.roundEndsAt,
              // 시간 끝 대기(2분 유예)도 끊긴 만큼 미룬다
              schedule: tu ? { ...c.schedule, timeUp: { at: tu.at + gapMs } } : c.schedule,
            },
          };
        }
      }
      if (base.onHostGap) return base.onHostGap(snap, gapMs, now);
      return { snapshot: snap };
    },
    onTeacherAction: (snapshot, action, now) => {
      const ctx: Ctx = { snap: snapshot, outputs: [], now, inner };
      if (teacherAction(ctx, action)) return { snapshot: ctx.snap, outputs: ctx.outputs };
      return base.onTeacherAction ? base.onTeacherAction(snapshot, action, now) : null;
    },
  };
}

/** 훅 기본값(이름 검사 없음) */
export const tradeHooks: HostHooks = createTradeHooks();

// ─── 대시보드용 계산(순수) ────────────────────────────────

/**
 * 계획보다 늦은 정도(PRD 4.2.2 수동 진행 "계획보다 3분 늦어요 — 빠질 활동: …").
 * lateSec = 지금 경과 − 기다리는 첫 항목의 계획 시각. wouldDrop = 지금 다시 배치하면 새로 빠지는 활동 ID.
 */
export function lateness(snapshot: HostSnapshot, now: number): { lateSec: number; waitingId: string | null; wouldDrop: string[] } {
  const c = snapshot.class;
  if (!started(c) || c.tradeEnded) return { lateSec: 0, waitingId: null, wouldDrop: [] };
  const e = clock.elapsedSec(c.clock, now);
  const next = c.schedule.items.find(firable);
  if (!next || next.at >= e) return { lateSec: 0, waitingId: null, wouldDrop: [] };
  const lateSec = Math.floor(e - next.at);
  const r = reschedule(c.schedule, c, now, { type: 'none' }, { playUnit: snapshot.meta.playUnit, scope: c.settings.scope });
  const droppedNow = new Set(c.schedule.items.filter((it) => it.kind === 'event' && it.form === 'dropped').map((it) => it.refId));
  const wouldDrop = r.error ? [] : r.activities.filter((a) => a.form === 'dropped' && !droppedNow.has(a.id)).map((a) => a.id);
  return { lateSec, waitingId: next.id, wouldDrop };
}

/** 남은 무역 시간(초) */
export function tradeRemaining(c: ClassState, now: number): number {
  return clock.remaining(c.clock, now);
}
