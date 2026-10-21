/**
 * 상태 모델 (PRD 10.3 v0.3.1) — 작업 103.
 *
 * 원칙
 * - 모든 상태는 JSON 직렬화 가능하다(Map·Set·Date·undefined 값 금지. 없는 값은 null).
 * - 교사 브라우저(호스트)가 `HostSnapshot` 하나로 학급 상태와 모든 학생 회사 상태를 가진다(PRD 7.4).
 * - 공개 상태(`PublicState`)에는 출석번호(`seat`)를 넣지 않는다. 회사는 공개 ID `pid`로만 가리킨다(PRD 7.3.1).
 * - 저장·전송 뒤 읽을 때는 `normalizeSnapshot()` 등으로 기본값을 채운다(옛 필드 무시, 버전 `v: 3` 확인).
 */
import type { MetricId } from '../data/awards';
import type {
  Difficulty,
  GoodId,
  LessonId,
  LetterRewardId,
  MarketTag,
  PortId,
  ShipId,
  StageFeature,
  WorksheetId,
  WrapStepId,
} from '../data/types';

// ─── JSON ─────────────────────────────────────────────────

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

// ─── 판 정보 ──────────────────────────────────────────────

/** 판 단위(PRD 4.1.1): 차시마다 한 판 / 단원 전체 한 판 / (고급) 연속 구간 직접 고르기 */
export type PlayUnit = 'lesson' | 'unit' | 'custom';

export interface SessionMeta {
  v: 3;
  /** 방 코드 6자리 */
  code: string;
  className: string;
  createdAt: number;
  playUnit: PlayUnit;
  /** 학습 범위(연속 구간, 순서대로) */
  scope: LessonId[];
  seed: number;
  /** 입장 마감 */
  locked: boolean;
}

// ─── 학급 상태 ────────────────────────────────────────────

export type Phase = 'prep' | 'event' | 'round' | 'between' | 'worksheet' | 'wrapup' | 'ended';

/** 무역 시계(서버 시각 ms). 계산은 작업 123(`src/core/clock.ts`) */
export interface ClockState {
  durationSec: number;
  startedAt: number | null;
  endsAt: number | null;
  pausedAt: number | null;
  pausedTotalSec: number;
}

export type ScheduleItemKind =
  | 'event' | 'round' | 'worksheet' | 'letter' | 'forecast' | 'incident' | 'comeback' | 'stageCover';

/** 배치표 항목(PRD 10.3). 배치 계산은 작업 123(`src/core/schedule.ts`) */
export interface ScheduleItem {
  id: string;
  kind: ScheduleItemKind;
  /** 사건 ID·학습지 ID·편지 슬롯 ID('S1')·라운드 번호 문자열 등 */
  refId: string;
  stage: LessonId;
  /** 무역 시작 기준 초 */
  at: number;
  durSec: number;
  form: 'full' | 'short' | 'dropped';
  status: 'pending' | 'live' | 'done' | 'skipped';
  /** 판 전체 라운드 번호(편지·라운드 항목처럼 라운드에 붙는 항목). 편지 배달에 쓴다 */
  round?: number;
  /** 묶음 학습지 등 여러 ID */
  refIds?: string[];
  // ── 작업 123 추가(선택 필드) ──
  /** 표지 종류: 구간 표지 / 차시 표지(차시 한 판) / 앞 차시 요약 카드(refIds = 요약 카드 ID) */
  variant?: 'stage' | 'lesson' | 'summary';
  /** 단원 한 판 L2 표지에 "지금까지 상위 N개 회사"를 보인다(이전 판 결과는 쓰지 않음) */
  topCompanies?: boolean;
  /** 교사가 [넣기/짧게/빼기]로 정한 형태(줄이기·되살리기가 바꾸지 않음) */
  pinned?: boolean;
  /** 학습지 항목의 배치 방식. 'during' = 진행 중 필수 ★ 칸 '지금 쓰기'(v0.3.4, PRD 4.3.3.1 — 작업 132) */
  placement?: WorksheetPlacement | 'during';
  /** (작업 132) 지금 쓰기 항목: 결정 패널과 근로 환경 보도가 같은 라운드 — 팝업 문구 뒤에 "보도를 보기 전의 생각을 떠올려 써요." */
  afterNews?: boolean;
  /** 지금 형태가 차단형인가(사건 항목) */
  blocking?: boolean;
  /** 활동 등급(사건 항목) */
  tier?: 1 | 2 | 3;
}

