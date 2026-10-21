/**
 * 자동 배치(스케줄러) — PRD 4.1.1, 4.3, 4.5, 6.7.2 (작업 123). 순수·결정적 함수.
 *
 * `buildSchedule(input)`: 판 단위·학습 범위·무역 시간 T·활동 비중 α 로 배치표를 만든다.
 *   1. 구간 길이 T_s = T ÷ n(3.5분 미만이면 `SCOPE_TOO_LONG`).
 *   2. 구간마다 활동 예산 A_s = T_s × α 안에 들도록 PRD 4.3.4 줄이는 순서 1~8단계를 차례로 적용하고,
 *      예산이 남으면 나중에 줄인 것부터 되살린다(넘치면 건너뜀). 학습지 시간도 이 예산에서 쓴다.
 *   3. 남은 시간 = 거래 시간 → 라운드 수 = max(최소, 반올림(거래 ÷ R)), 라운드 길이 ≥ 90초, 남는 초는 라운드에 고르게.
 *   4. 구간 안 순서: [표지(+앞 차시 요약)] → 차단형 활동과 라운드를 번갈아 → 마지막 라운드 → 구간 끝 활동 → 구간 끝 학습지.
 *      비차단 활동은 지정 라운드 시작에 붙는다.
 *   5. 편지: T ÷ 4 내림, 2~10통, (라운드 수 − 1) 이하, 첫 라운드 제외, 라운드당 1통, 1등급 차단형 활동 바로 뒤 라운드면 다음 라운드로,
 *      구간 은행이 한 학생에게 중복 없이 낼 수 있는 수로 한 번 더 제한(v0.3.1).
 *   6. 마무리 목록은 `wrapupByUnit`(판 단위·L4 포함 여부)에서 고른다.
 * `reschedule(schedule, classState, now, change)`: 연장·단축·라운드 길이·항목 형태·미루기·건너뛰기 때
 *   **아직 시작하지 않은 항목만** 같은 과정으로 다시 배치한다(연장이면 되살리기가 일어남). `version` + 1.
 * `previewSchedule(input)`: 판 설정 화면(109)용 요약.
 *
 * 돌발 사건·역전 장치 항목은 `extraPlacers`(작업 125·127이 등록)가 넣는다. 여기서는 개수 공식만 계산한다.
 */
import { COVER_EVENT_IDS, events as allEvents, eventsById } from '../data/events';
import { lessonsById } from '../data/lessons';
import { letterBank } from '../data/letters';
import { slotAt } from '../data/letterSchedule';
import {
  activityRatio as ratioRule,
  incidentCountRule,
  letterCountRule,
  MIN_STAGE_MESSAGE,
  MIN_STAGE_MINUTES,
  minRoundsByStage,
  playUnits,
  roundLength,
  STAGE_COVER_SEC,
  stageStartByLesson,
  tradeMinutes as tradeMinutesRule,
  WORKSHEET_BUNDLE_SEC,
  wrapupByUnit,
  coreExperienceIds,
  duringSourceEvent,
  fillOrder,
  type FillStepId,
} from '../data/schedule';
import { duringWorksheetIds, worksheetById, worksheetFor } from '../data/worksheet';
import type { Difficulty, GameEvent as EventDef, LessonId, WorksheetId, WrapStep } from '../data/types';
import { LESSON_IDS } from '../data/types';
import { elapsedSec } from './clock';
import type {
  ClassState,
  IncidentFreq,
  ItemForm,
  PlayUnit,
  ScheduleItem,
  ScheduleState,
  WorksheetPlacement,
  WrapItem,
} from './types';

// ─── 상수 ─────────────────────────────────────────────────

/** 준비 단계 예상 시간(분, PRD 4.2.1 "준비 5분") */
export const PREP_MINUTES = 5;
/** 앞 차시 요약 카드 표시 시간(초) — 표지와 같은 20초로 둔다(가정) */
export const SUMMARY_CARD_SEC = STAGE_COVER_SEC;
/** 줄여도 넘칠 때 교사 화면 경고 */
export const RAISE_WARNING = '이번 판은 활동이 많아 거래 시간이 짧아요';
/** 결과가 같이 움직이는 활동(학급 스마트폰 프로젝트: 시작 L3-E2 는 결과 L3-E5 를 따른다) */
export const LINKED_EVENTS: Readonly<Record<string, string>> = { 'L3-E2': 'L3-E5' };

const LESSON_ORDER: Readonly<Record<LessonId, number>> = { L1: 0, L2: 1, L3: 2, L4: 3 };

// ─── 타입 ─────────────────────────────────────────────────

export type ScheduleErrorCode = 'SCOPE_TOO_LONG' | 'BAD_SCOPE' | 'BAD_MINUTES';

export class ScheduleError extends Error {
  constructor(public readonly code: ScheduleErrorCode, message: string) {
    super(message);
    this.name = 'ScheduleError';
  }
}

export type BankSize = (stage: LessonId, difficulty: Difficulty) => number;

export interface ScheduleInput {
  playUnit: PlayUnit;
  /** 학습 범위(연속 구간). unit 이면 무시하고 L1~L4 */
  scope: readonly LessonId[];
  /** 무역 시간 T(분). 없으면 판 단위 기본값 */
  tradeMinutes?: number;
  /** 활동 비중 α(0.5/0.6/0.7, 기본 0.6) */
  activityRatio?: number;
  /** 교사가 정한 라운드 길이(초). 없으면 자동(T_s ≥ 10분 → 180, 그 밖 120) */
  roundSecOverride?: number | null;
  worksheetMode?: 'auto' | WorksheetPlacement;
  /** 교사 [넣기/짧게/빼기](사건 ID → 형태). 1등급의 'dropped'는 무시 */
  overrides?: Readonly<Record<string, ItemForm>>;
  /** 편지 배달 켜기(기본 켬) */
  letters?: boolean;
  seed?: number;
  /** (P1) 돌발 사건 빈도 — 개수만 계산, 배치는 extraPlacers */
  incidentFreq?: IncidentFreq;
  /** (P1) 역전 장치 */
  comeback?: boolean;
  /** 테스트용: 구간 은행 크기(기본 = letterBank 길이) */
  letterBankSize?: BankSize;
  /** 확장 배치기(기본 = 모듈의 `extraPlacers`) */
  extraPlacers?: readonly ExtraPlacer[];
  /** 채우는 순서(기본 = 데이터 `fillOrder`) */
  fillOrder?: readonly FillStepId[];
}

export interface NormalizedInput {
  playUnit: PlayUnit;
  scope: LessonId[];
  tradeMinutes: number;
  activityRatio: number;
  roundSecOverride: number | null;
  worksheetMode: 'auto' | WorksheetPlacement;
  overrides: Record<string, ItemForm>;
  letters: boolean;
  seed: number;
  incidentFreq: IncidentFreq;
  comeback: boolean;
  fillOrder: readonly FillStepId[];
}

/** 라운드 하나(배치 결과) */
export interface RoundInfo {
  round: number;
  stage: LessonId;
  at: number;
  durSec: number;
  /** 바로 앞(라운드 사이)에 1등급 차단형 활동이 있다 — 편지를 다음 라운드로 미룸 */
  afterTier1Blocking: boolean;
}

/** 구간 요약 */
export interface StageSummary {
  stage: LessonId;
  startSec: number;
  /** 이 계획이 쓴 구간 길이(초). 새 판이면 T_s */
  lengthSec: number;
  /** 최종 α(넘쳐서 올렸으면 올린 값) */
  alpha: number;
  alphaRaised: boolean;
  budgetSec: number;
  /** 고정 시간(표지 20초 + 앞 차시 요약 카드 20초) — 예산 밖 */
  fixedSec: number;
  /** 활동(차단형 활동·학습지·지금 쓰기 D_s) 사용 초 — PRD 4.3.6 '활동 사용' */
  usedSec: number;
  tradeSec: number;
  rounds: number;
  roundSecs: number[];
  worksheetMode: WorksheetPlacement;
  /** 최소 상태가 예산을 넘어 사다리를 쓰지 않았다(경고) */
  overflow: boolean;
  /** 채우는 순서에서 넣은 단계(넣은 항목마다 하나, 순서대로) */
  filled: FillStepId[];
  /** 건너뛴 후보 */
  skipped: { step: FillStepId; id: string; why: 'budget' | 'roundGuard' }[];
  /** (v0.3.4) 지금 쓰기 시간 D_s(초) — usedSec 에 포함 */
  duringSec: number;
  /** (v0.3.4) 넣은 지금 쓰기 번호 */
  during: WorksheetId[];
}

export interface ActivityStatus {
  id: string;
  stage: LessonId;
  title: string;
  tier: 1 | 2 | 3;
  priority: number | null;
  form: ItemForm;
  blocking: boolean;
  /** 이 형태의 예상 분 */
  minutes: number;
  pinned: boolean;
  /** 빠진 까닭: 예산 / 라운드 수 부족 / 교사 */
  reason: 'budget' | 'needsRounds' | 'teacher' | null;
}

export type WorksheetWhere = 'each' | 'stageEnd' | 'after' | 'wrap' | 'off';

export interface Schedule {
  input: NormalizedInput;
  items: ScheduleItem[];
  stages: StageSummary[];
  activities: ActivityStatus[];
  included: string[];
  shortened: string[];
  dropped: string[];
  worksheetModes: Partial<Record<LessonId, WorksheetPlacement>>;
  /** 범위 안 학습지 번호가 어디에서 쓰이는지 */
  worksheetWhere: Partial<Record<WorksheetId, WorksheetWhere>>;
  totalRounds: number;
  letterCount: number;
  /** 4.3.5 공식으로 계산한 편지 수(은행 제한 전) */
  letterFormula: number;
  incidentCount: number;
  wrapup: WrapItem[];
  /** '끝나고 쓰기'로 간 무역 학습지(⑯⑰⑱ 제외)와 그 시간 — 예상 수업 시간에는 넣지 않음(PRD 4.3.3) */
  afterWorksheets: { ids: WorksheetId[]; minutes: number };
  /** (v0.3.4) 지금 쓰기: 넣은 번호 / 시간이 짧아 넣지 못한 번호(원래 방식으로 씀) */
  duringWorksheets: { placed: WorksheetId[]; deferred: WorksheetId[] };
  expected: { prepMin: number; tradeMin: number; wrapMin: number; totalMin: number; text: string };
  warnings: string[];
}

export interface PlacerContext {
  input: NormalizedInput;
  /** 새로 배치한 라운드(다시 배치면 아직 시작하지 않은 라운드만) */
  rounds: readonly RoundInfo[];
  items: readonly ScheduleItem[];
  incidentCount: number;
  totalRounds: number;
}

/** 돌발 사건·예보·역전 장치 배치기(작업 125·127이 등록). 넣을 항목을 돌려준다 */
export type ExtraPlacer = (ctx: PlacerContext) => ScheduleItem[];

/** 확장 지점(기본 비어 있음) */
export const extraPlacers: ExtraPlacer[] = [];

