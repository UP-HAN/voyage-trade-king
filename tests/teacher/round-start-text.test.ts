/**
 * 작업 134 교사 결정 3: [무역 시작] 확인 창 안내가 배치표와 일치(10·15·25분, 차시·단원 표본)
 * + 상단 "라운드 1까지 m:ss" 문구, [지금 라운드 시작] 확인 창 본문.
 */
import { describe, expect, it } from 'vitest';
import { firstRoundPreview, hostReduce, roundNowPlan, tryBuildSchedule, inputFromClass } from '../../src/core';
import { createTradeHooks } from '../../src/core/trade';
import type { HostSnapshot, PlayUnit } from '../../src/core/types';
import type { LessonId } from '../../src/data/types';
import { itemLabel, minSecText, nextRoundText, roundNowConfirmBody, startConfirmText } from '../../src/teacher/schedule-view';
import { makeSession } from '../core/helpers';

const hooks = createTradeHooks();
const T0 = 10_000;

function setup(playUnit: PlayUnit, scope: LessonId[], minutes: number, manual = false): HostSnapshot {
  let s = makeSession({ n: 1, playUnit, scope });
  s = hostReduce(s, { type: 'teacher', action: { type: 'updateSettings', settings: { tradeMinutes: minutes, ...(manual ? { progressMode: 'manual' as const } : {}) } } }, T0 - 1, hooks).snapshot;
  return s;
}

describe('[무역 시작] 확인 창 안내 = 배치표', () => {
  const CASES: [PlayUnit, LessonId[], number][] = [
    ['lesson', ['L1'], 10], ['lesson', ['L1'], 15], ['lesson', ['L1'], 25],
    ['lesson', ['L2'], 10], ['lesson', ['L3'], 15], ['lesson', ['L4'], 25],
    ['unit', ['L1', 'L2', 'L3', 'L4'], 25], ['unit', ['L1', 'L2', 'L3', 'L4'], 40],
  ];
  it.each(CASES)('%s %s %i분', (pu, scope, m) => {
    const s = setup(pu, scope, m);
    const text = startConfirmText(s.class, pu, scope);
    // 실제로 [무역 시작]을 누르면 만들어지는 배치표
    const started = hostReduce(s, { type: 'teacher', action: { type: 'startTrade' } }, T0, hooks).snapshot;
    const p = firstRoundPreview(started.class.schedule.items)!;
    expect(text).toContain(`무역 시간 ${m}분이 시작돼요`);
    expect(text).toContain(`약 ${minSecText(p.atSec)} 뒤 라운드 1이 시작돼요`);
    for (const it of p.activities) expect(text).toContain(itemLabel(it));
    expect(text).toContain('[라운드 바로 시작]으로 당길 수 있어요');
    // 미리 계산한 배치표(같은 입력)와도 같다
    const pre = tryBuildSchedule(inputFromClass(s.class, pu, scope));
    expect(pre.ok && firstRoundPreview(pre.schedule.items)!.atSec).toBe(p.atSec);
  });

  it('차시 L1 10분 문구 그대로', () => {
    const s = setup('lesson', ['L1'], 10);
    expect(startConfirmText(s.class, 'lesson', ['L1'])).toBe(
      // v0.3.8(작업 153): 차시 L1 10분 '알아서' = 차시 끝에 모아서 → 벽란도 시장이 빠져 라운드 1이 당겨짐
      "무역 시간 10분이 시작돼요. 먼저 무역·수입·수출 활동을 하고 약 2분 20초 뒤 라운드 1이 시작돼요(사전 활동 중에도 '지금 할 일' 카드의 [라운드 바로 시작]으로 당길 수 있어요). 학생 화면·TV에는 남은 시간이 보이지 않아요 — 라운드가 열리면 저절로 알려요.",
    );
  });

  it('수동 진행(선생님이 하나씩 넘기기)이면 [다음으로] 안내 — 작업 137 쉬운 말', () => {
    const s = setup('lesson', ['L1'], 15, true);
    expect(startConfirmText(s.class, 'lesson', ['L1'])).toContain('선생님이 하나씩 넘기는 방식이라 [다음으로]를 눌러야 다음 순서가 시작돼요');
  });
});

describe('상단 표시·확인 창', () => {
  it('"라운드 1까지 2:00"(v0.3.8 배치) → [지금 라운드 시작] 확인 창에 무역·수입·수출 이름', () => {
    let s = setup('lesson', ['L1'], 10);
    s = hostReduce(s, { type: 'teacher', action: { type: 'startTrade' } }, T0, hooks).snapshot;
    expect(nextRoundText(s.class, T0 + 20_000)).toBe('라운드 1까지 2:00');
    const body = roundNowConfirmBody(roundNowPlan(s.class, T0 + 20_000));
    expect(body).toContain('「무역·수입·수출」');
    // v0.3.8(작업 153): 10분 '알아서'는 벽란도 시장이 빠진 배치라 '함께 빠지는 활동' 줄이 없다
    expect(body).not.toContain('함께 빠지는 활동');
    expect(body).toContain('이 차시의 꼭 할 활동이에요');
    s = hostReduce(s, { type: 'teacher', action: { type: 'startRoundNow', confirm: true } }, T0 + 20_000, hooks).snapshot;
    expect(nextRoundText(s.class, T0 + 21_000)).toBeNull();
  });
});
