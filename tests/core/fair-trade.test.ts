/**
 * 작업 176 — 같은 거래 반복 '바다 폭풍' + '다양한 무역 보너스'(core).
 * 판정은 호스트만(applyAction ctx.host / hostReduce), 학생 기기 미리 계산(predict)은 기록만.
 */
import { describe, expect, it } from 'vitest';
import { fairTips, fromKey, routeKey, tradedPortCount } from '../../src/core/fairTrade';
import { hostReduce } from '../../src/core/host';
import { quote } from '../../src/core/market';
import { applyAction, predict } from '../../src/core/rules';
import { metricValue } from '../../src/core/scoring';
import { normalizePlayer, normalizeSnapshot } from '../../src/core/state';
import { publicPayload } from '../../src/core/aggregate';
import { resolveRounds } from '../../src/core/voyage';
import { activateMission } from '../../src/core/progress';
import type { CargoLot, ClassState, HostSnapshot, Player } from '../../src/core/types';
import { fairTradeRules as R, fairTipText, fairTradeText } from '../../src/data/fairTrade';
import type { GoodId, PortId } from '../../src/data/types';
import { act, editPlayer, makeSession, player, startFirstRound, teach } from './helpers';

const HOST = { host: true } as const;
/** 최근 센 입항들의 길(입항 순) */
const routesOf = (p: Player) => p.game.fairTrade!.visits.flatMap((v) => v.routes);
/** 끝에서부터 이 길이 이어진 입항 수 */
const streakOf = (p: Player, r: string) => {
  const v = p.game.fairTrade!.visits;
  let n = 0;
  for (let i = v.length - 1; i >= 0 && v[i]!.routes.includes(r); i--) n++;
  return n;
};

const lot = (l: Partial<CargoLot> & Pick<CargoLot, 'good' | 'qty'>): CargoLot => ({
  unitCost: 40, origin: 'korea', source: 'specialty', boughtAt: 'BUS', ...l,
});

/** 1차시 라운드 1, 학생 1(·2)이 port 에 있고 화물 cargo */
function at(port: PortId, cargo: CargoLot[], n = 1, scope: ['L1'] | ['L2'] = ['L1']): HostSnapshot {
  let s = startFirstRound(makeSession({ n, scope }));
  for (let seat = 1; seat <= n; seat++) {
    s = editPlayer(s, seat, (p) => {
      p.game.port = port;
      p.game.visit = { arrival: 1, sold: {}, bought: {} };
      p.game.cargo = cargo.map((c) => ({ ...c }));
      p.game.money = 1000;
    });
  }
  return s;
}

/** 같은 항구에서 한 번 팔기(입항 한도는 새로) */
function sellOnce(cs: ClassState, p: Player, good: GoodId, qty: number, host = true): ReturnType<typeof applyAction> {
  const q: Player = { ...p, game: { ...p.game, visit: { arrival: p.game.visit.arrival + 1, sold: {}, bought: {} } } };
  return applyAction(cs, q, { type: 'sell', good, qty }, host ? HOST : {});
}

/** n번 같은 길로 5상자씩 팔기 */
function sellTimes(cs: ClassState, p: Player, good: GoodId, times: number, qty = 5): Player {
  let cur = p;
  for (let i = 0; i < times; i++) {
    const r = sellOnce(cs, cur, good, qty);
    expect(r.error).toBeUndefined();
    cur = r.player;
  }
  return cur;
}

const withRound = (cs: ClassState, round: number): ClassState => ({ ...cs, round });

describe('길 키', () => {
  it('산 항구 → 상품 → 판 항구, 공장 생산품은 부산 공장', () => {
    expect(routeKey(fromKey({ source: 'specialty', boughtAt: 'BUS' }), 'chip', 'SHA')).toBe('BUS>chip>SHA');
    expect(routeKey(fromKey({ source: 'factory', boughtAt: 'BUS' }), 'steel', 'HCM')).toBe(`${R.factoryFrom}>steel>HCM`);
    expect(routeKey(fromKey({ source: 'relay', boughtAt: 'SIN' }), 'ott', 'SHA')).toBe('SIN>ott>SHA');
  });
});

