/**
 * 작업 109 수정 1회차: 대시보드 렌더(가짜 DOM) — 저장 실패 띠(storageError).
 * 작업 137: 무역 시간 끝 카드(창 대신), 배치(큰 버튼 하나·접힘 영역), 확인 창(기본 포커스·Esc·바깥), 큰 버튼 두 번 누름 막기.
 * 가짜 DOM(tests/map/fake-dom.ts)에 없는 포커스·선택자 함수는 이 파일에서만 덧붙인다.
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { demoActions } from '../../src/teacher/actions';
import { Dashboard } from '../../src/teacher/Dashboard';
import { makeDemo } from '../../src/teacher/demo';
import type { TeacherGame } from '../../src/teacher/game';
import { FakeElement, installFakeDom } from '../map/fake-dom';
import { NowCard, PRESS_MAX_MS, PRESS_MIN_MS } from '../../src/teacher/NowCard';
import type { NowButton, NowCard as NowCardData } from '../../src/teacher/now-card';
import { CONFIRM_ARM_MS, useConfirm, type ConfirmOptions } from '../../src/teacher/ui';
import { OLD_TEACHER_TERMS } from '../../src/teacher/teacher-terms';

type Listener = (e: unknown) => void;
let dom: ReturnType<typeof installFakeDom>;
let docListeners: Map<string, Set<Listener>>;
const proto = FakeElement.prototype as unknown as Record<string, unknown>;

beforeEach(() => {
  dom = installFakeDom();
  docListeners = new Map();
  const doc = (globalThis as Record<string, unknown>).document as Record<string, unknown>;
  doc.activeElement = null;
  doc.addEventListener = (t: string, fn: Listener) => {
    if (!docListeners.has(t)) docListeners.set(t, new Set());
    docListeners.get(t)!.add(fn);
  };
  doc.removeEventListener = (t: string, fn: Listener) => docListeners.get(t)?.delete(fn);
  const focusable = (el: FakeElement) => (el.localName === 'button' || el.localName === 'input' || el.localName === 'select') && !el.hasAttribute('disabled');
  proto.querySelectorAll = function (this: FakeElement) {
    return this.find(focusable);
  };
  proto.querySelector = function (this: FakeElement, sel: string) {
    if (sel === '[data-autofocus]') return this.find((el) => el.hasAttribute('data-autofocus'))[0] ?? null;
    return this.find(focusable)[0] ?? null;
  };
  proto.contains = function (this: FakeElement, x: unknown) {
    return x === this || this.all().includes(x as FakeElement);
  };
  proto.focus = function (this: FakeElement) {
    doc.activeElement = this;
  };
});
afterEach(() => {
  act(() => render(null, dom.root as unknown as Element));
  for (const k of ['querySelectorAll', 'querySelector', 'contains', 'focus']) delete proto[k];
  dom.restore();
});

const byId = (id: string) => dom.root.find((el) => el.getAttribute('data-testid') === id)[0];
const NOW = Date.UTC(2026, 9, 9, 1, 0, 0);

function mount(edit: (d: ReturnType<typeof makeDemo>) => void) {
  const d = makeDemo(30, NOW);
  edit(d);
  act(() => {
    render(<Dashboard view={d.view} actions={demoActions(() => NOW)} onExit={() => undefined} />, dom.root as unknown as Element);
  });
  return d;
}

describe('저장 실패 띠(storageError)', () => {
  it('QUOTA: 빨간 띠 + [판 옮기기 파일 저장]', () => {
    mount((d) => {
      d.view = { ...d.view, storageError: 'QUOTA' };
    });
    const band = byId('storage-error');
    expect(band).toBeDefined();
    expect(band!.getAttribute('role')).toBe('alert');
    expect(band!.textContent).toContain('저장 공간이 모자라');
    expect(band!.textContent).toContain('판 옮기기 파일 저장');
  });

  it('NO_STORAGE: 저장 차단 문구', () => {
    mount((d) => {
      d.view = { ...d.view, storageError: 'NO_STORAGE' };
    });
    expect(byId('storage-error')!.textContent).toContain('저장을 막고 있어');
  });

  it('저장 실패가 없으면 띠 없음', () => {
    mount(() => undefined);
    expect(byId('storage-error')).toBeUndefined();
  });
});

// (작업 162) 옛 '무역 시간 끝 카드(상태 5)' 시험을 바꿈 — 추천 시간이 지나도 카드는 지금 상황 그대로, 시계·늦음 줄만 '지남'
describe('(작업 162) 추천 시간 — 시계 "남음"/"+지남", 늦음 줄, 옛 시간 끝 카드 없음', () => {
  /** 데모 판(무역 6분째)의 추천 시간을 바꾼다: over > 0 이면 그만큼 지난 판 */
  const withT = (durationSec: number, timeUp: boolean) => (d: ReturnType<typeof makeDemo>) => {
    const g = d.view.game as TeacherGame;
    const game: TeacherGame = {
      ...g,
      class: { ...g.class, tradeEnded: false, clock: { ...g.class.clock, durationSec }, schedule: { ...g.class.schedule, timeUp: timeUp ? { at: NOW - 1000 } : null } },
    };
    d.view = { ...d.view, game };
  };
  const elapsedOf = (d: ReturnType<typeof makeDemo>) => Math.round((NOW - (d.view.game as TeacherGame).class.clock.startedAt!) / 1000 - (d.view.game as TeacherGame).class.clock.pausedTotalSec);

  it('추천 시간 전: "추천 시간 12:30 남음"(지남 표시 없음)', () => {
    const e = elapsedOf(makeDemo(30, NOW));
    mount(withT(e + 750, false));
    const clock = byId('trade-clock')!;
    expect(clock.textContent).toContain('추천 시간 12:30 남음');
    expect(clock.getAttribute('data-over')).toBeFalsy();
    expect(clock.getAttribute('class')).not.toContain('t-clock--over');
  });

  it('추천 시간이 3분 20초 지남: "추천 시간 +3:20 지남"(t-clock--over, 경고색 없음) + 늦음 줄, 카드는 timeUp 이 아님·창 없음', () => {
    const e = elapsedOf(makeDemo(30, NOW));
    mount(withT(e - 200, true));
    const clock = byId('trade-clock')!;
    expect(clock.textContent).toContain('추천 시간 +3:20 지남');
    expect(clock.getAttribute('data-over')).toBe('1');
    expect(clock.getAttribute('class')).toContain('t-clock--over');
    expect(clock.getAttribute('class')).not.toContain('t-clock--warn');
    expect(byId('now-late')!.textContent).toBe('추천 시간이 지났어요 · 3분 더 하는 중');
    expect(byId('time-up')).toBeUndefined();
    expect(byId('btn-after-activity')).toBeUndefined();
    expect(byId('now-card')!.getAttribute('data-state')).not.toBe('timeUp');
  });
});

