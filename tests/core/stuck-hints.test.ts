/**
 * 작업 160b — 막힌 학생 갈매기 힌트(core): 상황 판정, 힌트 시계(사고팔 수 있던 시간만), 보내는 시각, 진척 리셋,
 * 반복 방지·상한, 오프라인, 일시정지 제외(실제 무역 훅), 스냅숏 복원, 출력(공개 상태 매초 없음), 다른 판.
 */
import { describe, expect, it } from 'vitest';
import { hostReduce, playerView } from '../../src/core/host';
import { normalizePlayer, normalizeSnapshot, seatKey, startSession } from '../../src/core/state';
import { situationOf, stepStuckHints } from '../../src/core/stuckHints';
import { createTradeHooks } from '../../src/core/trade';
import type { CargoLot, ClassState, HostOutput, HostSnapshot, Player } from '../../src/core';
import { stuckHintRules } from '../../src/data/stuckHints';
import type { GoodId, LessonId, PortId } from '../../src/data/types';
import { act, editPlayer, makeSession, player, teach } from './helpers';

const hintsOf = (s: HostSnapshot, seat = 1) => (player(s, seat).game.gullHints ?? []).map((h) => h.id);

/** 2차시 판(훅 없이): 표지 → 임무 M-IPE 발동 → 라운드 1. 회사 설립·무역 시작(startedAt)까지 준비 */
function l2Ready(n = 1): HostSnapshot {
  let s = makeSession({ n, scope: ['L2'] });
  s = teach(s, { type: 'startStage', stage: 'L2' });
  s = teach(s, { type: 'closeEvent' });
  s = teach(s, { type: 'fireEvent', id: 'L2-E3' });
  s = teach(s, { type: 'closeEvent' });
  s = teach(s, { type: 'startRound', durationSec: 3000 });
  for (let seat = 1; seat <= n; seat++) s = editPlayer(s, seat, (p) => void (p.company.founded = true));
  return withClass(s, { clock: { ...s.class.clock, startedAt: 0 } });
}

function withClass(s: HostSnapshot, patch: Partial<ClassState>): HostSnapshot {
  return { ...s, class: { ...s.class, ...patch } };
}

const lot = (good: GoodId, qty: number, source: CargoLot['source'] = 'specialty', boughtAt: PortId = 'DAM'): CargoLot => ({
  good, qty, unitCost: 30, origin: source === 'factory' || source === 'domestic' ? 'korea' : 'foreign', source, boughtAt,
});

const setCargo = (s: HostSnapshot, cargo: CargoLot[], steps?: boolean[]) =>
  editPlayer(s, 1, (p) => {
    p.game.cargo = cargo;
    if (steps) p.game.missions['M-IPE'] = { status: 'active', steps };
  });

const sit = (s: HostSnapshot) => situationOf(s.class, player(s, 1), 'M-IPE')?.key ?? null;

/** stepStuckHints 를 1초 간격으로 n번(시각 t0부터) */
function stepN(s: HostSnapshot, n: number, t0: number): { s: HostSnapshot; t: number } {
  let t = t0;
  for (let i = 0; i < n; i++) {
    s = stepStuckHints(s, t).snapshot;
    t += 1000;
  }
  return { s, t };
}