describe('반복 판정(호스트)', () => {
  it('5상자 미만은 세지 않는다', () => {
    const s = at('SHA', [lot({ good: 'chip', qty: 40 })]);
    const p = sellTimes(s.class, player(s, 1), 'chip', 6, 4);
    expect(routesOf(p)).toEqual([]);
    expect(p.game.fairTrade!.notice).toBeNull();
  });

  it('처음 2번은 괜찮고, 3번 연속이면 갈매기 예보(손해 없음), 4번째에 폭풍(그 항구·그 상품 판매 값 ×0.5)', () => {
    const s = at('SHA', [lot({ good: 'chip', qty: 40 })]);
    const p0 = player(s, 1);
    const normal = quote(s.class, p0, 'SHA', 'chip').sell!;
    const p2 = sellTimes(s.class, p0, 'chip', 2);
    expect(p2.game.fairTrade!.notice).toBeNull();
    const r3 = sellOnce(s.class, p2, 'chip', 5);
    expect(r3.events).toContainEqual({ type: 'fairForecast', route: 'BUS>chip>SHA' });
    expect(r3.player.game.fairTrade!.notice?.kind).toBe('forecast');
    expect(r3.player.game.effects.storm ?? null).toBeNull();
    expect(quote(s.class, r3.player, 'SHA', 'chip').sell).toBe(normal);
    const r4 = sellOnce(s.class, r3.player, 'chip', 5);
    // 4번째 판매 값은 그대로(폭풍은 다음 판매부터)
    expect(r4.events).toContainEqual({ type: 'stamp', kind: 'export', good: 'chip', qty: 5, amount: normal * 5 });
    expect(r4.events.some((e) => e.type === 'fairStorm')).toBe(true);
    const p4 = r4.player;
    expect(p4.game.effects.storm).toEqual({ port: 'SHA', good: 'chip', untilRound: 2 });
    expect(p4.game.fairTrade!.storms).toBe(1);
    expect(p4.game.fairTrade!.notice?.kind).toBe('storm');
    const q = quote(s.class, p4, 'SHA', 'chip');
    expect(q.storm).toBe(true);
    expect(q.sell).toBe(Math.max(1, Math.round(normal * 0.5)));
    // 그 상품을 다른 항구에, 다른 상품을 그 항구에 팔면 손해 없음
    expect(quote(s.class, p4, 'YOK', 'chip').storm).toBe(false);
    expect(quote(s.class, p4, 'SHA', 'car').storm).toBe(false);
    // 다른 학생은 손해 없음
    expect(quote(s.class, player(at('SHA', [lot({ good: 'chip', qty: 5 })], 2), 2), 'SHA', 'chip').storm).toBe(false);
    // 돈·화물을 빼지 않는다
    expect(p4.game.money).toBeGreaterThan(p0.game.money);
    expect(p4.game.cargo.reduce((n, l) => n + l.qty, 0)).toBe(20);
    // 폭풍이 오면 그 길 기록을 비운다
    expect(routesOf(p4)).toEqual([]);
    expect(p4.game.fairTrade!.counts['BUS>chip>SHA']).toBeUndefined();
  });

  it('같은 입항에서 같은 길로 나눠 판 것(5+5+5+5)은 한 번 거래로 센다', () => {
    const s = at('SHA', [lot({ good: 'chip', qty: 40 })]);
    let p = player(s, 1);
    for (let i = 0; i < 4; i++) {
      const r = applyAction(s.class, p, { type: 'sell', good: 'chip', qty: 5 }, HOST);
      expect(r.error).toBeUndefined();
      p = r.player;
    }
    expect(routesOf(p)).toEqual(['BUS>chip>SHA']);
    expect(p.game.fairTrade!.notice).toBeNull();
  });

  it('다른 길이 끼면 연속 수는 0부터(A A B A → 예보 없음)', () => {
    const s = at('SHA', [lot({ good: 'chip', qty: 40 }), lot({ good: 'car', qty: 40 })]);
    let p = sellTimes(s.class, player(s, 1), 'chip', 2);
    p = sellTimes(s.class, p, 'car', 1);
    p = sellTimes(s.class, p, 'chip', 1);
    expect(streakOf(p, 'BUS>chip>SHA')).toBe(1);
    expect(p.game.fairTrade!.notice).toBeNull();
  });

  it('주기적: 최근 6번 중 같은 길 4번이면(사이에 다른 거래가 끼어도) 예보, 그다음 폭풍', () => {
    const s = at('SHA', [lot({ good: 'chip', qty: 60 }), lot({ good: 'car', qty: 40 })]);
    let p = sellTimes(s.class, player(s, 1), 'chip', 2);
    p = sellTimes(s.class, p, 'car', 1);
    p = sellTimes(s.class, p, 'chip', 1);
    expect(p.game.fairTrade!.notice).toBeNull();
    p = sellTimes(s.class, p, 'chip', 1); // 최근 [A A B A A] → A 4번
    expect(p.game.fairTrade!.notice?.kind).toBe('forecast');
    p = sellTimes(s.class, p, 'car', 1);
    const r = sellOnce(s.class, p, 'chip', 5); // [A B A A B A] → A 4번, 예보 받은 길
    expect(r.player.game.fairTrade!.notice?.kind).toBe('storm');
  });

  it('되팔기·처음 화물은 세지 않는다', () => {
    let s = at('SHA', [lot({ good: 'chip', qty: 40, start: true })]);
    const p = sellTimes(s.class, player(s, 1), 'chip', 4);
    expect(routesOf(p)).toEqual([]);
    expect(p.game.fairTrade!.ports).toEqual(['SHA']); // 판 항구는 거래한 항구
    // 되팔기: 상하이에서 흑연을 사서 되팔기 4번 → 기록 없음
    s = at('SHA', [], 1, ['L2']);
    let q = player(s, 1);
    for (let i = 0; i < 4; i++) {
      q = { ...q, game: { ...q.game, visit: { arrival: i + 2, sold: {}, bought: {} } } };
      const b = applyAction(s.class, q, { type: 'buy', good: 'graphite', qty: 5 }, HOST);
      expect(b.error).toBeUndefined();
      const r = applyAction(s.class, b.player, { type: 'resell', good: 'graphite', qty: 5 }, HOST);
      expect(r.error).toBeUndefined();
      q = r.player;
    }
    expect(routesOf(q)).toEqual([]);
    expect(q.game.fairTrade!.goods).toEqual([]);
    expect(q.game.fairTrade!.ports).toEqual([]);
  });

  it('임무를 처음 채우는 판매(M-GAS·M-IPE 수출·M-RELAY·M-EXPORT4)는 세지 않고, 끝낸 뒤 같은 길은 센다', () => {
    // M-GAS: 포트헤들랜드 천연가스 → 부산
    let s = at('BUS', [lot({ good: 'gas', qty: 40, origin: 'foreign', boughtAt: 'PHE' })]);
    s = editPlayer(s, 1, (p) => activateMission(p, 'M-GAS'));
    let p = sellTimes(s.class, player(s, 1), 'gas', 1);
    expect(p.game.missions['M-GAS']?.status).toBe('done');
    expect(routesOf(p)).toEqual([]);
    p = sellTimes(s.class, p, 'gas', 1);
    expect(routesOf(p)).toEqual(['PHE>gas>BUS']);
    // M-IPE 수출 단계: 공장 철강 → 호찌민
    s = at('HCM', [lot({ good: 'steel', qty: 40, source: 'factory' })], 1, ['L2']);
    s = editPlayer(s, 1, (q) => {
      activateMission(q, 'M-IPE');
      q.game.missions['M-IPE']!.steps = [true, true, false];
    });
    p = sellTimes(s.class, player(s, 1), 'steel', 1);
    expect(p.game.missions['M-IPE']?.status).toBe('done');
    expect(routesOf(p)).toEqual([]);
    p = sellTimes(s.class, p, 'steel', 1);
    expect(routesOf(p)).toEqual([`${R.factoryFrom}>steel>HCM`]);
    // M-RELAY: 싱가포르에서 산 것 → 다른 나라
    s = at('SHA', [lot({ good: 'chip', qty: 40, origin: 'foreign', source: 'relay', boughtAt: 'SIN' })], 1, ['L2']);
    s = editPlayer(s, 1, (q) => activateMission(q, 'M-RELAY'));
    p = sellTimes(s.class, player(s, 1), 'chip', 1);
    expect(p.game.missions['M-RELAY']?.status).toBe('done');
    expect(routesOf(p)).toEqual([]);
    // M-EXPORT4: 그 유형 칸을 처음 채우는 판매(쌀 — 농산물)
    s = at('YOK', [lot({ good: 'rice', qty: 40, origin: 'foreign', boughtAt: 'HCM' })], 1, ['L2']);
    s = editPlayer(s, 1, (q) => activateMission(q, 'M-EXPORT4'));
    p = sellTimes(s.class, player(s, 1), 'rice', 1);
    expect(p.game.missions['M-EXPORT4']?.steps[0]).toBe(true);
    expect(routesOf(p)).toEqual([]);
    p = sellTimes(s.class, p, 'rice', 1);
    expect(routesOf(p)).toEqual(['HCM>rice>YOK']);
  });

  it('학생 기기 미리 계산(predict)은 판정하지 않는다', () => {
    const s = at('SHA', [lot({ good: 'chip', qty: 40 })]);
    let p = player(s, 1);
    for (let i = 0; i < 4; i++) p = sellOnce(s.class, p, 'chip', 5, false).player;
    expect(routesOf(p)).toEqual([]);
    expect(p.game.effects.storm ?? null).toBeNull();
    expect(predict(p, s.class, { type: 'sell', good: 'chip', qty: 5 }).player.game.fairTrade!.notice).toBeNull();
  });
});

