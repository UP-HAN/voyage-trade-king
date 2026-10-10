/**
 * 편지·갈매기 퀴즈 문제 은행 (PRD 6.7.4, v0.3.1).
 *
 * - 발신 형식: 'customs' = 관세사 도윤의 편지(개념), 'gullNews' = 갈매기 바다 소식(뉴스형 지문 + 질문).
 *   관세사는 편지로 무역 지식을 알려 주는 전문가다(관세를 깎아 주는 사람이 아님, p.110).
 * - 모든 문항에 해설(explain)과 교과서 쪽(pages). 지문이 지어낸 상황이면 fake: true("가상 뉴스" 띠).
 * - choice3 의 answer 는 정답 보기 번호(0부터), ox 의 answer 는 'O' | 'X'.
 *
 * 은행 크기 규칙(v0.3.1):
 * - 한 판의 편지는 최대 10통(난이도 순환 easy, normal → 난이도별 최대 5통). 차시 한 판(4.1.1)은 한 구간만 쓰므로
 *   **구간마다 (구간 고유 문항 + common 문항)이 난이도별 5문항 이상**이어야 한 학생에게 같은 문제가 다시 나오지 않는다.
 * - L1 은 구간 고유 문항만으로 난이도별 5 이상·합계 10 이상(P0). L2~L4 고유 문항은 작업 115~117이 보강한다.
 * - 구간 고유 문항이 모자라면 `common: true` 문항(구간을 가리지 않는 무역 기초)으로 채운다 → `letterBank()`.
 *   그래도 모자라면 스케줄러(작업 123)가 편지 수를 은행 크기로 줄이고 경고한다.
 * `npm run check:data`가 이 크기를 검사한다(L1 부족 = 오류, L2~L4 부족 = 경고).
 */
import type { Difficulty, LessonId, LetterQuestion } from './types';

type Q = Omit<LetterQuestion, 'common'>;

const C = (q: Omit<Q, 'lesson'>): LetterQuestion => ({ ...q, lesson: 'common', common: true });
const L = (q: Q): LetterQuestion => ({ ...q, common: false });

/** 구간을 가리지 않는 무역 기초 문항(6문항: 쉬움 3 · 보통 3) */
const COMMON: readonly LetterQuestion[] = [
  C({
    id: 'C-01', format: 'customs', type: 'choice3', difficulty: 'easy', topic: '무역의 뜻',
    prompt: '나라와 나라 사이에 물자나 서비스를 사고팔거나 교환하는 일을 무엇이라고 할까요?',
    choices: ['무역', '관세', '박람회'], answer: 0,
    explain: '나라와 나라 사이에서 물자나 서비스를 사고팔거나 교환하는 활동을 무역이라고 해요. (교과서 96쪽)',
    pages: [96], fake: false, dexCard: 'trade-def',
  }),
  C({
    id: 'C-02', format: 'customs', type: 'ox', difficulty: 'easy', topic: '수입의 뜻',
    prompt: '다른 나라에서 물자나 서비스를 사 오는 것을 수출이라고 해요.',
    answer: 'X',
    explain: '다른 나라에서 물자나 서비스를 사 오는 것은 수입, 다른 나라에 물자나 서비스를 파는 것은 수출이에요. (교과서 96쪽)',
    pages: [96], fake: false, dexCard: 'trade-def',
  }),
  C({
    id: 'C-03', format: 'customs', type: 'ox', difficulty: 'easy', topic: '관세의 뜻',
    prompt: '관세는 다른 나라에서 수입하는 상품에 부과하는 세금이에요.',
    answer: 'O',
    explain: '관세는 다른 나라에서 수입하는 상품에 부과하는 세금이에요. (교과서 108쪽)',
    pages: [108], fake: false, dexCard: 'tariff',
  }),
  C({
    id: 'C-04', format: 'gullNews', type: 'choice3', difficulty: 'normal', topic: '물자와 서비스',
    passage: '바다 건너 미국의 온라인 동영상 서비스가 우리나라에서 인기예요. 이 서비스는 배에 싣지 않고 인터넷으로 들어왔대요.',
    prompt: '이 서비스를 다른 나라에서 사 온 것도 무역일까요?',
    choices: ['물자만 사고팔아야 무역이라 무역이 아니에요', '서비스를 사고팔아도 무역이에요', '배로 옮겨야만 무역이에요'], answer: 1,
    explain: '나라와 나라 사이에 물자나 서비스를 사고팔거나 교환하는 일을 무역이라고 해요(96쪽). 우리나라는 미국에서 온라인 동영상 서비스를 수입해요(103쪽).',
    pages: [96, 103], fake: true, dexCard: 'goods-services',
  }),
  C({
    id: 'C-05', format: 'customs', type: 'choice3', difficulty: 'normal', topic: '물자의 뜻',
    prompt: "'물자'의 뜻으로 알맞은 것은 무엇일까요?",
    choices: ['어떤 활동에 필요한 물건이나 물건을 만드는 데 필요한 원료', '다른 나라에 상품을 파는 일', '선박이 지나다니는 바다 위의 길'], answer: 0,
    explain: '물자는 어떤 활동에 필요한 물건이나 물건을 만드는 데 필요한 원료예요(96쪽). 선박이 지나다니는 바다 위의 길은 항로예요(104쪽).',
    pages: [96, 104], fake: false, dexCard: 'goods-services',
  }),
  C({
    id: 'C-06', format: 'gullNews', type: 'choice3', difficulty: 'normal', topic: '수출의 뜻',
    passage: '우리 회사가 부산에서 실은 자동차를 타이 방콕 항구에 팔았어요.',
    prompt: '이 거래는 우리나라 입장에서 무엇일까요?',
    choices: ['수입', '수출', '관세'], answer: 1,
    explain: '다른 나라에 물자나 서비스를 파는 것을 수출이라고 해요(96쪽). 자동차는 우리나라의 주요 수출품이에요(100쪽).',
    pages: [96, 100], fake: true, dexCard: 'trade-def',
  }),
];

