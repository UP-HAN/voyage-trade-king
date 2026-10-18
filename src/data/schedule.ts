/**
 * 판 구성·자동 배치 상수 (PRD 4.1~4.3, v0.3 / v0.3.1) — 스케줄러(작업 123)·판 설정 화면(109)이 읽는다.
 * 모두 [게임 설정]. 배치 계산 자체는 core(작업 123)가 한다.
 * 활동별 등급·분·짧은 형태·위치는 events.ts 의 v0.3 필드(tier, minutes, shortForm, needsRounds, anchor)에 있다.
 */
import { lessonsById, pageRangeLabel } from './lessons';
import type { LessonId, PortId, StageStart, WorksheetId, WrapStep } from './types';

// ─── 판 단위(v0.3.1, PRD 4.1.1) ─────────────────────────────

export type PlayUnitId = 'lesson' | 'unit';

/** 판 단위 카드 두 장. 둘 다 1등급 기능 — 기본 선택 없음(마지막 선택은 교사 브라우저가 기억) */
export const playUnits = {
  lesson: {
    id: 'lesson' as const,
    label: '차시마다 한 판',
    desc: '오늘 배우는 차시만 해요',
    defaultMinutes: 25,
    recommended: [20, 30] as const,
    /** 맛보기 판(첫 시간 체험) */
    quickMinutes: { L1: 10 } as Readonly<Partial<Record<LessonId, number>>>,
    /** 범위: L1~L4 중 하나 */
    scope: 'one' as const,
  },
  unit: {
    id: 'unit' as const,
    label: '단원 전체 한 판',
    desc: '단원 전체를 한 번에 해요',
    defaultMinutes: 25,
    recommended: [25, 60] as const,
    scope: ['L1', 'L2', 'L3', 'L4'] as readonly LessonId[],
  },
} as const;

/** (고급, 접힘) 연속 구간 직접 고르기 — [고급 설정]을 펼쳐야 보인다 */
export const advancedScope = {
  label: '연속 구간 직접 고르기',
  examples: [['L1', 'L2'], ['L3', 'L4']] as readonly (readonly LessonId[])[],
  hiddenByDefault: true,
} as const;

/** 차시 한 판의 차시 카드(차시 표지·판 설정 카드). 제목·쪽은 lessons.ts 값, 질문은 교과서 발문에서 */
export const lessonCards: readonly { id: LessonId; title: string; pages: string; question: string; questionPages: readonly number[] }[] = [
  { id: 'L1', title: lessonsById.L1.title, pages: pageRangeLabel(lessonsById.L1.pages), question: '교실에 있는 여러 물건과 재료의 생산지가 다양한 까닭은 무엇일까요?', questionPages: [94] },
  { id: 'L2', title: lessonsById.L2.title, pages: pageRangeLabel(lessonsById.L2.pages), question: '우리나라는 왜 원유, 정밀 화학 원료, 천연가스 등을 주로 수입하고 반도체, 자동차, 무선 통신 기기 등을 주로 수출할까요?', questionPages: [100] },
  { id: 'L3', title: lessonsById.L3.title, pages: pageRangeLabel(lessonsById.L3.pages), question: '무역을 통해 세계 여러 나라는 어떻게 서로 기대고 겨룰까요?', questionPages: [106] },
  { id: 'L4', title: lessonsById.L4.title, pages: pageRangeLabel(lessonsById.L4.pages), question: '우리나라가 수입 철강 제품에 높은 관세를 부과했던 까닭은 무엇일까요?', questionPages: [108] },
];

/**
 * 마무리 구성표(PRD 4.1.1, 4.2.1).
 * - 차시 한 판 L1~L3: 정산 → 결산·시상(값이 모두 같은 지표의 상 숨김) → 되돌아보기(축약 2문항) → 끝나고 쓰기
 * - 차시 한 판 L4: 정산 → 컨테이너 OX → 결산·시상 → 되돌아보기 → 잡지 표지(선택) → 끝나고 쓰기
 * - 단원 한 판: PRD 4.2.1 마무리 전체(L4 포함)
 */
