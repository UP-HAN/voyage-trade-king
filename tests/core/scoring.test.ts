import { describe, expect, it } from 'vitest';
import { seededShuffle } from '../../src/core/rng';
import { assetValue, awards, flatMetrics, leaderboard, leapRatio, metricValue, myRankIfTop, recordBaseAsset } from '../../src/core/scoring';
import type { Player } from '../../src/core/types';
import { AWARD_ORDER, metrics as metricDefs } from '../../src/data/awards';
import { makeSession, player, editPlayer } from './helpers';

function fakeClass(n: number, seed = 7): Player[] {
  let s = makeSession({ n, scope: ['L1'], playUnit: 'unit' });
  const perm = (k: number) => seededShuffle(Array.from({ length: n }, (_, i) => i), seed + k);
  const ex = perm(1);
  const dx = perm(2);
  const cs = perm(3);
  const co = perm(4);
  const qz = perm(5);
  const vs = perm(6);
  const mo = perm(7);
  for (let i = 0; i < n; i++) {
    s = editPlayer(s, i + 1, (p) => {
      // 0번 학생은 모든 지표 1등 → 상 하나만 받고 나머지는 다음 순위로 넘어가야 함
      const top = i === 0;
      p.game.money = 500 + 10 * (top ? n : mo[i]);
      p.game.metrics.baseAsset = 500;
      p.game.metrics.exports = 100 * ((top ? n : ex[i]) + 1);
      p.game.metrics.dex = Array.from({ length: (top ? n : dx[i]) + 1 }, (_, k) => `card-${k}`);
      p.game.metrics.csr = 50 + (top ? n : cs[i]);
      p.game.metrics.coop = (top ? n : co[i]) + 1;
      p.game.metrics.quizRight = (top ? n : qz[i]) + 1;
      p.game.metrics.visited = Array.from({ length: (top ? n : vs[i]) + 1 }, (_, k) => `X${k}`) as never;
    });
  }
  return Object.values(s.players);
}

describe('지표(PRD 6.14.1)', () => {
  it('최종 자산 = 자금 + 남은 화물(산 값×0.5) + 배 값×0.5 − 긴급 대출', () => {
    let s = makeSession({ n: 1 });
    s = editPlayer(s, 1, (p) => {
      p.game.money = 300;
      p.game.loan = 200;
      p.game.ship = 'medium';
      p.game.cargo = [{ good: 'chip', qty: 4, unitCost: 90, origin: 'korea', source: 'specialty', boughtAt: 'BUS' }];
    });
    expect(assetValue(player(s, 1))).toBe(300 + 180 + 400 - 200);
  });

  it('도약 = 최종 자산 ÷ 기준 자산(시작 자금보다 작으면 시작 자금)', () => {
    let s = makeSession({ n: 1 });
    s = editPlayer(s, 1, (p) => {
      p.game.money = 1000;
    });
    expect(leapRatio(player(s, 1))).toBe(2);
    const rec = recordBaseAsset(player(s, 1));
    expect(rec.game.metrics.baseAsset).toBe(1000);
    expect(recordBaseAsset(rec)).toBe(rec);
    expect(metricValue(rec, 'leap')).toBe(1);
    s = editPlayer(s, 1, (p) => {
      p.game.metrics.baseAsset = 200;
    });
    expect(metricValue(player(s, 1), 'leap')).toBe(2); // 기준 200 < 시작 500 → 500 기준
  });
});

