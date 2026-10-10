/**
 * 대시보드 오른쪽 접힘 영역(아코디언 — 작업 137, PRD 7.5.2.2).
 * 기본은 모두 접힘. 펼친 상태는 이 브라우저(localStorage)에 기억한다 — 판마다가 아니라 교사 브라우저 기준.
 * 접힌 동안에는 안을 그리지 않는다(같은 testid가 두 곳에 생기지 않게, 30명 판에서도 가볍게).
 */
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import type { FoldId } from './now-card';

export const FOLD_KEY = 'voyage.teacher.folds';

export type FoldState = Partial<Record<FoldId, boolean>>;

export function loadFolds(storage: Pick<Storage, 'getItem'> | null = typeof localStorage !== 'undefined' ? localStorage : null): FoldState {
  try {
    const raw = storage?.getItem(FOLD_KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    if (!v || typeof v !== 'object') return {};
    const out: FoldState = {};
    for (const k of ['time', 'order', 'entry', 'worksheet', 'more'] as const) if ((v as Record<string, unknown>)[k] === true) out[k] = true;
    return out;
  } catch {
    return {};
  }
}

export function saveFolds(f: FoldState, storage: Pick<Storage, 'setItem'> | null = typeof localStorage !== 'undefined' ? localStorage : null): void {
  try {
    storage?.setItem(FOLD_KEY, JSON.stringify(f));
  } catch {
    /* 저장 못 해도 화면은 그대로 */
  }
}

/** 접힘 상태 훅: [상태, 펼치기/접기(id, open?)] */
export function useFolds(): [FoldState, (id: FoldId, open?: boolean) => void] {
  const [f, setF] = useState<FoldState>(() => loadFolds());
  const set = (id: FoldId, open?: boolean) =>
    setF((cur) => {
      const v = open ?? !cur[id];
      if (!!cur[id] === v) return cur;
      const next = { ...cur, [id]: v };
      saveFolds(next);
      return next;
    });
  return [f, set];
}

export interface FoldProps {
  id: FoldId;
  title: string;
  open: boolean;
  onToggle: (open: boolean) => void;
  /** 제목 줄 개수 배지(0이면 없음) */
  badge?: number;
  children: ComponentChildren;
}

export function Fold({ id, title, open, onToggle, badge, children }: FoldProps) {
  return (
    <section class={`t-fold${open ? ' t-fold--open' : ''}`} id={`fold-${id}`} data-testid={`fold-${id}`} data-open={open ? '1' : '0'}>
      <h2 class="t-fold__h">
        <button type="button" class="t-fold__head" data-testid={`fold-${id}-head`} aria-expanded={open} onClick={() => onToggle(!open)}>
          <span class="t-fold__arrow" aria-hidden="true">
            {open ? '▾' : '▸'}
          </span>
          <span class="t-fold__title">{title}</span>
          {!!badge && (
            <span class="t-fold__badge" data-testid={`fold-${id}-badge`}>
              {badge}
            </span>
          )}
        </button>
      </h2>
      {open && <div class="t-fold__body">{children}</div>}
    </section>
  );
}
