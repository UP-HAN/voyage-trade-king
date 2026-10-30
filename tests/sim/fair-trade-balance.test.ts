/**
 * 작업 176 — 같은 거래 반복 폭풍·다양한 무역 보너스 균형 시뮬레이션(Memory: 실제 교사 호스트 + 실제 학생 저장소).
 * 같은 판(1차시 25분, 2차시 앞 시간 25분, 자유 항해)에 봇 세 가지를 같은 수만큼 넣는다:
 * '한 가지 반복'(grind) · '다양한 거래'(diverse) · '정상 임무'(mission = 기본 봇 + 임무).
 *
 * 확인: 정상 임무 봇은 폭풍 0·예보 0, 반복 봇 평균 최종 자산 ≤ 다양한 봇 평균, 돈 음수 0, 보너스 중복 없음, 판이 마무리까지 간다.
 * 시드 수는 FAIR_SEEDS(기본 2 — npm test 시간). result.md 표는 FAIR_SEEDS=5 로 돌린 값(`tmp/176-fair-balance.json`).
 * 1차시 10분 판(항구 6곳)에서도 다양한 봇이 첫 단계(3곳·3종)에 닿는지 본다.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assetValue, metricValue } from '../../src/core';
import { fairTradeRules } from '../../src/data/fairTrade';
import type { LessonId } from '../../src/data/types';
import type { LessonPart } from '../../src/data/lessonParts';
import { seatKey } from '../../src/sync/host-session';
import { missionAction, newTraderMemory, traderAction, type TraderMemory } from './fair-bots';
import { COMPANY_NAMES, finishWhenPlanDone, makeSimWorld, rng, type SimStudent } from './sim-world';

const SEEDS = Math.max(1, Number(process.env.FAIR_SEEDS ?? 2));
const PER = 3;
type Kind = 'grind' | 'diverse' | 'mission';
const KINDS: Kind[] = ['grind', 'diverse', 'mission'];

async function runGame(scope: LessonId[], minutes: number, seed: number, lessonPart: LessonPart = 'all', fairTrade = true) {
  const w = makeSimWorld({ recordInbox: false });
  const h = w.host();
  const code = await w.openGame(h, { playUnit: 'lesson', scope, tradeMinutes: minutes, seed: 20261030 + seed, settings: { voyageMode: 'free', lessonPart, fairTrade } });
  const students: { s: SimStudent; kind: Kind; mem: TraderMemory }[] = [];
  let seat = 0;
  for (const kind of KINDS) {
    for (let i = 0; i < PER; i++) {
      seat += 1;
      const s = w.student(seat, COMPANY_NAMES[seat - 1]!);
      students.push({ s, kind, mem: newTraderMemory() });
      void s.store.join(code, seat, s.name);
      await w.advance(300);
    }
  }
  const rand = rng(seed * 7 + 1);
  const step = async () => {
    for (const x of students) {
      const a = x.kind === 'mission' ? missionAction(x.s, rand) : traderAction(x.s, x.mem, x.kind);
      if (a) x.s.store.act(a);
    }
    await w.advance(1000, 250);
  };
  for (let i = 0; i < 5; i++) await step();
  h.teacher({ type: 'startTrade' });
  for (let i = 0; i < (minutes + 8) * 60 && h.game().class.phase !== 'wrapup'; i++) {
    await step();
    finishWhenPlanDone(h);
  }
  for (let i = 0; i < 5; i++) await w.advance(1000, 250);
  const g = h.game();
  const rows = students.map(({ s, kind }) => {
    const p = g.players[seatKey(s.seat)]!;
    const ft = p.game.fairTrade!;
    return {
      kind,
      asset: assetValue(p),
      money: p.game.money,
      storms: ft.storms,
      forecasts: ft.warned.length + ft.storms,
      bonus: ft.bonus.length,
      bonusUnique: new Set(ft.bonus).size === ft.bonus.length,
      ports: ft.ports.length,
      goods: ft.goods.length,
      explore: metricValue(p, 'explore'),
      missionsDone: Object.values(p.game.missions).filter((m) => m.status === 'done').length,
      sells: p.game.log.filter((e) => e.kind === 'sell').length,
      rounds: g.class.round,
    };
  });
  h.session.dispose();
  return { phase: g.class.phase, rows };
}

type Row = Awaited<ReturnType<typeof runGame>>['rows'][number];
const avg = (xs: number[]) => Math.round((xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)) * 10) / 10;
function summarize(rows: Row[]) {
  const out: Record<string, Record<string, number>> = {};
  for (const k of KINDS) {
    const xs = rows.filter((r) => r.kind === k);
    out[k] = {
      asset: avg(xs.map((r) => r.asset)),
      storms: avg(xs.map((r) => r.storms)),
      maxStorms: Math.max(0, ...xs.map((r) => r.storms)),
      forecasts: avg(xs.map((r) => r.forecasts)),
      bonus: avg(xs.map((r) => r.bonus)),
      ports: avg(xs.map((r) => r.ports)),
      goods: avg(xs.map((r) => r.goods)),
      explore: avg(xs.map((r) => r.explore)),
      missionsDone: avg(xs.map((r) => r.missionsDone)),
      sells: avg(xs.map((r) => r.sells)),
      rounds: avg(xs.map((r) => r.rounds)),
    };
  }
  return out;
}

const results: Record<string, unknown> = {};
function save() {
  try {
    mkdirSync(join(process.cwd(), 'tmp'), { recursive: true });
    writeFileSync(join(process.cwd(), 'tmp', '176-fair-balance.json'), JSON.stringify(results, null, 2));
  } catch {
    /* 기록 실패는 시험과 무관 */
  }
}

