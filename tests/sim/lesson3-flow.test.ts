/**
 * 작업 172 — 3차시(차시 한 판 L3) 흐름을 화면 없이 Memory로: 실제 교사 호스트(무역 시계·배치표 자동 진행) + 실제 학생 저장소 + 봇.
 * 앞 시간(광물 협력·스마트폰)·뒤 시간(AI 경쟁·항만 투표·경제 게이지·경쟁 카드)·두 시간 모두를 무역 시작부터 마무리까지.
 * 늦게 들어온 학생도 부품 팀을 받는지, 스마트폰 완성/미완성 두 경우, 부품 넣기가 같은 거래 반복(176)으로 잘못 잡히지 않는지 본다.
 */
import { describe, expect, it } from 'vitest';
import type { PublicPayload } from '../../src/core';
import { seatKey } from '../../src/sync/host-session';
import { botAction, finishWhenPlanDone, makeSimWorld, rng, type SimStudent } from './sim-world';

type Part = 'all' | 'front' | 'back';

async function flowL3(minutes: number, lessonPart: Part, phoneFocus: number, n = 3) {
  const w = makeSimWorld();
  const h = w.host();
  const code = await w.openGame(h, { playUnit: 'lesson', scope: ['L3'], tradeMinutes: minutes, settings: { lessonPart, voyageMode: 'free' } });
  const students: (SimStudent & { phoneFocus?: number })[] = [];
  const names = ['해오름무역', '바다상회', '별빛상사', '파도해운', '고래무역', '등대상회'];
  for (let seat = 1; seat <= n; seat++) {
    const s = w.student(seat, names[seat - 1]!);
    await s.store.join(code, seat, names[seat - 1]!);
    await w.advance(800);
    students.push(Object.assign(s, { phoneFocus }));
  }
  const rand = rng(17);
  const step = async () => {
    for (const s of students) {
      const a = botAction(s, rand);
      if (a) s.store.act(a);
    }
    await w.advance(1000, 250);
  };
  for (let i = 0; i < 5; i++) await step();
  h.teacher({ type: 'startTrade' });
  let late: (SimStudent & { phoneFocus?: number }) | null = null;
  let sawPhoneScene = false;
  let sawGauge = false;
  for (let i = 0; i < (minutes + 10) * 60 && h.game().class.phase !== 'wrapup'; i++) {
    await step();
    finishWhenPlanDone(h);
    const cs = h.game().class;
    // 늦게 온 학생: 두 번째 라운드에(스마트폰 팀이 정해진 뒤)
    if (!late && cs.phase === 'round' && cs.round >= 2) {
      late = Object.assign(w.student(n + 1, '늦은배무역'), { phoneFocus });
      await late.store.join(code, n + 1, '늦은배무역');
      await w.advance(800);
      students.push(late);
    }
    if (cs.currentEvent?.id === 'L3-E5' && !cs.currentEvent.closed) {
      const pub = students[0]!.store.getState().peer.public as PublicPayload;
      if (pub.public.phone) sawPhoneScene = true;
      if (pub.public.econGauge) sawGauge = true;
    }
  }
  return { g: h.game(), h, students, sawPhoneScene, sawGauge, late };
}

const refsOf = (g: Awaited<ReturnType<typeof flowL3>>['g']) => g.class.schedule.items.filter((it) => it.form !== 'dropped').map((it) => it.refId);
const wsOf = (g: Awaited<ReturnType<typeof flowL3>>['g']) => g.class.schedule.items.filter((it) => it.kind === 'worksheet').flatMap((it) => it.refIds ?? [it.refId]);

