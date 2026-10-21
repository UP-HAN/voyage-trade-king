/**
 * 상태 만들기·읽기(기본값 채우기) — 작업 103.
 * `types.ts`가 `normalizePlayer`·`normalizeClass`·`normalizeSnapshot`을 다시 내보낸다.
 */
import { goodsUnlockedBy } from '../data/goods';
import { incidentCountRule, roundLength, stageStartByLesson, tradeMinutes, WORKSHEET_WAIT_SEC_DEFAULT } from '../data/schedule';
import { STARTING_PORT, STARTING_SHIP } from '../data/ships';
import { awardRules, leaderboardRules, scoringConstants } from '../data/awards';
import type { GoodId, LessonId, PortId } from '../data/types';
import { LESSON_IDS } from '../data/types';
import { defaultFlag, basicNameKey } from './company';
import type {
  ActiveEffect,
  ClassSettings,
  ClassState,
  Company,
  HostSnapshot,
  Json,
  LettersState,
  Metrics,
  NameStatus,
  PlayUnit,
  Player,
  PlayerGame,
  ScheduleState,
  SessionMeta,
  WorksheetState,
} from './types';

// ─── 작은 도구 ────────────────────────────────────────────

/** 좌석 키 's07' */
export function seatKey(seat: number): string {
  return `s${String(seat).padStart(2, '0')}`;
}

export const LESSON_ORDER: Readonly<Record<LessonId, number>> = { L1: 1, L2: 2, L3: 3, L4: 4 };

/** 끝난 라운드 번호(라운드 진행 중이면 그 앞 라운드) */
export function completedRound(cs: ClassState): number {
  return cs.phase === 'round' ? cs.round - 1 : cs.round;
}

/** 무역(사고팔기·목적지 고르기)을 할 수 있는 때: 라운드 진행 중이고 일시정지가 아님 */
export function isTrading(cs: ClassState): boolean {
  return cs.phase === 'round' && !cs.paused;
}

/**
 * (작업 153 추가, 교사 결정 2026-10-21) 사고팔기·만들기·자유 항해를 할 수 있는 때.
 * 라운드마다 판은 `isTrading` 그대로. 자유 항해 판은 라운드 끝이 막지 않는다 — 라운드 사이('between', 첫 라운드 뒤)에도 된다.
 * 막는 것은 교사의 [잠깐 멈춤]·판 마감(무역 끝)과, 차단형 활동이 열린 단계('event'·'worksheet' 등)뿐.
 */
export function canTrade(cs: ClassState): boolean {
  if (isTrading(cs)) return true;
  return isFreeVoyage(cs) && cs.phase === 'between' && cs.round >= 1 && !cs.paused && !cs.tradeEnded;
}

/** 자유 항해 판인가(규칙 엔진 기본은 'round') */
export function isFreeVoyage(cs: Pick<ClassState, 'settings'>): boolean {
  return cs.settings?.voyageMode === 'free';
}

/** (작업 151) 이번 라운드에 쌓인 낼 운항비(옛 상태에는 없음 = 0) */
export function fareDueOf(p: Pick<Player, 'game'>): number {
  return p.game.fareDue ?? 0;
}

/** (작업 151) 이번 라운드 항해 횟수(옛 상태에는 없음 = 0) */
export function sailsThisRoundOf(p: Pick<Player, 'game'>): number {
  return p.game.sailsThisRound ?? 0;
}

/**
 * (작업 151) 쓸 수 있는 돈: 자유 항해면 자금 − 낼 운항비, 아니면 자금 그대로.
 * 사기·생산·조선소 등 돈 쓰는 행동의 "돈이 모자라요" 판정에 쓴다.
 */
export function spendable(cs: Pick<ClassState, 'settings'>, p: Pick<Player, 'game'>): number {
  return isFreeVoyage(cs) ? p.game.money - fareDueOf(p) : p.game.money;
}

/** 그 구간 안 몇 번째 라운드(1부터). 라운드 전이면 0 */
export function stageRoundIndex(cs: ClassState): number {
  if (cs.stageFirstRound === null || cs.round < cs.stageFirstRound) return 0;
  return cs.round - cs.stageFirstRound + 1;
}

/** 지금 공개된 상품(구간 진행 순서 기준) */
export function visibleGoods(cs: ClassState): GoodId[] {
  return goodsUnlockedBy(cs.stage);
}

