/**
 * 작업 115 — 2차시(차시 한 판 L2) 흐름을 화면 없이 Memory로: 실제 교사 호스트(무역 시계·배치표 자동 진행) + 실제 학생 저장소 + 봇.
 * 15분·25분 판을 무역 시작부터 마무리까지 돌리고, 늦게 들어온 학생도 임무 3종을 받는지, 세관 게시판 집계가 공개 상태에 오는지 본다.
 */
import { describe, expect, it } from 'vitest';
import type { PublicPayload } from '../../src/core';
import { seatKey } from '../../src/sync/host-session';
import { botAction, makeSimWorld, rng, type SimStudent } from './sim-world';

async function flowL2(minutes: number, lessonPart: 'all' | 'front' | 'back' = 'all') {
  const w = makeSimWorld();
  const h = w.host();
  const code = await w.openGame(h, { playUnit: 'lesson', scope: ['L2'], tradeMinutes: minutes, settings: { lessonPart } });
  const students: SimStudent[] = [];
  for (const [seat, name] of [[1, '해오름무역'], [2, '바다상회']] as const) {
    const s = w.student(seat, name);
    await s.store.join(code, seat, name);
    await w.advance(800);
    students.push(s);
  }
  const rand = rng(11);
  const step = async () => {
    for (const s of students) {
      const a = botAction(s, rand);
      if (a) s.store.act(a);
    }
    await w.advance(1000, 250);
  };
  for (let i = 0; i < 5; i++) await step();
  // (작업 153) v0.3.8 차시 한 판 '알아서' = 활동마다 바로 — 15분 판은 학습지 시간 때문에 세관 게시판(2등급)이 빠진다.
  // 이 시험은 흐름(세관 게시판 집계)을 보므로 15분만 '게임 끝나고'로 고정한다(25분은 기본값 그대로)
  if (minutes < 25) h.teacher({ type: 'updateSettings', settings: { worksheetMode: 'after' } });
  h.teacher({ type: 'startTrade' });
  let late: SimStudent | null = null;
  let sawCustoms = false;
  for (let i = 0; i < (minutes + 8) * 60 && h.game().class.phase !== 'wrapup'; i++) {
    await step();
    const cs = h.game().class;
    if (!late && cs.phase === 'round') {
      late = w.student(3, '늦은배무역');
      await late.store.join(code, 3, '늦은배무역');
      await w.advance(800);
      students.push(late);
    }
    if (cs.currentEvent?.id === 'L2-E6' && !cs.currentEvent.closed) {
      const pub = students[0]!.store.getState().peer.public as PublicPayload;
      if (pub.public.customsBoard !== undefined) sawCustoms = true;
    }
  }
  return { g: h.game(), h, sawCustoms, students };
}

describe('2차시 흐름(Memory)', () => {
  for (const minutes of [15, 25]) {
    it(`차시 한 판 2차시 ${minutes}분 두 시간 모두: 표지 → 공장 개장 → 임무 3종 → 라운드 → 세관 게시판 → 마무리, 확인 퀴즈 없음(v0.3.9)`, { timeout: 120_000 }, async () => {
      const { g, h, sawCustoms } = await flowL2(minutes);
      expect(g.class.phase).toBe('wrapup');
      for (const id of ['L2-E1', 'L2-E2', 'L2-E3', 'L2-E4', 'L2-E5', 'L2-E6']) expect(g.class.firedEvents).toContain(id);
      expect(g.class.firedEvents).not.toContain('L2-E7');
      expect(g.class.features).toContain('factory');
      expect(g.class.openPorts).toHaveLength(12);
      expect(sawCustoms).toBe(true);
      // 늦게 온 학생 포함 모두 임무 3종
      expect(Object.keys(g.players)).toHaveLength(3);
      for (const k of [1, 2, 3]) expect(Object.keys(g.players[seatKey(k)]!.game.missions).sort()).toEqual(['M-EXPORT4', 'M-IPE', 'M-RELAY']);
      // 모두 같은 라운드까지 처리
      expect(new Set(Object.values(g.players).map((p) => p.game.resolvedRound)).size).toBe(1);
      // 마무리 목록: 결산·시상 → 되돌아보기
      expect(g.class.schedule.wrapup?.map((x) => x.eventId).filter(Boolean)).toEqual(['L4-E7', 'L4-E9']);
      h.session.dispose();
    });
  }

  it('차시 한 판 2차시 25분 앞 시간: 4유형·싱가포르·퀴즈 없음, 임무는 자원 수입→생산→수출 하나, 학습지 ⑤ → ⑥(v0.3.9)', { timeout: 120_000 }, async () => {
    const { g, h, sawCustoms } = await flowL2(25, 'front');
    expect(g.class.phase).toBe('wrapup');
    for (const id of ['L2-E1', 'L2-E2', 'L2-E3', 'L2-E6']) expect(g.class.firedEvents).toContain(id);
    for (const id of ['L2-E4', 'L2-E5', 'L2-E7']) expect(g.class.firedEvents).not.toContain(id);
    expect(sawCustoms).toBe(true);
    for (const k of [1, 2, 3]) expect(Object.keys(g.players[seatKey(k)]!.game.missions)).toEqual(['M-IPE']);
    const ws = g.class.schedule.items.filter((it) => it.kind === 'worksheet').flatMap((it) => it.refIds ?? [it.refId]);
    expect(ws).toEqual(['W05', 'W06']);
    expect(g.class.schedule.wrapup?.flatMap((x) => x.worksheetIds)).toEqual([]);
    h.session.dispose();
  });

  it('차시 한 판 2차시 25분 뒤 시간: 공장 개념·IPE·세관 게시판·퀴즈 없음, 처음 화물 없음, 학습지 ⑦ → ⑧(v0.3.9)', { timeout: 120_000 }, async () => {
    const { g, h } = await flowL2(25, 'back');
    expect(g.class.phase).toBe('wrapup');
    expect(g.class.firedEvents).toContain('L2-E1');
    expect(g.class.firedEvents).toContain('L2-E4');
    for (const id of ['L2-E2', 'L2-E3', 'L2-E6', 'L2-E7']) expect(g.class.firedEvents).not.toContain(id);
    expect(g.class.features).toContain('factory');
    for (const k of [1, 2, 3]) {
      const p = g.players[seatKey(k)]!;
      expect(p.game.missions['M-IPE']).toBeUndefined();
      expect(p.game.missions['M-EXPORT4']).toBeDefined();
      expect(p.game.log.some((e) => e.ref === 'startCargo')).toBe(false);
    }
    const ws = g.class.schedule.items.filter((it) => it.kind === 'worksheet').flatMap((it) => it.refIds ?? [it.refId]);
    expect(ws).toEqual(['W07', 'W08']);
    h.session.dispose();
  });
});
