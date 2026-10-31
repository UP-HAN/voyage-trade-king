/**
 * 사건 데이터 (PRD 6.11.4 스키마 + v0.3 배치 필드, 4.3.2 활동 등급표).
 *
 * ID 체계(v0.3):
 * - 구간 표지: `L1-COVER`, `L2-E1`(v0.2 '차시 표지'를 그대로 표지로 씀), `L3-COVER`, `L4-COVER` — tier 1, 0.3분.
 * - 준비 단계: `L1-E0`(입장), `L1-E3`(회사 설립) — tier 'prep'. lessons 큐가 아니라 schedule.prepQueue 에 있다.
 * - 마무리 단계: `L4-E6`(컨테이너 OX), `L4-E7`(결산·시상), `L4-E8`(잡지 표지), `L4-E9`(되돌아보기) — tier 'wrap'.
 *   schedule.wrapQueue 와 wrapupByUnit 이 쓴다.
 * - `L4-E5`(v0.2 '마지막 항해')는 사건이 아니라 L4 구간의 마지막 라운드이므로 이 목록에서 뺐다.
 *
 * `required`는 PRD 6.11.2(v0.3) "'필수'는 '1등급'으로 읽는다"에 따라 1등급·준비 사건과 마무리 필수 사건만 true
 * (건너뛰기 확인 창 대상). 2·3등급과 잡지 표지(선택)는 false.
 *
 * L1 사건은 모든 필드를 채웠다. L2~L4 는 배치 필드까지 채운 골격이며 본문은 'TODO'(작업 115~117이 채움).
 * 단, 마무리 L4-E7(결산·시상)·L4-E9(되돌아보기)는 차시 한 판 L1의 마무리에도 쓰이므로 본문을 채웠다(작업 114).
 */
import type { GameEvent, LessonId } from './types';

/** L2~L4 골격의 기본값 */
function skeleton(e: Pick<GameEvent, 'id' | 'lesson' | 'kind' | 'required' | 'title' | 'pages' | 'worksheetAfter' | 'tier' | 'blocking' | 'minutes' | 'shortForm' | 'needsRounds' | 'anchor'> & Partial<GameEvent>): GameEvent {
  return {
    trigger: { type: 'teacher' },
    fake: false,
    gameRule: false,
    body: 'TODO',
    textbook: [],
    effects: [],
    goal: null,
    needsResponse: false,
    catchUp: 'summary',
    ...e,
  };
}

