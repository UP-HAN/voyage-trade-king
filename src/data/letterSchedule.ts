/**
 * 편지 슬롯 규칙 (PRD 6.7.2~6.7.3, v0.3) — [게임 설정].
 *
 * v0.3 에서 편지 슬롯은 고정 표가 아니라 배치표가 정한다(편지 수 공식은 schedule.ts `letterCountRule`).
 * 슬롯 ID 는 판 안 순서대로 S1, S2, … 이고, 각 슬롯은 그 라운드가 속한 구간의 문제 은행(letters.ts `letterBank`)을 쓴다.
 * 슬롯의 보상과 난이도는 아래 순환 패턴으로 정한다(S1부터 차례로). 같은 슬롯의 학생은 문제가 달라도 같은 보상·같은 난이도.
 */
import type { Difficulty, LessonId, LetterRewardId } from './types';

/** 보상 순환 패턴(S1부터) */
export const rewardPattern: readonly LetterRewardId[] = [
  'money', 'fastCustoms', 'tailwind', 'money', 'dexCard', 'tailwind', 'money', 'fastCustoms', 'tailwind', 'money',
];

/** 난이도 순환 패턴(S1부터 easy, normal 반복) */
export const difficultyPattern: readonly Difficulty[] = ['easy', 'normal'];

/** 보상 정의(PRD 6.7.3) */
export const letterRewards: Readonly<Record<LetterRewardId, {
  id: LetterRewardId;
  name: string;
  effect: string;
  money?: number;
  extraFullPriceSell?: number;
  scope?: 'stage' | 'nextVoyage';
  gameRule: true;
}>> = {
  money: { id: 'money', name: '감사 사례금', effect: '자금 +30만 원(모두 같은 금액)', money: 30, gameRule: true },
  fastCustoms: {
    id: 'fastCustoms', name: '신속 통관', effect: "이번 구간 동안 모든 항구의 '제값에 팔 수 있는 양' +10상자",
    extraFullPriceSell: 10, scope: 'stage', gameRule: true,
  },
  tailwind: { id: 'tailwind', name: '순풍', effect: '다음 출항 운항비 0원', scope: 'nextVoyage', gameRule: true },
  dexCard: { id: 'dexCard', name: '도감 카드', effect: '그 문제의 개념 카드를 도감에 추가', gameRule: true },
};

/** 정답·오답 처리(PRD 6.7.3) */
export const letterAnswerRules = {
  /** 정답 시 지표 '무역 박사' 증가 */
  quizMetricOnRight: 1,
  /** 오답이면 해설·쪽수를 보여 주고 [알겠어요]로 닫음. 벌칙 없음 */
  wrongPenalty: 0,
  /** 슬롯마다 1회만 답할 수 있음 */
  oncePerSlot: true,
} as const;

/** 열지 않은 편지의 만료(PRD 6.7.2): 다음 편지가 오기 전까지, 그리고 적어도 2라운드 동안 열 수 있음 */
export const letterExpiry = {
  minRounds: 2,
  untilNextLetter: true,
  expiredText: '답장 기한이 지났어요',
} as const;

export interface LetterSlot {
  /** 'S1', 'S2', … */
  slotId: string;
  /** 0부터 */
  index: number;
  reward: LetterRewardId;
  difficulty: Difficulty;
  /** 스케줄러가 채움 */
  lesson?: LessonId;
  /** 스케줄러가 채움(판 전체 라운드 번호) */
  round?: number;
}

/** n번째(0부터) 슬롯의 보상·난이도 */
export function slotAt(index: number): LetterSlot {
  return {
    slotId: `S${index + 1}`,
    index,
    reward: rewardPattern[index % rewardPattern.length],
    difficulty: difficultyPattern[index % difficultyPattern.length],
  };
}

/** 슬롯 n개를 순서대로 */
export function slotsFor(count: number): LetterSlot[] {
  return Array.from({ length: count }, (_, i) => slotAt(i));
}

/** 슬롯 n개일 때 난이도별 슬롯 수 */
export function slotsByDifficulty(count: number): Record<Difficulty, number> {
  const out: Record<Difficulty, number> = { easy: 0, normal: 0 };
  for (const s of slotsFor(count)) out[s.difficulty] += 1;
  return out;
}

/** 참고: v0.2(전체 형태 4구간) 편지 수 L1 2, L2 3, L3 3, L4 1 = 9통 */
export const legacyLettersPerStage: Readonly<Record<LessonId, number>> = { L1: 2, L2: 3, L3: 3, L4: 1 };
