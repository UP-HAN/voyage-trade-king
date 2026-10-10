/**
 * 교사 화면 공용 작은 부품(작업 109): 확인 창(포커스 가두기), 아이콘(SVG — 이모지 금지), 상태 점.
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { trapFocus } from '../ui/common/ServiceFooter';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Tab·Shift+Tab을 창 안에서 돌린다(창 밖으로 포커스가 나가지 않게) — 131 ServiceFooter와 같은 함수 */
export function trapTab(e: KeyboardEvent, box: HTMLElement | null): void {
  if (e.key === 'Tab') trapFocus(e, box);
}

export interface ModalProps {
  title: string;
  children?: ComponentChildren;
  onClose?: () => void;
  testId?: string;
  wide?: boolean;
}

/** 열린 창 순서(맨 위 창만 Esc·Tab을 받는다 — 설정 창 위에 확인 창이 뜰 때) */
const modalStack: object[] = [];

/** 모달 창: 열리면 첫 버튼(또는 data-autofocus)에 포커스, Esc로 닫기, Tab 가두기, 닫히면 원래 포커스로 */
export function Modal({ title, children, onClose, testId, wide }: ModalProps) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const me = {};
    modalStack.push(me);
    const prev = (typeof document !== 'undefined' ? document.activeElement : null) as HTMLElement | null;
    const el = box.current;
    const first = el?.querySelector<HTMLElement>('[data-autofocus]') ?? el?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? el)?.focus?.();
    const onKey = (e: KeyboardEvent) => {
      if (modalStack[modalStack.length - 1] !== me) return;
      if (e.key === 'Escape' && close.current) {
        e.preventDefault();
        close.current();
      } else trapTab(e, box.current);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      const i = modalStack.indexOf(me);
      if (i >= 0) modalStack.splice(i, 1);
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, []);
  return (
    <div class="t-backdrop" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div
        ref={box}
        class={`t-modal${wide ? ' t-modal--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        data-testid={testId ?? 't-modal'}
      >
        <h2 class="t-modal__title">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export interface ConfirmOptions {
  title: string;
  body?: string;
  /** 행동 버튼(동사로: "라운드 끝내기") */
  ok?: string;
  /** 안전한 버튼(기본 "취소") */
  cancel?: string;
  /** 되돌릴 수 없는 행동이면 빨강 */
  danger?: boolean;
  testId?: string;
}

/** 확인 창이 뜬 뒤 행동 버튼을 누를 수 없는 시간(ms) — CSS 애니메이션(.t-arm)과 같은 값 */
export const CONFIRM_ARM_MS = 500;

/**
 * 확인 창 훅(작업 137, PRD 7.5.2.6): `const [node, ask] = useConfirm(); if (await ask({...})) …`
 * - 왼쪽 안전한 버튼(기본 포커스 — Enter도 이것), 오른쪽 행동 버튼(동사, 되돌릴 수 없으면 빨강).
 * - Esc·바깥 클릭 = 안전한 버튼. 뜬 뒤 0.5초 동안 행동 버튼은 눌리지 않는다(.t-arm — 카드 큰 버튼 두 번 클릭이 확인으로 이어지지 않게).
 *   타이머 대신 CSS 애니메이션(pointer-events)이라 시험의 가짜 시계에 묶이지 않는다.
 */
export function useConfirm(): [ComponentChildren, (o: ConfirmOptions) => Promise<boolean>] {
  const [cur, setCur] = useState<(ConfirmOptions & { resolve: (v: boolean) => void; n: number }) | null>(null);
  const seq = useRef(0);
  const ask = (o: ConfirmOptions) =>
    new Promise<boolean>((resolve) => {
      seq.current += 1;
      setCur({ ...o, resolve, n: seq.current });
    });
  const done = (v: boolean) => {
    cur?.resolve(v);
    setCur(null);
  };
  const node = cur ? (
    <Modal key={cur.n} title={cur.title} onClose={() => done(false)} testId={cur.testId ?? 't-confirm'}>
      {cur.body && <p class="t-modal__body">{cur.body}</p>}
      <div class="t-modal__actions t-modal__actions--confirm">
        <button type="button" class="btn btn--secondary" data-testid="confirm-cancel" data-autofocus onClick={() => done(false)}>
          {cur.cancel ?? '취소'}
        </button>
        <button type="button" class={`btn t-arm ${cur.danger ? 't-btn--danger' : 'btn--primary'}`} data-testid="confirm-ok" onClick={() => done(true)}>
          {cur.ok ?? '확인'}
        </button>
      </div>
    </Modal>
  ) : null;
  return [node, ask];
}

/** 체크 표시(SVG) */
export function CheckIcon({ label = '했음' }: { label?: string }) {
  return (
    <svg class="t-icon t-icon--ok" viewBox="0 0 20 20" width="18" height="18" role="img" aria-label={label}>
      <path d="M4 10.5l4 4 8-9" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

/** 아직 안 함(—, SVG) */
export function DashIcon({ label = '안 함' }: { label?: string }) {
  return (
    <svg class="t-icon t-icon--no" viewBox="0 0 20 20" width="18" height="18" role="img" aria-label={label}>
      <path d="M5 10h10" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
    </svg>
  );
}

/** 작은 깃발 아이콘(회사 색) */
export function FlagIcon({ color }: { color: string }) {
  return (
    <svg class="t-flag" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M3 1.5v13" stroke="#2B2318" stroke-width="1.4" />
      <path d="M3.7 2h9l-2.2 3 2.2 3h-9z" fill={color} stroke="#2B2318" stroke-width="0.8" />
    </svg>
  );
}

/** 상태 점(글자와 함께만 쓴다) */
export function Dot({ color, label }: { color: string; label?: string }) {
  return <span class="t-dot" style={{ background: color }} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : 'true'} />;
}

export const DOT = { green: '#2E8B3E', yellow: '#D9A441', red: '#C0392B', gray: '#8A8A8A' } as const;

/**
 * (작업 137) 펼친 작은 메뉴([TV 화면 ▾]·[더 보기 ▾]): 바깥을 누르거나 Esc면 닫는다(WorksheetPdfMenu와 같은 방식).
 * 창(확인 창·설정)이 떠 있을 때의 Esc는 창이 먼저 받는다 — 메뉴는 창이 없을 때만 닫는다.
 */
export function useDismiss(open: boolean, ref: { current: HTMLElement | null }, close: () => void): void {
  useEffect(() => {
    if (!open || typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
    const onDown = (e: Event) => {
      const el = ref.current;
      if (el && typeof el.contains === 'function' && !el.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && modalStack.length === 0) close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
}
