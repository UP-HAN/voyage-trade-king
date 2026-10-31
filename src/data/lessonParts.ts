/**
 * (v0.3.9, 작업 154, PRD 4.1.1 '2차시 나눠 고르기'·4.4 L2·16.1 결정 38)
 * 차시 한 판 2차시를 '앞 시간 / 뒤 시간 / 두 시간 모두'로 나눠 고르는 규칙 — 한 곳에 둔다.
 * (작업 172) 차시별 규칙표로 넓혔다: 2차시(값은 그대로)·3차시(교사 결정 2026-10-30 — 앞 = 106쪽, 뒤 = 107쪽).
 * (작업 173) 4차시(교사 결정 2026-10-30 — 앞 = 108~110쪽 철강·베트남·관세사, 뒤 = 111~113쪽 마무리 중심). 마무리 구성도 시간마다 다르다(`wrap`).
 *
 * - 규칙은 **차시 한 판 + 범위가 정확히 차시 하나 + 그 차시에 규칙이 있을 때**만 쓴다(`lessonPartRules`). 그 밖(단원 한 판·연속 구간·1·4차시)은 null.
 * - 빠지는 사건·학습지·편지는 배치 후보·은행에서 아예 뺀다(데이터 항목 자체는 지우지 않는다 — 단원 한 판이 그대로 쓴다).
 * - 확인 퀴즈(L2-E7)는 세 가지 모두 뺀다(수업 정리는 교사의 외부 퀴즈).
 */
import { wrapupByUnit } from './schedule';
import type { GoodId, LessonId, PortId, WorksheetId, WrapStep } from './types';

export type LessonPart = 'all' | 'front' | 'back';

export const LESSON_PARTS: readonly LessonPart[] = ['front', 'back', 'all'];

export interface LessonPartCover {
  title: string;
  body: string;
  /** 있으면 교사 발문을 바꾼다 */
  teacherPrompts?: readonly string[];
  /** 공용 화면 표지의 교과서 쪽(예: '100~102') */
  pages: string;
  /** 공용 화면 표지 질문(없으면 차시 카드 질문 그대로) */
  question?: string;
}

