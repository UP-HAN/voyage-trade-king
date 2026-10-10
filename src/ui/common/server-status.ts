/**
 * "사용 중인 방 n/최대" 상태 읽기(PRD 7.5.1, 10.10 `/health`).
 *
 * - `readServerRooms()`: `./health`(페이지 위치 기준, `cache: 'no-store'`)를 한 번 읽어 판정한다. 5초 넘으면 중단.
 * - `judgeHealth()`: 응답 → 상태(순수 함수). 쓰는 필드는 `rooms`·`maxRooms`·`acceptingNewRooms`뿐이다.
 * - `ServerRoomsStore`: 같은 페이지의 모든 표시(RoomCount·ServiceFooter 등)가 함께 쓰는 저장소.
 *   요청은 한 번에 하나만 띄우고(겹치면 진행 중인 요청을 같이 기다림), 화면이 다시 보일 때 1번 읽는다.
 *   `poll` 구독자가 있으면 화면이 보이는 동안 30초(±5초) 간격으로 읽고, 숨겨지면 멈춘다.
 * - `useServerRooms({ poll })`: 위 저장소를 쓰는 Preact 훅.
 *
 * 상한 숫자는 코드에 박지 않는다 — 언제나 서버 응답의 `maxRooms`를 쓴다.
 */
import { useEffect, useState } from 'preact/hooks';
import { syncMode, type SyncMode } from '../../config/deploy';

export type RoomStatusKind = 'loading' | 'ok' | 'busy' | 'full' | 'blocked' | 'unknown' | 'local';

export interface RoomStatus {
  kind: RoomStatusKind;
  rooms?: number;
  maxRooms?: number;
  /** 읽은 시각(ms) */
  checkedAt?: number;
}

/** 붐빔 기준: `rooms ≥ maxRooms × BUSY_RATIO` */
export const BUSY_RATIO = 0.8;
/** `/health` 시간 제한(ms) */
export const HEALTH_TIMEOUT_MS = 5_000;
/** 주기 읽기 간격(ms)과 흔들림(±ms) */
export const POLL_BASE_MS = 30_000;
export const POLL_JITTER_MS = 5_000;

export const LOADING_STATUS: RoomStatus = { kind: 'loading' };

function currentHref(): string {
  return typeof location !== 'undefined' ? location.href : 'http://localhost/';
}

/** 페이지 위치 기준 `./health` 주소(질의·해시 제외) */
export function healthUrl(href: string = currentHref()): string {
  const u = new URL(href);
  u.hash = '';
  u.search = '';
  return new URL('health', u).href;
}

