import { describe, expect, it } from 'vitest';
import { findSeatKeys } from '../../src/sync/app-messages';
import { joinMany, makeWorld, MemStorage, newToyGame, toyViews, type World } from './session-helpers';

async function openRoom(w: World, storage?: MemStorage) {
  const h = w.host(storage ? { storage } : {});
  const r = await h.session.open({ game: newToyGame() });
  if (!r.ok) throw new Error(r.error);
  return { h, code: r.code };
}

describe('학생 기기 재접속', () => {
  it('같은 기기 새로 고침(새 peer-session, 같은 저장소) → 자동 재입장 same-device + 호스트 상태', async () => {
    const w = makeWorld();
    const { h, code } = await openRoom(w);
    const [a] = await joinMany(w, code, 3);
    a!.session.act({ type: 'buy', n: 30 });
    await w.advance(200);
    a!.transport.leave(); // 탭 닫힘
    await w.advance(200);
    expect(h.session.getView().seats.find((s) => s.seat === 1)?.online).toBe(false);

    const again = w.student({ storage: a!.storage });
    expect(again.session.getState().status).toBe('idle');
    expect(again.session.autoRejoin()).toBe(true);
    await w.advance(300);
    expect(again.session.getState()).toMatchObject({ status: 'in', seat: 1, admitMode: 'same-device' });
    expect(again.session.getState().me?.money).toBe(70);
    expect(h.session.getView().seats.find((s) => s.seat === 1)?.online).toBe(true);
    // 행동 번호는 호스트가 기억한 것 다음부터
    expect(again.session.act({ type: 'buy', n: 5 })).toBe('sent');
    await w.advance(300);
    expect(again.session.getState()).toMatchObject({ pendingCount: 0 });
    expect(h.session.getView().game?.players.s01?.money).toBe(65);
    h.session.dispose();
  });

  it('와이파이 끊김 → 다시 연결되면 자동 재입장, 끊긴 동안 행동은 모았다가 보냄', async () => {
    const w = makeWorld();
    const { h, code } = await openRoom(w);
    const [a] = await joinMany(w, code, 1);
    w.net.disconnect(a!.transport);
    await w.advance(100);
    expect(a!.session.getState().status).toBe('reconnecting');
    expect(a!.session.act({ type: 'buy', n: 2 })).toBe('queued');
    expect(a!.session.getState().me?.money).toBe(98); // 미리 보임
    w.net.reconnect(a!.transport);
    await w.advance(1000);
    expect(a!.session.getState()).toMatchObject({ status: 'in', admitMode: 'same-device', pendingCount: 0 });
    expect(h.session.getView().game?.players.s01?.money).toBe(98);
    h.session.dispose();
  });

  it('거절된 행동은 호스트 상태로 되돌리고 알림', async () => {
    const w = makeWorld();
    const { h, code } = await openRoom(w);
    const [a] = await joinMany(w, code, 1);
    const rollbacks: string[] = [];
    a!.session.onRollback((msg, err) => rollbacks.push(`${err}:${msg}`));
    // 학생 기기는 미리 계산을 못 해도(predict 예외) 보냄 → 호스트가 거절
    expect(a!.session.act({ type: 'buy', n: 500 })).toBe('sent');
    await w.advance(200);
    expect(rollbacks).toEqual(['NO_MONEY:값이 바뀌어서 다시 계산했어요.']);
    expect(a!.session.getState().me?.money).toBe(100);
    h.session.dispose();
  });
});

