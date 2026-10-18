/**
 * 작업 115 — 2차시(차시 한 판 L2) core: 부산 공장 생산, 임무 3종(자원→생산→수출 / 수출국 4유형 / 싱가포르 중계),
 * 중계 도장, 세관 게시판 학급 집계(공개 상태 customsBoard), 수출국 4유형 도감, 싱가포르 첫 입항 카드, L2 배치.
 */
import { describe, expect, it } from 'vitest';
import { aggregate, buildSchedule, publicPayload, resolveRounds } from '../../src/core';
import type { GameEvent, HostSnapshot, PlayerGame } from '../../src/core';
import { helperLine } from '../../src/core/worksheet-helpers';
import { exportTypeCards } from '../../src/data/dex';
import { myExportTypeGoods } from '../../src/student/Dex';
import type { GoodId, PortId } from '../../src/data/types';
import { act, editPlayer, makeSession, player, teach } from './helpers';

/** 2차시 판: 표지(공장·항구 열림) → 임무 3종 발동 → 라운드 1 */
function l2Round(n = 2): HostSnapshot {
  let s = makeSession({ n, scope: ['L2'] });
  s = teach(s, { type: 'startStage', stage: 'L2' });
  s = teach(s, { type: 'closeEvent' });
  for (const id of ['L2-E3', 'L2-E4', 'L2-E5']) s = teach(s, { type: 'fireEvent', id });
  return teach(s, { type: 'startRound' });
}

const lot = (good: GoodId, qty: number, origin: 'korea' | 'foreign', boughtAt: PortId, unitCost = 30): PlayerGame['cargo'][number] => ({
  good, qty, unitCost, origin, source: origin === 'korea' ? 'specialty' : 'specialty', boughtAt,
});

const types = (events: GameEvent[]) => events.map((e) => e.type);

describe('2차시 시작', () => {
  it('표지가 공장·12개 항구를 열고 임무 3종이 모두 시작된다', () => {
    const s = l2Round();
    expect(s.class.features).toContain('factory');
    expect(s.class.openPorts).toHaveLength(12);
    const m = player(s, 1).game.missions;
    expect(Object.keys(m).sort()).toEqual(['M-EXPORT4', 'M-IPE', 'M-RELAY']);
    // 싱가포르 개념 카드는 학급 발동 때가 아니라 첫 입항 때
    expect(player(s, 1).game.metrics.dex).not.toContain('relay');
  });
});

