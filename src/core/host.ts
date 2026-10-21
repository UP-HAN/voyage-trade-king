/**
 * 호스트 리듀서 (PRD 7.4, 10.3) — 작업 103.
 *
 * `hostReduce(snapshot, input, now, hooks?) → { snapshot, outputs }` — 순수 함수(같은 입력 → 같은 출력).
 * 교사 브라우저(호스트)가 학생 행동·교사 행동·시계 틱·입장/퇴장 알림을 모두 이 함수로 처리한다.
 * - 학생 행동: 그 좌석 Player 에 `applyAction` → 그 학생에게 ack(+바뀌었으면 개인 상태).
 * - 교사 행동: 학급 상태 `applyTeacherAction` + 좌석 관련 행동(입장 마감·내보내기·이름·번호 바꾸기)은 여기서.
 * - 라운드 끝: 접속 여부와 상관없이 **모든 학생**에게 `resolveRounds`.
 * - 출력은 바뀐 것만: 공개 상태(하나로 묶음, 방 전체), 개인 상태(그 학생만), ack(행동마다).
 * - 시계 틱: 라운드 마감(`roundEndsAt`)만 처리하고 `hooks.onTick`(작업 123이 채움)을 부른다.
 */
import { eventsById } from '../data/events';
import { worksheetById } from '../data/worksheet';
import type { WorksheetId } from '../data/types';
import { applyFiredEventToPlayer, closeEventForAll } from './activities';
import { basicNameValidator, type NameValidator } from './company';
import { applyTeacherAction, type SideEffect } from './lesson';
import { assignDeliveredLetters } from './letters';
import { publicPayload } from './aggregate';
import { applyAction, predict, type ActionContext } from './rules';
import { clone, createPlayer, seatKey } from './state';
import { stepStuckHints } from './stuckHints';
import { resolveRounds } from './voyage';
import type { GameEvent, HostInput, HostOutput, HostSnapshot, Player, PlayerView, ReduceResult, TeacherAction } from './types';

export { predict };

export interface HostHooks {
  /** 시계 틱마다(작업 123: 무역 시계·배치표 자동 진행·기준 자산 기록) */
  onTick?: (snapshot: HostSnapshot, now: number) => { snapshot: HostSnapshot; outputs?: HostOutput[] };
  /** 교사 화면이 꺼져 있던 시간(작업 123: 일시정지로 처리) */
  onHostGap?: (snapshot: HostSnapshot, gapMs: number, now: number) => { snapshot: HostSnapshot; outputs?: HostOutput[] };
  /**
   * 교사 행동을 먼저 받아 본다(작업 123: startTrade·extend·shorten·pause·resume·배치표 조작).
   * 처리했으면 결과를, 아니면 null 을 돌려준다(null 이면 기본 처리).
   */
  onTeacherAction?: (snapshot: HostSnapshot, action: TeacherAction, now: number) => { snapshot: HostSnapshot; outputs?: HostOutput[] } | null;
  /** 회사 이름 검사(작업 124 `validateCompanyName` 주입) */
  validateName?: NameValidator;
}

/** 학생에게 보내는 개인 상태(기기 토큰 제외) */
export function playerView(p: Player): PlayerView {
  const { deviceToken: _t, ...rest } = p;
  void _t;
  return rest;
}

function otherNameKeys(players: Record<string, Player>, exceptSeat: number): string[] {
  return Object.values(players)
    .filter((p) => p.seat !== exceptSeat)
    .map((p) => p.company.nameKey);
}

interface Work {
  snap: HostSnapshot;
  outputs: HostOutput[];
  /** 좌석별 연출 이벤트(라운드 처리 등) */
  events: Record<string, GameEvent[]>;
}

function addEvents(w: Work, key: string, evs: readonly GameEvent[]): void {
  if (!evs.length) return;
  (w.events[key] ??= []).push(...evs);
}

/** 모든 학생 라운드 처리 */
function resolveAll(w: Work): void {
  const players = { ...w.snap.players };
  for (const [key, p] of Object.entries(players)) {
    const r = resolveRounds(w.snap.class, p);
    if (r.player !== p) players[key] = r.player;
    addEvents(w, key, r.events);
  }
  w.snap = { ...w.snap, players };
}

