/**
 * 벽란도 시장 미니게임 (L1-E1, PRD 6.12.1, p.95~96).
 * 상인 카드 9장을 "다른 나라 상인이 판 물건 / 사 간 물건" 두 바구니로 나눈다(끌어 놓기 + 탭-탭 대안).
 * 보너스 = 첫 제출에서 맞힌 수 × 20만 원(최대 180만 원) [게임 설정].
 */
export type ByeokrandoItemId = 'silk' | 'medicine' | 'books' | 'instrument' | 'jewel' | 'hemp' | 'ramie' | 'ginseng' | 'paper';
export type ByeokrandoSide = 'sold' | 'bought';

export interface ByeokrandoItem {
  id: ByeokrandoItemId;
  name: string;
  /** sold = 다른 나라 상인이 가져와서 판 물건, bought = 고려에서 사 간 물건 */
  answer: ByeokrandoSide;
  image: string;
  pages: readonly number[];
}

const item = (id: ByeokrandoItemId, name: string, answer: ByeokrandoSide): ByeokrandoItem => ({
  id, name, answer, image: `goods/byeokrando/${id}.png`, pages: [95],
});

export const byeokrandoItems: readonly ByeokrandoItem[] = [
  item('silk', '비단', 'sold'),
  item('medicine', '약재', 'sold'),
  item('books', '서적', 'sold'),
  item('instrument', '악기', 'sold'),
  item('jewel', '보석', 'sold'),
  item('hemp', '삼베', 'bought'),
  item('ramie', '모시', 'bought'),
  item('ginseng', '인삼', 'bought'),
  item('paper', '종이', 'bought'),
];

export const byeokrando = {
  title: '벽란도 시장',
  scene: 'scenes/byeokrando.png',
  merchants: 'characters/byeokrando-merchants.png',
  /** 상인 3(고려·송·아라비아) */
  merchantGroups: ['고려 상인', '송나라 상인', '아라비아 상인'],
  baskets: {
    sold: '다른 나라 상인이 판 물건',
    bought: '다른 나라 상인이 사 간 물건',
  },
  textbook: {
    pages: [95],
    note: '고려 시대의 수도인 개경 근처에 벽란도라는 큰 항구가 있었습니다. 이곳에는 가까운 송나라 상인부터 멀리 떨어진 아라비아 상인까지 여러 나라의 상인들이 드나들었습니다. 다른 나라에서 온 상인들은 비단, 약재, 서적, 악기, 보석 등을 가져와서 팔고, 고려에서 삼베, 모시, 인삼, 종이 등을 사 갔습니다.',
  },
  /** [게임 설정] 맞힌 수 × 20만 원, 최대 180만 원 */
  bonusPerCorrect: 20,
  bonusMax: 180,
  /** 제출 후 "고려 입장에서는?" 재분류 질문(p.96) — 비단 = 수입, 인삼 = 수출 */
  reclassify: {
    prompt: '고려 입장에서 보면 어떨까요?',
    items: [
      { item: 'silk' as ByeokrandoItemId, answer: 'import' as const, explain: '다른 나라에서 물자를 사 오는 것은 수입이에요.' },
      { item: 'ginseng' as ByeokrandoItemId, answer: 'export' as const, explain: '다른 나라에 물자를 파는 것은 수출이에요.' },
    ],
    pages: [96],
  },
  /** 짧은 형태(PRD 4.3.2): 카드 5장(판 3·사 간 2), 보너스 = 맞힌 수 × 36만 원(최대 180만), 재분류 질문 생략 */
  shortSet: {
    sold: ['silk', 'medicine', 'books'] as readonly ByeokrandoItemId[],
    bought: ['ginseng', 'paper'] as readonly ByeokrandoItemId[],
    bonusPerCorrect: 36,
    bonusMax: 180,
    reclassify: false,
  },
  /** 공용 화면: 맞힌 수 분포 막대 */
  screenSummary: 'histogram',
  gameRule: true,
} as const;