// ─── 작은 도구 ────────────────────────────────────────────

const sec = (min: number): number => Math.round(min * 60);
const round1 = (x: number): number => Math.round(x * 10) / 10;
const isTier = (t: EventDef['tier']): t is 1 | 2 | 3 => t === 1 || t === 2 || t === 3;

function defaultBankSize(stage: LessonId, d: Difficulty): number {
  return letterBank(stage, d).length;
}

/** 지금 형태가 차단형인가 */
export function blockingIn(def: EventDef, form: ItemForm): boolean {
  if (form === 'dropped') return false;
  if (form === 'short' && def.shortForm) return def.shortForm.blocking;
  return def.blocking;
}

/** 형태별 활동 예산 사용 초(비차단은 0) */
export function costIn(def: EventDef, form: ItemForm): number {
  if (!blockingIn(def, form)) return 0;
  if (form === 'short' && def.minutes.short !== null) return sec(def.minutes.short);
  return sec(def.minutes.full);
}

function canShorten(def: EventDef): boolean {
  return def.shortForm !== null && def.minutes.short !== null;
}

/** 자동 라운드 길이(초) */
export function autoRoundSec(stageSec: number): number {
  return stageSec >= roundLength.longStageMinMinutes * 60 ? roundLength.longSec : roundLength.shortSec;
}

/** 그 구간의 배치 대상 활동(1~3등급, 표지 제외, 데이터 순서) */
export function stageActivities(stage: LessonId): EventDef[] {
  return allEvents.filter((e) => e.lesson === stage && isTier(e.tier) && !e.isCover);
}

/** 무역 시간 안에 쓰는 학습지 번호(⑯⑰⑱ 제외) */
export function tradeWorksheets(stage: LessonId): WorksheetId[] {
  return worksheetFor(stage).filter((w) => w.phase === 'trade').map((w) => w.id);
}

function wsSecEach(ids: readonly WorksheetId[]): number {
  return ids.reduce((s, id) => s + sec(worksheetById[id].minutes), 0);
}

function wsCost(mode: WorksheetPlacement, ids: readonly WorksheetId[]): number {
  if (!ids.length) return 0;
  if (mode === 'each') return wsSecEach(ids);
  if (mode === 'stageEnd') return WORKSHEET_BUNDLE_SEC;
  return 0;
}

// ─── 입력 정리 ────────────────────────────────────────────

function isContiguous(scope: readonly LessonId[]): boolean {
  for (let i = 1; i < scope.length; i++) if (LESSON_ORDER[scope[i]] !== LESSON_ORDER[scope[i - 1]] + 1) return false;
  return true;
}

export function normalizeInput(input: ScheduleInput): NormalizedInput {
  const playUnit = input.playUnit;
  let scope: LessonId[];
  if (playUnit === 'unit') scope = [...playUnits.unit.scope];
  else scope = [...input.scope];
  if (!scope.length || scope.some((s) => !(LESSON_IDS as readonly string[]).includes(s))) {
    throw new ScheduleError('BAD_SCOPE', '학습 범위를 골라 주세요');
  }
  if (playUnit === 'lesson' && scope.length !== 1) throw new ScheduleError('BAD_SCOPE', '차시 한 판은 차시 하나만 고를 수 있어요');
  if (!isContiguous(scope)) throw new ScheduleError('BAD_SCOPE', '이어지는 구간만 고를 수 있어요');
  const defMin = playUnit === 'custom' ? tradeMinutesRule.default : playUnits[playUnit].defaultMinutes;
  const tradeMinutes = input.tradeMinutes ?? defMin;
  if (!Number.isFinite(tradeMinutes) || tradeMinutes < tradeMinutesRule.customMin || tradeMinutes > tradeMinutesRule.customMax) {
    throw new ScheduleError('BAD_MINUTES', `무역 시간은 ${tradeMinutesRule.customMin}~${tradeMinutesRule.customMax}분이에요`);
  }
  if ((tradeMinutes / scope.length) < MIN_STAGE_MINUTES) throw new ScheduleError('SCOPE_TOO_LONG', MIN_STAGE_MESSAGE);
  return looseInput(input, scope, tradeMinutes);
}

/** 검사 없이 정리(다시 배치용 — 단축으로 구간이 3.5분보다 짧아져도 오류를 내지 않는다) */
function looseInput(input: ScheduleInput, scope: LessonId[], tradeMinutes: number): NormalizedInput {
  const playUnit = input.playUnit;
  const a = input.activityRatio ?? ratioRule.default;
  const activityRatio = Number.isFinite(a) ? Math.min(ratioRule.autoRaiseMax, Math.max(0.3, a)) : ratioRule.default;
  const overrides: Record<string, ItemForm> = {};
  for (const [id, form] of Object.entries(input.overrides ?? {})) {
    const lead = LINKED_EVENTS[id] ?? id;
    const def = eventsById[lead];
    if (!def || !isTier(def.tier) || def.isCover) continue;
    if (def.tier === 1 && form === 'dropped') continue; // 1등급은 빼지 않는다
    if (form === 'short' && !canShorten(def)) continue;
    overrides[lead] = form;
  }
  const r = input.roundSecOverride;
  return {
    playUnit,
    scope,
    tradeMinutes,
    activityRatio,
    roundSecOverride: typeof r === 'number' && Number.isFinite(r) && r > 0 ? Math.round(r) : null,
    worksheetMode: input.worksheetMode ?? 'auto',
    overrides,
    letters: input.letters ?? true,
    seed: input.seed ?? 0,
    incidentFreq: input.incidentFreq ?? incidentCountRule.default,
    comeback: input.comeback ?? true,
    fillOrder: input.fillOrder ?? fillOrder,
  };
}

// ─── 한 구간 계획 ─────────────────────────────────────────

interface Cand {
  id: string;
  def: EventDef;
  tier: 1 | 2 | 3;
  priority: number;
  form: ItemForm;
  /** 교사가 고정한 형태 */
  pin: ItemForm | null;
  reason: ActivityStatus['reason'];
}

interface StageParams {
  stage: LessonId;
  startSec: number;
  lengthSec: number;
  /** 라운드 길이 자동 규칙에 쓰는 구간 길이(초) */
  nominalSec: number;
  alpha: number;
  roundSec: number | null;
  wsPolicy: 'auto' | WorksheetPlacement;
  /** 아직 시작하지 않은 활동(사건 ID → 고정 형태 또는 null) */
  pending: { id: string; pin: ItemForm | null }[];
  pendingWs: WorksheetId[];
  needCover: boolean;
  coverVariant: 'stage' | 'lesson';
  topCompanies: boolean;
  summaryIds: readonly string[] | null;
  playedRounds: number;
  firstRound: number;
  /** 새 판(라운드 최소 1개, L1 권장 2개) */
  fresh: boolean;
  /** 채우는 순서 */
  order: readonly FillStepId[];
  /** (다시 배치) 이미 띄웠거나 건너뛴 지금 쓰기 번호 — 다시 넣지 않는다 */
  doneDuring?: readonly WorksheetId[];
  /** (다시 배치) 원천 체험은 이미 시작했는데 지금 쓰기는 아직 — 구간 맨 앞에 그대로 둔다 */
  carryDuring?: readonly WorksheetId[];
  /** 차시 한 판(PRD 4.3.3 v0.3.8 규칙 2): ★ 지금 쓰기를 쓰지 않는다 */
  noDuring?: boolean;
}

interface StagePlan {
  items: ScheduleItem[];
  rounds: RoundInfo[];
  endSec: number;
  summary: StageSummary;
  cands: Cand[];
  /** 끝나고 쓰기로 간 번호 */
  afterWs: WorksheetId[];
  where: Partial<Record<WorksheetId, WorksheetWhere>>;
  warnings: string[];
  /** 넣은 지금 쓰기 / 넣지 못한 지금 쓰기 번호 */
  during: WorksheetId[];
  deferred: WorksheetId[];
}

interface FillOut {
  wsMode: WorksheetPlacement;
  alpha: number;
  raised: boolean;
  /** 최소 상태가 이미 예산을 넘음(사다리 없음, 경고) */
  overflow: boolean;
  budgetSec: number;
  /** 사다리에서 넣은 단계(넣은 항목마다 하나, 순서대로) */
  filled: FillStepId[];
  /** 건너뛴 후보(예산 초과 / 라운드 보호) */
  skipped: { step: FillStepId; id: string; why: 'budget' | 'roundGuard' }[];
  /** 넣은 '지금 쓰기' 번호(번호 순, 학습지가 '중간마다'가 되면 비움) */
  during: WorksheetId[];
  /** 넣을 조건(원천 체험 들어감·방식 끝나고/구간 끝)인데 시간이 모자라 넣지 못한 번호 */
  deferred: WorksheetId[];
  /** 지금 쓰기 시간 D_s(초, 옮겨 온 것 포함) */
  duringSec: number;
}

/** 활동 예산 B = min(T_s × α, T_s − 고정 시간 − 지금 쓰기 시간 − 90초) (PRD 4.3.1 v0.3.3, v0.3.4 D_s) */
export function activityBudget(lengthSec: number, fixedSec: number, alpha: number, duringSec = 0): number {
  return Math.max(0, Math.min(lengthSec * alpha, lengthSec - fixedSec - duringSec - roundLength.minSec));
}

/** 지금 쓰기 팝업 시간(초) — 데이터 `during.sec` 한 곳에서 읽는다 */
export function duringSecOf(id: WorksheetId): number {
  return worksheetById[id]?.during?.sec ?? 0;
}

interface FillOpts {
  wsPolicy: 'auto' | WorksheetPlacement;
  pendingWs: readonly WorksheetId[];
  lengthSec: number;
  alpha: number;
  order: readonly FillStepId[];
  /** 지금 쓰기 시간 D(초) → 활동 예산 */
  budgetAt: (duringSec: number) => number;
  /** 활동 사용 초(지금 쓰기 포함) → 그 구간 라운드 수(라운드 보호용) */
  roundsAt: (activitySec: number) => number;
  /** 지금 쓰기 후보(번호 순): 번호 + 원천 체험(그 구간 후보) */
  duringCands?: readonly { id: WorksheetId; source: Cand }[];
  /** 이미 확정된 지금 쓰기 초(다시 배치 때 원천 체험이 이미 시작해 옮겨 온 것) */
  fixedDuringSec?: number;
}

const dataIdx = (c: Cand) => allEvents.indexOf(c.def);

/**
 * PRD 4.3.4(v0.3.3, v0.3.4) 채우는 순서. cands 의 form 을 바꾼다.
 * 최소 상태(1등급 짧게, 시간 쓰는 2등급·3등급 빠짐, 학습지 자동이면 끝나고)에서 시작해 `order`(기본 `fillOrder`)대로
 * 한 항목씩 바꿔 보고, 예산을 넘거나 (tier2Short·wsDuring 밖에서) 라운드가 2개 이상 → 1개가 되면 그 항목만 되돌리고 넘어간다.
 * '지금 쓰기'(wsDuring)는 α 몫을 쓰지 않고 예산의 바닥 항(T_s − F − D_s − 90)만 줄인다. 학습지가 '중간마다'면 D_s = 0.
 * 최소 상태가 이미 예산을 넘으면 사다리 없이 α를 0.1씩 0.8까지 올린다(경고, 지금 쓰기도 넣지 않음).
 */
