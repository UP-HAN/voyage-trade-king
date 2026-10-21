/**
 * 작업 151 — 자유 항해(PRD 4.3.7.1): 라운드 중 [여기로 출발]로 바로 이동, 운항비는 라운드 끝에 한꺼번에 정산.
 */
import { describe, expect, it } from 'vitest';
import { voyageCostFor } from '../../src/core/market';
import { applyAction, spendable } from '../../src/core/rules';
import { normalizePlayer, normalizeClass, normalizeSnapshot } from '../../src/core/state';
import { resolveRounds } from '../../src/core/voyage';
import { applyTeacherAction } from '../../src/core/lesson';
import type { HostSnapshot, LogEntry } from '../../src/core/types';
import type { LessonId } from '../../src/data/types';
import { act, editPlayer, makeSession, player, startFirstRound, teach } from './helpers';

/** 자유 항해 판(준비 단계에서 교사 설정으로 바꿈) */
function freeSession(n = 1, scope: LessonId[] = ['L1']): HostSnapshot {
  const s = makeSession({ n, scope });
  return teach(s, { type: 'updateSettings', settings: { voyageMode: 'free' } }, 0);
}

describe('자유 항해 — 바로 이동(sailTo)', () => {
  it('라운드 중 바로 그 항구로 도착, 입항 한도 새로 시작, 기록·사건, 운항비는 낼 운항비에', () => {
    let s = startFirstRound(freeSession());
    expect(s.class.settings.voyageMode).toBe('free');
    s = editPlayer(s, 1, (p) => {
      p.game.visit.sold = { gas: 3 };
    });
    const cost = voyageCostFor(s.class, player(s, 1), 'BUS', 'SHA');
    const r = applyAction(s.class, player(s, 1), { type: 'sailTo', port: 'SHA' });
    expect(r.error).toBeUndefined();
    const g = r.player.game;
    expect(g.port).toBe('SHA');
    expect(g.money).toBe(500); // 아직 내지 않음
    expect(g.fareDue).toBe(cost);
    expect(g.sailsThisRound).toBe(1);
    expect(g.visit).toEqual({ arrival: 1, sold: {}, bought: {} });
    expect(g.metrics.visited).toContain('SHA');
    expect(g.dest).toBeNull();
    expect(g.ready).toBe(false);
    expect(g.log.at(-1)).toEqual<LogEntry>({ round: 1, stage: 'L1', kind: 'voyage', port: 'BUS', to: 'SHA', amount: cost });
    expect(r.events.map((e) => e.type)).toEqual(expect.arrayContaining(['departed', 'arrived', 'portCard']));
    expect(spendable(s.class, r.player)).toBe(500 - cost);
  });

  it('첫 입항 사건(2차시 싱가포르 L2-E5)이 그대로 일어난다', () => {
    const s = startFirstRound(freeSession(1, ['L2']));
    const r = applyAction(s.class, player(s, 1), { type: 'sailTo', port: 'SIN' });
    expect(r.error).toBeUndefined();
    expect(r.events).toContainEqual({ type: 'eventTriggered', id: 'L2-E5' });
    expect(r.player.game.responses['L2-E5']).toBe(true);
  });

  it('호스트 경로(act)로도 같은 결과(학생 예측 = 호스트)', () => {
    const s = startFirstRound(freeSession());
    const pre = applyAction(s.class, player(s, 1), { type: 'sailTo', port: 'YOK' });
    const host = act(s, 1, { type: 'sailTo', port: 'YOK' });
    const hp = host.snapshot.players.s01;
    expect(hp.game).toEqual(pre.player.game);
  });

  it('순풍이면 운항비 0, 순풍 1회 씀', () => {
    let s = startFirstRound(freeSession());
    s = editPlayer(s, 1, (p) => {
      p.game.effects.tailwind = 1;
    });
    const r = applyAction(s.class, player(s, 1), { type: 'sailTo', port: 'PHE' });
    expect(r.player.game.fareDue).toBe(0);
    expect(r.player.game.effects.tailwind).toBe(0);
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'departed', cost: 0, free: true }));
  });

  it('못 가는 때: 같은 항구·열리지 않음·막힘', () => {
    let s = startFirstRound(freeSession());
    expect(applyAction(s.class, player(s, 1), { type: 'sailTo', port: 'BUS' }).error).toBe('SAME_PORT');
    expect(applyAction(s.class, player(s, 1), { type: 'sailTo', port: 'SIN' }).error).toBe('PORT_LOCKED');
    s = {
      ...s,
      class: { ...s.class, activeEffects: [{ id: 'x', source: 'test', effect: { type: 'portClosed', port: 'SHA' }, until: null }] },
    };
    expect(applyAction(s.class, player(s, 1), { type: 'sailTo', port: 'SHA' }).error).toBe('PORT_CLOSED');
  });

  it('(작업 153 추가) 횟수 제한 없음: 한 라운드에 여러 번 항해, 운항비는 쌓였다가 라운드 끝에 한꺼번에', () => {
    let s = startFirstRound(freeSession());
    s = editPlayer(s, 1, (p) => {
      p.game.money = 5000;
    });
    const route = ['SHA', 'YOK', 'BUS', 'SHA', 'YOK', 'BUS'] as const;
    let p = player(s, 1);
    let due = 0;
    for (let i = 0; i < route.length; i++) {
      due += voyageCostFor(s.class, p, p.game.port, route[i]);
      const r = applyAction(s.class, p, { type: 'sailTo', port: route[i] });
      expect(r.error, String(i)).toBeUndefined();
      p = r.player;
    }
    expect(p.game.sailsThisRound).toBe(6);
    expect(p.game.fareDue).toBe(due);
    expect(p.game.money).toBe(5000);
    s = { ...s, players: { ...s.players, s01: p } };
    s = teach(s, { type: 'endRound' });
    expect(player(s, 1).game.sailsThisRound).toBe(0);
    expect(player(s, 1).game.fareDue).toBe(0);
    expect(player(s, 1).game.money).toBe(5000 - due);
  });

  it('(작업 153 추가) 라운드 끝이 막지 않는다: 라운드 사이에도 사고팔기·출발, 멈춤·무역 끝·차단형 활동이면 NOT_TRADING', () => {
    let s = startFirstRound(freeSession());
    s = editPlayer(s, 1, (p) => {
      p.game.money = 5000;
    });
    s = teach(s, { type: 'endRound' });
    expect(s.class.phase).toBe('between');
    const r = applyAction(s.class, player(s, 1), { type: 'sailTo', port: 'SHA' });
    expect(r.error).toBeUndefined();
    expect(r.player.game.fareDue).toBeGreaterThan(0);
    expect(applyAction(s.class, r.player, { type: 'buy', good: 'chip', qty: 1 }).error).not.toBe('NOT_TRADING');
    // 라운드마다 판은 그대로 막힘
    const rs = teach(startFirstRound(makeSession({ n: 1 })), { type: 'endRound' });
    expect(applyAction(rs.class, player(rs, 1), { type: 'buy', good: 'chip', qty: 1 }).error).toBe('NOT_TRADING');
    // 멈춤·차단형 활동(event)·무역 끝
    expect(applyAction({ ...s.class, paused: true }, player(s, 1), { type: 'sailTo', port: 'SHA' }).error).toBe('NOT_TRADING');
    expect(applyAction({ ...s.class, phase: 'event' }, player(s, 1), { type: 'sailTo', port: 'SHA' }).error).toBe('NOT_TRADING');
    expect(applyAction({ ...s.class, phase: 'worksheet' }, player(s, 1), { type: 'sailTo', port: 'SHA' }).error).toBe('NOT_TRADING');
    expect(applyAction({ ...s.class, tradeEnded: true }, player(s, 1), { type: 'sailTo', port: 'SHA' }).error).toBe('NOT_TRADING');
    // 무역이 끝나면 남은 낼 운항비를 정산
    s = { ...s, players: { ...s.players, s01: r.player } };
    s = teach(s, { type: 'endTrade' });
    expect(player(s, 1).game.fareDue).toBe(0);
    expect(player(s, 1).game.money).toBe(5000 - r.player.game.fareDue!);
  });

  it('(작업 159) 쓸 수 있는 돈(자금 − 낼 운항비)이 운항비보다 적어도 출발 — 낼 운항비에 쌓이고 정산 때 모자란 만큼 대출', () => {
    let s = startFirstRound(freeSession());
    const cost = voyageCostFor(s.class, player(s, 1), 'BUS', 'SHA');
    s = editPlayer(s, 1, (p) => {
      p.game.money = 100;
      p.game.fareDue = 100 - cost + 1;
    });
    const r = applyAction(s.class, player(s, 1), { type: 'sailTo', port: 'SHA' });
    expect(r.error).toBeUndefined();
    expect(r.player.game.port).toBe('SHA');
    expect(r.player.game.fareDue).toBe(101);
    expect(spendable(s.class, r.player)).toBe(-1);
    // 자금 0(빈손)이어도 출발
    const zero = editPlayer(s, 1, (p) => {
      p.game.money = 0;
      p.game.fareDue = 0;
    });
    const z = applyAction(zero.class, player(zero, 1), { type: 'sailTo', port: 'SHA' });
    expect(z.error).toBeUndefined();
    expect(z.player.game.fareDue).toBe(cost);
    // 쓸 수 있는 돈이 음수면 사기는 막힌다(기존 판정 그대로)
    expect(applyAction(s.class, z.player, { type: 'buy', good: 'rice' as never, qty: 1 }).error).toBeTruthy();
    // 라운드 끝 정산: 모자란 만큼 대출, 자금 음수 없음
    const res = resolveRounds({ ...s.class, phase: 'between' }, r.player);
    expect(res.player.game.money).toBe(0);
    expect(res.player.game.loan).toBe(1);
    expect(res.player.game.fareDue).toBe(0);
    expect(res.events).toContainEqual({ type: 'loan', amount: 1 });
    // 무역 끝 정산도 같은 길(호스트 endTrade)
    let t = { ...zero, players: { ...zero.players, s01: z.player } };
    t = teach(t, { type: 'endTrade' });
    expect(player(t, 1).game.fareDue).toBe(0);
    expect(player(t, 1).game.money).toBe(0);
    expect(player(t, 1).game.loan).toBe(cost);
  });

  it('(작업 159) 라운드마다 판은 그대로 — 자금이 운항비보다 적으면 목적지 NO_MONEY', () => {
    let s = startFirstRound(makeSession({ n: 1 }));
    s = editPlayer(s, 1, (p) => {
      p.game.money = 0;
    });
    expect(applyAction(s.class, player(s, 1), { type: 'setDestination', port: 'SHA' }).error).toBe('NO_MONEY');
  });

  it('무역 시작 전·멈춤 중에는 거절, 라운드마다 판에서도 거절(작업 153 추가: 라운드 사이는 허용)', () => {
    const before = freeSession();
    expect(applyAction(before.class, player(before, 1), { type: 'sailTo', port: 'SHA' }).error).toBe('NOT_TRADING');
    const s = startFirstRound(freeSession());
    const paused = { ...s.class, paused: true };
    expect(applyAction(paused, player(s, 1), { type: 'sailTo', port: 'SHA' }).error).toBe('NOT_TRADING');
    const between = { ...s.class, phase: 'between' as const };
    expect(applyAction(between, player(s, 1), { type: 'sailTo', port: 'SHA' }).error).toBeUndefined();
    const round = startFirstRound(makeSession({ n: 1 }));
    expect(round.class.settings.voyageMode).toBe('round');
    expect(applyAction(round.class, player(round, 1), { type: 'sailTo', port: 'SHA' }).error).toBe('NOT_FREE_VOYAGE');
  });
});

