/**
 * 게임 데이터 타입 정의 (작업 102).
 *
 * 정확성 원칙(PRD 2장):
 * - 교과서 사실 문장을 가진 객체는 `pages`(교과서 쪽, 94~117)를 반드시 가진다.
 * - 교과서에 없는 값·규칙은 `gameRule: true`([게임 설정]) 로 표시한다.
 * - 지어낸 뉴스·상황은 `fake: true`([가상 뉴스]) 로 표시한다.
 * `npm run check:data`(scripts/check-data.ts)가 이 규칙을 검사한다.
 */

// ─── 공통 ID ──────────────────────────────────────────────

export type LessonId = 'L1' | 'L2' | 'L3' | 'L4';
export const LESSON_IDS: readonly LessonId[] = ['L1', 'L2', 'L3', 'L4'];

export type PortId =
  | 'BUS' | 'SHA' | 'YOK' | 'HCM' | 'BKK' | 'PHE'
  | 'JKT' | 'DAM' | 'SIN' | 'MUM' | 'ROT' | 'LAX';

export type GoodId =
  | 'crude' | 'gas' | 'iron' | 'nickel' | 'graphite' | 'chem' | 'rice' | 'wood' | 'clothes'
  | 'robot' | 'vaccine' | 'ott' | 'program' | 'chip' | 'car' | 'phone' | 'kcon'
  | 'oilp' | 'steel' | 'battery' | 'aichip';

/** 학습지 번호 ID W01~W20 */
export type WorksheetId =
  | 'W01' | 'W02' | 'W03' | 'W04' | 'W05' | 'W06' | 'W07' | 'W08' | 'W09' | 'W10'
  | 'W11' | 'W12' | 'W13' | 'W14' | 'W15' | 'W16' | 'W17' | 'W18' | 'W19' | 'W20';

/** 교과서 쪽 목록(94~117 정수) */
export type PageList = readonly number[];

/** 교과서 근거가 있는 짧은 문장 */
export interface Sourced {
  text: string;
  pages: PageList;
}

/** 교과서 인용(원문 또는 원문을 거의 그대로 옮긴 문장) */
export interface TextbookRef {
  pages: PageList;
  note: string;
}

// ─── 상품 ────────────────────────────────────────────────

export type GoodForm = 'goods' | 'service';

export interface Good {
  id: GoodId;
  name: string;
  category: string;
  /** 'goods' = 물자(상자, 배에 실음), 'service' = 서비스(계약서, 적재 0) */
  form: GoodForm;
  /** 기준값 V(만 원/상자) [게임 설정, 튜닝 대상] */
  V: number;
  /** 싸게 살 수 있는 곳(특산 S 또는 중계 R 이 아닌 '원산지' 기준). 공장 생산품은 빈 배열 */
  specialtyPorts: readonly PortId[];
  /** 부산 공장 생산만 가능한 상품 */
  factoryOnly: boolean;
  /** 근거 쪽 */
  pages: PageList;
  unlockLesson: LessonId;
  /** 도감·카드 설명(교과서 근거 문장) */
  desc: Sourced;
  /** 판매 항구·값 등 교과서에 없는 설정이 섞였는지 */
  gameRule: boolean;
  gameRuleNote?: string;
  /** 아이콘 경로(assets/images 기준) */
  image: string;
}

// ─── 항구 ────────────────────────────────────────────────

/** '이 나라가 싸게 파는 까닭' 아이콘 4종(p.99) */
export type CheapReason = 'nature' | 'resource' | 'capital' | 'tech';

export interface Port {
  id: PortId;
  name: string;
  country: string;
  lon: number;
  lat: number;
  /** SVG viewBox 0 0 2700 1350 좌표(PRD 6.3.1) */
  x: number;
  y: number;
  unlockLesson: LessonId;
  /** 항구 카드 소개(교과서 근거 문장만) */
  features: readonly Sourced[];
  cheapReasons: readonly CheapReason[];
  /**
   * cheapReasons 배정의 근거. 교과서가 그 나라를 그 까닭으로 직접 설명하면 쪽수,
   * 아니면 [게임 설정](화면에 '게임 규칙' 표시)
   */
  cheapReasonsBasis: { gameRule: false; pages: PageList; note: string } | { gameRule: true; note: string };
  /** 교과서가 '세계적인 무역항'으로 든 항구(p.104) */
  isWorldPort: boolean;
  /** 항구 장면 이미지(assets/images 기준) */
  sceneImage: string;
  /** 본사(부산) */
  isHome?: boolean;
  /** [게임 설정] 설명(있으면) */
  gameRuleNote?: string;
}