export interface LessonPartRule {
  part: LessonPart;
  /** (작업 172) 이 규칙의 차시 */
  lesson: LessonId;
  /** 배치 후보에서 빼는 사건 */
  dropEvents: readonly string[];
  /** 배치·끝나고 쓰기에서 빼는 학습지 */
  dropWorksheets: readonly WorksheetId[];
  /** 편지 은행에서 빼는 문항 */
  dropLetters: readonly string[];
  /** 처음 화물(2차시 담맘 원유 2상자)을 싣는가 */
  startCargo: boolean;
  /** 항구 화면 싱가포르 중계 안내 줄·첫 [중계] 도장 개념 카드 숨김 */
  hideRelay: boolean;
  /** 표지(L2-E1) 덮어쓰기(null = 데이터 그대로) */
  cover: LessonPartCover | null;
  /** 임무 패널 '먼저 할 일'(null = 153 기본 문구) */
  missionFirst: string | null;
  /** 꼭 할 임무가 아닌 것에 ' · 시간 나면'을 붙이는가 */
  optionalTag: boolean;
  /**
   * (v0.3.10, 작업 165) 세관 게시판(`CUSTOMS_BOARD_EVENT`)을 구간 끝이 아니라 '뒤에 라운드 n개를 남기고' 그 앞에 둔다
   * (학습지 방식이 '활동마다 바로'일 때만 — ⑤가 바로 뒤에 붙고, 남은 라운드에서 ⑥을 게임하면서 쓴다). null = 지금처럼 구간 끝.
   */
  customsBeforeLastRounds: number | null;
  /**
   * (v0.3.11, 작업 167) 싱가포르(SIN) 항구 열림: 'closed' = 판 끝까지 잠김(앞 시간), 'afterW06' = 학습지 ⑥ 팝업이 닫히는 순간 열림(두 시간 모두),
   * 'open' = 처음부터 열림(뒤 시간). 잠긴 동안은 판 시작·구간 시작·표지 unlock 모두에서 뺀다(`portsHeldBack`).
   */
  singapore: 'closed' | 'afterW06' | 'open';
  /**
   * (작업 167·168) 배치표에서만 빼는 사건(학급 발동을 배치하지 않음). `dropEvents`와 달리 첫 입항 처리(voyage.ts)·⑥ 뒤 발동은 그대로 쓴다.
   * 두 시간 모두: L2-E5(잠긴 싱가포르를 가리키는 중계 임무를 라운드 1에 주지 않게), L2-E4(⑥ 뒤에 준다 — `fireAfterW06`).
   */
  scheduleOnlyDrop: readonly string[];
  /** (작업 168) 학습지 ⑥ 팝업이 닫히는 순간 학급 발동하는 사건(두 시간 모두: 수출국 4유형 임무 L2-E4) */
  fireAfterW06: readonly string[];
  /** (작업 168) 배치 고정 라운드 바꾸기(사건 ID → 'round:N'). 뒤 시간: 수출국 4유형 임무 L2-E4 = 라운드 3 시작 */
  anchorOverride: Readonly<Record<string, string>>;
  /**
   * (작업 172) 늘 짧은 형태로 넣는 활동(교사 [넣기/짧게/빼기]가 없을 때). 3차시: 경쟁 세 가지 카드(L3-E6 — 확인 퀴즈 없이 카드만),
   * 뒤 시간은 경제 게이지(L3-E5)도. 없으면 빈 목록(2차시 그대로)
   */
  forceShort?: readonly string[];
  /** (작업 172) '라운드 부족' 판정에 쓰는 최소 라운드 수 바꾸기(사건 ID → 수). 3차시 뒤 시간 L3-E5(게이지만) = 0 */
  needsRoundsOverride?: Readonly<Record<string, number>>;
  /**
   * (작업 172) 경제 게이지(L3-E5 안, p.107): 'withPhone' = 스마트폰 결과 뒤(두 시간 모두), 'stageEnd' = 게이지만(뒤 시간 — 경쟁 카드 바로 앞),
   * 'none' = 없음(앞 시간). 없으면 'withPhone'(단원 한 판과 같음)
   */
  econGauge?: 'withPhone' | 'stageEnd' | 'none';
  /** (작업 172) 이 판 시장·도감에 보이지 않는 상품(3차시 앞 시간: AI 반도체 — 기술 경쟁이 없음) */
  hideGoods?: readonly GoodId[];
  /**
   * (작업 172) 활동 이름 바꾸기(사건 ID → 이름). 3차시 L3-E5는 앞 시간 '우리 반 스마트폰 결과', 뒤 시간 '경제 게이지' —
   * 교사 오늘 순서·미리보기·학생 카드에 다른 시간 내용 이름이 보이지 않게
   */
  titles?: Readonly<Record<string, string>>;
  /** (작업 172) 이 판 도감에 보이지 않는 카드(상품 'good:x'·개념 카드 ID) — 다른 시간 활동이 주는 카드 */
  hideDex?: readonly string[];
  /**
   * (작업 173) 마지막 라운드 앞으로 옮기는 구간 끝 활동(`customsBeforeLastRounds`와 함께). 없으면 2차시 세관 게시판(L2-E6).
   * 4차시: 관세사 카드(L4-E4) — ⑮까지 쓰고 '마지막 항해'를 한다
   */
  midTailEvent?: string;
  /**
   * (작업 173 검증 반영) 무역 시간(분)이 이 값보다 짧으면 교사가 정하지 않은 한 짧은 형태로 고정(사건 ID → 분).
   * 4차시 앞 시간·두 시간 모두: 1970년대 철강(L4-E1) 30분 — 회상 3단계를 먼저 빼고 베트남 기사·공장 결정을 전체 형태로(순서표 '시간이 모자랄 때 버리는 순서')
   */
  shortBelowMinutes?: Readonly<Record<string, number>>;
  /** (작업 173) 옮기는 활동은 이 활동들이 붙은 라운드보다 뒤에(4차시: 근로 환경 보도 L4-E3 — ⑭가 보도 앞에 뜨지 않게) */
  midTailAfter?: readonly string[];
  /**
   * (작업 173) 마무리 구성(null·없음 = `wrapupByUnit.lesson[차시]` 그대로). 4차시 앞 시간: 컨테이너 OX·잡지 표지 없이 되돌아보기 2문항(⑱ 없음),
   * 뒤 시간: 4차시 마무리 전체(컨테이너 OX → 결산·시상 → 되돌아보기 3문항 → 잡지 표지)
   */
  wrap?: readonly WrapStep[] | null;
}

