/**
 * 작업 132: '지금 쓰기'(③★·⑭★, PRD 4.3.3.1)가 자동 진행·다시 배치·완료 집계에서 번호와 따로 움직이는지.
 */
import { describe, expect, it } from 'vitest';
import { hostReduce } from '../../src/core/host';
import { createTradeHooks } from '../../src/core/trade';
import { aggregate } from '../../src/core/aggregate';
import type { HostSnapshot, ScheduleItem, TeacherAction } from '../../src/core/types';
import { makeSession } from './helpers';

const hooks = createTradeHooks();
const T0 = 10_000;

function start(minutes: number): HostSnapshot {
  let s = makeSession({ n: 2, scope: ['L1', 'L2', 'L3', 'L4'], playUnit: 'unit' });
  s = hostReduce(s, { type: 'teacher', action: { type: 'updateSettings', settings: { tradeMinutes: minutes, worksheetWaitSec: 0 } } }, T0 - 1, hooks).snapshot;
  return hostReduce(s, { type: 'teacher', action: { type: 'startTrade' } }, T0, hooks).snapshot;
}
const ticks = (s: HostSnapshot, from: number, to: number, each?: (x: HostSnapshot) => void) => {
  for (let t = from; t <= to; t++) {
    s = hostReduce(s, { type: 'tick' }, T0 + t * 1000, hooks).snapshot;
    each?.(s);
  }
  return s;
};
const teach = (s: HostSnapshot, action: TeacherAction, sec: number) => hostReduce(s, { type: 'teacher', action }, T0 + sec * 1000, hooks).snapshot;
const item = (s: HostSnapshot, id: string) => s.class.schedule.items.find((it) => it.id === id) as ScheduleItem;

describe('지금 쓰기 — 자동 진행·다시 배치', () => {
  it('단원 25분: ③★ 팝업이 during 으로 뜨고, 학생 완료는 duringDone 에만, 공개 집계 duringDone', () => {
    let s = start(25);
    const w3 = item(s, 'wsd:W03');
    s = ticks(s, 1, w3.at + 1);
    expect(s.class.phase).toBe('worksheet');
    expect(s.class.worksheet.current).toEqual(['W03']);
    expect(s.class.worksheet.during).toBe(true);
    s = hostReduce(s, { type: 'act', seat: 1, seq: 1, action: { type: 'markWorksheetDone', ids: ['W03'], during: true } }, T0 + (w3.at + 2) * 1000, hooks).snapshot;
    const p1 = Object.values(s.players).find((p) => p.seat === 1)!;
    expect(p1.game.duringDone).toEqual(['W03']);
    expect(p1.game.worksheetDone).toEqual([]);
    const pub = aggregate(s.class, s.players);
    expect(pub.duringDone).toEqual({ W03: 1 });
    expect(pub.worksheetDone).toEqual({});
    s = ticks(s, w3.at + 2, w3.at + 45);
    expect(item(s, 'wsd:W03').status).toBe('done');
    expect(s.class.worksheet.during).toBe(false);
  });

  it('③★ 을 띄운 뒤 연장해도 ③★ 은 다시 넣지 않고, ③ 번호는 끝나고 쓰기에 남는다', () => {
    let s = start(25);
    const w3 = item(s, 'wsd:W03');
    const at = w3.at + 50;
    s = ticks(s, 1, at);
    expect(item(s, 'wsd:W03').status).toBe('done');
    s = teach(s, { type: 'extend', sec: 300 }, at);
    const d3 = s.class.schedule.items.filter((it) => it.placement === 'during' && it.refId === 'W03');
    expect(d3).toHaveLength(1);
    expect(d3[0].status).toBe('done');
    // ⑭★ 은 아직 — 다시 배치해도 남아 있다
    expect(s.class.schedule.items.filter((it) => it.id === 'wsd:W14' && it.status === 'pending')).toHaveLength(1);
    s = teach(s, { type: 'finishNow' }, at + 1);
    s = ticks(s, at + 2, at + 130);
    expect(s.class.schedule.wrapup!.find((w) => w.id === 'afterWorksheet')!.worksheetIds).toContain('W03');
  });

  it('두 섬이 진행 중일 때 다시 배치하면 ③★ 은 구간 맨 앞(두 섬 끝)으로 옮겨 온다', () => {
    let s = start(25);
    const e5 = item(s, 'ev:L1-E5');
    s = ticks(s, 1, e5.at + 5);
    expect(item(s, 'ev:L1-E5').status).toBe('live');
    s = teach(s, { type: 'extend', sec: 60 }, e5.at + 5);
    const w3 = s.class.schedule.items.filter((it) => it.id === 'wsd:W03');
    expect(w3).toHaveLength(1);
    expect(w3[0].status).toBe('pending');
    const e5b = item(s, 'ev:L1-E5');
    expect(w3[0].at).toBe(e5b.at + e5b.durSec);
  });
});
