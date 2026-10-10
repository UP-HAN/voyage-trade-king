/**
 * 구간 끝 확인 퀴즈 (PRD 6.7.5) — 공용 화면에 문제, 학생 기기에 선택지, 공용 화면에는 정답률 막대만.
 * 구간마다 지정 2문항(primary) + 예비 2문항. 보상 없음, 지표 '무역 박사' +1.
 * 편지 은행과 겹치지 않는 문항으로 따로 둔다(같은 판에서 같은 문제를 두 번 보지 않게).
 */
import type { CheckQuizQuestion, LessonId } from './types';

export const checkQuiz: readonly CheckQuizQuestion[] = [
  // ── L1 ──
  {
    id: 'CQ-L1-1', lesson: 'L1', primary: true, type: 'ox',
    prompt: '다른 나라에 물자나 서비스를 파는 것을 수출이라고 해요.', answer: 'O',
    explain: '다른 나라에 물자나 서비스를 파는 것을 수출, 사 오는 것을 수입이라고 해요. (교과서 96쪽)', pages: [96],
  },
  {
    id: 'CQ-L1-2', lesson: 'L1', primary: true, type: 'choice3',
    prompt: '우리나라에서도 흑연을 구할 수 있었는데 흑연을 수입하게 된 까닭은 무엇일까요?',
    choices: ['다른 나라에서 저렴한 가격의 흑연을 수입하게 되어서', '흑연이 필요 없어져서', '흑연을 만들 수 있는 나라가 우리나라뿐이라서'], answer: 0,
    explain: '과거 우리나라는 세계적인 흑연 생산국이었지만, 다른 나라에서 저렴한 가격의 흑연을 수입하면서 거의 생산하지 않게 됐어요. (교과서 99쪽)', pages: [99],
  },
  {
    id: 'CQ-L1-3', lesson: 'L1', primary: false, type: 'ox',
    prompt: '한 나라 안에서 구할 수 있는 물자나 서비스는 다른 나라에서 수입하지 않아요.', answer: 'X',
    explain: '한 나라 안에서 구할 수 있더라도 여러 가지 이유로 다른 나라에서 생산한 물자나 서비스를 수입하기도 해요. (교과서 98쪽)', pages: [98],
  },
  {
    id: 'CQ-L1-4', lesson: 'L1', primary: false, type: 'choice3',
    prompt: '벽란도에서 다른 나라 상인들이 가져와서 판 물건이 아닌 것은 무엇일까요?',
    choices: ['모시', '비단', '서적'], answer: 0,
    explain: '다른 나라 상인들은 비단, 약재, 서적, 악기, 보석 등을 가져와서 팔고, 고려에서 삼베, 모시, 인삼, 종이 등을 사 갔어요. (교과서 95쪽)', pages: [95],
  },
  // ── L2 ──
  {
    id: 'CQ-L2-1', lesson: 'L2', primary: true, type: 'choice3',
    prompt: '우리나라는 (     )을/를 수입한 후 상품을 생산하여 수출하는 무역이 발달했어요. 빈칸에 알맞은 말은?',
    choices: ['천연자원', '자동차', '반도체'], answer: 0,
    explain: '우리나라는 천연자원을 수입한 후 상품을 생산하여 수출하는 무역이 발달했어요. (교과서 104쪽)', pages: [104],
  },
  {
    id: 'CQ-L2-2', lesson: 'L2', primary: true, type: 'ox',
    prompt: '세계 여러 나라는 자연환경, 발달한 기술, 지리적 위치 등 각 나라의 특징에 따른 무역이 발달했어요.', answer: 'O',
    explain: '세계 여러 나라는 자연환경, 발달한 기술, 지리적 위치 등 각 나라의 특징에 따른 무역이 발달했어요. (교과서 104쪽)', pages: [104],
  },
  {
    id: 'CQ-L2-3', lesson: 'L2', primary: false, type: 'choice3',
    prompt: '석탄은 우리나라의 주요 수입품일까요, 수출품일까요?',
    choices: ['수입품', '수출품', '둘 다 아니에요'], answer: 0,
    explain: '우리나라의 주요 수입품은 원유, 정밀 화학 원료, 천연가스, 석탄이고, 주요 수출품은 반도체, 자동차, 무선 통신 기기, 석유 제품이에요. (교과서 100쪽)', pages: [100],
  },
  {
    id: 'CQ-L2-4', lesson: 'L2', primary: false, type: 'ox',
    prompt: '세계적인 무역항을 갖춘 도시에는 미국의 로스앤젤레스, 중국의 상하이, 네덜란드의 로테르담 등이 있어요.', answer: 'O',
    explain: '세계적인 무역항을 갖춘 도시에는 미국의 로스앤젤레스, 중국의 상하이, 네덜란드의 로테르담 등이 있어요. (교과서 104쪽)', pages: [104],
  },
  // ── L3 ──
  {
    id: 'CQ-L3-1', lesson: 'L3', primary: true, type: 'choice3',
    prompt: '세계 여러 나라가 다양한 분야에서 서로 경쟁하는 까닭은 무엇일까요?',
    choices: ['물자나 서비스를 수출하여 더 많은 이익을 얻으려고', '무역을 그만두려고', '관세를 모두 없애려고'], answer: 0,
    explain: '세계 여러 나라는 물자나 서비스를 수출하여 더 많은 이익을 얻으려고 다양한 분야에서 서로 경쟁해요. (교과서 107쪽)', pages: [107],
  },
  {
    id: 'CQ-L3-2', lesson: 'L3', primary: true, type: 'ox',
    prompt: '여러 나라가 각자 잘하는 분야를 중심으로 협력하여 사업을 진행하기도 해요.', answer: 'O',
    explain: '무역이 활발해지면서 여러 나라가 각자 잘하는 분야를 중심으로 협력하여 사업을 진행하기도 해요. (교과서 106쪽)', pages: [106],
  },
  {
    id: 'CQ-L3-3', lesson: 'L3', primary: false, type: 'choice3',
    prompt: '철도, 도로, 발전소 등 다른 나라의 주요 시설을 지으려는 경쟁은 무엇일까요?',
    choices: ['다른 나라에 필요한 시설을 건설하기 위한 경쟁', '첨단 기술을 개발하기 위한 경쟁', '더 나은 무역 환경을 만들기 위한 경쟁'], answer: 0,
    explain: '철도, 도로, 발전소 등 다른 나라의 주요 시설을 건설하기 위한 세계 여러 나라의 경쟁이 치열해요. (교과서 107쪽)', pages: [107],
  },
  {
    id: 'CQ-L3-4', lesson: 'L3', primary: false, type: 'ox',
    prompt: '항만은 선박이 안전하게 머물 수 있고, 화물이나 사람이 배로부터 육지에 오르내리기에 편리한 곳이에요.', answer: 'O',
    explain: '항만은 선박이 안전하게 머물 수 있고, 화물이나 사람이 배로부터 육지에 오르내리기에 편리한 곳이에요. (교과서 107쪽)', pages: [107],
  },
  // ── L4 ──
  {
    id: 'CQ-L4-1', lesson: 'L4', primary: true, type: 'ox',
    prompt: '수입이 늘어나서 국내 기업이 피해를 입거나 관련 산업이 성장하기 어려울 수도 있어요.', answer: 'O',
    explain: '수입이 늘어나서 국내 기업이 피해를 입거나 관련 산업이 성장하기 어려울 수도 있어요. (교과서 108쪽)', pages: [108],
  },
  {
    id: 'CQ-L4-2', lesson: 'L4', primary: true, type: 'choice3',
    prompt: '관세사가 되려면 무엇이 필요할까요?',
    choices: ['무역, 관세 등에 관한 법 지식과 업무 처리 과정을 잘 아는 것', '배를 운전하는 면허', '공장을 짓는 기술'], answer: 0,
    explain: '관세사가 되려면 무역, 관세 등에 관한 법 지식과 업무 처리 과정을 잘 알아야 해요. 외국어 능력을 갖추는 것도 유리해요. (교과서 110쪽)', pages: [110],
  },
  {
    id: 'CQ-L4-3', lesson: 'L4', primary: false, type: 'choice3',
    prompt: '기사에서 베트남의 지리적 위치가 장점인 까닭은 무엇일까요?',
    choices: ['중국과 국경을 맞대고 있어 생산한 물자를 중국에 쉽게 공급할 수 있어서', '바다가 전혀 없어서', '다른 나라와 멀리 떨어져 있어서'], answer: 0,
    explain: '베트남은 중국과 국경을 맞대고 있어 생산한 물자를 중국에 쉽게 공급할 수 있어요(『한국 무역 신문』, 2022. 12. 11.). (교과서 109쪽)', pages: [109],
  },
  {
    id: 'CQ-L4-4', lesson: 'L4', primary: false, type: 'ox',
    prompt: '관세는 다른 나라로 수출하는 상품에 부과하는 세금이에요.', answer: 'X',
    explain: '관세는 다른 나라에서 수입하는 상품에 부과하는 세금이에요. (교과서 108쪽)', pages: [108],
  },
];

/** 그 구간의 지정 문항(primary) 또는 예비 문항 */
export function checkQuizFor(lesson: LessonId, primary = true): CheckQuizQuestion[] {
  return checkQuiz.filter((q) => q.lesson === lesson && q.primary === primary);
}
