/**
 * 공통 문구 (PRD 2장 정확성 원칙) + 교과서 속 기사 원문(L3-E1 p.106, L4-E2 p.109).
 * 기사는 교과서 원문을 그대로 옮겼다(PDF 추출의 줄바꿈만 이어 붙임, 단어는 바꾸지 않음).
 */

/** 띠·표시 문구 */
export const banners = {
  /** 지어낸 뉴스·상황 카드에 반드시 붙이는 띠 */
  fakeNews: '가상 뉴스 — 교과서 내용을 바탕으로 만든 이야기예요',
  /** 실제 기사 인용(p.106, p.109)에 붙이는 띠 */
  textbookArticle: '교과서 속 기사',
  /** 교과서에 없는 값·규칙 옆 작은 표시 */
  gameRule: '게임 규칙',
} as const;

/** 쪽수 표시 "교과서 95~96쪽", "교과서 111, 115쪽" */
export function pageLabel(pages: readonly number[]): string {
  if (pages.length === 0) return '';
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const contiguous = sorted.every((p, i) => i === 0 || p === sorted[i - 1] + 1);
  if (sorted.length > 1 && contiguous) return `교과서 ${sorted[0]}~${sorted[sorted.length - 1]}쪽`;
  return `교과서 ${sorted.join(', ')}쪽`;
}

export interface TextbookArticle {
  id: string;
  headline: string;
  body: string;
  source: string;
  date: string;
  pages: readonly number[];
  /** 밑줄 활동: 학생이 찾아 누를 문장 */
  underlineTargets: readonly { label: string; sentence: string }[];
}

/** 교과서 속 기사 원문 */
export const textbookArticles: Readonly<Record<'mineralCoop' | 'vietnamFactory', TextbookArticle>> = {
  mineralCoop: {
    id: 'mineralCoop',
    headline: '한국–인도네시아 핵심 광물 연구 개발 협력 가속화',
    body:
      '우리나라와 인도네시아가 핵심 광물 연구 개발 협력을 한층 강화하기 위해 ‘한국 - 인도네시아 핵심 광물 공동 연구 센터’를 운영하기로 했다. ' +
      '인도네시아는 니켈, 주석 등 광물 매장량이 풍부한 국가로, 우리나라는 인도네시아와 협력을 함으로써 더 안정적인 자원 확보가 가능할 것으로 보인다. ' +
      '인도네시아는 우리나라의 뛰어난 광물 탐사 기술을 활용하여 효율적으로 자원을 개발할 수 있을 것으로 기대하고 있다.',
    source: '『전자 신문』',
    date: '2023. 11. 28.',
    pages: [106],
    underlineTargets: [
      { label: '우리나라가 기대하는 이익', sentence: '우리나라는 인도네시아와 협력을 함으로써 더 안정적인 자원 확보가 가능할 것으로 보인다.' },
      { label: '인도네시아가 기대하는 이익', sentence: '인도네시아는 우리나라의 뛰어난 광물 탐사 기술을 활용하여 효율적으로 자원을 개발할 수 있을 것으로 기대하고 있다.' },
    ],
  },
  vietnamFactory: {
    id: 'vietnamFactory',
    headline: '베트남으로 향하는 외국 기업의 생산 시설',
    body:
      '베트남으로 생산 시설을 옮기는 외국 기업이 늘어나고 있다. 외국 기업이 베트남으로 생산 시설을 옮기는 주된 이유는 저렴한 노동력 때문이다. ' +
      '베트남의 지리적 위치 또한 장점이다. 중국과 국경을 맞대고 있어 생산한 물자를 중국에 쉽게 공급할 수 있다. ' +
      '베트남에서 생산한 제품을 수입할 때 낮은 관세를 부과하기로 약속한 나라가 많다는 것도 유리한 점이다. ' +
      '이에 미국, 중국 기업을 비롯한 우리나라 기업들도 베트남에서 생산 시설을 운영하고 있다.',
    source: '『한국 무역 신문』',
    date: '2022. 12. 11.',
    pages: [109],
    underlineTargets: [
      { label: '저렴한 노동력', sentence: '외국 기업이 베트남으로 생산 시설을 옮기는 주된 이유는 저렴한 노동력 때문이다.' },
      { label: '지리적 위치', sentence: '중국과 국경을 맞대고 있어 생산한 물자를 중국에 쉽게 공급할 수 있다.' },
      { label: '낮은 관세 약속', sentence: '베트남에서 생산한 제품을 수입할 때 낮은 관세를 부과하기로 약속한 나라가 많다는 것도 유리한 점이다.' },
    ],
  },
};

/** 화면 공통 짧은 문구 */
export const commonText = {
  serviceTooltip: '서비스는 배에 싣지 않아요. 인터넷이나 계약으로 사고팔아요.',
  helperEmpty: '아직 기록이 없어요',
  worksheetDone: '다 썼어요',
  worksheetWait: '친구들을 기다려요',
  pauseOverlay: '선생님을 보세요',
  letterExpired: '답장 기한이 지났어요',
} as const;
