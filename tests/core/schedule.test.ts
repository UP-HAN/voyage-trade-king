/** 작업 123: 자동 배치(스케줄러) — PRD 4.1.1, 4.3, 4.5 */
import { describe, expect, it } from 'vitest';
import {
  buildSchedule,
  letterFormula,
  previewSchedule,
  reduceStageForBudget,
  ScheduleError,
  stageActivities,
  tradeWorksheets,
  tryBuildSchedule,
  type Schedule,
  type ScheduleInput,
} from '../../src/core/schedule';
import { eventsById } from '../../src/data/events';
import { fillOrder, type FillStepId } from '../../src/data/schedule';
import { worksheetById } from '../../src/data/worksheet';
import type { LessonId } from '../../src/data/types';

const ALL: LessonId[] = ['L1', 'L2', 'L3', 'L4'];

/** PRD 4.3.6 의 여섯 조합 */
const PRD_COMBOS: [string, ScheduleInput][] = [
  ['L1~L4 15분', { playUnit: 'unit', scope: ALL, tradeMinutes: 15 }],
  ['L1~L4 25분', { playUnit: 'unit', scope: ALL, tradeMinutes: 25 }],
  ['L1~L4 40분', { playUnit: 'unit', scope: ALL, tradeMinutes: 40 }],
  ['L1~L4 80분', { playUnit: 'unit', scope: ALL, tradeMinutes: 80 }],
  ['L1만 30분', { playUnit: 'custom', scope: ['L1'], tradeMinutes: 30 }],
  ['L1만 10분', { playUnit: 'custom', scope: ['L1'], tradeMinutes: 10 }],
];

/** 차시 한 판 16개 조합 */
const LESSON_COMBOS: [string, ScheduleInput][] = ALL.flatMap((L) =>
  [20, 25, 30, 40].map((T): [string, ScheduleInput] => [`차시 ${L} ${T}분`, { playUnit: 'lesson', scope: [L], tradeMinutes: T }]),
);

function checkCommon(s: Schedule): void {
  // 1등급은 하나도 빠지지 않는다
  for (const a of s.activities) if (a.tier === 1) expect(a.form, a.id).not.toBe('dropped');
  // 구간마다 거래 시간 ≥ T_s − F − D_s − B, 라운드 길이 ≥ 90초(PRD 4.3.1 v0.3.3, R8)
  for (const st of s.stages) {
    expect(st.tradeSec, st.stage).toBeGreaterThanOrEqual(st.lengthSec - st.fixedSec - st.duringSec - st.budgetSec - 1);
    // 활동 사용(지금 쓰기 포함) + 고정 시간 + 거래 = 구간 길이
    if (!st.overflow) expect(st.usedSec + st.fixedSec + st.tradeSec, st.stage).toBe(st.lengthSec);
    if (!st.overflow && s.input.worksheetMode === 'auto') for (const r of st.roundSecs) expect(r, st.stage).toBeGreaterThanOrEqual(90);
    expect(st.rounds).toBeGreaterThanOrEqual(1);
  }
  // 편지 수 공식(T ÷ 4 내림, 2~10, 라운드 − 1 이하) — 실제 은행은 모자라지 않는다
  expect(s.letterFormula).toBe(letterFormula(s.input.tradeMinutes, s.totalRounds));
  expect(s.letterCount).toBe(s.letterFormula);
  const letters = s.items.filter((it) => it.kind === 'letter');
  expect(letters).toHaveLength(s.letterCount);
  const rounds = new Set(letters.map((l) => l.round));
  expect(rounds.size).toBe(letters.length); // 라운드당 1통
  expect(rounds.has(1)).toBe(false); // 첫 라운드 제외
  for (const l of letters) expect(typeof l.round).toBe('number'); // 103 편지 배달이 읽는 round
  // 범위 안 무역 학습지 번호는 어딘가(중간마다/구간 끝/끝나고)에 있다
  for (const st of s.input.scope) for (const w of tradeWorksheets(st)) expect(s.worksheetWhere[w], w).toBeDefined();
  // 항목은 시각 순, 무역 시간 안
  for (let i = 1; i < s.items.length; i++) expect(s.items[i].at).toBeGreaterThanOrEqual(s.items[i - 1].at);
  const end = Math.max(...s.items.map((it) => it.at + it.durSec));
  expect(end).toBe(s.input.tradeMinutes * 60);
}

