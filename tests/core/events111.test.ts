/**
 * 작업 111: 사건 결과 공개·마감 기본값·응답 수·다시 보내기(호스트 리듀서) + 가짜 시계 자동 진행(L1 사건이 배치표 시각에 뜸).
 */
import { describe, expect, it } from 'vitest';
import { aggregate, EVENT_RESULT_SHOW_SEC, respondedTo, resultShowing } from '../../src/core';
import { hostReduce } from '../../src/core/host';
import { createTradeHooks } from '../../src/core/trade';
import type { HostSnapshot, ScheduleItem } from '../../src/core/types';
import { checkQuizFor } from '../../src/data/checkQuiz';
import { act, makeSession, planDone, player, startFirstRound, teach } from './helpers';

/** L1 판, 학생 n명, 라운드 1 → 사건 발동 */
function fired(id: string, n = 3, short = false): HostSnapshot {
  let s = startFirstRound(makeSession({ n }));
  // 차단형(확인 퀴즈 등)은 라운드 사이에
  if (id === 'L1-E8') s = teach(s, { type: 'endRound' });
  s = teach(s, { type: 'fireEvent', id, short });
  expect(s.class.currentEvent?.id).toBe(id);
  return s;
}

describe('L1-E7 흑연 결정: 기록·마감 기본값·응답 수', () => {
  it('응답하면 decisions.graphiteChoice·도감 흑연, 응답 수 1/3, 선택 분포(이름 없음)', () => {
    let s = fired('L1-E7');
    s = act(s, 1, { type: 'respondEvent', eventId: 'L1-E7', response: { choice: 'SHA' } }).snapshot;
    const p = player(s, 1);
    expect(p.game.decisions).toEqual({ graphiteChoice: 'SHA' }); // 키는 graphiteChoice 하나(수정 1회차)
    expect(p.game.metrics.dex).toContain('graphite');
    const pub = aggregate(s.class, s.players);
    expect(pub.event).toEqual({ id: 'L1-E7', responded: 1, total: 3 });
    expect(pub.decision).toEqual({ id: 'L1-E7', counts: { SHA: 1, BUS: 0, none: 0 } });
    expect(JSON.stringify(pub.decision)).not.toMatch(/seat|해오름/);
  });

  it("[마감]: 응답하지 않은 학생은 '응답 없음' + 기본 선택지 '사지 않기'(none), 응답 수·분포에는 넣지 않음", () => {
    let s = fired('L1-E7');
    s = act(s, 1, { type: 'respondEvent', eventId: 'L1-E7', response: { choice: 'BUS' } }).snapshot;
    s = teach(s, { type: 'closeEvent', reveal: true });
    expect(s.class.currentEvent).toMatchObject({ id: 'L1-E7', closed: true, revealed: true });
    for (const seat of [2, 3]) {
      const p = player(s, seat);
      expect(p.game.responses['L1-E7']).toEqual({ choice: 'none', noResponse: true });
      expect(p.game.decisions).toEqual({ graphiteChoice: 'none' });
      expect(respondedTo('L1-E7', p)).toBe(false);
    }
    expect(player(s, 1).game.decisions.graphiteChoice).toBe('BUS');
    const pub = aggregate(s.class, s.players);
    expect(pub.event?.responded).toBe(1);
    expect(pub.decision?.counts).toEqual({ SHA: 0, BUS: 1, none: 0 });
  });

  it('다음 사건이 떠서 닫혀도 같은 기본값(자동 마감)', () => {
    let s = fired('L1-E7');
    s = teach(s, { type: 'fireEvent', id: 'L1-E6' });
    expect(player(s, 2).game.decisions.graphiteChoice).toBe('none');
  });

  it('마감 뒤 들어온 학생은 기록이 없어 따라잡기로 직접 고를 수 있다', () => {
    let s = fired('L1-E7', 2);
    s = teach(s, { type: 'closeEvent', reveal: true });
    s = hostReduce(s, { type: 'join', seat: 9, pid: 'p09qz', companyName: '늦은배', nameKey: '늦은배' }, 2000).snapshot;
    expect(player(s, 9).game.responses['L1-E7']).toBeUndefined();
    const r = act(s, 9, { type: 'respondEvent', eventId: 'L1-E7', response: { choice: 'SHA' } });
    expect(r.outputs.find((o) => o.kind === 'ack')).toMatchObject({ ok: true });
    expect(player(r.snapshot, 9).game.decisions.graphiteChoice).toBe('SHA');
  });
});

