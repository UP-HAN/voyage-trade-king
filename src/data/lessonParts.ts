/**
 * (v0.3.9, 작업 154, PRD 4.1.1 '2차시 나눠 고르기'·4.4 L2·16.1 결정 38)
 * 차시 한 판 2차시를 '앞 시간 / 뒤 시간 / 두 시간 모두'로 나눠 고르는 규칙 — 한 곳에 둔다.
 *
 * - 규칙은 **차시 한 판 + 범위가 정확히 ['L2']** 일 때만 쓴다(`lessonPartRules`). 그 밖(단원 한 판·연속 구간·1·3·4차시)은 null.
 * - 빠지는 사건·학습지·편지는 배치 후보·은행에서 아예 뺀다(데이터 항목 자체는 지우지 않는다 — 단원 한 판이 그대로 쓴다).
 * - 확인 퀴즈(L2-E7)는 세 가지 모두 뺀다(수업 정리는 교사의 외부 퀴즈).
 */
import type { LessonId, WorksheetId } from './types';

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
}

/** 교사 판 설정 버튼 문구(그대로 쓴다) */
export const LESSON_PART_TEXT: Record<LessonPart, { title: string; sub: string; preview: string }> = {
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

/** 나눠 고르기가 있는 차시 */
export const LESSON_PART_LESSON: LessonId = 'L2';
/** 표지 사건(덮어쓰기 대상) */
export const LESSON_PART_COVER_EVENT = 'L2-E1';

const RULES: Record<LessonPart, LessonPartRule> = {
  front: {
    part: 'front',
    dropEvents: ['L2-E4', 'L2-E5', 'L2-E7'],
    dropWorksheets: ['W07', 'W08'],
    dropLetters: ['L2-03', 'L2-06', 'L2-07', 'L2-08'],
    startCargo: true,
    hideRelay: true,
    cover: {
      title: 'L2. 자원을 사 와서 만들어 팔아요',
      body: '새 항구 6곳이 열렸어요. 자원을 사 와서 공장에서 만들어 파는 무역을 해 봐요.',
      pages: '100~102',
    },
    missionFirst: null,
    optionalTag: true,
  },
  back: {
    part: 'back',
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
  },
  all: {
    part: 'all',
    dropEvents: ['L2-E7'],
    dropWorksheets: [],
    dropLetters: [],
    startCargo: true,
    hideRelay: false,
    cover: null,
    missionFirst: null,
    optionalTag: true,
  },
};

export function isLessonPart(v: unknown): v is LessonPart {
  return v === 'all' || v === 'front' || v === 'back';
}

/**
 * 이 판의 나눠 고르기 규칙. 차시 한 판이고 범위가 정확히 ['L2']일 때만 규칙, 그 밖은 null(아무것도 빼지 않음).
 * `part`가 없거나 틀리면 'all'.
 */
export function lessonPartRules(playUnit: string | null | undefined, scope: readonly LessonId[] | null | undefined, part?: LessonPart | null): LessonPartRule | null {
  if (playUnit !== 'lesson' || !scope || scope.length !== 1 || scope[0] !== LESSON_PART_LESSON) return null;
  return RULES[isLessonPart(part) ? part : 'all'];
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
  if (def.id !== LESSON_PART_COVER_EVENT) return base;
  const c = lessonPartRulesOf(settings)?.cover;
  if (!c) return base;
  return { title: c.title, body: c.body, teacherPrompts: c.teacherPrompts ?? base.teacherPrompts };
}
