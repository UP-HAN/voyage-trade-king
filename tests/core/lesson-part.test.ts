/**
 * 작업 154 — 2차시 나눠 고르기(PRD 4.1.1 v0.3.9) core: 설정 기본값·복원·바꿀 수 없음, 첫 입항 사건, 처음 화물, 편지 은행.
 * 배치표 쪽은 tests/core/schedule.test.ts 끝 describe.
 */
import { describe, expect, it } from 'vitest';
import { buildSchedule, hostReduce, startSession } from '../../src/core';
import { assignDeliveredLetters, letterDropOf, letterForSlot, letterSlots, mailbox } from '../../src/core/letters';
import { applyAction } from '../../src/core/rules';
import { createPlayer, normalizeClass } from '../../src/core/state';
import type { ClassState, HostSnapshot } from '../../src/core/types';
import { lessonPartRules, coverTextFor, portsHeldBack, SINGAPORE_OPEN_AFTER, type LessonPart } from '../../src/data/lessonParts';
import type { WorksheetId } from '../../src/data/types';
import { resolveRounds } from '../../src/core/voyage';
import { eventsById } from '../../src/data/events';
import { letterBank } from '../../src/data/letters';
import { editPlayer, player, startFirstRound, teach } from './helpers';

/** 차시 한 판 2차시 판(나눠 고르기 값을 판을 만들 때 넣고, 학생 n명 입장) */
function l2Session(part: LessonPart, n = 1): HostSnapshot {
  let snap = startSession({ code: '482137', playUnit: 'lesson', scope: ['L2'], seed: 12345, now: 0, hostToken: 'host-token', settings: { lessonPart: part } });
  for (let seat = 1; seat <= n; seat++) {
    snap = hostReduce(snap, { type: 'join', seat, pid: `p${seat}`, deviceToken: `d${seat}`, companyName: `해오름${seat}`, nameKey: `해오름${seat}` }, 0).snapshot;
  }
  return snap;
}

/** 표지(공장·항구 열림) → 라운드 1, 자유 항해 */
function l2Free(part: LessonPart): HostSnapshot {
  let s = l2Session(part);
  s = teach(s, { type: 'updateSettings', settings: { voyageMode: 'free' } }, 0);
  s = teach(s, { type: 'startStage', stage: 'L2' });
  s = teach(s, { type: 'closeEvent' });
  return startFirstRound(s);
}

describe('설정 lessonPart(v0.3.9)', () => {
  it("규칙 엔진 기본 'all', 판을 만들 때 넣은 값, 옛 판·틀린 값은 'all'", () => {
    expect(startSession({ code: '1', playUnit: 'lesson', scope: ['L2'], seed: 1, now: 0 }).class.settings.lessonPart).toBe('all');
    expect(l2Session('front', 0).class.settings.lessonPart).toBe('front');
    const raw = JSON.parse(JSON.stringify(l2Session('back', 0).class)) as Record<string, Record<string, unknown>>;
    expect(normalizeClass(raw).settings.lessonPart).toBe('back');
    delete raw.settings!.lessonPart;
    expect(normalizeClass(raw).settings.lessonPart).toBe('all');
    raw.settings!.lessonPart = 'middle';
    expect(normalizeClass(raw).settings.lessonPart).toBe('all');
  });

  it('updateSettings 로는 바꿀 수 없다', () => {
    const s = teach(l2Session('front', 0), { type: 'updateSettings', settings: { lessonPart: 'back' } as never }, 0);
    expect(s.class.settings.lessonPart).toBe('front');
  });

  it('규칙은 차시 한 판 + [L2]만', () => {
    expect(lessonPartRules('lesson', ['L2'], 'front')?.dropEvents).toEqual(['L2-E4', 'L2-E5', 'L2-E7']);
    expect(lessonPartRules('lesson', ['L2'], undefined)?.part).toBe('all');
    expect(lessonPartRules('unit', ['L1', 'L2', 'L3', 'L4'], 'front')).toBeNull();
    expect(lessonPartRules('custom', ['L2'], 'front')).toBeNull();
    expect(lessonPartRules('lesson', ['L3'], 'back')).toBeNull();
  });

  it('표지 덮어쓰기: 앞 시간·뒤 시간 제목, 두 시간 모두·단원 한 판은 그대로', () => {
    const def = eventsById['L2-E1']!;
    const base = { playUnit: 'lesson', scope: ['L2'] as const };
    expect(coverTextFor(def, { ...base, lessonPart: 'front' }).title).toBe('L2. 자원을 사 와서 만들어 팔아요');
    // (작업 167) 앞 시간은 싱가포르가 잠겨 5곳, 원래 글(두 시간 모두·단원 한 판)은 숫자 없이
    expect(coverTextFor(def, { ...base, lessonPart: 'front' }).body).toBe('새 항구 5곳이 열렸어요. 자원을 사 와서 공장에서 만들어 파는 무역을 해 봐요.');
    expect(coverTextFor(def, { ...base, lessonPart: 'all' }).body).toBe('새 항구들이 열렸어요. 자원을 사 와서 공장에서 만들어 파는 무역을 해 봐요.');
    expect(coverTextFor(def, { ...base, lessonPart: 'back' })).toMatchObject({
      title: 'L2. 세계의 다양한 무역',
      body: '새 항구 6곳이 열렸어요. 나라마다 무엇을 많이 수출하는지 항해하며 알아봐요. 싱가포르에도 들러 보세요.',
      teacherPrompts: ['나라마다 수출하는 것이 다른 까닭은 무엇일까요?'],
    });
    expect(coverTextFor(def, { ...base, lessonPart: 'all' }).title).toBe(def.title);
    expect(coverTextFor(def, { playUnit: 'unit', scope: ['L1', 'L2', 'L3', 'L4'], lessonPart: 'front' }).title).toBe(def.title);
    expect(coverTextFor(eventsById['L2-E2']!, { ...base, lessonPart: 'front' }).title).toBe(eventsById['L2-E2']!.title);
  });
});