describe('부산 공장 생산(PRD 6.9)', () => {
  it('원유를 수입해 석유 제품을 만들고 다른 나라에 팔면 자원→생산→수출 임무 완료', () => {
    let s = l2Round();
    s = editPlayer(s, 1, (p) => {
      p.game.port = 'BUS';
      p.game.cargo = [lot('crude', 3, 'foreign', 'DAM', 40)];
      p.game.money = 100;
    });
    const r = act(s, 1, { type: 'produce', recipe: 'oilp', qty: 2 });
    expect(r.outputs.find((o) => o.kind === 'ack')).toMatchObject({ ok: true });
    s = r.snapshot;
    const g = player(s, 1).game;
    expect(g.money).toBe(80);
    expect(g.cargo.find((l) => l.good === 'oilp')).toMatchObject({ qty: 2, origin: 'korea', source: 'factory', unitCost: 50 });
    expect(g.cargo.find((l) => l.good === 'crude')?.qty).toBe(1);
    expect(g.producedOnce).toBe(true);
    expect(g.missions['M-IPE']!.steps).toEqual([true, true, false]);
    const ack = r.outputs.find((o) => o.kind === 'ack');
    expect(ack && 'events' in ack ? types(ack.events) : []).toContain('factoryCycleCard');
    // 호찌민에 팔면 [수출]
    s = editPlayer(s, 1, (p) => (p.game.port = 'HCM'));
    const sold = act(s, 1, { type: 'sell', good: 'oilp', qty: 2 }, 2);
    const ev = (sold.outputs.find((o) => o.kind === 'ack') as { events: GameEvent[] }).events;
    expect(ev).toContainEqual(expect.objectContaining({ type: 'stamp', kind: 'export', good: 'oilp' }));
    expect(player(sold.snapshot, 1).game.missions['M-IPE']!.status).toBe('done');
  });

  it('부산이 아니면·재료가 없으면·1차시 판이면 만들 수 없다', () => {
    let s = l2Round();
    s = editPlayer(s, 1, (p) => {
      p.game.port = 'SHA';
      p.game.cargo = [lot('iron', 2, 'foreign', 'PHE')];
    });
    expect(act(s, 1, { type: 'produce', recipe: 'steel', qty: 1 }).outputs.find((o) => o.kind === 'ack')).toMatchObject({ ok: false, error: 'NOT_AT_BUSAN' });
    s = editPlayer(s, 1, (p) => (p.game.port = 'BUS'));
    expect(act(s, 1, { type: 'produce', recipe: 'steel', qty: 2 }).outputs.find((o) => o.kind === 'ack')).toMatchObject({ ok: false, error: 'NO_INPUT' });
    expect(act(s, 1, { type: 'produce', recipe: 'steel', qty: 1 }).outputs.find((o) => o.kind === 'ack')).toMatchObject({ ok: true });
    let l1 = makeSession({ n: 1, scope: ['L1'] });
    l1 = teach(l1, { type: 'startStage', stage: 'L1' });
    l1 = teach(l1, { type: 'closeEvent' });
    l1 = teach(l1, { type: 'startRound' });
    l1 = editPlayer(l1, 1, (p) => (p.game.cargo = [lot('iron', 2, 'foreign', 'PHE')]));
    expect(act(l1, 1, { type: 'produce', recipe: 'steel', qty: 1 }).outputs.find((o) => o.kind === 'ack')).toMatchObject({ ok: false, error: 'NO_FACTORY' });
  });

  it('배터리는 흑연 1 + 니켈 1 + 정밀 화학 원료 1, 공장비 20', () => {
    let s = l2Round();
    s = editPlayer(s, 1, (p) => {
      p.game.port = 'BUS';
      p.game.cargo = [lot('graphite', 1, 'foreign', 'SHA'), lot('nickel', 1, 'foreign', 'JKT'), lot('chem', 1, 'foreign', 'YOK')];
      p.game.money = 20;
    });
    s = act(s, 1, { type: 'produce', recipe: 'battery', qty: 1 }).snapshot;
    expect(player(s, 1).game.cargo).toEqual([expect.objectContaining({ good: 'battery', qty: 1, source: 'factory' })]);
    expect(player(s, 1).game.money).toBe(0);
  });
});

describe('수출국 4유형(L2-E4, 도감)', () => {
  it('사거나 팔면 유형 칸이 채워지고 네 칸이면 임무 완료 + 도감 4장', () => {
    let s = l2Round();
    s = editPlayer(s, 1, (p) => {
      p.game.money = 2000;
      p.game.port = 'BKK';
    });
    s = act(s, 1, { type: 'buy', good: 'rice', qty: 1 }, 1).snapshot; // 농산물(사기)
    s = editPlayer(s, 1, (p) => (p.game.port = 'PHE'));
    s = act(s, 1, { type: 'buy', good: 'iron', qty: 1 }, 2).snapshot; // 천연자원(사기)
    s = editPlayer(s, 1, (p) => (p.game.port = 'YOK'));
    s = act(s, 1, { type: 'buy', good: 'robot', qty: 1 }, 3).snapshot; // 기술(사기)
    expect(player(s, 1).game.missions['M-EXPORT4']!.steps).toEqual([true, true, true, false]);
    // 문화: 부산에서 산 K-콘텐츠를 상하이에 판다(팔기로도 인정)
    s = editPlayer(s, 1, (p) => {
      p.game.port = 'SHA';
      p.game.contracts = [{ good: 'kcon', qty: 1, unitCost: 30, origin: 'korea', source: 'specialty', boughtAt: 'BUS' }];
    });
    s = act(s, 1, { type: 'sell', good: 'kcon', qty: 1 }, 4).snapshot;
    const g = player(s, 1).game;
    expect(g.missions['M-EXPORT4']!.status).toBe('done');
    for (const c of exportTypeCards) expect(g.metrics.dex).toContain(c.id);
  });
});

