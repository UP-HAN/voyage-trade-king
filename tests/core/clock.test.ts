/** 작업 123: 무역 시계 + 틱 자동 진행 + 교사 시간 조작(PRD 4.2.2, 7.8) */
import { describe, expect, it } from 'vitest';
import * as clock from '../../src/core/clock';
import { hostReduce } from '../../src/core/host';
import { normalizeSnapshot, seatKey } from '../../src/core/state';
import { createTradeHooks, lateness, OVERTIME_ROUND_MIN_SEC, TIME_UP_GRACE_SEC, tradeRemaining } from '../../src/core/trade';
import type { HostInput, HostOutput, HostSnapshot, ScheduleItem, TeacherAction } from '../../src/core/types';
import type { LessonId } from '../../src/data/types';
import { makeSession, planDone } from './helpers';

const hooks = createTradeHooks();
const ALL: LessonId[] = ['L1', 'L2', 'L3', 'L4'];
const T0 = 10_000;

function run(snap: HostSnapshot, input: HostInput, now: number) {
  return hostReduce(snap, input, now, hooks);
}
function teach(snap: HostSnapshot, action: TeacherAction, now: number) {
  return run(snap, { type: 'teacher', action }, now);
}
/**
 * from~to(ms) 1초 틱. finish = (작업 162) 계획한 순서가 다 끝나면 교사가 [마무리로](finishNow)를 누른다 —
 * 판은 더 이상 저절로 끝나지 않는다.
 */
function tickRange(snap: HostSnapshot, from: number, to: number, onTick?: (s: HostSnapshot, now: number, out: HostOutput[]) => void, finish = false) {
  let s = snap;
  const outs: HostOutput[] = [];
  for (let t = from; t <= to; t += 1000) {
    const r = run(s, { type: 'tick' }, t);
    s = r.snapshot;
    outs.push(...r.outputs);
    if (finish && planDone(s.class)) {
      const f = teach(s, { type: 'finishNow' }, t);
      s = f.snapshot;
      outs.push(...f.outputs);
    }
    onTick?.(s, t, r.outputs);
  }
  return { snap: s, outs };
}
function started(opts: { scope?: LessonId[]; playUnit?: 'lesson' | 'unit' | 'custom'; n?: number; manual?: boolean } = {}) {
  let s = makeSession({ n: opts.n ?? 4, scope: opts.scope ?? ['L1'], playUnit: opts.playUnit ?? 'lesson' });
  if (opts.manual) s = teach(s, { type: 'updateSettings', settings: { progressMode: 'manual' } }, T0 - 1).snapshot;
  return teach(s, { type: 'startTrade' }, T0);
}
const item = (s: HostSnapshot, id: string) => s.class.schedule.items.find((it) => it.id === id) as ScheduleItem;
const notices = (outs: HostOutput[], code: string) => outs.filter((o) => o.kind === 'notice' && o.code === code);

describe('clock.ts(순수)', () => {
  it('시작·일시정지·이어서·연장·단축·hostGap', () => {
    let c = clock.startTrade(clock.idleClock(600), 1000);
    expect(c.endsAt).toBe(1000 + 600_000);
    expect(clock.elapsedSec(c, 61_000)).toBe(60);
    c = clock.pause(c, 61_000);
    expect(clock.remaining(c, 200_000)).toBe(540); // 일시정지 중 시간이 줄지 않음
    c = clock.resume(c, 121_000);
    expect(c.pausedTotalSec).toBe(60);
    expect(c.endsAt).toBe(1000 + 660_000);
    expect(clock.elapsedSec(c, 121_000)).toBe(60);
    c = clock.extend(c, 120);
    expect(c.durationSec).toBe(720);
    expect(clock.shorten(c, 700, 121_000)).toBeNull(); // 지난 시각보다 앞당길 수 없음
    c = clock.shorten(c, 60, 121_000)!;
    expect(c.durationSec).toBe(660);
    expect(clock.hostGap(c, 3)).toBe(c); // 5초 미만 무시
    const g = clock.hostGap(c, 30);
    expect(g.pausedTotalSec).toBe(90);
    expect(clock.elapsedSec(g, 151_000)).toBe(60);
    expect(clock.elapsedRatio(g, 151_000)).toBeCloseTo(60 / 660, 5);
    expect(clock.isTimeUp(g, 1000 + (660 + 90) * 1000)).toBe(true);
  });
});

