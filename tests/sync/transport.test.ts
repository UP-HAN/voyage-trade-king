import { describe, expect, it } from 'vitest';
import type { JsonObject, PeerRoomEvent } from '../../src/sync/adapter';
import { MemoryNetwork, type MemoryHost, type MemoryPeer } from '../../src/sync/memory';

/** 학생 입장 + 호스트가 받은 hello마다 admit */
function autoAdmit(host: MemoryHost) {
  const hellos: { peerId: string; seat: unknown }[] = [];
  host.onPeerHello((peerId, hello) => {
    hellos.push({ peerId, seat: hello.seat });
    host.admit(peerId);
  });
  return hellos;
}

function record(peer: MemoryPeer) {
  const msgs: JsonObject[] = [];
  const events: PeerRoomEvent[] = [];
  const hostStatus: boolean[] = [];
  peer.onMessage((m) => msgs.push(m));
  peer.onRoomEvent((e) => events.push(e));
  peer.onHostStatus((o) => hostStatus.push(o));
  return { msgs, events, hostStatus };
}

describe('MemoryNetwork — 호스트 1 + 학생 30', () => {
  it('입장 → 브로드캐스트 → 학생 메시지 → 끊김·재연결 → 서버 재시작 뒤 같은 코드로 다시 열기', async () => {
    const net = new MemoryNetwork();
    const host = net.createHost({ ip: '1.1.1.1' });
    const hellos = autoAdmit(host);
    const fromPeers: { peerId: string; msg: JsonObject }[] = [];
    host.onPeerMessage((peerId, msg) => fromPeers.push({ peerId, msg }));
    const left: string[] = [];
    host.onPeerLeave((id) => left.push(id));

    const opened = await host.openRoom({ maxPeers: 40 });
    if (typeof opened === 'string') throw new Error(opened);
    expect(opened.code).toMatch(/^\d{6}$/);
    expect(host.roomCode()).toBe(opened.code);

    // 30명 입장
    const peers = Array.from({ length: 30 }, () => net.createPeer({ ip: '2.2.2.2' }));
    const recs = peers.map(record);
    const results = await Promise.all(peers.map((p, i) => p.join(opened.code, { seat: i + 1, company: `회사${i + 1}` })));
    expect(results.every((r) => r === 'pending')).toBe(true);
    await net.flush();
    expect(hellos).toHaveLength(30);
    expect(recs.every((r) => r.events.some((e) => e.type === 'admitted'))).toBe(true);
    expect(host.connectedPeers()).toHaveLength(30);
    expect(net.stats()).toMatchObject({ rooms: 1, peers: 30, conns: 31 });

    // 브로드캐스트 1번 → 30명
    host.broadcast({ kind: 'public', round: 1 });
    await net.flush();
    for (const r of recs) expect(r.msgs).toEqual([{ kind: 'public', round: 1 }]);

    // 개인 메시지는 그 학생에게만
    const target = hellos[4]!.peerId;
    host.sendTo(target, { kind: 'private', cash: 500 });
    await net.flush();
    const got = recs.filter((r) => r.msgs.some((m) => m.kind === 'private'));
    expect(got).toHaveLength(1);

    // 학생 메시지는 호스트에게만(다른 학생은 받지 않음)
    peers[0]!.send({ act: 'buy', seq: 1 });
    await net.flush();
    expect(fromPeers).toEqual([{ peerId: peers[0]!.currentPeerId(), msg: { act: 'buy', seq: 1 } }]);
    expect(recs[1]!.msgs).toHaveLength(1);

    // 학생 끊김 → 호스트에 peer.left, 재연결 → 다시 join(새 peerId) → admit
    const oldId = peers[3]!.currentPeerId();
    net.disconnect(peers[3]!);
    expect(peers[3]!.getStatus()).toBe('offline');
    await net.flush();
    expect(left).toEqual([oldId]);
    net.reconnect(peers[3]!);
    expect(peers[3]!.getStatus()).toBe('online');
    expect(await peers[3]!.join(opened.code, { seat: 4 })).toBe('pending');
    await net.flush();
    expect(peers[3]!.isAdmitted()).toBe(true);
    expect(peers[3]!.currentPeerId()).not.toBe(oldId);
    expect(host.connectedPeers()).toHaveLength(30);

    // 호스트 끊김 → 학생에게 host.status false, 호스트가 resume → true
    net.disconnect(host);
    await net.flush();
    expect(recs[0]!.hostStatus).toEqual([false]);
    net.reconnect(host);
    expect(await host.resumeRoom(opened.code, opened.hostToken)).toBe('ok');
    await net.flush();
    expect(recs[0]!.hostStatus).toEqual([false, true]);
    expect(host.connectedPeers()).toHaveLength(30);

    // 서버 재시작: 방이 사라지고 모두 자동 재연결(새 연결)
    const statuses: string[] = [];
    host.onStatus((s) => statuses.push(s));
    net.restartServer();
    expect(statuses).toEqual(['reconnecting', 'online']);
    expect(net.stats().rooms).toBe(0);
    expect(await host.resumeRoom(opened.code, opened.hostToken)).toBe('NO_ROOM');
    const reopened = await host.openRoom({ maxPeers: 40, wantCode: opened.code, hostToken: opened.hostToken });
    expect(reopened).toEqual({ code: opened.code, hostToken: opened.hostToken });
    hellos.length = 0;
    const again = await Promise.all(peers.map((p, i) => p.join(opened.code, { seat: i + 1 })));
    expect(again.every((r) => r === 'pending')).toBe(true);
    await net.flush();
    expect(hellos).toHaveLength(30);
    expect(peers.every((p) => p.isAdmitted())).toBe(true);
    host.broadcast({ kind: 'public', round: 2 });
    await net.flush();
    for (const r of recs) expect(r.msgs.at(-1)).toEqual({ kind: 'public', round: 2 });
  });
});

