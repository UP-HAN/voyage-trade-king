/**
 * 작업 113: 1차시 미니게임 — 벽란도 시장(L1-E1) 채점·보너스 상한·짧은 형태 5장, 두 섬 이야기(L1-E5) 성공 판정
 * (PRD 검산 예 성공 / 1단계 그대로 교환 0 실패 / 예시 따라 하기 성공), 호스트 반영(보너스·+50만·도감),
 * 학생 화면 렌더(가짜 DOM: 누르기 → 바구니, 결과 보내기, 짧은 형태 3단계 시작·[예시 따라 하기] 처음부터),
 * 공용 화면 결과 장면 고르기·막대 모델(이름 없음), 집계 평균.
 */
import { render, type VNode } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aggregate, applyAction, playerView, publicClass, type Action, type HostSnapshot, type Player } from '../../src/core';
import { byeokrando, byeokrandoItems } from '../../src/data/byeokrando';
import { eventsById } from '../../src/data/events';
import { twoIslands } from '../../src/data/twoIslands';
import {
  allPlaced,
  byeokrandoBonus,
  byeokrandoCards,
  byeokrandoReason,
  exampleSetup,
  gradeByeokrando,
  judgeTwoIslands,
  maxUnits,
  reclassQuestions,
  twoIslandsScenes,
  totals,
  type Placement,
} from '../../src/minigames/logic';
import { MinigameLayer, isShortForm } from '../../src/minigames/MinigameLayer';
import { byeokrandoResultModel, minigameResultPicker, twoIslandsResultModel } from '../../src/screen/scenes/MinigameResultScene';
import { parseScreenData, type ScreenData } from '../../src/screen/model';
import { act as hostAct, editPlayer, makeSession, player, teach } from '../core/helpers';
import { installFakeDom, type FakeElement } from '../map/fake-dom';

const allRight = (short: boolean): Placement => Object.fromEntries(byeokrandoCards(short).map((c) => [c.id, c.answer]));

