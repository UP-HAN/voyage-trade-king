/**
 * 학생 저장소(작업 107): 재입장, 낙관적 표시 후 ack 확정·거절 되돌림, 호스트 부재 중 행동 대기,
 * 일시정지·막힌 이름 동안 조작 막힘, [게임 나가기] 기록 삭제, 허락 대기 중 연결 끊김.
 * 실제 호스트 세션 + 103 리듀서 + 123 시계 훅을 MemoryNetwork 위에서 돌린다.
 */
import { describe, expect, it } from 'vitest';
import { statusBands, HOST_WAIT_BAND_MS, pickInfo, READY_TOGGLE_GUARD_MS, toggleAllowed } from '../../src/student/GameScreen';
import { marketView } from '../../src/core';
import { goodsById } from '../../src/data/goods';
import { classForPredict, HOST_ONLY_ACTIONS, playerForPredict, studentPredict, tryPredict } from '../../src/student/predict';
import { topLayer } from '../../src/student/slots';
import { PEER_DEVICE_KEY, PEER_RECORD_KEY } from '../../src/sync/peer-store';
import { makeStudentWorld, MemStorage } from './helpers';

describe('입장·재입장', () => {
  it('입장 → 준비 단계 회사 설립 → HUD 값(L1 500만 원, 배 0/20). 공개 상태에 출석번호 없음', async () => {
    const w = makeStudentWorld();
    const { h, code } = await w.openRoom();
    const s = await w.joinFounded(code, 7, '해오름무역');
    const st = s.store.getState();
    expect(st.peer.status).toBe('in');
    expect(st.peer.me?.company.founded).toBe(true);
    expect(st.peer.me?.game.money).toBe(500);
    expect(st.peer.me?.game.cargo).toEqual([]);
    expect(st.peer.public?.class.phase).toBe('prep');
    expect(JSON.stringify(st.peer.public)).not.toMatch(/"seats?"/);
    expect(h.player(7)?.company.color).toBe('blue');
    h.session.dispose();
  });

  it('같은 기기 새로 고침: 저장값 + 기기 토큰으로 자동 재입장, 토스트에 출석번호 없음', async () => {
    const w = makeStudentWorld();
    const { h, code } = await w.openRoom();
    const storage = new MemStorage();
    const a = await w.joinFounded(code, 7, '해오름무역', w.student({ storage, token: 'aaaaaaaabbbbbbbbccccccccdddddddd' }));
    // 탭 새로 고침: 메모리·연결은 사라지고 저장소만 남음
    a.store.dispose();
    a.transport.leave();
    await w.advance(500);
    const b = w.student({ storage, token: 'aaaaaaaabbbbbbbbccccccccdddddddd' });
    expect(b.store.getState().saved).toMatchObject({ code, seat: 7, companyName: '해오름무역' });
    expect(b.store.autoRejoin()).toBe(true);
    expect(b.store.getState().booting).toBe(true);
    await w.advance(1500);
    const st = b.store.getState();
    expect(st.booting).toBe(false);
    expect(st.peer).toMatchObject({ status: 'in', admitMode: 'same-device', companyName: '해오름무역' });
    expect(st.peer.me?.company.founded).toBe(true);
    const toasts = st.toasts.map((t) => t.text);
    expect(toasts).toContain('해오름무역으로 돌아왔어요!');
    expect(toasts.join()).not.toMatch(/7번/);
    h.session.dispose();
  });

  it('[게임 나가기]: voyage.peer 기록을 지운다(기기 토큰은 남김) → 새로 고침해도 자동 재입장하지 않음', async () => {
    const w = makeStudentWorld();
    const { h, code } = await w.openRoom();
    const storage = new MemStorage();
    const a = await w.joinFounded(code, 3, '별빛상회', w.student({ storage }));
    expect(storage.getItem(PEER_RECORD_KEY)).not.toBeNull();
    a.store.leaveGame();
    expect(storage.getItem(PEER_RECORD_KEY)).toBeNull();
    expect(storage.getItem(PEER_DEVICE_KEY)).not.toBeNull();
    expect(a.store.getState().saved).toBeNull();
    a.store.dispose();
    const b = w.student({ storage });
    expect(b.store.autoRejoin()).toBe(false);
    h.session.dispose();
  });

  it('호스트 부재 중 입장 → "선생님 화면이 켜지면" 상태로 자동 재시도 → 호스트가 돌아오면 들어감', async () => {
    const w = makeStudentWorld();
    const { h, code } = await w.openRoom();
    w.net.disconnect(h.transport);
    await w.advance(200);
    const s = w.student();
    const r = await s.store.join(code, 2, '바다상사');
    expect(r).toBe('HOST_OFFLINE');
    expect(s.store.getState().retryingJoin).toBe(true);
    expect(s.store.getState().peer.errorCode).toBe('HOST_OFFLINE');
    w.net.reconnect(h.transport);
    await w.advance(5000);
    expect(s.store.getState().peer.status).toBe('in');
    expect(s.store.getState().retryingJoin).toBe(false);
    h.session.dispose();
  });

  it('다른 기기 허락 대기 중 연결이 끊기면 approvalLost → [다시 들어가기]로 다시 요청', async () => {
    const w = makeStudentWorld();
    const { h, code } = await w.openRoom();
    await w.joinFounded(code, 5, '파도무역');
    const other = w.student();
    await other.store.join(code, 5, '파도무역');
    await w.advance(500);
    expect(other.store.getState().peer.status).toBe('waitingApproval');
    expect(h.session.getView().rejoinRequests.map((r) => r.seat)).toEqual([5]);
    w.net.disconnect(other.transport);
    await w.advance(300);
    expect(other.store.getState().peer.status).toBe('reconnecting');
    expect(other.store.getState().approvalLost).toBe(true);
    w.net.reconnect(other.transport);
    await w.advance(2000);
    expect(other.store.getState().peer.status).toBe('reconnecting'); // 124: 손님 연결은 자동 재입장 대상 아님
    other.store.requestRejoin();
    await w.advance(800);
    expect(other.store.getState().peer.status).toBe('waitingApproval');
    expect(other.store.getState().approvalLost).toBe(false);
    h.session.approveRejoin(5);
    await w.advance(800);
    expect(other.store.getState().peer.status).toBe('in');
    h.session.dispose();
  });
});