describe('싱가포르 첫 입항(arrive, v0.3.9)', () => {
  // (작업 167) 앞 시간 판은 싱가포르가 끝까지 잠겨 있어 들어갈 수조차 없다(예전: 들어가도 L2-E5 없음)
  it('앞 시간 판: 싱가포르로 못 감(PORT_LOCKED) — L2-E5·중계 임무·도감 relay 없음', () => {
    const s = l2Free('front');
    const r = applyAction(s.class, player(s, 1), { type: 'sailTo', port: 'SIN' });
    expect(r.error).toBe('PORT_LOCKED');
    expect(r.player.game.port).not.toBe('SIN');
    expect(r.player.game.missions['M-RELAY']).toBeUndefined();
    expect(r.player.game.metrics.dex).not.toContain('relay');
    expect(r.player.game.responses['L2-E5']).toBeUndefined();
  });

  it('뒤 시간 판: L2-E5 있음, 중계 임무 받음', () => {
    const s = l2Free('back');
    const r = applyAction(s.class, player(s, 1), { type: 'sailTo', port: 'SIN' });
    expect(r.events).toContainEqual({ type: 'eventTriggered', id: 'L2-E5' });
    expect(r.player.game.missions['M-RELAY']).toBeDefined();
    expect(r.player.game.metrics.dex).toContain('relay');
  });
});

describe('처음 화물(createPlayer, v0.3.9)', () => {
  it('뒤 시간: 화물 0·startCargo 기록 없음, 돈 그대로 / 앞 시간: 원유 2상자', () => {
    const back = player(l2Session('back'), 1);
    const front = player(l2Session('front'), 1);
    const all = player(l2Session('all'), 1);
    expect(back.game.cargo).toEqual([]);
    expect(back.game.log.some((e) => e.ref === 'startCargo')).toBe(false);
    expect(back.game.money).toBe(front.game.money);
    expect(front.game.cargo).toEqual([expect.objectContaining({ good: 'crude', qty: 2, boughtAt: 'DAM' })]);
    expect(front.game.log.some((e) => e.ref === 'startCargo')).toBe(true);
    expect(all.game.cargo).toHaveLength(1);
  });
});