export function isEffectActive(e: ActiveEffect, cs: ClassState): boolean {
  if (e.until === null) return true;
  if (e.until.stage !== null && e.until.stage !== cs.stage) return false;
  if (e.until.round !== null && cs.round > e.until.round) return false;
  return true;
}

export function activeEffects(cs: ClassState): ActiveEffect[] {
  return cs.activeEffects.filter((e) => isEffectActive(e, cs));
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown, d: string): string => (typeof v === 'string' ? v : d);
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? ([...v] as T[]) : []);
const rec = <T>(v: unknown): Record<string, T> => (isObj(v) ? ({ ...v } as Record<string, T>) : {});
const isLesson = (v: unknown): v is LessonId => typeof v === 'string' && (LESSON_IDS as readonly string[]).includes(v);

/** 깊은 복사(JSON 상태 전용) */
export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

// ─── 기본값 ───────────────────────────────────────────────

export function defaultSettings(playUnit: PlayUnit, scope: LessonId[], minutes: number = tradeMinutes.default): ClassSettings {
  const stageMinutes = minutes / Math.max(1, scope.length);
  return {
    playUnit,
    scope: [...scope],
    tradeMinutes: minutes,
    activityRatio: 0.6,
    roundSec: stageMinutes >= roundLength.longStageMinMinutes ? roundLength.longSec : roundLength.shortSec,
    incidentFreq: incidentCountRule.default,
    incidentKindsOff: [],
    comeback: true,
    worksheetMode: 'auto',
    leaderboardTopN: leaderboardRules.topNDefault as 3,
    assetBoard: leaderboardRules.assetTabDefault,
    awardsPerPrize: awardRules.perPrizeDefault as 3,
    nameReview: false,
    extraBannedWords: [],
    worksheetWaitSec: WORKSHEET_WAIT_SEC_DEFAULT as 15,
    showForecastOnScreen: false,
    progressMode: 'auto',
    awardsOff: [],
    voyageMode: 'round',
  };
}

export interface CreateSessionInput {
  code: string;
  className?: string;
  playUnit: PlayUnit;
  scope: LessonId[];
  seed: number;
  now: number;
  hostToken?: string;
  settings?: Partial<ClassSettings>;
}

/**
 * 판 시작(PRD 4.2.3): 범위의 첫 구간 시작 조건(자금·열린 항구·기능)으로 학급 상태를 만든다.
 * 학생 회사는 입장할 때 `createPlayer`가 같은 조건으로 만든다.
 */
export function startSession(input: CreateSessionInput): HostSnapshot {
  const scope = input.scope.length ? [...input.scope] : ['L1' as LessonId];
  const first = scope[0];
  const start = stageStartByLesson[first];
  const settings: ClassSettings = { ...defaultSettings(input.playUnit, scope), ...(input.settings ?? {}), playUnit: input.playUnit, scope };
  const meta: SessionMeta = {
    v: 3,
    code: input.code,
    className: input.className ?? '',
    createdAt: input.now,
    playUnit: input.playUnit,
    scope,
    seed: input.seed,
    locked: false,
  };
  const cls: ClassState = {
    stage: first,
    round: 0,
    phase: 'prep',
    clock: { durationSec: settings.tradeMinutes * 60, startedAt: null, endsAt: null, pausedAt: null, pausedTotalSec: 0 },
    roundEndsAt: null,
    roundRemainingMs: null,
    paused: false,
    seed: input.seed,
    schedule: { items: [], version: 0, mode: settings.progressMode },
    currentEvent: null,
    worksheet: emptyWorksheet(settings.worksheetMode),
    letters: { enabled: true, delivered: [], skipped: [], slots: null },
    incidents: { active: [], forecasts: [] },
    activeEffects: [],
    settings,
    bannedNameKeys: [],
    openPorts: [...start.ports],
    features: [...start.features],
    stageFirstRound: null,
    firedEvents: [],
    shortEvents: [],
    votes: {},
    tradeEnded: false,
  };
  return { v: 3, meta, class: cls, players: {}, hostToken: input.hostToken ?? '', savedAt: input.now, rev: 0 };
}