describe('행동: 낙관적 표시·확정·되돌림', () => {
  it('목적지·출항 준비는 누르는 즉시 보이고 ack로 확정 → 라운드 끝에 호스트가 항해 처리 → 도착 토스트', async () => {
    const w = makeStudentWorld();
    const { h, code } = await w.openRoom();
    const s = await w.joinFounded(code, 1, '해오름무역');
    h.teacher({ type: 'startTrade' });
    h.teacher({ type: 'startRound', durationSec: 180 });
    await w.advance(1500);
    const cls = s.store.getState().peer.public!.class;
    expect(cls.phase).toBe('round');
    const info = pickInfo(s.store.getState().peer.me!, cls, 'SHA');
    expect(info.kind).toBe('ok');
    const cost = info.kind === 'ok' ? info.cost : -1;
    expect(cost).toBeGreaterThan(0);

    expect(s.store.act({ type: 'setDestination', port: 'SHA' })).toBe('sent');
    expect(s.store.act({ type: 'setReady' })).toBe('sent');
    // 아직 네트워크를 돌리지 않았는데도 화면 값이 바뀜(미리 계산)
    let st = s.store.getState();
    expect(st.peer.me?.game.dest).toBe('SHA');
    expect(st.peer.me?.game.ready).toBe(true);
    expect(st.peer.pendingCount).toBe(2);
    await w.advance(500);
    st = s.store.getState();
    expect(st.peer.pendingCount).toBe(0);
    expect(h.player(1)?.game.dest).toBe('SHA');

    h.teacher({ type: 'endRound' });
    await w.advance(1500);
    st = s.store.getState();
    expect(st.peer.me?.game.port).toBe('SHA');
    expect(st.peer.me?.game.money).toBe(500 - cost);
    expect(h.player(1)?.game.money).toBe(500 - cost);
    expect(st.toasts.map((t) => t.text)).toContain('상하이(중국)에 도착했어요');
    h.session.dispose();
  });

  it('사기는 누르는 즉시 자금·배 칸에 반영(미리 계산) → 호스트 확정 값과 같음', async () => {
    const w = makeStudentWorld();
    const { h, code } = await w.openRoom();
    const s = await w.joinFounded(code, 1, '해오름무역');
    h.teacher({ type: 'startTrade' });
    h.teacher({ type: 'startRound', durationSec: 180 });
    await w.advance(1500);
    const st0 = s.store.getState();
    const cs = classForPredict(st0.peer.public!.class);
    const q = marketView(cs, playerForPredict(st0.peer.me!), 'BUS').find((x) => x.visible && x.buy !== null && x.buyLeft >= 2 && goodsById[x.good].form === 'goods');
    expect(q).toBeTruthy();
    expect(s.store.act({ type: 'buy', good: q!.good, qty: 2 })).toBe('sent');
    const st1 = s.store.getState();
    expect(st1.peer.me!.game.money).toBe(500 - q!.buy! * 2);
    expect(st1.peer.me!.game.cargo.reduce((n, l) => n + l.qty, 0)).toBe(2);
    await w.advance(500);
    expect(s.store.getState().peer.pendingCount).toBe(0);
    expect(h.player(1)?.game.money).toBe(500 - q!.buy! * 2);
    expect(s.store.getState().peer.me!.game.money).toBe(h.player(1)?.game.money);
    h.session.dispose();
  });

  it('호스트가 거절하면 호스트 상태로 되돌리고 "값이 바뀌어서 다시 계산했어요"', async () => {
    const w = makeStudentWorld();
    const { h, code } = await w.openRoom();
    const s = await w.joinFounded(code, 1, '해오름무역');
    h.teacher({ type: 'startTrade' });
    h.teacher({ type: 'startRound', durationSec: 180 });
    await w.advance(1500);
    s.store.act({ type: 'setDestination', port: 'SHA' });
    await w.advance(500);
    // 호스트가 라운드를 끝냈지만 학생 기기는 아직 라운드 중으로 알고 있음 → 미리 계산은 되지만 호스트는 거절
    h.teacher({ type: 'endRound' });
    expect(s.store.act({ type: 'setReady' })).toBe('sent');
    expect(s.store.getState().peer.me?.game.ready).toBe(true);
    await w.advance(1500);
    const st = s.store.getState();
    expect(st.peer.me?.game.ready).toBe(false);
    expect(st.toasts.map((t) => t.text)).toContain('값이 바뀌어서 다시 계산했어요.');
    h.session.dispose();
  });

  it('호스트 부재: 띠(15초) + 행동 대기("보내는 중") → 호스트가 돌아오면 반영', async () => {
    const w = makeStudentWorld();
    const { h, code } = await w.openRoom();
    const s = await w.joinFounded(code, 1, '해오름무역');
    h.teacher({ type: 'startTrade' });
    h.teacher({ type: 'startRound', durationSec: 300 });
    await w.advance(1500);
    w.net.disconnect(h.transport);
    await w.advance(300);
    let st = s.store.getState();
    expect(st.peer.status).toBe('hostOffline');
    expect(statusBands(st, w.now())).toEqual([]);
    await w.advance(HOST_WAIT_BAND_MS);
    st = s.store.getState();
    expect(statusBands(st, w.now())).toContain('hostWait');
    expect(s.store.act({ type: 'setDestination', port: 'YOK' })).toBe('queued');
    expect(s.store.act({ type: 'setReady' })).toBe('queued');
    st = s.store.getState();
    expect(st.peer.queuedCount).toBe(2);
    expect(st.peer.me?.game.dest).toBe('YOK');
    w.net.reconnect(h.transport);
    await w.advance(3000);
    st = s.store.getState();
    expect(st.peer.status).toBe('in');
    expect(st.peer.queuedCount).toBe(0);
    expect(statusBands(st, w.now())).toEqual([]);
    expect(h.player(1)?.game).toMatchObject({ dest: 'YOK', ready: true });
    h.session.dispose();
  });
});

