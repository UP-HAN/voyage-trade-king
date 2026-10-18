/**
 * 무역 도감 (PRD 6.13) + 항해 규칙 탭(6.16.3) + 앞 차시 요약 카드(4.2.3, v0.3.1).
 * - 상품 탭·항구 탭은 goods.ts·ports.ts 를 그대로 쓴다(여기에 다시 적지 않음).
 * - 개념 카드는 교과서 문장으로 쓰고 쪽수를 단다. 해당 사건 경험 또는 편지 보상(dexCard)으로 얻는다.
 */
import type { ClassroomItemCard, ConceptCard, ExportTypeCard, RuleCard, SummaryCard } from './types';

/** 개념 카드 */
export const conceptCards: readonly ConceptCard[] = [
  {
    id: 'byeokrando', title: '벽란도의 무역', lesson: 'L1', unlock: 'L1-E1 벽란도 시장', pages: [95],
    text: '고려 시대의 수도 개경 근처에 벽란도라는 큰 항구가 있었어요. 다른 나라에서 온 상인들은 비단, 약재, 서적, 악기, 보석 등을 가져와서 팔고, 고려에서 삼베, 모시, 인삼, 종이 등을 사 갔어요.',
  },
  {
    id: 'trade-def', title: '무역·수입·수출', lesson: 'L1', unlock: 'L1-E2 개념 카드', pages: [96],
    text: '나라와 나라 사이에 물자나 서비스를 사고팔거나 교환하는 일을 무역이라고 해요. 다른 나라에서 물자나 서비스를 사 오는 것을 수입, 다른 나라에 물자나 서비스를 파는 것을 수출이라고 해요.',
  },
  {
    id: 'goods-services', title: '물자와 서비스', lesson: 'L1', unlock: '서비스 상품을 처음 사고팔 때 · 편지 보상', pages: [96, 103],
    text: '물자는 어떤 활동에 필요한 물건이나 물건을 만드는 데 필요한 원료예요. 나라 사이에는 물자뿐 아니라 서비스도 사고팔아요. 우리나라는 미국에서 온라인 동영상 서비스를 수입해요.',
  },
  {
    id: 'trade-need', title: '무역이 필요한 까닭', lesson: 'L1', unlock: 'L1-E4 무역이 없다면?', pages: [97],
    text: '살아가는 데 필요한 모든 물자나 서비스를 한 나라 안에서 구하기는 어려워요. 천연가스가 매장되어 있는 곳은 많지 않아서 일부 국가에서만 생산할 수 있고, 비행기를 만드는 데는 수준 높은 기술이 필요해서 일부 국가에서만 만들 수 있어요.',
  },
  {
    id: 'trade-benefit', title: '무역의 좋은 점', lesson: 'L1', unlock: 'L1-E5 두 섬 이야기', pages: [99],
    text: '여러 나라가 각각 효율적으로 생산하는 상품을 수출하고, 효율적으로 생산하기 어려운 상품을 수입하면 더 우수한 품질의 상품을 저렴한 가격으로 사용할 수 있어요.',
  },
  {
    id: 'trade-reasons', title: '나라마다 다른 까닭', lesson: 'L1', unlock: '항구 카드 3곳 보기 · 편지 보상', pages: [99],
    text: '나라마다 자연환경, 자원, 자본, 기술 등에 차이가 있어 무역을 해요. 각 나라는 다른 나라보다 더 잘 생산할 수 있는 물자나 서비스를 수출하고, 더 잘 생산하지 못하거나 부족한 물자나 서비스를 수입해요.',
  },
  {
    id: 'graphite', title: '흑연', lesson: 'L1', unlock: 'L1-E7 흑연 선택', pages: [98, 99],
    text: '흑연은 연필뿐만 아니라 스마트폰, 배터리의 원료로 쓰이는 자원이에요. 과거 우리나라는 세계적인 흑연 생산국이었지만, 다른 나라에서 저렴한 가격의 흑연을 수입하면서 거의 생산하지 않게 됐어요. 이처럼 한 나라 안에서 구할 수 있더라도 다른 나라에서 수입하기도 해요.',
  },
  {
    id: 'korea-trade', title: '우리나라 무역의 특징', lesson: 'L2', unlock: 'L2-E2 부산 공장 개장', pages: [101, 104],
    text: '우리나라는 원유, 천연가스, 철광석 등 산업 발달에 필요한 천연자원이 부족하지만, 다른 나라에서 수입한 자원으로 다양한 상품을 생산할 수 있는 기술이 발달했어요. 그래서 천연자원을 수입한 후 상품을 생산하여 수출하는 무역이 발달했어요.',
  },
  {
    id: 'relay', title: '싱가포르의 무역', lesson: 'L2', unlock: 'L2-E5 싱가포르 첫 입항', pages: [104],
    text: '싱가포르는 유럽과 아시아를 잇는 항로에 자리 잡고 있어요. 싱가포르 정부가 큰 항구를 만들자 여러 나라에서 생산한 상품들이 모이기 시작했고, 이 상품들을 필요한 나라에 다시 파는 형태의 무역이 발달했어요.',
  },
  {
    id: 'world-ports', title: '세계적인 무역항과 선박', lesson: 'L2', unlock: '세계적인 무역항 첫 입항 · 편지 보상', pages: [104],
    text: '무역을 할 때 선박을 이용하면 많은 양의 상품을 안전하고 효율적으로 실어 나를 수 있어요. 그래서 큰 선박이 정박할 수 있는 항구가 있고 교통이 편리한 곳에 위치한 도시에서 무역이 활발해요. 미국의 로스앤젤레스, 중국의 상하이, 네덜란드의 로테르담 등이 세계적인 무역항을 갖춘 도시예요.',
  },
  {
    id: 'expo', title: '박람회', lesson: 'L2', unlock: '선택 활동 세계 박람회 · 편지 보상', pages: [105],
    text: '박람회는 일정한 기간과 장소를 정해 놓고 다양한 물품을 전시하는 행사예요. 판매자와 소비자가 상품에 관해 궁금한 것을 직접 묻고 답할 수 있고, 관심 있는 상품을 현장에서 직접 구매하거나 나중에 구매할 것을 약속할 수도 있어요.',
  },
  {
    id: 'interdependence', title: '상호 의존', lesson: 'L3', unlock: 'L3-E1 광물 협력 기사', pages: [106],
    text: '무역이 활발해지면서 여러 나라의 우수한 물자를 한데 모아서 새로운 제품을 생산하기도 하고, 여러 나라가 각자 잘하는 분야를 중심으로 협력하여 사업을 진행하기도 해요.',
  },
  {
    id: 'competition-tech', title: '경쟁 ① 첨단 기술을 개발하기 위한 경쟁', lesson: 'L3', unlock: 'L3-E3 기술 경쟁', pages: [107],
    text: '더 나은 품질의 생성형 인공지능 제품을 개발해서 세계 여러 나라에 수출하기 위한 각 나라의 경쟁이 치열해지고 있어요.',
  },
  {
    id: 'competition-facility', title: '경쟁 ② 다른 나라에 필요한 시설을 건설하기 위한 경쟁', lesson: 'L3', unlock: 'L3-E6 경쟁 카드', pages: [107],
    text: '철도, 도로, 발전소 등 다른 나라의 주요 시설을 건설하기 위한 세계 여러 나라의 경쟁이 치열해요. 우리나라 기업이 건설한 인도의 다리도 있어요.',
  },
  {
    id: 'competition-env', title: '경쟁 ③ 더 나은 무역 환경을 만들기 위한 경쟁', lesson: 'L3', unlock: 'L3-E4 자동화 항만 투표', pages: [107],
    text: '세계 여러 나라는 자동화 항만 시스템을 도입하며 우수한 무역 환경을 갖추려고 경쟁해요. 부산항은 자동화 항만 시스템을 구축했어요.',
  },
  {
    id: 'export-growth', title: '수출이 늘어나면', lesson: 'L3', unlock: 'L3-E5 경제 게이지', pages: [107],
    text: '수출이 늘어나면 더 많은 물자나 서비스를 생산해야 하므로 산업이 성장해요. 이에 따라 일자리가 늘어나고 사람들의 소득도 증가하게 돼요.',
  },
  {
    id: 'import-pros-cons', title: '수입의 좋은 점과 문제점', lesson: 'L4', unlock: 'L4-E1 1970년대 철강', pages: [108],
    text: '수입이 늘어나면 국내에서 얻기 힘든 물자나 서비스를 이용할 수 있어 사람들의 생활이 풍족해져요. 그러나 수입이 늘어나서 국내 기업이 피해를 입거나 관련 산업이 성장하기 어려울 수도 있어요.',
  },
  {
    id: 'tariff', title: '관세', lesson: 'L4', unlock: '처음 관세를 낼 때 · 편지 보상', pages: [108],
    text: '관세는 다른 나라에서 수입하는 상품에 부과하는 세금이에요. 세계 여러 나라는 국내 산업을 보호하고 성장시키기 위해 수입품에 높은 관세를 부과하거나 일정한 양 이하로 수입을 제한하기도 해요.',
  },
  {
    id: 'steel-1970', title: '1970년대 우리나라 철강', lesson: 'L4', unlock: 'L4-E1 실제 사례 카드', pages: [108],
    text: '1970년대 우리나라는 제철소를 짓고 자체 기술로 철강 제품을 만들기 위해 노력했어요. 당시 수입 철강 제품에는 높은 관세를 부과했어요. 그 결과 국내에서 생산한 철강 제품이 수입 철강 제품보다 더 높은 경쟁력을 갖출 수 있었고, 오늘날 우리나라는 세계적인 철강 산업 국가로 성장했어요.',
  },
  {
    id: 'overseas-production', title: '해외 생산 시설', lesson: 'L4', unlock: 'L4-E2 베트남 기사', pages: [109],
    text: '세계 여러 나라 간에 무역이 활발해지면서, 기업들은 물자를 생산하는 데 유리한 환경을 갖춘 나라에서 경제활동을 하기도 해요. 그런데 기업이 얻는 이익에 비해 근로자들이 정당한 임금을 받지 못하거나, 생산 과정에서 환경 오염과 같은 문제가 발생하기도 해요.',
  },
  {
    id: 'customs-broker', title: '관세사', lesson: 'L4', unlock: 'L4-E4 관세사 직업 카드', pages: [110],
    text: '관세사는 수출입과 관련한 법 지식을 바탕으로 개인이나 기업이 원활하게 무역 활동을 할 수 있도록 도와요. 또 법에 정해진 규정에 따라 나라에 수출입 물품을 신고해요. 관세사가 되려면 무역, 관세 등에 관한 법 지식과 업무 처리 과정을 잘 알아야 해요.',
  },
  {
    id: 'connected-seas', title: '서로 이어진 바다', lesson: 'L3', unlock: '돌발 사건 해설 카드 3장 보기', pages: [104, 106],
    text: '무역을 할 때 선박을 이용하면 많은 양의 상품을 안전하고 효율적으로 실어 나를 수 있어요. 무역이 활발해지면서 여러 나라의 우수한 물자를 한데 모아서 새로운 제품을 생산하기도 해요.',
  },
];

