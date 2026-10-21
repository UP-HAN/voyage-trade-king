import { describe, expect, it } from 'vitest';
import { portPrice, quote } from '../../src/core/market';
import { applyAction, stampFor } from '../../src/core/rules';
import { goodsById } from '../../src/data/goods';
import { priceMultipliers, PRICE_JITTER, tariffs, tradeLimits } from '../../src/data/market';
import { serviceRules } from '../../src/data/goods';
import type { CargoLot, GameEvent } from '../../src/core/types';
import { editPlayer, makeSession, player, startFirstRound } from './helpers';

const lot = (l: Partial<CargoLot> & Pick<CargoLot, 'good' | 'qty'>): CargoLot => ({
  unitCost: 10, origin: 'foreign', source: 'specialty', boughtAt: 'SHA', ...l,
});
const stampOf = (evs: GameEvent[]) => evs.filter((e) => e.type === 'stamp').map((e) => (e as { kind: string }).kind);

describe('시세: 같은 시드 → 같은 값, 학생과 무관', () => {
  it('같은 seed·구간·라운드면 quote() 두 번 같은 값, 다른 학생 상태여도 같은 값', () => {
    let s = startFirstRound(makeSession({ n: 3, scope: ['L2'] }));
    s = editPlayer(s, 2, (p) => {
      p.game.money = 9999;
      p.game.port = 'SHA';
      p.game.cargo = [lot({ good: 'clothes', qty: 5 })];
    });
    const a1 = quote(s.class, player(s, 1), 'LAX', 'chip');
    const a2 = quote(s.class, player(s, 1), 'LAX', 'chip');
    const b = quote(s.class, player(s, 2), 'LAX', 'chip');
    expect(a1).toEqual(a2);
    expect(b.sell).toBe(a1.sell);
    expect(b.buy).toBe(a1.buy);
    // 다른 판(같은 시드)으로 다시 만들어도 같은 값
    const t = startFirstRound(makeSession({ n: 1, scope: ['L2'] }));
    expect(portPrice(t.class, 'LAX', 'chip')).toEqual(portPrice(s.class, 'LAX', 'chip'));
  });

  it('흔들림은 ±5% 이내, 라운드가 바뀌면 값이 바뀔 수 있다', () => {
    const s = startFirstRound(makeSession({ n: 1, scope: ['L2'] }));
    const V = goodsById.chip.V;
    for (let round = 1; round <= 20; round++) {
      const p = portPrice({ ...s.class, round }, 'LAX', 'chip');
      expect(p.sell!).toBeGreaterThanOrEqual(Math.floor(V * priceMultipliers.hotSell * (1 - PRICE_JITTER)));
      expect(p.sell!).toBeLessThanOrEqual(Math.ceil(V * priceMultipliers.hotSell * (1 + PRICE_JITTER)));
    }
    const vals = new Set(Array.from({ length: 10 }, (_, i) => portPrice({ ...s.class, round: i + 1 }, 'LAX', 'chip').sell));
    expect(vals.size).toBeGreaterThan(1);
  });

  it('L1에 공개되지 않은 상품·열리지 않은 항구는 보이지 않는다', () => {
    const s = makeSession({ n: 1, scope: ['L1'] });
    expect(portPrice(s.class, 'BUS', 'crude').visible).toBe(false);
    expect(portPrice(s.class, 'LAX', 'chip').visible).toBe(false);
    expect(portPrice(s.class, 'BUS', 'chip').visible).toBe(true);
  });
});

