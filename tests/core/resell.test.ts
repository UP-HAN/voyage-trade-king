/**
 * 작업 161 — 산 항구에서 되팔기(PRD 6.5.5): 산 값의 80%(상자당 내림), 관세·도장·지표 없음, 사기 한도 그대로.
 */
import { describe, expect, it } from 'vitest';
import { quote } from '../../src/core/market';
import { applyAction, resellUnit } from '../../src/core/rules';
import type { CargoLot, ClassState, HostSnapshot, LogEntry, Player } from '../../src/core/types';
import { resellRules } from '../../src/data/market';
import { act, editPlayer, makeSession, player, startFirstRound, teach } from './helpers';

/** 2차시 판 라운드 1, 학생은 상하이에 있음 */
function l2AtShanghai(fn?: (p: Player) => void): HostSnapshot {
  let s = startFirstRound(makeSession({ n: 1, scope: ['L2'] }));
  s = editPlayer(s, 1, (p) => {
    p.game.port = 'SHA';
    p.game.visit = { arrival: 1, sold: {}, bought: {} };
    fn?.(p);
  });
  return s;
}

const lot = (l: Partial<CargoLot> & Pick<CargoLot, 'good' | 'qty'>): CargoLot => ({
  unitCost: 24, origin: 'foreign', source: 'specialty', boughtAt: 'SHA', ...l,
});

describe('되팔기 비율 상수', () => {
  it('80%, 게임 규칙, 상자당 내림', () => {
    expect(resellRules.rate).toBe(0.8);
    expect(resellRules.gameRule).toBe(true);
    expect(resellRules.note).toBe('게임 규칙: 산 항구에서는 산 값의 80%로 되팔 수 있어요');
    expect(resellUnit(24)).toBe(19);
    expect(resellUnit(25)).toBe(20);
    expect(resellUnit(35)).toBe(28);
    expect(resellUnit(1)).toBe(0);
  });
});

