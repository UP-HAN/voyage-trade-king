/**
 * 작업 173 — 4차시(차시 한 판 L4) core: 1970년대 철강 투표·단계(L4-E1), 호찌민 공장 결정(L4-E2), 근로 환경 보도·개선(L4-E3),
 * ⑬⑭ 도우미, 차시 L4 배치(앞·뒤·두 시간 모두 × 10~30분), 시간별 마무리 구성, 새는 것 막기, 단원 한 판 배치 그대로.
 */
import { describe, expect, it } from 'vitest';
import { assetValue, buildSchedule, publicPayload, quote } from '../../src/core';
import { tariffForLot } from '../../src/core/market';
import type { HostSnapshot, Player } from '../../src/core/types';
import { helperLine } from '../../src/core/worksheet-helpers';
import { eventsById } from '../../src/data/events';
import { goodsById } from '../../src/data/goods';
import type { GoodId } from '../../src/data/types';
import { coverTextFor, dexHeldBack, lessonPartRules, type LessonPart } from '../../src/data/lessonParts';
import { letterBank } from '../../src/data/letters';
import { steelResultLine, steelStepAt } from '../../src/data/steel1970';
import { act, editPlayer, makeSession, player, teach } from './helpers';

/** 4차시 판: 표지 → (자유 항해) */
function l4(n: number, part: LessonPart = 'front', free = true): HostSnapshot {
  let s = makeSession({ n, scope: ['L4'], lessonPart: part });
  if (free) s = teach(s, { type: 'updateSettings', settings: { voyageMode: 'free' } }, 0);
  s = teach(s, { type: 'startStage', stage: 'L4' });
  return teach(s, { type: 'closeEvent' });
}

const ackOf = (r: ReturnType<typeof act>) => r.outputs.find((o) => o.kind === 'ack') as { ok: boolean; error?: string } | undefined;

/** L4-E1 투표: 표를 넣고 [투표 끝내고 결과 보기](eventStep) */
function steelVoted(votes: ('tariff' | 'noTariff' | null)[], short = false): HostSnapshot {
  let s = l4(votes.length);
  s = teach(s, { type: 'fireEvent', id: 'L4-E1', short });
  votes.forEach((v, i) => {
    if (v) s = act(s, i + 1, { type: 'respondEvent', eventId: 'L4-E1', response: { vote: v } }).snapshot;
  });
  return teach(s, { type: 'eventStep' });
}