/** 수출국 4유형(p.103) — L2-E4 임무로 모음 */
export const exportTypeCards: readonly ExportTypeCard[] = [
  {
    id: 'export-agri', title: '농산물을 수출하는 나라', pages: [103],
    text: '넓은 땅에서 많은 농산물을 생산하는 나라들은 전 세계에 농산물을 수출해요.',
    examples: ['인도 — 쌀', '타이 — 쌀', '베트남 — 쌀'], goods: ['rice'],
  },
  {
    id: 'export-resource', title: '천연자원을 수출하는 나라', pages: [103],
    text: '풍부한 천연자원을 가지고 있는 나라들은 전 세계에 천연자원을 수출해요.',
    examples: ['사우디아라비아 — 원유', '미국 — 원유'], goods: ['crude', 'iron', 'gas', 'nickel'],
  },
  {
    id: 'export-tech', title: '기술로 만든 물자를 수출하는 나라', pages: [103],
    text: '뛰어난 기술을 바탕으로 생산한 물자나 서비스를 수출하는 나라들도 있어요.',
    examples: ['독일 — 백신', '일본 — 로봇'], goods: ['robot', 'vaccine'],
  },
  {
    id: 'export-culture', title: '문화를 수출하는 나라', pages: [96, 103],
    text: '전 세계 사람들은 다른 나라에서 수입한 영화, 드라마, 음악 등 다양한 문화 상품을 즐겨요.',
    examples: ['미국 — 온라인 동영상 서비스', '우리나라 — 드라마·예능'], goods: ['ott', 'kcon'],
  },
];

