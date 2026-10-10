/**
 * 작업 114 — 재접속·장애 시나리오(PRD 7.3·7.3.1·7.8, v0.3.1): MemoryNetwork + 실제 교사 호스트(teacherReducer) + 실제 학생 저장소.
 * 124(tests/sync)가 장난감 리듀서로 확인한 것을 실제 게임 리듀서·무역 시계·편지·학생 화면 저장소로 다시 확인한다.
 *
 * 1. 라운드 중 학생 끊김 → 라운드 2개 지난 뒤 복귀 → 호스트가 처리한 항해 결과(resolvedRound)·편지 수령
 * 2. 다른 기기 재입장 요청 → 교사 허락 → 옛 기기 moved·행동 거부
 * 3. 교사 탭 닫힘 → 2분 뒤 다시 열기 → 같은 판·같은 코드, 남은 시간 유지(끊긴 시간 일시정지), 학생 대기 행동 반영
 * 4. 중계 서버 재시작 → 같은 코드로 이어짐
 * 5. 같은 코드가 막힌 경우 새 코드: 기기 토큰 있는 학생은 새 코드만 넣으면 자기 회사, 다른 기기는 번호 + 이름 일치 → 교사 허락
 * 6. SEAT_TAKEN → 교사 [이 기기를 n번 회사로 연결] / [번호 바꾸기] / [이름 막기] → 학생 다시 짓기
 * 7. 일시정지 중 입장한 학생도 일시정지 상태(오버레이)
 * 8. 내보낸 학생 재입장 거부
 */
import { describe, expect, it } from 'vitest';
import { tradeClock, type PublicPayload } from '../../src/core';
import { mailbox } from '../../src/core/letters';
import { classForPredict, playerForPredict } from '../../src/student/predict';
import { seatKey } from '../../src/sync/host-session';
import { COMPANY_NAMES, makeSimWorld, MemStorage, type SimHost, type SimStudent, type SimWorld } from './sim-world';

async function setup(o: { n?: number; minutes?: number; resumeGrace?: number; storage?: MemStorage } = {}) {
  const w = makeSimWorld(o.resumeGrace !== undefined ? { resumeGrace: o.resumeGrace } : {});
  const h = w.host(o.storage ? { storage: o.storage } : {});
  const code = await w.openGame(h, { playUnit: 'lesson', scope: ['L1'], tradeMinutes: o.minutes ?? 30 });
  const students: SimStudent[] = [];
  for (let i = 1; i <= (o.n ?? 3); i++) students.push(await joinFounded(w, code, i, COMPANY_NAMES[i - 1]!));
  return { w, h, code, students };
}

async function joinFounded(w: SimWorld, code: string, seat: number, name: string, s?: SimStudent): Promise<SimStudent> {
  const st = s ?? w.student(seat, name);
  await st.store.join(code, seat, name);
  await w.advance(800);
  st.store.act({ type: 'foundCompany', color: 'blue', emblem: 'star', avatar: 'captain-2' });
  await w.advance(1200);
  return st;
}

const pub = (s: SimStudent) => s.store.getState().peer.public as PublicPayload | null;
const status = (s: SimStudent) => s.store.getState().peer.status;
const remaining = (h: SimHost, now: number) => tradeClock.remaining(h.game().class.clock, now);

/** 라운드 k가 끝날 때까지 시계를 돌린다(학생은 매 라운드 출항 준비) */
async function untilRoundDone(w: SimWorld, h: SimHost, k: number, ready: SimStudent[] = []) {
  for (let i = 0; i < 3600 && !(h.game().class.round >= k && h.game().class.phase !== 'round'); i++) {
    if (h.game().class.phase === 'round') {
      for (const s of ready) {
        const me = s.store.getState().peer.me;
        if (me && !me.game.ready && status(s) === 'in') {
          if (!me.game.dest) s.store.act({ type: 'setDestination', port: me.game.port === 'BUS' ? 'SHA' : 'BUS' });
          else s.store.act({ type: 'setReady' });
        }
      }
    }
    await w.advance(1000, 250);
  }
  expect(h.game().class.round).toBeGreaterThanOrEqual(k);
}

