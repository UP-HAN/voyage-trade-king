/**
 * (작업 176) 같은 거래 반복 — 갈매기 예보·폭풍 카드(비모달). 160b 갈매기 힌트 카드와 같은 자리·같은 틀(`.st-gull`).
 * 호스트가 내 상태 `game.fairTrade.notice`의 n 을 올리면 한 번 보여 준다. [알겠어요]로 닫는다.
 * 무섭지 않게: '가상 뉴스' 띠 + 폭풍 그림(작게), 학생을 탓하지 않고 다른 길을 먼저 권한다.
 */
import type { FairNotice } from '../core';
import { fairTipText, fairTradeText } from '../data/fairTrade';
import { banners } from '../data/text';
import { Img } from '../ui/common/Img';

export function FairTradeCard({ notice, progress, onOk }: { notice: FairNotice; progress: string; onOk: () => void }) {
  const storm = notice.kind === 'storm';
  return (
    <aside
      class={`st-gull st-fair${storm ? ' st-fair--storm' : ''}`}
      role="note"
      aria-live="polite"
      aria-label={storm ? fairTradeText.stormTitle : fairTradeText.forecastTitle}
      data-testid="fair-card"
      data-kind={notice.kind}
    >
      <Img path="incidents/storm.png" alt="바다 날씨" fallbackLabel="바다" class="st-gull__face st-fair__face" width={44} height={44} />
      <div class="st-gull__body">
        <p class="st-gull__head">
          <b class="title-font" data-testid="fair-title">
            {storm ? fairTradeText.stormTitle : fairTradeText.forecastTitle}
          </b>
          <span class="st-gull__fake">{banners.fakeNews}</span>
          <span class="st-tag st-gull__rule">{banners.gameRule}</span>
        </p>
        <p class="st-gull__text" data-testid="fair-text">
          {storm ? fairTradeText.storm(notice.good, notice.to) : fairTradeText.forecast(notice.from, notice.good, notice.to)}{' '}
          {!storm && <b>{fairTradeText.forecastTry}</b>}
        </p>
        {notice.tips.length > 0 && (
          <ul class="st-fair__tips" data-testid="fair-tips">
            <li class="st-fair__tips-head">{fairTradeText.tipsHead}</li>
            {notice.tips.map((t, i) => (
              <li key={i} data-testid="fair-tip">
                {fairTipText(t)}
              </li>
            ))}
          </ul>
        )}
        {storm && (
          <p class="st-fair__lesson" data-testid="fair-lesson">
            {fairTradeText.stormLesson}
          </p>
        )}
        <p class="st-fair__progress" data-testid="fair-progress">
          {progress}
        </p>
      </div>
      <button type="button" class="btn btn--primary st-gull__ok" data-testid="fair-ok" onClick={onOk}>
        알겠어요
      </button>
    </aside>
  );
}
