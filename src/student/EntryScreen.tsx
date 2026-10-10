/**
 * S02 학생 입장 (PRD 7.2, 8.3 S02 — v0.3.1): 방 코드 6자리 → 출석번호(1~40) + 회사 이름(2~10자) → [들어가기].
 * - 실명 칸이 없다. 입력 칸 아래 늘 보이는 안내 "실제 이름은 쓰지 않아요. 우리 회사 이름을 지어요."
 * - 회사 이름은 입력 중 `validateCompanyName`(124)으로 미리 검사(글자 수 "5/10"). 최종 판정은 호스트.
 * - 맨 위 서버 공지 띠(NoticeBanner, 공지 없으면 숨김). 방 수·이용 안내는 두지 않는다(v0.3.2).
 */
import { lazy, Suspense } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';
import { NoticeBanner, type NoticeSource } from '../ui/common/NoticeBanner';
import type { StudentState, StudentStore } from './store';
import { companyNameHint, entryErrorText, NAME_GUIDE } from './text';
import { ConfirmDialog, Modal } from './overlays';

const ConnectionTest = lazy(() => import('../ui/common/ConnectionTest'));

const SEATS = Array.from({ length: 40 }, (_, i) => i + 1);

/** 숫자만 6자리까지 */
export function cleanCode(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 6);
}

