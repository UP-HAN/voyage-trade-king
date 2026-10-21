/**
 * MemoryNetwork — 한 프로세스 안의 가짜 중계 서버 (PRD 10.4 `MemoryAdapter`).
 *
 * `shared/relay-core.ts`를 그대로 돌리고, 호스트·학생 클라이언트를 여러 개 만든다(단위 테스트·30명 시뮬레이션).
 * 메시지는 실제처럼 JSON 문자열로 오가고, 비동기로 전달된다(지연 0이면 마이크로태스크, 아니면 setTimeout).
 * 시각은 가상 시계(`advanceTime`)로 움직인다.
 */
import type { Notice } from '@shared/protocol';
import { createRelayCore, type RelayConfig, type RelayCore, type RelayDeps, type RelayStats } from '@shared/relay-core';
import { HostBase, PeerBase, type JoinResult, type PeerHello, type TransportKind } from './adapter';

export interface MemoryNetworkOptions {
  config?: Partial<RelayConfig>;
  /** 가상 시계 시작 시각(ms). 기본 Date.now() */
  startTime?: number;
  /** 한 방향 전달 지연(ms). 기본 0 */
  latencyMs?: number;
  randomInt?: RelayDeps['randomInt'];
  randomToken?: RelayDeps['randomToken'];
}

export interface MemoryClientOptions {
  /** 이 클라이언트의 IP(속도 제한·방 생성 제한용). 기본 '10.0.0.1' */
  ip?: string;
}

type MemoryClient = MemoryHost | MemoryPeer;

interface Link {
  client: MemoryClient;
  connId: string | null;
  ip: string;
  /** leave()로 영구히 닫힘(테스트 도구 `reopenAfterLeave`로만 다시 엶 — 작업 145) */
  closed: boolean;
  /** 연결할 때마다 1 증가 — 이전 연결로 보낸 메시지가 새 연결에 도착하지 않게 */
  gen: number;
  /** 서버가 끊었음(끊기 전에 보낸 메시지는 마저 도착) */
  serverClosed: boolean;
  /** (105) 마지막 끊김이 서버가 끊은 것(방 밖 정리·내보내기 등)인가 — 그때만 다음 join이 다시 붙는다 */
  droppedByServer?: boolean;
}

export class MemoryNetwork {
  private core: RelayCore;
  private clock: number;
  private latency: number;
  private seq = 0;
  private inflight = 0;
  private notice: Notice | null = null;
  private readonly links = new Map<MemoryClient, Link>();
  private readonly byConn = new Map<string, Link>();
  private readonly deps: RelayDeps;
  private readonly config: Partial<RelayConfig>;

  constructor(opts: MemoryNetworkOptions = {}) {
    this.clock = opts.startTime ?? Date.now();
    this.latency = opts.latencyMs ?? 0;
    this.config = opts.config ?? {};
    this.deps = {
      now: () => this.clock,
      ...(opts.randomInt ? { randomInt: opts.randomInt } : {}),
      ...(opts.randomToken ? { randomToken: opts.randomToken } : {}),
      send: (connId, data) => {
        const link = this.byConn.get(connId);
        if (!link) return;
        const gen = link.gen;
        this.schedule(() => {
          if (link.gen === gen && (link.connId !== null || link.serverClosed)) link.client.receive(data);
        });
      },
      close: (connId) => {
        const link = this.byConn.get(connId);
        if (!link) return;
        this.byConn.delete(connId);
        link.connId = null;
        link.serverClosed = true;
        const gen = link.gen;
        this.schedule(() => {
          if (link.gen === gen && link.serverClosed) {
            link.serverClosed = false;
            link.droppedByServer = true;
            link.client.connectionLost(false);
          }
        });
      },
    };
    this.core = createRelayCore(this.config, this.deps);
  }

  /** 가상 시계(ms) */
  now(): number {
    return this.clock;
  }

  createHost(opts: MemoryClientOptions = {}): MemoryHost {
    const h = new MemoryHost(this);
    this.attach(h, opts);
    return h;
  }

  createPeer(opts: MemoryClientOptions = {}): MemoryPeer {
    const p = new MemoryPeer(this);
    this.attach(p, opts);
    return p;
  }

  /** 한 방향 전달 지연(ms) */
  setLatency(ms: number): void {
    this.latency = Math.max(0, ms);
  }

  /** 네트워크 끊김 흉내: 서버는 끊김을 보고, 클라이언트는 'offline' */
  disconnect(client: MemoryClient): void {
    const link = this.links.get(client);
    if (!link || link.connId === null) return;
    const id = link.connId;
    this.byConn.delete(id);
    link.connId = null;
    link.serverClosed = false;
    this.core.onDisconnect(id);
    client.connectionLost(false);
  }

  /** (105) 서버가 끊은 연결이면 다시 붙인다(네트워크 끊김 흉내·leave는 그대로). 다시 붙였으면 true */
  reconnectIfServerClosed(client: MemoryClient): boolean {
    const link = this.links.get(client);
    if (!link || !link.droppedByServer || link.closed || link.connId !== null) return false;
    this.connect(link);
    return true;
  }