describe('조작 막힘', () => {
  it('일시정지면 행동을 보내지 않음(blocked), 풀리면 다시', async () => {
    const w = makeStudentWorld();
    const { h, code } = await w.openRoom();
    const s = await w.joinFounded(code, 1, '해오름무역');
    h.teacher({ type: 'startTrade' });
    h.teacher({ type: 'startRound', durationSec: 180 });
    h.teacher({ type: 'pause' });
    await w.advance(1500);
    expect(topLayer(s.store.getState())).toBe('pause');
    expect(s.store.isBlocked()).toBe(true);
    expect(s.store.act({ type: 'setDestination', port: 'SHA' })).toBe('blocked');
    expect(s.store.getState().peer.pendingCount).toBe(0);
    h.teacher({ type: 'resume' });
    await w.advance(1500);
    expect(topLayer(s.store.getState())).toBeNull();
    expect(s.store.act({ type: 'setDestination', port: 'SHA' })).toBe('sent');
    h.session.dispose();
  });

  it('name.blocked: 이름 다시 짓기 창이 조작을 막고, 새 이름이 ok면 풀림(무역 중에도)', async () => {
    const w = makeStudentWorld();
    const { h, code } = await w.openRoom();
    const s = await w.joinFounded(code, 4, '바다상사');
    h.teacher({ type: 'startTrade' });
    h.teacher({ type: 'startRound', durationSec: 180 });
    await w.advance(1500);
    h.session.blockCompanyName(4);
    await w.advance(1500);
    expect(s.store.getState().peer.nameStatus).toBe('blocked');
    expect(topLayer(s.store.getState())).toBe('nameBlocked');
    expect(s.store.act({ type: 'setDestination', port: 'SHA' })).toBe('blocked');
    // 같은(막힌) 이름은 호스트가 거절 → 오류 문구, 여전히 막힘
    expect(s.store.setCompanyName('바다상사')).toBe(true);
    expect(s.store.getState().nameRequest.pending).toBe(true);
    await w.advance(800);
    expect(s.store.getState().nameRequest.error).toContain('쓸 수 없는 말');
    expect(s.store.getState().peer.nameStatus).toBe('blocked');
    expect(s.store.setCompanyName('은하상단')).toBe(true);
    await w.advance(1500);
    const st = s.store.getState();
    expect(st.peer.nameStatus).toBe('ok');
    expect(st.peer.companyName).toBe('은하상단');
    expect(topLayer(st)).toBeNull();
    expect(s.store.act({ type: 'setDestination', port: 'SHA' })).toBe('sent');
    h.session.dispose();
  });

  it('교사가 이름을 바꾸면 토스트 + 저장값 갱신', async () => {
    const w = makeStudentWorld();
    const { h, code } = await w.openRoom();
    const s = await w.joinFounded(code, 6, '노을무역');
    expect(h.session.renameCompany(6, '저녁노을')).toMatchObject({ ok: true });
    await w.advance(1500);
    const st = s.store.getState();
    expect(st.peer.companyName).toBe('저녁노을');
    expect(st.toasts.map((t) => t.text)).toContain("선생님이 회사 이름을 '저녁노을'로 바꿨어요");
    expect(s.peerStore.load()?.companyName).toBe('저녁노을');
    h.session.dispose();
  });
});

