/**
 * LocalAdapter — 서버 없이 한 브라우저의 여러 탭으로 개발·리허설 (PRD 10.4).
 *
 * - 탭끼리 `BroadcastChannel('voyage-local')`로 통신한다.
 * - 방을 여는 탭(호스트)이 `shared/relay-core.ts`를 대신 돌린다("서버 탭"). 이미 서버 탭이 있으면 그 탭에 붙는다.
 *   서버 탭을 닫으면 그 안의 방이 모두 사라진다(개발용이라 허용 — 콘솔 안내). 다른 호스트 탭이 남아 있으면 그 탭이 새 서버가 된다.
 * - 학생 탭은 서버 탭을 찾을 때까지 1초마다 다시 찾는다('reconnecting').
 * - `?as=s07`: 탭마다 다른 학생을 흉내 내도록 기기 토큰을 sessionStorage에 따로 둔다(`localDeviceToken`).
 * - `latencyMs`(또는 `true` = 50ms): 실제 서버처럼 한 방향 지연을 흉내 낸다.
 */
import type { Notice } from '@shared/protocol';
import { createRelayCore, type RelayConfig, type RelayCore, type RelayStats } from '@shared/relay-core';
import { HostBase, PeerBase, type JoinResult, type PeerHello, type TransportKind } from './adapter';

export const LOCAL_CHANNEL = 'voyage-local';
/** `latencyMs: true`일 때의 지연(ms) */
export const LOCAL_DEFAULT_LATENCY = 50;
const DISCOVER_WAIT_MS = 200;
const RETRY_MS = 1000;
const SWEEP_MS = 1000;
const LOCAL_IP = 'local';

/** BroadcastChannel과 같은 모양(테스트에서 바꿔 끼울 수 있게) */
export interface ChannelLike {
  postMessage(data: unknown): void;
  close(): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
}
export type ChannelFactory = (name: string) => ChannelLike;

export interface LocalOptions {
  channelName?: string;
  channelFactory?: ChannelFactory;
  /** 한 방향 지연(ms). true면 50ms */
  latencyMs?: number | boolean;
  /** 서버 탭이 될 때 relay-core 설정 */
  config?: Partial<RelayConfig>;
  /** 학생 탭 이름(`?as=s07`) — 콘솔 표시용 */
  as?: string | null;
}

/** 탭 사이 봉투 */
type Wire =
  | { k: 'discover'; from: string }
  | { k: 'server'; id: string; to: string }
  | { k: 'connect'; from: string; to: string }
  | { k: 'c2s'; from: string; to: string; data: string }
  | { k: 's2c'; from: string; to: string; data: string }
  | { k: 'close'; from: string; to: string; code: number }
  | { k: 'bye'; from: string; to: string }
  | { k: 'server.down'; id: string };

function defaultChannel(name: string): ChannelLike {
  if (typeof BroadcastChannel === 'undefined') throw new Error('이 브라우저는 BroadcastChannel을 지원하지 않아요');
  return new BroadcastChannel(name) as unknown as ChannelLike;
}

function newId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function latencyOf(v: LocalOptions['latencyMs']): number {
  if (v === true) return LOCAL_DEFAULT_LATENCY;
  if (typeof v === 'number' && v > 0) return v;
  return 0;
}

function later(ms: number, fn: () => void) {
  if (ms > 0) setTimeout(fn, ms);
  else queueMicrotask(fn);
}

const asWire = (d: unknown): Wire | null =>
  d && typeof d === 'object' && typeof (d as { k?: unknown }).k === 'string' ? (d as Wire) : null;

/** 서버 탭 안에서 도는 relay-core + 채널 연결 */
class LocalServer {
  readonly id = newId();
  readonly core: RelayCore;
  private readonly channel: ChannelLike;
  private readonly timer: ReturnType<typeof setInterval>;
  /** 같은 탭 안의 클라이언트(채널을 거치지 않음) */
  private readonly inProcess = new Map<string, LocalLink>();
  private stopped = false;

  constructor(
    private readonly opts: { channelName: string; channelFactory: ChannelFactory; latency: number; config?: Partial<RelayConfig> },
  ) {
    this.channel = opts.channelFactory(opts.channelName);
    this.core = createRelayCore(opts.config ?? {}, {
      now: () => Date.now(),
      send: (connId, data) => {
        const local = this.inProcess.get(connId);
        if (local) later(this.opts.latency, () => local.deliver(data));
        else later(this.opts.latency, () => this.post({ k: 's2c', from: this.id, to: connId, data }));
      },
      close: (connId, code) => {
        const local = this.inProcess.get(connId);
        if (local) {
          this.inProcess.delete(connId);
          later(this.opts.latency, () => local.serverClosed());
        } else later(this.opts.latency, () => this.post({ k: 'close', from: this.id, to: connId, code }));
      },
    });
    this.channel.onmessage = (ev) => this.onWire(asWire(ev.data));
    this.timer = setInterval(() => this.core.sweep(), SWEEP_MS);
    console.info('[local] 이 탭이 방 서버 역할을 해요. 이 탭을 닫으면 방이 사라져요(개발용).');
  }