describe('무역 시작과 자동 진행(통합: hostReduce 에 틱)', () => {
  it('단원 판 25분: 배치표 시각에 맞춰 표지·사건·라운드·편지가 발동하고, 순서가 끝나 교사가 [마무리로]를 누르면 마무리', () => {
    const r0 = started({ scope: ALL, playUnit: 'unit', n: 5 });
    let snap = r0.snapshot;
    const plan = snap.class.schedule.items.map((it) => ({ ...it }));
    expect(snap.class.clock.startedAt).toBe(T0);
    expect(snap.class.schedule.version).toBe(1);
    expect(snap.class.currentEvent?.id).toBe('L1-COVER'); // 시작 순간 표지

    const roundStarts: Record<number, number> = {};
    const res = tickRange(snap, T0 + 1000, T0 + 25 * 60_000 + 3000, (s, t) => {
      if (s.class.phase === 'round' && roundStarts[s.class.round] === undefined) roundStarts[s.class.round] = t;
    }, true);
    snap = res.snap;
    const cs = snap.class;
    // 라운드: 계획한 수만큼, 계획 시각에(1초 틱 오차)
    const planRounds = plan.filter((it) => it.kind === 'round');
    expect(cs.round).toBe(planRounds.length);
    for (const r of planRounds) expect(Math.abs(roundStarts[r.round!] - (T0 + r.at * 1000))).toBeLessThanOrEqual(1000);
    // 사건·표지: 빠지지 않은 것은 모두 발동
    for (const it of plan.filter((x) => (x.kind === 'event' || x.kind === 'stageCover') && x.form !== 'dropped' && x.variant !== 'summary')) {
      expect(cs.firedEvents, it.refId).toContain(it.refId);
    }
    for (const it of plan.filter((x) => x.kind === 'event' && x.form === 'short')) expect(cs.shortEvents).toContain(it.refId);
    // 편지: 계획한 슬롯이 모두 도착했고, hostReduce 를 거쳐 학생별 문항이 고정됨
    const planLetters = plan.filter((it) => it.kind === 'letter').map((it) => it.refId);
    expect(cs.letters.delivered).toEqual(planLetters);
    for (const p of Object.values(snap.players)) expect(Object.keys(p.game.letters.assigned).sort()).toEqual([...planLetters].sort());
    // 도약 기준 자산 기록
    for (const p of Object.values(snap.players)) expect(p.game.metrics.baseAsset).not.toBeNull();
    // 끝: 마무리, 남은 항목 없음, 마무리 목록
    expect(cs.phase).toBe('wrapup');
    expect(cs.tradeEnded).toBe(true);
    expect(cs.schedule.items.filter((it) => it.status === 'pending' && it.form !== 'dropped')).toHaveLength(0);
    expect(cs.schedule.wrapup!.map((w) => w.id)).toContain('awards');
    expect(notices(res.outs, 'TRADE_ENDED')).toHaveLength(1);
    expect(notices(res.outs, 'UPCOMING').length).toBeGreaterThan(5);
  });

  it("차시 한 판 L1 25분(v0.3.8, 작업 153): '알아서' = 활동마다 바로 ①→②→③→④, ★ 없음, 끝나고 쓰기 없음", () => {
    let snap = started({ scope: ['L1'], n: 3 }).snapshot;
    const ws = snap.class.schedule.items.filter((it) => it.kind === 'worksheet');
    expect(ws.map((it) => it.id)).toEqual(['ws:W01', 'ws:W02', 'ws:W03', 'ws:W04']);
    const seen: string[] = [];
    let during = 0;
    snap = tickRange(snap, T0 + 1000, T0 + 25 * 60_000 + 2000, (s) => {
      const cur = s.class.worksheet.current?.join(',');
      if (s.class.phase === 'worksheet' && cur && seen[seen.length - 1] !== cur) seen.push(cur);
      if (s.class.worksheet.during) during++;
    }, true).snap;
    expect(seen).toEqual(['W01', 'W02', 'W03', 'W04']);
    expect(during).toBe(0);
    for (const w of ws) expect(item(snap, w.id).status).toBe('done');
    expect(snap.class.worksheet.mode).toBe('each');
    expect(snap.class.phase).toBe('wrapup');
    expect(snap.class.schedule.wrapup!.find((w) => w.id === 'afterWorksheet')!.worksheetIds).toEqual([]);
  });
});