/** L1: 무역·수입·수출 뜻, 벽란도, 물자와 서비스, 무역이 필요한 까닭, 두 섬, 흑연, 관세 뜻(기초는 common C-03) — 12문항(6·6) */
const L1: readonly LetterQuestion[] = [
  L({
    id: 'L1-01', lesson: 'L1', format: 'customs', type: 'choice3', difficulty: 'easy', topic: '벽란도',
    prompt: '고려 시대 벽란도에서 다른 나라 상인들이 가져와서 판 물건은 무엇일까요?',
    choices: ['비단', '인삼', '삼베'], answer: 0,
    explain: '다른 나라에서 온 상인들은 비단, 약재, 서적, 악기, 보석 등을 가져와서 팔고, 고려에서 삼베, 모시, 인삼, 종이 등을 사 갔어요. (교과서 95쪽)',
    pages: [95], fake: false, dexCard: 'byeokrando',
  }),
  L({
    id: 'L1-02', lesson: 'L1', format: 'gullNews', type: 'choice3', difficulty: 'easy', topic: '벽란도',
    passage: '고려의 수도 개경 근처 벽란도에는 가까운 송나라 상인부터 멀리 떨어진 아라비아 상인까지 여러 나라의 상인들이 드나들었어요.',
    prompt: '다른 나라 상인들이 고려에서 사 간 물건은 무엇일까요?',
    choices: ['보석', '인삼', '악기'], answer: 1,
    explain: '다른 나라 상인들은 고려에서 삼베, 모시, 인삼, 종이 등을 사 갔어요. 보석과 악기는 그들이 가져와서 판 물건이에요. (교과서 95쪽)',
    pages: [95], fake: false, dexCard: 'byeokrando',
  }),
  L({
    id: 'L1-03', lesson: 'L1', format: 'customs', type: 'ox', difficulty: 'easy', topic: '수출의 뜻',
    prompt: '고려 입장에서 다른 나라 상인에게 인삼을 판 것은 수출이에요.',
    answer: 'O',
    explain: '다른 나라에 물자나 서비스를 파는 것을 수출이라고 해요(96쪽). 다른 나라 상인들은 고려에서 인삼을 사 갔어요(95쪽).',
    pages: [95, 96], fake: false, dexCard: 'trade-def',
  }),
  L({
    id: 'L1-04', lesson: 'L1', format: 'customs', type: 'choice3', difficulty: 'easy', topic: '무역이 필요한 까닭(자원)',
    prompt: '천연가스를 일부 나라에서만 생산할 수 있는 까닭은 무엇일까요?',
    choices: ['천연가스가 매장되어 있는 곳이 많지 않아서', '천연가스를 만드는 기술이 쉬워서', '천연가스가 쓸모없어서'], answer: 0,
    explain: '천연가스가 매장되어 있는 곳은 많지 않아서 일부 국가에서만 천연가스를 생산할 수 있어요. (교과서 97쪽)',
    pages: [97], fake: false, dexCard: 'trade-need',
  }),
  L({
    id: 'L1-05', lesson: 'L1', format: 'customs', type: 'ox', difficulty: 'easy', topic: '무역이 필요한 까닭(기술)',
    prompt: '비행기를 만드는 데는 수준 높은 기술이 필요해서 일부 국가에서만 비행기를 만들 수 있어요.',
    answer: 'O',
    explain: '비행기를 만드는 데는 수준 높은 기술이 필요해서 일부 국가에서만 비행기를 만들 수 있어요. 그래서 다른 나라와 무역을 해요. (교과서 97쪽)',
    pages: [97], fake: false, dexCard: 'trade-need',
  }),
  L({
    id: 'L1-06', lesson: 'L1', format: 'gullNews', type: 'choice3', difficulty: 'easy', topic: '무역이 필요한 까닭(자원)',
    passage: '부산에 강추위가 찾아왔어요. 집집마다 난방에 쓸 천연가스가 많이 필요하대요.',
    prompt: '천연가스는 어디에 쓰는 자원일까요?',
    choices: ['난방을 하거나 차량을 운행할 때 쓰는 연료', '옷을 만드는 실', '연필심'], answer: 0,
    explain: '천연가스는 난방을 하거나 차량을 운행할 때 연료로 사용하는 자원이에요. (교과서 97쪽)',
    pages: [97], fake: true, dexCard: 'trade-need',
  }),
  L({
    id: 'L1-07', lesson: 'L1', format: 'customs', type: 'choice3', difficulty: 'normal', topic: '무역의 좋은 점',
    prompt: '여러 나라가 각각 효율적으로 생산하는 상품을 수출하고, 생산하기 어려운 상품을 수입하면 어떻게 될까요?',
    choices: ['더 우수한 품질의 상품을 저렴한 가격으로 사용할 수 있어요', '모든 상품을 한 나라에서 혼자 만들어야 해요', '상품 값이 모두 비싸져요'], answer: 0,
    explain: '여러 나라가 각각 효율적으로 생산하는 상품을 수출하고, 효율적으로 생산하기 어려운 상품을 수입하면 더 우수한 품질의 상품을 저렴한 가격으로 사용할 수 있어요. (교과서 99쪽)',
    pages: [99], fake: false, dexCard: 'trade-benefit',
  }),
  L({
    id: 'L1-08', lesson: 'L1', format: 'gullNews', type: 'choice3', difficulty: 'normal', topic: '두 섬(잘하는 것을 수출)',
    passage: '㉯ 나라는 ㉮ 나라에 비해 기술 수준이 낮지만, 쌀을 재배하기에 적합한 환경이에요.',
    prompt: '㉯ 나라가 생산하여 수출할 때 더 유리한 상품은 무엇일까요?',
    choices: ['옷', '쌀', '둘 다 똑같아요'], answer: 1,
    explain: '㉯ 나라는 쌀을 재배하기에 적합한 환경이어서 같은 시간과 비용을 들인다면 옷보다 쌀을 생산하여 수출할 때 더 큰 이익을 얻을 수 있어요. (교과서 98쪽)',
    pages: [98], fake: false, dexCard: 'trade-benefit',
  }),
  L({
    id: 'L1-09', lesson: 'L1', format: 'customs', type: 'choice3', difficulty: 'normal', topic: '무역이 필요한 까닭(차이)',
    prompt: '나라와 나라가 무역을 하는 까닭으로 교과서에 나온 것은 무엇일까요?',
    choices: ['나라마다 자연환경, 자원, 자본, 기술 등에 차이가 있어서', '모든 나라의 자원이 똑같아서', '나라마다 필요한 물건이 하나도 없어서'], answer: 0,
    explain: '나라마다 자연환경, 자원, 자본, 기술 등에 차이가 있어 무역을 해요. (교과서 99쪽)',
    pages: [99], fake: false, dexCard: 'trade-reasons',
  }),
  L({
    id: 'L1-10', lesson: 'L1', format: 'gullNews', type: 'choice3', difficulty: 'normal', topic: '구할 수 있어도 수입(흑연)',
    passage: '과거 우리나라는 세계적인 흑연 생산국이었어요. 그런데 지금은 우리나라에서 흑연을 거의 생산하지 않아요.',
    prompt: '그 까닭은 무엇일까요?',
    choices: ['다른 나라에서 저렴한 가격의 흑연을 수입하면서', '흑연이 전혀 쓸모없어져서', '흑연을 사고파는 것이 금지되어서'], answer: 0,
    explain: '과거 우리나라는 세계적인 흑연 생산국이었지만, 다른 나라에서 저렴한 가격의 흑연을 수입하면서 우리나라에서는 거의 생산하지 않게 됐어요. (교과서 99쪽)',
    pages: [99], fake: false, dexCard: 'graphite',
  }),
  L({
    id: 'L1-11', lesson: 'L1', format: 'customs', type: 'ox', difficulty: 'normal', topic: '흑연',
    prompt: '흑연은 연필을 만드는 데에만 쓰이는 자원이에요.',
    answer: 'X',
    explain: '흑연은 연필뿐만 아니라 스마트폰, 배터리의 원료로 쓰이는 자원이에요. (교과서 99쪽)',
    pages: [99], fake: false, dexCard: 'graphite',
  }),
  L({
    id: 'L1-12', lesson: 'L1', format: 'customs', type: 'ox', difficulty: 'normal', topic: '두 섬(잘하는 것을 수출)',
    prompt: '㉮ 나라는 높은 수준의 기술을 갖추고 있어서, 같은 시간과 비용을 들인다면 쌀보다 옷을 생산하여 수출할 때 더 큰 이익을 얻을 수 있어요.',
    answer: 'O',
    explain: '㉮ 나라는 높은 수준의 기술을 갖추고 있어서 같은 시간과 비용을 들인다면 쌀보다 옷을 생산하여 수출할 때 더 큰 이익을 얻을 수 있어요. 각 나라는 더 잘 생산할 수 있는 것을 수출해요. (교과서 98~99쪽)',
    pages: [98, 99], fake: false, dexCard: 'trade-benefit',
  }),
];

