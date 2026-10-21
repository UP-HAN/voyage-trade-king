/**
 * 작업 108 항구 시장: 보기 계산(market.ts)이 103 `quote()`와 일치, 서비스 카드 0칸, 판매 불가 이유, 도장·관세 시나리오,
 * 한도 안내, 이익 문구, 첫 도장 개념 카드, 용어 사전 쪽수, 그리고 PortScreen 렌더(가짜 DOM).
 */
import { render, type VNode } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyAction, cargoUsed, playerView, publicClass, quote } from '../../src/core';
import type { CargoLot, HostSnapshot, Player } from '../../src/core';
import { conceptCards } from '../../src/data/dex';
import { terms } from '../../src/data/terms';
import { PortScreen, tradeAllowed, TRADE_GUARD_MS } from '../../src/student/port/PortScreen';
import { READY_TOGGLE_GUARD_MS } from '../../src/student/GameScreen';
import {
  buyCards,
  firstStampConcept,
  limitSentence,
  overLimitNote,
  profitText,
  saleSummary,
  SELL_REASON,
  saleTariffLine,
  sellCards,
  tariffSubject,
  tariffWhoSentence,
  wantedGoods,
} from '../../src/student/port/market';
import type { StudentState, StudentStore } from '../../src/student/store';
import { editPlayer, makeSession, player, startFirstRound } from '../core/helpers';
import { installFakeDom, type FakeElement } from '../map/fake-dom';

const lot = (l: Partial<CargoLot> & Pick<CargoLot, 'good' | 'qty'>): CargoLot => ({
  unitCost: 10, origin: 'foreign', source: 'specialty', boughtAt: 'SHA', ...l,
});

function round1(fn?: (p: Player) => void): { s: HostSnapshot; p: Player } {
  let s = startFirstRound(makeSession({ n: 1 }));
  if (fn) s = editPlayer(s, 1, fn);
  return { s, p: player(s, 1) };
}

describe('가격 표시 = quote()', () => {
  it('부산 사기 카드 값·꼬리표가 quote().buy와 같다(특산·국내산·서비스)', () => {
    const { s, p } = round1();
    const cards = buyCards(s.class, p);
    expect(cards.map((c) => c.good).sort()).toEqual(['car', 'chip', 'graphite', 'kcon', 'phone']);
    for (const c of cards) {
      const q = quote(s.class, p, 'BUS', c.good);
      expect(c.price).toBe(q.buy);
      expect(c.label).toBe(q.label);
    }
    expect(cards.find((c) => c.good === 'graphite')!.label).toBe('국내산');
    expect(cards.find((c) => c.good === 'chip')!.label).toBe('싸게 살 수 있어요');
  });

  it('상하이 팔기 카드 값 = quote().sell, 인기 표시, 산 값, 관세 10%', () => {
    const { s, p } = round1((p) => {
      p.game.port = 'SHA';
      p.game.cargo = [lot({ good: 'chip', qty: 5, unitCost: 90, origin: 'korea', boughtAt: 'BUS' })];
    });
    const [c] = sellCards(s.class, p);
    expect(c!.price).toBe(quote(s.class, p, 'SHA', 'chip').sell);
    expect(c!.hot).toBe(true);
    expect(c!.boughtFor).toBe(90);
    expect(c!.tariffRate).toBe(0.1);
    expect(c!.stamp).toBe('export');
    expect(c!.max).toBe(5);
    expect(c!.reason).toBeNull();
  });
});

describe('서비스 = 계약서(0칸)', () => {
  it('K-콘텐츠는 배 칸을 쓰지 않고, 배가 가득 차도 살 수 있다. 라운드당 5계약', () => {
    const { s, p } = round1((p) => {
      p.game.cargo = [lot({ good: 'rice', qty: 20, boughtAt: 'BKK' })];
    });
    const kcon = buyCards(s.class, p).find((c) => c.good === 'kcon')!;
    expect(kcon.service).toBe(true);
    expect(kcon.max).toBe(5);
    expect(buyCards(s.class, p).find((c) => c.good === 'chip')!.reason).toBe('배에 빈칸이 없어요');
    const r = applyAction(s.class, p, { type: 'buy', good: 'kcon', qty: 5 });
    expect(r.error).toBeUndefined();
    expect(cargoUsed(r.player)).toBe(20);
    expect(r.player.game.contracts[0]!.qty).toBe(5);
    expect(buyCards(s.class, r.player).find((c) => c.good === 'kcon')!.reason).toBe('이번 라운드 계약을 다 했어요');
  });
});

