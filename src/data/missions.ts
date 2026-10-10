/**
 * 임무 정의 (PRD 4.4, 6.11.1). 임무는 구간이 바뀌어도 판이 끝날 때까지 이어서 할 수 있다(PRD 4.3.1).
 * 진행 판정(도장 종류 확인 등)은 core(작업 103)가 한다.
 */
import type { Mission } from './types';

export const missions: readonly Mission[] = [
  {
    id: 'M-GAS', eventId: 'L1-E6', lesson: 'L1', title: '부산에 천연가스를 가져와요',
    steps: ['포트헤들랜드에서 천연가스를 사요', '부산으로 가서 천연가스를 팔아요 [수입]'],
    pages: [97], fake: true, persistsAcrossStages: true,
    reward: [{ type: 'dexCard', card: 'trade-need' }],
  },
  {
    id: 'M-IPE', eventId: 'L2-E3', lesson: 'L2', title: '자원 수입 → 생산 → 수출',
    steps: ['원유·철광석·흑연(배터리 재료) 중 하나를 사서 부산에 가져와요 [수입]', '부산 공장에서 상품을 만들어요', '만든 상품을 다른 나라에 팔아요 [수출]'],
    pages: [101, 104], fake: false, persistsAcrossStages: true,
    reward: [{ type: 'dexCard', card: 'korea-trade' }],
  },
  {
    id: 'M-EXPORT4', eventId: 'L2-E4', lesson: 'L2', title: '수출국 4유형 모으기',
    steps: ['농산물(쌀)', '천연자원(원유·철광석·천연가스·니켈)', '기술(로봇·백신)', '문화(온라인 동영상 서비스·K-콘텐츠)'],
    pages: [103], fake: false, persistsAcrossStages: true,
    reward: [{ type: 'dexCard', card: 'export-agri' }, { type: 'dexCard', card: 'export-resource' }, { type: 'dexCard', card: 'export-tech' }, { type: 'dexCard', card: 'export-culture' }],
  },
  {
    id: 'M-RELAY', eventId: 'L2-E5', lesson: 'L2', title: '싱가포르 중계 무역',
    steps: ['싱가포르에서 상품을 사요', '그 상품을 다른 나라 항구에 팔아요 [중계]'],
    pages: [104], fake: false, persistsAcrossStages: true,
    reward: [{ type: 'dexCard', card: 'relay' }],
  },
];

export const missionsById: Readonly<Record<string, Mission>> = Object.fromEntries(missions.map((m) => [m.id, m]));
