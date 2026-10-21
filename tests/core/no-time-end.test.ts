/**
 * 작업 162 — 무역 시간 T = '추천 시간'(PRD 4.2.2 v0.3.10): 시간이 지나도·계획 순서가 다 끝나도 판이 저절로 끝나지 않는다.
 * 판을 끝내는 것은 교사의 [마무리로](finishNow)뿐이고, 무역 중 [수업 끝내기](endSession)도 먼저 무역 끝 정산을 거친다.
 * 표본: 2차시 앞 시간 25분 자유 항해 판(공개수업 판), 같은 판의 라운드마다 판.
 */
import { describe, expect, it } from 'vitest';
import { hostReduce } from '../../src/core/host';
import { isSlotExpired, letterSlots } from '../../src/core/letters';
import { applyAction } from '../../src/core/rules';
import { canTrade, normalizeSnapshot, startSession } from '../../src/core/state';
import { createTradeHooks, OVERTIME_ROUND_MIN_SEC, roundNowPlan } from '../../src/core/trade';
import type { HostInput, HostOutput, HostSnapshot, TeacherAction } from '../../src/core/types';
import { editPlayer, makeSession, pidOf, planDone, player } from './helpers';

const hooks = createTradeHooks();
const T0 = 10_000;
const T = 25 * 60;

const run = (s: HostSnapshot, input: HostInput, now: number) => hostReduce(s, input, now, hooks);
const teach = (s: HostSnapshot, action: TeacherAction, now: number) => run(s, { type: 'teacher', action }, now);
const notices = (outs: HostOutput[], code: string) => outs.filter((o) => o.kind === 'notice' && o.code === code);

/** 2차시 앞 시간 25분 판(자동 진행). voyageMode 기본 'free'(교사 화면 2차시 기본값) */
function start(voyageMode: 'free' | 'round' = 'free', n = 3): HostSnapshot {
  let s = startSession({
    code: '482137', playUnit: 'lesson', scope: ['L2'], seed: 12345, now: 0, hostToken: 'host-token',
    settings: { voyageMode, lessonPart: 'front', tradeMinutes: 25, progressMode: 'auto' },
  });
  for (let seat = 1; seat <= n; seat++) {
    s = hostReduce(s, { type: 'join', seat, pid: pidOf(seat), deviceToken: `device-token-${seat}`, companyName: `해오름${seat}`, nameKey: `해오름${seat}` }, 0).snapshot;
  }
  return teach(s, { type: 'startTrade' }, T0).snapshot;
}

/** 경과 from~to초 1초 틱 */
function tickSec(s: HostSnapshot, from: number, to: number, onTick?: (s: HostSnapshot, e: number) => void) {
  const outs: HostOutput[] = [];
  for (let e = from; e <= to; e++) {
    const r = run(s, { type: 'tick' }, T0 + e * 1000);
    s = r.snapshot;
    outs.push(...r.outputs);
    onTick?.(s, e);
  }
  return { snap: s, outs };
}

describe('① 2차시 앞 시간 25분 판을 T + 5분까지 돌려도 마무리로 가지 않는다', () => {
  it('OVERTIME 알림 정확히 1번, tradeEnded false, phase ≠ wrapup, 계획한 라운드는 모두 함, 순서를 다 함', () => {
    const s0 = start();
    expect(s0.class.settings.voyageMode).toBe('free');
    expect(s0.class.settings.lessonPart).toBe('front');
    const rounds = s0.class.schedule.items.filter((it) => it.kind === 'round').length;
    let doneAt: number | null = null;
    const { snap, outs } = tickSec(s0, 1, T + 300, (s, e) => {
      if (doneAt === null && planDone(s.class)) doneAt = e;
    });
    expect(snap.class.tradeEnded).toBe(false);
    expect(snap.class.phase).not.toBe('wrapup');
    expect(snap.class.phase).toBe('between');
    expect(notices(outs, 'OVERTIME')).toHaveLength(1);
    expect(notices(outs, 'TRADE_ENDED')).toHaveLength(0);
    expect(notices(outs, 'PLAN_DONE')).toHaveLength(0);
    expect(notices(outs, 'TIME_UP')).toHaveLength(0);
    expect(snap.class.schedule.timeUp).toBeTruthy();
    expect(snap.class.round).toBe(rounds);
    expect(doneAt).not.toBeNull();
    expect(doneAt!).toBeLessThanOrEqual(T + 1);
    expect(planDone(snap.class)).toBe(true);
    // 학생들의 라운드 처리는 끝까지 맞다
    for (const p of Object.values(snap.players)) expect(p.game.resolvedRound).toBe(snap.class.round);
  });
});

