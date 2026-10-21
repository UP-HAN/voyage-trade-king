/**
 * 작업 111: 사건·결정 카드 모델(띠·쪽수·짧은 형태·단원 한 판 문구), 학생 사건 층 판단(차단/비차단·따라잡기·튜토리얼),
 * 그리고 EventLayer 렌더(가짜 DOM).
 */
import { render, type VNode } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyAction, playerView, publicClass, type HostSnapshot, type Player } from '../../src/core';
import { hostReduce } from '../../src/core/host';
import { eventsById } from '../../src/data/events';
import { banners } from '../../src/data/text';
import { textbookArticles } from '../../src/data/text';
import { EventLayer } from '../../src/student/events/EventLayer';
import { catchUpPlan, liveEvent, resultEvent, tutorialCanStart, tutorialStep } from '../../src/student/events/logic';
import type { StudentState, StudentStore } from '../../src/student/store';
import { decisionModel, eventCardModel, explainText, linkPages, showUnitNote } from '../../src/ui/cards';
import { editPlayer, makeSession, player, startFirstRound, teach } from '../core/helpers';
import { installFakeDom, type FakeElement } from '../map/fake-dom';

const L1_CARD_EVENTS = ['L1-E1', 'L1-E2', 'L1-E4', 'L1-E5', 'L1-E6', 'L1-E7', 'L1-E8'];

describe('카드 모델: 띠·쪽수', () => {
  it('L1 사건 카드는 모두 띠와 쪽수가 있다', () => {
    for (const id of L1_CARD_EVENTS) {
      const m = eventCardModel(eventsById[id]);
      expect(m.bandText, id).toBeTruthy();
      expect(m.pages.length, id).toBeGreaterThan(0);
      expect(linkPages(m.pages), id).toMatch(/^교과서 연결 p\.\d/);
      for (const q of m.quotes) expect(q.pages.length, id).toBeGreaterThan(0);
    }
  });
  it('천연가스 뉴스(L1-E6)는 "가상 뉴스 — 교과서 내용을 바탕으로 만든 이야기예요" 띠 + 효과 요약 + 안내 항해사', () => {
    const m = eventCardModel(eventsById['L1-E6']);
    expect(m.band).toBe('news');
    expect(m.bandText).toBe('가상 뉴스 — 교과서 내용을 바탕으로 만든 이야기예요');
    expect(m.bandText).toBe(banners.fakeNews);
    expect(m.effects).toContain('부산 천연가스 값 ↑ (이번 차시)');
    expect(m.effects).toContain('임무: 부산에 천연가스를 가져와요');
    expect(m.paragraphs.length).toBeLessThanOrEqual(3);
    expect(m.guide).toContain('안내 항해사');
    expect(m.quotes[0].pages).toEqual([97]);
  });
  it('L1-E2 개념: 전체는 고려 예시 포함, 짧은 형태는 정의만(예시 생략)', () => {
    const full = eventCardModel(eventsById['L1-E2']);
    const short = eventCardModel(eventsById['L1-E2'], { short: true });
    expect(full.band).toBe('concept');
    expect(full.paragraphs.join(' ')).toContain('고려 입장에서');
    expect(short.short).toBe(true);
    expect(short.paragraphs.join(' ')).not.toContain('고려');
    expect(short.paragraphs.join(' ')).toContain('무역이에요');
    expect(short.quotes.every((q) => q.pages.includes(96))).toBe(true);
  });
  it('L1-E4 무역이 없다면?: 상황 카드 2장(p.97) / 짧은 형태 1장(천연가스)', () => {
    const full = eventCardModel(eventsById['L1-E4']);
    expect(full.situations.map((s) => s.title)).toEqual(['천연가스를 생산할 수 없다면', '비행기를 만드는 기술이 없다면']);
    expect(full.situations.every((s) => s.quote?.pages.includes(97))).toBe(true);
    const short = eventCardModel(eventsById['L1-E4'], { short: true });
    expect(short.situations.map((s) => s.title)).toEqual(['천연가스를 생산할 수 없다면']);
  });
  it('unitOnlyNote: 단원 한 판(다음 구간이 범위에 있음)에서만', () => {
    const def = eventsById['L1-E7'];
    expect(showUnitNote(def, ['L1'])).toBe(false);
    expect(showUnitNote(def, ['L1', 'L2', 'L3', 'L4'])).toBe(true);
    expect(showUnitNote(def, ['L2', 'L1'])).toBe(false);
    expect(decisionModel(def, { scope: ['L1'] }).unitNote).toBeNull();
    expect(decisionModel(def, { scope: ['L1', 'L2'] }).unitNote).toBe(def.unitOnlyNote);
  });
  it('L1-E7 결정 모델: 상황 2문장·묻는 말·선택지 3개·고른 뒤 p.99 흑연 카드', () => {
    const m = decisionModel(eventsById['L1-E7']);
    expect(m.situation).toHaveLength(2);
    expect(m.ask.join(' ')).toContain('골라 보세요');
    expect(m.options.map((o) => o.id)).toEqual(['SHA', 'BUS', 'none']);
    expect(m.reveal?.title).toBe('흑연');
    expect(m.reveal?.text).toBe('흑연은 연필뿐만 아니라 스마트폰, 배터리의 원료로 쓰여요.');
    expect(m.reveal?.quote?.pages).toEqual([99]);
  });
  it('교과서 속 기사 띠(ArticleCard 틀용)', () => {
    expect(textbookArticles.mineralCoop.pages).toEqual([106]);
    expect(eventCardModel({ ...eventsById['L1-E2'], kind: 'article' }).bandText).toBe('교과서 속 기사');
    expect(eventCardModel(eventsById['L1-E2'], { variant: 'incident' }).band).toBe('incident');
  });
});

