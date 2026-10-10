/**
 * 사건 카드 S12(작업 111, PRD 8.3): 띠(가상 뉴스 | 교과서 속 기사 | 개념) + 삽화 + 제목 + 본문 3문장 이내
 * + (상황 카드) + "교과서 연결 p.000" 인용 상자 + 효과 요약 + [확인].
 * 학생용(18px)과 공용 화면용(32px 이상)은 `size`로 나눈다. `panel`이면 거래를 막지 않는 오른쪽 패널 모양.
 */
import type { ComponentChildren } from 'preact';
import { img } from '../common/asset';
import type { EventCardModel } from './model';
import { CardArt, CardBandLine, CardFrame, CardQuoteBox, type CardSize } from './parts';

export interface EventCardProps {
  model: EventCardModel;
  size?: CardSize;
  /** 오른쪽 패널(비차단 사건) */
  panel?: boolean;
  /** [확인] 누름. 없으면 버튼을 그리지 않는다(공용 화면) */
  onConfirm?: () => void;
  confirmLabel?: string;
  confirmDisabled?: boolean;
  /** 카드 아래에 더 붙일 내용(응답 수 등) */
  children?: ComponentChildren;
  testId?: string;
}

export function EventCard({ model: m, size = 'student', panel, onConfirm, confirmLabel = '확인', confirmDisabled, children, testId = 'event-card' }: EventCardProps) {
  return (
    <CardFrame size={size} band={m.band} testId={testId} id={m.id} short={m.short} panel={panel}>
      <CardBandLine band={m.band} text={m.bandText} kind={m.short ? `${m.kindLabel ?? '카드'} · 짧게` : m.kindLabel} pages={m.pages} />
      <div class="vc__main">
        {!panel && !(size === 'screen' && !m.image) && <CardArt path={m.image} alt={`${m.title} 그림`} />}
        <div class="vc__text">
          <h2 class="vc__title" data-testid="card-title">
            {m.title}
          </h2>
          {m.paragraphs.length > 0 && (
            <div class="vc__body" data-testid="card-body">
              {m.paragraphs.map((p, i) => (
                <p key={i} class="vc__p">
                  {p}
                </p>
              ))}
            </div>
          )}
          {m.situations.length > 0 && (
            <ol class="vc__situations" data-testid="card-situations" data-count={m.situations.length}>
              {m.situations.map((s, i) => (
                <li key={i} class="vc__situation" data-testid="card-situation">
                  <b class="vc__situation-title">{s.title}</b>
                  {s.quote && <CardQuoteBox quote={s.quote} />}
                </li>
              ))}
            </ol>
          )}
          {m.unitNote && (
            <p class="vc__unit-note" data-testid="card-unit-note">
              {m.unitNote}
            </p>
          )}
          {m.quotes.map((q, i) => (
            <CardQuoteBox key={i} quote={q} />
          ))}
          {m.effects.length > 0 && (
            <ul class="vc__effects" data-testid="card-effects" aria-label="효과">
              {m.effects.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          {m.guide && (
            <div class="vc__guide" data-testid="card-guide">
              <img class="vc__guide-img" src={img('characters/guide-hanbada.png')} alt="안내 항해사" onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')} />
              <p class="vc__guide-text">{m.guide}</p>
            </div>
          )}
          {children}
        </div>
      </div>
      {onConfirm && (
        <footer class="vc__foot">
          <button type="button" class="btn btn--primary vc__confirm" data-testid="card-confirm" disabled={confirmDisabled} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </footer>
      )}
    </CardFrame>
  );
}