describe('일시정지·hostGap', () => {
  it('일시정지 중 무역 시간이 줄지 않고 발동도 멈춘다', () => {
    let snap = started().snapshot;
    snap = tickRange(snap, T0 + 1000, T0 + 30_000).snap;
    snap = teach(snap, { type: 'pause' }, T0 + 30_000).snapshot;
    const rem = tradeRemaining(snap.class, T0 + 30_000);
    const fired = snap.class.firedEvents.length;
    snap = tickRange(snap, T0 + 31_000, T0 + 300_000).snap;
    expect(tradeRemaining(snap.class, T0 + 300_000)).toBe(rem);
    expect(snap.class.firedEvents.length).toBe(fired);
    snap = teach(snap, { type: 'resume' }, T0 + 300_000).snapshot;
    expect(snap.class.clock.pausedTotalSec).toBe(270);
    expect(snap.class.clock.endsAt).toBe(T0 + (1500 + 270) * 1000);
    expect(tradeRemaining(snap.class, T0 + 301_000)).toBe(rem - 1);
  });

  it('hostGap(5초 이상)은 일시정지로: 무역 시계와 라운드 타이머를 뒤로 민다', () => {
    let snap = started().snapshot;
    const r1 = item(snap, 'r:1');
    snap = tickRange(snap, T0 + 1000, T0 + (r1.at + 10) * 1000).snap;
    expect(snap.class.phase).toBe('round');
    const endsAt = snap.class.roundEndsAt!;
    const now = T0 + (r1.at + 70) * 1000; // 60초 끊겼다가 돌아옴(그동안 틱 없음)
    snap = run(snap, { type: 'hostGap', gapMs: 60_000 }, now).snapshot;
    expect(snap.class.clock.pausedTotalSec).toBe(60);
    expect(snap.class.roundEndsAt).toBe(endsAt + 60_000);
    expect(clock.elapsedSec(snap.class.clock, now)).toBe(r1.at + 10);
    snap = run(snap, { type: 'tick' }, now).snapshot;
    expect(snap.class.phase).toBe('round'); // 끊긴 동안 라운드가 끝나지 않음
    const small = run(snap, { type: 'hostGap', gapMs: 3000 }, now + 3000).snapshot;
    expect(small.class.clock.pausedTotalSec).toBe(60);
  });
});