/** 작업 123이 더한 배치표 선택 필드를 그대로 옮긴다(없는 필드는 넣지 않음 — undefined 금지) */
function scheduleExtras(r: Record<string, unknown>): Partial<ScheduleState> {
  const out: Partial<ScheduleState> = {};
  if (isObj(r.overrides)) out.overrides = rec(r.overrides) as ScheduleState['overrides'];
  if (Array.isArray(r.wrapup)) out.wrapup = arr(r.wrapup);
  if (Array.isArray(r.warnings)) out.warnings = arr<string>(r.warnings).filter((w) => typeof w === 'string');
  if (isObj(r.stageModes)) out.stageModes = rec(r.stageModes) as ScheduleState['stageModes'];
  if (Array.isArray(r.upcoming)) out.upcoming = arr<string>(r.upcoming).filter((w) => typeof w === 'string');
  if (typeof r.waiting === 'string' || r.waiting === null) out.waiting = r.waiting as string | null;
  if (r.timeUp === null) out.timeUp = null;
  else if (isObj(r.timeUp) && typeof r.timeUp.at === 'number') out.timeUp = { at: r.timeUp.at };
  if (typeof r.baseRecorded === 'boolean') out.baseRecorded = r.baseRecorded;
  if (typeof r.roundSecAuto === 'boolean') out.roundSecAuto = r.roundSecAuto;
  return out;
}

function emptyWorksheet(mode: ClassSettings['worksheetMode']): WorksheetState {
  return { current: null, mode: mode === 'auto' ? 'each' : mode, openedAt: null, pending: [] };
}

export function emptyMetrics(): Metrics {
  return {
    exports: 0, imports: 0, resale: 0, domestic: 0, tariffs: 0, quizRight: 0,
    csr: scoringConstants.csrBase, coop: 0,
    visited: [STARTING_PORT], dex: [`port:${STARTING_PORT}`], baseAsset: null,
  };
}

export function newGame(startMoney: number): PlayerGame {
  return {
    money: startMoney,
    loan: 0,
    startMoney,
    ship: STARTING_SHIP,
    port: STARTING_PORT,
    dest: null,
    ready: false,
    resolvedRound: 0,
    cargo: [],
    contracts: [],
    visit: { arrival: 0, sold: {}, bought: {} },
    roundContracts: { round: 0, buy: {}, sell: {} },
    unlockedRecipes: [],
    missions: {},
    decisions: {},
    letters: { answered: [], slots: {}, assigned: {} },
    checkQuiz: {},
    effects: { fastCustomsStage: null, tailwind: 0, reputationDown: false, chipPenaltyUntilRound: null },
    metrics: emptyMetrics(),
    worksheetDone: [],
    responses: {},
    opportunityCards: [],
    cover: null,
    reflect: null,
    producedOnce: false,
    log: [],
    fareDue: 0,
    sailsThisRound: 0,
  };
}

export interface NewPlayerInput {
  seat: number;
  pid: string;
  deviceToken?: string;
  companyName: string;
  nameKey?: string;
  nameStatus?: NameStatus;
  now: number;
}

/** 새 회사(범위의 첫 구간 시작 조건 — 차시 한 판·단원 한 판 공통, 늦게 온 학생도 같은 조건) */
export function createPlayer(meta: SessionMeta, cs: ClassState, input: NewPlayerInput): Player {
  const start = stageStartByLesson[meta.scope[0] ?? 'L1'];
  const flag = defaultFlag(input.seat);
  const game = newGame(start.money);
  // (작업 115 수정 1회차) 처음 화물(2차시: 담맘 원유 2상자). 기록에는 '처음 화물'(ref startCargo, 0원)로 남겨 학습지 ⑥ [내 기록]이 수입한 곳을 안다
  for (const c of start.startCargo ?? []) {
    game.cargo.push({ good: c.good, qty: c.qty, unitCost: c.unitCost, origin: 'foreign', source: 'specialty', boughtAt: c.boughtAt });
    game.log.push({ round: 0, stage: start.lesson, kind: 'buy', good: c.good, qty: c.qty, port: c.boughtAt, amount: 0, ref: 'startCargo' });
  }
  // 늦게 와도 이미 끝난 라운드의 항해는 처리할 것이 없다
  game.resolvedRound = completedRound(cs);
  game.roundContracts.round = cs.round;
  return {
    seat: input.seat,
    pid: input.pid,
    deviceToken: input.deviceToken ?? '',
    joinedAt: input.now,
    online: true,
    rev: 1,
    company: {
      name: input.companyName,
      nameKey: input.nameKey ?? basicNameKey(input.companyName),
      nameStatus: input.nameStatus ?? (cs.settings.nameReview ? 'review' : 'ok'),
      color: flag.color,
      emblem: flag.emblem,
      avatar: flag.avatar,
      founded: false,
    },
    game,
  };
}

