/**
 * 편지함 보기 모델 — 순수 함수 (PRD 6.7, 8.3 S14) — 작업 112.
 * 슬롯·문항 배정·만료·보상은 core(`src/core/letters.ts`, 103)가 정한다. 여기서는 학생 화면에 쓸 글자만 만든다.
 */
import { mailbox, type LetterView, type PublicClass } from '../../core';
import { letterExpiry, letterRewards } from '../../data/letterSchedule';
import type { LetterQuestion, LetterRewardId } from '../../data/types';
import { classForPredict, playerForPredict, type MeView } from '../predict';
import { formatMoney } from '../text';

export type { LetterView };

/** 편지함(도착한 편지 전부, 도착 순) */
export function letterBox(cls: PublicClass, me: MeView): LetterView[] {
  return mailbox(classForPredict(cls), playerForPredict(me));
}

/** 아직 답하지 않았고 기한이 남은 편지 수(HUD 배지) */
export function unansweredCount(views: readonly LetterView[]): number {
  return views.filter((v) => !v.result && !v.expired && v.question).length;
}

export type LetterStatus = 'new' | 'right' | 'wrong' | 'expired';

export function letterStatus(v: LetterView): LetterStatus {
  if (v.result === 'right') return 'right';
  if (v.result === 'wrong') return 'wrong';
  return v.expired ? 'expired' : 'new';
}

export const STATUS_TEXT: Record<LetterStatus, string> = {
  new: '새 편지',
  right: '정답',
  wrong: '해설 읽음',
  expired: letterExpiry.expiredText,
};

/** 편지 머리 꼬리표: 구간 은행이면 "L1 구간", 무역 기초(common) 문항이면 "무역 기초" */
export function slotTag(v: LetterView): string {
  return v.question?.common ? '무역 기초' : `${v.slot.stage} 구간`;
}

/** 발신 형식 이름 */
export function senderText(q: Pick<LetterQuestion, 'format'>): string {
  return q.format === 'customs' ? '발신: 관세사 도윤' : '갈매기 바다 소식';
}

/** "맞히면: 순풍 — 다음 출항 운항비 0원" */
export function rewardPreview(reward: LetterRewardId): string {
  const r = letterRewards[reward];
  return `맞히면: ${r.name} — ${r.effect}`;
}

/** 정답 뒤 보상 안내 */
export function rewardDone(reward: LetterRewardId): string {
  const r = letterRewards[reward];
  switch (reward) {
    case 'money':
      return `${r.name} ${formatMoney(r.money ?? 0)}을 받았어요`;
    case 'fastCustoms':
      return `${r.name}: 이번 구간 동안 모든 항구에서 제값에 팔 수 있는 양이 10상자 늘었어요`;
    case 'tailwind':
      return `${r.name}: 다음 출항 운항비가 0원이에요`;
    case 'dexCard':
      return `${r.name}: 도감에 개념 카드가 생겼어요`;
  }
}

/** 칭찬 말풍선(관세사 또는 갈매기) */
export function praiseText(q: Pick<LetterQuestion, 'format'>): { who: string; text: string } {
  return q.format === 'customs'
    ? { who: '관세사 도윤', text: '정확해요! 무역을 공부하는 선장님답네요.' }
    : { who: '갈매기', text: '끼룩! 맞았어요. 바다 소식을 잘 읽었네요.' };
}

/** 쪽수 표시: [95, 96] → "교과서 95~96쪽", [96, 103] → "교과서 96쪽, 103쪽" */
export function pagesText(pages: readonly number[]): string {
  if (!pages.length) return '';
  const sorted = [...pages].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (const p of [...sorted.slice(1), Number.NaN]) {
    if (p === prev + 1) {
      prev = p;
      continue;
    }
    parts.push(start === prev ? `${start}쪽` : `${start}~${prev}쪽`);
    start = p;
    prev = p;
  }
  return `교과서 ${parts.join(', ')}`;
}

/** 정답 보기 글자 */
export function answerText(q: LetterQuestion): string {
  if (q.type === 'ox') return String(q.answer);
  const i = typeof q.answer === 'number' ? q.answer : -1;
  const label = '①②③④'[i] ?? '';
  return `${label} ${q.choices?.[i] ?? ''}`.trim();
}

/** 해설 끝의 "(교과서 95쪽)"은 아래 쪽수 줄과 겹치므로 뺀다(문장 중간의 쪽수는 그대로) */
export function explainBody(explain: string): string {
  return explain.replace(/\s*\(교과서[^()]*쪽\)\s*$/, '').trim();
}
