/**
 * 작업 172 — 3차시(차시 한 판 L3) core: 광물 협력(L3-E1), 학급 스마트폰(팀 배정·필요 수량·조립장·완성 보상),
 * 경제 게이지, AI 기술 경쟁(L3-E3), 자동화 항만 투표(L3-E4), ⑨⑩⑪ 도우미, 차시 L3 배치(앞·뒤·두 시간 모두 × 15~40분).
 */
import { describe, expect, it } from 'vitest';
import { aggregate, buildSchedule, hostReduce, publicPayload, quote } from '../../src/core';
import { econGauge, phoneNeed, teamFor } from '../../src/core/phone';
import { visibleGoods } from '../../src/core/state';
import type { HostSnapshot, Player } from '../../src/core/types';
import { helperLine } from '../../src/core/worksheet-helpers';
import { lessonPartRules, type LessonPart } from '../../src/data/lessonParts';
import { econGaugeStep, PHONE_PARTS } from '../../src/data/phone';
import { goodsById } from '../../src/data/goods';
import type { GoodId, PortId } from '../../src/data/types';
import { act, editPlayer, makeSession, player, teach } from './helpers';

/** 3차시 판: 표지 → (자유 항해) */
function l3(n: number, part: LessonPart = 'all', free = true): HostSnapshot {
  let s = makeSession({ n, scope: ['L3'], lessonPart: part });
  if (free) s = teach(s, { type: 'updateSettings', settings: { voyageMode: 'free' } }, 0);
  s = teach(s, { type: 'startStage', stage: 'L3' });
  return teach(s, { type: 'closeEvent' });
}

/** 스마트폰 프로젝트 시작(L3-E2 발동) → 라운드 1 */
function phoneRound(n: number, part: LessonPart = 'all', short = false): HostSnapshot {
  let s = l3(n, part);
  s = teach(s, { type: 'fireEvent', id: 'L3-E2', short });
  return teach(s, { type: 'startRound' });
}

const lot = (good: GoodId, qty: number, boughtAt: PortId, source: 'specialty' | 'factory' = 'specialty', unitCost = 50): Player['game']['cargo'][number] => ({
  good, qty, unitCost, origin: source === 'factory' || boughtAt === 'BUS' ? 'korea' : 'foreign', source, boughtAt,
});

const atBusanWith = (s: HostSnapshot, seat: number, lots: Player['game']['cargo'], contracts: Player['game']['cargo'] = []) =>
  editPlayer(s, seat, (p) => {
    p.game.port = 'BUS';
    p.game.cargo = lots;
    p.game.contracts = contracts;
  });

const ackOf = (r: ReturnType<typeof act>) => r.outputs.find((o) => o.kind === 'ack') as { ok: boolean; error?: string } | undefined;

