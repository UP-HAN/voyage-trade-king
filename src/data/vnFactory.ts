/**
 * (작업 173, PRD 6.10) 호찌민 해외 공장(L4-E2)·근로 환경 보도(L4-E3) 화면 글.
 * 수치는 core `VN_FACTORY`(factoryVN.ts) 그대로 [게임 설정]. 카드 한 장의 숫자는 2개까지(PRD 6.5.4).
 *
 * 쓰는 말 기준(brief 위험): 근로자를 불쌍하거나 부정적으로 그리지 않는다 — '정당한 대가를 받아야 한다'처럼 권리로 말한다.
 * 회사 이름은 TV·다른 학생 화면에 쓰지 않는다. 학생 문구에 '선택' 낱말을 쓰지 않는다.
 */

export interface VNOptionText {
  id: string;
  label: string;
  good: string;
  worry: string;
  cost: string;
}

export interface VNStepText {
  key: 'build' | 'wage' | 'env';
  no: string;
  question: string;
  options: readonly VNOptionText[];
}

export const VN_STEPS: readonly VNStepText[] = [
  {
    key: 'build',
    no: '1',
    question: '호찌민에 공장을 지을까요?',
    options: [
      { id: 'yes', label: '지어요 (150만 원)', good: '공장에서 물건을 만들어 수익을 얻어요', worry: '근로자와 환경도 함께 책임져야 해요', cost: '건설비 150만 원' },
      { id: 'no', label: '짓지 않아요', good: '돈을 아낄 수 있어요', worry: '공장 수익은 없어요', cost: '0원 · 다른 회사의 공장 이야기를 읽어요' },
    ],
  },
  {
    key: 'wage',
    no: '2',
    question: '공장 근로자에게 임금을 어떻게 줄까요?',
    options: [
      { id: 'fair', label: '정당한 임금', good: '근로자가 일한 만큼 정당한 대가를 받아요', worry: '회사 수익이 조금 적어요', cost: '추가 비용 0원 · 공장 수익 +300만 원' },
      { id: 'low', label: '낮은 임금', good: '회사 수익이 더 많아요', worry: '근로자가 일한 만큼 받지 못해요', cost: '추가 비용 0원 · 공장 수익 +400만 원' },
    ],
  },
  {
    key: 'env',
    no: '3',
    question: '공장에 환경 설비를 설치할까요?',
    options: [
      { id: 'install', label: '설치해요 (100만 원)', good: '생산 과정에서 환경 오염을 줄여요', worry: '설치비가 들어요', cost: '설치비 100만 원' },
      { id: 'skip', label: '설치 안 해요', good: '설치비를 아껴요', worry: '강과 공기가 더러워질 수 있어요', cost: '0원' },
    ],
  },
];

export const VN_TEXT = {
  band: '교과서 속 기사',
  title: '호찌민 공장 결정',
  articleHelp: '외국 기업이 베트남에서 생산 시설을 운영하는 까닭 세 가지를 찾아 문장을 눌러 밑줄을 그어요.',
  articleDone: '다 읽었어요 · 공장 결정하러 가기',
  reasonAsk: '그렇게 정한 까닭을 한 줄로 써요',
  reasonHint: '써도 되고 안 써도 돼요(40자까지)',
  confirm: '이대로 정해요',
  back: '이전 단계로',
  /** 정한 뒤 정산 한 줄 */
  resultLine: (profit: number, csr: number) => `공장 수익 +${profit}만 원 · 사회적 책임 ${csr >= 0 ? '+' : ''}${csr}`,
  resultSub: (money: number) => `건설비·설비 비용을 빼면 자금이 ${money >= 0 ? `${money}만 원 늘었어요` : `${-money}만 원 줄었어요`}.`,
  notBuilt: '공장을 짓지 않았어요.',
  noMoney: '쓸 수 있는 돈이 모자라요. 짓지 않거나, 설비를 다시 정해요.',
  /** (검증 반영) 서버가 되돌린 결정(돈 말고 다른 까닭) */
  rejected: '방금 고른 것이 반영되지 않았어요. 다시 골라 주세요.',
  /** 짧은 형태(오른쪽 패널) 기사 요약 */
  shortLead: '기사 요약: 외국 기업이 베트남으로 생산 시설을 옮기는 까닭',
} as const;

/** 공장을 짓지 않은 학생·보도 대상이 아닌 학생이 읽는 '다른 회사의 공장 이야기'(p.109 해외 생산의 문제점 요지) */
export const OTHER_FACTORY_STORY = {
  title: '다른 회사의 공장 이야기',
  lines: [
    '어떤 회사가 베트남에 공장을 지었어요. 공장 덕분에 일자리가 생기고, 만든 물건은 여러 나라로 팔려요.',
    '그런데 회사가 얻는 이익에 비해 근로자가 정당한 임금을 받지 못하거나, 생산 과정에서 환경 오염 같은 문제가 생기기도 해요.',
    '그래서 회사는 이익만이 아니라 근로자와 환경도 함께 생각해야 해요.',
  ],
  pages: [109] as readonly number[],
} as const;

/** L4-E3 보도 패널(낮은 임금 또는 설비 미설치를 고른 학생) */
export const VN_REPORT_TEXT = {
  head: '우리 회사 공장 이야기가 뉴스에 나왔어요',
  wage: '근로자가 일한 만큼 정당한 임금을 받아야 한다는 목소리가 커졌어요.',
  env: '공장이 강과 공기를 더럽히지 않도록 환경 설비가 필요하다는 목소리가 커졌어요.',
  effect: '사회적 책임 −10 · 평판이 낮아져 인기 상품을 비싸게 팔기 어려워요.',
  fixLead: '지금 고칠 수 있어요.',
  fixWage: '임금 올리기 (100만 원)',
  fixEnv: '환경 설비 설치 (100만 원)',
  fixedOne: '고쳤어요! 사회적 책임 +10',
  fixedAll: '모두 고쳤어요! 평판이 돌아왔어요.',
  noMoney: '쓸 수 있는 돈이 모자라요. 상품을 판 뒤 다시 눌러요.',
  later: '나중에 고치기',
} as const;
