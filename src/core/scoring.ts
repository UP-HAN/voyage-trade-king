/**
 * 지표·순위판·시상 (PRD 6.14) — 작업 103.
 *
 * - 지표 8개(`src/data/awards.ts` metrics): 최종 자산·수출액·도감·사회적 책임·협력·무역 박사·개척·도약(성장률).
 * - 순위판·시상 결과에는 출석번호가 없다. 회사는 `pid` + 회사 이름(막힌 이름은 null) + 깃발로만 나온다.
 * - 도약 기준 자산은 호스트가 무역 시간 25% 지점 또는 첫 구간 끝 중 먼저 오는 때 `recordBaseAsset`으로 기록한다
 *   (호출 시점은 작업 123).
 */
import { AWARD_ORDER, metrics as metricDefs, type MetricId } from '../data/awards';
import { eventsById } from '../data/events';
import { missionsById } from '../data/missions';
import { settlementRates, shipsById } from '../data/ships';
import type { AwardResult, ClassState, LeaderEntry, Player } from './types';

type Players = Record<string, Player> | readonly Player[];

const listOf = (players: Players): Player[] =>
  Array.isArray(players) ? [...(players as readonly Player[])] : Object.values(players as Record<string, Player>);

/** 최종 자산(PRD 6.14.1) = 자금 + 남은 화물·계약(산 값×0.5) + 배 값×0.5 − 긴급 대출 */
export function assetValue(p: Player): number {
  const g = p.game;
  const goodsCost = [...g.cargo, ...g.contracts].reduce((s, l) => s + l.unitCost * l.qty, 0);
  const ship = shipsById[g.ship].price;
  return Math.round(g.money + goodsCost * settlementRates.cargoOfCost + ship * settlementRates.shipOfPrice - g.loan);
}

/** 도약 기준 자산(기록 전이거나 시작 자금보다 작으면 시작 자금) */
export function leapBase(p: Player): number {
  const b = p.game.metrics.baseAsset;
  return Math.max(p.game.startMoney, b ?? p.game.startMoney, 1);
}

/** 성장률(소수 둘째 자리) */
export function leapRatio(p: Player): number {
  return Math.round((assetValue(p) / leapBase(p)) * 100) / 100;
}

export function metricValue(p: Player, metric: MetricId): number {
  const m = p.game.metrics;
  switch (metric) {
    case 'finalAsset':
      return assetValue(p);
    case 'exports':
      return m.exports;
    case 'dex':
      return m.dex.length;
    case 'csr':
      return m.csr;
    case 'coop':
      return m.coop;
    case 'quiz':
      return m.quizRight;
    case 'explore':
      return m.visited.length;
    case 'leap':
      return leapRatio(p);
  }
}

/** 기준 자산 기록(이미 있으면 그대로) — 새 Player 를 돌려줌 */
export function recordBaseAsset(p: Player): Player {
  if (p.game.metrics.baseAsset !== null) return p;
  return { ...p, rev: p.rev + 1, game: { ...p.game, metrics: { ...p.game.metrics, baseAsset: assetValue(p) } } };
}

/** 모든 학생 기준 자산 기록 */
export function recordBaseAssets(players: Record<string, Player>): Record<string, Player> {
  const out: Record<string, Player> = {};
  for (const [k, p] of Object.entries(players)) out[k] = recordBaseAsset(p);
  return out;
}

/** 공개 화면에 쓰는 회사 이름: 막힌 이름 또는 '확인 후 공개' 중 미확인이면 null("이름 짓는 중") */
export function publicCompanyName(p: Player, nameReview: boolean): string | null {
  if (p.company.nameStatus === 'blocked') return null;
  if (nameReview && p.company.nameStatus === 'review') return null;
  return p.company.name;
}

function entry(p: Player, value: number, rank: number, nameReview: boolean): LeaderEntry {
  return { pid: p.pid, company: publicCompanyName(p, nameReview), flag: { color: p.company.color, emblem: p.company.emblem }, value, rank };
}

