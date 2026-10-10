/**
 * 타임라인(작업 109, PRD 6.11.2·7.5): 완료 / 진행 중 / 다음 3개(시각) / 빠진 항목(회색 [넣기]),
 * 수동 진행 [발동]·"계획보다 n분 늦어요", 응답 수 + [마감]. 1등급 건너뛰기는 확인 창.
 */
import { hasResultView, lateness, resultShowing, type ScheduleItem } from '../core';
import { eventsById } from '../data/events';
import type { TeacherActions } from './actions';
import type { TeacherGame } from './game';
import { currentResponseCount } from './table';
import { eventDefOf, groupTimeline, isTier1, itemLabel, mmss } from './schedule-view';
import type { ConfirmOptions } from './ui';

export interface TimelineProps {
  game: TeacherGame;
  now: number;
  actions: TeacherActions;
  ask: (o: ConfirmOptions) => Promise<boolean>;
}

/** 1등급 건너뛰기 확인(PRD 6.11.2) — 확인하면 confirm:true로 보냄 */
export async function skipWithConfirm(it: ScheduleItem, actions: TeacherActions, ask: (o: ConfirmOptions) => Promise<boolean>): Promise<void> {
  if (isTier1(it)) {
    const d = eventDefOf(it);
    const yes = await ask({
      title: '핵심 활동 건너뛰기',
      body: `이 활동은 「${d?.title ?? itemLabel(it)}」 개념의 핵심 경험이에요. 정말 건너뛸까요?`,
      ok: '건너뛰기',
      danger: true,
      testId: 'confirm-skip-tier1',
    });
    if (!yes) return;
    actions.dispatch({ type: 'skipItem', id: it.id, confirm: true });
    return;
  }
  actions.dispatch({ type: 'skipItem', id: it.id });
}

/** [결과 공개]를 쓸 수 있는 사건(공용 화면 막대가 있는 결정·확인 퀴즈·투표) — 작업 111 */
export function hasResultBars(id: string): boolean {
  return hasResultView(eventsById[id]);
}

/** [마감] 설명: 응답하지 않은 학생은 '응답 없음'으로 기록, 결정 사건이면 기본 선택지('사지 않기' 등) */
function closeHint(id: string): string {
  const def = eventsById[id];
  const none = def?.kind === 'decision' ? def.options?.find((o) => o.id === 'none') : undefined;
  const tail = hasResultView(def) ? ' 마감하면 결과(정답률·분포 막대)를 20초 동안 보여 줘요.' : '';
  return (none ? `응답하지 않은 학생은 '응답 없음'으로 기록하고 '${none.label}'로 넣어요.` : "응답하지 않은 학생은 '응답 없음'이에요.") + tail;
}

export function TierMark({ it }: { it: ScheduleItem }) {
  if (it.kind !== 'event') return null;
  const t = it.tier ?? eventDefOf(it)?.tier;
  return t ? <span class={`t-tier t-tier--${t}`}>{t}등급</span> : null;
}