describe('편지 은행(v0.3.9)', () => {
  const FRONT_DROP = ['L2-03', 'L2-06', 'L2-07', 'L2-08'];
  const BACK_DROP = ['L2-01', 'L2-02', 'L2-05'];

  it('letterBank 가 문항을 거른다', () => {
    for (const d of ['easy', 'normal'] as const) {
      const ids = letterBank('L2', d, FRONT_DROP).map((q) => q.id);
      for (const x of FRONT_DROP) expect(ids).not.toContain(x);
      expect(letterBank('L2', d).length - ids.length).toBe(letterBank('L2', d).filter((q) => FRONT_DROP.includes(q.id)).length);
    }
  });

  function withSchedule(part: LessonPart, n: number, minutes = 40): { cs: ClassState; s: HostSnapshot } {
    const s = l2Session(part, n);
    const sch = buildSchedule({ playUnit: 'lesson', scope: ['L2'], tradeMinutes: minutes, lessonPart: part });
    const items = sch.items.map((it) => ({ ...it, status: 'pending' as const }));
    const cs: ClassState = { ...s.class, schedule: { ...s.class.schedule, items } };
    const slots = letterSlots(cs);
    return { s, cs: { ...cs, round: 99, letters: { ...cs.letters, delivered: slots.map((x) => x.slotId) } } };
  }

  it.each([
    ['front', FRONT_DROP],
    ['back', BACK_DROP],
    // (작업 167) 두 시간 모두도 싱가포르·4유형·박람회 편지를 뺀다(⑥ 뒤에야 열리고 그 뒤 라운드가 없음)
    ['all', FRONT_DROP],
  ] as const)('%s 판 40분: 배달·편지함 문항에 빠진 번호가 없고, 모든 슬롯에 문항이 있다(좌석 1~30)', (part, drop) => {
    const { cs, s } = withSchedule(part, 30);
    expect(letterDropOf(cs)).toEqual(drop);
    const slots = letterSlots(cs);
    expect(slots.length).toBeGreaterThan(5);
    for (let seat = 1; seat <= 30; seat++) {
      const p = JSON.parse(JSON.stringify(player(s, seat))) as typeof s.players[string];
      assignDeliveredLetters(cs, p);
      const ids = Object.values(p.game.letters.assigned);
      expect(ids).toHaveLength(slots.length);
      for (const x of drop) expect(ids, `seat ${seat}`).not.toContain(x);
      const box = mailbox(cs, p);
      for (const v of box) {
        expect(v.question).not.toBeNull();
        expect(drop).not.toContain(v.question!.id);
      }
    }
  });

  it('두 시간 모두는 앞 시간과 같은 4문항을 거르고, 단원 한 판은 거르지 않는다', () => {
    expect(letterDropOf(l2Session('all', 0).class)).toEqual(FRONT_DROP);
    const unit = startSession({ code: '1', playUnit: 'unit', scope: ['L1', 'L2', 'L3', 'L4'], seed: 1, now: 0, settings: { lessonPart: 'front' } });
    expect(letterDropOf(unit.class)).toBeUndefined();
  });

  it('letterForSlot 은 거른 은행으로 회전한다(앞 시간 판, L2 슬롯)', () => {
    const { cs, s } = withSchedule('front', 12);
    const slot = letterSlots(cs).find((x) => x.stage === 'L2')!;
    for (let seat = 1; seat <= 12; seat++) {
      const q = letterForSlot(player(s, seat), slot, [slot], letterDropOf(cs));
      expect(FRONT_DROP).not.toContain(q?.id);
    }
  });
});

