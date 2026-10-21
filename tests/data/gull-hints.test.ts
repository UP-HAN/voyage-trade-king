/**
 * (작업 160, PRD 6.7.6) 갈매기 힌트 편지 — 정답·틀린 보기·해설이 시장표(market.ts)와 맞는지 검사한다.
 * 시장표가 바뀌면 이 시험이 깨진다 → 힌트 문구를 시장표에 맞춰 고친다(시장표를 힌트에 맞추지 않는다).
 */
import { describe, expect, it } from 'vitest';
import { goods, goodsById } from '../../src/data/goods';
import { letters, stageLetters } from '../../src/data/letters';
import { marketByPort } from '../../src/data/market';
import { ports, portsById } from '../../src/data/ports';
import { recipesById } from '../../src/data/recipes';
import type { GoodId, LessonId, LetterQuestion, PortId } from '../../src/data/types';

const ORDER: readonly LessonId[] = ['L1', 'L2', 'L3', 'L4'];
const atOrBeforeL2 = (l: LessonId) => ORDER.indexOf(l) <= ORDER.indexOf('L2');

/** 그 항구에서 플레이어가 그 상품을 살 수 있다(S·R·국내산) */
const canBuyAt = (port: PortId, good: GoodId) => {
  const m = marketByPort[port];
  return m.S.includes(good) || m.R.includes(good) || m.domesticBuy.includes(good);
};
/** 그 항구가 그 상품을 사 준다(H·N·R) */
const buysFromPlayer = (port: PortId, good: GoodId) => {
  const m = marketByPort[port];
  return m.H.includes(good) || m.N.includes(good) || m.R.includes(good);
};
/** 그 상품을 인기(H)로 비싸게 사 주는 항구 */
const hotPorts = (good: GoodId) => ports.filter((p) => marketByPort[p.id].H.includes(good)).map((p) => p.id);

const portByName = new Map(ports.map((p) => [p.name, p.id]));
const goodByName = new Map(goods.map((g) => [g.name, g.id]));

const hinted = letters.filter((q): q is LetterQuestion & { hint: NonNullable<LetterQuestion['hint']> } => !!q.hint);
const texts = (q: LetterQuestion) => [q.passage ?? '', q.prompt, ...(q.choices ?? []), q.explain];

