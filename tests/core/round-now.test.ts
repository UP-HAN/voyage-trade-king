/**
 * 작업 134: [지금 라운드 시작](startRoundNow) + 수동 진행 [발동]이 떠 있는 차단형 활동을 끝내고 다음 항목을 시작.
 * 123 규칙: 판 끝 ≤ T, 정수 초, 남은 라운드 ≥ 90초, 새 라운드 없음(진행 중 구간), letters.assigned 불변,
 * 1등급은 확인 후에만 건너뜀, 학습지 W 번호 누락 0(건너뛴 번호는 뒤 또는 '끝나고 쓰기'로).
 * 표본: 차시 L1~L4 10·15·25분, 단원 25·40분, L1~L2 20분 × (무역 시작 직후·사전 활동 중·라운드 사이 모든 지점).
 */
import { describe, expect, it, vi } from 'vitest';
import { hostReduce } from '../../src/core/host';
import { tradeWorksheets } from '../../src/core/schedule';
import { createTradeHooks, firstRoundPreview, nextRoundWait, roundNowPlan } from '../../src/core/trade';
import type { HostSnapshot, PlayUnit, ScheduleItem } from '../../src/core/types';
import type { LessonId } from '../../src/data/types';
import { makeSession, planDone } from './helpers';

vi.setConfig({ testTimeout: 120_000 });

const hooks = createTradeHooks();
const T0 = 10_000;
type Cfg = { name: string; playUnit: PlayUnit; scope: LessonId[]; minutes: number; manual?: boolean; ws?: 'each' | 'stageEnd' | 'after' };
const CONFIGS: Cfg[] = [
  ...(['L1', 'L2', 'L3', 'L4'] as LessonId[]).flatMap((L) => [10, 15, 25].map((m) => ({ name: `차시 ${L} ${m}분`, playUnit: 'lesson' as PlayUnit, scope: [L], minutes: m }))),
  { name: '단원 25분', playUnit: 'unit', scope: ['L1', 'L2', 'L3', 'L4'], minutes: 25 },
  { name: '단원 40분', playUnit: 'unit', scope: ['L1', 'L2', 'L3', 'L4'], minutes: 40 },
  { name: 'L1~L2 20분', playUnit: 'custom', scope: ['L1', 'L2'], minutes: 20 },
  // (수정 1회차) 학습지 방식 'each'·'stageEnd' — 건너뛴 번호가 누른 직후 '끝나고 쓰기'에 있는지
  ...(['L1', 'L4'] as LessonId[]).flatMap((L) => [10, 15, 25].map((m) => ({ name: `차시 ${L} ${m}분 each`, playUnit: 'lesson' as PlayUnit, scope: [L], minutes: m, ws: 'each' as const }))),
  { name: '단원 40분 stageEnd', playUnit: 'unit', scope: ['L1', 'L2', 'L3', 'L4'], minutes: 40, ws: 'stageEnd' },
];

const teach = (s: HostSnapshot, action: Parameters<typeof hostReduce>[1] & { type: 'teacher' } extends { action: infer A } ? A : never, now: number) =>
  hostReduce(s, { type: 'teacher', action }, now, hooks);

function start(c: Cfg, n = 2): HostSnapshot {
  let s = makeSession({ n, scope: c.scope, playUnit: c.playUnit });
  s = teach(s, { type: 'updateSettings', settings: { tradeMinutes: c.minutes, ...(c.manual ? { progressMode: 'manual' as const } : {}), ...(c.ws ? { worksheetMode: c.ws } : {}) } }, T0 - 1).snapshot;
  if (c.manual) s = teach(s, { type: 'setProgressMode', mode: 'manual' }, T0 - 1).snapshot;
  return teach(s, { type: 'startTrade' }, T0).snapshot;
}

const tick = (s: HostSnapshot, e: number) => hostReduce(s, { type: 'tick' }, T0 + e * 1000, hooks).snapshot;
const end = (items: readonly ScheduleItem[]) => Math.max(...items.filter((it) => it.form !== 'dropped').map((it) => it.at + it.durSec));

/**
 * 끝나기까지 틱을 돌린다(무역이 끝나면 멈춤). (작업 162) 판은 저절로 끝나지 않으므로 계획한 순서가 다 끝나면
 * 교사가 [마무리로](finishNow)를 누른다 — 순서가 끝나지 않으면(막힘) 결산되지 않은 채로 돌려준다.
 */
function runToEnd(s: HostSnapshot, fromE: number, T: number): HostSnapshot {
  for (let e = fromE; e <= T + 200 && !s.class.tradeEnded; e++) {
    s = tick(s, e);
    if (planDone(s.class)) s = teach(s, { type: 'finishNow' }, T0 + e * 1000).snapshot;
  }
  return s;
}