/** (작업 172) 이 판 도감에서 숨기는 카드 */
export function dexHeldBack(rule: LessonPartRule | null | undefined): readonly string[] {
  return rule?.hideDex ?? [];
}

/** (작업 172) 이 판에 보이지 않는 상품(3차시 앞 시간 AI 반도체) */
export function goodsHeldBack(rule: LessonPartRule | null | undefined): readonly GoodId[] {
  return rule?.hideGoods ?? [];
}

/** (작업 172) 경제 게이지 자리 — 규칙이 없으면(단원 한 판·연속 구간) 스마트폰 결과 뒤 */
export function econGaugeOf(rule: LessonPartRule | null | undefined): 'withPhone' | 'stageEnd' | 'none' {
  return rule?.econGauge ?? 'withPhone';
}

/** (작업 167) 싱가포르가 열리는 학습지 팝업(이 번호가 든 팝업이 닫히면 열림 — 'afterW06'일 때) */
export const SINGAPORE_OPEN_AFTER: WorksheetId = 'W06';
/** (작업 167) 늦게 여는 항구 */
export const SINGAPORE_PORT: PortId = 'SIN';

/** (작업 167) 이 판에서 아직 열지 않는 항구(판 시작·구간 시작·표지 unlock에서 뺀다) */
export function portsHeldBack(rule: LessonPartRule | null | undefined): PortId[] {
  return rule?.singapore === 'closed' || rule?.singapore === 'afterW06' ? [SINGAPORE_PORT] : [];
}

/** 세관 게시판 사건(작업 165 — 마지막 라운드 n개 앞으로 옮기는 대상) */
export const CUSTOMS_BOARD_EVENT = 'L2-E6';

export interface LessonPartText {
  title: string;
  sub: string;
  preview: string;
}

/** 교사 판 설정 버튼 문구(그대로 쓴다) — 2차시 */
export const LESSON_PART_TEXT: Record<LessonPart, LessonPartText> = {
  front: {
    title: '앞 시간 — 우리나라 무역의 특징',
    sub: '교과서 100~102쪽 · 부산 공장, 자원 수입 → 생산 → 수출, 세관 게시판 · 학습지 ⑤⑥',
    preview: '2차시 앞 시간: 우리나라 무역의 특징 (교과서 100~102쪽)',
  },
  back: {
    title: '뒤 시간 — 세계의 다양한 무역',
    sub: '교과서 103~104쪽 · 수출국 4유형, 싱가포르 중계 무역 · 학습지 ⑦⑧',
    preview: '2차시 뒤 시간: 세계의 다양한 무역 (교과서 103~104쪽)',
  },
  all: {
    title: '두 시간 내용 모두 한 판에',
    sub: '교과서 100~104쪽 · 학습지 ⑤~⑧',
    preview: '2차시 두 시간 모두 (교과서 100~104쪽)',
  },
};

/** (작업 172) 3차시 판 설정 버튼 문구(화면에는 차시 번호 대신 교과서 쪽) */
export const LESSON_PART_TEXT_L3: Record<LessonPart, LessonPartText> = {
  front: {
    title: '앞 시간 — 서로 기대는 무역',
    sub: '교과서 106쪽 · 광물 협력 기사, 우리 반 스마트폰 · 학습지 ⑨⑩',
    preview: '3차시 앞 시간: 서로 기대는 무역 (교과서 106쪽)',
  },
  back: {
    title: '뒤 시간 — 서로 겨루는 무역',
    sub: '교과서 107쪽 · AI 기술 경쟁, 자동화 항만 투표, 경제 게이지, 경쟁 세 가지 · 학습지 ⑪⑫',
    preview: '3차시 뒤 시간: 서로 겨루는 무역 (교과서 107쪽)',
  },
  all: {
    title: '두 시간 내용 모두 한 판에',
    sub: '교과서 106~107쪽 · 학습지 ⑨~⑫',
    preview: '3차시 두 시간 모두 (교과서 106~107쪽)',
  },
};