describe('도장 분류 4종(PRD 6.5.3)', () => {
  it('stampFor 표', () => {
    expect(stampFor('korea', 'specialty', 'SHA')).toBe('export');
    expect(stampFor('foreign', 'specialty', 'BUS')).toBe('import');
    expect(stampFor('foreign', 'relay', 'DAM')).toBe('relay');
    expect(stampFor('korea', 'factory', 'BUS')).toBe('domestic');
  });

  it('수출: 부산 반도체를 상하이에 판매', () => {
    let s = startFirstRound(makeSession({ n: 1, scope: ['L2'] }));
    s = editPlayer(s, 1, (p) => {
      p.game.port = 'SHA';
      p.game.cargo = [lot({ good: 'chip', qty: 2, origin: 'korea', boughtAt: 'BUS', unitCost: 90 })];
    });
    const r = applyAction(s.class, player(s, 1), { type: 'sell', good: 'chip', qty: 2 });
    expect(r.error).toBeUndefined();
    expect(stampOf(r.events)).toEqual(['export']);
    expect(r.player.game.metrics.exports).toBeGreaterThan(0);
  });

  it('수입: 상하이 의류를 부산에 판매(관세 10%)', () => {
    let s = startFirstRound(makeSession({ n: 1, scope: ['L1'] }));
    s = editPlayer(s, 1, (p) => {
      p.game.cargo = [lot({ good: 'clothes', qty: 10, boughtAt: 'SHA', unitCost: 18 })];
    });
    const q = quote(s.class, player(s, 1), 'BUS', 'clothes');
    const r = applyAction(s.class, player(s, 1), { type: 'sell', good: 'clothes', qty: 10 });
    expect(stampOf(r.events)).toEqual(['import']);
    const amount = q.sell! * 10;
    const tariff = Math.round(amount * tariffs.default);
    expect(r.events).toContainEqual({ type: 'tariff', rate: 0.1, amount: tariff });
    expect(r.events).toContainEqual({ type: 'profit', amount: amount - 180 - tariff });
    expect(r.player.game.money).toBe(player(s, 1).game.money + amount - tariff);
    expect(r.player.game.metrics.tariffs).toBe(tariff);
    expect(r.player.game.metrics.imports).toBe(amount);
  });

  it('중계: 싱가포르에서 산 상품을 다른 해외 항구에 판매 + 싱가포르 관세 0%', () => {
    let s = startFirstRound(makeSession({ n: 1, scope: ['L2'] }));
    s = editPlayer(s, 1, (p) => {
      p.game.port = 'DAM';
      p.game.cargo = [lot({ good: 'clothes', qty: 3, source: 'relay', boughtAt: 'SIN' })];
    });
    const r = applyAction(s.class, player(s, 1), { type: 'sell', good: 'clothes', qty: 3 });
    expect(stampOf(r.events)).toEqual(['relay']);
    // 싱가포르에서 팔면 관세 0
    // (작업 167) 싱가포르가 처음부터 열린 판 = 2차시 뒤 시간
    let t = startFirstRound(makeSession({ n: 1, scope: ['L2'], lessonPart: 'back' }));
    t = editPlayer(t, 1, (p) => {
      p.game.port = 'SIN';
      p.game.cargo = [lot({ good: 'chip', qty: 2, boughtAt: 'SHA' })];
    });
    expect(quote(t.class, player(t, 1), 'SIN', 'chip').tariffRate).toBe(0);
    const r2 = applyAction(t.class, player(t, 1), { type: 'sell', good: 'chip', qty: 2 });
    expect(r2.error).toBeUndefined();
    expect(r2.events.some((e) => e.type === 'tariff')).toBe(false);
    expect(r2.player.game.metrics.tariffs).toBe(0);
  });

  it('국내 판매: 공장 생산품을 부산에 판매(관세 없음)', () => {
    let s = startFirstRound(makeSession({ n: 1, scope: ['L2'] }));
    s = editPlayer(s, 1, (p) => {
      p.game.cargo = [lot({ good: 'crude', qty: 2, boughtAt: 'DAM', unitCost: 36 })];
    });
    const made = applyAction(s.class, player(s, 1), { type: 'produce', recipe: 'oilp', qty: 2 });
    expect(made.error).toBeUndefined();
    expect(made.events).toContainEqual({ type: 'factoryCycleCard' });
    // 석유 제품은 부산에서 '국내 판매'(N)
    const r = applyAction(s.class, made.player, { type: 'sell', good: 'oilp', qty: 2 });
    expect(r.error).toBeUndefined();
    expect(stampOf(r.events)).toEqual(['domestic']);
    expect(r.events.some((e) => e.type === 'tariff')).toBe(false);
  });
});

