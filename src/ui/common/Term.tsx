/**
 * 용어 밑줄 + 교과서 풀이 말풍선 (PRD 8.1-4) — 작업 108.
 * `<Term id="tariff" />` → 밑줄 친 "관세"(버튼). 누르면 말풍선: 풀이 문장 + "교과서 108쪽". 다시 누르거나 Esc·바깥 누르면 닫힘.
 * 글자를 바꾸려면 `<Term id="export">수출해요</Term>`(풀이는 같은 항목).
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { pageLabel } from '../../data/text';
import { termsById, type TermId } from '../../data/terms';
import './trade-ui.css';

export interface TermProps {
  id: TermId;
  children?: ComponentChildren;
  /** 말풍선을 위로 띄움(화면 아래쪽에서 쓸 때) */
  up?: boolean;
}

export function Term({ id, children, up }: TermProps) {
  const def = termsById[id];
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open || typeof document === 'undefined' || typeof document.addEventListener !== 'function') return undefined;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onDown = (e: Event) => {
      const el = ref.current;
      if (el && e.target instanceof Node && !el.contains(e.target)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open]);
  if (!def) return <>{children}</>;
  return (
    <span class={`term${open ? ' is-open' : ''}${up ? ' term--up' : ''}`} ref={ref} data-term={id}>
      <button type="button" class="term__word" aria-expanded={open} data-testid={`term-${id}`} onClick={() => setOpen(!open)}>
        {children ?? def.word}
      </button>
      {open && (
        <span class="term__bubble" role="note" data-testid={`term-bubble-${id}`}>
          <strong class="term__title">{def.word}</strong>
          <span class="term__text">{def.text}</span>
          <span class="term__pages">{pageLabel(def.pages)}</span>
        </span>
      )}
    </span>
  );
}

export default Term;