/** 지표 순으로 정렬한 순위(경쟁 순위: 1, 2, 2, 4) — 내부 계산용 */
export function rankAll(players: Players, metric: MetricId): { p: Player; value: number; rank: number }[] {
  const rows = listOf(players)
    .map((p) => ({ p, value: metricValue(p, metric) }))
    .sort((a, b) => b.value - a.value || (a.p.pid < b.p.pid ? -1 : a.p.pid > b.p.pid ? 1 : 0));
  let rank = 0;
  return rows.map((r, i) => {
    if (i === 0 || r.value !== rows[i - 1].value) rank = i + 1;
    return { ...r, rank };
  });
}

export interface BoardOptions {
  nameReview?: boolean;
}

/** 상위 N(동점이면 경계에서 함께). N=0이면 빈 배열 */
export function leaderboard(players: Players, metric: MetricId, topN: number, opts: BoardOptions = {}): LeaderEntry[] {
  if (topN <= 0) return [];
  return rankAll(players, metric)
    .filter((r) => r.rank <= topN)
    .map((r) => entry(r.p, r.value, r.rank, opts.nameReview ?? false));
}

/** 내 순위가 상위 N 안이면 그 순위, 아니면 null(하위 순위는 표시하지 않음) */
export function myRankIfTop(players: Players, seat: number, metric: MetricId, topN: number): number | null {
  if (topN <= 0) return null;
  const row = rankAll(players, metric).find((r) => r.p.seat === seat);
  return row && row.rank <= topN ? row.rank : null;
}

export interface AwardOptions {
  /** 상별 수상 인원 K(1~3) */
  perPrize?: number;
  /** 차시 한 판: 모든 학생 값이 같은 지표의 상은 뺀다(PRD 4.1.1) */
  hideFlatMetrics?: boolean;
  /** 교사가 끈 상 */
  off?: readonly MetricId[];
  nameReview?: boolean;
}

/** 모든 학생 값이 같은 지표 */
export function flatMetrics(players: Players): MetricId[] {
  const list = listOf(players);
  if (!list.length) return [];
  return metricDefs.map((m) => m.id).filter((id) => new Set(list.map((p) => metricValue(p, id))).size === 1);
}

/**
 * 시상(PRD 6.14.1): 상 8개 × K명. 지표 표 순서(최종 자산 → … → 도약)로 주되 이미 상을 받은 학생은 다음 순위에게 넘긴다.
 * 동점이면 함께 수상(그래서 K명보다 많을 수 있음). 값이 0 이하인 학생은 받지 않는다(result.md 가정).
 * 결과는 발표 순서(`AWARD_ORDER`: 도약상이 무역왕상 바로 앞)로 돌려준다.
 */
export function awards(players: Players, opts: AwardOptions = {}): AwardResult[] {
  const k = Math.max(1, Math.min(3, opts.perPrize ?? 3));
  const list = listOf(players);
  const flat = new Set(opts.hideFlatMetrics ? flatMetrics(list) : []);
  const off = new Set(opts.off ?? []);
  const awarded = new Set<string>();
  const results = new Map<MetricId, AwardResult>();
  for (const def of metricDefs) {
    if (flat.has(def.id) || off.has(def.id)) continue;
    const rows = rankAll(
      list.filter((p) => !awarded.has(p.pid)),
      def.id,
    ).filter((r) => r.value > 0);
    const winners: typeof rows = [];
    for (const r of rows) {
      if (winners.length >= k && r.value !== winners[winners.length - 1].value) break;
      winners.push(r);
    }
    winners.forEach((w) => awarded.add(w.p.pid));
    results.set(def.id, {
      metric: def.id,
      award: def.award,
      winners: winners.map((w) => entry(w.p, w.value, w.rank, opts.nameReview ?? false)),
    });
  }
  return AWARD_ORDER.filter((id) => results.has(id)).map((id) => results.get(id)!);
}

/**
 * 항해 완주 증서(PRD 6.14.1): 이 판에서 발동한 **필수(1등급)** 사건의 임무를 모두 마친 학생.
 * 학생 화면에만 보이고 공용 화면에는 인원수만.
 */
export function hasCertificate(cs: ClassState, p: Player): boolean {
  const required = Object.values(missionsById).filter((m) => cs.firedEvents.includes(m.eventId) && eventsById[m.eventId]?.required);
  return required.every((m) => p.game.missions[m.id]?.status === 'done');
}