describe('재접속·장애 시나리오(실제 리듀서)', () => {
  it('1. 라운드 중 끊김 → 라운드 2개 지난 뒤 복귀: 항해 결과·편지를 받는다', { timeout: 120_000 }, async () => {
    const { w, h, students } = await setup({ n: 3 });
    const [a, b] = students as [SimStudent, SimStudent];
    h.teacher({ type: 'startTrade' });
    // 1라운드 시작까지
    for (let i = 0; i < 1800 && h.game().class.phase !== 'round'; i++) await w.advance(1000, 250);
    expect(h.game().class.round).toBe(1);
    a.store.act({ type: 'setDestination', port: 'SHA' });
    await w.advance(500);
    a.store.act({ type: 'setReady' });
    await w.advance(500);
    expect(h.game().players[seatKey(1)]!.game.ready).toBe(true);
    // 와이파이 끊김
    w.net.disconnect(a.transport);
    await w.advance(500);
    expect(status(a)).toBe('reconnecting');
    const lettersBefore = h.game().class.letters.delivered.length;
    await untilRoundDone(w, h, 3, [b]);
    expect(h.game().class.round).toBeGreaterThanOrEqual(3);
    // 복귀
    w.net.reconnect(a.transport);
    await w.advance(3000);
    expect(status(a)).toBe('in');
    const me = a.store.getState().peer.me!;
    const hostP = h.game().players[seatKey(1)]!;
    expect(me.game.resolvedRound).toBe(h.game().class.round);
    expect(me.game.resolvedRound).toBe(hostP.game.resolvedRound);
    // 호스트가 끊긴 동안 처리한 항해 결과가 그대로 온다(기기 상태 = 호스트 상태)
    expect(me.game).toEqual(hostP.game);
    expect(hostP.game.visit).toBeDefined();
    expect(hostP.game.log.some((l) => JSON.stringify(l).includes('SHA'))).toBe(true);
    // 끊긴 동안 도착한 편지도 편지함에 있다
    const delivered = h.game().class.letters.delivered;
    expect(delivered.length).toBeGreaterThan(lettersBefore);
    const box = mailbox(classForPredict(pub(a)!.class), playerForPredict(me));
    expect(box.map((l) => l.slot.slotId)).toEqual(delivered);
    expect(box.every((l) => l.question)).toBe(true);
    h.session.dispose();
  });

  it('2. 다른 기기 재입장 요청 → 교사 허락 → 옛 기기 moved·행동 거부', async () => {
    const { w, h, code, students } = await setup({ n: 2 });
    const [a] = students as [SimStudent];
    const other = w.student(1, a.name);
    await other.store.join(code, 1, a.name);
    await w.advance(500);
    expect(status(other)).toBe('waitingApproval');
    expect(h.session.getView().rejoinRequests).toEqual([expect.objectContaining({ seat: 1, companyName: a.name, oldOnline: true })]);
    expect(h.session.approveRejoin(1)).toBe(true);
    await w.advance(800);
    expect(status(other)).toBe('in');
    expect(other.store.getState().peer.admitMode).toBe('approved');
    expect(status(a)).toBe('moved');
    // 옛 기기의 행동은 보내지지 않는다
    expect(a.store.act({ type: 'setDestination', port: 'SHA' })).not.toBe('sent');
    expect(other.store.getState().peer.me?.company.founded).toBe(true);
    h.session.dispose();
  });

  it('3. 교사 탭 닫힘 → 2분 뒤 다시 열기: 같은 판·같은 코드, 남은 시간 유지, 학생 대기 행동 반영', { timeout: 120_000 }, async () => {
    const storage = new MemStorage();
    const { w, h, code, students } = await setup({ n: 3, storage });
    h.teacher({ type: 'startTrade' });
    for (let i = 0; i < 1800 && h.game().class.phase !== 'round'; i++) await w.advance(1000, 250);
    await w.advance(5000);
    h.session.flushSave();
    const before = remaining(h, w.now());
    const roundLeftBefore = (h.game().class.roundEndsAt as number) - w.now();
    // 탭 닫힘
    h.session.dispose();
    h.transport.close();
    await w.advance(15_000);
    for (const s of students) expect(status(s)).toBe('hostOffline');
    // 호스트가 없는 동안 학생 행동(대기)
    const [a] = students as [SimStudent];
    expect(a.store.act({ type: 'setDestination', port: 'YOK' })).toBe('queued');
    expect(a.store.getState().peer.me?.game.dest).toBe('YOK'); // 미리 보임
    await w.advance(105_000); // 합계 2분
    // 다시 열기(같은 저장소)
    const h2 = w.host({ storage });
    const r = await h2.session.resume();
    await w.advance(3000);
    expect(r).toMatchObject({ ok: true, code, mode: 'resumed' });
    if (!r.ok) return;
    expect(r.gapMs).toBeGreaterThanOrEqual(120_000);
    // 남은 시간이 그대로(끊긴 2분은 일시정지 처리)
    const after = remaining(h2, w.now());
    expect(Math.abs(after - before)).toBeLessThanOrEqual(5);
    const roundLeftAfter = (h2.game().class.roundEndsAt as number) - w.now();
    expect(Math.abs(roundLeftAfter - roundLeftBefore)).toBeLessThanOrEqual(5000);
    // 학생 전원 돌아옴, 대기 행동 반영
    for (const s of students) expect(status(s)).toBe('in');
    expect(h2.game().players[seatKey(1)]!.game.dest).toBe('YOK');
    expect(a.store.getState().peer.pendingCount).toBe(0);
    h2.session.dispose();
  });

  it('4. 중계 서버 재시작 → 같은 코드로 이어짐(학생 자동 재입장, 판 그대로)', async () => {
    const { w, h, code, students } = await setup({ n: 5 });
    h.teacher({ type: 'startTrade' });
    await w.advance(5000);
    const elapsedBefore = tradeClock.elapsedSec(h.game().class.clock, w.now());
    w.net.restartServer();
    await w.advance(10_000);
    expect(h.session.getView()).toMatchObject({ status: 'open', code, codeChanged: null });
    for (const s of students) expect(status(s)).toBe('in');
    expect(h.session.getView().seats.filter((x) => x.online)).toHaveLength(5);
    expect(tradeClock.elapsedSec(h.game().class.clock, w.now())).toBeGreaterThan(elapsedBefore);
    h.session.dispose();
  });

  it('5. 같은 코드가 막히면 새 코드: 기기 토큰 있는 학생은 새 코드만으로 자기 회사, 다른 기기는 번호 + 이름 일치 → 교사 허락', async () => {
    const w = makeSimWorld({ resumeGrace: 0 });
    const h = w.host();
    const code = await w.openGame(h, { playUnit: 'lesson', scope: ['L1'], tradeMinutes: 15 });
    const students: SimStudent[] = [];
    for (let i = 1; i <= 4; i++) {
      const s = w.student(i, COMPANY_NAMES[i - 1]!, { ip: `10.9.0.${i}` });
      students.push(await joinFounded(w, code, i, s.name, s));
    }
    h.teacher({ type: 'startTrade' });
    await w.advance(3000);
    w.net.restartServer();
    await w.advance(15_000);
    const v = h.session.getView();
    expect(v.code).not.toBe(code);
    expect(v.codeChanged).toEqual({ from: code, to: v.code });
    // 공용 화면 다리에 새 코드
    expect(h.screenMsgs).toContainEqual({ codeChanged: v.code });
    // 학생 화면: 지금은 '선생님 화면을 기다리고 있어요' 상태에서 새 코드를 넣는 단추가 없다(540초 뒤에야 입장 화면 —
    // result.md '기획 확인 필요'). 대신 HUD [설정 → 게임 나가기](leaveGame: 방 기록만 지우고 기기 토큰은 남김) → 입장 화면에서
    // 새 코드 + 출석번호 + 회사 이름을 다시 넣으면 기기 토큰으로 자기 회사에 앉는다
    for (const s of students) expect(status(s)).toBe('hostOffline');
    for (const s of students) s.store.leaveGame();
    await w.advance(300);
    for (const s of students) {
      expect(s.store.getState().saved).toBeNull(); // 입장 화면 칸은 비어 있음(PRD 7.8의 '자동으로 채워짐'과 다름)
      void s.store.join(v.code as string, s.seat, s.name);
    }
    await w.advance(4000);
    for (const s of students) expect(`${s.seat}:${status(s)}:${s.store.getState().peer.errorCode}`).toBe(`${s.seat}:in:null`);
    for (const s of students) expect(s.store.getState().peer).toMatchObject({ status: 'in', admitMode: 'same-device' });
    // 기기 토큰이 없는 다른 기기: 번호 + 이름이 맞아도 자동 복원 없음 → 교사 허락
    const stranger = w.student(2, COMPANY_NAMES[1]!, { ip: '10.9.0.99' });
    await stranger.store.join(v.code as string, 2, COMPANY_NAMES[1]!);
    await w.advance(500);
    expect(status(stranger)).toBe('waitingApproval');
    h.session.approveRejoin(2);
    await w.advance(800);
    expect(status(stranger)).toBe('in');
    expect(status(students[1]!)).toBe('moved');
    h.session.dispose();
  });

  it('6. SEAT_TAKEN → [이 기기를 7번 회사로 연결] / [번호 바꾸기] / [이름 막기] → 학생 다시 짓기', async () => {
    const w = makeSimWorld();
    const h = w.host();
    const code = await w.openGame(h, { playUnit: 'lesson', scope: ['L1'], tradeMinutes: 15 });
    const owner = await joinFounded(w, code, 7, '해오름무역');
    // 같은 번호·다른 이름 → SEAT_TAKEN(원래 회사 이름은 알려 주지 않음)
    const other = w.student(7, '바다상사');
    await other.store.join(code, 7, '바다상사');
    await w.advance(500);
    expect(other.store.getState().peer.errorCode).toBe('SEAT_TAKEN');
    expect(JSON.stringify(other.inbox)).not.toContain('해오름');
    const probs = h.session.getView().joinProblems;
    expect(probs).toEqual([expect.objectContaining({ seat: 7 })]);
    // (가) 이 기기를 7번 회사로 연결 → 옛 기기 moved → 다시 [입장]하면 7번 회사
    expect(h.session.bindDeviceToSeat(probs[0]!.peerId, 7)).toBe(true);
    await w.advance(300);
    expect(status(owner)).toBe('moved');
    await other.store.join(code, 7, '바다상사');
    await w.advance(800);
    expect(other.store.getState().peer).toMatchObject({ status: 'in', seat: 7, companyName: '해오름무역' });

    // (나) 번호 바꾸기: 8번으로 들어온 학생이 사실 9번 → 교사가 [번호 바꾸기]
    const wrong = await joinFounded(w, code, 8, '별빛상회');
    expect(h.session.reassignSeat(8, 9)).toBe(true);
    await w.advance(800);
    expect(wrong.store.getState().peer.seat).toBe(9);
    expect(h.session.getView().seats.map((s) => s.seat).sort()).toEqual([7, 9]);

    // (다) 이름 막기 → 학생 화면은 다시 짓기 → 새 이름
    expect(h.session.blockCompanyName(9)).toBe(true);
    await w.advance(800);
    expect(wrong.store.isBlocked()).toBe(true);
    // 공개 상태에는 막힌 이름이 사라짐("이름 짓는 중")
    const pubCompanies = (pub(wrong)!.public.companies ?? []).map((c) => c.name);
    expect(pubCompanies).not.toContain('별빛상회');
    expect(wrong.store.setCompanyName('은하해운')).toBe(true);
    await w.advance(1000);
    expect(wrong.store.isBlocked()).toBe(false);
    expect(h.session.getView().seats.find((s) => s.seat === 9)?.companyName).toBe('은하해운');
    h.session.dispose();
  });

  it('7. 일시정지 중 입장한 학생도 일시정지(오버레이) 상태를 받는다', async () => {
    const { w, h, code } = await setup({ n: 2 });
    h.teacher({ type: 'startTrade' });
    await w.advance(3000);
    h.teacher({ type: 'pause' });
    await w.advance(1500);
    const late = await joinFounded(w, code, 12, '등대무역');
    expect(pub(late)!.class.paused).toBe(true);
    // 일시정지 중에는 행동이 막힘(학생 화면 오버레이)
    h.teacher({ type: 'resume' });
    await w.advance(1500);
    expect(pub(late)!.class.paused).toBe(false);
    h.session.dispose();
  });

  it('8. 내보낸 학생은 같은 기기로 다시 들어오지 못한다(KICKED)', async () => {
    const { w, h, code, students } = await setup({ n: 2 });
    const [a] = students as [SimStudent];
    expect(h.session.kick(1)).toBe(true);
    await w.advance(800);
    expect(status(a)).toBe('kicked');
    const again = w.student(1, a.name, { storage: a.storage, token: a.token });
    await again.store.join(code, 3, '다른이름무역');
    await w.advance(800);
    expect(['kicked', 'idle']).toContain(status(again));
    expect(status(again)).not.toBe('in');
    expect(h.session.getView().seats.map((s) => s.seat)).toEqual([2]);
    h.session.dispose();
  });
});
