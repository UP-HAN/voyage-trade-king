/**
 * 공정한 바다 패널 자리(작업 109) — 내용은 작업 127가 채운다(P1).
 * 확장 지점: 같은 이름·같은 props로 이 파일을 바꾸면 대시보드 오른쪽 접이식 패널에 그대로 나온다.
 */
import type { PanelProps } from './types';

export function FairSeaPanel(_props: PanelProps) {
  return (
    <p class="t-panel__empty" data-testid="panel-FairSeaPanel">
      역전 장치(기회 카드·막판 대형 주문) 현황 보기는 준비 중이에요.
    </p>
  );
}

export default FairSeaPanel;