describe('추천 시간(작업 162 — 시간이 지나도 판이 저절로 끝나지 않음)', () => {
  it('라운드 중 T가 지나면: 알림 OVERTIME 1번, 라운드는 제 타이머대로, 무역은 계속 → [마무리로]로만 마무리', () => {
    let snap = started({ n: 3 }).snapshot;
    const r1 = item(snap, 'r:1');
    const e = r1.at + 30;
    snap = tickRange(snap, T0 + 1000, T0 + e * 1000).snap;
    expect(snap.class.phase).toBe('round');
    const roundEndsAt = snap.class.roundEndsAt;
    snap = teach(snap, { type: 'shorten', sec: 1500 - (e + 5) }, T0 + e * 1000).snapshot;
    expect(snap.class.clock.durationSec).toBe(e + 5);
    const r = tickRange(snap, T0 + (e + 1) * 1000, T0 + (e + 60) * 1000);
    snap = r.snap;
    // 옛 동작: 즉시 무역 끝 → 마무리. 새 동작: 알림만, 라운드는 그대로
    expect(snap.class.tradeEnded).toBe(false);
    expect(snap.class.phase).toBe('round');
    expect(snap.class.roundEndsAt).toBe(roundEndsAt);
    expect(notices(r.outs, 'OVERTIME')).toHaveLength(1);
    expect(notices(r.outs, 'TRADE_ENDED')).toHaveLength(0);
    expect(snap.class.schedule.timeUp).toBeTruthy();
    const f = teach(snap, { type: 'finishNow' }, T0 + (e + 61) * 1000);
    snap = f.snapshot;
    expect(snap.class.tradeEnded).toBe(true);
    expect(snap.class.phase).toBe('wrapup');
    expect(notices(f.outputs, 'TRADE_ENDED')).toHaveLength(1);
    for (const p of Object.values(snap.players)) expect(p.game.resolvedRound).toBe(snap.class.round);
  });

  it('차단형 활동 중 T가 지나도: 2분 유예 뒤에도 끝나지 않고 활동이 그대로, 활동을 닫아도 끝나지 않음', () => {
    let snap = started({ manual: true }).snapshot;
    expect(snap.class.schedule.mode).toBe('manual');
    snap = teach(snap, { type: 'fireNow', id: 'cover:L1' }, T0 + 1000).snapshot;
    snap = teach(snap, { type: 'fireNow', id: 'ev:L1-E2' }, T0 + 2000).snapshot;
    expect(snap.class.phase).toBe('event');
    snap = teach(snap, { type: 'shorten', sec: 1500 - 5 }, T0 + 2000).snapshot;
    const r = tickRange(snap, T0 + 3000, T0 + (TIME_UP_GRACE_SEC + 30) * 1000);
    snap = r.snap;
    expect(notices(r.outs, 'OVERTIME')).toHaveLength(1);
    expect(notices(r.outs, 'TIME_UP')).toHaveLength(0);
    expect(snap.class.tradeEnded).toBe(false);
    expect(snap.class.phase).toBe('event');

    // 활동을 닫아도 마무리로 가지 않는다(옛 동작: 바로 마무리)
    let s2 = started({ manual: true }).snapshot;
    s2 = teach(s2, { type: 'fireNow', id: 'cover:L1' }, T0 + 1000).snapshot;
    s2 = teach(s2, { type: 'shorten', sec: 1500 - 3 }, T0 + 1000).snapshot;
    s2 = tickRange(s2, T0 + 2000, T0 + 5000).snap;
    expect(s2.class.schedule.timeUp).toBeTruthy();
    s2 = teach(s2, { type: 'closeEvent' }, T0 + 6000).snapshot;
    s2 = tickRange(s2, T0 + 7000, T0 + 200_000).snap;
    expect(s2.class.tradeEnded).toBe(false);
    expect(s2.class.phase).toBe('between');
    // [마무리로]
    let s3 = started({ manual: true }).snapshot;
    s3 = teach(s3, { type: 'finishNow' }, T0 + 1000).snapshot;
    expect(s3.class.phase).toBe('wrapup');
  });

  it('T 뒤에도 밀린 항목이 차례로 발동하고, 늦게 여는 라운드는 최소 90초', () => {
    // 선생님이 하나씩 넘기기로 두고 아무것도 열지 않은 채 T(25분)를 넘긴 뒤 자동 진행으로 돌린다 → 모든 항목이 T 뒤에 늦게 발동
    let snap = started({ n: 2, manual: true }).snapshot;
    const plan = snap.class.schedule.items.map((it) => ({ ...it }));
    const over = tickRange(snap, T0 + 1000, T0 + 1510 * 1000);
    snap = over.snap;
    expect(notices(over.outs, 'OVERTIME')).toHaveLength(1);
    expect(snap.class.firedEvents).toHaveLength(0);
    snap = teach(snap, { type: 'setProgressMode', mode: 'auto' }, T0 + 1510 * 1000).snapshot;
    const lens: number[] = [];
    let prevRound = 0;
    const r = tickRange(snap, T0 + 1511 * 1000, T0 + 4000 * 1000, (s, t) => {
      if (s.class.phase === 'round' && s.class.round !== prevRound && s.class.roundEndsAt !== null) {
        prevRound = s.class.round;
        lens.push(Math.round((s.class.roundEndsAt - t) / 1000));
      }
    }, true);
    snap = r.snap;
    // 계획한 라운드가 모두 열렸고 모두 90초 이상
    expect(lens).toHaveLength(plan.filter((it) => it.kind === 'round').length);
    for (const l of lens) expect(l).toBeGreaterThanOrEqual(OVERTIME_ROUND_MIN_SEC - 1);
    // 빠지지 않은 사건·학습지가 모두 발동(T 뒤에도 fireDue 가 돈다) → 순서가 끝나 [마무리로]
    for (const it of plan.filter((x) => x.kind === 'event' && x.form !== 'dropped')) expect(snap.class.firedEvents, it.refId).toContain(it.refId);
    expect(notices(r.outs, 'OVERTIME')).toHaveLength(0); // 한 번만
    expect(snap.class.phase).toBe('wrapup');
  });
});

