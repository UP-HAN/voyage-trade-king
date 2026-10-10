/**
 * 항구 시장 화면의 보기 계산(순수 함수) — 작업 108 (PRD 6.4.2, 6.5, 6.6).
 * 가격·관세·도장 계산은 103 규칙 엔진(`quote`, `tariffForLot`, `applyAction`)이 한다. 여기서는 그 결과를
 * 카드 한 장에 보일 값(값 1개 + 수량 + 작은 '산 값')과 문구로만 바꾼다. 평균 원가·관세 계산식·미끄러짐은 만들지 않는다.
 */
import { cargoCapacity, cargoUsed, quote, tariffForLot, type ClassState, type GameEvent, type Player, type Quote, type StampKind } from '../../core';
import { goodsById, serviceRules } from '../../data/goods';
import { marketTagLabels, tariffs } from '../../data/market';
import { portsById } from '../../data/ports';
import type { GoodId, PortId } from '../../data/types';
import { withEul } from '../text';

/** 팔 수 없는 까닭 */
export const SELL_REASON = {
  specialty: marketTagLabels.S.cannotSell, // '여기서 만드는 상품이라 사지 않아요'
  notTraded: '이 항구는 이 상품을 사지 않아요',
  boughtHere: '이 항구에서 산 상품이라 여기서는 팔 수 없어요',
  serviceBoughtHere: '계약한 항구에서는 팔 수 없어요. 다른 항구에서 팔아요',
  contractLimit: '이번 라운드에 팔 수 있는 계약을 다 팔았어요',
} as const;

/** 살 수 없는 까닭(수량 최대가 0일 때) */
export const BUY_REASON = {
  noSpace: '배에 빈칸이 없어요',
  noMoney: '자금이 모자라요',
  limit: '이번 입항에 살 수 있는 만큼 샀어요',
  contractLimit: '이번 라운드 계약을 다 했어요',
} as const;

export const NOT_TRADING_TEXT = '선생님이 라운드를 시작하면 거래할 수 있어요';

export interface SellCard {
  good: GoodId;
  name: string;
  service: boolean;
  /** 가진 양(이 항구에서 팔 수 없는 묶음 포함) */
  have: number;
  /** 지금 팔 수 있는 최대 수량(0이면 팔 수 없음) */
  max: number;
  /** "여기서 78만 원"의 값. 팔 수 없으면 null */
  price: number | null;
  hot: boolean;
  /** 작은 글씨 "산 값 36" — 먼저 팔리는 묶음의 산 값 */
  boughtFor: number;
  /** 관세율(해외 상품을 이 항구에 팔 때, 0이면 없음) */
  tariffRate: number;
  /** 제값에 더 팔 수 있는 양(게이지) */
  fullLeft: number;
  /** 제값 한도(상자) */
  fullLimit: number;
  reason: string | null;
  /** 이 상품을 팔면 찍힐 도장(먼저 팔리는 묶음 기준) */
  stamp: StampKind | null;
}

export interface BuyCard {
  good: GoodId;
  name: string;
  service: boolean;
  price: number;
  tag: Quote['tag'];
  label: string;
  max: number;
  reason: string | null;
}

/** 이 항구에서 팔 때 쓰는 묶음(산 항구에서는 못 팖, 공장 생산품은 예외 — rules.ts sell 과 같은 조건) */
function sellableLots(p: Player, good: GoodId, port: PortId) {
  const service = goodsById[good].form === 'service';
  const list = service ? p.game.contracts : p.game.cargo;
  return list.filter((l) => l.good === good && (l.boughtAt !== port || l.source === 'factory'));
}

function contractsLeft(cs: ClassState, p: Player, good: GoodId, side: 'buy' | 'sell'): number {
  const rc = p.game.roundContracts;
  const used = rc.round === cs.round ? (rc[side][good] ?? 0) : 0;
  return Math.max(0, serviceRules.maxContractsPerRound - used);
}

/** 도장 종류(rules.ts stampFor 와 같은 규칙) */
function stampOf(origin: 'korea' | 'foreign', port: PortId): StampKind {
  if (origin === 'korea') return port === 'BUS' ? 'domestic' : 'export';
  return port === 'BUS' ? 'import' : 'relay';
}