const L1_EVENTS: readonly GameEvent[] = [
  {
    id: 'L1-E0', lesson: 'L1', kind: 'screen', required: true, trigger: { type: 'prep' }, fake: false, gameRule: true,
    title: '입장',
    body: '공용 화면의 방 코드를 보고 들어와요. 방 코드와 출석번호, 회사 이름을 입력해요.',
    textbook: [], pages: [], effects: [], goal: null,
    needsResponse: false, catchUp: 'none', worksheetAfter: null,
    teacherPrompts: ['수업 시작 전 쉬는 시간에 미리 입장하게 하면 좋아요.'],
    tier: 'prep', blocking: false, minutes: { full: 0, short: null }, shortForm: null, needsRounds: 0, anchor: 'afterPrev',
  },
  {
    id: 'L1-E3', lesson: 'L1', kind: 'decision', required: true, trigger: { type: 'prep' }, fake: false, gameRule: true,
    title: '회사 설립',
    body: '깃발 색과 문양, 선장을 골라 우리 회사를 세워요. 회사 이름은 들어올 때 정했어요.',
    textbook: [], pages: [], effects: [{ type: 'companySetup' }], goal: { type: 'complete', ref: 'companySetup' },
    needsResponse: true, catchUp: 'replay', worksheetAfter: null,
    tier: 'prep', blocking: false, minutes: { full: 0, short: null }, shortForm: null, needsRounds: 0, anchor: 'afterPrev',
  },
  {
    id: 'L1-COVER', lesson: 'L1', kind: 'screen', required: true, trigger: { type: 'lessonStart' }, fake: false, gameRule: false,
    title: 'L1. 물건은 어디에서 왔을까? 왜 무역을 할까?',
    body: '교실에 있는 물건들은 어디에서 왔을까요? 부산항에서 우리 회사의 첫 항해를 시작해요.',
    textbook: [{ pages: [94], note: '교실에 있는 여러 물건과 재료의 생산지가 다양한 까닭은 무엇일까요?' }],
    pages: [94], effects: [{ type: 'unlock', ports: ['BUS', 'SHA', 'YOK', 'HCM', 'BKK', 'PHE'], features: ['market'] }], goal: null,
    needsResponse: false, catchUp: 'summary', worksheetAfter: null, image: 'lessons/l1.png',
    tier: 1, blocking: true, minutes: { full: 0.3, short: 0.3 }, shortForm: null, needsRounds: 0, anchor: 'afterPrev', isCover: true,
  },
  {
    id: 'L1-E1', lesson: 'L1', kind: 'minigame', required: false, trigger: { type: 'teacher' }, fake: false, gameRule: false,
    title: '벽란도 시장',
    body: '고려 시대 벽란도 항구에 여러 나라 상인들이 모였어요. 상인 카드를 "다른 나라 상인이 판 물건"과 "사 간 물건"으로 나눠 보세요. 맞힌 카드마다 시작 자금 보너스를 받아요.',
    textbook: [{ pages: [95], note: '다른 나라에서 온 상인들은 비단, 약재, 서적, 악기, 보석 등을 가져와서 팔고, 고려에서 삼베, 모시, 인삼, 종이 등을 사 갔습니다.' }],
    pages: [95, 96],
    effects: [
      { type: 'minigame', ref: 'byeokrando' },
      { type: 'moneyPerCorrect', amount: 20, max: 180, shortAmount: 36 },
      { type: 'dexCard', card: 'byeokrando' },
    ],
    goal: { type: 'complete', ref: 'byeokrando' },
    needsResponse: true, catchUp: 'replay', worksheetAfter: null,
    teacherPrompts: ['벽란도에서 고려 사람들이 인삼을 판 것은 수입일까 수출일까?'],
    image: 'scenes/byeokrando.png',
    tier: 2, priority: 2, blocking: true, minutes: { full: 5, short: 2.5 },
    shortForm: { blocking: true, note: '카드 5장(판 3·사 간 2), 보너스 = 맞힌 수 × 36만 원(최대 180만)' },
    needsRounds: 0, anchor: 'afterPrev',
  },
  {
    id: 'L1-E2', lesson: 'L1', kind: 'concept', required: true, trigger: { type: 'teacher' }, fake: false, gameRule: false,
    title: '무역·수입·수출',
    body: '나라와 나라 사이에 물자나 서비스를 사고팔면 무역이에요. 고려 입장에서 다른 나라 상인이 가져온 비단은 수입, 다른 나라 상인에게 판 인삼은 수출이에요.',
    textbook: [
      { pages: [96], note: '나라와 나라 사이에서도 물자나 서비스를 사고팔거나 교환하는 일이 일어나는데, 이러한 활동을 무역이라고 합니다.' },
      { pages: [96], note: '무역을 하는 과정에서 다른 나라에서 물자나 서비스를 사 오는 것을 수입이라고 하고, 다른 나라에 물자나 서비스를 파는 것을 수출이라고 합니다.' },
    ],
    pages: [96], effects: [{ type: 'dexCard', card: 'trade-def' }], goal: null,
    needsResponse: false, catchUp: 'summary', worksheetAfter: 'W01',
    tier: 1, blocking: true, minutes: { full: 2, short: 1 },
    shortForm: { blocking: true, note: '정의 카드 한 장' },
    needsRounds: 0, anchor: 'afterPrev',
  },
  {
    id: 'L1-E4', lesson: 'L1', kind: 'concept', required: false, trigger: { type: 'teacher' }, fake: false, gameRule: false,
    title: '무역이 없다면?',
    body: '한 나라가 이런 상황이라면 어떤 문제가 생길까요? ① 천연가스를 생산할 수 없다면 ② 비행기를 만드는 기술이 없다면',
    textbook: [
      { pages: [97], note: '천연가스는 난방을 하거나 차량을 운행할 때 연료로 사용하는 자원입니다. 천연가스가 매장되어 있는 곳은 많지 않아서 일부 국가에서만 천연가스를 생산할 수 있습니다.' },
      { pages: [97], note: '비행기를 만드는 데는 수준 높은 기술이 필요해서 일부 국가에서만 비행기를 만들 수 있습니다.' },
    ],
    pages: [97], effects: [{ type: 'dexCard', card: 'trade-need' }], goal: null,
    needsResponse: false, catchUp: 'summary', worksheetAfter: 'W02',
    teacherPrompts: ['천연가스를 생산할 수 없는 나라는 어떻게 겨울을 날까요?', '비행기를 만들 기술이 없는 나라 사람들은 어떻게 비행기를 탈까요?'],
    tier: 2, priority: 3, blocking: true, minutes: { full: 2, short: 1 },
    shortForm: { blocking: true, note: '상황 카드 1장' },
    needsRounds: 0, anchor: 'afterPrev',
  },
  {
    id: 'L1-E5', lesson: 'L1', kind: 'minigame', required: false, trigger: { type: 'teacher' }, fake: false, gameRule: false,
    title: '㉮ 나라와 ㉯ 나라 이야기',
    body: '㉮ 나라와 ㉯ 나라는 모두 쌀과 옷을 만들 수 있어요. 각 나라가 더 잘 만드는 것에 집중한 뒤 서로 바꾸면 어떻게 될까요? 두 나라 모두 혼자 살 때보다 쌀과 옷을 같거나 더 많이 갖게 만들어 보세요.',
    textbook: [
      { pages: [98], note: '㉮ 나라는 높은 수준의 기술을 갖추고 있어서 같은 시간과 비용을 들인다면 쌀보다 옷을 생산하여 수출할 때 더 큰 이익을 얻을 수 있습니다.' },
      { pages: [98], note: '㉯ 나라는 ㉮ 나라에 비해 기술 수준이 낮지만, 쌀을 재배하기에 적합한 환경이어서 같은 시간과 비용을 들인다면 옷보다 쌀을 생산하여 수출할 때 더 큰 이익을 얻을 수 있습니다.' },
      { pages: [99], note: '여러 나라가 각각 효율적으로 생산하는 상품을 수출하고, 효율적으로 생산하기 어려운 상품을 수입하면 더 우수한 품질의 상품을 저렴한 가격으로 사용할 수 있습니다.' },
    ],
    pages: [98, 99],
    effects: [
      { type: 'minigame', ref: 'twoIslands' },
      { type: 'money', amount: 50 },
      { type: 'dexCard', card: 'trade-benefit' },
    ],
    goal: { type: 'complete', ref: 'twoIslands' },
    needsResponse: true, catchUp: 'replay', worksheetAfter: 'W03',
    teacherPrompts: ['㉮ 나라는 쌀도 옷도 더 잘 만드는데 왜 쌀을 ㉯ 나라에서 사 올까?'],
    image: 'scenes/two-islands.png',
    tier: 2, priority: 1, blocking: true, minutes: { full: 6, short: 2.5 },
    shortForm: { blocking: true, note: "3단계 '바꾸기'부터, [예시 따라 하기] 바로 제공" },
    needsRounds: 0, anchor: 'afterPrev',
  },
  {
    id: 'L1-E6', lesson: 'L1', kind: 'mission', required: true, trigger: { type: 'roundStart', round: 1 }, fake: true, gameRule: false,
    title: '부산에 강추위, 천연가스가 필요해요',
    body: '부산에 강추위가 찾아와 난방용 천연가스가 많이 필요해요. 부산 항구에서는 천연가스를 생산하지 않아요. 포트헤들랜드에서 천연가스를 사 와서 부산에 팔아 보세요. 첫 항해는 안내 항해사 한바다가 차근차근 도와줘요.',
    textbook: [{ pages: [97], note: '천연가스가 매장되어 있는 곳은 많지 않아서 일부 국가에서만 천연가스를 생산할 수 있습니다.' }],
    pages: [97],
    effects: [
      { type: 'priceTag', port: 'BUS', good: 'gas', tag: 'H', until: 'lessonEnd' },
      { type: 'mission', ref: 'M-GAS' },
      { type: 'tutorial' },
    ],
    goal: { type: 'sell', good: 'gas', port: 'BUS', qty: 1 },
    needsResponse: false, catchUp: 'replay', worksheetAfter: null,
    tier: 1, blocking: false, minutes: { full: 0, short: 0 }, shortForm: null, needsRounds: 1, anchor: 'round:1',
  },
  {
    id: 'L1-E7', lesson: 'L1', kind: 'decision', required: true, trigger: { type: 'roundStart', round: 2 }, fake: false, gameRule: false,
    title: '흑연을 어디서 살까요?',
    body: '부산에서도 흑연을 살 수 있어요(국내산이라 비싸요). 상하이 흑연은 훨씬 싸요. 어디서 살지 골라 보세요. 사지 않아도 돼요. 흑연은 연필뿐만 아니라 스마트폰, 배터리의 원료로 쓰여요.',
    unitOnlyNote: '흑연은 다음 구간(2차시)에서 배터리를 만드는 재료가 돼요.',
    textbook: [
      { pages: [99], note: '흑연은 연필뿐만 아니라 스마트폰, 배터리의 원료로 쓰이는 자원입니다. 과거 우리나라는 세계적인 흑연 생산국이었지만, 다른 나라에서 저렴한 가격의 흑연을 수입하면서 우리나라에서는 거의 생산하지 않게 됐습니다.' },
      { pages: [98], note: '한편 한 나라 안에서 구할 수 있더라도 여러 가지 이유로 다른 나라에서 생산한 물자나 서비스를 수입하기도 합니다.' },
    ],
    pages: [98, 99],
    options: [
      { id: 'SHA', label: '상하이에서 살래요', after: '상하이 흑연이 더 싸요. 우리나라도 다른 나라의 저렴한 흑연을 수입해요.' },
      { id: 'BUS', label: '부산(국내산)에서 살래요', after: '국내산은 가까워서 편하지만 값이 비싸요.' },
      { id: 'none', label: '사지 않을래요', after: '흑연은 배터리의 원료로 쓰이는 자원이에요.' },
    ],
    effects: [{ type: 'decision', ref: 'graphiteChoice' }, { type: 'dexCard', card: 'graphite' }],
    goal: { type: 'decide', ref: 'graphiteChoice' },
    needsResponse: true, catchUp: 'replay', worksheetAfter: null,
    teacherPrompts: ['우리나라에 흑연이 있는데 왜 수입했을까?'],
    tier: 1, blocking: false, minutes: { full: 0, short: 0 }, shortForm: null, needsRounds: 1,
    anchor: 'round:2', anchorFallback: 'round:1',
  },
  {
    id: 'L1-E8', lesson: 'L1', kind: 'checkQuiz', required: false, trigger: { type: 'teacher' }, fake: false, gameRule: false,
    title: '1차시 확인 퀴즈',
    body: '오늘 배운 내용을 확인해요. 공용 화면의 문제를 보고 내 기기에서 답을 골라요.',
    textbook: [],
    pages: [96, 99], effects: [{ type: 'checkQuiz', lesson: 'L1' }], goal: null,
    needsResponse: true, catchUp: 'none', worksheetAfter: 'W04',
    tier: 3, blocking: true, minutes: { full: 2, short: null }, shortForm: null, needsRounds: 0, anchor: 'stageEnd',
  },
];