describe('수동 진행', () => {
  it('발동하지 않고 대기 표시 + 늦은 시간이 늘어난다', () => {
    let snap = started({ manual: true }).snapshot;
    expect(snap.class.firedEvents).toHaveLength(0);
    snap = tickRange(snap, T0 + 1000, T0 + 60_000).snap;
    expect(snap.class.firedEvents).toHaveLength(0);
    expect(snap.class.schedule.waiting).toBe('cover:L1');
    const l1 = lateness(snap, T0 + 60_000);
    snap = tickRange(snap, T0 + 61_000, T0 + 240_000).snap;
    const l2 = lateness(snap, T0 + 240_000);
    expect(l1.lateSec).toBe(60);
    expect(l2.lateSec).toBe(240);
    expect(l2.waitingId).toBe('cover:L1');
    expect(snap.class.firedEvents).toHaveLength(0);
    // [발동] 하면 진행
    snap = teach(snap, { type: 'fireNow', id: 'cover:L1' }, T0 + 241_000).snapshot;
    expect(snap.class.firedEvents).toContain('L1-COVER');
    // 많이 늦으면 빠질 활동이 생긴다
    const l3 = lateness(snap, T0 + 20 * 60_000);
    expect(l3.wouldDrop.length).toBeGreaterThan(0);
  });
});