/** 팔기 영역: 내 화물칸·계약서 카드(상품별 한 장) */
export function sellCards(cs: ClassState, p: Player): SellCard[] {
  const port = p.game.port;
  const order: GoodId[] = [];
  for (const l of [...p.game.cargo, ...p.game.contracts]) if (!order.includes(l.good)) order.push(l.good);
  return order.map((good) => {
    const g = goodsById[good];
    const service = g.form === 'service';
    const all = (service ? p.game.contracts : p.game.cargo).filter((l) => l.good === good);
    const have = all.reduce((s, l) => s + l.qty, 0);
    const lots = sellableLots(p, good, port);
    const sellable = lots.reduce((s, l) => s + l.qty, 0);
    const q = quote(cs, p, port, good);
    const first = lots[0] ?? all[0]!;
    let reason: string | null = null;
    // 서비스 계약은 '산 항구에서는 팔 수 없음'을 먼저 알려 준다(PRD 6.4.2)
    if (service && sellable === 0) reason = SELL_REASON.serviceBoughtHere;
    else if (!q.visible || q.sell === null) reason = q.tag === 'S' ? SELL_REASON.specialty : SELL_REASON.notTraded;
    else if (sellable === 0) reason = service ? SELL_REASON.serviceBoughtHere : SELL_REASON.boughtHere;
    let max = reason ? 0 : sellable;
    if (!reason && service) {
      max = Math.min(max, contractsLeft(cs, p, good, 'sell'));
      if (max === 0) reason = SELL_REASON.contractLimit;
    }
    const canSell = reason === null;
    return {
      good,
      name: g.name,
      service,
      have,
      max,
      price: canSell ? q.sell : null,
      hot: canSell && q.tag === 'H',
      boughtFor: first.unitCost,
      tariffRate: canSell ? tariffForLot(cs, port, good, first.origin) : 0,
      fullLeft: q.sellFullLeft,
      fullLimit: q.sellLimit,
      reason,
      stamp: canSell ? stampOf(first.origin, port) : null,
    };
  });
}

/** 사기 영역: 이 항구에서 싸게 살 수 있는 상품(특산 S·중계 R·국내산) */
export function buyCards(cs: ClassState, p: Player): BuyCard[] {
  const port = p.game.port;
  const free = Math.max(0, cargoCapacity(p) - cargoUsed(p));
  const out: BuyCard[] = [];
  for (const good of Object.keys(goodsById) as GoodId[]) {
    const q = quote(cs, p, port, good);
    if (!q.visible || q.buy === null) continue;
    const g = goodsById[good];
    const service = g.form === 'service';
    const byMoney = Math.floor(Math.max(0, p.game.money) / q.buy);
    const bySpace = service ? Infinity : free;
    const byContract = service ? contractsLeft(cs, p, good, 'buy') : Infinity;
    const max = Math.max(0, Math.min(q.buyLeft, byMoney, bySpace, byContract));
    let reason: string | null = null;
    if (max === 0) {
      if (q.buyLeft === 0) reason = BUY_REASON.limit;
      else if (byContract === 0) reason = BUY_REASON.contractLimit;
      else if (bySpace === 0) reason = BUY_REASON.noSpace;
      else reason = BUY_REASON.noMoney;
    }
    out.push({ good, name: g.name, service, price: q.buy, tag: q.tag, label: q.label, max, reason });
  }
  return out;
}

/** [이 항구가 사는 상품 보기]: 보통·인기·중계로 사는 상품(값 없이 이름 + 인기 표시) */
export function wantedGoods(cs: ClassState, p: Player): { good: GoodId; name: string; hot: boolean }[] {
  const port = p.game.port;
  const out: { good: GoodId; name: string; hot: boolean }[] = [];
  for (const good of Object.keys(goodsById) as GoodId[]) {
    const q = quote(cs, p, port, good);
    if (!q.visible || q.sell === null) continue;
    out.push({ good, name: goodsById[good].name, hot: q.tag === 'H' });
  }
  // 인기 먼저
  return out.sort((a, b) => Number(b.hot) - Number(a.hot));
}

/** 한도 게이지 문구 "이 항구는 반도체를 20상자까지 제값에 사요" */
export function limitSentence(name: string, limit: number, service: boolean): string {
  return `이 항구는 ${withEul(name)} ${limit}${service ? '계약' : '상자'}까지 제값에 사요`;
}

/** 한도를 넘겨 파는 양이 있으면 안내 문구 */
export function overLimitNote(qty: number, fullLeft: number): string | null {
  if (qty <= fullLeft) return null;
  return fullLeft === 0 ? '제값 한도를 다 채웠어요. 지금 팔면 값이 낮아져요' : '한도를 넘는 만큼은 값이 낮아져요';
}

/** 판매 결과 토스트(이익 = 판 돈 − 산 돈 − 관세, 103이 계산한 profit 이벤트) */
export function profitText(amount: number): string {
  if (amount > 0) return `+${amount.toLocaleString('ko-KR')}만 원 남았어요!`;
  if (amount < 0) return `−${Math.abs(amount).toLocaleString('ko-KR')}만 원 손해 봤어요`;
  return '본전이에요. 남은 돈도 손해도 없어요';
}

export interface SaleSummary {
  stamps: StampKind[];
  tariffRate: number;
  tariffAmount: number;
  profit: number | null;
  overLimit: boolean;
}