// ─── 읽을 때 기본값 채우기(옛 필드 무시) ───────────────────

export function normalizePlayer(raw: unknown): Player {
  const r = isObj(raw) ? raw : {};
  const seat = num(r.seat, 0);
  const flag = defaultFlag(seat);
  const c = isObj(r.company) ? r.company : {};
  const name = str(c.name, '');
  const statuses: NameStatus[] = ['ok', 'blocked', 'review', 'checkRealName'];
  const company: Company = {
    name,
    nameKey: str(c.nameKey, basicNameKey(name)),
    nameStatus: statuses.includes(c.nameStatus as NameStatus) ? (c.nameStatus as NameStatus) : 'ok',
    color: str(c.color, flag.color),
    emblem: str(c.emblem, flag.emblem),
    avatar: str(c.avatar, flag.avatar),
    founded: bool(c.founded, false),
  };
  const g = isObj(r.game) ? r.game : {};
  const base = newGame(num(g.startMoney, num(g.money, 500)));
  const m = isObj(g.metrics) ? g.metrics : {};
  const eff = isObj(g.effects) ? g.effects : {};
  const visit = isObj(g.visit) ? g.visit : {};
  const rc = isObj(g.roundContracts) ? g.roundContracts : {};
  const letters = isObj(g.letters) ? g.letters : {};
  const game: PlayerGame = {
    money: num(g.money, base.money),
    loan: num(g.loan, 0),
    startMoney: base.startMoney,
    ship: (['small', 'medium', 'large'] as const).includes(g.ship as 'small') ? (g.ship as PlayerGame['ship']) : base.ship,
    port: str(g.port, base.port) as PortId,
    dest: typeof g.dest === 'string' ? (g.dest as PortId) : null,
    ready: bool(g.ready, false),
    resolvedRound: num(g.resolvedRound, 0),
    cargo: arr(g.cargo),
    contracts: arr(g.contracts),
    visit: { arrival: num(visit.arrival, 0), sold: rec(visit.sold), bought: rec(visit.bought) },
    roundContracts: { round: num(rc.round, 0), buy: rec(rc.buy), sell: rec(rc.sell) },
    unlockedRecipes: arr(g.unlockedRecipes),
    missions: rec(g.missions),
    decisions: rec(g.decisions),
    letters: { answered: arr(letters.answered), slots: rec(letters.slots), assigned: rec(letters.assigned) },
    checkQuiz: rec(g.checkQuiz),
    effects: {
      fastCustomsStage: isLesson(eff.fastCustomsStage) ? eff.fastCustomsStage : null,
      tailwind: num(eff.tailwind, 0),
      reputationDown: bool(eff.reputationDown, false),
      chipPenaltyUntilRound: numOrNull(eff.chipPenaltyUntilRound),
    },
    metrics: {
      exports: num(m.exports, 0),
      imports: num(m.imports, 0),
      resale: num(m.resale, 0),
      domestic: num(m.domestic, 0),
      tariffs: num(m.tariffs, 0),
      quizRight: num(m.quizRight, 0),
      csr: num(m.csr, scoringConstants.csrBase),
      coop: num(m.coop, 0),
      visited: Array.isArray(m.visited) ? arr(m.visited) : [...base.metrics.visited],
      dex: Array.isArray(m.dex) ? arr(m.dex) : [...base.metrics.dex],
      baseAsset: numOrNull(m.baseAsset),
    },
    worksheetDone: arr(g.worksheetDone),
    ...(Array.isArray(g.duringDone) ? { duringDone: arr(g.duringDone) } : {}),
    responses: rec<Json>(g.responses),
    opportunityCards: arr(g.opportunityCards),
    cover: (g.cover ?? null) as Json,
    reflect: (g.reflect ?? null) as Json,
    producedOnce: bool(g.producedOnce, false),
    log: arr(g.log),
    // (작업 151) 옛 상태에는 없음 → 0
    fareDue: Math.max(0, num(g.fareDue, 0)),
    sailsThisRound: Math.max(0, num(g.sailsThisRound, 0)),
  };
  // 옛 필드(name: 실명·별명 등)는 옮기지 않는다
  return {
    seat,
    pid: str(r.pid, ''),
    deviceToken: str(r.deviceToken, ''),
    joinedAt: num(r.joinedAt, 0),
    online: bool(r.online, false),
    rev: num(r.rev, 0),
    company,
    game,
  };
}