/** 배치표 항목 형태 */
export type ItemForm = ScheduleItem['form'];

/** 마무리 단계 항목(PRD 4.1.1, 4.2.1 — 작업 123이 `wrapupByUnit`에서 고름) */
export interface WrapItem {
  id: WrapStepId;
  label: string;
  eventId?: string;
  /** 예상 시간(분). 학습지 시간 포함 */
  minutes: number;
  optional?: boolean;
  /** 그 판에서 값이 모두 같은 지표의 상 숨김(차시 한 판) — `awards()`에 넘긴다 */
  hideFlatMetrics?: boolean;
  /** 되돌아보기 문항 수(축약 2 / 전체 3) */
  questions?: number;
  /** 이 단계에서 쓰는 학습지 번호(끝나고 쓰기 안내·⑯⑰⑱) */
  worksheetIds: WorksheetId[];
}

export interface ScheduleState {
  items: ScheduleItem[];
  version: number;
  mode: 'auto' | 'manual';
  // ── 작업 123 추가(선택 필드 — 없으면 설정에서 다시 계산) ──
  /** 무역 시작 전에 교사가 정한 활동 형태(사건 ID → 형태) */
  overrides?: Record<string, ItemForm>;
  /** 마무리 항목 목록 */
  wrapup?: WrapItem[];
  /** 배치 경고(교사 화면) */
  warnings?: string[];
  /** 구간별 실제 학습지 방식 */
  stageModes?: Partial<Record<LessonId, WorksheetPlacement>>;
  /** 10초 안에 발동할 항목 ID(교사 화면 예고) */
  upcoming?: string[];
  /** 수동 진행에서 [발동]을 기다리는 항목 ID */
  waiting?: string | null;
  /** 차단형 활동 중 무역 시간이 끝남(서버 시각 ms). 활동이 끝나거나 2분 뒤 결산 */
  timeUp?: { at: number } | null;
  /** 도약 기준 자산을 기록했는가 */
  baseRecorded?: boolean;
  /** 라운드 길이를 자동 규칙으로 정하는가(false = 교사가 바꿈) */
  roundSecAuto?: boolean;
}

export interface CurrentEvent {
  id: string;
  openedAt: number;
  closesAt: number | null;
  closed: boolean;
  /** 짧은 형태로 발동했는가(PRD 4.3.2) */
  short: boolean;
  /** (작업 111) 교사가 [결과 공개]를 눌렀거나 결과 공개와 함께 마감함 — 공용 화면 선택 분포·정답률 막대 */
  revealed?: boolean;
  /** (작업 111) 결과가 있는 사건(확인 퀴즈·결정·투표)을 마감한 뒤 결과를 보여 주는 끝 시각(서버 시각 ms). 이때까지 공용 화면·학생 화면에 결과 */
  resultUntil?: number;
}

/** 학습지 배치 방식(교사 설정 'auto'는 스케줄러가 구간마다 정한 실제 방식으로 바꿔 둔다) */
export type WorksheetPlacement = 'each' | 'stageEnd' | 'after' | 'off';

export interface WorksheetState {
  /** 지금 떠 있는 팝업(번호 하나 또는 묶음) */
  current: WorksheetId[] | null;
  mode: WorksheetPlacement;
  openedAt: number | null;
  /** 라운드 중에 예약된 팝업(라운드가 끝나면 차례로 뜸, PRD 7.7) */
  pending: WorksheetId[][];
  /** (작업 112 수정 1회차) 팝업을 띄우기 전 단계 — 닫으면 이 단계로 돌아간다(무역 시작 전 'prep' 등). 없으면 라운드 사이 */
  returnPhase?: Phase;
  /** (작업 132, PRD 4.3.3.1) 지금 떠 있는 팝업이 '지금 쓰기'(★ 칸만) — 번호 완료와 따로 센다 */
  during?: boolean;
  /** (작업 132) 지금 쓰기 팝업 문구 뒤에 "보도를 보기 전의 생각을 떠올려 써요."를 붙인다 */
  afterNews?: boolean;
}

/** 편지 슬롯 하나(배치표의 letter 항목 + 순환 패턴) */
export interface LetterSlotInfo {
  /** 'S1', 'S2', … */
  slotId: string;
  /** 0부터 */
  index: number;
  /** 그 라운드가 속한 구간(문제 은행) */
  stage: LessonId;
  /** 도착 라운드(판 전체 번호) */
  round: number;
  reward: LetterRewardId;
  difficulty: Difficulty;
}

