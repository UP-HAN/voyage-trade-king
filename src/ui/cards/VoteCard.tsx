/**
 * (작업 172) 투표 공통 카드 — 학급 투표(L3-E4 부산 자동화 항만, 173의 L4-E1 1970 철강)가 같은 틀을 쓴다.
 *
 * - 학생(`size='student'`): 질문 + 두 버튼 → "투표했어요 · 결과를 기다려요". 마감 뒤에는 학급 결과 한 줄.
 * - 공용 화면(`size='screen'`): 질문 + "투표한 회사 n/m"(버튼 없음). 결과 막대는 BarsScene(`voteResultLine`).
 * - 누가 어디에 투표했는지는 어디에도 보이지 않는다(학생은 자기 표만 안다).
 */
import type { ComponentChildren } from 'preact';
import type { GameEvent } from '../../data/types';
import { BAND_TEXT, bandOf, splitSentences } from './model';
import { CardBandLine, CardFrame, type CardSize } from './parts';

export interface VoteCardProps {
  def: GameEvent;
  size?: CardSize;
  /** 내가 넣은 표(선택지 ID) */
  voted?: string | null;
  onVote?: (vote: string) => void;
  /** 마감한 뒤 결과 한 줄(있으면) */
  result?: string | null;
  children?: ComponentChildren;
}

/** 본문 → 소식(앞 문장들)·질문(마지막 물음 문장) */
export function voteParts(def: Pick<GameEvent, 'body' | 'title'>): { news: string[]; question: string } {
  const s = splitSentences(def.body && def.body !== 'TODO' ? def.body : '');
  const qi = s.map((x) => x.endsWith('?')).lastIndexOf(true);
  if (qi < 0) return { news: s, question: def.title };
  return { news: s.slice(0, qi), question: s[qi]! };
}

/** 투표 결과 한 줄(학생·TV 같음) */
export function voteResultLine(def: Pick<GameEvent, 'id' | 'options'>, result: string | null | undefined): string | null {
  if (!result) return null;
  const yes = def.options?.[0]?.id;
  if (def.id === 'L3-E4') return result === yes ? '찬성이 더 많아요 — 모두 50만 원씩 모아 부산에 자동화 항만을 만들어요' : '찬성이 더 많지 않아요 — 자동화 항만을 만들지 않아요';
  const label = def.options?.find((o) => o.id === result)?.label ?? result;
  return `우리 반 결과: ${label}`;
}

export function VoteCard({ def, size = 'student', voted, onVote, result, children }: VoteCardProps) {
  const band = bandOf(def);
  const { news, question } = voteParts(def);
  const interactive = size === 'student' && !voted && !!onVote && !result;
  const myLabel = voted ? def.options?.find((o) => o.id === voted)?.label ?? voted : null;
  return (
    <CardFrame size={size} band={band} testId="vote-card" id={def.id} extraClass="vc--vote">
      <CardBandLine band={band} text={BAND_TEXT[band]} kind="학급 투표" pages={def.pages} />
      <div class="vc__text">
        <h2 class="vc__title" data-testid="card-title">
          {def.title}
        </h2>
        {news.length > 0 && (
          <div class="vc__body" data-testid="vote-news">
            {news.map((s, i) => (
              <p key={i} class="vc__p">
                {s}
              </p>
            ))}
          </div>
        )}
        <p class="vc__ask vc__vote-q" data-testid="vote-question">
          {question}
        </p>
        {interactive && (
          <div class="vc__vote-btns" role="group" aria-label="투표">
            {(def.options ?? []).map((o) => (
              <button key={o.id} type="button" class="btn btn--primary vc__vote-btn" data-testid={`vote-${o.id}`} onClick={() => onVote?.(o.id)}>
                {o.label}
              </button>
            ))}
          </div>
        )}
        {size === 'student' && voted && !result && (
          <p class="vc__chosen" data-testid="vote-done" data-vote={voted}>
            투표했어요({myLabel}) · 결과를 기다려요
          </p>
        )}
        {result && (
          <p class="vc__vote-result" data-testid="vote-result">
            {result}
          </p>
        )}
        <p class="vc__vote-secret">누가 어디에 투표했는지는 아무도 볼 수 없어요.</p>
        {children}
      </div>
    </CardFrame>
  );
}
