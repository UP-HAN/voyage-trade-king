/**
 * 작업 123 수정 2회차: 일찍 끝낸 라운드(PRD 4.3.7, 오케스트레이터 결정).
 * - 계획한 다음 항목이 바로 시작, 진행 중 구간의 계획 활동은 그대로(빠지지 않음), 그 구간에 새 라운드 없음,
 * - 아낀 시간은 뒤 구간으로, 90초 미만 라운드 없음, 마지막 구간이면 계획이 일찍 끝남(작업 162: 결산은 교사 [마무리로] — 저절로 끝나지 않음).
 * 표본(검증 sweep 과 같은 방식): 단원 25·40분, L1~L2 20분, 차시 L1~L4 25분의 모든 라운드 × 12·30·60·90초 일찍.
 */
import { describe, expect, it, vi } from 'vitest';

// 많은 구성을 도는 sweep 테스트라 병렬 실행 부하에서 기본 5초를 넘을 수 있다.
vi.setConfig({ testTimeout: 60_000 });
import { hostReduce } from '../../src/core/host';
import { createTradeHooks } from '../../src/core/trade';
import type { HostSnapshot, PlayUnit, ScheduleItem } from '../../src/core/types';
import type { LessonId } from '../../src/data/types';
import { makeSession, planDone } from './helpers';

const hooks = createTradeHooks();
const T0 = 10_000;
const SAVES = [12, 30, 60, 90];
const CONFIGS: { name: string; playUnit: PlayUnit; scope: LessonId[]; minutes: number }[] = [
  { name: '단원 25분', playUnit: 'unit', scope: ['L1', 'L2', 'L3', 'L4'], minutes: 25 },
  { name: '단원 40분', playUnit: 'unit', scope: ['L1', 'L2', 'L3', 'L4'], minutes: 40 },
  { name: 'L1~L2 20분', playUnit: 'custom', scope: ['L1', 'L2'], minutes: 20 },
  ...(['L1', 'L2', 'L3', 'L4'] as LessonId[]).map((L) => ({ name: `차시 ${L} 25분`, playUnit: 'lesson' as PlayUnit, scope: [L], minutes: 25 })),
];

function start(c: (typeof CONFIGS)[number]): HostSnapshot {
  let s = makeSession({ n: 2, scope: c.scope, playUnit: c.playUnit });
  s = hostReduce(s, { type: 'teacher', action: { type: 'updateSettings', settings: { tradeMinutes: c.minutes } } }, T0 - 1, hooks).snapshot;
  return hostReduce(s, { type: 'teacher', action: { type: 'startTrade' } }, T0, hooks).snapshot;
}

const firable = (it: ScheduleItem) => it.status === 'pending' && it.form !== 'dropped' && it.kind !== 'letter';

/** 계획대로 끝까지 틱을 돌리며, 각 '일찍 끝낼 시각'의 스냅숏을 모은다 */
function captures(c: (typeof CONFIGS)[number]): { round: number; save: number; e: number; snap: HostSnapshot }[] {
  let snap = start(c);
  const plan = snap.class.schedule.items.filter((it) => it.kind === 'round');
  const targets = new Map<number, { round: number; save: number }[]>();
  for (const r of plan) {
    for (const save of SAVES) {
      const e = r.at + r.durSec - save;
      if (e <= r.at + 1) continue;
      targets.set(e, [...(targets.get(e) ?? []), { round: r.round!, save }]);
    }
  }
  const out: { round: number; save: number; e: number; snap: HostSnapshot }[] = [];
  const T = c.minutes * 60;
  for (let e = 1; e <= T; e++) {
    snap = hostReduce(snap, { type: 'tick' }, T0 + e * 1000, hooks).snapshot;
    for (const t of targets.get(e) ?? []) out.push({ ...t, e, snap });
  }
  return out;
}