describe('호스트 부재·새로 고침', () => {
  it('호스트 부재 중 행동 20개 대기 → 21번째는 안내 → 복귀 후 순서대로 처리', async () => {
    const w = makeWorld();
    const { h, code } = await openRoom(w);
    const [a, b] = await joinMany(w, code, 2);
    w.net.disconnect(h.transport);
    await w.advance(100);
    expect(a!.session.getState().status).toBe('hostOffline');
    expect(a!.session.getState().hostOfflineSince).not.toBeNull();
    const notices: string[] = [];
    a!.session.onEvent((e) => e.type === 'queueFull' && notices.push(e.message));
    const ns = Array.from({ length: 20 }, (_, i) => (i % 3) + 1);
    for (const n of ns) expect(a!.session.act({ type: 'buy', n })).toBe('queued');
    expect(a!.session.act({ type: 'buy', n: 1 })).toBe('queueFull');
    expect(notices).toEqual(['선생님 화면이 돌아오면 다시 해요.']);
    expect(a!.session.getState().queuedCount).toBe(20);

    w.net.reconnect(h.transport);
    await w.advance(3000);
    expect(h.session.getView().status).toBe('open');
    expect(a!.session.getState()).toMatchObject({ status: 'in', pendingCount: 0 });
    expect(b!.session.getState().status).toBe('in');
    expect(h.session.getView().game?.players.s01?.log).toEqual(ns.map((n) => `buy${n}`));
    expect(a!.session.getState().me?.money).toBe(100 - ns.reduce((x, y) => x + y, 0));
    h.session.dispose();
  });

  it('호스트 새로 고침: 새 host-session이 같은 저장소로 resume → 학생들이 최신 상태를 다시 받음, 끊긴 시간은 hostGap', async () => {
    const w = makeWorld();
    const storage = new MemStorage();
    const { h, code } = await openRoom(w, storage);
    const students = await joinMany(w, code, 5);
    students[2]!.session.act({ type: 'buy', n: 11 });
    await w.advance(1500); // 1초 묶음 저장
    expect(storage.getItem('voyage.host.last')).toBe(code);

    // 탭 새로 고침: 메모리는 사라지고 연결도 끊김
    h.session.dispose();
    h.transport.close();
    await w.advance(12_000);
    expect(students[0]!.session.getState().status).toBe('hostOffline');

    const h2 = w.host({ storage });
    const r = await h2.session.resume();
    await w.advance(1500);
    expect(r).toMatchObject({ ok: true, code, mode: 'resumed' });
    if (!r.ok) return;
    expect(r.gapMs).toBeGreaterThanOrEqual(12_000);
    expect(h2.session.getView().game?.gaps).toEqual([r.gapMs]);
    expect(h2.session.getView().seats.filter((s) => s.online)).toHaveLength(5);
    for (const s of students) expect(s.session.getState().status).toBe('in');
    expect(students[2]!.session.getState().me?.money).toBe(89);
    expect((students[0]!.session.getState().public as { gaps: number }).gaps).toBe(1);
    // 이어서 행동
    students[0]!.session.act({ type: 'buy', n: 1 });
    await w.advance(300);
    expect(h2.session.getView().game?.players.s01?.money).toBe(99);
    h2.session.dispose();
  });

  it('beforeunload: 판 진행 중이면 확인 창', async () => {
    const w = makeWorld();
    const { h } = await openRoom(w);
    const handlers = new Map<string, (e: unknown) => unknown>();
    const target = {
      addEventListener: (t: string, f: (e: unknown) => unknown) => handlers.set(t, f),
      removeEventListener: (t: string) => handlers.delete(t),
    };
    const off = h.session.installBeforeUnload(target as never);
    let prevented = false;
    const ev = { preventDefault: () => (prevented = true), returnValue: '' };
    expect(handlers.get('beforeunload')!(ev)).toBe('수업 중인 판이 있어요. 닫으면 학생들이 기다려야 해요.');
    expect(prevented).toBe(true);
    await h.session.close();
    expect(h.session.shouldWarnBeforeUnload()).toBe(false);
    off();
    expect(handlers.size).toBe(0);
  });
});

describe('중계 서버 재시작', () => {
  it('같은 코드로 다시 열림 → 학생 30명 자동 재입장', async () => {
    const w = makeWorld();
    const { h, code } = await openRoom(w);
    const students = await joinMany(w, code, 30);
    w.net.restartServer();
    await w.advance(8000);
    expect(h.session.getView()).toMatchObject({ status: 'open', code, codeChanged: null });
    expect(h.session.getView().seats.filter((s) => s.online)).toHaveLength(30);
    for (const s of students) expect(s.session.getState()).toMatchObject({ status: 'in', admitMode: 'same-device' });
    h.session.dispose();
  });

  it('같은 코드가 막히면 새 코드: 기기 토큰 있는 30명은 새 코드 입력만으로 자기 회사, 토큰 없는 기기는 교사 허락(자동 복원 없음)', async () => {
    const w = makeWorld({ resumeGrace: 0 }); // 기록 없는 재열기를 받지 않는 서버 → 새 코드
    const screens: { code: string; msgs: unknown[] }[] = [];
    // 공용 화면 다리 흉내
    const h = w.host({
      screenFactory: (c: string) => {
        const rec = { code: c, msgs: [] as unknown[] };
        screens.push(rec);
        return {
          publishToScreen: (p: unknown) => rec.msgs.push(p),
          codeChanged: (n: string) => rec.msgs.push({ codeChanged: n }),
          closed: () => undefined,
          dispose: () => undefined,
        };
      },
    });
    const opened = await h.session.open({ game: newToyGame() });
    if (!opened.ok) throw new Error(opened.error);
    const code = opened.code;
    // 학생마다 다른 IP: 이 시험은 resumeGrace 0으로 '새 코드'를 흉내 내므로 서버의 '유예 중 NO_ROOM 안 셈'도 꺼진다.
    // 같은 IP 30명은 session-fix1의 같은 코드 시험(유예 600초)에서 확인

    const students = [];
    for (let i = 1; i <= 30; i++) {
      const s = w.student({ ip: `10.1.0.${i}` });
      void s.session.join(code, i, `회사${String.fromCharCode(0xac00 + i * 37)}무역`);
      students.push(s);
    }
    await w.advance(4000);
    const names = h.session.getView().seats.map((s) => s.companyName);
    expect(names).toHaveLength(30);

    w.net.restartServer();
    await w.advance(15_000);
    const v = h.session.getView();
    expect(v.status).toBe('open');
    expect(v.code).not.toBe(code);
    expect(v.codeChanged).toEqual({ from: code, to: v.code });
    expect(h.storage.getItem(`voyage.host.${code}`)).toBeNull();
    expect(h.storage.getItem('voyage.host.last')).toBe(v.code);
    // 공용 화면이 새 코드를 받음
    expect(screens[0]!.msgs).toContainEqual({ codeChanged: v.code });
    expect(screens.at(-1)!.code).toBe(v.code);
    // 학생은 같은 코드로 계속 기다림('선생님 화면을 기다리고 있어요') — 새 코드는 TV를 보고 입력
    for (const s of students) expect(s.session.getState().status).toBe('hostOffline');

    // 학생은 새 코드만 입력(번호·이름은 기기에 남아 있음) → 기기 토큰으로 자기 회사
    for (const s of students) {
      const rec = s.store.load()!;
      void s.session.join(v.code as string, rec.seat as number, rec.companyName as string);
    }
    await w.advance(4000);
    for (const s of students) expect(s.session.getState()).toMatchObject({ status: 'in', admitMode: 'same-device' });

    // 토큰 없는 기기(다른 기기)가 번호 + 이름이 맞아도 자동으로 들어가지 못함 → 교사 허락 대기
    const stranger = w.student();
    await stranger.session.join(v.code as string, 5, names[4] as string);
    await w.advance(300);
    expect(stranger.session.getState().status).toBe('waitingApproval');
    expect(h.session.getView().rejoinRequests).toEqual([expect.objectContaining({ seat: 5, oldOnline: true })]);
    h.session.dispose();
  });
});

