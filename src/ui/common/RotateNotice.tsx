/**
 * 세로 화면 안내(PRD 8.1-10). 세로 방향일 때만 CSS(@media orientation: portrait)로 화면 전체를 덮는다.
 * 학생 라우트 최상위에 한 번 둔다.
 */
export function RotateNotice() {
  return (
    <div class="rotate-notice" role="alert" aria-live="polite">
      <div class="rotate-notice__box">
        <p class="rotate-notice__title">가로로 돌려 주세요</p>
        <p>기기를 가로로 돌리면 게임 화면이 보여요.</p>
      </div>
    </div>
  );
}