describe('자유 항해 — 쓸 수 있는 돈으로 사기 판정', () => {
  it('자금은 남아도 낼 운항비를 빼면 모자라면 사기 막힘', () => {
    let s = startFirstRound(freeSession());
    // 부산에서 살 수 있는 상품 하나 찾기
    const goods = ['graphite', 'gas', 'rice', 'chip', 'car', 'phone', 'steel', 'battery'] as const;
    let good: (typeof goods)[number] | null = null;
    for (const g of goods) {
      const r = applyAction(s.class, player(s, 1), { type: 'buy', good: g as never, qty: 1 });
      if (!r.error) {
        good = g;
        break;
      }
    }
    expect(good).not.toBeNull();
    const ok = applyAction(s.class, player(s, 1), { type: 'buy', good: good as never, qty: 1 });
    const price = 500 - ok.player.game.money;
    s = editPlayer(s, 1, (p) => {
      p.game.fareDue = 500 - price + 1;
    });
    expect(applyAction(s.class, player(s, 1), { type: 'buy', good: good as never, qty: 1 }).error).toBe('NO_MONEY');
    // 라운드마다 판이면 fareDue 는 판정에 쓰지 않는다
    const rs = { ...s.class, settings: { ...s.class.settings, voyageMode: 'round' as const } };
    expect(applyAction(rs, player(s, 1), { type: 'buy', good: good as never, qty: 1 }).error).toBeUndefined();
  });
});