describe('L3-E1 광물 협력(함께해요 50만 원 · 협력 +10 · 자카르타 니켈 사는 값 20% 싸게)', () => {
  function decided(choice: 'join' | 'none' | null): HostSnapshot {
    let s = l3(2);
    s = teach(s, { type: 'fireEvent', id: 'L3-E1' });
    if (choice) s = act(s, 1, { type: 'respondEvent', eventId: 'L3-E1', response: { choice } }).snapshot;
    s = teach(s, { type: 'closeEvent' });
    return teach(s, { type: 'startRound' });
  }

  it('함께해요: −50만 원, 협력 +10, 니켈 할인, 도감 상호 의존, 결정 기록', () => {
    const s = decided('join');
    const p = player(s, 1);
    const q = player(s, 2);
    expect(p.game.money).toBe(q.game.money - 50);
    expect(p.game.metrics.coop).toBe(q.game.metrics.coop + 10);
    expect(p.game.effects.nickelDiscount).toBe(true);
    expect(p.game.decisions['L3-E1']).toBe('join');
    expect(p.game.metrics.dex).toContain('interdependence');
  });

  it('니켈 할인은 자카르타 니켈 사는 값만(다른 항구·다른 상품은 그대로)', () => {
    let s = decided('join');
    s = editPlayer(s, 1, (p) => (p.game.port = 'JKT'));
    s = editPlayer(s, 2, (p) => (p.game.port = 'JKT'));
    const a = quote(s.class, player(s, 1), 'JKT', 'nickel');
    const b = quote(s.class, player(s, 2), 'JKT', 'nickel');
    expect(a.buy).toBe(Math.max(1, Math.round(b.buy! * 0.8)));
    expect(quote(s.class, player(s, 1), 'JKT', 'wood').buy).toBe(quote(s.class, player(s, 2), 'JKT', 'wood').buy);
    expect(quote(s.class, player(s, 1), 'SIN', 'nickel').buy).toBe(quote(s.class, player(s, 2), 'SIN', 'nickel').buy);
    // 실제로 산 값도 할인
    const r = act(s, 1, { type: 'buy', good: 'nickel', qty: 1 });
    expect(ackOf(r)?.ok).toBe(true);
    expect(player(r.snapshot, 1).game.cargo.find((l) => l.good === 'nickel')?.unitCost).toBe(a.buy);
  });

  it("이번에는 안 해요 / 응답 없음('응답 없음' + none): 돈·협력·할인 그대로", () => {
    for (const c of ['none', null] as const) {
      const s = decided(c);
      const p = player(s, 1);
      expect(p.game.money).toBe(player(s, 2).game.money);
      expect(p.game.effects.nickelDiscount).toBeUndefined();
      expect(p.game.decisions['L3-E1']).toBe('none');
      if (c === null) expect(p.game.responses['L3-E1']).toEqual({ choice: 'none', noResponse: true });
    }
  });

  it('자유 항해: 쓸 수 있는 돈(자금 − 낼 운항비)이 모자라면 가진 만큼만', () => {
    let s = l3(1);
    s = teach(s, { type: 'fireEvent', id: 'L3-E1' });
    s = editPlayer(s, 1, (p) => {
      p.game.money = 40;
      p.game.fareDue = 20;
    });
    s = act(s, 1, { type: 'respondEvent', eventId: 'L3-E1', response: { choice: 'join' } }).snapshot;
    expect(player(s, 1).game.money).toBe(20);
    expect(player(s, 1).game.effects.nickelDiscount).toBe(true);
  });

  it('⑨ 도우미: 참여 / 참여 안 함', () => {
    expect(helperLine('mineralCoopChoice', { cls: decided('join').class, player: player(decided('join'), 1) })).toBe('광물 협력: 참여했어요');
    expect(helperLine('mineralCoopChoice', { cls: decided('none').class, player: player(decided('none'), 1) })).toBe('광물 협력: 참여하지 않았어요');
  });
});

describe('학급 스마트폰: 부품 팀 배정·필요 수량', () => {
  it('출석번호 순으로 6종에 돌아가며(1번 반도체, 2번 배터리 … 7번 반도체)', () => {
    expect(PHONE_PARTS).toEqual(['chip', 'battery', 'chem', 'program', 'nickel', 'graphite']);
    expect([0, 1, 5, 6].map(teamFor)).toEqual(['chip', 'battery', 'graphite', 'chip']);
  });

  it('25명: 반도체 5명(필요 10), 나머지 4명(필요 8), 배터리만 절반(필요 4 — 검증 반영) · 학생 기록과 응답 거울(⑩)', () => {
    const s = phoneRound(25);
    const ph = s.class.phone!;
    expect(ph.parts.chip).toEqual({ need: 10, have: 0 });
    expect(ph.parts.battery).toEqual({ need: 4, have: 0 });
    for (const g of PHONE_PARTS.slice(2)) expect(ph.parts[g]).toEqual({ need: 8, have: 0 });
    expect(player(s, 1).game.phone?.team).toBe('chip');
    expect(player(s, 2).game.phone?.team).toBe('battery');
    expect(player(s, 7).game.phone?.team).toBe('chip');
    expect(player(s, 1).game.responses['L3-E2']).toEqual({ part: 'chip', fromPort: null, qty: 0 });
    expect(player(s, 1).game.missions['M-PHONE']?.status).toBe('active');
  });

  it('7명: 반도체 2명(필요 4), 나머지 1명(필요 2), 배터리 1명(필요 1). 3명이면 빈 팀도 1명 몫(필요 2)', () => {
    const s = phoneRound(7);
    expect(s.class.phone!.parts.chip!.need).toBe(4);
    expect(s.class.phone!.parts.graphite!.need).toBe(2);
    expect(s.class.phone!.parts.battery!.need).toBe(1);
    expect(phoneRound(3).class.phone!.parts.nickel!.need).toBe(2);
  });

  it('짧은 형태면 절반(올림), 배터리는 그 절반(올림, 최소 1)', () => {
    expect(phoneRound(25, 'all', true).class.phone!.parts.chip!.need).toBe(5);
    expect(phoneRound(25, 'all', true).class.phone!.parts.nickel!.need).toBe(4);
    expect(phoneRound(25, 'all', true).class.phone!.parts.battery!.need).toBe(2);
    expect(phoneNeed(3, true)).toBe(3);
    expect(phoneNeed(1, true, 'battery')).toBe(1);
    expect(phoneNeed(5, false, 'battery')).toBe(5);
  });

  it('늦게 온 학생은 인원이 가장 적은 팀에(필요 수량은 그대로)', () => {
    let s = phoneRound(7);
    s = teach(s, { type: 'endRound' });
    // 8번 학생이 늦게 들어옴: 반도체 2, 나머지 1 → 배터리(맨 앞의 가장 적은 팀)
    s = act(s, 1, { type: 'setReady' }).snapshot;
    const before = JSON.stringify(s.class.phone!.parts);
    s = hostReduce(s, { type: 'join', seat: 8, pid: 'p08late', deviceToken: 'd8', companyName: '늦은배', nameKey: '늦은배' }, 2000).snapshot;
    expect(player(s, 8).game.phone?.team).toBe('battery');
    expect(player(s, 8).game.missions['M-PHONE']).toBeDefined();
    expect(JSON.stringify(s.class.phone!.parts)).toBe(before);
  });
});