const SETTLE: WrapStep = { id: 'settle', label: '마지막 라운드 정산' };
const AFTER_WS: WrapStep = { id: 'afterWorksheet', label: "'끝나고 쓰기' 학습지 안내 + 항해 기록장" };
const CONTAINERS: WrapStep = { id: 'containers', label: '컨테이너 OX', eventId: 'L4-E6' };
const MAGAZINE: WrapStep = { id: 'magazine', label: '잡지 표지', eventId: 'L4-E8', optional: true };

export const wrapupByUnit: {
  readonly lesson: Readonly<Record<LessonId, readonly WrapStep[]>>;
  readonly unit: readonly WrapStep[];
} = {
  lesson: {
    L1: [SETTLE, { id: 'awards', label: '결산·시상', eventId: 'L4-E7', hideFlatMetrics: true }, { id: 'reflect', label: '되돌아보기', eventId: 'L4-E9', questions: 2 }, AFTER_WS],
    L2: [SETTLE, { id: 'awards', label: '결산·시상', eventId: 'L4-E7', hideFlatMetrics: true }, { id: 'reflect', label: '되돌아보기', eventId: 'L4-E9', questions: 2 }, AFTER_WS],
    L3: [SETTLE, { id: 'awards', label: '결산·시상', eventId: 'L4-E7', hideFlatMetrics: true }, { id: 'reflect', label: '되돌아보기', eventId: 'L4-E9', questions: 2 }, AFTER_WS],
    L4: [SETTLE, CONTAINERS, { id: 'awards', label: '결산·시상', eventId: 'L4-E7', hideFlatMetrics: true }, { id: 'reflect', label: '되돌아보기', eventId: 'L4-E9', questions: 3 }, MAGAZINE, AFTER_WS],
  },
  unit: [SETTLE, CONTAINERS, { id: 'awards', label: '결산·시상', eventId: 'L4-E7', hideFlatMetrics: false }, { id: 'reflect', label: '되돌아보기', eventId: 'L4-E9', questions: 3 }, MAGAZINE, AFTER_WS],
};

/** 마무리 단계 예상 시간(분, PRD 4.2.1: 5~15분) */
export const wrapupMinutesRange = [5, 15] as const;

// ─── 준비·마무리 사건 큐 ───────────────────────────────────

/** 준비 단계(무역 시계 밖): 입장 → 회사 설립 → 항해 규칙 카드(30초) → (L1 포함 시) 튜토리얼 안내 */
export const prepQueue: readonly string[] = ['L1-E0', 'L1-E3'];
/** 항해 규칙 카드 표시 시간(초) */
export const RULES_CARD_SEC = 30;
/** 마무리 사건 큐(단원 한 판 순서, PRD 4.2.1). 학습지 ⑯⑰⑱ 포함 */
export const wrapQueue: readonly string[] = ['L4-E6', 'W16', 'L4-E7', 'L4-E9', 'W18', 'L4-E8', 'W17'];

// ─── 시간 나누기(PRD 4.3.1) ────────────────────────────────

/** 무역 시간 T(분) 버튼과 직접 입력 범위 */
export const tradeMinutes = {
  buttons: [10, 15, 20, 25, 30, 40] as const,
  customMin: 5,
  customMax: 90,
  default: 25,
} as const;

/** 활동 비중 α: 무역 중심 0.5 / 균형 0.6(기본) / 학습 중심 0.7. 넘치면 구간만 0.1씩 최대 0.8까지 */
export const activityRatio = {
  options: [
    { value: 0.5, label: '무역 중심' },
    { value: 0.6, label: '균형' },
    { value: 0.7, label: '학습 중심' },
  ] as const,
  default: 0.6,
  autoRaiseStep: 0.1,
  autoRaiseMax: 0.8,
} as const;

