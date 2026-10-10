/**
 * 개발용 `?demo=30`: 학생 30명 가짜 데이터(작업 109). 개발 서버에서만 불러온다(index.tsx가 DEV일 때 lazy import).
 * 실제 세션·서버 없이 대시보드 표·필터·배치를 확인하는 용도. 모든 값은 지어낸 것이다.
 */
import { AVATAR_IDS, FLAG_COLOR_IDS, FLAG_EMBLEM_IDS, mulberry32, seatKey } from '../core';
import { eventsById } from '../data/events';
import { lessonsById } from '../data/lessons';
import type { HostView } from '../sync/host-session';
import { newTeacherGame, teacherReducer, type TeacherGame } from './game';

const NAMES = [
  '해오름무역', '푸른바다상사', '별빛해운', '파도상회', '고래무역', '무지개상사', '바람돛무역', '등대해운', '산호상사', '갈매기무역',
  '은하수상회', '한빛무역', '새벽해운', '물결상사', '진주무역', '구름돛상회', '나침반무역', '청자해운', '보물섬상사', '돌고래무역',
  '해바라기상회', '북극성무역', '모래톱해운', '노을상사', '바다별무역', '항해왕상회', '햇살무역', '거북선해운', '소라상사', '마루무역',
];

export function makeDemo(n = 30, now = Date.now()): { game: TeacherGame; view: HostView<TeacherGame> } {
  const count = Math.max(1, Math.min(40, Math.floor(n)));
  const rnd = mulberry32(20261009);
  const start = now - 6 * 60_000;
  let g: TeacherGame = newTeacherGame({
    className: '6-3(데모)',
    playUnit: 'lesson',
    scope: ['L1'],
    tradeMinutes: 25,
    settings: {},
    overrides: {},
    seed: 7,
    now: start - 60_000,
  });
  g = { ...g, meta: { ...g.meta, code: '482137' } };
  const run = (input: Parameters<typeof teacherReducer>[1], t: number) => {
    g = teacherReducer(g, input, t).snapshot;
  };
  for (let i = 1; i <= count; i++) {
    const name = NAMES[(i - 1) % NAMES.length] as string;
    run({ type: 'join', seat: i, pid: `d${String(i).padStart(2, '0')}abc`, companyName: name, nameKey: name, nameStatus: i === 9 ? 'checkRealName' : 'ok' }, start - 30_000);
    run({ type: 'act', seat: i, seq: 1, action: { type: 'foundCompany', color: FLAG_COLOR_IDS[i % FLAG_COLOR_IDS.length] as string, emblem: FLAG_EMBLEM_IDS[i % FLAG_EMBLEM_IDS.length] as string, avatar: AVATAR_IDS[i % AVATAR_IDS.length] as string } }, start - 20_000);
  }
  run({ type: 'teacher', action: { type: 'startTrade' } }, start);
  for (let t = start; t <= now; t += 5_000) run({ type: 'tick' }, t);

  // 가짜 상태 섞기(자금·준비·응답·학습지)
  const evId = lessonsById.L1.eventQueue.find((id) => eventsById[id]?.needsResponse) ?? 'L1-E2';
  const players = { ...g.players };
  for (let i = 1; i <= count; i++) {
    const key = seatKey(i);
    const p = players[key];
    if (!p) continue;
    const money = Math.round(300 + rnd() * 700);
    const exportsV = Math.round(rnd() * 400);
    const responses = rnd() < 0.8 ? { ...p.game.responses, [evId]: 'demo' } : p.game.responses;
    players[key] = {
      ...p,
      online: i % 11 !== 0,
      game: {
        ...p.game,
        money,
        ready: rnd() < 0.7,
        responses,
        worksheetDone: rnd() < 0.6 ? ['W01'] : [],
        metrics: { ...p.game.metrics, exports: exportsV },
        letters: { ...p.game.letters, slots: rnd() < 0.5 ? { S1: 'right' } : { S1: 'wrong' } },
        missions: { 'M-GAS': { status: rnd() < 0.5 ? 'done' : 'active', steps: [false] } },
      },
    };
  }
  g = {
    ...g,
    players,
    class: {
      ...g.class,
      currentEvent: { id: evId, openedAt: now - 30_000, closesAt: null, closed: false, short: false },
      worksheet: { ...g.class.worksheet, current: ['W01'] },
    },
  };

  const seats = Object.values(g.players)
    .sort((a, b) => a.seat - b.seat)
    .map((p) => ({
      seat: p.seat,
      pid: p.pid,
      companyName: p.company.name,
      nameStatus: (p.seat === 9 ? 'checkRealName' : p.seat === 17 ? 'blocked' : 'ok') as 'ok' | 'blocked' | 'checkRealName',
      online: p.online,
      joinedAt: start - 30_000,
    }));
  const view: HostView<TeacherGame> = {
    status: 'open',
    connection: 'online',
    code: '482137',
    codeChanged: null,
    locked: false,
    ended: false,
    seats,
    rejoinRequests: [{ seat: 7, companyName: seats[6]?.companyName ?? '', oldOnline: true, at: now - 10_000, peerId: 'demo-peer' }],
    joinProblems: [{ seat: 12, attempts: 2, lastAt: now - 20_000, peerId: 'demo-peer-2' }],
    badNameRejects: 1,
    teacher: null,
    game: g,
    storageError: null,
    disconnectedAt: null,
  };
  return { game: g, view };
}
