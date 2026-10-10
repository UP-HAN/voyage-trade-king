/** 124 수정 1회차: 호스트 연결 끊김 일시정지, 옮겨진 기기 hello.again 무시, 저장 실패 노출, 상한, 되돌림 순서 */
import { describe, expect, it } from 'vitest';
import { GUEST_MAX, JOIN_PROBLEM_MAX } from '../../src/sync/host-session';
import { joinMany, makeWorld, MemStorage, newToyGame, toyReducer, type World } from './session-helpers';

async function openRoom(w: World, opts: Parameters<World['host']>[0] = {}) {
  const h = w.host(opts);
  const r = await h.session.open({ game: newToyGame() });
  if (!r.ok) throw new Error(r.error);
  return { h, code: r.code };
}

describe('호스트 연결만 끊김 → 끊긴 동안 틱 정지, 다시 붙으면 hostGap', () => {
  it('20초 끊김 → gaps에 약 20000 1건, 끊긴 동안 시계 진행 없음', async () => {
    const w = makeWorld();
    const { h, code } = await openRoom(w);
    const [a] = await joinMany(w, code, 2);
    await w.advance(3000);
    const ticksBefore = h.session.getView().game!.ticks;
    expect(ticksBefore).toBeGreaterThan(0);
    w.net.disconnect(h.transport);
    await w.advance(20_000);
    expect(h.session.getView().game!.ticks).toBe(ticksBefore);
    expect(h.session.getView().disconnectedAt).not.toBeNull();
    expect(a!.session.getState().status).toBe('hostOffline');
    w.net.reconnect(h.transport);
    await w.advance(1500);
    const v = h.session.getView();
    expect(v.status).toBe('open');
    expect(v.disconnectedAt).toBeNull();
    expect(v.game!.gaps).toHaveLength(1);
    expect(v.game!.gaps[0]).toBeGreaterThanOrEqual(20_000);
    expect(v.game!.gaps[0]).toBeLessThan(20_500);
    expect(v.game!.ticks).toBeGreaterThan(ticksBefore); // 다시 흐름
    expect(a!.session.getState().status).toBe('in');
    h.session.dispose();
  });

  it('5초 미만 끊김은 hostGap 없음', async () => {
    const w = makeWorld();
    const { h, code } = await openRoom(w);
    await joinMany(w, code, 1);
    w.net.disconnect(h.transport);
    await w.advance(3000);
    w.net.reconnect(h.transport);
    await w.advance(1500);
    expect(h.session.getView().game!.gaps).toEqual([]);
    h.session.dispose();
  });

  it('끊긴 동안 서버 재시작 → 같은 코드로 다시 열림 + 끊긴 시간 hostGap', async () => {
    const w = makeWorld();
    const { h, code } = await openRoom(w);
    const students = await joinMany(w, code, 3);
    w.net.disconnect(h.transport);
    await w.advance(5000);
    w.net.restartServer(); // 학생은 다시 붙지만 방이 없음
    await w.advance(15_000);
    const ticks = h.session.getView().game!.ticks;
    w.net.reconnect(h.transport);
    await w.advance(20_000);
    const v = h.session.getView();
    expect(v).toMatchObject({ status: 'open', code });
    expect(v.game!.gaps).toHaveLength(1);
    expect(v.game!.gaps[0]).toBeGreaterThanOrEqual(20_000);
    expect(v.game!.ticks).toBeGreaterThan(ticks);
    // 호스트가 15초 넘게 없었어도 학생은 같은 코드로 계속 시도 → 입력 없이 기기 토큰으로 자기 회사에 돌아옴
    for (const s of students) expect(s.session.getState()).toMatchObject({ status: 'in', admitMode: 'same-device' });
    h.session.dispose();
  });
});