/** 구간 길이 T_s = T ÷ n 이 이 값(분) 미만이면 그 조합을 막는다 */
export const MIN_STAGE_MINUTES = 3.5;
export const MIN_STAGE_MESSAGE = '범위를 줄이거나 시간을 늘려 주세요';

/** 라운드 길이 규칙(v0.3.3): T_s ≥ 15분이면 180초, 그 밖 120초. 1.5분(90초) 미만이 되면 라운드 수를 줄임. 교사는 2~5분으로 바꿀 수 있음 */
export const roundLength = {
  longStageMinMinutes: 15,
  longSec: 180,
  shortSec: 120,
  minSec: 90,
  teacherMinMinutes: 2,
  teacherMaxMinutes: 5,
} as const;

/** 구간별 최소 라운드 수(L1은 2 권장 — 모자라면 천연가스 임무·흑연 결정이 같은 라운드에 나옴) */
export const minRoundsByStage: Readonly<Record<LessonId, { min: number; recommended: number }>> = {
  L1: { min: 1, recommended: 2 },
  L2: { min: 1, recommended: 1 },
  L3: { min: 1, recommended: 1 },
  L4: { min: 1, recommended: 1 },
};

/** 구간 표지 카드 시간(초) */
export const STAGE_COVER_SEC = 20;

// ─── 학습지 배치(PRD 4.3.3) ────────────────────────────────

export type WorksheetMode = 'auto' | 'each' | 'stageEnd' | 'after' | 'off';

export const worksheetModes: readonly { id: WorksheetMode; label: string }[] = [
  { id: 'auto', label: '자동' },
  { id: 'each', label: '중간마다' },
  { id: 'stageEnd', label: '구간 끝' },
  { id: 'after', label: '끝나고' },
  { id: 'off', label: '끄기' },
];

/** '구간 끝 모아 쓰기' 묶음 팝업 고정 시간(구간당 초) */
export const WORKSHEET_BUNDLE_SEC = 180;
/** [다 썼어요] 대기 시간(초) 선택지 */
export const worksheetWaitSecOptions = [0, 15, 30] as const;
export const WORKSHEET_WAIT_SEC_DEFAULT = 15;

// ─── 편지·돌발 사건·역전 장치 개수(PRD 4.3.5) ───────────────

/** 편지 수 = floor(T ÷ 4), 2~10통, 그리고 (판 전체 라운드 수 − 1) 이하. 첫 라운드 제외, 라운드당 최대 1통 */
export const letterCountRule = {
  divisor: 4,
  min: 2,
  max: 10,
  maxRoundsMinus: 1,
  skipFirstRound: true,
  perRoundMax: 1,
  /** 차단형 1등급 활동이 같은 라운드 시작에 있으면 다음 라운드로 미룸 */
  deferOnTier1Blocking: true,
} as const;

/** 돌발 사건 수(작업 125가 사용): 없음 0, 가끔 floor(T÷10)(T ≥ 15면 최소 1), 자주 floor(T÷5). 판 전체 라운드 수 − 2 이하 */
export const incidentCountRule = {
  off: { divisor: null, min: 0 },
  some: { divisor: 10, minIfTAtLeast: { t: 15, min: 1 } },
  often: { divisor: 5, minIfTAtLeast: null },
  default: 'some' as const,
  maxRoundsMinus: 2,
  /** 판의 첫 2라운드에는 예보하지 않음 */
  noForecastFirstRounds: 2,
  /** 마지막 1라운드에는 새 사건이 발생하지 않음 */
  noNewInLastRounds: 1,
  maxConcurrent: 1,
} as const;

/** 역전 장치 막판 대형 주문(PRD 4.3.5, 6.16.2 ④): T ≥ 15이면 무역 시간 75~85% 지점 라운드에 1개 */
export const bigOrderRule = {
  minTradeMinutes: 15,
  window: [0.75, 0.85] as const,
} as const;

// ─── 채우는 순서(PRD 4.3.4, v0.3.3 → v0.3.4 교사 확정) ─────────