describe('L4-E1 1970년대 철강 투표(투표 공통 카드 + 단계)', () => {
  it('과반 매김: 결과 단계에서 집계·공개, 부산 해외 철강 관세 30%(국산 철강·다른 항구·다른 상품은 그대로)', () => {
    const s = steelVoted(['tariff', 'tariff', 'noTariff']);
    expect(s.class.currentEvent?.step).toBe(1);
    expect(s.class.currentEvent?.closed).toBe(false);
    expect(s.class.votes['L4-E1']).toEqual({ revealed: true, result: 'tariff' });
    expect(tariffForLot(s.class, 'BUS', 'steel', 'foreign')).toBe(0.3);
    expect(tariffForLot(s.class, 'BUS', 'steel', 'korea')).toBe(0);
    expect(tariffForLot(s.class, 'BUS', 'crude', 'foreign')).toBe(0.1);
    expect(tariffForLot(s.class, 'SHA', 'steel', 'foreign')).toBe(0.1);
    // 투표하지 않은 학생도 실제 사례 카드 개념을 받는다
    for (const k of [1, 2, 3]) expect(player(s, k).game.metrics.dex).toEqual(expect.arrayContaining(['steel-1970', 'import-pros-cons']));
  });

  it("동점·과반 안 매김: 관세 효과 없음('매기지 않아요')", () => {
    for (const v of [['tariff', 'noTariff'], ['noTariff', 'noTariff', null]] as const) {
      const s = steelVoted([...v]);
      expect(s.class.votes['L4-E1']?.result).toBe('noTariff');
      expect(s.class.activeEffects.some((e) => e.id === 'steel1970')).toBe(false);
      expect(tariffForLot(s.class, 'BUS', 'steel', 'foreign')).toBe(0.1);
    }
  });

  it('단계: 전체 형태 결과 → 회상 1·2·3 → 실제 사례 → 마감(결과 시간을 다시 두지 않음), 짧은 형태는 결과 → 실제 사례', () => {
    let s = steelVoted(['tariff']);
    const names: string[] = [];
    for (let i = 0; i < 4; i++) {
      names.push(steelStepAt(false, s.class.currentEvent!.step));
      s = teach(s, { type: 'eventStep' });
    }
    names.push(steelStepAt(false, s.class.currentEvent!.step));
    expect(names).toEqual(['result', 's1', 's2', 's3', 'real']);
    s = teach(s, { type: 'eventStep' });
    expect(s.class.currentEvent?.closed).toBe(true);
    expect(s.class.currentEvent?.resultUntil).toBeUndefined();
    let t = steelVoted(['noTariff'], true);
    expect(steelStepAt(true, t.class.currentEvent!.step)).toBe('result');
    t = teach(t, { type: 'eventStep' });
    expect(steelStepAt(true, t.class.currentEvent!.step)).toBe('real');
    t = teach(t, { type: 'eventStep' });
    expect(t.class.currentEvent?.closed).toBe(true);
  });

  it('(검증 반영) 회상 중 일시정지했다 풀면 지금 단계 시작 시각을 멈춘 만큼 미룬다(풀자마자 넘어가지 않게)', () => {
    let s = steelVoted(['tariff']);
    const at = s.class.currentEvent!.stepAt!;
    s = teach(s, { type: 'pause' }, 5000);
    s = teach(s, { type: 'resume' }, 65_000);
    expect(s.class.currentEvent!.stepAt).toBe(at + 60_000);
    expect(s.class.currentEvent!.step).toBe(1);
  });

  it('결과 한 줄은 판에서 일어나지 않는 관세 약속을 하지 않는다', () => {
    for (const r of ['tariff', 'noTariff']) {
      const line = steelResultLine(r)!;
      expect(line).not.toMatch(/30%|팔면/);
      expect(line).toContain('제철소');
    }
  });

  it('결과를 보인 뒤에는 늦은 표를 받지 않는다(CLOSED)', () => {
    const s = steelVoted(['tariff', null]);
    const r = act(s, 2, { type: 'respondEvent', eventId: 'L4-E1', response: { vote: 'noTariff' } });
    expect(ackOf(r)?.error).toBe('CLOSED');
  });

  it('투표 공개 상태: 표 수만(누가 어디에 투표했는지 없음)', () => {
    const s = steelVoted(['tariff', 'noTariff', 'tariff']);
    expect(publicPayload(s).public.vote).toEqual({ id: 'L4-E1', counts: { tariff: 2, noTariff: 1 }, revealed: true, result: 'tariff' });
  });

  it('⑬ 도우미(voteResult1970): 응답 모양 { vote } 그대로', () => {
    const s = steelVoted(['tariff', 'noTariff', 'tariff']);
    const line = helperLine('voteResult1970', { cls: s.class, player: player(s, 2), pub: publicPayload(s).public });
    expect(line).toContain('관세를 매기지 않아요');
    expect(player(s, 2).game.responses['L4-E1']).toEqual({ vote: 'noTariff' });
  });

  it('투표 단계에서 마감하면(건너뛰기 등) 예전처럼 결과 20초 + 집계', () => {
    let s = l4(2);
    s = teach(s, { type: 'fireEvent', id: 'L4-E1' });
    s = act(s, 1, { type: 'respondEvent', eventId: 'L4-E1', response: { vote: 'tariff' } }).snapshot;
    s = teach(s, { type: 'closeEvent' });
    expect(typeof s.class.currentEvent?.resultUntil).toBe('number');
    expect(s.class.votes['L4-E1']?.result).toBe('tariff');
  });
});

