/**
 * 상품 21종 (PRD 6.4.1).
 * - V(기준값, 만 원/상자)와 '살 수 있는 곳'은 모두 [게임 설정](튜닝 대상)이다.
 * - `desc`는 교과서 문장에 근거한 설명이고 쪽수를 단다.
 * - 석탄(p.100 수입품)은 게임 상품이 아니다(교과서 그림·세관 게시판 비교 카드에서만 언급).
 * - 서비스(form 'service')는 배에 싣지 않는다(적재 0).
 */
import type { Good, GoodId, LessonId } from './types';

const img = (id: GoodId) => `goods/${id}.png`;

export const goods: readonly Good[] = [
  {
    id: 'crude', name: '원유', category: '천연자원', form: 'goods', V: 60,
    specialtyPorts: ['DAM', 'LAX'], factoryOnly: false, pages: [100, 103], unlockLesson: 'L2',
    desc: { text: '원유는 불순물을 없애지 않은 자연 상태의 석유예요. 우리나라는 원유를 주로 수입해요.', pages: [100] },
    gameRule: false, image: img('crude'),
  },
  {
    id: 'gas', name: '천연가스', category: '천연자원', form: 'goods', V: 50,
    specialtyPorts: ['PHE', 'LAX'], factoryOnly: false, pages: [97, 100], unlockLesson: 'L1',
    desc: { text: '천연가스는 난방을 하거나 차량을 운행할 때 연료로 사용하는 자원이에요. 매장되어 있는 곳이 많지 않아 일부 국가에서만 생산할 수 있어요.', pages: [97] },
    gameRule: true, gameRuleNote: '판매 항구(포트헤들랜드·로스앤젤레스)는 게임 설정이에요.', image: img('gas'),
  },
  {
    id: 'iron', name: '철광석', category: '천연자원', form: 'goods', V: 30,
    specialtyPorts: ['PHE'], factoryOnly: false, pages: [94, 101], unlockLesson: 'L1',
    desc: { text: '우리나라는 원유, 천연가스, 철광석 등 산업 발달에 필요한 천연자원이 부족해요.', pages: [101] },
    gameRule: false, image: img('iron'),
  },
  {
    id: 'nickel', name: '니켈', category: '천연자원', form: 'goods', V: 60,
    specialtyPorts: ['JKT'], factoryOnly: false, pages: [106], unlockLesson: 'L2',
    desc: { text: '인도네시아는 니켈, 주석 등 광물 매장량이 풍부한 나라예요.', pages: [106] },
    gameRule: false, image: img('nickel'),
  },
  {
    id: 'graphite', name: '흑연', category: '천연자원', form: 'goods', V: 40,
    specialtyPorts: ['SHA'], factoryOnly: false, pages: [99], unlockLesson: 'L1',
    desc: { text: '흑연은 연필뿐만 아니라 스마트폰, 배터리의 원료로 쓰이는 자원이에요.', pages: [99] },
    gameRule: true, gameRuleNote: '판매 항구(상하이는 싸게, 부산은 국내산으로 비싸게)는 게임 설정이에요.', image: img('graphite'),
  },
  {
    id: 'chem', name: '정밀 화학 원료', category: '원료', form: 'goods', V: 60,
    specialtyPorts: ['YOK', 'ROT'], factoryOnly: false, pages: [100], unlockLesson: 'L1',
    desc: { text: '정밀 화학 원료는 비료, 의약품, 배터리 등 다양한 화학 제품을 만드는 데 필요한 기초적인 원료예요.', pages: [100] },
    gameRule: true, gameRuleNote: '판매 항구(요코하마·로테르담)는 게임 설정이에요.', image: img('chem'),
  },
  {
    id: 'rice', name: '쌀', category: '농산물', form: 'goods', V: 20,
    specialtyPorts: ['MUM', 'BKK', 'HCM'], factoryOnly: false, pages: [103], unlockLesson: 'L1',
    desc: { text: '인도, 타이, 베트남은 쌀을 많이 수출하는 나라예요(미국 농무부, 2022.).', pages: [103] },
    gameRule: false, image: img('rice'),
  },
  {
    id: 'wood', name: '목재', category: '천연자원', form: 'goods', V: 20,
    specialtyPorts: ['JKT'], factoryOnly: false, pages: [94], unlockLesson: 'L2',
    desc: { text: '교실 출입문은 인도네시아에서 자란 나무로 만들기도 해요.', pages: [94] },
    gameRule: false, image: img('wood'),
  },
  {
    id: 'clothes', name: '의류', category: '공업 제품', form: 'goods', V: 30,
    specialtyPorts: ['HCM', 'SHA'], factoryOnly: false, pages: [94, 109], unlockLesson: 'L1',
    desc: { text: '우리가 입는 옷 가운데에는 베트남에서 만든 옷도 있어요.', pages: [94] },
    gameRule: true, gameRuleNote: '상하이 판매는 게임 설정이에요(교과서 근거는 베트남에서 만든 옷).', image: img('clothes'),
  },
  {
    id: 'robot', name: '로봇', category: '첨단 제품', form: 'goods', V: 200,
    specialtyPorts: ['YOK'], factoryOnly: false, pages: [103], unlockLesson: 'L1',
    desc: { text: '일본은 뛰어난 기술을 바탕으로 만든 로봇을 수출해요.', pages: [103] },
    gameRule: false, image: img('robot'),
  },
  {
    id: 'vaccine', name: '백신', category: '첨단 제품', form: 'goods', V: 150,
    specialtyPorts: ['ROT'], factoryOnly: false, pages: [103], unlockLesson: 'L2',
    desc: { text: '독일은 뛰어난 기술을 바탕으로 만든 백신을 수출해요.', pages: [103] },
    gameRule: true, gameRuleNote: '교과서는 독일의 수출품이에요. 게임에서는 유럽 상품을 로테르담에서 거래해요.', image: img('vaccine'),
  },
  {
    id: 'ott', name: '온라인 동영상 서비스', category: '문화 서비스', form: 'service', V: 100,
    specialtyPorts: ['LAX'], factoryOnly: false, pages: [103], unlockLesson: 'L2',
    desc: { text: '우리나라는 미국에서 온라인 동영상 서비스를 수입해요.', pages: [103] },
    gameRule: false, image: img('ott'),
  },
  {
    id: 'program', name: '프로그램(소프트웨어)', category: '서비스', form: 'service', V: 100,
    specialtyPorts: ['LAX'], factoryOnly: false, pages: [94], unlockLesson: 'L2',
    desc: { text: '교실에서 쓰는 태블릿은 미국에서 만든 프로그램을 사용하기도 해요.', pages: [94] },
    gameRule: false, image: img('program'),
  },
  {
    id: 'chip', name: '반도체', category: '우리나라 상품', form: 'goods', V: 150,
    specialtyPorts: ['BUS'], factoryOnly: false, pages: [100], unlockLesson: 'L1',
    desc: { text: '반도체는 우리나라의 주요 수출품이에요.', pages: [100] },
    gameRule: false, image: img('chip'),
  },
  {
    id: 'car', name: '자동차', category: '우리나라 상품', form: 'goods', V: 200,
    specialtyPorts: ['BUS'], factoryOnly: false, pages: [100], unlockLesson: 'L1',
    desc: { text: '자동차는 우리나라의 주요 수출품이에요.', pages: [100] },
    gameRule: false, image: img('car'),
  },
  {
    id: 'phone', name: '무선 통신 기기', category: '우리나라 상품', form: 'goods', V: 120,
    specialtyPorts: ['BUS'], factoryOnly: false, pages: [100, 106], unlockLesson: 'L1',
    desc: { text: '무선 통신 기기는 우리나라의 주요 수출품이에요.', pages: [100] },
    gameRule: false, image: img('phone'),
  },
  {
    id: 'kcon', name: 'K-콘텐츠(드라마·예능)', category: '우리나라 문화 서비스', form: 'service', V: 80,
    specialtyPorts: ['BUS'], factoryOnly: false, pages: [96, 103], unlockLesson: 'L1',
    desc: { text: '전 세계 사람들은 다른 나라에서 수입한 영화, 드라마, 음악 등 다양한 문화 상품을 즐겨요.', pages: [103] },
    gameRule: false, image: img('kcon'),
  },
  {
    id: 'oilp', name: '석유 제품', category: '우리나라 상품', form: 'goods', V: 100,
    specialtyPorts: [], factoryOnly: true, pages: [100], unlockLesson: 'L2',
    desc: { text: '석유 제품은 원유에 들어 있는 여러 혼합물을 분리하여 만든 휘발유, 경유와 같은 연료 제품이에요. 우리나라의 주요 수출품이에요.', pages: [100] },
    gameRule: false, image: img('oilp'),
  },
  {
    id: 'steel', name: '철강', category: '우리나라 상품', form: 'goods', V: 90,
    specialtyPorts: [], factoryOnly: true, pages: [108], unlockLesson: 'L2',
    desc: { text: '철광석을 가공하여 만드는 철강 제품은 건축, 자동차, 가전, 선박 등 다양한 산업의 기초 소재로 쓰여요.', pages: [108] },
    gameRule: false, image: img('steel'),
  },
  {
    id: 'battery', name: '배터리', category: '우리나라 상품', form: 'goods', V: 250,
    specialtyPorts: [], factoryOnly: true, pages: [99], unlockLesson: 'L2',
    desc: { text: '우리나라는 수입한 흑연으로 전기차 배터리를 만들어 수출해요.', pages: [99] },
    gameRule: false, image: img('battery'),
  },
  {
    id: 'aichip', name: 'AI 반도체', category: '우리나라 상품', form: 'goods', V: 400,
    specialtyPorts: [], factoryOnly: true, pages: [107], unlockLesson: 'L3',
    desc: { text: '더 나은 품질의 생성형 인공지능 제품을 개발해서 세계 여러 나라에 수출하기 위한 각 나라의 경쟁이 치열해지고 있어요.', pages: [107] },
    gameRule: true, gameRuleNote: 'AI 반도체 상품과 기술 경쟁 상위 학생만 만들 수 있는 규칙은 게임 설정이에요.', image: img('aichip'),
  },
];

