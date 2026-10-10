/**
 * 돌발 사건 패널 자리(작업 109) — 내용은 작업 126가 채운다(P1).
 * 확장 지점: 같은 이름·같은 props로 이 파일을 바꾸면 대시보드 오른쪽 접이식 패널에 그대로 나온다.
 */
import type { PanelProps } from './types';

export function IncidentPanel(_props: PanelProps) {
  return (
    <p class="t-panel__empty" data-testid="panel-IncidentPanel">
      돌발 사건 예보·관리 화면은 준비 중이에요.
    </p>
  );
}

export default IncidentPanel;