describe('판매 불가 이유', () => {
  it('특산 / 거래 안 함 / 산 항구의 계약', () => {
    const { s, p } = round1((p) => {
      p.game.cargo = [
        lot({ good: 'chip', qty: 2, origin: 'korea', boughtAt: 'BUS' }),
        lot({ good: 'graphite', qty: 2, boughtAt: 'SHA' }),
      ];
      p.game.contracts = [lot({ good: 'kcon', qty: 1, origin: 'korea', boughtAt: 'BUS' })];
    });
    const by = Object.fromEntries(sellCards(s.class, p).map((c) => [c.good, c]));
    expect(by.chip!.reason).toBe(SELL_REASON.specialty);
    expect(by.chip!.reason).toBe('여기서 만드는 상품이라 사지 않아요');
    expect(by.graphite!.reason).toBe('이 항구는 이 상품을 사지 않아요');
    expect(by.kcon!.reason).toBe(SELL_REASON.serviceBoughtHere);
    for (const c of Object.values(by)) {
      expect(c.max).toBe(0);
      expect(c.price).toBeNull();
    }
  });
});

describe('도장·관세 시나리오(완료 조건)', () => {
  it('부산 반도체 → 상하이: [수출] + 이익(관세 포함)', () => {
    let { s, p } = round1();
    let r = applyAction(s.class, p, { type: 'buy', good: 'chip', qty: 5 });
    p = { ...r.player, game: { ...r.player.game, port: 'SHA', visit: { arrival: 1, sold: {}, bought: {} } } };
    r = applyAction(s.class, p, { type: 'sell', good: 'chip', qty: 5 });
    const sum = saleSummary(r.events);
    expect(sum.stamps).toEqual(['export']);
    const sell = quote(s.class, p, 'SHA', 'chip').sell!;
    const cost = quote(s.class, player(s, 1), 'BUS', 'chip').buy!;
    expect(sum.profit).toBe(sell * 5 - cost * 5 - Math.round(sell * 5 * 0.1));
    expect(profitText(sum.profit!)).toBe(`+${sum.profit}만 원 남았어요!`);
    expect(firstStampConcept(p, sum.stamps)).toEqual({ stamp: 'export', cardId: 'trade-def' });
  });

  it('포트헤들랜드 천연가스 → 부산: [수입] + 관세 10%', () => {
    let { s, p } = round1((p) => (p.game.port = 'PHE'));
    let r = applyAction(s.class, p, { type: 'buy', good: 'gas', qty: 5 });
    p = { ...r.player, game: { ...r.player.game, port: 'BUS', visit: { arrival: 1, sold: {}, bought: {} } } };
    expect(sellCards(s.class, p)[0]!.tariffRate).toBe(0.1);
    r = applyAction(s.class, p, { type: 'sell', good: 'gas', qty: 5 });
    const sum = saleSummary(r.events);
    expect(sum.stamps).toEqual(['import']);
    expect(sum.tariffRate).toBe(0.1);
    expect(sum.tariffAmount).toBeGreaterThan(0);
  });

  it('방콕 쌀 → 요코하마: [중계] + 관세 10%, 첫 중계 개념 카드', () => {
    let { s, p } = round1((p) => (p.game.port = 'BKK'));
    let r = applyAction(s.class, p, { type: 'buy', good: 'rice', qty: 5 });
    p = { ...r.player, game: { ...r.player.game, port: 'YOK', visit: { arrival: 1, sold: {}, bought: {} } } };
    r = applyAction(s.class, p, { type: 'sell', good: 'rice', qty: 5 });
    const sum = saleSummary(r.events);
    expect(sum.stamps).toEqual(['relay']);
    expect(sum.tariffRate).toBe(0.1);
    expect(firstStampConcept(p, sum.stamps)).toEqual({ stamp: 'relay', cardId: 'relay' });
    // 두 번째 중계에는 다시 띄우지 않음
    expect(firstStampConcept(r.player, ['relay'])).toBeNull();
    expect(conceptCards.find((c) => c.id === 'relay')!.pages).toEqual([104]);
  });

  it('손해 문구, 본전 문구', () => {
    expect(profitText(-12)).toBe('−12만 원 손해 봤어요');
    expect(profitText(0)).toContain('본전');
  });
});