/** W 번호 누락 0: 범위 안 무역 학습지 번호가 배치표(띄운·띄울 항목) 또는 '끝나고 쓰기'에 있다 */
function missingWs(s: HostSnapshot): string[] {
  const c = s.class;
  const where = new Set<string>();
  for (const it of c.schedule.items) if (it.kind === 'worksheet' && it.placement !== 'during' && it.status !== 'skipped') (it.refIds ?? [it.refId]).forEach((w) => where.add(w));
  for (const w of c.schedule.wrapup ?? []) w.worksheetIds.forEach((x) => where.add(x));
  return c.settings.scope.flatMap(tradeWorksheets).filter((w) => !where.has(w));
}

describe('[지금 라운드 시작] — 표본 sweep', () => {
  it.each(CONFIGS.map((c) => [c.name, c] as const))('%s', (_, c) => {
    const T = c.minutes * 60;
    const problems: string[] = [];
    let snap = start(c);
    // 라운드가 아닌 모든 초(5초 간격)에서 눌러 본다(계획대로 흐르는 판 위에서 갈래로)
    let cases = 0;
    for (let e = 1; e <= T && !snap.class.tradeEnded; e++) {
      snap = tick(snap, e);
      if (e % 5 !== 0) continue;
      const plan = roundNowPlan(snap.class, T0 + e * 1000);
      if (plan.block) continue;
      cases++;
      const now = T0 + e * 1000 + 300;
      const tag = `e=${e}`;
      const before = snap.class;
      const assignedBefore = JSON.stringify(Object.values(snap.players).map((p) => p.game.letters.assigned));
      // 1등급이 빠지면 확인 없이는 아무것도 바뀌지 않는다
      if (plan.needsConfirm) {
        const r0 = teach(snap, { type: 'startRoundNow' }, now);
        if (!r0.outputs.some((o) => o.kind === 'notice' && o.code === 'NEEDS_CONFIRM' && o.message === 'ROUND_NOW_TIER1')) problems.push(`${tag}: 확인 요청 없음`);
        if (r0.snapshot.class.phase !== before.phase || r0.snapshot.class.schedule.version !== before.schedule.version) problems.push(`${tag}: 확인 전에 바뀜`);
      }
      const r = teach(snap, { type: 'startRoundNow', confirm: true }, now);
      const after = r.snapshot.class;
      const err = r.outputs.find((o) => o.kind === 'notice' && o.code !== 'UPCOMING');
      if (err) problems.push(`${tag}: 알림 ${err.kind === 'notice' ? err.code : ''}`);
      // 즉시 라운드
      if (after.phase !== 'round' || after.round !== before.round + 1) problems.push(`${tag}: 라운드가 안 열림(${after.phase} ${after.round})`);
      const live = after.schedule.items.find((it) => it.kind === 'round' && it.round === after.round);
      if (!live || live.status !== 'live' || live.at !== e) problems.push(`${tag}: 라운드 항목 ${live?.status} at ${live?.at}`);
      // 판 끝 ≤ T, 정수 초, 남은 라운드 ≥ 90초, 지금 라운드 ≥ 90초
      const items = after.schedule.items;
      if (end(items) > T) problems.push(`${tag}: 판 끝 ${end(items)} > ${T}`);
      for (const it of items) if (!Number.isInteger(it.at) || !Number.isInteger(it.durSec)) problems.push(`${tag}: ${it.id} 소수`);
      for (const it of items) if (it.kind === 'round' && (it.status === 'pending' || it.status === 'live') && it.durSec < 90 && end(before.schedule.items) <= T) {
        // 계획 자체가 90초 미만이던 라운드는 제외(원래 계획보다 짧아지지만 않으면 됨)
        const old = before.schedule.items.find((x) => x.id === it.id);
        if (!old || it.durSec < old.durSec) problems.push(`${tag}: ${it.id} ${it.durSec}초`);
      }
      if (after.roundEndsAt !== null && (after.roundEndsAt - now) / 1000 < Math.min(90, live?.durSec ?? 90) - 1) problems.push(`${tag}: 라운드 타이머 ${(after.roundEndsAt - now) / 1000}`);
      // 진행 중 구간에 새 라운드 없음
      const oldRounds = new Set(before.schedule.items.filter((it) => it.kind === 'round').map((it) => it.id));
      for (const it of items) if (it.kind === 'round' && it.stage === after.stage && !oldRounds.has(it.id)) problems.push(`${tag}: 새 라운드 ${it.id}`);
      // letters.assigned: 이미 배정된 것은 그대로(새 도착분만 늘어남)
      const assignedAfter = Object.values(r.snapshot.players).map((p) => p.game.letters.assigned);
      JSON.parse(assignedBefore).forEach((a: Record<string, string>, i: number) => {
        for (const [k, v] of Object.entries(a)) if (assignedAfter[i]![k] !== v) problems.push(`${tag}: 편지 문항 바뀜 ${k}`);
      });
      // 1등급은 확인한 것만 빠짐(확인 목록 밖의 1등급이 빠지지 않음)
      const okSkip = new Set(plan.tier1.map((x) => x.id));
      for (const it of items) {
        if (it.kind !== 'event' || it.status !== 'skipped' || it.tier !== 1) continue;
        const was = before.schedule.items.find((x) => x.id === it.id);
        if (was && was.status !== 'skipped' && !okSkip.has(it.refId)) problems.push(`${tag}: 확인 없이 1등급 ${it.refId} 빠짐`);
      }
      // W 번호 누락 0
      for (const w of missingWs(r.snapshot)) problems.push(`${tag}: ${w} 누락`);
      // 옮겨진 학습지 번호는 누른 직후 '끝나고 쓰기'에
      const afterIds = new Set((after.schedule.wrapup ?? []).flatMap((w) => w.worksheetIds));
      for (const w of plan.movedWorksheets) if (!afterIds.has(w)) problems.push(`${tag}: 옮긴 ${w}가 끝나고 쓰기에 없음`);
      // 두 번째로 누르기(다음 라운드 밖에서) — 누른 직후 누락 0
      if (cases % 3 === 0) {
        let s2 = r.snapshot;
        let e2 = e + 1;
        for (; e2 <= T && s2.class.phase === 'round' && !s2.class.tradeEnded; e2++) s2 = tick(s2, e2);
        for (let k = 0; k < 3 && !s2.class.tradeEnded; k++, e2++) s2 = tick(s2, e2);
        if (!roundNowPlan(s2.class, T0 + e2 * 1000).block) {
          const r2 = teach(s2, { type: 'startRoundNow', confirm: true }, T0 + e2 * 1000);
          for (const w of missingWs(r2.snapshot)) problems.push(`${tag} 두 번째(${e2}): ${w} 누락`);
        }
      }
      // 끝까지 돌려도 막히지 않고 결산, 마무리 학습지 누락 0
      if (cases % 4 === 1) {
        const fin = runToEnd(r.snapshot, e + 1, T);
        if (!fin.class.tradeEnded) problems.push(`${tag}: 끝까지 돌려도 결산 안 됨`);
        for (const w of missingWs(fin)) problems.push(`${tag}: 결산 뒤 ${w} 누락`);
      }
    }
    if (problems.length) console.log([c.name, ...problems.slice(0, 20)].join('\n'));
    expect(problems.slice(0, 10)).toEqual([]);
    expect(cases).toBeGreaterThan(0);
  });
});

