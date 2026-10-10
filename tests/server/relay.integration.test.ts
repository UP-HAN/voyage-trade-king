/**
 * 중계 서버 통합 테스트(작업 105 brief D-14, v0.3.1-7, v0.3.2-6).
 * 실제 서버(`server/src/server.ts`)를 임의 포트로 띄우고 `ws` 클라이언트로 붙는다.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { RELAY_CONFIG_ENV, DEFAULT_RELAY_CONFIG } from '../../shared/relay-core';
import { ConfigError, SERVER_DEFAULTS, clientIp, loadServerConfig, maskCode, maskIp, originAllowed } from '../../server/src/index';
import { connect, joinAndAdmit, openRoom, sleep, startTestServer, type TestServer } from './relay-helpers';

let servers: TestServer[] = [];
afterEach(async () => {
  for (const s of servers) await s.stop();
  servers = [];
});
async function boot(...a: Parameters<typeof startTestServer>) {
  const s = await startTestServer(...a);
  servers.push(s);
  return s;
}

async function getJson(url: string) {
  const res = await fetch(url);
  return { res, body: (await res.json()) as Record<string, unknown> };
}

describe('중계 서버 — 방·격리·거부', () => {
  it('방 열기(6자리) → 학생 3명 입장 → host.all 3명 수신 → 학생 메시지는 호스트만 → 두 번째 방과 격리', async () => {
    const s = await boot();
    const A = await openRoom(s.url);
    expect(A.code).toMatch(/^[1-9]\d{5}$/);
    expect(A.hostToken).toMatch(/^[0-9a-f]{32}$/);

    const studentsA = [];
    for (let i = 1; i <= 3; i++) studentsA.push(await joinAndAdmit(s.url, A.host, A.code, { seat: i, company: `해오름무역${i}` }));

    const B = await openRoom(s.url);
    expect(B.code).not.toBe(A.code);
    const studentB = await joinAndAdmit(s.url, B.host, B.code, { seat: 1, company: '달빛상사' });

    // 전체 메시지: A 학생 3명만
    A.host.send({ t: 'host.all', msg: { kind: 'public', round: 1 } });
    for (const st of studentsA) {
      const m = await st.peer.waitT('host.all');
      expect(m.msg).toEqual({ kind: 'public', round: 1 });
    }
    // 학생 메시지: A 호스트만
    studentsA[0]!.peer.send({ t: 'peer.msg', msg: { act: 'buy', n: 3 } });
    const got = await A.host.wait((m) => m.t === 'peer.msg');
    expect(got).toMatchObject({ peerId: studentsA[0]!.peerId, msg: { act: 'buy', n: 3 } });

    // 개인 메시지는 그 학생만
    A.host.send({ t: 'host.to', peerId: studentsA[1]!.peerId, msg: { kind: 'me', cash: 10 } });
    await studentsA[1]!.peer.waitT('host.to');

    // B 방에서 보낸 것은 A에 안 감
    B.host.send({ t: 'host.all', msg: { kind: 'public', room: 'B' } });
    studentB.peer.send({ t: 'peer.msg', msg: { act: 'sell' } });
    await studentB.peer.wait((m) => m.t === 'host.all' && (m.msg as { room?: string }).room === 'B');
    await B.host.wait((m) => m.t === 'peer.msg');
    await sleep(100);

    expect(studentB.peer.count('host.all')).toBe(1); // A의 전체 메시지를 받지 않음
    for (const st of studentsA) {
      expect(st.peer.msgs.filter((m) => m.t === 'host.all').every((m) => (m.msg as { room?: string }).room === undefined)).toBe(true);
      expect(st.peer.count('peer.msg')).toBe(0); // 다른 학생 메시지를 받지 않음
    }
    expect(studentsA[0]!.peer.count('host.to')).toBe(0);
    expect(studentsA[2]!.peer.count('host.to')).toBe(0);
    expect(A.host.msgs.filter((m) => m.t === 'peer.msg')).toHaveLength(1);
    expect(B.host.msgs.filter((m) => m.t === 'peer.msg')).toHaveLength(1);
  });

  it('요청 id(rid)를 응답에 그대로 돌려준다', async () => {
    const s = await boot();
    const h = await connect(s.url);
    h.send({ t: 'host.open', maxPeers: 30, rid: 'r1' });
    expect(await h.waitT('room.opened')).toMatchObject({ rid: 'r1' });
    h.send({ t: 'server.stats', rid: 'r2' });
    expect(await h.waitT('server.stats')).toMatchObject({ rid: 'r2', rooms: 1, maxRooms: 50 });
    const p = await connect(s.url);
    p.send({ t: 'peer.join', code: '999999', hello: {}, rid: 'j1' });
    expect(await p.waitT('error')).toMatchObject({ code: 'NO_ROOM', req: 'peer.join', rid: 'j1' });
    h.send({ t: 'host.close', rid: 'c1' });
    expect(await h.waitT('room.closed')).toMatchObject({ reason: 'closed', rid: 'c1' });
  });

  it('허용되지 않은 Origin·Origin 없음은 ORIGIN 오류 후 4007로 끊는다', async () => {
    const s = await boot();
    const bad = await connect(s.url, { origin: 'https://evil.example' });
    expect(await bad.waitT('error')).toMatchObject({ code: 'ORIGIN' });
    expect(await bad.closed).toBe(4007);
    const none = await connect(s.url, { origin: null });
    expect(await none.closed).toBe(4007);
    // 운영 출처만 허용(ALLOW_LOCALHOST 없이)
    const prod = await boot({ ALLOW_LOCALHOST: '0', ALLOWED_ORIGINS: 'https://lab.ches.es.kr' });
    const local = await connect(prod.url);
    expect(await local.closed).toBe(4007);
    const ok = await connect(prod.url, { origin: 'https://lab.ches.es.kr' });
    ok.send({ t: 'ping', at: 1 });
    expect(await ok.waitT('pong')).toMatchObject({ at: 1 });
    expect(prod.server.health().conns).toBe(1);
  });

  it('없는 코드로 계속 입장하면 30번 실패 뒤 RATE_LIMITED(서버 시작 뒤 resumeGrace가 지난 뒤)', async () => {
    const s = await boot({ RESUME_GRACE: '1' });
    await sleep(1100);
    const p = await connect(s.url);
    for (let i = 0; i < 31; i++) p.send({ t: 'peer.join', code: String(100000 + i), hello: {} });
    await p.wait(() => p.count('error') >= 31);
    const errs = p.msgs.filter((m) => m.t === 'error').map((m) => m.code);
    expect(errs.slice(0, 30).every((c) => c === 'NO_ROOM')).toBe(true);
    expect(errs[30]).toBe('RATE_LIMITED');
    expect(s.server.health().blockedIps).toBe(1);
  });

  it('64KB를 넘는 메시지는 1009로 끊는다', async () => {
    const s = await boot();
    const { host } = await openRoom(s.url);
    host.send({ t: 'host.all', msg: { big: 'x'.repeat(70_000) } });
    expect(await host.closed).toBe(1009);
    await sleep(50);
    expect(s.server.health().rooms).toBe(1); // 방은 남는다(호스트 부재 유예)
  });

  it('45초(테스트에서는 짧게) 동안 pong이 없으면 끊는다', async () => {
    const s = await boot({}, { heartbeatMs: 80, heartbeatTimeoutMs: 250 });
    const silent = await connect(s.url, { autoPong: false });
    const alive = await connect(s.url);
    const code = await silent.closed;
    expect(code).toBe(1006);
    await sleep(300);
    expect(alive.closeCode).toBeNull();
  });
});

describe('중계 서버 — /health·/notice·로그', () => {
  it('/health: 형식·헤더, 방 코드·IP·이름 없음', async () => {
    const s = await boot();
    const { host, code } = await openRoom(s.url, { realIp: '203.0.113.45' });
    await joinAndAdmit(s.url, host, code, { seat: 7, company: '비밀상회' });
    const { res, body } = await getJson(`${s.http}/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(Object.keys(body)).toEqual([
      'ok',
      'version',
      'uptimeSec',
      'rooms',
      'maxRooms',
      'acceptingNewRooms',
      'peers',
      'conns',
      'maxConn',
      'memMB',
      'notice',
      'blockedIps',
      'joinFailPerMin',
    ]);
    expect(body).toMatchObject({ ok: true, rooms: 1, maxRooms: 50, acceptingNewRooms: true, peers: 1, conns: 2, maxConn: 2300, notice: null });
    const text = JSON.stringify(body);
    expect(text).not.toContain(code);
    expect(text).not.toContain('203.0.113');
    expect(text).not.toContain('비밀상회');
    // 그 밖 경로
    expect((await fetch(`${s.http}/`)).status).toBe(404);
    expect((await fetch(`${s.http}/ws`)).status).toBe(404);
    expect((await fetch(`${s.http}/health`, { method: 'POST' })).status).toBe(405);
  });

  it('로그에 방 코드 전체·이름·메시지 내용·IP 전체가 없다(코드는 앞 2자리)', async () => {
    const s = await boot({}, { statsLogMs: 100 });
    const { host, code } = await openRoom(s.url, { realIp: '198.51.100.77' });
    const { peer } = await joinAndAdmit(s.url, host, code, { seat: 3, company: '푸른바다무역' });
    peer.send({ t: 'peer.msg', msg: { secret: '내용비밀123' } });
    await host.waitT('peer.msg');
    const bad = await connect(s.url, { origin: 'https://evil.example' });
    await bad.closed;
    host.send({ t: 'host.close' });
    await host.waitT('room.closed');
    await sleep(250); // 1분 집계(테스트 100ms) 한 번 이상
    const all = s.logs.join('\n');
    expect(all).not.toContain(code);
    expect(all).toContain(`"code":"${maskCode(code)}"`);
    expect(all).not.toContain('푸른바다무역');
    expect(all).not.toContain('내용비밀123');
    expect(all).not.toContain('198.51.100.77');
    // 접속 IP(로컬 127.0.0.1)도 남기지 않는다 — 시작 설정 요약(HOST·TRUST_PROXY 값)만 예외
    expect(s.logs.filter((l) => !l.includes('"msg":"start"')).join(' ')).not.toContain('127.0.0.1');
    const stats = s.logs.map((l) => JSON.parse(l) as Record<string, unknown>).filter((l) => l.msg === 'stats');
    expect(stats.length).toBeGreaterThan(0);
    const counts = stats.reduce<Record<string, number>>((acc, l) => {
      for (const [k, v] of Object.entries(l.counts as Record<string, number>)) acc[k] = (acc[k] ?? 0) + v;
      return acc;
    }, {});
    expect(counts.ORIGIN).toBe(1);
    expect(counts.roomsOpened).toBe(1);
    expect(counts.roomsClosed).toBe(1);
    // 모든 줄이 JSON 한 줄
    for (const l of s.logs) expect(() => JSON.parse(l)).not.toThrow();
  });

  it('/notice 형식 → 공지 파일 바꾸고 다시 읽기(SIGHUP) → 연결된 클라이언트가 server.notice 받음', async () => {
    const s = await boot();
    expect((await getJson(`${s.http}/notice`)).body).toEqual({ level: null });
    const c = await connect(s.url);
    expect(await c.waitT('server.notice')).toMatchObject({ level: null });

    const until = new Date(Date.now() + 3600_000).toISOString();
    s.writeNotice({ level: 'warn', text: '내일 17시에 점검이 있어요.', until });
    s.server.reloadNotice();
    const n = await c.wait((m) => m.t === 'server.notice' && m.level === 'warn');
    expect(n).toMatchObject({ text: '내일 17시에 점검이 있어요.', until });
    const { res, body } = await getJson(`${s.http}/notice`);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(body).toEqual({ level: 'warn', text: '내일 17시에 점검이 있어요.', until });
    expect(s.server.health().notice).toBe('warn');

    // 80자 넘으면 자름
    s.writeNotice({ level: 'info', text: '가'.repeat(120) });
    s.server.reloadNotice();
    expect(((await getJson(`${s.http}/notice`)).body.text as string).length).toBe(80);

    // 파일 지우기(빈 파일) → 공지 없음
    s.writeNotice(null);
    s.server.reloadNotice();
    await c.wait((m) => m.t === 'server.notice' && m.level === null && c.count('server.notice') >= 4);
    expect((await getJson(`${s.http}/notice`)).body).toEqual({ level: null });
  });

  it('잘못된 JSON 공지 파일 → 공지 없음 + 경고 로그 + 서버 계속 동작', async () => {
    const s = await boot();
    s.writeNotice('{ level: "warn", 따옴표 없음');
    const r = s.server.reloadNotice();
    expect(r.status).toBe('bad_json');
    expect((await getJson(`${s.http}/notice`)).body).toEqual({ level: null });
    expect(s.logs.some((l) => l.includes('"msg":"notice.invalid"') && l.includes('"level":"warn"'))).toBe(true);
    s.writeNotice({ level: 'loud', text: '모르는 단계' });
    expect(s.server.reloadNotice().status).toBe('bad_fields');
    const { host, code } = await openRoom(s.url);
    expect(code).toMatch(/^\d{6}$/);
    host.send({ t: 'ping', at: 5 });
    await host.waitT('pong');
  });

  it('blockNewRooms:true → 새 방 MAINTENANCE, 기존 방 메시지는 정상, acceptingNewRooms false', async () => {
    const s = await boot();
    const { host, code } = await openRoom(s.url);
    const { peer } = await joinAndAdmit(s.url, host, code, { seat: 1 });
    s.writeNotice({ level: 'maintenance', text: '17시~18시 서버 점검 중이에요.', blockNewRooms: true });
    s.server.reloadNotice();
    await host.wait((m) => m.t === 'server.notice' && m.level === 'maintenance');
    expect(s.server.health().acceptingNewRooms).toBe(false);
    expect((await getJson(`${s.http}/health`)).body.acceptingNewRooms).toBe(false);

    const h2 = await connect(s.url);
    h2.send({ t: 'host.open', maxPeers: 30 });
    expect(await h2.waitT('error')).toMatchObject({ code: 'MAINTENANCE', req: 'host.open', text: '17시~18시 서버 점검 중이에요.' });

    host.send({ t: 'host.all', msg: { still: 'ok' } });
    expect((await peer.waitT('host.all')).msg).toEqual({ still: 'ok' });
    peer.send({ t: 'peer.msg', msg: { a: 1 } });
    await host.waitT('peer.msg');

    s.writeNotice(null);
    s.server.reloadNotice();
    expect(s.server.health().acceptingNewRooms).toBe(true);
  });

  it('acceptingNewRooms: 처음 true → MAX_ROOMS=2에서 방 2개면 false → 하나 닫으면 true', async () => {
    const s = await boot({ MAX_ROOMS: '2', MAX_CONN: '92' });
    expect((await getJson(`${s.http}/health`)).body).toMatchObject({ acceptingNewRooms: true, maxRooms: 2, rooms: 0 });
    const a = await openRoom(s.url);
    await openRoom(s.url);
    expect((await getJson(`${s.http}/health`)).body).toMatchObject({ acceptingNewRooms: false, rooms: 2 });
    const c = await connect(s.url);
    c.send({ t: 'host.open', maxPeers: 30 });
    expect(await c.waitT('error')).toMatchObject({ code: 'BUSY', rooms: 2, maxRooms: 2 });
    a.host.send({ t: 'host.close' });
    await a.host.waitT('room.closed');
    expect((await getJson(`${s.http}/health`)).body).toMatchObject({ acceptingNewRooms: true, rooms: 1 });
  });

  it('기본 설정: 50방이 찬 뒤 51번째 host.open → BUSY, /health acceptingNewRooms:false, 같은 IP 11번째 방 → ROOM_LIMIT', async () => {
    // 한 PC에서 여러 학교를 흉내: TRUST_PROXY(127.0.0.1)에서 온 연결의 X-Real-IP를 서로 다르게
    const s = await boot();
    const hosts = [];
    for (let school = 0; school < 5; school++) {
      for (let i = 0; i < 10; i++) hosts.push(await openRoom(s.url, { realIp: `10.0.${school}.1` }));
    }
    expect(s.server.health()).toMatchObject({ rooms: 50, maxRooms: 50, acceptingNewRooms: false });
    const extra = await connect(s.url, { realIp: '10.0.9.1' });
    extra.send({ t: 'host.open', maxPeers: 30 });
    expect(await extra.waitT('error')).toMatchObject({ code: 'BUSY', rooms: 50, maxRooms: 50 });
    expect((await getJson(`${s.http}/health`)).body.acceptingNewRooms).toBe(false);
    // 한 방을 닫으면 다시 받음 → 같은 IP(10.0.0.1)의 11번째는 ROOM_LIMIT이 아니라 10번째가 된다. 다른 IP로 확인
    hosts[49]!.host.send({ t: 'host.close' });
    await hosts[49]!.host.waitT('room.closed');
    const same = await connect(s.url, { realIp: '10.0.0.1' });
    same.send({ t: 'host.open', maxPeers: 30 });
    expect(await same.waitT('error')).toMatchObject({ code: 'ROOM_LIMIT' });
    expect(s.server.health().acceptingNewRooms).toBe(true);
  }, 20_000);
});

describe('중계 서버 — 재시작(SIGTERM)', () => {
  it('shutdown → server.restarting 수신·1012로 끊김 → 새 서버에서 같은 코드로 다시 열기', async () => {
    const s1 = await startTestServer({}, { shutdownGraceMs: 150 });
    const { host, code, hostToken } = await openRoom(s1.url);
    const { peer } = await joinAndAdmit(s1.url, host, code, { seat: 1 });
    const down = s1.server.shutdown();
    await host.waitT('server.restarting');
    await peer.waitT('server.restarting');
    expect(s1.server.health().ok).toBe(false);
    // 종료 중 새 연결 거부
    await expect(connect(s1.url)).rejects.toBeTruthy();
    await down;
    expect(await host.closed).toBe(1012);
    await s1.stop();

    const s2 = await boot();
    const h2 = await connect(s2.url);
    h2.send({ t: 'host.open', maxPeers: 40, wantCode: code, hostToken });
    expect(await h2.waitT('room.opened')).toMatchObject({ code, hostToken });
    const p2 = await connect(s2.url);
    p2.send({ t: 'peer.join', code, hello: { seat: 1 } });
    await p2.waitT('peer.pending');
  });
});

describe('설정(환경 변수)', () => {
  it('기본값이 docs/server-setup.md v0.3 3.3과 같다', () => {
    const cfg = loadServerConfig({});
    expect(cfg.host).toBe('127.0.0.1');
    expect(cfg.port).toBe(8787);
    expect(cfg.allowedOrigins).toEqual(['https://lab.ches.es.kr']);
    expect(cfg.trustProxy).toEqual(['127.0.0.1']);
    expect(cfg.noticeFile).toBe('/etc/voyage-relay.notice.json');
    expect(cfg.logLevel).toBe('info');
    expect(cfg.allowLocalhost).toBe(false);
    expect(SERVER_DEFAULTS.PORT).toBe(8787);
    // 3.3 표 그대로
    const table: Record<string, number> = {
      MAX_ROOMS: 50,
      MAX_PEERS: 45,
      MAX_CONN: 2300,
      MAX_CONN_PER_IP: 500,
      MAX_ROOMS_PER_IP: 10,
      ROOM_CREATE_LIMIT: 20,
      ROOM_CREATE_WINDOW: 3600,
      EMPTY_ROOM_TTL: 1200,
      UNJOINED_TIMEOUT: 30,
      MSG_RATE: 20,
      MSG_BURST: 40,
      HOST_MSG_RATE: 120,
      HOST_MSG_BURST: 240,
      MAX_MSG_BYTES: 65536,
      JOIN_FAIL_LIMIT: 30,
      JOIN_FAIL_WINDOW: 300,
      JOIN_BLOCK_SEC: 120,
      JOIN_BLOCK_MAX: 1800,
      IDLE_TTL: 1800,
      HOST_GRACE: 1800,
      MAX_ROOM_AGE: 28800,
      RESUME_GRACE: 600,
      CODE_REUSE_BLOCK: 7200,
    };
    const fromCfg: Record<string, number> = {};
    for (const [key, name] of Object.entries(RELAY_CONFIG_ENV)) fromCfg[name] = cfg.relay[key as keyof typeof DEFAULT_RELAY_CONFIG];
    expect(fromCfg).toEqual(table);
  });

  it('deploy/env.example을 그대로 읽으면 기본값과 같다(RESUME_GRACE 포함)', () => {
    const text = readFileSync(new URL('../../deploy/env.example', import.meta.url), 'utf8');
    const env: Record<string, string> = {};
    for (const line of text.split('\n')) {
      const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
      if (m) env[m[1]!] = m[2]!;
    }
    expect(env.RESUME_GRACE).toBe('600');
    for (const name of Object.values(RELAY_CONFIG_ENV)) expect(env[name], name).toBeDefined();
    const cfg = loadServerConfig(env);
    expect(cfg.relay).toEqual(loadServerConfig({}).relay);
    expect(cfg.allowedOrigins).toEqual(['https://lab.ches.es.kr']);
  });

  it('환경 변수를 읽고, 잘못된 값이면 이유를 모아 ConfigError', () => {
    const cfg = loadServerConfig({ MAX_ROOMS: '30', MAX_CONN: '1400', ALLOWED_ORIGINS: 'https://a.kr, https://b.kr/', RESUME_GRACE: '900' });
    expect(cfg.relay.maxRooms).toBe(30);
    expect(cfg.relay.maxConn).toBe(1400);
    expect(cfg.relay.resumeGrace).toBe(900);
    expect(cfg.allowedOrigins).toEqual(['https://a.kr', 'https://b.kr']);
    try {
      loadServerConfig({ MAX_ROOMS: 'abc', PORT: '70000', ALLOWED_ORIGINS: 'lab.ches.es.kr/voyage', LOG_LEVEL: 'loud', MSG_RATE: '-1' });
      throw new Error('통과하면 안 됨');
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      const p = (e as ConfigError).problems.join('\n');
      expect(p).toContain('MAX_ROOMS');
      expect(p).toContain('PORT');
      expect(p).toContain('ALLOWED_ORIGINS');
      expect(p).toContain('LOG_LEVEL');
      expect(p).toContain('MSG_RATE');
    }
  });

  it('출처·클라이언트 IP·가리기', () => {
    const cfg = { allowedOrigins: ['https://lab.ches.es.kr'], allowLocalhost: false };
    expect(originAllowed(cfg, 'https://lab.ches.es.kr')).toBe(true);
    expect(originAllowed(cfg, 'http://localhost:5173')).toBe(false);
    expect(originAllowed({ ...cfg, allowLocalhost: true }, 'http://localhost:5173')).toBe(true);
    expect(originAllowed({ ...cfg, allowLocalhost: true }, 'http://127.0.0.1:4173')).toBe(true);
    expect(originAllowed({ ...cfg, allowLocalhost: true }, 'http://localhost.evil.com')).toBe(false);
    expect(originAllowed(cfg, undefined)).toBe(false);
    // TRUST_PROXY에서 온 연결만 X-Real-IP를 믿음
    expect(clientIp(['127.0.0.1'], '::ffff:127.0.0.1', '1.2.3.4')).toBe('1.2.3.4');
    expect(clientIp(['127.0.0.1'], '5.6.7.8', '1.2.3.4')).toBe('5.6.7.8');
    expect(clientIp(['127.0.0.1'], '127.0.0.1', 'not-an-ip')).toBe('127.0.0.1');
    expect(maskIp('203.0.113.45')).toBe('203.0.113.x');
    expect(maskIp('2001:db8:1:2::5')).toBe('2001:db8:1:x');
    expect(maskCode('482913')).toBe('48xxxx');
  });
});

describe('중계 서버 — relay-core 예외 격리(보강)', () => {
  it('relay-core가 한 연결 처리 중 던지면 그 연결만 1011로 닫고, 다른 방 연결·서버는 계속 동작', async () => {
    let boom = '';
    const s = await boot({}, {}, {
      wrapCore: (core) => ({
        ...core,
        onMessage(id, raw) {
          if (boom && raw.includes(boom)) throw new TypeError('주입한 오류');
          core.onMessage(id, raw);
        },
      }),
    });
    const A = await openRoom(s.url);
    const a1 = await joinAndAdmit(s.url, A.host, A.code, { seat: 1, company: '터지는상사' });
    const B = await openRoom(s.url);
    const b1 = await joinAndAdmit(s.url, B.host, B.code, { seat: 1 });

    boom = 'BOOM-마커';
    a1.peer.send({ t: 'peer.msg', msg: { x: 'BOOM-마커' } });
    expect(await a1.peer.closed).toBe(1011);

    // 다른 방은 그대로
    B.host.send({ t: 'host.all', msg: { ok: 1 } });
    expect((await b1.peer.waitT('host.all')).msg).toEqual({ ok: 1 });
    b1.peer.send({ t: 'peer.msg', msg: { y: 2 } });
    await B.host.waitT('peer.msg');
    // 같은 방 호스트도 유지, 학생이 나간 것으로 처리됨
    await A.host.wait((m) => m.t === 'peer.left');
    expect(A.host.closeCode).toBeNull();
    expect(s.server.health()).toMatchObject({ ok: true, rooms: 2, conns: 3 }); // 호스트 2 + B 학생 1
    // 로그: 오류 종류·스택만, 내용·이름 없음
    const line = s.logs.find((l) => l.includes('"msg":"core.error"'))!;
    expect(line).toContain('"where":"onMessage"');
    expect(line).toContain('"err":"TypeError"');
    expect(line).not.toContain('BOOM');
    expect(line).not.toContain('주입한 오류');
    expect(line).not.toContain('터지는상사');
  });
});