describe('서버 재시작 뒤 학생은 같은 코드로 계속 재입장 시도', () => {
  it('호스트 30초 부재 + 서버 재시작 + 같은 코드 재개방 → 학생 30명(같은 IP)이 입력 없이 자기 회사로, 기다리는 동안 hostOffline', async () => {
    const w = makeWorld();
    const { h, code } = await openRoom(w);
    const students = await joinMany(w, code, 30);
    const before = students.map((s) => s.session.getState().pid);
    w.net.disconnect(h.transport);
    await w.advance(2000);
    w.net.restartServer();
    await w.advance(28_000);
    for (const s of students) {
      expect(s.session.getState().status).toBe('hostOffline');
      expect(s.session.getState().hostOfflineSince).not.toBeNull();
    }
    expect(w.net.stats().blockedIps).toBe(0); // 유예 안 NO_ROOM은 IP 실패로 세지 않음
    w.net.reconnect(h.transport);
    await w.advance(20_000); // 재시도 간격 최대 15초 + 입장 처리
    expect(h.session.getView()).toMatchObject({ status: 'open', code });
    students.forEach((s, i) => expect(s.session.getState()).toMatchObject({ status: 'in', admitMode: 'same-device', pid: before[i] }));
    expect(h.session.getView().seats.filter((x) => x.online)).toHaveLength(30);
    h.session.dispose();
  });

  it('재시도 시간(540초)이 지나면 그때 codeChanged', async () => {
    const w = makeWorld();
    const { h, code } = await openRoom(w);
    const [a] = await joinMany(w, code, 1);
    w.net.disconnect(h.transport);
    w.net.restartServer();
    await w.advance(500_000, 1000);
    expect(a!.session.getState().status).toBe('hostOffline');
    await w.advance(60_000, 1000);
    expect(a!.session.getState()).toMatchObject({ status: 'codeChanged', errorCode: 'CODE_CHANGED' });
    h.session.dispose();
  });
});

describe('옮겨진 옛 기기는 hello.again에 답하지 않음', () => {
  it('다른 기기 승인 → 옛 기기 moved → 교사 새로 고침 resume → 요청 없음, 옛 기기 계속 moved', async () => {
    const w = makeWorld();
    const storage = new MemStorage();
    const { h, code } = await openRoom(w, { storage });
    const old = w.student();
    await old.session.join(code, 7, '해오름무역');
    await w.advance(300);
    const nu = w.student();
    await nu.session.join(code, 7, '해오름무역');
    await w.advance(300);
    h.session.approveRejoin(7);
    await w.advance(1500);
    expect(old.session.getState().status).toBe('moved');

    h.session.dispose();
    h.transport.close();
    await w.advance(2000);
    const h2 = w.host({ storage });
    expect((await h2.session.resume()).ok).toBe(true);
    await w.advance(1500);
    expect(h2.session.getView().rejoinRequests).toEqual([]);
    expect(old.session.getState().status).toBe('moved');
    expect(nu.session.getState().status).toBe('in');
    // 호스트가 옮겨진 연결을 기억하므로 hello.again 자체를 보내지 않음
    expect(h2.sentTo.filter((x) => x.peerId === old.transport.currentPeerId() && x.msg.t === 'hello.again')).toEqual([]);
    h2.session.dispose();
  });

  it('학생 쪽: 옮겨짐 상태면 hello.again에 인사하지 않음(호스트가 옮겨진 연결을 잊은 경우)', async () => {
    const w = makeWorld();
    const { h, code } = await openRoom(w);
    const s = w.student();
    await s.session.join(code, 3, '해오름무역');
    await w.advance(300);
    const sent: unknown[] = [];
    const orig = s.transport.send.bind(s.transport);
    s.transport.send = (m: object) => {
      sent.push(m);
      orig(m);
    };
    h.transport.sendTo(s.transport.currentPeerId() as string, { t: 'moved' });
    await w.advance(100);
    h.transport.sendTo(s.transport.currentPeerId() as string, { t: 'hello.again' });
    await w.advance(100);
    expect(s.session.getState().status).toBe('moved');
    expect(sent).toEqual([]);
    h.session.dispose();
  });
});

