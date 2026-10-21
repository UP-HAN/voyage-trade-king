/**
 * 작업 165: 학습지 ⑥ 함께 쓰기 — 다시 배치(연장)해도 세관 게시판 뒤에 라운드 2개(PRD 4.1.1 v0.3.10).
 * 배치표 기대값은 tests/core/schedule.test.ts 끝 describe.
 */
import { describe, expect, it } from 'vitest';
import { hostReduce, startSession } from '../../src/core';
import { createTradeHooks } from '../../src/core/trade';
import { alongCardOn, alongPlanned } from '../../src/student/worksheet/along';
import type { HostSnapshot, ScheduleItem, TeacherAction } from '../../src/core/types';

const hooks = createTradeHooks();
const T0 = 10_000;

function start(minutes: number): HostSnapshot {
  let s = startSession({ code: '482137', playUnit: 'lesson', scope: ['L2'], seed: 12345, now: 0, hostToken: 'host-token', settings: { lessonPart: 'front' } });
  s = hostReduce(s, { type: 'join', seat: 1, pid: 'p1', deviceToken: 'd1', companyName: '해오름1', nameKey: '해오름1' }, 0).snapshot;
  s = hostReduce(s, { type: 'teacher', action: { type: 'updateSettings', settings: { tradeMinutes: minutes, worksheetWaitSec: 0 } } }, T0 - 1, hooks).snapshot;
  return hostReduce(s, { type: 'teacher', action: { type: 'startTrade' } }, T0, hooks).snapshot;
}
const item = (s: HostSnapshot, id: string) => s.class.schedule.items.find((it) => it.id === id) as ScheduleItem;
const teach = (s: HostSnapshot, action: TeacherAction, sec: number) => hostReduce(s, { type: 'teacher', action }, T0 + sec * 1000, hooks).snapshot;

describe('세관 게시판 자리 — 다시 배치(작업 165)', () => {
  it('앞 시간 25분: 라운드 2 진행 중 +5분 해도 세관 게시판 뒤 라운드 2개, ⑤가 바로 뒤', () => {
    let s = start(25);
    let sec = 0;
    for (; sec < 1500 && item(s, 'r:2')?.status !== 'live'; sec++) {
      s = hostReduce(s, { type: 'tick' }, T0 + sec * 1000, hooks).snapshot;
    }
    expect(s.class.phase).toBe('round');
    s = teach(s, { type: 'extend', sec: 300 }, sec);
    const e6 = item(s, 'ev:L2-E6');
    expect(e6.status).toBe('pending');
    const after = s.class.schedule.items.filter((it) => it.kind === 'round' && it.at >= e6.at + e6.durSec);
    expect(after).toHaveLength(2);
    expect(item(s, 'ws:W05').at).toBe(e6.at + e6.durSec);
    expect(s.class.schedule.items.filter((it) => it.kind === 'round' && it.status === 'pending' && it.at < e6.at).length).toBeGreaterThanOrEqual(1);
    for (const r of s.class.schedule.items.filter((it) => it.kind === 'round' && it.status === 'pending')) expect(r.durSec).toBeGreaterThanOrEqual(90);
  });

  it('앞 시간 25분 자동 진행: ⑤가 닫히면 라운드 4가 열리고 그때 안내 카드 조건이 켜지며, ⑥이 뜨면 꺼진다', () => {
    let s = start(25);
    let sawOn = false;
    let onRound: string | null = null;
    for (let sec = 1; sec < 1600 && item(s, 'ws:W06').status === 'pending'; sec++) {
      s = hostReduce(s, { type: 'tick' }, T0 + sec * 1000, hooks).snapshot;
      if (alongCardOn(s.class)) {
        sawOn = true;
        onRound ??= s.class.schedule.items.find((it) => it.kind === 'round' && it.status === 'live')?.id ?? null;
        expect(item(s, 'ws:W05').status).toBe('done');
      } else if (item(s, 'ws:W05').status === 'pending') expect(sawOn).toBe(false);
    }
    expect(sawOn).toBe(true);
    expect(onRound).toBe('r:4');
    expect(item(s, 'ws:W06').status).toBe('live');
    expect(alongPlanned(s.class)).toBe(true);
    expect(alongCardOn(s.class)).toBe(false);
  });

  it('학생이 ⑤를 바로 다 써서 일찍 닫혀도(다음 라운드가 앞으로 당겨짐) 맨 끝 ⑥ 팝업 때 alongPlanned 그대로', () => {
    let s = start(25);
    let seq = 1;
    for (let sec = 1; sec < 1600 && item(s, 'ws:W06').status !== 'live'; sec++) {
      s = hostReduce(s, { type: 'tick' }, T0 + sec * 1000, hooks).snapshot;
      const cur = s.class.worksheet.current;
      if (s.class.phase === 'worksheet' && cur?.[0] === 'W05' && !s.players[Object.keys(s.players)[0]!]!.game.worksheetDone.includes('W05')) {
        s = hostReduce(s, { type: 'act', seat: 1, seq: seq++, action: { type: 'markWorksheetDone', ids: ['W05'] } }, T0 + sec * 1000 + 100, hooks).snapshot;
        s = hostReduce(s, { type: 'teacher', action: { type: 'closeWorksheet' } }, T0 + sec * 1000 + 200, hooks).snapshot;
        s = hostReduce(s, { type: 'teacher', action: { type: 'startRoundNow', confirm: true } }, T0 + sec * 1000 + 300, hooks).snapshot;
      }
    }
    expect(item(s, 'ws:W06').status).toBe('live');
    const w5 = item(s, 'ws:W05');
    const r4 = item(s, 'r:4');
    expect(w5.status).toBe('done');
    expect(r4.at).toBeLessThan(w5.at + w5.durSec); // 당겨졌다
    expect(alongPlanned(s.class)).toBe(true);
  });
});