// ─── 작업 167·168(v0.3.11): 싱가포르 늦게 열기 · 수출국 4유형 임무 시점 ───────────────
describe('싱가포르 열림 시점(작업 167)', () => {
  const W = (s: HostSnapshot, ids: WorksheetId[]) => teach(teach(s, { type: 'openWorksheet', ids }), { type: 'closeWorksheet' });
  const hasSin = (s: HostSnapshot) => s.class.openPorts.includes('SIN');

  it('portsHeldBack 표: 앞 시간·두 시간 모두 = [SIN], 뒤 시간·그 밖 판 = []', () => {
    expect(portsHeldBack(lessonPartRules('lesson', ['L2'], 'front'))).toEqual(['SIN']);
    expect(portsHeldBack(lessonPartRules('lesson', ['L2'], 'all'))).toEqual(['SIN']);
    expect(portsHeldBack(lessonPartRules('lesson', ['L2'], 'back'))).toEqual([]);
    expect(portsHeldBack(lessonPartRules('unit', ['L1', 'L2', 'L3', 'L4'], 'front'))).toEqual([]);
    expect(portsHeldBack(null)).toEqual([]);
    expect(SINGAPORE_OPEN_AFTER).toBe('W06');
  });

  it('앞 시간: 시작·표지 뒤 11곳(SIN 없음), ⑤·⑥ 팝업을 닫아도 끝까지 없음, 자유 항해 PORT_LOCKED·라운드 항해 portClosed', () => {
    let s = l2Session('front');
    expect(s.class.openPorts).toHaveLength(11);
    expect(hasSin(s)).toBe(false);
    s = teach(s, { type: 'startStage', stage: 'L2' });
    s = teach(s, { type: 'closeEvent' });
    expect(s.class.openPorts).toHaveLength(11);
    expect(hasSin(s)).toBe(false);
    s = W(W(s, ['W05']), ['W06']);
    expect(hasSin(s)).toBe(false);
    expect(s.class.firedEvents).not.toContain('L2-E4');
    // 라운드 항해: 목적지 SIN → 그대로 머묾(portClosed)
    s = startFirstRound(s);
    s = editPlayer(s, 1, (p) => {
      p.game.dest = 'SIN';
      p.game.ready = true;
    });
    const rr = resolveRounds({ ...s.class, round: 1, phase: 'between' }, player(s, 1));
    expect(rr.player.game.port).not.toBe('SIN');
    expect(rr.events).toContainEqual(expect.objectContaining({ type: 'stayed', reason: 'portClosed' }));
    // 자유 항해
    const f = l2Free('front');
    expect(applyAction(f.class, player(f, 1), { type: 'sailTo', port: 'SIN' }).error).toBe('PORT_LOCKED');
  });

  it('두 시간 모두: 시작 SIN 없음 → ⑤ 닫기 뒤에도 없음 → ⑥ 닫는 순간 열림 + 수출국 4유형 임무(L2-E4) 시작', () => {
    let s = l2Session('all', 2);
    s = teach(s, { type: 'startStage', stage: 'L2' });
    s = teach(s, { type: 'closeEvent' });
    expect(hasSin(s)).toBe(false);
    expect(s.class.openPorts).toHaveLength(11);
    s = W(s, ['W05']);
    expect(hasSin(s)).toBe(false);
    expect(player(s, 1).game.missions['M-EXPORT4']).toBeUndefined();
    s = teach(s, { type: 'openWorksheet', ids: ['W06'] });
    expect(hasSin(s)).toBe(false); // 떠 있는 동안은 아직
    s = teach(s, { type: 'closeWorksheet' });
    expect(hasSin(s)).toBe(true);
    expect(s.class.openPorts).toHaveLength(12);
    expect(s.class.firedEvents).toContain('L2-E4');
    for (const seat of [1, 2]) expect(player(s, seat).game.missions['M-EXPORT4']?.status).toBe('active');
    // 지금 사건 카드는 바꾸지 않는다(비차단 임무 — 카드 없이 임무만)
    expect(s.class.currentEvent?.id).not.toBe('L2-E4');
    // 다시 ⑥을 열고 닫아도 한 번만
    const again = W(s, ['W06']);
    expect(again.class.openPorts.filter((x) => x === 'SIN')).toHaveLength(1);
    expect(again.class.firedEvents.filter((x) => x === 'L2-E4')).toHaveLength(1);
    // ⑥ 뒤에 들어온 학생도 따라잡기로 임무를 받는다
    const late = hostReduce(s, { type: 'join', seat: 3, pid: 'p3', deviceToken: 'd3', companyName: '해오름3', nameKey: '해오름3' }, 0).snapshot;
    expect(player(late, 3).game.missions['M-EXPORT4']?.status).toBe('active');
    // ⑥ 뒤 싱가포르 첫 입항 = '싱가포르의 비밀' 카드 + 중계 임무
    let fr = teach(l2Session('all'), { type: 'updateSettings', settings: { voyageMode: 'free' } }, 0);
    fr = teach(teach(fr, { type: 'startStage', stage: 'L2' }), { type: 'closeEvent' });
    expect(applyAction(startFirstRound(fr).class, player(fr, 1), { type: 'sailTo', port: 'SIN' }).error).toBe('PORT_LOCKED');
    fr = startFirstRound(W(fr, ['W06']));
    const r = applyAction(fr.class, player(fr, 1), { type: 'sailTo', port: 'SIN' });
    expect(r.error).toBeUndefined();
    expect(r.events).toContainEqual({ type: 'eventTriggered', id: 'L2-E5' });
    expect(r.player.game.missions['M-RELAY']).toBeDefined();
    expect(r.player.game.metrics.dex).toContain('relay');
  });

  it('두 시간 모두: ⑥이 든 묶음 팝업(구간 끝에 모아서)·[모두 닫기]·다음 예약 팝업으로 넘어갈 때도 열림', () => {
    const base = teach(teach(l2Session('all'), { type: 'startStage', stage: 'L2' }), { type: 'closeEvent' });
    expect(hasSin(W(base, ['W05', 'W06', 'W07', 'W08']))).toBe(true);
    const allClose = teach(teach(base, { type: 'openWorksheet', ids: ['W06'] }), { type: 'closeWorksheet', all: true });
    expect(hasSin(allClose)).toBe(true);
    // ⑥ 위에 ⑦ 예약 → ⑥ 닫기 = ⑦로 넘어가며 열림
    let q = teach(base, { type: 'openWorksheet', ids: ['W06'] });
    q = teach(q, { type: 'openWorksheet', ids: ['W07'] });
    expect(q.class.worksheet.pending).toHaveLength(1);
    q = teach(q, { type: 'closeWorksheet' });
    expect(q.class.worksheet.current).toEqual(['W07']);
    expect(hasSin(q)).toBe(true);
    expect(q.class.firedEvents).toContain('L2-E4');
  });

  it('뒤 시간·단원 한 판(L2 시작 뒤)·3차시: 처음부터 SIN 열림(12곳)', () => {
    const back = teach(l2Session('back'), { type: 'startStage', stage: 'L2' });
    expect(back.class.openPorts).toHaveLength(12);
    let unit = startSession({ code: '1', playUnit: 'unit', scope: ['L1', 'L2', 'L3', 'L4'], seed: 1, now: 0, settings: { lessonPart: 'front' } });
    expect(unit.class.openPorts).not.toContain('SIN');
    unit = hostReduce(unit, { type: 'teacher', action: { type: 'startStage', stage: 'L2' } }, 0).snapshot;
    expect(unit.class.openPorts).toHaveLength(12);
    const l3 = startSession({ code: '1', playUnit: 'lesson', scope: ['L3'], seed: 1, now: 0 });
    expect(l3.class.openPorts).toContain('SIN');
  });
});

