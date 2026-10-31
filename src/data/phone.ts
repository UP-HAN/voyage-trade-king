/**
 * (작업 172) 3차시 학급 활동 상수 — 모두 [게임 설정](교사 확정 2026-10-30, PRD 6.12.3~6.12.5, 4.4 L3).
 *
 * - 학급 스마트폰 프로젝트(L3-E2 시작 → L3-E5 결과, p.106): 부품 6종, 팀 배정, 필요 수량, 조립장 보상.
 * - 경제 게이지(L3-E5 안, p.107): 3차시 학급 [수출] 판매액 평균으로 4칸.
 * - 광물 협력(L3-E1, p.106): 참여비·협력·자카르타 니켈 할인.
 * 규칙 엔진은 `src/core/phone.ts`, 화면 문구도 여기서 가져간다.
 */
import type { GoodId, PortId } from './types';

/** 부품 6종(배정 순서 = 출석번호 순 1번 반도체, 2번 배터리 …) */
export const PHONE_PARTS: readonly GoodId[] = ['chip', 'battery', 'chem', 'program', 'nickel', 'graphite'];

/** 부품을 구하는 곳(학생 안내 문구) */
export const PHONE_PART_WHERE: Readonly<Record<string, string>> = {
  chip: '부산에서 사요',
  battery: '부산 [공장]에서 만들어요(흑연·니켈·정밀 화학 원료)',
  chem: '요코하마·로테르담에서 사요',
  program: '로스앤젤레스에서 계약해요(배에 싣지 않아요)',
  nickel: '자카르타에서 사요',
  graphite: '상하이에서 사요',
};

export const phoneRules = {
  /** 필요 수량 = 팀 인원 × 2 */
  perMember: 2,
  /** 짧은 형태·라운드 2개뿐이면 절반(올림) */
  shortRatio: 0.5,
  /**
   * (172 검증 반영, 교사 위임 '추천대로') 필요 수량을 한 번 더 절반(올림, 최소 1)으로 하는 부품 — 배터리는 재료 세 곳 + 부산 공장을 거쳐
   * 25분 판에서 가장 늦게 모이고 1상자 보상(300만 원)도 가장 크다
   */
  halfParts: ['battery'] as readonly GoodId[],
  /**
   * (172 검증 반영, 교사 위임 '추천대로') 한 학생이 한 부품에 넣을 수 있는 최대 상자 수(우리 팀·다른 팀 모두).
   * 부산 반도체(사는 값 V×0.6)를 사서 바로 넣어 한 학생이 학급 필요량을 혼자 채우며 돈을 모으는 길을 막는다(1인 최대 남는 돈 = 2 × 90만 원).
   * 팀 필요 수량이 팀 인원 × 2라 팀원이 각자 2상자씩 넣으면 딱 모인다
   */
  perStudentPart: 2,
  /** 팀이 비어 있는 부품(학생이 6명보다 적을 때)도 이 인원으로 센다 — 스마트폰은 부품 6종이 다 있어야 한다(result.md 가정) */
  minMembers: 1,
  /** 넣은 부품 1상자당 보상 = 그 상품 V × 1.2(만 원, 반올림). 판매가 아님 — 도장·수출액·관세 없음 */
  rewardMul: 1.2,
  /** 자기 팀 부품 협력 +2/상자, 다른 팀 부품 +5/상자, 한 학생 부품 협력 합계 최대 +20 */
  coopOwn: 2,
  coopOther: 5,
  coopMax: 20,
  /** 모든 부품이 모이면 모두 협력 +20, 자금 +50만 원(한 번만) */
  completeCoop: 20,
  completeMoney: 50,
  /** 조립장이 있는 항구 */
  port: 'BUS' as PortId,
} as const;

/** 학생·TV 문구 */
export const PHONE_TEXT = {
  complete: '스마트폰 완성!',
  missing: (names: string) => `${names} 부품이 없어 스마트폰을 만들 수 없어요`,
  end: '여러 나라의 우수한 물자를 한데 모아 새로운 제품을 만들어요.',
  full: '이 부품은 다 모였어요',
} as const;

/** 경제 게이지 4칸(학급 [수출] 판매액 ÷ 참여 회사 수, 만 원) — p.107 수출 증가 → 산업 성장 → 일자리 → 소득 */
export const ECON_GAUGE_STEPS: readonly { min: number; text: string; pages: readonly number[] }[] = [
  { min: 100, text: '공장이 바빠져요(산업 성장)', pages: [107] },
  { min: 200, text: '일자리가 늘어요', pages: [107] },
  { min: 400, text: '소득이 늘어요', pages: [107] },
  { min: 600, text: '부산이 더 커져요', pages: [107] },
];

/** 경제 게이지 몇 칸(0~4) */
export function econGaugeStep(avg: number): number {
  return ECON_GAUGE_STEPS.filter((s) => avg >= s.min).length;
}

/** 경제 게이지 한 줄(학생·TV 같음) */
export function econGaugeLine(avg: number): string {
  const step = econGaugeStep(avg);
  if (step === 0) return `우리 반 수출 평균 ${Math.round(avg)}만 원 · 수출이 더 늘면 공장이 바빠져요`;
  return `우리 반 수출 평균 ${Math.round(avg)}만 원 · ${ECON_GAUGE_STEPS[step - 1]!.text}`;
}

/** L3-E1 광물 협력 [게임 설정, PRD 4.4 L3-E1] */
export const MINERAL_COOP = {
  cost: 50,
  coop: 10,
  /** 남은 판 동안 자카르타 니켈 사는 값 20% 싸게 */
  discountPort: 'JKT' as PortId,
  discountGood: 'nickel' as GoodId,
  discountMul: 0.8,
} as const;

/** L3-E3 생성형 인공지능 시장 그래프(p.107, S&P 글로벌 마켓 인텔리전트, 2023) — 억 달러 */
export const AI_MARKET_GRAPH = {
  source: 'S&P 글로벌 마켓 인텔리전트, 2023.',
  points: [
    { year: 2023, value: 37, label: '37억 달러' },
    { year: 2026, value: 194, label: '194억 달러' },
    { year: 2028, value: 363, label: '363억 달러' },
  ],
  pages: [107],
} as const;

/** L3-E6 경쟁 세 가지 카드(p.107) — 도감 카드 ID 순서 */
export const COMPETITION_CARDS: readonly { id: string; title: string; example: string }[] = [
  { id: 'competition-tech', title: '첨단 기술을 개발하기 위한 경쟁', example: '생성형 인공지능 제품' },
  { id: 'competition-facility', title: '다른 나라에 필요한 시설을 건설하기 위한 경쟁', example: '우리나라 기업이 건설한 인도의 다리' },
  { id: 'competition-env', title: '더 나은 무역 환경을 만들기 위한 경쟁', example: '자동화 항만 시스템을 구축한 부산항' },
];