function applySideEffects(w: Work, side: readonly SideEffect[]): void {
  for (const s of side) {
    if (s.type === 'roundEnded' || s.type === 'tradeEnded') resolveAll(w);
    if (s.type === 'lettersDelivered') {
      // 도착 순간 학생별 문항을 고정(이후 출석번호 변경·슬롯 변경에도 편지함 문항이 바뀌지 않음)
      const players = { ...w.snap.players };
      for (const [key, p] of Object.entries(players)) {
        const np = clone(p);
        if (assignDeliveredLetters(w.snap.class, np)) {
          np.rev = p.rev + 1;
          players[key] = np;
        }
      }
      w.snap = { ...w.snap, players };
    }
    if (s.type === 'eventFired') {
      const def = eventsById[s.id];
      if (!def) continue;
      const players = { ...w.snap.players };
      for (const [key, p] of Object.entries(players)) {
        const np = clone(p);
        const evs: GameEvent[] = [];
        applyFiredEventToPlayer(w.snap.class, np, def, evs);
        if (JSON.stringify(np.game) !== JSON.stringify(p.game)) {
          np.rev = p.rev + 1;
          players[key] = np;
        }
        addEvents(w, key, evs);
      }
      w.snap = { ...w.snap, players };
    }
    if (s.type === 'eventClosed') {
      const r = closeEventForAll(w.snap.class, w.snap.players, s.id);
      w.snap = { ...w.snap, class: r.class, players: r.players };
      for (const [key, evs] of Object.entries(r.events)) addEvents(w, key, evs);
    }
  }
}

function notice(w: Work, code: string, action?: TeacherAction, message?: string): void {
  w.outputs.push({ to: 'teacher', kind: 'notice', code, ...(action ? { action } : {}), ...(message ? { message } : {}) });
}

