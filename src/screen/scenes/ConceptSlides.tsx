/**
 * (작업 152) 개념 카드 TV 슬라이드 — 교사 피드백 11번 ①②, PRD v0.3.8 7.6·16.1 결정 37.
 *
 * 가운데 차단 카드로 뜨는 개념 사건(L1-E2·L1-E4·L2-E2, 짧은 형태 포함)을 공용 화면에서 PPT처럼 한 장씩 보여 준다.
 * - 장 목록(`conceptSlides`): 제목 장 → 본문 장(1~2문장씩) → 교과서 장(`textbook` note 하나에 한 장). 짧은 형태면 교과서 장 생략.
 * - 넘김은 저절로(`slideIndexAt`): 장당 시간 = (closesAt − openedAt) / 장 수, closesAt이 없거나 수동 진행이면 20초. 마지막 장에 머문다.
 * - 이 창 안에서 키보드 ←/→로 한 장 앞/뒤(다음 저절로 넘김 때까지 유지). 교사 대시보드에는 버튼이 없다.
 * - 공통 카드 부품(`src/ui/cards`)은 고치지 않고 사건 데이터로 직접 그린다(문장 나누기는 `eventCardModel`의 짧은 형태 규칙을 그대로 따름).
 * - 머리 띠의 `card-band`·`card-title`·`card-pages`는 예전 공용 화면 카드와 같은 testid(공용 화면 테스트 호환).
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { isBlocking } from '../../core';
import type { GameEvent } from '../../data/types';
import { img } from '../../ui/common/asset';
import { eventCardModel, linkPages } from '../../ui/cards';

export type Slide =
  | { kind: 'title'; title: string; image: string | null; pages: readonly number[] }
  | { kind: 'body'; lines: string[] }
  | { kind: 'textbook'; text: string; pages: readonly number[] };

/** 장 바뀜 없이 머무는 기본 장당 시간(closesAt 없음·수동 진행) */
export const SLIDE_DEFAULT_MS = 20_000;
/** 두 문장을 한 장에 묶는 최대 글자 수(넘으면 한 장에 한 문장) */
const PAIR_MAX_CHARS = 60;

/** 공용 화면에서 슬라이드로 보여 줄 사건인가: 개념 사건 + 가운데 차단 카드(L2-E5 같은 비차단 패널은 제외) */
export function isConceptSlideEvent(def: GameEvent | undefined, short: boolean): boolean {
  if (!def || def.kind !== 'concept' || def.isCover) return false;
  return isBlocking(def, short);
}

/** 교사·TV용 제목: 'L1 '·'L1-E2 ' 같은 개발 표기는 뺀다 */
export function displayTitle(title: string): string {
  return title.replace(/^L\d+(?:-[A-Z0-9]+)?\s*[:·\-–—]?\s*/, '').trim() || title;
}

/** "교과서 96쪽" / "교과서 98~99쪽" / "교과서 101, 104쪽" */
export function pagesText(pages: readonly number[]): string {
  if (!pages.length) return '';
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const contiguous = sorted.every((p, i) => i === 0 || p === sorted[i - 1] + 1);
  const label = sorted.length > 1 && contiguous ? `${sorted[0]}~${sorted[sorted.length - 1]}` : sorted.join(', ');
  return `교과서 ${label}쪽`;
}

/** 문장 목록을 한 장에 1~2문장씩 묶는다(두 문장 합이 길면 한 장에 하나) */
function groupLines(lines: readonly string[]): string[][] {
  const out: string[][] = [];
  let cur: string[] = [];
  for (const s of lines) {
    if (cur.length === 1 && cur[0].length + s.length <= PAIR_MAX_CHARS) {
      cur.push(s);
      out.push(cur);
      cur = [];
      continue;
    }
    if (cur.length) out.push(cur);
    cur = [s];
  }
  if (cur.length) out.push(cur);
  return out;
}

/**
 * 사건 데이터로 슬라이드 목록을 만든다(순수 함수).
 * 본문 문장은 학생 카드와 같은 규칙(`eventCardModel`)으로 고른다 — 짧은 형태 L1-E2는 고려 예시를 빼고, L1-E4는 상황 1개만.
 */
export function conceptSlides(def: GameEvent, { short }: { short: boolean }): Slide[] {
  const m = eventCardModel(def, { short });
  const slides: Slide[] = [{ kind: 'title', title: displayTitle(def.title), image: def.image ?? null, pages: def.pages }];
  const marks = ['①', '②', '③', '④', '⑤'];
  for (const lines of groupLines(m.paragraphs)) slides.push({ kind: 'body', lines });
  for (const lines of groupLines(m.situations.map((s, i) => `${marks[i] ?? `${i + 1}.`} ${s.title}`))) slides.push({ kind: 'body', lines });
  if (!m.short) {
    for (const t of def.textbook) slides.push({ kind: 'textbook', text: t.note, pages: t.pages.length ? t.pages : def.pages });
  }
  return slides;
}

