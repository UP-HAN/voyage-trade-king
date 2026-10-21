/**
 * 교사 행동(학급 상태) — 구간 전환·사건·라운드·일시정지·학습지·편지 (PRD 4.2, 4.3.7, 6.7.2, 6.11, 7.7, 7.8) — 작업 103.
 *
 * `applyTeacherAction(classState, action, now) → { class, error?, needsConfirm?, sideEffects }` — 순수 함수.
 * 학생 회사에 미치는 일(라운드 끝 항해 처리, 사건 발동·마감의 개인 효과)은 `sideEffects`로 알려 주고,
 * 호스트 리듀서(`host.ts`)가 모든 학생에게 적용한다. 좌석·입장 관련 교사 행동(kick, renameCompany 등)은 host.ts 가 맡는다.
 * 무역 시계·배치표 자동 진행(startTrade/extend/shorten, 틱)은 작업 123.
 */
import { eventsById } from '../data/events';
import { roundLength, stageStartByLesson } from '../data/schedule';
import { worksheetById } from '../data/worksheet';
import type { GameEvent as EventDef, LessonId, WorksheetId } from '../data/types';
import { slotsArrivingAt } from './letters';
import { LESSON_ORDER } from './state';
import type { ActiveEffect, ClassSettings, ClassState, Phase, Player, TeacherAction } from './types';

export type SideEffect =
  | { type: 'eventFired'; id: string }
  | { type: 'eventClosed'; id: string }
  | { type: 'roundEnded'; round: number }
  | { type: 'stageStarted'; stage: LessonId }
  | { type: 'tradeEnded' }
  | { type: 'lettersDelivered'; slotIds: string[] };

export interface TeacherResult {
  class: ClassState;
  error?: string;
  /** 1등급 사건 건너뛰기 등 확인이 필요함(같은 행동을 confirm: true 로 다시 보내면 적용) */
  needsConfirm?: string;
  sideEffects: SideEffect[];
}

/** host.ts 가 처리하는 교사 행동 */
export const HOST_TEACHER_ACTIONS = [
  'lockJoin', 'unlockJoin', 'kick', 'approveRejoin', 'renameCompany', 'blockCompanyName', 'approveCompanyName', 'reassignSeat',
  'resendEvent', 'resendWorksheet',
] as const;

/** 작업 123이 채울 교사 행동 */
export const CLOCK_TEACHER_ACTIONS = ['startTrade', 'extend', 'shorten'] as const;

/** (작업 111) 마감한 뒤 결과를 보여 주는 시간(초) — 확인 퀴즈 정답률·해설, 결정 분포, 투표 결과 [게임 설정] */
export const EVENT_RESULT_SHOW_SEC = 20;

/** 결과(정답률·분포 막대)가 있는 사건인가: 확인 퀴즈·투표·선택지가 있는 개인 결정 */
export function hasResultView(def: EventDef | undefined): boolean {
  return !!def && (def.kind === 'checkQuiz' || def.kind === 'vote' || (def.kind === 'decision' && !!def.options?.length));
}

/** 마감한 사건의 결과를 지금 보여 주는 중인가 */
export function resultShowing(cs: Pick<ClassState, 'currentEvent'>, now: number): boolean {
  const ce = cs.currentEvent;
  return !!ce && ce.closed && typeof ce.resultUntil === 'number' && ce.resultUntil > now;
}

/** 이 사건이 지금 차단형인가(짧은 형태면 shortForm.blocking) */
export function isBlocking(def: EventDef, short: boolean): boolean {
  if (short && def.shortForm) return def.shortForm.blocking;
  return def.blocking;
}

/** 마무리 단계면 마무리 유지, 아니면 라운드 사이 */
function restingPhase(cs: ClassState): Phase {
  return cs.tradeEnded ? 'wrapup' : 'between';
}

/**
 * 학습지 팝업을 닫은 뒤 단계(작업 112 수정 1회차): 팝업을 띄우기 전 단계(`worksheet.returnPhase`)로 돌아간다.
 * 무역 시작 전에 띄웠으면 'prep'(방 코드 장면 유지 — ⑲처럼 무역 전에 쓰는 번호), 라운드 사이·라운드 끝 예약이면 'between'.
 * 'prep'에서 띄운 채 무역을 시작했거나 무역이 끝났으면 지금 상태에 맞춘다. 마무리('wrapup')에서는 단계를 바꾸지 않으므로 여기 오지 않는다.
 */