describe('교사 행동: 연장·단축·미루기·건너뛰기·형태 바꾸기', () => {
  it('연장하면 빠졌던 2등급이 되살아나고 version 이 오른다', () => {
    let snap = started({ scope: ALL, playUnit: 'unit' }).snapshot;
    const droppedBefore = snap.class.schedule.items.filter((it) => it.kind === 'event' && it.form === 'dropped' && it.tier === 2).map((it) => it.refId);
    expect(droppedBefore.length).toBeGreaterThan(0);
    snap = run(snap, { type: 'tick' }, T0 + 1000).snapshot;
    const v = snap.class.schedule.version;
    snap = teach(snap, { type: 'extend', sec: 15 * 60 }, T0 + 1000).snapshot;
    expect(snap.class.schedule.version).toBe(v + 1);
    expect(snap.class.clock.durationSec).toBe(40 * 60);
    expect(snap.class.clock.endsAt).toBe(T0 + 40 * 60_000);
    const revived = droppedBefore.filter((id) => snap.class.schedule.items.find((it) => it.kind === 'event' && it.refId === id)!.form !== 'dropped');
    expect(revived.length).toBeGreaterThan(0);
    const end = Math.max(...snap.class.schedule.items.map((it) => it.at + it.durSec));
    expect(end).toBe(40 * 60);
  });

  it('단축하면 이미 지난 항목은 그대로, 지난 시각보다 앞당길 수는 없다', () => {
    let snap = started({ scope: ALL, playUnit: 'unit' }).snapshot;
    snap = tickRange(snap, T0 + 1000, T0 + 500_000).snap;
    const past = snap.class.schedule.items.filter((it) => it.status !== 'pending');
    expect(past.length).toBeGreaterThan(5);
    const r = teach(snap, { type: 'shorten', sec: 5 * 60 }, T0 + 500_000);
    const after = r.snapshot.class.schedule.items;
    for (const p of past) expect(after.find((it) => it.id === p.id)).toEqual(p);
    expect(r.snapshot.class.clock.durationSec).toBe(20 * 60);
    expect(Math.max(...after.map((it) => it.at + it.durSec))).toBe(20 * 60);
    const bad = teach(r.snapshot, { type: 'shorten', sec: 15 * 60 }, T0 + 500_000);
    expect(notices(bad.outputs, 'CANNOT_SHORTEN')).toHaveLength(1);
    expect(bad.snapshot.class.clock.durationSec).toBe(20 * 60);
  });

  it('[1분 미루기]·[건너뛰기](1등급은 확인)·[넣기/짧게/빼기]·라운드 길이·진행 방식', () => {
    let snap = started().snapshot;
    snap = run(snap, { type: 'tick' }, T0 + 5000).snapshot;
    let v = snap.class.schedule.version;
    const e2 = item(snap, 'ev:L1-E2');
    snap = teach(snap, { type: 'postpone', id: 'ev:L1-E2', sec: 60 }, T0 + 5000).snapshot;
    expect(snap.class.schedule.version).toBe(++v);
    expect(item(snap, 'ev:L1-E2').at).toBeGreaterThanOrEqual(e2.at + 60);

    const r = teach(snap, { type: 'skipItem', id: 'L1-E2' }, T0 + 6000);
    expect(notices(r.outputs, 'NEEDS_CONFIRM')).toHaveLength(1);
    expect(item(r.snapshot, 'ev:L1-E2').status).toBe('pending');
    snap = teach(r.snapshot, { type: 'skipItem', id: 'L1-E2', confirm: true }, T0 + 6000).snapshot;
    expect(item(snap, 'ev:L1-E2').status).toBe('skipped');
    expect(snap.class.schedule.version).toBe(++v);

    const t1 = teach(snap, { type: 'setItemForm', id: 'L1-E6', form: 'dropped' }, T0 + 7000);
    expect(notices(t1.outputs, 'TIER1_CANNOT_DROP')).toHaveLength(1);
    snap = teach(snap, { type: 'setItemForm', id: 'L1-E5', form: 'dropped' }, T0 + 7000).snapshot;
    expect(item(snap, 'ev:L1-E5').form).toBe('dropped');
    expect(item(snap, 'ev:L1-E5').pinned).toBe(true);
    expect(snap.class.schedule.version).toBe(++v);

    snap = teach(snap, { type: 'setRoundSec', sec: 240 }, T0 + 8000).snapshot;
    expect(snap.class.settings.roundSec).toBe(240);
    expect(snap.class.schedule.version).toBe(++v);

    snap = teach(snap, { type: 'setProgressMode', mode: 'manual' }, T0 + 9000).snapshot;
    expect(snap.class.schedule.mode).toBe('manual');
    expect(snap.class.settings.progressMode).toBe('manual');
  });

  it('훅이 없으면 103 동작 그대로(NOT_IMPLEMENTED)', () => {
    const s = makeSession({ n: 1 });
    const r = hostReduce(s, { type: 'teacher', action: { type: 'startTrade' } }, T0);
    expect(notices(r.outputs, 'NOT_IMPLEMENTED')).toHaveLength(1);
  });

  it('무역 시작 전 [빼기]는 배치 입력(overrides)으로 들어간다', () => {
    let s = makeSession({ n: 1 });
    s = teach(s, { type: 'setItemForm', id: 'L1-E1', form: 'dropped' }, T0 - 10).snapshot;
    s = teach(s, { type: 'startTrade' }, T0).snapshot;
    expect(item(s, 'ev:L1-E1').form).toBe('dropped');
    expect(item(s, 'ev:L1-E1').pinned).toBe(true);
    expect(s.players[seatKey(1)]).toBeDefined();
  });
});