// ─── 층 판단 ────────────────────────────────────────────

function round1(n = 2): HostSnapshot {
  return startFirstRound(makeSession({ n }));
}
const meOf = (s: HostSnapshot, seat: number) => playerView(player(s, seat));

describe('학생 사건 층 판단', () => {
  it('차단형(L1-E2)은 가운데, 비차단(L1-E6·L1-E7)은 패널', () => {
    let s = teach(makeSession({ n: 1 }), { type: 'fireEvent', id: 'L1-E2' });
    expect(liveEvent(publicClass(s.class))).toMatchObject({ id: 'L1-E2', blocking: true, shape: 'card' });
    s = teach(round1(1), { type: 'fireEvent', id: 'L1-E6' });
    expect(liveEvent(publicClass(s.class))).toMatchObject({ id: 'L1-E6', blocking: false, shape: 'card' });
    s = teach(s, { type: 'fireEvent', id: 'L1-E7' });
    expect(liveEvent(publicClass(s.class))).toMatchObject({ id: 'L1-E7', blocking: false, shape: 'decision' });
  });

  it('따라잡기: 늦게 온 학생 → 요약 카드 1장(L1-E2·L1-E4·L1-E6) + 개인 응답 사건(L1-E5·L1-E7), 회사 설립 L1-E3 없음', () => {
    let s = makeSession({ n: 1 });
    s = teach(s, { type: 'fireEvent', id: 'L1-E2' });
    s = teach(s, { type: 'closeEvent' });
    s = teach(s, { type: 'fireEvent', id: 'L1-E4' });
    s = teach(s, { type: 'closeEvent' });
    s = teach(s, { type: 'fireEvent', id: 'L1-E5' });
    s = teach(s, { type: 'closeEvent' });
    s = teach(s, { type: 'startRound' });
    s = teach(s, { type: 'fireEvent', id: 'L1-E6' });
    s = teach(s, { type: 'fireEvent', id: 'L1-E7' });
    s = teach(s, { type: 'closeEvent', reveal: true });
    s = hostReduce(s, { type: 'join', seat: 3, pid: 'p03qz', companyName: '늦은배', nameKey: '늦은배' }, 5000).snapshot;
    const late = meOf(s, 3);
    expect(late.company.founded).toBe(false);
    const plan = catchUpPlan(publicClass(s.class), late);
    expect(plan).toEqual([
      { mode: 'summary', ids: ['L1-E2', 'L1-E4', 'L1-E6'] },
      { mode: 'replay', id: 'L1-E5' },
      { mode: 'replay', id: 'L1-E7' },
    ]);
    // 처음부터 있던 학생은 마감 기본값이 있어 L1-E7 따라잡기 없음
    const early = meOf(s, 1);
    expect(catchUpPlan(publicClass(s.class), early).some((x) => x.mode === 'replay' && x.id === 'L1-E7')).toBe(false);
  });

  it('튜토리얼: L1 첫 라운드에 시작 → 단계(포트헤들랜드 → 출항 준비 → 도착 → 항구 → 천연가스)', () => {
    let s = teach(round1(1), { type: 'fireEvent', id: 'L1-E6' });
    const cls = publicClass(s.class);
    let me = meOf(s, 1);
    expect(tutorialCanStart(cls, me)).toBe(true);
    expect(tutorialStep(me, false)).toBe('pickDest');
    s = editPlayer(s, 1, (p) => {
      p.game.dest = 'PHE';
    });
    expect(tutorialStep(meOf(s, 1), false)).toBe('ready');
    s = editPlayer(s, 1, (p) => {
      p.game.ready = true;
    });
    expect(tutorialStep(meOf(s, 1), false)).toBe('arrive');
    s = editPlayer(s, 1, (p) => {
      p.game.port = 'PHE';
      p.game.dest = null;
      p.game.ready = false;
    });
    expect(tutorialStep(meOf(s, 1), false)).toBe('enterPort');
    expect(tutorialStep(meOf(s, 1), true)).toBe('buyGas');
    s = editPlayer(s, 1, (p) => {
      p.game.cargo = [{ good: 'gas', qty: 1, unitCost: 10, origin: 'foreign', source: 'specialty', boughtAt: 'PHE' }];
    });
    me = meOf(s, 1);
    expect(tutorialStep(me, true)).toBe('done');
    // 범위에 L1이 없으면 시작 안 함
    const s2 = teach(startFirstRound(makeSession({ n: 1, scope: ['L2'] })), { type: 'fireEvent', id: 'L1-E6' });
    expect(tutorialCanStart(publicClass(s2.class), meOf(s2, 1))).toBe(false);
  });
});