/** L2: 주요 수입품·수출품(p.100), 원료 수입→생산→수출, 수출국 4유형, 싱가포르 위치, 선박 운송, 박람회 — 8문항(4·4) */
const L2: readonly LetterQuestion[] = [
  L({
    id: 'L2-01', lesson: 'L2', format: 'customs', type: 'choice3', difficulty: 'easy', topic: '주요 수입품',
    prompt: '다음 중 우리나라의 주요 수입품은 무엇일까요?',
    choices: ['원유', '반도체', '자동차'], answer: 0,
    explain: '우리나라는 원유, 정밀 화학 원료, 천연가스, 석탄 등을 주로 수입하고, 반도체, 자동차, 무선 통신 기기, 석유 제품 등을 주로 수출해요. (교과서 100쪽)',
    pages: [100], fake: false, dexCard: 'korea-trade',
  }),
  L({
    id: 'L2-02', lesson: 'L2', format: 'customs', type: 'ox', difficulty: 'easy', topic: '주요 수출품',
    prompt: '석유 제품은 우리나라의 주요 수출품이에요.',
    answer: 'O',
    explain: '석유 제품은 원유에 들어 있는 여러 혼합물을 분리하여 만든 휘발유, 경유와 같은 연료 제품이에요. 반도체, 자동차, 무선 통신 기기와 함께 우리나라의 주요 수출품이에요. (교과서 100쪽)',
    pages: [100], fake: false, dexCard: 'korea-trade',
  }),
  L({
    id: 'L2-03', lesson: 'L2', format: 'gullNews', type: 'choice3', difficulty: 'easy', topic: '싱가포르 위치',
    passage: '싱가포르는 서울보다 약간 넓은 면적의 나라로, 유럽과 아시아를 잇는 항로에 자리 잡고 있어요.',
    prompt: '싱가포르에 큰 항구가 발달한 까닭과 관계있는 것은 무엇일까요?',
    choices: ['유럽과 아시아를 잇는 항로에 있는 위치', '넓은 땅에서 나는 많은 농산물', '땅속에 묻힌 풍부한 원유'], answer: 0,
    explain: '싱가포르는 유럽과 아시아를 잇는 항로에 자리 잡고 있어요. 싱가포르 정부는 이곳을 지나는 선박들이 정박할 수 있도록 큰 항구를 만들었어요. (교과서 104쪽)',
    pages: [104], fake: false, dexCard: 'relay',
  }),
  L({
    id: 'L2-04', lesson: 'L2', format: 'customs', type: 'choice3', difficulty: 'easy', topic: '선박 운송',
    prompt: '무역을 할 때 선박을 이용하면 좋은 점은 무엇일까요?',
    choices: ['많은 양의 상품을 안전하고 효율적으로 실어 나를 수 있어요', '상품이 저절로 만들어져요', '관세를 내지 않아도 돼요'], answer: 0,
    explain: '무역을 할 때 선박을 이용하면 많은 양의 상품을 안전하고 효율적으로 실어 나를 수 있어요. (교과서 104쪽)',
    pages: [104], fake: false, dexCard: 'world-ports',
  }),
  L({
    id: 'L2-05', lesson: 'L2', format: 'customs', type: 'choice3', difficulty: 'normal', topic: '원료 수입→생산→수출',
    prompt: '우리나라 무역의 특징으로 알맞은 것은 무엇일까요?',
    choices: ['천연자원을 수입한 후 상품을 생산하여 수출해요', '천연자원을 주로 수출해요', '농산물을 주로 수출해요'], answer: 0,
    explain: '우리나라는 원유, 천연가스, 철광석 등 천연자원이 부족하지만 수입한 자원으로 다양한 상품을 생산할 수 있는 기술이 발달했어요(101쪽). 그래서 천연자원을 수입한 후 상품을 생산하여 수출하는 무역이 발달했어요(104쪽).',
    pages: [101, 104], fake: false, dexCard: 'korea-trade',
  }),
  L({
    id: 'L2-06', lesson: 'L2', format: 'gullNews', type: 'choice3', difficulty: 'normal', topic: '수출국 4유형(농산물)',
    passage: '주요 쌀 수출국을 보면 인도가 40.5%로 가장 많고, 타이 15.3%, 베트남 13.5%가 뒤를 이어요(미국 농무부, 2022.).',
    prompt: '인도처럼 쌀을 많이 수출하는 나라는 수출국 4유형 가운데 어느 유형일까요?',
    choices: ['농산물을 수출하는 나라', '기술로 만든 물자를 수출하는 나라', '문화를 수출하는 나라'], answer: 0,
    explain: '넓은 땅에서 많은 농산물을 생산하거나 풍부한 천연자원을 가지고 있는 나라들은 전 세계에 농산물과 천연자원을 수출해요. (교과서 103쪽)',
    pages: [103], fake: false, dexCard: 'export-agri',
  }),
  L({
    id: 'L2-07', lesson: 'L2', format: 'customs', type: 'ox', difficulty: 'normal', topic: '수출국 4유형(기술)',
    prompt: '독일이 수출하는 백신과 일본이 수출하는 로봇은 뛰어난 기술을 바탕으로 생산한 물자예요.',
    answer: 'O',
    explain: '뛰어난 기술을 바탕으로 생산한 물자나 서비스를 수출하는 나라들도 있어요. 독일은 백신을, 일본은 로봇을 수출해요. (교과서 103쪽)',
    pages: [103], fake: false, dexCard: 'export-tech',
  }),
  L({
    id: 'L2-08', lesson: 'L2', format: 'gullNews', type: 'choice3', difficulty: 'normal', topic: '박람회',
    passage: '박람회는 일정한 기간과 장소를 정해 놓고 다양한 물품을 전시하는 행사예요. 판매자가 직접 홍보관을 운영해요.',
    prompt: '박람회에서 판매자와 소비자가 할 수 있는 일은 무엇일까요?',
    choices: ['상품에 관해 궁금한 것을 직접 묻고 답해요', '상품을 전혀 볼 수 없어요', '나라의 관세를 정해요'], answer: 0,
    explain: '박람회에서는 판매자와 소비자가 해당 상품에 관해 궁금한 것을 직접 묻고 답할 수 있어요. 관심 있는 상품을 현장에서 직접 구매하거나 나중에 구매할 것을 약속할 수도 있어요. (교과서 105쪽)',
    pages: [105], fake: false, dexCard: 'expo',
  }),
];

