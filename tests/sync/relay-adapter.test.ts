/**
 * RelayAdapter(src/sync/relay.ts) + 실제 중계 서버 — 104 transport 시나리오 축소판(호스트 1 + 학생 3, 끊김·재연결,
 * 서버 재시작 뒤 같은 코드). Node에서는 `ws` 클라이언트를 createSocket으로 넣는다(Origin 헤더).
 */
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { JsonObject, PeerRoomEvent } from '../../src/sync/adapter';
import {
  RelayHost,
  RelayLink,
  RelayPeer,
  createRelayHost,
  createRelayPeer,
  relayHttpUrl,
  restoreHostRoom,
  type RelayOptions,
  type WebSocketLike,
} from '../../src/sync/relay';
import { loadRelayModule } from '../../src/sync/select';
import { TEST_ORIGIN, sleep, startTestServer, type TestServer } from '../server/relay-helpers';

let cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.reverse()) await c();
  cleanups = [];
});

async function until(cond: () => boolean, ms = 5000, what = '조건') {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`${what}을 기다리다 시간 초과`);
    await sleep(10);
  }
}

function wsFactory(origin = TEST_ORIGIN) {
  const sockets: WebSocket[] = [];
  const createSocket = (url: string) => {
    const ws = new WebSocket(url, { origin });
    ws.on('error', () => {});
    sockets.push(ws);
    return ws as unknown as WebSocketLike;
  };
  return { sockets, createSocket, last: () => sockets[sockets.length - 1]! };
}

const fast: RelayOptions = { backoffBaseMs: 40, backoffMaxMs: 200, connectWaitMs: 4000 };

function recordPeer(p: RelayPeer) {
  const msgs: JsonObject[] = [];
  const events: PeerRoomEvent[] = [];
  const hostStatus: boolean[] = [];
  const statuses: string[] = [];
  p.onMessage((m) => msgs.push(m));
  p.onRoomEvent((e) => events.push(e));
  p.onHostStatus((o) => hostStatus.push(o));
  p.onStatus((s) => statuses.push(s));
  return { msgs, events, hostStatus, statuses };
}