describe('(작업 176) 같은 거래 반복 폭풍·다양한 무역 보너스 균형', () => {
  for (const [label, scope, part] of [['1차시 25분', ['L1'], 'all'], ['2차시 앞 시간 25분', ['L2'], 'front']] as const) {
    it(`${label}: 정상 임무 봇 폭풍 0·예보 0, 반복 봇 ≤ 다양한 봇(자산 평균), 돈 음수 0, 보너스 중복 없음`, { timeout: 1_200_000 }, async () => {
      const all: Row[] = [];
      const perSeed: unknown[] = [];
      for (let seed = 1; seed <= SEEDS; seed++) {
        const { phase, rows } = await runGame([...scope], 25, seed, part);
        expect(phase).toBe('wrapup');
        perSeed.push(summarize(rows));
        all.push(...rows);
      }
      const sum = summarize(all);
      // FAIR_CONTROL=1: 같은 시드로 규칙을 끈 판도 돌려 비교(result.md 표 — 폭풍이 반복 봇에게 준 차이)
      let control: unknown = null;
      if (process.env.FAIR_CONTROL === '1') {
        const off: Row[] = [];
        for (let seed = 1; seed <= SEEDS; seed++) off.push(...(await runGame([...scope], 25, seed, part, false)).rows);
        control = summarize(off);
      }
      results[label] = { seeds: SEEDS, summary: sum, control, perSeed };
      save();
      // eslint-disable-next-line no-console
      console.log(`[176 sim] ${label} seeds=${SEEDS}`, JSON.stringify(sum));
      for (const r of all) {
        expect(r.money).toBeGreaterThanOrEqual(0);
        expect(r.bonusUnique).toBe(true);
        expect(r.bonus).toBeLessThanOrEqual(fairTradeRules.bonusSteps.length * 2);
        expect(r.storms).toBeLessThanOrEqual(fairTradeRules.maxStormsPerGame);
        if (r.kind === 'mission') {
          expect(r.storms).toBe(0);
          expect(r.forecasts).toBe(0);
        }
      }
      expect(sum.mission!.missionsDone).toBeGreaterThanOrEqual(1);
      expect(sum.grind!.storms).toBeGreaterThan(0);
      expect(sum.grind!.asset).toBeLessThanOrEqual(sum.diverse!.asset);
      expect(sum.diverse!.storms).toBe(0);
    });
  }

  it('1차시 10분 판(항구 6곳)에서도 다양한 봇이 첫 단계(거래한 나라 3곳·판 상품 3종)에 닿는다', { timeout: 600_000 }, async () => {
    const { phase, rows } = await runGame(['L1'], 10, 1);
    expect(phase).toBe('wrapup');
    const div = rows.filter((r) => r.kind === 'diverse');
    results['1차시 10분'] = summarize(rows);
    save();
    // eslint-disable-next-line no-console
    console.log('[176 sim] 1차시 10분', JSON.stringify(summarize(rows)));
    for (const r of div) {
      expect(r.ports).toBeGreaterThanOrEqual(3);
      expect(r.goods).toBeGreaterThanOrEqual(3);
      expect(r.bonus).toBeGreaterThanOrEqual(2);
    }
  });
});
