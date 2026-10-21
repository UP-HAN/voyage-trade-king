/**
 * 작업 110 공용 화면 테스트 자료: 실제 교사 리듀서(109 `teacherReducer` = 103 hostReduce)로 판을 만들고
 * 공개 상태(`publicView`)·공용 화면 보기(`screenView`)를 그대로 꺼낸다. vitest와 e2e(개발 서버에서 `import('/tests/screen/fixtures.ts')`)가 함께 쓴다.
 * 학생 값(자금·지표·응답)은 화면 확인용으로 지어낸 것이다.
 */
import { AVATAR_IDS, FLAG_COLOR_IDS, FLAG_EMBLEM_IDS, seatKey, type TopN } from '../../src/core';
import type { LessonId, WorksheetId } from '../../src/data/types';
import { newTeacherGame, publicView, screenView, teacherReducer, type ScreenScene, type TeacherGame } from '../../src/teacher/game';

export const FIXTURE_NAMES = [
  '해오름무역', '푸른바다상사', '별빛해운', '파도상회', '고래무역', '무지개상사', '바람돛무역', '등대해운', '산호상사', '갈매기무역',
  '은하수상회', '한빛무역', '새벽해운', '물결상사', '진주무역', '구름돛상회', '나침반무역', '청자해운', '보물섬상사', '돌고래무역',
  '해바라기상회', '북극성무역', '모래톱해운', '노을상사', '바다별무역', '항해왕상회', '햇살무역',
];

export type FixtureScene =
  | 'prep'
  | 'cover'
  | 'summary'
  | 'event'
  | 'vote'
  | 'bars'
  /** (작업 113) 미니게임이 아닌 결과 막대: L3-E4 투표 공개 뒤 라운드 사이 → BarsScene */
  | 'barsVote'
  | 'map'
  | 'between'
  | 'worksheet'
  | 'worksheetBundle'
  | 'worksheetCustoms'
  | 'pause'
  | 'awards'
  | 'unitL2Cover';

export interface FixtureOptions {
  n?: number;
  topN?: TopN;
  choice?: ScreenScene;
  /** 이름을 막을 출석번호(공개 상태에서 null → "이름 짓는 중") */
  blockSeats?: number[];
  now?: number;
  /** 지어낸 지표를 넣지 않음(거래 전처럼 모든 값이 같음) */
  plain?: boolean;
  /** 'awards'를 단원 한 판으로 */
  unit?: boolean;
}

export interface ScreenPayload {
  publicState: Record<string, unknown>;
  classView: Record<string, unknown> | null;
}

