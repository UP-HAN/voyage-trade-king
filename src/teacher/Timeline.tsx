/**
 * '오늘 순서' 접힘 영역(옛 타임라인 — 작업 109, 작업 137에서 PRD 7.5.2.2대로 바꿈).
 *
 * - 끝난 것(접힘) · 지금 · 다음 전부를 시각과 함께 한 목록으로. 줄마다 버튼을 늘어놓지 않는다 —
 *   줄을 누르면 그 줄 아래에 [지금 시작] [1분 미루기] [이번엔 빼기]가 나온다(꼭 할 활동 빼기는 확인 창).
 * - 꼬리표는 '꼭 할 활동'만. "시간이 모자라 뺀 활동" 아래 [다시 넣기]. 수동 진행이면 "계획보다 3분 늦어요".
 * - 응답 수·[응답 받기 끝내기]·[TV에 결과 보여 주기]는 '지금 할 일' 카드로 옮겼다(여기서는 뺌). "배치 n판"은 설정 [고급] 맨 아래.
 */
import { useState } from 'preact/hooks';
import { hasResultView, lateness, type ScheduleItem } from '../core';
import { eventsById } from '../data/events';
import type { TeacherActions } from './actions';
import type { TeacherGame } from './game';
import { isMust } from './now-card';
import { teacherTitle } from './teacher-terms';
import { eventDefOf, groupTimeline, isTier1, itemLabel, mmss } from './schedule-view';
import type { ConfirmOptions } from './ui';

export interface TimelineProps {
  game: TeacherGame;
  now: number;
  actions: TeacherActions;
  ask: (o: ConfirmOptions) => Promise<boolean>;
  /** 라운드 줄의 [지금 시작] = 라운드 지금 시작(134 확인 흐름) */
  onRoundNow: () => void;
}

/** 꼭 할 활동 [이번엔 빼기] 확인(PRD 6.11.2·7.5.2.6) — 확인하면 confirm:true로 보냄 */
export async function skipWithConfirm(it: ScheduleItem, actions: TeacherActions, ask: (o: ConfirmOptions) => Promise<boolean>): Promise<boolean> {
  if (isTier1(it)) {
    const d = eventDefOf(it);
    const yes = await ask({
      title: '꼭 할 활동을 뺄까요?',
      body: `「${d ? teacherTitle(d.title) : itemLabel(it)}」은(는) 이 차시의 꼭 할 활동이에요. 빼고 넘어갈까요?`,
      ok: '이번엔 빼기',
      danger: true,
      testId: 'confirm-skip-tier1',
    });
    if (!yes) return false;
    actions.dispatch({ type: 'skipItem', id: it.id, confirm: true });
    return true;
  }
  actions.dispatch({ type: 'skipItem', id: it.id });
  return true;
}

/** [TV에 결과 보여 주기]를 쓸 수 있는 사건(공용 화면 막대가 있는 결정·확인 퀴즈·투표) — 작업 111 */
export function hasResultBars(id: string): boolean {
  return hasResultView(eventsById[id]);
}

/** 꼭 할 활동 꼬리표(그 밖의 등급은 대시보드에 표시하지 않음) */
export function MustMark({ it }: { it: ScheduleItem }) {
  return isMust(it) ? <span class="t-must">꼭 할 활동</span> : null;
}

/** 줄을 눌렀을 때 쓸 수 있는 동작이 있는 항목 */
const actionable = (it: ScheduleItem) => it.status === 'pending' && it.kind !== 'stageCover' && it.kind !== 'letter';

