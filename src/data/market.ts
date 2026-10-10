/**
 * 시장표와 가격·한도·관세 상수 (PRD 6.5, 6.6) — 모두 [게임 설정].
 * 가격 계산(배수 적용·흔들림·관세)은 core(작업 103)가 한다. 여기에는 상수와 표만 둔다.
 *
 * 태그: S=특산(싸게 삼, 팔 수 없음) / R=중계(싱가포르, 사고팔기) / H=인기(비싸게 팜) / N=보통(제값에 팜)
 * - 표에 없는 상품은 그 항구에서 거래하지 않는다.
 * - 공개되지 않은 구간의 상품은 시장에 보이지 않는다(goods.unlockLesson).
 */
import { GOOD_IDS } from './goods';
import type { GoodId, MarketRow, PortId } from './types';

/** 싱가포르 중계(R) 상품 */
const SIN_RELAY: readonly GoodId[] = ['crude', 'graphite', 'clothes', 'robot', 'rice', 'nickel'];

export const marketTable: readonly MarketRow[] = [
  {
    port: 'BUS',
    S: ['chip', 'car', 'phone', 'kcon'],
    R: [],
    H: [],
    // 석유 제품·철강·배터리는 '국내 판매'(공장 생산품을 부산에 판매)
    N: ['crude', 'gas', 'iron', 'nickel', 'chem', 'rice', 'wood', 'clothes', 'robot', 'vaccine', 'ott', 'program', 'oilp', 'steel', 'battery'],
    domesticBuy: ['graphite'],
    stageHot: [{ good: 'gas', lesson: 'L1' }],
  },
  {
    port: 'SHA',
    S: ['graphite', 'clothes'], R: [],
    H: ['chip', 'battery', 'aichip'],
    N: ['car', 'phone', 'crude', 'iron', 'gas', 'robot', 'kcon'],
    domesticBuy: [], stageHot: [],
  },
  {
    port: 'YOK',
    S: ['robot', 'chem'], R: [],
    H: ['rice', 'steel'],
    N: ['chip', 'crude', 'gas', 'iron', 'kcon', 'wood'],
    domesticBuy: [], stageHot: [],
  },
  {
    port: 'HCM',
    S: ['rice', 'clothes'], R: [],
    H: ['steel', 'phone', 'oilp'],
    N: ['chip', 'car', 'kcon', 'vaccine'],
    domesticBuy: [], stageHot: [],
  },
  {
    port: 'BKK',
    S: ['rice'], R: [],
    H: ['car', 'oilp'],
    N: ['phone', 'steel', 'kcon', 'chip'],
    domesticBuy: [], stageHot: [],
  },
  {
    port: 'SIN',
    S: [],
    R: SIN_RELAY,
    H: [],
    // "그 밖의 모든 상품"
    N: GOOD_IDS.filter((g) => !SIN_RELAY.includes(g)),
    domesticBuy: [], stageHot: [],
  },
  {
    port: 'JKT',
    S: ['nickel', 'wood'], R: [],
    H: ['car', 'steel', 'oilp'],
    N: ['phone', 'kcon', 'vaccine'],
    domesticBuy: [], stageHot: [],
  },
  {
    port: 'PHE',
    S: ['iron', 'gas'], R: [],
    H: ['car', 'oilp'],
    N: ['phone', 'chip', 'rice', 'kcon'],
    domesticBuy: [], stageHot: [],
  },
  {
    port: 'MUM',
    S: ['rice'], R: [],
    H: ['steel', 'phone', 'car'],
    N: ['chip', 'vaccine', 'oilp', 'crude'],
    domesticBuy: [], stageHot: [],
  },
  {
    port: 'DAM',
    S: ['crude'], R: [],
    H: ['car', 'rice'],
    N: ['steel', 'phone', 'kcon', 'clothes', 'wood'],
    domesticBuy: [], stageHot: [],
  },
  {
    port: 'ROT',
    S: ['vaccine', 'chem'], R: [],
    H: ['battery', 'chip', 'aichip'],
    N: ['car', 'phone', 'robot', 'kcon', 'oilp', 'clothes', 'rice'],
    domesticBuy: [], stageHot: [],
  },
  {
    port: 'LAX',
    S: ['crude', 'gas', 'ott', 'program'], R: [],
    H: ['chip', 'phone', 'battery', 'kcon', 'aichip'],
    N: ['car', 'robot', 'clothes', 'rice'],
    domesticBuy: [], stageHot: [],
  },
];