/** (작업 173) 4차시 판 설정 버튼 문구(화면에는 차시 번호 대신 교과서 쪽) */
export const LESSON_PART_TEXT_L4: Record<LessonPart, LessonPartText> = {
  front: {
    title: '앞 시간 — 수입과 기업의 결정',
    sub: '교과서 108~110쪽 · 1970년대 철강 투표, 베트남 공장 결정, 관세사 · 학습지 ⑬⑭⑮',
    preview: '4차시 앞 시간: 수입과 기업의 결정 (교과서 108~110쪽)',
  },
  back: {
    title: '뒤 시간 — 항해를 마치며',
    sub: '교과서 111~113쪽 · 마지막 항해, 컨테이너 OX, 시상, 되돌아보기, 잡지 표지 · 학습지 ⑯⑰⑱',
    preview: '4차시 뒤 시간: 항해를 마치며 (교과서 111~113쪽)',
  },
  all: {
    title: '두 시간 내용 모두 한 판에',
    sub: '교과서 108~113쪽 · 학습지 ⑬~⑱',
    preview: '4차시 두 시간 모두 (교과서 108~113쪽)',
  },
};

/** (작업 172) 차시별 판 설정 버튼 문구 */
export const LESSON_PART_TEXTS: Readonly<Partial<Record<LessonId, Record<LessonPart, LessonPartText>>>> = {
  L2: LESSON_PART_TEXT,
  L3: LESSON_PART_TEXT_L3,
  L4: LESSON_PART_TEXT_L4,
};

/** 차시의 판 설정 버튼 문구(규칙이 없는 차시면 2차시 문구 — 부르는 쪽이 `hasLessonParts`로 먼저 거른다) */
export function lessonPartText(lesson: LessonId | null | undefined, part: LessonPart): LessonPartText {
  return (lesson ? LESSON_PART_TEXTS[lesson] : undefined)?.[part] ?? LESSON_PART_TEXT[part];
}

/** (작업 172) 나눠 고르기가 있는 차시(작업 173이 L4를 더했다) */
export const LESSON_PART_LESSONS: readonly LessonId[] = ['L2', 'L3', 'L4'];
/** (옛 이름, 작업 154) 2차시 — 새 코드는 `LESSON_PART_LESSONS`·`hasLessonParts`를 쓴다 */
export const LESSON_PART_LESSON: LessonId = 'L2';
/** (옛 이름) 2차시 표지 사건 — 새 코드는 `LESSON_PART_COVER_EVENTS` */
export const LESSON_PART_COVER_EVENT = 'L2-E1';
/** (작업 172) 차시별 표지 사건(덮어쓰기 대상). events.ts COVER_EVENT_IDS 와 같은 값 — 순환 import 를 피해 여기 둔다(시험이 같은지 검사) */
export const LESSON_PART_COVER_EVENTS: Readonly<Record<LessonId, string>> = { L1: 'L1-COVER', L2: 'L2-E1', L3: 'L3-COVER', L4: 'L4-COVER' };

/** (작업 172) 3차시 앞 시간 고유 편지(스마트폰·인도네시아 협력) */
const L3_FRONT_LETTERS: readonly string[] = ['L3-01', 'L3-02', 'L3-05', 'L3-09', 'L3-10'];
/** (작업 172) 3차시 뒤 시간 고유 편지(생성형 인공지능·경쟁 3종·수출 증가) */
const L3_BACK_LETTERS: readonly string[] = ['L3-03', 'L3-04', 'L3-06', 'L3-07', 'L3-08'];