export function Timeline({ game, now, actions, ask }: TimelineProps) {
  const c = game.class;
  const items = c.schedule.items;
  const started = c.clock.startedAt !== null;
  if (!started) {
    return (
      <section class="t-timeline" data-testid="timeline" aria-label="타임라인">
        <h2 class="t-h3">타임라인</h2>
        <p class="t-small">[무역 시작]을 누르면 배치표가 만들어져요.</p>
      </section>
    );
  }
  const g = groupTimeline(items);
  const manual = c.schedule.mode === 'manual';
  const late = manual ? lateness(game, now) : null;
  const ce = c.currentEvent;
  const resp = ce && !ce.closed ? currentResponseCount(game) : null;
  const atText = (it: ScheduleItem) => mmss(it.at);

  return (
    <section class="t-timeline" data-testid="timeline" aria-label="타임라인">
      <h2 class="t-h3">
        타임라인 <span class="t-small">{manual ? '수동 진행' : '자동 진행'} · 배치 {c.schedule.version}판</span>
      </h2>
      {late && late.lateSec >= 60 && (
        <p class="t-alert" data-testid="late-note">
          계획보다 {Math.floor(late.lateSec / 60)}분 늦어요
          {late.wouldDrop.length > 0 && ` — 빠질 활동: ${late.wouldDrop.map((id) => eventsById[id]?.title ?? id).join(', ')}`}
        </p>
      )}
      {/* (작업 134) 수동 진행 [발동](tl-waiting·btn-fire)은 첫 화면에 보이도록 상단 진행 바로 옮겼다(Dashboard ManualFire) */}
      {g.live.length > 0 && (
        <ul class="t-tl t-tl--live" data-testid="tl-live">
          {g.live.map((it) => (
            <li key={it.id}>
              <span class="t-tl__at">{atText(it)}</span> <b>{itemLabel(it)}</b> <TierMark it={it} /> <span class="t-tag">진행 중</span>
            </li>
          ))}
        </ul>
      )}
      {ce && resultShowing(c, now) && (
        <div class="t-tl-resp" data-testid="tl-result" data-event={ce.id}>
          <span>
            결과 보여 주는 중 · {Math.max(0, Math.ceil(((ce.resultUntil ?? now) - now) / 1000))}초
          </span>
          <button type="button" class="btn btn--primary" data-testid="btn-end-result" onClick={() => actions.dispatch({ type: 'endResult' })}>
            다음
          </button>
        </div>
      )}
      {resp && ce && (
        <div class="t-tl-resp" data-testid="tl-responses" data-event={ce.id}>
          <span data-testid="tl-resp-count">
            응답 {resp.responded}/{resp.total}
          </span>
          {hasResultBars(ce.id) && (
            <button
              type="button"
              class="btn btn--secondary"
              data-testid="btn-reveal-event"
              disabled={ce.revealed === true}
              title="공용 화면에 선택 분포·정답률 막대를 보여요(이름 없음)"
              onClick={() => actions.dispatch({ type: 'revealEvent' })}
            >
              {ce.revealed ? '결과 공개됨' : '결과 공개'}
            </button>
          )}
          <button
            type="button"
            class="btn btn--secondary"
            data-testid="btn-close-event"
            title={closeHint(ce.id)}
            onClick={() => actions.dispatch({ type: 'closeEvent', reveal: true })}
          >
            마감
          </button>
        </div>
      )}
      <h3 class="t-h4">다음</h3>
      <ul class="t-tl" data-testid="tl-next">
        {g.next.map((it) => (
          <li key={it.id} data-testid="tl-next-item" data-item={it.id}>
            <span class="t-tl__at">{atText(it)}</span> {itemLabel(it)} <TierMark it={it} />
            {it.form === 'short' && <span class="t-small"> (짧게)</span>}
            {it.kind !== 'stageCover' && it.kind !== 'letter' && it.kind !== 'round' && (
              <span class="t-tl__btns">
                <button type="button" class="t-mini" onClick={() => actions.dispatch({ type: 'fireNow', id: it.id })}>
                  지금
                </button>
                <button type="button" class="t-mini" data-testid="tl-skip" onClick={() => void skipWithConfirm(it, actions, ask)}>
                  건너뛰기
                </button>
              </span>
            )}
          </li>
        ))}
        {g.next.length === 0 && <li class="t-small">남은 항목이 없어요.</li>}
        {g.laterCount > 0 && <li class="t-small">그 뒤 {g.laterCount}개</li>}
      </ul>
      {g.dropped.length > 0 && (
        <>
          <h3 class="t-h4">빠진 활동</h3>
          <ul class="t-tl t-tl--dropped" data-testid="tl-dropped">
            {g.dropped.map((it) => (
              <li key={it.id}>
                {itemLabel(it)} <TierMark it={it} />
                <button type="button" class="t-mini" onClick={() => actions.dispatch({ type: 'setItemForm', id: it.id, form: 'full' })}>
                  넣기
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {g.done.length > 0 && (
        <details class="t-tl-done">
          <summary data-testid="tl-done-summary">완료 {g.done.length}개</summary>
          <ul class="t-tl">
            {g.done.map((it) => (
              <li key={it.id} class={it.status === 'skipped' ? 't-tl--skipped' : ''}>
                <span class="t-tl__at">{atText(it)}</span> {itemLabel(it)} {it.status === 'skipped' ? '(건너뜀)' : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