/** (작업 110) 공용 화면 QR 주소의 `?room=482137` → 방 코드(6자리가 아니면 null) */
export function roomFromUrl(href: string): string | null {
  try {
    const v = new URL(href).searchParams.get('room') ?? '';
    return /^\d{6}$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

/** (작업 110) 입장을 보낸 뒤 주소창에 남은 `room` 지우기(다른 값·해시는 그대로) */
function clearRoomFromUrl(): void {
  try {
    const u = new URL(location.href);
    if (!u.searchParams.has('room')) return;
    u.searchParams.delete('room');
    history.replaceState(history.state, '', `${u.pathname}${u.search}${u.hash}`);
  } catch {
    /* 무시 */
  }
}

export interface EntryFormValues {
  code: string;
  seat: number | null;
  name: string;
}

/** NAME_TAKEN 제안 버튼: 칸만 채우고 보내지 않는다(학생이 [들어가기]를 다시 눌러야 함) */
export function applySuggestion(form: EntryFormValues, suggestion: string): EntryFormValues {
  return { ...form, name: suggestion };
}

export function canSubmit(form: EntryFormValues): boolean {
  return form.code.length === 6 && form.seat !== null && companyNameHint(form.name).ok;
}

function CodeBoxes({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  const digits = value.padEnd(6, ' ').split('');
  return (
    <label class={`st-code${focused ? ' is-focused' : ''}`}>
      <span class="st-sr">방 코드 여섯 자리</span>
      <input
        ref={ref}
        class="st-code__input"
        data-testid="entry-code"
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        maxLength={6}
        value={value}
        onInput={(e) => onChange(cleanCode((e.target as HTMLInputElement).value))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      <span class="st-code__boxes" aria-hidden="true">
        {digits.map((d, i) => (
          <span key={i} class={`st-code__box${i === 3 ? ' st-code__box--gap' : ''}${focused && i === Math.min(value.length, 5) ? ' is-caret' : ''}`}>
            {d.trim()}
          </span>
        ))}
      </span>
    </label>
  );
}

export function EntryScreen({ store, st }: { store: StudentStore; st: StudentState }) {
  const p = st.peer;
  const saved = st.saved;
  const [code, setCode] = useState(() => (p.status === 'codeChanged' ? '' : (typeof location !== 'undefined' ? roomFromUrl(location.href) : null) ?? saved?.code ?? ''));
  const [seat, setSeat] = useState<number | null>(() => saved?.seat ?? null);
  const [name, setName] = useState(() => saved?.companyName ?? '');
  const [touchedName, setTouchedName] = useState(false);
  const [confirmReal, setConfirmReal] = useState(false);
  const [showConn, setShowConn] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  // 코드가 바뀜 화면: 기기에 남은 번호·회사 이름을 채우고 코드 칸을 비움
  useEffect(() => {
    if (p.status === 'codeChanged') {
      setCode('');
      if (saved?.seat) setSeat(saved.seat);
      if (saved?.companyName) setName(saved.companyName);
    }
  }, [p.status]);

  const hint = companyNameHint(name);
  const form: EntryFormValues = { code, seat, name };
  const busy = p.status === 'joining' || p.status === 'waitingApproval';
  const errorCode = p.status === 'idle' || st.retryingJoin ? p.errorCode : null;
  const errorText = entryErrorText(errorCode, p.error);

  const submit = (skipRealCheck = false) => {
    if (!canSubmit(form) || seat === null) return;
    if (!skipRealCheck && hint.realNameHint) {
      setConfirmReal(true);
      return;
    }
    setConfirmReal(false);
    void store.join(code, seat, hint.name);
    clearRoomFromUrl();
  };

  const newName = () => {
    setName('');
    setTouchedName(false);
    nameRef.current?.focus();
  };

  return (
    <main class="st-entry" data-testid="student-entry">
      <NoticeBanner source={store.transport as unknown as NoticeSource} />
      <div class="st-entry__body">
        <div class="st-entry__card">
          <h1 class="st-entry__title title-font">학생 화면으로 들어가요</h1>
          {p.status === 'codeChanged' && (
            <p class="st-entry__alert" role="alert" data-testid="entry-code-changed">
              선생님 화면의 새 방 코드를 입력해요. 출석번호와 회사 이름은 그대로 두면 돼요.
            </p>
          )}

          <form
            class="st-entry__form"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <div class="st-field">
              <span class="st-field__label">방 코드</span>
              <CodeBoxes value={code} onChange={setCode} autoFocus={!code} />
            </div>

            <div class="st-entry__row">
              <label class="st-field st-field--seat">
                <span class="st-field__label">출석번호</span>
                <select
                  class="st-select"
                  data-testid="entry-seat"
                  value={seat === null ? '' : String(seat)}
                  onChange={(e) => {
                    const v = (e.target as HTMLSelectElement).value;
                    setSeat(v ? Number(v) : null);
                  }}
                >
                  <option value="">번호 고르기</option>
                  {SEATS.map((n) => (
                    <option key={n} value={String(n)}>
                      {n}번
                    </option>
                  ))}
                </select>
              </label>

              <label class="st-field st-field--name">
                <span class="st-field__label">
                  회사 이름 <span class="st-field__count" data-testid="entry-name-count">{hint.count}</span>
                </span>
                <input
                  ref={nameRef}
                  class="st-input"
                  data-testid="entry-name"
                  type="text"
                  autoComplete="off"
                  maxLength={20}
                  placeholder="예: 해오름무역"
                  value={name}
                  onInput={(e) => {
                    setName((e.target as HTMLInputElement).value);
                    setTouchedName(true);
                  }}
                />
              </label>
            </div>
            <p class="st-entry__guide" data-testid="entry-guide">
              {NAME_GUIDE}
            </p>
            {touchedName && hint.message && (
              <p class="st-entry__hint" data-testid="entry-name-hint" role="status">
                {hint.message}
              </p>
            )}

            <button type="submit" class="btn btn--primary btn--large st-entry__go" data-testid="entry-submit" disabled={!canSubmit(form) || busy}>
              {p.status === 'joining' ? '들어가는 중…' : '들어가기'}
            </button>
          </form>

          {errorText && (
            <div class="st-entry__error" role="alert" data-testid="entry-error" data-code={errorCode ?? ''}>
              <p>{errorText}</p>
              {errorCode === 'NAME_TAKEN' && (
                <div class="st-entry__suggest">
                  {p.suggestions.map((s) => (
                    <button
                      type="button"
                      key={s}
                      class="btn btn--secondary"
                      data-testid="entry-suggestion"
                      onClick={() => setName(applySuggestion(form, s).name)}
                    >
                      {s}
                    </button>
                  ))}
                  <button type="button" class="btn btn--secondary" data-testid="entry-new-name" onClick={newName}>
                    새 이름 쓰기
                  </button>
                </div>
              )}
              {errorCode === 'REJOIN_DENIED' && (
                <button type="button" class="btn btn--primary" data-testid="entry-request-rejoin" onClick={() => store.requestRejoin()}>
                  선생님께 다시 들어가기 요청
                </button>
              )}
            </div>
          )}

          {p.status === 'waitingApproval' && (
            <div class="st-entry__wait" role="status" data-testid="entry-waiting-approval">
              <p>이 번호의 회사는 다른 기기에서 쓰던 회사예요.</p>
              <p>선생님께 다시 들어가기를 요청했어요. 선생님이 허락하면 바로 들어가요.</p>
              <button type="button" class="btn btn--secondary" onClick={() => store.cancelJoin()}>
                그만두기
              </button>
            </div>
          )}

          {st.approvalLost && p.status === 'reconnecting' && (
            <div class="st-entry__wait" role="alert" data-testid="entry-approval-lost">
              <p>연결이 끊겨서 허락을 기다리지 못했어요.</p>
              <p>선생님 화면이 다시 켜지면 아래 단추를 눌러요.</p>
              <button type="button" class="btn btn--primary" data-testid="entry-retry-join" onClick={() => store.requestRejoin()}>
                다시 들어가기
              </button>
            </div>
          )}
        </div>
      </div>
      <p class="st-entry__foot">
        <button type="button" class="link-small" data-testid="entry-conn-test" onClick={() => setShowConn(true)}>
          연결 테스트
        </button>
        <a class="link-small" href="#/">
          처음 화면으로
        </a>
      </p>

      {confirmReal && (
        <ConfirmDialog
          title="사람 이름처럼 보여요"
          testId="entry-realname-confirm"
          body="실제 이름 말고 회사 이름을 지어 주세요."
          cancelLabel="다시 짓기"
          okLabel="이대로 쓰기"
          onCancel={() => {
            setConfirmReal(false);
            newName();
          }}
          onOk={() => submit(true)}
        />
      )}
      {showConn && (
        <Modal title="연결 테스트" onClose={() => setShowConn(false)} testId="entry-conn-modal">
          <Suspense fallback={<p>불러오는 중…</p>}>
            <ConnectionTest />
          </Suspense>
        </Modal>
      )}
    </main>
  );
}