/** 판 하나 만들기 */
export function buildGame(scene: FixtureScene, o: FixtureOptions = {}): TeacherGame {
  const n = o.n ?? 27;
  const now = o.now ?? Date.now();
  const unit = scene === 'unitL2Cover' || (scene === 'awards' && !!o.unit);
  const lessonL2 = scene === 'summary';
  const scope: LessonId[] = unit ? ['L1', 'L2', 'L3', 'L4'] : lessonL2 ? ['L2'] : ['L1'];
  const start = now - 4 * 60_000;
  let g = newTeacherGame({
    className: '6-3',
    playUnit: unit ? 'unit' : 'lesson',
    scope,
    tradeMinutes: 25,
    settings: { leaderboardTopN: o.topN ?? 3 },
    overrides: {},
    seed: 5,
    now: start - 120_000,
  });
  g = { ...g, meta: { ...g.meta, code: '482137' } };
  const run = (input: Parameters<typeof teacherReducer>[1], t: number) => {
    g = teacherReducer(g, input, t).snapshot;
  };
  for (let s = 1; s <= n; s++) {
    const name = FIXTURE_NAMES[(s - 1) % FIXTURE_NAMES.length] as string;
    run({ type: 'join', seat: s, pid: `x${String(s * 7919).padStart(5, '0')}`, companyName: name, nameKey: name, nameStatus: 'ok' }, start - 60_000);
    run(
      {
        type: 'act',
        seat: s,
        seq: 1,
        action: {
          type: 'foundCompany',
          color: FLAG_COLOR_IDS[s % FLAG_COLOR_IDS.length] as string,
          emblem: FLAG_EMBLEM_IDS[s % FLAG_EMBLEM_IDS.length] as string,
          avatar: AVATAR_IDS[s % AVATAR_IDS.length] as string,
        },
      },
      start - 50_000,
    );
  }
  for (const s of o.blockSeats ?? []) run({ type: 'teacher', action: { type: 'blockCompanyName', seat: s } }, start - 40_000);
  if (o.choice) run({ type: 'teacher', action: { type: 'setScreenScene', scene: o.choice } } as never, start - 30_000);
  if (scene === 'prep') return withMetrics(g, n, o.plain);

  run({ type: 'teacher', action: { type: 'startTrade' } }, start);
  if (scene === 'cover' || scene === 'summary' || scene === 'unitL2Cover') {
    run({ type: 'tick' }, start + 1000);
    if (scene === 'summary') {
      // 표지가 끝나면 앞 차시 요약 카드
      const cover = g.class.schedule.items.find((it) => it.kind === 'stageCover' && it.variant !== 'summary');
      if (cover) run({ type: 'teacher', action: { type: 'closeEvent' } }, start + 2000);
      for (let t = start + 3000; t <= start + 40_000; t += 1000) {
        run({ type: 'tick' }, t);
        if (g.class.schedule.items.some((it) => it.variant === 'summary' && it.status === 'live')) break;
      }
    }
    if (scene === 'unitL2Cover') {
      g = withMetrics(g, n, o.plain);
      // 단원 한 판: L2 표지를 바로 띄운다(지금까지 상위 N개 회사)
      run({ type: 'teacher', action: { type: 'closeEvent' } }, start + 2000);
      const l2 = g.class.schedule.items.find((it) => it.kind === 'stageCover' && it.stage === 'L2');
      g = {
        ...g,
        class: {
          ...g.class,
          stage: 'L2',
          phase: 'event',
          currentEvent: { id: 'L2-E1', openedAt: now - 5000, closesAt: null, closed: false, short: false },
          schedule: { ...g.class.schedule, items: g.class.schedule.items.map((it) => (it === l2 ? { ...it, status: 'live' as const } : it)) },
        },
      };
      return g;
    }
    return withMetrics(g, n, o.plain);
  }
  // 나머지: 무역 중 몇 분 흐른 뒤
  run({ type: 'teacher', action: { type: 'closeEvent' } }, start + 2000);
  g = withMetrics(g, n, o.plain);
  const cls = g.class;
  const at = now - 30_000;
  switch (scene) {
    case 'event':
      g = { ...g, class: { ...cls, phase: 'event', currentEvent: { id: 'L1-E2', openedAt: at, closesAt: null, closed: false, short: false } } };
      break;
    case 'vote':
      g = { ...g, class: { ...cls, phase: 'event', currentEvent: { id: 'L1-E1', openedAt: at, closesAt: null, closed: false, short: false } } };
      g = respond(g, n, 'L1-E1', (s) => (s % 4 === 0 ? undefined : { correct: s % 9 }));
      break;
    case 'bars':
      g = respond(g, n, 'L1-E1', (s) => ({ correct: (s * 5) % 10 }));
      g = { ...g, class: { ...g.class, phase: 'between', currentEvent: { id: 'L1-E1', openedAt: at, closesAt: null, closed: true, short: false } } };
      break;
    case 'barsVote':
      // (작업 113) 벽란도 자료가 미니게임 결과 장면으로 가므로, 일반 막대 장면(BarsScene)은 투표 자료로 검사한다
      g = respond(g, n, 'L3-E4', (s) => (s % 5 === 0 ? undefined : { vote: s % 3 === 0 ? 'no' : 'yes' }));
      g = {
        ...g,
        class: {
          ...g.class,
          phase: 'between',
          firedEvents: [...g.class.firedEvents, 'L3-E4'],
          votes: { ...g.class.votes, 'L3-E4': { revealed: true, result: null } },
          currentEvent: { id: 'L3-E4', openedAt: at, closesAt: null, closed: true, short: false, revealed: true },
        },
      };
      break;
    case 'map':
      run({ type: 'teacher', action: { type: 'startRound', durationSec: 180 } }, now - 40_000);
      break;
    case 'between':
      g = { ...g, class: { ...cls, phase: 'between', round: 1 } };
      break;
    case 'worksheet':
    case 'worksheetBundle':
    case 'worksheetCustoms': {
      const ids: WorksheetId[] = scene === 'worksheet' ? ['W03'] : scene === 'worksheetCustoms' ? ['W05'] : ['W01', 'W02', 'W03', 'W04'];
      g = { ...g, class: { ...cls, phase: 'worksheet', worksheet: { ...cls.worksheet, current: ids, openedAt: at } } };
      const players = { ...g.players };
      for (let s = 1; s <= n; s++) {
        const p = players[seatKey(s)];
        if (p && s <= 18) players[seatKey(s)] = { ...p, game: { ...p.game, worksheetDone: [...ids] } };
      }
      g = { ...g, players };
      break;
    }
    case 'pause':
      run({ type: 'teacher', action: { type: 'startRound', durationSec: 180 } }, now - 40_000);
      run({ type: 'teacher', action: { type: 'pause' } }, now - 5000);
      break;
    case 'awards':
      run({ type: 'teacher', action: { type: 'finishNow' } }, now - 5000);
      if (g.class.phase !== 'wrapup') g = { ...g, class: { ...g.class, phase: 'wrapup', tradeEnded: true } };
      break;
    default:
      break;
  }
  return g;
}

function respond(g: TeacherGame, n: number, eventId: string, fn: (seat: number) => unknown): TeacherGame {
  const players = { ...g.players };
  for (let s = 1; s <= n; s++) {
    const p = players[seatKey(s)];
    const r = fn(s);
    if (p && r !== undefined) players[seatKey(s)] = { ...p, game: { ...p.game, responses: { ...p.game.responses, [eventId]: r as never } } };
  }
  return { ...g, players };
}

/** 지어낸 지표(순위판·시상 확인용) */
function withMetrics(g: TeacherGame, n: number, plain = false): TeacherGame {
  if (plain) return g;
  const players = { ...g.players };
  for (let s = 1; s <= n; s++) {
    const p = players[seatKey(s)];
    if (!p) continue;
    const k = (s * 37) % 29;
    players[seatKey(s)] = {
      ...p,
      game: {
        ...p.game,
        money: 400 + k * 23,
        ready: s % 3 !== 0,
        metrics: {
          ...p.game.metrics,
          exports: k * 31,
          quizRight: s % 5,
          csr: 50 + (s % 4) * 5,
          visited: ['BUS', 'SHA', 'YOK', 'HCM', 'BKK', 'PHE'].slice(0, 1 + (s % 6)) as never,
        },
      },
    };
  }
  return { ...g, players };
}

/** 다리로 보내는 모양 그대로(출석번호가 있으면 예외 — strict) */
export function payloadOf(g: TeacherGame): ScreenPayload {
  return { publicState: publicView(g, true) as Record<string, unknown>, classView: screenView(g, true) as Record<string, unknown> };
}

export function scenePayload(scene: FixtureScene, o: FixtureOptions = {}): ScreenPayload {
  return payloadOf(buildGame(scene, o));
}