describe('부산 [조립장] 부품 넣기(판매 아님)', () => {
  it('우리 팀 부품: V×1.2/상자, 협력 +2/상자, 임무 완료, ⑩ 기록(산 항구), 도장·수출액·같은 거래 반복 셈 없음', () => {
    let s = phoneRound(6);
    s = atBusanWith(s, 1, [lot('chip', 3, 'BUS')]);
    const before = player(s, 1);
    const r = act(s, 1, { type: 'depositPart', good: 'chip', qty: 2 });
    expect(ackOf(r)?.ok).toBe(true);
    s = r.snapshot;
    const p = player(s, 1);
    expect(p.game.money - before.game.money).toBe(Math.round(goodsById.chip.V * 1.2) * 2);
    expect(p.game.metrics.coop - before.game.metrics.coop).toBe(4);
    expect(p.game.cargo.find((l) => l.good === 'chip')?.qty).toBe(1);
    expect(p.game.metrics.exports).toBe(before.game.metrics.exports);
    expect(p.game.log.at(-1)).toMatchObject({ kind: 'deposit', good: 'chip', qty: 2 });
    expect(p.game.missions['M-PHONE']?.status).toBe('done');
    expect(JSON.stringify(p.game.fairTrade)).toBe(JSON.stringify(before.game.fairTrade));
    expect(s.class.phone!.parts.chip!.have).toBe(2);
    expect(helperLine('smartphonePart', { cls: s.class, player: p })).toBe('내 부품: 반도체(부산에서 가져옴) · 넣은 수량 2');
  });

  it('오류: 부산이 아님 · 부품이 없음 · 다 모임 · 부품이 아님', () => {
    let s = phoneRound(6);
    s = editPlayer(s, 1, (p) => {
      p.game.port = 'SHA';
      p.game.cargo = [lot('chip', 3, 'BUS')];
    });
    expect(ackOf(act(s, 1, { type: 'depositPart', good: 'chip', qty: 1 }))?.error).toBe('NOT_AT_BUSAN');
    s = atBusanWith(s, 1, []);
    expect(ackOf(act(s, 1, { type: 'depositPart', good: 'chip', qty: 1 }))?.error).toBe('NO_CARGO');
    s = atBusanWith(s, 1, [lot('crude', 1, 'DAM')]);
    expect(ackOf(act(s, 1, { type: 'depositPart', good: 'crude', qty: 1 }))?.error).toBe('NOT_A_PART');
    // 반도체 필요 2: 3상자를 넣으면 2상자만 들어가고 그 뒤는 '다 모였어요'
    s = atBusanWith(s, 1, [lot('chip', 3, 'BUS')]);
    s = act(s, 1, { type: 'depositPart', good: 'chip', qty: 3 }).snapshot;
    expect(s.class.phone!.parts.chip).toEqual({ need: 2, have: 2 });
    expect(player(s, 1).game.cargo.find((l) => l.good === 'chip')?.qty).toBe(1);
    expect(ackOf(act(s, 1, { type: 'depositPart', good: 'chip', qty: 1 }))?.error).toBe('PART_FULL');
  });

  it('다른 팀 부품: 협력 +5/상자, 학생 한 명 부품 협력 합계 최대 +20', () => {
    let s = phoneRound(1);
    // 1명 판: 모든 부품 필요 2 — 반도체 팀 학생이 다른 부품을 넣는다
    s = atBusanWith(s, 1, [lot('graphite', 2, 'SHA'), lot('nickel', 2, 'JKT'), lot('chem', 2, 'YOK')]);
    const c0 = player(s, 1).game.metrics.coop;
    s = act(s, 1, { type: 'depositPart', good: 'graphite', qty: 2 }).snapshot;
    expect(player(s, 1).game.metrics.coop - c0).toBe(10);
    s = act(s, 1, { type: 'depositPart', good: 'nickel', qty: 2 }, 2).snapshot;
    expect(player(s, 1).game.metrics.coop - c0).toBe(20);
    s = act(s, 1, { type: 'depositPart', good: 'chem', qty: 2 }, 3).snapshot;
    expect(player(s, 1).game.metrics.coop - c0).toBe(20);
    expect(player(s, 1).game.phone?.coop).toBe(20);
  });

  it('프로그램은 계약에서, 배터리는 공장에서 만든 것(가져온 곳 부산)', () => {
    let s = phoneRound(4);
    // 4번 = 프로그램 팀, 2번 = 배터리 팀
    s = atBusanWith(s, 4, [], [{ good: 'program', qty: 2, unitCost: 60, origin: 'foreign', source: 'specialty', boughtAt: 'LAX' }]);
    s = act(s, 4, { type: 'depositPart', good: 'program', qty: 2 }).snapshot;
    expect(player(s, 4).game.contracts).toEqual([]);
    expect(player(s, 4).game.phone?.fromPort).toBe('LAX');
    s = atBusanWith(s, 2, [lot('graphite', 1, 'SHA'), lot('nickel', 1, 'JKT'), lot('chem', 1, 'YOK')]);
    s = act(s, 2, { type: 'produce', recipe: 'battery', qty: 1 }).snapshot;
    expect(player(s, 2).game.missions['M-PHONE']?.steps[0]).toBe(true);
    s = act(s, 2, { type: 'depositPart', good: 'battery', qty: 1 }, 2).snapshot;
    expect(player(s, 2).game.phone?.fromPort).toBe('BUS');
    expect(s.class.phone!.parts.battery!.have).toBe(1);
  });

  it('모든 부품이 모이면 그 순간 모두 협력 +20·자금 +50만 원(한 번만), 그 뒤는 넣을 수 없음', () => {
    let s = phoneRound(2);
    const all: Player['game']['cargo'] = PHONE_PARTS.filter((g) => g !== 'program').map((g) => lot(g, 2, g === 'chip' ? 'BUS' : 'SHA', g === 'battery' ? 'factory' : 'specialty'));
    s = atBusanWith(s, 1, all, [{ good: 'program', qty: 3, unitCost: 60, origin: 'foreign', source: 'specialty', boughtAt: 'LAX' }]);
    const m2 = player(s, 2).game.money;
    const c2 = player(s, 2).game.metrics.coop;
    let seq = 1;
    for (const g of PHONE_PARTS) s = act(s, 1, { type: 'depositPart', good: g, qty: 2 }, seq++).snapshot;
    expect(s.class.phone!.completedRound).toBe(1);
    expect(player(s, 2).game.money - m2).toBe(50);
    expect(player(s, 2).game.metrics.coop - c2).toBe(20);
    expect(publicPayload(s).public.phone?.complete).toBe(true);
    expect(ackOf(act(s, 1, { type: 'depositPart', good: 'program', qty: 1 }, seq))?.error).toBe('PHONE_DONE');
    // 공개 상태: 회사 이름만(출석번호·자금 없음)
    const pub = JSON.stringify(publicPayload(s).public.phone);
    expect(pub).toContain('해오름1');
    expect(pub).not.toMatch(/seat|money/);
  });
});