describe('(작업 137) 대시보드 배치', () => {
  it('큰 버튼 하나 + [잠깐 멈춤], 접힘 영역 5개는 기본 접힘, 위쪽 띠에 시간 조절 버튼 없음', () => {
    mount(() => undefined);
    expect(dom.root.find((el) => el.getAttribute('data-testid') === 'now-primary')).toHaveLength(1);
    expect(dom.root.find((el) => el.getAttribute('data-testid') === 'now-pause')).toHaveLength(1);
    for (const f of ['time', 'order', 'entry', 'worksheet', 'more']) {
      const fold = byId(`fold-${f}`)!;
      expect(fold, f).toBeDefined();
      // 입장 관리는 데모 판에 요청이 있어도 처음 그릴 때는 접혀 있다(새로 생길 때만 펼침)
      expect(fold.getAttribute('data-open'), f).toBe('0');
    }
    expect(byId('btn-extend-1')).toBeUndefined();
    expect(byId('fold-entry-badge')!.textContent).toBe('2');
    // 알림 줄 [보기] → 입장 관리 펼침
    act(() => void byId('note-rejoin-show')!.dispatch('click'));
    expect(byId('fold-entry')!.getAttribute('data-open')).toBe('1');
    expect(byId('rejoin-request')).toBeDefined();
    // [시간 조절 ▾] → 시간 조절 펼침, +1분 버튼
    act(() => void byId('btn-time-fold')!.dispatch('click'));
    expect(byId('btn-extend-1')).toBeDefined();
  });

  it('학습지 카드의 [아직 안 쓴 학생 보기] → 학생 표가 "학습지 안 씀"으로', () => {
    mount(() => undefined);
    expect(byId('now-card')!.getAttribute('data-state')).toBe('worksheet');
    act(() => void byId('now-ws-missing')!.dispatch('click'));
    expect(byId('filter-more')!.textContent).toContain('학습지 안 씀');
    const rows = dom.root.find((el) => el.getAttribute('data-testid') === 'student-row');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(30);
  });
});