const L2_RULES: Record<LessonPart, LessonPartRule> = {
  front: {
    part: 'front',
    lesson: 'L2',
    dropEvents: ['L2-E4', 'L2-E5', 'L2-E7'],
    dropWorksheets: ['W07', 'W08'],
    dropLetters: ['L2-03', 'L2-06', 'L2-07', 'L2-08'],
    startCargo: true,
    hideRelay: true,
    cover: {
      title: 'L2. 자원을 사 와서 만들어 팔아요',
      body: '새 항구 5곳이 열렸어요. 자원을 사 와서 공장에서 만들어 파는 무역을 해 봐요.',
      pages: '100~102',
    },
    missionFirst: null,
    optionalTag: true,
    customsBeforeLastRounds: 2,
    singapore: 'closed',
    scheduleOnlyDrop: [],
    fireAfterW06: [],
    anchorOverride: {},
  },
  back: {
    part: 'back',
    lesson: 'L2',
    dropEvents: ['L2-E2', 'L2-E3', 'L2-E6', 'L2-E7'],
    dropWorksheets: ['W05', 'W06'],
    dropLetters: ['L2-01', 'L2-02', 'L2-05'],
    startCargo: false,
    hideRelay: false,
    cover: {
      title: 'L2. 세계의 다양한 무역',
      body: '새 항구 6곳이 열렸어요. 나라마다 무엇을 많이 수출하는지 항해하며 알아봐요. 싱가포르에도 들러 보세요.',
      teacherPrompts: ['나라마다 수출하는 것이 다른 까닭은 무엇일까요?'],
      pages: '103~104',
      question: '나라마다 수출하는 것이 다른 까닭은 무엇일까요?',
    },
    missionFirst: '먼저 할 일: 쌀·원유·로봇·K-콘텐츠처럼 종류가 다른 상품을 사고팔아 수출국 4유형 칸을 채워요',
    optionalTag: false,
    customsBeforeLastRounds: null,
    singapore: 'open',
    scheduleOnlyDrop: [],
    fireAfterW06: [],
    anchorOverride: { 'L2-E4': 'round:3' },
  },
  all: {
    part: 'all',
    lesson: 'L2',
    dropEvents: ['L2-E7'],
    dropWorksheets: [],
    // (작업 167) 싱가포르·수출국 4유형·박람회 편지는 ⑥ 뒤에야 열리는 내용 — ⑥ 뒤에는 라운드가 없으므로 앞 시간과 같이 뺀다
    dropLetters: ['L2-03', 'L2-06', 'L2-07', 'L2-08'],
    startCargo: true,
    hideRelay: false,
    cover: null,
    missionFirst: null,
    optionalTag: true,
    customsBeforeLastRounds: 2,
    singapore: 'afterW06',
    scheduleOnlyDrop: ['L2-E4', 'L2-E5'],
    fireAfterW06: ['L2-E4'],
    anchorOverride: {},
  },
};

/**
 * (작업 172, 교사 결정 2026-10-30) 3차시 나눠 고르기.
 * - 앞 시간(106쪽): 표지, 광물 협력(L3-E1), 우리 반 스마트폰(L3-E2·E5 — 결과 장면에서 경제 게이지는 뺀다), 학습지 ⑨⑩.
 * - 뒤 시간(107쪽): 표지, AI 기술 경쟁(L3-E3), 자동화 항만 투표(L3-E4), 경제 게이지(L3-E5 게이지만, 구간 끝), 경쟁 세 가지 카드(L3-E6 카드만), ⑪⑫.
 * - 두 시간 모두: 위 전부(L3-E5에서 스마트폰 결과 → 경제 게이지).
 * - 차시 한 판 3차시는 확인 퀴즈 문항을 내지 않고 경쟁 세 가지 카드만 짧은 형태(1분)로 늘 넣는다(교사 확정 2026-10-30).
 * - 편지는 2차시 선례처럼 다른 시간 고유 문항을 양쪽 다 뺀다(두 시간 모두는 3차시 전체).
 */
