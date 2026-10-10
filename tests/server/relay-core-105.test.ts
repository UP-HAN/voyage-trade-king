/**
 * 작업 105가 relay-core에 더한 것(오케스트레이터 결정): 호스트 연결 속도 상한 분리, 서버 시작 뒤 resumeGrace 안의 NO_ROOM은
 * IP 실패 횟수에 세지 않음, 요청 id(rid) 되돌려 주기.
 */
import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, type ServerMessage } from '../../shared/protocol';
import { DEFAULT_RELAY_CONFIG, createRelayCore, type RelayConfig } from '../../shared/relay-core';

function bench(config: Partial<RelayConfig> = {}) {
  let now = Date.UTC(2026, 9, 9);
  const inbox = new Map<string, ServerMessage[]>();
  let seq = 0;
  const core = createRelayCore(config, {
    now: () => now,
    send: (id, d) => inbox.set(id, [...(inbox.get(id) ?? []), JSON.parse(d) as ServerMessage]),
    close: () => {},
  });
  return {
    core,
    advance(ms: number) {
      now += ms;
      core.sweep();
    },
    connect(ip: string) {
      const id = `c${++seq}`;
      core.onConnect(id, { ip });
      return id;
    },
    send(id: string, m: object) {
      core.onMessage(id, JSON.stringify({ v: PROTOCOL_VERSION, ...m }));
    },
    msgs(id: string) {
      return inbox.get(id) ?? [];
    },
  };
}

const errors = (list: ServerMessage[]) => list.filter((m) => m.t === 'error').map((m) => (m as { code: string }).code);

