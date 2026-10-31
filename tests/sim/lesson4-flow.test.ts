/**
 * 작업 173 — 4차시(차시 한 판 L4) 흐름을 화면 없이 Memory로: 실제 교사 호스트(무역 시계·배치표 '저절로' 진행) + 실제 학생 저장소 + 봇.
 * 앞 시간(1970년대 철강 투표·단계 → 베트남 공장 결정 → 근로 환경 보도·개선 → 관세사 → ⑬⑭⑮ → 마지막 항해 → 마무리),
 * 뒤 시간(표지 → 라운드 → 마무리 목록), 두 시간 모두를 무역 시작부터 마무리 결산·되돌아보기까지.
 * 정상 임무 봇(정당·낮은 임금·짓지 않음 섞임)에게 같은 거래 반복 폭풍(176)이 0번인지(새 활동이 오탐을 만들지 않음),
 * 공개 상태에 낮은 임금을 고른 회사가 드러나지 않는지 본다. 컨테이너 OX·잡지 표지 화면은 174 — 여기서는 마무리 목록 구성만.
 */
import { describe, expect, it } from 'vitest';
import type { PublicPayload } from '../../src/core';
import { seatKey } from '../../src/sync/host-session';
import { botAction, finishWhenPlanDone, makeSimWorld, rng, type SimStudent } from './sim-world';

type Part = 'all' | 'front' | 'back';
type Bot = SimStudent & { vn?: 'fair' | 'low' | 'none'; steelVote?: 'tariff' | 'noTariff'; reserve?: number };

async function flowL4(minutes: number, lessonPart: Part, n = 4) {
  const w = makeSimWorld();
  const h = w.host();
  const code = await w.openGame(h, { playUnit: 'lesson', scope: ['L4'], tradeMinutes: minutes, settings: { lessonPart, voyageMode: 'free' } });
  const students: Bot[] = [];
  const names = ['해오름무역', '바다상회', '별빛상사', '파도해운', '고래무역', '등대상회'];
  const plans: ('fair' | 'low' | 'none')[] = ['fair', 'low', 'none', 'low', 'fair', 'fair'];
  for (let seat = 1; seat <= n; seat++) {
    const s = w.student(seat, names[seat - 1]!);
    await s.store.join(code, seat, names[seat - 1]!);
    await w.advance(800);
    students.push(Object.assign(s, { vn: plans[seat - 1], steelVote: seat % 2 ? ('tariff' as const) : ('noTariff' as const), ...(plans[seat - 1] === 'low' ? { reserve: 400 } : {}) }));
  }
  const rand = rng(23);
  const step = async () => {
    for (const s of students) {
      const a = botAction(s, rand);
      if (a) s.store.act(a);
    }
    await w.advance(1000, 250);
  };
  for (let i = 0; i < 5; i++) await step();
  h.teacher({ type: 'startTrade' });
  const seenSteps = new Set<number>();
  let sawVnBars = false;
  let leak = false;
  let steelSales = 0;
  for (let i = 0; i < (minutes + 10) * 60 && h.game().class.phase !== 'wrapup'; i++) {
    await step();
    finishWhenPlanDone(h);
    const cs = h.game().class;
    if (cs.currentEvent?.id === 'L4-E1' && !cs.currentEvent.closed) seenSteps.add(cs.currentEvent.step ?? 0);
    const pub = students[0]!.store.getState().peer.public as PublicPayload;
    if (pub?.public.vnFactory) sawVnBars = true;
    // 공개 상태(TV·모든 학생 기기)에는 학생 응답·임금 결정이 없다
    const text = JSON.stringify(pub ?? {});
    if (text.includes('"wage"') || text.includes('"improved"')) leak = true;
  }
  for (const p of Object.values(h.game().players)) steelSales += p.game.log.filter((l) => l.kind === 'sell' && l.good === 'steel' && l.port === 'BUS').length;
  return { g: h.game(), h, students, seenSteps, sawVnBars, leak, steelSales };
}

const refsOf = (g: Awaited<ReturnType<typeof flowL4>>['g']) => g.class.schedule.items.filter((it) => it.form !== 'dropped').map((it) => it.refId);
const wsOf = (g: Awaited<ReturnType<typeof flowL4>>['g']) => g.class.schedule.items.filter((it) => it.kind === 'worksheet').flatMap((it) => it.refIds ?? [it.refId]);