describe('관세 도장(PRD 6.6) — 4차시 판', () => {
  it('해외 상품을 부산에 팔면 관세 10% 이벤트(빨간 도장)·첫 관세 때 도감 관세 카드', () => {
    let s = l4(1);
    s = teach(s, { type: 'startRound' });
    s = editPlayer(s, 1, (p) => {
      p.game.port = 'BUS';
      p.game.cargo = [{ good: 'crude', qty: 2, unitCost: 42, origin: 'foreign', source: 'specialty', boughtAt: 'DAM' }];
    });
    const r = act(s, 1, { type: 'sell', good: 'crude', qty: 2 });
    expect(ackOf(r)?.ok).toBe(true);
    const evs = ((ackOf(r) as unknown as { events?: { type: string; rate?: number }[] })?.events ?? []);
    expect(evs.find((e) => e.type === 'tariff')?.rate).toBe(0.1);
    expect(player(r.snapshot, 1).game.metrics.dex).toContain('tariff');
  });

  it('철강은 공장에서만 만들고(우리나라 상품) 해외 항구에서 살 수 없다 — 1970년대 투표의 관세 30%는 지금 규칙에서 실제로 걸리는 판매가 없다(보고서 결정 필요)', () => {
    const s = steelVoted(['tariff']);
    for (const port of ['SHA', 'YOK', 'HCM', 'BKK', 'PHE', 'DAM', 'JKT', 'SIN', 'MUM', 'LAX', 'ROT'] as const) {
      expect(quote(s.class, { ...player(s, 1), game: { ...player(s, 1).game, port } } as Player, port, 'steel').buy, port).toBeNull();
    }
    expect(goodsById.steel.factoryOnly).toBe(true);
  });
});

describe('L4-E2 호찌민 공장 결정(즉시 정산)', () => {
  function decided(resp: Record<string, unknown> | null, tweak?: (s: HostSnapshot) => HostSnapshot) {
    let s = l4(2);
    if (tweak) s = tweak(s);
    s = teach(s, { type: 'fireEvent', id: 'L4-E2' });
    const r = resp ? act(s, 1, { type: 'respondEvent', eventId: 'L4-E2', response: resp as never }) : null;
    return { s: r ? r.snapshot : s, ack: r ? ackOf(r) : undefined };
  }
  const base = () => player(l4(2), 1);

  it('네 경우: 안 지음 0·0 / 정당+설치 +50·+40 / 낮은 임금+미설치 +250·−20 / 섞임(정당+미설치 +150·+10)', () => {
    const cases: [Record<string, unknown>, number, number][] = [
      [{ build: false }, 0, 0],
      [{ build: true, wage: 'fair', env: 'install' }, 50, 40],
      [{ build: true, wage: 'low', env: 'skip' }, 250, -20],
      [{ build: true, wage: 'fair', env: 'skip' }, 150, 10],
      [{ build: true, wage: 'low', env: 'install' }, 150, 10],
    ];
    for (const [resp, money, csr] of cases) {
      const { s, ack } = decided(resp);
      expect(ack?.ok, JSON.stringify(resp)).toBe(true);
      expect(player(s, 1).game.money - base().game.money, JSON.stringify(resp)).toBe(money);
      expect(player(s, 1).game.metrics.csr - base().game.metrics.csr, JSON.stringify(resp)).toBe(csr);
      expect(player(s, 1).game.metrics.dex).toContain('overseas-production');
    }
  });

  it('응답 계약 { build, wage, env, reason } 그대로(까닭 40자), ⑭ 도우미(까닭 포함)', () => {
    const { s } = decided({ build: true, wage: 'fair', env: 'install', reason: '근로자도 정당한 대가를 받아야 해서요' });
    expect(player(s, 1).game.responses['L4-E2']).toEqual({ build: true, wage: 'fair', env: 'install', reason: '근로자도 정당한 대가를 받아야 해서요' });
    const line = helperLine('factoryDecision', { cls: s.class, player: player(s, 1) });
    expect(line).toContain('정당한 대가');
  });

  it('자유 항해: 쓸 수 있는 돈(자금 − 낼 운항비)이 짓는 비용(150 + 설비 100)보다 적으면 NO_MONEY — 설비를 안 하면 지을 수 있다', () => {
    const tight = (s: HostSnapshot) => editPlayer(s, 1, (p) => { p.game.money = 260; p.game.fareDue = 20; });
    const a = decided({ build: true, wage: 'fair', env: 'install' }, tight);
    expect(a.ack?.error).toBe('NO_MONEY');
    expect(player(a.s, 1).game.responses['L4-E2']).toBeUndefined();
    const b = decided({ build: true, wage: 'fair', env: 'skip' }, tight);
    expect(b.ack?.ok).toBe(true);
    expect(player(b.s, 1).game.money).toBe(260 + 150);
  });

  it('공개 상태 vnFactory는 수만(누가 낮은 임금을 골랐는지 없음)', () => {
    let { s } = decided({ build: true, wage: 'low', env: 'skip' });
    s = act(s, 2, { type: 'respondEvent', eventId: 'L4-E2', response: { build: false } }).snapshot;
    const pub = publicPayload(s);
    expect(pub.public.vnFactory).toEqual({ built: 1, notBuilt: 1, fair: 0, low: 1, install: 0, skip: 1 });
    const text = JSON.stringify(pub);
    expect(text).not.toContain('"wage"');
    expect(text).not.toContain('"responses"');
  });
});