/** 사다리 단계 */
export type FillStepId = 'tier2Short' | 'wsDuring' | 'tier1Full' | 'coreFull' | 'wsStageEnd' | 'tier2Full' | 'wsEach' | 'tier3Full';

/**
 * 채우는 순서(사다리, PRD 4.3.4 ①~⑧). 최소 상태에서 시작해 이 순서대로 한 항목씩 넣어 보고, 예산을 넘으면 그 항목만 되돌리고 넘어간다.
 * v0.3.4: 짧은 판 = 체험 우선 확정(결정 26), ② '지금 쓰기'(wsDuring) 추가. 순서는 이 배열 하나로만 정한다.
 */
export const fillOrder: readonly FillStepId[] = ['tier2Short', 'wsDuring', 'tier1Full', 'coreFull', 'wsStageEnd', 'tier2Full', 'wsEach', 'tier3Full'];

export const fillSteps: Readonly<Record<FillStepId, string>> = {
  tier2Short: '2등급: 빠짐 → 짧은 형태(우선 숫자가 작은 것부터)',
  wsDuring: '지금 쓰기: 원천 체험이 들어간 진행 중 필수 번호(③·⑭)의 ★ 칸을 체험 직후에 40초(번호 순, 라운드 보호 없음)',
  tier1Full: '1등급: 짧은 형태 → 전체(늘어나는 시간이 작은 것부터)',
  coreFull: '핵심 체험(두 섬 이야기·벽란도 시장·학급 스마트폰 프로젝트): 짧은 형태 → 전체(우선 숫자가 작은 것부터)',
  wsStageEnd: '학습지: 끝나고 → 구간 끝 모아 쓰기(자동일 때)',
  tier2Full: '나머지 2등급: 짧은 형태 → 전체(우선 숫자가 작은 것부터)',
  wsEach: '학습지: 구간 끝 → 중간마다(자동일 때)',
  tier3Full: '3등급: 빠짐 → 전체',
};

/** 핵심 체험(PRD 4.3.4 v0.3.4 교사 확정): 두 섬 이야기, 벽란도 시장, 학급 스마트폰 프로젝트(L3-E2·E5 묶음의 대표 ID) */
export const coreExperienceIds: readonly string[] = ['L1-E5', 'L1-E1', 'L3-E2'];

/**
 * '지금 쓰기'(PRD 4.3.3.1 규칙 2)의 원천 체험 — 이 사건이 이번 판에 들어갔을 때만 그 번호의 ★ 칸을 넣는다.
 * 진행 중 필수 번호 목록 자체는 `worksheet.ts`의 `during` 필드가 있는 번호다(시간도 그 필드의 sec).
 */
export const duringSourceEvent: Readonly<Partial<Record<WorksheetId, string>>> = { W03: 'L1-E5', W14: 'L4-E2' };

/** 지금 쓰기 팝업에서 결정 패널과 근로 환경 보도가 같은 라운드일 때 덧붙이는 문장(docs/worksheet.md 2.2) */
export const DURING_AFTER_NEWS_TEXT = '보도를 보기 전의 생각을 떠올려 써요.';

export type ReductionStepId =
  | 'dropTier3'
  | 'worksheetEachToStageEnd'
  | 'shortTier2'
  | 'worksheetStageEndToAfter'
  | 'shortCore'
  | 'shortTier1'
  | 'deferDuring'
  | 'dropTier2';

