/**
 * 카드 공통 조각(작업 111): 띠, 삽화 칸(없으면 양피지 무늬), 교과서 인용 상자, 등장 연출.
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { img } from '../common/asset';
import { fx } from '../common/fx';
import { linkPages, type CardBand, type CardQuote } from './model';

export type CardSize = 'student' | 'screen';

/** 카드가 처음 보일 때 `fx.cardIn()`(id가 바뀔 때마다 다시) */
export function useCardIn<T extends Element>(key: string): { current: T | null } {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    void fx.cardIn(ref.current, { card: key });
  }, [key]);
  return ref;
}

/** 띠: 가상 뉴스 / 교과서 속 기사 / 개념 / 돌발 사건(기상도 틀) + 작은 꼬리표 */
export function CardBandLine({ band, text, kind, pages }: { band: CardBand; text: string; kind?: string | null; pages?: readonly number[] }) {
  return (
    <div class={`vc__band vc__band--${band}`} data-testid="card-band" data-band={band}>
      <span class="vc__band-text">{text}</span>
      {kind && <span class="vc__kind">{kind}</span>}
      {pages && pages.length > 0 && (
        <span class="vc__band-pages" data-testid="card-pages">
          {linkPages(pages)}
        </span>
      )}
    </div>
  );
}

/** 삽화 칸: 그림이 있으면 그림, 없거나 못 읽으면 양피지 무늬(사건 삽화는 아직 없음) */
export function CardArt({ path, alt }: { path: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [path]);
  if (!path || failed) return <div class="vc__art vc__art--pattern" aria-hidden="true" data-testid="card-art-pattern" />;
  return (
    <div class="vc__art">
      <img class="vc__art-img" src={img(path)} alt={alt} decoding="async" onError={() => setFailed(true)} />
    </div>
  );
}

/** "교과서 연결 p.000" 인용 상자 */
export function CardQuoteBox({ quote }: { quote: CardQuote }) {
  return (
    <blockquote class="vc__quote" data-testid="card-quote">
      <span class="vc__quote-tag">{linkPages(quote.pages)}</span>
      <span class="vc__quote-text">{quote.text}</span>
    </blockquote>
  );
}

/** 카드 바깥 틀 */
export function CardFrame({
  size,
  band,
  testId,
  id,
  short,
  panel,
  children,
  extraClass,
}: {
  size: CardSize;
  band: CardBand;
  testId: string;
  id: string;
  short?: boolean;
  /** 거래를 막지 않는 오른쪽 패널 모양(L1-E6·L1-E7) */
  panel?: boolean;
  children: ComponentChildren;
  extraClass?: string;
}) {
  const ref = useCardIn<HTMLElement>(id);
  return (
    <article
      ref={ref}
      class={`vc vc--${size} vc--${band}${panel ? ' vc--panel' : ''}${extraClass ? ` ${extraClass}` : ''}`}
      data-testid={testId}
      data-event={id}
      data-short={short ? '1' : '0'}
      aria-label={undefined}
    >
      {children}
    </article>
  );
}
