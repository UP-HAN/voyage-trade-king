/**
 * 시장 시세·한도·관세 (PRD 6.5, 6.6) — 작업 103.
 *
 * - 항구 가격은 **학급 공통**이다: 같은 seed·구간·라운드면 어느 학생이 보든 같은 값(흔들림 ±5%, 시드 기반).
 *   학생 상태가 바꾸는 것은 '남은 한도'(이번 입항에 사고판 양·신속 통관)와 개인 효과 두 가지뿐이다:
 *   평판 하락(L4-E3: 인기 H → 보통 N 값), 기술 경쟁 뒤처짐(L3-E3: 반도체 판매가 −10%).
 * - 사건 효과(`activeEffects`)의 꼬리표 변경·가격 배수·관세·한도 배수를 반영한다.
 * - 공개되지 않은 구간의 상품, 열리지 않은 항구는 보이지 않는다(visible=false).
 */
import { goodsById } from '../data/goods';
import { marketByPort, marketTagLabels, priceMultipliers, PRICE_JITTER, tariffRate, tradeLimits } from '../data/market';
import { letterRewards } from '../data/letterSchedule';
import { shipsById } from '../data/ships';
import { voyageCost } from '../data/routes';
import type { GoodId, MarketTag, PortId } from '../data/types';
import { signedRandom } from './rng';
import { activeEffects, visibleGoods } from './state';
import type { ClassState, Origin, Player } from './types';

/** 기술 경쟁에서 밀린 학생의 반도체 판매가 배수 [게임 설정, PRD 6.12.4] */
export const CHIP_PENALTY_MULTIPLIER = 0.9;

export type QuoteTag = MarketTag | 'domestic';

export interface PortPrice {
  port: PortId;
  good: GoodId;
  visible: boolean;
  tag: QuoteTag | null;
  /** 사는 값(만 원/상자). 살 수 없으면 null */
  buy: number | null;
  /** 파는 값(만 원/상자, 개인 효과 반영 전). 팔 수 없으면 null */
  sell: number | null;
}

export interface Quote extends PortPrice {
  /** 이 학생이 실제로 받는 파는 값(개인 효과 반영) */
  sell: number | null;
  /** 한도를 넘겨 팔 때 값(파는 값 × 0.7) */
  overLimitSell: number | null;
  /** 이번 입항에 더 살 수 있는 양 */
  buyLeft: number;
  /** 이번 입항에 제값에 더 팔 수 있는 양 */
  sellFullLeft: number;
  buyLimit: number;
  sellLimit: number;
  /** 해외에서 들어온 상품을 이 항구에 팔 때 관세율 */
  tariffRate: number;
  /** 꼬리표 문구(화면) */
  label: string;
  /** 팔 수 없는 까닭(특산 S) */
  cannotSell: string | null;
}

/** 항구·상품의 시장 꼬리표(사건 효과 포함) */
export function marketTag(cs: ClassState, port: PortId, good: GoodId): QuoteTag | null {
  const row = marketByPort[port];
  let tag: QuoteTag | null = null;
  if (row.S.includes(good)) tag = 'S';
  else if (row.R.includes(good)) tag = 'R';
  else if (row.H.includes(good)) tag = 'H';
  else if (row.N.includes(good)) tag = 'N';
  else if (row.domesticBuy.includes(good)) tag = 'domestic';
  if (row.stageHot.some((h) => h.good === good && h.lesson === cs.stage) && (tag === 'N' || tag === null)) tag = 'H';
  for (const e of activeEffects(cs)) {
    if (e.effect.type === 'priceTag' && e.effect.port === port && e.effect.good === good) tag = e.effect.tag;
  }
  return tag;
}

function priceMul(cs: ClassState, port: PortId, good: GoodId, side: 'buy' | 'sell'): number {
  let m = 1;
  for (const e of activeEffects(cs)) {
    const f = e.effect;
    if (f.type !== 'priceMul') continue;
    if (f.port !== null && f.port !== port) continue;
    if (f.good !== null && f.good !== good) continue;
    if (f.side !== 'both' && f.side !== side) continue;
    m *= f.mul;
  }
  return m;
}

/** 라운드 흔들림 배수(1 ± 0.05) — 같은 seed·구간·라운드·항구·상품이면 같은 값 */
export function jitter(cs: ClassState, port: PortId, good: GoodId): number {
  return 1 + signedRandom(cs.seed, cs.stage, cs.round, `price:${port}:${good}`) * PRICE_JITTER;
}

const toPrice = (v: number): number => Math.max(1, Math.round(v));

/** 학생과 무관한 항구 가격 */
export function portPrice(cs: ClassState, port: PortId, good: GoodId): PortPrice {
  const visible = cs.openPorts.includes(port) && visibleGoods(cs).includes(good);
  const tag = visible ? marketTag(cs, port, good) : null;
  if (!visible || tag === null) return { port, good, visible: visible && tag !== null, tag, buy: null, sell: null };
  const V = goodsById[good].V;
  const j = jitter(cs, port, good);
  let buyMul: number | null = null;
  let sellMul: number | null = null;
  if (tag === 'S') buyMul = priceMultipliers.specialtyBuy;
  if (tag === 'R') {
    buyMul = priceMultipliers.relayBuy;
    sellMul = priceMultipliers.relaySell;
  }
  if (tag === 'H') sellMul = priceMultipliers.hotSell;
  if (tag === 'N') sellMul = priceMultipliers.normalSell;
  if (tag === 'domestic') buyMul = priceMultipliers.domesticBuy;
  return {
    port,
    good,
    visible: true,
    tag,
    buy: buyMul === null ? null : toPrice(V * buyMul * j * priceMul(cs, port, good, 'buy')),
    sell: sellMul === null ? null : toPrice(V * sellMul * j * priceMul(cs, port, good, 'sell')),
  };
}

