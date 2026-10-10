import { describe, expect, it } from 'vitest';
import type { JsonObject } from '../../src/sync/adapter';
import { findSeatKeys } from '../../src/sync/app-messages';
import { joinMany, makeWorld, newToyGame, type HostRig, type StudentRig, type World } from './session-helpers';

async function openRoom(w: World, game = newToyGame()) {
  const h = w.host();
  const r = await h.session.open({ game });
  if (!r.ok) throw new Error(r.error);
  return { h, code: r.code };
}

const peerIdOf = (s: StudentRig) => s.transport.currentPeerId() as string;
const msgsTo = (h: HostRig, peerId: string) => h.sentTo.filter((x) => x.peerId === peerId).map((x) => x.msg);

describe('호스트 1 + 학생 30', () => {
  it('입장 → 행동 10개씩 → 모두 ack, 개인 상태는 본인에게만, 공개 상태 1초에 1번 이하·출석번호 없음', async () => {
    const w = makeWorld();
    const { h, code } = await openRoom(w);
    const students = await joinMany(w, code, 30);
    for (const s of students) expect(s.session.getState().status).toBe('in');
    expect(h.session.getView().seats).toHaveLength(30);

    const acks: Record<number, number> = {};
    for (let k = 0; k < 10; k++) {
      for (const s of students) expect(s.session.act({ type: 'buy', n: 1 })).toBe('sent');
      // 낙관적 표시: ack 전에 이미 줄어 있음
      expect(students[0]!.session.getState().me?.money).toBe(100 - (k + 1));
      await w.advance(100);
    }
    // 학생 30명이 0.1초마다 행동 → 호스트는 서버 속도 상한(초당 18) 안에서 묶어 보냄 → 조금 기다리면 모두 도착
    await w.advance(6000);
    for (const s of students) {
      const st = s.session.getState();
      acks[st.seat as number] = s.received.filter((m) => m.t === 'ack' && m.ok === true).length;
      expect(acks[st.seat as number]).toBe(10);
      expect(st.pendingCount).toBe(0);
      expect(st.me?.money).toBe(90);
      expect((st.public as JsonObject).total).toBe(30 * 90);
    }

    // 개인 상태(state.me)는 그 학생 연결로만: A의 pid가 담긴 state.me는 A의 peerId로만 감
    const pidToPeer = new Map(students.map((s) => [s.session.getState().pid as string, peerIdOf(s)]));
    const meMsgs = h.sentTo.filter((x) => x.msg.t === 'state.me');
    expect(meMsgs.length).toBeGreaterThanOrEqual(60); // 못 보낸 옛 state.me는 새것으로 바뀌므로 330보다 적다
    for (const x of meMsgs) {
      const data = x.msg.data as { pid: string };
      expect(x.peerId).toBe(pidToPeer.get(data.pid));
    }
    // 학생 B가 받은 메시지에 A의 비공개 값이 없음
    const a = students[0]!.session.getState().pid as string;
    for (const s of students.slice(1)) expect(JSON.stringify(s.received)).not.toContain(`비밀-${a}`);

    // 공개 상태 브로드캐스트: 비공개 필드·출석번호 없음, 1초에 1번 이하
    const pubs = h.broadcasts.filter((b) => b.msg.t === 'state.public');
    expect(pubs.length).toBeGreaterThan(1);
    for (const b of pubs) {
      expect(JSON.stringify(b.msg)).not.toContain('비밀-');
      expect(findSeatKeys(b.msg)).toEqual([]);
    }
    for (let i = 1; i < pubs.length; i++) expect(pubs[i]!.at - pubs[i - 1]!.at).toBeGreaterThanOrEqual(1000);
    // 변경분(patch)도 쓰임
    expect(pubs.some((b) => 'patch' in b.msg)).toBe(true);
    // 교사 저장소에는 판 전체가, 학생 저장소에는 자기 것만
    expect(h.storage.getItem(`voyage.host.${code}`)).toContain('비밀-');
    for (const s of students.slice(1)) expect([...s.storage.map.values()].join('')).not.toContain(`비밀-${a}`);
    h.session.dispose();
  });

  it('같은 seq가 다시 오면 같은 ack(멱등)', async () => {
    const w = makeWorld();
    const { h, code } = await openRoom(w);
    const [s] = await joinMany(w, code, 1);
    s!.transport.send({ t: 'act', seq: 1, action: { type: 'buy', n: 200 } }); // 거절(NO_MONEY)
    await w.advance(100);
    s!.transport.send({ t: 'act', seq: 1, action: { type: 'buy', n: 1 } }); // 같은 seq → 같은 거절 ack, 다시 처리 안 함
    await w.advance(100);
    const acks = s!.received.filter((m) => m.t === 'ack');
    expect(acks).toHaveLength(2);
    expect(acks[0]).toEqual(acks[1]);
    expect(acks[0]).toMatchObject({ seq: 1, ok: false, error: 'NO_MONEY' });
    expect(h.session.getView().game?.players.s01?.money).toBe(100);
    h.session.dispose();
  });
});