describe('relay-core — 105 추가', () => {
  it('기본값: 호스트 120/s(순간 240), 학생 20/s(순간 40)', () => {
    expect(DEFAULT_RELAY_CONFIG.hostMsgRate).toBe(120);
    expect(DEFAULT_RELAY_CONFIG.hostMsgBurst).toBe(240);
    expect(DEFAULT_RELAY_CONFIG.msgRate).toBe(20);
    expect(DEFAULT_RELAY_CONFIG.msgBurst).toBe(40);
  });

  it('호스트 역할 연결은 순간 240개·초당 120개까지, 학생은 그대로 40개', () => {
    const b = bench();
    const host = b.connect('1.1.1.1');
    b.send(host, { t: 'host.open', maxPeers: 30 });
    const code = (b.msgs(host).find((m) => m.t === 'room.opened') as { code: string }).code;
    const peer = b.connect('2.2.2.2');
    b.send(peer, { t: 'peer.join', code, hello: {} });
    const peerId = (b.msgs(peer).find((m) => m.t === 'peer.pending') as { peerId: string }).peerId;
    b.send(host, { t: 'host.admit', peerId });
    b.advance(5000); // 버킷 채움

    for (let i = 0; i < 240; i++) b.send(host, { t: 'host.all', msg: { i } });
    expect(b.msgs(peer).filter((m) => m.t === 'host.all')).toHaveLength(240);
    expect(errors(b.msgs(host))).toEqual([]);
    b.send(host, { t: 'host.all', msg: { over: 1 } });
    expect(errors(b.msgs(host))).toEqual(['RATE_LIMITED']);
    b.advance(1000); // 120개 회복
    for (let i = 0; i < 120; i++) b.send(host, { t: 'host.all', msg: { j: i } });
    expect(errors(b.msgs(host))).toEqual(['RATE_LIMITED']);

    for (let i = 0; i < 41; i++) b.send(peer, { t: 'peer.msg', msg: { i } });
    expect(errors(b.msgs(peer))).toEqual(['RATE_LIMITED']);
  });

  it('서버 시작 직후(resumeGrace 안) 같은 IP 30명이 NO_ROOM을 받아도 막히지 않고, 유예가 지나면 기존대로 막힌다', () => {
    const b = bench();
    const ip = '203.0.113.10';
    for (let i = 0; i < 31; i++) {
      const c = b.connect(ip);
      b.send(c, { t: 'peer.join', code: '482913', hello: { seat: i + 1 } });
      expect(errors(b.msgs(c))).toEqual(['NO_ROOM']);
    }
    expect(b.core.stats().blockedIps).toBe(0);
    expect(b.core.stats().joinFailPerMin).toBe(31); // 현황에는 셈
    // 호스트가 같은 코드로 다시 열면 그 반 학생들은 바로 들어간다
    const host = b.connect('203.0.113.10');
    b.send(host, { t: 'host.open', maxPeers: 40, wantCode: '482913', hostToken: 'f'.repeat(32) });
    expect(b.msgs(host).find((m) => m.t === 'room.opened')).toMatchObject({ code: '482913' });
    const late = b.connect(ip);
    b.send(late, { t: 'peer.join', code: '482913', hello: {} });
    expect(b.msgs(late).map((m) => m.t)).toContain('peer.pending');

    // 유예(600초) 지난 뒤에는 30번 실패 → 31번째 RATE_LIMITED
    b.advance(601_000);
    const ip2 = '198.51.100.20';
    const got: string[] = [];
    for (let i = 0; i < 31; i++) {
      const c = b.connect(ip2);
      b.send(c, { t: 'peer.join', code: '111111', hello: {} });
      got.push(...errors(b.msgs(c)));
    }
    expect(got.slice(0, 30).every((x) => x === 'NO_ROOM')).toBe(true);
    expect(got[30]).toBe('RATE_LIMITED');
    expect(b.core.stats().blockedIps).toBe(1);
  });

  it('무활동으로 닫힌 방 코드에 같은 IP 30명이 540초 동안 자동 재입장해도 차단 0, 존재한 적 없는 코드 대입은 차단', () => {
    const b = bench();
    b.advance(601_000); // resumeGrace 지남
    const host = b.connect('1.1.1.1');
    b.send(host, { t: 'host.open', maxPeers: 40 });
    const code = (b.msgs(host).find((m) => m.t === 'room.opened') as { code: string }).code;
    const p0 = b.connect('203.0.113.50');
    b.send(p0, { t: 'peer.join', code, hello: {} });
    b.send(host, { t: 'host.admit', peerId: (b.msgs(p0).find((m) => m.t === 'peer.pending') as { peerId: string }).peerId });
    b.advance(1_800_000); // IDLE_TTL → 방 닫힘(idle)
    expect(b.core.stats().rooms).toBe(0);

    const ip = '203.0.113.50';
    const seen = new Set<string>();
    // 30명이 2 → 4 → 8 → 15 → 15 …초 간격으로 540초 동안 같은 코드 재시도
    const delays = [2, 4, 8, 15];
    for (let s = 0; s < 30; s++) {
      let t = 0;
      let i = 0;
      while (t <= 540) {
        const c = b.connect(ip);
        b.send(c, { t: 'peer.join', code, hello: { seat: s + 1 } });
        for (const e of errors(b.msgs(c))) seen.add(e);
        b.core.onDisconnect(c); // 학생 기기는 시도마다 새 연결
        t += delays[Math.min(i++, delays.length - 1)]!;
      }
    }
    expect([...seen]).toEqual(['NO_ROOM']);
    expect(b.core.stats().blockedIps).toBe(0);

    // 존재한 적 없는 코드: 30번 → 31번째 RATE_LIMITED
    const got: string[] = [];
    for (let i = 0; i < 31; i++) {
      const c = b.connect(ip);
      b.send(c, { t: 'peer.join', code: String(200000 + i), hello: {} });
      got.push(...errors(b.msgs(c)));
    }
    expect(got.slice(0, 30).every((x) => x === 'NO_ROOM')).toBe(true);
    expect(got[30]).toBe('RATE_LIMITED');
  });

  it('요청 id(rid)를 직접 응답에만 붙이고, 잘못된 rid는 BAD_MESSAGE', () => {
    const b = bench();
    const h = b.connect('1.1.1.1');
    b.send(h, { t: 'host.open', maxPeers: 30, rid: 'a1' });
    expect(b.msgs(h).find((m) => m.t === 'room.opened')).toMatchObject({ rid: 'a1' });
    b.send(h, { t: 'host.open', maxPeers: 30, rid: 'a2' }); // 이미 방이 있음 → BAD_MESSAGE
    expect(b.msgs(h).at(-1)).toMatchObject({ t: 'error', code: 'BAD_MESSAGE', req: 'host.open', rid: 'a2' });
    b.send(h, { t: 'server.stats', rid: 'bad rid!' });
    expect(b.msgs(h).at(-1)).toMatchObject({ t: 'error', code: 'BAD_MESSAGE' });
    expect(b.msgs(h).at(-1)).not.toHaveProperty('rid');
  });
});