describe('참고 반영', () => {
  it('저장 실패를 교사 화면 상태(storageError)로', async () => {
    const w = makeWorld();
    const storage = new MemStorage();
    const { h } = await openRoom(w, { storage });
    expect(h.session.getView().storageError).toBeNull();
    storage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    h.session.dispatchTeacher({ type: 'note', text: 'x' });
    await w.advance(1500);
    expect(h.session.getView().storageError).toBe('QUOTA');
    h.session.dispose();
  });

  it('입장 문제 목록 상한(오래된 것부터 버림)', async () => {
    const w = makeWorld();
    const { h, code } = await openRoom(w);
    const owner = w.student();
    await owner.session.join(code, 7, '해오름무역');
    await w.advance(300);
    const p = w.student({ ip: '9.9.9.9' });
    for (let i = 0; i < JOIN_PROBLEM_MAX + 5; i++) {
      await p.transport.join(code, { seat: 7, company: '다른이름', deviceToken: `device-token-${i}`, appVersion: 'v1' });
      await w.advance(100);
    }
    expect(h.session.getView().joinProblems).toHaveLength(JOIN_PROBLEM_MAX);
    h.session.dispose();
  });

  it('손님 연결 상한: 넘으면 가장 오래된 손님을 내보냄(학생 화면은 내보내짐이 아니라 거절)', async () => {
    const w = makeWorld();
    const { h, code } = await openRoom(w);
    const owner = w.student();
    await owner.session.join(code, 7, '해오름무역');
    await w.advance(300);
    const guests = [];
    for (let i = 0; i <= GUEST_MAX; i++) {
      const g = w.student();
      await g.session.join(code, 7, '해오름무역');
      await w.advance(200);
      guests.push(g);
    }
    await w.advance(2000);
    expect(h.session.getView().rejoinRequests).toHaveLength(GUEST_MAX);
    expect(guests[0]!.session.getState()).toMatchObject({ status: 'idle', errorCode: 'TOO_MANY_TRIES' });
    expect(guests.at(-1)!.session.getState().status).toBe('waitingApproval');
    h.session.dispose();
  });

  it('리듀서가 거절과 함께 me를 내도 되돌림 알림이 빠지지 않음', async () => {
    const w = makeWorld();
    const { h, code } = await openRoom(w, {
      reducer: (g, input) => {
        const r = toyReducer(g, input);
        if (input.type === 'act' && r.outputs.some((o) => o.type === 'ack' && !o.ok)) r.outputs.unshift({ type: 'me', seat: input.seat });
        return r;
      },
    });
    const [a] = await joinMany(w, code, 1);
    const rollbacks: string[] = [];
    a!.session.onRollback((_m, e) => rollbacks.push(String(e)));
    a!.session.act({ type: 'buy', n: 500 });
    await w.advance(500);
    expect(rollbacks).toEqual(['NO_MONEY']);
    expect(a!.session.getState()).toMatchObject({ pendingCount: 0 });
    expect(a!.session.getState().me?.money).toBe(100);
    h.session.dispose();
  });
});

describe('보강 2: 새로 고침 복구의 끊긴 시간은 마지막 틱 기준', () => {
  it('조용한 라운드 21.5초(출력 없는 틱 → 판 저장 없음) + 새로 고침 30초 → hostGap ≈ 30초', async () => {
    const w = makeWorld();
    const storage = new MemStorage();
    const { h, code } = await openRoom(w, { storage });
    await joinMany(w, code, 2);
    await w.advance(2000); // 저장 묶음이 끝나도록
    const savedAt = h.store.load(code)!.savedAt;
    await w.advance(21_500); // 조용한 라운드: 틱만 돔
    expect(h.store.load(code)!.savedAt).toBe(savedAt); // 판 전체는 다시 저장되지 않음
    expect(storage.getItem(`voyage.hosttick.${code}`)).not.toBeNull();
    h.session.dispose();
    h.transport.close();
    await w.advance(30_000);
    const h2 = w.host({ storage });
    const r = await h2.session.resume();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.gapMs).toBeGreaterThanOrEqual(30_000);
    expect(r.gapMs).toBeLessThanOrEqual(31_100);
    expect(h2.session.getView().game!.gaps).toEqual([r.gapMs]);
    // 틱 키는 판 목록에 섞이지 않고, 판 기록을 지우면 함께 지워짐
    expect(h2.store.list()).toEqual([code]);
    h2.store.remove(code);
    expect(storage.getItem(`voyage.hosttick.${code}`)).toBeNull();
    h2.session.dispose();
  });
});