describe('[지금 라운드 시작] — 차시 L1 10분(교사 리허설 재현)', () => {
  // v0.3.8(작업 153): 차시 한 판 '알아서'가 '활동마다 바로'·'차시 끝에 모아서'가 되어 배치가 바뀜 → 이 묶음은 '게임 끝나고'로 고정해 옛 리허설 배치를 본다
  const c: Cfg = { name: 'L1 10', playUnit: 'lesson', scope: ['L1'], minutes: 10, ws: 'after' };

  it('무역 시작 직후: 라운드 1까지 3:50, 학생 표시용 nextRoundWait', () => {
    const s = start(c);
    const w = nextRoundWait(s.class, T0 + 20_000);
    expect(w).toEqual({ round: 1, sec: 210, manual: false, first: true });
    expect(nextRoundWait(s.class, T0)?.sec).toBe(230);
  });

  it('표지 중에 누르면 확인 창(무역·수입·수출) → 확인하면 즉시 라운드 1, 뒤 항목은 당겨지고 판 끝 600초', () => {
    let s = start(c);
    for (let e = 1; e <= 10; e++) s = tick(s, e);
    const plan = roundNowPlan(s.class, T0 + 10_000);
    expect(plan.round?.id).toBe('r:1');
    expect(plan.closing).toBe('L1-COVER');
    expect(plan.skip.map((it) => it.id)).toEqual(['ev:L1-E1', 'ev:L1-E2']);
    expect(plan.tier1.map((x) => x.title)).toEqual(['무역·수입·수출']);
    const r0 = teach(s, { type: 'startRoundNow' }, T0 + 10_300);
    expect(r0.snapshot.class.phase).toBe('event');
    s = teach(s, { type: 'startRoundNow', confirm: true }, T0 + 10_300).snapshot;
    expect(s.class.phase).toBe('round');
    expect(s.class.round).toBe(1);
    const items = s.class.schedule.items;
    const byId = (id: string) => items.find((it) => it.id === id)!;
    expect(byId('r:1')).toMatchObject({ at: 10, status: 'live' });
    expect(byId('ev:L1-E6')).toMatchObject({ at: 10, status: 'live' }); // 라운드에 붙은 천연가스 패널도 함께
    expect(byId('ev:L1-E1').status).toBe('skipped');
    expect(byId('ev:L1-E2').status).toBe('skipped');
    expect(byId('ev:L1-E5').status).toBe('pending');
    expect(end(items)).toBe(600);
    expect(s.class.currentEvent?.id).toBe('L1-E6');
    // 학생은 지금 바로 거래할 수 있다(사기)
    const buy = hostReduce(s, { type: 'act', seat: 1, seq: 1, action: { type: 'buy', good: 'chip', qty: 1 } }, T0 + 11_000, hooks);
    expect(buy.outputs.find((o) => o.kind === 'ack')).toMatchObject({ ok: true });
  });

  it('1등급 활동이 진행 중이면(무역·수입·수출) 일찍 닫히므로 확인 대상', () => {
    let s = start(c);
    for (let e = 1; e <= 200; e++) s = tick(s, e);
    expect(roundNowPlan(s.class, T0 + 200_000).tier1).toEqual([{ id: 'L1-E2', title: '무역·수입·수출', live: true }]);
    s = teach(s, { type: 'startRoundNow', confirm: true }, T0 + 200_000).snapshot;
    expect(s.class.phase).toBe('round');
    expect(s.class.schedule.items.find((it) => it.id === 'ev:L1-E2')!.status).toBe('done');
  });

  it('라운드 사이(두 섬 이야기 중): 다음 라운드까지 표시, 2등급만 빠지므로 확인 없이 즉시 라운드 2', () => {
    let s = start(c);
    let e = 1;
    for (; !(s.class.round === 1 && s.class.phase !== 'round'); e++) s = tick(s, e);
    for (let k = 0; k < 10; k++, e++) s = tick(s, e);
    const w = nextRoundWait(s.class, T0 + (e - 1) * 1000)!;
    expect(w.first).toBe(false);
    expect(w.round).toBe(2);
    expect(w.sec).toBeGreaterThan(0);
    const plan = roundNowPlan(s.class, T0 + (e - 1) * 1000);
    expect(plan.tier1).toEqual([]);
    const r = teach(s, { type: 'startRoundNow' }, T0 + (e - 1) * 1000 + 200);
    expect(r.snapshot.class.phase).toBe('round');
    expect(r.snapshot.class.round).toBe(2);
    expect(r.snapshot.class.letters.delivered).toContain('S1'); // 라운드 2 편지도 함께 도착
    // W03(지금 쓰기 ★)를 건너뛰어도 끝나고 쓰기에 남는다
    const fin = runToEnd(r.snapshot, e, 600);
    expect(fin.class.tradeEnded).toBe(true);
    expect(missingWs(fin)).toEqual([]);
  });

  it('누를 수 없는 때: 라운드 중·일시정지·학습지 팝업·무역 전', () => {
    const s0 = makeSession({ n: 1 });
    expect(roundNowPlan(s0.class, 0).block).toBe('NOT_STARTED');
    let s = start(c);
    s = teach(s, { type: 'pause' }, T0 + 1000).snapshot;
    expect(roundNowPlan(s.class, T0 + 2000).block).toBe('PAUSED');
    const r = teach(s, { type: 'startRoundNow', confirm: true }, T0 + 2000);
    expect(r.outputs.some((o) => o.kind === 'notice' && o.code === 'PAUSED')).toBe(true);
    s = start(c);
    s = teach(s, { type: 'startRoundNow', confirm: true }, T0 + 1000).snapshot;
    expect(roundNowPlan(s.class, T0 + 2000).block).toBe('ROUND_IN_PROGRESS');
  });
});

