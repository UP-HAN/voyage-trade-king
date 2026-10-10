/**
 * 결산 지표와 상 (PRD 6.14.1~6.14.2) — [게임 설정].
 * 계산은 core(scoring, 작업 103)가 한다. 여기에는 이름·순서·상수만 둔다.
 * 지표는 v0.2의 7개 + v0.3 '도약(성장률)' = 8개, 상도 8개.
 */
export type MetricId = 'finalAsset' | 'exports' | 'dex' | 'csr' | 'coop' | 'quiz' | 'explore' | 'leap';

export interface Metric {
  id: MetricId;
  name: string;
  formula: string;
  award: string;
  unit: string;
  /** 차시 한 판에서 모두 같은 값이 되기 쉬운 지표(값이 모두 같으면 상 자동 숨김, PRD 4.1.1) */
  mayBeFlat: boolean;
}

export const metrics: readonly Metric[] = [
  { id: 'finalAsset', name: '최종 자산', formula: '자금 + 남은 화물(산 값×0.5) + 배 값×0.5 − 긴급 대출', award: '무역왕상', unit: '만 원', mayBeFlat: false },
  { id: 'exports', name: '수출액', formula: '[수출] 도장 판매액 합계', award: '수출 역군상', unit: '만 원', mayBeFlat: false },
  { id: 'dex', name: '도감', formula: '수집 카드 수', award: '도감 박사상', unit: '장', mayBeFlat: false },
  { id: 'csr', name: '사회적 책임', formula: '기본 50 + 결정 효과(6.10) + 협력 활동 참여 + 잡지 표지에 목표·노력 작성(+10)', award: '착한 기업상', unit: '점', mayBeFlat: true },
  { id: 'coop', name: '협력', formula: '광물 협력 참여, 스마트폰 부품 운반, 다른 팀 도와준 운반', award: '협력상', unit: '점', mayBeFlat: true },
  { id: 'quiz', name: '무역 박사', formula: '편지 퀴즈 정답 수 + 확인 퀴즈 정답 수', award: '무역 박사상', unit: '개', mayBeFlat: false },
  { id: 'explore', name: '개척', formula: '방문 항구 수', award: '개척상', unit: '곳', mayBeFlat: false },
  {
    id: 'leap', name: '도약(성장률)', award: '도약상', unit: '배', mayBeFlat: false,
    formula: '최종 자산 ÷ 기준 자산. 기준 자산 = 무역 시간 25% 지점(첫 구간이 끝날 때와 25% 중 먼저 오는 때)의 자산, 시작 자금보다 작으면 시작 자금',
  },
];

/** 시상 순서: 도약상을 무역왕상 바로 앞에(역전 이야기가 마지막 장면 가까이에 오게) */
export const AWARD_ORDER: readonly MetricId[] = ['exports', 'dex', 'csr', 'coop', 'quiz', 'explore', 'leap', 'finalAsset'];

export const awardRules = {
  /** 상별 수상 인원 K(교사 설정 1~3, 기본 3) */
  perPrizeOptions: [1, 2, 3] as const,
  perPrizeDefault: 3,
  /** 이미 상을 받은 학생은 다음 순위에게 넘긴다 */
  oneAwardPerStudent: true,
  /** 동점이면 함께 수상 */
  tiesShare: true,
  /** 필수 임무를 모두 마친 학생 전원(학생 화면에만, 공용 화면에는 인원수만) */
  certificate: '항해 완주 증서',
} as const;

export const scoringConstants = {
  csrBase: 50,
  csrMagazineBonus: 10,
  /** 도약 기준 자산 시점(무역 시간 비율) */
  leapBasePoint: 0.25,
} as const;

/** 순위 공개(PRD 6.14.2) */
export const leaderboardRules = {
  topNOptions: [0, 3, 4, 5] as const,
  topNDefault: 3,
  /** 무역 시간 25% 전에는 도약 탭을 "곧 공개"로 */
  leapTabRevealAt: 0.25,
  assetTabDefault: true,
} as const;