describe('벽란도 시장: 분류·채점·보너스(PRD 6.12.1, p.95)', () => {
  it('판 물건 5(비단·약재·서적·악기·보석), 사 간 물건 4(삼베·모시·인삼·종이) — 교과서 p.95와 같다', () => {
    const sold = byeokrandoItems.filter((i) => i.answer === 'sold').map((i) => i.name);
    const bought = byeokrandoItems.filter((i) => i.answer === 'bought').map((i) => i.name);
    expect(sold).toEqual(['비단', '약재', '서적', '악기', '보석']);
    expect(bought).toEqual(['삼베', '모시', '인삼', '종이']);
    expect(byeokrandoItems.every((i) => i.pages.includes(95))).toBe(true);
    expect(byeokrandoCards(false)).toHaveLength(9);
  });

  it('전체 형태: 맞힌 수 × 20만 원, 최대 180만 원', () => {
    expect(gradeByeokrando(allRight(false), false)).toMatchObject({ correct: 9, total: 9, wrong: [] });
    expect(byeokrandoBonus(9, false)).toBe(180);
    expect(byeokrandoBonus(7, false)).toBe(140);
    expect(byeokrandoBonus(0, false)).toBe(0);
    expect(byeokrandoBonus(12, false)).toBe(180); // 상한
    const p = { ...allRight(false), instrument: 'bought', ramie: 'sold' } as Placement;
    const g = gradeByeokrando(p, false);
    expect(g.correct).toBe(7);
    expect(g.wrong.sort()).toEqual(['instrument', 'ramie']);
  });

  it('짧은 형태: 카드 5장(판 3 비단·약재·서적 / 사 간 2 인삼·종이), 맞힌 수 × 36만 원, 최대 180만 원', () => {
    const ids = byeokrandoCards(true).map((c) => c.id).sort();
    expect(ids).toEqual(['books', 'ginseng', 'medicine', 'paper', 'silk']);
    expect(gradeByeokrando(allRight(true), true)).toMatchObject({ correct: 5, total: 5 });
    expect(byeokrandoBonus(5, true)).toBe(180);
    expect(byeokrandoBonus(4, true)).toBe(144);
    expect(byeokrandoBonus(9, true)).toBe(180); // 상한
    // 짧은 형태에 없는 카드는 채점하지 않는다
    expect(allPlaced(allRight(true), true)).toBe(true);
    expect(allPlaced(allRight(true), false)).toBe(false);
  });

  it('틀린 카드 이유(p.95)와 재분류 질문(p.96): 비단 = 수입, 인삼 = 수출 / 짧은 형태는 재분류 생략', () => {
    expect(byeokrandoReason('silk')).toBe('비단은 다른 나라 상인이 가져와서 판 물건이에요.');
    expect(byeokrandoReason('ramie')).toBe('모시는 다른 나라 상인이 고려에서 사 간 물건이에요.');
    const qs = reclassQuestions(false);
    expect(qs.map((q) => [q.item, q.answer])).toEqual([
      ['silk', 'import'],
      ['ginseng', 'export'],
    ]);
    expect(qs[0].question).toBe('고려 입장에서 비단은?');
    expect(qs[1].question).toBe('인삼은?');
    expect(reclassQuestions(true)).toEqual([]);
    expect(byeokrando.reclassify.pages).toEqual([96]);
  });

  it('호스트 반영: 화면이 보낸 첫 제출 배치로 같은 보너스가 회사 자금에 더해진다(전체·짧은 형태)', () => {
    for (const short of [false, true]) {
      let s = teach(makeSession({ n: 1 }), { type: 'fireEvent', id: 'L1-E1', short });
      s = editPlayer(s, 1, (p) => {
        p.company.founded = true;
      });
      const before = player(s, 1).game.money;
      const place = { ...allRight(short), silk: 'bought' } as Placement;
      const r = hostAct(s, 1, { type: 'respondEvent', eventId: 'L1-E1', response: { answers: place } as never });
      const after = r.snapshot.players.s01;
      const want = byeokrandoBonus(gradeByeokrando(place, short).correct, short);
      expect(after.game.money - before, short ? 'short' : 'full').toBe(want);
      expect(after.game.responses['L1-E1']).toEqual({ correct: short ? 4 : 8, total: short ? 5 : 9 });
    }
  });
});

