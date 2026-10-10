/**
 * 작업 134: 학생 화면 라운드 전·사이 상태 카드 문구(roundWaitInfo) — 공개 상태(publicClass)와 서버 시각만으로 계산.
 */
import { describe, expect, it } from 'vitest';
import { hostReduce, publicClass } from '../../src/core';
import { createTradeHooks } from '../../src/core/trade';
import type { HostSnapshot } from '../../src/core/types';
import { roundWaitInfo } from '../../src/student/GameScreen';
import { makeSession } from '../core/helpers';

const hooks = createTradeHooks();
const T0 = 50_000;

function start(minutes: number, manual = false): HostSnapshot {
  let s = makeSession({ n: 1 });
  s = hostReduce(s, { type: 'teacher', action: { type: 'updateSettings', settings: { tradeMinutes: minutes } } }, T0 - 1, hooks).snapshot;
  if (manual) s = hostReduce(s, { type: 'teacher', action: { type: 'setProgressMode', mode: 'manual' } }, T0 - 1, hooks).snapshot;
  return hostReduce(s, { type: 'teacher', action: { type: 'startTrade' } }, T0, hooks).snapshot;
}

describe('roundWaitInfo', () => {
  it('차시 L1 10분: 무역 시작 20초 뒤 "라운드 1까지 3:30"', () => {
    const s = start(10);
    const info = roundWaitInfo(publicClass(s.class), T0 + 20_000);
    expect(info.title).toBe('지금은 다 함께 활동하는 시간이에요');
    expect(info.line).toBe('라운드 1까지 3:30');
  });

  it('라운드 사이: "다음 라운드까지 m:ss"', () => {
    let s = start(10);
    let e = 1;
    for (; !(s.class.round === 1 && s.class.phase !== 'round'); e++) s = hostReduce(s, { type: 'tick' }, T0 + e * 1000, hooks).snapshot;
    const info = roundWaitInfo(publicClass(s.class), T0 + e * 1000);
    expect(info.title).toBe('지금은 라운드 사이 활동 시간이에요');
    expect(info.line).toMatch(/^다음 라운드까지 \d:\d{2}$/);
  });

  it('수동 진행: "선생님이 시작하면 라운드가 열려요"', () => {
    const s = start(10, true);
    expect(roundWaitInfo(publicClass(s.class), T0 + 5000).line).toBe('선생님이 시작하면 라운드가 열려요');
  });
});