export function fillForms(cands: Cand[], o: FillOpts): FillOut {
  for (const c of cands) {
    if (c.pin !== null) c.form = c.pin;
    else if (c.tier === 1) c.form = canShorten(c.def) ? 'short' : 'full';
    else if (c.tier === 2) c.form = costIn(c.def, 'full') > 0 ? 'dropped' : 'full';
    else c.form = 'dropped';
  }
  let wsMode: WorksheetPlacement = o.wsPolicy === 'auto' ? 'after' : o.wsPolicy;
  const during: WorksheetId[] = [];
  const fixedD = o.fixedDuringSec ?? 0;
  const dSec = () => fixedD + (wsMode === 'each' ? 0 : during.reduce((s, id) => s + duringSecOf(id), 0));
  const cost = () => cands.reduce((s, c) => s + costIn(c.def, c.form), 0) + wsCost(wsMode, o.pendingWs);
  const filled: FillStepId[] = [];
  const skipped: FillOut['skipped'] = [];
  const duringOk = (src: Cand) => src.form !== 'dropped' && wsMode !== 'each' && wsMode !== 'off';
  const finish = (extra: Pick<FillOut, 'alpha' | 'raised' | 'overflow'>): FillOut => {
    const placed = wsMode === 'each' || wsMode === 'off' ? [] : [...during];
    const deferred = (o.duringCands ?? []).filter((d) => !placed.includes(d.id) && duringOk(d.source)).map((d) => d.id);
    return { wsMode, ...extra, budgetSec: o.budgetAt(dSec()), filled, skipped, during: placed, deferred, duringSec: dSec() };
  };
  if (cost() > o.budgetAt(dSec()) + 1e-6) {
    let a = o.alpha;
    while (cost() > o.lengthSec * a + 1e-6 && a < ratioRule.autoRaiseMax - 1e-9) a = round1(Math.min(ratioRule.autoRaiseMax, a + ratioRule.autoRaiseStep));
    return finish({ alpha: a, raised: a > o.alpha + 1e-9, overflow: true });
  }
  const free = cands.filter((c) => c.pin === null);
  const core = new Set(coreExperienceIds.map((id) => LINKED_EVENTS[id] ?? id));
  const prioAsc = (a: Cand, b: Cand) => a.priority - b.priority || dataIdx(a) - dataIdx(b);
  interface Trial { id: string; apply: () => void; revert: () => void }
  const formTrial = (c: Cand, to: ItemForm): Trial => {
    const from = c.form;
    return { id: c.id, apply: () => (c.form = to), revert: () => (c.form = from) };
  };
  const wsTrial = (to: WorksheetPlacement): Trial => {
    const from = wsMode;
    return { id: `ws:${to}`, apply: () => (wsMode = to), revert: () => (wsMode = from) };
  };
  const duringTrial = (id: WorksheetId): Trial => ({
    id,
    apply: () => void during.push(id),
    revert: () => void during.splice(during.indexOf(id), 1),
  });
  const growth = (c: Cand) => costIn(c.def, 'full') - costIn(c.def, 'short');
  const trialsFor = (step: FillStepId): Trial[] => {
    switch (step) {
      case 'tier2Short':
        return free.filter((c) => c.tier === 2 && c.form === 'dropped').sort(prioAsc).map((c) => formTrial(c, canShorten(c.def) ? 'short' : 'full'));
      case 'wsDuring':
        return (o.duringCands ?? []).filter((d) => !during.includes(d.id) && duringOk(d.source)).map((d) => duringTrial(d.id));
      case 'tier1Full':
        return free
          .filter((c) => c.tier === 1 && c.form === 'short')
          .sort((a, b) => growth(a) - growth(b) || dataIdx(a) - dataIdx(b))
          .map((c) => formTrial(c, 'full'));
      case 'coreFull':
        // v0.3.4: 우선 숫자가 작은 것부터(같으면 데이터 순서) — L1 은 두 섬(1) → 벽란도(2)
        return free.filter((c) => core.has(c.id) && c.form === 'short').sort(prioAsc).map((c) => formTrial(c, 'full'));
      case 'wsStageEnd':
        return o.wsPolicy === 'auto' && wsMode === 'after' && o.pendingWs.length ? [wsTrial('stageEnd')] : [];
      case 'tier2Full':
        return free.filter((c) => c.tier === 2 && !core.has(c.id) && c.form === 'short').sort(prioAsc).map((c) => formTrial(c, 'full'));
      case 'wsEach':
        return o.wsPolicy === 'auto' && wsMode === 'stageEnd' && o.pendingWs.length ? [wsTrial('each')] : [];
      case 'tier3Full':
        return free.filter((c) => c.tier === 3 && c.form === 'dropped').sort((a, b) => dataIdx(a) - dataIdx(b)).map((c) => formTrial(c, 'full'));
      default:
        return [];
    }
  };
  // 라운드 보호(③~⑧)를 적용하지 않는 단계: ① 체험 짧게 넣기, ② 지금 쓰기(교사 결정 — PRD 4.3.4)
  const noGuard: readonly FillStepId[] = ['tier2Short', 'wsDuring'];
  for (const step of o.order) {
    for (const t of trialsFor(step)) {
      const before = o.roundsAt(cost() + dSec());
      t.apply();
      const after = cost();
      if (after > o.budgetAt(dSec()) + 1e-6) {
        t.revert();
        skipped.push({ step, id: t.id, why: 'budget' });
      } else if (!noGuard.includes(step) && before >= 2 && o.roundsAt(after + dSec()) === 1) {
        t.revert();
        skipped.push({ step, id: t.id, why: 'roundGuard' });
      } else filled.push(step);
    }
  }
  return finish({ alpha: o.alpha, raised: false, overflow: false });
}

/**
 * 구간 하나를 활동 예산 B(초)만 주고 채워 본다(검사·설명용). 표지는 예산 밖, 라운드 보호·α 올리기·지금 쓰기 없음.
 */
export function reduceStageForBudget(
  stage: LessonId,
  budgetSec: number,
  wsPolicy: 'auto' | WorksheetPlacement = 'auto',
  order: readonly FillStepId[] = fillOrder,
): { forms: Record<string, ItemForm>; wsMode: WorksheetPlacement; filled: FillStepId[]; usedSec: number; fits: boolean } {
  const cands = makeCands({
    stage, startSec: 0, lengthSec: budgetSec, nominalSec: budgetSec, alpha: 1, roundSec: null, wsPolicy, order,
    pending: stageActivities(stage).map((e) => ({ id: e.id, pin: null })), pendingWs: tradeWorksheets(stage),
    needCover: true, coverVariant: 'stage', topCompanies: false, summaryIds: null, playedRounds: 0, firstRound: 1, fresh: true,
  });
  const ws = tradeWorksheets(stage);
  const r = fillForms(cands, { wsPolicy, pendingWs: ws, lengthSec: budgetSec, budgetAt: () => budgetSec, alpha: 1, order, roundsAt: () => 2 });
  const usedSec = cands.reduce((a, c) => a + costIn(c.def, c.form), 0) + wsCost(r.wsMode, ws);
  return { forms: Object.fromEntries(cands.map((c) => [c.id, c.form])), wsMode: r.wsMode, filled: r.filled, usedSec, fits: usedSec <= budgetSec };
}

function roundsFor(tradeSec: number, R: number, p: StageParams): number {
  if (tradeSec <= 0) return p.fresh ? 1 : 0;
  if (!p.fresh && tradeSec < 30) return 0;
  let k = Math.max(minRoundsByStage[p.stage].min, 1, Math.round(tradeSec / R));
  const rec = minRoundsByStage[p.stage].recommended;
  if (p.playedRounds + k < rec && tradeSec / (rec - p.playedRounds) >= roundLength.minSec) k = rec - p.playedRounds;
  while (k > 1 && tradeSec / k < roundLength.minSec) k--;
  return k;
}

function splitEven(total: number, k: number): number[] {
  if (k <= 0) return [];
  const base = Math.floor(total / k);
  const extra = total - base * k;
  return Array.from({ length: k }, (_, i) => base + (i < extra ? 1 : 0));
}

function distribute(n: number, slots: number): number[] {
  const s = Math.max(1, slots);
  return Array.from({ length: s }, (_, i) => Math.floor(n / s) + (i < n % s ? 1 : 0));
}

function makeCands(p: StageParams): Cand[] {
  return p.pending
    .map(({ id, pin }) => ({ def: eventsById[id], id, pin }))
    .filter((x) => x.def && isTier(x.def.tier) && !x.def.isCover && !LINKED_EVENTS[x.id])
    .sort((a, b) => allEvents.indexOf(a.def) - allEvents.indexOf(b.def))
    .map(({ def, id, pin }) => ({
      id,
      def,
      tier: def.tier as 1 | 2 | 3,
      priority: def.priority ?? 0,
      form: 'full' as ItemForm,
      pin: def.tier === 1 && pin === 'dropped' ? null : pin,
      reason: null,
    }));
}