describe('미리 계산 어댑터(PublicClass + 내 개인 상태)', () => {
  it('교사 전용 필드를 빈 값으로 채우고, 회사 이름 바꾸기는 미리 계산하지 않음', async () => {
    const w = makeStudentWorld();
    const { h, code } = await w.openRoom();
    const s = await w.joinFounded(code, 1, '해오름무역');
    const st = s.store.getState();
    const pub = st.peer.public!;
    expect('bannedNameKeys' in pub.class).toBe(false);
    const cs = classForPredict(pub.class);
    expect(cs.bannedNameKeys).toEqual([]);
    expect(cs.settings.extraBannedWords).toEqual([]);
    expect(HOST_ONLY_ACTIONS.has('setCompanyName')).toBe(true);
    expect(tryPredict(st.peer.me, pub, { type: 'setCompanyName', name: '새이름무역' })).toEqual({ ok: false, code: 'HOST_ONLY' });
    expect(() => studentPredict(st.peer.me!, pub, { type: 'setCompanyName', name: '새이름무역' })).toThrow();
    // 준비 단계에서 거래는 호스트 규칙대로 오류(미리 보이지 않음)
    expect(tryPredict(st.peer.me, pub, { type: 'setReady' })).toEqual({ ok: false, code: 'NOT_TRADING' });
    const r = tryPredict(st.peer.me, pub, { type: 'foundCompany', color: 'red', emblem: 'fish', avatar: 'captain-1' });
    expect(r.ok && r.me.company.color).toBe('red');
    h.session.dispose();
  });
});

