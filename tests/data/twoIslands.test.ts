import { describe, expect, it } from 'vitest';
import { afterExchange, isSuccess, produce, twoIslands } from '../../src/data/twoIslands';

/** 2단계 배분(1일 단위)과 3단계 교환 단위를 모두 탐색해 성공 조합을 찾는다 */
function findSuccesses(baseRiceDays: { A: number; B: number }) {
  const base = { A: produce('A', baseRiceDays.A), B: produce('B', baseRiceDays.B) };
  const found: { a: number; b: number; units: number }[] = [];
  for (let a = 0; a <= twoIslands.days; a++) {
    for (let b = 0; b <= twoIslands.days; b++) {
      const A = produce('A', a);
      const B = produce('B', b);
      for (let units = 0; units * twoIslands.exchange.clothes <= A.clothes; units++) {
        const r = afterExchange(A, B, units);
        if (r && isSuccess(r, base)) found.push({ a, b, units });
      }
    }
  }
  return found;
}

describe('두 섬 이야기(PRD 6.12.2)', () => {
  it('수치가 PRD와 같다', () => {
    expect(twoIslands.islands.A).toMatchObject({ ricePerDay: 6, clothesPerDay: 12 });
    expect(twoIslands.islands.B).toMatchObject({ ricePerDay: 5, clothesPerDay: 2 });
    expect(twoIslands.days).toBe(10);
    expect(twoIslands.exchange).toEqual({ clothes: 3, rice: 2 });
    expect(twoIslands.reward.money).toBe(50);
  });

  it('기본 1단계(5:5) — ㉮ 쌀 30·옷 60, ㉯ 쌀 25·옷 10', () => {
    expect(produce('A', 5)).toEqual({ rice: 30, clothes: 60 });
    expect(produce('B', 5)).toEqual({ rice: 25, clothes: 10 });
  });

  it('기본 1단계 기준으로 성공 조합이 존재한다(1일 단위 전수 탐색)', () => {
    const found = findSuccesses(twoIslands.defaultRiceDays);
    console.log(`성공 조합 ${found.length}개, 예: ${JSON.stringify(found.slice(0, 3))}`);
    expect(found.length).toBeGreaterThan(0);
  });

  it('PRD 검산 예(㉮ 쌀 2일, ㉯ 쌀 10일, 옷 30 ↔ 쌀 20)가 성공한다', () => {
    const { riceDays, units } = twoIslands.example;
    const r = afterExchange(produce('A', riceDays.A), produce('B', riceDays.B), units)!;
    expect(r).toEqual({ A: { rice: 32, clothes: 66 }, B: { rice: 30, clothes: 30 } });
    expect(isSuccess(r, { A: produce('A', 5), B: produce('B', 5) })).toBe(true);
  });

  it('교환 없이 같은 배분이면 두 섬 모두 더 많이 갖지는 못한다(교환이 필요함)', () => {
    const base = { A: produce('A', 5), B: produce('B', 5) };
    let strictlyBetterWithoutTrade = false;
    for (let a = 0; a <= 10; a++) for (let b = 0; b <= 10; b++) {
      const r = { A: produce('A', a), B: produce('B', b) };
      if (isSuccess(r, base) && (a !== 5 || b !== 5)) strictlyBetterWithoutTrade = true;
    }
    expect(strictlyBetterWithoutTrade).toBe(false);
  });
});