const L2_EVENTS: readonly GameEvent[] = [
  // (작업 115) 2차시 본문 — 교과서 인용은 도감 개념 카드(dex.ts)·앞 차시 요약(SUM-L2)과 같은 문장을 쓴다
  skeleton({
    id: 'L2-E1', lesson: 'L2', kind: 'screen', required: true, trigger: { type: 'lessonStart' },
    title: 'L2. 자원을 사 와서 만들어 팔아요 · 세계의 다양한 무역', pages: [100], worksheetAfter: null,
    body: '새 항구들이 열렸어요. 자원을 사 와서 공장에서 만들어 파는 무역을 해 봐요.',
    textbook: [{ pages: [100], note: '우리나라는 원유, 정밀 화학 원료, 천연가스, 석탄 등을 주로 수입하고, 반도체, 자동차, 무선 통신 기기, 석유 제품 등을 주로 수출해요.' }],
    effects: [{ type: 'unlock', ports: ['JKT', 'DAM', 'SIN', 'MUM', 'ROT', 'LAX'], features: ['factory'] }],
    teacherPrompts: ['우리나라는 어떤 물건을 사 오고 어떤 물건을 팔까요?'],
    image: 'lessons/l2.png', isCover: true,
    tier: 1, blocking: true, minutes: { full: 0.3, short: 0.3 }, shortForm: null, needsRounds: 0, anchor: 'afterPrev',
  }),
  skeleton({
    id: 'L2-E2', lesson: 'L2', kind: 'concept', required: true, title: '부산 공장 개장', pages: [101], worksheetAfter: null,
    body: '부산에 우리 회사 공장이 문을 열었어요. 천연자원 수입 → 상품 생산 → 상품 수출, 이렇게 무역이 이어져요. 부산 항구에 들어가 [공장]에서 사 온 자원으로 상품을 만들어 보세요.',
    textbook: [{ pages: [101], note: '우리나라는 원유, 천연가스, 철광석 등 산업 발달에 필요한 천연자원이 부족하지만, 다른 나라에서 수입한 자원으로 다양한 상품을 생산할 수 있는 기술이 발달했어요.' }],
    effects: [{ type: 'dexCard', card: 'korea-trade' }],
    teacherPrompts: ['우리나라는 왜 원유를 사 와서 석유 제품을 만들어 팔까요?'],
    tier: 1, blocking: true, minutes: { full: 2, short: 1 }, shortForm: { blocking: true, note: '순환 그림 카드만' }, needsRounds: 0, anchor: 'afterPrev',
  }),
  skeleton({
    id: 'L2-E3', lesson: 'L2', kind: 'mission', required: true, trigger: { type: 'roundStart', round: 1 },
    title: '임무: 자원 수입 → 생산 → 수출', pages: [101, 104], worksheetAfter: null,
    body: '원유·철광석·흑연 중 하나를 다른 나라에서 사서 부산으로 가져와요. 부산 공장에서 상품을 만들어요. 만든 상품을 다른 나라 항구에 팔아 [수출] 도장을 받아요.',
    textbook: [{ pages: [104], note: '우리나라는 천연자원을 수입한 후 상품을 생산하여 수출하는 무역이 발달했어요.' }],
    effects: [{ type: 'mission', ref: 'M-IPE' }], catchUp: 'replay',
    tier: 1, blocking: false, minutes: { full: 0, short: 0 }, shortForm: null, needsRounds: 1, anchor: 'round:1',
  }),
  skeleton({
    id: 'L2-E4', lesson: 'L2', kind: 'mission', required: false, trigger: { type: 'roundStart', round: 1 },
    title: '임무: 수출국 4유형', pages: [103], worksheetAfter: null,
    body: '농산물(쌀), 천연자원(원유·철광석·천연가스·니켈), 기술(로봇·백신), 문화(온라인 동영상 서비스·K-콘텐츠) 상품을 하나씩 사거나 팔아 보세요. 하나 할 때마다 도감의 수출국 4유형 칸이 채워져요.',
    textbook: [
      { pages: [103], note: '넓은 땅에서 많은 농산물을 생산하거나, 풍부한 천연자원을 가지고 있는 나라들이 있어요. 이 나라들은 전 세계에 농산물과 천연자원을 수출해요.' },
      { pages: [103], note: '뛰어난 기술을 바탕으로 생산한 물자나 서비스를 수출하는 나라들도 있어요. 또한 전 세계 사람들은 다른 나라에서 수입한 영화, 드라마, 음악 등 다양한 문화 상품을 즐겨요.' },
    ],
    effects: [{ type: 'mission', ref: 'M-EXPORT4' }], catchUp: 'replay',
    tier: 2, priority: 2, blocking: false, minutes: { full: 0, short: 0 }, shortForm: null, needsRounds: 2, anchor: 'round:1',
  }),
  skeleton({
    id: 'L2-E5', lesson: 'L2', kind: 'concept', required: false, trigger: { type: 'firstArrival', port: 'SIN' },
    title: '싱가포르의 비밀', pages: [104], worksheetAfter: null,
    body: '싱가포르는 서울보다 약간 넓은 면적의 나라로, 유럽과 아시아를 잇는 항로에 자리 잡고 있어요. 큰 항구에 여러 나라에서 생산한 상품들이 모이고, 필요한 나라에 다시 팔려요. 싱가포르에서 산 상품을 다른 나라에 팔면 [중계] 도장을 받아요.',
    textbook: [{ pages: [104], note: '싱가포르는 유럽과 아시아를 잇는 항로에 자리 잡고 있어요. 싱가포르 정부가 큰 항구를 만들자 여러 나라에서 생산한 상품들이 모이기 시작했고, 이 상품들을 필요한 나라에 다시 파는 형태의 무역이 발달했어요.' }],
    effects: [{ type: 'dexCard', card: 'relay' }, { type: 'mission', ref: 'M-RELAY' }], catchUp: 'replay',
    teacherPrompts: ['싱가포르는 자원이 많지 않은데 어떻게 무역이 발달했을까?'],
    tier: 2, priority: 1, blocking: false, minutes: { full: 0, short: 0 }, shortForm: null, needsRounds: 1, anchor: 'round:1',
  }),
  skeleton({
    id: 'L2-E6', lesson: 'L2', kind: 'screen', required: false, title: '세관 게시판', pages: [100], worksheetAfter: 'W05',
    body: '우리 반이 부산에 들여온 상품과 다른 나라에 내보낸 상품 순위예요. 교과서 100쪽의 우리나라 주요 수입품·수출품과 비교해 봐요.',
    textbook: [{ pages: [100], note: '우리나라는 원유, 정밀 화학 원료, 천연가스, 석탄 등을 주로 수입하고, 반도체, 자동차, 무선 통신 기기, 석유 제품 등을 주로 수출해요.' }],
    teacherPrompts: ['우리 반 세관 게시판과 교과서 100쪽의 수입품·수출품은 무엇이 닮았나?'],
    tier: 2, priority: 3, blocking: true, minutes: { full: 3, short: 1 }, shortForm: { blocking: true, note: '공용 화면 비교 막대만' }, needsRounds: 0, anchor: 'stageEnd',
  }),
  skeleton({
    id: 'L2-E7', lesson: 'L2', kind: 'checkQuiz', required: false, title: '2차시 확인 퀴즈', pages: [100, 104], worksheetAfter: ['W06', 'W07', 'W08'],
    body: '오늘 배운 내용을 확인해요. 공용 화면의 문제를 보고 내 기기에서 답을 골라요.',
    effects: [{ type: 'checkQuiz', lesson: 'L2' }], needsResponse: true, catchUp: 'none',
    tier: 3, blocking: true, minutes: { full: 2, short: null }, shortForm: null, needsRounds: 0, anchor: 'stageEnd',
  }),
];