export interface LettersState {
  enabled: boolean;
  /** 이미 도착한 슬롯 ID(도착 순) */
  delivered: string[];
  /** 교사가 건너뛴 슬롯 */
  skipped: string[];
  /** 테스트·시뮬레이션용: 배치표 대신 쓰는 슬롯 목록(null 이면 배치표의 letter 항목) */
  slots: LetterSlotInfo[] | null;
}

/** 돌발 사건 자리(작업 125가 채움) */
export interface IncidentsState {
  active: Json[];
  forecasts: Json[];
}

/**
 * 사건·투표·돌발 사건이 만든 학급 공통 효과.
 * - priceTag: 그 항구·상품의 시장 꼬리표를 바꿈(L1 천연가스 H 등)
 * - priceMul: 가격 배수
 * - tariff: 관세율 덮어쓰기(L4-E1 투표 결과 등). 그 나라에서 만들지 않은 상품을 팔 때만
 * - limitMul: 입항 한도 배수(L3-E4 자동화 항만 +50%)
 * - portClosed: 목적지로 고를 수 없음(작업 125)
 * - voyageCostMul: 운항비 배수(작업 125)
 */
export type EffectSpec =
  | { type: 'priceTag'; port: PortId; good: GoodId; tag: MarketTag }
  | { type: 'priceMul'; port: PortId | null; good: GoodId | null; side: 'buy' | 'sell' | 'both'; mul: number }
  | { type: 'tariff'; port: PortId; good: GoodId | null; rate: number }
  | { type: 'limitMul'; port: PortId; mul: number }
  | { type: 'portClosed'; port: PortId }
  | { type: 'voyageCostMul'; port: PortId | null; mul: number };

export interface ActiveEffect {
  id: string;
  /** 만든 사건 ID 등 */
  source: string;
  effect: EffectSpec;
  /** stage: 그 구간이 끝나면 사라짐 / round: 그 라운드까지(포함) 유효. null 이면 판 끝까지 */
  until: { stage: LessonId | null; round: number | null } | null;
}

export type IncidentFreq = 'off' | 'some' | 'often';
export type TopN = 0 | 3 | 4 | 5;

export interface ClassSettings {
  playUnit: PlayUnit;
  scope: LessonId[];
  /** 무역 시간 T(분) */
  tradeMinutes: number;
  /** 활동 비중 α */
  activityRatio: number;
  /** 라운드 길이(초) */
  roundSec: number;
  incidentFreq: IncidentFreq;
  incidentKindsOff: string[];
  /** 역전 장치 */
  comeback: boolean;
  worksheetMode: 'auto' | WorksheetPlacement;
  leaderboardTopN: TopN;
  /** '최종 자산' 탭 공개 */
  assetBoard: boolean;
  awardsPerPrize: 1 | 2 | 3;
  /** (P1) 회사 이름 확인 후 공개 */
  nameReview: boolean;
  /** (P1) 교사 추가 금칙어(공개 상태에 싣지 않음) */
  extraBannedWords: string[];
  worksheetWaitSec: 0 | 15 | 30;
  showForecastOnScreen: boolean;
  /** 진행 방식: 자동 / 수동 */
  progressMode: 'auto' | 'manual';
  /** 교사가 끈 상(지표 ID) */
  awardsOff: MetricId[];
  /**
   * (v0.3.8, 작업 151, PRD 4.3.7.1) 항해 방식. 'round' = 라운드마다(출항 준비 → 라운드 끝에 출발),
   * 'free' = 자유롭게(라운드 중 [여기로 출발]로 바로 이동, 운항비는 라운드 끝에 한꺼번에). 규칙 엔진 기본 'round'
   */
  voyageMode: VoyageMode;
}

/** 항해 방식(PRD 4.3.7.1) */
export type VoyageMode = 'round' | 'free';

/** 학급 투표·학급 결정 결과(사건 ID별) */
export interface ClassVote {
  revealed: boolean;
  /** 마감 뒤 확정된 결과(선택지 ID) */
  result: string | null;
}