describe('[결과 공개]·확인 퀴즈 응답 수', () => {
  it('revealEvent: 마감하지 않고 revealed만', () => {
    let s = fired('L1-E8');
    s = teach(s, { type: 'revealEvent' });
    expect(s.class.currentEvent).toMatchObject({ id: 'L1-E8', closed: false, revealed: true });
  });

  it('확인 퀴즈: 지정 2문항을 모두 답해야 응답 1, 정답이면 무역 박사 +1, 정답률은 이름 없이', () => {
    let s = fired('L1-E8');
    const [q1, q2] = checkQuizFor('L1');
    s = act(s, 1, { type: 'answerCheckQuiz', qid: q1.id, answer: q1.answer }).snapshot;
    expect(aggregate(s.class, s.players).event?.responded).toBe(0);
    s = act(s, 1, { type: 'answerCheckQuiz', qid: q2.id, answer: q2.answer }, 2).snapshot;
    s = act(s, 2, { type: 'answerCheckQuiz', qid: q1.id, answer: q1.type === 'ox' ? (q1.answer === 'O' ? 'X' : 'O') : 1 }).snapshot;
    const pub = aggregate(s.class, s.players);
    expect(pub.event?.responded).toBe(1);
    expect(player(s, 1).game.metrics.quizRight).toBe(2);
    expect(pub.checkQuiz[q1.id]).toEqual({ right: 1, total: 2 });
  });
});

describe('[이 학생만 사건 다시 보내기] resendEvent', () => {
  it('그 학생에게만 me + eventTriggered(응답 기록은 그대로), 발동 전 사건이면 거절', () => {
    let s = fired('L1-E7');
    s = act(s, 2, { type: 'respondEvent', eventId: 'L1-E7', response: { choice: 'SHA' } }).snapshot;
    const r = hostReduce(s, { type: 'teacher', action: { type: 'resendEvent', seat: 2, id: 'L1-E7' } }, 3000);
    const evs = r.outputs.filter((o) => o.kind === 'events');
    expect(evs).toEqual([{ to: 'seat', seat: 2, kind: 'events', events: [{ type: 'eventTriggered', id: 'L1-E7' }] }]);
    expect(r.outputs.filter((o) => o.kind === 'me').map((o) => (o as { seat: number }).seat)).toEqual([2]);
    expect(player(r.snapshot, 2).game.responses['L1-E7']).toEqual({ choice: 'SHA' });
    const bad = hostReduce(s, { type: 'teacher', action: { type: 'resendEvent', seat: 2, id: 'L1-E5' } }, 3000);
    expect(bad.outputs.find((o) => o.kind === 'notice')).toMatchObject({ code: 'NOT_FIRED' });
  });
});

describe('가짜 시계 자동 진행: L1 사건이 배치표 시각에 뜬다(v0.3 7번)', () => {
  const hooks = createTradeHooks();
  const T0 = 10_000;
  function runLesson(minutes: number) {
    let s = makeSession({ n: 2 });
    s = hostReduce(s, { type: 'teacher', action: { type: 'updateSettings', settings: { tradeMinutes: minutes, worksheetMode: 'after' } } }, T0 - 1, hooks).snapshot; // v0.3.8(작업 153): 옛 배치(게임 끝나고)로 고정
    s = hostReduce(s, { type: 'teacher', action: { type: 'startTrade' } }, T0, hooks).snapshot;
    const items = s.class.schedule.items.filter((it) => it.kind === 'event' && it.form !== 'dropped') as ScheduleItem[];
    const seen: Record<string, { at: number; short: boolean; phase: string }> = {};
    for (let t = T0; t <= T0 + minutes * 60_000; t += 1000) {
      s = hostReduce(s, { type: 'tick' }, t, hooks).snapshot;
      const ce = s.class.currentEvent;
      if (ce && !ce.closed && !seen[ce.id]) seen[ce.id] = { at: Math.round((t - T0) / 1000), short: ce.short, phase: s.class.phase };
    }
    return { items, seen, end: s };
  }

  it('차시 L1 15분: L1-E2(전체) → L1-E6(1라운드 시작, 비차단) → L1-E7(2라운드 시작) 이 계획 시각에', () => {
    const { items, seen } = runLesson(15);
    for (const id of ['L1-E2', 'L1-E6', 'L1-E7']) {
      const it = items.find((x) => x.refId === id)!;
      expect(seen[id], id).toBeDefined();
      expect(Math.abs(seen[id].at - it.at), id).toBeLessThanOrEqual(1);
    }
    expect(seen['L1-E2'].short).toBe(false);
    expect(seen['L1-E6'].phase).toBe('round');
    expect(seen['L1-E7'].phase).toBe('round');
    expect(seen['L1-E7'].at).toBeGreaterThan(seen['L1-E6'].at);
  });

  it('차시 L1 10분: L1-E2가 짧은 형태(short)로 뜬다', () => {
    const { seen } = runLesson(10);
    expect(seen['L1-E2']).toMatchObject({ short: true });
    expect(seen['L1-E7']).toBeDefined();
  });
});

