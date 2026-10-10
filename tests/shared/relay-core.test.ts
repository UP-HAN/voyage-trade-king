import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PROTOCOL_VERSION, type ServerMessage } from '@shared/protocol';
import {
  DEFAULT_RELAY_CONFIG,
  RELAY_CONFIG_ENV,
  createRelayCore,
  relayConfigFromEnv,
  sha256Hex,
  type RelayConfig,
  type RelayCore,
} from '@shared/relay-core';

const V = PROTOCOL_VERSION;

/** relay-core를 가짜 시계·전송으로 감싼 시험대 */
function bench(config: Partial<RelayConfig> = {}, opts: { start?: number } = {}) {
  let now = opts.start ?? Date.UTC(2026, 9, 9, 0, 0, 0);
  const inbox = new Map<string, ServerMessage[]>();
  const closed = new Map<string, number>();
  let seq = 0;
  const core: RelayCore = createRelayCore(
    // 이 시험에서는 메시지 속도 제한을 크게 둔다(속도 제한 시험은 따로)
    { msgRate: 1e6, msgBurst: 1e6, hostMsgRate: 1e6, hostMsgBurst: 1e6, ...config },
    {
      now: () => now,
      send: (id, data) => {
        const list = inbox.get(id) ?? [];
        list.push(JSON.parse(data) as ServerMessage);
        inbox.set(id, list);
      },
      close: (id, code) => {
        closed.set(id, code);
      },
    },
  );
  const b = {
    core,
    closed,
    get now() {
      return now;
    },
    advance(ms: number) {
      now += ms;
      core.sweep();
    },
    connect(ip = '1.1.1.1') {
      const id = `c${++seq}`;
      const ok = core.onConnect(id, { ip, origin: 'test' });
      return { id, ok };
    },
    send(id: string, m: object) {
      core.onMessage(id, JSON.stringify({ v: V, ...m }));
    },
    take(id: string): ServerMessage[] {
      const list = inbox.get(id) ?? [];
      inbox.set(id, []);
      return list;
    },
    last(id: string): ServerMessage | undefined {
      const list = inbox.get(id) ?? [];
      return list[list.length - 1];
    },
    /** 호스트 연결 + 방 열기 */
    openRoom(ip = '1.1.1.1', extra: object = {}) {
      const { id } = b.connect(ip);
      b.send(id, { t: 'host.open', maxPeers: 40, ...extra });
      const m = b.last(id);
      return { id, msg: m, code: m && m.t === 'room.opened' ? m.code : '', hostToken: m && m.t === 'room.opened' ? m.hostToken : '' };
    },
    /** 학생 연결 + 입장 요청 (+ 호스트 허락) */
    joinPeer(hostId: string, code: string, admit = true, ip = '2.2.2.2') {
      const { id } = b.connect(ip);
      b.send(id, { t: 'peer.join', code, hello: { seat: 1 } });
      const m = b.last(id);
      const peerId = m && m.t === 'peer.pending' ? m.peerId : '';
      if (admit && peerId) b.send(hostId, { t: 'host.admit', peerId });
      return { id, peerId, msg: m };
    },
  };
  return b;
}

const errorOf = (m: ServerMessage | undefined) => (m && m.t === 'error' ? m.code : m?.t);