const L3_RULES: Record<LessonPart, LessonPartRule> = {
  front: {
    part: 'front',
    lesson: 'L3',
    dropEvents: ['L3-E3', 'L3-E4', 'L3-E6'],
    dropWorksheets: ['W11', 'W12'],
    dropLetters: L3_BACK_LETTERS,
    startCargo: false,
    hideRelay: false,
    cover: {
      title: 'L3. 서로 기대어 만들어요',
      body: '여러 나라의 우수한 물자를 한데 모으면 새로운 제품을 만들 수 있어요. 우리 반이 부품을 모아 스마트폰을 만들어 봐요.',
      teacherPrompts: ['스마트폰 한 대를 만드는 데 왜 여러 나라의 물자가 필요할까요?'],
      pages: '106',
      question: '여러 나라는 무역으로 어떻게 서로 기댈까요?',
    },
    missionFirst: '먼저 할 일: 우리 팀 부품을 사거나 만들어서 부산 [조립장]에 넣어요',
    optionalTag: false,
    customsBeforeLastRounds: null,
    singapore: 'open',
    scheduleOnlyDrop: [],
    fireAfterW06: [],
    anchorOverride: {},
    forceShort: [],
    econGauge: 'none',
    hideGoods: ['aichip'],
    titles: { 'L3-E5': '우리 반 스마트폰 결과' },
    hideDex: ['good:aichip', 'competition-tech', 'competition-facility', 'competition-env', 'export-growth'],
  },
  back: {
    part: 'back',
    lesson: 'L3',
    dropEvents: ['L3-E1', 'L3-E2'],
    dropWorksheets: ['W09', 'W10'],
    dropLetters: L3_FRONT_LETTERS,
    startCargo: false,
    hideRelay: false,
    cover: {
      title: 'L3. 서로 겨뤄요',
      body: '세계 여러 나라는 더 많은 이익을 얻으려고 여러 분야에서 서로 경쟁해요. 우리 회사도 기술과 무역 환경을 두고 겨뤄 봐요.',
      teacherPrompts: ['나라들은 무엇을 두고 서로 겨룰까요?'],
      pages: '107',
      question: '세계 여러 나라는 무역으로 무엇을 두고 겨룰까요?',
    },
    missionFirst: null,
    optionalTag: true,
    customsBeforeLastRounds: null,
    singapore: 'open',
    scheduleOnlyDrop: [],
    fireAfterW06: [],
    anchorOverride: {},
    forceShort: ['L3-E5', 'L3-E6'],
    needsRoundsOverride: { 'L3-E5': 0 },
    econGauge: 'stageEnd',
    titles: { 'L3-E5': '경제 게이지 — 수출이 늘어나면' },
    hideDex: ['interdependence'],
  },
  all: {
    part: 'all',
    lesson: 'L3',
    dropEvents: [],
    dropWorksheets: [],
    dropLetters: [],
    startCargo: false,
    hideRelay: false,
    cover: null,
    missionFirst: '먼저 할 일: 우리 팀 부품을 사거나 만들어서 부산 [조립장]에 넣어요',
    optionalTag: false,
    customsBeforeLastRounds: null,
    singapore: 'open',
    scheduleOnlyDrop: [],
    fireAfterW06: [],
    anchorOverride: {},
    forceShort: ['L3-E6'],
    econGauge: 'withPhone',
  },
};

/** (작업 173) 4차시 고유 편지(모두 108~110쪽 — 뒤 시간 판은 공통 문항만, 2차시 선례) */
export const L4_FRONT_LETTERS: readonly string[] = ['L4-01', 'L4-02', 'L4-03', 'L4-04', 'L4-05', 'L4-06'];
/** (작업 173) 4차시 앞 시간 활동(108~110쪽) — 뒤 시간 판에서 뺀다 */
export const L4_FRONT_EVENTS: readonly string[] = ['L4-E1', 'L4-E2', 'L4-E3', 'L4-E4'];
/** (작업 173) 4차시 앞 시간 활동이 주는 도감 카드 — 뒤 시간 판 도감에서 숨긴다(관세 카드는 판매 관세로도 얻으므로 그대로) */
export const L4_FRONT_DEX: readonly string[] = ['import-pros-cons', 'steel-1970', 'overseas-production', 'customs-broker'];