describe('한도 안내', () => {
  it('문구와 한도 초과 안내', () => {
    expect(limitSentence('반도체', 20, false)).toBe('이 항구는 반도체를 20상자까지 제값에 사요');
    expect(limitSentence('쌀', 20, false)).toBe('이 항구는 쌀을 20상자까지 제값에 사요');
    expect(overLimitNote(5, 20)).toBeNull();
    expect(overLimitNote(25, 20)).toBe('한도를 넘는 만큼은 값이 낮아져요');
    expect(overLimitNote(3, 0)).toContain('값이 낮아져요');
  });

  it('제값 한도를 넘겨 팔면 overLimit 이벤트(값 × 0.7)', () => {
    const { s, p } = round1((p) => {
      p.game.port = 'SHA';
      p.game.cargo = [lot({ good: 'chip', qty: 20, origin: 'korea', boughtAt: 'BUS' })];
      p.game.visit.sold = { chip: 15 };
    });
    const c = sellCards(s.class, p)[0]!;
    expect(c.fullLeft).toBe(5);
    expect(overLimitNote(10, c.fullLeft)).not.toBeNull();
    const r = applyAction(s.class, p, { type: 'sell', good: 'chip', qty: 10 });
    expect(saleSummary(r.events).overLimit).toBe(true);
  });
});

describe('이 항구가 사는 상품·용어 사전', () => {
  it('부산이 사는 상품(L1): 천연가스는 인기, 값 없이 이름만', () => {
    const { s, p } = round1();
    const w = wantedGoods(s.class, p);
    expect(w[0]).toEqual({ good: 'gas', name: '천연가스', hot: true });
    expect(w.every((x) => !('price' in x))).toBe(true);
  });
  it('용어 6개 이상, 모든 풀이에 쪽수(94~117)', () => {
    const ids = terms.map((t) => t.id);
    for (const id of ['tariff', 'relay', 'goodsMaterial', 'service', 'export', 'import']) expect(ids).toContain(id);
    for (const t of terms) {
      expect(t.pages.length).toBeGreaterThan(0);
      for (const pg of t.pages) expect(pg >= 94 && pg <= 117).toBe(true);
    }
  });
  it('거래 버튼 연속 클릭 가드는 107 출항 준비 가드와 같은 500ms', () => {
    expect(TRADE_GUARD_MS).toBe(READY_TOGGLE_GUARD_MS);
    expect(tradeAllowed(null, 0)).toBe(true);
    expect(tradeAllowed(1000, 1400)).toBe(false);
    expect(tradeAllowed(1000, 1500)).toBe(true);
  });
});

// ─── 렌더(가짜 DOM) ───

let dom: ReturnType<typeof installFakeDom>;
beforeEach(() => {
  dom = installFakeDom();
});
afterEach(() => {
  act(() => render(null, dom.root as unknown as Element));
  dom.restore();
});

function mount(el: VNode): FakeElement {
  act(() => render(el, dom.root as unknown as Element));
  return dom.root;
}

function fakeState(s: HostSnapshot, p: Player): StudentState {
  return {
    peer: { me: playerView(p), public: { class: publicClass(s.class), public: {} }, status: 'in', queuedCount: 0 },
    toasts: [],
  } as unknown as StudentState;
}

function fakeStore(log: unknown[], toasts: string[]): StudentStore {
  return {
    act: (a: unknown) => {
      log.push(a);
      return 'sent';
    },
    toast: (t: string) => toasts.push(t),
  } as unknown as StudentStore;
}

const byTestId = (root: FakeElement, id: string) => root.find((e) => e.getAttribute('data-testid') === id);

