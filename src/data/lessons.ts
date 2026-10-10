/**
 * 학습 구간 L1~L4 (PRD 4.4 — v0.3부터 '차시'는 '학습 구간'으로 읽는다).
 *
 * eventQueue: PRD 4.4 표 순서 그대로, 학습지 팝업 ⓦ(W..)를 그 사건 뒤에 넣었다. v0.3 변경:
 * - 맨 앞에 구간 표지 사건(L1-COVER / L2-E1 / L3-COVER / L4-COVER).
 * - 준비 단계 사건(L1-E0 입장, L1-E3 회사 설립)은 schedule.prepQueue 로 옮겼다.
 * - L4-E5(마지막 항해)는 사건이 아니라 L4 마지막 라운드이므로 뺐다.
 * - 마무리 단계(L4-E6·E7·E8·E9와 ⑯⑰⑱)는 schedule.wrapQueue / wrapupByUnit 이 쓴다.
 * - ④⑥⑦⑧⑪⑫는 '그 구간 마지막 라운드 끝'(worksheet.afterEvent = 'stageLastRound')에 뜨며, 큐에서는 확인 퀴즈 뒤에 둔다.
 * 실제 시각 배치는 스케줄러(작업 123)가 events.ts 의 등급·분 값으로 정한다.
 */
import { goodsUnlockedBy } from './goods';
import { portsOpenedIn } from './ports';
import type { GoodId, LessonId, PageList, PortId } from './types';

export interface Lesson {
  id: LessonId;
  title: string;
  pages: PageList;
  /** 학습 목표(PRD 4.4) */
  goal: string;
  /** 이 구간에 새로 열리는 항구 */
  portsOpened: readonly PortId[];
  /** 이 구간에 새로 공개되는 상품 */
  goodsUnlocked: readonly GoodId[];
  /** v0.2 기준 라운드 수(전체 형태 참고값). v0.3 실제 라운드 수는 스케줄러가 T로 계산 */
  defaultRounds: number;
  /** v0.2 기준 편지 수(참고값, PRD 6.7.2) */
  legacyLetters: number;
  eventQueue: readonly string[];
  priority: 'P0' | 'P1';
}

const newGoods = (lesson: LessonId, prev: LessonId | null): GoodId[] => {
  const before = new Set(prev ? goodsUnlockedBy(prev) : []);
  return goodsUnlockedBy(lesson).filter((g) => !before.has(g));
};

export const lessons: readonly Lesson[] = [
  {
    id: 'L1', title: '물건은 어디에서 왔을까? 왜 무역을 할까?', pages: [94, 95, 96, 97, 98, 99],
    goal: '무역·수입·수출의 뜻과 무역이 필요한 까닭(자원·기술의 차이, 효율적 생산과 교환의 이익, 구할 수 있어도 수입하는 경우)을 안다.',
    portsOpened: portsOpenedIn('L1'), goodsUnlocked: newGoods('L1', null), defaultRounds: 2, legacyLetters: 2, priority: 'P0',
    eventQueue: ['L1-COVER', 'L1-E1', 'L1-E2', 'W01', 'L1-E4', 'W02', 'L1-E5', 'W03', 'L1-E6', 'L1-E7', 'L1-E8', 'W04'],
  },
  {
    id: 'L2', title: '자원을 사 와서 만들어 팔아요 · 세계의 다양한 무역', pages: [100, 101, 102, 103, 104, 105],
    goal: '우리나라의 주요 수입품·수출품과 무역의 특징(천연자원 수입→상품 생산→수출)을 알고, 나라마다 특징(자연환경·기술·문화·지리적 위치)에 따라 다양한 무역이 발달함을 안다.',
    portsOpened: portsOpenedIn('L2'), goodsUnlocked: newGoods('L2', 'L1'), defaultRounds: 4, legacyLetters: 3, priority: 'P1',
    eventQueue: ['L2-E1', 'L2-E2', 'L2-E3', 'L2-E4', 'L2-E5', 'L2-E6', 'W05', 'L2-E7', 'W06', 'W07', 'W08'],
  },
  {
    id: 'L3', title: '서로 기대고 서로 겨뤄요 — 상호 의존과 경쟁', pages: [106, 107],
    goal: '여러 나라가 물자를 모아 새 제품을 만들고 잘하는 분야로 협력하는 상호 의존 관계를 알고, 수출 증가의 영향과 경쟁의 세 가지 모습(첨단 기술, 시설 건설, 무역 환경)을 안다.',
    portsOpened: portsOpenedIn('L3'), goodsUnlocked: newGoods('L3', 'L2'), defaultRounds: 3, legacyLetters: 3, priority: 'P1',
    eventQueue: ['L3-COVER', 'L3-E1', 'W09', 'L3-E2', 'L3-E3', 'L3-E4', 'L3-E5', 'W10', 'L3-E6', 'W11', 'W12'],
  },
  {
    id: 'L4', title: '수입의 빛과 그림자, 기업의 선택, 항해를 마치며', pages: [108, 109, 110, 111, 112, 113],
    goal: '수입 증가의 좋은 점과 문제점, 관세의 역할, 생산 시설 해외 이전의 까닭과 문제점, 관세사가 하는 일을 알고, 단원 내용을 확인하며 사회적 책임을 담아 기업을 소개한다.',
    portsOpened: portsOpenedIn('L4'), goodsUnlocked: newGoods('L4', 'L3'), defaultRounds: 1, legacyLetters: 1, priority: 'P1',
    eventQueue: ['L4-COVER', 'L4-E1', 'W13', 'L4-E2', 'L4-E3', 'W14', 'L4-E4', 'W15'],
  },
];

export const lessonsById: Readonly<Record<LessonId, Lesson>> = Object.fromEntries(
  lessons.map((l) => [l.id, l]),
) as Record<LessonId, Lesson>;

/** 쪽 범위 표시 '94~99' */
export function pageRangeLabel(pages: PageList): string {
  if (pages.length === 0) return '';
  const lo = Math.min(...pages);
  const hi = Math.max(...pages);
  return lo === hi ? `${lo}` : `${lo}~${hi}`;
}