describe('입장 판정 5단계 (PRD 7.2, v0.3.1)', () => {
  it('③ 새 좌석: pid 발급(6자), 출석번호는 본인 admitted에만', async () => {
    const w = makeWorld();
    const { h, code } = await openRoom(w);
    const s = w.student();
    await s.session.join(code, 7, '해오름 무역');
    await w.advance(200);
    const st = s.session.getState();
    expect(st).toMatchObject({ status: 'in', seat: 7, companyName: '해오름 무역', admitMode: 'new' });
    expect(st.pid).toMatch(/^[a-z0-9]{6}$/);
    expect(s.store.load()).toMatchObject({ code, seat: 7, companyName: '해오름 무역' });
    expect(h.session.getView().seats[0]).toMatchObject({ seat: 7, companyName: '해오름 무역', online: true });
    h.session.dispose();
  });

  it('② 같은 기기: 다른 번호·이름을 입력해도 자기 회사로(same-device)', async () => {
    const w = makeWorld();
    const { h, code } = await openRoom(w);
    const storage = (await joinMany(w, code, 1))[0]!.storage;
    const again = w.student({ storage });
    await again.session.join(code, 12, '전혀다른이름');
    await w.advance(200);
    expect(again.session.getState()).toMatchObject({ status: 'in', seat: 1, admitMode: 'same-device' });
    expect(h.session.getView().seats).toHaveLength(1);
    h.session.dispose();
  });

  it('④ 같은 번호·같은 이름·다른 기기 → 요청(옛 기기 접속 중이어도) → 승인: 새 기기 approved, 옛 기기 moved·행동 거부', async () => {
    const w = makeWorld();
    const { h, code } = await openRoom(w);
    const old = w.student();
    await old.session.join(code, 7, '해오름무역');
    await w.advance(200);
    const nu = w.student();
    await nu.session.join(code, 7, '해오름 무역');
    await w.advance(200);
    expect(nu.session.getState().status).toBe('waitingApproval');
    const req = h.session.getView().rejoinRequests;
    expect(req).toEqual([expect.objectContaining({ seat: 7, companyName: '해오름무역', oldOnline: true })]);
    // 손님 연결에는 개인 상태가 가지 않음
    expect(msgsTo(h, peerIdOf(nu)).some((m) => m.t === 'state.me')).toBe(false);

    expect(h.session.approveRejoin(7)).toBe(true);
    await w.advance(200);
    expect(nu.session.getState()).toMatchObject({ status: 'in', seat: 7, admitMode: 'approved' });
    expect(nu.session.getState().me?.money).toBe(100);
    expect(old.session.getState().status).toBe('moved');
    expect(old.store.load()).toBeNull();
    expect(old.session.act({ type: 'buy', n: 1 })).toBe('notIn');
    // 옛 연결이 억지로 보내도 거부
    old.transport.send({ t: 'act', seq: 99, action: { type: 'buy', n: 5 } });
    await w.advance(100);
    expect(old.received.find((m) => m.t === 'ack' && m.seq === 99)).toMatchObject({ ok: false, error: 'MOVED' });
    expect(h.session.getView().game?.players.s07?.money).toBe(100);
    expect(h.session.getView().rejoinRequests).toEqual([]);
    h.session.dispose();
  });

  it('④ 거절 → rejoin.denied, 다시 요청 가능', async () => {
    const w = makeWorld();
    const { h, code } = await openRoom(w);
    await joinMany(w, code, 1);
    const name = h.session.getView().seats[0]!.companyName;
    const nu = w.student();
    await nu.session.join(code, 1, name);
    await w.advance(200);
    expect(h.session.denyRejoin(1)).toBe(true);
    await w.advance(100);
    expect(nu.session.getState()).toMatchObject({ status: 'idle', errorCode: 'REJOIN_DENIED' });
    nu.session.requestRejoin();
    await w.advance(100);
    expect(nu.session.getState().status).toBe('waitingApproval');
    expect(h.session.getView().rejoinRequests).toHaveLength(1);
    h.session.dispose();
  });

  it('⑤ 같은 번호·다른 이름 → SEAT_TAKEN(원래 회사 이름 없음) + 입장 문제 목록, [이 기기를 7번 회사로 연결]', async () => {
    const w = makeWorld();
    const { h, code } = await openRoom(w);
    const owner = w.student();
    await owner.session.join(code, 7, '해오름무역');
    await w.advance(200);
    const other = w.student();
    const rejected: string[] = [];
    other.transport.onRoomEvent((e) => {
      if (e.type === 'rejected') rejected.push(e.reason);
    });
    await other.session.join(code, 7, '바다상사');
    await w.advance(200);
    await other.session.join(code, 7, '바다상사');
    await w.advance(200);
    expect(other.session.getState()).toMatchObject({ status: 'idle', errorCode: 'SEAT_TAKEN' });
    expect(rejected).toEqual(['SEAT_TAKEN', 'SEAT_TAKEN']);
    expect(JSON.stringify(other.received)).not.toContain('해오름');
    const probs = h.session.getView().joinProblems;
    expect(probs).toHaveLength(1);
    expect(probs[0]).toMatchObject({ seat: 7, attempts: 2 });
    expect(Object.keys(probs[0]!).sort()).toEqual(['attempts', 'lastAt', 'peerId', 'seat']);

    // 교사가 이 기기를 7번 회사로 연결 → 옛 기기 moved, 학생이 다시 들어가면 ②로 7번 회사
    expect(h.session.bindDeviceToSeat(probs[0]!.peerId, 7)).toBe(true);
    await w.advance(100);
    expect(owner.session.getState().status).toBe('moved');
    await other.session.join(code, 7, '바다상사');
    await w.advance(200);
    expect(other.session.getState()).toMatchObject({ status: 'in', seat: 7, companyName: '해오름무역', admitMode: 'same-device' });
    expect(h.session.getView().joinProblems).toEqual([]);
    h.session.dispose();
  });

  it('입장 마감: 새 번호 LOCKED, 재입장은 허용', async () => {
    const w = makeWorld();
    const { h, code } = await openRoom(w);
    const [a] = await joinMany(w, code, 1);
    h.session.setLocked(true);
    const late = w.student();
    await late.session.join(code, 9, '늦은무역');
    await w.advance(200);
    expect(late.session.getState()).toMatchObject({ status: 'idle', errorCode: 'LOCKED' });
    // 같은 기기 새로 고침은 들어옴
    const again = w.student({ storage: a!.storage });
    expect(again.session.autoRejoin()).toBe(true);
    await w.advance(200);
    expect(again.session.getState()).toMatchObject({ status: 'in', admitMode: 'same-device' });
    h.session.dispose();
  });

  it('내보내기: kicked → 같은 토큰 재입장 KICKED, 번호는 비워짐', async () => {
    const w = makeWorld();
    const { h, code } = await openRoom(w);
    const [a] = await joinMany(w, code, 1);
    expect(h.session.kick(1)).toBe(true);
    await w.advance(100);
    expect(a!.session.getState().status).toBe('kicked');
    expect(h.session.getView().seats).toEqual([]);
    const again = w.student({ storage: a!.storage });
    await again.session.join(code, 2, '다른무역');
    await w.advance(200);
    expect(again.session.getState().status).toBe('kicked');
    // 다른 기기는 그 번호에 새로 들어올 수 있음
    const b = w.student();
    await b.session.join(code, 1, '새회사');
    await w.advance(200);
    expect(b.session.getState()).toMatchObject({ status: 'in', seat: 1, admitMode: 'new' });
    h.session.dispose();
  });

  it('회사 이름 거절: 금칙어 BAD_NAME, 중복 NAME_TAKEN + 제안, 형식 NAME_FORMAT(호스트 판정)', async () => {
    const w = makeWorld();
    const { h, code } = await openRoom(w);
    const a = w.student();
    await a.session.join(code, 1, '해오름무역');
    await w.advance(200);
    const b = w.student();
    await b.session.join(code, 2, '해오름 무역');
    await w.advance(200);
    expect(b.session.getState()).toMatchObject({ status: 'idle', errorCode: 'NAME_TAKEN' });
    expect(b.session.getState().suggestions).toEqual(['해오름 무역2', '해오름 무역3']);
    // 학생 기기 미리 검사를 건너뛴 인사도 호스트가 막음
    b.transport.leave();
    const c = w.student();
    const rejected: string[] = [];
    c.transport.onRoomEvent((e) => e.type === 'rejected' && rejected.push(e.reason));
    for (const company of ['바1보상사', 'ㅋㅋ무역']) {
      await c.transport.join(code, { seat: 3, company, deviceToken: 'raw-device-0001', appVersion: 'v1' });
      await w.advance(100);
    }
    expect(rejected).toEqual(['BAD_NAME', 'NAME_FORMAT']);
    expect(h.session.getView().badNameRejects).toBe(1);
    h.session.dispose();
  });

  it('앱 버전이 다르면 version.mismatch(입장은 허용)', async () => {
    const w = makeWorld();
    const { h, code } = await openRoom(w);
    const s = w.student({ appVersion: 'v0' });
    await s.session.join(code, 4, '옛버전무역');
    await w.advance(200);
    expect(s.session.getState()).toMatchObject({ status: 'in', versionMismatch: true });
    h.session.dispose();
  });

  it('입장 실패 제한: 같은 토큰 거절 10번 뒤 11번째는 TOO_MANY_TRIES, 1분 뒤 풀림', async () => {
    const w = makeWorld();
    const { h, code } = await openRoom(w);
    const s = w.student();
    const rejected: string[] = [];
    s.transport.onRoomEvent((e) => e.type === 'rejected' && rejected.push(e.reason));
    for (let i = 0; i < 11; i++) {
      await s.transport.join(code, { seat: 41, company: '해오름', deviceToken: 'same-device-01', appVersion: 'v1' });
      await w.advance(100);
    }
    expect(rejected.slice(0, 10).every((r) => r === 'BAD_HELLO')).toBe(true);
    expect(rejected[10]).toBe('TOO_MANY_TRIES');
    // 막힌 동안에는 올바른 인사도 TOO_MANY_TRIES
    await s.transport.join(code, { seat: 5, company: '해오름', deviceToken: 'same-device-01', appVersion: 'v1' });
    await w.advance(100);
    expect(rejected[11]).toBe('TOO_MANY_TRIES');
    await w.advance(60_000);
    // 방 밖 연결은 서버가 30초 뒤 끊으므로(UNJOINED_TIMEOUT) 다시 연결
    w.net.reconnect(s.transport);
    await s.transport.join(code, { seat: 5, company: '해오름', deviceToken: 'same-device-01', appVersion: 'v1' });
    await w.advance(200);
    expect(rejected).toHaveLength(12);
    expect(h.session.getView().seats.map((x) => x.seat)).toEqual([5]);
    h.session.dispose();
  });
});

