/**
 * 편지·갈매기 퀴즈 (PRD 6.7, v0.3) — 작업 103.
 *
 * - 슬롯은 배치표(`classState.schedule.items`)의 `kind: 'letter'` 항목에서 온다(refId 'S1'…, stage, round).
 *   테스트·시뮬레이션은 `classState.letters.slots`에 슬롯 목록을 직접 넣을 수 있다(있으면 배치표 대신 씀).
 * - 보상·난이도는 슬롯 순서의 순환 패턴(`src/data/letterSchedule.ts`)으로 정한다. 같은 슬롯 = 같은 보상·같은 난이도.
 * - 출제: 그 슬롯 구간의 은행(`letterBank`)을 **출석번호 기반으로 회전**한 순서에서, 앞 슬롯에 이미 나온 문항을 건너뛴다
 *   → 한 학생에게 같은 문항이 두 번 나오지 않는다. 출석번호는 호스트 내부 계산에만 쓴다(공개 상태에 없음).
 * - 만료: 다음 편지가 도착했고 그리고 도착 뒤 최소 2라운드가 지나면, 무역 시간이 끝나면 전부(PRD 6.7.2).
 */
import { letterAnswerRules, letterExpiry, letterRewards, slotAt } from '../data/letterSchedule';
import { letterBank, lettersById } from '../data/letters';
import type { LetterQuestion } from '../data/types';
import { grantDex } from './progress';
import type { Answer, ClassState, GameEvent, LetterSlotInfo, Player } from './types';

/** 'S3' → 2 */
export function slotIndex(slotId: string): number {
  const n = Number(/^S(\d+)$/.exec(slotId)?.[1] ?? NaN);
  return Number.isFinite(n) && n >= 1 ? n - 1 : -1;
}

/** 이 판의 편지 슬롯 전체(배치표 또는 직접 넣은 목록) */
export function letterSlots(cs: ClassState): LetterSlotInfo[] {
  if (cs.letters.slots) return cs.letters.slots;
  const out: LetterSlotInfo[] = [];
  for (const it of cs.schedule.items) {
    if (it.kind !== 'letter' || typeof it.round !== 'number') continue;
    const index = slotIndex(it.refId);
    if (index < 0) continue;
    const pat = slotAt(index);
    out.push({ slotId: pat.slotId, index, stage: it.stage, round: it.round, reward: pat.reward, difficulty: pat.difficulty });
  }
  return out.sort((a, b) => a.index - b.index);
}

/** 테스트용: 슬롯 n개를 라운드에 배정(순환 패턴 그대로) */
export function makeSlots(entries: readonly { stage: LetterSlotInfo['stage']; round: number }[]): LetterSlotInfo[] {
  return entries.map((e, i) => {
    const pat = slotAt(i);
    return { slotId: pat.slotId, index: i, stage: e.stage, round: e.round, reward: pat.reward, difficulty: pat.difficulty };
  });
}

/** 이 라운드 시작에 도착하는 슬롯 ID(켜져 있고 건너뛰지 않은 것) */
export function slotsArrivingAt(cs: ClassState, round: number): string[] {
  if (!cs.letters.enabled) return [];
  return letterSlots(cs)
    .filter((s) => s.round === round && !cs.letters.skipped.includes(s.slotId) && !cs.letters.delivered.includes(s.slotId))
    .map((s) => s.slotId);
}

/** 이미 도착한 슬롯(도착 순, 건너뛴 슬롯 제외) */
export function deliveredSlots(cs: ClassState): LetterSlotInfo[] {
  const byId = new Map(letterSlots(cs).map((s) => [s.slotId, s]));
  return cs.letters.delivered
    .filter((id) => !cs.letters.skipped.includes(id))
    .map((id) => byId.get(id))
    .filter((s): s is LetterSlotInfo => s !== undefined);
}

/**
 * 그 슬롯에 이 학생이 받는 문항. `history`는 그 판의 도착 슬롯 순서(기본: 이 슬롯 하나).
 * - 도착 때 배정된 문항(`letters.assigned`)이 있으면 그대로 쓴다(출석번호·슬롯이 바뀌어도 고정).
 * - 없으면 출석번호 기반 회전 순서에서, 이미 답했거나 다른 슬롯에 배정·출제된 문항을 건너뛴다.
 * 은행이 모자라면 null.
 */