/** 지금 장 번호(0부터) — 마지막 장에 머문다 */
export function slideIndexAt(total: number, openedAt: number, closesAt: number | null, now: number, manual = false): number {
  if (total <= 1) return 0;
  const per = !manual && typeof closesAt === 'number' && closesAt > openedAt ? (closesAt - openedAt) / total : SLIDE_DEFAULT_MS;
  const k = Math.floor((now - openedAt) / per);
  return Math.max(0, Math.min(total - 1, k));
}

export interface ConceptSlidesProps {
  def: GameEvent;
  short: boolean;
  openedAt: number;
  closesAt: number | null;
  now: number;
  manual?: boolean;
  /** 응답 수 등 아래에 붙일 내용 */
  children?: ComponentChildren;
}

export function ConceptSlides({ def, short, openedAt, closesAt, now, manual = false, children }: ConceptSlidesProps) {
  const slides = conceptSlides(def, { short });
  const n = slides.length;
  const auto = slideIndexAt(n, openedAt, closesAt, now, manual);
  // ←/→로 옮긴 장: 다음 저절로 넘김(auto가 바뀜)까지 유지
  const [nudge, setNudge] = useState<{ auto: number; idx: number; ev: string } | null>(null);
  const k = nudge && nudge.auto === auto && nudge.ev === def.id ? Math.max(0, Math.min(n - 1, nudge.idx)) : auto;
  const kRef = useRef({ k, auto, n, id: def.id });
  kRef.current = { k, auto, n, id: def.id };

  useEffect(() => {
    const w = typeof window !== 'undefined' ? window : null;
    if (!w || typeof w.addEventListener !== 'function') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const c = kRef.current;
      const next = Math.max(0, Math.min(c.n - 1, c.k + (e.key === 'ArrowRight' ? 1 : -1)));
      setNudge({ auto: c.auto, idx: next, ev: c.id });
    };
    w.addEventListener('keydown', onKey);
    return () => w.removeEventListener('keydown', onKey);
  }, []);

  // 넘침 막기: 본문이 칸을 넘으면 글자 한 단계 줄임
  const bodyRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ key: string; small: boolean }>({ key: '', small: false });
  const fitKey = `${def.id}:${short ? 1 : 0}:${k}`;
  useLayoutEffect(() => {
    const el = bodyRef.current as (HTMLElement & { scrollHeight?: number; clientHeight?: number }) | null;
    if (!el) return;
    const over = typeof el.scrollHeight === 'number' && typeof el.clientHeight === 'number' && el.clientHeight > 0 && el.scrollHeight > el.clientHeight + 1;
    if (fit.key !== fitKey) setFit({ key: fitKey, small: over });
  }, [fitKey]);
  const small = fit.key === fitKey && fit.small;

  const s = slides[k];
  const title = displayTitle(def.title);
  return (
    <section class="scr-slides" data-testid="concept-slides" data-event={def.id} data-slide={k} data-total={n} aria-roledescription="슬라이드" aria-label={title}>
      {s.kind !== 'title' && (
        <header class="scr-slides__head">
          <span class="scr-slides__band" data-testid="card-band">
            개념
          </span>
          <span class="scr-slides__head-title" data-testid="card-title">
            {title}
          </span>
          <span class="scr-slides__head-pages" data-testid="card-pages">
            {linkPages(def.pages)}
          </span>
        </header>
      )}
      <div key={k} ref={bodyRef} class={`scr-slide scr-slide--${s.kind}${small ? ' scr-slide--small' : ''}`} data-testid="concept-slide" data-kind={s.kind}>
        {s.kind === 'title' && (
          <>
            <p class="scr-slide__kicker" data-testid="card-band">
              개념 공부
            </p>
            {s.image && <SlideImage path={s.image} alt={`${s.title} 그림`} />}
            <h2 class="scr-slide__title" data-testid="card-title">
              {s.title}
            </h2>
            {s.pages.length > 0 && (
              <p class="scr-slide__pages" data-testid="slide-pages">
                {pagesText(s.pages)}
              </p>
            )}
          </>
        )}
        {s.kind === 'body' && (
          <div class="scr-slide__lines" data-testid="slide-body">
            {s.lines.map((line, i) => (
              <p key={i} class="scr-slide__line">
                {line}
              </p>
            ))}
          </div>
        )}
        {s.kind === 'textbook' && (
          <figure class="scr-slide__book" data-testid="slide-textbook">
            <span class="scr-slide__book-tag">교과서</span>
            <blockquote class="scr-slide__book-text">{s.text}</blockquote>
            <figcaption class="scr-slide__pages" data-testid="slide-pages">
              {pagesText(s.pages)}
            </figcaption>
          </figure>
        )}
      </div>
      <footer class="scr-slides__foot">
        <span class="scr-slides__dots" aria-hidden="true" data-testid="slide-dots">
          {slides.map((_, i) => (i === k ? '●' : '○')).join('')}
        </span>
        <span class="scr-slides__num" data-testid="slide-num">
          {k + 1} / {n}
        </span>
        {children}
      </footer>
    </section>
  );
}

function SlideImage({ path, alt }: { path: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [path]);
  if (failed) return null;
  return <img class="scr-slide__img" src={img(path)} alt={alt} decoding="async" onError={() => setFailed(true)} />;
}