export interface ClassState {
  stage: LessonId;
  /** 판 전체 라운드 번호(시작한 마지막 라운드). 0 = 아직 라운드 없음 */
  round: number;
  phase: Phase;
  clock: ClockState;
  roundEndsAt: number | null;
  /** 일시정지 중 남은 라운드 시간(ms) */
  roundRemainingMs: number | null;
  paused: boolean;
  seed: number;
  schedule: ScheduleState;
  currentEvent: CurrentEvent | null;
  worksheet: WorksheetState;
  letters: LettersState;
  incidents: IncidentsState;
  activeEffects: ActiveEffect[];
  settings: ClassSettings;
  /** v0.3.1 이 판에서 교사가 막은 이름의 비교 키(공개 상태에 싣지 않음) */
  bannedNameKeys: string[];
  // ── 구간 진행 ──
  /** 열린 항구 */
  openPorts: PortId[];
  /** 열린 기능 */
  features: StageFeature[];
  /** 지금 구간의 첫 라운드 번호(구간 안 n번째 라운드 계산용). 아직 없으면 null */
  stageFirstRound: number | null;
  /** 발동한 사건 ID(발동 순, 중복 없음) — 따라잡기·도감 판정 */
  firedEvents: string[];
  /** 짧은 형태로 발동한 사건 */
  shortEvents: string[];
  /** 학급 투표 결과 */
  votes: Record<string, ClassVote>;
  /** 무역 시간이 끝났는가(편지 모두 만료) */
  tradeEnded: boolean;
}

// ─── 학생 회사 상태 ───────────────────────────────────────

export type NameStatus = 'ok' | 'blocked' | 'review' | 'checkRealName';

export interface Company {
  /** 회사 이름 = 학생 표시 이름(PRD 6.1.1) */
  name: string;
  /** 비교 키(공백 제거 + 영문 소문자 + NFC) */
  nameKey: string;
  nameStatus: NameStatus;
  color: string;
  emblem: string;
  avatar: string;
  /** 회사 설립(깃발·문양·아바타 고르기)을 마쳤는가 */
  founded: boolean;
}

/** 'korea' = 우리나라에서 만든 상품(부산 특산·국내산 흑연·공장 생산), 'foreign' = 해외에서 산 상품 */
export type Origin = 'korea' | 'foreign';
export type LotSource = 'specialty' | 'relay' | 'domestic' | 'factory';

/** 화물(물자) 또는 계약(서비스) 한 묶음 */
export interface CargoLot {
  good: GoodId;
  qty: number;
  /** 상자당 산 값(공장 생산품은 재료 값 + 공장비) */
  unitCost: number;
  origin: Origin;
  source: LotSource;
  boughtAt: PortId;
}

/** 이번 입항에서 사고판 양(입항할 때마다 초기화 — 한도 계산) */
export interface PortVisit {
  /** 몇 번째 입항(0 = 시작 항구) */
  arrival: number;
  /** 제값에 판 양 */
  sold: Partial<Record<GoodId, number>>;
  bought: Partial<Record<GoodId, number>>;
}

/** 이번 라운드 서비스 계약 수(종류별 5계약) */
export interface RoundContracts {
  round: number;
  buy: Partial<Record<GoodId, number>>;
  sell: Partial<Record<GoodId, number>>;
}

export interface MissionProgress {
  status: 'active' | 'done';
  steps: boolean[];
}

export interface PlayerEffects {
  /** 신속 통관: 이 구간 동안 제값 한도 +10 */
  fastCustomsStage: LessonId | null;
  /** 순풍: 남은 무료 출항 횟수 */
  tailwind: number;
  /** L4-E3 평판 하락: 인기(H) 판매가가 보통(N)으로 */
  reputationDown: boolean;
  /** L3-E3 기술 경쟁에서 밀림: 이 라운드까지 반도체 판매가 −10% */
  chipPenaltyUntilRound: number | null;
}

export interface Metrics {
  /** [수출] 도장 판매액 합계 */
  exports: number;
  imports: number;
  /** [중계] 판매액 */
  resale: number;
  /** [국내 판매] 판매액 */
  domestic: number;
  /** 낸 관세 */
  tariffs: number;
  /** 편지·확인 퀴즈 정답 수(무역 박사) */
  quizRight: number;
  /** 사회적 책임(기본 50) */
  csr: number;
  coop: number;
  /** 방문 항구(개척) */
  visited: PortId[];
  /** 도감 카드 ID(상품 'good:x', 항구 'port:X', 개념 카드 ID) */
  dex: string[];
  /** 도약 기준 자산(호스트가 기록, 작업 123이 시점 결정) */
  baseAsset: number | null;
}

