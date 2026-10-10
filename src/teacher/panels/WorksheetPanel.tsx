/**
 * 교사 학습지 패널(작업 112, PRD 7.7·4.3.3 — 대시보드 오른쪽 접이식 패널).
 *
 * - 배치 방식(구간별: 중간마다 / 구간 끝 묶음 / 끝나고 쓰기 / 끄기)과 '끝나고 쓰기' 번호.
 * - 지금 떠 있는 팝업: 번호·문구, 다 쓴 회사 "18/27", 아직 안 쓴 회사 목록 **"7 해오름무역"(출석번호 + 회사 이름 — 교사 화면에만)**,
 *   [모두 닫기(학습지 시간 끝)](묶음 팝업이 3분을 넘기면 강조 "다 못 쓴 번호는 마무리 때 이어 써요").
 * - 라운드 중 예약("라운드가 끝나면 띄우기"), 다음 배치 학습지 [건너뛰기], [다시 띄우기], 번호 고르기 + [지금 띄우기](큐와 무관한 일괄).
 * - '학습지 팝업 끄기': 남은 학습지 항목을 모두 건너뜀(타임라인에 회색 '건너뜀').
 * - ①~⑳ 완료율 표: 이번 판 번호만 펼치고, 나머지는 접어 회색으로. (작업 132) 판에 '지금 쓰기'(③★·⑭★)가 있으면
 *   그 번호 줄 아래에 ★ 줄을 따로 둔다(번호 완료와 따로 셈 — PRD 4.3.3.1 규칙 7). 지금 쓰기 팝업의 완료 현황도 ★ 완료로 센다.
 * 학급 상태는 `actions.dispatch`(→ 세션 → hostReduce)로만 바꾼다. 공용 화면에는 이름 없이 수만 나간다(WorksheetScene).
 */
import { useRef, useState } from 'preact/hooks';
import { type ClassState, type ScheduleItem, type WorksheetPlacement } from '../../core';
import { afterWorksheetIds, playWorksheetIds } from '../../core/worksheet-helpers';
import { duringLabel, worksheet, worksheetById } from '../../data/worksheet';
import type { LessonId, WorksheetId } from '../../data/types';
import type { TeacherGame } from '../game';
import type { PanelProps } from './types';

/** 묶음 팝업 시간(초) — 넘으면 [모두 닫기] 강조 */
export const BUNDLE_CLOSE_HINT_SEC = 180;

export const PLACEMENT_TEXT: Record<WorksheetPlacement, string> = {
  each: '중간마다',
  stageEnd: '구간 끝 묶음',
  after: '끝나고 쓰기',
  off: '끄기',
};

/** 교사 화면 학생 표시: "7 해오름무역" */
export function seatLabel(seat: number, companyName: string): string {
  return `${seat} ${companyName}`;
}

export interface SeatName {
  seat: number;
  companyName: string;
}

/** 지금 팝업의 완료 현황(묶음은 번호 모두를 다 쓴 회사만 '다 씀'. 지금 쓰기 팝업은 ★ 칸 완료로 셈) */
export function popupProgress(
  g: TeacherGame | null,
  seats: readonly SeatName[],
): { ids: WorksheetId[]; during: boolean; done: number; total: number; missing: string[] } {
  const ids = (g?.class.worksheet.current ?? []).filter((id) => worksheetById[id]);
  const during = !!g && g.class.worksheet.during === true;
  if (!g || !ids.length) return { ids, during, done: 0, total: 0, missing: [] };
  const names = new Map(seats.map((s) => [s.seat, s.companyName]));
  const players = Object.values(g.players).sort((a, b) => a.seat - b.seat);
  const missing: string[] = [];
  let done = 0;
  for (const p of players) {
    const list = during ? (p.game.duringDone ?? []) : p.game.worksheetDone;
    if (ids.every((id) => list.includes(id))) done += 1;
    else missing.push(seatLabel(p.seat, names.get(p.seat) ?? p.company.name));
  }
  return { ids, during, done, total: players.length, missing };
}

