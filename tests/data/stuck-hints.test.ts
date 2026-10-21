/**
 * (작업 160b) 막힌 학생 갈매기 힌트 문구 — 시장표(market.ts)·레시피(recipes.ts)·항구(ports.ts)·쪽수 규칙과 맞는지.
 * 시장표가 바뀌면 이 시험이 깨진다 → 문구(src/data/stuckHints.ts)를 시장표에 맞춰 고친다.
 */
import { describe, expect, it } from 'vitest';
import { goodsById } from '../../src/data/goods';
import { marketByPort, resellRules } from '../../src/data/market';
import { ports, portsById } from '../../src/data/ports';
import { recipesById } from '../../src/data/recipes';
import { allStuckHintIds, BATTERY_PARTS, IPE_HINT_RECIPES, stuckHintCatalog, stuckHintText } from '../../src/data/stuckHints';
import type { LessonId } from '../../src/data/types';

const ORDER: readonly LessonId[] = ['L1', 'L2', 'L3', 'L4'];
const atOrBeforeL2 = (l: LessonId) => ORDER.indexOf(l) <= ORDER.indexOf('L2');

/** situationOf 가 낼 수 있는 모든 힌트 ID */
function allIds(): string[] {
  const ids: string[] = [];
  for (const r of IPE_HINT_RECIPES) ids.push(`IPE-MAKE-1:${r}`, `IPE-MAKE-2:${r}`, `IPE-EXPORT-1:${r}`, `IPE-EXPORT-2:${r}`);
  ids.push('IPE-BUY-1', 'IPE-BUY-2', 'IPE-AGAIN-1');
  // 배터리 재료 중 일부만 있을 때의 없는 재료 조합(1개·2개) 6가지
  const parts = BATTERY_PARTS;
  for (let mask = 1; mask < (1 << parts.length) - 1; mask++) {
    const missing = parts.filter((_, i) => mask & (1 << i));
    ids.push(`IPE-PARTS-1:${missing.join('+')}`);
  }
  return ids;
}