export function normalizeClass(raw: unknown, meta?: Pick<SessionMeta, 'playUnit' | 'scope' | 'seed'>): ClassState {
  const r = isObj(raw) ? raw : {};
  const s = isObj(r.settings) ? r.settings : {};
  const scope = (Array.isArray(s.scope) ? (s.scope as unknown[]).filter(isLesson) : meta?.scope) ?? ['L1'];
  const playUnit = (['lesson', 'unit', 'custom'] as const).includes(s.playUnit as PlayUnit)
    ? (s.playUnit as PlayUnit)
    : meta?.playUnit ?? 'unit';
  const d = defaultSettings(playUnit, scope.length ? scope : ['L1'], num(s.tradeMinutes, tradeMinutes.default));
  // v0.3.1에서 없어진 이름 표시 설정은 옮기지 않는다(무시)
  const settings: ClassSettings = {
    playUnit,
    scope: [...d.scope],
    tradeMinutes: num(s.tradeMinutes, d.tradeMinutes),
    activityRatio: num(s.activityRatio, d.activityRatio),
    roundSec: num(s.roundSec, d.roundSec),
    incidentFreq: (['off', 'some', 'often'] as const).includes(s.incidentFreq as 'off') ? (s.incidentFreq as ClassSettings['incidentFreq']) : d.incidentFreq,
    incidentKindsOff: arr(s.incidentKindsOff),
    comeback: bool(s.comeback, d.comeback),
    worksheetMode: (['auto', 'each', 'stageEnd', 'after', 'off'] as const).includes(s.worksheetMode as 'auto') ? (s.worksheetMode as ClassSettings['worksheetMode']) : d.worksheetMode,
    leaderboardTopN: ([0, 3, 4, 5] as const).includes(s.leaderboardTopN as 3) ? (s.leaderboardTopN as ClassSettings['leaderboardTopN']) : d.leaderboardTopN,
    assetBoard: bool(s.assetBoard, d.assetBoard),
    awardsPerPrize: ([1, 2, 3] as const).includes(s.awardsPerPrize as 3) ? (s.awardsPerPrize as ClassSettings['awardsPerPrize']) : d.awardsPerPrize,
    nameReview: bool(s.nameReview, false),
    extraBannedWords: arr<string>(s.extraBannedWords).filter((w) => typeof w === 'string'),
    worksheetWaitSec: ([0, 15, 30] as const).includes(s.worksheetWaitSec as 15) ? (s.worksheetWaitSec as ClassSettings['worksheetWaitSec']) : d.worksheetWaitSec,
    showForecastOnScreen: bool(s.showForecastOnScreen, d.showForecastOnScreen),
    progressMode: s.progressMode === 'manual' ? 'manual' : 'auto',
    awardsOff: arr(s.awardsOff),
    // (작업 151) 옛 판에는 없음 → 라운드마다
    voyageMode: s.voyageMode === 'free' ? 'free' : 'round',
  };
  const stage = isLesson(r.stage) ? r.stage : settings.scope[0];
  const start = stageStartByLesson[settings.scope[0]];
  const phases = ['prep', 'event', 'round', 'between', 'worksheet', 'wrapup', 'ended'] as const;
  const clock = isObj(r.clock) ? r.clock : {};
  const sched = isObj(r.schedule) ? r.schedule : {};
  const ws = isObj(r.worksheet) ? r.worksheet : {};
  const lt = isObj(r.letters) ? r.letters : {};
  const inc = isObj(r.incidents) ? r.incidents : {};
  const ce = isObj(r.currentEvent) ? r.currentEvent : null;
  const letters: LettersState = {
    enabled: bool(lt.enabled, true),
    delivered: arr(lt.delivered),
    skipped: arr(lt.skipped),
    slots: Array.isArray(lt.slots) ? arr(lt.slots) : null,
  };
  return {
    stage,
    round: num(r.round, 0),
    phase: phases.includes(r.phase as 'prep') ? (r.phase as ClassState['phase']) : 'prep',
    clock: {
      durationSec: num(clock.durationSec, settings.tradeMinutes * 60),
      startedAt: numOrNull(clock.startedAt),
      endsAt: numOrNull(clock.endsAt),
      pausedAt: numOrNull(clock.pausedAt),
      pausedTotalSec: num(clock.pausedTotalSec, 0),
    },
    roundEndsAt: numOrNull(r.roundEndsAt),
    roundRemainingMs: numOrNull(r.roundRemainingMs),
    paused: bool(r.paused, false),
    seed: num(r.seed, meta?.seed ?? 0),
    schedule: { items: arr(sched.items), version: num(sched.version, 0), mode: sched.mode === 'manual' ? 'manual' : settings.progressMode, ...scheduleExtras(sched) },
    currentEvent: ce
      ? {
          id: str(ce.id, ''),
          openedAt: num(ce.openedAt, 0),
          closesAt: numOrNull(ce.closesAt),
          closed: bool(ce.closed, false),
          short: bool(ce.short, false),
          ...(ce.revealed === true ? { revealed: true } : {}),
          ...(typeof ce.resultUntil === 'number' && Number.isFinite(ce.resultUntil) ? { resultUntil: ce.resultUntil } : {}),
        }
      : null,
    worksheet: {
      current: Array.isArray(ws.current) ? arr(ws.current) : null,
      mode: (['each', 'stageEnd', 'after', 'off'] as const).includes(ws.mode as 'each') ? (ws.mode as WorksheetState['mode']) : emptyWorksheet(settings.worksheetMode).mode,
      openedAt: numOrNull(ws.openedAt),
      pending: arr(ws.pending),
      ...(phases.includes(ws.returnPhase as 'prep') ? { returnPhase: ws.returnPhase as WorksheetState['returnPhase'] } : {}),
      ...(ws.during === true ? { during: true } : {}),
      ...(ws.afterNews === true ? { afterNews: true } : {}),
    },
    letters,
    incidents: { active: arr(inc.active), forecasts: arr(inc.forecasts) },
    activeEffects: arr(r.activeEffects),
    settings,
    bannedNameKeys: arr<string>(r.bannedNameKeys).filter((k) => typeof k === 'string'),
    openPorts: Array.isArray(r.openPorts) ? arr(r.openPorts) : [...start.ports],
    features: Array.isArray(r.features) ? arr(r.features) : [...start.features],
    stageFirstRound: numOrNull(r.stageFirstRound),
    firedEvents: arr(r.firedEvents),
    shortEvents: arr(r.shortEvents),
    votes: rec(r.votes),
    tradeEnded: bool(r.tradeEnded, false),
  };
}