describe('relay-core 설정', () => {
  it('키·기본값이 server-setup 3.3과 같고 대응표가 있다(maxRooms는 교사 결정 50)', () => {
    expect(DEFAULT_RELAY_CONFIG).toEqual({
      maxRooms: 50,
      maxPeers: 45,
      maxConn: 2300,
      maxConnPerIp: 500,
      maxRoomsPerIp: 10,
      roomCreateLimit: 20,
      roomCreateWindow: 3600,
      emptyRoomTtl: 1200,
      unjoinedTimeout: 30,
      msgRate: 20,
      msgBurst: 40,
      hostMsgRate: 120, // 105 추가(호스트 역할 연결 상한)
      hostMsgBurst: 240,
      maxMsgBytes: 65536,
      joinFailLimit: 30,
      joinFailWindow: 300,
      joinBlockSec: 120,
      joinBlockMax: 1800,
      idleTtl: 1800,
      hostGrace: 1800,
      maxRoomAge: 28800,
      codeReuseBlock: 7200,
      resumeGrace: 600,
    });
    expect(Object.keys(RELAY_CONFIG_ENV).sort()).toEqual(Object.keys(DEFAULT_RELAY_CONFIG).sort());
    for (const env of Object.values(RELAY_CONFIG_ENV)) expect(env).toMatch(/^[A-Z_]+$/);
  });

  it('relayConfigFromEnv: 환경 변수 이름으로 덮어쓰고 이상한 값은 무시', () => {
    const c = relayConfigFromEnv({ MAX_ROOMS: '12', MAX_PEERS: 'abc', IDLE_TTL: '-5' });
    expect(c.maxRooms).toBe(12);
    expect(c.maxPeers).toBe(45);
    expect(c.idleTtl).toBe(1800);
  });

  it('sha256Hex가 node:crypto와 같다', () => {
    for (const s of ['', 'abc', '한글 토큰 🚢', 'x'.repeat(1000)]) {
      expect(sha256Hex(s)).toBe(createHash('sha256').update(s, 'utf8').digest('hex'));
    }
  });

  it('shared/가 DOM·Node 전용 모듈과 src/core를 import하지 않는다', () => {
    for (const f of ['shared/protocol.ts', 'shared/relay-core.ts']) {
      // 주석은 빼고 코드만 본다
      const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(src).not.toMatch(/from\s+['"](node:|fs|http|https|net|crypto|path)['"/]/);
      expect(src).not.toMatch(/\b(window|document|localStorage|sessionStorage|process)\./);
      expect(src).not.toMatch(/src\/core/);
    }
  });
});

describe('relay-core 방 코드', () => {
  it('6자리 숫자, 열린 방·최근 닫힌 방과 겹치지 않음(1만 번 열고 닫기)', { timeout: 30_000 }, () => {
    const b = bench({ maxRooms: 100000, roomCreateLimit: 1e9, maxRoomsPerIp: 1e9, maxConn: 1e9, maxConnPerIp: 1e9 });
    const seen = new Set<string>();
    let open = 0;
    for (let i = 0; i < 10000; i++) {
      const r = b.openRoom();
      if (!r.msg || r.msg.t !== 'room.opened') throw new Error(`열기 실패 ${JSON.stringify(r.msg)}`);
      expect(r.code).toMatch(/^[1-9]\d{5}$/);
      // 열린 방·최근(2시간 안) 닫힌 방 코드와 겹치지 않는다(시계는 그대로)
      expect(seen.has(r.code)).toBe(false);
      seen.add(r.code);
      if (i % 2 === 1) b.send(r.id, { t: 'host.close' });
      else open++;
    }
    expect(seen.size).toBe(10000);
    expect(b.core.stats().rooms).toBe(open);
  });

  it('닫힌 코드는 재사용 금지, 같은 hostToken이면 다시 열 수 있다', () => {
    const b = bench();
    const a = b.openRoom();
    b.send(a.id, { t: 'host.close' });
    expect(b.take(a.id).some((m) => m.t === 'room.closed')).toBe(true);
    // 다른 토큰으로 같은 코드 요청 → 다른 코드
    const other = b.connect();
    b.send(other.id, { t: 'host.open', maxPeers: 30, wantCode: a.code, hostToken: 'f'.repeat(32) });
    const m1 = b.last(other.id);
    expect(m1?.t).toBe('room.opened');
    expect(m1 && m1.t === 'room.opened' && m1.code).not.toBe(a.code);
    // 같은 토큰 → 같은 코드
    const same = b.connect();
    b.send(same.id, { t: 'host.open', maxPeers: 30, wantCode: a.code, hostToken: a.hostToken });
    const m2 = b.last(same.id);
    expect(m2).toMatchObject({ t: 'room.opened', code: a.code, hostToken: a.hostToken });
  });

  it('서버 재시작 뒤(기록 없음) 비어 있는 wantCode는 그대로 열린다', () => {
    const b = bench();
    const { id } = b.connect();
    b.send(id, { t: 'host.open', maxPeers: 30, wantCode: '482137', hostToken: 'a'.repeat(32) });
    expect(b.last(id)).toMatchObject({ t: 'room.opened', code: '482137', hostToken: 'a'.repeat(32) });
  });

  it('host.resume: 맞는 토큰이면 다시 붙고 학생에게 host.status, 틀리면 NO_ROOM', () => {
    const b = bench();
    const h = b.openRoom();
    const p = b.joinPeer(h.id, h.code);
    b.core.onDisconnect(h.id);
    expect(b.take(p.id).some((m) => m.t === 'host.status' && m.online === false)).toBe(true);
    const bad = b.connect();
    b.send(bad.id, { t: 'host.resume', code: h.code, hostToken: 'x'.repeat(32) });
    expect(errorOf(b.last(bad.id))).toBe('NO_ROOM');
    const h2 = b.connect();
    b.send(h2.id, { t: 'host.resume', code: h.code, hostToken: h.hostToken });
    expect(b.last(h2.id)).toMatchObject({ t: 'room.opened', resumed: true, peers: [p.peerId] });
    expect(b.take(p.id).some((m) => m.t === 'host.status' && m.online === true)).toBe(true);
  });
});

describe('relay-core 역할·격리', () => {
  it('방 A의 host.all·host.to가 방 B에 가지 않는다, peer.msg는 자기 방 호스트에게만', () => {
    const b = bench();
    const A = b.openRoom('1.1.1.1');
    const B = b.openRoom('3.3.3.3');
    const a1 = b.joinPeer(A.id, A.code);
    const b1 = b.joinPeer(B.id, B.code);
    b.take(a1.id);
    b.take(b1.id);
    b.take(A.id);
    b.take(B.id);
    b.send(A.id, { t: 'host.all', msg: { hello: 'A' } });
    b.send(A.id, { t: 'host.to', peerId: b1.peerId, msg: { secret: 1 } }); // 다른 방 학생 지정 — 무시
    expect(b.take(a1.id)).toEqual([{ v: V, t: 'host.all', msg: { hello: 'A' } }]);
    expect(b.take(b1.id)).toEqual([]);
    b.send(b1.id, { t: 'peer.msg', msg: { act: 1 } });
    expect(b.take(A.id)).toEqual([]);
    expect(b.take(B.id)).toEqual([{ v: V, t: 'peer.msg', peerId: b1.peerId, msg: { act: 1 } }]);
  });

  it('학생이 호스트 메시지를 보내면 BAD_MESSAGE, 역할은 바뀌지 않는다', () => {
    const b = bench();
    const A = b.openRoom();
    const p = b.joinPeer(A.id, A.code);
    b.send(p.id, { t: 'host.all', msg: { x: 1 } });
    expect(errorOf(b.last(p.id))).toBe('BAD_MESSAGE');
    b.send(p.id, { t: 'host.open', maxPeers: 10 });
    expect(errorOf(b.last(p.id))).toBe('BAD_MESSAGE');
    // 호스트가 peer.join → 거부
    b.send(A.id, { t: 'peer.join', code: A.code, hello: {} });
    expect(errorOf(b.last(A.id))).toBe('BAD_MESSAGE');
  });

  it('admit 전에는 peer.msg 거부, 아무것도 받지 못함', () => {
    const b = bench();
    const A = b.openRoom();
    const p = b.joinPeer(A.id, A.code, false);
    expect(p.msg?.t).toBe('peer.pending');
    b.send(p.id, { t: 'peer.msg', msg: { x: 1 } });
    expect(errorOf(b.last(p.id))).toBe('BAD_MESSAGE');
    b.take(p.id);
    b.send(A.id, { t: 'host.all', msg: { y: 1 } });
    b.send(A.id, { t: 'host.to', peerId: p.peerId, msg: { y: 2 } });
    expect(b.take(p.id)).toEqual([]);
  });

  it('호스트에 peer.hello, reject는 reason을 그대로 전달, kick은 kicked 후 끊음', () => {
    const b = bench();
    const A = b.openRoom();
    const p = b.joinPeer(A.id, A.code, false);
    expect(b.last(A.id)).toEqual({ v: V, t: 'peer.hello', peerId: p.peerId, hello: { seat: 1 } });
    b.send(A.id, { t: 'host.reject', peerId: p.peerId, reason: 'NAME_TAKEN' });
    expect(b.last(p.id)).toEqual({ v: V, t: 'rejected', reason: 'NAME_TAKEN' });
    const q = b.joinPeer(A.id, A.code, true);
    expect(b.last(q.id)).toEqual({ v: V, t: 'admitted', peerId: q.peerId });
    b.send(A.id, { t: 'host.kick', peerId: q.peerId });
    expect(b.last(q.id)?.t).toBe('kicked');
    expect(b.closed.has(q.id)).toBe(true);
  });

  it('잠금 → LOCKED, 가득 참 → FULL, 호스트 없음 → HOST_OFFLINE', () => {
    const b = bench();
    const { id } = b.connect();
    b.send(id, { t: 'host.open', maxPeers: 2 });
    const m = b.last(id);
    const code = m && m.t === 'room.opened' ? m.code : '';
    b.joinPeer(id, code);
    b.joinPeer(id, code);
    expect(errorOf(b.joinPeer(id, code).msg)).toBe('FULL');
    b.send(id, { t: 'host.lock' });
    expect(errorOf(b.joinPeer(id, code).msg)).toBe('LOCKED');
    b.send(id, { t: 'host.unlock' });
    const C = b.openRoom('5.5.5.5');
    b.core.onDisconnect(C.id);
    expect(errorOf(b.joinPeer(C.id, C.code).msg)).toBe('HOST_OFFLINE');
  });

  it('ping → pong {at, serverNow}', () => {
    const b = bench();
    const { id } = b.connect();
    b.send(id, { t: 'ping', at: 123 });
    expect(b.last(id)).toEqual({ v: V, t: 'pong', at: 123, serverNow: b.now });
  });

  it('버전이 다르면 VERSION, 64KB 넘으면 TOO_LARGE', () => {
    const b = bench();
    const A = b.openRoom();
    b.core.onMessage(A.id, JSON.stringify({ v: 2, t: 'ping', at: 1 }));
    expect(errorOf(b.last(A.id))).toBe('VERSION');
    b.send(A.id, { t: 'host.all', msg: { big: 'x'.repeat(65536) } });
    expect(errorOf(b.last(A.id))).toBe('TOO_LARGE');
    b.take(A.id);
    b.send(A.id, { t: 'host.all', msg: { ok: 'x'.repeat(60000) } });
    expect(b.take(A.id)).toEqual([]);
  });
});

describe('relay-core 속도 제한·대입 방지', () => {
  it('메시지 속도 제한: 순간 40개 뒤 RATE_LIMITED, 시간이 지나면 다시 허용', () => {
    const b = bench({ msgRate: 20, msgBurst: 40 });
    const { id } = b.connect();
    b.take(id);
    for (let i = 0; i < 40; i++) b.send(id, { t: 'ping', at: i });
    expect(b.take(id).filter((m) => m.t === 'pong')).toHaveLength(40);
    b.send(id, { t: 'ping', at: 99 });
    b.send(id, { t: 'ping', at: 100 });
    // 넘친 메시지마다 req를 붙여 답한다
    expect(b.take(id)).toEqual([
      { v: V, t: 'error', code: 'RATE_LIMITED', req: 'ping' },
      { v: V, t: 'error', code: 'RATE_LIMITED', req: 'ping' },
    ]);
    b.advance(1000); // 20개 회복
    for (let i = 0; i < 20; i++) b.send(id, { t: 'ping', at: i });
    expect(b.take(id).filter((m) => m.t === 'pong')).toHaveLength(20);
  });

  it('NO_ROOM 실패 30번 뒤 31번째는 RATE_LIMITED, 성공한 입장은 세지 않음, 두 번째 차단은 240초', () => {
    const b = bench();
    b.advance(601_000); // (105) 서버 시작 뒤 resumeGrace 안의 NO_ROOM은 세지 않으므로 지난 뒤에 시험
    const A = b.openRoom('1.1.1.1');
    const ip = '9.9.9.9';
    const tryJoin = (code: string) => b.joinPeer(A.id, code, false, ip).msg;
    for (let i = 0; i < 29; i++) expect(errorOf(tryJoin('100000'))).toBe('NO_ROOM');
    // 성공 입장 여러 번 — 세지 않음
    for (let i = 0; i < 5; i++) expect(tryJoin(A.code)?.t).toBe('peer.pending');
    expect(errorOf(tryJoin('100000'))).toBe('NO_ROOM'); // 30번째 실패 → 차단 시작
    expect(errorOf(tryJoin(A.code))).toBe('RATE_LIMITED'); // 31번째 요청
    expect(b.core.stats().blockedIps).toBe(1);
    expect(b.core.stats().joinFailPerMin).toBe(30);
    b.advance(119_000);
    expect(errorOf(tryJoin(A.code))).toBe('RATE_LIMITED');
    b.advance(1_000); // 120초 지남
    expect(tryJoin(A.code)?.t).toBe('peer.pending');
    // 1시간 안에 다시 30번 실패 → 240초
    for (let i = 0; i < 30; i++) tryJoin('100000');
    expect(errorOf(tryJoin(A.code))).toBe('RATE_LIMITED');
    b.advance(239_000);
    expect(errorOf(tryJoin(A.code))).toBe('RATE_LIMITED');
    b.advance(1_000);
    expect(tryJoin(A.code)?.t).toBe('peer.pending');
  });

  it('차단 시간은 두 배씩 늘지만 joinBlockMax(1800초)를 넘지 않는다', () => {
    const b = bench();
    b.advance(601_000); // (105) resumeGrace 지난 뒤
    const attempt = () => {
      // 실패한 연결은 30초 뒤 정리되므로 시도마다 새 연결
      const { id } = b.connect('8.8.8.8');
      b.send(id, { t: 'peer.join', code: '100000', hello: {} });
      return errorOf(b.last(id));
    };
    const durations: number[] = [];
    for (let round = 0; round < 6; round++) {
      for (let i = 0; i < 30; i++) attempt();
      let waited = 0;
      for (;;) {
        const code = attempt();
        if (code !== 'RATE_LIMITED') break;
        b.advance(10_000);
        waited += 10;
      }
      durations.push(waited);
      // 마지막 확인 요청도 실패 1회로 셈 → 다음 라운드 30번에서 1개 빼기 위해 실패 기록을 정리
      b.advance(301_000);
    }
    expect(durations.slice(0, 5)).toEqual([120, 240, 480, 960, 1800]);
    expect(durations[5]).toBe(1800);
  });
});

describe('relay-core 상한', () => {
  it('기본 maxRooms(50): 51번째 방은 BUSY(+ rooms/maxRooms) — 여러 IP로 maxRoomsPerIp에 먼저 걸리지 않게', () => {
    const b = bench();
    for (let i = 0; i < 50; i++) expect(b.openRoom(`10.0.${Math.floor(i / 10)}.1`).msg?.t).toBe('room.opened');
    const r = b.openRoom('10.9.9.9');
    expect(r.msg).toMatchObject({ t: 'error', code: 'BUSY', req: 'host.open', rooms: 50, maxRooms: 50 });
  });

  it('maxRooms를 100으로 두면 101번째가 BUSY', () => {
    const b = bench({ maxRooms: 100 });
    for (let i = 0; i < 100; i++) expect(b.openRoom(`10.0.${Math.floor(i / 10)}.1`).msg?.t).toBe('room.opened');
    expect(errorOf(b.openRoom('10.1.0.1').msg)).toBe('BUSY');
  });

  it('같은 IP 11번째 열린 방은 ROOM_LIMIT', () => {
    const b = bench();
    for (let i = 0; i < 10; i++) expect(b.openRoom('4.4.4.4').msg?.t).toBe('room.opened');
    expect(errorOf(b.openRoom('4.4.4.4').msg)).toBe('ROOM_LIMIT');
    expect(b.openRoom('4.4.4.5').msg?.t).toBe('room.opened');
  });

  it('시간 창 안 21번째 생성은 ROOM_LIMIT, 같은 hostToken 재열기는 통과, 창이 지나면 다시 허용', () => {
    const b = bench();
    const ip = '6.6.6.6';
    let lastOpened = { code: '', hostToken: '' };
    for (let i = 0; i < 20; i++) {
      const r = b.openRoom(ip);
      expect(r.msg?.t).toBe('room.opened');
      lastOpened = r;
      b.send(r.id, { t: 'host.close' });
    }
    expect(errorOf(b.openRoom(ip).msg)).toBe('ROOM_LIMIT');
    const re = b.openRoom(ip, { wantCode: lastOpened.code, hostToken: lastOpened.hostToken });
    expect(re.msg).toMatchObject({ t: 'room.opened', code: lastOpened.code });
    b.advance(3600_000);
    expect(b.openRoom(ip).msg?.t).toBe('room.opened');
  });

  it('전체 연결 상한 BUSY, IP당 연결 상한 RATE_LIMITED', () => {
    const b = bench({ maxConn: 3, maxConnPerIp: 2 });
    expect(b.connect('1.1.1.1').ok).toBe(true);
    expect(b.connect('1.1.1.1').ok).toBe(true);
    const third = b.connect('1.1.1.1');
    expect(third.ok).toBe(false);
    expect(errorOf(b.last(third.id))).toBe('RATE_LIMITED');
    expect(b.connect('2.2.2.2').ok).toBe(true);
    const over = b.connect('3.3.3.3');
    expect(over.ok).toBe(false);
    expect(errorOf(b.last(over.id))).toBe('BUSY');
  });
});

describe('relay-core 수명·정리', () => {
  it('호스트 끊김 → host.status false, HOST_GRACE 지나면 room.closed(host_gone)', () => {
    const b = bench();
    const A = b.openRoom();
    const p = b.joinPeer(A.id, A.code);
    b.core.onDisconnect(A.id);
    expect(b.take(p.id).at(-1)).toEqual({ v: V, t: 'host.status', online: false });
    b.advance(1799_000);
    expect(b.core.stats().rooms).toBe(1);
    b.advance(1_000);
    expect(b.core.stats().rooms).toBe(0);
    expect(b.take(p.id).some((m) => m.t === 'room.closed' && m.reason === 'host_gone')).toBe(true);
  });

  it('IDLE_TTL: 30분 무활동이면 삭제(idle)', () => {
    const b = bench();
    const A = b.openRoom();
    b.joinPeer(A.id, A.code);
    b.advance(1000_000);
    b.send(A.id, { t: 'host.all', msg: { tick: 1 } });
    b.advance(1799_000);
    expect(b.core.stats().rooms).toBe(1);
    b.advance(1_000);
    expect(b.core.stats().rooms).toBe(0);
    expect(b.take(A.id).some((m) => m.t === 'room.closed' && m.reason === 'idle')).toBe(true);
  });

  it('MAX_ROOM_AGE: 활동이 있어도 8시간이면 삭제(max_age)', () => {
    const b = bench();
    const A = b.openRoom();
    b.joinPeer(A.id, A.code);
    for (let i = 0; i < 479; i++) {
      b.advance(60_000);
      b.send(A.id, { t: 'host.all', msg: { i } });
    }
    expect(b.core.stats().rooms).toBe(1);
    b.advance(60_000);
    expect(b.core.stats().rooms).toBe(0);
    expect(b.take(A.id).some((m) => m.t === 'room.closed' && m.reason === 'max_age')).toBe(true);
  });

  it('빈 방은 20분 뒤 삭제(empty), 학생이 한 번이라도 들어온 방은 유지', () => {
    const b = bench();
    const E = b.openRoom('1.1.1.1');
    const F = b.openRoom('1.1.1.2');
    const p = b.joinPeer(F.id, F.code);
    b.core.onDisconnect(p.id); // 들어왔다 나감
    // 무활동 30분에 걸리지 않게 호스트 활동
    b.advance(600_000);
    b.send(E.id, { t: 'host.all', msg: {} });
    b.send(F.id, { t: 'host.all', msg: {} });
    b.advance(599_000);
    expect(b.core.stats().rooms).toBe(2);
    b.advance(1_000);
    expect(b.core.stats().rooms).toBe(1);
    expect(b.take(E.id).some((m) => m.t === 'room.closed' && m.reason === 'empty')).toBe(true);
    expect(b.take(F.id).some((m) => m.t === 'room.closed')).toBe(false);
  });

  it('역할을 밝히지 않은 연결은 30초 뒤 끊김(UNJOINED_TIMEOUT), 밝힌 연결은 유지', () => {
    const b = bench();
    const idle = b.connect();
    const A = b.openRoom();
    const p = b.joinPeer(A.id, A.code);
    b.send(idle.id, { t: 'ping', at: 1 }); // ping은 역할을 밝힌 것이 아님
    b.advance(29_000);
    expect(b.closed.has(idle.id)).toBe(false);
    b.advance(1_000);
    expect(b.closed.has(idle.id)).toBe(true);
    expect(errorOf(b.last(idle.id))).toBe('UNJOINED_TIMEOUT');
    expect(b.closed.has(A.id)).toBe(false);
    expect(b.closed.has(p.id)).toBe(false);
    expect(b.core.stats().conns).toBe(2);
  });
});

describe('relay-core 공지·점검', () => {
  it('server.notice가 새 연결과 기존 연결 모두에 간다', () => {
    const b = bench();
    const old = b.connect();
    expect(b.take(old.id)).toEqual([{ v: V, t: 'server.notice', level: null }]);
    b.core.setNotice({ level: 'warn', text: '내일 점검' });
    expect(b.take(old.id)).toEqual([{ v: V, t: 'server.notice', level: 'warn', text: '내일 점검' }]);
    const fresh = b.connect();
    expect(b.take(fresh.id)).toEqual([{ v: V, t: 'server.notice', level: 'warn', text: '내일 점검' }]);
    expect(b.core.stats().notice).toBe('warn');
  });

  it('from~until 밖이면 {level:null}, 시간이 되면 sweep에서 알림', () => {
    const b = bench();
    const from = new Date(b.now + 60_000).toISOString();
    const until = new Date(b.now + 120_000).toISOString();
    const c = b.openRoom(); // 역할이 있는 연결(빈 연결 정리에 걸리지 않게)
    b.take(c.id);
    b.core.setNotice({ level: 'maintenance', text: '점검', from, until });
    expect(b.take(c.id)).toEqual([{ v: V, t: 'server.notice', level: null }]);
    b.advance(60_000);
    expect(b.take(c.id)).toEqual([{ v: V, t: 'server.notice', level: 'maintenance', text: '점검', until }]);
    b.advance(61_000);
    expect(b.take(c.id)).toEqual([{ v: V, t: 'server.notice', level: null }]);
  });

  it('MAINTENANCE: 새 방 거절, 기존 방 메시지 정상, host.resume·같은 토큰 재열기 허용', () => {
    const b = bench();
    const A = b.openRoom();
    const p = b.joinPeer(A.id, A.code);
    b.core.setNotice({ level: 'maintenance', text: '점검 중' });
    expect(b.core.stats().notice).toBe('maintenance');
    expect(errorOf(b.openRoom('7.7.7.7').msg)).toBe('MAINTENANCE');
    b.take(p.id);
    b.send(A.id, { t: 'host.all', msg: { still: 'ok' } });
    expect(b.take(p.id)).toEqual([{ v: V, t: 'host.all', msg: { still: 'ok' } }]);
    b.core.onDisconnect(A.id);
    const h2 = b.connect();
    b.send(h2.id, { t: 'host.resume', code: A.code, hostToken: A.hostToken });
    expect(b.last(h2.id)).toMatchObject({ t: 'room.opened', resumed: true });
    // 닫고 같은 토큰으로 다시 열기
    b.send(h2.id, { t: 'host.close' });
    b.send(h2.id, { t: 'host.open', maxPeers: 30, wantCode: A.code, hostToken: A.hostToken });
    expect(b.last(h2.id)).toMatchObject({ t: 'room.opened', code: A.code });
  });

  it('blockNewRooms: 시각과 관계없이 새 방 거절, info 공지만이면 허용', () => {
    const b = bench();
    b.core.setNotice({ level: 'info', text: '안내' });
    expect(b.openRoom().msg?.t).toBe('room.opened');
    b.core.setNotice({
      level: 'warn',
      text: '곧 점검',
      from: new Date(b.now + 3600_000).toISOString(),
      blockNewRooms: true,
    });
    expect(errorOf(b.openRoom('1.2.3.4').msg)).toBe('MAINTENANCE');
    b.core.setNotice(null);
    expect(b.openRoom('1.2.3.4').msg?.t).toBe('room.opened');
  });
});

describe('relay-core 현황', () => {
  it('stats()에 방 코드·IP가 없다', () => {
    const b = bench();
    const A = b.openRoom('203.0.113.7');
    b.joinPeer(A.id, A.code, true, '198.51.100.9');
    for (let i = 0; i < 3; i++) b.joinPeer(A.id, '100000', false, '192.0.2.55');
    const s = b.core.stats();
    expect(s).toEqual({
      rooms: 1,
      maxRooms: 50,
      peers: 1,
      conns: 5,
      maxConn: 2300,
      blockedIps: 0,
      joinFailPerMin: 3,
      notice: null,
      acceptingNewRooms: true,
    });
    const text = JSON.stringify(s);
    expect(text).not.toContain(A.code);
    expect(text).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  });

  it('server.stats 요청: 역할 없이 {rooms, maxRooms}만, 역할이 정해지지 않는다', () => {
    const b = bench();
    b.openRoom();
    const { id } = b.connect();
    b.send(id, { t: 'server.stats' });
    expect(b.last(id)).toEqual({ v: V, t: 'server.stats', rooms: 1, maxRooms: 50 });
    // 여전히 역할 없음 → 30초 뒤 끊김
    b.advance(30_000);
    expect(b.closed.has(id)).toBe(true);
  });

  it('server.stats도 속도 제한을 받는다', () => {
    const b = bench({ msgRate: 1, msgBurst: 3 });
    const { id } = b.connect();
    b.take(id);
    for (let i = 0; i < 5; i++) b.send(id, { t: 'server.stats' });
    const got = b.take(id);
    expect(got.filter((m) => m.t === 'server.stats')).toHaveLength(3);
    expect(got.filter((m) => m.t === 'error')).toEqual([
      { v: V, t: 'error', code: 'RATE_LIMITED', req: 'server.stats' },
      { v: V, t: 'error', code: 'RATE_LIMITED', req: 'server.stats' },
    ]);
  });
});

describe('relay-core 수정 1회차 — 재열기 우회·방 밖 연결·속도 제한 응답', () => {
  const gracePassed = 601_000; // resumeGrace(600초) 지남

  it('점검 중: 기록 없는 지어낸 wantCode로도 새 방을 열 수 없다(유예 시간 안·밖 모두), 기본 문구가 붙는다', () => {
    const b = bench();
    b.core.setNotice({ level: 'warn', text: '안내', until: new Date(b.now - 1000).toISOString(), blockNewRooms: true });
    // 공지는 시간 밖이라 보이지 않지만 blockNewRooms로 막힘 → 기본 문구
    const early = b.openRoom('7.7.7.7', { wantCode: '123456', hostToken: 'anything' });
    expect(early.msg).toMatchObject({
      t: 'error',
      code: 'MAINTENANCE',
      req: 'host.open',
      text: '서버 점검 중이라 지금은 새 방을 열 수 없어요. 잠시 후 다시 시도해 주세요.',
    });
    b.advance(gracePassed);
    const late = b.openRoom('7.7.7.8', { wantCode: '123457', hostToken: 'anything' });
    expect(errorOf(late.msg)).toBe('MAINTENANCE');
    // 공지가 보이는 동안에는 그 문구를 붙인다
    b.core.setNotice({ level: 'maintenance', text: '17시까지 점검' });
    expect(b.openRoom('7.7.7.9').msg).toMatchObject({ code: 'MAINTENANCE', text: '17시까지 점검' });
  });

  it('한 IP가 지어낸 wantCode로 30번 열고 닫으면 시간당 생성 상한(20)에서 막힌다', () => {
    const b = bench();
    b.advance(gracePassed);
    const results: string[] = [];
    for (let i = 0; i < 30; i++) {
      const r = b.openRoom('6.6.6.6', { wantCode: String(200000 + i), hostToken: `tok${i}` });
      results.push(r.msg?.t === 'room.opened' ? 'ok' : String(errorOf(r.msg)));
      if (r.msg?.t === 'room.opened') {
        // 유예 시간이 지났으므로 원하는 코드가 아니라 새 코드·새 토큰을 받는다
        expect(r.code).not.toBe(String(200000 + i));
        b.send(r.id, { t: 'host.close' });
      }
    }
    expect(results.filter((x) => x === 'ok')).toHaveLength(20);
    expect(results.slice(20).every((x) => x === 'ROOM_LIMIT')).toBe(true);
  });

  it('유예 시간 안의 기록 없는 재열기도 생성 상한 검사는 받지만 생성 수에는 들어가지 않는다', () => {
    const b = bench({ roomCreateLimit: 2 });
    // 재시작 직후 정상 복구 3건(상한 2보다 많음) — 세지 않으므로 모두 성공
    for (let i = 0; i < 3; i++) {
      const r = b.openRoom('5.5.5.5', { wantCode: String(300000 + i), hostToken: `t${i}` });
      expect(r.msg).toMatchObject({ t: 'room.opened', code: String(300000 + i), hostToken: `t${i}` });
    }
    // 새 방 2개까지는 됨, 3번째는 ROOM_LIMIT, 그 뒤엔 유예 재열기도 ROOM_LIMIT
    expect(b.openRoom('5.5.5.5').msg?.t).toBe('room.opened');
    expect(b.openRoom('5.5.5.5').msg?.t).toBe('room.opened');
    expect(errorOf(b.openRoom('5.5.5.5').msg)).toBe('ROOM_LIMIT');
    expect(errorOf(b.openRoom('5.5.5.5', { wantCode: '309999', hostToken: 'x' }).msg)).toBe('ROOM_LIMIT');
  });

  it('재시작 직후 정상 재개방은 성공, 확인된 재열기(같은 토큰)는 유예 뒤·점검 중에도 성공', () => {
    const b = bench();
    const r = b.openRoom('1.1.1.1', { wantCode: '482137', hostToken: 'h'.repeat(32) });
    expect(r.msg).toMatchObject({ t: 'room.opened', code: '482137' });
    b.send(r.id, { t: 'host.close' });
    b.advance(gracePassed);
    b.core.setNotice({ level: 'maintenance', text: '점검' });
    const again = b.openRoom('1.1.1.1', { wantCode: '482137', hostToken: 'h'.repeat(32) });
    expect(again.msg).toMatchObject({ t: 'room.opened', code: '482137' });
  });

  it('방 밖에 남은 연결 정리: 없는 코드 join·거절된 학생은 30초, 방이 닫힌 호스트는 300초 뒤 끊김 / admit 학생·방 있는 호스트는 유지', () => {
    const b = bench();
    const A = b.openRoom();
    const admitted = b.joinPeer(A.id, A.code, true);
    const failed = b.joinPeer(A.id, '100000', false, '9.9.9.9');
    expect(errorOf(failed.msg)).toBe('NO_ROOM');
    const rejected = b.joinPeer(A.id, A.code, false);
    b.advance(10_000);
    b.send(A.id, { t: 'host.reject', peerId: rejected.peerId, reason: 'NAME_TAKEN' }); // 10초 시점에 방 밖이 됨
    const C = b.openRoom('3.3.3.3');
    b.send(C.id, { t: 'host.close' }); // 10초 시점에 방이 사라진 호스트
    b.advance(20_000); // 30초
    expect(b.closed.get(failed.id)).toBe(4003);
    expect(b.closed.has(rejected.id)).toBe(false);
    b.advance(10_000); // 40초 = 거절 뒤 30초
    expect(b.closed.get(rejected.id)).toBe(4003);
    expect(b.closed.has(C.id)).toBe(false);
    b.advance(270_000); // 310초 = 방 닫힘 뒤 300초
    expect(b.closed.get(C.id)).toBe(4003);
    expect(b.closed.has(admitted.id)).toBe(false);
    expect(b.closed.has(A.id)).toBe(false);
  });

  it('속도 제한에 걸린 요청에는 req가 붙은 RATE_LIMITED, 오류 응답도 따로 제한', () => {
    const b = bench({ msgRate: 0.001, msgBurst: 2 });
    const { id } = b.connect();
    b.take(id);
    b.send(id, { t: 'ping', at: 1 });
    b.send(id, { t: 'ping', at: 2 });
    for (let i = 0; i < 4; i++) b.send(id, { t: 'host.open', maxPeers: 10 });
    const got = b.take(id);
    expect(got.filter((m) => m.t === 'pong')).toHaveLength(2);
    // 오류 응답 버킷(2)만큼만 답하고 나머지는 버린다(어댑터 시간 제한이 처리)
    expect(got.filter((m) => m.t === 'error')).toEqual([
      { v: V, t: 'error', code: 'RATE_LIMITED', req: 'host.open' },
      { v: V, t: 'error', code: 'RATE_LIMITED', req: 'host.open' },
    ]);
  });
});

describe('relay-core v0.3.2 — 연결 상한·acceptingNewRooms', () => {
  it('같은 IP에서 10개 방 × 31연결(310)이 기본값에서 거부되지 않는다', () => {
    const b = bench();
    const ip = '203.0.113.1';
    for (let r = 0; r < 10; r++) {
      const h = b.openRoom(ip);
      expect(h.msg?.t).toBe('room.opened');
      for (let i = 0; i < 30; i++) {
        const p = b.joinPeer(h.id, h.code, true, ip);
        expect(p.msg?.t).toBe('peer.pending');
      }
    }
    expect(b.core.stats()).toMatchObject({ rooms: 10, peers: 300, conns: 310 });
  });

  it('acceptingNewRooms는 host.open 거절 판정과 같다', () => {
    const b = bench();
    // (가) 빈 서버
    expect(b.core.stats().acceptingNewRooms).toBe(true);
    // (다) 49방 + blockNewRooms → false, 실제 host.open은 MAINTENANCE
    for (let i = 0; i < 49; i++) b.openRoom(`10.1.${Math.floor(i / 10)}.1`);
    expect(b.core.stats().acceptingNewRooms).toBe(true);
    b.core.setNotice({ level: 'warn', text: '곧 점검', blockNewRooms: true });
    expect(b.core.stats().acceptingNewRooms).toBe(false);
    expect(errorOf(b.openRoom('10.2.0.1').msg)).toBe('MAINTENANCE');
    // (라) maintenance 공지가 until을 지나면 다시 true, 실제로 열림
    b.core.setNotice({ level: 'maintenance', text: '점검', until: new Date(b.now + 60_000).toISOString() });
    expect(b.core.stats().acceptingNewRooms).toBe(false);
    expect(errorOf(b.openRoom('10.2.0.2').msg)).toBe('MAINTENANCE');
    b.advance(61_000);
    expect(b.core.stats().acceptingNewRooms).toBe(true);
    expect(b.openRoom('10.2.0.3').msg?.t).toBe('room.opened'); // 50번째
    // (나) 50방 → false, 실제 host.open은 BUSY
    expect(b.core.stats()).toMatchObject({ rooms: 50, maxRooms: 50, acceptingNewRooms: false });
    expect(errorOf(b.openRoom('10.2.0.4').msg)).toBe('BUSY');
  });
});
