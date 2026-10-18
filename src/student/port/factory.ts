/**
 * 부산 공장 화면 모델 — 순수 함수 (작업 115, PRD 6.9 · 교과서 p.101).
 *
 * 레시피 카드(재료 → 공장 → 상품 3칸): 재료별 가진 수/필요 수, 공장비, 지금 만들 수 있는 최대 수, 못 만드는 까닭.
 * 생산 규칙·검사는 core `applyAction({ type: 'produce' })`가 한다. 여기서는 화면에 보일 숫자만 계산한다.
 */
import type { ClassState, Player } from '../../core';
import { LESSON_ORDER } from '../../core/state';
import { goodsById } from '../../data/goods';
import { recipes } from '../../data/recipes';
import type { GoodId } from '../../data/types';

export interface FactoryInput {
  good: GoodId;
  name: string;
  /** 한 상자 만드는 데 필요한 수 */
  need: number;
  /** 배에 가진 수 */
  have: number;
}

export interface FactoryCard {
  id: GoodId;
  name: string;
  inputs: FactoryInput[];
  /** 상자당 공장비(만 원) */
  fee: number;
  /** 지금 만들 수 있는 최대 상자 수 */
  max: number;
  /** 못 만드는 까닭(만들 수 있으면 null) */
  reason: string | null;
}

/** 공장 탭을 보여 주나: 공장 기능이 열렸고 부산에 있을 때 */
export function factoryOpen(cs: Pick<ClassState, 'features'>, p: Pick<Player, 'game'>): boolean {
  return cs.features.includes('factory') && p.game.port === 'BUS';
}

/** 배에 가진 상자 수(상품별) */
function haveOf(p: Pick<Player, 'game'>, good: GoodId): number {
  return p.game.cargo.filter((l) => l.good === good).reduce((s, l) => s + l.qty, 0);
}

/** 지금 구간에서 보이는 레시피 카드(AI 반도체는 기술 경쟁에서 얻은 학생만) */
export function factoryCards(cs: Pick<ClassState, 'stage'>, p: Pick<Player, 'game'>): FactoryCard[] {
  return recipes
    .filter((r) => LESSON_ORDER[r.unlockLesson] <= LESSON_ORDER[cs.stage])
    .filter((r) => r.requires !== 'techRaceWinner' || p.game.unlockedRecipes.includes(r.id))
    .map((r) => {
      const inputs = (Object.entries(r.inputs) as [GoodId, number][]).map(([good, need]) => ({ good, name: goodsById[good]?.name ?? good, need, have: haveOf(p, good) }));
      const byInput = Math.min(...inputs.map((i) => Math.floor(i.have / i.need)));
      const byMoney = r.fee > 0 ? Math.floor(Math.max(0, p.game.money) / r.fee) : Number.POSITIVE_INFINITY;
      const max = Math.max(0, Math.min(byInput, byMoney));
      const reason = byInput < 1 ? '재료가 모자라요' : byMoney < 1 ? '공장비가 모자라요' : null;
      return { id: r.id, name: r.name, inputs, fee: r.fee, max, reason };
    });
}

/** 재료 한 줄: "원유 1" / "흑연 1 + 니켈 1 + 정밀 화학 원료 1" */
export function inputsLine(c: Pick<FactoryCard, 'inputs'>): string {
  return c.inputs.map((i) => `${i.name} ${i.need}`).join(' + ');
}
