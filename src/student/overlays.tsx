/**
 * 학생 화면 공용 겹침 화면: 창(Modal)·확인 창·토스트·전체 화면 안내·일시정지(S25)·막힌 이름 다시 짓기.
 * 이모지 없이 SVG·글자만 쓴다.
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { fx } from '../ui/common/fx';
import type { StudentStore, Toast } from './store';
import { companyNameHint, NAME_GUIDE } from './text';

export function Modal({
  title,
  onClose,
  children,
  testId,
  wide,
  soft,
}: {
  title: string;
  onClose?: () => void;
  children: ComponentChildren;
  testId?: string;
  wide?: boolean;
  /** (작업 134) 아래 화면을 막지 않는 창(배경 없음, 왼쪽 위 카드) — 라운드 중 거래 버튼·결정 패널을 가리지 않게 */
  soft?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
    if (!onClose) return undefined;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div class={`st-modal${soft ? ' st-modal--soft' : ''}`} role="dialog" aria-modal={soft ? 'false' : 'true'} aria-label={title} data-testid={testId}>
      <div class={`st-modal__box${wide ? ' st-modal__box--wide' : ''}`} ref={ref} tabIndex={-1}>
        <div class="st-modal__head">
          <h2 class="st-modal__title title-font">{title}</h2>
          {onClose && (
            <button type="button" class="st-icon-btn" aria-label="닫기" onClick={onClose}>
              <CloseIcon />
            </button>
          )}
        </div>
        <div class="st-modal__body">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  body,
  okLabel,
  cancelLabel,
  onOk,
  onCancel,
  testId,
  focusCancel,
}: {
  title: string;
  body: string;
  okLabel: string;
  cancelLabel: string;
  onOk: () => void;
  onCancel: () => void;
  testId?: string;
  /** (작업 145) 취소 버튼에 기본 포커스(Enter·두 번 탭으로 실수로 확인하지 않게) */
  focusCancel?: boolean;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focusCancel) cancelRef.current?.focus();
  }, []);
  return (
    <Modal title={title} onClose={onCancel} testId={testId}>
      <p>{body}</p>
      <div class="st-row-btns">
        <button type="button" ref={cancelRef} class="btn btn--secondary" onClick={onCancel} data-testid="confirm-cancel">
          {cancelLabel}
        </button>
        <button type="button" class="btn btn--primary" onClick={onOk} data-testid="confirm-ok">
          {okLabel}
        </button>
      </div>
    </Modal>
  );
}

export function CloseIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6L18 18M18 6L6 18" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
    </svg>
  );
}

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  if (!toasts.length) return null;
  return (
    <div class="st-toasts" role="status" aria-live="polite" data-testid="toasts">
      {toasts.map((t) => (
        <button type="button" key={t.id} class={`st-toast st-toast--${t.kind}`} onClick={() => onDismiss(t.id)} data-testid="toast">
          {t.kind === 'arrive' && (
            <svg class="st-toast__stamp" width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
              <circle cx="15" cy="15" r="12" fill="none" stroke="#C0623F" stroke-width="2.4" />
              <circle cx="15" cy="15" r="8" fill="none" stroke="#C0623F" stroke-width="1.2" />
              <path d="M15 9V20M11 12H19M10 16Q11 21 15 21Q19 21 20 16" fill="none" stroke="#C0623F" stroke-width="1.8" stroke-linecap="round" />
            </svg>
          )}
          <span>{t.text}</span>
        </button>
      ))}
    </div>
  );
}

/** 전체 화면 안내(옮겨짐·내보내짐·판 끝 등) — 조작 막힘 */
export function FullMessage({ title, children, testId }: { title: string; children?: ComponentChildren; testId: string }) {
  return (
    <main class="st-full" data-testid={testId}>
      <div class="st-full__box" role="alert">
        <h1 class="title-font">{title}</h1>
        {children}
      </div>
    </main>
  );
}