describe('되팔기 core(applyAction resell)', () => {
  it('① 상하이에서 흑연 20 사기 → 되팔기 20: 돈 = 처음 − 산 돈 + 20 × floor(산 값 × 0.8), 화물 0, 지표·도장·관세 없음', () => {
    const s = l2AtShanghai((p) => {
      p.game.cargo = [];
    });
    const p0 = player(s, 1);
    const price = quote(s.class, p0, 'SHA', 'graphite').buy!;
    expect(price).toBeGreaterThan(20);
    const b = applyAction(s.class, p0, { type: 'buy', good: 'graphite', qty: 20 });
    expect(b.error).toBeUndefined();
    expect(b.player.game.money).toBe(p0.game.money - price * 20);
    expect(applyAction(s.class, b.player, { type: 'buy', good: 'graphite', qty: 1 }).error).toBe('NO_SPACE');

    const r = applyAction(s.class, b.player, { type: 'resell', good: 'graphite', qty: 20 });
    expect(r.error).toBeUndefined();
    const back = 20 * Math.floor(price * 0.8);
    const g = r.player.game;
    expect(g.money).toBe(p0.game.money - price * 20 + back);
    expect(g.cargo).toEqual([]);
    expect(g.metrics).toEqual(b.player.game.metrics);
    expect(g.missions).toEqual(b.player.game.missions);
    expect(r.events).toEqual([{ type: 'resold', good: 'graphite', qty: 20, amount: back, loss: price * 20 - back }]);
    expect(r.events.some((e) => e.type === 'stamp' || e.type === 'tariff' || e.type === 'profit' || e.type === 'dexUnlocked')).toBe(false);
    expect(g.log.at(-1)).toEqual<LogEntry>({ round: 1, stage: 'L2', kind: 'resell', good: 'graphite', qty: 20, port: 'SHA', amount: back, profit: -(price * 20 - back) });
    expect(g.visit).toEqual(b.player.game.visit);
    // 배 빈칸 20 → 다시 살 수 있음
    expect(applyAction(s.class, r.player, { type: 'buy', good: 'graphite', qty: 1 }).error).toBeUndefined();
  });

  it('호스트 경로(act)와 학생 예측이 같다', () => {
    const s = l2AtShanghai((p) => {
      p.game.cargo = [lot({ good: 'graphite', qty: 5 })];
    });
    const pre = applyAction(s.class, player(s, 1), { type: 'resell', good: 'graphite', qty: 3 });
    const host = act(s, 1, { type: 'resell', good: 'graphite', qty: 3 });
    expect(host.snapshot.players.s01!.game).toEqual(pre.player.game);
  });

  it('② 다른 항구로 가면 CANNOT_RESELL', () => {
    const s = l2AtShanghai((p) => {
      p.game.port = 'YOK';
      p.game.cargo = [lot({ good: 'graphite', qty: 5, boughtAt: 'SHA' })];
    });
    expect(applyAction(s.class, player(s, 1), { type: 'resell', good: 'graphite', qty: 1 }).error).toBe('CANNOT_RESELL');
  });

  it('③ 공장 생산품·서비스는 CANNOT_RESELL', () => {
    let s = startFirstRound(makeSession({ n: 1, scope: ['L2'] }));
    s = editPlayer(s, 1, (p) => {
      p.game.port = 'BUS';
      p.game.cargo = [lot({ good: 'oilp', qty: 2, unitCost: 30, origin: 'korea', source: 'factory', boughtAt: 'BUS' })];
      p.game.contracts = [lot({ good: 'kcon', qty: 2, unitCost: 30, origin: 'korea', boughtAt: 'BUS' })];
    });
    expect(applyAction(s.class, player(s, 1), { type: 'resell', good: 'oilp', qty: 1 }).error).toBe('CANNOT_RESELL');
    expect(applyAction(s.class, player(s, 1), { type: 'resell', good: 'kcon', qty: 1 }).error).toBe('CANNOT_RESELL');
    expect(applyAction(s.class, player(s, 1), { type: 'resell', good: 'graphite', qty: 1 }).error).toBe('CANNOT_RESELL');
  });

  it('④ 가진 양보다 많이 되팔면 NO_CARGO, 수량이 양의 정수가 아니면 BAD_QTY', () => {
    const s = l2AtShanghai((p) => {
      p.game.cargo = [lot({ good: 'graphite', qty: 5 })];
    });
    const p = player(s, 1);
    expect(applyAction(s.class, p, { type: 'resell', good: 'graphite', qty: 6 }).error).toBe('NO_CARGO');
    expect(applyAction(s.class, p, { type: 'resell', good: 'graphite', qty: 0 }).error).toBe('BAD_QTY');
    expect(applyAction(s.class, p, { type: 'resell', good: 'graphite', qty: 1.5 }).error).toBe('BAD_QTY');
  });

  it('⑤ 섞인 묶음: 되팔기는 여기서 산 묶음만, [팔기]는 다른 곳 묶음만', () => {
    // 상하이: 옷은 특산이라 팔 수 없으니, 상하이가 사 주는 원유(N)로 본다 — 여기(상하이)에서 산 원유와 담맘에서 산 원유
    const s = l2AtShanghai((p) => {
      p.game.cargo = [
        lot({ good: 'crude', qty: 3, unitCost: 50, boughtAt: 'DAM' }),
        lot({ good: 'crude', qty: 4, unitCost: 41, boughtAt: 'SHA' }),
      ];
    });
    const p = player(s, 1);
    expect(applyAction(s.class, p, { type: 'resell', good: 'crude', qty: 5 }).error).toBe('NO_CARGO');
    const r = applyAction(s.class, p, { type: 'resell', good: 'crude', qty: 4 });
    expect(r.error).toBeUndefined();
    expect(r.player.game.cargo).toEqual([lot({ good: 'crude', qty: 3, unitCost: 50, boughtAt: 'DAM' })]);
    expect(r.player.game.money).toBe(p.game.money + 4 * 32);
    // 팔기는 담맘 묶음 3상자까지만(여기서 산 4상자는 SAME_PORT)
    expect(applyAction(s.class, p, { type: 'sell', good: 'crude', qty: 4 }).error).toBe('SAME_PORT');
    const sold = applyAction(s.class, p, { type: 'sell', good: 'crude', qty: 3 });
    expect(sold.error).toBeUndefined();
    expect(sold.player.game.cargo).toEqual([lot({ good: 'crude', qty: 4, unitCost: 41, boughtAt: 'SHA' })]);
  });

  it('⑥ 되판 뒤에도 visit.bought 그대로 → 같은 입항에 30상자 넘게 못 산다', () => {
    const s = l2AtShanghai((p) => {
      p.game.cargo = [];
    });
    let p = applyAction(s.class, player(s, 1), { type: 'buy', good: 'graphite', qty: 20 }).player;
    p = applyAction(s.class, p, { type: 'resell', good: 'graphite', qty: 20 }).player;
    expect(p.game.visit.bought.graphite).toBe(20);
    expect(quote(s.class, p, 'SHA', 'graphite').buyLeft).toBe(10);
    const b10 = applyAction(s.class, p, { type: 'buy', good: 'graphite', qty: 10 });
    expect(b10.error).toBeUndefined();
    p = applyAction(s.class, b10.player, { type: 'resell', good: 'graphite', qty: 10 }).player;
    expect(applyAction(s.class, p, { type: 'buy', good: 'graphite', qty: 1 }).error).toBe('BUY_LIMIT');
  });

  it('⑦ 자유 항해 라운드 사이(canTrade)에도 되고, 잠깐 멈춤·무역 시작 전에는 NOT_TRADING', () => {
    let s = makeSession({ n: 1, scope: ['L2'] });
    s = teach(s, { type: 'updateSettings', settings: { voyageMode: 'free' } }, 0);
    s = startFirstRound(s);
    s = editPlayer(s, 1, (p) => {
      p.game.port = 'SHA';
      p.game.cargo = [lot({ good: 'graphite', qty: 5 })];
    });
    const p = player(s, 1);
    const between: ClassState = { ...s.class, phase: 'between' };
    expect(applyAction(between, p, { type: 'resell', good: 'graphite', qty: 1 }).error).toBeUndefined();
    expect(applyAction({ ...s.class, paused: true }, p, { type: 'resell', good: 'graphite', qty: 1 }).error).toBe('NOT_TRADING');
    const before = makeSession({ n: 1, scope: ['L2'] });
    expect(applyAction(before.class, p, { type: 'resell', good: 'graphite', qty: 1 }).error).toBe('NOT_TRADING');
    // 라운드마다 판의 라운드 사이는 거래 불가
    const roundMode = startFirstRound(makeSession({ n: 1, scope: ['L2'] }));
    expect(applyAction({ ...roundMode.class, phase: 'between' }, p, { type: 'resell', good: 'graphite', qty: 1 }).error).toBe('NOT_TRADING');
  });

  it('⑧ 돌려받는 돈 < 산 돈(무작위 산 값 1~400, 100번)', () => {
    let seed = 161;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const s = l2AtShanghai();
    for (let i = 0; i < 100; i++) {
      const unitCost = 1 + Math.floor(rand() * 400);
      const qty = 1 + Math.floor(rand() * 20);
      const p = { ...player(s, 1), game: { ...player(s, 1).game, cargo: [lot({ good: 'graphite', qty, unitCost })] } };
      const r = applyAction(s.class, p, { type: 'resell', good: 'graphite', qty });
      expect(r.error).toBeUndefined();
      const got = r.player.game.money - p.game.money;
      expect(got).toBeLessThan(unitCost * qty);
      expect(got).toBe(qty * Math.floor(unitCost * 0.8 + 1e-9));
      const ev = r.events[0]!;
      expect(ev.type === 'resold' && ev.loss > 0).toBe(true);
    }
  });

  it('여러 묶음(값이 다른 여기 묶음)은 묶음 순서대로 꺼낸다', () => {
    const s = l2AtShanghai((p) => {
      p.game.cargo = [lot({ good: 'graphite', qty: 2, unitCost: 24 }), lot({ good: 'graphite', qty: 3, unitCost: 26 })];
    });
    const r = applyAction(s.class, player(s, 1), { type: 'resell', good: 'graphite', qty: 4 });
    expect(r.events[0]).toEqual({ type: 'resold', good: 'graphite', qty: 4, amount: 2 * 19 + 2 * 20, loss: 2 * 24 + 2 * 26 - (2 * 19 + 2 * 20) });
    expect(r.player.game.cargo).toEqual([lot({ good: 'graphite', qty: 1, unitCost: 26 })]);
  });
});

describe('되팔기 수치 예(result.md)', () => {
  it('흑연 24×20 → 380(−100), 원유 41×10 → 320(−90), 니켈 36×5 → 140(−40)', () => {
    expect(20 * resellUnit(24)).toBe(380);
    expect(10 * resellUnit(41)).toBe(320);
    expect(5 * resellUnit(36)).toBe(140);
  });
});
