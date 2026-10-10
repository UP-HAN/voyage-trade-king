/**
 * 부산 공장 레시피 4종 (PRD 6.9) — [게임 설정 + p.101].
 * 부산에 정박 중일 때 즉시 생산. 첫 생산 때 p.101 '천연자원 수입 → 상품 생산 → 수출' 순환 그림 카드를 보여 준다.
 */
import type { GoodId, Recipe } from './types';

export const recipes: readonly Recipe[] = [
  { id: 'oilp', name: '석유 제품', inputs: { crude: 1 }, fee: 10, outputV: 100, unlockLesson: 'L2', pages: [100, 101], gameRule: true },
  { id: 'steel', name: '철강', inputs: { iron: 2 }, fee: 10, outputV: 90, unlockLesson: 'L2', pages: [101, 108], gameRule: true },
  { id: 'battery', name: '배터리', inputs: { graphite: 1, nickel: 1, chem: 1 }, fee: 20, outputV: 250, unlockLesson: 'L2', pages: [99, 101], gameRule: true },
  { id: 'aichip', name: 'AI 반도체', inputs: { chip: 2 }, fee: 30, outputV: 400, unlockLesson: 'L3', requires: 'techRaceWinner', pages: [107], gameRule: true },
];

export const recipesById: Readonly<Partial<Record<GoodId, Recipe>>> = Object.fromEntries(
  recipes.map((r) => [r.id, r]),
) as Partial<Record<GoodId, Recipe>>;

/** 공장 화면 순환 그림 카드(p.101) */
export const factoryCycleCard = {
  title: '자원을 사 와서 만들어 팔아요',
  steps: ['천연자원 수입', '상품 생산', '상품 수출'],
  text: '우리나라는 원유, 천연가스, 철광석 등 산업 발달에 필요한 천연자원이 부족해요. 반면에 다른 나라에서 수입한 자원으로 다양한 상품을 생산할 수 있는 기술이 발달했어요.',
  pages: [101],
} as const;