describe('폭풍 상한·끝', () => {
  it('untilRound(다음 라운드 끝) 뒤 라운드 처리에서 저절로 사라진다', () => {
    const s = at('SHA', [lot({ good: 'chip', qty: 40 })]);
    const p = sellTimes(s.class, player(s, 1), 'chip', 4);
    expect(p.game.effects.storm?.untilRound).toBe(2);
    // 라운드 1 끝 → 그대로, 라운드 2 끝 → 사라짐
    const after1 = resolveRounds({ ...s.class, phase: 'between', round: 1 }, p).player;
    expect(after1.game.effects.storm).not.toBeNull();
    expect(quote({ ...s.class, round: 2 }, after1, 'SHA', 'chip').storm).toBe(true);
    const after2 = resolveRounds({ ...s.class, phase: 'between', round: 2 }, after1).player;
    expect(after2.game.effects.storm).toBeNull();
    expect(quote({ ...s.class, round: 3 }, after2, 'SHA', 'chip').storm).toBe(false);
  });

  it('한 라운드 1번, 폭풍 뒤 1라운드 쉼, 한 판 3번까지 — 3번을 다 받으면 예보 카드만', () => {
    const s = at('SHA', [lot({ good: 'chip', qty: 200 }), lot({ good: 'car', qty: 200 })]);
    let p = sellTimes(withRound(s.class, 1), player(s, 1), 'chip', 4);
    expect(p.game.fairTrade!.storms).toBe(1);
    // 같은 라운드·다음 라운드: 다른 길로 4번이어도 예보·폭풍 없음
    const n0 = p.game.fairTrade!.notice!.n;
    p = sellTimes(withRound(s.class, 1), p, 'car', 4);
    p = sellTimes(withRound(s.class, 2), p, 'car', 4);
    expect(p.game.fairTrade!.notice!.n).toBe(n0);
    expect(p.game.fairTrade!.storms).toBe(1);
    // 라운드 3: car 연속(이미 7번 셈) → 이번 판매로 예보(아직 예보 받지 않은 길)
    p = sellTimes(withRound(s.class, 3), p, 'car', 1);
    expect(p.game.fairTrade!.notice!.kind).toBe('forecast');
    p = sellTimes(withRound(s.class, 3), p, 'car', 1);
    expect(p.game.fairTrade!.storms).toBe(2);
    // 라운드 5: chip 4번 → 3번째 폭풍
    p = { ...p, game: { ...p.game, effects: { ...p.game.effects, storm: null } } };
    p = sellTimes(withRound(s.class, 5), p, 'chip', 4);
    expect(p.game.fairTrade!.storms).toBe(3);
    // 라운드 7: 더는 폭풍 없음 — 예보만 계속(손해 없음)
    p = { ...p, game: { ...p.game, effects: { ...p.game.effects, storm: null } } };
    p = sellTimes(withRound(s.class, 7), p, 'car', 6);
    expect(p.game.fairTrade!.storms).toBe(3);
    expect(p.game.fairTrade!.notice!.kind).toBe('forecast');
    expect(p.game.effects.storm).toBeNull();
  });

  it('폭풍 중 판매로 돈이 음수가 되지 않는다(판매 값 1 이상)', () => {
    const s = at('SHA', [lot({ good: 'chip', qty: 40 })]);
    let p = sellTimes(s.class, player(s, 1), 'chip', 4);
    p = { ...p, game: { ...p.game, money: 0 } };
    const r = sellOnce(s.class, p, 'chip', 5);
    expect(r.error).toBeUndefined();
    expect(r.player.game.money).toBeGreaterThan(0);
  });
});