describe('RelayAdapter + 실제 서버', () => {
  it('호스트 1 + 학생 3: 입장 → 전체·개인·학생 메시지 → 학생 끊김·재입장 → 호스트 끊김·resume → 서버 재시작 뒤 같은 코드', async () => {
    let s: TestServer = await startTestServer({}, { shutdownGraceMs: 150 });
    cleanups.push(() => s.stop());
    const port = s.port;

    const hf = wsFactory();
    const host = createRelayHost(s.url, { ...fast, createSocket: hf.createSocket });
    cleanups.push(() => host.dispose());
    const hellos: string[] = [];
    host.onPeerHello((peerId, hello) => {
      hellos.push(String(hello.company));
      host.admit(peerId);
    });
    const fromPeers: JsonObject[] = [];
    host.onPeerMessage((_id, m) => fromPeers.push(m));
    const left: string[] = [];
    host.onPeerLeave((id) => left.push(id));

    const opened = await host.openRoom({ maxPeers: 40 });
    if (typeof opened === 'string') throw new Error(opened);
    expect(opened.code).toMatch(/^\d{6}$/);
    expect(host.getStatus()).toBe('online');
    expect(Math.abs(host.serverNow() - Date.now())).toBeLessThan(100);

    const pfs = [wsFactory(), wsFactory(), wsFactory()];
    const peers = pfs.map((f) => createRelayPeer(s.url, { ...fast, createSocket: f.createSocket }));
    for (const p of peers) cleanups.push(() => p.dispose());
    const recs = peers.map(recordPeer);
    const joined = await Promise.all(peers.map((p, i) => p.join(opened.code, { seat: i + 1, company: `회사${i + 1}` })));
    expect(joined).toEqual(['pending', 'pending', 'pending']);
    await until(() => recs.every((r) => r.events.some((e) => e.type === 'admitted')), 3000, '입장 허락');
    expect(host.connectedPeers()).toHaveLength(3);
    expect(hellos.sort()).toEqual(['회사1', '회사2', '회사3']);

    host.broadcast({ kind: 'public', round: 1 });
    await until(() => recs.every((r) => r.msgs.length === 1));
    peers[1]!.send({ act: 'buy' });
    await until(() => fromPeers.length === 1);
    expect(fromPeers[0]).toEqual({ act: 'buy' });
    expect(await host.queryStats()).toEqual({ rooms: 1, maxRooms: 50 });

    // ── 학생 0 끊김(네트워크) → 어댑터가 다시 붙음 → 세션처럼 다시 join ──
    pfs[0]!.last().terminate();
    await until(() => recs[0]!.statuses.includes('reconnecting'));
    await until(() => peers[0]!.getStatus() === 'online', 3000, '학생 재연결');
    await until(() => left.length === 1, 3000, 'peer.left');
    expect(await peers[0]!.join(opened.code, { seat: 1, company: '회사1' })).toBe('pending');
    await until(() => recs[0]!.events.filter((e) => e.type === 'admitted').length === 2);
    expect(host.connectedPeers()).toHaveLength(3);

    // ── 호스트 끊김 → 학생들은 host.status false → 호스트 다시 붙어 resume → true ──
    hf.last().terminate();
    await until(() => recs[1]!.hostStatus.includes(false), 3000, 'host.status false');
    await until(() => host.getStatus() === 'online', 3000, '호스트 재연결');
    expect(host.roomCode()).toBeNull(); // 어댑터는 스스로 방에 다시 들어가지 않는다(세션 몫)
    expect(await host.resumeRoom(opened.code, opened.hostToken)).toBe('ok');
    expect(host.roomCode()).toBe(opened.code);
    expect(host.connectedPeers()).toHaveLength(3);
    await until(() => recs[1]!.hostStatus.at(-1) === true);

    // ── 서버 재시작(SIGTERM 흉내): server.restarting → 재연결 중 → 새 서버(같은 포트) → 같은 코드로 다시 열기 ──
    const hostStatuses: string[] = [];
    host.onStatus((st) => hostStatuses.push(st));
    await s.server.shutdown();
    await s.stop();
    expect(hostStatuses).toContain('reconnecting');
    s = await startTestServer({}, { shutdownGraceMs: 150 }, { port });
    cleanups.push(() => s.stop());
    await until(() => host.getStatus() === 'online' && peers.every((p) => p.getStatus() === 'online'), 8000, '재시작 뒤 재연결');
    const restored = await restoreHostRoom(host, { code: opened.code, hostToken: opened.hostToken, maxPeers: 40 });
    expect(restored).toEqual({ kind: 'reopened', code: opened.code, hostToken: opened.hostToken });
    const again = await Promise.all(peers.map((p, i) => p.join(opened.code, { seat: i + 1, company: `회사${i + 1}` })));
    expect(again).toEqual(['pending', 'pending', 'pending']);
    await until(() => host.connectedPeers().length === 3, 3000, '재시작 뒤 입장');
    host.broadcast({ kind: 'public', round: 2 });
    await until(() => recs.every((r) => r.msgs.some((m) => m.round === 2)));
  }, 30_000);

  it('잘못된 출처: ORIGIN 연결 오류를 알리고 스스로 다시 붙지 않는다', async () => {
    const s = await startTestServer();
    cleanups.push(() => s.stop());
    const f = wsFactory('https://evil.example');
    const host = new RelayHost(s.url, { ...fast, createSocket: f.createSocket });
    cleanups.push(() => host.dispose());
    const errs: string[] = [];
    host.onConnectionError((e) => errs.push(`${e.code}:${e.message}`));
    await until(() => errs.length > 0);
    await sleep(400);
    expect(errs).toEqual(['ORIGIN:허용되지 않은 주소에서 접속했어요.']);
    expect(host.getStatus()).toBe('offline');
    expect(f.sockets).toHaveLength(1);
  });

  it('없는 코드·잘못된 요청은 서버 오류 코드로, 끊긴 뒤 요청은 다시 연결해서 보낸다', async () => {
    const s = await startTestServer({ UNJOINED_TIMEOUT: '1' }, { sweepMs: 100 });
    cleanups.push(() => s.stop());
    const f = wsFactory();
    const peer = new RelayPeer(s.url, { ...fast, createSocket: f.createSocket });
    cleanups.push(() => peer.dispose());
    expect(await peer.join('123456', { seat: 1 })).toBe('NO_ROOM');
    expect(peer.lastError()).toMatchObject({ code: 'NO_ROOM', req: 'peer.join' });
    // 방 밖에서 1초 지나면 서버가 끊음(UNJOINED_TIMEOUT 4003) → 스스로 다시 붙지 않음
    await until(() => peer.getStatus() === 'offline', 4000, 'UNJOINED_TIMEOUT');
    expect(peer.connectionError()?.code).toBe('UNJOINED_TIMEOUT');
    const n = f.sockets.length;
    await sleep(300);
    expect(f.sockets.length).toBe(n);
    // 다음 요청이 다시 연다
    expect(await peer.join('123456', { seat: 1 })).toBe('NO_ROOM');
    expect(f.sockets.length).toBe(n + 1);
  });

  it('select.ts가 relay 모듈을 찾는다', async () => {
    const mod = await loadRelayModule();
    expect(mod).not.toBeNull();
    expect(typeof mod!.createRelayHost).toBe('function');
    expect(typeof mod!.createRelayPeer).toBe('function');
    expect(relayHttpUrl('wss://lab.ches.es.kr/voyage/ws', 'health')).toBe('https://lab.ches.es.kr/voyage/health');
    expect(relayHttpUrl('ws://127.0.0.1:8787/ws', 'notice')).toBe('http://127.0.0.1:8787/notice');
  });
});

// ───────────────────── 가짜 소켓: 재연결 대기·요청 id ─────────────────────

class FakeSocket implements WebSocketLike {
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  send(data: string) {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  deliver(m: object) {
    this.onmessage?.({ data: JSON.stringify({ v: 3, ...m }) });
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code, reason: '' });
  }
}

function fakeFactory() {
  const sockets: FakeSocket[] = [];
  return {
    sockets,
    createSocket: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
  };
}