/** 이번 판 배치표의 '지금 쓰기' 번호(③·⑭, 번호 순) */
export function playDuringIds(cs: Pick<ClassState, 'schedule'>): WorksheetId[] {
  const ids = new Set<WorksheetId>();
  for (const it of cs.schedule.items) if (it.kind === 'worksheet' && it.placement === 'during') ids.add(it.refId as WorksheetId);
  return worksheet.filter((w) => ids.has(w.id)).map((w) => w.id);
}

/** ①~⑳ 완료율(이번 판 번호 표시 포함, 구간별 묶음) */
export function completionGroups(g: TeacherGame | null): {
  lesson: LessonId | 'optional';
  rows: { id: WorksheetId; label: string; done: number; total: number; inPlay: boolean; during?: boolean }[];
  inPlay: boolean;
}[] {
  const inPlay = new Set(g ? playWorksheetIds(g.class.schedule) : []);
  const duringIds = new Set(g ? playDuringIds(g.class) : []);
  const players = g ? Object.values(g.players) : [];
  const total = players.length;
  const out: ReturnType<typeof completionGroups> = [];
  for (const w of worksheet) {
    const done = players.filter((p) => p.game.worksheetDone.includes(w.id)).length;
    const row = { id: w.id, label: w.label, done, total, inPlay: inPlay.has(w.id) };
    const rows = [row];
    // 지금 쓰기 ★ 줄(판에 있을 때만) — 번호 완료와 따로 센다
    if (duringIds.has(w.id)) {
      const dDone = players.filter((p) => (p.game.duringDone ?? []).includes(w.id)).length;
      rows.push({ id: w.id, label: duringLabel(w.id), done: dDone, total, inPlay: true, during: true } as typeof row);
    }
    const grp = out.find((x) => x.lesson === w.lesson);
    if (grp) {
      grp.rows.push(...rows);
      grp.inPlay = grp.inPlay || row.inPlay;
    } else out.push({ lesson: w.lesson, rows, inPlay: row.inPlay });
  }
  return out;
}

/** 다음에 뜰 배치표 학습지 항목 */
export function nextWorksheetItem(cs: ClassState): ScheduleItem | null {
  return cs.schedule.items.find((it) => it.kind === 'worksheet' && it.status === 'pending' && it.form !== 'dropped') ?? null;
}

/** 마지막으로 닫힌 학습지 번호(배치표 기준) */
export function lastClosedIds(cs: ClassState): WorksheetId[] | null {
  const done = cs.schedule.items.filter((it) => it.kind === 'worksheet' && it.status === 'done');
  const last = done[done.length - 1];
  return last ? ((last.refIds?.length ? last.refIds : [last.refId]) as WorksheetId[]) : null;
}

const NOW_STYLE = { margin: '6px 0', padding: '6px 8px', border: '1px solid #cdbb8f', borderRadius: '8px' };
const NOW_LONG = { ...NOW_STYLE, border: '2px solid #C0623F', background: '#FCE9C8' };
const OFF_STYLE = { color: '#8a7f6a', opacity: 0.75 };

const labelsOf = (ids: readonly WorksheetId[]) => ids.map((id) => worksheetById[id]?.label ?? id).join('');