/** 좌석·이름 관련 교사 행동(호스트 소관). 처리했으면 true */
function hostTeacherAction(w: Work, action: TeacherAction, hooks: HostHooks): boolean {
  const s = w.snap;
  const setPlayer = (key: string, p: Player) => (w.snap = { ...w.snap, players: { ...w.snap.players, [key]: p } });
  switch (action.type) {
    case 'lockJoin':
    case 'unlockJoin':
      w.snap = { ...s, meta: { ...s.meta, locked: action.type === 'lockJoin' } };
      return true;
    case 'kick': {
      // 번호를 비운다(기기 토큰 차단은 세션 124)
      const key = seatKey(action.seat);
      if (!s.players[key]) return notice(w, 'NO_SEAT', action), true;
      const players = { ...s.players };
      delete players[key];
      w.snap = { ...s, players };
      return true;
    }
    case 'approveRejoin': {
      // 기기 토큰 묶기는 세션(124)이 하고, 새 기기는 join 입력으로 들어온다
      if (!s.players[seatKey(action.seat)]) notice(w, 'NO_SEAT', action);
      return true;
    }
    case 'renameCompany': {
      const key = seatKey(action.seat);
      const p = s.players[key];
      if (!p) return notice(w, 'NO_SEAT', action), true;
      const validate = hooks.validateName ?? basicNameValidator;
      const res = validate(action.name, {
        takenKeys: otherNameKeys(s.players, action.seat),
        bannedKeys: [],
        extraWords: s.class.settings.extraBannedWords,
      });
      let name: string;
      let nameKey: string;
      if (res.ok) {
        name = res.name;
        nameKey = res.key;
      } else if (res.error === 'BAD_NAME') {
        // 교사 권한: 금칙어는 경고만 하고 적용(PRD 6.1.1). 길이·형식·중복은 막는다
        const fallback = basicNameValidator(action.name, { takenKeys: otherNameKeys(s.players, action.seat), bannedKeys: [], extraWords: [] });
        if (!fallback.ok) return notice(w, fallback.error, action), true;
        name = fallback.name;
        nameKey = fallback.key;
        notice(w, 'BAD_NAME_WARNING', action);
      } else {
        return notice(w, res.error, action), true;
      }
      setPlayer(key, { ...p, rev: p.rev + 1, company: { ...p.company, name, nameKey, nameStatus: 'ok' } });
      return true;
    }
    case 'blockCompanyName': {
      const key = seatKey(action.seat);
      const p = s.players[key];
      if (!p) return notice(w, 'NO_SEAT', action), true;
      w.snap = {
        ...s,
        class: { ...s.class, bannedNameKeys: [...new Set([...s.class.bannedNameKeys, p.company.nameKey])] },
        players: { ...s.players, [key]: { ...p, rev: p.rev + 1, company: { ...p.company, nameStatus: 'blocked' } } },
      };
      return true;
    }
    case 'approveCompanyName': {
      const key = seatKey(action.seat);
      const p = s.players[key];
      if (!p) return notice(w, 'NO_SEAT', action), true;
      if (p.company.nameStatus === 'blocked') return notice(w, 'NAME_BLOCKED', action), true;
      if (p.company.nameStatus !== 'ok') setPlayer(key, { ...p, rev: p.rev + 1, company: { ...p.company, nameStatus: 'ok' } });
      return true;
    }
    case 'reassignSeat': {
      // 회사 상태는 그대로, 좌석(출석번호)만 옮긴다
      const from = seatKey(action.from);
      const to = seatKey(action.to);
      const p = s.players[from];
      if (!p) return notice(w, 'NO_SEAT', action), true;
      if (!Number.isInteger(action.to) || action.to < 1 || action.to > 40) return notice(w, 'BAD_SEAT', action), true;
      if (s.players[to]) return notice(w, 'SEAT_TAKEN', action), true;
      const players = { ...s.players };
      delete players[from];
      players[to] = { ...p, seat: action.to, rev: p.rev + 1 };
      w.snap = { ...s, players };
      return true;
    }
    case 'resendEvent': {
      // [이 학생만 사건 다시 보내기](작업 111): 그 학생 기기의 따라잡기 큐에 넣으라고 알린다(eventTriggered).
      // 응답 기록은 지우지 않는다(보상 두 번 방지). 아직 응답하지 않은 개인 사건은 재입장 때도 따라잡기로 다시 나온다.
      const key = seatKey(action.seat);
      const p = s.players[key];
      if (!p) return notice(w, 'NO_SEAT', action), true;
      if (!eventsById[action.id] || !s.class.firedEvents.includes(action.id)) return notice(w, 'NOT_FIRED', action), true;
      const np = clone(p);
      np.game.log.push({ round: s.class.round, stage: s.class.stage, kind: 'event', ref: `resend:${action.id}` });
      np.rev = p.rev + 1;
      setPlayer(key, np);
      addEvents(w, key, [{ type: 'eventTriggered', id: action.id }]);
      return true;
    }
    case 'resendWorksheet': {
      // [이 학생에게 학습지 다시 보내기](작업 112, PRD 7.7): 늦게 온 학생 등에게 그 학생만 개인 팝업.
      // 기록(log ref 'resendWs:W03')으로 남겨 재접속해도 다시 뜬다. [다 썼어요](markWorksheetDone)를 누르면 끝.
      const key = seatKey(action.seat);
      const p = s.players[key];
      if (!p) return notice(w, 'NO_SEAT', action), true;
      if (!worksheetById[action.wId]) return notice(w, 'NO_WORKSHEET', action), true;
      if (p.game.worksheetDone.includes(action.wId)) return notice(w, 'ALREADY_DONE', action), true;
      const np = clone(p);
      np.game.log.push({ round: s.class.round, stage: s.class.stage, kind: 'event', ref: `${RESEND_WS_PREFIX}${action.wId}` });
      np.rev = p.rev + 1;
      setPlayer(key, np);
      return true;
    }
    default:
      return false;
  }
}

/** 학습지 다시 보내기 기록 접두어(log ref) */
export const RESEND_WS_PREFIX = 'resendWs:';

