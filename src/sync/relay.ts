/**
 * RelayAdapter — 중계 서버(server/, 작업 105)에 WebSocket으로 붙는 HostTransport·PeerTransport (PRD 10.4·10.5).
 *
 * - 방 동작(요청·응답·학생/호스트 메시지)은 104의 `HostBase`/`PeerBase`가 하고, 여기서는 **연결**만 다룬다:
 *   WebSocket 열기·자동 재연결(1·2·4·8…최대 15초, ±20% 흔들림)·서버 시각 보정(ping 3번, 왕복 최소값)·
 *   `server.restarting` 처리·연결 수준 오류(출처·버전·상한) 알림.
 * - 104 계약대로 어댑터는 다시 붙은 뒤 **스스로 방에 다시 들어가지 않는다.** 상태가 'online'으로 돌아오면 세션 계층(124)이
 *   `resumeRoom`(호스트) / `join`(학생)을 다시 부른다. 호스트의 "resume → 같은 코드로 다시 열기 → 새 코드" 순서는
 *   `restoreHostRoom()` 도우미로도 제공한다(세션이 써도 되고 직접 해도 된다).
 * - Node(테스트·부하 생성기)에서는 `createSocket`으로 `ws` 클라이언트를 넣는다(Origin 헤더를 줄 수 있게).
 */
import { CLOSE_CODES, PROTOCOL_VERSION, errorToKorean, type ErrorCode } from '@shared/protocol';
import {
  HostBase,
  Listeners,
  PeerBase,
  type HostTransport,
  type JoinResult,
  type OpenRoomOptions,
  type OpenRoomResult,
  type PeerHello,
  type ResumeRoomResult,
  type ServerStatsInfo,
  type Unsub,
} from './adapter';

// ───────────────────────────── 소켓 ─────────────────────────────

/** 브라우저 WebSocket과 `ws` 패키지 WebSocket이 함께 가진 최소 모양 */
export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}
export type WebSocketFactory = (url: string) => WebSocketLike;

const WS_OPEN = 1;

/** 기본: 전역 WebSocket(브라우저, Node 22+) */
export const defaultSocketFactory: WebSocketFactory = (url) => {
  const Ctor = (globalThis as { WebSocket?: new (u: string) => WebSocketLike }).WebSocket;
  if (!Ctor) throw new Error('이 환경에는 WebSocket이 없어요');
  return new Ctor(url);
};

export interface RelayOptions {
  /** 소켓 만들기(테스트·Node에서 `ws` 클라이언트 주입) */
  createSocket?: WebSocketFactory;
  /** 시각(ms) */
  clock?: () => number;
  /** [0,1) 난수(재연결 흔들림) */
  random?: () => number;
  /** 재연결 첫 대기(ms, 기본 1000) — 1·2·4·8… */
  backoffBaseMs?: number;
  /** 재연결 최대 대기(ms, 기본 15000) */
  backoffMaxMs?: number;
  /** 흔들림 비율(기본 0.2 = ±20%) */
  jitter?: number;
  /** 서버 시각 다시 재기·연결 점검 주기(ms, 기본 30000) */
  clockSyncIntervalMs?: number;
  /** 한 번 잴 때 ping 수(기본 3) */
  clockSyncPings?: number;
  /** 이 시간 동안 받은 것이 없으면 끊고 다시 붙음(ms, 기본 75000) */
  staleAfterMs?: number;
  /** 요청 전에 연결을 기다리는 최대 시간(ms, 기본 10000) */
  connectWaitMs?: number;
  /** 요청 시간 제한(ms, 기본 104의 REQUEST_TIMEOUT_MS) */
  requestTimeoutMs?: number;
  /** 만들자마자 연결(기본 true) */
  autoConnect?: boolean;
}

/** 연결 수준 오류(요청과 상관없이 서버가 보낸 오류·끊기 코드) */
export interface RelayConnectionError {
  code: ErrorCode | 'CLOSED';
  /** errorToKorean 문구 */
  message: string;
  /** WebSocket close 코드(끊김에서 온 경우) */
  closeCode?: number;
}

