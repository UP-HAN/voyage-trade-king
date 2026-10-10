/**
 * 부하 테스트 스크립트 스모크(작업 105 v0.3.1-6): 작은 설정(방 3 × 학생 5, 0.2분)으로 끝까지 도는지만 확인.
 * 진짜 부하 측정은 `npm run loadtest -- --rooms 50 --students 30 --minutes 5`(기본 테스트에 넣지 않음).
 */
import { describe, expect, it } from 'vitest';
import { defaultStages, parseArgs, runLoadTest } from '../../server/scripts/loadtest';

describe('부하 테스트 스크립트', () => {
  it('인자 읽기·기본 단계(10 → 30 → 50)', () => {
    const o = parseArgs(['--rooms', '50', '--students', '30', '--minutes', '5']);
    expect(o).toMatchObject({ rooms: 50, students: 30, minutes: 5, stages: [10, 30, 50], stageMinutes: 2, workers: 4, interval: 0.3 });
    expect(defaultStages(100)).toEqual([10, 60, 100]);
    expect(parseArgs(['--rooms', '100', '--stages', '100']).stages).toEqual([100]);
    expect(parseArgs(['--rooms', '100']).maxRooms).toBe(100);
  });

  it('--rooms 3 --students 5 --minutes 0.2 가 끝까지 돌고 결과·상한 확인을 낸다', async () => {
    const o = parseArgs(['--rooms', '3', '--students', '5', '--minutes', '0.2', '--stages', '3', '--warmup', '1', '--in-process', '--quiet']);
    const r = await runLoadTest(o);
    expect(r.stages).toHaveLength(1);
    const s = r.stages[0]!;
    expect(s.rooms).toBe(3);
    expect(s.conns).toBe(18);
    expect(s.samples).toBeGreaterThan(100);
    expect(s.p95).toBeGreaterThan(0);
    expect(s.inPerSec).toBeGreaterThan(50);
    expect(s.outFramesPerSec).toBeGreaterThan(50);
    expect(s.unexpectedClose).toBe(0);
    expect(s.errors).toEqual({});
    expect(r.limits).toMatchObject({ busyAt51: true, healthAcceptingFalse: true, roomLimitAt11: true });
  }, 60_000);
});