describe('한도(PRD 6.5.1)', () => {
  it('제값 한도 20상자를 넘기면 판매가 × 0.7', () => {
    let s = startFirstRound(makeSession({ n: 1, scope: ['L1'] }));
    s = editPlayer(s, 1, (p) => {
      p.game.ship = 'medium';
      p.game.cargo = [lot({ good: 'rice', qty: 25, boughtAt: 'BKK', unitCost: 12 })];
      p.game.port = 'YOK';
    });
    const q = quote(s.class, player(s, 1), 'YOK', 'rice');
    expect(q.sellFullLeft).toBe(tradeLimits.fullPriceSell);
    const r = applyAction(s.class, player(s, 1), { type: 'sell', good: 'rice', qty: 25 });
    const amount = 20 * q.sell! + 5 * Math.round(q.sell! * tradeLimits.overLimitSellMultiplier);
    expect(r.events).toContainEqual({ type: 'overLimit', good: 'rice', qty: 5 });
    expect(r.events.find((e) => e.type === 'stamp')).toMatchObject({ kind: 'relay', qty: 25, amount });
    expect(quote(s.class, r.player, 'YOK', 'rice').sellFullLeft).toBe(0);
  });

  it('살 수 있는 양 30상자', () => {
    let s = startFirstRound(makeSession({ n: 1, scope: ['L1'] }));
    s = editPlayer(s, 1, (p) => {
      p.game.ship = 'large';
      p.game.money = 99999;
      p.game.port = 'BKK';
    });
    expect(applyAction(s.class, player(s, 1), { type: 'buy', good: 'rice', qty: 31 }).error).toBe('BUY_LIMIT');
    expect(applyAction(s.class, player(s, 1), { type: 'buy', good: 'rice', qty: 30 }).error).toBeUndefined();
  });

  it('화물칸이 모자라면 살 수 없다(소형 20상자)', () => {
    let s = startFirstRound(makeSession({ n: 1, scope: ['L1'] }));
    s = editPlayer(s, 1, (p) => {
      p.game.money = 99999;
    });
    expect(applyAction(s.class, player(s, 1), { type: 'buy', good: 'chip', qty: 21 }).error).toBe('NO_SPACE');
  });
});

describe('서비스(PRD 6.4.2)', () => {
  it('서비스는 배 칸 0, 산 항구에서 못 팔고, 라운드당 종류별 5계약', () => {
    let s = startFirstRound(makeSession({ n: 1, scope: ['L1'] }));
    s = editPlayer(s, 1, (p) => {
      p.game.money = 99999;
      p.game.cargo = [lot({ good: 'chip', qty: 20, origin: 'korea', boughtAt: 'BUS' })];
    });
    // 배가 가득 차도 계약은 살 수 있다
    const r = applyAction(s.class, player(s, 1), { type: 'buy', good: 'kcon', qty: serviceRules.maxContractsPerRound });
    expect(r.error).toBeUndefined();
    expect(r.player.game.contracts).toHaveLength(1);
    expect(r.player.game.cargo.reduce((n, l) => n + l.qty, 0)).toBe(20);
    expect(applyAction(s.class, r.player, { type: 'buy', good: 'kcon', qty: 1 }).error).toBe('CONTRACT_LIMIT');
    // 산 항구(부산)에서 팔 수 없다 — 애초에 부산은 K-콘텐츠 특산(S)이라 팔지 않음
    expect(applyAction(s.class, r.player, { type: 'sell', good: 'kcon', qty: 1 }).error).toBe('CANNOT_SELL');
  });

  it('산 항구가 판매 가능 항구여도 같은 항구 되팔기는 막힌다(SAME_PORT)', () => {
    let s = startFirstRound(makeSession({ n: 1, scope: ['L2'], lessonPart: 'back' }));
    s = editPlayer(s, 1, (p) => {
      p.game.port = 'SIN';
      p.game.money = 9999;
    });
    const b = applyAction(s.class, player(s, 1), { type: 'buy', good: 'clothes', qty: 2 });
    expect(b.error).toBeUndefined();
    expect(applyAction(s.class, b.player, { type: 'sell', good: 'clothes', qty: 2 }).error).toBe('SAME_PORT');
  });
});