describe('[무역 시작] 확인 창 미리보기(firstRoundPreview)', () => {
  const CASES: [PlayUnit, LessonId[], number, number, string[]][] = [
    ['lesson', ['L1'], 10, 230, ['L1-E1', 'L1-E2']],
    ['lesson', ['L1'], 15, 290, ['L1-E1', 'L1-E2']],
  ];
  it.each(CASES)('%s %s %i분: 라운드 1 at·사전 활동이 배치표와 같다', (pu, scope, m, at, ids) => {
    const s = start({ name: '', playUnit: pu, scope, minutes: m, ws: 'after' }); // v0.3.8: 옛 배치(게임 끝나고)로 고정
    const p = firstRoundPreview(s.class.schedule.items)!;
    expect(p.atSec).toBe(at);
    expect(p.activities.map((it) => it.refId)).toEqual(ids);
  });
});

describe('수동 진행: [발동]만으로 처음부터 끝까지(리허설 d — 표지에서 막히지 않음)', () => {
  const MANUAL: [string, Cfg][] = [
    ['차시 L1 15분', { name: '', playUnit: 'lesson', scope: ['L1'], minutes: 15, manual: true }],
    ['차시 L1 10분', { name: '', playUnit: 'lesson', scope: ['L1'], minutes: 10, manual: true }],
    ['단원 25분', { name: '', playUnit: 'unit', scope: ['L1', 'L2', 'L3', 'L4'], minutes: 25, manual: true }],
  ];
  it.each(MANUAL)('%s', (_, c) => {
    let s = start(c);
    expect(s.class.schedule.mode).toBe('manual');
    const T = c.minutes * 60;
    let rounds = 0;
    let fires = 0;
    const fails: string[] = [];
    for (let e = 1; e <= T + 200 && !s.class.tradeEnded; e++) {
      s = tick(s, e);
      const w = s.class.schedule.waiting;
      if (w && e % 3 === 0) {
        const r = teach(s, { type: 'fireNow', id: w }, T0 + e * 1000 + 100);
        const n = r.outputs.find((o) => o.kind === 'notice' && o.code !== 'UPCOMING');
        if (n && n.kind === 'notice') fails.push(`${e}: ${w} ${n.code}`);
        s = r.snapshot;
        fires++;
      }
      if (s.class.phase === 'round' && s.class.round > rounds) rounds = s.class.round;
    }
    expect(fails.slice(0, 5)).toEqual([]);
    expect(fires).toBeGreaterThan(2);
    expect(rounds).toBeGreaterThanOrEqual(2);
    // (작업 162) 옛 기대: T가 지나면 저절로 결산. 새 규칙: T + 200초가 지나도 판은 계속 → 선생님 [마무리로]로 결산
    expect(s.class.tradeEnded).toBe(false);
    expect(s.class.schedule.timeUp).toBeTruthy();
    s = teach(s, { type: 'finishNow' }, T0 + (T + 201) * 1000).snapshot;
    expect(s.class.tradeEnded).toBe(true);
    expect(s.class.phase).toBe('wrapup');
  });

  it('표지가 떠 있을 때 [발동](벽란도 시장)을 누르면 표지를 닫고 벽란도 시장이 열린다', () => {
    let s = start({ name: '', playUnit: 'lesson', scope: ['L1'], minutes: 15, manual: true, ws: 'after' }); // v0.3.8: 옛 배치로 고정
    s = teach(s, { type: 'fireNow', id: 'cover:L1' }, T0 + 1000).snapshot;
    for (let e = 2; e <= 25; e++) s = tick(s, e);
    expect(s.class.currentEvent).toMatchObject({ id: 'L1-COVER', closed: false });
    expect(s.class.schedule.waiting).toBe('ev:L1-E1');
    const r = teach(s, { type: 'fireNow', id: 'ev:L1-E1' }, T0 + 25_500);
    expect(r.outputs.filter((o) => o.kind === 'notice')).toEqual([]);
    expect(r.snapshot.class.currentEvent).toMatchObject({ id: 'L1-E1', closed: false });
    expect(r.snapshot.class.schedule.items.find((it) => it.id === 'cover:L1')!.status).toBe('done');
  });

  it('수동 진행에서도 [지금 라운드 시작]이 된다(계획보다 늦어도 라운드는 제 길이)', () => {
    let s = start({ name: '', playUnit: 'lesson', scope: ['L1'], minutes: 10, manual: true, ws: 'after' }); // v0.3.8: 옛 배치로 고정
    const planned = s.class.schedule.items.find((it) => it.id === 'r:1')!.durSec; // v0.3.8(작업 153): ★ 없음 → 계획 길이가 옛 90초보다 김
    for (let e = 1; e <= 300; e++) s = tick(s, e); // 아무것도 발동하지 않고 5분(라운드 1 계획 지남)
    const r = teach(s, { type: 'startRoundNow', confirm: true }, T0 + 300_000);
    expect(r.snapshot.class.phase).toBe('round');
    expect((r.snapshot.class.roundEndsAt! - (T0 + 300_000)) / 1000).toBe(planned);
  });
});