describe('L4-E3 근로 환경 보도·개선', () => {
  function reported(resp: Record<string, unknown>, money?: number): HostSnapshot {
    let s = l4(2);
    s = teach(s, { type: 'fireEvent', id: 'L4-E2' });
    s = act(s, 1, { type: 'respondEvent', eventId: 'L4-E2', response: resp as never }).snapshot;
    s = act(s, 2, { type: 'respondEvent', eventId: 'L4-E2', response: { build: true, wage: 'fair', env: 'install' } }).snapshot;
    s = teach(s, { type: 'closeEvent' });
    s = teach(s, { type: 'startRound' });
    if (money !== undefined) s = editPlayer(s, 1, (p) => (p.game.money = money));
    return teach(s, { type: 'fireEvent', id: 'L4-E3' });
  }

  it('보도 대상(낮은 임금 또는 미설치)만 사회적 책임 −10·평판 하락, 정당+설치 학생은 그대로', () => {
    const s = reported({ build: true, wage: 'low', env: 'skip' });
    const c0 = player(l4(2), 1).game.metrics.csr;
    expect(player(s, 1).game.metrics.csr - c0).toBe(-20 - 10);
    expect(player(s, 1).game.effects.reputationDown).toBe(true);
    expect(player(s, 2).game.metrics.csr - c0).toBe(40);
    expect(player(s, 2).game.effects.reputationDown).toBeFalsy();
  });

  it('평판 하락: 인기(H) 판매가가 보통(N)으로', () => {
    const s = reported({ build: true, wage: 'low', env: 'skip' });
    const ports = ['BUS', 'SHA', 'YOK', 'HCM', 'BKK', 'PHE', 'DAM', 'JKT', 'SIN', 'MUM', 'LAX', 'ROT'] as const;
    let found = false;
    for (const port of ports) {
      for (const good of Object.keys(goodsById) as GoodId[]) {
        const a = quote(s.class, { ...player(s, 1), game: { ...player(s, 1).game, port } } as Player, port, good);
        const b = quote(s.class, { ...player(s, 2), game: { ...player(s, 2).game, port } } as Player, port, good);
        if (a.tag === 'H' && a.sell !== null && b.sell !== null) {
          expect(a.sell).toBeLessThan(b.sell);
          found = true;
        }
      }
    }
    expect(found).toBe(true);
  });

  it('개선 두 번(임금·설비 각 100만 원, +10) → 평판 회복, 같은 것 두 번은 ANSWERED, 고칠 것 없으면 NOTHING_TO_IMPROVE', () => {
    let s = reported({ build: true, wage: 'low', env: 'skip' });
    const m0 = player(s, 1).game.money;
    let r = act(s, 1, { type: 'respondEvent', eventId: 'L4-E3', response: { improve: 'wage' } });
    expect(ackOf(r)?.ok).toBe(true);
    s = r.snapshot;
    expect(player(s, 1).game.effects.reputationDown).toBe(true);
    r = act(s, 1, { type: 'respondEvent', eventId: 'L4-E3', response: { improve: 'wage' } }, 2);
    expect(ackOf(r)?.error).toBe('ANSWERED');
    r = act(s, 1, { type: 'respondEvent', eventId: 'L4-E3', response: { improve: 'env' } }, 3);
    s = r.snapshot;
    expect(player(s, 1).game.money).toBe(m0 - 200);
    expect(player(s, 1).game.metrics.csr - player(l4(2), 1).game.metrics.csr).toBe(-30 + 20);
    expect(player(s, 1).game.effects.reputationDown).toBe(false);
    expect(ackOf(act(s, 2, { type: 'respondEvent', eventId: 'L4-E3', response: { improve: 'wage' } }))?.error).toBe('NOTHING_TO_IMPROVE');
    // 낮은 임금만 고른 학생은 설비를 고칠 수 없다
    const t = reported({ build: true, wage: 'low', env: 'install' });
    expect(ackOf(act(t, 1, { type: 'respondEvent', eventId: 'L4-E3', response: { improve: 'env' } }))?.error).toBe('NOTHING_TO_IMPROVE');
  });

  it('쓸 수 있는 돈이 모자라면 NO_MONEY', () => {
    const s = reported({ build: true, wage: 'low', env: 'skip' }, 50);
    expect(ackOf(act(s, 1, { type: 'respondEvent', eventId: 'L4-E3', response: { improve: 'wage' } }))?.error).toBe('NO_MONEY');
  });

  it('(검증 반영) 보도가 이미 나온 뒤 따라잡기로 낮은 임금을 고른 학생도 그 자리에서 보도·평판 하락(정당+설치면 없음)', () => {
    let s = l4(2);
    s = teach(s, { type: 'fireEvent', id: 'L4-E2' });
    s = teach(s, { type: 'closeEvent' });
    s = teach(s, { type: 'startRound' });
    s = teach(s, { type: 'fireEvent', id: 'L4-E3' });
    const c0 = player(s, 1).game.metrics.csr;
    s = act(s, 1, { type: 'respondEvent', eventId: 'L4-E2', response: { build: true, wage: 'low', env: 'install' } }).snapshot;
    s = act(s, 2, { type: 'respondEvent', eventId: 'L4-E2', response: { build: true, wage: 'fair', env: 'install' } }).snapshot;
    expect(player(s, 1).game.metrics.csr - c0).toBe(10 - 10);
    expect(player(s, 1).game.effects.reputationDown).toBe(true);
    expect(player(s, 2).game.effects.reputationDown).toBeFalsy();
    expect(ackOf(act(s, 1, { type: 'respondEvent', eventId: 'L4-E3', response: { improve: 'wage' } }, 2))?.ok).toBe(true);
  });

  it('⑭ 도우미: 낮은 임금·미설치 기록', () => {
    const s = reported({ build: true, wage: 'low', env: 'skip', reason: '수익을 늘리려고' });
    const line = helperLine('factoryDecision', { cls: s.class, player: player(s, 1) });
    expect(line).toContain('낮은 임금');
    expect(line).toContain('수익을 늘리려고');
  });
});

