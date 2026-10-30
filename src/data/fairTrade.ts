/**
 * (작업 176) 같은 거래 반복 '바다 폭풍' + '다양한 무역 보너스' — 상수 [게임 설정]과 학생·교사·TV 문구 한 곳.
 *
 * - 판정·기록은 호스트(core/fairTrade.ts)만 한다. 학생 기기의 미리 계산(predict)은 판정하지 않는다.
 * - 거래 길(route) = '산 항구 → 상품 → 판 항구'. 공장에서 만든 상품은 산 항구 대신 '부산 공장'(`factoryFrom`).
 * - 폭풍은 그 학생에게만, 그 판매 항구에서 그 상품 판매 값만 줄인다(돈·화물을 빼거나 출항을 막지 않음).
 * - 보너스는 모두에게 같은 크기(정액 원칙, PRD 6.16).
 * - 125(학급 돌발 사건)가 이어 쓸 수 있게 문구·모양을 여기에 둔다.
 * - 학생 문구: 초6 눈높이, '패널티'·'선택' 같은 말을 쓰지 않고 무섭지 않게(PRD 6.15.6).
 */
import { goodsById } from './goods';
import { portsById } from './ports';
import type { GoodId, PortId } from './types';

export const fairTradeRules = {
  /** 한 번 판매에서 그 길로 판 상자가 이만큼 이상일 때만 '한 번 거래'로 센다(조금씩 사고파는 학생 보호) */
  minQty: 5,
  /** 각 길의 처음 이만큼은 언제나 괜찮다(임무·연습) */
  freeTimes: 2,
  /** 같은 길 연속 이만큼이면 갈매기 예보 */
  forecastStreak: 3,
  /** 최근 `windowSize`번 중 같은 길이 `windowHits`번 이상이면(사이에 다른 거래가 끼어도) 같은 단계로 본다 */
  windowSize: 6,
  windowHits: 4,
  /** 폭풍: 그 항구에서 그 상품 판매 값 배수 */
  stormSellMul: 0.5,
  /** 폭풍이 이어지는 라운드 수(1 = 다음 라운드가 끝날 때까지) */
  stormRounds: 1,
  /** 한 학생에게 한 판 폭풍 최대 횟수(한 라운드에는 1번) */
  maxStormsPerGame: 3,
  /** 폭풍 뒤 예보·폭풍이 다시 오려면 지나야 하는 라운드 수 */
  cooldownRounds: 1,
  /** 보너스 단계: 거래한 나라 수·판 상품 종류 수 */
  bonusSteps: [3, 5, 7, 9] as readonly number[],
  /** 단계마다 보너스(만 원) */
  bonusAmount: 30,
  /** 공장에서 만든 상품의 '산 곳' 키 */
  factoryFrom: 'BUS:factory',
} as const;

/** 받침 있으면 '을', 없으면 '를' */
function eul(word: string): string {
  const ch = word.charCodeAt(word.length - 1);
  const has = ch >= 0xac00 && ch <= 0xd7a3 ? (ch - 0xac00) % 28 !== 0 : false;
  return `${word}${has ? '을' : '를'}`;
}

const goodNm = (g: GoodId): string => (goodsById[g]?.name ?? g).replace(/\([^)]*\)\s*$/, '').trim();
const portNm = (p: PortId | string): string => (p === fairTradeRules.factoryFrom ? '부산 공장' : (portsById[p as PortId]?.name ?? p));

/** 피하는 길 추천 하나 */
export type FairTip = { kind: 'port'; port: PortId } | { kind: 'good'; good: GoodId; buyAt: PortId; sellAt: PortId };

export function fairTipText(t: FairTip): string {
  if (t.kind === 'port') return `아직 거래하지 않은 ${portNm(t.port)}에 가서 사고팔아 보세요.`;
  return `${portNm(t.buyAt)}에서 ${eul(goodNm(t.good))} 사서 ${portNm(t.sellAt)}에 팔아 보세요.`;
}

/** 학생·교사·TV 문구 */
export const fairTradeText = {
  forecastTitle: '갈매기 예보',
  stormTitle: '폭풍이 왔어요!',
  forecast: (from: string, good: GoodId, to: PortId): string =>
    `${portNm(from)} → ${portNm(to)} 바닷길에 같은 배가 너무 자주 다녀서 파도가 거세지고 있어요. 한 번 더 같은 길로 ${eul(goodNm(good))} 팔면 폭풍이 올 수 있어요.`,
  forecastTry: '다른 나라, 다른 상품과 거래해 보세요!',
  storm: (good: GoodId, port: PortId): string =>
    `${portNm(port)} 항구에서는 당분간 ${eul(goodNm(good))} 반값에 사 가요. 다른 상품이나 다른 항구를 찾아 항해해 봐요.`,
  stormLesson: '실제 무역에서도 한 가지 상품·한 나라에만 기대면 날씨·사건 하나로 큰 손해를 볼 수 있어요.',
  tipsHead: '이런 길은 어때요?',
  /** 시장 카드 꼬리표 */
  marketTag: '폭풍 때문에 값이 내려갔어요',
  bonus: (kind: 'ports' | 'goods', step: number, amount: number): string =>
    kind === 'ports' ? `다양한 무역 보너스! 새 나라 ${step}곳과 거래했어요 +${amount}만 원` : `다양한 무역 보너스! 상품 ${step}종을 팔았어요 +${amount}만 원`,
  /** 다음 단계까지 진행 표시(다 닿았으면 그 칸은 '다 모음') */
  progress: (ports: number, goods: number): string => {
    const next = (n: number) => fairTradeRules.bonusSteps.find((s) => s > n) ?? null;
    const np = next(ports);
    const ng = next(goods);
    return `거래한 나라 ${np === null ? `${ports}곳 다 모음` : `${ports}/${np}`} · 판 상품 ${ng === null ? `${goods}종 다 모음` : `${goods}/${ng}`}`;
  },
  /** TV 해도 아래 띠(이름 없음) */
  tvNews: '갈매기 소식: 바다 어딘가에 폭풍이 지나갔어요 · 여러 나라와 거래하면 안전해요',
  /** 교사 화면(학생 표·학생 상세) */
  teacher: (storms: number): string => `같은 거래 반복 — 폭풍 ${storms}번`,
  teacherForecast: '같은 거래 반복 — 갈매기 예보',
  /** 항해 규칙 카드 아래 한 줄(켜져 있을 때만) */
  ruleLine: '같은 거래만 되풀이하면 그 바닷길에 폭풍이 와요. 여러 나라·여러 상품과 거래하면 보너스!',
  /** 판 설정 [고급 설정] */
  setupLabel: '같은 거래 반복 폭풍·다양한 무역 보너스',
} as const;

export { portNm as fairPortName, goodNm as fairGoodName };