  /**
   * (작업 145) 테스트 도구: leave()로 닫은 연결을 다시 연다 — RelayPeer(ready)·LocalPeer(restart)가 leave 뒤 다음 join에서
   * 다시 연결하는 것을 흉내 낼 때(tests/student/helpers.ts). MemoryPeer.join 자체는 leave 뒤 다시 붙지 않는다(기존 계약). 다시 열었으면 true
   */
  reopenAfterLeave(client: MemoryClient): boolean {
    const link = this.links.get(client);
    if (!link || !link.closed || link.connId !== null) return false;
    link.closed = false;
    this.connect(link);
    return true;
  }

  /** 다시 연결(새 연결 — 방에는 세션 계층이 다시 들어가야 함) */
  reconnect(client: MemoryClient): void {
    const link = this.links.get(client);
    if (!link || link.closed || link.connId !== null) return;
    this.connect(link);
  }

  /** 서버 재시작 흉내: 모든 방이 사라지고 클라이언트는 자동으로 다시 붙는다(새 연결) */
  restartServer(): void {
    this.core.announceRestart();
    const live = [...this.links.values()].filter((l) => l.connId !== null);
    for (const l of live) {
      this.byConn.delete(l.connId as string);
      l.connId = null;
      l.serverClosed = false;
      l.client.connectionLost(true);
    }
    this.core = createRelayCore(this.config, this.deps);
    if (this.notice) this.core.setNotice(this.notice);
    for (const l of live) this.connect(l);
  }

  /** 가상 시계를 앞으로 돌리고 `sweep()` 후 전달 대기 메시지를 비운다 */
  async advanceTime(ms: number): Promise<void> {
    this.clock += ms;
    this.core.sweep();
    await this.flush();
  }

  /** 서버 공지 설정(테스트 도구) */
  setNotice(n: Notice | null): void {
    this.notice = n;
    this.core.setNotice(n);
  }

  stats(): RelayStats {
    return this.core.stats();
  }

  /** 전달 중인 메시지가 모두 도착할 때까지 기다린다 */
  async flush(): Promise<void> {
    for (let i = 0; i < 10000 && this.inflight > 0; i++) {
      await new Promise<void>((r) => setTimeout(r, this.latency > 0 ? this.latency : 0));
    }
  }

  // ── 내부 ──
  /** @internal 클라이언트 → 서버 */
  clientSend(client: MemoryClient, data: string): void {
    const link = this.links.get(client);
    if (!link || link.connId === null) return;
    const id = link.connId;
    this.schedule(() => {
      if (link.connId === id) this.core.onMessage(id, data);
    });
  }

  /** @internal leave() */
  clientClose(client: MemoryClient): void {
    const link = this.links.get(client);
    if (!link) return;
    this.disconnect(client);
    link.closed = true;
  }

  private attach(client: MemoryClient, opts: MemoryClientOptions) {
    const link: Link = { client, connId: null, ip: opts.ip ?? '10.0.0.1', closed: false, gen: 0, serverClosed: false };
    this.links.set(client, link);
    this.connect(link);
  }

  private connect(link: Link) {
    const id = `m${++this.seq}`;
    link.gen++;
    link.serverClosed = false;
    link.droppedByServer = false;
    link.connId = id;
    this.byConn.set(id, link);
    // 클라이언트를 먼저 online으로(서버가 보내는 첫 공지를 받을 수 있게) — 전달은 비동기라 순서가 맞다
    link.client.connectionOpened();
    // 상한으로 거절되면 relay-core가 deps.close를 불러 클라이언트가 'offline'이 된다
    this.core.onConnect(id, { ip: link.ip, origin: 'memory' });
  }

  private schedule(fn: () => void) {
    this.inflight++;
    const run = () => {
      this.inflight--;
      fn();
    };
    if (this.latency > 0) setTimeout(run, this.latency);
    else queueMicrotask(run);
  }
}

export class MemoryHost extends HostBase {
  readonly kind: TransportKind = 'memory';
  constructor(private readonly net: MemoryNetwork) {
    super(() => net.now());
  }
  protected sendRaw(data: string): void {
    this.net.clientSend(this, data);
  }
  protected closeWire(): void {
    this.net.clientClose(this);
  }
  /** 호스트 연결을 영구히 닫는다 */
  close(): void {
    this.closeWire();
  }
}

export class MemoryPeer extends PeerBase {
  readonly kind: TransportKind = 'memory';
  constructor(private readonly net: MemoryNetwork) {
    super(() => net.now());
  }
  protected sendRaw(data: string): void {
    this.net.clientSend(this, data);
  }
  protected closeWire(): void {
    this.net.clientClose(this);
  }
  /** (105) 서버가 끊은 뒤(방 밖 30초 정리 등) 다시 [입장]하면 새 연결로 다시 붙어 보낸다 — RelayPeer와 같은 의미 */
  override join(code: string, hello: PeerHello): Promise<JoinResult> {
    if (this.getStatus() === 'offline') this.net.reconnectIfServerClosed(this);
    return super.join(code, hello);
  }
}
