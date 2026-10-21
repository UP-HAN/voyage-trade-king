/**
 * 작업 159 — 자유 항해 후불(쓸 수 있는 돈 < 운항비여도 출발) 시뮬레이션. 151의 자금 분포 비교(fund)와 같은 방식:
 * Memory(실제 교사 호스트 + 실제 학생 저장소) + 무작위 봇, 25명·25분 판을 끝까지.
 * 봇 절반은 기존 봇(돈이 되는 항구만), 절반은 '막 가는 봇'(라운드 중 가끔 돈과 상관없이 [여기로 출발] — 남용에 가까운 경우).
 *
 * 확인: 자금 음수 0, 무역 끝에 낼 운항비 0(정산 누락 없음), 정산 대출(기록 ref 'fare')이 화면에 이상하게 커지지 않는지(한 명 합계 상한).
 * 측정값은 `tmp/159-free-debt.json`(git 무시)과 콘솔에 남긴다(result.md 표의 근거).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isPortClosed, type Action, type PublicPayload } from '../../src/core';
import type { LessonId } from '../../src/data/types';
import { seatKey } from '../../src/sync/host-session';
import { classForPredict } from '../../src/student/predict';
import { botAction, COMPANY_NAMES, makeSimWorld, rng, type SimStudent } from './sim-world';

const N = 25;
const MINUTES = 25;
/** 막 가는 봇이 라운드 하나에서 돈과 상관없이 떠나는 최대 횟수(끝없이 왕복하지 않게) */
const RECKLESS_SAILS = 4;

/** 막 가는 봇: 라운드 중 20% 확률로 돈과 상관없이 아무 항구로 출발, 아니면 기존 봇 행동 */
function recklessAction(s: SimStudent, rand: () => number): Action | null {
  const st = s.store.getState();
  const me = st.peer.me;
  const pub = st.peer.public as PublicPayload | null;
  if (st.peer.status === 'in' && me && pub && st.peer.pendingCount === 0 && me.company.founded && pub.class.phase === 'round' && pub.class.settings.voyageMode === 'free') {
    if ((me.game.sailsThisRound ?? 0) < RECKLESS_SAILS && rand() < 0.2) {
      const c = classForPredict(pub.class);
      const ports = pub.class.openPorts.filter((x) => x !== me.game.port && !isPortClosed(c, x));
      if (ports.length) return { type: 'sailTo', port: ports[Math.floor(rand() * ports.length)]! };
    }
  }
  return botAction(s, rand);
}

async function runFree(scope: LessonId[], seed: number) {
  const w = makeSimWorld({ recordInbox: false });
  const h = w.host();
  const code = await w.openGame(h, { playUnit: 'lesson', scope, tradeMinutes: MINUTES, settings: { voyageMode: 'free' } });
  const students: SimStudent[] = [];
  for (let i = 1; i <= N; i++) {
    const s = w.student(i, COMPANY_NAMES[i - 1]!);
    students.push(s);
    void s.store.join(code, i, s.name);
    await w.advance(300);
  }
  const rand = rng(seed);
  const step = async () => {
    for (const s of students) {
      const a = s.seat % 2 === 0 ? recklessAction(s, rand) : botAction(s, rand);
      if (a) s.store.act(a);
    }
    await w.advance(1000, 250);
  };
  for (let i = 0; i < 5; i++) await step();
  h.teacher({ type: 'startTrade' });
  for (let i = 0; i < (MINUTES + 8) * 60 && h.game().class.phase !== 'wrapup'; i++) await step();
  for (let i = 0; i < 5; i++) await w.advance(1000, 250);
  const g = h.game();
  const rows = students.map((s) => {
    const p = g.players[seatKey(s.seat)]!;
    const fareLoan = p.game.log.filter((e) => e.kind === 'loan' && e.ref === 'fare').reduce((a, e) => a + (e.amount ?? 0), 0);
    const sails = p.game.log.filter((e) => e.kind === 'voyage').length;
    return { seat: s.seat, reckless: s.seat % 2 === 0, money: p.game.money, loan: p.game.loan, fareLoan, fareDue: p.game.fareDue ?? 0, sails };
  });
  h.session.dispose();
  return { phase: g.class.phase, rows };
}

function summary(rows: Awaited<ReturnType<typeof runFree>>['rows']) {
  const part = (r: boolean) => rows.filter((x) => x.reckless === r);
  const stat = (xs: number[]) => ({ avg: Math.round(xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)), max: Math.max(0, ...xs) });
  const of = (r: boolean) => {
    const xs = part(r);
    return {
      n: xs.length,
      sails: stat(xs.map((x) => x.sails)),
      fareLoanPlayers: xs.filter((x) => x.fareLoan > 0).length,
      fareLoan: stat(xs.map((x) => x.fareLoan)),
      loan: stat(xs.map((x) => x.loan)),
      money: stat(xs.map((x) => x.money)),
      minMoney: Math.min(...xs.map((x) => x.money)),
    };
  };
  return { normal: of(false), reckless: of(true) };
}

describe('(작업 159) 자유 항해 후불 — 25명·25분 시뮬레이션', () => {
  const out: Record<string, unknown> = {};
  for (const [label, scope, seed] of [['1차시', ['L1'], 1], ['2차시', ['L2'], 2]] as const) {
    it(`${label}: 자금 음수 0, 낼 운항비 정산 누락 0, 정산 대출이 한 명 1,000만 원을 넘지 않는다`, { timeout: 600_000 }, async () => {
      const { phase, rows } = await runFree([...scope], seed);
      expect(phase).toBe('wrapup');
      const s = summary(rows);
      out[label] = s;
      // eslint-disable-next-line no-console
      console.log(`[159 sim] ${label}`, JSON.stringify(s));
      for (const r of rows) {
        expect(r.money).toBeGreaterThanOrEqual(0);
        expect(r.fareDue).toBe(0);
        expect(Number.isFinite(r.loan)).toBe(true);
        expect(r.fareLoan).toBeLessThanOrEqual(1000);
      }
      try {
        mkdirSync(join(process.cwd(), 'tmp'), { recursive: true });
        writeFileSync(join(process.cwd(), 'tmp', '159-free-debt.json'), JSON.stringify(out, null, 2));
      } catch {
        /* 기록 실패는 시험과 무관 */
      }
    });
  }
});
