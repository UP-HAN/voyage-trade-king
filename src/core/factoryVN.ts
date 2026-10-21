/**
 * 호찌민 해외 공장 (L4-E2·L4-E3, PRD 6.10) — 즉시 정산 계산만(P1 화면은 작업 117). 작업 103.
 * 수치는 [게임 설정 + p.109]. src/data 에 해당 상수가 없어 여기 둔다(result.md 제안: 데이터로 옮기기).
 */
import type { GameEvent, Player } from './types';

export const VN_FACTORY = {
  buildCost: 150,
  wage: {
    fair: { profit: 300, csr: 20 },
    low: { profit: 400, csr: -10 },
  },
  env: {
    install: { cost: 100, csr: 20 },
    skip: { cost: 0, csr: -10 },
  },
  /** L4-E3 근로 환경 보도: 낮은 임금 또는 미설치 */
  report: { csr: -10 },
  /** 개선 선택: 임금 올리기 / 설비 설치 */
  improve: { cost: 100, csr: 10 },
  pages: [109],
  gameRule: true,
} as const;

export type Wage = 'fair' | 'low';
export type EnvChoice = 'install' | 'skip';

export interface VNDecision {
  build: boolean;
  wage?: Wage;
  env?: EnvChoice;
  /** 까닭(선택, 40자) */
  reason?: string;
}

/** 결정 → 자금·사회적 책임 변화(정당+설치 = +50·+40 / 낮은 임금+미설치 = +250·−20) */
export function vnFactoryOutcome(d: VNDecision): { money: number; csr: number } {
  if (!d.build) return { money: 0, csr: 0 };
  const w = VN_FACTORY.wage[d.wage ?? 'fair'];
  const e = VN_FACTORY.env[d.env ?? 'install'];
  return { money: -VN_FACTORY.buildCost + w.profit - e.cost, csr: w.csr + e.csr };
}

export function isBadChoice(d: VNDecision): boolean {
  return d.build && (d.wage === 'low' || d.env === 'skip');
}

export function parseVNDecision(raw: unknown): VNDecision | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.build !== 'boolean') return null;
  // JSON 상태에 undefined 를 남기지 않도록 있는 필드만 담는다
  const reason = typeof r.reason === 'string' ? { reason: r.reason.slice(0, 40) } : {};
  if (!r.build) return { build: false, ...reason };
  if (r.wage !== 'fair' && r.wage !== 'low') return null;
  if (r.env !== 'install' && r.env !== 'skip') return null;
  return { build: true, wage: r.wage, env: r.env, ...reason };
}

/** L4-E2 결정 즉시 정산(player 는 복사본, 직접 고침) */
export function applyVNDecision(p: Player, d: VNDecision, events: GameEvent[]): void {
  const o = vnFactoryOutcome(d);
  if (o.money) {
    p.game.money += o.money;
    events.push({ type: 'money', amount: o.money, reason: 'vnFactory' });
  }
  if (o.csr) {
    p.game.metrics.csr += o.csr;
    events.push({ type: 'csr', amount: o.csr, reason: 'vnFactory' });
  }
}

/** L4-E3 보도: 나쁜 선택을 한 학생만 사회적 책임 −10, 평판 하락 */
export function applyVNReport(p: Player, d: VNDecision | null, events: GameEvent[]): boolean {
  if (!d || !isBadChoice(d)) return false;
  p.game.metrics.csr += VN_FACTORY.report.csr;
  p.game.effects.reputationDown = true;
  events.push({ type: 'csr', amount: VN_FACTORY.report.csr, reason: 'vnReport' });
  return true;
}

/**
 * 개선 선택(임금 올리기 / 설비 설치) — 각 100만 원, 사회적 책임 +10.
 * 나쁜 선택을 모두 고치면 평판 하락이 풀린다. 오류면 문자열.
 */
export function applyVNImprove(
  p: Player,
  d: VNDecision | null,
  which: 'wage' | 'env',
  done: readonly string[],
  events: GameEvent[],
  /** (작업 151) 쓸 수 있는 돈(`spendable(cs, p)` — 자유 항해면 자금 − 낼 운항비). 없으면 자금 */
  budget: number = p.game.money,
): string | null {
  if (!d || !isBadChoice(d)) return 'NOTHING_TO_IMPROVE';
  if (which === 'wage' && d.wage !== 'low') return 'NOTHING_TO_IMPROVE';
  if (which === 'env' && d.env !== 'skip') return 'NOTHING_TO_IMPROVE';
  if (done.includes(which)) return 'ANSWERED';
  if (budget < VN_FACTORY.improve.cost) return 'NO_MONEY';
  p.game.money -= VN_FACTORY.improve.cost;
  p.game.metrics.csr += VN_FACTORY.improve.csr;
  events.push({ type: 'money', amount: -VN_FACTORY.improve.cost, reason: `vnImprove:${which}` });
  events.push({ type: 'csr', amount: VN_FACTORY.improve.csr, reason: `vnImprove:${which}` });
  const fixed = new Set([...done, which]);
  const stillBad = (d.wage === 'low' && !fixed.has('wage')) || (d.env === 'skip' && !fixed.has('env'));
  if (!stillBad) p.game.effects.reputationDown = false;
  return null;
}