// ─── 시장 ────────────────────────────────────────────────

export type MarketTag = 'S' | 'R' | 'H' | 'N';

export interface MarketRow {
  port: PortId;
  /** 특산 — 싸게 삼(V×0.6), 팔 수 없음 */
  S: readonly GoodId[];
  /** 중계(싱가포르만) — V×0.75에 사고 V×1.0에 팜 */
  R: readonly GoodId[];
  /** 인기 — V×1.3에 팜 */
  H: readonly GoodId[];
  /** 보통 — V×1.0에 팜 */
  N: readonly GoodId[];
  /** 국내산 흑연(부산만) — V×1.1에 삼 */
  domesticBuy: readonly GoodId[];
  /** 특정 구간 동안만 인기(H)가 되는 상품(부산 천연가스 L1) */
  stageHot: readonly { good: GoodId; lesson: LessonId }[];
}

// ─── 항로 ────────────────────────────────────────────────

export interface Waypoint {
  id: string;
  name: string;
  lon: number;
  lat: number;
  /** 해협·운하 등 사건(canal 등)이 가리킬 수 있는 길목 */
  chokepoint?: boolean;
}

export interface RouteEdge {
  a: string;
  b: string;
  /** [게임 설정] 길이 가중치(기본 1). 큰 바다를 가로지르는 구간 보정 */
  weight?: number;
}

// ─── 레시피·배 ─────────────────────────────────────────────

export interface Recipe {
  id: GoodId;
  name: string;
  inputs: Partial<Record<GoodId, number>>;
  /** 공장비(만 원/상자) */
  fee: number;
  /** 결과 상품 V(goods.ts 값과 같아야 함) */
  outputV: number;
  unlockLesson: LessonId;
  /** 기술 경쟁 상위 학생만 등 추가 조건 */
  requires?: 'techRaceWinner';
  pages: PageList;
  gameRule: true;
}

export type ShipId = 'small' | 'medium' | 'large';

export interface Ship {
  id: ShipId;
  name: string;
  capacity: number;
  costMultiplier: number;
  /** 값(만 원). 0 = 시작 지급 */
  price: number;
  unlockLesson: LessonId;
  priority: 'P0' | 'P1';
  image: string;
  gameRule: true;
}

// ─── 사건 ────────────────────────────────────────────────

export type EventKind =
  | 'concept' | 'article' | 'news' | 'decision' | 'vote' | 'mission'
  | 'minigame' | 'screen' | 'worksheet' | 'checkQuiz';

/** 1|2|3 = 활동 등급(4.3.2), 'prep' = 준비 단계, 'wrap' = 마무리 단계 */
export type EventTier = 1 | 2 | 3 | 'prep' | 'wrap';

export type TriggerType = 'teacher' | 'lessonStart' | 'firstArrival' | 'firstTrade' | 'roundStart' | 'prep' | 'wrapup';

export interface EventTrigger {
  type: TriggerType;
  port?: PortId;
  round?: number;
}

/** 비차단 활동의 위치: 'round:n'(구간 n번째 라운드 시작) | 'stageEnd' | 'afterPrev' */
export type Anchor = `round:${number}` | 'stageEnd' | 'afterPrev';

export type EventEffect =
  | { type: 'priceTag'; port: PortId; good: GoodId; tag: MarketTag; until: 'lessonEnd' }
  | { type: 'money'; amount: number }
  | { type: 'moneyPerCorrect'; amount: number; max: number; shortAmount?: number }
  | { type: 'dexCard'; card: string }
  | { type: 'minigame'; ref: 'byeokrando' | 'twoIslands' | 'containers' }
  | { type: 'mission'; ref: string }
  | { type: 'decision'; ref: string }
  | { type: 'checkQuiz'; lesson: LessonId }
  | { type: 'tutorial' }
  | { type: 'companySetup' }
  | { type: 'unlock'; ports?: readonly PortId[]; goods?: readonly GoodId[]; features?: readonly StageFeature[] };

export type EventGoal =
  | { type: 'sell'; good: GoodId; port: PortId; qty: number }
  | { type: 'decide'; ref: string }
  | { type: 'complete'; ref: string };

export interface DecisionOption {
  id: string;
  label: string;
  /** 고른 뒤 보여 줄 말(있으면) */
  after?: string;
}