/** 다시 붙지 않는 끊기 코드: 출처·버전(고쳐지지 않음) */
const FATAL_CLOSE = new Set<number>([CLOSE_CODES.ORIGIN, CLOSE_CODES.VERSION]);
/** 스스로는 다시 붙지 않고, 다음 요청 때 붙는 끊기 코드: 내보내짐·방 닫힘·빈 연결 정리·다른 탭이 대신함 */
const LAZY_CLOSE = new Set<number>([CLOSE_CODES.KICKED, CLOSE_CODES.ROOM_CLOSED, CLOSE_CODES.UNJOINED_TIMEOUT, CLOSE_CODES.REPLACED]);
/** 끊기 코드 → 오류 코드 */
const CLOSE_TO_ERROR: Partial<Record<number, ErrorCode>> = {
  [CLOSE_CODES.TOO_LARGE]: 'TOO_LARGE',
  [CLOSE_CODES.UNJOINED_TIMEOUT]: 'UNJOINED_TIMEOUT',
  [CLOSE_CODES.BUSY]: 'BUSY',
  [CLOSE_CODES.RATE_LIMITED]: 'RATE_LIMITED',
  [CLOSE_CODES.ORIGIN]: 'ORIGIN',
  [CLOSE_CODES.VERSION]: 'VERSION',
};
/** 연결이 이만큼 살아 있었으면 재연결 대기를 처음(1초)부터 */
const STABLE_MS = 5000;

interface LinkHooks {
  /** 소켓 열림 */
  opened(): void;
  /** 받은 문자열 */
  data(s: string): void;
  /** 끊김. reconnecting이면 자동으로 다시 붙는 중 */
  lost(reconnecting: boolean): void;
  /** 연결 시도 시작(상태 'reconnecting'으로) */
  connecting(): void;
}

/**
 * WebSocket 하나를 관리한다(열기·재연결·시각 보정·끊김 감지). RelayHost·RelayPeer가 하나씩 가진다.
 */
export class RelayLink {
  private ws: WebSocketLike | null = null;
  private openedAt = 0;
  private lastRecv = 0;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private waiting: Array<(ok: boolean) => void> = [];
  /** 서버 시각 - 내 시각(ms) */
  offset = 0;
  /** 마지막으로 잰 왕복 최소값(ms, 없으면 null) */
  lastRtt: number | null = null;
  private round: { left: number; best: number } | null = null;
  readonly errorL = new Listeners<[RelayConnectionError]>();
  private lastConnErr: RelayConnectionError | null = null;
  /** 이번 연결에서 이미 오류를 알렸는가(서버가 오류를 보내고 끊으면 같은 오류를 두 번 알리지 않게) */
  private errThisConn = false;
  private readonly createSocket: WebSocketFactory;
  private readonly clock: () => number;
  private readonly random: () => number;
  private readonly o: Required<Omit<RelayOptions, 'createSocket' | 'clock' | 'random' | 'requestTimeoutMs' | 'autoConnect'>>;

  constructor(
    readonly url: string,
    private readonly hooks: LinkHooks,
    opts: RelayOptions = {},
  ) {
    this.createSocket = opts.createSocket ?? defaultSocketFactory;
    this.clock = opts.clock ?? (() => Date.now());
    this.random = opts.random ?? Math.random;
    this.o = {
      backoffBaseMs: opts.backoffBaseMs ?? 1000,
      backoffMaxMs: opts.backoffMaxMs ?? 15_000,
      jitter: opts.jitter ?? 0.2,
      clockSyncIntervalMs: opts.clockSyncIntervalMs ?? 30_000,
      clockSyncPings: Math.max(1, opts.clockSyncPings ?? 3),
      staleAfterMs: opts.staleAfterMs ?? 75_000,
      connectWaitMs: opts.connectWaitMs ?? 10_000,
    };
  }

  isOpen(): boolean {
    return !!this.ws && this.ws.readyState === WS_OPEN && this.openedAt > 0;
  }

  /** 마지막 연결 수준 오류 */
  connectionError(): RelayConnectionError | null {
    return this.lastConnErr;
  }

  /** n번째(0부터) 재연결 대기(ms) — 1·2·4·8…최대 15초, ±jitter */
  backoffDelay(n: number): number {
    const base = Math.min(this.o.backoffBaseMs * 2 ** Math.min(n, 20), this.o.backoffMaxMs);
    const j = 1 + this.o.jitter * (2 * this.random() - 1);
    return Math.max(0, Math.round(base * j));
  }