function planStage(p: StageParams): StagePlan {
  const warnings: string[] = [];
  const fixedSec = (p.needCover ? STAGE_COVER_SEC : 0) + (p.summaryIds ? SUMMARY_CARD_SEC : 0);
  const R = p.roundSec ?? autoRoundSec(p.nominalSec);
  const cands = makeCands(p);
  const followers = p.pending.filter((x) => LINKED_EVENTS[x.id]).map((x) => x.id);
  const forced = new Set<string>();
  const budgetAt = (duringSec: number) => activityBudget(p.lengthSec, fixedSec, p.alpha, duringSec);
  // 활동 사용 초(지금 쓰기 D_s 포함 — PRD 4.3.6 '활동 사용') → 거래 시간
  const tradeOf = (activitySec: number) => p.lengthSec - fixedSec - activitySec;
  // 지금 쓰기(PRD 4.3.3.1 규칙 2): 그 구간 번호 중 during 필드가 있고, 학습지 방식이 '끄기'·'중간마다'(교사 고정)가 아니고,
  // 원천 체험이 이 구간 후보에 있는 것. 이미 띄운 번호·옮겨 온 번호는 후보가 아니다
  const carry = p.noDuring ? [] : (p.carryDuring ?? []).filter((w) => p.pendingWs.includes(w));
  const duringCands = p.noDuring || p.wsPolicy === 'off' || p.wsPolicy === 'each'
    ? []
    : duringWorksheetIds
      .filter((w) => p.pendingWs.includes(w) && !(p.doneDuring ?? []).includes(w) && !carry.includes(w))
      .map((w) => ({ id: w, source: cands.find((c) => c.id === duringSourceEvent[w]) }))
      .filter((d): d is { id: WorksheetId; source: Cand } => !!d.source);
  const carrySec = carry.reduce((a, w) => a + duringSecOf(w), 0);
  let fill: FillOut = {
    wsMode: 'after', alpha: p.alpha, raised: false, overflow: false, budgetSec: budgetAt(carrySec), filled: [], skipped: [], during: [], deferred: [], duringSec: carrySec,
  };
  let k = 0;
  let tradeSec = 0;
  let used = 0;
  const run = () => {
    const pinnedBackup = cands.map((c) => c.pin);
    for (const c of cands) if (forced.has(c.id)) c.pin = 'dropped';
    fill = fillForms(cands, {
      wsPolicy: p.wsPolicy, pendingWs: p.pendingWs, lengthSec: p.lengthSec, budgetAt, alpha: p.alpha, order: p.order,
      roundsAt: (a) => roundsFor(Math.max(0, tradeOf(a)), R, p),
      duringCands, fixedDuringSec: carrySec,
    });
    cands.forEach((c, i) => (c.pin = pinnedBackup[i]));
    used = cands.reduce((s, c) => s + costIn(c.def, c.form), 0) + wsCost(fill.wsMode, p.pendingWs) + fill.duringSec;
    tradeSec = Math.max(0, tradeOf(used));
    k = fill.overflow ? (p.fresh || tradeSec >= 30 ? 1 : 0) : roundsFor(tradeSec, R, p);
  };
  run();
  // 라운드가 모자라는 2등급: 빼고(사유 '라운드 부족') 그 구간 채우기를 처음부터 다시(최대 2번, 시간 0이면 다시 하지 않음)
  for (let redo = 0; ; redo++) {
    const viol = cands.filter((c) => c.form !== 'dropped' && c.tier !== 1 && c.def.needsRounds > p.playedRounds + k && !forced.has(c.id));
    if (!viol.length) break;
    viol.forEach((c) => forced.add(c.id));
    if (redo >= 2 || viol.every((c) => costIn(c.def, c.form) === 0)) {
      for (const c of viol) c.form = 'dropped';
      used = cands.reduce((s, c) => s + costIn(c.def, c.form), 0) + wsCost(fill.wsMode, p.pendingWs) + fill.duringSec;
      tradeSec = Math.max(0, tradeOf(used));
      if (!fill.overflow) k = roundsFor(tradeSec, R, p);
      break;
    }
    run();
  }
  for (const c of cands) {
    if (c.form !== 'dropped') c.reason = null;
    else c.reason = forced.has(c.id) ? 'needsRounds' : c.pin === 'dropped' ? 'teacher' : 'budget';
  }
  if (fill.overflow) warnings.push(RAISE_WARNING);
  let roundSecs = splitEven(tradeSec, k);
  if (p.fresh && k >= 1 && tradeSec < 30) {
    // 교사가 넣은 활동이 너무 많아 거래 시간이 없다: 라운드 1개(30초)를 두고 구간이 넘친다
    roundSecs = [30];
    warnings.push(`${p.stage} 활동이 많아 무역 시간을 넘겨요`);
  }

  const items: ScheduleItem[] = [];
  const rounds: RoundInfo[] = [];
  const where: Partial<Record<WorksheetId, WorksheetWhere>> = {};
  const placedWs = new Set<WorksheetId>();
  const byId = new Map(cands.map((c) => [c.id, c]));
  let t = p.startSec;

  const evItem = (c: Cand | { id: string; def: EventDef; form: ItemForm; tier: 1 | 2 | 3; pin: ItemForm | null }, at: number, durSec: number): ScheduleItem => ({
    id: `ev:${c.id}`,
    kind: 'event',
    refId: c.id,
    stage: p.stage,
    at,
    durSec,
    form: c.form,
    status: 'pending',
    blocking: blockingIn(c.def, c.form),
    tier: c.tier,
    ...(c.pin !== null ? { pinned: true } : {}),
  });

  // 학습지(중간마다): 사건 뒤 번호
  const wsMode = p.wsPolicy === 'off' ? 'off' : fill.wsMode;
  const l4e2Short = byId.get('L4-E2')?.form === 'short';
  const wsAfterEvent = (eventId: string): WorksheetId[] => {
    if (wsMode !== 'each') return [];
    const hit = p.pendingWs.filter((w) => {
      if (placedWs.has(w)) return false;
      if (worksheetById[w].afterEvent !== eventId) return false;
      if (w === 'W14' && l4e2Short) return false; // PRD 4.5: L4-E2 결정이 비차단이면 ⑭는 L4 구간 끝
      return true;
    });
    if (!p.noDuring || !hit.length) return hit;
    // 차시 한 판(PRD 4.3.3 v0.3.8): 번호가 거꾸로 가지 않게 — 원천 활동이 빠져 아직 못 띄운 앞 번호를 먼저(번호 순)
    const top = Math.max(...hit.map((w) => worksheetById[w].no));
    return p.pendingWs
      .filter((w) => !placedWs.has(w) && worksheetById[w].no <= top)
      .sort((x, y) => worksheetById[x].no - worksheetById[y].no);
  };
  const pushWs = (ids: WorksheetId[]) => {
    for (const w of ids) {
      const d = sec(worksheetById[w].minutes);
      items.push({ id: `ws:${w}`, kind: 'worksheet', refId: w, refIds: [w], stage: p.stage, at: t, durSec: d, form: 'full', status: 'pending', placement: 'each' });
      placedWs.add(w);
      where[w] = 'each';
      t += d;
    }
  };
  // 지금 쓰기(PRD 4.3.3.1 규칙 3): 원천 체험 바로 뒤(차단형) / 그 체험이 붙은 라운드 끝(비차단).
  // 번호 전체의 자리(where·묶음·끝나고)는 바꾸지 않는다
  const duringPlaced = new Set<WorksheetId>();
  const pushDuring = (ids: readonly WorksheetId[], sameRound: readonly string[] = []) => {
    for (const w of ids) {
      if (duringPlaced.has(w)) continue;
      const d = duringSecOf(w);
      const news = worksheetById[w].afterEvent;
      const afterNews = news !== duringSourceEvent[w] && sameRound.includes(news);
      items.push({
        id: `wsd:${w}`, kind: 'worksheet', refId: w, refIds: [w], stage: p.stage, at: t, durSec: d, form: 'full', status: 'pending', placement: 'during',
        ...(afterNews ? { afterNews: true } : {}),
      });
      duringPlaced.add(w);
      t += d;
    }
  };
  const duringAfter = (eventId: string): WorksheetId[] => fill.during.filter((w) => duringSourceEvent[w] === eventId);

  if (p.needCover) {
    items.push({
      id: `cover:${p.stage}`, kind: 'stageCover', refId: COVER_EVENT_IDS[p.stage], stage: p.stage, at: t, durSec: STAGE_COVER_SEC,
      form: 'full', status: 'pending', variant: p.coverVariant, blocking: true, tier: 1, ...(p.topCompanies ? { topCompanies: true } : {}),
    });
    t += STAGE_COVER_SEC;
  }
  if (p.summaryIds) {
    items.push({
      id: `sum:${p.stage}`, kind: 'stageCover', refId: 'summary', refIds: [...p.summaryIds], stage: p.stage, at: t, durSec: SUMMARY_CARD_SEC,
      form: 'full', status: 'pending', variant: 'summary', blocking: true, tier: 1,
    });
    t += SUMMARY_CARD_SEC;
  }
  // 원천 체험이 이미 시작한 지금 쓰기(다시 배치): 구간 맨 앞
  pushDuring(carry);

  // 빠진 활동도 항목으로 둔다(대시보드 [넣기]용, 발동하지 않음)
  for (const c of cands) if (c.form === 'dropped') items.push(evItem(c, p.startSec, 0));

  const live = cands.filter((c) => c.form !== 'dropped');
  const flow = live.filter((c) => c.def.anchor === 'afterPrev');
  const tail = live.filter((c) => c.def.anchor === 'stageEnd' && blockingIn(c.def, c.form));
  const anchored = live.filter((c) => c.def.anchor.startsWith('round:') || (c.def.anchor === 'stageEnd' && !blockingIn(c.def, c.form)));
  const blockingFlow = flow.filter((c) => blockingIn(c.def, c.form));
  const k2 = roundSecs.length;
  const counts = distribute(blockingFlow.length, k2);
  const slotOf = new Map<string, number>();
  /** 비차단 활동이 붙는 라운드(구간 안 새 라운드 번호 1..k) + 라운드 중간 여부 */
  const attach = new Map<string, { idx: number; mid: boolean }>();
  {
    let slot = 0;
    let usedInSlot = 0;
    let lastBlockingSlot = 0;
    let prevNb: number | null = null;
    for (const c of flow) {
      if (blockingIn(c.def, c.form)) {
        while (slot < counts.length - 1 && usedInSlot >= counts[slot]) {
          slot++;
          usedInSlot = 0;
        }
        slotOf.set(c.id, slot);
        usedInSlot++;
        lastBlockingSlot = slot;
        prevNb = null;
      } else {
        const idx: number = prevNb !== null ? Math.min(prevNb + 1, k2) : Math.min(lastBlockingSlot + 1, k2);
        attach.set(c.id, { idx, mid: false });
        prevNb = idx;
      }
    }
    for (const c of anchored) {
      const n = c.def.anchor.startsWith('round:') ? Number(c.def.anchor.slice(6)) : k2 + p.playedRounds;
      let idx = n - p.playedRounds;
      let mid = false;
      if (idx < 1) idx = 1;
      if (idx > k2) {
        const fb = c.def.anchorFallback;
        if (fb && fb.startsWith('round:')) {
          idx = Math.max(1, Number(fb.slice(6)) - p.playedRounds);
          mid = true; // L1-E7: 라운드가 1개면 첫 라운드 중간
        } else idx = k2;
        if (idx > k2) idx = k2;
      }
      attach.set(c.id, { idx: Math.max(0, idx), mid });
    }
  }
  const followerForm = (lead: string): ItemForm => byId.get(lead)?.form ?? 'dropped';

  const placeAttached = (idx: number, roundAt: number, roundDur: number): string[] => {
    const placed: string[] = [];
    const list = live.filter((c) => attach.get(c.id)?.idx === idx);
    for (const c of list) {
      const a = attach.get(c.id)!;
      const at = a.mid ? roundAt + Math.floor(roundDur / 2) : roundAt;
      items.push(evItem(c, at, roundAt + roundDur - at));
      placed.push(c.id);
    }
    // 따라가는 활동(학급 스마트폰 시작 L3-E2 → 결과 L3-E5 를 따름): 구간 첫 라운드 시작
    if (idx === 1) {
      for (const f of followers) {
        const lead = LINKED_EVENTS[f];
        const form = followerForm(lead);
        if (form === 'dropped') continue;
        const def = eventsById[f];
        items.push(evItem({ id: f, def, form, tier: def.tier as 1 | 2 | 3, pin: null }, roundAt, roundDur));
      }
    }
    return placed;
  };

  for (let j = 1; j <= k2; j++) {
    let tier1Before = false;
    for (const c of blockingFlow.filter((x) => slotOf.get(x.id) === j - 1)) {
      const d = costIn(c.def, c.form);
      items.push(evItem(c, t, d));
      t += d;
      if (c.tier === 1) tier1Before = true;
      pushWs(wsAfterEvent(c.id));
      pushDuring(duringAfter(c.id));
    }
    const roundNo = p.firstRound + j - 1;
    const L = roundSecs[j - 1];
    items.push({ id: `r:${roundNo}`, kind: 'round', refId: String(roundNo), stage: p.stage, at: t, durSec: L, form: 'full', status: 'pending', round: roundNo });
    rounds.push({ round: roundNo, stage: p.stage, at: t, durSec: L, afterTier1Blocking: tier1Before });
    const attachedHere = placeAttached(j, t, L);
    t += L;
    // 라운드 중에 붙은 활동 뒤 학습지는 라운드 끝에(PRD 4.5 '라운드 중이면 라운드 끝')
    for (const id of attachedHere) pushWs(wsAfterEvent(id));
    // 지금 쓰기도 라운드 중 발동 금지 — 결정 패널이 붙은 라운드 끝(같은 라운드에 보도가 붙으면 afterNews)
    for (const id of attachedHere) pushDuring(duringAfter(id), attachedHere);
  }
  if (k2 === 0) {
    for (const c of blockingFlow) {
      const d = costIn(c.def, c.form);
      items.push(evItem(c, t, d));
      t += d;
      pushWs(wsAfterEvent(c.id));
      pushDuring(duringAfter(c.id));
    }
    const nb = live.filter((x) => attach.has(x.id)).map((x) => x.id);
    for (const c of live.filter((x) => attach.has(x.id))) {
      items.push(evItem(c, t, 0));
      pushWs(wsAfterEvent(c.id));
      pushDuring(duringAfter(c.id), nb);
    }
  }
  // 구간 끝: 구간 끝 활동 → (중간마다) 남은 번호 / (구간 끝) 묶음 팝업
  for (const c of tail) {
    const d = costIn(c.def, c.form);
    items.push(evItem(c, t, d));
    t += d;
    pushWs(wsAfterEvent(c.id));
    pushDuring(duringAfter(c.id));
  }
  // (안전) 자리를 못 찾은 지금 쓰기는 구간 끝 학습지 앞에
  pushDuring(fill.during);
  const afterWs: WorksheetId[] = [];
  const rest = p.pendingWs.filter((w) => !placedWs.has(w)).sort((a, b) => worksheetById[a].no - worksheetById[b].no);
  if (wsMode === 'each') pushWs(rest);
  else if (wsMode === 'stageEnd' && rest.length) {
    items.push({
      id: `wsb:${p.stage}`, kind: 'worksheet', refId: `bundle:${p.stage}`, refIds: rest, stage: p.stage, at: t, durSec: WORKSHEET_BUNDLE_SEC,
      form: 'full', status: 'pending', placement: 'stageEnd',
    });
    t += WORKSHEET_BUNDLE_SEC;
    for (const w of rest) where[w] = 'stageEnd';
  } else if (wsMode === 'after') {
    afterWs.push(...rest);
    for (const w of rest) where[w] = 'after';
  } else for (const w of rest) where[w] = 'off';

  const summary: StageSummary = {
    stage: p.stage,
    startSec: p.startSec,
    lengthSec: p.lengthSec,
    alpha: fill.alpha,
    alphaRaised: fill.raised,
    budgetSec: Math.round(fill.budgetSec),
    fixedSec,
    usedSec: used,
    tradeSec: roundSecs.reduce((s, x) => s + x, 0),
    rounds: k2,
    roundSecs,
    worksheetMode: wsMode,
    overflow: fill.overflow,
    filled: fill.filled,
    skipped: fill.skipped,
    duringSec: fill.duringSec,
    during: [...carry, ...fill.during],
  };
  if (fill.deferred.length) warnings.push(duringDeferredWarning(fill.deferred, wsMode));
  return { items, rounds, endSec: t, summary, cands, afterWs, where, warnings, during: [...carry, ...fill.during], deferred: fill.deferred };
}