/** L3: 스마트폰 상호 의존, 인도네시아 협력, 수출 증가와 일자리, 경쟁 3종, 생성형 인공지능 — 8문항(4·4) */
const L3: readonly LetterQuestion[] = [
  L({
    id: 'L3-01', lesson: 'L3', format: 'customs', type: 'choice3', difficulty: 'easy', topic: '스마트폰 상호 의존',
    prompt: '무역이 활발해지면서 여러 나라의 우수한 물자를 한데 모아 무엇을 하기도 할까요?',
    choices: ['새로운 제품을 생산해요', '무역을 멈춰요', '항구를 닫아요'], answer: 0,
    explain: '무역이 활발해지면서 여러 나라의 우수한 물자를 한데 모아서 새로운 제품을 생산하기도 해요. 스마트폰은 전 세계 무역의 결과로 만들어져요. (교과서 106쪽)',
    pages: [106], fake: false, dexCard: 'interdependence',
  }),
  L({
    id: 'L3-02', lesson: 'L3', format: 'gullNews', type: 'choice3', difficulty: 'easy', topic: '인도네시아 협력',
    passage: '인도네시아는 니켈, 주석 등 광물 매장량이 풍부한 국가로, 우리나라는 인도네시아와 협력을 함으로써 더 안정적인 자원 확보가 가능할 것으로 보인다.',
    source: '『전자 신문』, 2023. 11. 28.',
    prompt: '이 협력으로 우리나라가 기대하는 이익은 무엇일까요?',
    choices: ['더 안정적인 자원 확보', '광물 탐사 기술을 쓰지 못하게 됨', '관세가 높아짐'], answer: 0,
    explain: '기사에 따르면 우리나라는 인도네시아와 협력을 함으로써 더 안정적인 자원 확보가 가능할 것으로 보여요. (교과서 106쪽)',
    pages: [106], fake: false, dexCard: 'interdependence',
  }),
  L({
    id: 'L3-03', lesson: 'L3', format: 'gullNews', type: 'ox', difficulty: 'easy', topic: '생성형 인공지능',
    passage: '전 세계 생성형 인공지능 시장은 2023년 약 37억 달러에서 2028년 약 363억 달러로 커질 것으로 전망돼요(S&P 글로벌 마켓 인텔리전트, 2023.).',
    prompt: '생성형 인공지능 시장은 앞으로 작아질 것으로 전망돼요.',
    answer: 'X',
    explain: '전 세계 생성형 인공지능 시장은 크게 커질 것으로 전망되고, 더 나은 품질의 생성형 인공지능 제품을 개발해서 수출하기 위한 각 나라의 경쟁이 치열해지고 있어요. (교과서 107쪽)',
    pages: [107], fake: false, dexCard: 'competition-tech',
  }),
  L({
    id: 'L3-04', lesson: 'L3', format: 'customs', type: 'choice3', difficulty: 'easy', topic: '경쟁 3종(무역 환경)',
    prompt: '부산항이 자동화 항만 시스템을 갖춘 것은 어떤 경쟁의 예일까요?',
    choices: ['더 나은 무역 환경을 만들기 위한 경쟁', '다른 나라에 필요한 시설을 건설하기 위한 경쟁', '농산물을 더 많이 생산하기 위한 경쟁'], answer: 0,
    explain: '세계 여러 나라는 자동화 항만 시스템을 도입하며 우수한 무역 환경을 갖추려고 경쟁해요. 부산항은 자동화 항만 시스템을 구축했어요. (교과서 107쪽)',
    pages: [107], fake: false, dexCard: 'competition-env',
  }),
  L({
    id: 'L3-05', lesson: 'L3', format: 'gullNews', type: 'choice3', difficulty: 'normal', topic: '인도네시아 협력(상호 의존)',
    passage: '인도네시아는 우리나라의 뛰어난 광물 탐사 기술을 활용하여 효율적으로 자원을 개발할 수 있을 것으로 기대하고 있다.',
    source: '『전자 신문』, 2023. 11. 28.',
    prompt: '이 기사처럼 여러 나라가 잘하는 분야로 협력하며 서로 기대는 관계를 무엇이라고 할까요?',
    choices: ['상호 의존', '관세', '수입 제한'], answer: 0,
    explain: '여러 나라가 각자 잘하는 분야를 중심으로 협력하여 사업을 진행하기도 해요. 이렇게 무역을 통해 서로 기대는 관계를 상호 의존이라고 해요. (교과서 106쪽)',
    pages: [106], fake: false, dexCard: 'interdependence',
  }),
  L({
    id: 'L3-06', lesson: 'L3', format: 'customs', type: 'choice3', difficulty: 'normal', topic: '경쟁 3종(첨단 기술)',
    prompt: '더 좋은 생성형 인공지능 제품을 개발해서 수출하려는 각 나라의 경쟁은 무엇일까요?',
    choices: ['첨단 기술을 개발하기 위한 경쟁', '더 나은 무역 환경을 만들기 위한 경쟁', '다른 나라에 필요한 시설을 건설하기 위한 경쟁'], answer: 0,
    explain: '더 나은 품질의 생성형 인공지능 제품을 개발해서 세계 여러 나라에 수출하기 위한 각 나라의 경쟁이 치열해지고 있어요. 이것은 첨단 기술을 개발하기 위한 경쟁이에요. (교과서 107쪽)',
    pages: [107], fake: false, dexCard: 'competition-tech',
  }),
  L({
    id: 'L3-07', lesson: 'L3', format: 'gullNews', type: 'choice3', difficulty: 'normal', topic: '경쟁 3종(시설 건설)',
    passage: '우리나라 기업이 다른 나라의 철도를 짓는 공사를 맡으려고 여러 나라 기업과 겨루고 있어요.',
    prompt: '이것은 어떤 경쟁일까요?',
    choices: ['다른 나라에 필요한 시설을 건설하기 위한 경쟁', '첨단 기술을 개발하기 위한 경쟁', '더 나은 무역 환경을 만들기 위한 경쟁'], answer: 0,
    explain: '철도, 도로, 발전소 등 다른 나라의 주요 시설을 건설하기 위한 세계 여러 나라의 경쟁이 치열해요. 우리나라 기업이 건설한 인도의 다리도 있어요. (교과서 107쪽)',
    pages: [107], fake: true, dexCard: 'competition-facility',
  }),
  L({
    id: 'L3-08', lesson: 'L3', format: 'customs', type: 'choice3', difficulty: 'normal', topic: '수출 증가와 일자리',
    prompt: '수출이 늘어날 때 일어나는 일의 순서로 알맞은 것은 무엇일까요?',
    choices: ['산업 성장 → 일자리 증가 → 소득 증가', '소득 감소 → 일자리 감소 → 산업 성장', '일자리 감소 → 산업 성장 → 소득 증가'], answer: 0,
    explain: '수출이 늘어나면 더 많은 물자나 서비스를 생산해야 하므로 산업이 성장해요. 이에 따라 일자리가 늘어나고 사람들의 소득도 증가하게 돼요. (교과서 107쪽)',
    pages: [107], fake: false, dexCard: 'export-growth',
  }),
];

