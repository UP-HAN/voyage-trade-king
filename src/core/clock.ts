/**
 * 무역 시계 (PRD 4.2.2, 7.8) — 작업 123. 순수 함수.
 *
 * - 시각은 모두 중계 서버 시각(ms, `now` 인자)이다. 이 파일은 시계를 직접 읽지 않는다.
 * - 경과 시간(초) = (지금 또는 일시정지 시각 − 시작 시각) − 일시정지 합계. 배치표의 `at`은 이 경과 시간 기준이다.
 * - `endsAt` = 시작 + (무역 시간 + 일시정지 합계). 일시정지 중에는 마지막 값을 그대로 두고, 화면은 `pausedAt`을 보고 멈춘 시간을 보인다.
 * - 교사 화면이 꺼져 있던 시간(`hostGap`, 5초 이상)은 일시정지로 처리한다.
 */
import type { ClockState } from './types';

/** 이보다 짧은 교사 화면 끊김은 무시한다(초) */
export const HOST_GAP_MIN_SEC = 5;

/** 아직 시작하지 않은 시계 */
export function idleClock(durationSec: number): ClockState {
  return { durationSec, startedAt: null, endsAt: null, pausedAt: null, pausedTotalSec: 0 };
}

function withEnds(c: ClockState): ClockState {
  if (c.startedAt === null) return { ...c, endsAt: null };
  return { ...c, endsAt: c.startedAt + Math.round((c.durationSec + c.pausedTotalSec) * 1000) };
}

/** 시작·일시정지 합계·무역 시간으로 `endsAt`을 다시 계산(다른 곳에서 합계를 바꾼 뒤) */
export function syncEnds(c: ClockState): ClockState {
  return withEnds(c);
}

/** [무역 시작] */
export function startTrade(c: ClockState, now: number): ClockState {
  return withEnds({ ...c, startedAt: now, pausedAt: null, pausedTotalSec: 0 });
}

/** 일시정지(이미 멈췄거나 시작 전이어도 시각만 남긴다) */
export function pause(c: ClockState, now: number): ClockState {
  if (c.pausedAt !== null) return c;
  return { ...c, pausedAt: now };
}

/** 이어서 하기: 멈춘 시간을 합계에 더하고 마감 시각을 뒤로 민다 */
export function resume(c: ClockState, now: number): ClockState {
  if (c.pausedAt === null) return c;
  const sec = Math.max(0, (now - c.pausedAt) / 1000);
  return withEnds({ ...c, pausedAt: null, pausedTotalSec: c.pausedTotalSec + sec });
}

/** 연장(초) */
export function extend(c: ClockState, sec: number): ClockState {
  return withEnds({ ...c, durationSec: c.durationSec + Math.max(0, sec) });
}

/** 단축 가능한 최대 초(이미 지난 시각보다 앞당길 수 없음) */
export function maxShortenSec(c: ClockState, now: number): number {
  return Math.max(0, Math.floor(c.durationSec - elapsedSec(c, now)));
}

/** 단축(초). 지난 시각보다 앞당기면 null */
export function shorten(c: ClockState, sec: number, now: number): ClockState | null {
  const s = Math.max(0, sec);
  if (s > maxShortenSec(c, now)) return null;
  return withEnds({ ...c, durationSec: c.durationSec - s });
}

/** 교사 화면이 꺼져 있던 시간(초)을 일시정지로 처리. 5초 미만·시작 전·이미 일시정지 중이면 그대로 */
export function hostGap(c: ClockState, sec: number): ClockState {
  if (sec < HOST_GAP_MIN_SEC || c.startedAt === null || c.pausedAt !== null) return c;
  return withEnds({ ...c, pausedTotalSec: c.pausedTotalSec + sec });
}

/** 무역 시작 뒤 흐른 시간(초, 일시정지 제외). 시작 전이면 0 */
export function elapsedSec(c: ClockState, now: number): number {
  if (c.startedAt === null) return 0;
  const until = c.pausedAt ?? now;
  return Math.max(0, (until - c.startedAt) / 1000 - c.pausedTotalSec);
}

/** 남은 시간(초, 0 이상) */
export function remaining(c: ClockState, now: number): number {
  if (c.startedAt === null) return c.durationSec;
  return Math.max(0, c.durationSec - elapsedSec(c, now));
}

/** 흐른 비율 0~1 */
export function elapsedRatio(c: ClockState, now: number): number {
  if (c.durationSec <= 0) return 1;
  return Math.min(1, elapsedSec(c, now) / c.durationSec);
}

/** 무역 시간이 다 됐는가 */
export function isTimeUp(c: ClockState, now: number): boolean {
  return c.startedAt !== null && elapsedSec(c, now) >= c.durationSec;
}