/** "시간이 짧아 ⑭ 지금 쓰기를 넣지 못했어요(끝나고 써요)" (PRD 4.3.3.1 규칙 5) */
export function duringDeferredWarning(ids: readonly WorksheetId[], mode: WorksheetPlacement): string {
  const labels = ids.map((id) => worksheetById[id]?.label ?? id).join('');
  return `시간이 짧아 ${labels} 지금 쓰기를 넣지 못했어요(${mode === 'stageEnd' ? '구간 끝에' : '끝나고'} 써요)`;
}

// ─── 편지 ─────────────────────────────────────────────────

/** PRD 4.3.5 편지 수 공식(라운드 수 상한 포함) */
export function letterFormula(tradeMinutes: number, totalRounds: number): number {
  let c = Math.floor(tradeMinutes / letterCountRule.divisor);
  c = Math.min(letterCountRule.max, Math.max(letterCountRule.min, c));
  return Math.max(0, Math.min(c, totalRounds - letterCountRule.maxRoundsMinus));
}

/** PRD 4.3.5 / 6.15.3 돌발 사건 수 */
export function incidentFormula(freq: IncidentFreq, tradeMinutes: number, totalRounds: number): number {
  let c = 0;
  if (freq === 'some') {
    c = Math.floor(tradeMinutes / (incidentCountRule.some.divisor ?? 10));
    const m = incidentCountRule.some.minIfTAtLeast;
    if (m && tradeMinutes >= m.t) c = Math.max(c, m.min);
  } else if (freq === 'often') c = Math.floor(tradeMinutes / (incidentCountRule.often.divisor ?? 5));
  return Math.max(0, Math.min(c, totalRounds - incidentCountRule.maxRoundsMinus));
}

interface FixedSlot { index: number; stage: LessonId; round: number }

/** 고르게 + 1등급 차단형 바로 뒤 라운드면 다음 라운드로(한 라운드 최대 1통) */
function pickRounds(cands: readonly RoundInfo[], count: number): RoundInfo[] {
  const M = cands.length;
  const n = Math.min(count, M);
  if (n <= 0) return [];
  const taken = new Set<number>();
  for (let i = 0; i < n; i++) {
    const target = Math.floor((i * M) / n);
    let j = -1;
    for (let x = target; x < M; x++) if (!taken.has(x) && !cands[x].afterTier1Blocking) { j = x; break; }
    if (j < 0) for (let x = target; x < M; x++) if (!taken.has(x)) { j = x; break; }
    if (j < 0) for (let x = target - 1; x >= 0; x--) if (!taken.has(x)) { j = x; break; }
    if (j >= 0) taken.add(j);
  }
  return [...taken].sort((a, b) => a - b).map((x) => cands[x]);
}

/** 구간 은행이 모자란 구간(있으면 첫 구간) */
function bankShortage(slots: readonly FixedSlot[], bank: BankSize): LessonId | null {
  const need = new Map<string, number>();
  for (const s of slots) {
    const key = `${s.stage}:${slotAt(s.index).difficulty}`;
    need.set(key, (need.get(key) ?? 0) + 1);
  }
  for (const [key, n] of need) {
    const [stage, d] = key.split(':') as [LessonId, Difficulty];
    if (n > bank(stage, d)) return stage;
  }
  return null;
}

/**
 * 편지 배치: `future` 라운드 중에서 count 통을 고르게(첫 라운드 제외는 호출하는 쪽이 후보에서 뺌).
 * 슬롯 번호는 startIndex 부터. 은행이 모자라면 줄이고 경고.
 */
function placeLetters(
  future: readonly RoundInfo[],
  count: number,
  startIndex: number,
  fixed: readonly FixedSlot[],
  bank: BankSize,
): { items: ScheduleItem[]; warning: string | null; count: number } {
  let c = Math.max(0, count);
  let warning: string | null = null;
  for (;;) {
    const chosen = pickRounds(future, c);
    const slots: FixedSlot[] = chosen.map((r, i) => ({ index: startIndex + i, stage: r.stage, round: r.round }));
    const short = bankShortage([...fixed, ...slots], bank);
    if (short && c > 0) {
      c -= 1;
      warning = short;
      continue;
    }
    const items = chosen.map((r, i): ScheduleItem => {
      const slotId = slotAt(startIndex + i).slotId;
      return { id: `letter:${slotId}`, kind: 'letter', refId: slotId, stage: r.stage, at: r.at, durSec: 0, form: 'full', status: 'pending', round: r.round };
    });
    return {
      items,
      count: items.length,
      warning: warning ? `${warning} 편지 문제가 모자라 편지를 ${items.length + fixed.length}통으로 줄였어요` : null,
    };
  }
}

// ─── 마무리 ───────────────────────────────────────────────

/** 마무리 항목(PRD 4.1.1, 4.2.1). afterWs = 끝나고 쓰기 번호 */
export function buildWrapup(playUnit: PlayUnit, scope: readonly LessonId[], afterWs: readonly WorksheetId[]): WrapItem[] {
  const hasL4 = scope.includes('L4');
  let steps: readonly WrapStep[];
  if (playUnit === 'lesson') steps = wrapupByUnit.lesson[scope[0]];
  else if (playUnit === 'unit' || hasL4) steps = wrapupByUnit.unit;
  else steps = wrapupByUnit.lesson.L1; // 연속 구간(L4 없음): 차시 판 L1~L3 구성(되돌아보기 축약)
  return steps.map((s): WrapItem => {
    const def = s.eventId ? eventsById[s.eventId] : undefined;
    let minutes = def ? def.minutes.full : 0;
    const worksheetIds: WorksheetId[] = [];
    if (s.id === 'containers') {
      worksheetIds.push('W16');
      minutes += worksheetById.W16.minutes;
    }
    if (s.id === 'reflect' && hasL4) worksheetIds.push('W18');
    if (s.id === 'magazine') worksheetIds.push('W17');
    if (s.id === 'afterWorksheet') worksheetIds.push(...afterWs);
    const item: WrapItem = { id: s.id, label: s.label, minutes, worksheetIds };
    if (s.eventId) item.eventId = s.eventId;
    if (s.optional) item.optional = true;
    if (s.id === 'awards') item.hideFlatMetrics = playUnit === 'lesson';
    if (s.id === 'reflect') item.questions = hasL4 ? 3 : 2;
    return item;
  });
}

export function afterWorksheetsOf(ids: readonly WorksheetId[]): { ids: WorksheetId[]; minutes: number } {
  return { ids: [...ids], minutes: ids.reduce((s, id) => s + worksheetById[id].minutes, 0) };
}

