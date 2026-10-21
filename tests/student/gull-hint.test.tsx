/**
 * 작업 160b — 학생 화면 갈매기 힌트 카드: 문구·'게임 규칙' 꼬리표·'가상 뉴스' 띠·쪽수, [알겠어요] → 사라짐(새로 고침해도),
 * 하단 바 "갈매기 힌트 다시 보기" → 다시 뜸, 힌트가 없으면 카드·링크 없음. 카드는 하단 바 밖(흐름 안)이라 버튼을 덮지 않는다.
 */
import { render, type VNode } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { playerView, publicClass, type GullHintRecord, type HostSnapshot, type Player } from '../../src/core';
import { stuckHintText } from '../../src/data/stuckHints';
import { GameScreen } from '../../src/student/GameScreen';
import { GullHintCard, lastGullHint } from '../../src/student/GullHint';
import type { StudentState, StudentStore } from '../../src/student/store';
import { editPlayer, makeSession, player, teach } from '../core/helpers';
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

function fakeState(s: HostSnapshot, p: Player): StudentState {
  return {
    peer: { me: playerView(p), public: { class: publicClass(s.class), public: { companies: [], ships: [] } }, status: 'in', queuedCount: 0, pid: p.pid },
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

/** 2차시 라운드 1, 회사 설립, 힌트 기록 */
function l2(hints: GullHintRecord[]): { s: HostSnapshot; p: Player } {
  let s = makeSession({ n: 1, scope: ['L2'] });
  s = teach(s, { type: 'startStage', stage: 'L2' });
  s = teach(s, { type: 'closeEvent' });
  s = teach(s, { type: 'fireEvent', id: 'L2-E3' });
  s = teach(s, { type: 'closeEvent' });
  s = teach(s, { type: 'startRound', durationSec: 600 });
  s = editPlayer(s, 1, (p) => {
    p.company.founded = true;
    if (hints.length) p.game.gullHints = hints;
  });
  return { s, p: player(s, 1) };
}

const H = (id: string, at = 120): GullHintRecord => ({ id, mission: 'M-IPE', at });

describe('GullHintCard', () => {
  it('규칙 힌트: 문구·게임 규칙 꼬리표·쪽수·[알겠어요], 가상 뉴스 띠 없음', () => {
    const root = mount(<GullHintCard id="IPE-MAKE-2:oilp" onOk={noop} />);
    const card = byTestId(root, 'gull-hint')[0]!;
    expect(card.getAttribute('data-hint')).toBe('IPE-MAKE-2:oilp');
    expect(byTestId(root, 'gull-hint-text')[0]!.textContent).toBe(stuckHintText('IPE-MAKE-2:oilp')!.text);
    expect(byTestId(root, 'gull-hint-rule')[0]!.textContent).toBe('게임 규칙');
    expect(byTestId(root, 'gull-hint-fake')).toHaveLength(0);
    expect(byTestId(root, 'gull-hint-pages')[0]!.textContent).toBe('교과서 101쪽');
    expect(byTestId(root, 'gull-hint-ok')[0]!.textContent).toBe('알겠어요');
    expect(card.textContent).toContain('갈매기 힌트');
  });

  it("가상 뉴스 힌트(IPE-EXPORT-2:oilp): '가상 뉴스' 띠, 게임 규칙 꼬리표 없음, 100쪽", () => {
    const root = mount(<GullHintCard id="IPE-EXPORT-2:oilp" onOk={noop} />);
    expect(byTestId(root, 'gull-hint-fake')[0]!.textContent).toBe('가상 뉴스 — 교과서 내용을 바탕으로 만든 이야기예요');
    expect(byTestId(root, 'gull-hint-rule')).toHaveLength(0);
    expect(byTestId(root, 'gull-hint-pages')[0]!.textContent).toBe('교과서 100쪽');
    expect(byTestId(root, 'gull-hint-text')[0]!.textContent).toContain('호찌민');
  });

  it('모르는 ID 는 그리지 않는다, lastGullHint 는 문구가 있는 마지막 것', () => {
    const root = mount(<GullHintCard id="X-1" onOk={noop} />);
    expect(byTestId(root, 'gull-hint')).toHaveLength(0);
    expect(lastGullHint({ game: { gullHints: [H('IPE-BUY-1'), H('X-9')] } } as never)?.id).toBe('IPE-BUY-1');
    expect(lastGullHint({ game: {} } as never)).toBeNull();
  });
});

describe('GameScreen 의 갈매기 힌트', () => {
  it('힌트가 없으면 카드·다시 보기 링크 없음', () => {
    const { s, p } = l2([]);
    const root = mount(<GameScreen store={fakeStore} st={fakeState(s, p)} />);
    expect(byTestId(root, 'bottom-bar')).toHaveLength(1);
    expect(byTestId(root, 'gull-hint')).toHaveLength(0);
    expect(byTestId(root, 'gull-hint-again')).toHaveLength(0);
  });

  it('마지막 힌트 카드가 뜨고 [알겠어요] → 사라짐(다시 그려도) → 다시 보기 → 다시 뜸', () => {
    const { s, p } = l2([H('IPE-MAKE-1:oilp'), H('IPE-MAKE-2:oilp', 240)]);
    let root = mount(<GameScreen store={fakeStore} st={fakeState(s, p)} />);
    expect(byTestId(root, 'gull-hint')[0]!.getAttribute('data-hint')).toBe('IPE-MAKE-2:oilp');
    // 카드는 하단 바 안에 있지 않다(하단 바 버튼을 덮지 않음)
    expect(byTestId(byTestId(root, 'bottom-bar')[0]!, 'gull-hint')).toHaveLength(0);
    expect(byTestId(root, 'gull-hint-again')).toHaveLength(1);
    click(byTestId(root, 'gull-hint-ok')[0]!);
    expect(byTestId(root, 'gull-hint')).toHaveLength(0);
    expect(mem.get('voyage.student.gullHintSeen')).toBe('IPE-MAKE-2:oilp');
    // 새로 고침(다시 마운트): 본 힌트는 다시 뜨지 않는다
    act(() => render(null, dom.root as unknown as Element));
    root = mount(<GameScreen store={fakeStore} st={fakeState(s, p)} />);
    expect(byTestId(root, 'gull-hint')).toHaveLength(0);
    click(byTestId(root, 'gull-hint-again')[0]!);
    expect(byTestId(root, 'gull-hint')[0]!.getAttribute('data-hint')).toBe('IPE-MAKE-2:oilp');
    click(byTestId(root, 'gull-hint-ok')[0]!);
    expect(byTestId(root, 'gull-hint')).toHaveLength(0);
  });

  it('새 힌트가 오면 본 힌트와 달라서 다시 뜬다', () => {
    mem.set('voyage.student.gullHintSeen', 'IPE-MAKE-1:oilp');
    const a = l2([H('IPE-MAKE-1:oilp')]);
    let root = mount(<GameScreen store={fakeStore} st={fakeState(a.s, a.p)} />);
    expect(byTestId(root, 'gull-hint')).toHaveLength(0);
    const b = l2([H('IPE-MAKE-1:oilp'), H('IPE-EXPORT-2:oilp', 300)]);
    root = mount(<GameScreen store={fakeStore} st={fakeState(b.s, b.p)} />);
    expect(byTestId(root, 'gull-hint')[0]!.getAttribute('data-hint')).toBe('IPE-EXPORT-2:oilp');
    expect(byTestId(root, 'gull-hint-fake')).toHaveLength(1);
  });

  it('회사 설립 전에는 카드가 뜨지 않는다', () => {
    const { s } = l2([H('IPE-BUY-1')]);
    const s2 = editPlayer(s, 1, (p) => void (p.company.founded = false));
    const root = mount(<GameScreen store={fakeStore} st={fakeState(s2, player(s2, 1))} />);
    expect(byTestId(root, 'gull-hint')).toHaveLength(0);
  });
});