describe('PortScreen 렌더', () => {
  it('상하이: 팔기 카드 숫자는 값·수량·산 값(+관세 도장)만, 값 = quote', () => {
    const { s, p } = round1((p) => {
      p.game.port = 'SHA';
      p.game.cargo = [lot({ good: 'chip', qty: 5, unitCost: 90, origin: 'korea', boughtAt: 'BUS' })];
    });
    const root = mount(<PortScreen store={fakeStore([], [])} st={fakeState(s, p)} onBack={() => undefined} />);
    const card = byTestId(root, 'sell-card-chip')[0]!;
    const sell = quote(s.class, p, 'SHA', 'chip').sell!;
    expect(byTestId(card, 'sell-price')[0]!.textContent).toBe(`여기서 ${sell}만 원 비싸게 팔 수 있어요`);
    const tariff = byTestId(card, 'tariff-badge')[0]!.textContent;
    expect(tariff).toBe('관세 10%');
    const nums = (card.textContent.replace(tariff, '').match(/\d+/g) ?? []).map(Number).sort((a, b) => a - b);
    expect(nums).toEqual([1, 90, sell].sort((a, b) => a - b));
    expect(byTestId(root, 'port-name')[0]!.textContent).toBe('상하이 (중국)');
    expect(byTestId(root, 'not-trading')).toHaveLength(0);
    // 공장·조선소 탭은 L1에서 숨김
    expect(root.textContent).not.toContain('공장');
    expect(root.textContent).not.toContain('조선소');
  });

  it('[팔기] → act({sell}) 한 번 + 이익 토스트 + [수출] 도장, 바로 다시 눌러도 무시', () => {
    const { s, p } = round1((p) => {
      p.game.port = 'SHA';
      p.game.cargo = [lot({ good: 'chip', qty: 5, unitCost: 90, origin: 'korea', boughtAt: 'BUS' })];
    });
    const log: unknown[] = [];
    const toasts: string[] = [];
    const root = mount(<PortScreen store={fakeStore(log, toasts)} st={fakeState(s, p)} onBack={() => undefined} />);
    const btn = byTestId(root, 'sell-chip')[0]!;
    act(() => {
      btn.dispatch('click');
    });
    act(() => {
      byTestId(root, 'sell-chip')[0]!.dispatch('click');
    });
    expect(log).toEqual([{ type: 'sell', good: 'chip', qty: 1 }]);
    expect(toasts[0]).toMatch(/^\+\d+만 원 남았어요!$/);
    expect(byTestId(root, 'result-stamp-export')).toHaveLength(1);
    expect(byTestId(root, 'result-stamp-tariff')[0]!.textContent).toBe('관세 10%');
    expect(byTestId(root, 'concept-pop')[0]!.textContent).toContain('교과서 96쪽');
  });

  it('라운드 밖: 버튼 비활성 + 안내', () => {
    const s0 = makeSession({ n: 1 });
    const root = mount(<PortScreen store={fakeStore([], [])} st={fakeState(s0, player(s0, 1))} onBack={() => undefined} />);
    expect(byTestId(root, 'not-trading')[0]!.textContent).toBe('선생님이 라운드를 시작하면 거래할 수 있어요');
    expect(byTestId(root, 'buy-chip')[0]!.hasAttribute('disabled')).toBe(true);
  });

  it('싱가포르: 관세 없음 게임 규칙 표시', () => {
    let s = startFirstRound(makeSession({ n: 1, scope: ['L2'] }));
    s = editPlayer(s, 1, (p) => (p.game.port = 'SIN'));
    const root = mount(<PortScreen store={fakeStore([], [])} st={fakeState(s, player(s, 1))} onBack={() => undefined} />);
    expect(byTestId(root, 'singapore-note')[0]!.textContent).toContain('게임 규칙');
    expect(byTestId(root, 'singapore-note')[0]!.textContent).toContain('싱가포르 항구는 관세가 없어요');
  });
});

