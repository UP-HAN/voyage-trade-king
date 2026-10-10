/**
 * '지금 할 일' 카드 화면(작업 137, PRD 7.5.2.1) — `now-card.ts`가 고른 카드를 그리기만 한다.
 *
 * 꼬리표 · 한 줄(24px 이상) · 보조 정보 · 큰 버튼 하나(높이 56px·너비 200px 이상) · [잠깐 멈춤] · 작은 글자 버튼 · 알림 줄 · "TV: ○○".
 * - 큰 버튼은 누른 뒤 상태가 바뀔 때까지(최대 1.5초), 그리고 바뀌었더라도 0.6초 동안은 다시 눌리지 않는다(두 번 눌러 두 단계 넘어감 방지).
 *   확인 창에서 [취소]하면 바로 다시 켜진다.
 * - 상태가 바뀌면 0.2초 페이드·강조(`prefers-reduced-motion`이면 없음 — teacher.css).
 * - data-testid: 카드 `now-card`(data-state), 큰 버튼 자리 `now-primary`(안의 버튼은 기존 시험이 쓰던 testid), 멈춤 자리 `now-pause`.
 */
import { useEffect, useState } from 'preact/hooks';
import type { NowButton, NowCard as Card } from './now-card';
import { WorksheetPdfMenu } from './WorksheetPdfMenu';
import { CheckIcon } from './ui';

/** 누른 뒤 최소로 막는 시간(ms) — 상태가 금방 바뀌어도 두 번째 클릭이 다음 단계로 가지 않게 */
export const PRESS_MIN_MS = 600;
/** 상태가 바뀌지 않을 때 다시 켜지는 시간(ms) */
export const PRESS_MAX_MS = 1500;

export interface NowCardProps {
  card: Card;
  /** 버튼 동작. false를 돌려주면(확인 창 취소) 큰 버튼을 바로 다시 켠다 */
  onAction: (b: NowButton) => Promise<boolean | void> | boolean | void;
  /** 진행 중인 학급의 차시(학습지 PDF 강조) */
  lesson?: string | null;
}

function SmallButton({ b, onAction }: { b: NowButton; onAction: NowCardProps['onAction'] }) {
  return (
    <button type="button" class="t-now__small" data-testid={b.testId} disabled={b.disabled} onClick={() => void onAction(b)}>
      {b.label}
    </button>
  );
}

export function NowCard({ card, onAction }: NowCardProps) {
  const [busy, setBusy] = useState<{ key: string; minPassed: boolean } | null>(null);
  useEffect(() => {
    if (!busy) return;
    const a = setTimeout(() => setBusy((b) => (b ? { ...b, minPassed: true } : b)), PRESS_MIN_MS);
    const z = setTimeout(() => setBusy(null), PRESS_MAX_MS);
    return () => {
      clearTimeout(a);
      clearTimeout(z);
    };
  }, [busy?.key]);
  const locked = !!busy && (!busy.minPassed || busy.key === card.key);

  const press = async (b: NowButton) => {
    if (locked) return;
    setBusy({ key: card.key, minPassed: false });
    let r: boolean | void = undefined;
    try {
      r = await onAction(b);
    } finally {
      if (r === false) setBusy(null);
    }
  };

  const p = card.primary;
  return (
    <section class={`t-now t-now--${card.state}`} data-testid="now-card" data-state={card.state} data-manual={card.manual ? '1' : '0'} aria-label="지금 할 일">
      <div class="t-now__head">
        <span class="t-now__title">지금 할 일</span>
        <span class="t-now__tag" data-testid="now-tag">
          {card.tag}
        </span>
        <span class="t-grow" />
        {card.state !== 'ended' && <span class={`t-now__tv t-now__tv--${card.tv.kind}`} data-testid="tv-chip" data-kind={card.tv.kind} data-scene={card.tv.scene ?? ''}>
          {card.tv.text}
          {card.tv.button && (
            <button type="button" class="t-now__small t-now__small--tv" data-testid={card.tv.button.testId} onClick={() => void onAction(card.tv.button!)}>
              {card.tv.button.label}
            </button>
          )}
        </span>}
      </div>
      <div class="t-now__body">
        <div class="t-now__text" key={`${card.state}:${card.line}`}>
          <p class="t-now__line" data-testid={card.lineTestId ?? 'now-line'} data-event={card.eventId}>
            {card.line}
          </p>
          {card.sub.length > 0 && (
            <ul class="t-now__sub">
              {card.sub.map((s, i) => (
                <li key={i} class={`${s.strong ? 't-now__strong' : ''}${s.check !== undefined ? ' t-now__check' : ''}`} data-testid={s.testId} data-event={s.eventId}>
                  {s.check !== undefined && (s.check ? <CheckIcon label="됨" /> : <span class="t-now__box" aria-hidden="true" />)}
                  <span>{s.text}</span>
                  {s.pdfLink && <WorksheetPdfMenu variant="menu" label="학습지 열기" />}
                </li>
              ))}
            </ul>
          )}
          {card.secondary && <SmallButton b={card.secondary} onAction={onAction} />}
        </div>
        <div class="t-now__acts">
          {p && (
            <div class="t-now__primary" data-testid="now-primary" data-kind={p.kind}>
              <button
                type="button"
                class={`btn btn--large t-now__big t-now__big--${p.tone ?? 'primary'}`}
                data-testid={p.testId}
                disabled={p.disabled || locked}
                aria-disabled={p.disabled || locked ? 'true' : undefined}
                onClick={() => void press(p)}
              >
                {p.label}
                <svg class="t-now__arrow" viewBox="0 0 12 14" width="12" height="14" aria-hidden="true">
                  <path d="M1 1l10 6-10 6z" fill="currentColor" />
                </svg>
              </button>
              {p.reason && (
                <span class="t-now__reason" data-testid="now-reason">
                  {p.reason}
                </span>
              )}
            </div>
          )}
          {card.showPause && (
            <span class="t-now__pause" data-testid="now-pause">
              <button
                type="button"
                class="btn btn--secondary t-btn-sm"
                data-testid="btn-pause"
                onClick={() => void onAction({ label: '잠깐 멈춤', kind: 'pause' })}
              >
                잠깐 멈춤
              </button>
            </span>
          )}
          {/* 멈춤 중에는 [잠깐 멈춤] 자리를 비워 둔다 — 큰 버튼([이어서 하기])이 그 자리로 움직여 두 번째 클릭을 받지 않게 */}
          {card.state === 'paused' && <span class="t-now__pause t-now__pause--ph" aria-hidden="true" />}
        </div>
      </div>
      {card.notes.length > 0 && (
        <ul class="t-now__notes" data-testid="now-notes">
          {card.notes.map((n) => (
            <li key={n.id} data-testid={n.testId}>
              <span class="t-now__bang" aria-hidden="true">
                !
              </span>
              <span>{n.text}</span>
              {n.buttons.map((b) => (
                <SmallButton key={b.label} b={b} onAction={onAction} />
              ))}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
