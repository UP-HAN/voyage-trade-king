/**
 * 작업 109: 공용 화면·학생 전원에게 보내는 상태에 출석번호·학생별 자금·응답 명단이 없는지(PRD 7.6·7.9),
 * 교사 화면 전용 행동(setScreenScene·setWrapStep·setRoomCode), 결과 표(실명 없음), 새 판 만들기.
 */
import { describe, expect, it } from 'vitest';
import { findSeatKeys } from '../../src/sync/app-messages';
import { createHostSession } from '../../src/sync/host-session';
import { createHostStore } from '../../src/sync/host-store';
import type { ScreenPublisher } from '../../src/sync/screen-bridge';
import { createPeerSession } from '../../src/sync/peer-session';
import { createPeerStore } from '../../src/sync/peer-store';
import { ManualTimers } from '../../src/sync/throttle';
import { MemoryNetwork } from '../../src/sync/memory';
import type { JsonObject } from '../../src/sync/adapter';
import { publicView, resultTableOf, screenView, teacherReducer, teacherViews, newTeacherGame, type TeacherGame } from '../../src/teacher/game';
import { gameWith } from './helpers';
import { MemStorage } from '../sync/session-helpers';

/** 금지 키: 출석번호·자금·응답 명단·기기 토큰 */
function forbiddenKeys(obj: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown, path: string) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (['seat', 'money', 'responses', 'deviceToken', 'seats', 'loan', 'cargo'].includes(k)) out.push(`${path}.${k}`);
        walk(x, `${path}.${k}`);
      }
    }
  };
  walk(obj, '');
  return out;
}

describe('공개 상태(학생 전원·공용 화면)', () => {
  it('30명 무역 중 판: publicView·screenView에 출석번호·자금·응답 명단이 없다', () => {
    const w = gameWith(30, { start: true });
    // 사건 응답·학습지 완료를 섞어도
    const g = w.get();
    expect(Object.keys(g.players)).toHaveLength(30);
    const pub = publicView(g, true);
    const scr = screenView(g, true);
    expect(findSeatKeys(pub)).toEqual([]);
    expect(findSeatKeys(scr)).toEqual([]);
    expect(forbiddenKeys(pub)).toEqual([]);
    expect(forbiddenKeys(scr)).toEqual([]);
    expect(JSON.stringify(pub)).not.toMatch(/"seat"\s*:/);
    // 회사는 pid로만 가리킨다
    const companies = (pub.public as { companies: { pid: string }[] }).companies;
    expect(companies).toHaveLength(30);
    expect(companies.every((c) => /^p\d{5}$/.test(c.pid))).toBe(true);
  });

  it('teacherViews.me는 그 학생 것만(기기 토큰 없음)', () => {
    const g = gameWith(3).get();
    const me = teacherViews.me(g, 2) as JsonObject;
    expect(me.seat).toBe(2);
    expect(me).not.toHaveProperty('deviceToken');
    expect(teacherViews.me(g, 9)).toBeNull();
  });

  it('세션(124) + 교사 리듀서: 학생에게 간 state.public과 공용 화면 다리에 출석번호·자금이 없다', async () => {
    const net = new MemoryNetwork({ startTime: Date.UTC(2026, 9, 9, 1, 0, 0) });
    const now = () => net.now();
    const timers = new ManualTimers(now);
    const screens: { pub: JsonObject; cls: JsonObject | null }[] = [];
    const publisher = (): ScreenPublisher => ({
      publishToScreen: (p, c) => screens.push({ pub: structuredClone(p), cls: c ? structuredClone(c) : null }),
      codeChanged: () => undefined,
      closed: () => undefined,
      dispose: () => undefined,
    });
    const transport = net.createHost({ ip: '1.1.1.1' });
    const session = createHostSession<TeacherGame>({
      transport,
      reducer: teacherReducer,
      views: teacherViews,
      store: createHostStore({ storage: new MemStorage(), now }),
      appVersion: 'v1',
      now,
      timers,
      strictPublic: true,
      screenFactory: publisher,
      resultTable: resultTableOf,
    });
    const game = newTeacherGame({ className: '6-3', playUnit: 'lesson', scope: ['L1'], tradeMinutes: 10, settings: {}, overrides: {}, seed: 3, now: now() });
    const r = await session.open({ game });
    expect(r.ok).toBe(true);
    const code = (r as { code: string }).code;
    session.dispatchTeacher({ type: 'setRoomCode', code });
    const received: JsonObject[] = [];
    const advance = async (ms: number) => {
      for (let left = ms; left > 0; left -= 100) {
        await net.advanceTime(100);
        timers.runDue();
        await net.flush();
      }
    };
    for (let s = 1; s <= 5; s++) {
      const pt = net.createPeer({ ip: '2.2.2.2' });
      pt.onMessage((m) => received.push(m.t === 'multi' ? ({ t: 'multi', msgs: m.msgs } as JsonObject) : m));
      const ps = createPeerSession({ transport: pt, predict: (me: unknown) => me, store: createPeerStore({ storage: new MemStorage(), now }), appVersion: 'v1', now, timers });
      void ps.join(code, s, `회사${String.fromCharCode(0xac00 + s * 37)}무역`);
    }
    await advance(2000);
    session.dispatchTeacher({ type: 'startTrade' });
    session.dispatchTeacher({ type: 'setScreenScene', scene: 'leaderboard' });
    await advance(5000);
    expect(session.getView().seats).toHaveLength(5);
    const flat = received.flatMap((m) => (m.t === 'multi' ? (m.msgs as JsonObject[]) : [m]));
    const publics = flat.filter((m) => m.t === 'state.public');
    expect(publics.length).toBeGreaterThan(0);
    for (const m of publics) {
      expect(findSeatKeys(m)).toEqual([]);
      expect(forbiddenKeys(m.data ?? m.patch)).toEqual([]);
    }
    expect(screens.length).toBeGreaterThan(0);
    for (const s of screens) {
      expect(findSeatKeys(s)).toEqual([]);
      expect(forbiddenKeys(s)).toEqual([]);
    }
    expect(screens.at(-1)!.pub.screenScene).toBe('leaderboard');
    expect(screens.at(-1)!.cls?.screenScene).toBe('leaderboard');
    session.dispose();
  });
});