describe('3차시 흐름(Memory)', () => {
  it('앞 시간 25분(부품 모으는 봇): 광물 협력 → 스마트폰 → 결과 → ⑨⑩, 뒤 시간 내용 없음, 스마트폰 완성, 폭풍 0', { timeout: 180_000 }, async () => {
    const { g, h, sawPhoneScene, sawGauge } = await flowL3(25, 'front', 0.95);
    expect(g.class.phase).toBe('wrapup');
    for (const id of ['L3-COVER', 'L3-E1', 'L3-E2', 'L3-E5']) expect(g.class.firedEvents).toContain(id);
    for (const id of ['L3-E3', 'L3-E4', 'L3-E6']) expect(g.class.firedEvents).not.toContain(id);
    expect(refsOf(g).some((r) => ['L3-E3', 'L3-E4', 'L3-E6'].includes(r))).toBe(false);
    expect(wsOf(g)).toEqual(['W09', 'W10']);
    expect(sawPhoneScene).toBe(true);
    expect(sawGauge).toBe(false);
    expect(g.class.phone?.completedRound, JSON.stringify(g.class.phone) + JSON.stringify(Object.values(g.players).map((p) => [p.game.port, p.game.money, p.game.cargo, p.game.contracts, p.game.phone]))).not.toBeNull();
    for (const p of Object.values(g.players)) {
      expect(p.game.phone?.team, `seat ${p.seat}`).toBeDefined();
      expect(p.game.missions['M-PHONE']).toBeDefined();
      expect(p.game.unlockedRecipes).not.toContain('aichip');
      expect(p.game.metrics.dex).not.toContain('export-growth');
      expect(p.game.metrics.dex.some((d) => d.startsWith('competition-'))).toBe(false);
      // (작업 176) 부품 넣기·니켈 할인 거래가 같은 거래 반복으로 잡히지 않는다
      expect(p.game.fairTrade?.storms ?? 0, `seat ${p.seat} 폭풍`).toBe(0);
    }
    // 늦게 온 학생(4번)도 팀이 있다 — 필요 수량은 발동 때 그대로(3명 → 모두 2, 배터리만 절반 1 — 검증 반영)
    expect(g.players[seatKey(4)]?.game.phone?.team).toBeDefined();
    expect(Object.fromEntries(Object.entries(g.class.phone!.parts).map(([k, x]) => [k, x!.need]))).toEqual({ chip: 2, battery: 1, chem: 2, program: 2, nickel: 2, graphite: 2 });
    // 한 학생 한 부품 2상자 한도
    for (const p of Object.values(g.players)) for (const n of Object.values(p.game.phone?.deposited ?? {})) expect(n).toBeLessThanOrEqual(2);
    expect(g.class.schedule.wrapup?.map((x) => x.eventId).filter(Boolean)).toEqual(['L4-E7', 'L4-E9']);
    h.session.dispose();
  });

  it('앞 시간 25분(부품을 모으지 않는 봇): 스마트폰 미완성 — 결과에서 실패로 끝나지 않고 흐름은 끝까지', { timeout: 180_000 }, async () => {
    const { g, h, sawPhoneScene } = await flowL3(25, 'front', 0);
    expect(g.class.phase).toBe('wrapup');
    expect(sawPhoneScene).toBe(true);
    expect(g.class.phone?.completedRound).toBeNull();
    expect(g.class.firedEvents).toContain('L3-E5');
    h.session.dispose();
  });

  it('뒤 시간 25분: AI 경쟁·항만 투표 → 경제 게이지 → 경쟁 카드(카드만) → ⑪⑫, 앞 시간 내용 없음', { timeout: 180_000 }, async () => {
    const { g, h, sawGauge, sawPhoneScene } = await flowL3(25, 'back', 0.6);
    expect(g.class.phase).toBe('wrapup');
    for (const id of ['L3-COVER', 'L3-E3', 'L3-E4', 'L3-E5', 'L3-E6']) expect(g.class.firedEvents).toContain(id);
    for (const id of ['L3-E1', 'L3-E2']) expect(g.class.firedEvents).not.toContain(id);
    expect(g.class.shortEvents).toContain('L3-E6');
    expect(g.class.phone ?? null).toBeNull();
    expect(sawGauge).toBe(true);
    expect(sawPhoneScene).toBe(false);
    expect(wsOf(g)).toEqual(['W11', 'W12']);
    for (const p of Object.values(g.players)) {
      expect(p.game.phone).toBeUndefined();
      expect(p.game.missions['M-PHONE']).toBeUndefined();
      expect(p.game.effects.nickelDiscount).toBeUndefined();
      expect(p.game.metrics.dex).not.toContain('interdependence');
      // 확인 퀴즈 문항은 내지 않는다(카드만)
      expect(Object.keys(p.game.checkQuiz)).toEqual([]);
    }
    expect(g.class.votes['L3-E4']?.revealed).toBe(true);
    h.session.dispose();
  });

  it('앞 시간 15분: 라운드 2개 — 스마트폰 필요 수량 절반, 늦은 학생 포함 끝까지', { timeout: 180_000 }, async () => {
    const { g, h } = await flowL3(15, 'front', 0.9);
    expect(g.class.phase).toBe('wrapup');
    expect(g.class.schedule.items.filter((it) => it.kind === 'round').length).toBe(2);
    expect(g.class.phone?.half).toBe(true);
    expect(Object.values(g.class.phone!.parts).every((x) => x!.need === 1)).toBe(true);
    expect(new Set(Object.values(g.players).map((p) => p.game.resolvedRound)).size).toBe(1);
    h.session.dispose();
  });

  it('두 시간 모두 25분: 스마트폰 결과 → 경제 게이지, ⑨~⑫', { timeout: 180_000 }, async () => {
    const { g, h, sawGauge, sawPhoneScene } = await flowL3(25, 'all', 0.8);
    expect(g.class.phase).toBe('wrapup');
    for (const id of ['L3-COVER', 'L3-E1', 'L3-E2', 'L3-E3', 'L3-E4', 'L3-E5', 'L3-E6']) expect(g.class.firedEvents).toContain(id);
    expect(sawPhoneScene).toBe(true);
    expect(sawGauge).toBe(true);
    expect(wsOf(g)).toEqual(['W09', 'W10', 'W11', 'W12']);
    h.session.dispose();
  });
});
