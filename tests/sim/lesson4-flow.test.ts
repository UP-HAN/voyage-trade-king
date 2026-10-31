/**
 * 작업 173 — 4차시(차시 한 판 L4) 흐름을 화면 없이 Memory로: 실제 교사 호스트(무역 시계·배치표 '저절로' 진행) + 실제 학생 저장소 + 봇.
 * 앞 시간(1970년대 철강 투표·단계 → 베트남 공장 결정 → 근로 환경 보도·개선 → 관세사 → ⑬⑭⑮ → 마지막 항해 → 마무리),
 * 뒤 시간(표지 → 라운드 → 마무리 목록), 두 시간 모두를 무역 시작부터 마무리 결산·되돌아보기까지.
 * 정상 임무 봇(정당·낮은 임금·짓지 않음 섞임)에게 같은 거래 반복 폭풍(176)이 0번인지(새 활동이 오탐을 만들지 않음),
 * 공개 상태에 낮은 임금을 고른 회사가 드러나지 않는지 본다.
 * (작업 174) 뒤 시간·두 시간 모두·단원 한 판은 마무리 끝까지: 컨테이너 OX 응답 → [결과 보기] → 시상 한 장씩 → 되돌아보기 입력 →
 * 잡지 표지(게임에서 쓰기 → 교사가 고른 표지만 공개 상태에) → 끝나고 쓰기 → 수업 끝내기. 마무리 활동이 사고팔기 기록·폭풍을 만들지 않는지도 본다.
 */
import { describe, expect, it } from 'vitest';
import type { PublicPayload } from '../../src/core';
import { seatKey } from '../../src/sync/host-session';
import { botAction, finishWhenPlanDone, makeSimWorld, rng, type SimStudent, type SimWorld } from './sim-world';
import { liveWrapStep, wrapAwardList } from '../../src/teacher/game';

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
  return { g: h.game(), h, w, students, seenSteps, sawVnBars, leak, steelSales };
}

/**
 * (작업 174) 마무리 끝까지 — 교사 큰 버튼과 같은 행동만(마무리 첫 항목은 저절로 시작, 그다음은 [다음으로] = 지금 항목 끝 + 다음 항목 시작).
 * 학생은 실제 학생 저장소로 응답한다.
 */
async function runWrap(w: SimWorld, h: ReturnType<SimWorld['host']>, students: SimStudent[], magazine: 'game' | 'paper' = 'game') {
  const steps = (h.game().class.schedule.wrapup ?? []).filter((x) => x.id !== 'settle');
  const seen: string[] = [];
  let coverLeakBeforePick = false;
  const logLen = () => Object.values(h.game().players).reduce((n, p) => n + p.game.log.length, 0);
  const log0 = logLen();
  for (let i = 0; i < steps.length; i++) {
    const id = liveWrapStep(h.game());
    seen.push(id ?? '-');
    expect(id, `마무리 ${i + 1}번째`).toBe(steps[i]!.id);
    if (id === 'containers') {
      students.forEach((s, k) => s.store.act({ type: 'respondEvent', eventId: 'L4-E6', response: { picks: k % 2 ? [1, 5, 7, 8] : [1, 2, 5, 7], self: [3, 2, (k % 3) + 1] } as never }));
      await w.advance(1500, 250);
      h.teacher({ type: 'setContainersResult', show: true });
    }
    if (id === 'awards') {
      const total = wrapAwardList(h.game()).length;
      for (let k = 0; k < total; k++) {
        h.teacher({ type: 'awardNext' });
        await w.advance(400, 200);
      }
      await w.advance(1200, 200);
      const seenByStudent = (students[0]!.store.getState().peer.public as PublicPayload | null)?.wrap?.awardsShown ?? -1;
      expect(seenByStudent).toBe(total);
    }
    if (id === 'reflect') {
      students.forEach((s) => s.store.act({ type: 'respondEvent', eventId: 'L4-E9', response: { answers: ['반도체를 팔아 이익이 컸어요', '니켈을 함께 샀어요', '환경을 지켜요'] } as never }));
      await w.advance(1500, 250);
    }
    if (id === 'magazine') {
      h.teacher({ type: 'setMagazineMode', mode: magazine });
      await w.advance(600, 200);
      if (magazine === 'game') {
        students.forEach((s, k) => s.store.act({ type: 'respondEvent', eventId: 'L4-E8', response: { fields: [`대표상품${k}`, '빨라요', '베트남', '환경을 지켜요', '정당한 임금', '협력해요'], bg: (k % 3) + 1 } as never }));
        await w.advance(1500, 250);
        if (JSON.stringify(students[0]!.store.getState().peer.public ?? {}).includes('대표상품')) coverLeakBeforePick = true;
        const pid = Object.values(h.game().players).find((p) => p.seat === 1)!.pid;
        h.teacher({ type: 'pickCover', pid });
        await w.advance(1500, 250);
      }
    }
    const next = steps[i + 1];
    if (next) {
      h.teacher({ type: 'setWrapStep', id: id!, status: 'done' });
      h.teacher({ type: 'setWrapStep', id: next.id, status: 'live' });
      await w.advance(800, 200);
    }
  }
  const pubAfter = students[0]!.store.getState().peer.public as PublicPayload | null;
  h.teacher({ type: 'endSession' });
  await w.advance(800, 200);
  return { seen, coverLeakBeforePick, pubAfter, logAdded: logLen() - log0 };
}