describe('두 섬 이야기: 성공 판정(PRD 6.12.2, p.98~99)', () => {
  it('PRD 검산 예(㉮ 쌀 2일·옷 8일, ㉯ 쌀 10일, 옷 30 ↔ 쌀 20)는 성공', () => {
    const ex = exampleSetup();
    expect(ex).toEqual({ riceDays: { A: 2, B: 10 }, units: 10 });
    const j = judgeTwoIslands(ex.riceDays, ex.units);
    expect(j.after).toEqual({ A: { rice: 32, clothes: 66 }, B: { rice: 30, clothes: 30 } });
    expect(j.ok).toEqual({ A: true, B: true });
    expect(j.success).toBe(true);
    expect(totals(j.after)).toEqual({ rice: 62, clothes: 96 });
  });

  it('1단계 그대로(5:5) 교환 0이면 실패, 1단계 그대로 교환해도 실패(교환 1단위 이상이 필요 — 103 규칙)', () => {
    const j0 = judgeTwoIslands(twoIslands.defaultRiceDays, 0);
    expect(j0.ok).toEqual({ A: false, B: false }); // 바꾸지 않으면 섬별로도 ✓ 없음(수정 1회차)
    expect(j0.traded).toBe(false);
    expect(j0.success).toBe(false); // 바꾸지 않았으니 실패
    // 잘하는 것에 집중했어도 바꾸지 않으면 ✓ 없음
    expect(judgeTwoIslands({ A: 2, B: 10 }, 0).ok).toEqual({ A: false, B: false });
    const j1 = judgeTwoIslands(twoIslands.defaultRiceDays, 1);
    expect(j1.success).toBe(false);
    expect(j1.ok.A).toBe(false);
    expect(j1.short.A).toEqual({ rice: 0, clothes: 3 });
  });

  it('교환 단위는 줄 수 있는 양까지만', () => {
    expect(maxUnits({ A: 2, B: 10 })).toBe(25); // ㉮ 옷 96 ÷ 3 = 32, ㉯ 쌀 50 ÷ 2 = 25
    expect(maxUnits({ A: 10, B: 0 })).toBe(0);
    expect(judgeTwoIslands({ A: 2, B: 10 }, 99).units).toBe(25);
  });

  it('3장면 숫자(작업 150): 혼자 30/60·25/10 → 집중 12/96·50/0 → 바꾼 뒤 32/66·30/30, 두 나라 모두 같거나 많음', () => {
    const sc = twoIslandsScenes();
    expect(sc.alone).toEqual({ A: { rice: 30, clothes: 60 }, B: { rice: 25, clothes: 10 } });
    expect(sc.focus).toEqual({ A: { rice: 12, clothes: 96 }, B: { rice: 50, clothes: 0 } });
    expect(sc.traded).toEqual({ A: { rice: 32, clothes: 66 }, B: { rice: 30, clothes: 30 } });
    expect(sc.give).toEqual({ clothes: 30, rice: 20 });
    expect(sc.riceDays).toEqual({ A: 2, B: 10 });
    expect(sc.units).toBe(10);
    for (const k of ['A', 'B'] as const) {
      expect(sc.traded[k].rice).toBeGreaterThanOrEqual(sc.alone[k].rice);
      expect(sc.traded[k].clothes).toBeGreaterThanOrEqual(sc.alone[k].clothes);
    }
    expect(twoIslands.islands.A.label).toBe('㉮ 나라');
    expect(twoIslands.islands.B.label).toBe('㉯ 나라');
  });

  it('호스트 반영: 검산 예·[예시 따라 하기] 모두 성공 → +50만 원·도감 「무역의 좋은 점」, 1단계 그대로면 TRY_AGAIN', () => {
    const base = editPlayer(teach(makeSession({ n: 1 }), { type: 'fireEvent', id: 'L1-E5' }), 1, (p) => {
      p.company.founded = true;
    });
    const money0 = player(base, 1).game.money;
    for (const response of [{ riceDays: { A: 2, B: 10 }, units: 10 }, { example: true, riceDays: { A: 2, B: 10 }, units: 10 }]) {
      const r = hostAct(base, 1, { type: 'respondEvent', eventId: 'L1-E5', response: response as never });
      const p = r.snapshot.players.s01;
      expect(p.game.money - money0).toBe(twoIslands.reward.money);
      expect(p.game.metrics.dex).toContain('trade-benefit');
      expect(p.game.responses['L1-E5']).toMatchObject({ success: true, example: response.example === true, stage3: { A: { rice: 32, clothes: 66 }, B: { rice: 30, clothes: 30 } } });
    }
    const bad = applyAction(base.class, player(base, 1), { type: 'respondEvent', eventId: 'L1-E5', response: { riceDays: { A: 5, B: 5 }, units: 0 } });
    expect(bad.error).toBe('TRY_AGAIN');
  });
});

// ─── 학생 화면 렌더(가짜 DOM) ─────────────────────────────

let dom: ReturnType<typeof installFakeDom>;
beforeEach(() => {
  dom = installFakeDom();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(1_000_000);
});
afterEach(() => {
  act(() => render(null, dom.root as unknown as Element));
  dom.restore();
  vi.useRealTimers();
});

function mount(el: VNode): FakeElement {
  act(() => render(el, dom.root as unknown as Element));
  return dom.root;
}
const byTestId = (root: FakeElement, id: string) => root.find((e) => e.getAttribute('data-testid') === id);
const one = (root: FakeElement, id: string) => byTestId(root, id)[0]!;
const click = (el: FakeElement | undefined) => {
  vi.setSystemTime(Date.now() + 600); // 연속 클릭 가드(500ms) 지나서
  act(() => {
    el!.dispatch('click');
  });
};
const cardOf = (root: FakeElement, id: string) => root.find((e) => e.getAttribute('data-testid') === 'bk-card' && e.getAttribute('data-item') === id)[0];