export function letterForSlot(player: Player, slot: LetterSlotInfo, history: readonly LetterSlotInfo[] = [slot]): LetterQuestion | null {
  const assigned = player.game.letters.assigned ?? {};
  const fixed = assigned[slot.slotId];
  if (fixed && lettersById[fixed]) return lettersById[fixed];
  const seq = history.some((s) => s.slotId === slot.slotId) ? history : [...history, slot];
  const used = new Set<string>([...player.game.letters.answered, ...Object.values(assigned)]);
  for (const s of seq) {
    const pre = assigned[s.slotId];
    if (s.slotId !== slot.slotId && pre) continue; // 이미 used 에 들어 있음
    const bank = letterBank(s.stage, s.difficulty);
    let q: LetterQuestion | null = null;
    if (bank.length) {
      const offset = (((player.seat - 1) % bank.length) + bank.length) % bank.length;
      const rotated = [...bank.slice(offset), ...bank.slice(0, offset)];
      q = rotated.find((x) => !used.has(x.id)) ?? null;
    }
    if (s.slotId === slot.slotId) return q;
    if (q) used.add(q.id);
  }
  return null;
}

/**
 * 편지가 도착한 순간 이 학생의 문항을 배정해 기록한다(player 는 복사본, 직접 고침).
 * 호스트가 라운드 시작(편지 도착) 때 모든 학생에게, 늦게 온 학생에게는 입장 때 부른다. 바뀌었으면 true.
 */
export function assignDeliveredLetters(cs: ClassState, p: Player): boolean {
  const list = deliveredSlots(cs);
  let changed = false;
  for (const slot of list) {
    if (p.game.letters.assigned[slot.slotId]) continue;
    const q = letterForSlot(p, slot, list);
    if (!q) continue;
    p.game.letters.assigned[slot.slotId] = q.id;
    changed = true;
  }
  return changed;
}

/** 만료됐는가(PRD 6.7.2) */
export function isSlotExpired(cs: ClassState, slot: LetterSlotInfo): boolean {
  if (cs.tradeEnded || cs.phase === 'wrapup' || cs.phase === 'ended') return true;
  const list = deliveredSlots(cs);
  const i = list.findIndex((s) => s.slotId === slot.slotId);
  const next = i >= 0 ? list[i + 1] : undefined;
  const limit = Math.max(slot.round + letterExpiry.minRounds, next ? next.round : Number.POSITIVE_INFINITY);
  return cs.round >= limit;
}

export interface LetterView {
  slot: LetterSlotInfo;
  question: LetterQuestion | null;
  expired: boolean;
  result: 'right' | 'wrong' | null;
}

/** 편지함(도착한 편지 전부) */
export function mailbox(cs: ClassState, player: Player): LetterView[] {
  const list = deliveredSlots(cs);
  return list.map((slot) => ({
    slot,
    question: letterForSlot(player, slot, list),
    expired: isSlotExpired(cs, slot),
    result: player.game.letters.slots[slot.slotId] ?? null,
  }));
}

export function isRightAnswer(q: { answer: number | 'O' | 'X' }, answer: Answer): boolean {
  return q.answer === answer;
}

/**
 * 편지 답하기. player 는 이미 복사본이어야 한다(직접 고침). 오류면 문자열을 돌려준다.
 * 정답: 슬롯 보상(1회) + 무역 박사 +1. 오답: 보상·벌칙 없음.
 */
export function applyLetterAnswer(cs: ClassState, p: Player, slotId: string, answer: Answer, events: GameEvent[]): string | null {
  const list = deliveredSlots(cs);
  const slot = list.find((s) => s.slotId === slotId);
  if (!slot) return 'NO_SLOT';
  if (p.game.letters.slots[slotId]) return 'ANSWERED';
  if (isSlotExpired(cs, slot)) return 'EXPIRED';
  const q = letterForSlot(p, slot, list);
  if (!q) return 'NO_QUESTION';
  const right = isRightAnswer(q, answer);
  p.game.letters.slots[slotId] = right ? 'right' : 'wrong';
  p.game.letters.answered.push(q.id);
  if (right) {
    p.game.metrics.quizRight += letterAnswerRules.quizMetricOnRight;
    const r = letterRewards[slot.reward];
    if (slot.reward === 'money') {
      p.game.money += r.money ?? 0;
      events.push({ type: 'money', amount: r.money ?? 0, reason: `letter:${slotId}` });
    } else if (slot.reward === 'fastCustoms') {
      p.game.effects.fastCustomsStage = cs.stage;
    } else if (slot.reward === 'tailwind') {
      p.game.effects.tailwind += 1;
    } else if (slot.reward === 'dexCard') {
      grantDex(p, q.dexCard, events);
    }
  }
  events.push({ type: 'letterResult', slotId, right, reward: right ? slot.reward : null });
  p.game.log.push({ round: cs.round, stage: cs.stage, kind: 'letter', ref: slotId });
  return null;
}