describe('다양한 무역 보너스', () => {
  it('거래한 나라 3·5곳, 판 상품 3종에 닿을 때 +30만 원 한 번씩(중복 없음), 부산·되팔기 제외', () => {
    const goods: GoodId[] = ['chip', 'car', 'phone'];
    const s = at('SHA', goods.map((g) => lot({ good: g, qty: 50 })));
    let p = player(s, 1);
    const sellAt = (port: PortId, good: GoodId, qty = 1) => {
      p = { ...p, game: { ...p.game, port, visit: { arrival: p.game.visit.arrival + 1, sold: {}, bought: {} } } };
      const r = applyAction(s.class, p, { type: 'sell', good, qty }, HOST);
      expect(r.error, `${port} ${good}`).toBeUndefined();
      p = r.player;
      return r.events.filter((e) => e.type === 'fairBonus');
    };
    expect(sellAt('SHA', 'chip')).toEqual([]);
    expect(sellAt('YOK', 'chip')).toEqual([]);
    expect(sellAt('HCM', 'chip')).toEqual([{ type: 'fairBonus', kind: 'ports', step: 3, amount: R.bonusAmount }]);
    expect(sellAt('HCM', 'chip')).toEqual([]);
    expect(sellAt('HCM', 'car')).toEqual([]);
    expect(sellAt('HCM', 'phone')).toEqual([{ type: 'fairBonus', kind: 'goods', step: 3, amount: R.bonusAmount }]);
    expect(p.game.fairTrade!.ports).toEqual(['SHA', 'YOK', 'HCM']);
    expect(p.game.fairTrade!.bonus).toEqual(['ports:3', 'goods:3']);
    expect(tradedPortCount(p)).toBe(4);
    expect(metricValue(p, 'explore')).toBe(4);
    // 들르기만 한 항구는 개척에 들지 않는다
    p = { ...p, game: { ...p.game, metrics: { ...p.game.metrics, visited: ['BUS', 'SHA', 'YOK', 'HCM', 'BKK', 'PHE'] } } };
    expect(metricValue(p, 'explore')).toBe(4);
  });

  it('산 항구도 그 상품을 다른 곳에 팔면 거래한 나라(되팔기·처음 화물·부산은 제외)', () => {
    const s = at('YOK', [lot({ good: 'rice', qty: 5, origin: 'foreign', boughtAt: 'HCM' }), lot({ good: 'crude', qty: 5, origin: 'foreign', boughtAt: 'DAM', start: true })]);
    let r = applyAction(s.class, player(s, 1), { type: 'sell', good: 'rice', qty: 1 }, HOST);
    expect(r.player.game.fairTrade!.ports).toEqual(['YOK', 'HCM']);
    r = applyAction(s.class, r.player, { type: 'sell', good: 'crude', qty: 1 }, HOST);
    expect(r.player.game.fairTrade!.ports).toEqual(['YOK', 'HCM']);
  });

  it('보너스는 모두에게 같은 크기, 단계는 3·5·7·9 — 최대 8번 240만 원', () => {
    expect(R.bonusSteps).toEqual([3, 5, 7, 9]);
    expect(R.bonusAmount).toBe(30);
    expect(R.bonusSteps.length * 2 * R.bonusAmount).toBe(240);
    expect(fairTradeText.progress(4, 2)).toBe('거래한 나라 4/5 · 판 상품 2/3');
    expect(fairTradeText.bonus('ports', 5, 30)).toBe('다양한 무역 보너스! 새 나라 5곳과 거래했어요 +30만 원');
  });
});