describe('자유 항해 — 라운드 끝 정산', () => {
  it('낼 운항비를 한꺼번에 내고 fareSettled, 배는 그대로', () => {
    let s = startFirstRound(freeSession());
    const r1 = applyAction(s.class, player(s, 1), { type: 'sailTo', port: 'SHA' });
    const r2 = applyAction(s.class, r1.player, { type: 'sailTo', port: 'YOK' });
    const due = r2.player.game.fareDue ?? 0;
    expect(due).toBeGreaterThan(0);
    s = { ...s, players: { ...s.players, s01: r2.player } };
    const cls = { ...s.class, phase: 'between' as const };
    const res = resolveRounds(cls, player(s, 1));
    expect(res.player.game.port).toBe('YOK');
    expect(res.player.game.money).toBe(500 - due);
    expect(res.player.game.fareDue).toBe(0);
    expect(res.player.game.resolvedRound).toBe(1);
    expect(res.events).toContainEqual({ type: 'fareSettled', amount: due, round: 1 });
    expect(res.events.some((e) => e.type === 'stayed' || e.type === 'departed')).toBe(false);
    // 멱등
    expect(resolveRounds(cls, res.player).player).toBe(res.player);
  });

  it('정산 때 자금이 모자라면 모자란 만큼 대출(자금 음수 없음)', () => {
    let s = startFirstRound(freeSession());
    s = editPlayer(s, 1, (p) => {
      p.game.money = 30;
      p.game.fareDue = 50;
      p.game.cargo = [{ good: 'rice' as never, qty: 1, unitCost: 10, origin: 'foreign', source: 'specialty', boughtAt: 'SHA' }];
    });
    const res = resolveRounds({ ...s.class, phase: 'between' }, player(s, 1));
    expect(res.player.game.money).toBe(0);
    expect(res.player.game.loan).toBe(20);
    expect(res.events).toContainEqual({ type: 'loan', amount: 20 });
    expect(res.events).toContainEqual({ type: 'fareSettled', amount: 50, round: 1 });
  });

  it('호스트 endRound 로 모든 학생 정산', () => {
    let s = startFirstRound(freeSession(2));
    s = act(s, 1, { type: 'sailTo', port: 'HCM' }).snapshot;
    const due = player(s, 1).game.fareDue ?? 0;
    s = teach(s, { type: 'endRound' });
    expect(player(s, 1).game.money).toBe(500 - due);
    expect(player(s, 1).game.port).toBe('HCM');
    expect(player(s, 2).game.money).toBe(500);
  });
});