describe('RelayAdapter — 재연결 대기·요청 id', () => {
  it('재연결 대기: 1·2·4·8·15·15초(±20%)', () => {
    const lo = new RelayLink('ws://x/ws', { opened() {}, data() {}, lost() {}, connecting() {} }, { random: () => 0 });
    const hi = new RelayLink('ws://x/ws', { opened() {}, data() {}, lost() {}, connecting() {} }, { random: () => 0.999999 });
    const base = [1000, 2000, 4000, 8000, 15000, 15000, 15000];
    base.forEach((b, i) => {
      expect(lo.backoffDelay(i)).toBe(Math.round(b * 0.8));
      expect(hi.backoffDelay(i)).toBeGreaterThan(b * 1.19);
      expect(hi.backoffDelay(i)).toBeLessThanOrEqual(b * 1.2);
    });
  });

  it('끊기면 대기 뒤 다시 연결하고, 오래 버틴 연결 뒤에는 대기를 처음부터', async () => {
    const f = fakeFactory();
    const peer = new RelayPeer('ws://x/ws', { createSocket: f.createSocket, backoffBaseMs: 20, backoffMaxMs: 80, jitter: 0 });
    cleanups.push(() => peer.dispose());
    f.sockets[0]!.open();
    expect(peer.getStatus()).toBe('online');
    f.sockets[0]!.drop();
    expect(peer.getStatus()).toBe('reconnecting');
    await until(() => f.sockets.length === 2, 1000);
    f.sockets[1]!.drop(); // 열리지 못함 → 다음은 40ms
    const t0 = Date.now();
    await until(() => f.sockets.length === 3, 1000);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(30);
    f.sockets[2]!.open();
    expect(peer.getStatus()).toBe('online');
  });

  it('server.restarting을 받으면 곧바로 끊고 다시 연결 절차', async () => {
    const f = fakeFactory();
    const host = new RelayHost('ws://x/ws', { createSocket: f.createSocket, backoffBaseMs: 20, jitter: 0 });
    cleanups.push(() => host.dispose());
    f.sockets[0]!.open();
    f.sockets[0]!.deliver({ t: 'server.restarting' });
    await until(() => host.getStatus() === 'reconnecting', 500);
    await until(() => f.sockets.length === 2, 500);
  });

  it('응답은 요청 id로 짝짓는다 — 시간 초과 뒤 늦게 온 room.opened는 다른 요청에 붙지 않고 닫는다', async () => {
    const f = fakeFactory();
    const host = new RelayHost('ws://x/ws', { createSocket: f.createSocket, requestTimeoutMs: 60 });
    cleanups.push(() => host.dispose());
    const sock = f.sockets[0]!;
    sock.open();
    const first = await host.openRoom({ maxPeers: 30 });
    expect(first).toBe('TIMEOUT');
    const rid1 = sock.sent.find((m) => m.t === 'host.open')!.rid as string;
    expect(rid1).toBeTruthy();

    host.requestTimeoutMs = 2000;
    const second = host.openRoom({ maxPeers: 30 });
    await until(() => sock.sent.filter((m) => m.t === 'host.open').length === 2);
    const rid2 = sock.sent.filter((m) => m.t === 'host.open')[1]!.rid as string;
    expect(rid2).not.toBe(rid1);
    // 첫 요청의 늦은 응답 → 두 번째 요청에 붙지 않고, 아무도 모르는 방이 남지 않게 host.close
    sock.deliver({ t: 'room.opened', code: '111111', hostToken: 'a'.repeat(32), rid: rid1 });
    expect(host.roomCode()).toBeNull();
    expect(sock.sent.at(-1)).toMatchObject({ t: 'host.close' });
    sock.deliver({ t: 'room.opened', code: '222222', hostToken: 'b'.repeat(32), rid: rid2 });
    expect(await second).toEqual({ code: '222222', hostToken: 'b'.repeat(32) });
    expect(host.roomCode()).toBe('222222');
  });

  it('서버 시각: ping 3번 중 왕복 최소값으로 오프셋', async () => {
    const f = fakeFactory();
    let now = 1000;
    const peer = new RelayPeer('ws://x/ws', { createSocket: f.createSocket, clock: () => now });
    cleanups.push(() => peer.dispose());
    const sock = f.sockets[0]!;
    sock.open(); // ping 1 at 1000
    const pings = () => sock.sent.filter((m) => m.t === 'ping');
    expect(pings()).toHaveLength(1);
    now = 1400; // 왕복 400, 서버 시각 = 내 시각 + 5000
    sock.deliver({ t: 'pong', at: 1000, serverNow: 1200 + 5000 });
    expect(pings()).toHaveLength(2);
    now = 1450; // 왕복 50
    sock.deliver({ t: 'pong', at: 1400, serverNow: 1425 + 5000 });
    now = 1700; // 왕복 250
    sock.deliver({ t: 'pong', at: 1450, serverNow: 1575 + 5000 });
    expect(pings()).toHaveLength(3);
    expect(peer.serverNow() - now).toBe(5000);
    expect(peer.link.lastRtt).toBe(50);
  });
});