describe('갈매기 힌트 문구(작업 160b)', () => {
  const ids = allIds();

  it('ID 21개(레시피 3×2, 수출 3×2, BUY 2, AGAIN 1, PARTS 6) 모두 문구가 있다', () => {
    expect(ids).toHaveLength(21);
    expect(ids.filter((id) => id.startsWith('IPE-PARTS-1:'))).toHaveLength(6);
    for (const id of ids) expect(stuckHintText(id), id).not.toBeNull();
    // check:data 가 검사하는 목록(stuckHintCatalog)과 같은 ID
    expect([...allStuckHintIds()].sort()).toEqual([...ids].sort());
    expect(Object.keys(stuckHintCatalog).sort()).toEqual([...ids].sort());
  });

  it('모르는 ID·틀린 매개변수는 null', () => {
    for (const id of ['IPE-MAKE-1', 'IPE-MAKE-1:aichip', 'IPE-EXPORT-2:crude', 'IPE-PARTS-1:', 'IPE-PARTS-1:chem+nickel', 'IPE-PARTS-1:graphite+nickel+chem', 'IPE-BUY-1:x', 'X-1', '']) {
      expect(stuckHintText(id), id).toBeNull();
    }
  });

  it('facts ↔ 시장표·레시피·되팔기 규칙', () => {
    for (const id of ids) {
      const h = stuckHintText(id)!;
      for (const f of h.facts) {
        if (f.side === 'buy') {
          for (const p of f.ports) {
            const m = marketByPort[p];
            expect(m.S.includes(f.good) || m.domesticBuy.includes(f.good), `${id}: ${p}에서 ${f.good}를 싸게 살 수 있어야`).toBe(true);
            expect(atOrBeforeL2(portsById[p].unlockLesson), `${id}: ${p}는 2차시에 열려 있어야`).toBe(true);
          }
        } else if (f.side === 'sell') {
          for (const p of f.ports) expect(marketByPort[p].H, `${id}: ${p}가 ${f.good}를 비싸게 사야`).toContain(f.good);
        } else if (f.side === 'buyCountry') {
          const inCountry = ports.filter((p) => p.country === f.country);
          expect(inCountry.length, `${id}: 나라 ${f.country}`).toBeGreaterThan(0);
          const cheap = inCountry.filter((p) => marketByPort[p.id].S.includes(f.good) && atOrBeforeL2(p.unlockLesson));
          expect(cheap.length, `${id}: ${f.country} 항구 중 ${f.good} 특산`).toBeGreaterThan(0);
        } else if (f.side === 'recipe') {
          expect(recipesById[f.recipe]?.inputs, `${id}: 레시피 ${f.recipe}`).toEqual(f.inputs);
          expect(atOrBeforeL2(recipesById[f.recipe]!.unlockLesson)).toBe(true);
        } else if (f.side === 'resell') {
          expect(resellRules.rate).toBeGreaterThan(0);
        }
      }
    }
  });

  it('facts 의 항구 이름·나라 이름·상품 이름·레시피 수량이 문구에 들어 있다', () => {
    for (const id of ids) {
      const h = stuckHintText(id)!;
      for (const f of h.facts) {
        if (f.side === 'buy' || f.side === 'sell') {
          for (const p of f.ports) {
            expect(h.text, `${id}: 항구 ${p}`).toContain(portsById[p].name);
            // 부산 국내산 흑연은 나라 표기 없이 '부산'
            if (p !== 'BUS') expect(h.text, `${id}: 나라 ${portsById[p].country}`).toContain(portsById[p].country);
          }
          expect(h.text, `${id}: 상품 ${f.good}`).toContain(goodsById[f.good].name);
        } else if (f.side === 'buyCountry') {
          expect(h.text).toContain(f.country);
          expect(h.text).toContain(goodsById[f.good].name);
        } else if (f.side === 'recipe') {
          // 재료 이름은 늘, 만드는 상품 이름은 2번째 힌트(수량까지 말하는 것)·배터리 재료 힌트에서
          for (const g of Object.keys(f.inputs)) expect(h.text, `${id}: 재료 ${g}`).toContain(goodsById[g as keyof typeof goodsById].name);
          if (id.includes('-2:') || id === 'IPE-BUY-2' || f.recipe === 'battery') expect(h.text, `${id}: 레시피 상품 이름`).toContain(goodsById[f.recipe].name);
          if (id.includes('-2:') || id === 'IPE-BUY-2') {
            // 2번째 힌트는 수량까지: "원유 1상자로", "철광석 2상자로", "1상자씩으로"
            for (const [g, n] of Object.entries(f.inputs)) {
              expect(h.text, `${id}: ${g} 이름`).toContain(goodsById[g as keyof typeof goodsById].name);
              if (f.recipe !== 'battery') expect(h.text, `${id}: ${g} ${n}상자`).toContain(`${goodsById[g as keyof typeof goodsById].name} ${n}상자`);
            }
            if (f.recipe === 'battery' && id === 'IPE-MAKE-2:battery') expect(h.text).toContain('1상자씩');
          }
        } else if (f.side === 'resell') {
          expect(h.text).toContain('되팔');
        }
      }
    }
  });

  it('PARTS 문구: 없는 재료가 모두 나오고 있는 재료의 사는 곳 문장은 없다', () => {
    const where = { graphite: '흑연은', nickel: '니켈은', chem: '정밀 화학 원료는' } as const;
    for (const id of ids.filter((x) => x.startsWith('IPE-PARTS-1:'))) {
      const missing = id.split(':')[1]!.split('+');
      const h = stuckHintText(id)!;
      for (const p of BATTERY_PARTS) {
        if (missing.includes(p)) expect(h.text, `${id} ${p}`).toContain(where[p]);
        else expect(h.text, `${id} ${p}`).not.toContain(where[p]);
      }
    }
  });

  it('쪽수는 94·99·100·101쪽만, 103~108쪽·싱가포르·중계 없음, 문구 160자 이하', () => {
    const ALLOWED = [94, 99, 100, 101];
    for (const id of ids) {
      const h = stuckHintText(id)!;
      expect(h.pages.length, id).toBeGreaterThan(0);
      for (const p of h.pages) expect(ALLOWED, `${id} pages ${p}`).toContain(p);
      for (const m of h.text.matchAll(/(\d{2,3})쪽/g)) expect(ALLOWED, `${id} '${m[0]}'`).toContain(Number(m[1]));
      expect(h.text, id).not.toMatch(/10[3-8]/);
      expect(h.text, id).not.toContain('싱가포르');
      expect(h.text, id).not.toContain('중계');
      expect(h.text.length, `${id} 길이`).toBeLessThanOrEqual(160);
      // 2차시에 열리지 않은 항구 이름은 쓰지 않는다
      for (const p of ports) if (h.text.includes(p.name)) expect(atOrBeforeL2(p.unlockLesson), `${id} ${p.name}`).toBe(true);
    }
  });

  it("tag 'fakeNews' ⇔ 문구가 '갈매기가 들은 소식:'으로 시작, 가상 뉴스는 '(게임에서는 …)' 꼬리로 게임 규칙을 밝힌다", () => {
    for (const id of ids) {
      const h = stuckHintText(id)!;
      expect(h.tag === 'fakeNews', id).toBe(h.text.startsWith('갈매기가 들은 소식:'));
      if (h.tag === 'fakeNews') expect(h.text, id).toMatch(/\(게임에서는 .+ 비싸게 사요\.\)$/);
    }
    expect(ids.filter((id) => stuckHintText(id)!.tag === 'fakeNews').sort()).toEqual(['IPE-EXPORT-2:battery', 'IPE-EXPORT-2:oilp', 'IPE-EXPORT-2:steel']);
  });

  it('화면 버튼·탭·도장 이름 그대로: [항구 들어가기]·[공장]·[만들기]·[수출]·[국내 판매]', () => {
    expect(stuckHintText('IPE-MAKE-2:oilp')!.text).toContain('[항구 들어가기] → [공장] → [만들기]');
    expect(stuckHintText('IPE-EXPORT-1:steel')!.text).toContain('[수출]');
    expect(stuckHintText('IPE-EXPORT-1:steel')!.text).toContain('[국내 판매]');
    expect(stuckHintText('IPE-EXPORT-1:steel')!.text).toContain('만든 철강을 다른 나라 항구에');
    expect(stuckHintText('IPE-EXPORT-1:battery')!.text).toContain('만든 배터리를 다른 나라 항구에');
  });
});
