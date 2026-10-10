import { describe, expect, it } from 'vitest';
import { goods, goodsById, L1_GOODS } from '../../src/data/goods';
import { AICHIP_HOT_PORTS, marketByPort, marketTable, priceMultipliers, PRICE_JITTER, tariffRate, tradeLimits } from '../../src/data/market';
import { ports, portsById, portsOpenedIn } from '../../src/data/ports';
import { distanceSteps, VOYAGE_COST_PER_STEP } from '../../src/data/routes';
import { shipsById } from '../../src/data/ships';
import type { GoodId, PortId } from '../../src/data/types';

describe('상품 21종(PRD 6.4.1) — 표본 대조', () => {
  it('21종, L1 공개 11종', () => {
    expect(goods).toHaveLength(21);
    expect([...L1_GOODS].sort()).toEqual(['car', 'chem', 'chip', 'clothes', 'gas', 'graphite', 'iron', 'kcon', 'phone', 'rice', 'robot'].sort());
  });
  it.each([
    ['crude', '원유', 'goods', 60, ['DAM', 'LAX'], 'L2'],
    ['graphite', '흑연', 'goods', 40, ['SHA'], 'L1'],
    ['ott', '온라인 동영상 서비스', 'service', 100, ['LAX'], 'L2'],
    ['battery', '배터리', 'goods', 250, [], 'L2'],
    ['aichip', 'AI 반도체', 'goods', 400, [], 'L3'],
    ['kcon', 'K-콘텐츠(드라마·예능)', 'service', 80, ['BUS'], 'L1'],
  ] as const)('%s', (id, name, form, V, sp, lesson) => {
    const g = goodsById[id];
    expect(g).toMatchObject({ name, form, V, unlockLesson: lesson });
    expect([...g.specialtyPorts].sort()).toEqual([...sp].sort());
  });
});

describe('[게임 설정] 표시', () => {
  it('의류의 상하이 특산은 게임 설정', () => {
    expect(goodsById.clothes.gameRule).toBe(true);
    expect(goodsById.clothes.gameRuleNote).toMatch(/상하이/);
  });
  it('항구마다 cheapReasons 근거(쪽수 또는 게임 설정)가 있다', () => {
    for (const p of ports) {
      const b = p.cheapReasonsBasis;
      expect(b.note.length, p.id).toBeGreaterThan(0);
      if (!b.gameRule) expect(b.pages.length, p.id).toBeGreaterThan(0);
    }
  });
});

describe('항구 12곳(PRD 6.3.2) — 표본 대조', () => {
  it.each([
    ['BUS', '부산', '대한민국', 129.2, 34.9, 1492, 351, 'L1'],
    ['PHE', '포트헤들랜드', '오스트레일리아', 118.6, -19.6, 1386, 896, 'L1'],
    ['SIN', '싱가포르', '싱가포르', 104.0, 1.2, 1240, 688, 'L2'],
    ['ROT', '로테르담', '네덜란드', 3.6, 52.2, 236, 178, 'L2'],
    ['LAX', '로스앤젤레스', '미국', -118.5, 33.5, 2615, 365, 'L2'],
  ] as const)('%s', (id, name, country, lon, lat, x, y, lesson) => {
    expect(portsById[id]).toMatchObject({ name, country, lon, lat, x, y, unlockLesson: lesson });
  });
  it('좌표가 PRD 6.3.1 투영과 ±10 이내로 맞다', () => {
    for (const p of ports) {
      const lonE = p.lon < -20 ? p.lon + 360 : p.lon;
      expect(Math.abs(p.x - (lonE + 20) * 10), p.id).toBeLessThanOrEqual(10);
      expect(Math.abs(p.y - (70 - p.lat) * 10), p.id).toBeLessThanOrEqual(10);
    }
  });
  it('L1 6곳·L2 6곳', () => {
    expect(portsOpenedIn('L1').sort()).toEqual(['BKK', 'BUS', 'HCM', 'PHE', 'SHA', 'YOK']);
    expect(portsOpenedIn('L2')).toHaveLength(6);
  });
});

