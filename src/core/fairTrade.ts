/**
 * (작업 176) 같은 거래 반복 '바다 폭풍' + '다양한 무역 보너스' — 규칙 엔진.
 *
 * - 상수·문구는 `src/data/fairTrade.ts` 한 곳.
 * - `rules.ts` sell 이 묶음마다 모은 판매 정보(`FairSaleLot`)를 `afterSale`에 넘긴다.
 *   · 거래한 나라·판 상품 기록(개척 지표)은 언제나(학생 기기 미리 계산 포함 — 같은 결과).
 *   · 반복 판정(예보·폭풍)과 보너스는 **호스트만**(`host`), 판 설정이 켜져 있을 때만.
 * - 폭풍 효과(그 항구·그 상품 판매 값 ×0.5)는 `market.ts` quote 가 `effects.storm`으로 적용한다.
 * - 이 파일의 함수는 넘겨받은 Player(이미 복사본)를 직접 고친다.
 */
import { fairTradeRules as R, type FairTip } from '../data/fairTrade';
import type { GoodId, PortId } from '../data/types';
import { isPortClosed, portPrice } from './market';
import { emptyFairTrade, visibleGoods } from './state';
import type { CargoLot, ClassSettings, ClassState, FairTradeState, GameEvent, Player } from './types';

/** 판 설정이 켜져 있는가(옛 판 = 켬) */
export function fairTradeOn(settings: Pick<ClassSettings, 'fairTrade'> | null | undefined): boolean {
  return settings?.fairTrade !== false;
}

/** 이 학생의 기록(없으면 만들어 붙인다) */
export function fairOf(p: Player): FairTradeState {
  if (!p.game.fairTrade) p.game.fairTrade = emptyFairTrade();
  return p.game.fairTrade;
}

/** 읽기 전용(없으면 빈 기록) */
export function fairView(p: { game: { fairTrade?: FairTradeState } }): FairTradeState {
  return p.game.fairTrade ?? emptyFairTrade();
}

/** 산 곳 키: 공장에서 만든 상품은 '부산 공장' */
export function fromKey(lot: Pick<CargoLot, 'source' | 'boughtAt'>): string {
  return lot.source === 'factory' ? R.factoryFrom : lot.boughtAt;
}

/** 거래 길 키 '산 곳>상품>판 항구' */
export function routeKey(from: string, good: GoodId, to: PortId): string {
  return `${from}>${good}>${to}`;
}

export function parseRoute(route: string): { from: string; good: GoodId; to: PortId } {
  const [from = '', good = '', to = ''] = route.split('>');
  return { from, good: good as GoodId, to: to as PortId };
}

/** 개척 지표: 실제로 사고판 항구 수(해외 거래 항구 + 부산) */
export function tradedPortCount(p: { game: { fairTrade?: FairTradeState } }): number {
  return fairView(p).ports.length + 1;
}

/** 판매 묶음 하나(rules.ts sell 이 모음) */
export interface FairSaleLot {
  good: GoodId;
  /** 판 항구 */
  port: PortId;
  qty: number;
  lot: Pick<CargoLot, 'source' | 'boughtAt' | 'start'>;
  /** 이 묶음 판매로 임무 단계가 처음 체크되었다(진행 중인 임무를 채우는 판매) */
  mission: boolean;
}

/** 지금 이 학생·이 항구·이 상품에 폭풍이 있는가 */
export function stormOn(cs: Pick<ClassState, 'round'>, p: Pick<Player, 'game'>, port: PortId, good: GoodId): boolean {
  const s = p.game.effects.storm;
  return !!s && s.port === port && s.good === good && cs.round <= s.untilRound;
}

/** 라운드 처리(voyage.ts): untilRound 가 지난 폭풍은 사라진다 */
export function expireStorm(p: Player, round: number): void {
  const s = p.game.effects.storm;
  if (s && s.untilRound <= round) p.game.effects.storm = null;
}

/**
 * 판매 뒤 처리. `host`가 아니면(학생 기기 미리 계산) 기록만 하고 판정·보너스는 하지 않는다.
 */
export function afterSale(cs: ClassState, p: Player, sales: readonly FairSaleLot[], events: GameEvent[], host: boolean): void {
  if (!sales.length) return;
  const ft = fairOf(p);
  // ① 거래한 나라·판 상품(되팔기는 이 함수로 오지 않는다)
  for (const s of sales) {
    if (s.qty <= 0) continue;
    if (!ft.goods.includes(s.good)) ft.goods.push(s.good);
    if (s.port !== 'BUS' && !ft.ports.includes(s.port)) ft.ports.push(s.port);
    const from = s.lot.boughtAt;
    if (!s.lot.start && s.lot.source !== 'factory' && from !== 'BUS' && !ft.ports.includes(from)) ft.ports.push(from);
  }
  if (!host || !fairTradeOn(cs.settings)) return;
  // ② 보너스 단계
  grantBonus(p, ft, events);
  // ③ 반복 판정: 처음 화물·임무 첫 채움은 빼고, 길별로 모아 minQty 이상인 길만 '한 번 거래'
  const byRoute = new Map<string, number>();
  for (const s of sales) {
    if (s.lot.start || s.mission) continue;
    const key = routeKey(fromKey(s.lot), s.good, s.port);
    byRoute.set(key, (byRoute.get(key) ?? 0) + s.qty);
  }
  for (const [route, qty] of byRoute) {
    if (qty < R.minQty) continue;
    // 같은 입항에서 같은 길로 나눠 판 것(5+5+5…)은 한 번 거래로 센다 — 한 번 들러 여러 번 누른 학생이 바로 폭풍을 맞지 않게
    const visitKey = `${route}@${p.game.visit.arrival}`;
    if (ft.lastVisit === visitKey) continue;
    ft.lastVisit = visitKey;
    judge(cs, p, ft, route, events);
  }
}