export function expectedTime(tradeMinutes: number, wrap: readonly WrapItem[]): Schedule['expected'] {
  const wrapMin = wrap.filter((w) => !w.optional).reduce((s, w) => s + w.minutes, 0);
  const tradeMin = Math.round(tradeMinutes * 10) / 10;
  const totalMin = Math.round((PREP_MINUTES + tradeMin + wrapMin) * 10) / 10;
  return { prepMin: PREP_MINUTES, tradeMin, wrapMin, totalMin, text: `준비 ${PREP_MINUTES}분 + 무역 ${tradeMin}분 + 마무리 ${wrapMin}분 = ${totalMin}분` };
}

// ─── 여러 구간 계획(새 판·다시 배치 공통) ──────────────────

interface StageSpec {
  stage: LessonId;
  /** 이 구간의 목표 끝 시각(초) */
  targetEnd: number;
  nominalSec: number;
  pending: { id: string; pin: ItemForm | null }[];
  pendingWs: WorksheetId[];
  needCover: boolean;
  summaryIds: readonly string[] | null;
  playedRounds: number;
  fresh: boolean;
  doneDuring?: WorksheetId[];
  carryDuring?: WorksheetId[];
  /** (다시 배치, 차시 한 판 '알아서') 이미 시작한 구간의 학습지 방식 — 한 판 한 방식으로 그대로 둔다 */
  wsLock?: WorksheetPlacement;
}

interface MultiPlan {
  items: ScheduleItem[];
  rounds: RoundInfo[];
  stages: StageSummary[];
  cands: Cand[];
  afterWs: WorksheetId[];
  where: Partial<Record<WorksheetId, WorksheetWhere>>;
  warnings: string[];
  stageModes: Partial<Record<LessonId, WorksheetPlacement>>;
  during: WorksheetId[];
  deferred: WorksheetId[];
}

function planStages(input: NormalizedInput, specs: readonly StageSpec[], startSec: number, firstRound: number): MultiPlan {
  const out: MultiPlan = { items: [], rounds: [], stages: [], cands: [], afterWs: [], where: {}, warnings: [], stageModes: {}, during: [], deferred: [] };
  let t = startSec;
  let nextRound = firstRound;
  const lessonGame = input.playUnit === 'lesson';
  for (const s of specs) {
    const planWith = (wsPolicy: 'auto' | WorksheetPlacement) => planStage({
      stage: s.stage,
      startSec: t,
      lengthSec: Math.max(0, s.targetEnd - t),
      nominalSec: s.nominalSec,
      alpha: input.activityRatio,
      roundSec: input.roundSecOverride,
      wsPolicy,
      pending: s.pending,
      pendingWs: s.pendingWs,
      needCover: s.needCover,
      coverVariant: input.playUnit === 'lesson' ? 'lesson' : 'stage',
      topCompanies: input.playUnit !== 'lesson' && s.stage === 'L2' && input.scope[0] !== 'L2',
      summaryIds: s.summaryIds,
      playedRounds: s.playedRounds,
      firstRound: nextRound,
      fresh: s.fresh,
      order: input.fillOrder,
      doneDuring: s.doneDuring,
      carryDuring: s.carryDuring,
      noDuring: lessonGame,
    });
    const plan = lessonGame && input.worksheetMode === 'auto' ? lessonAutoPlan(planWith, s) : planWith(input.worksheetMode);
    out.items.push(...plan.items);
    out.rounds.push(...plan.rounds);
    out.stages.push(plan.summary);
    out.cands.push(...plan.cands);
    out.afterWs.push(...plan.afterWs);
    Object.assign(out.where, plan.where);
    for (const w of plan.warnings) if (!out.warnings.includes(w)) out.warnings.push(w);
    out.stageModes[s.stage] = plan.summary.worksheetMode;
    out.during.push(...plan.during);
    out.deferred.push(...plan.deferred);
    nextRound += plan.rounds.length;
    t = plan.endSec;
  }
  return out;
}

/**
 * 차시 한 판 '알아서 정하기'(PRD 4.3.3 v0.3.8 규칙 1): '활동마다 바로'로 시작하고, 그러면 그 차시 라운드가 2개 미만이면
 * '차시 끝에 모아서'로 한 단계만 내린다(사다리의 after → stageEnd → each 올리기는 쓰지 않음).
 * 다시 배치에서 이미 시작한 구간은 처음 정한 방식을 그대로 쓴다(한 판 한 방식).
 */
function lessonAutoPlan(planWith: (wsPolicy: 'auto' | WorksheetPlacement) => StagePlan, s: StageSpec): StagePlan {
  if (s.wsLock === 'each' || s.wsLock === 'stageEnd') return planWith(s.wsLock);
  const each = planWith('each');
  if (s.playedRounds + each.rounds.length >= 2 || !s.pendingWs.length) return each;
  return planWith('stageEnd');
}

function sortItems(items: ScheduleItem[]): ScheduleItem[] {
  return items.map((it, i) => ({ it, i })).sort((a, b) => a.it.at - b.it.at || a.i - b.i).map((x) => x.it);
}

function activitiesOf(cands: readonly Cand[]): ActivityStatus[] {
  const list: ActivityStatus[] = cands.map((c) => ({
    id: c.id,
    stage: c.def.lesson,
    title: c.def.title,
    tier: c.tier,
    priority: c.def.priority ?? null,
    form: c.form,
    blocking: blockingIn(c.def, c.form),
    minutes: c.form === 'dropped' ? 0 : c.form === 'short' ? (c.def.minutes.short ?? 0) : c.def.minutes.full,
    pinned: c.pin !== null,
    reason: c.form === 'dropped' ? c.reason : null,
  }));
  // 따라가는 활동도 목록에
  for (const [f, lead] of Object.entries(LINKED_EVENTS)) {
    const l = list.find((x) => x.id === lead);
    if (!l) continue;
    const def = eventsById[f];
    list.push({
      id: f, stage: def.lesson, title: def.title, tier: def.tier as 1 | 2 | 3, priority: def.priority ?? null, form: l.form,
      blocking: blockingIn(def, l.form), minutes: l.form === 'dropped' ? 0 : l.form === 'short' ? (def.minutes.short ?? 0) : def.minutes.full,
      pinned: l.pinned, reason: l.reason,
    });
  }
  return list.sort((a, b) => allEvents.indexOf(eventsById[a.id]) - allEvents.indexOf(eventsById[b.id]));
}

// ─── 새 판 ────────────────────────────────────────────────

/** 배치표 만들기. 잘못된 입력이면 `ScheduleError`(SCOPE_TOO_LONG / BAD_SCOPE / BAD_MINUTES) */
export function buildSchedule(raw: ScheduleInput): Schedule {
  const input = normalizeInput(raw);
  const bank = raw.letterBankSize ?? defaultBankSize;
  const T = input.tradeMinutes * 60;
  const n = input.scope.length;
  const Ts = T / n;
  const specs: StageSpec[] = input.scope.map((stage, i) => ({
    stage,
    targetEnd: Math.round(Ts * (i + 1)),
    nominalSec: Ts,
    pending: stageActivities(stage).map((e) => ({ id: e.id, pin: input.overrides[LINKED_EVENTS[e.id] ?? e.id] ?? null })),
    pendingWs: input.worksheetMode === 'off' ? [] : tradeWorksheets(stage),
    needCover: true,
    summaryIds: i === 0 && stageStartByLesson[stage].summaryCardIds.length ? stageStartByLesson[stage].summaryCardIds : null,
    playedRounds: 0,
    fresh: true,
  }));
  const plan = planStages(input, specs, 0, 1);
  const totalRounds = plan.rounds.length;
  const formula = input.letters ? letterFormula(input.tradeMinutes, totalRounds) : 0;
  const letters = placeLetters(plan.rounds.filter((r) => r.round !== 1), formula, 0, [], bank);
  const warnings = [...plan.warnings];
  if (letters.warning) warnings.push(letters.warning);
  const incidentCount = incidentFormula(input.incidentFreq, input.tradeMinutes, totalRounds);
  let items = [...plan.items, ...letters.items];
  const placers = raw.extraPlacers ?? extraPlacers;
  for (const placer of placers) items.push(...placer({ input, rounds: plan.rounds, items, incidentCount, totalRounds }));
  items = sortItems(items);
  const where: Partial<Record<WorksheetId, WorksheetWhere>> = { ...plan.where };
  const wrapup = buildWrapup(input.playUnit, input.scope, plan.afterWs);
  for (const w of wrapup) for (const id of w.worksheetIds) if (!where[id]) where[id] = 'wrap';
  const activities = activitiesOf(plan.cands);
  return {
    input,
    items,
    stages: plan.stages,
    activities,
    included: activities.filter((a) => a.form === 'full').map((a) => a.id),
    shortened: activities.filter((a) => a.form === 'short').map((a) => a.id),
    dropped: activities.filter((a) => a.form === 'dropped').map((a) => a.id),
    worksheetModes: plan.stageModes,
    worksheetWhere: where,
    totalRounds,
    letterCount: letters.count,
    letterFormula: formula,
    incidentCount,
    wrapup,
    afterWorksheets: afterWorksheetsOf(plan.afterWs),
    duringWorksheets: { placed: [...plan.during], deferred: [...plan.deferred] },
    expected: expectedTime(input.tradeMinutes, wrapup),
    warnings,
  };
}

/** 오류를 값으로 받는 판 */
export function tryBuildSchedule(input: ScheduleInput): { ok: true; schedule: Schedule } | { ok: false; error: ScheduleErrorCode; message: string } {
  try {
    return { ok: true, schedule: buildSchedule(input) };
  } catch (e) {
    if (e instanceof ScheduleError) return { ok: false, error: e.code, message: e.message };
    throw e;
  }
}

/** 학급 상태 → 배치 입력(무역 시작·다시 배치 때) */
export function inputFromClass(cs: ClassState, playUnit: PlayUnit, scope: readonly LessonId[]): ScheduleInput {
  const s = cs.settings;
  const Ts = (s.tradeMinutes * 60) / Math.max(1, scope.length);
  const roundAuto = cs.schedule.roundSecAuto ?? s.roundSec === autoRoundSec(Ts);
  return {
    playUnit,
    scope,
    tradeMinutes: s.tradeMinutes,
    activityRatio: s.activityRatio,
    roundSecOverride: roundAuto ? null : s.roundSec,
    worksheetMode: s.worksheetMode,
    overrides: cs.schedule.overrides ?? {},
    letters: cs.letters.enabled,
    seed: cs.seed,
    incidentFreq: s.incidentFreq,
    comeback: s.comeback,
  };
}

// ─── 다시 배치 ────────────────────────────────────────────

export type RescheduleChange =
  /** 무역 시간(clock.durationSec)이 바뀜 — 연장·단축 */
  | { type: 'time' }
  /** settings.roundSec 이 바뀜 */
  | { type: 'roundSec' }
  | { type: 'itemForm'; id: string; form: ItemForm }
  | { type: 'postpone'; id: string; sec: number }
  | { type: 'skip'; id: string }
  | { type: 'none' };

export interface RescheduleResult {
  schedule: ScheduleState;
  stages: StageSummary[];
  activities: ActivityStatus[];
  totalRounds: number;
  letterCount: number;
  warnings: string[];
  error?: string;
}