describe('시장표(PRD 6.5.2) — 표본 대조', () => {
  const same = (a: readonly string[], b: readonly string[]) => expect([...a].sort()).toEqual([...b].sort());
  it('부산: S 4종 + 국내산 흑연, L1 동안 천연가스 H', () => {
    const r = marketByPort.BUS;
    same(r.S, ['chip', 'car', 'phone', 'kcon']);
    same(r.domesticBuy, ['graphite']);
    expect(r.stageHot).toEqual([{ good: 'gas', lesson: 'L1' }]);
    expect(r.N).toContain('gas');
    same(r.N, ['crude', 'gas', 'iron', 'nickel', 'chem', 'rice', 'wood', 'clothes', 'robot', 'vaccine', 'ott', 'program', 'oilp', 'steel', 'battery']);
  });
  it('상하이', () => {
    same(marketByPort.SHA.S, ['graphite', 'clothes']);
    same(marketByPort.SHA.H, ['chip', 'battery', 'aichip']);
    same(marketByPort.SHA.N, ['car', 'phone', 'crude', 'iron', 'gas', 'robot', 'kcon']);
  });
  it('호찌민', () => {
    same(marketByPort.HCM.S, ['rice', 'clothes']);
    same(marketByPort.HCM.H, ['steel', 'phone', 'oilp']);
    same(marketByPort.HCM.N, ['chip', 'car', 'kcon', 'vaccine']);
  });
  it('싱가포르: R 6종 + 그 밖의 모든 상품 N, H 없음', () => {
    same(marketByPort.SIN.R, ['crude', 'graphite', 'clothes', 'robot', 'rice', 'nickel']);
    expect(marketByPort.SIN.H).toHaveLength(0);
    expect(marketByPort.SIN.N.length + marketByPort.SIN.R.length).toBe(21);
  });
  it('담맘', () => {
    same(marketByPort.DAM.S, ['crude']);
    same(marketByPort.DAM.H, ['car', 'rice']);
    same(marketByPort.DAM.N, ['steel', 'phone', 'kcon', 'clothes', 'wood']);
  });
  it('로스앤젤레스', () => {
    same(marketByPort.LAX.S, ['crude', 'gas', 'ott', 'program']);
    same(marketByPort.LAX.H, ['chip', 'phone', 'battery', 'kcon', 'aichip']);
    same(marketByPort.LAX.N, ['car', 'robot', 'clothes', 'rice']);
  });
  it('AI 반도체는 상하이·로테르담·로스앤젤레스에서 H', () => {
    for (const p of AICHIP_HOT_PORTS) expect(marketByPort[p].H).toContain('aichip');
  });
  it('상수(PRD 6.5.1, 6.6)', () => {
    expect(priceMultipliers).toMatchObject({ specialtyBuy: 0.6, relayBuy: 0.75, relaySell: 1.0, normalSell: 1.0, hotSell: 1.3, domesticBuy: 1.1 });
    expect(tradeLimits).toMatchObject({ fullPriceSell: 20, buy: 30, overLimitSellMultiplier: 0.7 });
    expect(PRICE_JITTER).toBe(0.05);
    expect(tariffRate('SIN')).toBe(0);
    expect(tariffRate('BUS')).toBe(0.1);
  });
});

describe('L1 공개 상품만으로 L1 항구 사이에 이익 경로가 있다', () => {
  it('최소 3개(소형 배 한 번 항해 기준, 관세·운항비 포함)', () => {
    const l1Ports = portsOpenedIn('L1');
    const l1Goods = new Set<GoodId>(L1_GOODS);
    const ship = shipsById.small;
    const paths: { good: GoodId; from: PortId; to: PortId; profit: number }[] = [];
    for (const from of l1Ports) {
      const row = marketByPort[from];
      const buys: [GoodId, number][] = [
        ...row.S.map((g) => [g, priceMultipliers.specialtyBuy] as [GoodId, number]),
        ...row.domesticBuy.map((g) => [g, priceMultipliers.domesticBuy] as [GoodId, number]),
      ];
      for (const [good, buyMul] of buys) {
        if (!l1Goods.has(good)) continue;
        for (const to of l1Ports) {
          if (to === from) continue;
          const dest = marketByPort[to];
          const hot = dest.H.includes(good) || dest.stageHot.some((s) => s.good === good && s.lesson === 'L1');
          const sellMul = hot ? priceMultipliers.hotSell : dest.N.includes(good) ? priceMultipliers.normalSell : null;
          if (sellMul === null) continue;
          const V = goodsById[good].V;
          const perBox = V * sellMul * (1 - tariffRate(to)) - V * buyMul;
          const qty = goodsById[good].form === 'service' ? 5 : Math.min(ship.capacity, tradeLimits.fullPriceSell);
          const cost = distanceSteps(from, to) * VOYAGE_COST_PER_STEP * ship.costMultiplier;
          const profit = Math.round(perBox * qty - cost);
          if (profit > 0) paths.push({ good, from, to, profit });
        }
      }
    }
    paths.sort((a, b) => b.profit - a.profit);
    console.table(paths.slice(0, 10));
    expect(paths.length).toBeGreaterThanOrEqual(3);
    // 천연가스 임무 경로(포트헤들랜드 → 부산)가 이익이어야 한다
    expect(paths.some((p) => p.good === 'gas' && p.from === 'PHE' && p.to === 'BUS')).toBe(true);
  });

  it('시장표의 모든 S 상품은 goods.specialtyPorts 와 같다', () => {
    for (const row of marketTable) for (const g of row.S) expect(goodsById[g].specialtyPorts, `${row.port} ${g}`).toContain(row.port);
  });
});
