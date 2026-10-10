/**
 * 작업 114 — 판 길이 매트릭스(화면 없이, 실제 교사 리듀서 = 103 hostReduce + 123 무역 시계 훅).
 * 차시 한 판 L1 10·15·30분, 연속 구간 L1~L2 20분, 단원 전체 한 판 25분(v0.3.1)을 배치표대로 가짜 시계로 끝까지 돌린다.
 *
 * 확인: 1등급 누락 0(발동 안 된 1등급 없음), 학습지 번호 누락 0(무역 중 팝업으로 열렸거나 '끝나고 쓰기' 목록에 있음),
 * 시간 끝 처리(무역 끝 → 마무리, 남은 시간 0, 마무리 항목에 결산·시상 L4-E7·되돌아보기 L4-E9).
 * L2~L4 사건은 아직 골격(115~117)이라 L1 구간은 내용까지, 나머지 구간은 배치표·구간 전환만 본다.
 */
import { describe, expect, it } from 'vitest';
import { tradeClock, tradeWorksheets, type HostSnapshot, type PlayUnit } from '../../src/core';
import type { LessonId, WorksheetId } from '../../src/data/types';
import { seatKey } from '../../src/sync/host-session';
import { newTeacherGame, teacherReducer, type TeacherGame } from '../../src/teacher/game';

const T0 = Date.UTC(2026, 9, 12, 1, 0, 0);

function run(g: TeacherGame, input: Parameters<typeof teacherReducer>[1], now: number): TeacherGame {
  return teacherReducer(g, input, now).snapshot;
}

/** 판을 만들고 학생 n명 입장·회사 설립 → 무역 시작 → 끝까지 1초 틱. 반환: 끝난 스냅숏, 무역 경과(초) 기록 */
function playToEnd(playUnit: PlayUnit, scope: LessonId[], minutes: number, n = 4) {
  let g = newTeacherGame({ className: '6-1', playUnit, scope, tradeMinutes: minutes, settings: { progressMode: 'auto' }, overrides: {}, seed: 99, now: T0 });
  for (let seat = 1; seat <= n; seat++) {
    g = run(g, { type: 'join', seat, pid: `pid${seat}x`, companyName: `회사${seat}무역`, nameKey: `회사${seat}무역`, nameStatus: 'ok' }, T0);
    g = run(g, { type: 'act', seat, seq: 1, action: { type: 'foundCompany', color: 'blue', emblem: 'star', avatar: 'captain-1' } }, T0);
  }
  let now = T0 + 1000;
  g = run(g, { type: 'teacher', action: { type: 'startTrade' } }, now);
  const opened = new Set<WorksheetId>();
  const stages: LessonId[] = [];
  let seq = 2;
  for (let i = 0; i < (minutes + 10) * 60 && g.class.phase !== 'wrapup'; i++) {
    now += 1000;
    g = run(g, { type: 'tick' }, now);
    for (const id of g.class.worksheet.current ?? []) opened.add(id);
    if (stages.at(-1) !== g.class.stage) stages.push(g.class.stage);
    // 라운드마다 출항 준비(항해 처리 확인용)
    if (g.class.phase === 'round' && i % 20 === 0) {
      for (let seat = 1; seat <= n; seat++) {
        const p = g.players[seatKey(seat)]!;
        if (p.game.ready) continue;
        const dest = g.class.openPorts.find((x) => x !== p.game.port) ?? null;
        g = run(g, { type: 'act', seat, seq: seq, action: { type: 'setDestination', port: dest } }, now);
        g = run(g, { type: 'act', seat, seq: seq + 1, action: { type: 'setReady' } }, now);
      }
      seq += 2;
    }
  }
  return { g, opened, stages, now };
}