const L4_WRAP = wrapupByUnit.lesson.L4;
/** (작업 173) 4차시 앞 시간 마무리: 정산 → 결산·시상 → 되돌아보기 2문항(⑱ 없음) → 끝나고 쓰기 */
const L4_FRONT_WRAP: readonly WrapStep[] = L4_WRAP.filter((s) => s.id !== 'containers' && s.id !== 'magazine').map((s) => (s.id === 'reflect' ? { ...s, questions: 2 } : s));

/**
 * (작업 173, 교사 결정 2026-10-30) 4차시 나눠 고르기.
 * - 앞 시간(108~110쪽): 표지, 1970년대 철강 투표(L4-E1), 베트남 기사·공장 결정(L4-E2), 근로 환경 보도(L4-E3), 관세사(L4-E4), ⑬⑭⑮.
 *   마무리는 결산·시상·되돌아보기 2문항만(컨테이너 OX·잡지 표지·⑯⑰⑱ 없음).
 * - 뒤 시간(111~113쪽): 표지만 → '마지막 항해' 라운드(남은 화물 정리·자유 무역) → 4차시 마무리 전체.
 * - 두 시간 모두: 앞 시간 활동 전부 + 4차시 마무리 전체(`wrapupByUnit.lesson.L4`).
 * - 관세사 카드는 구간 끝 활동으로 돌려 '마지막 라운드 앞'에 둔다(보도 라운드 뒤) — ⑬⑭⑮를 다 쓰고 마지막 항해.
 */
const L4_RULES: Record<LessonPart, LessonPartRule> = {
  front: {
    part: 'front',
    lesson: 'L4',
    dropEvents: [],
    dropWorksheets: ['W16', 'W17', 'W18'],
    dropLetters: [],
    startCargo: false,
    hideRelay: false,
    cover: {
      title: 'L4. 수입과 기업의 결정',
      body: '수입이 늘면 무엇이 좋고 무엇이 걱정될까요? 1970년대 부산으로 시간 여행을 떠나고, 베트남에 공장을 지을지도 결정해 봐요.',
      teacherPrompts: ['우리나라가 수입 철강 제품에 높은 관세를 부과했던 까닭은 무엇일까요?'],
      pages: '108~110',
      question: '우리나라가 수입 철강 제품에 높은 관세를 부과했던 까닭은 무엇일까요?',
    },
    missionFirst: null,
    optionalTag: true,
    customsBeforeLastRounds: 1,
    singapore: 'open',
    scheduleOnlyDrop: [],
    fireAfterW06: [],
    anchorOverride: { 'L4-E4': 'stageEnd' },
    midTailEvent: 'L4-E4',
    midTailAfter: ['L4-E3'],
    shortBelowMinutes: { 'L4-E1': 30 },
    wrap: L4_FRONT_WRAP,
  },
  back: {
    part: 'back',
    lesson: 'L4',
    dropEvents: L4_FRONT_EVENTS,
    dropWorksheets: ['W13', 'W14', 'W15'],
    dropLetters: L4_FRONT_LETTERS,
    startCargo: false,
    hideRelay: false,
    cover: {
      title: 'L4. 항해를 마치며',
      body: '마지막 항해예요. 남은 화물을 정리하며 자유롭게 무역해요. 항해가 끝나면 공부한 내용을 되돌아보고 우리 회사를 소개해요.',
      teacherPrompts: ['무역을 하며 여러 나라는 서로 어떻게 기대고 겨뤘나요?'],
      pages: '111~113',
      question: '무역을 하며 세계 여러 나라는 어떤 관계를 맺었을까요?',
    },
    missionFirst: null,
    optionalTag: true,
    customsBeforeLastRounds: null,
    singapore: 'open',
    scheduleOnlyDrop: [],
    fireAfterW06: [],
    anchorOverride: {},
    hideDex: L4_FRONT_DEX,
    wrap: L4_WRAP,
  },
  all: {
    part: 'all',
    lesson: 'L4',
    dropEvents: [],
    dropWorksheets: [],
    dropLetters: [],
    startCargo: false,
    hideRelay: false,
    cover: null,
    missionFirst: null,
    optionalTag: true,
    customsBeforeLastRounds: 1,
    singapore: 'open',
    scheduleOnlyDrop: [],
    fireAfterW06: [],
    anchorOverride: { 'L4-E4': 'stageEnd' },
    midTailEvent: 'L4-E4',
    midTailAfter: ['L4-E3'],
    shortBelowMinutes: { 'L4-E1': 30 },
    wrap: null,
  },
};