describe('수정 1회차(PRD v0.3.3)', () => {
  it('일찍 끝낸 라운드(10초 이상): 다시 배치(version + 1)하고 다음 항목이 바로 시작한다', () => {
    let snap = started().snapshot;
    const r1 = item(snap, 'r:1');
    const e = r1.at + 30;
    snap = tickRange(snap, T0 + 1000, T0 + e * 1000).snap;
    expect(snap.class.phase).toBe('round');
    const v = snap.class.schedule.version;
    snap = teach(snap, { type: 'endRound' }, T0 + e * 1000).snapshot;
    expect(snap.class.schedule.version).toBe(v + 1);
    expect(item(snap, 'r:1').status).toBe('done');
    // 다음 항목이 지금 시작했다(계획 시각을 기다리지 않음)
    const live = snap.class.schedule.items.filter((it) => it.status === 'live');
    expect(live.length).toBeGreaterThan(0);
    for (const it of live) expect(Math.abs(it.at - e)).toBeLessThanOrEqual(1);
    expect(snap.class.schedule.items.filter((it) => it.status === 'pending' && it.form !== 'dropped' && it.at < e)).toHaveLength(0);
    // 차시 한 판(단일 구간): 아낀 시간은 남은 라운드들에 나눠 더한다 → 판 끝 = T, 새 라운드 0
    const saved = r1.at + r1.durSec - e;
    expect(Math.max(...snap.class.schedule.items.filter((it) => it.form !== 'dropped').map((it) => it.at + it.durSec))).toBe(25 * 60);
    const plan = started().snapshot.class.schedule.items.filter((it) => it.kind === 'round');
    const now = snap.class.schedule.items.filter((it) => it.kind === 'round');
    expect(now.map((it) => it.id)).toEqual(plan.map((it) => it.id));
    const restSum = (xs: ScheduleItem[]) => xs.filter((it) => it.id !== 'r:1').reduce((a, it) => a + it.durSec, 0);
    expect(restSum(now) - restSum(plan)).toBe(saved);
  });

  it('10초 미만 일찍 끝내면 그대로(다음 항목은 계획 시각에)', () => {
    let snap = started().snapshot;
    const r1 = item(snap, 'r:1');
    const e = r1.at + r1.durSec - 5;
    snap = tickRange(snap, T0 + 1000, T0 + e * 1000).snap;
    const v = snap.class.schedule.version;
    const next = snap.class.schedule.items.find((it) => it.status === 'pending' && it.form !== 'dropped' && it.kind !== 'letter')!;
    snap = teach(snap, { type: 'endRound' }, T0 + e * 1000).snapshot;
    expect(snap.class.schedule.version).toBe(v);
    expect(item(snap, next.id).status).toBe('pending');
    expect(item(snap, next.id).at).toBe(next.at);
    snap = tickRange(snap, T0 + (e + 1) * 1000, T0 + (next.at - 1) * 1000).snap;
    expect(item(snap, next.id).status).toBe('pending');
    snap = run(snap, { type: 'tick' }, T0 + next.at * 1000).snapshot;
    expect(item(snap, next.id).status).not.toBe('pending');
  });

  it('시간 끝 대기(timeUp.at)도 hostGap 만큼 밀린다', () => {
    let snap = started({ manual: true }).snapshot;
    snap = teach(snap, { type: 'fireNow', id: 'cover:L1' }, T0 + 1000).snapshot;
    snap = teach(snap, { type: 'shorten', sec: 1500 - 3 }, T0 + 1000).snapshot;
    snap = tickRange(snap, T0 + 2000, T0 + 5000).snap;
    const at = snap.class.schedule.timeUp!.at;
    snap = run(snap, { type: 'hostGap', gapMs: 30_000 }, T0 + 35_000).snapshot;
    expect(snap.class.schedule.timeUp!.at).toBe(at + 30_000);
  });

  it('저장 → normalizeSnapshot → 복원: 123 배치표 필드가 그대로', () => {
    let s = makeSession({ n: 2 });
    s = teach(s, { type: 'setItemForm', id: 'L1-E5', form: 'dropped' }, T0 - 20).snapshot;
    s = teach(s, { type: 'setRoundSec', sec: 150 }, T0 - 10).snapshot;
    // 무역 시작 전
    const before = normalizeSnapshot(JSON.parse(JSON.stringify(s)))!;
    expect(before.class.schedule).toEqual(s.class.schedule);
    expect(before.class.schedule.overrides).toEqual({ 'L1-E5': 'dropped' });
    expect(before.class.schedule.roundSecAuto).toBe(false);
    // 무역 중
    s = teach(s, { type: 'startTrade' }, T0).snapshot;
    s = tickRange(s, T0 + 1000, T0 + 300_000).snap;
    const mid = normalizeSnapshot(JSON.parse(JSON.stringify(s)))!;
    expect(mid.class.schedule).toEqual(s.class.schedule);
    expect(mid.class.schedule.stageModes).toEqual(s.class.schedule.stageModes);
    expect(mid.class.schedule.version).toBe(s.class.schedule.version);
    // 복원한 스냅숏으로 이어서 해도 같은 결과
    const a = tickRange(s, T0 + 301_000, T0 + 600_000).snap;
    const b = tickRange(mid, T0 + 301_000, T0 + 600_000).snap;
    expect(b.class.schedule.items).toEqual(a.class.schedule.items);
    expect(b.class.round).toBe(a.class.round);
  });
});