  /** 연결 시작(이미 열렸거나 여는 중이면 그대로) */
  connect(): void {
    this.stopped = false;
    if (this.ws || this.retryTimer) return;
    this.hooks.connecting();
    let ws: WebSocketLike;
    try {
      ws = this.createSocket(this.url);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    this.openedAt = 0;
    this.errThisConn = false;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.openedAt = this.clock();
      this.lastRecv = this.openedAt;
      this.startSyncTimer();
      this.hooks.opened();
      this.flushWaiting(true);
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      this.lastRecv = this.clock();
      const d = ev.data;
      this.hooks.data(typeof d === 'string' ? d : String(d));
    };
    ws.onerror = () => {
      /* onclose가 뒤따른다 */
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.dropped(ev.code);
    };
  }

  /** 소켓이 닫혔다(서버·네트워크) */
  private dropped(code: number): void {
    const lived = this.openedAt ? this.clock() - this.openedAt : 0;
    this.detach();
    const errCode = CLOSE_TO_ERROR[code];
    if (errCode && !this.errThisConn) this.reportError({ code: errCode, message: errorToKorean(errCode), closeCode: code });
    if (this.stopped) {
      this.hooks.lost(false);
      this.flushWaiting(false);
      return;
    }
    if (FATAL_CLOSE.has(code) || LAZY_CLOSE.has(code)) {
      // 스스로 다시 붙지 않는다. 다음 요청(ready)이 다시 연다
      this.attempt = 0;
      this.hooks.lost(false);
      this.flushWaiting(false);
      return;
    }
    if (lived >= STABLE_MS) this.attempt = 0;
    this.hooks.lost(true);
    this.scheduleRetry();
  }

  private scheduleRetry(delay = this.backoffDelay(this.attempt)): void {
    if (this.stopped || this.retryTimer) return;
    this.attempt++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
  }

  private detach(): void {
    const ws = this.ws;
    this.ws = null;
    this.openedAt = 0;
    this.round = null;
    if (this.syncTimer) clearInterval(this.syncTimer);
    this.syncTimer = null;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
      try {
        ws.close(1000, 'bye');
      } catch {
        /* 이미 닫힘 */
      }
    }
  }

  /** 지금 연결을 끊고 곧 다시 붙는다(서버 재시작 알림·응답 없음) */
  restartSoon(): void {
    if (this.stopped) return;
    const wasOpen = this.openedAt > 0;
    this.detach();
    this.attempt = 0;
    if (wasOpen) this.hooks.lost(true);
    this.scheduleRetry();
  }

  /** 영구히 끊는다(다시 connect()/ready()를 부르면 다시 연다) */
  stop(): void {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.detach();
    this.attempt = 0;
    this.hooks.lost(false);
    this.flushWaiting(false);
  }

  /** 열려 있으면 바로, 아니면 연결을 시작해 열릴 때까지(최대 connectWaitMs) 기다린다 */
  ready(): Promise<boolean> {
    if (this.isOpen()) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      let done = false;
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(ok);
      };
      const timer = setTimeout(() => finish(false), this.o.connectWaitMs);
      this.waiting.push(finish);
      if (this.retryTimer) {
        // 다음 재시도를 앞당긴다(사용자가 지금 하려는 일)
        clearTimeout(this.retryTimer);
        this.retryTimer = null;
      }
      this.connect();
    });
  }

  private flushWaiting(ok: boolean): void {
    for (const w of this.waiting.splice(0)) w(ok);
  }

  send(data: string): void {
    if (this.ws && this.ws.readyState === WS_OPEN) this.ws.send(data);
  }

  // ── 서버 시각 ──
  private startSyncTimer(): void {
    if (this.syncTimer) clearInterval(this.syncTimer);
    this.syncTimer = setInterval(() => {
      if (!this.isOpen()) return;
      if (this.clock() - this.lastRecv > this.o.staleAfterMs) {
        this.restartSoon();
        return;
      }
      this.syncClock();
    }, this.o.clockSyncIntervalMs);
  }

  /** ping n번(앞 응답을 받은 뒤 다음) → 왕복 최소값의 절반으로 오프셋 */
  syncClock(): void {
    if (!this.isOpen()) return;
    this.round = { left: this.o.clockSyncPings, best: Infinity };
    this.sendPing();
  }

  private sendPing(): void {
    if (!this.round || this.round.left <= 0) return;
    this.round.left--;
    this.send(JSON.stringify({ v: PROTOCOL_VERSION, t: 'ping', at: this.clock() }));
  }

  /** pong 처리. 반환값 = 오프셋을 바꿨는가 */
  pong(at: number, serverNow: number): boolean {
    const now = this.clock();
    const rtt = Math.max(0, now - at);
    let changed = false;
    if (this.round) {
      if (rtt < this.round.best) {
        this.round.best = rtt;
        this.offset = serverNow + rtt / 2 - now;
        this.lastRtt = rtt;
        changed = true;
      }
      if (this.round.left > 0) this.sendPing();
      else this.round = null;
    } else if (this.lastRtt === null || rtt <= this.lastRtt) {
      this.offset = serverNow + rtt / 2 - now;
      this.lastRtt = rtt;
      changed = true;
    }
    return changed;
  }

  reportError(e: RelayConnectionError): void {
    this.errThisConn = true;
    this.lastConnErr = e;
    this.errorL.emit(e);
  }
}

