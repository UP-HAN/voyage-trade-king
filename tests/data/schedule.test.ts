import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { summaryCards } from '../../src/data/dex';
import { eventsById } from '../../src/data/events';
import { lessonsById } from '../../src/data/lessons';
import { slotAt, slotsByDifficulty } from '../../src/data/letterSchedule';
import {
  activityRatio, coreExperienceIds, duringSourceEvent, fillOrder, fillSteps, letterCountRule, lessonCards, MIN_STAGE_MINUTES, playUnits, reductionOrder, roundLength,
  stageStart, stageStartByLesson, tradeMinutes, WORKSHEET_BUNDLE_SEC, wrapupByUnit,
} from '../../src/data/schedule';
import { emergencyLoan, LOAN_LENDER_NAME } from '../../src/data/ships';
import type { LessonId, StageFeature } from '../../src/data/types';

const PRD = readFileSync(join(process.cwd(), 'docs', 'PRD.md'), 'utf8');

describe('구간별 시작 조건(PRD 4.2.3)', () => {
  it('PRD 표와 같다(자금·열린 항구 수·기능)', () => {
    const start = PRD.indexOf('#### 4.2.3');
    const end = PRD.indexOf('### 4.3');
    const rows = PRD.slice(start, end).split('\n').filter((l) => /^\| L\d \|/.test(l));
    expect(rows).toHaveLength(4);
    const featureMap: Record<string, StageFeature> = { 시장: 'market', 공장: 'factory', 조선소: 'shipyard' };
    for (const line of rows) {
      const [lesson, moneyCol, portsCol, featCol] = line.split('|').slice(1, -1).map((s) => s.trim());
      const s = stageStartByLesson[lesson as LessonId];
      expect(s.money, line).toBe(Number(/([\d,]+)만 원/.exec(moneyCol)![1].replace(/,/g, '')));
      expect(s.ports.length, line).toBe(Number(/(\d+)곳/.exec(portsCol)![1]));
      expect([...s.features].sort(), line).toEqual(featCol.split(',').map((f) => featureMap[f.trim()]).sort());
    }
  });

  it('summaryCardIds: L2 → L1, L3 → L1~L2, L4 → L1~L3, 모두 존재하는 요약 카드', () => {
    expect(stageStartByLesson.L1.summaryCardIds).toEqual([]);
    expect(stageStartByLesson.L2.summaryCardIds).toEqual(['SUM-L1']);
    expect(stageStartByLesson.L3.summaryCardIds).toEqual(['SUM-L1', 'SUM-L2']);
    expect(stageStartByLesson.L4.summaryCardIds).toEqual(['SUM-L1', 'SUM-L2', 'SUM-L3']);
    const ids = new Set(summaryCards.map((c) => c.id));
    for (const s of stageStart) for (const id of s.summaryCardIds) expect(ids.has(id), id).toBe(true);
    const l1 = summaryCards.find((c) => c.id === 'SUM-L1')!;
    expect(JSON.stringify(l1)).not.toMatch(/TODO/);
    for (const line of l1.lines) expect(line.pages.length).toBeGreaterThan(0);
  });
});

