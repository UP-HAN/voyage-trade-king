/**
 * 배 3종과 항해 상수 (PRD 6.8) — [게임 설정].
 * 운항비 = 거리 단계 × 10만 원 × 운항비 배수(routes.ts `voyageCost`). 입항료 없음. 항해 지연 없음(라운드 동기화).
 */
import type { Ship, ShipId } from './types';

export const ships: readonly Ship[] = [
  { id: 'small', name: '소형 화물선', capacity: 20, costMultiplier: 1, price: 0, unlockLesson: 'L1', priority: 'P0', image: 'ships/ship-small.png', gameRule: true },
  { id: 'medium', name: '중형 화물선', capacity: 40, costMultiplier: 1.5, price: 800, unlockLesson: 'L2', priority: 'P1', image: 'ships/ship-medium.png', gameRule: true },
  { id: 'large', name: '대형 컨테이너선', capacity: 80, costMultiplier: 2, price: 2000, unlockLesson: 'L3', priority: 'P1', image: 'ships/ship-large.png', gameRule: true },
];

export const shipsById: Readonly<Record<ShipId, Ship>> = Object.fromEntries(
  ships.map((s) => [s.id, s]),
) as Record<ShipId, Ship>;

export const STARTING_SHIP: ShipId = 'small';
export const STARTING_PORT = 'BUS' as const;

/**
 * 자금 0 · 화물 0 이면 긴급 대출(탈락 없음). 최종 자산에서 뺀다.
 * 빌려주는 곳은 실존 은행 이름과 겹치지 않게 일반 명칭 '선장 조합 금고'로 쓴다(PRD 2장 5항, 오케스트레이터 결정).
 */
export const LOAN_LENDER_NAME = '선장 조합 금고';

export const emergencyLoan = {
  amount: 200,
  text: '선장 조합 금고 긴급 대출 200만 원(최종 자산에서 빼요)',
  gameRule: true,
} as const;

/** 결산 때 남은 화물·배 값 반영 비율(PRD 6.14.1) */
export const settlementRates = {
  cargoOfCost: 0.5,
  shipOfPrice: 0.5,
} as const;
