/**
 * 작업 123 수정 1회차: 배치표 전수 회귀 검사.
 * 판 단위(차시 4 · 단원 · 연속 구간 10) × T 5~90분 × 학습지 방식(자동·중간마다·구간 끝·끝나고) × α 0.5/0.6/0.7
 */
import { describe, expect, it } from 'vitest';
import { letterFormula, tradeWorksheets, tryBuildSchedule, type ScheduleInput } from '../../src/core/schedule';
import type { WorksheetPlacement } from '../../src/core/types';
import type { LessonId } from '../../src/data/types';

const L: LessonId[] = ['L1', 'L2', 'L3', 'L4'];
const scopes: { playUnit: ScheduleInput['playUnit']; scope: LessonId[] }[] = [
  ...L.map((x) => ({ playUnit: 'lesson' as const, scope: [x] })),
  { playUnit: 'unit', scope: L },
];
for (let a = 0; a < 4; a++) for (let b = a; b < 4; b++) scopes.push({ playUnit: 'custom', scope: L.slice(a, b + 1) });
const modes: ('auto' | WorksheetPlacement)[] = ['auto', 'each', 'stageEnd', 'after'];
const ratios = [0.5, 0.6, 0.7];

describe('배치표 전수 회귀(판 단위 × T 5~90 × 학습지 방식 × α)', () => {
  it.each(scopes.map((s) => [`${s.playUnit} ${s.scope.join('')}`, s] as const))('%s', (_, sc) => {
    let built = 0;
    const problems: string[] = [];
    for (let T = 5; T <= 90; T++) {
      for (const worksheetMode of modes) {
        for (const activityRatio of ratios) {
          const r = tryBuildSchedule({ ...sc, tradeMinutes: T, worksheetMode, activityRatio });
          if (!r.ok) {
            // 3.5분 미만만 막힌다
            if (r.error !== 'SCOPE_TOO_LONG' || T / sc.scope.length >= 3.5) problems.push(`${T} ${worksheetMode} ${activityRatio}: ${r.error}`);
            continue;
          }
          built++;
          const s = r.schedule;
          const tag = `${T}분 ${worksheetMode} α${activityRatio}`;
          // 1등급 누락 0
          for (const a of s.activities) if (a.tier === 1 && a.form === 'dropped') problems.push(`${tag}: 1등급 ${a.id} 빠짐`);
          // 학습지 W 번호 누락 0
          for (const st of s.input.scope) for (const w of tradeWorksheets(st)) if (!s.worksheetWhere[w]) problems.push(`${tag}: ${w} 없음`);
          // 편지: round 있음, 1라운드 아님, 라운드 중복 없음, 공식
          const letters = s.items.filter((it) => it.kind === 'letter');
          const rounds = letters.map((l) => l.round);
          if (rounds.some((x) => typeof x !== 'number')) problems.push(`${tag}: 편지 round 없음`);
          if (rounds.includes(1)) problems.push(`${tag}: 편지가 1라운드`);
          if (new Set(rounds).size !== rounds.length) problems.push(`${tag}: 편지 라운드 중복`);
          if (s.letterCount !== letterFormula(T, s.totalRounds)) problems.push(`${tag}: 편지 수 ${s.letterCount}`);
          for (const l of letters) {
            const rd = s.items.find((it) => it.kind === 'round' && it.round === l.round);
            if (!rd || rd.at !== l.at || rd.stage !== l.stage) problems.push(`${tag}: 편지 ${l.refId} at·stage 가 라운드와 다름`);
          }
          // 라운드 ≥ 90초(경고 구간·교사가 학습지 방식을 고정한 판 제외)
          if (worksheetMode === 'auto') {
            for (const st of s.stages) {
              if (st.overflow) continue;
              for (const x of st.roundSecs) if (x < 90) problems.push(`${tag}: ${st.stage} 라운드 ${x}초`);
            }
          }
        }
      }
    }
    expect(problems.slice(0, 10)).toEqual([]);
    expect(built).toBeGreaterThan(0);
  });
});