function expectWrapDone(r: Awaited<ReturnType<typeof runWrap>>, g: ReturnType<ReturnType<SimWorld['host']>['game']>, magazine: 'game' | 'paper') {
  expect(r.seen).toEqual(['containers', 'awards', 'reflect', 'magazine', 'afterWorksheet']);
  expect(r.logAdded, '마무리 활동은 사고팔기 기록을 남기지 않는다').toBe(0);
  for (const p of Object.values(g.players)) {
    expect(p.game.responses['L4-E6'], `seat ${p.seat} 컨테이너`).toMatchObject({ total: 8 });
    expect((p.game.responses['L4-E6'] as { self?: number[] }).self).toHaveLength(3);
    expect((p.game.reflect as { answers: string[] }).answers).toHaveLength(3);
    if (magazine === 'game') expect((p.game.cover as { fields: string[] }).fields).toHaveLength(6);
    else expect(p.game.responses['L4-E8']).toBeUndefined();
    expect(p.game.fairTrade?.storms ?? 0).toBe(0);
  }
  expect(r.coverLeakBeforePick, '교사가 고르기 전 공개 상태에 학생 표지 글 없음').toBe(false);
  if (magazine === 'game') expect(r.pubAfter?.wrap?.cover?.fields[0]).toBe('대표상품0');
  expect(g.class.phase).toBe('ended');
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
    const { g, h, seenSteps, sawVnBars, students, w } = await flowL4(15, 'back');
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
    // (작업 174) 마무리 끝까지(15분 판 기본은 종이 — 여기서는 [게임에서 써요]로 바꿔 씀)
    const r = await runWrap(w, h, students, 'game');
    expectWrapDone(r, h.game(), 'game');
    for (const id of ['L4-E6', 'L4-E8', 'L4-E9']) expect(h.game().class.firedEvents.filter((x) => x === id)).toHaveLength(1);
    h.session.dispose();
  });

  it('두 시간 모두 25분: 앞 시간 활동 전부 + 4차시 마무리 전체(⑯⑰⑱)', { timeout: 240_000 }, async () => {
    const { g, h, students, w } = await flowL4(25, 'all');
    expect(g.class.phase).toBe('wrapup');
    for (const id of ['L4-E1', 'L4-E2', 'L4-E3', 'L4-E4']) expect(g.class.firedEvents).toContain(id);
    expect(g.class.schedule.wrapup?.flatMap((x) => x.worksheetIds)).toEqual(['W16', 'W18', 'W17']);
    // (작업 174) 마무리 끝까지 — 잡지 표지는 종이(25분 판 기본)
    const r = await runWrap(w, h, students, 'paper');
    expectWrapDone(r, h.game(), 'paper');
    h.session.dispose();
  });
});

describe('(작업 174) 단원 한 판 25분(Memory) — 마무리 끝까지', () => {
  it('1~4차시 25분 → 마무리(컨테이너 OX → 결산·시상 → 되돌아보기 3문항 → 잡지 표지 → 끝나고 쓰기) → 수업 끝내기', { timeout: 400_000 }, async () => {
    const w = makeSimWorld();
    const h = w.host();
    // 개발 열쇠 없이: 판 설정 화면의 '준비 중'(FULL_UNIT_READY)은 화면 규칙이라 시뮬레이션은 판을 바로 연다(가정 값 주입과 같음)
    const code = await w.openGame(h, { playUnit: 'unit', scope: ['L1', 'L2', 'L3', 'L4'], tradeMinutes: 25, settings: { voyageMode: 'free' } });
    const students: SimStudent[] = [];
    const names = ['해오름무역', '바다상회', '별빛상사', '파도해운'];
    for (let seat = 1; seat <= 4; seat++) {
      const s = w.student(seat, names[seat - 1]!);
      await s.store.join(code, seat, names[seat - 1]!);
      await w.advance(800);
      students.push(s);
    }
    const rand = rng(31);
    const step = async () => {
      for (const s of students) {
        const a = botAction(s, rand);
        if (a) s.store.act(a);
      }
      await w.advance(1000, 250);
    };
    for (let i = 0; i < 5; i++) await step();
    h.teacher({ type: 'startTrade' });
    for (let i = 0; i < 40 * 60 && h.game().class.phase !== 'wrapup'; i++) {
      await step();
      finishWhenPlanDone(h);
    }
    expect(h.game().class.phase).toBe('wrapup');
    expect(h.game().class.schedule.wrapup?.map((x) => x.id)).toEqual(['settle', 'containers', 'awards', 'reflect', 'magazine', 'afterWorksheet']);
    const r = await runWrap(w, h, students, 'game');
    expectWrapDone(r, h.game(), 'game');
    h.session.dispose();
  });
});