export function phaseAfterWorksheet(cs: Pick<ClassState, 'clock' | 'tradeEnded' | 'worksheet'>): Phase {
  if (cs.tradeEnded) return 'wrapup';
  const back = cs.worksheet.returnPhase;
  if (back === 'prep') return cs.clock.startedAt === null ? 'prep' : 'between';
  return 'between';
}

const ok = (cls: ClassState, sideEffects: SideEffect[] = []): TeacherResult => ({ class: cls, sideEffects });
const err = (cls: ClassState, error: string): TeacherResult => ({ class: cls, error, sideEffects: [] });

/** 사건 발동(학급 쪽 효과: 항구·기능 열기, 시장 꼬리표) */
function fire(cs: ClassState, def: EventDef, short: boolean, now: number): TeacherResult {
  const side: SideEffect[] = [];
  let cls: ClassState = { ...cs };
  if (cls.currentEvent && !cls.currentEvent.closed) {
    side.push({ type: 'eventClosed', id: cls.currentEvent.id });
  }
  const openPorts = new Set(cls.openPorts);
  const features = new Set(cls.features);
  const effects: ActiveEffect[] = [...cls.activeEffects];
  for (const e of def.effects) {
    if (e.type === 'unlock') {
      e.ports?.forEach((x) => openPorts.add(x));
      e.features?.forEach((x) => features.add(x));
    }
    if (e.type === 'priceTag') {
      const id = `${def.id}:${e.port}:${e.good}`;
      // until 'lessonEnd' = 그 구간이 끝날 때까지
      effects.push({ id, source: def.id, effect: { type: 'priceTag', port: e.port, good: e.good, tag: e.tag }, until: { stage: cls.stage, round: null } });
    }
  }
  const blocking = isBlocking(def, short);
  cls = {
    ...cls,
    openPorts: [...openPorts],
    features: [...features],
    activeEffects: dedupeEffects(effects),
    currentEvent: { id: def.id, openedAt: now, closesAt: null, closed: false, short },
    phase: blocking && !cls.tradeEnded && cls.phase !== 'round' ? 'event' : cls.phase,
    firedEvents: cls.firedEvents.includes(def.id) ? cls.firedEvents : [...cls.firedEvents, def.id],
    shortEvents: short ? [...new Set([...cls.shortEvents, def.id])] : cls.shortEvents.filter((x) => x !== def.id),
  };
  side.push({ type: 'eventFired', id: def.id });
  return ok(cls, side);
}

function dedupeEffects(list: ActiveEffect[]): ActiveEffect[] {
  const m = new Map<string, ActiveEffect>();
  for (const e of list) m.set(e.id, e);
  return [...m.values()];
}

function markSchedule(cs: ClassState, refId: string, status: 'live' | 'done' | 'skipped'): ClassState {
  if (!cs.schedule.items.some((it) => it.refId === refId && it.status !== status)) return cs;
  return {
    ...cs,
    schedule: {
      ...cs.schedule,
      items: cs.schedule.items.map((it) => (it.refId === refId && (it.kind === 'event' || it.kind === 'stageCover') ? { ...it, status } : it)),
    },
  };
}