describe('갈매기 힌트 편지(작업 160)', () => {
  it('L2 은행에 L2-G1~G8 8문항, 모두 gullNews·choice3·정답 0·hint 있음', () => {
    const ids = hinted.map((q) => q.id).sort();
    expect(ids).toEqual(['L2-G1', 'L2-G2', 'L2-G3', 'L2-G4', 'L2-G5', 'L2-G6', 'L2-G7', 'L2-G8']);
    for (const q of hinted) {
      expect(q.lesson, q.id).toBe('L2');
      expect(q.common, q.id).toBe(false);
      expect(q.format, q.id).toBe('gullNews');
      expect(q.type, q.id).toBe('choice3');
      expect(q.answer, q.id).toBe(0);
      expect(q.passage, q.id).toBeTruthy();
    }
    expect(hinted.filter((q) => q.difficulty === 'easy').map((q) => q.id)).toEqual(['L2-G1', 'L2-G2', 'L2-G3', 'L2-G4']);
    expect(hinted.filter((q) => q.difficulty === 'normal').map((q) => q.id)).toEqual(['L2-G5', 'L2-G6', 'L2-G7', 'L2-G8']);
    expect(stageLetters('L2', 'easy')).toHaveLength(8);
    expect(stageLetters('L2', 'normal')).toHaveLength(8);
  });

  it('① 정답 보기는 시장표와 맞고, 틀린 보기는 정말 틀리다', () => {
    for (const q of hinted) {
      const { side, good, choicePorts } = q.hint;
      const ans = q.answer as number;
      if (side === 'recipe') {
        const inputs = Object.keys(recipesById[good]?.inputs ?? {}) as GoodId[];
        expect(inputs.length, q.id).toBeGreaterThan(0);
        q.choices!.forEach((c, i) => {
          const g = goodByName.get(c);
          expect(g, `${q.id} 보기 '${c}' 상품 이름`).toBeTruthy();
          if (i === ans) expect(inputs, `${q.id} 정답 '${c}'는 재료가 아니어야`).not.toContain(g);
          else expect(inputs, `${q.id} 보기 '${c}'는 재료여야`).toContain(g);
        });
        continue;
      }
      expect(choicePorts, q.id).toHaveLength(3);
      choicePorts!.forEach((port, i) => {
        expect(port, `${q.id} 보기 ${i}`).not.toBeNull();
        const p = port as PortId;
        // 보기 문구가 가리키는 항구 이름과 choicePorts 가 같다
        expect(q.choices![i].startsWith(portsById[p].name), `${q.id} 보기 '${q.choices![i]}' ↔ ${p}`).toBe(true);
        if (side === 'buy') {
          if (i === ans) {
            const m = marketByPort[p];
            expect(m.S.includes(good) || m.domesticBuy.includes(good), `${q.id} 정답 ${p}에서 ${good}를 싸게 살 수 있어야`).toBe(true);
          } else expect(canBuyAt(p, good), `${q.id} 틀린 보기 ${p}에서 ${good}를 살 수 없어야`).toBe(false);
        } else {
          if (i === ans) expect(marketByPort[p].H, `${q.id} 정답 ${p}가 ${good}를 비싸게 사야`).toContain(good);
          else expect(buysFromPlayer(p, good), `${q.id} 틀린 보기 ${p}는 ${good}를 사 주지 않아야`).toBe(false);
        }
      });
    }
  });

  it('② 해설의 "게임에서는 A·B가 …를 비싸게 사요" 항구 목록이 시장표 H와 같다', () => {
    const RE = /게임에서는 ([가-힣·]+?)(?:이|가) ([가-힣 ]+?)(?:을|를) 비싸게 사요/;
    const sells = hinted.filter((q) => q.hint.side === 'sell');
    expect(sells.length).toBe(4);
    for (const q of sells) {
      const m = q.explain.match(RE);
      expect(m, `${q.id} 해설 형식`).toBeTruthy();
      const named = m![1].split('·').map((n) => {
        const id = portByName.get(n);
        expect(id, `${q.id} 항구 이름 '${n}'`).toBeTruthy();
        return id!;
      });
      expect(goodByName.get(m![2].trim()), `${q.id} 상품 이름`).toBe(q.hint.good);
      expect([...named].sort(), q.id).toEqual(hotPorts(q.hint.good).sort());
    }
  });

  it('③ 교과서 쪽은 94·99·100·101쪽만(103~108쪽 인용 없음)', () => {
    const ALLOWED = [94, 99, 100, 101];
    for (const q of hinted) {
      for (const p of q.pages) expect(ALLOWED, `${q.id} pages ${p}`).toContain(p);
      for (const t of texts(q)) {
        for (const m of t.matchAll(/(\d{2,3})(?:~\d{2,3})?쪽/g)) expect(ALLOWED, `${q.id} '${m[0]}'`).toContain(Number(m[1]));
        expect(t, q.id).not.toMatch(/10[3-8]/);
      }
    }
  });

  it('④ 나오는 항구·상품은 모두 2차시(L2) 판에서 열려 있다(싱가포르는 앞 시간에 숨기므로 쓰지 않음)', () => {
    for (const q of hinted) {
      for (const p of q.hint.choicePorts ?? []) if (p) expect(atOrBeforeL2(portsById[p].unlockLesson), `${q.id} ${p}`).toBe(true);
      for (const t of texts(q)) {
        for (const p of ports) if (t.includes(p.name)) expect(atOrBeforeL2(p.unlockLesson), `${q.id} ${p.name}`).toBe(true);
        expect(t, q.id).not.toContain('싱가포르');
      }
      expect(atOrBeforeL2(goodsById[q.hint.good].unlockLesson), `${q.id} ${q.hint.good}`).toBe(true);
    }
  });
});
