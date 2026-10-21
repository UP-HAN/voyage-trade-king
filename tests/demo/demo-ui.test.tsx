/**
 * 작업 169 교사 시범 화면: 경로·저장 분리(기록장), 교사 버튼(대시보드 TV 메뉴·시작 화면), 시범 띠·[처음부터 다시].
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearStudentViewMemory, DemoBand } from '../../src/demo/index';
import { MemoryStorage } from '../../src/demo/world';
import { DEMO_HINT, DEMO_WINDOW_NAME, DemoOpenButton, demoHref } from '../../src/demo/DemoOpenButton';
import { isDemoHref, routeFromHash } from '../../src/route';
import { logbookStorage } from '../../src/student/logbook/storage';
import { demoActions } from '../../src/teacher/actions';
import { Dashboard } from '../../src/teacher/Dashboard';
import { makeDemo } from '../../src/teacher/demo';
import { installFakeDom } from '../map/fake-dom';

const g = globalThis as Record<string, unknown>;
let dom: ReturnType<typeof installFakeDom>;
let opened: unknown[][];

beforeEach(() => {
  dom = installFakeDom();
  opened = [];
  g.window = { open: (...a: unknown[]) => void opened.push(a) };
  g.location = { pathname: '/voyage/', href: 'http://localhost/voyage/#/teacher', hash: '#/teacher', search: '' };
});
afterEach(() => {
  act(() => render(null, dom.root as unknown as Element));
  dom.restore();
  delete g.window;
  delete g.location;
});

const byId = (id: string) => dom.root.find((el) => el.getAttribute('data-testid') === id)[0];

describe('경로·저장 분리', () => {
  it('#/demo 는 따로 된 경로이고 #/play 는 그대로', () => {
    expect(routeFromHash('#/demo')).toBe('/demo');
    expect(routeFromHash('#/play')).toBe('/play');
    expect(isDemoHref('http://x/voyage/#/demo')).toBe(true);
    expect(isDemoHref('http://x/voyage/#/play')).toBe(false);
    expect(isDemoHref('http://x/voyage/#/play?demo=map')).toBe(false);
    expect(isDemoHref('나쁜 주소')).toBe(false);
  });

  it('시범 화면에서는 항해 기록장을 기기에 저장하지 않는다(수업 기록장을 끝난 판으로 바꾸지 않게)', () => {
    g.localStorage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
    try {
      expect(logbookStorage('http://x/voyage/#/demo')).toBeNull();
      expect(logbookStorage('http://x/voyage/#/play')).toBe(g.localStorage);
    } finally {
      delete g.localStorage;
    }
  });

  it('시범 주소: 지금 페이지 경로 + #/demo (질의 없음 — 방 코드·sync 없음)', () => {
    expect(demoHref({ pathname: '/voyage/' })).toBe('/voyage/#/demo');
  });
});

describe('교사 버튼', () => {
  it('대시보드 [TV 화면 ▾] 안: [시범 화면 열기] + 설명 한 줄 → 새 창으로 #/demo', () => {
    const d = makeDemo(5, Date.UTC(2026, 9, 9, 1, 0, 0));
    act(() => render(<Dashboard view={d.view} actions={demoActions(() => Date.UTC(2026, 9, 9, 1, 0, 0))} onExit={() => undefined} />, dom.root as unknown as Element));
    expect(byId('btn-open-demo')).toBeUndefined();
    act(() => void byId('tv-menu')!.dispatch('click'));
    const list = byId('tv-menu-list')!;
    expect(list.textContent).toContain('공용 화면 창 열기');
    expect(list.textContent).toContain('시범 화면 열기');
    expect(byId('demo-open-hint')!.textContent).toBe(DEMO_HINT);
    expect(DEMO_HINT).toBe('수업과 따로 도는 연습 화면이에요. 멈춤이 떠도 이 화면은 안 멈춰요.');
    act(() => void byId('btn-open-demo')!.dispatch('click'));
    expect(opened).toEqual([['/voyage/#/demo', DEMO_WINDOW_NAME]]);
    expect(byId('tv-menu-list')).toBeUndefined();
  });

  it('시작 화면용 버튼(설명 한 줄 함께) — StartScreen 이 그린다', () => {
    act(() => render(<DemoOpenButton />, dom.root as unknown as Element));
    expect(byId('demo-open')!.textContent).toContain('시범 화면 열기');
    expect(byId('demo-open-hint')!.textContent).toBe(DEMO_HINT);
    act(() => void byId('btn-open-demo')!.dispatch('click'));
    expect(opened).toEqual([['/voyage/#/demo', DEMO_WINDOW_NAME]]);
    const src = readFileSync(join(__dirname, '../../src/teacher/StartScreen.tsx'), 'utf8');
    expect(src).toMatch(/<DemoOpenButton \/>/);
  });
});

describe('시범 띠', () => {
  it('"시범 화면 — 수업과 상관없어요" + [처음부터 다시], 시간 숫자 없음', () => {
    const onReset = vi.fn();
    act(() => render(<DemoBand onReset={onReset} />, dom.root as unknown as Element));
    const band = byId('demo-band')!;
    expect(band.textContent).toContain('시범 화면 — 수업과 상관없어요');
    expect(band.textContent).not.toMatch(/\d/);
    act(() => void byId('demo-reset')!.dispatch('click'));
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});

describe('[처음부터 다시] 화면 기억 지우기', () => {
  it('이 창의 학생 화면 기억(voyage.student.*)만 지운다', () => {
    const ss = new MemoryStorage();
    ss.setItem('voyage.student.view', 'port');
    ss.setItem('voyage.student.gullHintSeen', 'x');
    ss.setItem('voyage.teacher.activeTab', '123456');
    clearStudentViewMemory(ss);
    expect([...ss.map.keys()]).toEqual(['voyage.teacher.activeTab']);
    expect(() => clearStudentViewMemory(null)).not.toThrow();
  });
});
