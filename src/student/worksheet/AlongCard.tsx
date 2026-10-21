/**
 * (작업 165, PRD 4.1.1) '잠깐! 학습지 ⑥' 함께 쓰기 안내 카드 — 비모달.
 * 갈매기 힌트 카드(`GullHint.tsx`)와 같은 자리(`st-gull-dock`, 흐름 안)에 놓아 하단 바·항구 버튼을 가리지 않는다.
 */
import { WS6_ALONG_TEXT } from '../../data/lessonParts';

export function Ws6AlongCard({ onOk }: { onOk: () => void }) {
  return (
    <aside class="st-gull st-along" role="note" aria-live="polite" aria-label={WS6_ALONG_TEXT.head} data-testid="ws6-along">
      <span class="st-along__no title-font" aria-hidden="true">
        ⑥
      </span>
      <div class="st-gull__body">
        <p class="st-gull__head">
          <b class="title-font">{WS6_ALONG_TEXT.head}</b>
        </p>
        <p class="st-gull__text" data-testid="ws6-along-text">
          {WS6_ALONG_TEXT.body1}
        </p>
        <p class="st-along__more" data-testid="ws6-along-more">
          {WS6_ALONG_TEXT.body2}
        </p>
      </div>
      <button type="button" class="btn btn--primary st-gull__ok" data-testid="ws6-along-ok" onClick={onOk}>
        {WS6_ALONG_TEXT.ok}
      </button>
    </aside>
  );
}