describe('4차시 흐름(Memory)', () => {
  it('앞 시간 30분: 철강 투표 → 결과·회상·실제 사례(저절로) → 공장 결정 → 보도·개선 → 관세사 → ⑬⑭⑮ → 마무리(결산·되돌아보기 2문항), 폭풍 0', { timeout: 300_000 }, async () => {
    const { g, h, seenSteps, sawVnBars, leak, steelSales } = await flowL4(30, 'front');
    expect(g.class.phase).toBe('wrapup');
    for (const id of ['L4-COVER', 'L4-E1', 'L4-E2', 'L4-E3', 'L4-E4']) expect(g.class.firedEvents).toContain(id);
    // 저절로 진행에서도 단계가 모두 지나간다(투표 → 결과 → 회상 1·2·3 → 실제 사례)
    expect([...seenSteps].sort()).toEqual([0, 1, 2, 3, 4, 5]);
    expect(g.class.votes['L4-E1']?.revealed).toBe(true);
    expect(wsOf(g)).toEqual(['W13', 'W14', 'W15']);
    expect(sawVnBars).toBe(true);
    expect(leak).toBe(false);
    for (const p of Object.values(g.players)) {
      expect(p.game.responses['L4-E2'], `seat ${p.seat} 공장 결정`).toBeDefined();
      expect(p.game.metrics.dex).toEqual(expect.arrayContaining(['steel-1970', 'import-pros-cons', 'overseas-production']));
      // (작업 176) 새 활동(투표·공장 결정·보도 개선)이 같은 거래 반복 폭풍을 만들지 않는다
      expect(p.game.fairTrade?.storms ?? 0, `seat ${p.seat} 폭풍`).toBe(0);
    }
    // 낮은 임금 + 미설치(2번)는 보도 대상이고 고치기를 할 수 있다(봇은 고친다)
    const low = g.players[seatKey(2)]!;
    expect(low.game.responses['L4-E3'], JSON.stringify([low.game.responses['L4-E2'], low.game.money, low.game.fareDue, g.class.firedEvents])).toBeDefined();
    expect(low.game.effects.reputationDown).toBe(false);
    // 마무리: 컨테이너 OX·잡지 표지 없음, 되돌아보기 2문항
    expect(g.class.schedule.wrapup?.map((x) => x.id)).toEqual(['settle', 'awards', 'reflect', 'afterWorksheet']);
    expect(g.class.schedule.wrapup?.find((x) => x.id === 'reflect')?.questions).toBe(2);
    // 철강 관세(매김이면 30%)의 실제 영향: 부산 철강 판매 수(보고서용)
    expect(steelSales).toBeGreaterThanOrEqual(0);
    h.session.dispose();
  });

  it('(검증 반영) 앞 시간 25분: 철강은 짧게(결과 → 실제 사례), 베트남 공장 결정은 전체 형태(가운데 카드), 폭풍 0', { timeout: 240_000 }, async () => {
    const { g, h, seenSteps } = await flowL4(25, 'front');
    expect(g.class.phase).toBe('wrapup');
    expect(g.class.shortEvents).toContain('L4-E1');
    expect(g.class.shortEvents).not.toContain('L4-E2');
    expect([...seenSteps].sort()).toEqual([0, 1, 2]);
    expect(wsOf(g)).toEqual(['W13', 'W14', 'W15']);
    for (const p of Object.values(g.players)) {
      expect(p.game.responses['L4-E2'], `seat ${p.seat}`).toBeDefined();
      expect(p.game.fairTrade?.storms ?? 0).toBe(0);
    }
    h.session.dispose();
  });

  it('앞 시간 15분: 라운드 2개, 짧은 철강 투표(결과 → 실제 사례), 끝까지', { timeout: 240_000 }, async () => {
    const { g, h, seenSteps } = await flowL4(15, 'front');
    expect(g.class.phase).toBe('wrapup');
    expect(g.class.schedule.items.filter((it) => it.kind === 'round').length).toBe(2);
    expect(g.class.shortEvents).toContain('L4-E1');
    expect([...seenSteps].sort()).toEqual([0, 1, 2]);
    expect(wsOf(g)).toEqual(['W13', 'W14', 'W15']);
    for (const p of Object.values(g.players)) expect(p.game.fairTrade?.storms ?? 0).toBe(0);
    h.session.dispose();
  });

  it('뒤 시간 15분: 표지 → 라운드만 → 마무리 목록(컨테이너 OX → 결산 → 되돌아보기 3문항 → 잡지 표지), 앞 시간 내용 없음', { timeout: 240_000 }, async () => {
    const { g, h, seenSteps, sawVnBars } = await flowL4(15, 'back');
    expect(g.class.phase).toBe('wrapup');
    for (const id of ['L4-E1', 'L4-E2', 'L4-E3', 'L4-E4']) expect(g.class.firedEvents).not.toContain(id);
    expect(refsOf(g).some((r) => /^L4-E[1-4]$/.test(r))).toBe(false);
    expect(wsOf(g)).toEqual([]);
    expect(seenSteps.size).toBe(0);
    expect(sawVnBars).toBe(false);
    expect(g.class.activeEffects.some((e) => e.id === 'steel1970')).toBe(false);
    expect(g.class.schedule.wrapup?.map((x) => x.id)).toEqual(['settle', 'containers', 'awards', 'reflect', 'magazine', 'afterWorksheet']);
    for (const p of Object.values(g.players)) {
      expect(p.game.effects.reputationDown).toBeFalsy();
      for (const d of ['steel-1970', 'overseas-production', 'customs-broker']) expect(p.game.metrics.dex).not.toContain(d);
      expect(p.game.fairTrade?.storms ?? 0).toBe(0);
    }
    h.session.dispose();
  });

  it('두 시간 모두 25분: 앞 시간 활동 전부 + 4차시 마무리 전체(⑯⑰⑱)', { timeout: 240_000 }, async () => {
    const { g, h } = await flowL4(25, 'all');
    expect(g.class.phase).toBe('wrapup');
    for (const id of ['L4-E1', 'L4-E2', 'L4-E3', 'L4-E4']) expect(g.class.firedEvents).toContain(id);
    expect(g.class.schedule.wrapup?.flatMap((x) => x.worksheetIds)).toEqual(['W16', 'W18', 'W17']);
    h.session.dispose();
  });
});