describe('교사 끄기·호스트·복구·공개 범위', () => {
  function hostRun(s: HostSnapshot, times: number, good: GoodId = 'chip'): HostSnapshot {
    for (let i = 0; i < times; i++) {
      s = editPlayer(s, 1, (p) => {
        p.game.visit = { arrival: p.game.visit.arrival + 1, sold: {}, bought: {} };
      });
      const r = act(s, 1, { type: 'sell', good, qty: 5 }, i + 1);
      expect(r.snapshot.players.s01.rev).toBeGreaterThan(s.players.s01.rev);
      s = r.snapshot;
    }
    return s;
  }

  it('호스트 리듀서로 4번 → 폭풍, 공개 상태엔 stormNews 한 비트만(누구·길·상품 없음)', () => {
    let s = at('SHA', [lot({ good: 'chip', qty: 40 })], 2);
    s = hostRun(s, 4);
    expect(player(s, 1).game.fairTrade!.storms).toBe(1);
    const pub = publicPayload(s);
    expect(pub.public.stormNews).toBe(true);
    const json = JSON.stringify(pub);
    for (const bad of ['"fairTrade":{', 'storms', 'BUS>chip', 'untilRound', 'notice', '"seat"']) expect(json).not.toContain(bad);
    // 공개 학급 상태의 settings.fairTrade(켜짐 여부)만 있다
    expect(pub.class.settings.fairTrade).toBe(true);
    // 다른 라운드면 띠 없음
    expect(publicPayload({ ...s, class: { ...s.class, round: 2 } }).public.stormNews).toBeUndefined();
  });

  it('교사가 끄면 판정·보너스가 멈추고(이미 받은 보너스는 그대로), 다시 켜면 이어진다', () => {
    let s = at('SHA', [lot({ good: 'chip', qty: 40 })]);
    s = teach(s, { type: 'updateSettings', settings: { fairTrade: false } });
    expect(s.class.settings.fairTrade).toBe(false);
    s = hostRun(s, 6);
    const ft = player(s, 1).game.fairTrade!;
    expect(ft.visits).toEqual([]);
    expect(ft.notice).toBeNull();
    expect(ft.ports).toEqual(['SHA']); // 개척 기록은 계속
    s = teach(s, { type: 'updateSettings', settings: { fairTrade: true } });
    expect(s.class.settings.fairTrade).toBe(true);
  });

  it('판을 만들 때 끈 판(fairTrade:false)은 처음부터 판정 없음', () => {
    let s = startFirstRound((() => {
      const base = makeSession({ n: 0 });
      return { ...base, class: { ...base.class, settings: { ...base.class.settings, fairTrade: false } } };
    })());
    s = hostReduce(s, { type: 'join', seat: 1, pid: 'p01qz', companyName: '해오름1', nameKey: '해오름1' }, 0).snapshot;
    s = editPlayer(s, 1, (p) => {
      p.game.port = 'SHA';
      p.game.cargo = [lot({ good: 'chip', qty: 40 })];
    });
    s = hostRun(s, 4);
    expect(player(s, 1).game.fairTrade!.storms).toBe(0);
  });

  it('새로 고침·재접속: 스냅숏 JSON 왕복 뒤 연속 수·폭풍 효과·받은 보너스가 그대로', () => {
    let s = at('SHA', [lot({ good: 'chip', qty: 60 })]);
    s = hostRun(s, 3);
    const back = normalizeSnapshot(JSON.parse(JSON.stringify(s)))!;
    expect(player(back, 1).game.fairTrade).toEqual(player(s, 1).game.fairTrade);
    const s2 = hostRun(back, 1);
    expect(player(s2, 1).game.effects.storm).toEqual({ port: 'SHA', good: 'chip', untilRound: 2 });
    const back2 = normalizeSnapshot(JSON.parse(JSON.stringify(s2)))!;
    expect(player(back2, 1).game.effects.storm).toEqual({ port: 'SHA', good: 'chip', untilRound: 2 });
    expect(player(back2, 1).game.fairTrade).toEqual(player(s2, 1).game.fairTrade);
  });

  it('옛 저장본(새 칸 없음) → 기본값, 판매 기록에서 거래한 항구·판 상품만 되살리고 그만큼 보너스는 받은 것으로', () => {
    const s = at('SHA', [lot({ good: 'chip', qty: 40 })]);
    const raw = JSON.parse(JSON.stringify(player(s, 1)));
    delete raw.game.fairTrade;
    delete raw.game.effects.storm;
    raw.game.log = [
      { round: 1, stage: 'L1', kind: 'sell', good: 'chip', qty: 1, port: 'SHA', amount: 50 },
      { round: 1, stage: 'L1', kind: 'sell', good: 'car', qty: 1, port: 'YOK', amount: 50 },
      { round: 1, stage: 'L1', kind: 'sell', good: 'phone', qty: 1, port: 'BUS', amount: 50 },
      { round: 1, stage: 'L1', kind: 'resell', good: 'rice', qty: 1, port: 'HCM', amount: 5 },
    ];
    const p = normalizePlayer(raw);
    expect(p.game.effects.storm).toBeNull();
    expect(p.game.fairTrade).toMatchObject({ visits: [], storms: 0, notice: null, ports: ['SHA', 'YOK'], goods: ['chip', 'car', 'phone'], bonus: ['goods:3'] });
    // 옛 판 설정(fairTrade 없음) → 켬
    const snapRaw = JSON.parse(JSON.stringify(s));
    delete snapRaw.class.settings.fairTrade;
    expect(normalizeSnapshot(snapRaw)!.class.settings.fairTrade).toBe(true);
    // 망가진 값은 기본값
    const bad = normalizePlayer({ ...raw, game: { ...raw.game, fairTrade: { visits: 3, counts: { a: 'x' }, notice: { kind: 'boom' } }, effects: { storm: { port: 1 } } } });
    expect(bad.game.fairTrade).toMatchObject({ visits: [], counts: {}, notice: null });
    expect(bad.game.effects.storm).toBeNull();
  });
});

