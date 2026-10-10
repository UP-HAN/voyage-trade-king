/**
 * 판 설정 화면(작업 109, PRD 4.1.1·7.2·7.5·7.5.1 — v0.3.2).
 * ① 판 단위 카드(기본 선택 없음, 마지막 선택 기억) → ② 나머지 설정 → 오른쪽 배치 미리보기·예상 수업 시간.
 * [방 열기] 바로 위 "사용 중인 방 n/50", 바로 아래 가득 참·점검 안내 상자. 비활성 이유는 하나만(판 단위 → 시간 → 서버).
 * 방 수 상태는 부모가 `useServerRooms({ poll: true })`로 한 번 만들어 넘긴다(버튼과 두 부품이 같은 상태를 씀).
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo } from 'preact/hooks';
import { syncMode } from '../config/deploy';
import type { ItemForm, SchedulePreview } from '../core';
import { leaderboardRules } from '../data/awards';
import { activityRatio as RATIO, lessonCards, playUnits, tradeMinutes as TRADE_MINUTES, worksheetModes } from '../data/schedule';
import type { LessonId } from '../data/types';
import { NoticeBanner } from '../ui/common/NoticeBanner';
import { RoomCount, RoomFullNotice } from '../ui/common/RoomCount';
import type { RoomStatus } from '../ui/common/server-status';
import {
  ALL_LESSONS,
  clampMinutes,
  defaultMinutesFor,
  fullUnitReady,
  lessonImplemented,
  lessonReleased,
  NOT_READY_TEXT,
  openDisabledReason,
  previewOf,
  savePrefs,
  type SetupValues,
} from './setup';
import { duringPreviewLine, worksheetNo } from './schedule-view';

export interface OpenError {
  code: string;
  text: string;
}

export interface SetupScreenProps {
  values: SetupValues;
  onChange: (v: SetupValues) => void;
  rooms: { status: RoomStatus; refresh: () => void };
  opening: boolean;
  openError: OpenError | null;
  onOpen: (v: SetupValues, preview: SchedulePreview) => void;
  onBack: () => void;
  /** 기억 저장소(테스트 주입). 기본 localStorage */
  prefsStorage?: Pick<Storage, 'getItem' | 'setItem'> | null;
}

