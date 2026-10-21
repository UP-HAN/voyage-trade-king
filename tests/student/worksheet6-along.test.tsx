/**
 * 작업 165 — 학생 화면 '잠깐! 학습지 ⑥' 함께 쓰기 안내 카드(비차단, PRD 4.1.1 v0.3.10).
 * ⑤ 끝 + ⑥ 아직 + 라운드 중이면 카드, [알겠어요] → 사라짐(다시 그려도·같은 판), 다른 판이면 다시 뜸.
 * ⑤ 아직·⑥ 진행/끝·뒤 시간·1차시 판이면 없음. 카드는 하단 바 밖(흐름 안)이라 [항구 들어가기]를 덮지 않는다.
 */
import { render, type VNode } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hostReduce, playerView, publicClass, startSession, type HostSnapshot, type Player } from '../../src/core';
import { createTradeHooks } from '../../src/core/trade';
import { WS6_ALONG_TEXT } from '../../src/data/lessonParts';
import { GameScreen } from '../../src/student/GameScreen';
import type { StudentState, StudentStore } from '../../src/student/store';
import { alongCardOn, alongPlanned } from '../../src/student/worksheet/along';
import { editPlayer, player } from '../core/helpers';
import { installFakeDom, type FakeElement } from '../map/fake-dom';

let dom: ReturnType<typeof installFakeDom>;
const mem = new Map<string, string>();
beforeEach(() => {
  dom = installFakeDom();
  mem.clear();
  (globalThis as { sessionStorage?: unknown }).sessionStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  };
});
afterEach(() => {
  act(() => render(null, dom.root as unknown as Element));
  dom.restore();
  delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
});

function mount(el: VNode): FakeElement {
  act(() => render(el, dom.root as unknown as Element));
  return dom.root;
}
const byTestId = (root: FakeElement, id: string) => root.find((e) => e.getAttribute('data-testid') === id);
const click = (el: FakeElement) => act(() => void el.dispatch('click'));

function fakeState(s: HostSnapshot, p: Player, code = '482137'): StudentState {
  return {
    peer: { me: playerView(p), public: { class: publicClass(s.class), public: { companies: [], ships: [] } }, status: 'in', queuedCount: 0, pid: p.pid, code },
    toasts: [],
  } as unknown as StudentState;
}

const noop = () => undefined;
const fakeStore = {
  act: () => 'sent',
  toast: noop,
  onGameEvents: () => noop,
  onNotice: () => noop,
  notice: () => null,
  serverNow: () => Date.now(),
  getState: () => ({}),
  subscribe: () => noop,
} as unknown as StudentStore;

const hooks = createTradeHooks();
const T0 = 10_000;
const status = (s: HostSnapshot, id: string) => s.class.schedule.items.find((it) => it.id === id)?.status;

/** 2차시 앞 시간 25분 판을 자동 진행: `until`이 참이 될 때까지 */
function run(until: (s: HostSnapshot) => boolean): HostSnapshot {
  let s = startSession({ code: '482137', playUnit: 'lesson', scope: ['L2'], seed: 12345, now: 0, hostToken: 'host-token', settings: { lessonPart: 'front' } });
  s = hostReduce(s, { type: 'join', seat: 1, pid: 'p1', deviceToken: 'd1', companyName: '해오름1', nameKey: '해오름1' }, 0).snapshot;
  s = hostReduce(s, { type: 'teacher', action: { type: 'updateSettings', settings: { tradeMinutes: 25, worksheetWaitSec: 0 } } }, T0 - 1, hooks).snapshot;
  s = hostReduce(s, { type: 'teacher', action: { type: 'startTrade' } }, T0, hooks).snapshot;
  for (let sec = 1; sec < 1700 && !until(s); sec++) s = hostReduce(s, { type: 'tick' }, T0 + sec * 1000, hooks).snapshot;
  expect(until(s)).toBe(true);
  return editPlayer(s, 1, (p) => void (p.company.founded = true));
}

let afterW5: HostSnapshot;
let beforeW5: HostSnapshot;
let w6Live: HostSnapshot;
beforeAll(() => {
  beforeW5 = run((s) => s.class.phase === 'round' && status(s, 'r:2') === 'live');
  afterW5 = run((s) => s.class.phase === 'round' && status(s, 'ws:W05') === 'done' && status(s, 'r:4') === 'live');
  w6Live = run((s) => status(s, 'ws:W06') === 'live');
});

const screen = (s: HostSnapshot, code?: string) => mount(<GameScreen store={fakeStore} st={fakeState(s, player(s, 1), code)} />);