function check(g: HostSnapshot, opened: Set<WorksheetId>, scope: LessonId[], minutes: number, contentStages: LessonId[]) {
  const cs = g.class;
  const problems: string[] = [];
  // 시간 끝 처리
  if (cs.phase !== 'wrapup') problems.push(`phase ${cs.phase}`);
  if (!cs.tradeEnded) problems.push('tradeEnded false');
  const left = tradeClock.remaining(cs.clock, T0 + 10 ** 9);
  if (left > 0) problems.push(`남은 시간 ${left}`);
  // 1등급 누락 0
  for (const it of cs.schedule.items) {
    if (it.kind !== 'event' && it.kind !== 'stageCover') continue;
    if (it.tier !== 1 && it.kind !== 'stageCover') continue;
    if (!contentStages.includes(it.stage as LessonId) && it.kind === 'event') continue;
    if (it.form === 'dropped') problems.push(`${it.id} 빠짐(dropped)`);
    else if (it.status !== 'done') problems.push(`${it.id} ${it.status}`);
  }
  // 학습지 번호 누락 0(무역 중 열림 또는 끝나고 쓰기)
  const after = new Set((cs.schedule.wrapup ?? []).flatMap((w) => w.worksheetIds));
  for (const st of scope) {
    for (const w of tradeWorksheets(st)) if (!opened.has(w) && !after.has(w)) problems.push(`${w} 안 열림·끝나고 쓰기에도 없음`);
  }
  // 마무리 구성: 결산·시상 → 되돌아보기
  const wrap = cs.schedule.wrapup ?? [];
  const ids = wrap.map((w) => w.eventId).filter(Boolean);
  if (!ids.includes('L4-E7') || !ids.includes('L4-E9')) problems.push(`마무리 ${ids.join(',')}`);
  if (ids.indexOf('L4-E7') > ids.indexOf('L4-E9')) problems.push('결산·시상이 되돌아보기 뒤');
  const reflect = wrap.find((w) => w.eventId === 'L4-E9');
  const wantQ = scope.includes('L4') ? 3 : 2;
  if (reflect?.questions !== wantQ) problems.push(`되돌아보기 문항 ${reflect?.questions} (기대 ${wantQ})`);
  // 무역 시간이 판 길이와 맞다(일시정지 없음): 시작~끝 = T분 ± 2분(차단형 활동 중 시간 끝 대기 최대 2분)
  void minutes;
  return problems;
}

describe('판 길이 매트릭스(배치표 → 가짜 시계로 끝까지)', () => {
  const cases: { name: string; playUnit: PlayUnit; scope: LessonId[]; minutes: number; content: LessonId[] }[] = [
    { name: '차시 한 판 L1 10분', playUnit: 'lesson', scope: ['L1'], minutes: 10, content: ['L1'] },
    { name: '차시 한 판 L1 15분', playUnit: 'lesson', scope: ['L1'], minutes: 15, content: ['L1'] },
    { name: '차시 한 판 L1 30분', playUnit: 'lesson', scope: ['L1'], minutes: 30, content: ['L1'] },
    { name: '연속 구간 L1~L2 20분', playUnit: 'custom', scope: ['L1', 'L2'], minutes: 20, content: ['L1'] },
    { name: '단원 전체 한 판 25분', playUnit: 'unit', scope: ['L1', 'L2', 'L3', 'L4'], minutes: 25, content: ['L1'] },
  ];
  it.each(cases.map((c) => [c.name, c] as const))('%s', (_n, c) => {
    const { g, opened, stages, now } = playToEnd(c.playUnit, c.scope, c.minutes);
    expect(check(g, opened, c.scope, c.minutes, c.content)).toEqual([]);
    // 구간 전환: 범위의 구간을 차례로 모두 지남
    expect(stages).toEqual(c.scope);
    // 무역 시간 = 판 길이(+ 시간 끝 대기 최대 2분)
    const tradeSec = (now - (T0 + 1000)) / 1000;
    expect(tradeSec).toBeGreaterThanOrEqual(c.minutes * 60);
    expect(tradeSec).toBeLessThanOrEqual(c.minutes * 60 + 125);
    // 모든 학생 같은 라운드까지 항해 처리
    const rounds = Object.values(g.players).map((p) => p.game.resolvedRound);
    expect(new Set(rounds).size).toBe(1);
    expect(rounds[0]).toBe(g.class.round);
    // L1 구간의 1등급 사건(천연가스 임무·흑연 결정·무역 정의)이 실제로 발동됨
    for (const id of ['L1-COVER', 'L1-E2', 'L1-E6', 'L1-E7']) expect(g.class.firedEvents, id).toContain(id);
  });
});