export const marketByPort: Readonly<Record<PortId, MarketRow>> = Object.fromEntries(
  marketTable.map((r) => [r.port, r]),
) as Record<PortId, MarketRow>;

/** AI 반도체(L3)를 인기(H)로 사는 항구(PRD 6.5.2 주석) */
export const AICHIP_HOT_PORTS: readonly PortId[] = ['SHA', 'ROT', 'LAX'];

/** 가격 배수 [게임 설정] (PRD 6.5.1) */
export const priceMultipliers = {
  /** 특산 S: 사는 값 */
  specialtyBuy: 0.6,
  /** 중계 R(싱가포르): 사는 값 */
  relayBuy: 0.75,
  /** 중계 R(싱가포르): 파는 값 */
  relaySell: 1.0,
  /** 보통 N: 파는 값 */
  normalSell: 1.0,
  /** 인기 H: 파는 값 */
  hotSell: 1.3,
  /** 국내산 흑연(부산): 사는 값 */
  domesticBuy: 1.1,
} as const;

/** 한 번 입항에 상품 한 종류당 한도 [게임 설정] (PRD 6.5.1) */
export const tradeLimits = {
  /** 제값에 팔 수 있는 양(상자) */
  fullPriceSell: 20,
  /** 살 수 있는 양(상자) */
  buy: 30,
  /** 한도를 넘겨 팔 때 판매가 배수 */
  overLimitSellMultiplier: 0.7,
} as const;

/** 라운드마다 가격 흔들림(±비율). 방 시드 + 라운드 번호로 정해 모두 같은 값을 본다 */
export const PRICE_JITTER = 0.05;

/** 관세 [게임 설정 + p.108] (PRD 6.6) */
export const tariffs = {
  /** 다른 나라에서 들어온 상품(그 항구 나라가 만들지 않은 상품)을 팔 때 */
  default: 0.1,
  byPort: { SIN: 0 } as Readonly<Partial<Record<PortId, number>>>,
  /** 사건으로 바뀌는 관세(작업 103·115~117이 적용) */
  eventOverrides: {
    /** L4-E1 투표 '매김': 부산에 해외 철강을 팔 때 */
    steel1970Busan: { port: 'BUS' as PortId, good: 'steel' as GoodId, rate: 0.3 },
    /** 선택 활동 [가상 뉴스] 뭄바이 수입 철강 관세 인상(P2) */
    mumbaiSteel: { port: 'MUM' as PortId, good: 'steel' as GoodId, rate: 0.4 },
  },
  singaporeNote: '게임 규칙: 싱가포르 항구는 관세가 없어요',
  pages: [108] as const,
  gameRule: true,
} as const;

/** 그 항구의 관세율 */
export function tariffRate(port: PortId): number {
  return tariffs.byPort[port] ?? tariffs.default;
}

/** 시장 꼬리표 화면 문구(PRD 6.5.1) */
export const marketTagLabels = {
  S: { text: '싸게 살 수 있어요', color: 'green', cannotSell: '여기서 만드는 상품이라 사지 않아요' },
  R: { text: '여러 나라에서 모였어요', color: 'blue' },
  H: { text: '비싸게 팔 수 있어요', color: 'orange' },
  N: { text: '', color: 'none' },
  domestic: { text: '국내산', color: 'gray' },
} as const;
