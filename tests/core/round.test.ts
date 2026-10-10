import { describe, expect, it } from 'vitest';
import { voyageCostFor } from '../../src/core/market';
import { applyAction } from '../../src/core/rules';
import { resolveRounds } from '../../src/core/voyage';
import { emergencyLoan } from '../../src/data/ships';
import { distanceSteps, VOYAGE_COST_PER_STEP } from '../../src/data/routes';
import { editPlayer, makeSession, player, startFirstRound, teach } from './helpers';

describe('라운드 처리(resolveRounds)', () => {
  it('목적지 + 출항 준비면 운항비를 내고 이동, 첫 입항 항구 카드·개척', () => {
    let s = startFirstRound(makeSession({ n: 1, scope: ['L1'] }));
    let p = applyAction(s.class, player(s, 1), { type: 'setDestination', port: 'SHA' }).player;
    p = applyAction(s.class, p, { type: 'setReady' }).player;
    s = { ...s, players: { ...s.players, s01: p } };
    s = teach(s, { type: 'endRound' });
    const after = player(s, 1);
    const cost = distanceSteps('BUS', 'SHA') * VOYAGE_COST_PER_STEP;
    expect(after.game.port).toBe('SHA');
    expect(after.game.money).toBe(500 - cost);
    expect(after.game.metrics.visited).toEqual(['BUS', 'SHA']);
    expect(after.game.metrics.dex).toContain('port:SHA');
    expect(after.game.resolvedRound).toBe(1);
    expect(after.game.dest).toBeNull();
    expect(after.game.visit.arrival).toBe(1);
  });

  it('준비 안 했거나 목적지가 없으면 머무름', () => {
    let s = startFirstRound(makeSession({ n: 2, scope: ['L1'] }));
    s = { ...s, players: { ...s.players, s01: applyAction(s.class, player(s, 1), { type: 'setDestination', port: 'YOK' }).player } };
    s = teach(s, { type: 'endRound' });
    expect(player(s, 1).game.port).toBe('BUS');
    expect(player(s, 2).game.port).toBe('BUS');
    expect(player(s, 1).game.money).toBe(500);
  });

  it('멱등: 같은 입력 두 번 → 같은 결과', () => {
    let s = startFirstRound(makeSession({ n: 1, scope: ['L1'] }));
    s = editPlayer(s, 1, (p) => {
      p.game.dest = 'HCM';
      p.game.ready = true;
    });
    s = { ...s, class: { ...s.class, phase: 'between' } };
    const once = resolveRounds(s.class, player(s, 1));
    const again = resolveRounds(s.class, player(s, 1));
    expect(again).toEqual(once);
    const twice = resolveRounds(s.class, once.player);
    expect(twice.player).toBe(once.player);
    expect(twice.events).toEqual([]);
  });

  it('놓친 라운드 3개 따라잡기: 첫 라운드에 항해, 나머지는 머무름', () => {
    let s = makeSession({ n: 1, scope: ['L1'] });
    s = editPlayer(s, 1, (p) => {
      p.game.dest = 'PHE';
      p.game.ready = true;
      p.game.resolvedRound = 0;
    });
    const cls = { ...s.class, round: 3, phase: 'between' as const };
    const r = resolveRounds(cls, player(s, 1));
    expect(r.player.game.resolvedRound).toBe(3);
    expect(r.player.game.port).toBe('PHE');
    const kinds = r.events.filter((e) => e.type === 'departed' || e.type === 'stayed').map((e) => `${e.type}:${(e as { round: number }).round}`);
    expect(kinds).toEqual(['departed:1', 'stayed:2', 'stayed:3']);
    expect(r.player.game.money).toBe(500 - voyageCostFor(cls, player(s, 1), 'BUS', 'PHE'));
  });

  it('라운드 진행 중에는 그 라운드를 처리하지 않는다', () => {
    const s = startFirstRound(makeSession({ n: 1, scope: ['L1'] }));
    expect(resolveRounds(s.class, player(s, 1)).player).toBe(player(s, 1));
  });

  it('운항비가 모자라면 목적지를 고를 수 없다 / 순풍이면 0원', () => {
    let s = startFirstRound(makeSession({ n: 1, scope: ['L1'] }));
    s = editPlayer(s, 1, (p) => {
      p.game.money = 5;
      p.game.cargo = [{ good: 'chip', qty: 1, unitCost: 90, origin: 'korea', source: 'specialty', boughtAt: 'BUS' }];
    });
    expect(applyAction(s.class, player(s, 1), { type: 'setDestination', port: 'SHA' }).error).toBe('NO_MONEY');
    s = editPlayer(s, 1, (p) => {
      p.game.effects.tailwind = 1;
    });
    const r = applyAction(s.class, player(s, 1), { type: 'setDestination', port: 'PHE' });
    expect(r.error).toBeUndefined();
    expect(r.events).toContainEqual({ type: 'voyagePreview', to: 'PHE', cost: 0, free: true });
  });

  it('막힌 항구(portClosed)는 고를 수 없다', () => {
    let s = startFirstRound(makeSession({ n: 1, scope: ['L1'] }));
    s = { ...s, class: { ...s.class, activeEffects: [{ id: 'x', source: 'test', effect: { type: 'portClosed', port: 'SHA' }, until: null }] } };
    expect(applyAction(s.class, player(s, 1), { type: 'setDestination', port: 'SHA' }).error).toBe('PORT_CLOSED');
  });

  it('자금 0 · 화물 0 → 긴급 대출(최종 자산에서 뺌)', () => {
    let s = startFirstRound(makeSession({ n: 1, scope: ['L1'] }));
    s = editPlayer(s, 1, (p) => {
      p.game.money = 0;
    });
    const r = applyAction(s.class, player(s, 1), { type: 'requestLoan' });
    expect(r.error).toBeUndefined();
    expect(r.player.game.money).toBe(emergencyLoan.amount);
    expect(r.player.game.loan).toBe(emergencyLoan.amount);
    expect(applyAction(s.class, r.player, { type: 'requestLoan' }).error).toBe('LOAN_NOT_NEEDED');
  });
});