describe('앞 시간(15차시) 판에는 수출국 4유형·싱가포르가 어떤 경로로도 나오지 않는다(작업 167·168)', () => {
  it.each([15, 25, 30, 40])('%i분: 배치표에 L2-E4·L2-E5·⑦⑧ 없음, 편지 슬롯 모두 싱가포르·4유형·박람회 아님', (m) => {
    for (const ws of ['auto', 'each', 'stageEnd', 'after', 'off'] as const) {
      const sch = buildSchedule({ playUnit: 'lesson', scope: ['L2'], tradeMinutes: m, lessonPart: 'front', worksheetMode: ws });
      const refs = sch.items.flatMap((it) => [it.refId, ...(it.refIds ?? [])]);
      for (const x of ['L2-E4', 'L2-E5', 'L2-E7', 'W07', 'W08']) expect(refs, `${m}분 ${ws}`).not.toContain(x);
    }
    const s = l2Session('front', 30);
    const sch = buildSchedule({ playUnit: 'lesson', scope: ['L2'], tradeMinutes: m, lessonPart: 'front' });
    const cs: ClassState = { ...s.class, schedule: { ...s.class.schedule, items: sch.items }, round: 99 };
    const slots = letterSlots(cs);
    const full: ClassState = { ...cs, letters: { ...cs.letters, delivered: slots.map((x) => x.slotId) } };
    for (let seat = 1; seat <= 30; seat++) {
      const p = JSON.parse(JSON.stringify(player(s, seat))) as typeof s.players[string];
      assignDeliveredLetters(full, p);
      for (const id of Object.values(p.game.letters.assigned)) expect(['L2-03', 'L2-06', 'L2-07', 'L2-08']).not.toContain(id);
    }
  });

  it('판 끝까지(⑥ 닫기·무역 끝 포함) M-EXPORT4·M-RELAY 없음, 도감 relay 없음, SIN 잠김', () => {
    let s = l2Session('front', 2);
    s = teach(s, { type: 'startStage', stage: 'L2' });
    s = teach(s, { type: 'closeEvent' });
    s = teach(s, { type: 'fireEvent', id: 'L2-E3' });
    s = teach(s, { type: 'openWorksheet', ids: ['W06'] });
    s = teach(s, { type: 'closeWorksheet' });
    s = teach(s, { type: 'endTrade' });
    for (const seat of [1, 2]) {
      const g = player(s, seat).game;
      expect(Object.keys(g.missions).sort()).toEqual(['M-IPE']);
      expect(g.metrics.dex).not.toContain('relay');
    }
    expect(s.class.firedEvents).not.toContain('L2-E4');
    expect(s.class.firedEvents).not.toContain('L2-E5');
    expect(s.class.openPorts).not.toContain('SIN');
  });
});

