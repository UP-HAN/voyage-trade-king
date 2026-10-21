/**
 * 작업 109 학생 표: 필터(작업 137 — 전체·도움이 필요해요·[더 보기] 7종)·정렬·요약 칩, `?demo=30` 가짜 데이터.
 */
import { describe, expect, it } from 'vitest';
import { makeDemo } from '../../src/teacher/demo';
import { aggregate, seatKey } from '../../src/core';
import { checkQuizFor } from '../../src/data/checkQuiz';
import { eventsById } from '../../src/data/events';
import type { TeacherGame } from '../../src/teacher/game';
import { FILTERS, HELP_FILTERS, MORE_FILTERS, buildRows, currentResponseCount, filterCounts, filterRows, matchesFilter, nowTaskOf, sortRows, summaryText, type StudentRow } from '../../src/teacher/table';
import type { ClassState, Player } from '../../src/core';

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

  it('필터: 전체 + 도움이 필요해요 + [더 보기] 7종(쉬운 말 — 작업 137)', () => {
    expect(FILTERS.map((f) => f.label)).toEqual(['전체', '도움이 필요해요', '들어오지 않음', '응답 안 함', '출항 준비 안 함', '임무 아직', '학습지 안 씀', '다시 들어오기 요청', '이름 확인']);
    expect(MORE_FILTERS).toEqual(['offline', 'noResponse', 'notReady', 'missionTodo', 'noWorksheet', 'rejoin', 'nameCheck']);
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

  it("'도움이 필요해요' = 들어오지 않음 ∪ 응답 안 함 ∪ 학습지 안 씀 ∪ 다시 들어오기 요청 ∪ 이름 확인(합집합, 겹쳐도 한 번)", () => {
    const union = new Set<number>();
    for (const f of HELP_FILTERS) for (const r of filterRows(rows, f)) union.add(r.seat);
    expect(HELP_FILTERS).toEqual(['offline', 'noResponse', 'noWorksheet', 'rejoin', 'nameCheck']);
    for (const r of rows) if (r.now.done === false) union.add(r.seat); // (작업 148) 지금 할 일을 아직 안 한 학생
    expect(filterRows(rows, 'help').map((r) => r.seat)).toEqual([...union].sort((a, b) => a - b));
    expect(filterCounts(rows).help).toBe(union.size);
    // 출항 준비 안 함·임무 아직만 걸린 학생(지금 할 일은 없음)은 '도움이 필요해요'에 들지 않는다
    const base: StudentRow = { ...rows[0]!, online: true, responded: true, worksheetDone: true, rejoinRequested: false, nameStatus: 'ok', ready: false, missionsDone: 0, missionsTotal: 2, now: { text: '기다리는 중', done: null } };
    expect(matchesFilter(base, 'help')).toBe(false);
    expect(matchesFilter({ ...base, online: false }, 'help')).toBe(true);
    expect(matchesFilter({ ...base, responded: false }, 'help')).toBe(true);
    expect(matchesFilter({ ...base, worksheetDone: false }, 'help')).toBe(true);
    expect(matchesFilter({ ...base, rejoinRequested: true }, 'help')).toBe(true);
    expect(matchesFilter({ ...base, nameStatus: 'checkRealName' }, 'help')).toBe(true);
    expect(matchesFilter({ ...base, now: { text: '목적지 고르는 중', done: false } }, 'help')).toBe(true);
    expect(matchesFilter({ ...base, now: { text: '출항 준비 끝', done: true } }, 'help')).toBe(false);
    // 응답할 활동·학습지가 없으면(null) 걸리지 않는다
    expect(matchesFilter({ ...base, responded: null, worksheetDone: null }, 'help')).toBe(false);
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

  it('요약 칩 "들어옴 n/m · 출항 준비 r · 응답 안 함 k"(쉬운 말 — 작업 137)', () => {
    const online = rows.filter((r) => r.online).length;
    const ready = rows.filter((r) => r.ready).length;
    const nr = rows.filter((r) => r.responded === false).length;
    expect(summaryText(rows)).toBe(`들어옴 ${online}/30 · 출항 준비 ${ready} · 응답 안 함 ${nr}`);
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
      expect(summaryText(r)).toMatch(/응답 안 함 0$/);
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

/** (작업 148) 데모 판의 반 상태·학생 1번을 바꿔 끼우기 — 학생 1번은 회사를 만든 상태로 */
function gameWith(cls: Partial<ClassState>, game: Partial<Player['game']> = {}, founded = true): TeacherGame {
  const players = { ...demo.game.players };
  const k = seatKey(1);
  const p = players[k]!;
  players[k] = { ...p, company: { ...p.company, founded }, game: { ...p.game, ...game } };
  return { ...demo.game, class: { ...demo.game.class, ...cls }, players };
}
const P1 = (g: TeacherGame) => g.players[seatKey(1)]!;
const task = (g: TeacherGame) => nowTaskOf(g, P1(g));
const noWs: ClassState['worksheet'] = { ...demo.game.class.worksheet, current: null, during: false };
const started: ClassState['clock'] = { ...demo.game.class.clock, startedAt: 1 };
const live = { clock: started, paused: false, tradeEnded: false };
const openEv = (id: string): ClassState['currentEvent'] => ({ id, openedAt: 0, closesAt: null, closed: false, short: false });

describe("작업 148 '지금 할 일'(nowTaskOf) — 9줄 규칙", () => {
  const needResp = Object.values(eventsById).find((e) => e.needsResponse && e.kind !== 'checkQuiz')!;
  const noResp = Object.values(eventsById).find((e) => !e.needsResponse)!;

  it('1) 학생 없음·무역 끝 → "·" null', () => {
    expect(nowTaskOf(demo.game, undefined)).toEqual({ text: '·', done: null });
    expect(task(gameWith({ ...live, tradeEnded: true }))).toEqual({ text: '·', done: null });
    expect(task(gameWith({ ...live, phase: 'wrapup' }))).toEqual({ text: '·', done: null });
    expect(task(gameWith({ ...live, phase: 'ended' }))).toEqual({ text: '·', done: null });
  });

  it('2) 회사 안 만듦 → 회사 만드는 중 false', () => {
    expect(task(gameWith({ ...live }, {}, false))).toEqual({ text: '회사 만드는 중', done: false });
  });

  it('3) 무역 시작 전 → 회사 만듦 true', () => {
    expect(task(gameWith({ ...live, clock: { ...started, startedAt: null }, phase: 'prep' }))).toEqual({ text: '회사 만듦', done: true });
  });

  it('4) 멈춤 → 멈춤 null', () => {
    expect(task(gameWith({ ...live, paused: true }))).toEqual({ text: '멈춤', done: null });
  });

  it('5) 학습지 팝업(묶음) → 다 씀 / 쓰는 중', () => {
    const cls = { ...live, phase: 'worksheet' as const, worksheet: { ...noWs, current: ['W01'] } as ClassState['worksheet'] };
    expect(task(gameWith(cls, { worksheetDone: ['W01'] }))).toEqual({ text: '학습지 다 씀', done: true });
    expect(task(gameWith(cls, { worksheetDone: [] }))).toEqual({ text: '학습지 쓰는 중', done: false });
  });

  it('6) 라운드 밖 응답 필요 사건 → 응답함 / 응답하는 중', () => {
    const cls = { ...live, phase: 'event' as const, worksheet: noWs, currentEvent: openEv(needResp.id) };
    expect(task(gameWith(cls, { responses: { [needResp.id]: 'a' } }))).toEqual({ text: '응답함', done: true });
    expect(task(gameWith(cls, { responses: {} }))).toEqual({ text: '응답하는 중', done: false });
  });

  it('7) 라운드 밖 응답 없는 카드·표지 → 카드 읽음 / 카드 읽는 중', () => {
    const cls = { ...live, phase: 'event' as const, worksheet: noWs, currentEvent: openEv(noResp.id) };
    expect(task(gameWith(cls, { responses: { [noResp.id]: true } }))).toEqual({ text: '카드 읽음', done: true });
    expect(task(gameWith(cls, { responses: {} }))).toEqual({ text: '카드 읽는 중', done: false });
  });

  it('8) 라운드 중 → 출항 준비 끝 / 목적지 … 출항 준비 아직 / 목적지 고르는 중', () => {
    const cls = { ...live, phase: 'round' as const, worksheet: noWs, currentEvent: null };
    expect(task(gameWith(cls, { ready: true }))).toEqual({ text: '출항 준비 끝', done: true });
    expect(task(gameWith(cls, { ready: false, dest: 'SHA' }))).toEqual({ text: '목적지 상하이 · 출항 준비 아직', done: false });
    expect(task(gameWith(cls, { ready: false, dest: null }))).toEqual({ text: '목적지 고르는 중', done: false });
    // 라운드 중 열린 사건이 있어도 라운드 규칙(6·7줄은 라운드 밖만)
    expect(task(gameWith({ ...cls, currentEvent: openEv(noResp.id) }, { ready: false, dest: null, responses: {} }))).toEqual({ text: '목적지 고르는 중', done: false });
  });

  it('151 자유 항해 라운드 → 사고팔기 ✓ · 항해 k번 / 아직 사고팔기 전 · 항해 k번', () => {
    const settings = { ...demo.game.class.settings, voyageMode: 'free' as const };
    const cls = { ...live, phase: 'round' as const, worksheet: noWs, currentEvent: null, settings, round: 2 };
    const buy = { round: 2, stage: 'L1' as const, kind: 'buy' as const, amount: 10 };
    const old = { round: 1, stage: 'L1' as const, kind: 'sell' as const, amount: 10 };
    expect(task(gameWith(cls, { log: [buy], sailsThisRound: 2 }))).toEqual({ text: '사고팔기 ✓ · 항해 2번', done: true });
    expect(task(gameWith(cls, { log: [old], sailsThisRound: 0 }))).toEqual({ text: '아직 사고팔기 전 · 항해 0번', done: false });
  });

  it('9) 그 밖(사건 사이) → 기다리는 중 null', () => {
    expect(task(gameWith({ ...live, phase: 'between', worksheet: noWs, currentEvent: null }))).toEqual({ text: '기다리는 중', done: null });
    // 닫힌 사건도 '기다리는 중'
    expect(task(gameWith({ ...live, phase: 'between', worksheet: noWs, currentEvent: { ...openEv(noResp.id)!, closed: true } }))).toEqual({ text: '기다리는 중', done: null });
  });

  it('★ 지금 쓰기 중 duringDone만 있는 학생 → 학습지 칸 다 씀, 지금 할 일 "학습지 다 씀"', () => {
    const g = gameWith({ ...live, phase: 'worksheet', worksheet: { ...noWs, current: ['W01'], during: true } }, { worksheetDone: [], duringDone: ['W01'] });
    const r = buildRows(g, demo.view).find((x) => x.seat === 1)!;
    expect(r.worksheetDone).toBe(true);
    expect(r.now).toEqual({ text: '학습지 다 씀', done: true });
    expect(matchesFilter(r, 'noWorksheet')).toBe(false);
    // 반대로 번호만 끝내고(worksheetDone) ★ 칸을 안 쓴 학생은 아직
    const g2 = gameWith({ ...live, phase: 'worksheet', worksheet: { ...noWs, current: ['W01'], during: true } }, { worksheetDone: ['W01'], duringDone: [] });
    const r2 = buildRows(g2, demo.view).find((x) => x.seat === 1)!;
    expect(r2.worksheetDone).toBe(false);
    expect(r2.now).toEqual({ text: '학습지 쓰는 중', done: false });
  });

  it("라운드 중 출항 준비 안 한 학생이 '도움이 필요해요'에 든다", () => {
    const g = gameWith({ ...live, phase: 'round', worksheet: noWs, currentEvent: null }, { ready: false, dest: null });
    const r = buildRows(g, demo.view);
    expect(r.find((x) => x.seat === 1)!.now.done).toBe(false);
    expect(filterRows(r, 'help').map((x) => x.seat)).toContain(1);
  });
});