function sanitizeSettings(cur: ClassSettings, patch: Partial<ClassSettings>): ClassSettings {
  const next: ClassSettings = { ...cur };
  if (patch.roundSec !== undefined) {
    const min = roundLength.teacherMinMinutes * 60;
    const max = roundLength.teacherMaxMinutes * 60;
    next.roundSec = Math.min(max, Math.max(min, Math.round(patch.roundSec)));
  }
  if (patch.leaderboardTopN !== undefined && [0, 3, 4, 5].includes(patch.leaderboardTopN)) next.leaderboardTopN = patch.leaderboardTopN;
  if (patch.awardsPerPrize !== undefined && [1, 2, 3].includes(patch.awardsPerPrize)) next.awardsPerPrize = patch.awardsPerPrize;
  if (patch.worksheetWaitSec !== undefined && [0, 15, 30].includes(patch.worksheetWaitSec)) next.worksheetWaitSec = patch.worksheetWaitSec;
  if (typeof patch.assetBoard === 'boolean') next.assetBoard = patch.assetBoard;
  if (typeof patch.nameReview === 'boolean') next.nameReview = patch.nameReview;
  if (typeof patch.comeback === 'boolean') next.comeback = patch.comeback;
  if (typeof patch.showForecastOnScreen === 'boolean') next.showForecastOnScreen = patch.showForecastOnScreen;
  if (Array.isArray(patch.extraBannedWords)) next.extraBannedWords = patch.extraBannedWords.filter((w) => typeof w === 'string').map((w) => w.slice(0, 20)).slice(0, 200);
  if (Array.isArray(patch.incidentKindsOff)) next.incidentKindsOff = patch.incidentKindsOff.filter((w) => typeof w === 'string');
  if (Array.isArray(patch.awardsOff)) next.awardsOff = [...patch.awardsOff];
  if (patch.incidentFreq && ['off', 'some', 'often'].includes(patch.incidentFreq)) next.incidentFreq = patch.incidentFreq;
  if (patch.worksheetMode && ['auto', 'each', 'stageEnd', 'after', 'off'].includes(patch.worksheetMode)) next.worksheetMode = patch.worksheetMode;
  if (patch.progressMode === 'auto' || patch.progressMode === 'manual') next.progressMode = patch.progressMode;
  if (typeof patch.activityRatio === 'number' && patch.activityRatio >= 0.5 && patch.activityRatio <= 0.8) next.activityRatio = patch.activityRatio;
  if (typeof patch.tradeMinutes === 'number' && patch.tradeMinutes >= 5 && patch.tradeMinutes <= 90) next.tradeMinutes = patch.tradeMinutes;
  // playUnit·scope 는 판 중에 바꾸지 않는다(새 판으로)
  return next;
}