// ─── 렌더 ──────────────────────────────────────────────

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

function founded(s: HostSnapshot, seat: number): HostSnapshot {
  return editPlayer(s, seat, (p) => {
    p.company.founded = true;
  });
}

function fakeState(s: HostSnapshot, p: Player): StudentState {
  return {
    peer: { me: playerView(p), public: { class: publicClass(s.class), public: {} }, status: 'in', queuedCount: 0, pid: p.pid, code: '482137' },
    toasts: [],
  } as unknown as StudentState;
}

/** 행동을 받아 core 규칙으로 바로 반영하는 가짜 저장소 */
function fakeStore(log: unknown[]): StudentStore {
  return {
    act: (a: unknown) => {
      log.push(a);
      return 'sent';
    },
    toast: () => undefined,
  } as unknown as StudentStore;
}

const byTestId = (root: FakeElement, id: string) => root.find((e) => e.getAttribute('data-testid') === id);

/** (152) 학급 상태에 지금 사건을 바로 넣는다(배치·발동 규칙과 상관없이 층 그리기만 확인) */
function withEvent(s: HostSnapshot, id: string, short = false): HostSnapshot {
  return { ...s, class: { ...s.class, phase: 'event', currentEvent: { id, openedAt: 0, closesAt: null, closed: false, short } } };
}