describe('교사의 회사 이름·번호 관리', () => {
  it('이름 막기 → name.blocked → 같은 이름 BAD_NAME → 새 이름 ok, 공개 상태에서 이름 짓는 중(null)', async () => {
    const w = makeWorld();
    const { h, code } = await openRoom(w, newToyGame('round'));
    const s = w.student();
    await s.session.join(code, 3, '나쁜이름무역');
    await w.advance(200);
    const events: string[] = [];
    s.session.onEvent((e) => events.push(e.type === 'nameResult' ? `nameResult:${e.ok}:${e.error ?? ''}` : e.type));
    // 무역 중(phase round)에는 학생 스스로 못 바꿈
    s.session.setCompanyName('새이름무역');
    await w.advance(100);
    expect(events).toEqual(['nameResult:false:NAME_LOCKED']);

    expect(h.session.blockCompanyName(3)).toBe(true);
    await w.advance(1100);
    expect(s.session.getState().nameStatus).toBe('blocked');
    expect(events).toContain('nameBlocked');
    const pub = s.session.getState().public as { companies: { name: string | null }[] };
    expect(pub.companies[0]!.name).toBeNull();

    s.session.setCompanyName('나쁜이름 무역');
    await w.advance(100);
    expect(events.at(-1)).toBe('nameResult:false:BAD_NAME');
    s.session.setCompanyName('착한바다');
    await w.advance(1100);
    expect(events.at(-1)).toBe('nameResult:true:');
    expect(s.session.getState()).toMatchObject({ companyName: '착한바다', nameStatus: 'ok' });
    expect(s.store.load()?.companyName).toBe('착한바다');
    expect(h.session.getView().seats[0]).toMatchObject({ companyName: '착한바다', nameStatus: 'ok' });
    // 다른 학생이 막힌 이름을 새로 쓸 수도 없음
    const t = w.student();
    await t.session.join(code, 4, '나쁜이름무역');
    await w.advance(200);
    expect(t.session.getState().errorCode).toBe('BAD_NAME');
    h.session.dispose();
  });

  it('이름 바꾸기 → 학생 name.changed·저장값 갱신, 금칙어는 경고만, 중복은 거절', async () => {
    const w = makeWorld();
    const { h, code } = await openRoom(w);
    const [a] = await joinMany(w, code, 2);
    expect(h.session.renameCompany(1, h.session.getView().seats[1]!.companyName)).toEqual({ ok: false, error: 'NAME_TAKEN' });
    expect(h.session.renameCompany(1, '푸른 바다')).toEqual({ ok: true, companyName: '푸른 바다' });
    await w.advance(100);
    expect(a!.session.getState().companyName).toBe('푸른 바다');
    expect(a!.store.load()?.companyName).toBe('푸른 바다');
    expect(h.session.renameCompany(1, '바보상사')).toEqual({ ok: true, companyName: '바보상사', warning: 'BAD_NAME' });
    h.session.dispose();
  });

  it('번호 바꾸기: 회사·토큰 그대로 빈 번호로, 학생 seat.changed', async () => {
    const w = makeWorld();
    const { h, code } = await openRoom(w);
    const [a] = await joinMany(w, code, 2);
    a!.session.act({ type: 'buy', n: 7 });
    await w.advance(100);
    expect(h.session.reassignSeat(1, 2)).toBe(false); // 빈 번호만
    expect(h.session.reassignSeat(1, 21)).toBe(true);
    await w.advance(100);
    expect(a!.session.getState()).toMatchObject({ seat: 21, status: 'in' });
    expect(a!.session.getState().me?.money).toBe(93);
    expect(a!.store.load()?.seat).toBe(21);
    expect(h.session.getView().seats.map((s) => s.seat)).toEqual([2, 21]);
    // 새로 고침해도 21번 회사로
    const again = w.student({ storage: a!.storage });
    again.session.autoRejoin();
    await w.advance(200);
    expect(again.session.getState()).toMatchObject({ seat: 21, admitMode: 'same-device' });
    h.session.dispose();
  });
});