describe('buildSchedule — PRD 4.3.6 여섯 조합', () => {
  it.each(PRD_COMBOS)('%s: 1등급 누락 0, 거래 비율, 편지 공식, 라운드 ≥ 90초, 학습지 번호', (_, input) => {
    checkCommon(buildSchedule(input));
  });

  it('L1~L4 단원 판에는 4구간 표지, 단원 L2 표지에 상위 회사 표시, 마무리에 L4 전체', () => {
    const s = buildSchedule({ playUnit: 'unit', scope: ALL, tradeMinutes: 25 });
    const covers = s.items.filter((it) => it.kind === 'stageCover');
    expect(covers.map((c) => c.stage)).toEqual(ALL);
    expect(covers.every((c) => c.variant === 'stage')).toBe(true);
    expect(covers.find((c) => c.stage === 'L2')!.topCompanies).toBe(true);
    expect(s.wrapup.map((w) => w.id)).toEqual(['settle', 'containers', 'awards', 'reflect', 'magazine', 'afterWorksheet']);
    expect(s.wrapup.find((w) => w.id === 'awards')!.hideFlatMetrics).toBe(false);
    // PRD 4.2.1 예: 준비 5분 + 무역 25분 + 마무리 9분 = 39분
    expect(s.expected.text).toBe('준비 5분 + 무역 25분 + 마무리 9분 = 39분');
  });

  it('SCOPE_TOO_LONG: L1~L4 + 10분', () => {
    expect(() => buildSchedule({ playUnit: 'unit', scope: ALL, tradeMinutes: 10 })).toThrow(ScheduleError);
    const r = tryBuildSchedule({ playUnit: 'unit', scope: ALL, tradeMinutes: 10 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('SCOPE_TOO_LONG');
    // T_s = T ÷ 4 가 3.5분 미만이면 막는다(13분 → 3.25분). 14분은 정확히 3.5분이라 허용
    expect(tryBuildSchedule({ playUnit: 'unit', scope: ALL, tradeMinutes: 13 }).ok).toBe(false);
    expect(tryBuildSchedule({ playUnit: 'unit', scope: ALL, tradeMinutes: 15 }).ok).toBe(true);
    expect(tryBuildSchedule({ playUnit: 'custom', scope: ['L1', 'L2'], tradeMinutes: 6 }).ok).toBe(false);
  });

  it('결정성: 같은 입력 → 같은 배치표', () => {
    for (const [, input] of [...PRD_COMBOS, ...LESSON_COMBOS]) {
      expect(JSON.stringify(buildSchedule({ ...input, seed: 7 }))).toBe(JSON.stringify(buildSchedule({ ...input, seed: 7 })));
    }
  });

  it('편지 항목에는 모두 round·구간이 있고, 슬롯 ID 는 S1부터 차례로', () => {
    const s = buildSchedule({ playUnit: 'unit', scope: ALL, tradeMinutes: 80 });
    const letters = s.items.filter((it) => it.kind === 'letter');
    expect(letters.map((l) => l.refId)).toEqual(letters.map((_, i) => `S${i + 1}`));
    const roundStage = new Map(s.items.filter((it) => it.kind === 'round').map((r) => [r.round, r.stage]));
    for (const l of letters) expect(l.stage).toBe(roundStage.get(l.round!));
  });

  it('교사 [빼기]: 2등급은 빠지고 1등급 빼기는 무시', () => {
    const s = buildSchedule({ playUnit: 'lesson', scope: ['L1'], tradeMinutes: 40, overrides: { 'L1-E5': 'dropped', 'L1-E2': 'dropped' } });
    expect(s.activities.find((a) => a.id === 'L1-E5')!.form).toBe('dropped');
    expect(s.activities.find((a) => a.id === 'L1-E5')!.reason).toBe('teacher');
    expect(s.activities.find((a) => a.id === 'L1-E2')!.form).not.toBe('dropped');
  });

  it('학습지 방식 고정(끄기)이면 학습지 항목이 없다', () => {
    const s = buildSchedule({ playUnit: 'lesson', scope: ['L1'], tradeMinutes: 25, worksheetMode: 'off' });
    expect(s.items.filter((it) => it.kind === 'worksheet')).toHaveLength(0);
  });
});

/** 기획 확정값(PRD 4.3.6 v0.3.4 구간 22줄 표). 'nR' = 빠짐(라운드 부족), during = 지금 쓰기 번호 */
type Mark = 'F' | 's' | '-' | 'nR';
interface StageExp { forms: Record<string, Mark>; ws: string; during: string[]; used: number; rounds: number; len: [number, number] }
const UNIT = (T: number): ScheduleInput => ({ playUnit: 'unit', scope: ALL, tradeMinutes: T });
const EXPECTED: [string, ScheduleInput, Partial<Record<LessonId, StageExp>>][] = [
  ['단원 15분', UNIT(15), {
    L1: { forms: { 'L1-E2': 's', 'L1-E5': '-', 'L1-E1': '-', 'L1-E4': '-', 'L1-E8': '-' }, ws: 'after', during: [], used: 60, rounds: 1, len: [145, 145] },
    L2: { forms: { 'L2-E2': 's', 'L2-E6': '-', 'L2-E5': 'F', 'L2-E4': 'nR', 'L2-E7': '-' }, ws: 'after', during: [], used: 60, rounds: 1, len: [145, 145] },
    L3: { forms: { 'L3-E1': 's', 'L3-E3': 's', 'L3-E2': 'nR', 'L3-E5': 'nR', 'L3-E4': 's', 'L3-E6': '-' }, ws: 'after', during: [], used: 90, rounds: 1, len: [115, 115] },
    L4: { forms: { 'L4-E1': 's', 'L4-E2': 's', 'L4-E4': '-' }, ws: 'after', during: [], used: 90, rounds: 1, len: [115, 115] },
  }],
  ['단원 25분', UNIT(25), {
    L1: { forms: { 'L1-E2': 's', 'L1-E5': 's', 'L1-E1': '-', 'L1-E4': '-', 'L1-E8': '-' }, ws: 'after', during: ['W03'], used: 250, rounds: 1, len: [105, 105] },
    L2: { forms: { 'L2-E2': 's', 'L2-E6': 's', 'L2-E5': 'F', 'L2-E4': 'F', 'L2-E7': '-' }, ws: 'after', during: [], used: 120, rounds: 2, len: [117, 118] },
    L3: { forms: { 'L3-E1': 's', 'L3-E3': 's', 'L3-E2': 's', 'L3-E5': 's', 'L3-E4': 's', 'L3-E6': '-' }, ws: 'after', during: [], used: 150, rounds: 2, len: [102, 103] },
    L4: { forms: { 'L4-E1': 's', 'L4-E2': 's', 'L4-E4': 'F' }, ws: 'after', during: ['W14'], used: 250, rounds: 1, len: [105, 105] },
  }],
  ['단원 40분', UNIT(40), {
    L1: { forms: { 'L1-E2': 's', 'L1-E5': 's', 'L1-E1': 's', 'L1-E4': '-', 'L1-E8': '-' }, ws: 'after', during: ['W03'], used: 400, rounds: 2, len: [90, 90] },
    L2: { forms: { 'L2-E2': 'F', 'L2-E6': 's', 'L2-E5': 'F', 'L2-E4': 'F', 'L2-E7': '-' }, ws: 'stageEnd', during: [], used: 360, rounds: 2, len: [110, 110] },
    L3: { forms: { 'L3-E1': 's', 'L3-E3': 'F', 'L3-E2': 's', 'L3-E5': 's', 'L3-E4': 's', 'L3-E6': '-' }, ws: 'after', during: [], used: 330, rounds: 2, len: [125, 125] },
    L4: { forms: { 'L4-E1': 's', 'L4-E2': 's', 'L4-E4': 's' }, ws: 'stageEnd', during: ['W14'], used: 370, rounds: 2, len: [105, 105] },
  }],
  ['단원 80분', UNIT(80), {
    L1: { forms: { 'L1-E2': 'F', 'L1-E5': 'F', 'L1-E1': 's', 'L1-E4': 's', 'L1-E8': '-' }, ws: 'after', during: ['W03'], used: 730, rounds: 3, len: [150, 150] },
    L2: { forms: { 'L2-E2': 'F', 'L2-E6': 'F', 'L2-E5': 'F', 'L2-E4': 'F', 'L2-E7': 'F' }, ws: 'stageEnd', during: [], used: 600, rounds: 3, len: [193, 194] },
    L3: { forms: { 'L3-E1': 'F', 'L3-E3': 'F', 'L3-E2': 'F', 'L3-E5': 'F', 'L3-E4': 's', 'L3-E6': '-' }, ws: 'after', during: [], used: 690, rounds: 3, len: [163, 164] },
    L4: { forms: { 'L4-E1': 'F', 'L4-E2': 'F', 'L4-E4': 's' }, ws: 'after', during: ['W14'], used: 760, rounds: 2, len: [210, 210] },
  }],
  ['L1만 30분', { playUnit: 'custom', scope: ['L1'], tradeMinutes: 30 }, {
    L1: { forms: { 'L1-E2': 'F', 'L1-E5': 'F', 'L1-E1': 'F', 'L1-E4': 'F', 'L1-E8': '-' }, ws: 'stageEnd', during: ['W03'], used: 1120, rounds: 4, len: [165, 165] },
  }],
  ['L1만 10분', { playUnit: 'custom', scope: ['L1'], tradeMinutes: 10 }, {
    L1: { forms: { 'L1-E2': 's', 'L1-E5': 's', 'L1-E1': 's', 'L1-E4': '-', 'L1-E8': '-' }, ws: 'after', during: ['W03'], used: 400, rounds: 2, len: [90, 90] },
  }],
  ['차시 L1 25분', { playUnit: 'lesson', scope: ['L1'], tradeMinutes: 25 }, {
    L1: { forms: { 'L1-E2': 'F', 'L1-E5': 'F', 'L1-E1': 'F', 'L1-E4': 'F', 'L1-E8': '-' }, ws: 'after', during: ['W03'], used: 940, rounds: 3, len: [180, 180] },
  }],
  ['차시 L2 25분', { playUnit: 'lesson', scope: ['L2'], tradeMinutes: 25 }, {
    L2: { forms: { 'L2-E2': 'F', 'L2-E6': 'F', 'L2-E5': 'F', 'L2-E4': 'F', 'L2-E7': 'F' }, ws: 'each', during: [], used: 900, rounds: 3, len: [186, 187] },
  }],
  ['차시 L3 25분', { playUnit: 'lesson', scope: ['L3'], tradeMinutes: 25 }, {
    L3: { forms: { 'L3-E1': 'F', 'L3-E3': 'F', 'L3-E2': 'F', 'L3-E5': 'F', 'L3-E4': 's', 'L3-E6': '-' }, ws: 'stageEnd', during: [], used: 870, rounds: 3, len: [196, 197] },
  }],
  ['차시 L4 25분', { playUnit: 'lesson', scope: ['L4'], tradeMinutes: 25 }, {
    L4: { forms: { 'L4-E1': 'F', 'L4-E2': 'F', 'L4-E4': 's' }, ws: 'stageEnd', during: ['W14'], used: 940, rounds: 3, len: [173, 174] },
  }],
];
/** PRD 4.3.6 판 전체 표(v0.3.4) */
const TOTALS: Record<string, { rounds: number; letters: number; incidents: number; minutes: number }> = {
  '단원 15분': { rounds: 4, letters: 3, incidents: 1, minutes: 29 },
  '단원 25분': { rounds: 6, letters: 5, incidents: 2, minutes: 39 },
  '단원 40분': { rounds: 8, letters: 7, incidents: 4, minutes: 54 },
  '단원 80분': { rounds: 11, letters: 10, incidents: 8, minutes: 94 },
  'L1만 30분': { rounds: 4, letters: 3, incidents: 2, minutes: 40 },
  'L1만 10분': { rounds: 2, letters: 1, incidents: 0, minutes: 20 },
  '차시 L1 25분': { rounds: 3, letters: 2, incidents: 1, minutes: 35 },
  '차시 L2 25분': { rounds: 3, letters: 2, incidents: 1, minutes: 35 },
  '차시 L3 25분': { rounds: 3, letters: 2, incidents: 1, minutes: 35 },
  '차시 L4 25분': { rounds: 3, letters: 2, incidents: 1, minutes: 39 },
};

function markOf(s: Schedule, id: string): Mark {
  const a = s.activities.find((x) => x.id === id)!;
  if (a.form === 'dropped') return a.reason === 'needsRounds' ? 'nR' : '-';
  return a.form === 'full' ? 'F' : 's';
}

describe('채우는 순서(PRD 4.3.4 v0.3.4) — 기획 확정값 22줄', () => {
  it.each(EXPECTED)('%s', (name, input, stages) => {
    const s = buildSchedule(input);
    checkCommon(s);
    for (const [stage, exp] of Object.entries(stages) as [LessonId, StageExp][]) {
      const st = s.stages.find((x) => x.stage === stage)!;
      const got = Object.fromEntries(Object.keys(exp.forms).map((id) => [id, markOf(s, id)]));
      expect(got, `${name} ${stage}`).toEqual(exp.forms);
      expect(st.worksheetMode, `${name} ${stage} 학습지`).toBe(exp.ws);
      expect(st.during, `${name} ${stage} 지금 쓰기`).toEqual(exp.during);
      expect(s.items.filter((it) => it.stage === stage && it.placement === 'during').map((it) => it.refId), `${name} ${stage} 지금 쓰기 항목`).toEqual(exp.during);
      expect(st.usedSec, `${name} ${stage} 활동 사용`).toBe(exp.used);
      expect(st.rounds, `${name} ${stage} 라운드 수`).toBe(exp.rounds);
      for (const r of st.roundSecs) {
        expect(r).toBeGreaterThanOrEqual(exp.len[0] - 1);
        expect(r).toBeLessThanOrEqual(exp.len[1] + 1);
      }
      for (const a of s.activities) if (a.stage === stage && a.tier === 1) expect(a.form).not.toBe('dropped');
    }
    const t = TOTALS[name];
    expect([s.totalRounds, s.letterCount, s.incidentCount, s.expected.totalMin], name).toEqual([t.rounds, t.letters, t.incidents, t.minutes]);
  });

  it('fillOrder 배열 순서만 바꿔도 배치가 바뀐다(학습지 먼저 → 단원 40분 L1)', () => {
    const order: FillStepId[] = ['wsStageEnd', ...fillOrder.filter((x) => x !== 'wsStageEnd')];
    const s = buildSchedule({ ...UNIT(40), fillOrder: order });
    expect(['L1-E2', 'L1-E4', 'L1-E5', 'L1-E1'].map((id) => markOf(s, id))).toEqual(['F', 's', '-', '-']);
    const l1 = s.stages[0];
    expect(l1.worksheetMode).toBe('stageEnd');
    expect(l1.usedSec).toBe(360);
    expect(l1.roundSecs).toEqual([110, 110]);
  });

  it('라운드 보호: 단원 25분 L2 의 공장 개장 전체는 라운드 2→1 이라 건너뛴다', () => {
    const s = buildSchedule(UNIT(25));
    const l2 = s.stages[1];
    expect(l2.skipped).toContainEqual({ step: 'tier1Full', id: 'L2-E2', why: 'roundGuard' });
    expect(l2.rounds).toBe(2);
    expect(markOf(s, 'L2-E4')).toBe('F');
  });

  it('라운드 부족 재계산: 단원 15분 L3 → 스마트폰 빠짐(라운드 부족), 항만 투표 짧게, 90초', () => {
    const s = buildSchedule(UNIT(15));
    expect(markOf(s, 'L3-E5')).toBe('nR');
    expect(markOf(s, 'L3-E2')).toBe('nR');
    expect(markOf(s, 'L3-E4')).toBe('s');
    expect(s.stages[2].usedSec).toBe(90);
  });

  it('longStageMinMinutes 15: 단원 40분은 모든 구간 라운드 2개', () => {
    const s = buildSchedule(UNIT(40));
    expect(s.stages.map((st) => st.rounds)).toEqual([2, 2, 2, 2]);
  });

  it('α 0.7 짧은 구간(단원 15·17분, L1~L2 7분)에서도 라운드 ≥ 90초', () => {
    const inputs: ScheduleInput[] = [UNIT(15), UNIT(17), { playUnit: 'custom', scope: ['L1', 'L2'], tradeMinutes: 7 }];
    for (const input of inputs) {
      const s = buildSchedule({ ...input, activityRatio: 0.7 });
      for (const st of s.stages) for (const r of st.roundSecs) expect(r, `${input.tradeMinutes} ${st.stage}`).toBeGreaterThanOrEqual(90);
    }
  });

  it('최소 상태가 넘치면 α 를 올리고 경고(교사가 전체 형태로 고정)', () => {
    const s = buildSchedule({ ...UNIT(15), overrides: { 'L1-E5': 'full', 'L1-E1': 'full' } });
    const l1 = s.stages[0];
    expect(l1.overflow).toBe(true);
    expect(l1.alphaRaised).toBe(true);
    expect(l1.rounds).toBe(1);
    expect(l1.filled).toHaveLength(0);
    expect(s.warnings).toContain('이번 판은 활동이 많아 거래 시간이 짧아요');
  });

  it('검사용 reduceStageForBudget: 예산 B 안에서 1등급은 빠지지 않는다', () => {
    for (const stage of ALL) {
      for (let B = 0; B <= 30 * 60; B += 30) {
        const r = reduceStageForBudget(stage, B);
        for (const [id, form] of Object.entries(r.forms)) if (eventsById[id].tier === 1) expect(form).not.toBe('dropped');
        if (r.filled.length) expect(r.fits).toBe(true);
      }
    }
  });
});

describe('차시 한 판(v0.3.1) — 16개 조합', () => {
  it('playUnit lesson + 2구간 → BAD_SCOPE', () => {
    const r = tryBuildSchedule({ playUnit: 'lesson', scope: ['L1', 'L2'], tradeMinutes: 25 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('BAD_SCOPE');
    const r2 = tryBuildSchedule({ playUnit: 'custom', scope: ['L1', 'L3'], tradeMinutes: 25 });
    expect(r2.ok).toBe(false);
  });

  it.each(LESSON_COMBOS)('%s: 1등급 누락 0, 그 차시 학습지 누락 0, 다른 차시 번호 없음', (_, input) => {
    const s = buildSchedule(input);
    checkCommon(s);
    const L = input.scope[0];
    // 다른 차시 활동·학습지가 없다
    for (const it of s.items) expect(it.stage).toBe(L);
    for (const id of Object.keys(s.worksheetWhere)) expect(worksheetById[id as keyof typeof worksheetById].lesson).toBe(L);
    for (const w of s.wrapup) for (const id of w.worksheetIds) expect(worksheetById[id].lesson).toBe(L);
    // 차시 표지(+ L2~L4 는 앞 차시 요약 카드)
    const covers = s.items.filter((it) => it.kind === 'stageCover');
    expect(covers[0].variant).toBe('lesson');
    if (L === 'L1') expect(covers).toHaveLength(1);
    else {
      expect(covers[1].variant).toBe('summary');
      expect(covers[1].refIds!.length).toBeGreaterThan(0);
    }
    // 결산·시상은 hideFlatMetrics
    expect(s.wrapup.find((w) => w.id === 'awards')!.hideFlatMetrics).toBe(true);
    // 기본 무역 시간(입력 생략 시) 25분
  });

  it('L4 차시 판에만 컨테이너 OX·잡지 표지(선택) 마무리', () => {
    for (const L of ALL) {
      const s = buildSchedule({ playUnit: 'lesson', scope: [L], tradeMinutes: 25 });
      const ids = s.wrapup.map((w) => w.id);
      if (L === 'L4') {
        expect(ids).toEqual(['settle', 'containers', 'awards', 'reflect', 'magazine', 'afterWorksheet']);
        expect(s.wrapup.find((w) => w.id === 'magazine')!.optional).toBe(true);
        expect(s.wrapup.find((w) => w.id === 'containers')!.worksheetIds).toEqual(['W16']);
        expect(s.wrapup.find((w) => w.id === 'reflect')!.questions).toBe(3);
      } else {
        expect(ids).toEqual(['settle', 'awards', 'reflect', 'afterWorksheet']);
        expect(s.wrapup.find((w) => w.id === 'reflect')!.questions).toBe(2);
      }
    }
  });

  it('차시 한 판 L1 결산 항목에 hideFlatMetrics: true, 기본 무역 시간 25분', () => {
    const s = buildSchedule({ playUnit: 'lesson', scope: ['L1'] });
    expect(s.input.tradeMinutes).toBe(25);
    const awards = s.wrapup.find((w) => w.id === 'awards')!;
    expect(awards.eventId).toBe('L4-E7');
    expect(awards.hideFlatMetrics).toBe(true);
  });

  it('은행이 모자라면 편지 수를 줄이고 경고한다', () => {
    const normal = buildSchedule({ playUnit: 'lesson', scope: ['L3'], tradeMinutes: 40 });
    expect(normal.letterCount).toBeGreaterThan(2);
    const s = buildSchedule({ playUnit: 'lesson', scope: ['L3'], tradeMinutes: 40, letterBankSize: (_st, d) => (d === 'easy' ? 1 : 1) });
    expect(s.letterCount).toBe(2);
    expect(s.letterCount).toBeLessThan(s.letterFormula);
    expect(s.warnings.some((w) => w.includes('L3 편지 문제가 모자라 편지를 2통으로 줄였어요'))).toBe(true);
    // 한 난이도만 모자라도 줄인다
    const s2 = buildSchedule({ playUnit: 'lesson', scope: ['L3'], tradeMinutes: 40, letterBankSize: (_st, d) => (d === 'easy' ? 1 : 9) });
    expect(s2.items.filter((it) => it.kind === 'letter').length).toBeLessThanOrEqual(4);
    expect(s2.warnings.some((w) => w.includes('편지 문제가 모자라'))).toBe(true);
  });

  it('결정성(16개)', () => {
    for (const [, input] of LESSON_COMBOS) expect(buildSchedule(input)).toEqual(buildSchedule(input));
  });
});

describe('previewSchedule(판 설정 화면)', () => {
  it('구간 띠·활동 목록·예상 수업 시간·경고', () => {
    const p = previewSchedule({ playUnit: 'unit', scope: ALL, tradeMinutes: 25 });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.bands).toHaveLength(4);
    expect(p.bands.reduce((a, b) => a + b.ratio, 0)).toBeCloseTo(1, 5);
    expect(p.activities.find((a) => a.id === 'L1-E2')!.canDrop).toBe(false);
    expect(p.activities.find((a) => a.id === 'L1-E5')!.canDrop).toBe(true);
    expect(p.expected.totalMin).toBe(39);
    // 끝나고 쓸 학습지: 단원 25분은 ①~⑮ 15개, 28분(⑫⑮ 1분)
    expect(p.afterWorksheets.ids).toHaveLength(15);
    expect(p.afterWorksheets.minutes).toBe(28);
    const lesson = previewSchedule({ playUnit: 'lesson', scope: ['L2'], tradeMinutes: 25 });
    if (lesson.ok) expect(lesson.bands).toHaveLength(1);
    const bad = previewSchedule({ playUnit: 'unit', scope: ALL, tradeMinutes: 10 });
    expect(bad.ok).toBe(false);
  });
});

describe("지금 쓰기 ③★·⑭★ (PRD 4.3.3.1, v0.3.4 — 작업 132)", () => {
  const during = (s: Schedule) => s.items.filter((it) => it.placement === 'during');

  it('① 단원 25분: wsd:W03 이 두 섬(L1-E5) 끝 시각에 40초, wsd:W14 도 40초', () => {
    const s = buildSchedule(UNIT(25));
    const e5 = s.items.find((it) => it.id === 'ev:L1-E5')!;
    const w3 = s.items.find((it) => it.id === 'wsd:W03')!;
    expect(w3).toMatchObject({ kind: 'worksheet', refId: 'W03', refIds: ['W03'], placement: 'during', durSec: 40, stage: 'L1', status: 'pending', form: 'full' });
    expect(w3.at).toBe(e5.at + e5.durSec);
    // 다음 라운드 앞
    const r1 = s.items.find((it) => it.id === 'r:1')!;
    expect(w3.at + w3.durSec).toBeLessThanOrEqual(r1.at);
    expect(s.items.find((it) => it.id === 'wsd:W14')!.durSec).toBe(40);
    expect(s.duringWorksheets).toEqual({ placed: ['W03', 'W14'], deferred: [] });
    // 번호 전체의 자리는 그대로(끝나고 쓰기 ①~⑮ 15개·28분)
    expect(s.worksheetWhere.W03).toBe('after');
    expect(s.worksheetWhere.W14).toBe('after');
    expect(s.afterWorksheets.ids).toHaveLength(15);
    expect(s.afterWorksheets.minutes).toBe(28);
    const p = previewSchedule(UNIT(25));
    if (p.ok) expect(p.duringWorksheets.placed).toEqual(['W03', 'W14']);
  });

  it('② 단원 15분: ⑭ 못 넣음(경고), ⑭는 끝나고, ③ 지금 쓰기 없음(두 섬 빠짐)', () => {
    const s = buildSchedule(UNIT(15));
    expect(s.duringWorksheets).toEqual({ placed: [], deferred: ['W14'] });
    expect(s.warnings).toContain('시간이 짧아 ⑭ 지금 쓰기를 넣지 못했어요(끝나고 써요)');
    expect(s.worksheetWhere.W14).toBe('after');
    expect(during(s)).toHaveLength(0);
    expect(s.stages[3].skipped).toContainEqual({ step: 'wsDuring', id: 'W14', why: 'budget' });
    const p = previewSchedule(UNIT(15));
    if (p.ok) {
      expect(p.duringWorksheets.deferred).toEqual(['W14']);
      expect(p.warnings).toContain('시간이 짧아 ⑭ 지금 쓰기를 넣지 못했어요(끝나고 써요)');
    }
  });

  it("③ 학습지 '끄기' → 지금 쓰기 0", () => {
    for (const input of [UNIT(25), { playUnit: 'lesson' as const, scope: ['L1'] as LessonId[], tradeMinutes: 25 }]) {
      const s = buildSchedule({ ...input, worksheetMode: 'off' });
      expect(during(s)).toHaveLength(0);
      expect(s.duringWorksheets).toEqual({ placed: [], deferred: [] });
    }
  });

  it("④ 학습지 '중간마다' 고정 → 지금 쓰기 0, ws:W03 이 L1-E5 바로 뒤", () => {
    const s = buildSchedule({ playUnit: 'lesson', scope: ['L1'], tradeMinutes: 25, worksheetMode: 'each' });
    expect(during(s)).toHaveLength(0);
    const e5 = s.items.find((it) => it.id === 'ev:L1-E5')!;
    const w3 = s.items.find((it) => it.id === 'ws:W03')!;
    expect(w3.at).toBe(e5.at + e5.durSec);
  });

  it('⑤ 교사가 두 섬(L1-E5)을 빼면 ③ 지금 쓰기 없음', () => {
    const s = buildSchedule({ ...UNIT(25), overrides: { 'L1-E5': 'dropped' } });
    expect(during(s).map((it) => it.refId)).toEqual(['W14']);
    expect(s.duringWorksheets.deferred).toEqual([]);
  });

  it('⑥ 단원 25분 L4: 지금 쓰기는 라운드 보호 예외 — 건너뜀 없음, 라운드 2 → 1', () => {
    const s = buildSchedule(UNIT(25));
    const l4 = s.stages[3];
    expect(l4.skipped.some((x) => x.step === 'wsDuring')).toBe(false);
    expect(l4.filled).toContain('wsDuring');
    expect(l4.rounds).toBe(1);
    expect(l4.duringSec).toBe(40);
    // ⑭ 결정 패널(짧게, 비차단)과 보도가 같은 라운드 → 라운드 끝에 afterNews
    const w14 = s.items.find((it) => it.id === 'wsd:W14')!;
    const r6 = s.items.find((it) => it.id === 'r:6')!;
    expect(w14.at).toBe(r6.at + r6.durSec);
    expect(w14.afterNews).toBe(true);
  });

  it('⑦ coreFull 은 우선 숫자 순: 차시 L1 25분에서 두 섬 F 가 벽란도 F 보다 먼저', () => {
    const s = buildSchedule({ playUnit: 'lesson', scope: ['L1'], tradeMinutes: 25 });
    const l1 = s.stages[0];
    const core = l1.filled.filter((x) => x === 'coreFull');
    expect(core).toHaveLength(2);
    expect(markOf(s, 'L1-E5')).toBe('F');
    expect(markOf(s, 'L1-E1')).toBe('F');
    // 두 섬(우선 1)이 먼저 — 벽란도만 예산이 모자라는 단원 80분에서 두 섬 F, 벽란도 s
    const u80 = buildSchedule(UNIT(80));
    expect([markOf(u80, 'L1-E5'), markOf(u80, 'L1-E1')]).toEqual(['F', 's']);
    expect(u80.stages[0].skipped).toContainEqual({ step: 'coreFull', id: 'L1-E1', why: 'budget' });
    expect(u80.stages[0].skipped.some((x) => x.step === 'coreFull' && x.id === 'L1-E5')).toBe(false);
  });

  it('⑧ 단원 80분 L4: 차단형(전체) 베트남 결정 L4-E2 바로 뒤 wsd:W14, 보도 앞', () => {
    const s = buildSchedule(UNIT(80));
    const e2 = s.items.find((it) => it.id === 'ev:L4-E2')!;
    expect(e2.blocking).toBe(true);
    const w14 = s.items.find((it) => it.id === 'wsd:W14')!;
    expect(w14.at).toBe(e2.at + e2.durSec);
    expect(w14.afterNews).toBeUndefined();
    const e3 = s.items.find((it) => it.id === 'ev:L4-E3')!;
    expect(w14.at + w14.durSec).toBeLessThanOrEqual(e3.at);
  });

  it('결정성: 지금 쓰기 포함 같은 입력 → 같은 배치표', () => {
    for (const T of [15, 25, 40, 80]) expect(JSON.stringify(buildSchedule(UNIT(T)))).toBe(JSON.stringify(buildSchedule(UNIT(T))));
  });
});