describe('① situationOf — 상황 키', () => {
  it('2차시 시작(부산, 원유 2) → make:oilp, 생산 뒤 → export:oilp, 부산에 판 뒤 → again', () => {
    let s = l2Ready();
    expect(player(s, 1).game.cargo.map((l) => [l.good, l.qty])).toEqual([['crude', 2]]);
    expect(sit(s)).toBe('make:oilp');
    s = act(s, 1, { type: 'produce', recipe: 'oilp', qty: 1 }).snapshot;
    expect(player(s, 1).game.missions['M-IPE']!.steps).toEqual([true, true, false]);
    expect(sit(s)).toBe('export:oilp');
    s = act(s, 1, { type: 'sell', good: 'oilp', qty: 1 }, 2).snapshot;
    expect(player(s, 1).game.cargo.some((l) => l.good === 'oilp')).toBe(false);
    // 원유 1상자가 남아 있어도 1단계를 끝냈으니 again
    expect(sit(s)).toBe('again');
  });

  it('원유를 부산에 판 뒤(0단계만 참) → buy', () => {
    let s = l2Ready();
    s = act(s, 1, { type: 'sell', good: 'crude', qty: 2 }).snapshot;
    expect(player(s, 1).game.missions['M-IPE']!.steps).toEqual([true, false, false]);
    expect(sit(s)).toBe('buy');
  });

  it('흑연만 → parts:nickel+chem / 철광석 2 → make:steel / 철광석 1 → buy / 흑연·니켈·정밀 화학 원료 1씩 → make:battery', () => {
    const s = l2Ready();
    expect(sit(setCargo(s, [lot('graphite', 1, 'domestic', 'BUS')]))).toBe('parts:nickel+chem');
    expect(sit(setCargo(s, [lot('nickel', 2, 'specialty', 'JKT')]))).toBe('parts:graphite+chem');
    expect(sit(setCargo(s, [lot('iron', 2, 'specialty', 'PHE')]))).toBe('make:steel');
    expect(sit(setCargo(s, [lot('iron', 1, 'specialty', 'PHE')]))).toBe('buy');
    expect(sit(setCargo(s, [lot('graphite', 1, 'specialty', 'SHA'), lot('nickel', 1, 'specialty', 'JKT'), lot('chem', 1, 'specialty', 'YOK')]))).toBe('make:battery');
    // 우선순위 oilp → steel → battery
    expect(sit(setCargo(s, [lot('iron', 2), lot('crude', 1)]))).toBe('make:oilp');
    expect(sit(setCargo(s, [lot('steel', 1, 'factory', 'BUS')], [true, true, false]))).toBe('export:steel');
    expect(sit(setCargo(s, [lot('battery', 1, 'factory', 'BUS')], [true, true, false]))).toBe('export:battery');
  });

  it('해외 수출 뒤(임무 done) → null, 공장 기능 없음 → null, 모르는 임무 → null', () => {
    let s = l2Ready();
    s = act(s, 1, { type: 'produce', recipe: 'oilp', qty: 1 }).snapshot;
    s = editPlayer(s, 1, (p) => void (p.game.port = 'HCM'));
    s = act(s, 1, { type: 'sell', good: 'oilp', qty: 1 }, 2).snapshot;
    expect(player(s, 1).game.missions['M-IPE']!.status).toBe('done');
    expect(sit(s)).toBeNull();
    const noFactory = withClass(l2Ready(), { features: ['market'] });
    expect(sit(noFactory)).toBeNull();
    expect(situationOf(l2Ready().class, player(l2Ready(), 1), 'M-RELAY')).toBeNull();
  });
});

describe('② 힌트 시계 — 사고팔 수 있던 시간만', () => {
  const sec = (s: HostSnapshot) => s.stuck?.clock.sec ?? 0;

  it('1초 틱 131번(첫 틱은 기준점) → 130초, 틱 사이 60초 → +2초만', () => {
    let { s, t } = stepN(l2Ready(), 131, 0);
    expect(sec(s)).toBe(130);
    s = stepStuckHints(s, t + 59_000).snapshot;
    expect(sec(s)).toBe(132);
  });

  it.each([
    ['사건(phase event)', { phase: 'event' }],
    ['학습지 팝업(phase worksheet)', { phase: 'worksheet' }],
    ['[잠깐 멈춤]', { paused: true }],
    ['라운드 사이(라운드마다 판)', { phase: 'between' }],
    ['무역 끝', { tradeEnded: true, phase: 'wrapup' }],
  ] as [string, Partial<ClassState>][])('%s 동안은 sec 그대로', (_, patch) => {
    let { s, t } = stepN(l2Ready(), 11, 0);
    expect(sec(s)).toBe(10);
    s = withClass(s, patch);
    ({ s, t } = stepN(s, 100, t));
    expect(sec(s)).toBe(10);
    expect(s.stuck!.clock.lastAt).toBeNull();
  });

  it('무역 시작 전(startedAt null)은 세지 않고, 스냅숏 객체도 그대로', () => {
    const s0 = withClass(l2Ready(), { clock: { ...l2Ready().class.clock, startedAt: null } });
    const r = stepStuckHints(s0, 5000);
    expect(r.snapshot).toBe(s0);
  });

  it('멈춤에서 돌아오면 멈춘 시간을 더하지 않는다', () => {
    let { s, t } = stepN(l2Ready(), 11, 0);
    s = withClass(s, { paused: true });
    ({ s, t } = stepN(s, 30, t));
    s = withClass(s, { paused: false });
    ({ s, t } = stepN(s, 5, t));
    // 다시 도는 첫 틱은 기준점(0) + 4틱
    expect(sec(s)).toBe(14);
  });

  it('자유 항해 판 라운드 사이(round ≥ 1)는 센다', () => {
    let s = l2Ready();
    s = withClass(s, { phase: 'between', settings: { ...s.class.settings, voyageMode: 'free' } });
    ({ s } = stepN(s, 21, 0));
    expect(sec(s)).toBe(20);
  });
});