/** 버튼 묶음(하나 고르기) */
function Seg<T extends string | number | boolean>({
  label,
  value,
  options,
  onPick,
  disabled,
  testId,
  note,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onPick: (v: T) => void;
  disabled?: boolean;
  testId: string;
  note?: string;
}) {
  return (
    <div class={`t-field${disabled ? ' t-field--off' : ''}`} data-testid={testId}>
      <span class="t-field__label">
        {label}
        {note && <span class="t-soon">{note}</span>}
      </span>
      <div class="t-seg" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            class="t-seg__btn"
            aria-pressed={o.value === value}
            disabled={disabled}
            onClick={() => onPick(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const FORM_TEXT: Record<ItemForm, string> = { full: '들어감', short: '짧게', dropped: '빠짐' };
const MODE_TEXT: Record<string, string> = { each: '중간마다', stageEnd: '구간 끝', after: '끝나고', off: '끄기' };

function PreviewPanel({
  preview,
  values,
  onForm,
}: {
  preview: ReturnType<typeof previewOf>;
  values: SetupValues;
  onForm: (id: string, form: ItemForm) => void;
}) {
  if (!preview) {
    return (
      <div class="t-preview t-preview--empty" data-testid="preview-empty">
        <p>판 단위를 고르면 배치 미리보기와 예상 수업 시간이 나와요.</p>
      </div>
    );
  }
  if (!preview.ok) {
    return (
      <div class="t-preview" data-testid="preview-error">
        <p class="t-alert t-alert--error">{preview.message}</p>
      </div>
    );
  }
  return (
    <div class="t-preview" data-testid="preview">
      <p class="t-expected" data-testid="expected-time">
        예상 수업 시간 <b>{preview.expected.text}</b>
      </p>
      <div class="t-bands" data-testid="preview-bands" aria-label="구간 띠">
        {preview.bands.map((b) => (
          <div key={b.stage} class="t-band" data-testid="preview-band" style={{ flex: `${Math.max(0.05, b.ratio)} 1 0` }} title={b.label}>
            <span class="t-band__name">{b.label}</span>
            <span class="t-band__meta">
              라운드 {b.rounds} · 학습지 {MODE_TEXT[b.worksheetMode] ?? b.worksheetMode}
            </span>
          </div>
        ))}
      </div>
      <p class="t-preview__facts" data-testid="preview-facts">
        라운드 {preview.totalRounds}개 · 편지 {preview.letters}통 · 학습지 방식{' '}
        {preview.bands.map((b) => `${values.playUnit === 'lesson' ? '' : `${b.stage} `}${MODE_TEXT[b.worksheetMode] ?? b.worksheetMode}`).join(', ')}
        {preview.afterWorksheets.ids.length > 0 &&
          ` · 끝나고 쓸 학습지 ${preview.afterWorksheets.ids.length}개(약 ${preview.afterWorksheets.minutes}분: ${preview.afterWorksheets.ids.map(worksheetNo).join('')})`}
      </p>
      {duringPreviewLine(preview.duringWorksheets.placed) && (
        <p class="t-preview__facts" data-testid="preview-during">
          {duringPreviewLine(preview.duringWorksheets.placed)}
        </p>
      )}
      {preview.warnings.length > 0 && (
        <ul class="t-warn" data-testid="preview-warnings">
          {preview.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
      <div class="t-acts-scroll">
        <table class="t-acts" data-testid="preview-activities">
          <thead>
            <tr>
              <th scope="col">활동</th>
              <th scope="col">등급</th>
              <th scope="col">이번 판</th>
              <th scope="col">바꾸기</th>
            </tr>
          </thead>
          <tbody>
            {preview.activities.map((a) => (
              <tr key={a.id} class={a.form === 'dropped' ? 't-acts--dropped' : ''} data-testid={`act-${a.id}`}>
                <td>
                  <span class="t-acts__stage">{a.stage}</span> {a.title}
                </td>
                <td>
                  <span class={`t-tier t-tier--${a.tier}`}>{a.tier}등급</span>
                </td>
                <td data-testid="act-form">
                  {FORM_TEXT[a.form]}
                  {a.form !== 'dropped' && a.minutes > 0 ? ` ${a.minutes}분` : ''}
                  {a.pinned ? ' (고정)' : ''}
                </td>
                <td class="t-acts__btns">
                  <button type="button" class="t-mini" aria-pressed={a.form === 'full'} onClick={() => onForm(a.id, 'full')}>
                    넣기
                  </button>
                  {a.canShort && (
                    <button type="button" class="t-mini" aria-pressed={a.form === 'short'} onClick={() => onForm(a.id, 'short')}>
                      짧게
                    </button>
                  )}
                  {a.canDrop && (
                    <button type="button" class="t-mini" aria-pressed={a.form === 'dropped'} onClick={() => onForm(a.id, 'dropped')}>
                      빼기
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function SetupScreen({ values, onChange, rooms, opening, openError, onOpen, onBack, prefsStorage }: SetupScreenProps) {
  const preview = useMemo(() => previewOf(values), [values]);
  const reason = openDisabledReason(values, preview, rooms.status);
  const chosen = !!values.playUnit && (values.playUnit !== 'lesson' || !!values.lesson);
  const set = (patch: Partial<SetupValues>) => onChange({ ...values, ...patch });

  // 마지막 선택 기억(학생 정보 없음)
  useEffect(() => {
    savePrefs(values, prefsStorage === undefined ? undefined : prefsStorage);
  }, [values]);

  const pickUnit = (u: 'lesson' | 'unit') => {
    if (values.playUnit === u) return;
    set({ playUnit: u, tradeMinutes: defaultMinutesFor(u), overrides: {} });
  };
  const toggleCustom = (st: LessonId) => {
    const has = values.customScope.includes(st);
    const next = has ? values.customScope.filter((s) => s !== st) : [...values.customScope, st];
    set({ playUnit: 'custom', customScope: ALL_LESSONS.filter((s) => next.includes(s)), overrides: {} });
  };
  const openNow = () => {
    if (reason || opening || !preview || !preview.ok) return;
    onOpen(values, preview);
  };
  const relay = syncMode() === 'relay';
  const big = openError && ['BUSY', 'ROOM_LIMIT', 'MAINTENANCE'].includes(openError.code);

  const rest: ComponentChildren = (
    <>
      <label class="t-field">
        <span class="t-field__label">학급 이름</span>
        <input
          class="t-input"
          data-testid="class-name"
          maxLength={20}
          placeholder="예: 6-3"
          value={values.className}
          onInput={(e) => set({ className: (e.currentTarget as HTMLInputElement).value })}
        />
      </label>
      <div class="t-field" data-testid="trade-minutes">
        <span class="t-field__label">무역 시간</span>
        <div class="t-seg" role="group" aria-label="무역 시간">
          {TRADE_MINUTES.buttons.map((m) => (
            <button key={m} type="button" class="t-seg__btn" aria-pressed={values.tradeMinutes === m} onClick={() => set({ tradeMinutes: m })}>
              {m}분
            </button>
          ))}
          <label class="t-custom-min">
            직접
            <input
              type="number"
              class="t-input t-input--num"
              data-testid="trade-minutes-custom"
              min={TRADE_MINUTES.customMin}
              max={TRADE_MINUTES.customMax}
              value={values.tradeMinutes}
              onChange={(e) => set({ tradeMinutes: clampMinutes(Number((e.currentTarget as HTMLInputElement).value)) })}
            />
            분
          </label>
        </div>
      </div>
      <Seg
        label="학습지 배치"
        testId="worksheet-mode"
        value={values.worksheetMode}
        options={worksheetModes.map((m) => ({ value: m.id, label: m.label }))}
        onPick={(v) => set({ worksheetMode: v })}
      />
      <Seg
        label="활동 비중"
        testId="activity-ratio"
        value={values.activityRatio}
        options={RATIO.options.map((o) => ({ value: o.value as number, label: o.label }))}
        onPick={(v) => set({ activityRatio: v })}
      />
      <Seg
        label="돌발 사건"
        testId="incident-freq"
        value={values.incidentFreq}
        disabled
        note="곧 열려요"
        options={[
          { value: 'off', label: '없음' },
          { value: 'some', label: '가끔' },
          { value: 'often', label: '자주' },
        ]}
        onPick={(v) => set({ incidentFreq: v })}
      />
      <Seg
        label="역전 장치"
        testId="comeback"
        value={values.comeback}
        disabled
        note="곧 열려요"
        options={[
          { value: true, label: '켬' },
          { value: false, label: '끔' },
        ]}
        onPick={(v) => set({ comeback: v })}
      />
      <Seg
        label="순위 공개"
        testId="top-n"
        value={values.leaderboardTopN}
        options={leaderboardRules.topNOptions.map((n) => ({ value: n, label: n === 0 ? '안 보임' : `상위 ${n}` }))}
        onPick={(v) => set({ leaderboardTopN: v })}
      />
      <Seg
        label="진행 방식"
        testId="progress-mode"
        value={values.progressMode}
        options={[
          { value: 'auto', label: '자동' },
          { value: 'manual', label: '수동' },
        ]}
        onPick={(v) => set({ progressMode: v })}
      />
    </>
  );

  return (
    <main class="t-setup" data-testid="teacher-setup">
      {relay && <NoticeBanner fetchFrom={true} compact />}
      <header class="t-setup__head">
        <button type="button" class="link-small" data-testid="setup-back" onClick={onBack}>
          처음으로
        </button>
        <h1 class="title-font">판 설정</h1>
      </header>
      <div class="t-setup__grid">
        <section class="t-setup__left" aria-label="판 설정">
          <h2 class="t-h2">① 판 단위</h2>
          <div class="t-cards" data-testid="unit-cards">
            {(['lesson', 'unit'] as const).map((u) => {
              // (작업 134) 기능 플래그: L2~L4 본편 전에는 단원 한 판을 '준비 중'으로(선택 불가 + 이유)
              const off = u === 'unit' && !fullUnitReady();
              return (
                <button
                  key={u}
                  type="button"
                  class="t-card"
                  data-testid={`unit-${u}`}
                  aria-pressed={values.playUnit === u}
                  disabled={off}
                  onClick={() => pickUnit(u)}
                >
                  <span class="t-card__title">{playUnits[u].label}</span>
                  <span class="t-card__desc">{playUnits[u].desc}</span>
                  <span class="t-card__meta">무역 {playUnits[u].defaultMinutes}분 기본</span>
                  {off && (
                    <span class="t-soon" data-testid="unit-soon">
                      {NOT_READY_TEXT}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {values.playUnit === 'lesson' && (
            <div class="t-lessons" data-testid="lesson-pick" role="group" aria-label="차시 고르기">
              {lessonCards.map((c) => {
                const ok = lessonImplemented(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    class="t-lesson"
                    data-testid={`lesson-${c.id}`}
                    aria-pressed={values.lesson === c.id}
                    disabled={!ok}
                    onClick={() => set({ lesson: c.id, overrides: {} })}
                  >
                    <b>{c.id}</b> {c.title}
                    <span class="t-lesson__pages">교과서 {c.pages}쪽</span>
                    {!ok && <span class="t-soon">준비 중</span>}
                  </button>
                );
              })}
            </div>
          )}
          {values.playUnit === 'unit' && (
            <p class="t-note" data-testid="unit-note">
              L1~L4 네 구간을 한 판에 해요.
              {ALL_LESSONS.some((l) => !lessonImplemented(l)) && ' 아직 준비 중인 구간(L2~L4 일부 활동)은 간단한 형태로 나와요.'}
            </p>
          )}
          <details class="t-adv" open={values.playUnit === 'custom'}>
            <summary>고급 설정</summary>
            <div class="t-field" data-testid="custom-scope">
              <span class="t-field__label">연속 구간 직접 고르기</span>
              <div class="t-seg" role="group" aria-label="연속 구간">
                {ALL_LESSONS.map((st) => (
                  <button
                    key={st}
                    type="button"
                    class="t-seg__btn"
                    aria-pressed={values.playUnit === 'custom' && values.customScope.includes(st)}
                    disabled={!lessonReleased(st)}
                    title={lessonReleased(st) ? undefined : '준비 중'}
                    onClick={() => toggleCustom(st)}
                  >
                    {st}
                  </button>
                ))}
              </div>
            </div>
          </details>
          <h2 class="t-h2">② 나머지 설정</h2>
          <div class={`t-rest${chosen ? '' : ' t-dim'}`} data-testid="setup-rest" aria-disabled={!chosen} inert={!chosen}>
            {rest}
          </div>
        </section>
        <section class={`t-setup__right${chosen ? '' : ' t-dim'}`} aria-label="배치 미리보기">
          <h2 class="t-h2">배치 미리보기</h2>
          <PreviewPanel preview={preview} values={values} onForm={(id, form) => set({ overrides: { ...values.overrides, [id]: form } })} />
          <div class="t-open">
            <RoomCount status={rooms.status} onRefresh={rooms.refresh} />
            <div class="t-open__row">
              <button
                type="button"
                class="btn btn--primary btn--large"
                data-testid="btn-open"
                disabled={!!reason || opening}
                aria-describedby={reason ? 'open-reason' : undefined}
                onClick={openNow}
              >
                {opening ? '여는 중…' : '방 열기'}
              </button>
              {reason && (
                <span id="open-reason" class="t-open__reason" data-testid="open-reason" data-kind={reason.kind}>
                  {reason.text}
                </span>
              )}
            </div>
            <RoomFullNotice status={rooms.status} />
            {openError && (
              <div class={`t-openerr${big ? ' t-openerr--big' : ''}`} role="alert" data-testid="open-error" data-code={openError.code}>
                <p>{openError.text}</p>
                <button type="button" class="btn btn--secondary" data-testid="btn-open-retry" disabled={opening || !!reason} onClick={openNow}>
                  다시 시도
                </button>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
