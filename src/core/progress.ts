/**
 * 도감·임무 진행 (PRD 6.13, 4.4 임무) — 작업 103.
 * 이 파일의 함수는 넘겨받은 Player(이미 복사본)를 **직접 고친다**. 호출하는 쪽(rules·voyage·activities)이 복사를 맡는다.
 */
import { exportTypeCards } from '../data/dex';
import { missionsById } from '../data/missions';
import type { EventEffect, GoodId, PortId } from '../data/types';
import type { GameEvent, LotSource, Origin, Player, StampKind } from './types';

/** 도감 카드 추가(처음일 때만 이벤트) */
export function grantDex(p: Player, id: string, events: GameEvent[]): void {
  if (p.game.metrics.dex.includes(id)) return;
  p.game.metrics.dex.push(id);
  events.push({ type: 'dexUnlocked', id });
}

/** 임무 시작(이미 있으면 그대로) */
export function activateMission(p: Player, id: string): void {
  const m = missionsById[id];
  if (!m || p.game.missions[id]) return;
  p.game.missions[id] = { status: 'active', steps: m.steps.map(() => false) };
}

/** 개인에게 적용하는 사건 효과(돈·도감 카드) */
export function applyPersonalEffects(p: Player, effects: readonly EventEffect[], events: GameEvent[], reason: string): void {
  for (const e of effects) {
    if (e.type === 'dexCard') grantDex(p, e.card, events);
    if (e.type === 'money') {
      p.game.money += e.amount;
      events.push({ type: 'money', amount: e.amount, reason });
    }
  }
}

function setStep(p: Player, id: string, step: number, events: GameEvent[]): void {
  const m = p.game.missions[id];
  if (!m || m.status !== 'active' || m.steps[step]) return;
  m.steps[step] = true;
  events.push({ type: 'missionStep', id, step });
  if (id === 'M-EXPORT4') {
    const card = exportTypeCards[step];
    if (card) grantDex(p, card.id, events);
  }
}

function completeIfDone(p: Player, id: string, events: GameEvent[], force = false): void {
  const m = p.game.missions[id];
  if (!m || m.status !== 'active') return;
  if (!force && !m.steps.every(Boolean)) return;
  m.steps = m.steps.map(() => true);
  m.status = 'done';
  events.push({ type: 'missionDone', id });
  applyPersonalEffects(p, missionsById[id]?.reward ?? [], events, `mission:${id}`);
}

/** 산 뒤 임무 진행 */
export function onBuy(p: Player, good: GoodId, port: PortId, events: GameEvent[]): void {
  if (good === 'gas') setStep(p, 'M-GAS', 0, events);
  if (port === 'SIN') setStep(p, 'M-RELAY', 0, events);
  exportTypeCards.forEach((c, i) => {
    if (c.goods.includes(good)) setStep(p, 'M-EXPORT4', i, events);
  });
  completeIfDone(p, 'M-EXPORT4', events);
}

const IPE_RAW: readonly GoodId[] = ['crude', 'iron', 'graphite', 'nickel', 'chem'];

/** 판 뒤 임무 진행(묶음 하나당) */
export function onSell(
  p: Player,
  sale: { good: GoodId; port: PortId; stamp: StampKind; origin: Origin; source: LotSource; boughtAt: PortId },
  events: GameEvent[],
): void {
  if (sale.good === 'gas' && sale.port === 'BUS') {
    setStep(p, 'M-GAS', 1, events);
    // 목표(PRD 6.11.4 goal): 부산에서 천연가스 1상자 이상 판매
    completeIfDone(p, 'M-GAS', events, true);
  }
  // (작업 115) 수출국 4유형: 사거나 팔면 그 유형 칸(PRD 4.4 L2-E4)
  exportTypeCards.forEach((c, i) => {
    if (c.goods.includes(sale.good)) setStep(p, 'M-EXPORT4', i, events);
  });
  completeIfDone(p, 'M-EXPORT4', events);
  if (sale.stamp === 'import' && IPE_RAW.includes(sale.good)) setStep(p, 'M-IPE', 0, events);
  if (sale.stamp === 'export' && sale.source === 'factory') setStep(p, 'M-IPE', 2, events);
  completeIfDone(p, 'M-IPE', events);
  if (sale.stamp === 'relay' && sale.boughtAt === 'SIN') {
    setStep(p, 'M-RELAY', 0, events);
    setStep(p, 'M-RELAY', 1, events);
    completeIfDone(p, 'M-RELAY', events);
  }
}

/** 생산 뒤 임무 진행 */
export function onProduce(p: Player, usedForeignRaw: boolean, events: GameEvent[]): void {
  if (usedForeignRaw) setStep(p, 'M-IPE', 0, events);
  setStep(p, 'M-IPE', 1, events);
  completeIfDone(p, 'M-IPE', events);
}

export function isForeignRaw(good: GoodId, origin: Origin): boolean {
  return origin === 'foreign' && IPE_RAW.includes(good);
}