export function Timeline({ game, now, actions, ask, onRoundNow }: TimelineProps) {
  const [open, setOpen] = useState<string | null>(null);
  const c = game.class;
  const started = c.clock.startedAt !== null;
  if (!started) {
    return (
      <div class="t-order-fold" data-testid="timeline">
        <p class="t-small">[무역 시작]을 누르면 오늘 순서가 만들어져요.</p>
      </div>
    );
  }
  const g = groupTimeline(c.schedule.items.filter((it) => it.kind !== 'letter'), Number.MAX_SAFE_INTEGER);
  const manual = c.schedule.mode === 'manual';
  const late = manual ? lateness(game, now) : null;
  const nextRound = c.schedule.items.find((it) => it.kind === 'round' && it.status === 'pending' && it.form !== 'dropped');
  const ce = c.currentEvent;
  /** 지금 열려 있는 응답 받는 활동(라운드에 붙은 결정 포함) — 줄을 누르면 [TV에 결과 보여 주기] [응답 받기 끝내기] */
  const openResp = (it: ScheduleItem) => it.kind === 'event' && !!ce && !ce.closed && ce.id === it.refId && !!eventsById[it.refId]?.needsResponse;
  const row = (it: ScheduleItem, live: boolean) => {
    const can = live ? openResp(it) : actionable(it) && (it.kind !== 'round' || it === nextRound);
    const sel = open === it.id && can;
    return (
      <li key={it.id} class={`t-ord${live ? ' t-ord--live' : ''}${sel ? ' t-ord--sel' : ''}`} data-testid={live ? 'tl-live-item' : 'tl-next-item'} data-item={it.id}>
        <button type="button" class="t-ord__head" aria-expanded={can ? sel : undefined} disabled={!can} onClick={() => setOpen(sel ? null : it.id)}>
          <span class="t-tl__at">{mmss(it.at)}</span>
          <span class="t-ord__name">{itemLabel(it)}</span>
          <MustMark it={it} />
          {it.form === 'short' && <span class="t-small"> (짧게)</span>}
          {live && <span class="t-tag">지금</span>}
        </button>
        {sel && live && (
          <span class="t-ord__acts">
            {hasResultBars(it.refId) && !ce?.revealed && (
              <button type="button" class="t-mini" data-testid="tl-reveal" onClick={() => actions.dispatch({ type: 'revealEvent' })}>
                TV에 결과 보여 주기
              </button>
            )}
            <button type="button" class="t-mini" data-testid="tl-close" onClick={() => (setOpen(null), actions.dispatch({ type: 'closeEvent', reveal: true }))}>
              응답 받기 끝내기
            </button>
          </span>
        )}
        {sel && !live && (
          <span class="t-ord__acts">
            {it.kind === 'round' ? (
              <button type="button" class="t-mini" data-testid="tl-now" onClick={() => (setOpen(null), onRoundNow())}>
                지금 시작
              </button>
            ) : (
              <>
                <button type="button" class="t-mini" data-testid="tl-now" onClick={() => (setOpen(null), actions.dispatch({ type: 'fireNow', id: it.id, clear: true }))}>
                  지금 시작
                </button>
                <button type="button" class="t-mini" data-testid="tl-postpone" onClick={() => (setOpen(null), actions.dispatch({ type: 'postpone', id: it.id }))}>
                  1분 미루기
                </button>
                <button type="button" class="t-mini" data-testid="tl-skip" onClick={() => (setOpen(null), void skipWithConfirm(it, actions, ask))}>
                  이번엔 빼기
                </button>
              </>
            )}
          </span>
        )}
      </li>
    );
  };

  return (
    <div class="t-order-fold" data-testid="timeline" data-version={c.schedule.version}>
      {late && late.lateSec >= 60 && (
        <p class="t-alert" data-testid="late-note">
          계획보다 {Math.floor(late.lateSec / 60)}분 늦어요
          {late.wouldDrop.length > 0 && ` — 빠질 수 있는 활동: ${late.wouldDrop.map((id) => (eventsById[id] ? teacherTitle(eventsById[id]!.title) : id)).join(', ')}`}
        </p>
      )}
      {g.done.length > 0 && (
        <details class="t-tl-done">
          <summary data-testid="tl-done-summary">끝난 것 {g.done.length}개</summary>
          <ul class="t-tl">
            {g.done.map((it) => (
              <li key={it.id} class={it.status === 'skipped' ? 't-tl--skipped' : ''}>
                <span class="t-tl__at">{mmss(it.at)}</span> {itemLabel(it)} {it.status === 'skipped' ? '(뺌)' : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
      <ul class="t-tl t-ords" data-testid="tl-next">
        {g.live.map((it) => row(it, true))}
        {g.next.map((it) => row(it, false))}
        {g.live.length + g.next.length === 0 && <li class="t-small">남은 순서가 없어요.</li>}
      </ul>
      <p class="t-small t-ord__hint">줄을 누르면 [지금 시작] [1분 미루기] [이번엔 빼기]가 나와요.</p>
      {g.dropped.length > 0 && (
        <>
          <h3 class="t-h4">시간이 모자라 뺀 활동</h3>
          <ul class="t-tl t-tl--dropped" data-testid="tl-dropped">
            {g.dropped.map((it) => (
              <li key={it.id}>
                {itemLabel(it)} <MustMark it={it} />
                <button type="button" class="t-mini" data-testid="tl-restore" onClick={() => actions.dispatch({ type: 'setItemForm', id: it.id, form: 'full' })}>
                  다시 넣기
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