function isCount(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

/** `/health` 응답 본문 → 상태(순수 함수, PRD 7.5.1 판정 순서) */
export function judgeHealth(body: unknown, checkedAt?: number): RoomStatus {
  const at = checkedAt === undefined ? {} : { checkedAt };
  if (!body || typeof body !== 'object') return { kind: 'unknown', ...at };
  const b = body as { rooms?: unknown; maxRooms?: unknown; acceptingNewRooms?: unknown };
  if (!isCount(b.rooms) || !isCount(b.maxRooms) || b.maxRooms === 0) return { kind: 'unknown', ...at };
  const rooms = b.rooms;
  const maxRooms = b.maxRooms;
  // 옛 서버(acceptingNewRooms 없음)는 true로 본다.
  const accepting = b.acceptingNewRooms !== false;
  let kind: RoomStatusKind;
  if (rooms >= maxRooms) kind = 'full';
  else if (!accepting) kind = 'blocked';
  else if (rooms >= maxRooms * BUSY_RATIO) kind = 'busy';
  else kind = 'ok';
  return { kind, rooms, maxRooms, ...at };
}

/** [방 열기]를 켜 둘지 — `full`·`blocked`일 때만 끈다(확인 중·알 수 없음은 서버가 최종 판단) */
export function canOpenRoom(status: RoomStatus | null | undefined): boolean {
  return !(status && (status.kind === 'full' || status.kind === 'blocked'));
}

export interface ReadOptions {
  href?: string;
  mode?: SyncMode;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
}

/**
 * `./health`를 한 번 읽는다. 로컬 모드면 요청 없이 `local`.
 * 실패·시간 초과·HTTP 오류·JSON 오류·형식 오류는 모두 `unknown`(던지지 않는다).
 */
export async function readServerRooms(signal?: AbortSignal, o: ReadOptions = {}): Promise<RoomStatus> {
  const href = o.href ?? currentHref();
  const mode = o.mode ?? syncMode(href);
  const now = o.now ?? (() => Date.now());
  if (mode !== 'relay') return { kind: 'local' };
  const fetchImpl = o.fetchImpl ?? (typeof fetch === 'function' ? fetch : undefined);
  if (!fetchImpl) return { kind: 'unknown', checkedAt: now() };

  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctrl.abort();
      reject(new Error('timeout'));
    }, o.timeoutMs ?? HEALTH_TIMEOUT_MS);
  });
  try {
    const body = await Promise.race([
      (async () => {
        const res = await fetchImpl(healthUrl(href), { cache: 'no-store', signal: ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as unknown;
      })(),
      timeout,
    ]);
    return judgeHealth(body, now());
  } catch {
    return { kind: 'unknown', checkedAt: now() };
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

// ───────────────────────────── 함께 쓰는 저장소 ─────────────────────────────

/** 화면 보임 상태를 알려 주는 대상(브라우저에서는 document) */
export interface VisibilitySource {
  readonly visibilityState: string;
  addEventListener(type: 'visibilitychange', cb: () => void): void;
  removeEventListener(type: 'visibilitychange', cb: () => void): void;
}

export interface StoreOptions {
  /** 한 번 읽기(기본 readServerRooms) */
  read?: (signal: AbortSignal) => Promise<RoomStatus>;
  visibility?: VisibilitySource | null;
  random?: () => number;
  setTimer?: (cb: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

type Listener = (s: RoomStatus) => void;

interface Sub {
  listener: Listener;
  poll: boolean;
}

/** 주기 읽기 간격: 30초 ± 5초 */
export function nextPollDelay(random: () => number = Math.random): number {
  return POLL_BASE_MS - POLL_JITTER_MS + Math.round(random() * 2 * POLL_JITTER_MS);
}

export class ServerRoomsStore {
  private status: RoomStatus = LOADING_STATUS;
  private readonly subs = new Set<Sub>();
  private inflight: Promise<RoomStatus> | null = null;
  private ctrl: AbortController | null = null;
  private timer: unknown = null;
  private readonly read: (signal: AbortSignal) => Promise<RoomStatus>;
  private readonly vis: VisibilitySource | null;
  private readonly random: () => number;
  private readonly setTimer: (cb: () => void, ms: number) => unknown;
  private readonly clearTimer: (t: unknown) => void;
  /** 읽기 요청 횟수(테스트·진단용) */
  requests = 0;

  constructor(o: StoreOptions = {}) {
    this.read = o.read ?? ((signal) => readServerRooms(signal));
    this.vis = o.visibility !== undefined ? o.visibility : typeof document !== 'undefined' ? document : null;
    this.random = o.random ?? Math.random;
    this.setTimer = o.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
    this.clearTimer = o.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  }

  get(): RoomStatus {
    return this.status;
  }

  private visible(): boolean {
    return !this.vis || this.vis.visibilityState !== 'hidden';
  }

  private wantsPoll(): boolean {
    for (const s of this.subs) if (s.poll) return true;
    return false;
  }

  private set(s: RoomStatus): void {
    this.status = s;
    for (const sub of [...this.subs]) sub.listener(s);
  }

  private onVisibility = (): void => {
    if (this.subs.size === 0) return;
    if (this.visible()) {
      void this.refresh();
    } else {
      this.stopTimer();
    }
  };

  private stopTimer(): void {
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
  }

  private schedule(): void {
    this.stopTimer();
    if (this.subs.size === 0 || !this.wantsPoll() || !this.visible() || this.status.kind === 'local') return;
    this.timer = this.setTimer(() => {
      this.timer = null;
      void this.refresh();
    }, nextPollDelay(this.random));
  }

  /** 지금 한 번 읽는다(이미 읽는 중이면 그 요청을 같이 기다린다) */
  refresh(): Promise<RoomStatus> {
    if (this.inflight) return this.inflight;
    this.stopTimer();
    const ctrl = new AbortController();
    this.ctrl = ctrl;
    this.requests += 1;
    const p = this.read(ctrl.signal)
      .catch((): RoomStatus => ({ kind: 'unknown' }))
      .then((s) => {
        if (this.ctrl === ctrl) {
          this.ctrl = null;
          this.inflight = null;
          if (!ctrl.signal.aborted && this.subs.size > 0) {
            this.set(s);
            this.schedule();
          }
        }
        return s;
      });
    this.inflight = p;
    return p;
  }

  /** 구독. 첫 구독자면 읽기를 시작하고 보임 전환을 듣는다. 반환값은 구독 해제 */
  subscribe(listener: Listener, opts: { poll?: boolean } = {}): () => void {
    const sub: Sub = { listener, poll: !!opts.poll };
    const first = this.subs.size === 0;
    this.subs.add(sub);
    if (first) {
      this.status = LOADING_STATUS;
      this.vis?.addEventListener('visibilitychange', this.onVisibility);
      void this.refresh();
    } else if (sub.poll && this.timer === null && !this.inflight) {
      this.schedule();
    }
    listener(this.status);
    return () => {
      if (!this.subs.delete(sub)) return;
      if (this.subs.size === 0) {
        this.vis?.removeEventListener('visibilitychange', this.onVisibility);
        this.stopTimer();
        this.ctrl?.abort();
        this.ctrl = null;
        this.inflight = null;
      } else if (!this.wantsPoll()) {
        this.stopTimer();
      }
    };
  }
}

let shared: ServerRoomsStore | null = null;

/** 페이지 전체가 함께 쓰는 저장소 */
export function sharedServerRooms(): ServerRoomsStore {
  if (!shared) shared = new ServerRoomsStore();
  return shared;
}

/**
 * 사용 중인 방 상태 훅. 처음 1번 + 화면이 다시 보일 때 1번 읽는다.
 * `poll: true`면 보이는 동안 30초(±5초)마다 읽는다(타이틀은 false — 학생도 거치므로).
 */
export function useServerRooms({ poll }: { poll: boolean }): { status: RoomStatus; refresh: () => void } {
  const store = sharedServerRooms();
  const [status, setStatus] = useState<RoomStatus>(() => (syncMode() === 'relay' ? LOADING_STATUS : { kind: 'local' }));
  useEffect(() => store.subscribe(setStatus, { poll }), [store, poll]);
  return { status, refresh: () => void store.refresh() };
}