/** 판매 이벤트 → 도장·관세·이익 */
export function saleSummary(events: readonly GameEvent[]): SaleSummary {
  const stamps: StampKind[] = [];
  let tariffRate = 0;
  let tariffAmount = 0;
  let profit: number | null = null;
  let overLimit = false;
  for (const e of events) {
    if (e.type === 'stamp' && !stamps.includes(e.kind)) stamps.push(e.kind);
    if (e.type === 'tariff') {
      tariffRate = e.rate;
      tariffAmount += e.amount;
    }
    if (e.type === 'profit') profit = e.amount;
    if (e.type === 'overLimit') overLimit = true;
  }
  return { stamps, tariffRate, tariffAmount, profit, overLimit };
}

/** 첫 [수출]/[수입]/[중계] 도장 때 띄울 개념 카드 ID(dex.ts) — 그 도장의 판매액 지표가 0이었으면 처음 */
export const STAMP_CONCEPT: Partial<Record<StampKind, string>> = { export: 'trade-def', import: 'trade-def', relay: 'relay' };

export function firstStampConcept(before: Player, stamps: readonly StampKind[]): { stamp: StampKind; cardId: string } | null {
  const m = before.game.metrics;
  // '무역·수입·수출' 카드는 수출·수입 중 처음 한 번만, '싱가포르의 무역' 카드는 첫 중계 때
  const first: Record<StampKind, boolean> = {
    export: m.exports === 0 && m.imports === 0,
    import: m.exports === 0 && m.imports === 0,
    relay: m.resale === 0,
    domestic: false,
  };
  for (const s of stamps) {
    const card = STAMP_CONCEPT[s];
    if (card && first[s]) return { stamp: s, cardId: card };
  }
  return null;
}

/** 관세 % 표시 "관세 10%" */
export function tariffLabel(rate: number): string {
  return `관세 ${Math.round(rate * 100)}%`;
}

export const SINGAPORE_NOTE = tariffs.singaporeNote;

/** 행동 오류 코드 → 학생 문구 */
export function tradeErrorText(code: string): string {
  switch (code) {
    case 'NOT_TRADING':
      return NOT_TRADING_TEXT;
    case 'NO_SPACE':
      return BUY_REASON.noSpace;
    case 'NO_MONEY':
      return BUY_REASON.noMoney;
    case 'BUY_LIMIT':
      return BUY_REASON.limit;
    case 'CONTRACT_LIMIT':
      return '이번 라운드 계약 한도(5계약)를 넘었어요';
    case 'SAME_PORT':
      return SELL_REASON.boughtHere;
    case 'CANNOT_SELL':
    case 'NOT_SOLD_HERE':
      return SELL_REASON.notTraded;
    case 'CANNOT_BUY':
      return '이 항구에서는 살 수 없어요';
    case 'NO_CARGO':
      return '팔 상품이 없어요';
    default:
      return '지금은 할 수 없어요';
  }
}


// ─── 관세를 매기는 나라(수정 1회차: "수출하는데 왜 관세?" 오해 막기, PRD 6.6 · 교과서 p.108) ───

/** 받침 있으면 '은', 없으면 '는' */
function withEun(word: string): string {
  const ch = word.charCodeAt(word.length - 1);
  const batchim = ch >= 0xac00 && ch <= 0xd7a3 && (ch - 0xac00) % 28 !== 0;
  return `${word}${batchim ? '은' : '는'}`;
}

/** 이 항구에서 관세를 매기는 나라 이름(부산 = 우리나라) */
export function tariffCountry(port: PortId): string {
  return port === 'BUS' ? '우리나라' : portsById[port].country;
}

/** "중국은" / "우리나라는" — 관세 설명 문장의 주어 */
export function tariffSubject(port: PortId): string {
  return withEun(tariffCountry(port));
}

/** "중국은 다른 나라에서 들어오는 상품에 관세를 매겨요" */
export function tariffWhoSentence(port: PortId): string {
  return `${tariffSubject(port)} 다른 나라에서 들어오는 상품에 관세를 매겨요`;
}

/**
 * 판매 결과 띠의 관세 설명 한 줄(관세를 냈을 때만).
 * [수출] → "중국에서는 우리 상품이 수입품이라 관세를 냈어요", [중계] → "일본에서는 다른 나라에서 들어온 수입품이라 관세를 냈어요",
 * [수입](부산) → "우리나라에 들어오는 수입품이라 우리나라에 관세를 냈어요".
 */
export function saleTariffLine(port: PortId, stamps: readonly StampKind[], tariffAmount: number): string | null {
  if (tariffAmount <= 0) return null;
  const country = tariffCountry(port);
  if (port === 'BUS') return '다른 나라에서 사 온 상품이 우리나라에 들어오는 수입품이라 우리나라에 관세를 냈어요';
  if (stamps.includes('export')) return `${country}에서는 우리 상품이 수입품이라 ${country}에 관세를 냈어요`;
  return `${country}에서는 다른 나라에서 들어온 수입품이라 ${country}에 관세를 냈어요`;
}