describe('수출국 4유형 임무(L2-E4) 시점(작업 168)', () => {
  const at = (sch: ReturnType<typeof buildSchedule>, ref: string) => sch.items.find((it) => it.refId === ref && it.kind === 'event');
  const roundAt = (sch: ReturnType<typeof buildSchedule>, n: number) => sch.items.find((it) => it.kind === 'round' && it.round === n);

  it.each([10, 15, 25, 30, 40])('뒤 시간 %i분: L2-E4 = 라운드 3 시작(라운드 2개면 라운드 2 시작), L2-E5 = 라운드 1', (m) => {
    const sch = buildSchedule({ playUnit: 'lesson', scope: ['L2'], tradeMinutes: m, lessonPart: 'back' });
    const k = sch.totalRounds;
    expect(k).toBeGreaterThanOrEqual(2);
    expect(at(sch, 'L2-E4')!.at).toBe(roundAt(sch, Math.min(3, k))!.at);
    expect(at(sch, 'L2-E5')!.at).toBe(roundAt(sch, 1)!.at);
    // 4유형 편지(보통 난이도)는 라운드 3 전에 오지 않는다(S1 = 라운드 2 쉬움, S2 = 라운드 3부터)
    const s = l2Session('back');
    const slots = letterSlots({ ...s.class, schedule: { ...s.class.schedule, items: sch.items } });
    for (const sl of slots) if (sl.difficulty === 'normal') expect(sl.round).toBeGreaterThanOrEqual(Math.min(3, k));
  });

  it('뒤 시간 라운드 2개 판: L2-E4 = 라운드 2 시작, 1개 판: 라운드 부족으로 빠짐', () => {
    const two = buildSchedule({ playUnit: 'lesson', scope: ['L2'], tradeMinutes: 10, lessonPart: 'back', roundSecOverride: 200 } as never);
    expect(two.totalRounds).toBe(2);
    expect(at(two, 'L2-E4')!.at).toBe(roundAt(two, 2)!.at);
    const one = buildSchedule({ playUnit: 'lesson', scope: ['L2'], tradeMinutes: 10, lessonPart: 'back', roundSecOverride: 600 } as never);
    expect(one.totalRounds).toBe(1);
    expect(one.activities.find((a) => a.id === 'L2-E4')).toMatchObject({ form: 'dropped', reason: 'needsRounds' });
  });

  it.each([15, 25, 30, 40])('두 시간 모두 %i분: 배치표에 L2-E4·L2-E5 없음, L2-E3 = 라운드 1 시작, ⑥ 있음', (m) => {
    for (const ws of ['auto', 'each', 'stageEnd'] as const) {
      const sch = buildSchedule({ playUnit: 'lesson', scope: ['L2'], tradeMinutes: m, lessonPart: 'all', worksheetMode: ws });
      expect(at(sch, 'L2-E4'), `${m} ${ws}`).toBeUndefined();
      expect(at(sch, 'L2-E5'), `${m} ${ws}`).toBeUndefined();
      expect(at(sch, 'L2-E3')!.at).toBe(roundAt(sch, 1)!.at);
      expect(sch.items.some((it) => it.kind === 'worksheet' && (it.refIds ?? [it.refId]).includes('W06'))).toBe(true);
    }
  });

  it('앞 시간: L2-E3 = 라운드 1 시작, dropEvents 그대로', () => {
    const sch = buildSchedule({ playUnit: 'lesson', scope: ['L2'], tradeMinutes: 25, lessonPart: 'front' });
    expect(at(sch, 'L2-E3')!.at).toBe(roundAt(sch, 1)!.at);
    expect(lessonPartRules('lesson', ['L2'], 'front')?.dropEvents).toEqual(['L2-E4', 'L2-E5', 'L2-E7']);
  });

  it('단원 한 판 L2 구간은 그대로: L2-E3·L2-E4·L2-E5 = L2 구간 첫 라운드', () => {
    const sch = buildSchedule({ playUnit: 'unit', scope: ['L1', 'L2', 'L3', 'L4'], tradeMinutes: 40 });
    const first = sch.items.filter((it) => it.kind === 'round' && it.stage === 'L2').sort((a, b) => a.at - b.at)[0]!;
    for (const id of ['L2-E3', 'L2-E4', 'L2-E5']) {
      const it = at(sch, id)!;
      if (it.form !== 'dropped') expect(it.at, id).toBe(first.at);
    }
  });
});
