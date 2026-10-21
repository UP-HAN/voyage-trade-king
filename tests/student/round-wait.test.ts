/**
 * 작업 134: 학생 화면 라운드 전·사이 상태 카드 문구(roundWaitInfo) — 공개 상태(publicClass)와 서버 시각만으로 계산.
 */
import { describe, expect, it } from 'vitest';
import { hostReduce, publicClass } from '../../src/core';
import { createTradeHooks } from '../../src/core/trade';
import type { HostSnapshot } from '../../src/core/types';
import { playerView } from '../../src/core/host';
import { portLabel } from '../../src/data/ports';
import { roundWaitInfo } from '../../src/student/GameScreen';
import type { MeView } from '../../src/student/predict';
import { makeSession, player } from '../core/helpers';

const hooks = createTradeHooks();
const T0 = 50_000;

function start(minutes: number, manual = false): HostSnapshot {
  let s = makeSession({ n: 1 });
  s = hostReduce(s, { type: 'teacher', action: { type: 'updateSettings', settings: { tradeMinutes: minutes } } }, T0 - 1, hooks).snapshot;
  if (manual) s = hostReduce(s, { type: 'teacher', action: { type: 'setProgressMode', mode: 'manual' } }, T0 - 1, hooks).snapshot;
  return hostReduce(s, { type: 'teacher', action: { type: 'startTrade' } }, T0, hooks).snapshot;
}