describe('싱가포르 중계(L2-E5)', () => {
  it('첫 입항 때 개념 카드(도감 relay) + eventTriggered, 두 번째 입항은 없음', () => {
    let s = l2Round();
    s = editPlayer(s, 1, (p) => {
      p.game.port = 'JKT';
      p.game.dest = 'SIN';
      p.game.ready = true;
      p.game.money = 500;
    });
    const r = resolveRounds({ ...s.class, round: 1, phase: 'between' }, player(s, 1));
    expect(r.player.game.port).toBe('SIN');
    expect(r.events).toContainEqual({ type: 'eventTriggered', id: 'L2-E5' });
    expect(r.player.game.metrics.dex).toContain('relay');
  });

  it('싱가포르에서 산 상품을 다른 나라에 팔면 [중계] 도장 + 중계 임무 완료', () => {
    let s = l2Round();
    s = editPlayer(s, 1, (p) => {
      p.game.port = 'SIN';
      p.game.money = 1000;
    });
    s = act(s, 1, { type: 'buy', good: 'rice', qty: 2 }, 1).snapshot;
    expect(player(s, 1).game.missions['M-RELAY']!.steps).toEqual([true, false]);
    s = editPlayer(s, 1, (p) => (p.game.port = 'DAM'));
    const r = act(s, 1, { type: 'sell', good: 'rice', qty: 2 }, 2);
    const ev = (r.outputs.find((o) => o.kind === 'ack') as { events: GameEvent[] }).events;
    expect(ev).toContainEqual(expect.objectContaining({ type: 'stamp', kind: 'relay', good: 'rice', qty: 2 }));
    expect(player(r.snapshot, 1).game.missions['M-RELAY']!.status).toBe('done');
    expect(player(r.snapshot, 1).game.metrics.resale).toBeGreaterThan(0);
  });
});

describe('세관 게시판(L2-E6) — 공개 상태 customsBoard', () => {
  it('학급 전체 [수입]·[수출] 판매 상자 수를 상품별로 합친다(이름 없음)', () => {
    let s = l2Round(2);
    s = editPlayer(s, 1, (p) => {
      p.game.port = 'BUS';
      p.game.cargo = [lot('crude', 3, 'foreign', 'DAM')];
    });
    s = act(s, 1, { type: 'sell', good: 'crude', qty: 3 }, 1).snapshot;
    s = editPlayer(s, 2, (p) => {
      p.game.port = 'SHA';
      p.game.cargo = [{ ...lot('car', 2, 'korea', 'BUS'), source: 'specialty' }];
    });
    s = act(s, 2, { type: 'sell', good: 'car', qty: 2 }, 1).snapshot;
    const pub = publicPayload(s).public;
    expect(pub.customsBoard).toEqual({ imports: { crude: 3 }, exports: { car: 2 } });
    expect(JSON.stringify(pub.customsBoard)).not.toMatch(/p0\dqz|해오름/);
  });

  it('2차시가 없는 판에서는 null', () => {
    const s = makeSession({ n: 1, scope: ['L1'] });
    expect(aggregate(s.class, s.players).customsBoard).toBeNull();
  });
});

describe('2차시 배치(차시 한 판 L2)', () => {
  for (const T of [10, 15, 20, 25]) {
    it(`${T}분: 판 끝 ≤ T, 1등급 빠짐 없음, 학습지 ⑤~⑧ 누락 없음`, () => {
      const s = buildSchedule({ playUnit: 'lesson', scope: ['L2'], tradeMinutes: T });
      const items = s.items.filter((it) => it.form !== 'dropped');
      const end = Math.max(...items.map((it) => it.at + it.durSec));
      expect(end).toBeLessThanOrEqual(T * 60);
      for (const id of ['L2-E1', 'L2-E2', 'L2-E3']) expect(items.some((it) => it.refId === id)).toBe(true);
      expect(items.filter((it) => it.kind === 'round').length).toBeGreaterThanOrEqual(1);
      const placed = new Set<string>([
        ...items.filter((it) => it.kind === 'worksheet').flatMap((it) => (it.refIds?.length ? it.refIds : [it.refId])),
        ...s.wrapup.flatMap((w) => w.worksheetIds),
      ]);
      for (const w of ['W05', 'W06', 'W07', 'W08']) expect(placed.has(w)).toBe(true);
    });
  }
});