export const goodsById: Readonly<Record<GoodId, Good>> = Object.fromEntries(
  goods.map((g) => [g.id, g]),
) as Record<GoodId, Good>;

export const GOOD_IDS: readonly GoodId[] = goods.map((g) => g.id);

const LESSON_ORDER: Record<LessonId, number> = { L1: 1, L2: 2, L3: 3, L4: 4 };

/** 그 구간까지 공개된 상품(구간 진행 순서 기준) */
export function goodsUnlockedBy(lesson: LessonId): GoodId[] {
  return goods.filter((g) => LESSON_ORDER[g.unlockLesson] <= LESSON_ORDER[lesson]).map((g) => g.id);
}

/** L1 공개 11종(PRD 6.4.1) */
export const L1_GOODS: readonly GoodId[] = goodsUnlockedBy('L1');

/** 서비스 상품 규칙 [게임 설정 + p.96, 103] */
export const serviceRules = {
  /** 한 라운드에 한 종류당 최대 계약 수 */
  maxContractsPerRound: 5,
  /** 산 항구가 아닌 다른 항구에서만 팔 수 있다 */
  sellOnlyAtOtherPort: true,
  tooltip: '서비스는 배에 싣지 않아요. 인터넷이나 계약으로 사고팔아요.',
  pages: [96, 103] as const,
  gameRule: true,
} as const;