describe('자유 항해 — 설정·옛 상태', () => {
  it('규칙 엔진 기본은 라운드마다, 판 시작 뒤에는 항해 방식을 바꾸지 않는다', () => {
    const s = makeSession({ n: 0 });
    expect(s.class.settings.voyageMode).toBe('round');
    const started = startFirstRound(freeSession(0));
    const r = applyTeacherAction(started.class, { type: 'updateSettings', settings: { voyageMode: 'round' } }, 2000);
    expect(r.class.settings.voyageMode).toBe('free');
  });

  it('옛 상태(필드 없음) 복원: fareDue·sailsThisRound 0, voyageMode round', () => {
    const s = startFirstRound(freeSession());
    const raw = JSON.parse(JSON.stringify(s)) as HostSnapshot;
    delete (raw.players.s01.game as { fareDue?: number }).fareDue;
    delete (raw.players.s01.game as { sailsThisRound?: number }).sailsThisRound;
    delete (raw.class.settings as { voyageMode?: string }).voyageMode;
    const n = normalizeSnapshot(raw)!;
    expect(n.players.s01.game.fareDue).toBe(0);
    expect(n.players.s01.game.sailsThisRound).toBe(0);
    expect(n.class.settings.voyageMode).toBe('round');
    expect(normalizePlayer({ game: { fareDue: 40, sailsThisRound: 2 } }).game.fareDue).toBe(40);
    expect(normalizeClass({ settings: { voyageMode: 'free' } }).settings.voyageMode).toBe('free');
  });
});