describe('② T 직전에 늦어진 라운드·학습지가 T 뒤에도 발동한다(라운드 ≥ 90초)', () => {
  it('마지막 라운드 직전에 하나씩 넘기기로 멈춰 T를 넘긴 뒤 자동으로 돌리면 마지막 라운드·뒤 학습지가 열린다', () => {
    let s = start();
    const items = s.class.schedule.items;
    const last = items.filter((it) => it.kind === 'round').pop()!;
    const tail = items.filter((it) => it.kind === 'worksheet' && it.at >= last.at && it.form !== 'dropped');
    s = tickSec(s, 1, last.at - 3).snap;
    expect(s.class.round).toBe((last.round ?? 1) - 1);
    s = teach(s, { type: 'setProgressMode', mode: 'manual' }, T0 + (last.at - 3) * 1000).snapshot;
    s = tickSec(s, last.at - 2, T + 10).snap;
    expect(s.class.round).toBe((last.round ?? 1) - 1); // 하나씩 넘기기라 열리지 않음
    expect(s.class.schedule.timeUp).toBeTruthy();
    s = teach(s, { type: 'setProgressMode', mode: 'auto' }, T0 + (T + 10) * 1000).snapshot;
    let len: number | null = null;
    const r = tickSec(s, T + 11, T + 900, (x, e) => {
      if (len === null && x.class.phase === 'round' && x.class.round === last.round && x.class.roundEndsAt !== null) len = Math.round((x.class.roundEndsAt - (T0 + e * 1000)) / 1000);
    });
    s = r.snap;
    expect(len).not.toBeNull();
    expect(len!).toBeGreaterThanOrEqual(OVERTIME_ROUND_MIN_SEC - 1);
    for (const w of tail) expect(s.class.schedule.items.find((it) => it.id === w.id)!.status, w.id).toBe('done');
    expect(planDone(s.class)).toBe(true);
    expect(s.class.tradeEnded).toBe(false);
  });

  it('T 뒤에도 남은 라운드가 있으면 [라운드 지금 시작]이 막히지 않는다', () => {
    let s = start();
    s = teach(s, { type: 'setProgressMode', mode: 'manual' }, T0 + 500).snapshot;
    s = tickSec(s, 1, T + 20).snap;
    expect(s.class.schedule.timeUp).toBeTruthy();
    const plan = roundNowPlan(s.class, T0 + (T + 20) * 1000);
    expect(plan.block).toBeNull();
    const r = teach(s, { type: 'startRoundNow', confirm: true }, T0 + (T + 20) * 1000);
    expect(r.snapshot.class.phase).toBe('round');
  });
});

describe('③ 순서를 다 한 뒤', () => {
  it('자유 항해 판: 끝나지 않고 canTrade — 라운드 사이에 사고팔기·항해가 계속된다(T 뒤에도)', () => {
    let s = tickSec(start(), 1, T + 120).snap;
    expect(planDone(s.class)).toBe(true);
    expect(canTrade(s.class)).toBe(true);
    s = editPlayer(s, 1, (p) => {
      p.game.money = 5000;
    });
    const p = player(s, 1);
    const to = s.class.openPorts.find((x) => x !== p.game.port)!;
    const sail = hostReduce(s, { type: 'act', seat: 1, seq: 900, action: { type: 'sailTo', port: to } }, T0 + (T + 121) * 1000);
    expect(sail.outputs.find((o) => o.kind === 'ack' && 'ok' in o && !(o as { ok: boolean }).ok)).toBeUndefined();
    s = sail.snapshot;
    expect(player(s, 1).game.port).toBe(to);
    expect(player(s, 1).game.fareDue ?? 0).toBeGreaterThan(0);
    // 사기: 그 항구에서 살 수 있는 상품 하나라도
    const goods = ['graphite', 'gas', 'rice', 'chip', 'car', 'phone', 'steel', 'battery', 'oil', 'iron', 'cotton', 'coffee'];
    const ok = goods.some((g) => !applyAction(s.class, player(s, 1), { type: 'buy', good: g as never, qty: 1 }).error);
    expect(ok).toBe(true);
    // 그대로 5분 더 — 여전히 끝나지 않는다
    const more = tickSec(s, T + 122, T + 420);
    expect(more.snap.class.tradeEnded).toBe(false);
    expect(notices(more.outs, 'TRADE_ENDED')).toHaveLength(0);
  });

  it('라운드마다 판: 거래가 멈춘 채(canTrade false) [마무리로]를 기다린다', () => {
    const s = tickSec(start('round'), 1, T + 120).snap;
    expect(planDone(s.class)).toBe(true);
    expect(s.class.tradeEnded).toBe(false);
    expect(canTrade(s.class)).toBe(false);
    expect(applyAction(s.class, player(s, 1), { type: 'buy', good: 'chip' as never, qty: 1 }).error).toBe('NOT_TRADING');
  });
});

