/**
 * 작업 109 판 설정 렌더(가짜 DOM, tests/map/fake-dom.ts): "사용 중인 방" 상태에 따른 [방 열기]·안내 상자(v0.3.2 5번 가~바),
 * 판 단위 미선택 시 비활성, RoomFullNotice 렌더, ServiceFooter 포커스 가두기.
 */
import { render, type VNode } from 'preact';
import { act } from 'preact/test-utils';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ROOM_BLOCKED_TEXT, ROOM_FULL_TEXT, RoomFullNotice } from '../../src/ui/common/RoomCount';
import { ServerRoomsStore, judgeHealth, type RoomStatus } from '../../src/ui/common/server-status';
import { trapFocus } from '../../src/ui/common/ServiceFooter';
import { SetupContainer } from '../../src/teacher/index';
import { defaultSetup, type SetupValues } from '../../src/teacher/setup';
import { installFakeDom, type FakeElement } from '../map/fake-dom';
import { MemStorage } from '../sync/session-helpers';

let dom: ReturnType<typeof installFakeDom>;
beforeEach(() => {
  dom = installFakeDom();
});
afterEach(() => {
  act(() => render(null, dom.root as unknown as Element));
  dom.restore();
});

const byId = (root: FakeElement, id: string) => root.find((el) => el.getAttribute('data-testid') === id)[0];
const text = (el: FakeElement | undefined) => el?.textContent ?? '';
const disabled = (el: FakeElement | undefined) => !!el && el.hasAttribute('disabled') && el.getAttribute('disabled') !== 'false';

