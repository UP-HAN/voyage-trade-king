import type { Action } from '../core';
import type { MeView } from '../student/predict';
import type { StudentActResult } from '../student/store';

/** 미니게임 하나(벽란도·두 섬)가 받는 값 — `MinigameLayer`가 사건 층 props에서 만든다 */
export interface MinigameGameProps {
  eventId: string;
  /** 짧은 형태(PRD 4.3.2) */
  short: boolean;
  /** 따라잡기로 연 것(늦게 들어온 학생·다시 보내기) */
  catchUp: boolean;
  /** 사건이 이미 마감됐나(따라잡기에서) */
  closed: boolean;
  player: MeView;
  act: (action: Action) => StudentActResult;
  onDone: () => void;
  /** 이 화면을 열 때 이미 결과가 기록돼 있었나 */
  alreadyDone: boolean;
}