describe('③ 보내는 시각', () => {
  it('119초 없음, 120초 IPE-MAKE-1:oilp 1번, 239초 없음, 240초 IPE-MAKE-2:oilp, 그 뒤 몇 분이 지나도 없음', () => {
    let { s, t } = stepN(l2Ready(), 120, 0); // sec 0..119
    expect(s.stuck!.clock.sec).toBe(119);
    expect(hintsOf(s)).toEqual([]);
    ({ s, t } = stepN(s, 1, t)); // 120
    expect(hintsOf(s)).toEqual(['IPE-MAKE-1:oilp']);
    expect(player(s, 1).game.gullHints![0]).toEqual({ id: 'IPE-MAKE-1:oilp', mission: 'M-IPE', at: 120 });
    ({ s, t } = stepN(s, 119, t)); // 239
    expect(hintsOf(s)).toEqual(['IPE-MAKE-1:oilp']);
    ({ s, t } = stepN(s, 1, t)); // 240
    expect(hintsOf(s)).toEqual(['IPE-MAKE-1:oilp', 'IPE-MAKE-2:oilp']);
    ({ s, t } = stepN(s, 600, t));
    expect(hintsOf(s)).toEqual(['IPE-MAKE-1:oilp', 'IPE-MAKE-2:oilp']);
  });

  it('회사를 세우지 않은 학생은 받지 않는다', () => {
    const s0 = editPlayer(l2Ready(), 1, (p) => void (p.company.founded = false));
    const { s } = stepN(s0, 300, 0);
    expect(hintsOf(s)).toEqual([]);
  });
});

describe('④ 진척하면 다시 센다', () => {
  it('100초에 생산 → 120초 힌트 없음, 220초 IPE-EXPORT-1:oilp', () => {
    let { s, t } = stepN(l2Ready(), 100, 0); // sec 0..99
    s = act(s, 1, { type: 'produce', recipe: 'oilp', qty: 1 }, 1, t).snapshot;
    ({ s, t } = stepN(s, 21, t)); // 100..120
    expect(hintsOf(s)).toEqual([]);
    ({ s, t } = stepN(s, 99, t)); // ..219
    expect(hintsOf(s)).toEqual([]);
    ({ s, t } = stepN(s, 1, t)); // 220
    expect(hintsOf(s)).toEqual(['IPE-EXPORT-1:oilp']);
    expect(s.stuck!.watch[seatKey(1)]!['M-IPE']).toMatchObject({ key: 'export:oilp', since: 100, sent: 1, lastHintAt: 220 });
  });
});