/** 항목 ID 또는 사건 ID 로 항목 찾기 */
export function findItem(items: readonly ScheduleItem[], id: string): ScheduleItem | undefined {
  return items.find((it) => it.id === id) ?? items.find((it) => it.kind === 'event' && it.refId === id);
}

const isStarted = (it: ScheduleItem) => it.status !== 'pending';

/**
 * 아직 시작하지 않은 항목만 다시 배치(PRD 4.2.2, 4.3.4 끝). 시작한(진행 중·끝·건너뜀) 항목은 그대로 둔다.
 * - 남은 시간 = (새 무역 시간) − max(지금, 진행 중 항목 끝) [− 미루기].
 * - 남은 시간은 각 구간의 원래 남은 길이 비율로 나눈다. 진행 중 구간은 남은 부분만, 시작 안 한 구간은 새로 계획한다.
 */
export function reschedule(
  schedule: ScheduleState,
  cs: ClassState,
  now: number,
  change: RescheduleChange,
  opts: {
    playUnit?: PlayUnit;
    scope?: readonly LessonId[];
    letterBankSize?: BankSize;
    extraPlacers?: readonly ExtraPlacer[];
    /** 이 구간(진행 중)은 다시 계획하지 않는다 — 남은 시간은 모두 뒤 구간으로(일찍 끝낸 라운드) */
    freezeStage?: LessonId;
    /** 경과 초를 이 값으로 본다(일찍 끝낸 라운드: 정수 초로 내림 — 다음 항목이 누른 순간 바로 시작하도록) */
    elapsedSec?: number;
  } = {},
): RescheduleResult {
  const playUnit = opts.playUnit ?? cs.settings.playUnit;
  const scope = [...(opts.scope ?? cs.settings.scope)];
  const bank = opts.letterBankSize ?? defaultBankSize;
  let items = schedule.items.map((it) => ({ ...it }));
  let delay = 0;
  const fail = (error: string): RescheduleResult => ({ schedule, stages: [], activities: [], totalRounds: 0, letterCount: 0, warnings: [], error });

  // 1. 바뀐 것 반영
  if (change.type === 'itemForm') {
    const it = findItem(items, change.id);
    if (!it || it.kind !== 'event') return fail('NO_ITEM');
    if (isStarted(it)) return fail('ALREADY_STARTED');
    const leadId = LINKED_EVENTS[it.refId] ?? it.refId;
    const def = eventsById[leadId];
    if (def.tier === 1 && change.form === 'dropped') return fail('TIER1_CANNOT_DROP');
    if (change.form === 'short' && !canShorten(def)) return fail('NO_SHORT_FORM');
    const lead = findItem(items, leadId);
    if (lead) {
      lead.form = change.form;
      lead.pinned = true;
    }
  } else if (change.type === 'skip') {
    const it = findItem(items, change.id);
    if (!it) return fail('NO_ITEM');
    if (isStarted(it)) return fail('ALREADY_STARTED');
    // 라운드를 건너뛰면 그 라운드를 없앤다(라운드 번호가 밀리지 않게)
    if (it.kind === 'round') items = items.filter((x) => x !== it);
    else it.status = 'skipped';
    if (it.kind === 'event' && LINKED_EVENTS[it.refId] === undefined) {
      // 따라가는 활동도 함께 건너뜀
      for (const [f, lead] of Object.entries(LINKED_EVENTS)) if (lead === it.refId) { const fi = findItem(items, f); if (fi && !isStarted(fi)) fi.status = 'skipped'; }
    }
  } else if (change.type === 'postpone') {
    const it = findItem(items, change.id);
    if (!it) return fail('NO_ITEM');
    if (isStarted(it)) return fail('ALREADY_STARTED');
    delay = Math.max(0, change.sec);
  }

  const T = cs.clock.durationSec;
  const e = opts.elapsedSec ?? elapsedSec(cs.clock, now);
  const nonLetter = (it: ScheduleItem) => it.kind === 'event' || it.kind === 'stageCover' || it.kind === 'round' || it.kind === 'worksheet';
  const liveEnd = items.filter((it) => it.status === 'live').reduce((m, it) => Math.max(m, it.at + it.durSec), 0);
  const e0 = Math.max(e, liveEnd) + delay;

  // 2. 구간 나누기: 시작한 마지막 구간부터 계획한다
  const startedStages = new Set(items.filter((it) => isStarted(it) && nonLetter(it) && it.status !== 'skipped').map((it) => it.stage));
  let curIdx = -1;
  scope.forEach((s, i) => {
    if (startedStages.has(s)) curIdx = i;
  });
  if (curIdx > 0) {
    // 지난 구간의 남은 항목은 건너뜀(구간은 되돌아가지 않음). 학습지 번호는 끝나고 쓰기로 넘어가도록 항목만 지운다
    items = items.filter((it) => !((it.kind === 'worksheet' || it.kind === 'round') && it.status === 'pending' && scope.indexOf(it.stage) < curIdx));
    for (const it of items) if (it.status === 'pending' && it.kind !== 'letter' && scope.indexOf(it.stage) < curIdx && it.form !== 'dropped') it.status = 'skipped';
  }
  const planFrom = Math.max(0, curIdx);
  let planScope = scope.slice(planFrom);
  let curStarted = curIdx >= 0;
  if (opts.freezeStage && planScope[0] === opts.freezeStage) {
    planScope = planScope.slice(1);
    curStarted = false;
  }
  const oldSpan = (s: LessonId) => {
    const its = schedule.items.filter((it) => it.stage === s && it.form !== 'dropped' && it.kind !== 'letter');
    if (!its.length) return { start: 0, end: 0 };
    return { start: Math.min(...its.map((it) => it.at)), end: Math.max(...its.map((it) => it.at + it.durSec)) };
  };
  const weights = planScope.map((s, i) => {
    const sp = oldSpan(s);
    return i === 0 && curStarted ? Math.max(0, sp.end - e0) : Math.max(0, sp.end - sp.start);
  });
  const avail = Math.max(0, T - e0);
  const wsum = weights.reduce((a, b) => a + b, 0);
  let shares: number[];
  if (wsum > 0) shares = weights.map((w) => (w / wsum) * avail);
  else if (planScope.length === 1) shares = [avail];
  else {
    const others = planScope.length - (curStarted ? 1 : 0);
    shares = planScope.map((_, i) => (curStarted && i === 0 ? 0 : avail / others));
  }
  const nominal = T / scope.length;

  // 3. 시작한 항목·건너뛴 항목·지난 구간 항목·배달한(또는 지난 라운드) 편지는 그대로. 나머지는 다시 만든다
  const lastRound = Math.max(cs.round, 0, ...items.filter((it) => it.kind === 'round' && (it.status === 'live' || it.status === 'done')).map((it) => it.round ?? 0));
  const keptLetters = items.filter((it) => it.kind === 'letter'
    && (it.status !== 'pending' || (it.round ?? 0) <= lastRound || cs.letters.skipped.includes(it.refId) || cs.letters.delivered.includes(it.refId)));
  const kept = items.filter((it) => {
    if (it.kind === 'letter') return keptLetters.includes(it);
    return it.status !== 'pending' || scope.indexOf(it.stage) < planFrom;
  });

  // 이미 띄운 번호(지금 쓰기 ★ 칸은 번호를 띄운 것으로 세지 않는다 — PRD 4.3.3.1 규칙 7)
  const shown = new Set<string>();
  for (const it of kept) if (it.kind === 'worksheet' && it.placement !== 'during') (it.refIds ?? [it.refId]).forEach((w) => shown.add(w));
  // 지금 쓰기: 이미 띄웠거나 건너뛴 번호는 다시 넣지 않고, 원천 체험이 이미 시작했는데 아직 안 띄운 번호는 그 구간 맨 앞에 둔다
  const doneDuring = kept.filter((it) => it.kind === 'worksheet' && it.placement === 'during').map((it) => it.refId as WorksheetId);
  const sourceStarted = (w: WorksheetId) => {
    const src = duringSourceEvent[w];
    const it = src ? items.find((x) => x.kind === 'event' && x.refId === src) : undefined;
    return !!it && (it.status === 'live' || it.status === 'done');
  };
  const pendingDuring = items.filter((it) => it.kind === 'worksheet' && it.placement === 'during' && it.status === 'pending').map((it) => it.refId as WorksheetId);
  const input = looseInput(inputFromClass(cs, playUnit, scope), scope, T / 60);
  const pinOf = (eventId: string): ItemForm | null => {
    const it = items.find((x) => x.kind === 'event' && x.refId === eventId);
    if (it?.pinned) return it.form;
    return input.overrides[eventId] ?? null;
  };
  let acc = e0;
  const specs: StageSpec[] = planScope.map((stage, i) => {
    acc += shares[i];
    const started = curStarted && i === 0;
    const stageItems = items.filter((it) => it.stage === stage);
    const pendingEvents = stageActivities(stage)
      .map((def) => def.id)
      .filter((id) => {
        const it = stageItems.find((x) => x.kind === 'event' && x.refId === id);
        return it ? it.status === 'pending' : !started;
      })
      .map((id) => ({ id, pin: pinOf(LINKED_EVENTS[id] ?? id) }));
    const coverIt = stageItems.find((x) => x.kind === 'stageCover' && x.variant !== 'summary');
    const sumIt = stageItems.find((x) => x.kind === 'stageCover' && x.variant === 'summary');
    return {
      stage,
      targetEnd: i === planScope.length - 1 ? Math.max(e0, T) : Math.round(acc),
      nominalSec: nominal,
      pending: pendingEvents,
      pendingWs: input.worksheetMode === 'off' ? [] : tradeWorksheets(stage).filter((w) => !shown.has(w)),
      needCover: !started && (!coverIt || coverIt.status === 'pending'),
      summaryIds: !started && sumIt && sumIt.status === 'pending' ? (sumIt.refIds ?? []) : null,
      playedRounds: items.filter((it) => it.kind === 'round' && it.stage === stage && isStarted(it) && it.status !== 'skipped').length,
      fresh: !started,
      doneDuring,
      carryDuring: pendingDuring.filter((w) => worksheetById[w].lesson === stage && sourceStarted(w)),
      ...(started && schedule.stageModes?.[stage] ? { wsLock: schedule.stageModes[stage] } : {}),
    };
  });
  const plan = planStages(input, specs, e0, lastRound + 1);
  const totalRounds = lastRound + plan.rounds.length;
  const fixedSlots: FixedSlot[] = keptLetters.map((it) => ({ index: Math.max(0, Number(it.refId.slice(1)) - 1), stage: it.stage, round: it.round ?? 0 }));
  const liveFixed = keptLetters.filter((it) => !cs.letters.skipped.includes(it.refId)).length;
  const formula = cs.letters.enabled ? letterFormula(T / 60, totalRounds) : 0;
  const future = plan.rounds.filter((r) => r.round !== 1 && !keptLetters.some((l) => l.round === r.round));
  const startIndex = fixedSlots.length ? Math.max(...fixedSlots.map((s) => s.index)) + 1 : 0;
  const letters = placeLetters(future, Math.max(0, formula - liveFixed), startIndex, fixedSlots, bank);
  const warnings = [...plan.warnings];
  if (letters.warning) warnings.push(letters.warning);
  const incidentCount = incidentFormula(input.incidentFreq, T / 60, totalRounds);
  let out = [...kept, ...plan.items, ...letters.items];
  const placers = opts.extraPlacers ?? extraPlacers;
  for (const placer of placers) out.push(...placer({ input, rounds: plan.rounds, items: out, incidentCount, totalRounds }));
  out = sortItems(out);
  // 끝나고 쓰기 = 범위 안 무역 학습지 중 어디에도 놓이지 않은 번호
  const placedWs = new Set<string>();
  for (const it of out) if (it.kind === 'worksheet' && it.status !== 'skipped' && it.placement !== 'during') (it.refIds ?? [it.refId]).forEach((w) => placedWs.add(w));
  const afterWs = input.worksheetMode === 'off' ? [] : scope.flatMap(tradeWorksheets).filter((w) => !placedWs.has(w) && !shownSkipped(items, w));
  const wrapup = buildWrapup(playUnit, scope, afterWs);
  const stageModes = { ...(schedule.stageModes ?? {}), ...plan.stageModes };
  return {
    schedule: {
      ...schedule,
      items: out,
      version: schedule.version + 1,
      wrapup,
      warnings,
      stageModes,
      upcoming: [],
    },
    stages: plan.stages,
    activities: activitiesOf(plan.cands),
    totalRounds,
    letterCount: liveFixed + letters.count,
    warnings,
  };
}