function grantBonus(p: Player, ft: FairTradeState, events: GameEvent[]): void {
  for (const kind of ['ports', 'goods'] as const) {
    const n = kind === 'ports' ? ft.ports.length : ft.goods.length;
    for (const step of R.bonusSteps) {
      const id = `${kind}:${step}`;
      if (n < step || ft.bonus.includes(id)) continue;
      ft.bonus.push(id);
      p.game.money += R.bonusAmount;
      events.push({ type: 'fairBonus', kind, step, amount: R.bonusAmount });
    }
  }
}

function judge(cs: ClassState, p: Player, ft: FairTradeState, route: string, events: GameEvent[]): void {
  ft.counts[route] = (ft.counts[route] ?? 0) + 1;
  ft.recent = [...ft.recent, route].slice(-R.windowSize);
  ft.streak = ft.streak?.route === route ? { route, n: ft.streak.n + 1 } : { route, n: 1 };
  // 처음 freeTimes 번은 언제나 괜찮다
  if ((ft.counts[route] ?? 0) <= R.freeTimes) return;
  const hits = ft.recent.filter((r) => r === route).length;
  const repeating = ft.streak.n >= R.forecastStreak || hits >= R.windowHits;
  if (!repeating) return;
  // 폭풍 뒤 cooldownRounds 라운드가 지나기 전에는 예보·폭풍 없음(폭풍이 온 라운드 포함 = 한 라운드 1번)
  if (ft.lastStormRound !== null && cs.round <= ft.lastStormRound + R.cooldownRounds) return;
  const { from, good, to } = parseRoute(route);
  const canStorm = ft.warned.includes(route) && ft.storms < R.maxStormsPerGame;
  const n = (ft.notice?.n ?? 0) + 1;
  const tips = fairTips(cs, p, { from, good, to });
  if (canStorm) {
    const untilRound = Math.max(1, cs.round) + R.stormRounds;
    p.game.effects.storm = { port: to, good, untilRound };
    ft.storms += 1;
    ft.lastStormRound = cs.round;
    // 폭풍이 지나가면 그 길 기록을 비운다
    ft.recent = ft.recent.filter((r) => r !== route);
    delete ft.counts[route];
    ft.streak = null;
    ft.warned = ft.warned.filter((r) => r !== route);
    ft.notice = { n, kind: 'storm', from, good, to, round: cs.round, tips };
    events.push({ type: 'fairStorm', route, port: to, good, untilRound });
    return;
  }
  if (!ft.warned.includes(route)) ft.warned.push(route);
  ft.notice = { n, kind: 'forecast', from, good, to, round: cs.round, tips };
  events.push({ type: 'fairForecast', route });
}

/**
 * 피하는 길 추천(최대 2개): ① 아직 판 적 없는 상품을 열린 항구에서 사서 다른 열린 항구에 파는 길(이익이 큰 것)
 * ② 아직 거래하지 않은 열린 항구. 지금 판 범위에서 열린 항구·보이는 상품만(잠긴 항구 금지), 폭풍 길·피할 상품 제외.
 */
export function fairTips(cs: ClassState, p: Player, avoid: { from: string; good: GoodId; to: PortId }): FairTip[] {
  const ft = fairView(p);
  const open = cs.openPorts.filter((x) => !isPortClosed(cs, x));
  const goods = visibleGoods(cs);
  const tips: FairTip[] = [];
  let best: { good: GoodId; buyAt: PortId; sellAt: PortId; margin: number; fresh: boolean } | null = null;
  for (const good of goods) {
    if (good === avoid.good) continue;
    const fresh = !ft.goods.includes(good);
    for (const buyAt of open) {
      const b = portPrice(cs, buyAt, good);
      if (!b.visible || b.buy === null) continue;
      for (const sellAt of open) {
        if (sellAt === buyAt) continue;
        const s = portPrice(cs, sellAt, good);
        if (!s.visible || s.sell === null) continue;
        const margin = s.sell - b.buy;
        if (margin <= 0) continue;
        if (!best || (fresh && !best.fresh) || (fresh === best.fresh && margin > best.margin)) best = { good, buyAt, sellAt, margin, fresh };
      }
    }
  }
  if (best) tips.push({ kind: 'good', good: best.good, buyAt: best.buyAt, sellAt: best.sellAt });
  const port = open.find(
    (x) => x !== 'BUS' && x !== avoid.to && x !== p.game.port && !ft.ports.includes(x) && goods.some((g) => {
      const q = portPrice(cs, x, g);
      return q.visible && (q.buy !== null || q.sell !== null);
    }),
  );
  if (port) tips.push({ kind: 'port', port });
  return tips.slice(0, 2);
}