describe('일찍 끝낸 라운드(10초 이상) — 표본 sweep', () => {
  it.each(CONFIGS.map((c) => [c.name, c] as const))('%s', (_, c) => {
    const problems: string[] = [];
    let cases = 0;
    // [라운드 끝]을 정수 초와 소수 초(+0.3초)에 누른다
    for (const { round, save, e, snap, off } of captures(c).flatMap((x) => [0, 300].map((off) => ({ ...x, off })))) {
      if (snap.class.phase !== 'round' || snap.class.round !== round) {
        problems.push(`r:${round} -${save}: 라운드 중이 아님(${snap.class.phase})`);
        continue;
      }
      cases++;
      const tag = `r:${round} ${save}초 일찍(+${off}ms)`;
      const before = snap.class.schedule;
      const stage = snap.class.stage;
      const next = before.items.find(firable);
      const pendingActs = before.items.filter((it) => it.kind === 'event' && it.status === 'pending' && it.form !== 'dropped');
      const r = hostReduce(snap, { type: 'teacher', action: { type: 'endRound' } }, T0 + e * 1000 + off, hooks);
      const after = r.snapshot.class;
      const items = after.schedule.items;
      if (after.schedule.version !== before.version + 1) problems.push(`${tag}: version`);
      // 1. 계획한 다음 항목이 바로 시작(없으면 판이 끝남)
      if (next) {
        const n = items.find((it) => it.id === next.id);
        if (!n || n.status === 'pending') problems.push(`${tag}: 다음 항목 ${next.id} 시작 안 함`);
        else if (Math.abs(n.at - e) > 1 && n.kind !== 'round') problems.push(`${tag}: ${next.id} at ${n.at}`);
      } else if (after.tradeEnded || !planDone(after)) problems.push(`${tag}: 남은 항목이 없는데 '순서를 다 함'이 아님(또는 저절로 결산함 — 작업 162)`);
      // 2. 그 순간 계획에 있던 활동이 빠지지 않음
      for (const p of pendingActs) {
        const a = items.find((it) => it.kind === 'event' && it.refId === p.refId);
        if (!a || a.form === 'dropped') problems.push(`${tag}: ${p.refId} 빠짐`);
        else if (a.stage === stage && a.form !== p.form) problems.push(`${tag}: ${p.refId} 형태 ${p.form}→${a.form}`);
      }
      // 3. 진행 중 구간에 새 라운드 없음, 90초 미만 라운드 없음
      const oldRounds = new Set(before.items.filter((it) => it.kind === 'round').map((it) => it.id));
      for (const it of items.filter((x) => x.kind === 'round')) {
        if (it.stage === stage && !oldRounds.has(it.id)) problems.push(`${tag}: 새 라운드 ${it.id}`);
        if (it.status === 'pending' && it.durSec < 90) problems.push(`${tag}: ${it.id} ${it.durSec}초`);
      }
      // 4. 판 끝: 뒤 구간이 있으면 T, 없으면 그만큼 일찍
      const live = items.filter((it) => it.form !== 'dropped');
      const end = Math.max(...live.map((it) => it.at + it.durSec));
      const hasLater = c.scope.indexOf(stage) < c.scope.length - 1;
      // 마지막 구간: 남은 라운드가 있으면 거기에 더해 판 끝 = T, 없으면 그만큼 일찍(결산)
      const pendingRounds = before.items.filter((it) => it.kind === 'round' && it.status === 'pending' && it.stage === stage).length;
      if ((hasLater || pendingRounds > 0) && end !== c.minutes * 60) problems.push(`${tag}: 판 끝 ${end}`);
      if (!hasLater && pendingRounds === 0 && end > c.minutes * 60 - save + 1) problems.push(`${tag}: 마지막 구간 끝 ${end}`);
      if (!hasLater && pendingRounds > 0) {
        // 남은(그때 시작 전이던) 라운드 길이 합이 아낀 초만큼 늘어난다
        const ids = new Set(before.items.filter((it) => it.kind === 'round' && it.status === 'pending' && it.stage === stage).map((it) => it.id));
        const sum = (xs: ScheduleItem[]) => xs.filter((it) => ids.has(it.id)).reduce((a2, it) => a2 + it.durSec, 0);
        if (sum(items) - sum(before.items) !== save) problems.push(`${tag}: 남은 라운드 합 +${sum(items) - sum(before.items)}`);
      }
      // 정수 초 유지, 판 끝 ≤ T
      for (const it of items) if (!Number.isInteger(it.at) || !Number.isInteger(it.durSec)) problems.push(`${tag}: ${it.id} 소수 ${it.at}+${it.durSec}`);
      if (end > c.minutes * 60) problems.push(`${tag}: 판 끝 ${end} > T`);
      // 5. 배달한 편지 그대로, 편지 라운드 중복 없음
      // (다음 항목이 라운드면 그 라운드 편지가 새로 도착한다 — 앞부분은 그대로)
      if (JSON.stringify(after.letters.delivered.slice(0, snap.class.letters.delivered.length)) !== JSON.stringify(snap.class.letters.delivered)) problems.push(`${tag}: 편지 배달 바뀜`);
      for (const id of after.letters.delivered.slice(snap.class.letters.delivered.length)) {
        const l = items.find((it) => it.kind === 'letter' && it.refId === id);
        if (!l || l.round !== after.round) problems.push(`${tag}: 편지 ${id} 라운드 다름`);
      }
      const lr = items.filter((it) => it.kind === 'letter').map((it) => it.round);
      if (new Set(lr).size !== lr.length) problems.push(`${tag}: 편지 라운드 중복`);
    }
    if (problems.length) console.log([c.name, ...problems].join('\n'));
    expect(problems.slice(0, 10)).toEqual([]);
    expect(cases).toBeGreaterThan(0);
  });

  it.each([3, 5])('단원 25분 r:%i 를 90초 일찍: 다음 계획 항목 즉시, 세관 게시판·스마트폰 결과 유지, 새 라운드 0', (rn) => {
    const c = CONFIGS[0];
    let snap = start(c);
    const r = snap.class.schedule.items.find((it) => it.id === `r:${rn}`)!;
    const e = r.at + r.durSec - 90;
    for (let t = 1; t <= e; t++) snap = hostReduce(snap, { type: 'tick' }, T0 + t * 1000, hooks).snapshot;
    const next = snap.class.schedule.items.find(firable)!;
    const stage = snap.class.stage;
    const roundsBefore = snap.class.schedule.items.filter((it) => it.kind === 'round' && it.stage === stage).length;
    snap = hostReduce(snap, { type: 'teacher', action: { type: 'endRound' } }, T0 + e * 1000, hooks).snapshot;
    const items = snap.class.schedule.items;
    expect(items.find((it) => it.id === next.id)!.status).not.toBe('pending');
    for (const id of ['L2-E6', 'L3-E5']) expect(items.find((it) => it.kind === 'event' && it.refId === id)!.form).not.toBe('dropped');
    // 진행 중 구간에는 새 라운드가 없다(PRD 4.3.7). 뒤 구간은 아낀 시간으로 다시 채우므로(4.3.4 연장과 같음) 라운드가 되살아날 수 있다
    // — v0.3.4 에서 단원 25분 L4 는 ⑭★ 40초 때문에 1라운드였다가 +45초쯤이면 2라운드로 돌아온다(작업 132)
    expect(items.filter((it) => it.kind === 'round' && it.stage === stage).length).toBeLessThanOrEqual(roundsBefore);
    for (const it of items) if (it.kind === 'round' && it.status === 'pending') expect(it.durSec).toBeGreaterThanOrEqual(90);
    expect(Math.max(...items.filter((it) => it.form !== 'dropped').map((it) => it.at + it.durSec))).toBe(25 * 60);
  });

  it.each([CONFIGS[0], CONFIGS[3]].map((c) => [c.name, c] as const))(
    '%s: 마지막 구간 마지막 라운드를 일찍 끝내면 남은 계획을 마치고 순서가 일찍 끝남 — 저절로 결산하지 않고 [마무리로]를 기다림(작업 162)',
    (_, c) => {
      let snap = start(c);
      const last = snap.class.schedule.items.filter((it) => it.kind === 'round').pop()!;
      const e = last.at + last.durSec - 60;
      for (let t = 1; t <= e; t++) snap = hostReduce(snap, { type: 'tick' }, T0 + t * 1000, hooks).snapshot;
      const r = hostReduce(snap, { type: 'teacher', action: { type: 'endRound' } }, T0 + e * 1000, hooks);
      snap = r.snapshot;
      const notes = [...r.outputs];
      let doneAt: number | null = planDone(snap.class) ? e : null;
      for (let t = e + 1; t <= e + 400; t++) {
        const x = hostReduce(snap, { type: 'tick' }, T0 + t * 1000, hooks);
        snap = x.snapshot;
        notes.push(...x.outputs);
        if (doneAt === null && planDone(snap.class)) doneAt = t;
      }
      // 순서는 계획보다 60초 일찍 끝났다
      expect(doneAt).not.toBeNull();
      expect(c.minutes * 60 - doneAt!).toBeGreaterThanOrEqual(59);
      // 400초를 더 흘려도(T를 넘겨도) 저절로 결산하지 않는다
      expect(snap.class.tradeEnded).toBe(false);
      expect(snap.class.phase).toBe('between');
      expect(notes.some((o) => o.kind === 'notice' && (o.code === 'PLAN_DONE' || o.code === 'TRADE_ENDED'))).toBe(false);
      // 교사 [마무리로] 한 번으로 마무리
      snap = hostReduce(snap, { type: 'teacher', action: { type: 'finishNow' } }, T0 + (e + 401) * 1000, hooks).snapshot;
      expect(snap.class.tradeEnded).toBe(true);
      expect(snap.class.phase).toBe('wrapup');
    },
  );

  it('마지막 라운드를 30·90초 일찍 끝내면 남은 계획을 마치고 순서가 끝남, 저절로 결산하지 않음(단원 14~23분, L3~L4 10·11분, L1~L3 11~14분)', () => {
    const cfgs: (typeof CONFIGS)[number][] = [
      ...[14, 15, 16, 17, 18, 19, 20, 21, 22, 23].map((m) => ({ name: `단원 ${m}`, playUnit: 'unit' as PlayUnit, scope: ['L1', 'L2', 'L3', 'L4'] as LessonId[], minutes: m })),
      ...[10, 11].map((m) => ({ name: `L3~L4 ${m}`, playUnit: 'custom' as PlayUnit, scope: ['L3', 'L4'] as LessonId[], minutes: m })),
      ...[11, 12, 13, 14].map((m) => ({ name: `L1~L3 ${m}`, playUnit: 'custom' as PlayUnit, scope: ['L1', 'L2', 'L3'] as LessonId[], minutes: m })),
    ];
    const problems: string[] = [];
    for (const c of cfgs) {
      for (const save of [30, 90]) {
        let snap = start(c);
        const last = snap.class.schedule.items.filter((it) => it.kind === 'round').pop()!;
        const e = last.at + last.durSec - save;
        if (e <= last.at + 1) continue;
        for (let t = 1; t <= e; t++) snap = hostReduce(snap, { type: 'tick' }, T0 + t * 1000, hooks).snapshot;
        const r = hostReduce(snap, { type: 'teacher', action: { type: 'endRound' } }, T0 + e * 1000 + 300, hooks);
        snap = r.snapshot;
        let done = planDone(snap.class);
        // 마지막 라운드 뒤에 남은 계획(구간 끝 활동·학습지)이 있으면 그것을 마친 뒤 '순서를 다 함'(작업 162: 결산은 교사가)
        const tailEnd = Math.max(e, ...snap.class.schedule.items.filter((it) => it.status === 'pending' || it.status === 'live').filter((it) => it.form !== 'dropped' && it.kind !== 'letter').map((it) => it.at + it.durSec));
        for (let t = e + 1; t <= tailEnd + 2; t++) {
          const x = hostReduce(snap, { type: 'tick' }, T0 + t * 1000, hooks);
          snap = x.snapshot;
          if (planDone(snap.class)) done = true;
        }
        if (!done) problems.push(`${c.name} -${save}: 순서를 다 하지 못함`);
        if (snap.class.tradeEnded) problems.push(`${c.name} -${save}: 저절로 결산함`);
        if (tailEnd > c.minutes * 60 - save + 1) problems.push(`${c.name} -${save}: 남은 계획 끝 ${tailEnd}`);
      }
    }
    expect(problems).toEqual([]);
  });
});