describe('(수정 1회차) 마감한 사건의 결과 보여 주기', () => {
  it('[결과 공개] 없이 [마감]해도 결과 공개 + resultUntil(20초), [다음]이면 바로 끝', () => {
    let s = fired('L1-E8');
    s = hostReduce(s, { type: 'teacher', action: { type: 'closeEvent' } }, 5000).snapshot;
    expect(s.class.currentEvent).toMatchObject({ closed: true, revealed: true, resultUntil: 5000 + EVENT_RESULT_SHOW_SEC * 1000 });
    expect(resultShowing(s.class, 6000)).toBe(true);
    s = hostReduce(s, { type: 'teacher', action: { type: 'endResult' } }, 7000).snapshot;
    expect(resultShowing(s.class, 7001)).toBe(false);
    // 결과가 없는 사건(개념 카드)은 resultUntil 없음
    let c = teach(makeSession({ n: 1 }), { type: 'fireEvent', id: 'L1-E2' });
    c = teach(c, { type: 'closeEvent' });
    expect(c.class.currentEvent?.resultUntil).toBeUndefined();
  });

  const hooks = createTradeHooks();
  const T0 = 10_000;
  function l1WithQuiz(minutes = 18): HostSnapshot {
    let s = makeSession({ n: 2 });
    s = hostReduce(s, { type: 'teacher', action: { type: 'updateSettings', settings: { tradeMinutes: minutes, worksheetMode: 'after' } } }, T0 - 1, hooks).snapshot; // v0.3.8(작업 153): 옛 배치(게임 끝나고)로 고정
    s = { ...s, class: { ...s.class, schedule: { ...s.class.schedule, overrides: { 'L1-E8': 'full' } } } };
    return hostReduce(s, { type: 'teacher', action: { type: 'startTrade' } }, T0, hooks).snapshot;
  }
  const tickTo = (s: HostSnapshot, from: number, to: number) => {
    for (let t = from; t <= to; t += 1000) s = hostReduce(s, { type: 'tick' }, t, hooks).snapshot;
    return s;
  };

  // (작업 162) 옛 기대 '그다음 무역 끝'은 '그다음 순서를 다 함(planDone)'으로 — 판은 저절로 끝나지 않고 교사 [마무리로]를 기다린다
  it('자동 마감: 마지막 항목 L1-E8은 칸 끝 20초 전에 마감 → 결과 20초 → 그다음 순서를 다 함(판 끝 ≤ T, 저절로 결산 안 함)', () => {
    let s = l1WithQuiz();
    const it = s.class.schedule.items.find((x) => x.refId === 'L1-E8')!;
    const end = it.at + it.durSec;
    expect(end).toBeLessThanOrEqual(18 * 60);
    s = tickTo(s, T0, T0 + (end - EVENT_RESULT_SHOW_SEC - 1) * 1000);
    expect(s.class.currentEvent).toMatchObject({ id: 'L1-E8', closed: false });
    s = tickTo(s, T0 + (end - EVENT_RESULT_SHOW_SEC) * 1000, T0 + (end - EVENT_RESULT_SHOW_SEC + 1) * 1000);
    expect(s.class.currentEvent).toMatchObject({ id: 'L1-E8', closed: true, revealed: true });
    expect(planDone(s.class)).toBe(false); // 결과를 보여 주는 동안 순서가 끝났다고 보지 않는다
    s = tickTo(s, T0 + (end - EVENT_RESULT_SHOW_SEC + 2) * 1000, T0 + (end - 1) * 1000);
    expect(planDone(s.class)).toBe(false);
    s = tickTo(s, T0 + end * 1000, T0 + (end + 1) * 1000);
    expect(planDone(s.class)).toBe(true);
    expect(s.class.tradeEnded).toBe(false);
  });

  it('교사 [마감](공개 없이): 마지막 항목이어도 결과 20초 뒤 순서를 다 함, [다음]이면 바로(작업 162: 결산은 교사가)', () => {
    let s = l1WithQuiz();
    const it = s.class.schedule.items.find((x) => x.refId === 'L1-E8')!;
    const t1 = T0 + (it.at + 5) * 1000;
    s = tickTo(s, T0, t1);
    expect(s.class.currentEvent).toMatchObject({ id: 'L1-E8', closed: false });
    s = hostReduce(s, { type: 'teacher', action: { type: 'closeEvent', reveal: true } }, t1 + 500, hooks).snapshot;
    s = tickTo(s, t1 + 1000, t1 + 10_000);
    expect(planDone(s.class)).toBe(false);
    expect(resultShowing(s.class, t1 + 10_000)).toBe(true);
    s = hostReduce(s, { type: 'teacher', action: { type: 'endResult' } }, t1 + 10_500, hooks).snapshot;
    s = tickTo(s, t1 + 11_000, t1 + 12_000);
    expect(planDone(s.class)).toBe(true);
    expect(s.class.tradeEnded).toBe(false);
  });

  it('비차단 결정(L1-E7)은 라운드 칸 끝 20초 전에 마감되어 라운드 안에서 결과를 보인다(다음 항목 시각 그대로)', () => {
    let s = l1WithQuiz();
    const it = s.class.schedule.items.find((x) => x.refId === 'L1-E7')!;
    s = tickTo(s, T0, T0 + (it.at + it.durSec - EVENT_RESULT_SHOW_SEC + 1) * 1000);
    expect(s.class.currentEvent).toMatchObject({ id: 'L1-E7', closed: true, revealed: true });
    expect(s.class.phase).toBe('round');
    expect(player(s, 1).game.decisions).toEqual({ graphiteChoice: 'none' });
  });
});