/** 가짜 /health: 다음 응답을 바꿔 가며 쓴다. 타이머는 손으로 돌린다 */
function fakeRooms(first: unknown | 'fail') {
  let body: unknown | 'fail' = first;
  const timers: { cb: () => void; ms: number; id: number }[] = [];
  let seq = 0;
  const store = new ServerRoomsStore({
    read: async () => (body === 'fail' ? ({ kind: 'unknown' } as RoomStatus) : judgeHealth(body, 1)),
    visibility: null,
    random: () => 0.5,
    setTimer: (cb, ms) => {
      const id = ++seq;
      timers.push({ cb, ms, id });
      return id;
    },
    clearTimer: (id) => {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
  });
  return {
    store,
    set: (b: unknown | 'fail') => {
      body = b;
    },
    /** 30초 주기 읽기 한 번 */
    async tick() {
      const t = timers.shift();
      if (t) await act(async () => t.cb());
      await act(async () => undefined);
    },
    pending: () => timers.length,
  };
}

const health = (rooms: number, maxRooms = 50, acceptingNewRooms = rooms < maxRooms) => ({ ok: true, rooms, maxRooms, acceptingNewRooms });

async function mountSetup(store: ServerRoomsStore, values: SetupValues) {
  const state = { values, opened: 0 };
  const el: VNode = (
    <SetupContainer
      values={values}
      onChange={(v) => {
        state.values = v;
      }}
      opening={false}
      openError={null}
      onOpen={() => {
        state.opened++;
      }}
      onBack={() => undefined}
      roomsStore={store}
      prefsStorage={new MemStorage()}
    />
  );
  await act(async () => {
    render(el, dom.root as unknown as Element);
  });
  await act(async () => undefined);
  return state;
}

const L1: SetupValues = { ...defaultSetup(), playUnit: 'lesson', lesson: 'L1', tradeMinutes: 10 };

describe('판 설정 [방 열기]와 사용 중인 방(v0.3.2 5번)', () => {
  it('판 단위를 고르기 전에는 [방 열기] 비활성 + 이유', async () => {
    const f = fakeRooms(health(23));
    await mountSetup(f.store, defaultSetup());
    expect(disabled(byId(dom.root, 'btn-open'))).toBe(true);
    expect(text(byId(dom.root, 'open-reason'))).toBe('판 단위를 먼저 골라 주세요');
    expect(byId(dom.root, 'setup-rest')?.getAttribute('aria-disabled')).toBe('true');
    expect(byId(dom.root, 'unit-lesson')?.getAttribute('aria-pressed')).toBe('false');
    expect(byId(dom.root, 'unit-unit')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('(가) 23/50 → 버튼 켜짐', async () => {
    const f = fakeRooms(health(23));
    await mountSetup(f.store, L1);
    expect(text(byId(dom.root, 'room-count-text'))).toBe('사용 중인 방 23/50');
    expect(disabled(byId(dom.root, 'btn-open'))).toBe(false);
    expect(byId(dom.root, 'room-full-notice')).toBeUndefined();
    expect(byId(dom.root, 'open-reason')).toBeUndefined();
  });

  it('(나) 50/50 → 버튼 꺼짐 + RoomFullNotice 문구', async () => {
    const f = fakeRooms(health(50));
    await mountSetup(f.store, L1);
    expect(text(byId(dom.root, 'room-count-text'))).toBe('사용 중인 방 50/50 · 가득 찼어요');
    expect(disabled(byId(dom.root, 'btn-open'))).toBe(true);
    expect(text(byId(dom.root, 'room-full-notice'))).toBe(ROOM_FULL_TEXT);
    expect(text(byId(dom.root, 'open-reason'))).toBe('서버에 방이 가득 찼어요');
  });

  it('(다) acceptingNewRooms:false → 꺼짐 + 점검 문구', async () => {
    const f = fakeRooms(health(12, 50, false));
    await mountSetup(f.store, L1);
    expect(disabled(byId(dom.root, 'btn-open'))).toBe(true);
    expect(text(byId(dom.root, 'room-full-notice'))).toBe(ROOM_BLOCKED_TEXT);
    expect(text(byId(dom.root, 'open-reason'))).toBe('점검 중이라 새 방을 열 수 없어요');
  });

  it('(라) 요청 실패 → "알 수 없음" + 버튼 켜짐 + [다시 확인]', async () => {
    const f = fakeRooms('fail');
    await mountSetup(f.store, L1);
    expect(text(byId(dom.root, 'room-count-text'))).toBe('사용 중인 방: 알 수 없음');
    expect(byId(dom.root, 'room-count-refresh')).toBeDefined();
    expect(disabled(byId(dom.root, 'btn-open'))).toBe(false);
  });

  it('(마) 꺼진 상태에서 응답이 49/50으로 바뀌면 다시 켜지고 설정 값이 그대로', async () => {
    const f = fakeRooms(health(50));
    const st = await mountSetup(f.store, L1);
    expect(disabled(byId(dom.root, 'btn-open'))).toBe(true);
    const lessonBtn = byId(dom.root, 'lesson-L1');
    expect(lessonBtn?.getAttribute('aria-pressed')).toBe('true');
    f.set(health(49));
    await f.tick(); // 30초 주기 읽기
    expect(text(byId(dom.root, 'room-count-text'))).toBe('사용 중인 방 49/50 · 붐벼요');
    expect(disabled(byId(dom.root, 'btn-open'))).toBe(false);
    expect(byId(dom.root, 'lesson-L1')?.getAttribute('aria-pressed')).toBe('true');
    expect(st.values).toBe(L1); // 다시 고르게 하지 않음
    await act(async () => {
      byId(dom.root, 'btn-open')!.dispatch('click');
    });
    expect(st.opened).toBe(1);
  });

  it('(바) 방을 연 뒤(판 설정 화면이 사라지면) /health를 더 읽지 않는다', async () => {
    const f = fakeRooms(health(23));
    await mountSetup(f.store, L1);
    const before = f.store.requests;
    expect(before).toBe(1);
    expect(f.pending()).toBe(1); // 30초 주기 예약
    await f.tick();
    expect(f.store.requests).toBe(2);
    // 방 열기 성공 → 대시보드로(판 설정 언마운트)
    await act(async () => {
      render(null, dom.root as unknown as Element);
    });
    expect(f.pending()).toBe(0);
    const after = f.store.requests;
    for (let i = 0; i < 5; i++) await f.tick();
    expect(f.store.requests).toBe(after);
  });

  it('방 열기 실패(BUSY): 큰 안내 상자 + [다시 시도]', async () => {
    const f = fakeRooms(health(49));
    const state = { opened: 0 };
    await act(async () => {
      render(
        <SetupContainer
          values={L1}
          onChange={() => undefined}
          opening={false}
          openError={{ code: 'BUSY', text: '지금 서버에 방이 가득 찼어요(50/50). 몇 분 뒤 다시 해 보세요.' }}
          onOpen={() => void state.opened++}
          onBack={() => undefined}
          roomsStore={f.store}
          prefsStorage={new MemStorage()}
        />,
        dom.root as unknown as Element,
      );
    });
    await act(async () => undefined);
    const box = byId(dom.root, 'open-error');
    expect(box?.getAttribute('data-code')).toBe('BUSY');
    expect(box?.hasClass('t-openerr--big')).toBe(true);
    expect(box?.getAttribute('role')).toBe('alert');
    expect(text(box)).toContain('(50/50)');
    await act(async () => {
      byId(dom.root, 'btn-open-retry')!.dispatch('click');
    });
    expect(state.opened).toBe(1);
  });

  it('대시보드·학생 표 코드에는 방 수 부품과 /health 읽기가 없다', () => {
    for (const file of ['Dashboard.tsx', 'StudentTable.tsx', 'Timeline.tsx', 'StudentDrawer.tsx', 'SettingsModal.tsx']) {
      const src = readFileSync(new URL(`../../src/teacher/${file}`, import.meta.url), 'utf8');
      expect(src).not.toMatch(/RoomCount|useServerRooms|sharedServerRooms|\/health/);
    }
    // v0.3.1 문구는 코드에 없다
    const all = ['index.tsx', 'StartScreen.tsx', 'SetupScreen.tsx', 'Dashboard.tsx'].map((f) =>
      readFileSync(new URL(`../../src/teacher/${f}`, import.meta.url), 'utf8'),
    );
    expect(all.join('\n')).not.toMatch(/서버 좋음|지금 열린 방|서버 상태를 알 수 없어요/);
  });
});

describe('RoomFullNotice 렌더(131 부품)', () => {
  const mount = (s: RoomStatus | null) => {
    act(() => render(<RoomFullNotice status={s} />, dom.root as unknown as Element));
    return byId(dom.root, 'room-full-notice');
  };
  it('가득 참·점검일 때만, 문구 그대로', () => {
    const full = mount({ kind: 'full', rooms: 50, maxRooms: 50 });
    expect(text(full)).toBe(ROOM_FULL_TEXT);
    expect(full?.getAttribute('data-kind')).toBe('full');
    expect(full?.getAttribute('role')).toBe('status');
    expect(text(mount({ kind: 'blocked', rooms: 3, maxRooms: 50 }))).toBe(ROOM_BLOCKED_TEXT);
    for (const k of ['ok', 'busy', 'unknown', 'loading', 'local'] as const) expect(mount({ kind: k })).toBeUndefined();
    expect(mount(null)).toBeUndefined();
  });
});

describe('ServiceFooter [이용 안내] 창 포커스 가두기(131 최소 수정)', () => {
  function fakeBox() {
    const focused: string[] = [];
    const mk = (name: string) => ({ name, focus: () => focused.push(name) });
    const a = mk('a');
    const b = mk('b');
    const c = mk('c');
    const box = {
      ...mk('box'),
      querySelectorAll: () => [a, b, c],
      contains: (x: unknown) => x === a || x === b || x === c || x === box,
    };
    return { a, b, c, box, focused };
  }
  const withActive = (el: unknown, fn: () => void) => {
    const g = globalThis as Record<string, unknown>;
    const prev = g.document;
    g.document = { activeElement: el };
    try {
      fn();
    } finally {
      g.document = prev;
    }
  };
  it('마지막에서 Tab → 첫 번째, 첫 번째에서 Shift+Tab → 마지막, 창 밖이면 첫 번째', () => {
    const { a, c, box, focused } = fakeBox();
    let prevented = 0;
    const ev = (shiftKey: boolean) => ({ shiftKey, preventDefault: () => void prevented++ });
    withActive(c, () => trapFocus(ev(false), box as unknown as HTMLElement));
    withActive(a, () => trapFocus(ev(true), box as unknown as HTMLElement));
    withActive({}, () => trapFocus(ev(false), box as unknown as HTMLElement));
    withActive(a, () => trapFocus(ev(false), box as unknown as HTMLElement)); // 중간 이동은 브라우저에 맡김
    expect(focused).toEqual(['a', 'c', 'a']);
    expect(prevented).toBe(3);
  });

  it('ServiceFooter가 keydown에서 Tab을 trapFocus로 넘긴다', () => {
    const src = readFileSync(new URL('../../src/ui/common/ServiceFooter.tsx', import.meta.url), 'utf8');
    expect(src).toMatch(/e\.key === 'Tab'\) trapFocus\(e, dialogRef\.current\)/);
  });
});