export interface GameEvent {
  id: string;
  lesson: LessonId;
  kind: EventKind;
  required: boolean;
  trigger: EventTrigger;
  /** 지어낸 뉴스·상황이면 true("가상 뉴스" 띠) */
  fake: boolean;
  /** 교과서에 없는 설정 사건(입장·회사 설립 등)이면 true */
  gameRule: boolean;
  title: string;
  /** 본문. L2~L4 골격은 'TODO' 허용(check:data 경고) */
  body: string;
  /** 단원 한 판(다음 구간이 있는 판)일 때만 본문 뒤에 붙이는 문구. 차시 한 판에서는 쓰지 않는다 */
  unitOnlyNote?: string;
  /** 교과서 인용 목록 */
  textbook: readonly TextbookRef[];
  /** 이 사건이 다루는 교과서 쪽 */
  pages: PageList;
  effects: readonly EventEffect[];
  goal: EventGoal | null;
  /** 학생 응답이 필요한가(대시보드 응답 수 표시) */
  needsResponse: boolean;
  /** 늦게 온 학생 처리 */
  catchUp: 'replay' | 'summary' | 'none';
  /** 이 사건 뒤 이어지는 학습지 팝업 */
  worksheetAfter: WorksheetId | readonly WorksheetId[] | null;
  /** 결정 사건의 선택지 */
  options?: readonly DecisionOption[];
  /** 교사 화면 발문 */
  teacherPrompts?: readonly string[];
  /** 학생에게 묻는 문항(되돌아보기 L4-E9 — PRD 6.14.4·학습지 ⑱). 축약판(L4 없는 판)은 앞에서부터 마무리 구성표의 questions 개만 */
  reflectQuestions?: readonly string[];
  /** 장면 이미지(assets/images 기준) */
  image?: string;
  // ── v0.3 배치 필드(PRD 4.3.2) ──
  tier: EventTier;
  /** 2등급 안 우선순위(작을수록 먼저 남김). 2등급만 */
  priority?: number;
  /** 차단형인가 */
  blocking: boolean;
  /** 예상 시간(분). short=null 이면 짧은 형태 없음 */
  minutes: { full: number; short: number | null };
  /** 짧은 형태 설명(없으면 null) */
  shortForm: { blocking: boolean; note: string } | null;
  /** 이 활동이 의미 있으려면 구간에 필요한 최소 라운드 수 */
  needsRounds: number;
  anchor: Anchor;
  /** 라운드가 모자랄 때의 위치(L1-E7: 라운드 1개면 첫 라운드 중간) */
  anchorFallback?: Anchor;
  /** 구간 표지 사건 */
  isCover?: boolean;
  /** 조건부 대상(L4-E3: 낮은 임금·미설치를 고른 학생에게만) */
  conditional?: boolean;
  /** 마무리 사건이 들어가는 조건 */
  wrapRule?: 'always' | 'ifL4' | 'optionalIfL4';
}

// ─── 임무 ────────────────────────────────────────────────

export interface Mission {
  id: string;
  eventId: string;
  lesson: LessonId;
  title: string;
  /** 학생 화면 진행 표시줄 문구 */
  steps: readonly string[];
  pages: PageList;
  fake: boolean;
  /** 구간이 바뀌어도 판 끝까지 이어서 할 수 있다(PRD 4.3.1) */
  persistsAcrossStages: true;
  reward: readonly EventEffect[];
}

// ─── 편지·퀴즈 ─────────────────────────────────────────────

export type Difficulty = 'easy' | 'normal';
export type LetterFormat = 'customs' | 'gullNews';
export type QuestionType = 'choice3' | 'ox';

export interface QuizQuestion {
  id: string;
  type: QuestionType;
  prompt: string;
  /** choice3 의 보기 3개 */
  choices?: readonly string[];
  /** choice3 = 정답 보기 번호(0부터), ox = 'O' | 'X' */
  answer: number | 'O' | 'X';
  /** 해설(교과서 문장 근거, 쪽수 포함) */
  explain: string;
  pages: PageList;
}

export interface LetterQuestion extends QuizQuestion {
  /** 구간 은행. 'common' = 구간을 가리지 않는 무역 기초 문항 */
  lesson: LessonId | 'common';
  common: boolean;
  format: LetterFormat;
  difficulty: Difficulty;
  /** 갈매기 바다 소식의 뉴스형 지문 */
  passage?: string;
  /** 지문이 지어낸 상황이면 true("가상 뉴스" 띠) */
  fake: boolean;
  /** 교과서 기사 인용이면 출처(신문·날짜) */
  source?: string;
  /** 보상이 dexCard 일 때 추가되는 개념 카드 */
  dexCard: string;
  /** 문항 주제(PRD 6.7.4 표) */
  topic: string;
}

