/**
 * 교사 화면 쉬운 말(작업 137, PRD 7.5.2.5 용어 바꾸기 표) — 순수 상수·함수.
 *
 * 교사 화면(대시보드·설정·확인 창·알림·학습지 패널·학생 상세 서랍)에 보이는 말만 바꾼다.
 * 데이터 필드·행동 이름·`data-testid`·학생 화면·공용 화면 문구는 그대로다(공통 데이터 label은 여기서 교사용으로 바꿔 보인다).
 */
import type { WorksheetPlacement } from '../core';
import type { LessonId } from '../data/types';

/** 교사 화면에 보이면 안 되는 옛 말(설정 [고급] 맨 아래 작은 글씨 "배치 n판"은 예외 — 시험이 그 부분만 빼고 검사) */
export const OLD_TEACHER_TERMS = /1등급|2등급|3등급|배치 \d+판|발동|빠진 활동|입장 마감|출항 준비|일시정지|발표 모드|마감/;

/** 활동 등급 → 쉬운 말(꼬리표는 '꼭 할 활동'만 대시보드에 표시) */
export const TIER_TEXT: Readonly<Record<1 | 2 | 3, string>> = {
  1: '꼭 할 활동',
  2: '하면 좋은 활동',
  3: '시간 나면 하는 활동',
};

/** 진행 방식(값 이름은 auto/manual 그대로) */
export const MODE_TEXT: Readonly<Record<'auto' | 'manual', string>> = {
  auto: '시간 맞춰 저절로 넘어가기',
  manual: '선생님이 하나씩 넘기기',
};

/** 수동 진행 안내(카드 보조 정보) */
export const MANUAL_HINT = '선생님이 [다음으로]를 눌러야 넘어가요';

/** 학습지 배치(값 이름은 그대로) */
export const PLACEMENT_TEACHER_TEXT: Readonly<Record<WorksheetPlacement, string>> = {
  each: '활동마다 바로',
  stageEnd: '차시 끝에 모아서',
  after: '게임 끝나고',
  off: '학습지 안 씀',
};

/** 공용 화면 장면 고르기(교사 화면 이름 — 공용 화면 쪽 값·규칙은 그대로) */
export const SCENE_CHOICE_TEXT: Readonly<Record<'auto' | 'leaderboard' | 'map' | 'code' | 'black', string>> = {
  auto: '알아서 바꾸기',
  leaderboard: '순위판',
  map: '해도',
  code: '방 코드',
  black: '검은 화면',
};

/** 'L1' → '1차시' (교사 화면 띠·꼬리표) */
export function lessonText(stage: LessonId | string): string {
  const m = /^L(\d)$/.exec(stage);
  return m ? `${m[1]}차시` : stage;
}

/** 받침 있는 낱말인가(을/를·이/가 고르기). 한글이 아니면 숫자·영문 끝 받침 규칙을 대충 따른다 */
export function hasBatchim(word: string): boolean {
  const ch = word.trim().slice(-1);
  if (!ch) return false;
  const code = ch.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0;
  // 숫자: 0 1 3 6 7 8 은 받침
  if (/[013678]/.test(ch)) return true;
  if (/[①-⑳]/.test(ch)) return false;
  return /[lmnr]/i.test(ch);
}

/** 을/를 */
export const eul = (w: string) => `${w}${hasBatchim(w) ? '을' : '를'}`;
/** 이/가 */
export const iGa = (w: string) => `${w}${hasBatchim(w) ? '이' : '가'}`;