describe('한 학생 한 부품 2상자 한도(검증 반영 — 반도체 사서 넣기 구멍)', () => {
  it('우리 팀 부품도 2상자까지: 25명 판 반도체 팀 1번이 10상자를 가져와도 2상자만 들어가고, 남는 돈은 2 × (보상 − 산 값)뿐', () => {
    let s = phoneRound(25);
    s = editPlayer(s, 1, (p) => (p.game.money = 2000));
    s = editPlayer(s, 1, (p) => (p.game.port = 'BUS'));
    const before = player(s, 1).game.money;
    s = act(s, 1, { type: 'buy', good: 'chip', qty: 5 }).snapshot;
    const paid = before - player(s, 1).game.money;
    s = act(s, 1, { type: 'depositPart', good: 'chip', qty: 5 }, 2).snapshot;
    expect(s.class.phone!.parts.chip!.have).toBe(2);
    expect(player(s, 1).game.cargo.find((l) => l.good === 'chip')?.qty).toBe(3);
    expect(ackOf(act(s, 1, { type: 'depositPart', good: 'chip', qty: 1 }, 3))?.error).toBe('PART_CAP');
    // 넣은 2상자 보상(2 × 180) − 산 값(2상자 몫)
    const unit = paid / 5;
    expect(player(s, 1).game.money - (before - paid)).toBe(2 * Math.round(goodsById.chip.V * 1.2));
    expect(2 * Math.round(goodsById.chip.V * 1.2) - 2 * unit).toBeLessThanOrEqual(2 * 90);
  });

  it('다른 팀 부품도 한 부품에 2상자까지, 다른 학생은 따로 2상자', () => {
    let s = phoneRound(25);
    s = atBusanWith(s, 1, [lot('graphite', 5, 'SHA')]);
    s = atBusanWith(s, 2, [lot('graphite', 5, 'SHA')]);
    s = act(s, 1, { type: 'depositPart', good: 'graphite', qty: 5 }).snapshot;
    s = act(s, 2, { type: 'depositPart', good: 'graphite', qty: 5 }).snapshot;
    expect(s.class.phone!.parts.graphite!.have).toBe(4);
    expect(player(s, 1).game.phone?.deposited.graphite).toBe(2);
    expect(ackOf(act(s, 1, { type: 'depositPart', good: 'graphite', qty: 1 }, 2))?.error).toBe('PART_CAP');
  });
});