describe('⑤ 반복 방지·상한', () => {
  it('이미 받은 힌트는 다시 안 가고 그 상황의 다음 힌트로', () => {
    const s0 = editPlayer(l2Ready(), 1, (p) => void (p.game.gullHints = [{ id: 'IPE-MAKE-1:oilp', mission: 'M-IPE', at: 5 }]));
    let { s, t } = stepN(s0, 121, 0);
    expect(hintsOf(s)).toEqual(['IPE-MAKE-1:oilp', 'IPE-MAKE-2:oilp']);
    ({ s, t } = stepN(s, 600, t));
    expect(hintsOf(s)).toHaveLength(2);
  });

  it('상황이 돌아와도(원유를 다시 실음) 받은 힌트는 다시 안 감', () => {
    let { s, t } = stepN(l2Ready(), 241, 0);
    expect(hintsOf(s)).toEqual(['IPE-MAKE-1:oilp', 'IPE-MAKE-2:oilp']);
    s = setCargo(s, []); // buy
    ({ s, t } = stepN(s, 10, t));
    s = setCargo(s, [lot('crude', 2)]); // 다시 make:oilp
    ({ s, t } = stepN(s, 600, t));
    expect(hintsOf(s)).toEqual(['IPE-MAKE-1:oilp', 'IPE-MAKE-2:oilp']);
  });

  it('임무당 5개 상한', () => {
    const five = ['A', 'B', 'C', 'D', 'E'].map((x, i) => ({ id: `X-${x}`, mission: 'M-IPE', at: i }));
    const s0 = editPlayer(l2Ready(), 1, (p) => void (p.game.gullHints = five));
    const { s } = stepN(s0, 600, 0);
    expect(hintsOf(s)).toEqual(five.map((h) => h.id));
    expect(stuckHintRules.perMission).toBe(5);
  });

  it('상황을 바꿔 가며 계속 막혀도 임무당 5개를 넘지 않고 ID 중복 없음', () => {
    let s = l2Ready();
    let t = 0;
    const cargos: CargoLot[][] = [[lot('crude', 2)], [], [lot('graphite', 1, 'domestic', 'BUS')], [lot('iron', 2)], [lot('nickel', 1)], [lot('chem', 1)]];
    for (const c of cargos) {
      s = setCargo(s, c);
      ({ s, t } = stepN(s, 300, t));
    }
    const ids = hintsOf(s);
    expect(ids.length).toBe(5);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('⑥ 오프라인 학생', () => {
  it('오프라인이면 받지 않고 감시 상태도 그대로 → 다시 온라인이면 그 틱에 받음', () => {
    let { s, t } = stepN(l2Ready(), 100, 0);
    s = hostReduce(s, { type: 'presence', seat: 1, online: false }, t).snapshot;
    const watchBefore = JSON.stringify(s.stuck!.watch);
    ({ s, t } = stepN(s, 100, t)); // sec 199
    expect(hintsOf(s)).toEqual([]);
    expect(JSON.stringify(s.stuck!.watch)).toBe(watchBefore);
    s = hostReduce(s, { type: 'presence', seat: 1, online: true }, t).snapshot;
    ({ s, t } = stepN(s, 1, t));
    expect(hintsOf(s)).toEqual(['IPE-MAKE-1:oilp']);
  });
});

// ─── 실제 무역 훅(createTradeHooks) + hostReduce 로 ───

const hooks = createTradeHooks();
const T0 = 10_000;

function realGame(o: { scope?: LessonId[]; lessonPart?: 'all' | 'front' | 'back' } = {}): HostSnapshot {
  let s = startSession({
    code: '482137',
    playUnit: 'lesson',
    scope: o.scope ?? ['L2'],
    seed: 12345,
    now: 0,
    hostToken: 'host-token',
    settings: { tradeMinutes: 25, lessonPart: o.lessonPart ?? 'front' },
  });
  s = hostReduce(s, { type: 'join', seat: 1, pid: 'p01qz', deviceToken: 'device-token-1', companyName: '해오름1', nameKey: '해오름1' }, 0).snapshot;
  s = editPlayer(s, 1, (p) => void (p.company.founded = true));
  return hostReduce(s, { type: 'teacher', action: { type: 'startTrade' } }, T0, hooks).snapshot;
}

const tickAt = (s: HostSnapshot, e: number) => hostReduce(s, { type: 'tick' }, T0 + e * 1000, hooks);

describe('⑦ 일시정지 제외(실제 무역 훅)', () => {
  it('라운드 중 60초 → [잠깐 멈춤] 300초 → 이어서 하기 → 59초: 힌트 없음, 1초 더: 힌트', () => {
    let s = realGame();
    let e = 0;
    // 첫 라운드(임무 열림)까지
    while (!(s.class.phase === 'round' && player(s, 1).game.missions['M-IPE']?.status === 'active')) {
      s = tickAt(s, ++e).snapshot;
      expect(e).toBeLessThan(1500);
    }
    const startSec = s.stuck!.clock.sec;
    for (let i = 0; i < 60; i++) s = tickAt(s, ++e).snapshot;
    expect(s.stuck!.clock.sec - startSec).toBe(60);
    s = hostReduce(s, { type: 'teacher', action: { type: 'pause' } }, T0 + e * 1000 + 500, hooks).snapshot;
    for (let i = 0; i < 300; i++) s = tickAt(s, ++e).snapshot;
    expect(s.stuck!.clock.sec - startSec).toBe(60);
    s = hostReduce(s, { type: 'teacher', action: { type: 'resume' } }, T0 + e * 1000 + 500, hooks).snapshot;
    expect(s.class.phase).toBe('round');
    for (let i = 0; i < 60; i++) s = tickAt(s, ++e).snapshot; // 첫 틱은 기준점 → 59초
    expect(s.stuck!.clock.sec - startSec).toBe(119);
    expect(hintsOf(s)).toEqual([]);
    s = tickAt(s, ++e).snapshot;
    expect(hintsOf(s)).toEqual(['IPE-MAKE-1:oilp']);
  });
});

describe('⑧ 재접속·복원', () => {
  it('JSON 저장 → normalizeSnapshot 뒤에도 시계·감시가 이어지고 같은 힌트 다시 안 감, 2번째는 원래 시각에', () => {
    let { s, t } = stepN(l2Ready(), 150, 0); // sec 149, MAKE-1 받음
    expect(hintsOf(s)).toEqual(['IPE-MAKE-1:oilp']);
    const restored = normalizeSnapshot(JSON.parse(JSON.stringify(s)))!;
    expect(restored.stuck).toEqual(s.stuck);
    expect(hintsOf(restored)).toEqual(['IPE-MAKE-1:oilp']);
    s = restored;
    ({ s, t } = stepN(s, 90, t)); // 150..239
    expect(hintsOf(s)).toEqual(['IPE-MAKE-1:oilp']);
    ({ s, t } = stepN(s, 1, t)); // 240
    expect(hintsOf(s)).toEqual(['IPE-MAKE-1:oilp', 'IPE-MAKE-2:oilp']);
  });

  it('normalizePlayer 가 gullHints 를 지키고(없으면 넣지 않음), playerView 에 들어 있다', () => {
    const { s } = stepN(l2Ready(), 121, 0);
    const p = player(s, 1);
    expect(normalizePlayer(JSON.parse(JSON.stringify(p))).game.gullHints).toEqual(p.game.gullHints);
    expect(playerView(p).game.gullHints).toEqual([{ id: 'IPE-MAKE-1:oilp', mission: 'M-IPE', at: 120 }]);
    const old = JSON.parse(JSON.stringify(p)) as Player;
    delete old.game.gullHints;
    expect('gullHints' in normalizePlayer(old).game).toBe(false);
    // 모양이 틀린 기록은 옮기지 않는다
    expect(normalizePlayer({ ...old, game: { ...old.game, gullHints: [{ id: 3 }, { id: 'IPE-BUY-1', mission: 'M-IPE', at: 9, x: 1 }] } }).game.gullHints).toEqual([
      { id: 'IPE-BUY-1', mission: 'M-IPE', at: 9 },
    ]);
  });

  it('옛 스냅숏(stuck 없음)·틀린 모양은 stuck 을 넣지 않는다', () => {
    const s = l2Ready();
    expect('stuck' in normalizeSnapshot(JSON.parse(JSON.stringify(s)))!).toBe(false);
    expect('stuck' in normalizeSnapshot({ ...JSON.parse(JSON.stringify(s)), stuck: { clock: 1 } })!).toBe(false);
  });
});

describe('⑨ 출력', () => {
  const kinds = (o: HostOutput[]) => o.map((x) => `${x.to}:${x.kind}${x.to === 'seat' ? `:${x.seat}` : ''}`);

  it('힌트가 간 틱에 그 좌석에만 me·events, 시계만 바뀐 틱에는 공개 상태 출력 없음', () => {
    let s = l2Ready(2);
    s = editPlayer(s, 2, (p) => {
      p.game.cargo = [];
      p.game.gullHints = [{ id: 'IPE-BUY-1', mission: 'M-IPE', at: 0 }, { id: 'IPE-BUY-2', mission: 'M-IPE', at: 0 }];
    });
    // 첫 틱(기준점)·시계만 도는 틱: 출력 없음
    for (let e = 0; e < 120; e++) {
      const r = hostReduce(s, { type: 'tick' }, e * 1000);
      expect(kinds(r.outputs), `e=${e}`).toEqual([]);
      s = r.snapshot;
    }
    const r = hostReduce(s, { type: 'tick' }, 120 * 1000);
    expect(kinds(r.outputs)).toEqual(['seat:me:1', 'seat:events:1']);
    const ev = r.outputs.find((o) => o.kind === 'events');
    expect(ev && ev.kind === 'events' ? ev.events : []).toEqual([{ type: 'gullHint', id: 'IPE-MAKE-1:oilp', mission: 'M-IPE' }]);
    const me = r.outputs.find((o) => o.kind === 'me');
    expect(me && me.kind === 'me' ? me.data.game.gullHints?.map((h) => h.id) : []).toEqual(['IPE-MAKE-1:oilp']);
    expect(r.snapshot.rev).toBe(s.rev); // 공개 상태 버전 그대로
    expect(player(r.snapshot, 1).rev).toBe(player(s, 1).rev + 1);
    expect(player(r.snapshot, 2)).toBe(player(s, 2)); // 다른 학생 객체는 그대로
  });

  it('실제 무역 훅에서도 힌트 시계 때문에 공개 상태가 매초 나가지 않는다(라운드 중 조용한 틱)', () => {
    let s = realGame();
    let e = 0;
    while (!(s.class.phase === 'round' && player(s, 1).game.missions['M-IPE']?.status === 'active')) s = tickAt(s, ++e).snapshot;
    // 매 틱: 힌트 감시 상태를 지운 같은 스냅숏으로 돌린 것과 공개 출력이 같다(힌트 시계는 공개 출력을 만들지 않음)
    const pub = (o: HostOutput[]) => JSON.stringify(o.filter((x) => x.to === 'all'));
    for (let i = 0; i < 200; i++) {
      e++;
      const r = tickAt(s, e);
      const bare = hostReduce({ ...s, stuck: undefined }, { type: 'tick' }, T0 + e * 1000, hooks);
      expect(pub(r.outputs), `e=${e}`).toBe(pub(bare.outputs));
      s = r.snapshot;
    }
    expect(hintsOf(s)).toContain('IPE-MAKE-1:oilp');
  });
});

describe('⑩ 다른 판에서는 아무것도 안 감', () => {
  it.each([
    ['2차시 뒤 시간', { scope: ['L2'] as LessonId[], lessonPart: 'back' as const }],
    ['1차시', { scope: ['L1'] as LessonId[], lessonPart: 'all' as const }],
  ])('%s', (_, o) => {
    let s = realGame(o);
    for (let e = 1; e <= 1200 && !s.class.tradeEnded; e++) s = tickAt(s, e).snapshot;
    expect(player(s, 1).game.missions['M-IPE']).toBeUndefined();
    expect(hintsOf(s)).toEqual([]);
    expect(s.stuck?.watch ?? {}).toEqual({});
  });

  it('enabled 상수는 켜져 있고 시간은 2분·2분', () => {
    expect(stuckHintRules).toMatchObject({ enabled: true, firstSec: 120, nextSec: 120, maxStepMs: 2000 });
    expect(stuckHintRules.missions).toEqual(['M-IPE']);
  });
});