describe('EventLayer 렌더', () => {
  it('(152) L1-E2 차단형 개념 카드(가운데, 어두운 층) → "TV 화면을 함께 봐요" 카드, [다 봤어요] 한 번만 respondEvent(연속 클릭 가드)', () => {
    let s = founded(teach(makeSession({ n: 1 }), { type: 'fireEvent', id: 'L1-E2' }), 1);
    s = { ...s, class: { ...s.class, phase: 'event' } };
    const log: unknown[] = [];
    const root = mount(<EventLayer store={fakeStore(log)} st={fakeState(s, player(s, 1))} />);
    const tv = byTestId(root, 'event-tv-card')[0]!;
    expect(tv.getAttribute('data-event')).toBe('L1-E2');
    expect(byTestId(root, 'event-tv-band')[0]!.textContent).toBe('개념 공부');
    expect(byTestId(root, 'event-tv-title')[0]!.textContent).toBe('무역·수입·수출');
    expect(tv.textContent).toContain('TV 화면을 함께 봐요');
    expect(byTestId(root, 'event-tv-note')[0]!.textContent).toBe("선생님과 같이 읽어요. 이 내용은 나중에 [도감]의 '무역·수입·수출'에서 다시 볼 수 있어요.");
    // 긴 본문은 학생 기기에 없다
    expect(byTestId(root, 'card-body')).toHaveLength(0);
    expect(root.find((e) => e.getAttribute('data-layer') === 'event')).toHaveLength(1);
    expect(byTestId(root, 'card-confirm')[0]!.textContent).toBe('다 봤어요');
    act(() => {
      byTestId(root, 'card-confirm')[0]!.dispatch('click');
    });
    act(() => {
      byTestId(root, 'card-confirm')[0]?.dispatch('click');
    });
    expect(log).toEqual([{ type: 'respondEvent', eventId: 'L1-E2', response: { seen: true } }]);
  });

  it('(152) [내 화면에서 읽기] → 예전 긴 카드(띠·쪽수·본문, [확인] → seen)', () => {
    const s = founded(teach(makeSession({ n: 1 }), { type: 'fireEvent', id: 'L1-E2' }), 1);
    const log: unknown[] = [];
    const root = mount(<EventLayer store={fakeStore(log)} st={fakeState(s, player(s, 1))} />);
    act(() => {
      byTestId(root, 'event-tv-read-here')[0]!.dispatch('click');
    });
    expect(byTestId(root, 'event-tv-card')).toHaveLength(0);
    const card = byTestId(root, 'event-card')[0]!;
    expect(card.getAttribute('data-short')).toBe('0');
    expect(byTestId(root, 'card-band')[0]!.textContent).toContain('개념');
    expect(byTestId(root, 'card-pages')[0]!.textContent).toBe('교과서 연결 p.96');
    expect(byTestId(root, 'card-body')[0]!.textContent).toContain('고려 입장에서');
    act(() => {
      byTestId(root, 'card-confirm')[0]!.dispatch('click');
    });
    expect(log).toEqual([{ type: 'respondEvent', eventId: 'L1-E2', response: { seen: true } }]);
  });

  it('(152) L1-E4·L2-E2도 TV 카드, 도감 카드 이름', () => {
    let s = founded(teach(makeSession({ n: 1 }), { type: 'fireEvent', id: 'L1-E4' }), 1);
    let root = mount(<EventLayer store={fakeStore([])} st={fakeState(s, player(s, 1))} />);
    expect(byTestId(root, 'event-tv-card')[0]!.getAttribute('data-event')).toBe('L1-E4');
    expect(byTestId(root, 'event-tv-note')[0]!.textContent).toContain("[도감]의 '무역이 필요한 까닭'");
    s = founded(withEvent(makeSession({ n: 1, scope: ['L2'] }), 'L2-E2'), 1);
    root = mount(<EventLayer store={fakeStore([])} st={fakeState(s, player(s, 1))} />);
    expect(byTestId(root, 'event-tv-card')[0]!.getAttribute('data-event')).toBe('L2-E2');
    expect(byTestId(root, 'event-tv-title')[0]!.textContent).toBe('부산 공장 개장');
    expect(byTestId(root, 'event-tv-note')[0]!.textContent).toContain("[도감]의 '우리나라 무역의 특징'");
  });

  it('L1-E2 짧은 형태·L1-E4 짧은 형태(상황 카드 1장) — TV 카드, [내 화면에서 읽기]로 짧은 긴 카드', () => {
    let s = founded(teach(makeSession({ n: 1 }), { type: 'fireEvent', id: 'L1-E4', short: true }), 1);
    let root = mount(<EventLayer store={fakeStore([])} st={fakeState(s, player(s, 1))} />);
    expect(byTestId(root, 'event-tv-card')).toHaveLength(1);
    act(() => {
      byTestId(root, 'event-tv-read-here')[0]!.dispatch('click');
    });
    expect(byTestId(root, 'event-card')[0]!.getAttribute('data-short')).toBe('1');
    expect(byTestId(root, 'card-situation')).toHaveLength(1);
    s = founded(teach(makeSession({ n: 1 }), { type: 'fireEvent', id: 'L1-E2', short: true }), 1);
    root = mount(<EventLayer store={fakeStore([])} st={fakeState(s, player(s, 1))} />);
    expect(byTestId(root, 'event-tv-card')).toHaveLength(1);
    act(() => {
      byTestId(root, 'event-tv-read-here')[0]!.dispatch('click');
    });
    expect(byTestId(root, 'card-body')[0]!.textContent).not.toContain('고려');
  });

  it('(152) 표지(L1-COVER)·세관 게시판(L2-E6)·L2-E5 패널은 예전 그대로(TV 카드 없음)', () => {
    let s = founded(withEvent(makeSession({ n: 1 }), 'L1-COVER'), 1);
    let root = mount(<EventLayer store={fakeStore([])} st={fakeState(s, player(s, 1))} />);
    expect(byTestId(root, 'event-tv-card')).toHaveLength(0);
    expect(byTestId(root, 'event-card')).toHaveLength(0);
    s = founded(withEvent(makeSession({ n: 1, scope: ['L2'] }), 'L2-E6'), 1);
    root = mount(<EventLayer store={fakeStore([])} st={fakeState(s, player(s, 1))} />);
    expect(byTestId(root, 'event-tv-card')).toHaveLength(0);
    expect(byTestId(root, 'event-card')[0]!.getAttribute('data-event')).toBe('L2-E6');
    expect(byTestId(root, 'card-title')[0]!.textContent).toBe('세관 게시판');
    s = founded(withEvent(makeSession({ n: 1, scope: ['L2'] }), 'L2-E5'), 1);
    root = mount(<EventLayer store={fakeStore([])} st={fakeState(s, player(s, 1))} />);
    expect(byTestId(root, 'event-tv-card')).toHaveLength(0);
    // 비차단(오른쪽 패널·임무 패널 쪽) — 가운데 차단 층이 없다
    expect(root.find((e) => e.getAttribute('data-layer') === 'event')).toHaveLength(0);
  });

  it('L1-E6 비차단: 오른쪽 패널(어두운 층 없음), 가상 뉴스 띠, 효과 요약', () => {
    const s = founded(teach(round1(1), { type: 'fireEvent', id: 'L1-E6' }), 1);
    const root = mount(<EventLayer store={fakeStore([])} st={fakeState(s, player(s, 1))} />);
    expect(byTestId(root, 'event-panel')).toHaveLength(1);
    expect(root.find((e) => (e.getAttribute('class') ?? '').includes('st-layer--dim'))).toHaveLength(0);
    expect(byTestId(root, 'card-band')[0]!.textContent).toContain('가상 뉴스 — 교과서 내용을 바탕으로 만든 이야기예요');
    expect(byTestId(root, 'card-effects')[0]!.textContent).toContain('부산 천연가스 값 ↑ (이번 차시)');
  });

  it('L1-E7 결정 패널: 고르고 [결정하기] → respondEvent, 결과 화면에 p.99 흑연 카드; 차시 한 판이면 unitOnlyNote 없음', () => {
    let s = founded(teach(teach(round1(1), { type: 'fireEvent', id: 'L1-E6' }), { type: 'fireEvent', id: 'L1-E7' }), 1);
    const log: unknown[] = [];
    let root = mount(<EventLayer store={fakeStore(log)} st={fakeState(s, player(s, 1))} />);
    expect(byTestId(root, 'event-panel')[0]!.getAttribute('data-event')).toBe('L1-E7');
    expect(byTestId(root, 'card-unit-note')).toHaveLength(0);
    act(() => {
      byTestId(root, 'decision-opt-SHA')[0]!.dispatch('click');
    });
    act(() => {
      byTestId(root, 'decision-submit')[0]!.dispatch('click');
    });
    expect(log).toEqual([{ type: 'respondEvent', eventId: 'L1-E7', response: { choice: 'SHA' } }]);
    // 호스트 반영 뒤
    const r = applyAction(s.class, player(s, 1), log[0] as never);
    s = { ...s, players: { ...s.players, s01: r.player } };
    root = mount(<EventLayer store={fakeStore([])} st={fakeState(s, player(s, 1))} />);
    expect(byTestId(root, 'decision-chosen')[0]!.getAttribute('data-choice')).toBe('SHA');
    expect(byTestId(root, 'decision-reveal')[0]!.textContent).toContain('교과서 연결 p.99');
  });

  it('단원 한 판이면 L1-E7 카드에 unitOnlyNote', () => {
    const s = founded(teach(startFirstRound(makeSession({ n: 1, scope: ['L1', 'L2', 'L3', 'L4'], playUnit: 'unit' })), { type: 'fireEvent', id: 'L1-E7' }), 1);
    const root = mount(<EventLayer store={fakeStore([])} st={fakeState(s, player(s, 1))} />);
    expect(byTestId(root, 'card-unit-note')[0]!.textContent).toBe(eventsById['L1-E7'].unitOnlyNote);
  });

  it('미니게임 사건(L1-E1)은 MinigameLayer로 넘긴다(작업 113: 벽란도 시장 화면)', () => {
    const s = founded(teach(makeSession({ n: 1 }), { type: 'fireEvent', id: 'L1-E1' }), 1);
    const root = mount(<EventLayer store={fakeStore([])} st={fakeState(s, player(s, 1))} />);
    expect(byTestId(root, 'minigame')[0]!.getAttribute('data-event')).toBe('L1-E1');
    expect(root.find((e) => e.getAttribute('data-layer') === 'minigame')).toHaveLength(1);
  });

  it('회사 설립 전에는 아무것도 그리지 않는다(107 회사 설립 화면이 먼저)', () => {
    const s = teach(makeSession({ n: 1 }), { type: 'fireEvent', id: 'L1-E2' });
    const root = mount(<EventLayer store={fakeStore([])} st={fakeState(s, player(s, 1))} />);
    expect(byTestId(root, 'event-card')).toHaveLength(0);
  });
});