describe('경제 게이지(p.107)', () => {
  it('4칸: 100·200·400·600만 원', () => {
    expect([0, 99, 100, 199, 200, 399, 400, 599, 600, 900].map(econGaugeStep)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });

  it('3차시 [수출] 판매액 ÷ 회사 수 — 앞 시간 판은 게이지 없음', () => {
    let s = l3(2, 'back');
    s = editPlayer(s, 1, (p) => p.game.log.push({ round: 1, stage: 'L3', kind: 'sell', good: 'chip', qty: 2, port: 'SHA', amount: 500, stamp: 'export' }));
    s = editPlayer(s, 2, (p) => p.game.log.push({ round: 1, stage: 'L3', kind: 'sell', good: 'crude', qty: 2, port: 'BUS', amount: 300, stamp: 'import' }));
    expect(econGauge(s.class, Object.values(s.players))).toEqual({ avg: 250, step: 2 });
    expect(aggregate(s.class, s.players).econGauge).toEqual({ avg: 250, step: 2 });
    expect(aggregate(l3(2, 'front').class, l3(2, 'front').players).econGauge).toBeUndefined();
  });
});

describe('L3-E3 생성형 인공지능 기술 경쟁', () => {
  it('상위 30%(동점 포함, 최소 3명, 0원 제외) → AI 반도체, 나머지 반도체 −10% 2라운드, won 기록(⑪)', () => {
    let s = l3(10, 'back');
    s = teach(s, { type: 'fireEvent', id: 'L3-E3' });
    const invests = [300, 300, 200, 200, 200, 100, 100, 0, 0, 0];
    invests.forEach((v, i) => {
      // 결정 카드 모양({ choice })도 받는다
      s = act(s, i + 1, { type: 'respondEvent', eventId: 'L3-E3', response: i % 2 ? { invest: v } : { choice: String(v) } }).snapshot;
    });
    expect(player(s, 1).game.responses['L3-E3']).toEqual({ invest: 300, choice: '300' });
    s = teach(s, { type: 'closeEvent' });
    const won = invests.map((_, i) => player(s, i + 1).game.unlockedRecipes.includes('aichip'));
    expect(won).toEqual([true, true, true, true, true, false, false, false, false, false]);
    expect((player(s, 3).game.responses['L3-E3'] as { won: boolean }).won).toBe(true);
    expect((player(s, 6).game.responses['L3-E3'] as { won: boolean }).won).toBe(false);
    expect(player(s, 8).game.effects.chipPenaltyUntilRound).toBe(s.class.round + 2);
    expect(player(s, 1).game.effects.chipPenaltyUntilRound).toBeNull();
    expect(helperLine('competitionRecord', { cls: s.class, player: player(s, 1) })).toContain('AI 반도체 얻음');
    expect(player(s, 1).game.metrics.dex).toContain('competition-tech');
  });

  it('응답하지 않은 학생은 응답 없음(0원·won false)', () => {
    let s = l3(3, 'back');
    s = teach(s, { type: 'fireEvent', id: 'L3-E3' });
    s = teach(s, { type: 'closeEvent' });
    expect(player(s, 1).game.responses['L3-E3']).toEqual({ invest: 0, choice: '0', won: false, noResponse: true });
  });
});

describe('L3-E4 부산 자동화 항만 투표', () => {
  function voted(votes: ('yes' | 'no' | null)[], tweak?: (s: HostSnapshot) => HostSnapshot): HostSnapshot {
    let s = l3(votes.length, 'back');
    if (tweak) s = tweak(s);
    s = teach(s, { type: 'fireEvent', id: 'L3-E4' });
    votes.forEach((v, i) => {
      if (v) s = act(s, i + 1, { type: 'respondEvent', eventId: 'L3-E4', response: { vote: v } }).snapshot;
    });
    return teach(s, { type: 'closeEvent' });
  }

  it('과반 찬성: 모두 50만 원, 부산 한도 +50%', () => {
    const base = l3(3, 'back');
    const s = voted(['yes', 'yes', 'no']);
    expect(s.class.votes['L3-E4']?.result).toBe('yes');
    for (const k of [1, 2, 3]) expect(player(s, k).game.money).toBe(player(base, k).game.money - 50);
    const q = quote(s.class, player(s, 1), 'BUS', 'crude');
    expect(q.sellLimit).toBe(Math.floor(quote(base.class, player(base, 1), 'BUS', 'crude').sellLimit * 1.5));
    expect(q.buyLimit).toBe(Math.floor(quote(base.class, player(base, 1), 'BUS', 'crude').buyLimit * 1.5));
    expect(player(s, 1).game.metrics.dex).toContain('competition-env');
  });

  it('동점이면 만들지 않음(돈·한도 그대로)', () => {
    const base = l3(2, 'back');
    const s = voted(['yes', 'no']);
    expect(s.class.votes['L3-E4']?.result).toBe('no');
    expect(player(s, 1).game.money).toBe(player(base, 1).game.money);
    expect(s.class.activeEffects.some((e) => e.id === 'autoPort')).toBe(false);
  });

  it('자유 항해: 낼 운항비를 뺀 쓸 수 있는 돈 기준(모자라면 가진 만큼, 음수 금지)', () => {
    const s = voted(['yes', 'yes'], (x) =>
      editPlayer(editPlayer(x, 1, (p) => { p.game.money = 60; p.game.fareDue = 30; }), 2, (p) => { p.game.money = 10; p.game.fareDue = 30; }));
    expect(player(s, 1).game.money).toBe(30);
    expect(player(s, 2).game.money).toBe(10);
  });

  it('투표 공개 상태: 표 수만(누가 어디에 투표했는지 없음)', () => {
    const s = voted(['yes', 'no', 'yes']);
    const v = publicPayload(s).public.vote;
    expect(v).toEqual({ id: 'L3-E4', counts: { yes: 2, no: 1 }, revealed: true, result: 'yes' });
  });
});

describe('나눠 고르기 효과가 새지 않는다', () => {
  it('앞 시간: AI 반도체가 시장에 보이지 않는다 / 뒤 시간·두 시간 모두는 보인다', () => {
    expect(visibleGoods(l3(1, 'front').class)).not.toContain('aichip');
    expect(visibleGoods(l3(1, 'back').class)).toContain('aichip');
    expect(visibleGoods(l3(1, 'all').class)).toContain('aichip');
  });

  it('앞 시간 L3-E5(스마트폰 결과)는 수출 증가 카드를 주지 않고, 뒤 시간 L3-E5(게이지)는 준다', () => {
    let f = l3(1, 'front');
    f = teach(f, { type: 'fireEvent', id: 'L3-E5' });
    expect(player(f, 1).game.metrics.dex).not.toContain('export-growth');
    let b = l3(1, 'back');
    b = teach(b, { type: 'fireEvent', id: 'L3-E5' });
    expect(player(b, 1).game.metrics.dex).toContain('export-growth');
  });
});

// ─── 배치(차시 한 판 L3 × 앞·뒤·두 시간 모두 × 15~40분) ───────────────

const PART_EVENTS: Record<LessonPart, { must: string[]; never: string[]; ws: string[]; noWs: string[] }> = {
  front: { must: ['L3-COVER', 'L3-E1'], never: ['L3-E3', 'L3-E4', 'L3-E6'], ws: ['W09', 'W10'], noWs: ['W11', 'W12'] },
  back: { must: ['L3-COVER', 'L3-E3'], never: ['L3-E1', 'L3-E2'], ws: ['W11', 'W12'], noWs: ['W09', 'W10'] },
  all: { must: ['L3-COVER', 'L3-E1', 'L3-E3'], never: [], ws: ['W09', 'W10', 'W11', 'W12'], noWs: [] },
};

describe('차시 L3 배치', () => {
  for (const part of ['front', 'back', 'all'] as const) {
    for (const T of [15, 20, 25, 30, 40]) {
      it(`${part} ${T}분: 끝 ≤ T, 1등급 누락 0, 그 시간 학습지 누락 0, 다른 시간 활동·학습지 0, L3-E6 카드만`, () => {
        const s = buildSchedule({ playUnit: 'lesson', scope: ['L3'], tradeMinutes: T, lessonPart: part });
        const live = s.items.filter((it) => it.form !== 'dropped');
        expect(Math.max(...live.map((it) => it.at + it.durSec))).toBeLessThanOrEqual(T * 60);
        const exp = PART_EVENTS[part];
        for (const id of exp.must) expect(live.some((it) => it.refId === id), id).toBe(true);
        for (const id of exp.never) expect(s.items.some((it) => it.refId === id), id).toBe(false);
        for (const id of exp.never) expect(s.activities.some((a) => a.id === id), `미리보기 ${id}`).toBe(false);
        const placed = new Set<string>([...live.filter((it) => it.kind === 'worksheet').flatMap((it) => it.refIds ?? [it.refId]), ...s.wrapup.flatMap((w) => w.worksheetIds)]);
        for (const w of exp.ws) expect(placed.has(w), w).toBe(true);
        for (const w of exp.noWs) expect(placed.has(w), w).toBe(false);
        const e6 = s.items.find((it) => it.refId === 'L3-E6');
        if (part !== 'front') expect(e6?.form, 'L3-E6').toBe('short');
        // 교사가 정하지 않았으므로 '교사가 정함' 표시 없음
        expect(e6?.pinned).toBeUndefined();
      });
    }
  }

  it('규칙 표: 앞·뒤 시간에 빠지는 것, 2차시 규칙 그대로, 차시 한 판이 아니면 null', () => {
    expect(lessonPartRules('lesson', ['L3'], 'front')).toMatchObject({ lesson: 'L3', dropEvents: ['L3-E3', 'L3-E4', 'L3-E6'], dropWorksheets: ['W11', 'W12'], econGauge: 'none', hideGoods: ['aichip'] });
    expect(lessonPartRules('lesson', ['L3'], 'back')).toMatchObject({ dropEvents: ['L3-E1', 'L3-E2'], dropWorksheets: ['W09', 'W10'], econGauge: 'stageEnd', forceShort: ['L3-E5', 'L3-E6'] });
    expect(lessonPartRules('lesson', ['L3'], 'all')).toMatchObject({ dropEvents: [], forceShort: ['L3-E6'], econGauge: 'withPhone' });
    expect(lessonPartRules('unit', ['L1', 'L2', 'L3', 'L4'], 'front')).toBeNull();
    expect(lessonPartRules('custom', ['L3', 'L4'], 'back')).toBeNull();
    expect(lessonPartRules('lesson', ['L2'], 'front')?.lesson).toBe('L2');
  });

  it('단원 한 판의 L3는 그대로: 확인 퀴즈(L3-E6 전체 형태 가능)·경쟁 카드 고정 없음', () => {
    const s = buildSchedule({ playUnit: 'unit', scope: ['L1', 'L2', 'L3', 'L4'], tradeMinutes: 80 });
    expect(s.activities.find((a) => a.id === 'L3-E6')?.form).not.toBe('short');
  });
});

describe('같은 라운드에 열리는 활동(두 시간 모두 짧은 판)', () => {
  it('스마트폰 시작(L3-E2 임무)은 열려 있는 광물 협력 결정 패널(L3-E1 짧게)을 닫지 않는다', () => {
    let s = l3(2);
    s = teach(s, { type: 'startRound' });
    s = teach(s, { type: 'fireEvent', id: 'L3-E1', short: true });
    s = teach(s, { type: 'fireEvent', id: 'L3-E2' });
    expect(s.class.currentEvent).toMatchObject({ id: 'L3-E1', closed: false });
    expect(s.class.firedEvents).toContain('L3-E2');
    expect(s.class.phone).toBeTruthy();
    expect(player(s, 1).game.missions['M-PHONE']).toBeDefined();
    // 결정은 그대로 받을 수 있다
    const r = act(s, 1, { type: 'respondEvent', eventId: 'L3-E1', response: { choice: 'join' } });
    expect(ackOf(r)?.ok).toBe(true);
  });

  it('1차시 첫 출항 임무(L1-E6)는 예전처럼 열린 결정을 닫는다', () => {
    let s = makeSession({ n: 1, scope: ['L1'] });
    s = teach(s, { type: 'startRound' });
    s = teach(s, { type: 'fireEvent', id: 'L1-E7' });
    s = teach(s, { type: 'fireEvent', id: 'L1-E6' });
    expect(s.class.currentEvent?.id).toBe('L1-E6');
  });
});

describe('경쟁 세 가지 카드(L3-E6 짧은 형태 = 카드만)', () => {
  it('확인 퀴즈 문항을 받지 않고, 카드 확인이 응답이며, 시설 건설 경쟁 카드를 준다', () => {
    let s = l3(1, 'back');
    s = teach(s, { type: 'fireEvent', id: 'L3-E6', short: true });
    expect(ackOf(act(s, 1, { type: 'answerCheckQuiz', qid: 'CQ-L3-1', answer: 0 }))?.error).toBe('CLOSED');
    expect(player(s, 1).game.metrics.dex).toContain('competition-facility');
    expect(publicPayload(s).public.event).toMatchObject({ id: 'L3-E6', responded: 0, total: 1 });
    s = act(s, 1, { type: 'respondEvent', eventId: 'L3-E6', response: { seen: true } }).snapshot;
    expect(publicPayload(s).public.event).toMatchObject({ id: 'L3-E6', responded: 1, total: 1 });
    // 결과 화면(정답률)이 없다 — 마감해도 결과 시간을 두지 않는다
    s = teach(s, { type: 'closeEvent' });
    expect(s.class.currentEvent?.resultUntil).toBeUndefined();
  });
});

describe('판 설정 안내(검증 반영): 두 시간 모두 판의 스마트폰 전체 형태 시간', () => {
  it('30분은 짧은 형태, 40분은 전체 형태 — 안내 값은 "그 분 이상이면 늘 전체 형태"인 가장 짧은 시간', async () => {
    const { phoneFullMinutes } = await import('../../src/teacher/setup');
    const formAt = (m: number) => buildSchedule({ playUnit: 'lesson', scope: ['L3'], tradeMinutes: m, lessonPart: 'all' }).activities.find((a) => a.id === 'L3-E5')!.form;
    expect(formAt(30)).toBe('short');
    expect(formAt(40)).toBe('full');
    const n = phoneFullMinutes('all')!;
    expect(n).toBeGreaterThan(30);
    expect(n).toBeLessThanOrEqual(40);
    for (let m = n; m <= 50; m++) expect(formAt(m), `${m}분`).toBe('full');
    expect(formAt(n - 1)).not.toBe('full');
  });
});