function session(id: string, short: boolean): HostSnapshot {
  return editPlayer(teach(makeSession({ n: 1 }), { type: 'fireEvent', id, short }), 1, (p) => {
    p.company.founded = true;
  });
}

function layer(s: HostSnapshot, p: Player, log: Action[], onDone: () => void = () => undefined, catchUp = false) {
  return (
    <MinigameLayer
      eventId={s.class.currentEvent!.id}
      classState={publicClass(s.class)}
      player={playerView(p)}
      act={(a) => {
        log.push(a);
        return 'sent';
      }}
      onDone={onDone}
      catchUp={catchUp}
    />
  );
}

describe('학생 화면: 벽란도 시장', () => {
  it('누르기 → 바구니로 9장을 넣고 [다 넣었어요] → 정답 공개 → 정의 카드·재분류 → [마치기]에서 첫 제출 배치를 한 번만 보낸다', () => {
    const s = session('L1-E1', false);
    const log: Action[] = [];
    let done = 0;
    const root = mount(layer(s, player(s, 1), log, () => (done += 1)));
    expect(one(root, 'minigame').getAttribute('data-step')).toBe('sort');
    expect(byTestId(root, 'bk-card')).toHaveLength(9);
    expect(one(root, 'bk-submit').getAttribute('disabled')).not.toBeNull();
    const want = { ...allRight(false), books: 'bought' } as Placement; // 서적 1장 틀림
    for (const [id, side] of Object.entries(want)) {
      click(cardOf(root, id));
      expect(cardOf(root, id)!.getAttribute('aria-pressed')).toBe('true');
      click(one(root, `bk-basket-btn-${side}`));
      expect(cardOf(root, id)!.getAttribute('data-place')).toBe(side);
    }
    click(one(root, 'bk-submit'));
    expect(one(root, 'minigame').getAttribute('data-step')).toBe('reveal');
    expect(one(root, 'bk-score').getAttribute('data-correct')).toBe('8');
    expect(one(root, 'bk-bonus').textContent).toBe('160만 원');
    expect(root.textContent).toContain('서적은 다른 나라 상인이 가져와서 판 물건이에요.');
    expect(root.textContent).toContain('교과서 p.95');
    expect(log).toEqual([]); // 아직 보내지 않음(사건 층이 기록을 보면 화면을 닫으므로 끝까지 본 뒤 보냄)
    click(one(root, 'bk-next'));
    expect(one(root, 'bk-define').textContent).toContain('교과서 p.96');
    expect(one(root, 'minigame-finish').getAttribute('disabled')).not.toBeNull(); // 재분류 질문을 다 답해야
    const q = (item: string, w: string) => root.find((e) => e.getAttribute('data-testid') === 'bk-q' && e.getAttribute('data-item') === item)[0]!.find((e) => e.getAttribute('data-testid') === `bk-q-${w}`)[0];
    click(q('silk', 'import'));
    click(q('ginseng', 'export'));
    expect(byTestId(root, 'bk-q-result').map((e) => e.getAttribute('data-ok'))).toEqual(['1', '1']);
    click(one(root, 'minigame-finish'));
    act(() => {
      one(root, 'minigame-finish')?.dispatch('click'); // 바로 한 번 더(가드)
    });
    expect(log).toEqual([{ type: 'respondEvent', eventId: 'L1-E1', response: { answers: want } }]);
    expect(done).toBe(1);
  });

  it('짧은 형태: 5장, 재분류 없음, 보너스 × 36만 원', () => {
    const s = session('L1-E1', true);
    expect(isShortForm(publicClass(s.class), 'L1-E1')).toBe(true);
    const log: Action[] = [];
    const root = mount(layer(s, player(s, 1), log));
    expect(byTestId(root, 'bk-card')).toHaveLength(5);
    expect(byTestId(root, 'minigame-short')).toHaveLength(1);
    for (const [id, side] of Object.entries(allRight(true))) {
      click(cardOf(root, id));
      click(one(root, `bk-basket-btn-${side}`));
    }
    click(one(root, 'bk-submit'));
    expect(one(root, 'bk-bonus').textContent).toBe('180만 원');
    click(one(root, 'bk-next'));
    expect(byTestId(root, 'bk-reclass')).toHaveLength(0);
    click(one(root, 'minigame-finish'));
    expect(log).toHaveLength(1);
  });

  it('첫 제출 뒤 화면이 닫히면(교사 마감) 그때 결과를 보낸다 — 보상을 잃지 않게', () => {
    const s = session('L1-E1', true);
    const log: Action[] = [];
    const root = mount(layer(s, player(s, 1), log));
    for (const [id, side] of Object.entries(allRight(true))) {
      click(cardOf(root, id));
      click(one(root, `bk-basket-btn-${side}`));
    }
    click(one(root, 'bk-submit'));
    expect(log).toEqual([]);
    act(() => render(null, dom.root as unknown as Element));
    expect(log).toHaveLength(1);
    expect((log[0] as { eventId: string }).eventId).toBe('L1-E1');
  });

  it('이미지가 없어도 이름 꼬리표로 진행된다(이미지 onError)', () => {
    const s = session('L1-E1', true);
    const root = mount(layer(s, player(s, 1), []));
    const imgs = root.find((e) => e.localName === 'img' && (e.getAttribute('class') ?? '').includes('bk-card__img'));
    expect(imgs.length).toBe(5);
    act(() => {
      for (const i of imgs) i.dispatch('error');
    });
    expect(root.find((e) => (e.getAttribute('class') ?? '').includes('mg-noimg')).length).toBe(5);
    expect(cardOf(root, 'silk')!.textContent).toContain('비단');
  });
});

