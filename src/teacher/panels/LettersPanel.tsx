/**
 * 교사 편지 패널(작업 112, PRD 6.7.2 — 대시보드 제어 영역의 작은 패널).
 *
 * - 편지 배달 켜기/끄기, 이번(다음) 라운드 편지 건너뛰기(모든 학생에게 똑같이 — 배달 전 슬롯만, core가 막음).
 * - 슬롯별(S1, S2 …) 도착 라운드·구간·보상·상태와 **정답률(이름 없이 수만)**. 학생별 '편지 정답 수'는 학생 표 열(109)에 있다.
 * 학급 상태는 `actions.dispatch`로만 바꾼다.
 */
import { letterSlots, type ClassState, type LetterSlotInfo } from '../../core';
import { letterRewards } from '../../data/letterSchedule';
import type { TeacherGame } from '../game';
import type { PanelProps } from './types';

export type SlotState = 'delivered' | 'skipped' | 'pending';

export interface SlotRow {
  slot: LetterSlotInfo;
  state: SlotState;
  /** 답한 회사 수 / 맞힌 회사 수 / 전체 */
  answered: number;
  right: number;
  total: number;
}

/** 슬롯별 현황(학생 이름 없음) */
export function slotRows(g: TeacherGame | null): SlotRow[] {
  if (!g) return [];
  const cs = g.class;
  const players = Object.values(g.players);
  return letterSlots(cs).map((slot) => {
    const state: SlotState = cs.letters.skipped.includes(slot.slotId) ? 'skipped' : cs.letters.delivered.includes(slot.slotId) ? 'delivered' : 'pending';
    let answered = 0;
    let right = 0;
    for (const p of players) {
      const r = p.game.letters.slots[slot.slotId];
      if (r) answered += 1;
      if (r === 'right') right += 1;
    }
    return { slot, state, answered, right, total: players.length };
  });
}

/** 다음 라운드에 도착할(아직 배달·건너뛰기 전) 슬롯 */
export function nextSlot(cs: ClassState): LetterSlotInfo | null {
  return (
    letterSlots(cs)
      .filter((s) => !cs.letters.delivered.includes(s.slotId) && !cs.letters.skipped.includes(s.slotId) && s.round > cs.round)
      .sort((a, b) => a.round - b.round)[0] ?? null
  );
}

const STATE_TEXT: Record<SlotState, string> = { delivered: '도착', skipped: '건너뜀', pending: '예정' };

export function LettersPanel({ game, actions }: PanelProps) {
  if (!game) {
    return (
      <p class="t-panel__empty" data-testid="panel-LettersPanel">
        판을 열면 편지 배달을 관리할 수 있어요.
      </p>
    );
  }
  const cs = game.class;
  const rows = slotRows(game);
  const next = nextSlot(cs);
  const started = cs.clock.startedAt !== null;
  const nextItem = next ? cs.schedule.items.find((it) => it.kind === 'letter' && it.refId === next.slotId) : undefined;
  const skipNext = () => {
    if (!next) return;
    // 배치표 항목이 있으면 [건너뛰기](타임라인에도 '건너뜀'), 없으면 슬롯만 건너뜀
    if (nextItem && started) actions.dispatch({ type: 'skipItem', id: nextItem.id });
    else actions.dispatch({ type: 'skipLetterSlot', slotId: next.slotId });
  };
  return (
    <div class="t-ltp" data-testid="panel-LettersPanel">
      <p class="t-small">
        <button
          type="button"
          class="t-mini"
          data-testid="lp-toggle"
          aria-pressed={cs.letters.enabled}
          onClick={() => actions.dispatch({ type: 'toggleLetters', enabled: !cs.letters.enabled })}
        >
          편지 배달 {cs.letters.enabled ? '켜짐' : '꺼짐'}
        </button>
        {next && !cs.tradeEnded && (
          <button type="button" class="t-mini" data-testid="lp-skip" data-slot={next.slotId} onClick={skipNext}>
            다음 편지({next.slotId}, 라운드 {next.round}) 건너뛰기
          </button>
        )}
      </p>
      {rows.length === 0 ? (
        <p class="t-small" data-testid="lp-empty">
          {started ? '이번 판에는 편지가 없어요.' : '무역을 시작하면 편지 일정이 생겨요.'}
        </p>
      ) : (
        <ul style={{ margin: 0, paddingLeft: '18px' }} data-testid="lp-slots">
          {rows.map((r) => (
            <li key={r.slot.slotId} data-testid="lp-slot" data-slot={r.slot.slotId} data-state={r.state} style={r.state === 'skipped' ? { color: '#8a7f6a' } : undefined}>
              <b>{r.slot.slotId}</b> 라운드 {r.slot.round} · {r.slot.stage} · {letterRewards[r.slot.reward].name} · {STATE_TEXT[r.state]}
              {r.state === 'delivered' && (
                <span data-testid="lp-rate">
                  {' '}
                  — 정답 {r.right}/{r.answered}
                  {r.answered > 0 && ` (${Math.round((r.right / r.answered) * 100)}%)`} · 답함 {r.answered}/{r.total}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default LettersPanel;
