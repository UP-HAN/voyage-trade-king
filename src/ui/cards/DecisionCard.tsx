/**
 * 결정 카드 S13(작업 111, PRD 8.3): 선택지 카드 2~3장(좋은 점 / 걱정되는 점 / 비용) + 까닭 쓰기(선택, 40자) + [결정하기].
 * 고른 뒤에는 고른 선택지의 말(`after`)과 교과서 카드(L1-E7: p.99 흑연)를 공개한다.
 * `panel`이면 거래를 막지 않는 오른쪽 패널 모양(L1-E7 v0.3), `size='screen'`이면 공용 화면(버튼 없음).
 */
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { REASON_MAX, type DecisionModel } from './model';
import { CardBandLine, CardFrame, CardQuoteBox, type CardSize } from './parts';

export interface DecisionCardProps {
  model: DecisionModel;
  size?: CardSize;
  panel?: boolean;
  /** 이미 고른 선택지(있으면 결과 화면) */
  chosen?: string | null;
  /** 마감 때 기본값으로 채워졌는가('응답 없음') */
  noResponse?: boolean;
  onDecide?: (choice: string, reason: string) => void;
  /** 결정 버튼 막기(보내는 중·연속 클릭 가드) */
  busy?: boolean;
  children?: ComponentChildren;
  testId?: string;
}

export function DecisionCard({ model: m, size = 'student', panel, chosen, noResponse, onDecide, busy, children, testId = 'decision-card' }: DecisionCardProps) {
  const [pick, setPick] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const done = chosen != null;
  const interactive = size === 'student' && !done && !!onDecide;
  const chosenOpt = done ? m.options.find((o) => o.id === chosen) : undefined;

  return (
    <CardFrame size={size} band={m.band} testId={testId} id={m.id} panel={panel} extraClass="vc--decision">
      <CardBandLine band={m.band} text={m.bandText} kind="결정" pages={m.pages} />
      <div class="vc__text">
        <h2 class="vc__title" data-testid="card-title">
          {m.title}
        </h2>
        {m.situation.length > 0 && (
          <div class="vc__body" data-testid="card-body">
            {m.situation.map((s, i) => (
              <p key={i} class="vc__p">
                {s}
              </p>
            ))}
          </div>
        )}
        {!done && m.ask.length > 0 && <p class="vc__ask">{m.ask.join(' ')}</p>}
        {!done && (
          <div class="vc__options" role={interactive ? 'radiogroup' : undefined} aria-label="선택지" data-testid="decision-options">
            {m.options.map((o) => {
              const on = pick === o.id;
              const inner = (
                <>
                  <span class="vc__opt-label">{o.label}</span>
                  {(o.good || o.worry || o.cost) && (
                    <dl class="vc__opt-facts">
                      {o.good && (
                        <>
                          <dt>좋은 점</dt>
                          <dd>{o.good}</dd>
                        </>
                      )}
                      {o.worry && (
                        <>
                          <dt>걱정되는 점</dt>
                          <dd>{o.worry}</dd>
                        </>
                      )}
                      {o.cost && (
                        <>
                          <dt>비용</dt>
                          <dd>{o.cost}</dd>
                        </>
                      )}
                    </dl>
                  )}
                </>
              );
              return interactive ? (
                <button
                  key={o.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  class={`vc__opt${on ? ' is-on' : ''}`}
                  data-testid={`decision-opt-${o.id}`}
                  onClick={() => setPick(o.id)}
                >
                  {inner}
                </button>
              ) : (
                <div key={o.id} class="vc__opt" data-testid={`decision-opt-${o.id}`}>
                  {inner}
                </div>
              );
            })}
          </div>
        )}
        {interactive && (
          <>
            <label class="vc__reason">
              <span>까닭 쓰기(선택)</span>
              <input
                type="text"
                maxLength={REASON_MAX}
                value={reason}
                placeholder="왜 이렇게 골랐나요?"
                data-testid="decision-reason"
                onInput={(e) => setReason((e.currentTarget as HTMLInputElement).value.slice(0, REASON_MAX))}
              />
              <small class="vc__count">
                {reason.length}/{REASON_MAX}
              </small>
            </label>
            <div class="vc__foot">
              <button
                type="button"
                class="btn btn--primary vc__confirm"
                data-testid="decision-submit"
                disabled={!pick || busy}
                onClick={() => pick && onDecide?.(pick, reason.trim())}
              >
                결정하기
              </button>
            </div>
          </>
        )}
        {done && (
          <div class="vc__chosen" data-testid="decision-chosen" data-choice={chosen ?? ''}>
            <p class="vc__chosen-label">
              {noResponse ? '응답 없음 — 기본 선택: ' : '내 선택: '}
              <b>{chosenOpt?.label ?? chosen}</b>
            </p>
            {chosenOpt?.after && <p class="vc__p">{chosenOpt.after}</p>}
          </div>
        )}
        {done && m.reveal && (
          <section class="vc__reveal" data-testid="decision-reveal">
            <h3 class="vc__reveal-title">{m.reveal.title}</h3>
            {m.reveal.text && <p class="vc__p">{m.reveal.text}</p>}
            {m.reveal.quote && <CardQuoteBox quote={m.reveal.quote} />}
          </section>
        )}
        {m.unitNote && (
          <p class="vc__unit-note" data-testid="card-unit-note">
            {m.unitNote}
          </p>
        )}
        {children}
      </div>
    </CardFrame>
  );
}