/** 교실 물건 6장(p.94) — 선택 활동 '교실 물건 탐정'(P2) */
export const classroomItemCards: readonly ClassroomItemCard[] = [
  { id: 'item-door', item: '출입문', country: '인도네시아', material: '나무', relatedGood: 'wood', relatedPort: 'JKT', pages: [94], text: '인도네시아에서 자란 나무로 만든 출입문' },
  { id: 'item-bookshelf', item: '플라스틱 책꽂이', country: '사우디아라비아', material: '원유', relatedGood: 'crude', relatedPort: 'DAM', pages: [94], text: '사우디아라비아에서 생산한 원유로 만든 플라스틱 책꽂이' },
  { id: 'item-chair', item: '의자', country: '오스트레일리아', material: '철', relatedGood: 'iron', relatedPort: 'PHE', pages: [94], text: '오스트레일리아에서 캐낸 철로 만든 의자' },
  { id: 'item-pencil', item: '연필', country: '중국', material: '—', relatedPort: 'SHA', pages: [94], text: '중국에서 만든 연필' },
  { id: 'item-tablet', item: '태블릿', country: '미국', material: '프로그램', relatedGood: 'program', relatedPort: 'LAX', pages: [94], text: '미국에서 만든 프로그램을 사용하는 태블릿' },
  { id: 'item-clothes', item: '옷', country: '베트남', material: '—', relatedGood: 'clothes', relatedPort: 'HCM', pages: [94], text: '베트남에서 만든 옷' },
];