describe('(작업 137) 확인 창 — 안전한 버튼 왼쪽·기본 포커스, Esc·바깥 = 안전한 버튼, 행동 버튼은 0.5초 뒤', () => {
  function mountConfirm() {
    let askRef: ((o: ConfirmOptions) => Promise<boolean>) | null = null;
    function Host() {
      const [node, ask] = useConfirm();
      askRef = ask;
      return <div>{node}</div>;
    }
    act(() => render(<Host />, dom.root as unknown as Element));
    return (o: ConfirmOptions) => {
      let p!: Promise<boolean>;
      act(() => {
        p = askRef!(o);
      });
      return p;
    };
  }
  const doc = () => (globalThis as Record<string, unknown>).document as { activeElement: unknown };
  const key = (k: string, shiftKey = false) => {
    let prevented = false;
    const e = { key: k, shiftKey, preventDefault: () => void (prevented = true) };
    act(() => docListeners.get('keydown')?.forEach((fn) => fn(e)));
    return prevented;
  };

  it('기본 포커스 = 왼쪽 [취소](Enter도 이것), 행동 버튼은 오른쪽·동사·.t-arm(0.5초), Esc = 취소', async () => {
    const ask = mountConfirm();
    const p = ask({ title: '라운드를 지금 끝낼까요?', body: '라운드가 1:20 남았어요.', ok: '라운드 끝내기', testId: 'confirm-end-round' });
    const dlg = byId('confirm-end-round')!;
    expect(dlg.getAttribute('role')).toBe('dialog');
    const btns = dlg.find((el) => el.localName === 'button');
    expect(btns.map((b) => b.getAttribute('data-testid'))).toEqual(['confirm-cancel', 'confirm-ok']);
    expect(btns[1]!.textContent).toBe('라운드 끝내기');
    expect(btns[1]!.hasClass('t-arm')).toBe(true);
    expect(CONFIRM_ARM_MS).toBe(500);
    expect(doc().activeElement).toBe(btns[0]);
    // Tab 가두기: 마지막(행동 버튼)에서 Tab → 첫 버튼, 첫 버튼에서 Shift+Tab → 마지막
    doc().activeElement = btns[1];
    expect(key('Tab')).toBe(true);
    expect(doc().activeElement).toBe(btns[0]);
    expect(key('Tab', true)).toBe(true);
    expect(doc().activeElement).toBe(btns[1]);
    key('Escape');
    await expect(p).resolves.toBe(false);
    expect(byId('confirm-end-round')).toBeUndefined();
  });

  it('바깥(배경) 클릭 = 취소, [확인] = true, 되돌릴 수 없는 행동은 빨강', async () => {
    const ask = mountConfirm();
    const p1 = ask({ title: '정말 방을 닫을까요?', ok: '수업 끝내기(방 닫기)', danger: true, testId: 'confirm-end-2' });
    expect(byId('confirm-ok')!.hasClass('t-btn--danger')).toBe(true);
    const backdrop = dom.root.find((el) => el.hasClass('t-backdrop'))[0]!;
    act(() => void backdrop.dispatch('click'));
    await expect(p1).resolves.toBe(false);
    const p2 = ask({ title: '무역을 시작할까요?', ok: '무역 시작' });
    act(() => void byId('confirm-ok')!.dispatch('click'));
    await expect(p2).resolves.toBe(true);
  });
});