/**
 * 일찍 끝낸 라운드(PRD 4.3.7, 오케스트레이터 결정 2회차).
 * - 진행 중 구간의 남은 계획 항목은 형태·순서·길이를 그대로 두고 아낀 초만큼 앞당긴다 → 계획한 다음 항목이 바로 시작.
 *   그 구간에 새 라운드를 만들지 않고, 계획한 활동을 빼지 않는다.
 * - 아낀 시간은 아직 시작하지 않은 뒤 구간들로 넘겨 그 구간들만 다시 배치(R1~R6 사다리)한다.
 * - 뒤 구간이 없으면(마지막·단일 구간) 판이 그만큼 일찍 끝난다(호출하는 쪽이 결산으로 넘김).
 */
export function rescheduleEarlyEnd(
  schedule: ScheduleState,
  cs: ClassState,
  now: number,
  savedSec: number,
  opts: { playUnit?: PlayUnit; scope?: readonly LessonId[]; letterBankSize?: BankSize; extraPlacers?: readonly ExtraPlacer[] } = {},
): RescheduleResult {
  const scope = [...(opts.scope ?? cs.settings.scope)];
  const stage = cs.stage;
  const saved = Math.max(0, Math.round(savedSec));
  // 다시 배치는 정수 초 기준. 버튼을 누른 소수 시각은 내림해 다음 항목이 그 틱에 바로 시작하게 한다(올림이면 다음 틱까지 기다림)
  const e = Math.floor(elapsedSec(cs.clock, now) + 1e-9);
  const frozenIds = new Set<string>();
  const items: ScheduleItem[] = schedule.items.map((it) => {
    if (it.stage !== stage || it.status !== 'pending') return it;
    frozenIds.add(it.id);
    // 빠진 활동 자리(at=구간 시작, 0초)는 옮기지 않는다
    // 끝난 라운드 중간에 붙어 있던 비차단 활동(L1-E7 등)은 지금 바로
    const at = it.form === 'dropped' ? it.at : Math.max(e, it.at - saved);
    // 다시 배치하는 동안 '시작한 항목'처럼 그대로 두려고 잠시 live 로 둔다
    return { ...it, at, status: 'live' as const };
  });
  const hasLater = scope.indexOf(stage) < scope.length - 1;
  let result: RescheduleResult;
  if (hasLater) {
    result = reschedule({ ...schedule, items }, cs, now, { type: 'none' }, { ...opts, freezeStage: stage, elapsedSec: e });
    if (result.error) return result;
  } else {
    // 마지막(또는 유일한) 구간: 아낀 시간을 그 구간의 아직 시작하지 않은 라운드들에 나눠 더한다(새 라운드 없음).
    // 남은 라운드가 없으면 계획이 그만큼 일찍 끝난다(호출하는 쪽이 결산으로)
    const rounds = items
      .filter((it) => frozenIds.has(it.id) && it.kind === 'round' && it.form !== 'dropped')
      .sort((a, b) => a.at - b.at);
    const extras = splitEven(saved, rounds.length);
    rounds.forEach((r, i) => {
      const x = extras[i];
      if (!x) return;
      const oldEnd = r.at + r.durSec;
      for (let j = 0; j < items.length; j++) {
        const it = items[j];
        if (!frozenIds.has(it.id) || it.form === 'dropped') continue;
        if (it.id === r.id) items[j] = { ...it, durSec: it.durSec + x };
        else if (it.at >= oldEnd) items[j] = { ...it, at: it.at + x };
        else if (it.at >= r.at && it.at + it.durSec === oldEnd) items[j] = { ...it, durSec: it.durSec + x }; // 라운드에 붙은 비차단 활동
      }
      // 뒤 라운드 항목도 같은 배열에서 갱신된 값을 쓴다
      for (let k = i + 1; k < rounds.length; k++) rounds[k] = items.find((it) => it.id === rounds[k].id)!;
    });
    result = { schedule: { ...schedule, items, version: schedule.version + 1, upcoming: [] }, stages: [], activities: [], totalRounds: 0, letterCount: 0, warnings: [] };
  }
  let restored = result.schedule.items.map((it) => (frozenIds.has(it.id) && it.status === 'live' ? { ...it, status: 'pending' as const } : it));
  // 판 끝은 T를 넘지 않는다(넘치면 마지막 남은 라운드에서 잘라냄)
  const T = cs.clock.durationSec;
  const end = Math.max(0, ...restored.filter((it) => it.form !== 'dropped').map((it) => it.at + it.durSec));
  if (end > T) {
    const over = end - T;
    const last = [...restored].filter((it) => it.kind === 'round' && it.status === 'pending').sort((a, b) => b.at - a.at)[0];
    if (last) {
      const lastEnd = last.at + last.durSec;
      restored = restored.map((it) => {
        if (it.id === last.id) return { ...it, durSec: Math.max(0, it.durSec - over) };
        if (it.status === 'pending' && it.at >= lastEnd) return { ...it, at: it.at - over };
        if (it.status === 'pending' && it.at >= last.at && it.at + it.durSec === lastEnd) return { ...it, durSec: Math.max(0, it.durSec - over) };
        return it;
      });
    }
  }
  return { ...result, schedule: { ...result.schedule, items: sortItems(restored) } };
}

function shownSkipped(items: readonly ScheduleItem[], w: string): boolean {
  return items.some((it) => it.kind === 'worksheet' && it.status === 'skipped' && it.placement !== 'during' && (it.refIds ?? [it.refId]).includes(w));
}

// ─── 학습지 위치(검사·대시보드용) ──────────────────────────

/** 배치표에서 범위 안 학습지 번호가 어디에 있는지 */
export function worksheetPlacementOf(items: readonly ScheduleItem[], wrap: readonly WrapItem[]): Partial<Record<WorksheetId, WorksheetWhere>> {
  const out: Partial<Record<WorksheetId, WorksheetWhere>> = {};
  for (const it of items) {
    if (it.kind !== 'worksheet' || it.placement === 'during') continue;
    for (const w of (it.refIds ?? [it.refId]) as WorksheetId[]) out[w] = it.placement === 'stageEnd' ? 'stageEnd' : 'each';
  }
  for (const s of wrap) for (const w of s.worksheetIds) if (!out[w]) out[w] = s.id === 'afterWorksheet' ? 'after' : 'wrap';
  return out;
}

// ─── 미리보기(판 설정 화면, 109) ───────────────────────────

export interface SchedulePreview {
  ok: true;
  playUnit: PlayUnit;
  scope: LessonId[];
  tradeMinutes: number;
  /** 구간 띠(비율 0~1). 차시 한 판이면 한 칸 */
  bands: { stage: LessonId; label: string; startRatio: number; ratio: number; rounds: number; worksheetMode: WorksheetPlacement; alphaRaised: boolean }[];
  activities: (ActivityStatus & { canDrop: boolean; canShort: boolean })[];
  expected: Schedule['expected'];
  letters: number;
  incidents: number;
  totalRounds: number;
  wrapup: WrapItem[];
  /** 끝나고 쓸 학습지 n개(약 m분) */
  afterWorksheets: { ids: WorksheetId[]; minutes: number };
  /** (v0.3.4) 지금 쓰기 ③★·⑭★ — 넣은 번호 / 넣지 못한 번호 */
  duringWorksheets: { placed: WorksheetId[]; deferred: WorksheetId[] };
  warnings: string[];
}

export function previewSchedule(input: ScheduleInput): SchedulePreview | { ok: false; error: ScheduleErrorCode; message: string } {
  const r = tryBuildSchedule(input);
  if (!r.ok) return r;
  const s = r.schedule;
  const T = s.input.tradeMinutes * 60;
  return {
    ok: true,
    playUnit: s.input.playUnit,
    scope: s.input.scope,
    tradeMinutes: s.input.tradeMinutes,
    bands: s.stages.map((st) => ({
      stage: st.stage,
      label: s.input.playUnit === 'lesson' ? `${st.stage} ${lessonsById[st.stage].title}` : st.stage,
      startRatio: st.startSec / T,
      ratio: st.lengthSec / T,
      rounds: st.rounds,
      worksheetMode: st.worksheetMode,
      alphaRaised: st.alphaRaised,
    })),
    activities: s.activities.map((a) => {
      const def = eventsById[LINKED_EVENTS[a.id] ?? a.id];
      return { ...a, canDrop: a.tier !== 1, canShort: canShorten(def) };
    }),
    expected: s.expected,
    letters: s.letterCount,
    incidents: s.incidentCount,
    totalRounds: s.totalRounds,
    wrapup: s.wrapup,
    afterWorksheets: s.afterWorksheets,
    duringWorksheets: s.duringWorksheets,
    warnings: s.warnings,
  };
}

/** 배치표 → 학급 상태에 넣을 모양 */
export function toScheduleState(s: Schedule, prev: ScheduleState, mode: 'auto' | 'manual'): ScheduleState {
  return {
    ...prev,
    items: s.items,
    version: prev.version + 1,
    mode,
    wrapup: s.wrapup,
    warnings: s.warnings,
    stageModes: s.worksheetModes,
    upcoming: [],
    waiting: null,
    timeUp: null,
    baseRecorded: false,
    roundSecAuto: s.input.roundSecOverride === null,
  };
}