/**
 * 도감 '항해 규칙' 탭 — 준비 단계 항해 규칙 카드와 같은 4장(PRD 6.16.3 문구 그대로). [게임 설정]
 * 역전 장치가 꺼진 판에서는 2번 카드를 숨긴다(requires: 'comeback').
 */
export const ruleCards: readonly RuleCard[] = [
  { id: 'rule-1', no: 1, text: '보상은 모두에게 같은 크기예요.', gameRule: true },
  { id: 'rule-2', no: 2, text: '구간이 바뀔 때 작은 회사 1/3은 항구 조합의 기회 카드를 골라요.', requires: 'comeback', gameRule: true },
  { id: 'rule-3', no: 3, text: '큰 배·많은 화물은 사고가 나면 비용도 커요. 바다 소식을 읽고 대비해요.', gameRule: true },
  { id: 'rule-4', no: 4, text: '상은 8가지예요. 많이 자란 회사(도약상)도 상을 받아요.', gameRule: true },
];

/** 도감 탭 묶음(화면용) */
export const dex = {
  concepts: conceptCards,
  exportTypes: exportTypeCards,
  classroomItems: classroomItemCards,
  rules: ruleCards,
} as const;

/**
 * 앞 차시 요약 카드(PRD 4.2.3, v0.3.1) — L2~L4 로 시작하는 판(차시 한 판·고급 범위)의 첫 화면에 이어 나온다.
 * schedule.ts `stageStart[].summaryCardIds` 가 이 ID 를 가리킨다.
 */
export const summaryCards: readonly SummaryCard[] = [
  {
    id: 'SUM-L1', lesson: 'L1', title: '1차시 요약 — 무역과 무역이 이루어지는 까닭',
    lines: [
      { text: '나라와 나라 사이에 물자나 서비스를 사고팔거나 교환하는 일을 무역이라고 해요.', pages: [96] },
      { text: '다른 나라에서 물자나 서비스를 사 오는 것은 수입, 다른 나라에 파는 것은 수출이에요.', pages: [96] },
      { text: '살아가는 데 필요한 모든 물자나 서비스를 한 나라 안에서 구하기는 어려워요.', pages: [97] },
      { text: '나라마다 자연환경, 자원, 자본, 기술 등에 차이가 있어 무역을 해요.', pages: [99] },
      { text: '각 나라가 효율적으로 생산하는 상품을 수출하고, 효율적으로 생산하기 어려운 상품을 수입하면 더 우수한 품질의 상품을 저렴한 가격으로 사용할 수 있어요.', pages: [99] },
    ],
  },
  {
    id: 'SUM-L2', lesson: 'L2', title: '2차시 요약 — 우리나라와 세계의 다양한 무역',
    lines: [
      { text: '우리나라는 원유, 정밀 화학 원료, 천연가스, 석탄 등을 주로 수입하고, 반도체, 자동차, 무선 통신 기기, 석유 제품 등을 주로 수출해요.', pages: [100] },
      { text: '우리나라는 천연자원을 수입한 후 상품을 생산하여 수출하는 무역이 발달했어요.', pages: [104] },
      { text: '세계 여러 나라는 자연환경, 발달한 기술, 지리적 위치 등 각 나라의 특징에 따른 무역이 발달했어요.', pages: [104] },
    ],
  },
  {
    id: 'SUM-L3', lesson: 'L3', title: '3차시 요약 — 상호 의존과 경쟁',
    lines: [
      { text: '여러 나라의 우수한 물자를 한데 모아서 새로운 제품을 생산하기도 하고, 각자 잘하는 분야를 중심으로 협력하기도 해요.', pages: [106] },
      { text: '세계 여러 나라는 물자나 서비스를 수출하여 더 많은 이익을 얻으려고 서로 경쟁해요.', pages: [107] },
      { text: '첨단 기술을 개발하기 위한 경쟁, 다른 나라에 필요한 시설을 건설하기 위한 경쟁, 더 나은 무역 환경을 만들기 위한 경쟁이 있어요.', pages: [107] },
      { text: '수출이 늘어나면 산업이 성장하고 일자리가 늘어나며 사람들의 소득도 증가해요.', pages: [107] },
    ],
  },
];

/** 모든 도감 카드 ID(개념 + 수출국 4유형 + 교실 물건) — 편지 보상 dexCard 가 가리킬 수 있는 대상 */
export const ALL_DEX_CARD_IDS: readonly string[] = [
  ...conceptCards.map((c) => c.id),
  ...exportTypeCards.map((c) => c.id),
  ...classroomItemCards.map((c) => c.id),
];