/** S25 일시정지: "선생님을 보세요" — 모든 조작 막힘 */
export function PauseOverlay() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    void fx.pauseIn(ref.current);
    ref.current?.focus();
  }, []);
  return (
    <div class="st-pause" ref={ref} tabIndex={-1} role="alertdialog" aria-modal="true" aria-label="선생님을 보세요" data-testid="pause-overlay">
      <svg width="96" height="96" viewBox="0 0 96 96" aria-hidden="true">
        <circle cx="48" cy="48" r="44" fill="none" stroke="#DCAA48" stroke-width="4" />
        <rect x="32" y="28" width="11" height="40" rx="3" fill="#EFE2BF" />
        <rect x="53" y="28" width="11" height="40" rx="3" fill="#EFE2BF" />
      </svg>
      <p class="st-pause__title title-font">선생님을 보세요</p>
      <p>선생님이 다시 시작하면 이어서 해요.</p>
    </div>
  );
}

/** 회사 이름 입력 칸(글자 수·미리 검사) — 이름 바꾸기·막힌 이름 다시 짓기 공통 */
export function NameEditor({
  store,
  initial,
  submitLabel,
  onCancel,
  testId,
}: {
  store: StudentStore;
  initial: string;
  submitLabel: string;
  onCancel?: () => void;
  testId: string;
}) {
  const [name, setName] = useState(initial);
  const [touched, setTouched] = useState(false);
  const [confirmReal, setConfirmReal] = useState(false);
  const [req, setReq] = useState(store.getState().nameRequest);
  useEffect(() => store.subscribe((s) => setReq(s.nameRequest)), [store]);
  const hint = companyNameHint(name);
  const send = (skip = false) => {
    if (!hint.ok) return;
    if (!skip && hint.realNameHint) return setConfirmReal(true);
    setConfirmReal(false);
    store.setCompanyName(hint.name);
  };
  return (
    <form
      class="st-name-editor"
      data-testid={testId}
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <label class="st-field">
        <span class="st-field__label">
          회사 이름 <span class="st-field__count">{hint.count}</span>
        </span>
        <input
          class="st-input"
          type="text"
          maxLength={20}
          autoComplete="off"
          value={name}
          data-testid={`${testId}-input`}
          onInput={(e) => {
            setName((e.target as HTMLInputElement).value);
            setTouched(true);
          }}
        />
      </label>
      <p class="st-entry__guide">{NAME_GUIDE}</p>
      {touched && hint.message && <p class="st-entry__hint">{hint.message}</p>}
      {req.error && (
        <div class="st-entry__error" role="alert" data-testid={`${testId}-error`}>
          <p>{req.error}</p>
          {req.suggestions.length > 0 && (
            <div class="st-entry__suggest">
              {req.suggestions.map((s) => (
                <button type="button" key={s} class="btn btn--secondary" onClick={() => setName(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div class="st-row-btns">
        {onCancel && (
          <button type="button" class="btn btn--secondary" onClick={onCancel}>
            그만두기
          </button>
        )}
        <button type="submit" class="btn btn--primary" disabled={!hint.ok || req.pending} data-testid={`${testId}-submit`}>
          {req.pending ? '보내는 중…' : submitLabel}
        </button>
      </div>
      {confirmReal && (
        <ConfirmDialog
          title="사람 이름처럼 보여요"
          body="실제 이름 말고 회사 이름을 지어 주세요."
          cancelLabel="다시 짓기"
          okLabel="이대로 쓰기"
          onCancel={() => {
            setConfirmReal(false);
            setName('');
          }}
          onOk={() => send(true)}
        />
      )}
    </form>
  );
}

/** 막힌 이름: "선생님이 회사 이름을 다시 지어 달래요" — ok가 될 때까지 다른 조작 막힘 */
export function NameBlockedModal({ store }: { store: StudentStore }) {
  return (
    <div class="st-blocker" data-testid="name-blocked">
      <div class="st-modal__box" role="alertdialog" aria-modal="true" aria-label="회사 이름 다시 짓기">
        <h2 class="st-modal__title title-font">선생님이 회사 이름을 다시 지어 달래요</h2>
        <p>새 회사 이름을 지어 주세요. 이름을 정하면 바로 이어서 해요.</p>
        <NameEditor store={store} initial="" submitLabel="이 이름으로 정하기" testId="name-blocked-form" />
      </div>
    </div>
  );
}