/** 받은 문자열에서 종류만 가볍게 꺼내 연결 수준 처리(pong·restarting·연결 오류)를 한다. pong이면 true(소비) */
function preReceive(link: RelayLink, data: string): boolean {
  if (!data.includes('"t":"pong"') && !data.includes('"t":"server.restarting"') && !data.includes('"t":"error"')) return false;
  let m: { t?: unknown; at?: unknown; serverNow?: unknown; code?: unknown; req?: unknown; text?: unknown };
  try {
    m = JSON.parse(data) as typeof m;
  } catch {
    return false;
  }
  if (m.t === 'pong' && typeof m.at === 'number' && typeof m.serverNow === 'number') {
    link.pong(m.at, m.serverNow);
    return true;
  }
  if (m.t === 'server.restarting') {
    // 서버가 곧 다시 켜진다 → 바로 끊고 재연결 절차(학생 화면: "잠깐 다시 연결하는 중…")
    queueMicrotask(() => link.restartSoon());
    return false;
  }
  if (m.t === 'error' && typeof m.code === 'string' && m.req === undefined) {
    // 요청과 무관한 오류(출처·버전·상한·빈 연결 정리 등)
    const code = m.code as ErrorCode;
    link.reportError({ code, message: errorToKorean(code, typeof m.text === 'string' ? { text: m.text } : undefined) });
  }
  return false;
}

// ───────────────────────────── 호스트 ─────────────────────────────

export class RelayHost extends HostBase {
  readonly kind = 'relay' as const;
  readonly link: RelayLink;

  constructor(url: string, opts: RelayOptions = {}) {
    super(opts.clock);
    if (opts.requestTimeoutMs !== undefined) this.requestTimeoutMs = opts.requestTimeoutMs;
    this.link = new RelayLink(
      url,
      {
        opened: () => this.connectionOpened(),
        data: (s) => this.receive(s),
        lost: (r) => this.connectionLost(r),
        connecting: () => this.setStatus('reconnecting'),
      },
      opts,
    );
    if (opts.autoConnect !== false) this.link.connect();
  }

  protected sendRaw(data: string): void {
    this.link.send(data);
  }
  protected closeWire(): void {
    this.link.stop();
  }
  override receive(data: string): void {
    if (preReceive(this.link, data)) return;
    super.receive(data);
  }
  override syncClock(): void {
    this.link.syncClock();
  }
  override serverNow(): number {
    return this.clock() + this.link.offset;
  }

  override async openRoom(opts: OpenRoomOptions): Promise<OpenRoomResult> {
    await this.link.ready();
    return super.openRoom(opts);
  }
  override async resumeRoom(code: string, hostToken: string): Promise<ResumeRoomResult> {
    await this.link.ready();
    return super.resumeRoom(code, hostToken);
  }
  override async queryStats(): Promise<ServerStatsInfo | null> {
    await this.link.ready();
    return super.queryStats();
  }

  /** 연결 수준 오류(출처·버전·상한 등) 알림 — message는 errorToKorean 문구 */
  onConnectionError(cb: (e: RelayConnectionError) => void): Unsub {
    return this.link.errorL.add(cb);
  }
  connectionError(): RelayConnectionError | null {
    return this.link.connectionError();
  }
  /** 연결을 영구히 닫는다(다시 쓰려면 openRoom/resumeRoom이 다시 연다) */
  dispose(): void {
    this.link.stop();
  }
}