describe('피하는 길 추천', () => {
  it('열린 항구·보이는 상품만, 폭풍 상품·잠긴 항구 없음, 쉬운 말', () => {
    const s = at('SHA', [lot({ good: 'chip', qty: 40 })], 1, ['L2']);
    expect(s.class.openPorts).not.toContain('SIN'); // 기본 makeSession L2 = 'all' 판(싱가포르는 ⑥ 뒤)
    const tips = fairTips(s.class, player(s, 1), { from: 'BUS', good: 'chip', to: 'SHA' });
    expect(tips.length).toBe(2);
    for (const t of tips) {
      if (t.kind === 'good') {
        expect(t.good).not.toBe('chip');
        expect(s.class.openPorts).toContain(t.buyAt);
        expect(s.class.openPorts).toContain(t.sellAt);
      } else {
        expect(s.class.openPorts).toContain(t.port);
        expect(t.port).not.toBe('SHA');
      }
      const text = fairTipText(t);
      expect(text).not.toMatch(/선택|패널티|반칙|임계/);
    }
  });

  it('학생 문구에 금지 낱말이 없다', () => {
    const all = [
      fairTradeText.forecast('BUS', 'chip', 'SHA'), fairTradeText.forecastTry, fairTradeText.storm('chip', 'SHA'), fairTradeText.stormLesson,
      fairTradeText.marketTag, fairTradeText.bonus('ports', 3, 30), fairTradeText.bonus('goods', 3, 30), fairTradeText.tvNews, fairTradeText.ruleLine,
    ];
    for (const t of all) expect(t).not.toMatch(/선택|패널티|반칙|임계/);
    expect(fairTradeText.forecast('BUS', 'chip', 'SHA')).toContain('반도체를 팔면');
  });
});

