/**
 * 작업 169 교사 시범 화면: 시범 판 처음 상태, 수업 흐름 층 없음(틱 무시), 공장·자유 항해, 처음부터 다시, 저장 키 분리.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startSession } from '../../src/core';
import { createDemoWorld, demoGame, demoReducer, DEMO_COMPANY, MemoryStorage, type DemoWorld } from '../../src/demo/world';
import { factoryOpen } from '../../src/student/port/factory';

const g = globalThis as { localStorage?: unknown; sessionStorage?: unknown };
let ls: MemoryStorage;
let ss: MemoryStorage;
const worlds: DemoWorld[] = [];

beforeEach(() => {
  ls = new MemoryStorage();
  ss = new MemoryStorage();
  // 실제 수업 저장본이 있는 기기라고 치고(교사 판·학생 방 기록), 시범 판이 건드리지 않는지 본다
  ls.setItem('voyage.host', '{"real":true}');
  ls.setItem('voyage.peer', '{"real":true}');
  g.localStorage = ls;
  g.sessionStorage = ss;
});

afterEach(() => {
  for (const w of worlds.splice(0)) w.dispose();
  delete g.localStorage;
  delete g.sessionStorage;
});

async function world(): Promise<DemoWorld> {
  const w = createDemoWorld({ href: 'http://localhost/#/demo' });
  worlds.push(w);
  await w.ready;
  return w;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(ok: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!ok() && Date.now() < end) await sleep(20);
  expect(ok()).toBe(true);
}

describe('시범 판 처음 상태', () => {
  it('시범무역 설립됨·800만 원·부산·원유 2상자·공장 열림·라운드 중, 멈춤·사건·학습지·편지 없음', async () => {
    const w = await world();
    const p = w.store.getState().peer;
    expect(p.status).toBe('in');
    const me = p.me!;
    expect(me.company.founded).toBe(true);
    expect(me.company.name).toBe(DEMO_COMPANY);
    expect(me.game.money).toBe(800);
    expect(me.game.port).toBe('BUS');
    expect(me.game.cargo.filter((l) => l.good === 'crude').reduce((s, l) => s + l.qty, 0)).toBe(2);
    const cls = p.public!.class;
    expect(cls.stage).toBe('L2');
    expect(cls.phase).toBe('round');
    expect(cls.paused).toBe(false);
    expect(cls.currentEvent).toBeNull();
    expect(cls.worksheet.current).toBeNull();
    expect(cls.settings.voyageMode).toBe('free');
    expect(cls.features).toContain('factory');
    expect(factoryOpen(cls, me)).toBe(true);
    expect(cls.clock.startedAt).not.toBeNull();
    expect(w.store.isBlocked()).toBe(false);
  });

  it('열린 항구는 2차시 앞 시간 판 설정 그대로(하드코딩 없음)', () => {
    const real = startSession({ code: '000000', playUnit: 'lesson', scope: ['L2'], seed: 1, now: 0, settings: { lessonPart: 'front' } });
    expect(demoGame(0).class.openPorts).toEqual(real.class.openPorts);
    expect(demoGame(0).class.settings.lessonPart).toBe('front');
    expect(demoGame(0).class.letters.enabled).toBe(false);
  });

  it('틱·끊긴 시간은 무시: 라운드가 끝나지 않고 갈매기 힌트·자동 진행이 돌지 않는다', () => {
    const r = demoReducer();
    let s = demoGame(0);
    s = r(s, { type: 'teacher', action: { type: 'startRound', durationSec: 1 } }, 0).snapshot;
    const after = r(s, { type: 'tick' }, 10 * 60 * 60 * 1000);
    expect(after.snapshot).toBe(s);
    expect(after.outputs).toEqual([]);
    expect(r(s, { type: 'hostGap', gapMs: 99999 }, 1).snapshot).toBe(s);
    expect(s.class.phase).toBe('round');
  });
});

describe('시범 조작', () => {
  it('부산 공장에서 원유로 석유 제품을 만들고, 자유 항해로 바로 다른 항구에 간다', async () => {
    const w = await world();
    expect(w.store.act({ type: 'produce', recipe: 'oilp', qty: 1 })).not.toBe('blocked');
    await until(() => (w.store.getState().peer.me?.game.cargo ?? []).some((l) => l.good === 'oilp'));
    const open = w.store.getState().peer.public!.class.openPorts.filter((x) => x !== 'BUS');
    expect(open.length).toBeGreaterThan(0);
    w.store.act({ type: 'sailTo', port: open[0]! });
    await until(() => w.store.getState().peer.me?.game.port === open[0]);
    // 시간이 지나도(호스트 틱이 돌아도) 라운드는 그대로
    w.host.tick();
    expect(w.host.getView().game!.class.phase).toBe('round');
  });

  it('처음부터 다시: 새 시범 판은 다시 부산·원유 2상자', async () => {
    const a = await world();
    a.store.act({ type: 'produce', recipe: 'oilp', qty: 2 });
    await until(() => (a.store.getState().peer.me?.game.cargo ?? []).some((l) => l.good === 'oilp'));
    a.dispose();
    const b = await world();
    const me = b.store.getState().peer.me!;
    expect(me.game.port).toBe('BUS');
    expect(me.game.cargo.some((l) => l.good === 'oilp')).toBe(false);
    expect(me.game.money).toBe(800);
  });
});

describe('저장 분리', () => {
  it('localStorage·sessionStorage를 읽지도 쓰지도 않는다(실제 수업 저장본 그대로)', async () => {
    const w = await world();
    w.store.act({ type: 'produce', recipe: 'oilp', qty: 1 });
    await sleep(1500);
    w.host.flushSave();
    expect([...ls.map.keys()].sort()).toEqual(['voyage.host', 'voyage.peer']);
    expect(ls.getItem('voyage.host')).toBe('{"real":true}');
    expect(ls.getItem('voyage.peer')).toBe('{"real":true}');
    expect(ss.length).toBe(0);
  });
});