describe('④ 교사 [마무리로] 한 번으로 마무리', () => {
  it('운항비 정산(fareDue 0, 모자라면 대출)·남은 편지 만료·마무리 목록', () => {
    let s = tickSec(start(), 1, T + 60).snap;
    // 학생 1: 쌓인 운항비 50, 자금 0, 팔 물건 있음 → 모자란 50만큼 대출. 학생 2: 넉넉함
    s = editPlayer(s, 1, (p) => {
      p.game.money = 0;
      p.game.fareDue = 50;
      p.game.cargo = [{ good: 'chip' as never, qty: 1, unitCost: 10, origin: 'foreign', source: 'specialty', boughtAt: 'BUS' as never }];
    });
    s = editPlayer(s, 2, (p) => {
      p.game.money = 1000;
      p.game.fareDue = 30;
    });
    const loan1 = player(s, 1).game.loan;
    const r = teach(s, { type: 'finishNow' }, T0 + (T + 61) * 1000);
    s = r.snapshot;
    expect(s.class.tradeEnded).toBe(true);
    expect(s.class.phase).toBe('wrapup');
    expect(notices(r.outputs, 'TRADE_ENDED')).toHaveLength(1);
    expect(player(s, 1).game.fareDue ?? 0).toBe(0);
    expect(player(s, 1).game.money).toBe(0);
    expect(player(s, 1).game.loan).toBe(loan1 + 50);
    expect(player(s, 2).game.fareDue ?? 0).toBe(0);
    expect(player(s, 2).game.money).toBe(970);
    for (const p of Object.values(s.players)) expect(p.game.money).toBeGreaterThanOrEqual(0);
    // 남은 편지 만료
    for (const slot of letterSlots(s.class)) expect(isSlotExpired(s.class, slot)).toBe(true);
    // 마무리 목록, 남은 항목 없음
    expect(s.class.schedule.wrapup!.map((w) => w.id)).toContain('awards');
    expect(s.class.schedule.items.filter((it) => it.status === 'pending' && it.form !== 'dropped')).toHaveLength(0);
    expect(s.class.schedule.timeUp ?? null).toBeNull();
    // 무역 끝 뒤 틱은 아무것도 바꾸지 않는다
    const after = tickSec(s, T + 62, T + 70);
    expect(after.snap.class.phase).toBe('wrapup');
    expect(notices(after.outs, 'OVERTIME')).toHaveLength(0);
  });
});

describe('⑤ 무역 중 [수업 끝내기] — 먼저 무역 끝 정산', () => {
  it('라운드 사이에 endSession: 운항비 정산·마무리 목록을 거친 뒤 phase ended', () => {
    let s = tickSec(start(), 1, 400).snap;
    expect(s.class.tradeEnded).toBe(false);
    s = editPlayer(s, 1, (p) => {
      p.game.money = 0;
      p.game.fareDue = 40;
      p.game.cargo = [{ good: 'chip' as never, qty: 1, unitCost: 10, origin: 'foreign', source: 'specialty', boughtAt: 'BUS' as never }];
    });
    const loan1 = player(s, 1).game.loan;
    const r = teach(s, { type: 'endSession' }, T0 + 401_000);
    s = r.snapshot;
    expect(s.class.phase).toBe('ended');
    expect(s.class.tradeEnded).toBe(true);
    expect(notices(r.outputs, 'TRADE_ENDED')).toHaveLength(1);
    expect(player(s, 1).game.fareDue ?? 0).toBe(0);
    expect(player(s, 1).game.loan).toBe(loan1 + 40);
    expect(s.class.schedule.wrapup!.length).toBeGreaterThan(0);
    for (const p of Object.values(s.players)) expect(p.game.resolvedRound).toBe(s.class.round);
  });

  it('라운드 중 endSession: 라운드 항해 처리 + 정산 뒤 ended', () => {
    let s = start();
    const r1 = s.class.schedule.items.find((it) => it.kind === 'round')!;
    s = tickSec(s, 1, r1.at + 20).snap;
    expect(s.class.phase).toBe('round');
    s = teach(s, { type: 'endSession' }, T0 + (r1.at + 21) * 1000).snapshot;
    expect(s.class.phase).toBe('ended');
    for (const p of Object.values(s.players)) {
      expect(p.game.resolvedRound).toBe(s.class.round);
      expect(p.game.fareDue ?? 0).toBe(0);
    }
  });

  it('마무리 뒤·무역 시작 전 endSession 은 옛 길 그대로(바로 ended)', () => {
    let s = tickSec(start(), 1, 30).snap;
    s = teach(s, { type: 'finishNow' }, T0 + 31_000).snapshot;
    const r = teach(s, { type: 'endSession' }, T0 + 32_000);
    expect(r.snapshot.class.phase).toBe('ended');
    expect(notices(r.outputs, 'TRADE_ENDED')).toHaveLength(0);
    const before = makeSession({ n: 1 });
    expect(teach(before, { type: 'endSession' }, T0).snapshot.class.phase).toBe('ended');
  });
});

