import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  POLL_BASE_MS,
  POLL_JITTER_MS,
  ServerRoomsStore,
  canOpenRoom,
  healthUrl,
  judgeHealth,
  nextPollDelay,
  readServerRooms,
  type RoomStatus,
  type VisibilitySource,
} from '../../src/ui/common/server-status';
import { roomCountText } from '../../src/ui/common/RoomCount';

const HREF = 'https://lab.ches.es.kr/voyage/?sync=relay#/';

function jsonRes(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

function fetchReturning(body: unknown, status = 200) {
  return vi.fn(async () => jsonRes(body, status)) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe('healthUrl — 페이지 위치 기준 ./health', () => {
  it.each([
    ['https://lab.ches.es.kr/voyage/#/', 'https://lab.ches.es.kr/voyage/health'],
    ['https://lab.ches.es.kr/voyage/?sync=relay#/teacher', 'https://lab.ches.es.kr/voyage/health'],
    ['https://lab.ches.es.kr/voyage/index.html', 'https://lab.ches.es.kr/voyage/health'],
    ['http://127.0.0.1:4173/', 'http://127.0.0.1:4173/health'],
  ])('%s → %s', (href, url) => expect(healthUrl(href)).toBe(url));
});

describe('readServerRooms — 판정 표(PRD 7.5.1)', () => {
  it('로컬 모드면 요청 없이 local', async () => {
    const f = fetchReturning({ rooms: 1, maxRooms: 50 });
    expect((await readServerRooms(undefined, { href: HREF, mode: 'local', fetchImpl: f })).kind).toBe('local');
    expect((await readServerRooms(undefined, { href: HREF, mode: 'memory', fetchImpl: f })).kind).toBe('local');
    expect(f).not.toHaveBeenCalled();
  });

  const cases: Array<[string, unknown, RoomStatus['kind']]> = [
    ['23/50 → ok', { ok: true, rooms: 23, maxRooms: 50, acceptingNewRooms: true }, 'ok'],
    ['40/50 → busy', { rooms: 40, maxRooms: 50, acceptingNewRooms: true }, 'busy'],
    ['39/50 → ok', { rooms: 39, maxRooms: 50, acceptingNewRooms: true }, 'ok'],
    ['50/50 → full', { rooms: 50, maxRooms: 50, acceptingNewRooms: false }, 'full'],
    ['51/50 → full', { rooms: 51, maxRooms: 50, acceptingNewRooms: false }, 'full'],
    ['12/50 + acceptingNewRooms false → blocked', { rooms: 12, maxRooms: 50, acceptingNewRooms: false }, 'blocked'],
    ['acceptingNewRooms 없음(옛 서버) → ok', { rooms: 12, maxRooms: 50 }, 'ok'],
    ['음수 → unknown', { rooms: -1, maxRooms: 50 }, 'unknown'],
    ['maxRooms 0 → unknown', { rooms: 0, maxRooms: 0 }, 'unknown'],
    ['소수 → unknown', { rooms: 1.5, maxRooms: 50 }, 'unknown'],
    ['문자열 → unknown', { rooms: '3', maxRooms: 50 }, 'unknown'],
    ['필드 없음 → unknown', { ok: true }, 'unknown'],
    ['null → unknown', null, 'unknown'],
  ];
  it.each(cases)('%s', async (_name, body, kind) => {
    const f = fetchReturning(body);
    const s = await readServerRooms(undefined, { href: HREF, mode: 'relay', fetchImpl: f, now: () => 1234 });
    expect(s.kind).toBe(kind);
    expect(s.checkedAt).toBe(1234);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(url).toBe('https://lab.ches.es.kr/voyage/health');
    expect(init.cache).toBe('no-store');
  });

  it('숫자는 응답의 maxRooms를 따른다(상한이 바뀌어도)', async () => {
    const s = await readServerRooms(undefined, { href: HREF, mode: 'relay', fetchImpl: fetchReturning({ rooms: 7, maxRooms: 30 }) });
    expect(s).toMatchObject({ kind: 'ok', rooms: 7, maxRooms: 30 });
    expect(roomCountText(s)).toBe('사용 중인 방 7/30');
    expect(judgeHealth({ rooms: 24, maxRooms: 30 }).kind).toBe('busy');
  });

  it('HTTP 500 → unknown', async () => {
    const s = await readServerRooms(undefined, { href: HREF, mode: 'relay', fetchImpl: fetchReturning({ rooms: 1, maxRooms: 50 }, 500) });
    expect(s.kind).toBe('unknown');
  });

  it('JSON 오류 → unknown', async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200, json: async () => JSON.parse('{oops') }) as unknown as Response);
    const s = await readServerRooms(undefined, { href: HREF, mode: 'relay', fetchImpl: f as unknown as typeof fetch });
    expect(s.kind).toBe('unknown');
  });

  it('네트워크 오류 → unknown', async () => {
    const f = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const s = await readServerRooms(undefined, { href: HREF, mode: 'relay', fetchImpl: f as unknown as typeof fetch });
    expect(s.kind).toBe('unknown');
  });

  it('5초 넘게 응답 없음 → unknown(요청은 중단)', async () => {
    vi.useFakeTimers();
    try {
      let aborted = false;
      const f = vi.fn(
        (_u: string, init: RequestInit) =>
          new Promise<Response>(() => {
            init.signal?.addEventListener('abort', () => (aborted = true));
          }),
      );
      const p = readServerRooms(undefined, { href: HREF, mode: 'relay', fetchImpl: f as unknown as typeof fetch });
      await vi.advanceTimersByTimeAsync(4999);
      let done = false;
      void p.then(() => (done = true));
      await Promise.resolve();
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      expect((await p).kind).toBe('unknown');
      expect(aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('canOpenRoom — full·blocked만 false', () => {
  it.each([
    ['loading', true],
    ['ok', true],
    ['busy', true],
    ['full', false],
    ['blocked', false],
    ['unknown', true],
    ['local', true],
  ] as const)('%s → %s', (kind, expected) => {
    expect(canOpenRoom({ kind })).toBe(expected);
  });
  it('상태가 없으면 true', () => {
    expect(canOpenRoom(null)).toBe(true);
    expect(canOpenRoom(undefined)).toBe(true);
  });
});

describe('roomCountText — 문구(PRD 7.5.1)', () => {
  it.each([
    [{ kind: 'loading' }, '사용 중인 방 확인 중…'],
    [{ kind: 'ok', rooms: 23, maxRooms: 50 }, '사용 중인 방 23/50'],
    [{ kind: 'busy', rooms: 42, maxRooms: 50 }, '사용 중인 방 42/50 · 붐벼요'],
    [{ kind: 'full', rooms: 50, maxRooms: 50 }, '사용 중인 방 50/50 · 가득 찼어요'],
    [{ kind: 'blocked', rooms: 12, maxRooms: 50 }, '사용 중인 방 12/50 · 점검 중이라 새 방을 열 수 없어요'],
    [{ kind: 'unknown' }, '사용 중인 방: 알 수 없음'],
    [{ kind: 'local' }, ''],
  ] as Array<[RoomStatus, string]>)('%o', (s, text) => expect(roomCountText(s)).toBe(text));
});

describe('nextPollDelay — 30초 ±5초', () => {
  it('범위', () => {
    expect(nextPollDelay(() => 0)).toBe(POLL_BASE_MS - POLL_JITTER_MS);
    expect(nextPollDelay(() => 1)).toBe(POLL_BASE_MS + POLL_JITTER_MS);
    for (let i = 0; i < 200; i++) {
      const d = nextPollDelay();
      expect(d).toBeGreaterThanOrEqual(25_000);
      expect(d).toBeLessThanOrEqual(35_000);
    }
  });
});

class FakeDoc implements VisibilitySource {
  visibilityState = 'visible';
  private cbs = new Set<() => void>();
  addEventListener(_t: 'visibilitychange', cb: () => void) {
    this.cbs.add(cb);
  }
  removeEventListener(_t: 'visibilitychange', cb: () => void) {
    this.cbs.delete(cb);
  }
  set(v: 'visible' | 'hidden') {
    this.visibilityState = v;
    for (const cb of [...this.cbs]) cb();
  }
  get listeners() {
    return this.cbs.size;
  }
}

describe('ServerRoomsStore — 읽는 때', () => {
  let doc: FakeDoc;
  let calls: number;
  let pending: Array<(s: RoomStatus) => void>;
  let aborted: number;
  const okStatus: RoomStatus = { kind: 'ok', rooms: 23, maxRooms: 50 };

  /** 즉시 응답하는 가짜 읽기 */
  function instantStore(random = () => 0.5) {
    return new ServerRoomsStore({
      visibility: doc,
      random,
      read: async () => {
        calls += 1;
        return okStatus;
      },
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    doc = new FakeDoc();
    calls = 0;
    pending = [];
    aborted = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('poll:false — 처음 1번만, 60초 동안 주기 요청 없음', async () => {
    const store = instantStore();
    const seen: RoomStatus[] = [];
    const off = store.subscribe((s) => seen.push(s), { poll: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);
    expect(seen[0].kind).toBe('loading');
    expect(seen.at(-1)).toEqual(okStatus);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(calls).toBe(1);
    off();
  });

  it('poll:false — 탭이 다시 보이면 1번 더 읽는다', async () => {
    const store = instantStore();
    const off = store.subscribe(() => {}, { poll: false });
    await vi.advanceTimersByTimeAsync(0);
    doc.set('hidden');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toBe(1);
    doc.set('visible');
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(calls).toBe(2);
    off();
  });

  it('poll:true — 25~35초 간격으로 읽는다', async () => {
    let r = 0;
    const randoms = [0, 1, 0.5];
    const store = instantStore(() => randoms[r++ % randoms.length]);
    const off = store.subscribe(() => {}, { poll: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(24_999);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1); // 25초(random 0)
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(34_999);
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(1); // 35초(random 1)
    expect(calls).toBe(3);
    await vi.advanceTimersByTimeAsync(30_000); // 30초(random 0.5)
    expect(calls).toBe(4);
    off();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(calls).toBe(4);
  });

  it('poll:true — 숨겨지면 멈추고, 다시 보이면 바로 읽고 다시 주기 시작', async () => {
    const store = instantStore();
    const off = store.subscribe(() => {}, { poll: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);
    doc.set('hidden');
    await vi.advanceTimersByTimeAsync(300_000);
    expect(calls).toBe(1);
    doc.set('visible');
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls).toBe(3);
    off();
  });

  it('refresh() — 즉시 읽고, 동시에 요청은 1개만', async () => {
    const store = new ServerRoomsStore({
      visibility: doc,
      read: (signal) =>
        new Promise<RoomStatus>((resolve) => {
          calls += 1;
          signal.addEventListener('abort', () => (aborted += 1));
          pending.push(resolve);
        }),
    });
    const seen: RoomStatus[] = [];
    const off = store.subscribe((s) => seen.push(s), { poll: true });
    expect(calls).toBe(1);
    // 진행 중에 refresh·보임 전환·두 번째 구독이 겹쳐도 요청은 하나
    void store.refresh();
    void store.refresh();
    doc.set('visible');
    const off2 = store.subscribe(() => {}, { poll: false });
    expect(calls).toBe(1);
    pending.shift()!({ kind: 'full', rooms: 50, maxRooms: 50 });
    await vi.advanceTimersByTimeAsync(0);
    expect(seen.at(-1)?.kind).toBe('full');
    // 끝난 뒤 refresh()는 새 요청
    const p = store.refresh();
    expect(calls).toBe(2);
    pending.shift()!({ kind: 'ok', rooms: 49, maxRooms: 50 });
    expect((await p).kind).toBe('ok');
    expect(store.get().kind).toBe('ok');
    off2();
    off();
  });

  it('구독이 모두 끝나면 타이머·요청·보임 리스너를 정리한다', async () => {
    const store = new ServerRoomsStore({
      visibility: doc,
      read: (signal) =>
        new Promise<RoomStatus>((resolve) => {
          calls += 1;
          signal.addEventListener('abort', () => (aborted += 1));
          pending.push(resolve);
        }),
    });
    const seen: RoomStatus[] = [];
    const off = store.subscribe((s) => seen.push(s), { poll: true });
    expect(doc.listeners).toBe(1);
    off();
    expect(aborted).toBe(1);
    expect(doc.listeners).toBe(0);
    pending.shift()!(okStatus); // 늦게 온 응답은 반영하지 않음
    await vi.advanceTimersByTimeAsync(120_000);
    expect(seen.map((s) => s.kind)).toEqual(['loading']);
    expect(calls).toBe(1);
  });

  it('로컬 모드 상태면 주기 읽기를 하지 않는다', async () => {
    const store = new ServerRoomsStore({
      visibility: doc,
      read: async () => {
        calls += 1;
        return { kind: 'local' };
      },
    });
    const off = store.subscribe(() => {}, { poll: true });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(calls).toBe(1);
    off();
  });
});