describe('학생 화면: 두 섬 이야기(㉮·㉯ 나라 3장면·버튼 2번, 작업 150)', () => {
  const nation = (root: FakeElement, k: 'A' | 'B') => {
    const e = one(root, `ti-nation-${k}`);
    return `${e.getAttribute('data-rice')}/${e.getAttribute('data-clothes')}`;
  };

  for (const short of [false, true]) {
    it(`${short ? '짧은' : '전체'} 형태: 장면 1 → [잘하는 것을 많이 만들어 보기] → 장면 2 → [옷 30벌 ↔ 쌀 20포대 바꾸기] → 장면 3 → [다 했어요]로 보내고 호스트가 성공`, () => {
      const s = session('L1-E5', short);
      const log: Action[] = [];
      let done = 0;
      const root = mount(layer(s, player(s, 1), log, () => (done += 1)));
      // 슬라이더·힌트·예시 따라 하기·뒤로 없음
      for (const id of ['ti-A-slider', 'ti-B-slider', 'ti-hint', 'ti-example', 'ti-back', 'ti-next', 'ti-units-plus']) expect(byTestId(root, id), id).toHaveLength(0);
      expect(root.find((e) => e.localName === 'input')).toHaveLength(0);
      expect(root.textContent).toContain('㉮ 나라와 ㉯ 나라 이야기');
      expect(root.textContent).toContain('교과서 98~99쪽');
      expect(root.textContent).not.toContain('섬은');

      // 장면 1
      expect(one(root, 'minigame').getAttribute('data-step')).toBe('scene1');
      expect(one(root, 'ti-scene-title').textContent).toBe('1. 혼자 살 때');
      expect(one(root, 'ti-guide').textContent).toContain('㉮ 나라와 ㉯ 나라는 10일 동안 쌀과 옷을 반씩(5일씩) 만들어요.');
      expect(one(root, 'ti-guide').textContent).toContain('㉮ 나라는 옷을, ㉯ 나라는 쌀을 상대적으로 더 잘 만들어요.');
      expect(one(root, 'ti-nation-A').textContent).toContain('㉮ 나라');
      expect(one(root, 'ti-nation-B').textContent).toContain('㉯ 나라');
      expect(nation(root, 'A')).toBe('30/60');
      expect(nation(root, 'B')).toBe('25/10');
      expect(byTestId(root, 'ti-bar')).toHaveLength(4);
      expect(one(root, 'ti-focus').textContent).toBe('잘하는 것을 많이 만들어 보기');
      expect(byTestId(root, 'ti-trade')).toHaveLength(0);
      click(one(root, 'ti-focus'));

      // 장면 2
      expect(one(root, 'minigame').getAttribute('data-step')).toBe('scene2');
      expect(one(root, 'ti-scene-title').textContent).toBe('2. 잘하는 것을 많이 만들기');
      expect(one(root, 'ti-guide').textContent).toContain('㉮ 나라는 옷을 많이(8일), ㉯ 나라는 쌀만(10일) 만들었어요.');
      expect(one(root, 'ti-guide').textContent).toContain('그런데 ㉮는 쌀이, ㉯는 옷이 모자라요. 서로 바꿔 볼까요?');
      expect(nation(root, 'A')).toBe('12/96');
      expect(nation(root, 'B')).toBe('50/0');
      expect(one(root, 'ti-trade').textContent).toBe('옷 30벌 ↔ 쌀 20포대 바꾸기');
      expect(log).toEqual([]);
      click(one(root, 'ti-trade'));

      // 장면 3
      expect(one(root, 'minigame').getAttribute('data-step')).toBe('scene3');
      expect(one(root, 'ti-scene-title').textContent).toBe('3. 서로 바꾸니');
      expect(one(root, 'ti-guide').textContent).toContain('두 나라 모두 혼자 살 때보다 쌀도 옷도 같거나 더 많아졌어요!');
      expect(nation(root, 'A')).toBe('32/66');
      expect(nation(root, 'B')).toBe('30/30');
      expect(one(root, 'ti-give-clothes').textContent).toBe('30');
      expect(one(root, 'ti-give-rice').textContent).toBe('20');
      const bars = byTestId(root, 'ti-bar');
      expect(bars.filter((b) => b.getAttribute('data-when') === 'before').map((b) => b.getAttribute('data-value'))).toEqual(['30', '60', '25', '10']);
      expect(bars.filter((b) => b.getAttribute('data-when') === 'after').map((b) => b.getAttribute('data-value'))).toEqual(['32', '66', '30', '30']);
      expect(one(root, 'ti-end').textContent).toContain(twoIslands.endSentence.text);
      expect(one(root, 'ti-end').textContent).toContain('교과서 99쪽');
      expect(log).toEqual([]);
      click(one(root, 'ti-done'));
      act(() => {
        one(root, 'ti-done')?.dispatch('click'); // 바로 한 번 더(가드)
      });
      expect(log).toEqual([{ type: 'respondEvent', eventId: 'L1-E5', response: { riceDays: { A: 2, B: 10 }, units: 10 } }]);
      expect(done).toBe(1);
      const r = applyAction(s.class, player(s, 1), log[0]);
      expect(r.error).toBeUndefined();
      expect(r.player.game.money - player(s, 1).game.money).toBe(twoIslands.reward.money);
      expect(r.player.game.metrics.dex).toContain('trade-benefit');
    });
  }

  it('장면 3에서 화면이 닫히면(교사 마감) 그때 결과를 보낸다 — 장면 1·2에서 닫히면 보내지 않음', () => {
    const s = session('L1-E5', false);
    const log: Action[] = [];
    let root = mount(layer(s, player(s, 1), log));
    click(one(root, 'ti-focus'));
    act(() => render(null, dom.root as unknown as Element));
    expect(log).toEqual([]);
    root = mount(layer(s, player(s, 1), log)); // 기기 저장이 있으면 장면 2부터, 없으면 장면 1부터
    if (byTestId(root, 'ti-focus').length) click(one(root, 'ti-focus'));
    click(one(root, 'ti-trade'));
    act(() => render(null, dom.root as unknown as Element));
    expect(log).toEqual([{ type: 'respondEvent', eventId: 'L1-E5', response: { riceDays: { A: 2, B: 10 }, units: 10 } }]);
  });

  it('따라잡기로 열어도 같은 3장면(놓친 활동)', () => {
    let s = session('L1-E5', false);
    s = teach(s, { type: 'closeEvent' });
    const root = mount(
      <MinigameLayer eventId="L1-E5" classState={publicClass(s.class)} player={playerView(player(s, 1))} act={() => 'sent'} onDone={() => undefined} catchUp />,
    );
    expect(root.textContent).toContain('놓친 활동');
    expect(one(root, 'minigame').getAttribute('data-step')).toBe('scene1');
    expect(byTestId(root, 'ti-focus')).toHaveLength(1);
    expect(byTestId(root, 'ti-example')).toHaveLength(0);
  });
});

