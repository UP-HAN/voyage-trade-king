/**
 * 작업 114 — E2E 흐름(e2e/lesson1-full.spec.ts A)을 화면 없이 Memory로: [차시마다 한 판] L1 15분과 [단원 전체 한 판] 25분(v0.3.1 1번).
 * 출석번호 + 회사 이름 입장, 같은 회사 이름 거절 → 다시 입력, 한 학생 새로 고침(같은 기기 자동 재입장),
 * 한 학생은 L1-E4 뒤 늦게 입장(회사 설립 → 따라잡기 목록), 배치표대로 끝까지 → 마무리.
 * 단원 한 판은 L2~L4가 골격이라 L1 구간 내용 + 배치표·구간 전환(표지 L2-E1·L3-COVER·L4-COVER)만 본다.
 */
import { describe, expect, it } from 'vitest';
import { catchUpQueue, type PlayUnit, type PublicPayload } from '../../src/core';
import type { LessonId } from '../../src/data/types';
import { seatKey } from '../../src/sync/host-session';
import { botAction, makeSimWorld, rng, type SimStudent } from './sim-world';

async function flow(playUnit: PlayUnit, scope: LessonId[], minutes: number) {
  const w = makeSimWorld();
  const h = w.host();
  const code = await w.openGame(h, { playUnit, scope, tradeMinutes: minutes });
  const s1 = w.student(1, '해오름무역');
  await s1.store.join(code, 1, '해오름무역');
  await w.advance(800);
  // 같은 회사 이름 → 거절(제안) → 다시 입력
  const s2 = w.student(2, '바다상회');
  await s2.store.join(code, 2, '해오름 무역');
  await w.advance(800);
  expect(s2.store.getState().peer.errorCode).toBe('NAME_TAKEN');
  expect(s2.store.getState().peer.suggestions?.length).toBeGreaterThan(0);
  await s2.store.join(code, 2, '바다상회');
  await w.advance(800);
  expect(s2.store.getState().peer.status).toBe('in');
  const students: SimStudent[] = [s1, s2];
  const rand = rng(7);
  const step = async (n = 1) => {
    for (let i = 0; i < n; i++) {
      for (const s of students) {
        const a = botAction(s, rand);
        if (a) s.store.act(a);
      }
      await w.advance(1000, 250);
    }
  };
  await step(5);
  expect(Object.values(h.game().players).every((p) => p.company.founded)).toBe(true);
  h.teacher({ type: 'startTrade' });

  let s3: SimStudent | null = null;
  let refreshed = false;
  const stagesSeen: LessonId[] = [];
  for (let i = 0; i < (minutes + 8) * 60 && h.game().class.phase !== 'wrapup'; i++) {
    await step();
    const cs = h.game().class;
    if (stagesSeen.at(-1) !== cs.stage) stagesSeen.push(cs.stage);
    // 1라운드 중 s2 새로 고침(같은 저장소로 새 저장소 객체)
    if (!refreshed && cs.phase === 'round') {
      refreshed = true;
      s2.store.dispose();
      s2.transport.leave();
      await w.advance(500);
      const again = w.student(2, '바다상회', { storage: s2.storage, token: s2.token });
      expect(again.store.autoRejoin()).toBe(true);
      await w.advance(1500);
      expect(again.store.getState().peer).toMatchObject({ status: 'in', admitMode: 'same-device', companyName: '바다상회' });
      students[1] = again;
    }
    // L1-E4가 발동한 뒤 늦게 입장
    const e4 = cs.schedule.items.find((it) => it.refId === 'L1-E4');
    const e4Gone = !e4 || e4.form === 'dropped' || e4.status === 'skipped';
    const lateNow = e4Gone ? cs.firedEvents.includes('L1-E6') : cs.firedEvents.includes('L1-E4') && cs.currentEvent?.id !== 'L1-E4';
    if (!s3 && lateNow) {
      s3 = w.student(3, '늦은배무역');
      await s3.store.join(code, 3, '늦은배무역');
      await w.advance(800);
      expect(s3.store.getState().peer.status).toBe('in');
      // 따라잡기 목록: 지금까지 발동한 따라잡기 대상 사건(학생 기기가 계산하는 그대로)
      const pub = s3.store.getState().peer.public as PublicPayload;
      const me = s3.store.getState().peer.me!;
      const q = catchUpQueue(pub.class as never, me as never);
      expect(q.length).toBeGreaterThan(0);
      students.push(s3);
    }
  }
  const g = h.game();
  expect(g.class.phase).toBe('wrapup');
  expect(s3).not.toBeNull();
  expect(Object.keys(g.players)).toHaveLength(3);
  expect(g.players[seatKey(3)]!.company.founded).toBe(true);
  // 모두 같은 라운드까지 처리
  expect(new Set(Object.values(g.players).map((p) => p.game.resolvedRound)).size).toBe(1);
  // L1 사건 발동
  for (const id of ['L1-COVER', 'L1-E2', 'L1-E6', 'L1-E7']) expect(g.class.firedEvents).toContain(id);
  // 흑연 결정·천연가스 임무 기록이 호스트(대시보드 근거)에 있다
  const p1 = g.players[seatKey(1)]!;
  expect(p1.game.missions['M-GAS']).toBeDefined();
  return { g, stagesSeen, h };
}

describe('E2E 흐름(Memory): 판 단위별', () => {
  it('차시 한 판 L1 15분', { timeout: 120_000 }, async () => {
    const { g, stagesSeen, h } = await flow('lesson', ['L1'], 15);
    expect(stagesSeen).toEqual(['L1']);
    expect(g.class.schedule.wrapup?.map((x) => x.eventId).filter(Boolean)).toEqual(['L4-E7', 'L4-E9']);
    h.session.dispose();
  });

  it('단원 전체 한 판 25분(L2~L4는 배치표·구간 전환만)', { timeout: 120_000 }, async () => {
    const { g, stagesSeen, h } = await flow('unit', ['L1', 'L2', 'L3', 'L4'], 25);
    expect(stagesSeen).toEqual(['L1', 'L2', 'L3', 'L4']);
    for (const id of ['L2-E1', 'L3-COVER', 'L4-COVER']) expect(g.class.firedEvents).toContain(id);
    const wrapIds = g.class.schedule.wrapup?.map((x) => x.eventId).filter(Boolean);
    expect(wrapIds).toEqual(expect.arrayContaining(['L4-E6', 'L4-E7', 'L4-E9']));
    h.session.dispose();
  });
});