  private post(w: Wire) {
    if (!this.stopped) this.channel.postMessage(w);
  }

  private onWire(w: Wire | null) {
    if (!w || this.stopped) return;
    switch (w.k) {
      case 'discover':
        this.post({ k: 'server', id: this.id, to: w.from });
        return;
      case 'connect':
        if (w.to === this.id) this.core.onConnect(w.from, { ip: LOCAL_IP, origin: 'local' });
        return;
      case 'c2s':
        if (w.to === this.id) this.core.onMessage(w.from, w.data);
        return;
      case 'bye':
        if (w.to === this.id) this.core.onDisconnect(w.from);
        return;
      default:
        return;
    }
  }

  /** 같은 탭의 클라이언트 연결 */
  connectLocal(link: LocalLink) {
    this.inProcess.set(link.clientId, link);
    this.core.onConnect(link.clientId, { ip: LOCAL_IP, origin: 'local' });
  }
  sendLocal(link: LocalLink, data: string) {
    later(this.opts.latency, () => {
      if (this.inProcess.get(link.clientId) === link) this.core.onMessage(link.clientId, data);
    });
  }
  byeLocal(link: LocalLink) {
    if (this.inProcess.get(link.clientId) !== link) return;
    this.inProcess.delete(link.clientId);
    this.core.onDisconnect(link.clientId);
  }

  stop() {
    if (this.stopped) return;
    this.channel.postMessage({ k: 'server.down', id: this.id } satisfies Wire);
    this.stopped = true;
    clearInterval(this.timer);
    this.channel.close();
    for (const link of [...this.inProcess.values()]) link.serverClosed();
    this.inProcess.clear();
  }
}

/** 클라이언트 하나의 연결(채널 또는 같은 탭 서버) */
class LocalLink {
  readonly clientId = newId();
  private channel: ChannelLike | null = null;
  private serverId: string | null = null;
  private server: LocalServer | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private discovering = false;
  /** 같은 탭에 서버를 띄웠을 때 */
  ownServer: LocalServer | null = null;

  constructor(
    private readonly owner: LocalHost | LocalPeer,
    private readonly opts: { channelName: string; channelFactory: ChannelFactory; latency: number; config?: Partial<RelayConfig> },
    private readonly canServe: boolean,
  ) {}

  /** 연결을 시도하고, 붙거나(또는 학생이면 첫 찾기 실패 후) 끝난다 */
  start(): Promise<void> {
    this.channel = this.opts.channelFactory(this.opts.channelName);
    this.channel.onmessage = (ev) => this.onWire(asWire(ev.data));
    return this.discover();
  }

  private discover(): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.discovering = true;
    this.channel?.postMessage({ k: 'discover', from: this.clientId } satisfies Wire);
    return new Promise((resolve) => {
      setTimeout(() => {
        this.discovering = false;
        if (this.closed || this.isConnected()) return resolve();
        if (this.canServe) {
          this.ownServer = new LocalServer(this.opts);
          this.server = this.ownServer;
          this.ownServer.connectLocal(this);
          this.owner.connectionOpened();
        } else {
          if (this.owner.getStatus() !== 'reconnecting') this.owner.connectionLost(true);
          this.retry = setTimeout(() => void this.discover(), RETRY_MS);
        }
        resolve();
      }, DISCOVER_WAIT_MS);
    });
  }

  /** (105) 서버가 끊은 연결을 다시 찾는다(leave로 닫았으면 그대로) */
  reopen(): Promise<void> {
    if (this.closed || this.isConnected() || this.discovering) return Promise.resolve();
    if (this.retry) clearTimeout(this.retry);
    return this.discover();
  }

  private isConnected() {
    return this.server !== null || this.serverId !== null;
  }

  private onWire(w: Wire | null) {
    if (!w || this.closed) return;
    switch (w.k) {
      case 'server':
        if (w.to !== this.clientId || this.isConnected() || !this.discovering) return;
        this.serverId = w.id;
        if (this.retry) clearTimeout(this.retry);
        this.channel?.postMessage({ k: 'connect', from: this.clientId, to: w.id } satisfies Wire);
        this.owner.connectionOpened();
        return;
      case 's2c':
        if (w.to === this.clientId && w.from === this.serverId) this.deliver(w.data);
        return;
      case 'close':
        if (w.to === this.clientId && w.from === this.serverId) this.serverClosed();
        return;
      case 'server.down':
        if (w.id === this.serverId) {
          this.serverId = null;
          console.info('[local] 서버 탭이 닫혔어요. 다시 찾는 중…');
          this.owner.connectionLost(true);
          this.retry = setTimeout(() => void this.discover(), Math.random() * DISCOVER_WAIT_MS);
        }
        return;
      default:
        return;
    }
  }

  deliver(data: string) {
    if (!this.closed) this.owner.receive(data);
  }

  /** 서버가 이 연결을 끊음(내보내기·방 닫힘 등) */
  serverClosed() {
    this.serverId = null;
    this.server = null;
    if (!this.closed) this.owner.connectionLost(false);
  }

  send(data: string) {
    if (this.server) {
      this.server.sendLocal(this, data);
      return;
    }
    if (!this.serverId || !this.channel) return;
    const msg: Wire = { k: 'c2s', from: this.clientId, to: this.serverId, data };
    const ch = this.channel;
    later(this.opts.latency, () => {
      if (!this.closed) ch.postMessage(msg);
    });
  }

  close() {
    if (this.closed) return;
    if (this.server) this.server.byeLocal(this);
    else if (this.serverId) this.channel?.postMessage({ k: 'bye', from: this.clientId, to: this.serverId } satisfies Wire);
    this.closed = true;
    if (this.retry) clearTimeout(this.retry);
    this.ownServer?.stop();
    this.channel?.close();
    this.channel = null;
    this.server = null;
    this.serverId = null;
  }

  /** 이 탭의 서버(없으면 null) */
  serverCore(): RelayCore | null {
    return this.ownServer?.core ?? null;
  }
}