/** L4: 관세 뜻, 수입 증가의 좋은 점·문제점, 1970년대 철강, 베트남 이전 까닭, 해외 생산의 문제점, 관세사 — 6문항(3·3) */
const L4: readonly LetterQuestion[] = [
  L({
    id: 'L4-01', lesson: 'L4', format: 'customs', type: 'ox', difficulty: 'easy', topic: '수입 증가의 좋은 점',
    prompt: '수입이 늘어나면 국내에서 얻기 힘든 물자나 서비스를 이용할 수 있어 생활이 풍족해져요.',
    answer: 'O',
    explain: '수입이 늘어나면 국내에서 얻기 힘든 물자나 서비스를 이용할 수 있어 사람들의 생활이 풍족해져요. (교과서 108쪽)',
    pages: [108], fake: false, dexCard: 'import-pros-cons',
  }),
  L({
    id: 'L4-02', lesson: 'L4', format: 'customs', type: 'choice3', difficulty: 'easy', topic: '관세사',
    prompt: '관세사가 하는 일로 알맞은 것은 무엇일까요?',
    choices: ['수출입과 관련한 법 지식을 바탕으로 원활한 무역 활동을 도와요', '나라의 관세율을 정해요', '배를 몰고 바다를 건너요'], answer: 0,
    explain: '관세사는 수출입과 관련한 법 지식을 바탕으로 개인이나 기업이 원활하게 무역 활동을 할 수 있도록 도와요. 법에 정해진 규정에 따라 나라에 수출입 물품을 신고해요. (교과서 110쪽)',
    pages: [110], fake: false, dexCard: 'customs-broker',
  }),
  L({
    id: 'L4-03', lesson: 'L4', format: 'gullNews', type: 'choice3', difficulty: 'easy', topic: '베트남 이전 까닭',
    passage: '베트남으로 생산 시설을 옮기는 외국 기업이 늘어나고 있다. 외국 기업이 베트남으로 생산 시설을 옮기는 주된 이유는 저렴한 노동력 때문이다.',
    source: '『한국 무역 신문』, 2022. 12. 11.',
    prompt: '기사에서 말한, 외국 기업이 베트남으로 생산 시설을 옮기는 주된 이유는 무엇일까요?',
    choices: ['저렴한 노동력', '눈이 많이 오는 날씨', '비싼 땅값'], answer: 0,
    explain: '기사에 따르면 주된 이유는 저렴한 노동력이에요. 중국과 국경을 맞댄 지리적 위치, 낮은 관세를 약속한 나라가 많다는 점도 유리한 점이에요. (교과서 109쪽)',
    pages: [109], fake: false, dexCard: 'overseas-production',
  }),
  L({
    id: 'L4-04', lesson: 'L4', format: 'customs', type: 'choice3', difficulty: 'normal', topic: '1970년대 철강',
    prompt: '1970년대 우리나라가 수입 철강 제품에 높은 관세를 부과한 결과는 무엇일까요?',
    choices: ['국내에서 생산한 철강 제품이 더 높은 경쟁력을 갖췄어요', '우리나라 철강 산업이 사라졌어요', '철강 제품을 전혀 쓰지 않게 됐어요'], answer: 0,
    explain: '1970년대 우리나라는 수입 철강 제품에 높은 관세를 부과했어요. 그 결과 국내에서 생산한 철강 제품이 더 높은 경쟁력을 갖출 수 있었고, 오늘날 세계적인 철강 산업 국가로 성장했어요. (교과서 108쪽)',
    pages: [108], fake: false, dexCard: 'steel-1970',
  }),
  L({
    id: 'L4-05', lesson: 'L4', format: 'customs', type: 'ox', difficulty: 'normal', topic: '해외 생산의 문제점',
    prompt: '한 기업이 여러 나라에서 생산 시설을 운영하면 근로자들이 정당한 임금을 받지 못하거나 환경 오염 같은 문제가 생기기도 해요.',
    answer: 'O',
    explain: '기업이 얻는 이익에 비해 근로자들이 정당한 임금을 받지 못하거나, 생산 과정에서 환경 오염과 같은 문제가 발생하기도 해요. (교과서 109쪽)',
    pages: [109], fake: false, dexCard: 'overseas-production',
  }),
  L({
    id: 'L4-06', lesson: 'L4', format: 'gullNews', type: 'choice3', difficulty: 'normal', topic: '관세 뜻(수입 제한)',
    passage: '어느 나라에 다른 나라의 값싼 상품이 많이 들어와서 그 나라 회사들이 어려움을 겪고 있대요.',
    prompt: '나라들이 국내 산업을 보호하고 성장시키기 위해 하는 일은 무엇일까요?',
    choices: ['수입품에 높은 관세를 부과하거나 수입을 제한해요', '모든 수출을 멈춰요', '항구를 없애요'], answer: 0,
    explain: '세계 여러 나라는 국내 산업을 보호하고 성장시키기 위해 수입품에 높은 관세를 부과하거나 일정한 양 이하로 수입을 제한하기도 해요. (교과서 108쪽)',
    pages: [108], fake: true, dexCard: 'import-pros-cons',
  }),
];