/** 저장·전송된 스냅숏 읽기. `v: 3`이 아니면 null */
export function normalizeSnapshot(raw: unknown): HostSnapshot | null {
  if (!isObj(raw) || raw.v !== 3) return null;
  const m = isObj(raw.meta) ? raw.meta : {};
  const scope = Array.isArray(m.scope) ? (m.scope as unknown[]).filter(isLesson) : [];
  const meta: SessionMeta = {
    v: 3,
    code: str(m.code, ''),
    className: str(m.className, ''),
    createdAt: num(m.createdAt, 0),
    playUnit: (['lesson', 'unit', 'custom'] as const).includes(m.playUnit as PlayUnit) ? (m.playUnit as PlayUnit) : 'unit',
    scope: scope.length ? scope : ['L1'],
    seed: num(m.seed, 0),
    locked: bool(m.locked, false),
  };
  const players: Record<string, Player> = {};
  for (const p of Object.values(isObj(raw.players) ? raw.players : {})) {
    const np = normalizePlayer(p);
    if (np.seat > 0) players[seatKey(np.seat)] = np;
  }
  return {
    v: 3,
    meta,
    class: normalizeClass(raw.class, meta),
    players,
    hostToken: str(raw.hostToken, ''),
    savedAt: num(raw.savedAt, 0),
    rev: num(raw.rev, 0),
  };
}