describe('(수정 1회차) 마감 뒤 결과 표시', () => {
  it('확인 퀴즈를 [결과 공개] 없이 마감해도 학생에게 결과·해설·쪽수(한 번)', () => {
    let s = founded(round1(1), 1);
    s = teach(s, { type: 'endRound' });
    s = teach(s, { type: 'fireEvent', id: 'L1-E8' }, 1000);
    s = teach(s, { type: 'closeEvent' }, 2000);
    const cls = publicClass(s.class);
    expect(resultEvent(cls, 2500)).toMatchObject({ id: 'L1-E8', shape: 'quiz' });
    expect(resultEvent(cls, 2000 + 21_000)).toBeNull();
    const store = { ...fakeStore([]), serverNow: () => 2500 } as unknown as StudentStore;
    const root = mount(<EventLayer store={store} st={fakeState(s, player(s, 1))} />);
    expect(byTestId(root, 'event-result')).toHaveLength(1);
    const ex = byTestId(root, 'quiz-explain');
    expect(ex).toHaveLength(2);
    expect(ex[0]!.textContent).toContain('교과서 연결 p.96');
    expect(ex[0]!.textContent).not.toContain('(교과서 96쪽)');
  });
  it('explainText: 끝의 "(교과서 n쪽)"만 뺀다', () => {
    expect(explainText('수출이라고 해요. (교과서 96쪽)')).toBe('수출이라고 해요.');
    expect(explainText('그대로')).toBe('그대로');
  });
});