export interface LogEntry {
  round: number;
  stage: LessonId;
  kind: 'buy' | 'sell' | 'produce' | 'voyage' | 'loan' | 'letter' | 'event';
  good?: GoodId;
  qty?: number;
  port?: PortId;
  to?: PortId;
  amount?: number;
  stamp?: StampKind;
  profit?: number;
  ref?: string;
}

export interface PlayerGame {
  money: number;
  /** 긴급 대출 합계(최종 자산에서 뺌) */
  loan: number;
  /** 이 판 시작 자금(도약 기준 하한) */
  startMoney: number;
  ship: ShipId;
  port: PortId;
  dest: PortId | null;
  ready: boolean;
  /** 이 라운드까지 항해를 처리했다(멱등) */
  resolvedRound: number;
  cargo: CargoLot[];
  /** 서비스 계약서(배 칸을 쓰지 않음) */
  contracts: CargoLot[];
  visit: PortVisit;
  roundContracts: RoundContracts;
  unlockedRecipes: GoodId[];
  missions: Record<string, MissionProgress>;
  /** 결정 기록(graphiteChoice 등) */
  decisions: Record<string, string>;
  letters: {
    /** 답한 문항 ID */
    answered: string[];
    slots: Record<string, 'right' | 'wrong'>;
    /** 편지가 도착한 순간 배정된 문항 ID(슬롯 ID → 문항 ID). 배정 뒤에는 회전을 다시 계산하지 않는다 */
    assigned: Record<string, string>;
  };
  /** 확인 퀴즈 답(문항 ID → 결과) */
  checkQuiz: Record<string, 'right' | 'wrong'>;
  effects: PlayerEffects;
  metrics: Metrics;
  worksheetDone: WorksheetId[];
  /** (작업 132) '지금 쓰기' ★ 칸을 다 쓴 번호(번호 완료 worksheetDone 과 따로). 옛 상태에는 없음 */
  duringDone?: WorksheetId[];
  /** 사건 응답(사건 ID → 응답) */
  responses: Record<string, Json>;
  /** 역전 장치 기회 카드(작업 127) */
  opportunityCards: Json[];
  /** 잡지 표지 입력 */
  cover: Json;
  /** 되돌아보기 입력 */
  reflect: Json;
  /** 첫 생산을 했는가(p.101 순환 그림 카드 1회) */
  producedOnce: boolean;
  log: LogEntry[];
  /** (작업 151) 자유 항해: 이번 라운드에 쌓인 낼 운항비(라운드 끝에 정산). 옛 상태에는 없음(= 0) */
  fareDue?: number;
  /** (작업 151) 자유 항해: 이번 라운드 항해 횟수. 옛 상태에는 없음(= 0) */
  sailsThisRound?: number;
}

export interface Player {
  /** 출석번호 — 호스트 내부 키, 교사 화면에만 */
  seat: number;
  /** 공개 ID(작업 124 세션이 발급) */
  pid: string;
  /** 호스트만 앎. 학생 개인 상태로 보낼 때 뺀다 */
  deviceToken: string;
  joinedAt: number;
  online: boolean;
  /** 상태가 바뀔 때마다 1씩 오름(ack.version) */
  rev: number;
  company: Company;
  game: PlayerGame;
}

export interface HostSnapshot {
  v: 3;
  meta: SessionMeta;
  class: ClassState;
  /** 좌석 키 's07' → Player */
  players: Record<string, Player>;
  hostToken: string;
  savedAt: number;
  /** 공개 상태 버전(바뀔 때마다 1씩) */
  rev: number;
}

// ─── 공개 상태(방 전체) ───────────────────────────────────

export interface Flag {
  color: string;
  emblem: string;
}

export interface LeaderEntry {
  pid: string;
  /** 회사 이름(막힘·확인 전이면 null → "이름 짓는 중") */
  company: string | null;
  flag: Flag;
  value: number;
  rank: number;
}

export interface AwardResult {
  metric: MetricId;
  award: string;
  winners: LeaderEntry[];
}