const L3_EVENTS: readonly GameEvent[] = [
  // (작업 172) 3차시 본문 — 교과서 인용은 p.106~107 원문(docs/source/textbook-text.md)을 짧게. 효과 수치는 src/data/phone.ts [게임 설정]
  skeleton({
    id: 'L3-COVER', lesson: 'L3', kind: 'screen', required: true, trigger: { type: 'lessonStart' },
    title: 'L3. 서로 기대고 서로 겨뤄요 — 상호 의존과 경쟁', pages: [106], worksheetAfter: null,
    body: '여러 나라가 서로 기대고 겨루는 모습을 무역으로 만나 봐요.',
    textbook: [{ pages: [106], note: '여러 나라의 우수한 물자를 한데 모아서 새로운 제품을 생산하기도 하고, 여러 나라가 각자 잘하는 분야를 중심으로 협력하여 사업을 진행하기도 합니다.' }],
    effects: [{ type: 'unlock', features: ['shipyard'] }], image: 'lessons/l3.png', isCover: true,
    teacherPrompts: ['무역을 통해 세계 여러 나라는 어떻게 서로 기대고 겨룰까요?'],
    tier: 1, blocking: true, minutes: { full: 0.3, short: 0.3 }, shortForm: null, needsRounds: 0, anchor: 'afterPrev',
  }),
  skeleton({
    id: 'L3-E1', lesson: 'L3', kind: 'article', required: true, title: '교과서 속 기사: 한국-인도네시아 핵심 광물 협력', pages: [106], worksheetAfter: 'W09',
    body: '우리나라와 인도네시아가 핵심 광물 연구 개발 협력을 강화하기로 했어요. 인도네시아는 니켈이 풍부하고, 우리나라는 광물 탐사 기술이 뛰어나요. 우리 회사도 탐사 기술 지원에 함께할까요? 50만 원이 들고, 함께하면 자카르타에서 니켈을 20% 싸게 살 수 있어요. 함께할지 골라 보세요.',
    textbook: [{ pages: [106], note: '여러 나라가 각자 잘하는 분야를 중심으로 협력하여 사업을 진행하기도 합니다.' }],
    options: [
      { id: 'join', label: '함께해요 (50만 원)', after: '두 나라가 잘하는 것으로 서로 도우면 둘 다 이익을 얻어요. 자카르타 니켈을 싸게 살 수 있어요.' },
      { id: 'none', label: '이번에는 안 해요', after: '우리나라와 인도네시아는 서로 잘하는 것으로 협력해요.' },
    ],
    effects: [{ type: 'decision', ref: 'L3-E1' }, { type: 'dexCard', card: 'interdependence' }],
    goal: { type: 'decide', ref: 'L3-E1' },
    needsResponse: true, catchUp: 'replay',
    teacherPrompts: ['두 나라는 이 협력으로 각각 어떤 이익을 얻을까요?'],
    tier: 1, blocking: true, minutes: { full: 4, short: 0 }, shortForm: { blocking: false, note: '기사 2줄 요약 + 결정 패널(비차단)' }, needsRounds: 0, anchor: 'afterPrev',
  }),
  skeleton({
    id: 'L3-E2', lesson: 'L3', kind: 'mission', required: false, trigger: { type: 'roundStart', round: 1 },
    title: '우리 반 스마트폰 만들기', pages: [106], worksheetAfter: null, catchUp: 'replay',
    body: '우리 반이 여러 나라의 부품을 모아 스마트폰을 만들어요. 출석번호 순서대로 부품 팀이 정해졌어요. 우리 팀 부품을 사거나 만들어서 부산 항구 [조립장]에 넣어요. 다른 팀 부품을 넣어 도와도 좋아요.',
    textbook: [{ pages: [106], note: '여러 나라의 우수한 물자를 한데 모아서 새로운 제품을 생산하기도 합니다.' }],
    effects: [{ type: 'mission', ref: 'M-PHONE' }],
    gameRule: true,
    teacherPrompts: ['스마트폰 한 대에는 어느 나라의 물자가 들어갈까요?'],
    tier: 2, priority: 1, blocking: false, minutes: { full: 0.5, short: 0.5 }, shortForm: { blocking: false, note: '필요 수량 절반' }, needsRounds: 2, anchor: 'round:1',
  }),
  skeleton({
    id: 'L3-E3', lesson: 'L3', kind: 'decision', required: true, title: '생성형 인공지능 기술 경쟁', pages: [107], worksheetAfter: null,
    body: '더 나은 생성형 인공지능 제품을 만들려고 세계 여러 나라가 경쟁하고 있어요. 전 세계 생성형 인공지능 시장은 2023년 37억 달러에서 2028년 363억 달러로 커질 것으로 보여요. 우리 회사는 기술 연구에 얼마를 쓸까요? 다른 회사는 볼 수 없어요. 연구비를 골라 보세요.',
    textbook: [{ pages: [107], note: '더 나은 품질의 생성형 인공지능 제품을 개발해서 세계 여러 나라에 수출하기 위한 각 나라의 경쟁이 치열해지고 있습니다.' }],
    options: [
      { id: '0', label: '0원' },
      { id: '100', label: '100만 원' },
      { id: '200', label: '200만 원' },
      { id: '300', label: '300만 원' },
    ],
    effects: [{ type: 'dexCard', card: 'competition-tech' }],
    needsResponse: true, catchUp: 'replay',
    teacherPrompts: ['나라들은 왜 첨단 기술을 먼저 개발하려고 경쟁할까요?'],
    tier: 1, blocking: true, minutes: { full: 3, short: 0 }, shortForm: { blocking: false, note: '그래프 작게 + 비공개 결정 패널(비차단, 60초)' }, needsRounds: 0, anchor: 'afterPrev',
  }),
  skeleton({
    id: 'L3-E4', lesson: 'L3', kind: 'vote', required: false, fake: true, title: '부산 자동화 항만 투표', pages: [107], worksheetAfter: null,
    body: '상하이·싱가포르도 자동화 항만을 도입했대요. 자동화 항만이 있으면 배가 더 빨리 짐을 싣고 내릴 수 있어요. 모두 50만 원씩 모아 부산에 자동화 항만을 만들까요?',
    textbook: [{ pages: [107], note: '세계 여러 나라는 자동화 항만 시스템을 도입하며 우수한 무역 환경을 갖추려고 경쟁합니다.' }],
    options: [
      { id: 'yes', label: '찬성' },
      { id: 'no', label: '반대' },
    ],
    effects: [{ type: 'dexCard', card: 'competition-env' }],
    needsResponse: true,
    teacherPrompts: ['부산항이 좋아지면 누가 이익일까?'],
    tier: 2, priority: 2, blocking: true, minutes: { full: 3, short: 1.5 }, shortForm: { blocking: true, note: '투표 + 결과만' }, needsRounds: 0, anchor: 'afterPrev',
  }),
  skeleton({
    id: 'L3-E5', lesson: 'L3', kind: 'screen', required: false, title: '우리 반 스마트폰과 경제 게이지', pages: [106, 107], worksheetAfter: 'W10',
    body: '우리 반이 모은 스마트폰 부품을 확인해요. 여러 나라의 우수한 물자를 한데 모아 새로운 제품을 만들어요. 수출이 늘어나면 산업이 성장하고 일자리와 소득이 늘어요.',
    textbook: [
      { pages: [106], note: '여러 나라의 우수한 물자를 한데 모아서 새로운 제품을 생산하기도 합니다.' },
      { pages: [107], note: '수출이 늘어나면 더 많은 물자나 서비스를 생산해야 하므로 산업이 성장합니다. 이에 따라 일자리가 늘어나고 사람들의 소득도 증가하게 됩니다.' },
    ],
    teacherPrompts: ['스마트폰을 만드는 데 왜 우리 반 모두가 필요했을까요?', '수출이 늘어나면 우리 생활은 어떻게 달라질까요?'],
    tier: 2, priority: 1, blocking: true, minutes: { full: 3, short: 1 }, shortForm: { blocking: true, note: '결과 막대만' }, needsRounds: 2, anchor: 'stageEnd',
  }),
  skeleton({
    id: 'L3-E6', lesson: 'L3', kind: 'checkQuiz', required: false, title: '경쟁 세 가지', pages: [107], worksheetAfter: ['W11', 'W12'],
    body: '세계 여러 나라는 수출로 더 많은 이익을 얻으려고 여러 분야에서 서로 경쟁해요. ① 첨단 기술을 개발하기 위한 경쟁 ② 다른 나라에 필요한 시설을 건설하기 위한 경쟁 ③ 더 나은 무역 환경을 만들기 위한 경쟁',
    textbook: [
      { pages: [107], note: '더 나은 품질의 생성형 인공지능 제품을 개발해서 세계 여러 나라에 수출하기 위한 각 나라의 경쟁이 치열해지고 있습니다.' },
      { pages: [107], note: '철도, 도로, 발전소 등 다른 나라의 주요 시설을 건설하기 위한 세계 여러 나라의 경쟁이 치열합니다.' },
      { pages: [107], note: '세계 여러 나라는 자동화 항만 시스템을 도입하며 우수한 무역 환경을 갖추려고 경쟁합니다.' },
    ],
    effects: [{ type: 'checkQuiz', lesson: 'L3' }, { type: 'dexCard', card: 'competition-facility' }], needsResponse: true, catchUp: 'none',
    teacherPrompts: ['우리나라 기업이 다른 나라에 다리를 지으면 무엇이 좋을까요?'],
    tier: 3, blocking: true, minutes: { full: 3, short: 1 }, shortForm: { blocking: true, note: '카드만' }, needsRounds: 0, anchor: 'stageEnd',
  }),
];