describe('순위판(PRD 6.14.2)', () => {
  const players = fakeClass(10);
  it.each([0, 3, 5])('N=%i → 상위 N명만', (n) => {
    const b = leaderboard(players, 'exports', n);
    expect(b).toHaveLength(n);
    b.forEach((e, i) => expect(e.rank).toBe(i + 1));
  });

  it('경계 동점이면 함께 나온다, 출력에 출석번호가 없다', () => {
    const tied = players.map((p, i) => (i === 5 ? { ...p, game: { ...p.game, metrics: { ...p.game.metrics, exports: 0 } } } : p));
    const sorted = [...tied].sort((a, b) => b.game.metrics.exports - a.game.metrics.exports);
    const third = sorted[2];
    const withTie = tied.map((p) => (p.pid === sorted[3].pid ? { ...p, game: { ...p.game, metrics: { ...p.game.metrics, exports: third.game.metrics.exports } } } : p));
    const b = leaderboard(withTie, 'exports', 3);
    expect(b).toHaveLength(4);
    expect(b.map((e) => e.rank)).toEqual([1, 2, 3, 3]);
    expect(JSON.stringify(b)).not.toContain('"seat"');
    expect(Object.keys(b[0]).sort()).toEqual(['company', 'flag', 'pid', 'rank', 'value']);
  });

  it('내 순위는 상위 N 안일 때만', () => {
    const sorted = [...players].sort((a, b) => b.game.metrics.exports - a.game.metrics.exports);
    expect(myRankIfTop(players, sorted[1].seat, 'exports', 3)).toBe(2);
    expect(myRankIfTop(players, sorted[7].seat, 'exports', 3)).toBeNull();
    expect(myRankIfTop(players, sorted[0].seat, 'exports', 0)).toBeNull();
  });
});

describe('시상(PRD 6.14.1)', () => {
  it('30명 가짜 데이터: 상 8개 × 3명 = 서로 다른 24명, 도약상은 무역왕상 바로 앞', () => {
    const players = fakeClass(30);
    const res = awards(players, { perPrize: 3 });
    expect(res.map((r) => r.metric)).toEqual([...AWARD_ORDER]);
    expect(res.map((r) => r.metric).indexOf('leap')).toBe(res.map((r) => r.metric).indexOf('finalAsset') - 1);
    const winners = res.flatMap((r) => r.winners.map((w) => w.pid));
    expect(winners).toHaveLength(24);
    expect(new Set(winners).size).toBe(24);
    // 모든 지표 1등인 학생은 무역왕상(지표 표 첫 줄) 하나만
    const top = players[0].pid;
    expect(res.filter((r) => r.winners.some((w) => w.pid === top)).map((r) => r.metric)).toEqual(['finalAsset']);
    expect(JSON.stringify(res)).not.toContain('"seat"');
  });

  it('동점이면 함께 수상', () => {
    const players = fakeClass(10).map((p) => ({ ...p, game: { ...p.game, metrics: { ...p.game.metrics, csr: 50 } } }));
    players[0] = { ...players[0], game: { ...players[0].game, metrics: { ...players[0].game.metrics, csr: 90 } } };
    const res = awards(players, { perPrize: 1 });
    const csr = res.find((r) => r.metric === 'csr')!;
    // 1등(90)은 이미 무역왕상을 받았으므로 다음 순위(50 동점 전원 중 상이 없는 학생)가 함께 받는다
    expect(csr.winners.length).toBeGreaterThan(1);
    expect(new Set(csr.winners.map((w) => w.value))).toEqual(new Set([50]));
  });

  it('K=1이면 상 8개 × 1명', () => {
    const res = awards(fakeClass(30), { perPrize: 1 });
    expect(res.flatMap((r) => r.winners)).toHaveLength(8);
  });

  it('hideFlatMetrics: L1 차시 판에서 모두 같은 사회적 책임·협력 상은 빠진다', () => {
    let s = makeSession({ n: 30, scope: ['L1'], playUnit: 'lesson' });
    for (let seat = 1; seat <= 30; seat++) {
      s = editPlayer(s, seat, (p) => {
        p.game.money = 400 + seat * 7;
        p.game.metrics.exports = seat * 13;
        p.game.metrics.quizRight = seat % 5;
      });
    }
    const list = Object.values(s.players);
    expect(flatMetrics(list)).toEqual(expect.arrayContaining(['csr', 'coop']));
    const hidden = awards(list, { perPrize: 3, hideFlatMetrics: true }).map((r) => r.metric);
    expect(hidden).not.toContain('csr');
    expect(hidden).not.toContain('coop');
    expect(hidden).toContain('finalAsset');
    const shown = awards(list, { perPrize: 3, hideFlatMetrics: false }).map((r) => r.metric);
    expect(shown).toContain('csr');
    expect(metricDefs.filter((m) => m.mayBeFlat).map((m) => m.id).sort()).toEqual(['coop', 'csr']);
  });
});