describe('(작업 137) 큰 버튼 빠른 두 번 누름 — 두 단계가 넘어가지 않는다', () => {
  const cardOf = (key: string, kind: NowButton['kind'] = 'next'): NowCardData => ({
    state: 'card', priority: 9, tag: '사전 활동', line: key, sub: [], notes: [], secondary: null, showPause: true, manual: false, key,
    primary: { label: '다음으로', kind, testId: 'now-next', itemId: key },
    tv: { kind: 'auto', text: 'TV: 해도', scene: 'map', button: null },
  });

  it('누르는 순간 상태가 바뀌어도 0.6초 동안 다음 큰 버튼은 눌리지 않고, 상태가 그대로면 1.5초 뒤 다시 켜진다', () => {
    vi.useFakeTimers();
    try {
      const pressed: string[] = [];
      let card = cardOf('A');
      const draw = () => act(() => render(<NowCard card={card} onAction={onAction} />, dom.root as unknown as Element));
      const onAction = (b: NowButton) => {
        pressed.push(b.itemId!);
        card = cardOf(b.itemId === 'A' ? 'B' : 'C'); // 누르면 바로 다음 상태
        draw();
      };
      draw();
      const big = () => byId('now-next')!;
      act(() => void big().dispatch('click'));
      act(() => void big().dispatch('click')); // 두 번째 클릭(바뀐 카드의 버튼)
      expect(pressed).toEqual(['A']);
      expect(big().hasAttribute('disabled')).toBe(true);
      act(() => void vi.advanceTimersByTime(PRESS_MIN_MS + 10));
      expect(big().hasAttribute('disabled')).toBe(false);
      act(() => void big().dispatch('click'));
      expect(pressed).toEqual(['A', 'B']);
      // 상태가 바뀌지 않는 동작(실패 등): 1.5초 동안 막혔다가 다시 켜짐
      const stuck: string[] = [];
      card = cardOf('S');
      act(() => render(<NowCard card={card} onAction={(b) => void stuck.push(b.itemId!)} />, dom.root as unknown as Element));
      act(() => void vi.advanceTimersByTime(PRESS_MAX_MS));
      act(() => void byId('now-next')!.dispatch('click'));
      act(() => void byId('now-next')!.dispatch('click'));
      expect(stuck).toEqual(['S']);
      act(() => void vi.advanceTimersByTime(PRESS_MAX_MS + 10));
      act(() => void byId('now-next')!.dispatch('click'));
      expect(stuck).toEqual(['S', 'S']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('확인 창에서 [취소]하면(false) 큰 버튼이 바로 다시 켜진다', async () => {
    let n = 0;
    const card = cardOf('R', 'endRound');
    act(() => render(<NowCard card={card} onAction={() => (n++, Promise.resolve(false))} />, dom.root as unknown as Element));
    await act(async () => void byId('now-next')!.dispatch('click'));
    expect(n).toBe(1);
    expect(byId('now-next')!.hasAttribute('disabled')).toBe(false);
  });

  it('(작업 159) card.late 가 있으면 꼬리표 옆 "예정보다 n분 느려요", 없으면 안 그림', () => {
    act(() => render(<NowCard card={{ ...cardOf('L'), late: '예정보다 3분 느려요' }} onAction={() => undefined} />, dom.root as unknown as Element));
    expect(byId('now-late')!.textContent).toBe('예정보다 3분 느려요');
    act(() => render(<NowCard card={{ ...cardOf('M'), late: null }} onAction={() => undefined} />, dom.root as unknown as Element));
    expect(byId('now-late')).toBeFalsy();
  });
});

describe('(작업 137) 용어 — 대시보드 전체(접힘 영역 모두 펼침)·설정 창에 옛 말이 없다', () => {
  it('데모 30명 판: 카드·띠·표·접힘 5개·설정(고급 작은 글씨 "배치 n판" 빼고)', () => {
    mount(() => undefined);
    for (const f of ['time', 'order', 'entry', 'worksheet', 'more']) act(() => void byId(`fold-${f}-head`)!.dispatch('click'));
    act(() => void byId('filter-more')!.dispatch('click'));
    act(() => void byId('tv-menu')!.dispatch('click'));
    act(() => void byId('btn-settings')!.dispatch('click'));
    const ver = byId('schedule-version')!;
    expect(ver.textContent).toMatch(/^배치 \d+판$/);
    const text = dom.root.textContent.replace(ver.textContent, '');
    expect(text).not.toMatch(OLD_TEACHER_TERMS);
    expect(text).toContain('시간 맞춰 저절로 넘어가기');
    expect(text).toContain('선생님이 하나씩 넘기기');
    expect(text).toContain('알아서 바꾸기');
    expect(text).toContain('이 화면을 TV로 보여 주기');
    expect(text).toContain('새 학생 그만 받기');
    expect(text).toContain('수업 끝내기(방 닫기)');
  });
});
