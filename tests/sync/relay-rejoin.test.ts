/**
 * (105, 오케스트레이터 결정 3) 서버가 방 밖 학생 연결을 끊은 뒤(UNJOINED_TIMEOUT) 학생이 다시 [입장]하면
 * 어댑터가 스스로 다시 연결한 뒤 join한다 — relay·memory·local 세 어댑터가 같은 의미.
 */
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createLocalHost, createLocalPeer, type LocalHost, type LocalPeer } from '../../src/sync/local';
import { MemoryNetwork } from '../../src/sync/memory';
import { RelayPeer, createRelayHost, type WebSocketLike } from '../../src/sync/relay';
import { TEST_ORIGIN, sleep, startTestServer } from '../server/relay-helpers';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

async function until(cond: () => boolean, ms = 5000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('시간 초과');
    await sleep(10);
  }
}

describe('거절·실패 뒤 끊긴 학생 연결로 다시 입장', () => {
  it('relay: 거절 → 서버가 방 밖 연결을 끊음 → 다시 join하면 새 연결로 pending', async () => {
    const s = await startTestServer({ UNJOINED_TIMEOUT: '1' }, { sweepMs: 100 });
    cleanups.push(() => s.stop());
    const createSocket = (url: string) => {
      const ws = new WebSocket(url, { origin: TEST_ORIGIN });
      ws.on('error', () => {});
      return ws as unknown as WebSocketLike;
    };
    const host = createRelayHost(s.url, { createSocket });
    cleanups.push(() => host.dispose());
    let first = true;
    host.onPeerHello((id) => {
      if (first) host.reject(id, 'NAME_TAKEN');
      else host.admit(id);
      first = false;
    });
    const opened = await host.openRoom({ maxPeers: 30 });
    if (typeof opened === 'string') throw new Error(opened);
    const peer = new RelayPeer(s.url, { createSocket, backoffBaseMs: 50 });
    cleanups.push(() => peer.dispose());
    const events: string[] = [];
    peer.onRoomEvent((e) => events.push(e.type));
    expect(await peer.join(opened.code, { seat: 1, company: '갑' })).toBe('pending');
    await until(() => events.includes('rejected'));
    await until(() => peer.getStatus() === 'offline', 4000); // 방 밖 1초 → 서버가 끊음(4003)
    expect(await peer.join(opened.code, { seat: 1, company: '을' })).toBe('pending');
    await until(() => events.includes('admitted'));
  });

  it('memory: 방 밖 정리로 끊긴 뒤 join하면 다시 붙어 pending', async () => {
    const net = new MemoryNetwork({ config: { unjoinedTimeout: 30 } });
    const host = net.createHost();
    host.onPeerHello((id) => host.admit(id));
    const opened = await host.openRoom({ maxPeers: 30 });
    if (typeof opened === 'string') throw new Error(opened);
    const peer = net.createPeer();
    expect(await peer.join('999999', {})).toBe('NO_ROOM');
    await net.advanceTime(31_000);
    expect(peer.getStatus()).toBe('offline');
    expect(await peer.join(opened.code, {})).toBe('pending');
    await net.flush();
    expect(peer.isAdmitted()).toBe(true);
    // leave()로 스스로 나간 뒤에는 다시 붙지 않는다
    peer.leave();
    expect(await peer.join(opened.code, {})).toBe('OFFLINE');
  });

  it('local: 서버 탭이 끊은 뒤 join하면 서버 탭을 다시 찾아 pending', async () => {
    const channelName = `voyage-rejoin-${process.pid}-${Date.now()}`;
    const host: LocalHost = await createLocalHost({ channelName, config: { unjoinedTimeout: 1 } });
    cleanups.push(() => host.close());
    host.onPeerHello((id) => host.admit(id));
    const opened = await host.openRoom({ maxPeers: 30 });
    if (typeof opened === 'string') throw new Error(opened);
    const peer: LocalPeer = await createLocalPeer({ channelName });
    cleanups.push(() => peer.leave());
    expect(await peer.join('999999', {})).toBe('NO_ROOM');
    await until(() => peer.getStatus() === 'offline', 5000);
    expect(await peer.join(opened.code, {})).toBe('pending');
    await until(() => peer.isAdmitted(), 2000);
  });
});