/** 교사 설명용 "줄이는 순서로 읽으면"(사다리의 거꾸로, PRD 4.3.4). α 올리기는 activityRatio.autoRaiseMax */
export const reductionOrder: readonly { step: number; id: ReductionStepId; desc: string }[] = [
  { step: 1, id: 'dropTier3', desc: '3등급 활동(확인 퀴즈, 경쟁 카드)을 뺀다' },
  { step: 2, id: 'worksheetEachToStageEnd', desc: "학습지를 '중간마다' → '구간 끝 모아 쓰기'로 바꾼다" },
  { step: 3, id: 'shortTier2', desc: '2등급 활동(핵심 체험 아님)을 짧은 형태로 바꾼다' },
  { step: 4, id: 'worksheetStageEndToAfter', desc: "학습지를 '구간 끝' → '끝나고 쓰기'로 옮긴다(번호는 빠지지 않음)" },
  { step: 5, id: 'shortCore', desc: '핵심 체험(두 섬 이야기, 벽란도 시장, 학급 스마트폰 프로젝트)을 짧은 형태로 바꾼다' },
  { step: 6, id: 'shortTier1', desc: '1등급 활동을 짧은 형태로 바꾼다(빼지는 않는다)' },
  { step: 7, id: 'deferDuring', desc: '지금 쓰기를 끝나고로 돌린다(시간이 아주 짧을 때만)' },
  { step: 8, id: 'dropTier2', desc: '2등급 활동을 뺀다(우선 숫자가 큰 것부터)' },
];

// ─── 구간별 시작 조건(PRD 4.2.3) ───────────────────────────

const L1_PORTS: readonly PortId[] = ['BUS', 'SHA', 'YOK', 'HCM', 'BKK', 'PHE'];
const ALL_PORTS: readonly PortId[] = [...L1_PORTS, 'JKT', 'DAM', 'SIN', 'MUM', 'ROT', 'LAX'];

/** 판마다 새 회사로 시작한다(차시 한 판·단원 한 판 공통). 범위의 첫 구간 줄로 시작 */
export const stageStart: readonly StageStart[] = [
  { lesson: 'L1', money: 500, ports: L1_PORTS, features: ['market'], summaryCardIds: [], tutorial: true, remark: '500만 원 + 벽란도·두 섬 보상' },
  { lesson: 'L2', money: 800, ports: ALL_PORTS, features: ['market', 'factory'], summaryCardIds: ['SUM-L1'], tutorial: false, startCargo: [{ good: 'crude', qty: 2, unitCost: 42, boughtAt: 'DAM' }], remark: '첫 화면에 L1 요약 카드(무역·수입·수출, 무역하는 까닭). (작업 115 수정 1회차) 담맘에서 사 온 원유 2상자를 싣고 시작 — 라운드 3개 안에 수입 → 생산 → 수출' },
  { lesson: 'L3', money: 1000, ports: ALL_PORTS, features: ['market', 'factory', 'shipyard'], summaryCardIds: ['SUM-L1', 'SUM-L2'], tutorial: false, remark: 'L1~L2 요약 카드' },
  { lesson: 'L4', money: 1200, ports: ALL_PORTS, features: ['market', 'factory', 'shipyard'], summaryCardIds: ['SUM-L1', 'SUM-L2', 'SUM-L3'], tutorial: false, remark: 'L1~L3 요약 카드' },
];

export const stageStartByLesson: Readonly<Record<LessonId, StageStart>> = Object.fromEntries(
  stageStart.map((s) => [s.lesson, s]),
) as Record<LessonId, StageStart>;

/**
 * (작업 134 → 115, 교사 결정 2026-10-19) 차시별 준비 표시. 판 설정에서 true 인 차시만 고를 수 있다.
 * 단원 전체 한 판은 모든 차시가 true 일 때만 열린다(`FULL_UNIT_READY`). 3·4차시(작업 116~118)가 끝나면 true 로 바꾼다.
 */
export const LESSON_READY: Readonly<Record<LessonId, boolean>> = { L1: true, L2: true, L3: false, L4: false };
/** 단원 전체 한 판을 고를 수 있는가(모든 차시가 준비됨) */
export const FULL_UNIT_READY: boolean = (Object.values(LESSON_READY) as boolean[]).every(Boolean);
/** 단원 한 판이 열리기 전에 고를 수 있는 차시(LESSON_READY 에서) */
export const READY_LESSONS_BEFORE_FULL: readonly LessonId[] = (['L1', 'L2', 'L3', 'L4'] as const).filter((l) => LESSON_READY[l]);
