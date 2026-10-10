/**
 * 작업 109 교사 화면 테스트 도구: 리듀서로 n명 판 만들기.
 */
import { FLAG_COLOR_IDS, FLAG_EMBLEM_IDS, AVATAR_IDS } from '../../src/core';
import type { SessionInput } from '../../src/sync/host-session';
import { newTeacherGame, teacherReducer, type TeacherGame } from '../../src/teacher/game';

export function gameWith(n: number, o: { playUnit?: 'lesson' | 'unit'; minutes?: number; start?: boolean } = {}): { game: TeacherGame; run: (i: SessionInput, t: number) => void; get: () => TeacherGame } {
  let g = newTeacherGame({
    className: '6-3',
    playUnit: o.playUnit ?? 'lesson',
    scope: o.playUnit === 'unit' ? ['L1', 'L2', 'L3', 'L4'] : ['L1'],
    tradeMinutes: o.minutes ?? 10,
    settings: {},
    overrides: {},
    seed: 11,
    now: 0,
  });
  const run = (i: SessionInput, t: number) => {
    g = teacherReducer(g, i, t).snapshot;
  };
  for (let s = 1; s <= n; s++) {
    run({ type: 'join', seat: s, pid: `p${String(s).padStart(5, '0')}`, companyName: `회사${String.fromCharCode(0xac00 + s * 37)}무역`, nameKey: `k${s}`, nameStatus: 'ok' }, 100);
    run(
      {
        type: 'act',
        seat: s,
        seq: 1,
        action: { type: 'foundCompany', color: FLAG_COLOR_IDS[s % FLAG_COLOR_IDS.length], emblem: FLAG_EMBLEM_IDS[s % FLAG_EMBLEM_IDS.length], avatar: AVATAR_IDS[s % AVATAR_IDS.length] },
      },
      200,
    );
  }
  if (o.start) {
    run({ type: 'teacher', action: { type: 'startTrade' } }, 1000);
    for (let t = 2000; t <= 300_000; t += 1000) run({ type: 'tick' }, t);
  }
  return { game: g, run, get: () => g };
}