// ─── 공용 화면 ─────────────────────────────

function screenData(s: HostSnapshot): ScreenData {
  const pub = aggregate(s.class, s.players);
  return parseScreenData({ class: publicClass(s.class), public: pub }, { screenScene: 'auto' })!;
}

describe('공용 화면: 미니게임 결과(이름 없음)', () => {
  it('벽란도: 아무도 안 했으면 사건 카드(null), 한 명이라도 마치면 결과 장면 — 분포 0~9장, 짧은 형태 0~5장', () => {
    let s = editPlayer(editPlayer(teach(makeSession({ n: 2 }), { type: 'fireEvent', id: 'L1-E1' }), 1, (p) => (p.company.founded = true)), 2, (p) => (p.company.founded = true));
    expect(minigameResultPicker(screenData(s), 0)).toBeNull();
    s = hostAct(s, 1, { type: 'respondEvent', eventId: 'L1-E1', response: { answers: allRight(false) } as never }).snapshot;
    s = hostAct(s, 2, { type: 'respondEvent', eventId: 'L1-E1', response: { answers: { ...allRight(false), silk: 'bought', hemp: 'sold' } } as never }).snapshot;
    const d = screenData(s);
    expect(minigameResultPicker(d, 0)).toBe('minigameResult');
    const m = byeokrandoResultModel(d);
    expect(m.done).toBe(2);
    expect(m.rows).toHaveLength(10);
    expect(m.rows[9].value).toBe(1);
    expect(m.rows[7].value).toBe(1);
    // 이름이 모델에 없다
    expect(JSON.stringify(m)).not.toContain('해오름');
    // 일시정지면 고르지 않는다(일시정지 장면)
    expect(minigameResultPicker({ ...d, cls: { ...d.cls, paused: true } }, 0)).toBeNull();
    const short = screenData(editPlayer(teach(makeSession({ n: 1 }), { type: 'fireEvent', id: 'L1-E1', short: true }), 1, (p) => (p.company.founded = true)));
    expect(byeokrandoResultModel(short).rows).toHaveLength(6);
  });

  it('두 섬: "성공 n명 / 참여 m명", 성공한 회사들의 두 섬 합계 평균 vs 1단계 합계(55·70)', () => {
    let s = teach(makeSession({ n: 3 }), { type: 'fireEvent', id: 'L1-E5' });
    for (const seat of [1, 2, 3]) s = editPlayer(s, seat, (p) => (p.company.founded = true));
    s = hostAct(s, 1, { type: 'respondEvent', eventId: 'L1-E5', response: { example: true } as never }).snapshot;
    // ㉮ 쌀 1일·㉯ 쌀 10일, 교환 12단위 → ㉮ 쌀 30·옷 72, ㉯ 쌀 26·옷 36 → 합계 쌀 56·옷 108
    expect(judgeTwoIslands({ A: 1, B: 10 }, 12).success).toBe(true);
    s = hostAct(s, 2, { type: 'respondEvent', eventId: 'L1-E5', response: { riceDays: { A: 1, B: 10 }, units: 12 } as never }).snapshot;
    const pub = aggregate(s.class, s.players);
    expect(pub.twoIslands).toEqual({ success: 2, total: 2, avgStage3: { rice: 59, clothes: 102 } });
    const d = screenData(s);
    expect(minigameResultPicker(d, 0)).toBe('minigameResult');
    const m = twoIslandsResultModel(d);
    expect(m).toMatchObject({ success: 2, joined: 3, base: { rice: 55, clothes: 70 }, avg: { rice: 59, clothes: 102 } });
    expect(eventsById['L1-E5'].pages).toEqual([98, 99]);
  });
});