describe('수정 1회차', () => {
  it('무역 중 늦게 들어온 학생: 회사 설립 전(founded=false) → foundCompany → companyFounded·L1-E3 응답', async () => {
    const w = makeStudentWorld();
    const { h, code } = await w.openRoom();
    await w.joinFounded(code, 1, '해오름무역');
    h.teacher({ type: 'startTrade' });
    h.teacher({ type: 'startRound', durationSec: 180 });
    await w.advance(1500);
    const late = w.student();
    await late.store.join(code, 9, '늦깎이상회');
    await w.advance(1500);
    let st = late.store.getState();
    expect(st.peer.public?.class.phase).toBe('round');
    expect(st.peer.me?.company.founded).toBe(false); // 화면은 이때 해도 대신 S04(GameScreen: !founded)
    const evs: string[] = [];
    late.store.transport.onMessage((m) => {
      const scan = (x: unknown) => {
        const o = x as { t?: string; msgs?: unknown[]; data?: { events?: { type: string }[] } };
        if (o.t === 'multi') o.msgs?.forEach(scan);
        if (o.t === 'state.me') for (const e of o.data?.events ?? []) evs.push(e.type);
      };
      scan(m);
    });
    expect(late.store.act({ type: 'foundCompany', color: 'green', emblem: 'fish', avatar: 'captain-4' })).toBe('sent');
    expect(late.store.getState().peer.me?.company.founded).toBe(true); // 즉시(미리 계산)
    await w.advance(1000);
    st = late.store.getState();
    expect(st.peer.pendingCount).toBe(0);
    expect(h.player(9)?.company).toMatchObject({ founded: true, color: 'green', emblem: 'fish', avatar: 'captain-4' });
    expect(h.player(9)?.game.responses['L1-E3']).toBe(true);
    expect(evs).toContain('companyFounded');
    h.session.dispose();
  });

  it('[출항 준비]↔[출항 취소] 전환 직후 가드 시간 동안 클릭 무시', () => {
    expect(READY_TOGGLE_GUARD_MS).toBeGreaterThanOrEqual(400);
    expect(toggleAllowed(null, 1000)).toBe(true);
    expect(toggleAllowed(1000, 1000 + 120)).toBe(false);
    expect(toggleAllowed(1000, 1000 + READY_TOGGLE_GUARD_MS - 1)).toBe(false);
    expect(toggleAllowed(1000, 1000 + READY_TOGGLE_GUARD_MS)).toBe(true);
  });
});
