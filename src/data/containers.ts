/**
 * 컨테이너 싣기 OX (L4-E6, PRD 6.12.7, p.111).
 * 교과서 p.111 문장 8개를 그대로 컨테이너 8개에 쓴다. 옳은 문장 4개만 트럭에 싣는다.
 * 교과서의 알파벳 조합 퍼즐은 교과서에서 직접 하고, 게임은 OX 판정만 한다(확정).
 */
export interface ContainerSentence {
  no: number;
  /** 교과서 원문(p.111) */
  text: string;
  correct: boolean;
  /** 옳은 문장의 주제 / 틀린 문장의 바른 설명 */
  explain: string;
  pages: readonly number[];
}

export const containerSentences: readonly ContainerSentence[] = [
  {
    no: 1, text: '무역이란 나라와 나라 사이에 물자나 서비스를 주고받는 것입니다.', correct: true,
    explain: '무역의 뜻: 나라와 나라 사이에 물자나 서비스를 사고팔거나 교환하는 일을 무역이라고 해요.', pages: [96],
  },
  {
    no: 2, text: '각 나라의 자연환경, 자원, 자본, 기술 등이 비슷하여 무역이 발생합니다.', correct: false,
    explain: '나라마다 자연환경, 자원, 자본, 기술 등에 차이가 있어 무역을 해요. 비슷해서가 아니라 달라서 무역이 일어나요.', pages: [99],
  },
  {
    no: 3, text: '우리나라는 원유, 천연가스, 철광석 등 천연자원을 주로 수출합니다.', correct: false,
    explain: '우리나라는 원유, 천연가스, 철광석 등 산업 발달에 필요한 천연자원이 부족해서 주로 수입해요.', pages: [100, 101],
  },
  {
    no: 4, text: '한 나라 안에서 구할 수 있는 물자나 서비스는 다른 나라에서 수입하지 않습니다.', correct: false,
    explain: '한 나라 안에서 구할 수 있더라도 여러 가지 이유로 다른 나라에서 수입하기도 해요. 우리나라는 흑연을 구할 수 있었지만 저렴한 흑연을 수입해요.', pages: [98, 99],
  },
  {
    no: 5, text: '우리나라는 원료를 수입한 후 상품을 생산하여 수출하는 무역이 발달했습니다.', correct: true,
    explain: '원료 수입 후 생산·수출: 우리나라는 천연자원을 수입한 후 상품을 생산하여 수출하는 무역이 발달했어요.', pages: [101, 104],
  },
  {
    no: 6, text: '자유롭게 무역을 하면 모든 나라의 경제가 나빠집니다.', correct: false,
    explain: '각 나라가 효율적으로 생산하는 상품을 수출하고 생산하기 어려운 상품을 수입하면 더 우수한 품질의 상품을 저렴한 가격으로 쓸 수 있어요. 수출이 늘어나면 산업이 성장하고 일자리와 소득도 늘어나요.', pages: [99, 107],
  },
  {
    no: 7, text: '세계 여러 나라는 무역을 통해 상호 의존과 경쟁을 하고 있습니다.', correct: true,
    explain: '상호 의존과 경쟁: 여러 나라는 우수한 물자를 모으거나 잘하는 분야로 협력하고, 더 많은 이익을 얻으려고 서로 경쟁해요.', pages: [106, 107],
  },
  {
    no: 8, text: '무역에 유리한 지리적 위치를 이용하여 무역이 발달하기도 합니다.', correct: true,
    explain: '지리적 위치: 싱가포르처럼 무역에 유리한 지리적 위치를 이용해서 무역이 발달한 나라도 있어요.', pages: [104],
  },
];

/** p.111 자기 평가 3문항(교과서 문장 그대로, 별 1~3개) */
export const selfEvaluation: readonly { no: number; text: string; pages: readonly number[] }[] = [
  { no: 1, text: '무역의 의미와 나라 간에 무역이 발생하는 까닭을 설명할 수 있습니다.', pages: [111] },
  { no: 2, text: '무역이 이루어지는 사례에서 여러 나라가 상호 의존하고 경쟁하는 관계를 분석할 수 있습니다.', pages: [111] },
  { no: 3, text: '무역이 이루어지는 사례에 관심을 갖고 무역의 필요성을 존중하는 태도를 기를 수 있습니다.', pages: [111] },
];

export const containersGame = {
  title: '컨테이너 싣기',
  instruction: '옳은 문장이 적힌 컨테이너만 트럭에 실어요.',
  image: 'minigame/container-truck.png',
  puzzleNote: '알파벳 퍼즐(정답 컨테이너의 알파벳 찾기)은 교과서 111쪽에서 직접 해요.',
  stars: 3,
  pages: [111],
} as const;

export const CORRECT_CONTAINER_NOS: readonly number[] = containerSentences.filter((s) => s.correct).map((s) => s.no);