// ─── 배치 ─────────────────────────────────────────────

const FRONT_EVENTS = ['L4-E1', 'L4-E2', 'L4-E3', 'L4-E4'];
const PART: Record<LessonPart, { must: string[]; never: string[]; ws: string[]; noWs: string[] }> = {
  front: { must: ['L4-E1', 'L4-E2', 'L4-E3'], never: [], ws: ['W13', 'W14', 'W15'], noWs: ['W16', 'W17', 'W18'] },
  back: { must: [], never: FRONT_EVENTS, ws: ['W16', 'W17', 'W18'], noWs: ['W13', 'W14', 'W15'] },
  all: { must: ['L4-E1', 'L4-E2', 'L4-E3'], never: [], ws: ['W13', 'W14', 'W15', 'W16', 'W17', 'W18'], noWs: [] },
};

describe('차시 L4 배치', () => {
  for (const part of ['front', 'back', 'all'] as const) {
    for (const T of [10, 15, 20, 25, 30]) {
      it(`${part} ${T}분: 끝 ≤ T, 1등급 누락 0, 그 시간 학습지 누락 0, 다른 시간 활동·학습지 0, 라운드 2개 이상`, () => {
        const s = buildSchedule({ playUnit: 'lesson', scope: ['L4'], tradeMinutes: T, lessonPart: part });
        const live = s.items.filter((it) => it.form !== 'dropped');
        expect(Math.max(...live.map((it) => it.at + it.durSec))).toBeLessThanOrEqual(T * 60);
        expect(s.totalRounds).toBeGreaterThanOrEqual(2);
        const exp = PART[part];
        for (const id of exp.must) expect(live.some((it) => it.refId === id), id).toBe(true);
        for (const id of exp.never) expect(s.items.some((it) => it.refId === id), id).toBe(false);
        for (const id of exp.never) expect(s.activities.some((a) => a.id === id), `미리보기 ${id}`).toBe(false);
        const placed = new Set<string>([...live.filter((it) => it.kind === 'worksheet').flatMap((it) => it.refIds ?? [it.refId]), ...s.wrapup.flatMap((w) => w.worksheetIds)]);
        for (const w of exp.ws) expect(placed.has(w), w).toBe(true);
        for (const w of exp.noWs) expect(placed.has(w), w).toBe(false);
        // ⑭는 근로 환경 보도보다 앞에 뜨지 않는다(활동마다 바로일 때)
        const e3 = live.find((it) => it.refId === 'L4-E3');
        const w14 = live.find((it) => it.kind === 'worksheet' && (it.refIds ?? [it.refId]).includes('W14'));
        if (e3 && w14) expect(w14.at, 'W14 뒤').toBeGreaterThanOrEqual(e3.at);
        // 학습지 번호는 거꾸로 가지 않는다
        const order = live.filter((it) => it.kind === 'worksheet').flatMap((it) => it.refIds ?? [it.refId]);
        expect([...order].sort()).toEqual(order);
      });
    }
  }

  it('(검증 반영) 무역 30분 미만 앞 시간·두 시간 모두: 철강 회상 3단계를 빼고(짧게) 베트남 기사·공장 결정을 전체 형태로 — 30분 이상은 둘 다 전체, 교사가 정하면 교사 것', () => {
    for (const part of ['front', 'all'] as const) {
      const f = (T: number, overrides?: Record<string, 'full' | 'short' | 'dropped'>) => buildSchedule({ playUnit: 'lesson', scope: ['L4'], tradeMinutes: T, lessonPart: part, ...(overrides ? { overrides } : {}) } as never).activities;
      const a25 = f(25);
      expect(a25.find((a) => a.id === 'L4-E1')?.form, part).toBe('short');
      expect(a25.find((a) => a.id === 'L4-E1')?.pinned, part).toBe(false);
      expect(a25.find((a) => a.id === 'L4-E2')?.form, part).toBe('full');
      const a30 = f(30);
      expect(a30.find((a) => a.id === 'L4-E1')?.form).toBe('full');
      expect(a30.find((a) => a.id === 'L4-E2')?.form).toBe('full');
    }
    expect(lessonPartRules('lesson', ['L4'], 'back')?.shortBelowMinutes).toBeUndefined();
  });

  it('앞 시간 25분: 관세사 카드·⑭⑮는 보도 라운드 뒤, 마지막 항해(마지막 라운드) 앞', () => {
    const s = buildSchedule({ playUnit: 'lesson', scope: ['L4'], tradeMinutes: 25, lessonPart: 'front' });
    const rounds = s.items.filter((it) => it.kind === 'round');
    const last = rounds[rounds.length - 1]!;
    const e3 = s.items.find((it) => it.refId === 'L4-E3')!;
    const e4 = s.items.find((it) => it.refId === 'L4-E4')!;
    const w15 = s.items.find((it) => it.refId === 'W15')!;
    expect(e4.at).toBeGreaterThan(e3.at);
    expect(w15.at + w15.durSec).toBeLessThanOrEqual(last.at);
  });

  it('라운드 1개 판(차시 한 판): 보도는 공장 결정 패널과 같은 순간이 아니라 라운드 중간', () => {
    const s = buildSchedule({ playUnit: 'lesson', scope: ['L4'], tradeMinutes: 7, lessonPart: 'front' });
    expect(s.totalRounds).toBe(1);
    const r1 = s.items.find((it) => it.kind === 'round')!;
    const e2 = s.items.find((it) => it.refId === 'L4-E2' && it.form !== 'dropped')!;
    const e3 = s.items.find((it) => it.refId === 'L4-E3' && it.form !== 'dropped')!;
    expect(e2.blocking).toBe(false);
    expect(e2.at).toBe(r1.at);
    expect(e3.at).toBe(r1.at + Math.floor(r1.durSec / 2));
  });

  it('시간별 마무리 구성: 앞 = 컨테이너·잡지·⑯⑰⑱ 없음·되돌아보기 2문항 / 뒤·두 시간 모두 = 4차시 마무리 전체', () => {
    const w = (part: LessonPart) => buildSchedule({ playUnit: 'lesson', scope: ['L4'], tradeMinutes: 25, lessonPart: part }).wrapup;
    const front = w('front');
    expect(front.map((x) => x.id)).toEqual(['settle', 'awards', 'reflect', 'afterWorksheet']);
    expect(front.find((x) => x.id === 'reflect')?.questions).toBe(2);
    expect(front.flatMap((x) => x.worksheetIds)).toEqual([]);
    for (const part of ['back', 'all'] as const) {
      const x = w(part);
      expect(x.map((y) => y.id)).toEqual(['settle', 'containers', 'awards', 'reflect', 'magazine', 'afterWorksheet']);
      expect(x.find((y) => y.id === 'reflect')?.questions).toBe(3);
      expect(x.flatMap((y) => y.worksheetIds)).toEqual(['W16', 'W18', 'W17']);
    }
  });

  it('뒤 시간 판: 표지 → 바로 라운드, 1970년대 철강·관세 30%·공장 결정·관세사·⑬⑭⑮ 없음, 그 도감 카드 숨김, 편지는 공통 문항만', () => {
    const rule = lessonPartRules('lesson', ['L4'], 'back')!;
    const s = buildSchedule({ playUnit: 'lesson', scope: ['L4'], tradeMinutes: 15, lessonPart: 'back' });
    const kinds = s.items.filter((it) => it.form !== 'dropped').map((it) => it.kind);
    expect(kinds.slice(0, 3)).toEqual(['stageCover', 'stageCover', 'round']);
    expect(s.items.some((it) => it.kind === 'event')).toBe(false);
    expect(dexHeldBack(rule)).toEqual(expect.arrayContaining(['steel-1970', 'import-pros-cons', 'overseas-production', 'customs-broker']));
    for (const d of ['easy', 'normal'] as const) for (const q of letterBank('L4', d, rule.dropLetters)) expect(q.common, q.id).toBe(true);
    expect(coverTextFor(eventsById['L4-COVER']!, { playUnit: 'lesson', scope: ['L4'], lessonPart: 'back' }).title).toBe('L4. 항해를 마치며');
  });

  it('뒤 시간 판을 실제로 돌려도 철강 관세 효과가 없다', () => {
    let s = l4(2, 'back');
    s = teach(s, { type: 'startRound' });
    expect(s.class.activeEffects.some((e) => e.id === 'steel1970')).toBe(false);
    expect(tariffForLot(s.class, 'BUS', 'steel', 'foreign')).toBe(0.1);
    expect(player(s, 1).game.cargo).toEqual([]);
    expect(player(s, 1).game.money).toBe(1200);
  });

  it('편지 은행: 앞 시간·두 시간 모두 난이도별 5 이상·합계 10 이상(정답·쪽수·해설)', () => {
    for (const part of ['front', 'all'] as const) {
      const drop = lessonPartRules('lesson', ['L4'], part)!.dropLetters;
      const easy = letterBank('L4', 'easy', drop);
      const normal = letterBank('L4', 'normal', drop);
      expect(easy.length).toBeGreaterThanOrEqual(5);
      expect(normal.length).toBeGreaterThanOrEqual(5);
      expect(easy.length + normal.length).toBeGreaterThanOrEqual(10);
      for (const q of [...easy, ...normal]) {
        expect(q.pages.length).toBeGreaterThan(0);
        expect(q.explain.length).toBeGreaterThan(0);
      }
    }
  });

  it('시작 1,200만 원·처음 화물 없음·요약 카드 SUM-L1~L3(앞 시간)', () => {
    const s = l4(1, 'front');
    expect(player(s, 1).game.money).toBe(1200);
    expect(player(s, 1).game.cargo).toEqual([]);
    const b = buildSchedule({ playUnit: 'lesson', scope: ['L4'], tradeMinutes: 25, lessonPart: 'front' });
    expect(b.items.find((it) => it.variant === 'summary')?.refIds).toEqual(['SUM-L1', 'SUM-L2', 'SUM-L3']);
  });

  it('남은 화물은 결산에서 산 값의 절반(기존 scoring)', () => {
    const s = editPlayer(l4(1), 1, (p) => {
      p.game.money = 100;
      p.game.cargo = [{ good: 'steel', qty: 2, unitCost: 60, origin: 'foreign', source: 'specialty', boughtAt: 'SHA' }];
    });
    const p = player(s, 1);
    expect(assetValue(p) - assetValue({ ...p, game: { ...p.game, cargo: [] } })).toBe(60);
  });

  it('단원 한 판의 L4는 나눠 고르기 규칙을 타지 않는다(관세사 카드 자리·마무리 그대로)', () => {
    expect(lessonPartRules('unit', ['L1', 'L2', 'L3', 'L4'], 'front')).toBeNull();
    expect(lessonPartRules('custom', ['L3', 'L4'], 'front')).toBeNull();
    const u = buildSchedule({ playUnit: 'unit', scope: ['L1', 'L2', 'L3', 'L4'], tradeMinutes: 40 });
    expect(u.wrapup.find((w) => w.id === 'reflect')?.questions).toBe(3);
  });
});
