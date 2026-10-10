/**
 * 교과서 속 기사 카드(작업 111 틀 — L3-E1 p.106·L4-E2 p.109 사건(116·117)이 채운다).
 * 기사 원문(`src/data/text.ts` textbookArticles)을 문장으로 나눠 보여 주고, 문장을 누르면 밑줄을 긋는다(`onToggle`).
 */
import type { ComponentChildren } from 'preact';
import type { TextbookArticle } from '../../data/text';
import { BAND_TEXT, linkPages, splitSentences } from './model';
import { CardBandLine, CardFrame, type CardSize } from './parts';

export interface ArticleCardProps {
  article: TextbookArticle;
  size?: CardSize;
  /** 밑줄 그은 문장 */
  underlined?: readonly string[];
  /** 문장 누름(없으면 읽기 전용) */
  onToggle?: (sentence: string) => void;
  children?: ComponentChildren;
  testId?: string;
}

export function ArticleCard({ article, size = 'student', underlined = [], onToggle, children, testId = 'article-card' }: ArticleCardProps) {
  const sentences = splitSentences(article.body);
  const marked = new Set(underlined);
  return (
    <CardFrame size={size} band="article" testId={testId} id={article.id} extraClass="vc--article">
      <CardBandLine band="article" text={BAND_TEXT.article} pages={article.pages} />
      <div class="vc__text">
        <h2 class="vc__title" data-testid="card-title">
          {article.headline}
        </h2>
        <p class="vc__article" data-testid="article-body">
          {sentences.map((s, i) =>
            onToggle ? (
              <button
                key={i}
                type="button"
                class={`vc__sentence${marked.has(s) ? ' is-marked' : ''}`}
                aria-pressed={marked.has(s)}
                data-testid="article-sentence"
                onClick={() => onToggle(s)}
              >
                {s}
              </button>
            ) : (
              <span key={i} class={`vc__sentence${marked.has(s) ? ' is-marked' : ''}`}>
                {s}{' '}
              </span>
            ),
          )}
        </p>
        <p class="vc__source">
          {article.source} ({article.date}) · {linkPages(article.pages)}
        </p>
        {children}
      </div>
    </CardFrame>
  );
}
