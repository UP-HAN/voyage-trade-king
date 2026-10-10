import { afterEach, describe, expect, it } from 'vitest';
import type { JsonObject } from '../../src/sync/adapter';
import { createLocalHost, createLocalPeer, localDeviceToken, type LocalHost, type LocalPeer } from '../../src/sync/local';
import { createHostTransport, createPeerTransport, localOptionsFromHref, loadRelayModule } from '../../src/sync/select';

// Node 24의 BroadcastChannel은 같은 이름의 다른 객체에 메시지를 전달한다 — 탭 2개를 객체 2개로 흉내.
const open: { close?: () => void; leave?: () => void }[] = [];
afterEach(() => {
  for (const c of open.splice(0)) (c.close ?? c.leave)?.call(c);
});

let n = 0;
const uniqueChannel = () => `voyage-local-test-${process.pid}-${++n}`;

function waitFor(cond: () => boolean, ms = 1000): Promise<void> {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (cond()) return resolve();
      if (Date.now() - t0 > ms) return reject(new Error('시간 초과'));
      setTimeout(tick, 5);
    };
    tick();
  });
}

describe('LocalAdapter (BroadcastChannel 탭 2개)', () => {
  it('호스트 탭과 학생 탭이 1초 안에 메시지를 주고받는다(지연 50ms 흉내)', async () => {
    const channelName = uniqueChannel();
    const host: LocalHost = await createLocalHost({ channelName, latencyMs: true });
    open.push(host);
    expect(host.getStatus()).toBe('online');
    host.onPeerHello((id) => host.admit(id));
    const fromPeer: JsonObject[] = [];
    host.onPeerMessage((_id, m) => fromPeer.push(m));

    const opened = await host.openRoom({ maxPeers: 40 });
    if (typeof opened === 'string') throw new Error(opened);

    const peer: LocalPeer = await createLocalPeer({ channelName, latencyMs: true, as: 's07' });
    open.push(peer);
    expect(peer.getStatus()).toBe('online');
    const toPeer: JsonObject[] = [];
    peer.onMessage((m) => toPeer.push(m));

    const t0 = Date.now();
    expect(await peer.join(opened.code, { seat: 7, company: '해오름무역' })).toBe('pending');
    await waitFor(() => peer.isAdmitted());
    host.broadcast({ kind: 'public', hi: 1 });
    peer.send({ act: 'ping-host' });
    await waitFor(() => toPeer.length > 0 && fromPeer.length > 0);
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(1000);
    expect(elapsed).toBeGreaterThanOrEqual(150); // 50ms 지연이 실제로 들어갔다
    expect(toPeer).toEqual([{ kind: 'public', hi: 1 }]);
    expect(fromPeer).toEqual([{ act: 'ping-host' }]);
    expect(host.serverStats()).toMatchObject({ rooms: 1, peers: 1, conns: 2 });
  });

  it('서버 탭이 없으면 학생은 reconnecting, 서버 탭이 닫히면 학생이 알게 된다', async () => {
    const channelName = uniqueChannel();
    const lonely = await createLocalPeer({ channelName });
    open.push(lonely);
    expect(lonely.getStatus()).toBe('reconnecting');
    expect(await lonely.join('123456', {})).toBe('OFFLINE');

    const host = await createLocalHost({ channelName });
    await waitFor(() => lonely.getStatus() === 'online', 2000);
    host.close();
    await waitFor(() => lonely.getStatus() === 'reconnecting');
  });

  it('두 번째 호스트 탭은 첫 서버 탭에 붙는다(방 2개가 한 서버에)', async () => {
    const channelName = uniqueChannel();
    const a = await createLocalHost({ channelName });
    const b = await createLocalHost({ channelName });
    open.push(b, a);
    await a.openRoom({ maxPeers: 10 });
    await b.openRoom({ maxPeers: 10 });
    expect(a.serverStats()?.rooms).toBe(2);
    expect(b.serverStats()).toBeNull();
  });

  it('?as=s07 기기 토큰은 sessionStorage 키별로 고정', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    const t1 = localDeviceToken('s07', storage);
    expect(t1).toMatch(/^[0-9a-f]{32}$/);
    expect(localDeviceToken('s07', storage)).toBe(t1);
    expect(localDeviceToken('s08', storage)).not.toBe(t1);
    expect(localDeviceToken(null, storage)).toBeNull();
  });
});

describe('select.ts', () => {
  it('URL에서 local 옵션 읽기', () => {
    expect(localOptionsFromHref('http://x/?sync=local&lag=50&as=s07')).toEqual({ latencyMs: 50, as: 's07' });
    expect(localOptionsFromHref('http://x/#/play?as=s03')).toEqual({ as: 's03' });
  });

  it('relay 모듈을 불러오지 못하면 null, 기본으로는 작업 105의 relay.ts를 찾는다', async () => {
    expect(await loadRelayModule(async () => Promise.reject(new Error('없음')))).toBeNull();
    const mod = await loadRelayModule();
    expect(typeof mod?.createRelayHost).toBe('function');
  });

  it('?sync=memory → memory, relay를 못 불러오면 → local로 대체', async () => {
    const mh = await createHostTransport({ href: 'http://x/?sync=memory' });
    const mp = await createPeerTransport({ href: 'http://x/?sync=memory' });
    expect(mh.kind).toBe('memory');
    expect(mp.kind).toBe('memory');
    const opened = await mh.openRoom({ maxPeers: 5 });
    if (typeof opened === 'string') throw new Error(opened);
    expect(await mp.join(opened.code, {})).toBe('pending');
    mp.leave();

    const channelName = uniqueChannel();
    const rh = await createHostTransport({
      href: 'http://x/?sync=relay',
      relayLoader: async () => Promise.reject(new Error('relay 없음')),
      local: { channelName },
    });
    open.push(rh as LocalHost);
    expect(rh.kind).toBe('local');
  });

  it('relay 모듈이 있으면 그것을 쓴다', async () => {
    const fake = { kind: 'relay' } as never;
    const h = await createHostTransport({
      href: 'http://lab.example/voyage/?sync=relay&relay=wss://r.example/ws',
      relayLoader: async () => ({ createRelayHost: (url: string) => ({ ...(fake as object), url }) as never, createRelayPeer: () => fake }),
    });
    expect(h).toMatchObject({ kind: 'relay', url: 'wss://r.example/ws' });
  });
});