export interface PublicState {
  /** 들어온 회사 수 */
  joinedCount: number;
  onlineCount: number;
  readyCount: number;
  /** (작업 151) 자유 항해: 이번 라운드 학급 전체 항해 수(라운드마다 판·옛 상태에는 없음) */
  sailsThisRound?: number;
  /** 현재 사건 응답 수 */
  event: { id: string; responded: number; total: number } | null;
  /** 학습지 번호별 완료 수 */
  worksheetDone: Partial<Record<WorksheetId, number>>;
  /** (작업 132) '지금 쓰기' ★ 칸 완료 수(번호별). 옛 상태에는 없음 */
  duringDone?: Partial<Record<WorksheetId, number>>;
  companies: { pid: string; name: string | null; color: string; emblem: string }[];
  ships: { pid: string; port: PortId; color: string; emblem: string }[];
  /** 지표별 상위 N(N=0이면 빈 객체). 'soon' = 아직 공개 전(도약 탭) */
  leaderboard: Partial<Record<MetricId, LeaderEntry[] | 'soon'>>;
  /** 벽란도 맞힌 수 분포(인덱스 = 맞힌 수) */
  byeokrando: number[];
  /** 두 섬 성공 수. `avgStage3`(작업 113) = 성공한 회사들의 3단계 두 섬 합계(쌀·옷) 평균(성공이 없으면 null, 옛 상태에는 없음) */
  twoIslands: { success: number; total: number; avgStage3?: { rice: number; clothes: number } | null };
  /** 확인 퀴즈 문항별 정답률 */
  checkQuiz: Record<string, { right: number; total: number }>;
  /** (작업 111) 현재 결정 사건(선택지가 있는 개인 결정)의 선택 분포 — 이름 없이 수만. '응답 없음' 기본값은 세지 않는다 */
  decision?: { id: string; counts: Record<string, number> } | null;
  /** 학급 투표(현재 또는 마지막) */
  vote: { id: string; counts: Record<string, number>; revealed: boolean; result: string | null } | null;
  /** 완주 증서 인원(이름 없이) */
  certificates: number;
  /** 마무리 단계에서만 */
  awards: AwardResult[] | null;
  /**
   * (작업 115) L2-E6 세관 게시판: 학급 전체가 부산에 들여온([수입] 판매) / 다른 나라에 내보낸([수출] 판매) 상자 수(상품별, 이름 없이 합계만).
   * 판 범위에 2차시가 있을 때만(없거나 거래 전이면 null). 학습지 ⑤ 도우미도 이 값을 읽는다
   */
  customsBoard?: { imports: Partial<Record<GoodId, number>>; exports: Partial<Record<GoodId, number>> } | null;
}

/** 방 전체에 보내는 학급 상태(교사 전용 필드 제외) */
export type PublicClass = Omit<ClassState, 'bannedNameKeys' | 'settings'> & {
  settings: Omit<ClassSettings, 'extraBannedWords'>;
};

// ─── 학생 행동 ────────────────────────────────────────────

export type Answer = number | 'O' | 'X';

export type Action =
  | { type: 'buy'; good: GoodId; qty: number }
  | { type: 'sell'; good: GoodId; qty: number }
  | { type: 'setDestination'; port: PortId | null }
  | { type: 'setReady' }
  /** (작업 151) 자유 항해: 라운드 중 바로 그 항구로 출발·도착(운항비는 라운드 끝에 정산) */
  | { type: 'sailTo'; port: PortId }
  | { type: 'cancelReady' }
  | { type: 'produce'; recipe: GoodId; qty: number }
  /** 회사 설립: 깃발 색·문양·아바타(이름은 입장 때 정함) */
  | { type: 'foundCompany'; color: string; emblem: string; avatar: string }
  /** 준비 단계 또는 이름이 막힌 뒤에만 */
  | { type: 'setCompanyName'; name: string }
  | { type: 'answerLetter'; slotId: string; answer: Answer }
  | { type: 'answerCheckQuiz'; qid: string; answer: Answer }
  /** 결정·투표·미니게임 결과 */
  | { type: 'respondEvent'; eventId: string; response: Json }
  /** 지금 떠 있는 학습지(없으면 ids) [다 썼어요] */
  | { type: 'markWorksheetDone'; ids?: WorksheetId[]; /** (작업 132) '지금 쓰기' ★ 칸 완료 */ during?: boolean }
  | { type: 'requestLoan' };

export type ActionType = Action['type'];

// ─── 교사 행동 ────────────────────────────────────────────

