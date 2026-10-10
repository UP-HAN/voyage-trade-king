/**
 * 작업 109 학생 표: 필터 8종(전체 + 7, '이름 확인' 포함)·정렬·요약 칩, `?demo=30` 가짜 데이터.
 */
import { describe, expect, it } from 'vitest';
import { makeDemo } from '../../src/teacher/demo';
import { aggregate, seatKey } from '../../src/core';
import { checkQuizFor } from '../../src/data/checkQuiz';
import { eventsById } from '../../src/data/events';
import type { TeacherGame } from '../../src/teacher/game';
import { FILTERS, buildRows, currentResponseCount, filterCounts, filterRows, matchesFilter, sortRows, summaryText, type StudentRow } from '../../src/teacher/table';

const demo = makeDemo(30, Date.UTC(2026, 9, 9, 1, 0, 0));
const rows = buildRows(demo.game, demo.view);

describe('?demo=30 학생 표', () => {
  it('30줄, 출석번호 + 회사 이름(실명 필드 없음)', () => {
    expect(rows).toHaveLength(30);
    expect(rows.map((r) => r.seat)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    for (const r of rows) {
      expect(r.companyName.length).toBeGreaterThan(1);
      expect(Object.keys(r)).not.toContain('name');
      expect(Object.keys(r)).not.toContain('realName');
    }
  });

  it('필터 8종: 전체 + 미접속·응답 안 함·출항 준비 안 함·임무 미완료·학습지 안 씀·재접속 요청·이름 확인', () => {
    expect(FILTERS.map((f) => f.label)).toEqual(['전체', '미접속', '응답 안 함', '출항 준비 안 함', '임무 미완료', '학습지 안 씀', '재접속 요청', '이름 확인']);
    const c = filterCounts(rows);
    expect(c.all).toBe(30);
    for (const f of FILTERS) {
      const list = filterRows(rows, f.id);
      expect(list.length).toBe(c[f.id]);
      expect(list.every((r) => matchesFilter(r, f.id))).toBe(true);
      if (f.id !== 'all') expect(list.length).toBeGreaterThan(0); // 데모 데이터는 모든 필터에 걸리는 학생이 있다
      if (f.id !== 'all') expect(list.length).toBeLessThan(30);
    }
    expect(filterRows(rows, 'offline').every((r) => !r.online)).toBe(true);
    expect(filterRows(rows, 'rejoin').map((r) => r.seat)).toEqual([7]);
    expect(filterRows(rows, 'nameCheck').map((r) => r.seat)).toEqual([9]);
    expect(filterRows(rows, 'noResponse').every((r) => r.responded === false)).toBe(true);
    expect(filterRows(rows, 'noWorksheet').every((r) => r.worksheetDone === false)).toBe(true);
  });

  it('정렬: 번호·자금·수출액·회사 이름', () => {
    const byMoney = sortRows(rows, 'money').map((r) => r.money);
    expect([...byMoney].sort((a, b) => b - a)).toEqual(byMoney);
    const byExp = sortRows(rows, 'exports').map((r) => r.exports);
    expect([...byExp].sort((a, b) => b - a)).toEqual(byExp);
    const byName = sortRows(rows, 'company').map((r) => r.companyName);
    expect([...byName].sort()).toEqual(byName);
    expect(sortRows(sortRows(rows, 'money'), 'seat').map((r) => r.seat)).toEqual(rows.map((r) => r.seat));
  });

  it('요약 칩 "접속 n/m · 준비 r · 미응답 k"', () => {
    const online = rows.filter((r) => r.online).length;
    const ready = rows.filter((r) => r.ready).length;
    const nr = rows.filter((r) => r.responded === false).length;
    expect(summaryText(rows)).toBe(`접속 ${online}/30 · 준비 ${ready} · 미응답 ${nr}`);
  });

  it('마지막 접속 시각은 미접속 학생에게만', () => {
    const seen = new Map([[11, 123], [1, 456]]);
    const r2 = buildRows(demo.game, demo.view, seen);
    const s11 = r2.find((r) => r.seat === 11) as StudentRow;
    const s1 = r2.find((r) => r.seat === 1) as StudentRow;
    expect(s11.online).toBe(false);
    expect(s11.lastSeenAt).toBe(123);
    expect(s1.lastSeenAt).toBeNull();
  });
});

/** 데모 판에서 지금 사건만 바꿔 끼우기 */
function withEvent(id: string, edit?: (g: TeacherGame) => TeacherGame): TeacherGame {
  let g: TeacherGame = { ...demo.game, class: { ...demo.game.class, currentEvent: { id, openedAt: 0, closesAt: null, closed: false, short: false } } };
  if (edit) g = edit(g);
  return g;
}

describe('응답 판정 — 103 aggregate와 같은 규칙(수정 1회차)', () => {
  it('(i) 응답이 필요 없는 사건(차시 표지 등)이 떠 있으면 미응답 0명, 응답 칸은 "·"', () => {
    const noResp = Object.values(eventsById).filter((e) => !e.needsResponse && e.lesson === 'L1');
    expect(noResp.length).toBeGreaterThan(0);
    for (const e of noResp) {
      const g = withEvent(e.id);
      const r = buildRows(g, demo.view);
      expect(r.every((x) => x.responded === null)).toBe(true);
      expect(filterRows(r, 'noResponse')).toHaveLength(0);
      expect(summaryText(r)).toMatch(/미응답 0$/);
      expect(currentResponseCount(g)).toBeNull();
      expect(aggregate(g.class, g.players).event).toBeNull();
    }
  });

  it('(ii) 확인 퀴즈는 그 구간 지정 문항을 모두 푼 학생을 응답함으로 센다(표·타임라인·aggregate 같은 수 — 111에서 구간 문항 기준으로)', () => {
    const quiz = Object.values(eventsById).find((e) => e.kind === 'checkQuiz' && e.needsResponse);
    expect(quiz).toBeDefined();
    const qs = checkQuizFor(quiz!.lesson);
    const solved = new Set([1, 2, 3, 5, 8]);
    const g = withEvent(quiz!.id, (g0) => {
      const players = { ...g0.players };
      for (const s of solved) {
        const k = seatKey(s);
        const p = players[k]!;
        players[k] = { ...p, game: { ...p.game, checkQuiz: Object.fromEntries(qs.map((q) => [q.id, 'right' as const])) } };
      }
      // 한 문항만 푼 학생·다른 구간 문항만 푼 학생은 아직 응답 안 함
      const k9 = seatKey(9);
      players[k9] = { ...players[k9]!, game: { ...players[k9]!.game, checkQuiz: { [qs[0]!.id]: 'wrong' } } };
      const k10 = seatKey(10);
      players[k10] = { ...players[k10]!, game: { ...players[k10]!.game, checkQuiz: { 'Q-other': 'right' } } };
      return { ...g0, players };
    });
    const r = buildRows(g, demo.view);
    expect(r.filter((x) => x.responded === true).map((x) => x.seat)).toEqual([...solved]);
    expect(filterRows(r, 'noResponse')).toHaveLength(30 - solved.size);
    expect(currentResponseCount(g)).toEqual({ responded: solved.size, total: 30 });
    expect(aggregate(g.class, g.players).event?.responded).toBe(solved.size);
  });

  it('응답이 필요한 보통 사건: 표의 응답 수 = aggregate 응답 수', () => {
    const g = demo.game;
    const agg = aggregate(g.class, g.players).event;
    expect(agg).not.toBeNull();
    expect(buildRows(g, demo.view).filter((x) => x.responded === true).length).toBe(agg!.responded);
    expect(currentResponseCount(g)).toEqual({ responded: agg!.responded, total: agg!.total });
  });
});