describe('관세를 매기는 나라(수정 1회차)', () => {
  it('관세 설명 문장의 주어는 그 항구 나라: 상하이 중국 / 부산 우리나라 / 요코하마 일본', () => {
    expect(tariffWhoSentence('SHA')).toBe('중국은 다른 나라에서 들어오는 상품에 관세를 매겨요');
    expect(tariffWhoSentence('BUS')).toBe('우리나라는 다른 나라에서 들어오는 상품에 관세를 매겨요');
    expect(tariffWhoSentence('YOK')).toBe('일본은 다른 나라에서 들어오는 상품에 관세를 매겨요');
    expect(tariffSubject('BKK')).toBe('타이는');
  });

  it('결과 띠 설명 줄: [수출]+관세(상하이) / [수입]+관세(부산) / [중계]+관세(요코하마), 관세 없으면 없음', () => {
    expect(saleTariffLine('SHA', ['export'], 98)).toBe('중국에서는 우리 상품이 수입품이라 중국에 관세를 냈어요');
    expect(saleTariffLine('BUS', ['import'], 30)).toContain('우리나라에 들어오는 수입품이라 우리나라에 관세를 냈어요');
    expect(saleTariffLine('YOK', ['relay'], 10)).toBe('일본에서는 다른 나라에서 들어온 수입품이라 일본에 관세를 냈어요');
    expect(saleTariffLine('SIN', ['relay'], 0)).toBeNull();
  });

  it('렌더: 상하이 팔기 영역 문장 주어 = 중국, 관세 도장 옆 게임 규칙, [팔기] 뒤 결과 띠 설명 줄', () => {
    const { s, p } = round1((p) => {
      p.game.port = 'SHA';
      p.game.cargo = [lot({ good: 'chip', qty: 5, unitCost: 90, origin: 'korea', boughtAt: 'BUS' })];
    });
    const root = mount(<PortScreen store={fakeStore([], [])} st={fakeState(s, p)} onBack={() => undefined} />);
    expect(byTestId(root, 'tariff-who')[0]!.textContent).toBe('중국은 다른 나라에서 들어오는 상품에 관세를 매겨요.');
    expect(byTestId(root, 'tariff-rule-tag')[0]!.textContent).toBe('게임 규칙');
    expect(root.textContent).toContain('다른 나라에서 사 온 상품을 우리나라(부산)에 팔면 수입이에요');
    act(() => {
      byTestId(root, 'sell-chip')[0]!.dispatch('click');
    });
    const line = byTestId(root, 'sale-tariff-line')[0]!.textContent;
    expect(line).toContain('중국에서는 우리 상품이 수입품이라 중국에 관세를 냈어요');
    expect(line).toContain('관세를 내고 남은 돈이에요');
    expect(line).toContain('게임 규칙: 관세 10%');
  });

  it('렌더: 요코하마 중계·부산 수입도 그 나라가 주어', () => {
    for (const [port, good, from, country] of [
      ['YOK', 'rice', 'BKK', '일본은'],
      ['BUS', 'gas', 'PHE', '우리나라는'],
    ] as const) {
      const { s, p } = round1((p) => {
        p.game.port = port;
        p.game.cargo = [lot({ good, qty: 3, boughtAt: from })];
      });
      const root = mount(<PortScreen store={fakeStore([], [])} st={fakeState(s, p)} onBack={() => undefined} />);
      expect(byTestId(root, 'tariff-who')[0]!.textContent).toBe(`${country} 다른 나라에서 들어오는 상품에 관세를 매겨요.`);
      act(() => render(null, dom.root as unknown as Element));
    }
  });
});

describe('(작업 154) 2차시 나눠 고르기 — 싱가포르 안내 줄·첫 중계 개념 카드(v0.3.9)', () => {
  const withPart = (s: HostSnapshot, part: 'front' | 'back' | 'all'): HostSnapshot => ({ ...s, class: { ...s.class, settings: { ...s.class.settings, lessonPart: part } } });
  const sinState = (part: 'front' | 'back' | 'all') => {
    let s = withPart(startFirstRound(makeSession({ n: 1, scope: ['L2'], playUnit: 'lesson' })), part);
    s = editPlayer(s, 1, (p) => (p.game.port = 'SIN'));
    return s;
  };

  it('앞 시간 판: 싱가포르 항구에 singapore-note 없음, 뒤 시간·두 시간 모두는 있음', () => {
    let root = mount(<PortScreen store={fakeStore([], [])} st={fakeState(sinState('front'), player(sinState('front'), 1))} onBack={() => undefined} />);
    expect(byTestId(root, 'singapore-note')).toHaveLength(0);
    expect(byTestId(root, 'port-screen')).toHaveLength(1);
    act(() => render(null, dom.root as unknown as Element));
    root = mount(<PortScreen store={fakeStore([], [])} st={fakeState(sinState('back'), player(sinState('back'), 1))} onBack={() => undefined} />);
    expect(byTestId(root, 'singapore-note')).toHaveLength(1);
    act(() => render(null, dom.root as unknown as Element));
    root = mount(<PortScreen store={fakeStore([], [])} st={fakeState(sinState('all'), player(sinState('all'), 1))} onBack={() => undefined} />);
    expect(byTestId(root, 'singapore-note')).toHaveLength(1);
  });

  it('firstStampConcept hideRelay: 첫 중계 카드는 띄우지 않고 첫 수출·수입 카드는 그대로', () => {
    const { p } = round1();
    expect(firstStampConcept(p, ['relay'], { hideRelay: true })).toBeNull();
    expect(firstStampConcept(p, ['relay'])).toEqual({ stamp: 'relay', cardId: 'relay' });
    expect(firstStampConcept(p, ['export'], { hideRelay: true })).toEqual({ stamp: 'export', cardId: 'trade-def' });
    expect(firstStampConcept(p, ['relay', 'export'], { hideRelay: true })).toEqual({ stamp: 'export', cardId: 'trade-def' });
  });
});
