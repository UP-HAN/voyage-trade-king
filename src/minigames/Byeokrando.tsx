/**
 * 벽란도 시장(L1-E1, PRD 6.12.1, 교과서 p.95~96) — 개인 미니게임(작업 113).
 *
 * 1) 나누기: 상품 카드(전체 9장 / 짧은 형태 5장)를 "다른 나라 상인이 판 물건" / "사 간 물건" 바구니로.
 *    끌어 놓기(마우스·터치 — Pointer Events) + 접근성 대안(카드 누르기 → 바구니 누르기, 키보드도 같음).
 * 2) [다 넣었어요] → 정답 공개: 맞은 카드 초록 테두리, 틀린 카드는 올바른 바구니로 옮기고 짧은 이유(p.95). 보너스 = 첫 제출 기준.
 * 3) 정의 카드(무역·수입·수출, p.96) + 재분류 질문(전체 형태만): 고려 입장에서 비단은? 인삼은?
 * 4) [마치기] → 결과(`respondEvent` { answers }: 첫 제출 배치)를 보낸다. 채점·보상은 호스트가 같은 규칙으로 다시 한다.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { byeokrando, type ByeokrandoItemId, type ByeokrandoSide } from '../data/byeokrando';
import { termsById } from '../data/terms';
import { img, imgSrcSet } from '../ui/common/asset';
import {
  allPlaced,
  byeokrandoBonus,
  byeokrandoBonusRule,
  byeokrandoCards,
  byeokrandoItem,
  byeokrandoReason,
  gradeByeokrando,
  manwon,
  reclassQuestions,
  saveKey,
  TRADE_WORD_LABEL,
  type Placement,
  type TradeWord,
} from './logic';
import { GoodsImg, MinigameFrame, OptionalImg, usePersisted, useResultSender } from './shared';
import type { MinigameGameProps } from './types';

type Step = 'sort' | 'reveal' | 'define' | 'done';

interface Saved {
  v: 1;
  step: Step;
  place: Placement;
  /** 첫 제출 배치(보너스 기준) */
  first: Placement | null;
  reclass: Partial<Record<ByeokrandoItemId, TradeWord>>;
  sent: boolean;
}

const MERCHANTS = [
  { src: 'characters/byeokrando-song.png', label: '송나라 상인' },
  { src: 'characters/byeokrando-arab.png', label: '아라비아 상인' },
  { src: 'characters/byeokrando-goryeo.png', label: '고려 상인' },
] as const;

const SIDES: readonly ByeokrandoSide[] = ['sold', 'bought'];

/** 끌기 시작으로 볼 거리(px) — 그보다 짧으면 누르기 */
const DRAG_START_PX = 8;