export function WorksheetPanel({ game, view, actions, now }: PanelProps) {
  const lastShown = useRef<WorksheetId[] | null>(null);
  const [pick, setPick] = useState<WorksheetId | ''>('');
  if (!game) {
    return (
      <p class="t-panel__empty" data-testid="panel-WorksheetPanel">
        판을 열면 학습지 팝업을 관리할 수 있어요.
      </p>
    );
  }
  const c = game.class;
  const seats: SeatName[] = view.seats.map((s) => ({ seat: s.seat, companyName: s.companyName }));
  const prog = popupProgress(game, seats);
  if (prog.ids.length) lastShown.current = prog.ids;
  const reopenIds = lastShown.current && !prog.ids.length ? lastShown.current : lastClosedIds(c);
  const bundle = prog.ids.length > 1;
  const openedAt = c.worksheet.openedAt;
  const longBundle = bundle && openedAt !== null && now - openedAt >= BUNDLE_CLOSE_HINT_SEC * 1000;
  const inRound = c.phase === 'round';
  const eventOpen = c.phase === 'event';
  const ended = c.phase === 'ended';
  const off = c.settings.worksheetMode === 'off';
  const next = nextWorksheetItem(c);
  const after = afterWorksheetIds(c.schedule);
  const modes = c.schedule.stageModes ?? {};
  const playIds = playWorksheetIds(c.schedule);
  const pickIds = pick ? [pick] : [];
  const choices = [...playIds, ...worksheet.map((w) => w.id).filter((id) => !playIds.includes(id))];
  const open = (ids: WorksheetId[]) => ids.length && actions.dispatch({ type: 'openWorksheet', ids });

  const turnOff = () => {
    // 큐(배치표)의 남은 학습지 항목을 먼저 모두 건너뛰고(타임라인에 회색 '건너뜀') 설정을 끈다.
    // 설정을 먼저 끄면 다시 배치가 남은 학습지 항목을 지워 버려 건너뜀 표시가 남지 않는다.
    for (const it of c.schedule.items) if (it.kind === 'worksheet' && it.status === 'pending') actions.dispatch({ type: 'skipItem', id: it.id });
    actions.dispatch({ type: 'updateSettings', settings: { worksheetMode: 'off' } });
    // 이미 떠 있는 팝업과 라운드 끝 예약도 한꺼번에 닫는다(라운드 중 예약만 걸린 경우 포함 — 작업 114)
    if (c.worksheet.current?.length || c.worksheet.pending.length) actions.dispatch({ type: 'closeWorksheet', all: true });
  };

  return (
    <div class="t-wsp" data-testid="panel-WorksheetPanel">
      <p class="t-small" data-testid="ws-modes">
        배치 방식:{' '}
        {c.settings.scope.map((s) => `${c.settings.playUnit === 'lesson' ? '' : `${s} `}${PLACEMENT_TEXT[modes[s] ?? c.worksheet.mode] ?? ''}`).join(' · ')}
        {off && ' (학습지 팝업 꺼짐)'}
        {after.length > 0 && <span data-testid="ws-after-ids"> · 끝나고 쓰기 {labelsOf(after)}</span>}
      </p>

      {prog.ids.length ? (
        <div
          class="t-wsp__now"
          style={longBundle ? NOW_LONG : NOW_STYLE}
          data-testid="ws-now"
          data-ids={prog.ids.join(',')}
          data-long={longBundle ? '1' : '0'}
          data-during={prog.during ? '1' : '0'}
        >
          <p>
            <b class="t-wsp__no">{prog.during ? `${duringLabel(prog.ids[0])} 지금 쓰기` : labelsOf(prog.ids)}</b>{' '}
            {prog.during
              ? worksheetById[prog.ids[0]].during?.prompt ?? worksheetById[prog.ids[0]].prompt
              : prog.ids.length === 1
                ? worksheetById[prog.ids[0]].prompt
                : `${worksheetById[prog.ids[0]].lesson} 구간 묶음 — 번호마다 한 줄씩`}
          </p>
          <p>
            다 쓴 회사{' '}
            <b data-testid="ws-panel-done">
              {prog.done}/{prog.total}
            </b>
          </p>
          {prog.missing.length > 0 && (
            <p class="t-small" data-testid="ws-missing">
              아직 안 쓴 회사: {prog.missing.join(', ')}
            </p>
          )}
          {longBundle && (
            <p data-testid="ws-long-hint" style={{ margin: '4px 0', fontWeight: 700 }}>
              3분이 지났어요. 다 못 쓴 번호는 마무리 때 이어 써요.
            </p>
          )}
          <button
            type="button"
            class={`btn ${longBundle ? 'btn--primary' : 'btn--secondary'} t-btn-sm`}
            data-testid="ws-close-all"
            onClick={() => actions.dispatch({ type: 'closeWorksheet' })}
          >
            모두 닫기(학습지 시간 끝)
          </button>
        </div>
      ) : (
        <p class="t-small" data-testid="ws-none">
          지금 떠 있는 학습지 팝업이 없어요.
        </p>
      )}

      {c.worksheet.pending.length > 0 && (
        <p class="t-small" data-testid="ws-reserved">
          라운드가 끝나면 띄우기: {c.worksheet.pending.map(labelsOf).join(', ')}
        </p>
      )}

      {next && !c.tradeEnded && (
        <p class="t-small" data-testid="ws-next" data-item={next.id}>
          다음 학습지:{' '}
          {next.placement === 'during' ? `${duringLabel(next.refId as WorksheetId)} 지금 쓰기` : labelsOf((next.refIds?.length ? next.refIds : [next.refId]) as WorksheetId[])}
          <button type="button" class="t-mini" data-testid="ws-skip" onClick={() => actions.dispatch({ type: 'skipItem', id: next.id })}>
            건너뛰기
          </button>
        </p>
      )}

      <div class="t-row t-wsp__ctrl">
        {reopenIds && !prog.ids.length && (
          <button type="button" class="t-mini" data-testid="ws-reopen" disabled={eventOpen || ended} onClick={() => open(reopenIds)}>
            다시 띄우기 {labelsOf(reopenIds)}
          </button>
        )}
        <select
          class="t-select"
          data-testid="ws-pick"
          aria-label="띄울 학습지 번호"
          value={pick}
          onChange={(e) => setPick((e.currentTarget as HTMLSelectElement).value as WorksheetId | '')}
        >
          <option value="">번호 고르기</option>
          {choices.map((id) => (
            <option key={id} value={id}>
              {worksheetById[id].label} {playIds.includes(id) ? '' : '(이번 판 밖)'}
            </option>
          ))}
        </select>
        <button
          type="button"
          class="t-mini"
          data-testid="ws-open-now"
          disabled={!pick || eventOpen || ended}
          title={eventOpen ? '사건 카드가 끝나면 띄울 수 있어요' : undefined}
          onClick={() => {
            open(pickIds);
            setPick('');
          }}
        >
          {inRound ? '라운드가 끝나면 띄우기' : '지금 띄우기'}
        </button>
      </div>

      <p class="t-small">
        <button
          type="button"
          class="t-mini"
          data-testid="ws-off"
          aria-pressed={off}
          disabled={ended}
          onClick={() => (off ? actions.dispatch({ type: 'updateSettings', settings: { worksheetMode: 'auto' } }) : turnOff())}
        >
          {off ? '학습지 팝업 다시 켜기' : '학습지 팝업 끄기'}
        </button>
      </p>

      <div class="t-wsp__table" data-testid="ws-rate-table">
        {completionGroups(game).map((grp) => (
          <details key={grp.lesson} open={grp.inPlay} style={grp.inPlay ? undefined : OFF_STYLE} data-testid="ws-rate-group" data-lesson={grp.lesson} data-inplay={grp.inPlay ? '1' : '0'}>
            <summary>
              {grp.lesson === 'optional' ? '선택 활동' : grp.lesson} {grp.rows.map((r) => r.label).join('')}
              {!grp.inPlay && ' (이번 판 밖)'}
            </summary>
            <ul style={{ margin: '2px 0 6px', paddingLeft: '18px' }}>
              {grp.rows.map((r) => (
                <li
                  key={`${r.id}${r.during ? '*' : ''}`}
                  style={r.inPlay ? undefined : OFF_STYLE}
                  data-testid={r.during ? 'ws-rate-during' : 'ws-rate-row'}
                  data-id={r.id}
                  data-inplay={r.inPlay ? '1' : '0'}
                >
                  <b>{r.label}</b> {r.done}/{r.total}
                  {r.total > 0 && ` (${Math.round((r.done / r.total) * 100)}%)`}
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
    </div>
  );
}

export default WorksheetPanel;