describe('MemoryNetwork — 오류·도구', () => {
  it('없는 방 NO_ROOM, 잠금 LOCKED, reject·kick 사건, 방 닫힘', async () => {
    const net = new MemoryNetwork();
    const host = net.createHost();
    const opened = await host.openRoom({ maxPeers: 5 });
    if (typeof opened === 'string') throw new Error(opened);
    const code = opened.code === '999999' ? '999998' : '999999';
    const p = net.createPeer();
    const rec = record(p);
    expect(await p.join(code, {})).toBe('NO_ROOM');

    host.onPeerHello((peerId, hello) => (hello.company === '나쁜' ? host.reject(peerId, 'BAD_NAME') : host.admit(peerId)));
    expect(await p.join(opened.code, { company: '나쁜' })).toBe('pending');
    await net.flush();
    expect(rec.events).toEqual([{ type: 'rejected', reason: 'BAD_NAME' }]);
    expect(await p.join(opened.code, { company: '좋은' })).toBe('pending');
    await net.flush();
    expect(rec.events.at(-1)).toMatchObject({ type: 'admitted' });

    host.setLocked(true);
    await net.flush();
    const q = net.createPeer();
    expect(await q.join(opened.code, {})).toBe('LOCKED');

    host.kick(p.currentPeerId()!);
    await net.flush();
    expect(rec.events.at(-1)).toEqual({ type: 'kicked' });
    expect(p.getStatus()).toBe('offline');

    const closedReasons: string[] = [];
    host.onRoomClosed((r) => closedReasons.push(r));
    await host.closeRoom();
    expect(closedReasons).toEqual(['closed']);
    expect(host.roomCode()).toBeNull();
  });

  it('BUSY·ROOM_LIMIT·MAINTENANCE가 openRoom 결과로 온다, 공지는 onNotice로', async () => {
    const net = new MemoryNetwork({ config: { maxRooms: 2, maxRoomsPerIp: 1 } });
    const h1 = net.createHost({ ip: '1.1.1.1' });
    const h2 = net.createHost({ ip: '1.1.1.1' });
    const h3 = net.createHost({ ip: '2.2.2.2' });
    const h4 = net.createHost({ ip: '3.3.3.3' });
    expect(typeof (await h1.openRoom({ maxPeers: 30 }))).toBe('object');
    expect(await h2.openRoom({ maxPeers: 30 })).toBe('ROOM_LIMIT');
    expect(typeof (await h3.openRoom({ maxPeers: 30 }))).toBe('object');
    expect(await h4.openRoom({ maxPeers: 30 })).toBe('BUSY');
    expect(await h4.queryStats()).toEqual({ rooms: 2, maxRooms: 2 });

    const notices: unknown[] = [];
    h4.onNotice((n) => notices.push(n));
    await h1.closeRoom();
    net.setNotice({ level: 'maintenance', text: '점검 중' });
    await net.flush();
    expect(notices).toEqual([{ level: 'maintenance', text: '점검 중' }]);
    expect(await h4.openRoom({ maxPeers: 30 })).toBe('MAINTENANCE');
    // 새로 붙은 클라이언트도 공지를 받는다
    const p = net.createPeer();
    await net.flush();
    expect(p.currentNotice()).toEqual({ level: 'maintenance', text: '점검 중' });
  });

  it('advanceTime: 빈 방 20분 뒤 삭제, 지연 설정, serverNow는 가상 시계', async () => {
    const net = new MemoryNetwork({ startTime: 1_000_000 });
    const host = net.createHost();
    const closed: string[] = [];
    host.onRoomClosed((r) => closed.push(r));
    expect(typeof (await host.openRoom({ maxPeers: 30 }))).toBe('object');
    await net.advanceTime(1200_000);
    expect(closed).toEqual(['empty']);
    expect(Math.abs(host.serverNow() - net.now())).toBeLessThan(5);

    net.setLatency(20);
    const t0 = Date.now();
    const r = await host.openRoom({ maxPeers: 30 });
    expect(typeof r).toBe('object');
    expect(Date.now() - t0).toBeGreaterThanOrEqual(30); // 왕복 약 40ms(타이머가 1~2ms 일찍 깨는 것을 허용 — 105에서 여유)
  });

  it('학생은 leave() 뒤 offline, 호스트에 peer.left', async () => {
    const net = new MemoryNetwork();
    const host = net.createHost();
    host.onPeerHello((id) => host.admit(id));
    const left: string[] = [];
    host.onPeerLeave((id) => left.push(id));
    const opened = await host.openRoom({ maxPeers: 30 });
    if (typeof opened === 'string') throw new Error(opened);
    const p = net.createPeer();
    await p.join(opened.code, {});
    await net.flush();
    const id = p.currentPeerId();
    p.leave();
    await net.flush();
    expect(p.getStatus()).toBe('offline');
    expect(left).toEqual([id]);
    net.reconnect(p); // leave 뒤에는 다시 붙지 않음
    expect(p.getStatus()).toBe('offline');
  });
});