export interface CheckQuizQuestion extends QuizQuestion {
  lesson: LessonId;
  /** true = 지정 2문항, false = 예비 */
  primary: boolean;
}

export type LetterRewardId = 'money' | 'fastCustoms' | 'tailwind' | 'dexCard';

// ─── 학습지 ───────────────────────────────────────────────

export type HelperKey =
  | 'byeokrandoResult' | 'twoIslandsResult' | 'graphiteChoice' | 'customsBoard'
  | 'importProduceExport' | 'exportTypes' | 'relayTrade' | 'mineralCoopChoice'
  | 'smartphonePart' | 'competitionRecord' | 'voteResult1970' | 'factoryDecision'
  | 'containerResult' | 'magazineDraft' | 'voyageSummary' | 'expoEntry';

/** 사건 ID | 'stageLastRound'(그 구간 마지막 라운드 끝) | 'optional:…'(선택 활동 뒤) */
export type WorksheetAnchor = string;

export interface WorksheetPrompt {
  id: WorksheetId;
  no: number;
  /** 원문자 ①~⑳ */
  label: string;
  lesson: LessonId | 'optional';
  afterEvent: WorksheetAnchor;
  /** 팝업 본문(docs/worksheet.md 2장 그대로) */
  prompt: string;
  pages: PageList;
  /** 팝업 아래 쪽 표시(docs/worksheet.md 2장 그대로, 예: '교과서 95~96쪽') */
  pagesLabel: string;
  helper: HelperKey | null;
  /** 칸별 예상 시간(분, docs/worksheet.md 3장) */
  minutes: number;
  phase: 'trade' | 'wrap';
  /** 연결된 사건이 빠지면 구간 끝 모아 쓰기로 옮김 */
  stageEndFallback: boolean;
  /**
   * (v0.3.4, PRD 4.3.3.1) 진행 중 필수 ★ 칸 — '지금 쓰기'. part = 학습지 칸 번호, prompt = 팝업 문구(docs/worksheet.md 2.2),
   * sec = 팝업 시간(초). 있는 번호(③·⑭)만 원천 체험 직후 이 칸만 쓴다.
   */
  during?: { part: string; prompt: string; sec: number };
}

// ─── 도감 ────────────────────────────────────────────────

export interface ConceptCard {
  id: string;
  title: string;
  text: string;
  pages: PageList;
  lesson: LessonId;
  /** 얻는 방법 */
  unlock: string;
}

export type ExportTypeId = 'export-agri' | 'export-resource' | 'export-tech' | 'export-culture';

export interface ExportTypeCard {
  id: ExportTypeId;
  title: string;
  text: string;
  /** 교과서 예(나라 — 상품) */
  examples: readonly string[];
  /** L2-E4 임무에서 이 유형으로 인정하는 상품 */
  goods: readonly GoodId[];
  pages: PageList;
}

export interface ClassroomItemCard {
  id: string;
  item: string;
  text: string;
  country: string;
  material: string;
  relatedGood?: GoodId;
  relatedPort?: PortId;
  pages: PageList;
}

export interface RuleCard {
  id: string;
  no: number;
  text: string;
  /** 이 장치가 꺼진 판에서는 숨김 */
  requires?: 'comeback' | 'incidents';
  gameRule: true;
}

export interface SummaryCard {
  id: string;
  lesson: LessonId;
  title: string;
  lines: readonly Sourced[];
}

// ─── 판 구성(schedule) ─────────────────────────────────────

export type StageFeature = 'market' | 'factory' | 'shipyard';

export interface StageStart {
  lesson: LessonId;
  /** 시작 자금(만 원) */
  money: number;
  ports: readonly PortId[];
  features: readonly StageFeature[];
  /** 첫 화면에 이어 나오는 앞 차시 요약 카드(dex.summaryCards ID) */
  summaryCardIds: readonly string[];
  tutorial: boolean;
  /** 비고(PRD 4.2.3 표) */
  remark: string;
}

export type WrapStepId = 'settle' | 'containers' | 'awards' | 'reflect' | 'magazine' | 'afterWorksheet';

export interface WrapStep {
  id: WrapStepId;
  label: string;
  /** 연결 사건(있으면) */
  eventId?: string;
  optional?: boolean;
  /** 그 판에서 값이 모두 같은 지표의 상 자동 숨김 */
  hideFlatMetrics?: boolean;
  /** 되돌아보기 문항 수(축약 2 / 전체 3) */
  questions?: number;
}
