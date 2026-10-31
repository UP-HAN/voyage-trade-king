/**
 * (작업 173, PRD 6.12.6) 1970년대 철강 회상(L4-E1) — 투표 뒤 단계와 화면 글.
 *
 * - 투표(투표 공통 카드) → 우리 반 결과 → (전체 형태) 회상 3단계 → 실제 사례 카드(p.108).
 *   짧은 형태는 회상 3단계를 빼고 결과 → 실제 사례 카드.
 * - 단계는 학급 하나로 움직인다(`currentEvent.step`) — 교사 [다음] 한 곳에서 넘기고, '저절로' 진행이면 시간에 맞춰 넘어간다.
 * - 학급 결과가 실제(관세를 매김)와 달라도 그 결과대로 회상을 보여 준 뒤 실제 사례를 공개한다(교사 동의, 2026-10-08).
 * - 회상 문구는 PRD 6.12.6 표 [게임 설정], 실제 사례 카드는 교과서 108쪽 요지(쉬운 말로 줄임 — 원문을 길게 옮기지 않는다).
 */

export const STEEL_EVENT = 'L4-E1';

export type SteelStep = 'vote' | 'result' | 's1' | 's2' | 's3' | 'real';

/** 전체 형태 단계 */
export const STEEL_STEPS_FULL: readonly SteelStep[] = ['vote', 'result', 's1', 's2', 's3', 'real'];
/** 짧은 형태 단계(3단계 회상 생략) */
export const STEEL_STEPS_SHORT: readonly SteelStep[] = ['vote', 'result', 'real'];

export function steelSteps(short: boolean): readonly SteelStep[] {
  return short ? STEEL_STEPS_SHORT : STEEL_STEPS_FULL;
}

/** 지금 단계(`currentEvent.step` 번호 → 이름). 범위를 넘으면 마지막 단계 */
export function steelStepAt(short: boolean, step: number | undefined): SteelStep {
  const list = steelSteps(short);
  const i = Math.max(0, Math.min(list.length - 1, Math.floor(step ?? 0)));
  return list[i]!;
}

/**
 * '저절로' 진행에서 단계를 넘기는 시간 [게임 설정]: 투표는 30초(모두 투표하면 5초 뒤), 그 뒤 단계는 남은 칸 시간을 나눠 쓰되 최소 12초.
 * 교사 [다음]은 언제든 바로 넘긴다.
 */
export const STEEL_AUTO = { voteSec: 30, allVotedSec: 5, minStepSec: 12 } as const;

export interface SteelStage {
  /** 단계 꼬리표("회상 1단계") */
  tag: string;
  line: string;
  /** 이 단계 분위기(그림 틀 색) */
  mood: 'up' | 'down' | 'neutral';
}

/** 회상 3단계(투표 결과별) — PRD 6.12.6 */
export const STEEL_FLASHBACK: Readonly<Record<'tariff' | 'noTariff', readonly SteelStage[]>> = {
  tariff: [
    { tag: '1단계', line: '수입 철강에 관세가 붙어 철강 값이 조금 비싸졌어요. 건물을 짓는 회사와 자동차 회사가 불만을 말해요.', mood: 'down' },
    { tag: '2단계', line: '우리나라 제철소에서 만든 철강이 팔리기 시작해요.', mood: 'up' },
    { tag: '3단계', line: '철강을 만드는 기술이 늘어 우리 철강이 경쟁력을 갖춰요.', mood: 'up' },
  ],
  noTariff: [
    { tag: '1단계', line: '싼 수입 철강 덕분에 건물과 배를 짓기가 쉬워졌어요.', mood: 'up' },
    { tag: '2단계', line: '우리나라 제철소는 철강을 팔지 못해요.', mood: 'down' },
    { tag: '3단계', line: '우리나라 철강 산업이 자라기 어려워요.', mood: 'down' },
  ],
};

/** 실제 사례 카드(교과서 108쪽 요지) */
export const STEEL_REAL = {
  kicker: '실제로는 이랬어요',
  title: '1970년대 우리나라 철강',
  lines: [
    '1970년대 우리나라는 제철소를 짓고 우리 기술로 철강 제품을 만들려고 노력했어요.',
    '그리고 수입 철강 제품에 높은 관세를 매겼어요.',
    '그 결과 우리나라 철강 제품이 수입 철강 제품보다 더 높은 경쟁력을 갖추었고, 오늘날 우리나라는 세계적인 철강 산업 국가가 되었어요.',
  ],
  /** 철강이 중요한 까닭(p.108 보조 단) */
  why: '철강은 건축·자동차·가전·선박 같은 여러 산업의 기초 소재로 쓰여요.',
  /** p.108 용어 풀이 */
  term: '관세 = 다른 나라에서 수입하는 상품에 매기는 세금',
  /** 우리 반 결과가 실제와 다를 때 한 줄 */
  differ: '우리 반 결과는 실제와 달랐어요. 괜찮아요 — 왜 다른 결과가 나왔는지 생각해 봐요.',
  same: '우리 반 결과도 실제와 같았어요.',
  pages: [108] as readonly number[],
} as const;

/** 회상 장면 그림(175 산출물 — 없으면 세피아 틀만) */
export const STEEL_IMAGE = 'scenes/busan-1970s.png';

/** 우리 반 결과 한 줄(투표 공통 카드 `voteResultLine`이 쓴다) */
export function steelResultLine(result: string | null | undefined): string | null {
  // (검증 반영) 판에서 일어나지 않는 약속(부산 해외 철강 관세 30%)은 쓰지 않는다 — 1970년대 결정이 국내 철강 산업에 준 영향을 따라가는 배움 문구
  if (result === 'tariff') return '우리 반 결과: 관세를 매겨요 — 수입 철강이 비싸지면 우리 제철소에 어떤 일이 생길지 따라가 봐요';
  if (result === 'noTariff') return '우리 반 결과: 관세를 매기지 않아요 — 싼 수입 철강이 계속 들어오면 우리 제철소에 어떤 일이 생길지 따라가 봐요';
  return null;
}

/** 시장 카드 관세 도장 옆 꼬리표(부산 해외 철강 30%) */
export const STEEL_TARIFF_TAG = '1970년대 투표 결과';
