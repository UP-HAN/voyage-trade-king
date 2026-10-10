/** core 테스트 공용 도구 */
import { hostReduce, type HostHooks } from '../../src/core/host';
import { seatKey, startSession } from '../../src/core/state';
import type { Action, HostInput, HostSnapshot, PlayUnit, Player, ReduceResult, TeacherAction } from '../../src/core/types';
import type { LessonId } from '../../src/data/types';

export const pidOf = (seat: number) => `p${String(seat).padStart(2, '0')}qz`;

export function makeSession(opts: { n?: number; scope?: LessonId[]; playUnit?: PlayUnit; seed?: number } = {}): HostSnapshot {
  let snap = startSession({
    code: '482137',
    playUnit: opts.playUnit ?? 'lesson',
    scope: opts.scope ?? ['L1'],
    seed: opts.seed ?? 12345,
    now: 0,
    hostToken: 'host-token',
  });
  for (let seat = 1; seat <= (opts.n ?? 0); seat++) {
    snap = hostReduce(snap, {
      type: 'join',
      seat,
      pid: pidOf(seat),
      deviceToken: `device-token-${seat}`,
      companyName: `해오름${seat}`,
      nameKey: `해오름${seat}`,
    }, 0).snapshot;
  }
  return snap;
}

export function run(snap: HostSnapshot, input: HostInput, now = 1000, hooks?: HostHooks): ReduceResult {
  return hostReduce(snap, input, now, hooks);
}

export function teach(snap: HostSnapshot, action: TeacherAction, now = 1000): HostSnapshot {
  return hostReduce(snap, { type: 'teacher', action }, now).snapshot;
}

export function act(snap: HostSnapshot, seat: number, action: Action, seq = 1, now = 1000): ReduceResult {
  return hostReduce(snap, { type: 'act', seat, seq, action }, now);
}

export function player(snap: HostSnapshot, seat: number): Player {
  return snap.players[seatKey(seat)];
}

/** 학생 상태를 직접 고친 새 스냅숏(테스트 준비용) */
export function editPlayer(snap: HostSnapshot, seat: number, fn: (p: Player) => void): HostSnapshot {
  const p = JSON.parse(JSON.stringify(player(snap, seat))) as Player;
  fn(p);
  return { ...snap, players: { ...snap.players, [seatKey(seat)]: p } };
}

/** 라운드 시작까지(준비 → 라운드 1) */
export function startFirstRound(snap: HostSnapshot, now = 1000): HostSnapshot {
  return teach(snap, { type: 'startRound' }, now);
}