describe('검증 177 반영', () => {
  /** 한 입항: 입항 번호를 올리고 그 항구에서 차례로 판다 */
  function visit(cs: ClassState, p: Player, port: PortId, sells: [GoodId, number][]): Player {
    let cur: Player = { ...p, game: { ...p.game, port, visit: { arrival: p.game.visit.arrival + 1, sold: {}, bought: {} } } };
    for (const [g, q] of sells) {
      const r = applyAction(cs, cur, { type: 'sell', good: g, qty: q }, HOST);
      expect(r.error, `${port} ${g}`).toBeUndefined();
      cur = r.player;
    }
    return cur;
  }
  const n = (p: Player) => p.game.fairTrade!.notice?.n ?? 0;

  it('① 판 중에 끄면 이미 온 폭풍의 반값·TV 띠·학생 카드 조건이 바로 풀린다(다시 켜면 남은 untilRound 동안 다시 적용)', () => {
    let s = at('SHA', [lot({ good: 'chip', qty: 40 })], 2);
    s = editPlayer(s, 1, (p) => {
      p.game.fairTrade!.storms = 1;
      p.game.fairTrade!.lastStormRound = 1;
      p.game.effects.storm = { port: 'SHA', good: 'chip', untilRound: 2 };
    });
    const normal = quote(s.class, player(s, 2), 'SHA', 'chip').sell!;
    expect(quote(s.class, player(s, 1), 'SHA', 'chip').storm).toBe(true);
    expect(publicPayload(s).public.stormNews).toBe(true);
    const off = teach(s, { type: 'updateSettings', settings: { fairTrade: false } });
    const q = quote(off.class, player(off, 1), 'SHA', 'chip');
    expect(q.storm).toBe(false);
    expect(q.sell).toBe(normal);
    expect(publicPayload(off).public.stormNews).toBeUndefined();
    // 끈 뒤 판매는 원래 값
    const r = applyAction(off.class, player(off, 1), { type: 'sell', good: 'chip', qty: 5 }, HOST);
    expect(r.events).toContainEqual({ type: 'stamp', kind: 'export', good: 'chip', qty: 5, amount: normal * 5 });
    // 다시 켜면 아직 남은 폭풍은 다시 적용(가장 단순한 쪽 — result.md)
    const on = teach(off, { type: 'updateSettings', settings: { fairTrade: true } });
    expect(quote(on.class, player(on, 1), 'SHA', 'chip').storm).toBe(true);
  });

  it('② 한 입항에서 두 상품을 섞어 눌러도(칩5·차5·칩5) 같은 길은 그 입항에 한 번만 센다', () => {
    const s = at('BUS', [lot({ good: 'chip', qty: 100 }), lot({ good: 'car', qty: 100 })]);
    let p = player(s, 1);
    for (let i = 1; i <= 2; i++) {
      p = visit(s.class, p, 'HCM', [['chip', 5], ['car', 5], ['chip', 5]]);
      p = visit(s.class, p, 'BUS', []);
      expect(p.game.fairTrade!.counts['BUS>chip>HCM']).toBe(i);
      expect(n(p)).toBe(0);
    }
    p = visit(s.class, p, 'HCM', [['chip', 5], ['car', 5], ['chip', 5]]);
    expect(p.game.fairTrade!.counts['BUS>chip>HCM']).toBe(3);
  });

  it('③ 임무를 끝내는 입항에서 5+5로 나눠 팔아도 그 입항의 같은 길은 세지 않는다', () => {
    let s = at('PHE', [lot({ good: 'gas', qty: 40, origin: 'foreign', boughtAt: 'PHE' })]);
    s = editPlayer(s, 1, (p) => activateMission(p, 'M-GAS'));
    let p = visit(s.class, player(s, 1), 'BUS', [['gas', 5], ['gas', 5]]);
    expect(p.game.missions['M-GAS']?.status).toBe('done');
    expect(routesOf(p)).toEqual([]);
    p = visit(s.class, p, 'PHE', []);
    p = visit(s.class, p, 'BUS', [['gas', 5], ['gas', 5]]);
    expect(routesOf(p)).toEqual(['PHE>gas>BUS']);
    expect(p.game.fairTrade!.counts['PHE>gas>BUS']).toBe(1);
  });

  it('④ 같은 길로 두 상품을 함께 실어 다녀도(부산→포트헤들랜드 자동차+칩) 3번째 입항에 예보, 4번째에 폭풍', () => {
    const s = at('BUS', [lot({ good: 'car', qty: 100 }), lot({ good: 'chip', qty: 100 })]);
    let p = player(s, 1);
    for (let i = 1; i <= 4; i++) {
      p = visit(s.class, p, 'PHE', [['car', 5], ['chip', 5]]);
      if (i < 3) expect(n(p)).toBe(0);
      if (i === 3) expect(p.game.fairTrade!.notice?.kind).toBe('forecast');
      p = visit(s.class, p, 'BUS', []);
    }
    expect(p.game.fairTrade!.storms).toBe(1);
    expect(p.game.effects.storm?.port).toBe('PHE');
  });

  it('④ 오탐 없음: 서로 다른 항구에서 산 여러 상품을 한 항구에 나눠 팔기(길마다 2번까지)·공장 생산품을 매번 다른 나라에 수출', () => {
    const goods: CargoLot[] = [
      lot({ good: 'rice', qty: 50, origin: 'foreign', boughtAt: 'HCM' }), lot({ good: 'clothes', qty: 50, origin: 'foreign', boughtAt: 'SHA' }),
      lot({ good: 'chip', qty: 50 }), lot({ good: 'car', qty: 50 }), lot({ good: 'phone', qty: 50 }),
      lot({ good: 'rice', qty: 50, origin: 'foreign', boughtAt: 'BKK' }),
    ];
    const s = at('BUS', goods, 1, ['L2']);
    let p = player(s, 1);
    // 6입항: 요코하마·호찌민 등에 두 가지씩, 같은 길은 두 번까지
    const plan: [PortId, [GoodId, number][]][] = [
      ['YOK', [['rice', 5], ['chip', 5]]], ['HCM', [['car', 5], ['phone', 5]]], ['PHE', [['car', 5], ['chip', 5]]],
      ['YOK', [['rice', 5]]], ['HCM', [['chip', 5], ['phone', 5]]], ['PHE', [['phone', 5], ['rice', 5]]],
    ];
    for (const [port, sells] of plan) {
      p = visit(s.class, p, port, sells);
      p = visit(s.class, p, 'BUS', []);
    }
    expect(n(p)).toBe(0);
    // 공장 철강을 매번 다른 나라에
    const f = at('BUS', [lot({ good: 'steel', qty: 60, source: 'factory' })], 1, ['L2']);
    let q = player(f, 1);
    for (const port of ['HCM', 'YOK', 'JKT', 'DAM', 'MUM', 'HCM'] as PortId[]) {
      q = visit(f.class, q, port, [['steel', 5]]);
      q = visit(f.class, q, 'BUS', []);
    }
    expect(n(q)).toBe(0);
    expect(q.game.fairTrade!.storms).toBe(0);
  });

  it('⑤ 폭풍 상한(3번)에 닿은 뒤에는 예보 카드가 판매마다 새로 뜨지 않는다', () => {
    const s = at('SHA', [lot({ good: 'chip', qty: 200 })]);
    let p = player(s, 1);
    p = { ...p, game: { ...p.game, fairTrade: { ...p.game.fairTrade!, storms: 3, lastStormRound: -5 } } };
    p = sellTimes(withRound(s.class, 9), p, 'chip', 3);
    expect(p.game.fairTrade!.notice?.kind).toBe('forecast');
    const n0 = n(p);
    p = sellTimes(withRound(s.class, 9), p, 'chip', 5);
    expect(n(p)).toBe(n0);
    expect(p.game.fairTrade!.storms).toBe(3);
    expect(p.game.effects.storm ?? null).toBeNull();
  });
});