function linkOpts(o: LocalOptions) {
  return {
    channelName: o.channelName ?? LOCAL_CHANNEL,
    channelFactory: o.channelFactory ?? defaultChannel,
    latency: latencyOf(o.latencyMs),
    ...(o.config ? { config: o.config } : {}),
  };
}

function onPageHide(fn: () => void) {
  const w = (globalThis as { addEventListener?: (t: string, f: () => void) => void }).addEventListener;
  if (typeof w === 'function' && typeof (globalThis as { document?: unknown }).document !== 'undefined') {
    w.call(globalThis, 'pagehide', fn);
  }
}

export class LocalHost extends HostBase {
  readonly kind: TransportKind = 'local';
  /** @internal */
  link: LocalLink;
  constructor(opts: LocalOptions = {}) {
    super(() => Date.now());
    this.link = new LocalLink(this, linkOpts(opts), true);
  }
  protected sendRaw(data: string): void {
    this.link.send(data);
  }
  protected closeWire(): void {
    this.link.close();
    this.connectionLost(false);
  }
  /** 연결을 닫는다(이 탭이 서버였다면 방도 사라짐) */
  close(): void {
    this.closeWire();
  }
  /** 이 탭이 서버 탭이면 relay-core 현황 */
  serverStats(): RelayStats | null {
    return this.link.serverCore()?.stats() ?? null;
  }
  /** 이 탭이 서버 탭이면 공지 설정(테스트 도구). 아니면 false */
  setNotice(n: Notice | null): boolean {
    const core = this.link.serverCore();
    if (!core) return false;
    core.setNotice(n);
    return true;
  }
}

export class LocalPeer extends PeerBase {
  readonly kind: TransportKind = 'local';
  /** @internal */
  link: LocalLink;
  readonly as: string | null;
  constructor(opts: LocalOptions = {}) {
    super(() => Date.now());
    this.as = opts.as ?? null;
    this.link = new LocalLink(this, linkOpts(opts), false);
  }
  protected sendRaw(data: string): void {
    this.link.send(data);
  }
  protected closeWire(): void {
    this.link.close();
    this.connectionLost(false);
  }
  /** (105) 서버가 끊은 뒤(방 밖 30초 정리 등) 다시 [입장]하면 서버 탭을 다시 찾아 보낸다 — RelayPeer와 같은 의미 */
  override async join(code: string, hello: PeerHello): Promise<JoinResult> {
    if (this.getStatus() === 'offline') await this.link.reopen();
    return super.join(code, hello);
  }
}

/** 호스트 만들기: 서버 탭을 찾고, 없으면 이 탭이 서버가 된다. 연결되면 돌려준다 */
export async function createLocalHost(opts: LocalOptions = {}): Promise<LocalHost> {
  const h = new LocalHost(opts);
  await h.link.start();
  onPageHide(() => h.close());
  return h;
}

/** 학생 만들기: 서버 탭을 찾는다(없으면 'reconnecting' 상태로 돌려주고 계속 찾음) */
export async function createLocalPeer(opts: LocalOptions = {}): Promise<LocalPeer> {
  const p = new LocalPeer(opts);
  await p.link.start();
  onPageHide(() => p.leave());
  return p;
}

/** `?as=` 값별 기기 토큰 저장 키 */
export const LOCAL_AS_KEY_PREFIX = 'voyage.local.as.';

/**
 * `?as=s07`이 있으면 그 탭 전용 기기 토큰(sessionStorage, 탭마다 다름)을 돌려준다. 없으면 null.
 * 세션 계층(124)은 local 모드에서 이 값이 있으면 localStorage의 기기 토큰 대신 쓴다(같은 브라우저 탭들이 다른 학생이 되도록).
 */
export function localDeviceToken(
  as: string | null,
  storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = typeof sessionStorage !== 'undefined' ? sessionStorage : undefined,
): string | null {
  if (!as) return null;
  const key = LOCAL_AS_KEY_PREFIX + as;
  try {
    const old = storage?.getItem(key);
    if (old) return old;
    const token = newId().replace(/-/g, '');
    storage?.setItem(key, token);
    return token;
  } catch {
    return newId().replace(/-/g, '');
  }
}
