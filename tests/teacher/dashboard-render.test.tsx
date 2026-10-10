/**
 * 작업 109 수정 1회차: 대시보드 렌더(가짜 DOM) — 저장 실패 띠(storageError), "무역 시간이 끝났어요" 창의 포커스 가두기.
 * 가짜 DOM(tests/map/fake-dom.ts)에 없는 포커스·선택자 함수는 이 파일에서만 덧붙인다.
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { demoActions } from '../../src/teacher/actions';
import { Dashboard } from '../../src/teacher/Dashboard';
import { makeDemo } from '../../src/teacher/demo';
import type { TeacherGame } from '../../src/teacher/game';
import { FakeElement, installFakeDom } from '../map/fake-dom';

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

describe('"무역 시간이 끝났어요" 창 — 공용 Modal(포커스 가두기)', () => {
  it('열리면 [지금 결산]에 포커스, Tab·Shift+Tab이 창 안에서 돈다, Esc로 닫힘', () => {
    mount((d) => {
      const g = d.view.game as TeacherGame;
      const game: TeacherGame = { ...g, class: { ...g.class, tradeEnded: false, schedule: { ...g.class.schedule, timeUp: { at: NOW - 1000 } } } };
      d.view = { ...d.view, game };
    });
    const dlg = byId('time-up');
    expect(dlg).toBeDefined();
    expect(dlg!.getAttribute('role')).toBe('dialog');
    expect(dlg!.getAttribute('aria-modal')).toBe('true');
    const doc = (globalThis as Record<string, unknown>).document as { activeElement: unknown };
    const finish = byId('btn-finish-now');
    const after = byId('btn-after-activity');
    expect(doc.activeElement).toBe(finish);
    const key = (k: string, shiftKey = false) => {
      let prevented = false;
      const e = { key: k, shiftKey, preventDefault: () => void (prevented = true) };
      act(() => docListeners.get('keydown')?.forEach((fn) => fn(e)));
      return prevented;
    };
    // 마지막([지금 결산])에서 Tab → 첫 번째([이 활동 끝나고])
    expect(key('Tab')).toBe(true);
    expect(doc.activeElement).toBe(after);
    // 첫 번째에서 Shift+Tab → 마지막
    expect(key('Tab', true)).toBe(true);
    expect(doc.activeElement).toBe(finish);
    // 창 밖에 포커스가 있으면 Tab으로 창 안 첫 버튼
    doc.activeElement = byId('btn-settings');
    key('Tab');
    expect(doc.activeElement).toBe(after);
    // Esc = [이 활동 끝나고]
    key('Escape');
    expect(byId('time-up')).toBeUndefined();
  });
});