describe('판 옮기기 파일', () => {
  it('export → 다른 PC의 새 host-session이 import → 같은 코드로 이어짐(옛 호스트는 replaced)', async () => {
    const w = makeWorld();
    const { h, code } = await openRoom(w);
    const students = await joinMany(w, code, 4);
    students[1]!.session.act({ type: 'buy', n: 9 });
    await w.advance(300);
    const file = h.session.exportMoveFile();
    expect(JSON.parse(file)).toMatchObject({ kind: 'voyage-move', v: 3, warning: expect.stringContaining('선생님 권한') });
    expect(file).toContain(JSON.parse(file).record.hostToken);

    const h2 = w.host({ ip: '3.3.3.3' }); // 새 PC, 빈 저장소
    expect((await h2.session.importMoveFile('{"kind":"x"}')).ok).toBe(false);
    const bad = JSON.parse(file);
    bad.v = 2;
    expect(await h2.session.importMoveFile(JSON.stringify(bad))).toMatchObject({ ok: false, error: 'VERSION' });
    const r = await h2.session.importMoveFile(file);
    await w.advance(1500);
    expect(r).toMatchObject({ ok: true, code, mode: 'resumed' });
    expect(h.session.getView().status).toBe('replaced');
    expect(h2.storage.getItem(`voyage.host.${code}`)).not.toBeNull();
    students[1]!.session.act({ type: 'buy', n: 1 });
    await w.advance(300);
    expect(h2.session.getView().game?.players.s02?.money).toBe(90);
    expect(students[1]!.session.getState()).toMatchObject({ status: 'in', pendingCount: 0 });
    h2.session.dispose();
  });
});

describe('공개 상태에 출석번호 없음', () => {
  it('리듀서가 공개 상태에 seat를 넣으면: 엄격 모드는 예외, 기본은 지우고 보냄', async () => {
    const w = makeWorld();
    // 보기 함수를 일부러 잘못 만듦
    const h = w.host({
      strict: false,
      views: { ...toyViews, public: (g) => ({ ...toyViews.public(g), seats: [7], list: [{ seat: 7, pid: 'x' }] }) },
    });
    const errs: unknown[] = [];
    const origErr = console.error;
    console.error = (...a: unknown[]) => errs.push(a);
    try {
      const r = await h.session.open({ game: newToyGame() });
      if (!r.ok) throw new Error(r.error);
      await joinMany(w, r.code, 2);
      await w.advance(1500);
    } finally {
      console.error = origErr;
    }
    const pubs = h.broadcasts.filter((b) => b.msg.t === 'state.public');
    expect(pubs.length).toBeGreaterThan(0);
    for (const b of pubs) expect(findSeatKeys(b.msg)).toEqual([]);
    for (const x of h.sentTo.filter((s) => s.msg.t === 'state.public')) expect(findSeatKeys(x.msg)).toEqual([]);
    expect(errs.length).toBeGreaterThan(0);
    expect(JSON.stringify(errs)).not.toMatch(/회사/);
    h.session.dispose();
  });
});
