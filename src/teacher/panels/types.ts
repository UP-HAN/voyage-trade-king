/**
 * 대시보드 오른쪽 접이식 패널 공통 props(작업 109 확장 지점).
 * 112(학습지·편지)·126(돌발 사건)·127(공정한 바다)이 이 모양으로 패널을 채운다.
 * 학급 상태는 `actions.dispatch`(→ 세션 → 103 hostReduce)로만 바꾼다.
 */
import type { HostView } from '../../sync/host-session';
import type { TeacherActions } from '../actions';
import type { TeacherGame } from '../game';

export interface PanelProps {
  game: TeacherGame | null;
  view: HostView<TeacherGame>;
  actions: TeacherActions;
  /** 서버 시각(ms) */
  now: number;
}