/** 전체 은행(구간 고유 + common) */
export const letters: readonly LetterQuestion[] = [...COMMON, ...L1, ...L2, ...L3, ...L4];

export const lettersById: Readonly<Record<string, LetterQuestion>> = Object.fromEntries(letters.map((q) => [q.id, q]));

/** 구간 고유 문항(common 제외) */
export function stageLetters(lesson: LessonId, difficulty?: Difficulty): LetterQuestion[] {
  return letters.filter((q) => q.lesson === lesson && (!difficulty || q.difficulty === difficulty));
}

/** common 문항 */
export function commonLetters(difficulty?: Difficulty): LetterQuestion[] {
  return letters.filter((q) => q.common && (!difficulty || q.difficulty === difficulty));
}

/**
 * 그 구간 슬롯이 쓰는 은행: 구간 고유 문항을 먼저, 그 뒤에 common 문항을 붙인다(고유 문항이 모자랄 때 채우는 규칙).
 * 학생별 회전 순서·중복 방지(answeredLetterIds)는 core(작업 103·112)가 이 순서 위에서 정한다.
 */
export function letterBank(lesson: LessonId, difficulty: Difficulty): LetterQuestion[] {
  return [...stageLetters(lesson, difficulty), ...commonLetters(difficulty)];
}