describe('교사 화면 전용 행동', () => {
  it('setScreenScene은 공개 상태를 바꾸고(public 출력) 잘못된 장면은 무시', () => {
    const g = gameWith(1).get();
    const r = teacherReducer(g, { type: 'teacher', action: { type: 'setScreenScene', scene: 'map' } }, 1);
    expect(r.snapshot.screenScene).toBe('map');
    expect(r.outputs).toEqual([{ type: 'public' }]);
    expect(publicView(r.snapshot).screenScene).toBe('map');
    const bad = teacherReducer(r.snapshot, { type: 'teacher', action: { type: 'setScreenScene', scene: 'nope' } }, 2);
    expect(bad.snapshot.screenScene).toBe('map');
  });

  it('setWrapStep·setRoomCode, 그리고 103 리듀서를 거쳐도 두 필드가 남는다', () => {
    let g = gameWith(2).get();
    g = teacherReducer(g, { type: 'teacher', action: { type: 'setWrapStep', id: 'settle', status: 'done' } }, 1).snapshot;
    g = teacherReducer(g, { type: 'teacher', action: { type: 'setRoomCode', code: '482137' } }, 2).snapshot;
    g = teacherReducer(g, { type: 'teacher', action: { type: 'setScreenScene', scene: 'code' } }, 3).snapshot;
    g = teacherReducer(g, { type: 'teacher', action: { type: 'startTrade' } }, 4).snapshot;
    g = teacherReducer(g, { type: 'tick' }, 5000).snapshot;
    expect(g.wrapProgress).toEqual({ settle: 'done' });
    expect(g.meta.code).toBe('482137');
    expect(g.screenScene).toBe('code');
    expect(g.class.clock.startedAt).toBe(4);
  });
});

describe('새 판·결과 표', () => {
  it('차시 L1 10분: 라운드 길이 자동(120초), 미리보기 고정값이 배치에 쓰인다', () => {
    const g = newTeacherGame({ className: '', playUnit: 'lesson', scope: ['L1'], tradeMinutes: 10, settings: {}, overrides: { 'L1-E1': 'dropped' }, seed: 1, now: 0 });
    expect(g.class.settings.tradeMinutes).toBe(10);
    expect(g.class.settings.roundSec).toBe(120);
    expect(g.class.schedule.roundSecAuto).toBe(true);
    expect(g.class.schedule.overrides).toEqual({ 'L1-E1': 'dropped' });
    const started = teacherReducer(g, { type: 'teacher', action: { type: 'startTrade' } }, 10).snapshot;
    expect(started.class.clock.durationSec).toBe(600);
    const e1 = started.class.schedule.items.find((it) => it.kind === 'event' && it.refId === 'L1-E1');
    expect(e1?.form).toBe('dropped');
  });

  it('결과 표: 판 단위·차시, 지표 8개, 실명 열 없음', () => {
    const t = resultTableOf(gameWith(4, { start: true }).get());
    expect(t.playUnit).toBe('차시마다 한 판');
    expect(t.scope).toBe('L1');
    expect(t.metrics).toHaveLength(8);
    expect(t.metrics.map((m) => m.label).join()).not.toMatch(/이름|실명/);
    expect(t.rows).toHaveLength(4);
    expect(t.rows.every((r) => Object.keys(r).sort().join() === 'awards,seat,values')).toBe(true);
  });
});