describe('판 단위(PRD 4.1.1, v0.3.1)', () => {
  it('playUnits 두 카드가 PRD 문구·기본값과 같다', () => {
    expect(playUnits.lesson).toMatchObject({ label: '차시마다 한 판', desc: '오늘 배우는 차시만 해요', defaultMinutes: 25, recommended: [20, 30] });
    expect(playUnits.lesson.quickMinutes.L1).toBe(10);
    expect(playUnits.unit).toMatchObject({ label: '단원 전체 한 판', desc: '단원 전체를 한 번에 해요', defaultMinutes: 25, recommended: [25, 60] });
    for (const t of [playUnits.lesson.label, playUnits.lesson.desc, playUnits.unit.label, playUnits.unit.desc]) expect(PRD).toContain(t);
  });

  it('lessonCards 4장 — 제목·쪽은 lessons.ts 값', () => {
    expect(lessonCards.map((c) => c.id)).toEqual(['L1', 'L2', 'L3', 'L4']);
    expect(lessonCards[0].pages).toBe('94~99');
    for (const c of lessonCards) {
      expect(c.title).toBe(lessonsById[c.id].title);
      expect(c.question.length).toBeGreaterThan(5);
    }
  });

  it('wrapupByUnit: 차시 한 판 L1~L3 / L4 / 단원 한 판', () => {
    for (const l of ['L1', 'L2', 'L3'] as const) {
      expect(wrapupByUnit.lesson[l].map((s) => s.id)).toEqual(['settle', 'awards', 'reflect', 'afterWorksheet']);
      expect(wrapupByUnit.lesson[l].find((s) => s.id === 'awards')?.hideFlatMetrics).toBe(true);
      expect(wrapupByUnit.lesson[l].find((s) => s.id === 'reflect')?.questions).toBe(2);
    }
    expect(wrapupByUnit.lesson.L4.map((s) => s.id)).toEqual(['settle', 'containers', 'awards', 'reflect', 'magazine', 'afterWorksheet']);
    expect(wrapupByUnit.lesson.L4.find((s) => s.id === 'magazine')?.optional).toBe(true);
    expect(wrapupByUnit.unit.map((s) => s.id)).toEqual(['settle', 'containers', 'awards', 'reflect', 'magazine', 'afterWorksheet']);
    for (const s of [...Object.values(wrapupByUnit.lesson).flat(), ...wrapupByUnit.unit]) {
      if (s.eventId) expect(eventsById[s.eventId], s.eventId).toBeDefined();
    }
  });
});

describe('실존 이름 금지', () => {
  it('긴급 대출은 일반 명칭(선장 조합 금고)', () => {
    expect(emergencyLoan.text).toContain(LOAN_LENDER_NAME);
    expect(emergencyLoan.text).not.toMatch(/부산 ?은행/);
  });
});

describe('배치 상수(PRD 4.3, v0.3)', () => {
  it('시간·라운드·학습지·편지 상수', () => {
    expect(activityRatio.default).toBe(0.6);
    expect(activityRatio.options.map((o) => o.value)).toEqual([0.5, 0.6, 0.7]);
    expect(MIN_STAGE_MINUTES).toBe(3.5);
    expect(roundLength).toMatchObject({ longStageMinMinutes: 15, longSec: 180, shortSec: 120, minSec: 90 });
    expect(WORKSHEET_BUNDLE_SEC).toBe(180);
    expect(tradeMinutes.buttons).toEqual([10, 15, 20, 25, 30, 40]);
    expect([tradeMinutes.customMin, tradeMinutes.customMax]).toEqual([5, 90]);
    expect(letterCountRule).toMatchObject({ divisor: 4, min: 2, max: 10 });
    expect(reductionOrder.map((r) => r.step)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('채우는 순서·핵심 체험·줄이는 순서(PRD 4.3.4 v0.3.4)', () => {
    expect(fillOrder).toEqual(['tier2Short', 'wsDuring', 'tier1Full', 'coreFull', 'wsStageEnd', 'tier2Full', 'wsEach', 'tier3Full']);
    expect(Object.keys(fillSteps).sort()).toEqual([...fillOrder].sort());
    expect(coreExperienceIds).toEqual(['L1-E5', 'L1-E1', 'L3-E2']);
    // 사다리의 거꾸로: … 1등급 짧게 → 지금 쓰기를 끝나고로 → 2등급 빼기
    expect(reductionOrder.map((r) => r.id)).toEqual([
      'dropTier3', 'worksheetEachToStageEnd', 'shortTier2', 'worksheetStageEndToAfter', 'shortCore', 'shortTier1', 'deferDuring', 'dropTier2',
    ]);
    expect(reductionOrder.find((r) => r.id === 'shortCore')!.desc).toContain('벽란도');
    expect(duringSourceEvent).toEqual({ W03: 'L1-E5', W14: 'L4-E2' });
  });

  it('편지 슬롯 순환 패턴(PRD 6.7.3)', () => {
    const rewards = Array.from({ length: 10 }, (_, i) => slotAt(i).reward);
    expect(rewards).toEqual(['money', 'fastCustoms', 'tailwind', 'money', 'dexCard', 'tailwind', 'money', 'fastCustoms', 'tailwind', 'money']);
    expect(slotAt(0)).toMatchObject({ slotId: 'S1', difficulty: 'easy' });
    expect(slotAt(1).difficulty).toBe('normal');
    expect(slotsByDifficulty(10)).toEqual({ easy: 5, normal: 5 });
  });
});