describe('⑥ 시간 조절·일시정지·교사 화면 끊김·새로 고침(스냅숏)', () => {
  it('[+n분]으로 T가 다시 남으면 timeUp 이 지워지고, 다시 넘으면 알림이 한 번 더', () => {
    const a = tickSec(start(), 1, T + 30);
    let s = a.snap;
    expect(notices(a.outs, 'OVERTIME')).toHaveLength(1);
    s = teach(s, { type: 'extend', sec: 120 }, T0 + (T + 30) * 1000).snapshot;
    expect(s.class.schedule.timeUp ?? null).toBeNull();
    expect(s.class.clock.durationSec).toBe(T + 120);
    const b = tickSec(s, T + 31, T + 130);
    expect(notices(b.outs, 'OVERTIME')).toHaveLength(1);
    expect(b.snap.class.tradeEnded).toBe(false);
  });

  it('지난 뒤 [+1분]으로도 아직 지나 있으면 다시 배치하지 않는다(남은 항목이 빠지지 않음)', () => {
    let s = start();
    s = teach(s, { type: 'setProgressMode', mode: 'manual' }, T0 + 500).snapshot;
    s = tickSec(s, 1, T + 200).snap;
    const before = s.class.schedule;
    const r = teach(s, { type: 'extend', sec: 60 }, T0 + (T + 200) * 1000);
    expect(r.snapshot.class.clock.durationSec).toBe(T + 60);
    expect(r.snapshot.class.schedule.items).toEqual(before.items);
    expect(r.snapshot.class.schedule.timeUp).toEqual(before.timeUp);
    expect(r.snapshot.class.schedule.items.filter((it) => it.form === 'dropped').length).toBe(before.items.filter((it) => it.form === 'dropped').length);
  });

  it('일시정지 중에는 경과가 늘지 않아 알림이 없고, 이어서 하면 T를 넘을 때 한 번', () => {
    let s = tickSec(start(), 1, T - 10).snap;
    s = teach(s, { type: 'pause' }, T0 + (T - 10) * 1000).snapshot;
    const p = tickSec(s, T - 9, T + 300);
    expect(notices(p.outs, 'OVERTIME')).toHaveLength(0);
    expect(p.snap.class.schedule.timeUp ?? null).toBeNull();
    s = teach(p.snap, { type: 'resume' }, T0 + (T + 300) * 1000).snapshot;
    const q = tickSec(s, T + 301, T + 320);
    expect(notices(q.outs, 'OVERTIME')).toHaveLength(1);
    expect(q.snap.class.tradeEnded).toBe(false);
  });

  it('T 뒤 교사 화면이 끊겼다 돌아와도(hostGap) 끝나지 않고 알림이 다시 나가지 않는다', () => {
    let s = tickSec(start(), 1, T + 20).snap;
    s = run(s, { type: 'hostGap', gapMs: 60_000 }, T0 + (T + 80) * 1000).snapshot;
    const r = tickSec(s, T + 81, T + 200);
    expect(notices(r.outs, 'OVERTIME')).toHaveLength(0);
    expect(r.snap.class.tradeEnded).toBe(false);
  });

  it('T 뒤 교사 새로 고침(저장한 스냅숏 복구): timeUp 이 남아 알림이 다시 나가지 않고, 판은 계속 → [마무리로]', () => {
    let s = tickSec(start(), 1, T + 20).snap;
    const restored = normalizeSnapshot(JSON.parse(JSON.stringify(s)));
    expect(restored).not.toBeNull();
    s = restored as HostSnapshot;
    expect(s.class.schedule.timeUp).toBeTruthy();
    const r = tickSec(s, T + 21, T + 120);
    expect(notices(r.outs, 'OVERTIME')).toHaveLength(0);
    expect(r.snap.class.tradeEnded).toBe(false);
    expect(canTrade(r.snap.class)).toBe(true);
    const f = teach(r.snap, { type: 'finishNow' }, T0 + (T + 121) * 1000).snapshot;
    expect(f.class.phase).toBe('wrapup');
  });
});