describe('alongPlanned / alongCardOn', () => {
  it('앞 시간: ⑤와 ⑥ 사이에 라운드 → planned, ⑤ 끝·라운드 중에만 카드', () => {
    expect(alongPlanned(afterW5.class)).toBe(true);
    expect(alongCardOn(afterW5.class)).toBe(true);
    expect(alongCardOn(beforeW5.class)).toBe(false);
    expect(alongCardOn(w6Live.class)).toBe(false);
  });

  it('⑤를 건너뛰어도 카드, ⑥이 끝났으면 없음, 라운드가 아니면 없음', () => {
    const c = structuredClone(afterW5.class);
    c.schedule.items.find((it) => it.id === 'ws:W05')!.status = 'skipped';
    expect(alongCardOn(c)).toBe(true);
    c.schedule.items.find((it) => it.id === 'ws:W06')!.status = 'done';
    expect(alongCardOn(c)).toBe(false);
    const d = structuredClone(afterW5.class);
    d.phase = 'event';
    expect(alongCardOn(d)).toBe(false);
  });

  it('뒤 시간·1차시 판·사이에 라운드가 없는 배치표면 planned 아님', () => {
    const back = structuredClone(afterW5.class);
    back.settings.lessonPart = 'back';
    expect(alongPlanned(back)).toBe(false);
    const l1 = structuredClone(afterW5.class);
    l1.settings.scope = ['L1'];
    expect(alongPlanned(l1)).toBe(false);
    const noRound = structuredClone(afterW5.class);
    noRound.schedule.items = noRound.schedule.items.filter((it) => it.kind !== 'round' || it.at < noRound.schedule.items.find((x) => x.id === 'ws:W05')!.at);
    expect(alongPlanned(noRound)).toBe(false);
  });
});

describe("GameScreen 의 '잠깐! 학습지 ⑥' 카드", () => {
  it('⑤ 끝 + 라운드 4: 카드가 문구 그대로, 하단 바 밖(항구 들어가기를 덮지 않음)', () => {
    const root = screen(afterW5);
    const card = byTestId(root, 'ws6-along')[0]!;
    expect(card.getAttribute('role')).toBe('note');
    expect(card.textContent).toContain(WS6_ALONG_TEXT.head);
    expect(byTestId(root, 'ws6-along-text')[0]!.textContent).toBe('지금부터는 학습지 ⑥의 문항을 동시에 쓰면서 게임을 해 보세요!');
    expect(byTestId(root, 'ws6-along-more')[0]!.textContent).toBe(WS6_ALONG_TEXT.body2);
    expect(byTestId(root, 'ws6-along-ok')[0]!.textContent).toBe('알겠어요');
    expect(card.textContent).not.toContain('선택');
    const bar = byTestId(root, 'bottom-bar')[0]!;
    expect(byTestId(bar, 'ws6-along')).toHaveLength(0);
    expect(byTestId(bar, 'enter-port')).toHaveLength(1);
    expect(byTestId(card, 'enter-port')).toHaveLength(0);
  });

  it('[알겠어요] → 사라짐, 다시 그려도(새로 고침) 같은 판이면 안 뜸, 다른 판(방 코드)이면 다시 뜸', () => {
    let root = screen(afterW5);
    click(byTestId(root, 'ws6-along-ok')[0]!);
    expect(byTestId(root, 'ws6-along')).toHaveLength(0);
    expect(mem.get('voyage.student.ws6AlongSeen')).toBe('482137');
    act(() => render(null, dom.root as unknown as Element));
    root = screen(afterW5);
    expect(byTestId(root, 'ws6-along')).toHaveLength(0);
    act(() => render(null, dom.root as unknown as Element));
    root = screen(afterW5, '777777');
    expect(byTestId(root, 'ws6-along')).toHaveLength(1);
  });

  it('⑤ 아직이면 없음, ⑥이 뜨면 없음', () => {
    expect(byTestId(screen(beforeW5), 'ws6-along')).toHaveLength(0);
    act(() => render(null, dom.root as unknown as Element));
    expect(byTestId(screen(w6Live), 'ws6-along')).toHaveLength(0);
  });

  it('뒤 시간·1차시 판이면 없음, 회사 설립 전이면 없음', () => {
    const back = structuredClone(afterW5);
    back.class.settings.lessonPart = 'back';
    expect(byTestId(screen(back), 'ws6-along')).toHaveLength(0);
    act(() => render(null, dom.root as unknown as Element));
    const l1 = structuredClone(afterW5);
    l1.class.settings.scope = ['L1'];
    expect(byTestId(screen(l1), 'ws6-along')).toHaveLength(0);
    act(() => render(null, dom.root as unknown as Element));
    const nf = editPlayer(afterW5, 1, (p) => void (p.company.founded = false));
    expect(byTestId(screen(nf), 'ws6-along')).toHaveLength(0);
  });
});