export function Byeokrando({ eventId, short, catchUp, player, act, onDone, alreadyDone }: MinigameGameProps) {
  const cards = byeokrandoCards(short);
  const [s, set] = usePersisted<Saved>(saveKey(player.pid, eventId), 1, () => ({ v: 1, step: 'sort', place: {}, first: null, reclass: {}, sent: false }));
  const sender = useResultSender(eventId, act, s.sent || alreadyDone);
  const [selected, setSelected] = useState<ByeokrandoItemId | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // 첫 제출이 끝났으면 보낼 결과를 기억(화면이 닫히면 그때 보냄)
  useEffect(() => {
    sender.setPending(s.first && !s.sent ? { answers: s.first as Record<string, string> } : null);
  }, [s.first, s.sent]);

  const kicker = (
    <>
      {catchUp ? '놓친 활동 · ' : '활동 · '}고려 시대 벽란도 항구(교과서 p.95){short && <span class="mg-tag" data-testid="minigame-short">짧게</span>}
    </>
  );
  const frame = (step: string, body: JSX.Element, extra?: JSX.Element) => (
    <MinigameFrame id={eventId} game="byeokrando" title={byeokrando.title} kicker={kicker} bg={img(byeokrando.scene)} bgSet={imgSrcSet(byeokrando.scene)} step={step} extra={extra}>
      {body}
    </MinigameFrame>
  );

  // 이미 한 사건(교사가 다시 보냄 등): 결과만
  if (alreadyDone && !s.first) {
    const r = player.game.responses[eventId] as { correct?: number; total?: number } | undefined;
    return frame(
      'already',
      <div class="mg-body mg-center">
        <p class="mg-lead" data-testid="minigame-already">
          이미 했어요{typeof r?.correct === 'number' ? ` — ${r.total ?? cards.length}장 중 ${r.correct}장 맞혔어요.` : '.'}
        </p>
        <button type="button" class="btn btn--primary" data-testid="minigame-finish" onClick={onDone}>
          닫기
        </button>
      </div>,
    );
  }

  const finish = () => {
    const r = sender.send();
    if (r === 'guard') return;
    if (r === 'fail') {
      setMsg('보내지 못했어요. 연결을 확인하고 다시 눌러요.');
      return;
    }
    set((x) => ({ ...x, sent: true, step: 'done' }));
    onDone();
  };

  // ── 1) 나누기 ──
  if (s.step === 'sort' || !s.first) {
    const place = (id: ByeokrandoItemId, side: ByeokrandoSide | null) => {
      set((x) => {
        const p = { ...x.place };
        if (side) p[id] = side;
        else delete p[id];
        return { ...x, place: p };
      });
      setSelected(null);
    };
    const ready = allPlaced(s.place, short);
    const submit = () => {
      if (!ready || !sender.guard()) return;
      set((x) => ({ ...x, first: { ...x.place }, step: 'reveal' }));
    };
    return frame(
      'sort',
      <SortBoard cards={cards.map((c) => c.id)} place={s.place} selected={selected} setSelected={setSelected} onPlace={place} ready={ready} onSubmit={submit} short={short} />,
      <Merchants />,
    );
  }

  const g = gradeByeokrando(s.first, short);
  const bonus = byeokrandoBonus(g.correct, short);
  const rule = byeokrandoBonusRule(short);

  // ── 2) 정답 공개 ──
  if (s.step === 'reveal') {
    return frame(
      'reveal',
      <div class="mg-body">
        <p class="mg-score" data-testid="bk-score" data-correct={g.correct} data-total={g.total}>
          <b class="mg-big">{g.correct}</b>/{g.total}장 맞혔어요! 시작 자금 보너스 <b class="mg-big" data-testid="bk-bonus">{manwon(bonus)}</b>
          <span class="mg-rule">
            [게임 설정] 첫 제출에서 맞힌 수 × {rule.per}만 원(최대 {rule.max}만 원)
          </span>
        </p>
        <div class="bk-baskets bk-baskets--reveal">
          {SIDES.map((side) => (
            <div key={side} class={`bk-basket bk-basket--${side}`} data-testid={`bk-basket-${side}`} data-basket={side}>
              <p class="bk-basket__label">{byeokrando.baskets[side]}</p>
              <ul class="bk-rows">
                {cards
                  .filter((c) => c.answer === side)
                  .map((c) => {
                    const ok = s.first![c.id] === c.answer;
                    return (
                      <li key={c.id} class={`bk-row ${ok ? 'is-ok' : 'is-moved'}`} data-testid="bk-reveal-card" data-item={c.id} data-ok={ok ? '1' : '0'}>
                        <GoodsImg src={img(c.image)} name={c.name} class="bk-row__img" />
                        <b class="bk-row__name">{c.name}</b>
                        {ok ? <span class="bk-row__mark">맞았어요</span> : <span class="bk-row__why">옮겼어요 — {byeokrandoReason(c.id)}</span>}
                      </li>
                    );
                  })}
              </ul>
            </div>
          ))}
        </div>
        <blockquote class="mg-quote">
          “{lastSentence(byeokrando.textbook.note)}” <cite>교과서 p.95</cite>
        </blockquote>
        <div class="mg-foot">
          <button
            type="button"
            class="btn btn--primary"
            data-testid="bk-next"
            onClick={() => {
              if (sender.guard()) set((x) => ({ ...x, step: 'define' }));
            }}
          >
            다음
          </button>
        </div>
      </div>,
    );
  }

  // ── 3) 정의 카드 + 재분류 질문 ──
  const qs = reclassQuestions(short);
  const allAnswered = qs.every((q) => s.reclass[q.item]);
  return frame(
    'define',
    <div class="mg-body">
      <section class="bk-define" data-testid="bk-define">
        <p class="bk-define__head">
          <b>무역·수입·수출</b> <span class="mg-pages">교과서 p.96</span>
        </p>
        <dl class="bk-terms">
          {(['trade', 'import', 'export'] as const).map((id) => (
            <div key={id} class="bk-term">
              <dt>{termsById[id].word}</dt>
              <dd>{termsById[id].text}</dd>
            </div>
          ))}
        </dl>
      </section>
      {qs.length > 0 && (
        <section class="bk-reclass" data-testid="bk-reclass">
          <p class="bk-reclass__head">{byeokrando.reclassify.prompt}</p>
          {qs.map((q) => {
            const picked = s.reclass[q.item];
            const it = byeokrandoItem(q.item);
            return (
              <div key={q.item} class="bk-q" data-testid="bk-q" data-item={q.item}>
                <GoodsImg src={img(it.image)} name={it.name} class="bk-q__img" />
                <p class="bk-q__text">{q.question}</p>
                <div class="bk-q__btns">
                  {(['import', 'export'] as const).map((w) => (
                    <button
                      key={w}
                      type="button"
                      class={`btn ${picked === w ? 'btn--primary' : 'btn--secondary'}${picked && w === q.answer ? ' is-answer' : ''}`}
                      data-testid={`bk-q-${w}`}
                      disabled={!!picked}
                      aria-pressed={picked === w}
                      onClick={() => {
                        if (!picked && sender.guard()) set((x) => ({ ...x, reclass: { ...x.reclass, [q.item]: w } }));
                      }}
                    >
                      {TRADE_WORD_LABEL[w]}
                    </button>
                  ))}
                </div>
                {picked && (
                  <p class={`bk-q__result ${picked === q.answer ? 'is-ok' : 'is-no'}`} data-testid="bk-q-result" data-ok={picked === q.answer ? '1' : '0'}>
                    <b>{picked === q.answer ? '맞았어요!' : `정답은 ${TRADE_WORD_LABEL[q.answer]}이에요.`}</b> {q.explain} <span class="mg-pages">p.96</span>
                  </p>
                )}
              </div>
            );
          })}
        </section>
      )}
      <div class="mg-foot">
        {msg && (
          <p class="mg-msg" role="alert">
            {msg}
          </p>
        )}
        <button type="button" class="btn btn--primary btn--large" data-testid="minigame-finish" disabled={!allAnswered} onClick={finish}>
          마치기
        </button>
      </div>
    </div>,
  );
}