/** 교사 행동 하나(학급 상태만) */
export function applyTeacherAction(cs: ClassState, action: TeacherAction, now: number): TeacherResult {
  if (cs.phase === 'ended' && action.type !== 'updateSettings') return err(cs, 'ENDED');
  switch (action.type) {
    case 'startStage': {
      const stage = action.stage;
      if (!cs.settings.scope.includes(stage)) return err(cs, 'NOT_IN_SCOPE');
      if (cs.phase === 'round') return err(cs, 'ROUND_IN_PROGRESS');
      // 학습지 팝업이 떠 있는 동안은 [라운드 시작]처럼 거절(PRD 7.7 — 쓰는 시간 보장, 작업 114)
      if (cs.phase === 'worksheet') return err(cs, 'WORKSHEET_OPEN');
      if (LESSON_ORDER[stage] < LESSON_ORDER[cs.stage]) return err(cs, 'STAGE_BACKWARD');
      if (stage === cs.stage && cs.stageFirstRound !== null) return err(cs, 'STAGE_ALREADY_STARTED');
      const start = stageStartByLesson[stage];
      let cls: ClassState = {
        ...cs,
        stage,
        stageFirstRound: null,
        openPorts: [...new Set([...cs.openPorts, ...start.ports])],
        features: [...new Set([...cs.features, ...start.features])],
        // 구간 효과(그 구간 끝까지)는 사라진다
        activeEffects: cs.activeEffects.filter((e) => !(e.until && e.until.stage !== null && e.until.stage !== stage)),
      };
      const coverId = Object.values(eventsById).find((e) => e.isCover && e.lesson === stage)?.id;
      const side: SideEffect[] = [{ type: 'stageStarted', stage }];
      if (coverId) {
        const r = fire(cls, eventsById[coverId], false, now);
        cls = markSchedule(r.class, coverId, 'live');
        side.push(...r.sideEffects);
      }
      return ok(cls, side);
    }
    case 'fireEvent': {
      const def = eventsById[action.id];
      if (!def) return err(cs, 'NO_EVENT');
      const short = Boolean(action.short) && def.shortForm !== null;
      // 차단형 활동은 라운드 사이에(라운드 중 발동 금지)
      if (cs.phase === 'round' && isBlocking(def, short)) return err(cs, 'ROUND_IN_PROGRESS');
      if (cs.phase === 'worksheet') return err(cs, 'WORKSHEET_OPEN');
      const r = fire(cs, def, short, now);
      return { ...r, class: markSchedule(r.class, def.id, 'live') };
    }
    case 'skipEvent': {
      const def = eventsById[action.id];
      if (!def) return err(cs, 'NO_EVENT');
      if ((def.tier === 1 || def.required) && !action.confirm) {
        return { class: cs, needsConfirm: 'REQUIRED_EVENT', sideEffects: [] };
      }
      let cls = markSchedule(cs, def.id, 'skipped');
      const side: SideEffect[] = [];
      if (cls.currentEvent?.id === def.id && !cls.currentEvent.closed) {
        cls = { ...cls, currentEvent: { ...cls.currentEvent, closed: true }, phase: cls.phase === 'event' ? restingPhase(cls) : cls.phase };
        side.push({ type: 'eventClosed', id: def.id });
      }
      return ok(cls, side);
    }
    case 'closeEvent': {
      const ev = cs.currentEvent;
      if (!ev || ev.closed) return err(cs, 'NO_OPEN_EVENT');
      // [마감]은 결과 공개와 함께(reveal) — 공용 화면에 선택 분포·정답률 막대(작업 111)
      // 결과가 있는 사건은 마감하면 늘 결과를 공개하고 EVENT_RESULT_SHOW_SEC 동안 보여 준다([결과 공개]를 먼저 누르지 않았어도)
      const withResult = hasResultView(eventsById[ev.id]);
      const revealed = ev.revealed === true || action.reveal === true || withResult;
      let cls: ClassState = {
        ...cs,
        currentEvent: {
          ...ev,
          closed: true,
          ...(revealed ? { revealed: true } : {}),
          ...(withResult ? { resultUntil: now + EVENT_RESULT_SHOW_SEC * 1000 } : {}),
        },
        phase: cs.phase === 'event' ? restingPhase(cs) : cs.phase,
      };
      cls = markSchedule(cls, ev.id, 'done');
      return ok(cls, [{ type: 'eventClosed', id: ev.id }]);
    }
    case 'endResult': {
      const ev = cs.currentEvent;
      if (!ev || !resultShowing(cs, now)) return err(cs, 'NO_RESULT');
      return ok({ ...cs, currentEvent: { ...ev, resultUntil: now } });
    }
    case 'revealEvent': {
      // [결과 공개](작업 111): 마감하지 않고 결과 막대만 공개. 투표면 투표 공개 표시도 함께
      const ev = cs.currentEvent;
      if (!ev) return err(cs, 'NO_EVENT');
      if (ev.revealed) return ok(cs);
      const isVote = eventsById[ev.id]?.kind === 'vote';
      const prevVote = cs.votes[ev.id];
      return ok({
        ...cs,
        currentEvent: { ...ev, revealed: true },
        votes: isVote ? { ...cs.votes, [ev.id]: { result: prevVote?.result ?? null, revealed: true } } : cs.votes,
      });
    }
    case 'startRound': {
      if (cs.tradeEnded) return err(cs, 'TRADE_ENDED');
      if (cs.phase === 'round') return err(cs, 'ROUND_IN_PROGRESS');
      if (cs.phase === 'event') return err(cs, 'EVENT_OPEN');
      if (cs.phase === 'worksheet') return err(cs, 'WORKSHEET_OPEN');
      const round = cs.round + 1;
      const sec = action.durationSec ?? cs.settings.roundSec;
      const arriving = slotsArrivingAt(cs, round);
      const cls: ClassState = {
        ...cs,
        round,
        phase: 'round',
        stageFirstRound: cs.stageFirstRound ?? round,
        roundEndsAt: cs.paused ? null : now + sec * 1000,
        roundRemainingMs: cs.paused ? sec * 1000 : null,
        letters: arriving.length ? { ...cs.letters, delivered: [...cs.letters.delivered, ...arriving] } : cs.letters,
      };
      return ok(cls, arriving.length ? [{ type: 'lettersDelivered', slotIds: arriving }] : []);
    }
    case 'endRound': {
      if (cs.phase !== 'round') return err(cs, 'NO_ROUND');
      let cls: ClassState = { ...cs, phase: restingPhase(cs), roundEndsAt: null, roundRemainingMs: null };
      // 라운드 중 예약된 학습지 팝업이 이제 뜬다(PRD 7.7)
      if (!cls.tradeEnded && cls.worksheet.pending.length) {
        const [next, ...rest] = cls.worksheet.pending;
        cls = { ...cls, phase: 'worksheet', worksheet: { ...cls.worksheet, current: next, pending: rest, openedAt: now, returnPhase: 'between' } };
      }
      return ok(cls, [{ type: 'roundEnded', round: cs.round }]);
    }
    case 'pause': {
      if (cs.paused) return err(cs, 'ALREADY_PAUSED');
      const remaining = cs.roundEndsAt !== null ? Math.max(0, cs.roundEndsAt - now) : cs.roundRemainingMs;
      return ok({ ...cs, paused: true, clock: { ...cs.clock, pausedAt: now }, roundEndsAt: null, roundRemainingMs: remaining });
    }
    case 'resume': {
      if (!cs.paused) return err(cs, 'NOT_PAUSED');
      const pausedSec = cs.clock.pausedAt !== null ? Math.max(0, (now - cs.clock.pausedAt) / 1000) : 0;
      const roundEndsAt = cs.phase === 'round' && cs.roundRemainingMs !== null ? now + cs.roundRemainingMs : cs.roundEndsAt;
      return ok({
        ...cs,
        paused: false,
        clock: { ...cs.clock, pausedAt: null, pausedTotalSec: cs.clock.pausedTotalSec + pausedSec },
        roundEndsAt,
        roundRemainingMs: cs.phase === 'round' ? null : cs.roundRemainingMs,
      });
    }
    case 'openWorksheet': {
      const ids = (Array.isArray(action.ids) ? action.ids : [action.ids]).filter((id): id is WorksheetId => id in worksheetById);
      if (!ids.length) return err(cs, 'NO_WORKSHEET');
      if (action.during) {
        // (작업 132) '지금 쓰기' 팝업: 예약하지 않는다(배치표가 라운드·다른 팝업이 끝나기를 기다렸다가 다시 띄움)
        if (ids.some((id) => !worksheetById[id].during)) return err(cs, 'NO_WORKSHEET');
        if (cs.phase === 'round' || cs.worksheet.current) return err(cs, 'WORKSHEET_OPEN');
        if (cs.phase === 'event') return err(cs, 'EVENT_OPEN');
        return ok({
          ...cs,
          phase: cs.tradeEnded ? cs.phase : 'worksheet',
          worksheet: {
            ...cs.worksheet, current: ids, openedAt: now, during: true, ...(action.afterNews ? { afterNews: true } : { afterNews: false }),
            returnPhase: cs.phase === 'worksheet' ? cs.worksheet.returnPhase : cs.phase,
          },
        });
      }
      // 라운드 중이면 예약 → 라운드가 끝나는 순간 뜬다. 다른 팝업이 떠 있으면 그 뒤에
      if (cs.phase === 'round' || cs.worksheet.current) {
        return ok({ ...cs, worksheet: { ...cs.worksheet, pending: [...cs.worksheet.pending, ids] } });
      }
      if (cs.phase === 'event') return err(cs, 'EVENT_OPEN');
      return ok({
        ...cs,
        phase: cs.tradeEnded ? cs.phase : 'worksheet',
        worksheet: { ...cs.worksheet, current: ids, openedAt: now, during: false, afterNews: false, returnPhase: cs.phase === 'worksheet' ? cs.worksheet.returnPhase : cs.phase },
      });
    }
    case 'closeWorksheet': {
      // all: 라운드 중 예약만 걸린 경우(떠 있는 팝업 없음)도 예약을 지운다(작업 114 — '학습지 팝업 끄기')
      if (action.all && !cs.worksheet.current) {
        if (!cs.worksheet.pending.length) return err(cs, 'NO_WORKSHEET');
        return ok({ ...cs, worksheet: { ...cs.worksheet, pending: [] } });
      }
      if (!cs.worksheet.current) return err(cs, 'NO_WORKSHEET');
      const [next, ...rest] = action.all ? [] : cs.worksheet.pending;
      if (action.all && cs.worksheet.pending.length) cs = { ...cs, worksheet: { ...cs.worksheet, pending: [] } };
      if (next) return ok({ ...cs, worksheet: { ...cs.worksheet, current: next, pending: rest, openedAt: now, during: false, afterNews: false } });
      // 팝업 전 단계로 돌아간다: 무역 시작 전이면 'prep'(방 코드 장면 유지), 무역 중이면 'between', 마무리면 'wrapup'(작업 112 수정 1회차)
      const { returnPhase: _rp, ...rest0 } = cs.worksheet;
      void _rp;
      return ok({ ...cs, phase: cs.phase === 'worksheet' ? phaseAfterWorksheet(cs) : cs.phase, worksheet: { ...rest0, current: null, openedAt: null, during: false, afterNews: false } });
    }
    case 'toggleLetters':
      return ok({ ...cs, letters: { ...cs.letters, enabled: action.enabled ?? !cs.letters.enabled } });
    case 'skipLetterSlot': {
      if (cs.letters.skipped.includes(action.slotId)) return err(cs, 'ALREADY_SKIPPED');
      // 이미 도착한 편지는 건너뛸 수 없다(답한 학생·안 연 학생의 기회가 달라지므로). 배달 전 슬롯만
      if (cs.letters.delivered.includes(action.slotId)) return err(cs, 'ALREADY_DELIVERED');
      return ok({ ...cs, letters: { ...cs.letters, skipped: [...cs.letters.skipped, action.slotId] } });
    }
    case 'updateSettings': {
      const settings = sanitizeSettings(cs.settings, action.settings ?? {});
      // (작업 151) 항해 방식은 판 시작 전(준비 단계·무역 시작 전)에만 바꾼다
      const v = action.settings?.voyageMode;
      if ((v === 'round' || v === 'free') && cs.phase === 'prep' && cs.round === 0 && cs.clock.startedAt === null) settings.voyageMode = v;
      return ok({ ...cs, settings });
    }
    case 'endTrade': {
      if (cs.tradeEnded) return err(cs, 'TRADE_ENDED');
      const side: SideEffect[] = [];
      let cls: ClassState = { ...cs };
      if (cls.phase === 'round') side.push({ type: 'roundEnded', round: cls.round });
      if (cls.currentEvent && !cls.currentEvent.closed) {
        side.push({ type: 'eventClosed', id: cls.currentEvent.id });
        cls = { ...cls, currentEvent: { ...cls.currentEvent, closed: true } };
      }
      cls = { ...cls, phase: 'wrapup', tradeEnded: true, roundEndsAt: null, roundRemainingMs: null, worksheet: { ...cls.worksheet, current: null, pending: [] } };
      side.push({ type: 'tradeEnded' });
      return ok(cls, side);
    }
    case 'endSession':
      return ok({ ...cs, phase: 'ended', tradeEnded: true, roundEndsAt: null });
    case 'startTrade':
    case 'extend':
    case 'shorten':
      return err(cs, 'NOT_IMPLEMENTED');
    default:
      return err(cs, (HOST_TEACHER_ACTIONS as readonly string[]).includes((action as TeacherAction).type) ? 'HOST_ACTION' : 'BAD_ACTION');
  }
}

/**
 * 늦게 온 학생이 받아야 할 개인 응답 사건(PRD 6.11.2 따라잡기): 이미 발동한 사건 중
 * `catchUp: 'replay'`이고 응답이 필요한데 아직 응답하지 않은 것(발동 순). 회사 설립을 안 했으면 L1-E3 이 맨 앞.
 * 투표·마감이 지난 비공개 결정처럼 지금 응답할 수 없는 사건은 뺀다.
 */
export function catchUpQueue(cs: ClassState, player: Player): string[] {
  const out: string[] = [];
  if (!player.company.founded) out.push('L1-E3');
  for (const id of cs.firedEvents) {
    const def = eventsById[id];
    if (!def || def.catchUp !== 'replay' || !def.needsResponse) continue;
    if (player.game.responses[id] !== undefined) continue;
    const live = cs.currentEvent?.id === id && !cs.currentEvent.closed;
    if ((def.kind === 'vote' || id === 'L3-E3') && !live) continue;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}