/** 입항 한도 배수(L3-E4 자동화 항만 등) */
export function limitMultiplier(cs: ClassState, port: PortId): number {
  let m = 1;
  for (const e of activeEffects(cs)) if (e.effect.type === 'limitMul' && e.effect.port === port) m *= e.effect.mul;
  return m;
}

/** 이 항구의 관세율(사건 효과가 있으면 그 값) — 해외에서 들어온 상품에만 적용 */
export function tariffFor(cs: ClassState, port: PortId, good: GoodId): number {
  let rate = tariffRate(port);
  for (const e of activeEffects(cs)) {
    const f = e.effect;
    if (f.type === 'tariff' && f.port === port && (f.good === null || f.good === good)) rate = f.rate;
  }
  return rate;
}

/**
 * 그 묶음을 이 항구에 팔 때 관세율. '그 항구 나라가 만들지 않은 상품'에만 매긴다(PRD 6.6):
 * 우리나라 상품(부산 특산·국내산·공장 생산)을 부산에 팔면 0, 나머지는 항구 관세율.
 * (해외 특산품은 그 특산 항구에서 팔 수 없으므로 '그 나라가 만든 상품'을 그 나라에 파는 경우는 생기지 않는다)
 */
export function tariffForLot(cs: ClassState, port: PortId, good: GoodId, origin: Origin): number {
  if (origin === 'korea' && port === 'BUS') return 0;
  return tariffFor(cs, port, good);
}

/** 학생 한 명의 시세(가격 + 남은 한도 + 개인 효과) */
export function quote(cs: ClassState, player: Player, port: PortId, good: GoodId): Quote {
  const base = portPrice(cs, port, good);
  const g = player.game;
  const here = g.port === port;
  const limMul = limitMultiplier(cs, port);
  const extra = g.effects.fastCustomsStage === cs.stage ? (letterRewards.fastCustoms.extraFullPriceSell ?? 0) : 0;
  const sellLimit = Math.floor((tradeLimits.fullPriceSell + extra) * limMul);
  const buyLimit = Math.floor(tradeLimits.buy * limMul);
  const sold = here ? (g.visit.sold[good] ?? 0) : 0;
  const bought = here ? (g.visit.bought[good] ?? 0) : 0;
  let sell = base.sell;
  if (sell !== null && base.tag === 'H' && g.effects.reputationDown) {
    // 평판 하락: 인기(H) 값 대신 보통(N) 값
    sell = toPrice(goodsById[good].V * priceMultipliers.normalSell * jitter(cs, port, good) * priceMul(cs, port, good, 'sell'));
  }
  if (sell !== null && good === 'chip' && g.effects.chipPenaltyUntilRound !== null && cs.round <= g.effects.chipPenaltyUntilRound) {
    sell = toPrice(sell * CHIP_PENALTY_MULTIPLIER);
  }
  const tag = base.tag;
  const labelOf = (t: QuoteTag | null): string => (t === null ? '' : t === 'domestic' ? marketTagLabels.domestic.text : marketTagLabels[t].text);
  return {
    ...base,
    sell,
    overLimitSell: sell === null ? null : toPrice(sell * tradeLimits.overLimitSellMultiplier),
    buyLeft: Math.max(0, buyLimit - bought),
    sellFullLeft: Math.max(0, sellLimit - sold),
    buyLimit,
    sellLimit,
    tariffRate: tariffFor(cs, port, good),
    label: labelOf(tag),
    cannotSell: tag === 'S' ? marketTagLabels.S.cannotSell : null,
  };
}

/** 이 항구 시장 전체(보이는 상품만) */
export function marketView(cs: ClassState, player: Player, port: PortId): Quote[] {
  return visibleGoods(cs)
    .map((g) => quote(cs, player, port, g))
    .filter((q) => q.visible);
}

/** 운항비(만 원) = 거리 단계 × 10 × 배 운항비 배수 × 사건 배수(작업 125) */
export function voyageCostFor(cs: ClassState, player: Player, from: PortId, to: PortId): number {
  const base = voyageCost(from, to, shipsById[player.game.ship].costMultiplier);
  let m = 1;
  for (const e of activeEffects(cs)) {
    const f = e.effect;
    if (f.type === 'voyageCostMul' && (f.port === null || f.port === to)) m *= f.mul;
  }
  return Math.round(base * m);
}

/** 막힌 항구(효과 portClosed — 작업 125가 채움) */
export function isPortClosed(cs: ClassState, port: PortId): boolean {
  return activeEffects(cs).some((e) => e.effect.type === 'portClosed' && e.effect.port === port);
}
