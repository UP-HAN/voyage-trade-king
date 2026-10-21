/**
 * 판 설정 화면(작업 109, PRD 4.1.1·7.2·7.5·7.5.1 — v0.3.2).
 * ① 판 단위 카드(기본 선택 없음, 마지막 선택 기억) → ② 나머지 설정 → 오른쪽 배치 미리보기·예상 수업 시간.
 * [방 열기] 바로 위 "사용 중인 방 n/50", 바로 아래 가득 참·점검 안내 상자. 비활성 이유는 하나만(판 단위 → 시간 → 서버).
 * 방 수 상태는 부모가 `useServerRooms({ poll: true })`로 한 번 만들어 넘긴다(버튼과 두 부품이 같은 상태를 씀).
 * (작업 138, PRD 7.5.2.3·7.5.2.5) 기본으로는 ① 판 단위 ② 차시 ③ 무역 시간 ④ 학급 이름만 보이고, 나머지는 [고급 설정](`setup-advanced`) 안.
 * 미리보기 맨 위는 오늘 순서 한 줄 요약 + 예상 수업 시간 + '이 차시 학습지'(PDF), 활동 표는 [활동 직접 고치기](`preview-activities-toggle`) 안.
 * 교사에게 보이는 말은 쉬운 말로(값·필드 이름·data-testid 는 그대로). 학생 화면 문구에 쓰이는 데이터 label 은 고치지 않고 여기 대응표로 바꾼다.
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { syncMode } from '../config/deploy';
import { tradeWorksheets, type ItemForm, type SchedulePreview } from '../core';
import { leaderboardRules } from '../data/awards';
import { LESSON_PART_TEXT, LESSON_PARTS, lessonPartRules, type LessonPart } from '../data/lessonParts';
import { activityRatio as RATIO, lessonCards, playUnits, tradeMinutes as TRADE_MINUTES, worksheetModes, type WorksheetMode } from '../data/schedule';
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
  lessonName,
  lessonReleased,
  lessonsName,
  NOT_READY_TEXT,
  openDisabledReason,
  orderSummaryOf,
  previewOf,
  savePrefs,
  freeVoyageAvailable,
  lessonPartAvailable,
  lessonPartOf,
  VOYAGE_MODE_SHORT,
  VOYAGE_MODE_TEXT,
  voyageModeOf,
  type SetupValues,
} from './setup';
import { duringPreviewLine, worksheetNo } from './schedule-view';
import { WorksheetPdfMenu } from './WorksheetPdfMenu';
import { teacherWarningText } from './notice-text';
import { teacherTitle } from './teacher-terms';

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
  options: readonly { value: T; label: string; /** (작업 151) 이 칸만 회색 '준비 중' */ soon?: boolean }[];
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
            data-value={String(o.value)}
            disabled={disabled || o.soon}
            onClick={() => onPick(o.value)}
          >
            {o.label}
            {o.soon && <span class="t-soon">준비 중</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

const FORM_TEXT: Record<ItemForm, string> = { full: '들어감', short: '짧게', dropped: '빠짐' };

// ── 교사 화면 용어(PRD 7.5.2.5). 값 이름은 그대로, 보이는 말만 ──
/** 학습지 넣는 때(값: auto/each/stageEnd/after/off) */
export const WORKSHEET_MODE_TEXT: Record<WorksheetMode, string> = {
  auto: '알아서 정하기',
  each: '활동마다 바로',
  stageEnd: '차시 끝에 모아서',
  after: '게임 끝나고',
  off: '학습지 안 씀',
};
/** 활동 비중(값: 0.5/0.6/0.7) */
export const RATIO_TEXT: Record<string, string> = { '0.5': '거래 시간 많이', '0.6': '반반', '0.7': '활동 많이' };
/** 진행 방식(값: auto/manual) */
export const PROGRESS_TEXT: Record<'auto' | 'manual', string> = { auto: '시간 맞춰 저절로 넘어가기', manual: '선생님이 하나씩 넘기기' };
/** 활동 등급 꼬리표 */
export const TIER_TEXT: Record<1 | 2 | 3, string> = { 1: '꼭 할 활동', 2: '하면 좋은 활동', 3: '시간 나면 하는 활동' };
const MODE_TEXT: Record<string, string> = WORKSHEET_MODE_TEXT;
/**
 * 차시 한 판 미리보기 한 줄(작업 153, PRD 4.3.3 v0.3.8): 이 차시 학습지 번호가 언제 뜨는지.
 * 'each' → `학습지: 활동마다 바로 ① → ② → ③ → ④`, 'stageEnd' → `학습지: 차시 끝에 한 번에 ①②③④`, 'after' → `학습지: 게임 끝나고 마무리에서`
 */
export function worksheetOrderLine(mode: string, stage: LessonId, part?: LessonPart): string | null {
  // (작업 154) 2차시 나눠 고르기로 빠진 번호는 보이지 않는다(차시 한 판에서만 부르므로 'lesson')
  const drop = lessonPartRules('lesson', [stage], part)?.dropWorksheets;
  const nos = tradeWorksheets(stage, drop).map(worksheetNo);
  if (!nos.length) return null;
  if (mode === 'each') return `학습지: 활동마다 바로 ${nos.join(' → ')}`;
  if (mode === 'stageEnd') return `학습지: 차시 끝에 한 번에 ${nos.join('')}`;
  if (mode === 'after') return '학습지: 게임 끝나고 마무리에서';
  return null;
}

/** 'L1 무역은…' → '1차시 무역은…' (구간 띠 이름) */
const bandName = (label: string) => label.replace(/^L(\d)/, '$1차시');

function PreviewPanel({
  preview,
  order,
  values,
  onForm,
}: {
  preview: ReturnType<typeof previewOf>;
  order: string | null;
  values: SetupValues;
  onForm: (id: string, form: ItemForm) => void;
}) {
  if (!preview) {
    return (
      <div class="t-preview t-preview--empty" data-testid="preview-empty">
        <p>판 단위를 고르면 오늘 순서와 예상 수업 시간이 나와요.</p>
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
      {lessonPartAvailable(values) && (
        <p class="t-preview__part" data-testid="preview-part" data-part={values.lessonPart}>
          {LESSON_PART_TEXT[values.lessonPart].preview}
        </p>
      )}
      {order && (
        <p class="t-order" data-testid="preview-order">
          <span class="t-order__label">오늘 순서</span> {order}
        </p>
      )}
      <p class="t-expected" data-testid="expected-time">
        예상 수업 시간 <b>{preview.expected.text}</b>
      </p>
      <p class="t-preview__facts" data-testid="preview-voyage" data-mode={voyageModeOf(values)}>
        항해: {VOYAGE_MODE_SHORT[voyageModeOf(values)]}
      </p>
      <div class="t-sheet" data-testid="preview-worksheets">
        <span class="t-sheet__label">{values.playUnit === 'lesson' ? '이 차시 학습지' : '학습지'}</span>
        <WorksheetPdfMenu variant="inline" highlightLesson={values.playUnit === 'lesson' ? values.lesson : 'unit'} />
      </div>
      {values.playUnit === 'lesson' && preview.bands[0] && worksheetOrderLine(preview.bands[0].worksheetMode, preview.bands[0].stage, lessonPartOf(values)) && (
        <p class="t-preview__facts" data-testid="preview-ws-order" data-mode={preview.bands[0].worksheetMode}>
          {worksheetOrderLine(preview.bands[0].worksheetMode, preview.bands[0].stage, lessonPartOf(values))}
        </p>
      )}
      <div class="t-bands" data-testid="preview-bands" aria-label="구간 띠">
        {preview.bands.map((b) => (
          <div key={b.stage} class="t-band" data-testid="preview-band" style={{ flex: `${Math.max(0.05, b.ratio)} 1 0` }} title={bandName(b.label)}>
            <span class="t-band__name">{bandName(b.label)}</span>
            <span class="t-band__meta">
              라운드 {b.rounds} · 학습지 {MODE_TEXT[b.worksheetMode] ?? b.worksheetMode}
            </span>
          </div>
        ))}
      </div>
      <p class="t-preview__facts" data-testid="preview-facts">
        라운드 {preview.totalRounds}개 · 편지 {preview.letters}통 · 학습지 넣는 때{' '}
        {preview.bands.map((b) => `${values.playUnit === 'lesson' ? '' : `${lessonName(b.stage)} `}${MODE_TEXT[b.worksheetMode] ?? b.worksheetMode}`).join(', ')}
        {preview.afterWorksheets.ids.length > 0 &&
          ` · 끝나고 쓸 학습지 ${preview.afterWorksheets.ids.length}개(약 ${preview.afterWorksheets.minutes}분: ${preview.afterWorksheets.ids.map(worksheetNo).join('')})`}
      </p>
      {duringPreviewLine(preview.duringWorksheets.placed) && (
        <p class="t-preview__facts" data-testid="preview-during">
          {duringPreviewLine(preview.duringWorksheets.placed)?.replace(/^지금 쓰기: /, '지금 바로 쓰기: ').replace(/([①-⑳])\(/g, '$1★(')}
        </p>
      )}
      {preview.warnings.length > 0 && (
        <ul class="t-warn" data-testid="preview-warnings">
          {preview.warnings.map((w, i) => (
            <li key={i}>{teacherWarningText(w)}</li>
          ))}
        </ul>
      )}
      <details class="t-adv t-acts-box" data-testid="preview-activities-toggle">
        <summary>활동 직접 고치기 (넣기·짧게·빼기)</summary>
      <div class="t-acts-scroll">
        <table class="t-acts" data-testid="preview-activities">
          <thead>
            <tr>
              <th scope="col">활동</th>
              <th scope="col">종류</th>
              <th scope="col">이번 판</th>
              <th scope="col">바꾸기</th>
            </tr>
          </thead>
          <tbody>
            {preview.activities.map((a) => (
              <tr key={a.id} class={a.form === 'dropped' ? 't-acts--dropped' : ''} data-testid={`act-${a.id}`}>
                <td>
                  <span class="t-acts__stage">{lessonName(a.stage)}</span> {teacherTitle(a.title)}
                </td>
                <td>
                  <span class={`t-tier t-tier--${a.tier}`}>{TIER_TEXT[a.tier]}</span>
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
      </details>
    </div>
  );
}

export function SetupScreen({ values, onChange, rooms, opening, openError, onOpen, onBack, prefsStorage }: SetupScreenProps) {
  const preview = useMemo(() => previewOf(values), [values]);
  const order = useMemo(() => (preview && preview.ok ? orderSummaryOf(values) : null), [values, preview]);
  // [고급 설정] 펼침(연속 구간을 골라 둔 상태면 펼친 채로 시작)
  const [advOpen, setAdvOpen] = useState(values.playUnit === 'custom');
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

  // 기본으로 보이는 칸 번호(① 판 단위 ② 차시 ③ 무역 시간 ④ 학급 이름 — 차시를 고르지 않는 판이면 번호를 당긴다)
  const nums = '①②③④⑤';
  const lessonStep = values.playUnit === 'lesson';
  // (작업 154) 2차시면 ③ 어느 시간 내용을 할까요? 가 끼어 번호가 하나씩 밀린다
  const partStep = lessonPartAvailable(values);
  const nPart = nums[2];
  const nTime = nums[(lessonStep ? 2 : 1) + (partStep ? 1 : 0)];
  const nClass = nums[(lessonStep ? 3 : 2) + (partStep ? 1 : 0)];

  const basic: ComponentChildren = (
    <>
      <div class="t-field" data-testid="trade-minutes">
        <span class="t-field__label">{nTime} 무역 시간</span>
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
      <label class="t-field">
        <span class="t-field__label">
          {nClass} 학급 이름 <span class="t-optional">(선택)</span>
        </span>
        <input
          class="t-input"
          data-testid="class-name"
          maxLength={20}
          placeholder="예: 6-3"
          value={values.className}
          onInput={(e) => set({ className: (e.currentTarget as HTMLInputElement).value })}
        />
      </label>
    </>
  );

  const advanced: ComponentChildren = (
    <>
      <Seg
        label="학습지 넣는 때"
        testId="worksheet-mode"
        value={values.worksheetMode}
        options={worksheetModes.map((m) => ({ value: m.id, label: WORKSHEET_MODE_TEXT[m.id] ?? m.label }))}
        onPick={(v) => set({ worksheetMode: v })}
      />
      <Seg
        label="활동 비중"
        testId="activity-ratio"
        value={values.activityRatio}
        options={RATIO.options.map((o) => ({ value: o.value as number, label: RATIO_TEXT[String(o.value)] ?? o.label }))}
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
          { value: 'auto', label: PROGRESS_TEXT.auto },
          { value: 'manual', label: PROGRESS_TEXT.manual },
        ]}
        onPick={(v) => set({ progressMode: v })}
      />
      {/* (작업 151, PRD 4.3.7.1) 항해 방식 — 1·2차시 차시 판만 '자유롭게'를 고를 수 있다(기억하지 않음) */}
      <Seg
        label="항해 방식"
        testId="voyage-mode"
        value={voyageModeOf(values)}
        options={[
          { value: 'free', label: VOYAGE_MODE_TEXT.free, soon: !freeVoyageAvailable(values) },
          { value: 'round', label: VOYAGE_MODE_TEXT.round },
        ]}
        onPick={(v) => set({ voyageMode: v })}
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
              // (작업 134) 기능 플래그: 본편이 다 준비되기 전에는 단원 한 판을 '준비 중'으로(선택 불가 + 이유)
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
            <>
              <h2 class="t-h2">② 차시</h2>
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
                      <span>
                        <b>{lessonName(c.id)}</b> <span class="t-lesson__id">({c.id})</span> {c.title}
                      </span>
                      <span class="t-lesson__pages">교과서 {c.pages}쪽</span>
                      {!ok && <span class="t-soon">준비 중</span>}
                    </button>
                  );
                })}
              </div>
              {partStep && (
                <>
                  <h2 class="t-h2">{nPart} 어느 시간 내용을 할까요?</h2>
                  <div class="t-lessons t-parts" data-testid="lesson-part-pick" role="group" aria-label="어느 시간 내용을 할까요?">
                    {LESSON_PARTS.map((part) => (
                      <button
                        key={part}
                        type="button"
                        class="t-lesson"
                        data-testid={`lesson-part-${part}`}
                        aria-pressed={values.lessonPart === part}
                        onClick={() => set({ lessonPart: part, overrides: {} })}
                      >
                        <b>{LESSON_PART_TEXT[part].title}</b>
                        <span class="t-lesson__pages">{LESSON_PART_TEXT[part].sub}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
              {values.lesson === 'L2' && values.tradeMinutes < 25 && values.lessonPart !== 'back' && (
                <p class="t-note" data-testid="lesson2-time-hint">
                  2차시는 무역 25분 이상을 권해요. 라운드가 3개 이상이어야 공장에서 만든 상품을 수출하고 세관 게시판을 채울 시간이 넉넉해요.
                </p>
              )}
            </>
          )}
          {values.playUnit === 'unit' && (
            <p class="t-note" data-testid="unit-note">
              {lessonsName(ALL_LESSONS)}를 한 판에 해요.
              {ALL_LESSONS.some((l) => !lessonImplemented(l)) && ' 아직 준비 중인 차시의 일부 활동은 간단한 형태로 나와요.'}
            </p>
          )}
          <div class={`t-rest${chosen ? '' : ' t-dim'}`} data-testid="setup-rest" aria-disabled={!chosen} inert={!chosen}>
            {basic}
          </div>
          <details
            class="t-adv"
            data-testid="setup-advanced"
            open={advOpen}
            onToggle={(e) => setAdvOpen((e.currentTarget as HTMLDetailsElement).open)}
          >
            <summary>고급 설정</summary>
            <p class="t-adv__hint">처음에는 그대로 두어도 돼요. 기본: 학습지는 알아서, 시간 맞춰 저절로 넘어가기.</p>
            <div class={`t-adv__rest${chosen ? '' : ' t-dim'}`} data-testid="setup-adv-rest" aria-disabled={!chosen} inert={!chosen}>
              {advanced}
            </div>
            <div class="t-field" data-testid="custom-scope">
              <span class="t-field__label">연속 구간 직접 고르기</span>
              <div class="t-seg" role="group" aria-label="연속 구간">
                {ALL_LESSONS.map((st) => (
                  <button
                    key={st}
                    type="button"
                    class="t-seg__btn"
                    aria-pressed={values.playUnit === 'custom' && values.customScope.includes(st)}
                    data-value={st}
                    disabled={!lessonReleased(st)}
                    title={lessonReleased(st) ? undefined : '준비 중'}
                    onClick={() => toggleCustom(st)}
                  >
                    {lessonName(st)}
                  </button>
                ))}
              </div>
            </div>
          </details>
        </section>
        <section class={`t-setup__right${chosen ? '' : ' t-dim'}`} aria-label="미리보기">
          <h2 class="t-h2">미리보기</h2>
          <PreviewPanel
            preview={preview}
            order={order}
            values={values}
            onForm={(id, form) => set({ overrides: { ...values.overrides, [id]: form } })}
          />
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