const L4_EVENTS: readonly GameEvent[] = [
  skeleton({
    id: 'L4-COVER', lesson: 'L4', kind: 'screen', required: true, trigger: { type: 'lessonStart' },
    // (작업 173) 학생 화면 '선택' 낱말 금지 — 차시 제목 '기업의 결정'(학습지 v1.2와 같게)
    title: 'L4. 수입의 빛과 그림자, 기업의 결정, 항해를 마치며', pages: [108], worksheetAfter: null,
    body: '수입이 늘면 무엇이 좋고 무엇이 걱정될까요? 기업의 결정도 함께 생각해 봐요.',
    textbook: [{ pages: [108], note: '우리나라가 수입 철강 제품에 높은 관세를 부과했던 까닭을 써 봅시다.' }],
    teacherPrompts: ['우리나라가 수입 철강 제품에 높은 관세를 부과했던 까닭은 무엇일까요?'],
    image: 'lessons/l4.png', isCover: true,
    tier: 1, blocking: true, minutes: { full: 0.3, short: 0.3 }, shortForm: null, needsRounds: 0, anchor: 'afterPrev',
  }),
  skeleton({
    // (작업 173) 투표 공통 카드(VoteCard) + 투표 뒤 단계(결과 → 회상 3단계 → 실제 사례 카드, 짧은 형태는 결과 → 실제 사례). 단계 글은 data/steel1970.ts
    id: 'L4-E1', lesson: 'L4', kind: 'vote', required: true, title: '시간 여행: 1970년대 부산', pages: [108], worksheetAfter: 'W13',
    body: '1970년대 부산 항구로 시간 여행을 왔어요. 우리나라는 제철소를 짓고 철강을 만들기 시작했어요. 그런데 다른 나라 철강이 더 싸게 들어오고 있어요. 수입 철강에 높은 관세를 매길까요?',
    textbook: [
      { pages: [108], note: '수입이 늘어나서 국내 기업이 피해를 입거나 관련 산업이 성장하기 어려울 수도 있습니다.' },
      { pages: [108], note: '1970년대 우리나라는 수입 철강 제품에는 높은 관세를 부과했습니다.' },
    ],
    options: [
      { id: 'tariff', label: '관세를 매겨요' },
      { id: 'noTariff', label: '매기지 않아요' },
    ],
    effects: [{ type: 'dexCard', card: 'steel-1970' }], needsResponse: true, image: 'scenes/busan-1970s.png',
    teacherPrompts: ['다른 나라 철강이 싸게 들어오면 누가 좋고 누가 걱정할까요?', '철강은 왜 중요한 물자일까요?'],
    tier: 1, blocking: true, minutes: { full: 6, short: 1.5 }, shortForm: { blocking: true, note: '투표(30초) → 실제 사례 카드(3단계 시뮬레이션 생략)' }, needsRounds: 0, anchor: 'afterPrev',
  }),
  skeleton({
    // (작업 173) 기사 밑줄(3곳) → 공장 결정 3단계(짓기 → 임금 → 환경 설비) → 까닭(쓰고 싶으면). 응답 { build, wage, env, reason } (factoryVN.ts)
    id: 'L4-E2', lesson: 'L4', kind: 'article', required: true, title: '교과서 속 기사: 베트남으로 향하는 생산 시설 + 호찌민 공장 결정', pages: [109], worksheetAfter: null,
    body: '외국 기업들이 베트남으로 생산 시설을 옮기고 있대요. 기사에서 그 까닭 세 가지를 찾아 밑줄을 그어요. 그다음 우리 회사도 호찌민에 공장을 지을지 정해요.',
    textbook: [
      { pages: [109], note: '세계 여러 나라 간에 무역이 활발해지면서, 기업들은 물자를 생산하는 데 유리한 환경을 갖춘 나라에서 경제활동을 하기도 합니다.' },
      { pages: [109], note: '기업이 얻는 이익에 비해 근로자들이 정당한 임금을 받지 못하거나, 생산 과정에서 환경 오염과 같은 문제가 발생하기도 합니다.' },
    ],
    effects: [{ type: 'dexCard', card: 'overseas-production' }],
    needsResponse: true, catchUp: 'replay', image: 'events/vietnam-factory.png',
    teacherPrompts: ['외국 기업이 베트남에 공장을 짓는 까닭은 무엇일까요?', '공장을 지은 회사가 생각해야 할 것은 무엇일까요?'],
    tier: 1, blocking: true, minutes: { full: 5, short: 0 }, shortForm: { blocking: false, note: '기사 요약 + 결정 패널(비차단)' }, needsRounds: 0, anchor: 'afterPrev',
  }),
  skeleton({
    // (작업 173) 낮은 임금 또는 설비 미설치를 고른 학생에게만 보도·사회적 책임 −10·평판 하락 + 고치기 버튼. 나머지는 '다른 회사 공장 이야기'(읽기만)
    id: 'L4-E3', lesson: 'L4', kind: 'news', required: true, fake: true, title: '해외 공장 근로 환경 보도', pages: [109], worksheetAfter: 'W14',
    body: '호찌민의 한 공장 이야기가 뉴스에 나왔어요. 근로자가 일한 만큼 정당한 임금을 받아야 하고, 공장이 강과 공기를 더럽히지 않아야 한다는 목소리가 커지고 있어요. 회사는 이익만이 아니라 근로자와 환경도 함께 생각해야 해요.',
    textbook: [{ pages: [109], note: '기업이 얻는 이익에 비해 근로자들이 정당한 임금을 받지 못하거나, 생산 과정에서 환경 오염과 같은 문제가 발생하기도 합니다.' }],
    conditional: true,
    teacherPrompts: ['보도가 나온 회사는 무엇을 고칠 수 있을까요?'],
    tier: 1, blocking: false, minutes: { full: 0, short: 0 }, shortForm: null, needsRounds: 1, anchor: 'afterPrev',
  }),
  skeleton({
    // (작업 173) 관세사 '도윤'의 편지 형식 직업 카드 — 하는 일 2가지·필요한 것 2가지(p.110). TV는 개념 슬라이드
    id: 'L4-E4', lesson: 'L4', kind: 'concept', required: false, title: '관세사 직업 카드', pages: [110], worksheetAfter: 'W15',
    body: '안녕하세요, 관세사 도윤이에요. 관세사는 세관 공무원이 아니라, 무역하는 사람과 회사를 돕는 전문가예요. ① 하는 일: 수출입과 관련한 법 지식으로 개인이나 기업이 원활하게 무역하도록 도와요 ② 하는 일: 회사를 대신해 정해진 절차에 따라 업무를 처리하고, 나라에 수출입 물품을 신고해요 ③ 필요한 것: 무역·관세에 관한 법 지식과 업무 처리 과정 ④ 필요한 것: 영어를 비롯한 외국어 능력',
    textbook: [
      { pages: [110], note: '수출입과 관련한 법 지식을 바탕으로 개인이나 기업이 원활하게 무역 활동을 할 수 있도록 도와주는 일을 합니다.' },
      { pages: [110], note: '관세사가 되려면 무역, 관세 등에 관한 법 지식과 업무 처리 과정을 잘 알아야 합니다.' },
    ],
    effects: [{ type: 'dexCard', card: 'customs-broker' }], image: 'characters/customs-doyun.png',
    teacherPrompts: ['관세사가 없다면 무역하는 회사는 무엇이 어려울까요?'],
    tier: 2, priority: 1, blocking: true, minutes: { full: 2, short: 1 }, shortForm: { blocking: true, note: '카드만' }, needsRounds: 0, anchor: 'afterPrev',
  }),
  // ── 마무리 단계 ──
  skeleton({
    // (작업 174) 마무리 첫 활동 — 학생 화면 Containers.tsx(문장 8개 → 채점·해설 → 자기 평가 3문항), TV 문장별 정답률. 보상 없음
    id: 'L4-E6', lesson: 'L4', kind: 'minigame', required: true, trigger: { type: 'wrapup' }, title: '컨테이너 싣기', pages: [111], worksheetAfter: 'W16',
    body: '옳은 문장이 적힌 컨테이너만 트럭에 실어요. 다 실으면 정답과 까닭을 확인하고, 스스로 평가해요.',
    textbook: [{ pages: [111], note: '공부한 내용을 되돌아보고, 스스로 평가해 봅시다.' }],
    teacherPrompts: ['틀린 문장은 어떻게 고치면 옳은 문장이 될까요?'],
    effects: [{ type: 'minigame', ref: 'containers' }], needsResponse: true, catchUp: 'replay', wrapRule: 'ifL4',
    tier: 'wrap', blocking: true, minutes: { full: 3, short: null }, shortForm: null, needsRounds: 0, anchor: 'afterPrev',
  }),
  skeleton({
    id: 'L4-E7', lesson: 'L4', kind: 'screen', required: true, trigger: { type: 'wrapup' }, title: '결산·시상식', pages: [111, 112, 113], worksheetAfter: null,
    gameRule: true, wrapRule: 'always',
    body: '항해가 끝났어요. 배에 남은 화물은 산 값의 절반으로 계산해 최종 자산을 정해요. 상은 최종 자산 하나로만 주지 않아요. 수출액, 도감, 편지·확인 퀴즈, 사고판 항구처럼 여러 기록을 보고 서로 다른 친구에게 상을 줘요. 공용 화면의 시상식을 보고, 내 화면에서 내 기록을 확인해요.',
    textbook: [
      { pages: [111], note: '무역이 이루어지는 사례에 관심을 갖고 무역의 필요성을 존중하는 태도를 기를 수 있습니다.' },
    ],
    teacherPrompts: ['최종 자산이 아니어도 상을 받을 수 있어요. 어떤 기록으로 상을 받았나요?', '내 항해에서 가장 이익이 컸던 무역은 무엇이었나요?'],
    tier: 'wrap', blocking: true, minutes: { full: 3, short: null }, shortForm: null, needsRounds: 0, anchor: 'afterPrev',
  }),
  skeleton({
    // (작업 174) 기본은 종이(교과서 112~113쪽·학습지 ⑰), 교사가 [게임에서 써요]를 고르면 6칸 + 배경 + 미리보기(MagazineCover.tsx)
    id: 'L4-E8', lesson: 'L4', kind: 'decision', required: false, trigger: { type: 'wrapup' }, title: '잡지 표지 만들기', pages: [112, 113], worksheetAfter: 'W17',
    body: '기업의 대표가 되어 우리 회사를 소개하는 잡지 표지를 만들어요. 대표 상품과 특징, 주요 수출국, 사회적 책임 목표, 근로자의 권리를 보호하려는 노력, 자랑하고 싶은 모습을 써요.',
    textbook: [{ pages: [112, 113], note: '기업의 대표가 되어 기업 운영 계획을 세우고, 기업을 소개하는 잡지의 표지를 완성해 봅시다.' }],
    teacherPrompts: ['우리 회사가 사회적 책임을 다하려면 무엇을 약속할 수 있을까요?'],
    needsResponse: true, catchUp: 'replay', wrapRule: 'optionalIfL4',
    tier: 'wrap', blocking: true, minutes: { full: 8, short: 0 }, shortForm: { blocking: false, note: '종이 활동으로 대체(교과서 112~113쪽)' }, needsRounds: 0, anchor: 'afterPrev',
  }),
  skeleton({
    id: 'L4-E9', lesson: 'L4', kind: 'worksheet', required: true, trigger: { type: 'wrapup' }, title: '되돌아보기', pages: [111, 115], worksheetAfter: 'W18',
    needsResponse: true, catchUp: 'replay', wrapRule: 'always',
    body: '항해를 되돌아보며 문항마다 한 줄씩 답해요. [내 기록]에서 거래 기록과 결산을 보면 쓰기 쉬워요. 다 쓴 글은 복사해서 학습지 ⑱에 옮겨 적을 수 있어요.',
    reflectQuestions: [
      '내 항해에서 가장 이익이 컸던 무역은 무엇이고, 왜 이익이 컸을까요?',
      '게임에서 여러 나라가 서로 기대거나(상호 의존) 겨룬(경쟁) 장면 하나를 써요.',
      '사회적 책임을 다하는 기업으로서 우리 회사의 목표를 한 문장으로 써요.',
    ],
    textbook: [
      { pages: [111], note: '무역이 이루어지는 사례에서 여러 나라가 상호 의존하고 경쟁하는 관계를 분석할 수 있습니다.' },
      { pages: [115], note: '이 단원을 공부하며 새로 알게 된 점이나 느낀 점을 써 봅시다.' },
    ],
    teacherPrompts: ['무역 시간에 가장 이익이 컸던 거래를 떠올려 봐요. 왜 이익이 컸을까요?'],
    tier: 'wrap', blocking: true, minutes: { full: 2, short: null }, shortForm: null, needsRounds: 0, anchor: 'afterPrev',
  }),
];

export const events: readonly GameEvent[] = [...L1_EVENTS, ...L2_EVENTS, ...L3_EVENTS, ...L4_EVENTS];

export const eventsById: Readonly<Record<string, GameEvent>> = Object.fromEntries(events.map((e) => [e.id, e]));

/** 구간 표지 사건 ID */
export const COVER_EVENT_IDS: Readonly<Record<LessonId, string>> = {
  L1: 'L1-COVER',
  L2: 'L2-E1',
  L3: 'L3-COVER',
  L4: 'L4-COVER',
};

/** worksheetAfter 를 배열로 */
export function worksheetsAfter(e: GameEvent): readonly string[] {
  if (e.worksheetAfter === null) return [];
  return typeof e.worksheetAfter === 'string' ? [e.worksheetAfter] : e.worksheetAfter;
}