export type TeacherAction =
  | { type: 'startStage'; stage: LessonId }
  | { type: 'fireEvent'; id: string; short?: boolean }
  /** 1등급이면 confirm 없이 보내면 needsConfirm */
  | { type: 'skipEvent'; id: string; confirm?: boolean }
  | { type: 'closeEvent'; reveal?: boolean }
  /** (작업 111) [결과 공개]: 지금 사건의 결과 막대(선택 분포·정답률)를 공용 화면에 보인다. 마감하지 않는다 */
  | { type: 'revealEvent' }
  /** (작업 111) 결과 보여 주기 [다음]: 마감한 사건의 결과 표시를 지금 끝낸다 */
  | { type: 'endResult' }
  /** (작업 111) [이 학생만 사건 다시 보내기]: 그 학생 기기의 따라잡기 큐에 사건을 넣는다 */
  | { type: 'resendEvent'; seat: number; id: string }
  /** (작업 112) [이 학생에게 학습지 다시 보내기]: 그 학생 기록에 '다시 받은 학습지'를 남긴다(학생 기기가 개인 팝업으로 띄움) */
  | { type: 'resendWorksheet'; seat: number; wId: WorksheetId }
  | { type: 'startRound'; durationSec?: number }
  | { type: 'endRound' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'openWorksheet'; ids: WorksheetId | WorksheetId[]; /** (작업 132) '지금 쓰기' 팝업(라운드 중·다른 팝업 중이면 예약하지 않고 거절) */ during?: boolean; afterNews?: boolean }
  /** all=true: 떠 있는 팝업과 라운드 끝 예약을 한꺼번에 닫는다('학습지 팝업 끄기', 작업 114) */
  | { type: 'closeWorksheet'; all?: boolean }
  | { type: 'toggleLetters'; enabled?: boolean }
  | { type: 'skipLetterSlot'; slotId: string }
  | { type: 'lockJoin' }
  | { type: 'unlockJoin' }
  | { type: 'kick'; seat: number }
  | { type: 'approveRejoin'; seat: number }
  | { type: 'updateSettings'; settings: Partial<ClassSettings> }
  | { type: 'renameCompany'; seat: number; name: string }
  | { type: 'blockCompanyName'; seat: number }
  | { type: 'approveCompanyName'; seat: number }
  | { type: 'reassignSeat'; from: number; to: number }
  /** 무역 시간 끝 → 마무리(남은 편지 만료). 시계에 따른 자동 종료는 작업 123 */
  | { type: 'endTrade' }
  | { type: 'endSession' }
  // 작업 123(무역 시계·배치표, `clock.ts` 훅이 처리 — 훅이 없으면 NOT_IMPLEMENTED/BAD_ACTION)
  | { type: 'startTrade' }
  | { type: 'extend'; sec: number }
  | { type: 'shorten'; sec: number }
  /** 라운드 길이(초, 120~300) — 남은 배치표 다시 계산 */
  | { type: 'setRoundSec'; sec: number }
  /** 활동 [넣기/짧게/빼기](1등급은 빼기 없음). id = 항목 ID 또는 사건 ID */
  | { type: 'setItemForm'; id: string; form: ItemForm }
  /** [1분 미루기] */
  | { type: 'postpone'; id: string; sec?: number }
  /** [건너뛰기](1등급은 confirm 없이 보내면 needsConfirm) */
  | { type: 'skipItem'; id: string; confirm?: boolean }
  /**
   * [지금] / 수동 진행의 [발동]. (작업 137) clear: 지금 떠 있는 표지·카드·학습지·결과 보여 주기를 먼저 끝내고 이 항목을 시작한다
   * (교사 '지금 할 일' 카드의 [다음으로] — 자동 진행에서도. 수동 진행은 원래 끝낸다)
   */
  | { type: 'fireNow'; id: string; clear?: boolean }
  | { type: 'setProgressMode'; mode: 'auto' | 'manual' }
  /**
   * (작업 134) [지금 라운드 시작]: 다음 라운드 앞의 아직 시작하지 않은 사전 활동을 건너뛰고(진행 중 활동은 닫고) 라운드를 지금 연다.
   * 뒤 항목은 당긴 만큼 다시 배치. 1등급 활동을 건너뛰게 되면 confirm 없이 보내면 needsConfirm('ROUND_NOW_TIER1')
   */
  | { type: 'startRoundNow'; confirm?: boolean }
  /** 무역 시간 끝 알림의 [지금 결산](언제든 무역을 끝냄) */
  | { type: 'finishNow' };

export type TeacherActionType = TeacherAction['type'];

// ─── 규칙 결과(화면·연출용) ───────────────────────────────

export type StampKind = 'export' | 'import' | 'relay' | 'domestic';