describe('(작업 153) 2차시 임무 패널 "먼저 할 일"', () => {
  function l2Panel(withCargo: boolean): FakeElement {
    let s = startFirstRound(makeSession({ n: 1, scope: ['L2'], playUnit: 'lesson' }));
    s = founded(teach(s, { type: 'fireEvent', id: 'L2-E3' }), 1);
    // 임무 3개 모두 패널에 오게(배치에서는 라운드 1 시작에 함께 붙는다)
    s = editPlayer(s, 1, (p) => {
      for (const id of ['M-IPE', 'M-EXPORT4', 'M-RELAY']) p.game.missions[id] ??= { status: 'active', steps: [] } as never;
    });
    if (!withCargo) s = editPlayer(s, 1, (p) => { p.game.log = p.game.log.filter((e) => e.ref !== 'startCargo'); });
    return mount(<EventLayer store={fakeStore([])} st={fakeState(s, player(s, 1))} />);
  }

  it('처음 화물이 있으면: 제목 바로 아래·목록 위에 먼저 할 일 상자, 처음 화물 글은 그 안에 한 번만', () => {
    const root = l2Panel(true);
    const panel = byTestId(root, 'mission-panel')[0]!;
    expect(panel).toBeDefined();
    const first = byTestId(panel, 'mission-first');
    expect(first).toHaveLength(1);
    expect(first[0]!.getAttribute('class')).toBe('ev-first');
    expect(first[0]!.textContent).toContain('먼저 할 일: 부산 [항구 들어가기] → [공장]에서 원유로 석유 제품 만들기');
    const cargo = byTestId(root, 'mission-start-cargo');
    expect(cargo).toHaveLength(1);
    expect(cargo[0]!.textContent).toBe('우리 배에 담맘에서 사 온 원유 2상자가 실려 있어요. 만든 상품을 다른 나라에 팔면 [수출] 도장을 받아요.');
    expect(byTestId(first[0]!, 'mission-start-cargo')).toHaveLength(1);
    // 위치: 제목 다음, 임무 목록 앞
    const text = panel.textContent;
    const iTitle = text.indexOf('2차시 임무');
    const iFirst = text.indexOf('먼저 할 일');
    const iList = text.indexOf('자원 수입 → 생산 → 수출');
    expect(iTitle).toBeGreaterThanOrEqual(0);
    expect(iTitle).toBeLessThan(iFirst);
    expect(iFirst).toBeLessThan(iList);
    expect(text.split('원유 2상자').length - 1).toBe(1);
    expect(byTestId(root, 'card-confirm')[0]!.getAttribute('data-role')).toBe('mission-panel-ok');
  });

  it('처음 화물이 없으면: "먼저 할 일: 위에서 첫 번째 임무부터 해요"', () => {
    const root = l2Panel(false);
    expect(byTestId(root, 'mission-first')[0]!.textContent).toBe('먼저 할 일: 위에서 첫 번째 임무부터 해요');
    expect(byTestId(root, 'mission-start-cargo')).toHaveLength(0);
  });

  it('꼭 할 임무가 아닌 것(수출국 4유형·싱가포르 중계)에만 " · 시간 나면" 꼬리표', () => {
    const root = l2Panel(true);
    const items = root.find((e) => (e.getAttribute('data-testid') ?? '').startsWith('mission-intro-'));
    const opt = Object.fromEntries(items.map((li) => [li.getAttribute('data-testid'), li.find((e) => e.getAttribute('class') === 'ev-missions__opt').length]));
    expect(opt['mission-intro-M-IPE']).toBe(0);
    expect(opt['mission-intro-M-EXPORT4']).toBe(1);
    expect(opt['mission-intro-M-RELAY']).toBe(1);
    expect(items.find((li) => li.getAttribute('data-testid') === 'mission-intro-M-RELAY')!.textContent).toContain(' · 시간 나면');
  });
});