describe('roundWaitInfo', () => {
  it('차시 L1 10분: 무역 시작 20초 뒤 "지금 활동이 끝나면 라운드 1이 열려요"(작업 159: 시간 숫자 없음)', () => {
    const s = start(10);
    const info = roundWaitInfo(publicClass(s.class), T0 + 20_000);
    expect(info.title).toBe('지금은 다 함께 활동하는 시간이에요');
    expect(info.line).toBe('지금 활동이 끝나면 라운드 1이 열려요'); // (작업 159) 남은 시간 숫자 없음
  });

  it('라운드 사이: "지금 활동이 끝나면 다음 라운드가 열려요"', () => {
    let s = start(10);
    let e = 1;
    for (; !(s.class.round === 1 && s.class.phase !== 'round'); e++) s = hostReduce(s, { type: 'tick' }, T0 + e * 1000, hooks).snapshot;
    const info = roundWaitInfo(publicClass(s.class), T0 + e * 1000);
    expect(info.title).toBe('지금은 라운드 사이 활동 시간이에요');
    expect(info.line).toBe('지금 활동이 끝나면 다음 라운드가 열려요');
  });

  it('수동 진행: "선생님이 시작하면 라운드가 열려요"', () => {
    const s = start(10, true);
    expect(roundWaitInfo(publicClass(s.class), T0 + 5000).line).toBe('선생님이 시작하면 라운드가 열려요');
  });

  // ── 작업 149 ──
  function me(s: HostSnapshot, fn?: (m: MeView) => void): MeView {
    const m = JSON.parse(JSON.stringify(playerView(player(s, 1)))) as MeView;
    fn?.(m);
    return m;
  }
  /** 자동 진행으로 라운드 1이 끝난 직후(라운드 사이) */
  function betweenRounds(): { s: HostSnapshot; now: number } {
    let s = start(10);
    let e = 1;
    for (; !(s.class.round === 1 && s.class.phase !== 'round'); e++) {
      s = hostReduce(s, { type: 'tick' }, T0 + e * 1000, hooks).snapshot;
      if (e > 3000) throw new Error('라운드 1이 끝나지 않음');
    }
    return { s, now: T0 + e * 1000 };
  }

  it('149 카드 확인 뒤(응답 없는 카드, 응답 기록 있음): "카드를 다 읽었어요 ✓", 줄은 "라운드 1까지 m:ss"', () => {
    const s = start(10);
    const cls = { ...publicClass(s.class), phase: 'event' as const, currentEvent: { id: 'L1-E2', openedAt: T0, closesAt: null, closed: false, short: false } };
    const info = roundWaitInfo(cls, T0 + 20_000, me(s, (m) => { m.game.responses['L1-E2'] = true; }));
    expect(info.title).toBe('카드를 다 읽었어요 ✓');
    expect(info.sub).toBe('선생님이 다음으로 넘기면 이어서 해요. 그동안 TV를 함께 봐요');
    expect(info.line).toBe('지금 활동이 끝나면 라운드 1이 열려요');
    // 아직 안 읽었으면 옛 문구
    expect(roundWaitInfo(cls, T0 + 20_000, me(s)).title).toBe('지금은 다 함께 활동하는 시간이에요');
    // 응답이 필요한 사건(L1-E3 결정)은 응답이 있어도 바꾸지 않음
    const dec = { ...cls, currentEvent: { ...cls.currentEvent, id: 'L1-E3' } };
    expect(roundWaitInfo(dec, T0 + 20_000, me(s, (m) => { m.game.responses['L1-E3'] = 'a'; })).title).not.toBe('카드를 다 읽었어요 ✓');
  });

  it('149 라운드 사이 도착(항해 기록): "○○에 도착했어요!" + 자동/수동 sub', () => {
    const { s, now } = betweenRounds();
    const cls = publicClass(s.class);
    const arrived = me(s, (m) => { m.game.log.push({ round: 1, stage: cls.stage, kind: 'voyage', port: 'lisbon', to: m.game.port, amount: 0 } as never); });
    const info = roundWaitInfo(cls, now, arrived);
    expect(info.title).toBe(`${portLabel(arrived.game.port)}에 도착했어요!`);
    expect(info.sub).toBe('다음 라운드가 열리면 여기 시장에서 사고팔 수 있어요');
    expect(info.line).toBe('지금 활동이 끝나면 다음 라운드가 열려요');
    // 출항하지 않았으면 "있어요"
    expect(roundWaitInfo(cls, now, me(s)).title).toBe(`지금 우리 배는 ${portLabel(arrived.game.port)}에 있어요`);
    // 수동 진행
    const man = { ...cls, schedule: { ...cls.schedule, mode: 'manual' as const } };
    const mi = roundWaitInfo(man, now, arrived);
    expect(mi.sub).toBe('선생님이 라운드를 열면 여기 시장에서 사고팔 수 있어요');
    expect(mi.line).toBe('선생님이 시작하면 라운드가 열려요');
  });

  it('151 자유 항해: 라운드 사이에는 도착 판정 없이 "지금 우리 배는 ○○에 있어요"', () => {
    const { s, now } = betweenRounds();
    const base = publicClass(s.class);
    const cls = { ...base, settings: { ...base.settings, voyageMode: 'free' as const } };
    const sailed = me(s, (m) => { m.game.log.push({ round: 1, stage: cls.stage, kind: 'voyage', port: 'BUS', to: m.game.port, amount: 0 } as never); });
    const info = roundWaitInfo(cls, now, sailed);
    expect(info.title).toBe(`지금 우리 배는 ${portLabel(sailed.game.port)}에 있어요`);
    expect(info.sub).toBe('다음 라운드가 열리면 여기 시장에서 사고팔 수 있어요');
  });

  it('149 남은 라운드 없음: 자동은 "곧 다 함께 정리 활동", 수동은 옛 문구, over=true', () => {
    const { s, now } = betweenRounds();
    const base = publicClass(s.class);
    const items = base.schedule.items.map((it) => (it.kind === 'round' && it.status === 'pending' ? { ...it, form: 'dropped' as const } : it));
    const cls = { ...base, schedule: { ...base.schedule, items } };
    const auto = roundWaitInfo(cls, now, me(s));
    expect(auto.over).toBe(true);
    expect(auto.title).toBe('라운드가 모두 끝났어요');
    expect(auto.line).toBe('남은 라운드가 없어요 · 곧 다 함께 정리 활동을 해요');
    const man = { ...cls, schedule: { ...cls.schedule, mode: 'manual' as const } };
    expect(roundWaitInfo(man, now, me(s)).line).toBe('남은 라운드가 없어요 · 선생님이 시작하면 정리 활동을 함께 해요');
  });

  it('149 me 없이 부르면 옛 결과와 같음', () => {
    const { s, now } = betweenRounds();
    const info = roundWaitInfo(publicClass(s.class), now);
    expect(info.title).toBe('지금은 라운드 사이 활동 시간이에요');
    expect(info.sub).toBe('라운드가 열리면 항구에서 사고팔고 출항할 수 있어요');
    expect(info.over).toBe(false);
    const s0 = start(10);
    const i0 = roundWaitInfo(publicClass(s0.class), T0 + 20_000);
    expect(i0).toEqual({ title: '지금은 다 함께 활동하는 시간이에요', line: '지금 활동이 끝나면 라운드 1이 열려요', sub: '라운드가 열리면 항구에서 사고팔고 출항할 수 있어요', over: false });
  });
});