function lastSentence(text: string): string {
  const parts = text.split(/(?<=\.)\s+/).filter(Boolean);
  return parts[parts.length - 1] ?? text;
}

function Merchants() {
  return (
    <div class="bk-merchants" aria-label="벽란도에 모인 상인들">
      {MERCHANTS.map((m) => (
        <figure key={m.src} class="bk-merchant">
          <OptionalImg src={img(m.src)} alt={m.label} class="bk-merchant__img" />
          <figcaption>{m.label}</figcaption>
        </figure>
      ))}
    </div>
  );
}

// ─── 나누기 판(끌어 놓기 + 누르기) ─────────────────────────────

interface DragState {
  id: ByeokrandoItemId;
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
}

function dropTargetAt(x: number, y: number): ByeokrandoSide | 'tray' | null {
  if (typeof document === 'undefined' || typeof document.elementFromPoint !== 'function') return null;
  const el = document.elementFromPoint(x, y);
  const zone = el && (el as Element).closest ? (el as Element).closest('[data-drop]') : null;
  const v = zone?.getAttribute('data-drop');
  return v === 'sold' || v === 'bought' || v === 'tray' ? v : null;
}

function SortBoard({
  cards,
  place,
  selected,
  setSelected,
  onPlace,
  ready,
  onSubmit,
  short,
}: {
  cards: ByeokrandoItemId[];
  place: Placement;
  selected: ByeokrandoItemId | null;
  setSelected: (id: ByeokrandoItemId | null) => void;
  onPlace: (id: ByeokrandoItemId, side: ByeokrandoSide | null) => void;
  ready: boolean;
  onSubmit: () => void;
  short: boolean;
}) {
  const drag = useRef<DragState | null>(null);
  const suppressClick = useRef(false);
  const [ghost, setGhost] = useState<{ id: ByeokrandoItemId; x: number; y: number } | null>(null);
  const [hover, setHover] = useState<ByeokrandoSide | 'tray' | null>(null);

  const cardProps = (id: ByeokrandoItemId) => ({
    onPointerDown: (e: PointerEvent) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      drag.current = { id, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, moved: false };
      try {
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      } catch {
        /* 무시 */
      }
    },
    onPointerMove: (e: PointerEvent) => {
      const d = drag.current;
      if (!d || d.pointerId !== e.pointerId) return;
      if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_START_PX) return;
      d.moved = true;
      e.preventDefault();
      setGhost({ id: d.id, x: e.clientX, y: e.clientY });
      setHover(dropTargetAt(e.clientX, e.clientY));
    },
    onPointerUp: (e: PointerEvent) => {
      const d = drag.current;
      drag.current = null;
      if (!d || d.pointerId !== e.pointerId) return;
      setGhost(null);
      setHover(null);
      if (!d.moved) return; // 누르기는 click에서
      suppressClick.current = true;
      setTimeout(() => (suppressClick.current = false), 0);
      const t = dropTargetAt(e.clientX, e.clientY);
      if (t === 'sold' || t === 'bought') onPlace(d.id, t);
      else if (t === 'tray') onPlace(d.id, null);
    },
    onPointerCancel: () => {
      drag.current = null;
      setGhost(null);
      setHover(null);
    },
    onClick: () => {
      if (suppressClick.current) {
        suppressClick.current = false;
        return;
      }
      setSelected(selected === id ? null : id);
    },
  });

  const card = (id: ByeokrandoItemId, inBasket: boolean) => {
    const it = byeokrandoItem(id);
    const isSel = selected === id;
    return (
      <button
        key={id}
        type="button"
        class={`bk-card${inBasket ? ' bk-card--in' : ''}${isSel ? ' is-selected' : ''}${ghost?.id === id ? ' is-dragging' : ''}`}
        data-testid="bk-card"
        data-item={id}
        data-place={place[id] ?? 'tray'}
        aria-pressed={isSel}
        aria-label={`${it.name}${isSel ? ' — 골랐어요. 넣을 바구니를 눌러요' : ''}`}
        {...cardProps(id)}
      >
        <GoodsImg src={img(it.image)} name={it.name} class="bk-card__img" />
        <span class="bk-card__name">{it.name}</span>
      </button>
    );
  };

  const trayCards = cards.filter((id) => !place[id]);
  const selName = selected ? byeokrandoItem(selected).name : null;

  return (
    <div class="mg-body bk-sort">
      <p class="mg-lead" data-testid="bk-guide">
        {selName ? (
          <>
            <b>{selName}</b>을(를) 넣을 바구니를 눌러요.
          </>
        ) : (
          <>다른 나라 상인이 벽란도에서 판 물건과 사 간 물건은 무엇일까요? 카드를 바구니로 끌어 놓거나, 카드를 누른 뒤 바구니를 눌러요.</>
        )}
      </p>
      <div
        class={`bk-tray${hover === 'tray' ? ' is-hover' : ''}`}
        data-drop="tray"
        data-testid="bk-tray"
        onClick={(e) => {
          // 바구니에 있던 카드를 고른 뒤 빈 자리를 누르면 되돌린다
          if (selected && place[selected] && (e.target as Element) === e.currentTarget) onPlace(selected, null);
        }}
      >
        {trayCards.length ? trayCards.map((id) => card(id, false)) : <span class="bk-tray__empty">카드를 모두 넣었어요.</span>}
      </div>
      <div class="bk-baskets">
        {SIDES.map((side) => {
          const inside = cards.filter((id) => place[id] === side);
          return (
            <div
              key={side}
              class={`bk-basket bk-basket--${side}${hover === side ? ' is-hover' : ''}${selected ? ' is-target' : ''}`}
              data-drop={side}
              data-basket={side}
              data-testid={`bk-basket-${side}`}
              data-count={inside.length}
            >
              <button
                type="button"
                class="bk-basket__btn"
                data-testid={`bk-basket-btn-${side}`}
                onClick={() => {
                  if (selected) onPlace(selected, side);
                }}
              >
                <BasketIcon />
                <span class="bk-basket__label">{byeokrando.baskets[side]}</span>
                <span class="bk-basket__count">{inside.length}장</span>
              </button>
              <div class="bk-basket__cards">{inside.map((id) => card(id, true))}</div>
            </div>
          );
        })}
      </div>
      <div class="mg-foot">
        <span class="mg-rule">[게임 설정] 맞힌 카드마다 시작 자금 보너스 {byeokrandoBonusRule(short).per}만 원</span>
        <button type="button" class="btn btn--primary btn--large" data-testid="bk-submit" disabled={!ready} onClick={onSubmit}>
          다 넣었어요
        </button>
      </div>
      {ghost && (
        <div class="bk-ghost" style={{ transform: `translate(${ghost.x}px, ${ghost.y}px)` }} aria-hidden="true">
          <span class="bk-card bk-card--ghost">
            <GoodsImg src={img(byeokrandoItem(ghost.id).image)} name={byeokrandoItem(ghost.id).name} class="bk-card__img" />
            <span class="bk-card__name">{byeokrandoItem(ghost.id).name}</span>
          </span>
        </div>
      )}
    </div>
  );
}

function BasketIcon() {
  return (
    <svg class="bk-basket__icon" width="34" height="28" viewBox="0 0 34 28" aria-hidden="true" focusable="false">
      <path d="M3 10h28l-3 15H6z" fill="#B8894A" stroke="#2B2318" stroke-width="1.6" stroke-linejoin="round" />
      <path d="M8 10c0-6 18-6 18 0" fill="none" stroke="#2B2318" stroke-width="1.8" />
      <path d="M6 15h22M7 20h20M12 10l1 15M17 10v15M22 10l-1 15" stroke="#8D6C2C" stroke-width="1.2" />
    </svg>
  );
}