const RULES: Readonly<Partial<Record<LessonId, Record<LessonPart, LessonPartRule>>>> = { L2: L2_RULES, L3: L3_RULES, L4: L4_RULES };

/** (작업 172) 이 차시에 나눠 고르기가 있는가 */
export function hasLessonParts(lesson: LessonId | null | undefined): boolean {
  return !!lesson && LESSON_PART_LESSONS.includes(lesson) && !!RULES[lesson];
}

export function isLessonPart(v: unknown): v is LessonPart {
  return v === 'all' || v === 'front' || v === 'back';
}

/**
 * 이 판의 나눠 고르기 규칙. 차시 한 판이고 범위가 정확히 차시 하나이며 그 차시에 규칙이 있을 때만 규칙, 그 밖은 null(아무것도 빼지 않음).
 * `part`가 없거나 틀리면 'all'.
 */
export function lessonPartRules(playUnit: string | null | undefined, scope: readonly LessonId[] | null | undefined, part?: LessonPart | null): LessonPartRule | null {
  if (playUnit !== 'lesson' || !scope || scope.length !== 1) return null;
  const lesson = scope[0];
  if (!hasLessonParts(lesson)) return null;
  return RULES[lesson]![isLessonPart(part) ? part : 'all'];
}

/** 설정 객체에서 바로(ClassSettings·공개 settings 공용) */
export function lessonPartRulesOf(s: { playUnit: string; scope: readonly LessonId[]; lessonPart?: LessonPart | null } | null | undefined): LessonPartRule | null {
  if (!s) return null;
  return lessonPartRules(s.playUnit, s.scope, s.lessonPart);
}

/** 표지 제목·글·발문(학생 카드·공용 화면·교사 화면 공용). 덮어쓰기가 없으면 원래 값 */
export function coverTextFor<T extends { id: string; title: string; body: string; teacherPrompts?: readonly string[] }>(
  def: T,
  settings: { playUnit: string; scope: readonly LessonId[]; lessonPart?: LessonPart | null } | null | undefined,
): { title: string; body: string; teacherPrompts: readonly string[] } {
  const base = { title: def.title, body: def.body, teacherPrompts: def.teacherPrompts ?? [] };
  const rule = lessonPartRulesOf(settings);
  if (!rule) return base;
  // (작업 172) 표지가 아닌 활동은 이름만 바꾼다(3차시 L3-E5)
  if (def.id !== LESSON_PART_COVER_EVENTS[rule.lesson]) return rule.titles?.[def.id] ? { ...base, title: rule.titles[def.id]! } : base;
  const c = rule.cover;
  if (!c) return base;
  return { title: c.title, body: c.body, teacherPrompts: c.teacherPrompts ?? base.teacherPrompts };
}

/**
 * (v0.3.10, 작업 165, PRD 4.1.1 '2차시 나눠 고르기' 끝) 학습지 ⑥ 게임하면서 함께 쓰기 문구.
 * - 안내 카드: ⑤ 팝업이 닫히고 다음 라운드가 열리면 학생 화면 아래에 막지 않는 카드로.
 * - `last`: 맨 끝 ⑥ 팝업(반 전체)의 문항 목록 바로 위 한 줄.
 */
export const WS6_ALONG_TEXT = {
  head: '잠깐! 학습지 ⑥',
  body1: '지금부터는 학습지 ⑥의 문항을 동시에 쓰면서 게임을 해 보세요!',
  body2: '1번: 수입한 자원 → 공장에서 만든 상품 → 수출한 곳을 내가 한 대로 적어요. 2번 빈칸과 3번 항해 퀴즈도 풀어요.',
  ok: '알겠어요',
  last: '아직 못 쓴 친구들은 남은 문제를 다 풀어보아요. ⑥의 1·2·3번을 모두 쓰고 [다 썼어요]를 눌러요.',
} as const;