/** 이 학생에게 다시 보냈고 아직 다 쓰지 않은 학습지 번호(보낸 순) */
export function resentWorksheets(p: Pick<Player, 'game'>): WorksheetId[] {
  const out: WorksheetId[] = [];
  for (const e of p.game.log) {
    if (e.kind !== 'event' || !e.ref?.startsWith(RESEND_WS_PREFIX)) continue;
    const id = e.ref.slice(RESEND_WS_PREFIX.length) as WorksheetId;
    if (worksheetById[id] && !p.game.worksheetDone.includes(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

function teacher(w: Work, action: TeacherAction, now: number, hooks: HostHooks): void {
  if (hooks.onTeacherAction) {
    const r = hooks.onTeacherAction(w.snap, action, now);
    if (r) {
      w.snap = r.snapshot;
      if (r.outputs) w.outputs.push(...r.outputs);
      return;
    }
  }
  if (hostTeacherAction(w, action, hooks)) return;
  const r = applyTeacherAction(w.snap.class, action, now);
  if (r.needsConfirm) return notice(w, 'NEEDS_CONFIRM', action, r.needsConfirm);
  if (r.error) return notice(w, r.error, action);
  w.snap = { ...w.snap, class: r.class };
  applySideEffects(w, r.sideEffects);
}

/**
 * 호스트 리듀서. `hooks`는 선택(작업 123의 onTick, 작업 124의 validateName).
 */
export function hostReduce(snapshot: HostSnapshot, input: HostInput, now: number, hooks: HostHooks = {}): ReduceResult {
  const beforePlayers = snapshot.players;
  const beforePublic = JSON.stringify(publicPayload(snapshot));
  const w: Work = { snap: snapshot, outputs: [], events: {} };
  let ackFor: { seat: number; seq: number; ok: boolean; error?: string; events: GameEvent[] } | null = null;

  switch (input.type) {
    case 'act': {
      const key = seatKey(input.seat);
      const p = w.snap.players[key];
      if (!p) {
        ackFor = { seat: input.seat, seq: input.seq, ok: false, error: 'NOT_SEATED', events: [] };
        break;
      }
      const ctx: ActionContext = { validateName: hooks.validateName, takenKeys: otherNameKeys(w.snap.players, input.seat) };
      const r = applyAction(w.snap.class, p, input.action, ctx);
      if (r.error) {
        ackFor = { seat: input.seat, seq: input.seq, ok: false, error: r.error, events: [] };
      } else {
        w.snap = { ...w.snap, players: { ...w.snap.players, [key]: r.player } };
        ackFor = { seat: input.seat, seq: input.seq, ok: true, events: r.events };
      }
      break;
    }
    case 'teacher':
      teacher(w, input.action, now, hooks);
      break;
    case 'tick': {
      const c = w.snap.class;
      if (c.phase === 'round' && !c.paused && c.roundEndsAt !== null && now >= c.roundEndsAt) {
        teacher(w, { type: 'endRound' }, now, hooks);
      }
      if (hooks.onTick) {
        const r = hooks.onTick(w.snap, now);
        w.snap = r.snapshot;
        if (r.outputs) w.outputs.push(...r.outputs);
      }
      // (작업 160b) 막힌 학생 갈매기 힌트 — 무역 훅 다음, 틱에서만
      const sh = stepStuckHints(w.snap, now);
      w.snap = sh.snapshot;
      for (const [key, evs] of Object.entries(sh.events)) addEvents(w, key, evs);
      break;
    }
    case 'join': {
      const key = seatKey(input.seat);
      const cur = w.snap.players[key];
      if (cur) {
        const token = input.deviceToken ?? cur.deviceToken;
        if (!cur.online || cur.deviceToken !== token) {
          w.snap = { ...w.snap, players: { ...w.snap.players, [key]: { ...cur, online: true, deviceToken: token } } };
        }
      } else {
        // 새 회사: 범위의 첫 구간 시작 조건 + 이미 발동한 사건의 개인 효과(임무·요약 카드) 따라잡기
        const np = createPlayer(w.snap.meta, w.snap.class, {
          seat: input.seat,
          pid: input.pid,
          deviceToken: input.deviceToken,
          companyName: input.companyName,
          nameKey: input.nameKey,
          nameStatus: input.nameStatus,
          now,
        });
        const evs: GameEvent[] = [];
        for (const id of w.snap.class.firedEvents) {
          const def = eventsById[id];
          if (def) applyFiredEventToPlayer(w.snap.class, np, def, evs);
        }
        // 이미 도착했고 아직 만료되지 않은 편지도 받는다(PRD 6.7.2) — 문항 배정
        assignDeliveredLetters(w.snap.class, np);
        w.snap = { ...w.snap, players: { ...w.snap.players, [key]: np } };
      }
      break;
    }
    case 'leave':
    case 'presence': {
      const key = seatKey(input.seat);
      const cur = w.snap.players[key];
      const online = input.type === 'presence' ? input.online : false;
      if (cur && cur.online !== online) w.snap = { ...w.snap, players: { ...w.snap.players, [key]: { ...cur, online } } };
      break;
    }
    case 'hostGap': {
      if (hooks.onHostGap) {
        const r = hooks.onHostGap(w.snap, input.gapMs, now);
        w.snap = r.snapshot;
        if (r.outputs) w.outputs.push(...r.outputs);
      }
      break;
    }
  }

  // ── 출력: 바뀐 것만 ──
  const outputs: HostOutput[] = [];
  const afterPublic = publicPayload(w.snap);
  const publicChanged = JSON.stringify(afterPublic) !== beforePublic;
  if (publicChanged) w.snap = { ...w.snap, rev: w.snap.rev + 1 };
  if (w.snap !== snapshot) w.snap = { ...w.snap, savedAt: now };
  if (publicChanged) outputs.push({ to: 'all', kind: 'public', version: w.snap.rev, data: afterPublic });
  for (const [key, p] of Object.entries(w.snap.players)) {
    if (beforePlayers[key] !== p) outputs.push({ to: 'seat', seat: p.seat, kind: 'me', version: p.rev, data: playerView(p) });
    const evs = w.events[key];
    if (evs?.length) outputs.push({ to: 'seat', seat: p.seat, kind: 'events', events: evs });
  }
  if (ackFor) {
    const p = w.snap.players[seatKey(ackFor.seat)];
    outputs.push({
      to: 'seat',
      seat: ackFor.seat,
      kind: 'ack',
      seq: ackFor.seq,
      ok: ackFor.ok,
      ...(ackFor.error ? { error: ackFor.error } : {}),
      version: p ? p.rev : 0,
      events: ackFor.events,
    });
  }
  outputs.push(...w.outputs);
  return { snapshot: w.snap, outputs };
}

/** 훅을 묶은 리듀서(작업 124 세션에 주입하는 모양) */
export function createHostReducer(hooks: HostHooks = {}): (snapshot: HostSnapshot, input: HostInput, now: number) => ReduceResult {
  return (snapshot, input, now) => hostReduce(snapshot, input, now, hooks);
}

// ─── 작업 124 세션 계층 모양으로 바꾸기(src/sync 를 import 하지 않는 구조적 어댑터) ───

/** 세션(124 `SessionOutput`)과 같은 모양의 출력 */
export type SessionLikeOutput =
  | { type: 'public'; data?: Record<string, unknown> }
  | { type: 'me'; seat: number; data?: Record<string, unknown> }
  | { type: 'ack'; seat: number; seq: number; ok: boolean; error?: string }
  | { type: 'teacher'; data: Record<string, unknown> };

/**
 * HostOutput → 세션 출력. 연출 이벤트(ack.events, 'events')는 세션 출력에 자리가 없어 `me.data.events`로 싣는다
 * (화면이 쓰지 않으면 무시해도 된다).
 */
export function toSessionOutputs(outputs: readonly HostOutput[]): SessionLikeOutput[] {
  const out: SessionLikeOutput[] = [];
  const evBySeat = new Map<number, GameEvent[]>();
  for (const o of outputs) {
    if (o.kind === 'events') evBySeat.set(o.seat, [...(evBySeat.get(o.seat) ?? []), ...o.events]);
    if (o.kind === 'ack' && o.events.length) evBySeat.set(o.seat, [...(evBySeat.get(o.seat) ?? []), ...o.events]);
  }
  for (const o of outputs) {
    if (o.kind === 'public') out.push({ type: 'public', data: o.data as unknown as Record<string, unknown> });
    else if (o.kind === 'me') {
      const events = evBySeat.get(o.seat);
      out.push({ type: 'me', seat: o.seat, data: { ...(o.data as unknown as Record<string, unknown>), ...(events ? { events } : {}) } });
    } else if (o.kind === 'ack') out.push({ type: 'ack', seat: o.seat, seq: o.seq, ok: o.ok, ...(o.error ? { error: o.error } : {}) });
    else if (o.kind === 'notice') out.push({ type: 'teacher', data: { notice: o.code, ...(o.message ? { message: o.message } : {}), ...(o.action ? { action: o.action } : {}) } });
  }
  return out;
}

/** 세션(124 `createHostSession({ reducer })`)에 바로 넣는 리듀서 */
export function createSessionReducer(hooks: HostHooks = {}): (snapshot: HostSnapshot, input: HostInput, now: number) => { snapshot: HostSnapshot; outputs: SessionLikeOutput[] } {
  return (snapshot, input, now) => {
    const r = hostReduce(snapshot, input, now, hooks);
    return { snapshot: r.snapshot, outputs: toSessionOutputs(r.outputs) };
  };
}