// ─── (작업 115 수정 1회차) ───────────────────────────────────

describe('수정 1회차: 처음 화물·⑥ 한 만큼 기록·세관 게시판 재료·도감 내 상품', () => {
  it('2차시로 시작하면 담맘 원유 2상자를 싣고 시작(1차시는 빈 배)', () => {
    const s = makeSession({ n: 1, scope: ['L2'] });
    expect(player(s, 1).game.cargo).toEqual([expect.objectContaining({ good: 'crude', qty: 2, origin: 'foreign', boughtAt: 'DAM' })]);
    expect(player(makeSession({ n: 1, scope: ['L1'] }), 1).game.cargo).toEqual([]);
  });

  it('라운드 3개 안에: 라운드 1 부산에서 석유 제품 생산 → 라운드 2 호찌민에 수출 → 임무 완료, ⑥ 기록 세 단계', () => {
    let s = l2Round();
    const made = act(s, 1, { type: 'produce', recipe: 'oilp', qty: 2 });
    expect(made.outputs.find((o) => o.kind === 'ack')).toMatchObject({ ok: true });
    s = made.snapshot;
    expect(helperLine('importProduceExport', { cls: s.class, player: player(s, 1) })).toBe('원유 수입(담맘) → 석유 제품 생산 → 아직 수출 전');
    s = editPlayer(s, 1, (p) => (p.game.port = 'HCM'));
    s = act(s, 1, { type: 'sell', good: 'oilp', qty: 2 }, 2).snapshot;
    expect(player(s, 1).game.missions['M-IPE']!.status).toBe('done');
    expect(helperLine('importProduceExport', { cls: s.class, player: player(s, 1) })).toBe('원유 수입(담맘) → 석유 제품 생산 → 호찌민에 수출');
    // 처음 화물은 ⑦ 수출국 4유형 '사거나 판 상품'에 넣지 않는다(직접 사고판 것만)
    expect(helperLine('exportTypes', { cls: s.class, player: player(s, 1) })).not.toContain('원유');
  });

  it('⑥ [내 기록]은 한 만큼: 수입만 / 수입·생산', () => {
    const base = { decisions: {}, responses: {}, metrics: { visited: [] } };
    const onlyImport = { game: { ...base, log: [{ round: 1, stage: 'L2' as const, kind: 'buy' as const, good: 'iron' as const, qty: 4, port: 'PHE' as const, amount: 80 }] } };
    expect(helperLine('importProduceExport', { cls: { votes: {} }, player: onlyImport })).toBe('철광석 수입(포트헤들랜드) → 아직 생산 전');
    const produced = { game: { ...base, log: [...onlyImport.game.log, { round: 2, stage: 'L2' as const, kind: 'produce' as const, good: 'steel' as const, qty: 2, port: 'BUS' as const, amount: 20 }] } };
    expect(helperLine('importProduceExport', { cls: { votes: {} }, player: produced })).toBe('철광석 수입(포트헤들랜드) → 철강 생산 → 아직 수출 전');
    expect(helperLine('importProduceExport', { cls: { votes: {} }, player: { game: { ...base, log: [] } } })).toBe('아직 못 했어요');
  });

  it('세관 게시판: 부산 공장에서 쓴 천연자원도 들여온 상품으로 센다', () => {
    let s = l2Round();
    s = act(s, 1, { type: 'produce', recipe: 'oilp', qty: 1 }).snapshot;
    expect(publicPayload(s).public.customsBoard).toEqual({ imports: { crude: 1 }, exports: {} });
  });

  it('도감 수출국 4유형에 내가 사고판 상품 이름', () => {
    let s = l2Round();
    s = editPlayer(s, 1, (p) => (p.game.port = 'BKK'));
    s = act(s, 1, { type: 'buy', good: 'rice', qty: 1 }).snapshot;
    expect(myExportTypeGoods(player(s, 1))).toEqual({ 'export-agri': '쌀' });
  });
});