export type GameEvent =
  | { type: 'stamp'; kind: StampKind; good: GoodId; qty: number; amount: number }
  | { type: 'tariff'; rate: number; amount: number }
  | { type: 'profit'; amount: number }
  | { type: 'overLimit'; good: GoodId; qty: number }
  | { type: 'bought'; good: GoodId; qty: number; amount: number }
  | { type: 'produced'; good: GoodId; qty: number; fee: number }
  | { type: 'factoryCycleCard' }
  | { type: 'voyagePreview'; to: PortId; cost: number; free: boolean }
  | { type: 'departed'; from: PortId; to: PortId; cost: number; free: boolean; round: number }
  | { type: 'arrived'; port: PortId; round: number; first: boolean }
  | { type: 'stayed'; port: PortId; round: number; reason: 'noDestination' | 'notReady' | 'noMoney' | 'portClosed' }
  | { type: 'portCard'; port: PortId }
  | { type: 'loan'; amount: number }
  /** (작업 151) 자유 항해: 라운드 끝 운항비 정산 */
  | { type: 'fareSettled'; amount: number; round: number }
  | { type: 'money'; amount: number; reason: string }
  | { type: 'missionStep'; id: string; step: number }
  | { type: 'missionDone'; id: string }
  | { type: 'dexUnlocked'; id: string }
  | { type: 'letterResult'; slotId: string; right: boolean; reward: LetterRewardId | null }
  | { type: 'checkQuizResult'; qid: string; right: boolean }
  | { type: 'eventTriggered'; id: string }
  | { type: 'csr'; amount: number; reason: string }
  | { type: 'recipeUnlocked'; recipe: GoodId }
  | { type: 'nameChanged'; name: string; status: NameStatus }
  | { type: 'companyFounded' }
  | { type: 'worksheetDone'; ids: WorksheetId[]; during?: boolean };

export interface ActionResult {
  player: Player;
  events: GameEvent[];
  error?: string;
}

// ─── 호스트 입출력 ────────────────────────────────────────

/** 입장 알림(작업 124 세션이 입장 판정 뒤 넣음). 처음이면 새 회사, 이미 있으면 접속 표시 */
export interface JoinInput {
  type: 'join';
  seat: number;
  pid: string;
  /** 기기 토큰(세션 124가 따로 보관하면 생략 가능) */
  deviceToken?: string;
  companyName: string;
  nameKey: string;
  nameStatus?: NameStatus;
}

export type HostInput =
  | { type: 'act'; seat: number; seq: number; action: Action }
  | { type: 'teacher'; action: TeacherAction }
  | { type: 'tick' }
  | JoinInput
  | { type: 'leave'; seat: number }
  /** 접속 표시(세션 124 모양) */
  | { type: 'presence'; seat: number; online: boolean }
  /** 교사 화면이 꺼져 있던 시간(일시정지 처리 — 작업 123 훅) */
  | { type: 'hostGap'; gapMs: number };

export interface PublicPayload {
  class: PublicClass;
  public: PublicState;
  /** (작업 132) 교사가 [시작]한 마무리 단계 ID(교사 화면 진행 표시 — 학생 마무리 화면이 따른다). 옛 상태에는 없음 */
  wrapLive?: string | null;
}

/** 학생 개인 상태(기기 토큰 제외) */
export type PlayerView = Omit<Player, 'deviceToken'>;

export type HostOutput =
  /** 방 전체: 학급 공개 상태(바뀌었을 때만, 하나로 묶음) */
  | { to: 'all'; kind: 'public'; version: number; data: PublicPayload }
  /** 그 학생에게만: 개인 상태 */
  | { to: 'seat'; seat: number; kind: 'me'; version: number; data: PlayerView }
  /** 그 학생에게만: 행동 확인 */
  | { to: 'seat'; seat: number; kind: 'ack'; seq: number; ok: boolean; error?: string; version: number; events: GameEvent[] }
  /** 그 학생에게만: 라운드 처리 등 행동 밖에서 생긴 결과(연출용) */
  | { to: 'seat'; seat: number; kind: 'events'; events: GameEvent[] }
  /** 교사 화면: 확인 요청·오류 안내 */
  | { to: 'teacher'; kind: 'notice'; code: string; action?: TeacherAction; message?: string };

export interface ReduceResult {
  snapshot: HostSnapshot;
  outputs: HostOutput[];
}

// ─── 읽을 때 기본값 채우기(구현은 state.ts) ───────────────
export { normalizeClass, normalizePlayer, normalizeSnapshot } from './state';