describe('MemoryNetwork — 요청은 반드시 끝난다(수정 1회차)', () => {
  it('버스트를 넘긴 openRoom은 RATE_LIMITED, 오류 응답마저 제한되면 TIMEOUT으로 끝난다', async () => {
    // 버스트 2: 연결 직후 ping 1개 + openRoom 1개까지 통과
    const net = new MemoryNetwork({ config: { msgRate: 0.001, msgBurst: 2 } });
    const host = net.createHost();
    host.requestTimeoutMs = 100;
    expect(typeof (await host.openRoom({ maxPeers: 10 }))).toBe('object');
    await host.closeRoom(); // 버킷이 비어 이 요청은 RATE_LIMITED 오류로 끝남
    // 오류 응답 버킷(2) 중 1개를 위에서 썼으므로 다음 하나는 RATE_LIMITED로 답을 받는다
    const t0 = Date.now();
    expect(await host.openRoom({ maxPeers: 10 })).toBe('RATE_LIMITED');
    expect(host.lastError()).toMatchObject({ code: 'RATE_LIMITED', req: 'host.open' });
    // 이제 오류 응답도 막힘 → 시간 제한
    expect(await host.openRoom({ maxPeers: 10 })).toBe('TIMEOUT');
    expect(await host.queryStats()).toBeNull();
    // 시간 제한 100ms × 2번. 전체 npm test 부하에서도 흔들리지 않게 여유를 크게(105) — '반드시 끝난다'만 확인
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  it('연결이 없으면 OFFLINE, 응답 전에 끊기면 OFFLINE', async () => {
    const net = new MemoryNetwork({ latencyMs: 30 });
    const peer = net.createPeer();
    const pending = peer.join('123456', {});
    net.disconnect(peer);
    expect(await pending).toBe('OFFLINE');
    expect(await peer.join('123456', {})).toBe('OFFLINE');
  });

  it('공지 시간 밖 blockNewRooms로 거절되면 기본 점검 문구가 onNotice·lastError로 온다', async () => {
    const net = new MemoryNetwork();
    net.setNotice({ level: 'info', text: '지난 안내', until: new Date(net.now() - 1000).toISOString(), blockNewRooms: true });
    const host = net.createHost();
    const notices: unknown[] = [];
    host.onNotice((n) => notices.push(n));
    await net.flush();
    expect(await host.openRoom({ maxPeers: 10 })).toBe('MAINTENANCE');
    const text = '서버 점검 중이라 지금은 새 방을 열 수 없어요. 잠시 후 다시 시도해 주세요.';
    expect(host.lastError()).toMatchObject({ code: 'MAINTENANCE', text });
    expect(notices.at(-1)).toEqual({ level: 'maintenance', text });
  });
});