// ───────────────────────────── 학생 ─────────────────────────────

export class RelayPeer extends PeerBase {
  readonly kind = 'relay' as const;
  readonly link: RelayLink;

  constructor(url: string, opts: RelayOptions = {}) {
    super(opts.clock);
    if (opts.requestTimeoutMs !== undefined) this.requestTimeoutMs = opts.requestTimeoutMs;
    this.link = new RelayLink(
      url,
      {
        opened: () => this.connectionOpened(),
        data: (s) => this.receive(s),
        lost: (r) => this.connectionLost(r),
        connecting: () => this.setStatus('reconnecting'),
      },
      opts,
    );
    if (opts.autoConnect !== false) this.link.connect();
  }

  protected sendRaw(data: string): void {
    this.link.send(data);
  }
  protected closeWire(): void {
    this.link.stop();
  }
  override receive(data: string): void {
    if (preReceive(this.link, data)) return;
    super.receive(data);
  }
  override syncClock(): void {
    this.link.syncClock();
  }
  override serverNow(): number {
    return this.clock() + this.link.offset;
  }

  override async join(code: string, hello: PeerHello): Promise<JoinResult> {
    await this.link.ready();
    return super.join(code, hello);
  }
  override async queryStats(): Promise<ServerStatsInfo | null> {
    await this.link.ready();
    return super.queryStats();
  }

  onConnectionError(cb: (e: RelayConnectionError) => void): Unsub {
    return this.link.errorL.add(cb);
  }
  connectionError(): RelayConnectionError | null {
    return this.link.connectionError();
  }
  dispose(): void {
    this.leave();
  }
}

// ───────────────────────────── 만들기 (select.ts의 RelayModule) ─────────────────────────────

export function createRelayHost(url: string, opts?: RelayOptions): RelayHost {
  return new RelayHost(url, opts);
}

export function createRelayPeer(url: string, opts?: RelayOptions): RelayPeer {
  return new RelayPeer(url, opts);
}

// ───────────────────────────── 도우미 ─────────────────────────────

export type RestoreResult =
  | { kind: 'resumed'; code: string; hostToken: string }
  | { kind: 'reopened'; code: string; hostToken: string }
  | { kind: 'changed'; code: string; hostToken: string; oldCode: string }
  | { kind: 'failed'; error: string };

/**
 * 호스트 방 되살리기(PRD 7.3, brief 105-9): ① `resumeRoom` → ② `NO_ROOM`이면 같은 코드로 `openRoom{wantCode, hostToken}`
 * → ③ 다른 코드가 나오면 'changed'(세션이 학생·공용 화면에 새 코드를 알림). 세션 계층(124)이 다시 붙은 뒤 부를 수 있다.
 */
export async function restoreHostRoom(
  host: Pick<HostTransport, 'resumeRoom' | 'openRoom'>,
  saved: { code: string; hostToken: string; maxPeers: number },
): Promise<RestoreResult> {
  const r = await host.resumeRoom(saved.code, saved.hostToken);
  if (r === 'ok') return { kind: 'resumed', code: saved.code, hostToken: saved.hostToken };
  if (r !== 'NO_ROOM') return { kind: 'failed', error: r };
  const o = await host.openRoom({ maxPeers: saved.maxPeers, wantCode: saved.code, hostToken: saved.hostToken });
  if (typeof o === 'string') return { kind: 'failed', error: o };
  if (o.code === saved.code) return { kind: 'reopened', code: o.code, hostToken: o.hostToken };
  return { kind: 'changed', code: o.code, hostToken: o.hostToken, oldCode: saved.code };
}

/** 중계 주소(ws/wss) → 같은 폴더의 HTTP(S) 주소(예: `wss://h/voyage/ws` + 'health' → `https://h/voyage/health`) */
export function relayHttpUrl(relayUrl: string, name: 'health' | 'notice'): string {
  const u = new URL(name, relayUrl);
  u.protocol = u.protocol === 'wss:' ? 'https:' : u.protocol === 'ws:' ? 'http:' : u.protocol;
  u.search = '';
  u.hash = '';
  return u.href;
}
