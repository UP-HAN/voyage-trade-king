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
import { lessonPartRules, coverTextFor, type LessonPart } from '../../src/data/lessonParts';
import { eventsById } from '../../src/data/events';
import { letterBank } from '../../src/data/letters';
import { player, startFirstRound, teach } from './helpers';

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
  it('앞 시간 판: L2-E5 없음, 중계 임무·도감 relay 없음', () => {
    const s = l2Free('front');
    const r = applyAction(s.class, player(s, 1), { type: 'sailTo', port: 'SIN' });
    expect(r.error).toBeUndefined();
    expect(r.player.game.port).toBe('SIN');
    expect(r.events).not.toContainEqual({ type: 'eventTriggered', id: 'L2-E5' });
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

  it('두 시간 모두·단원 한 판은 거르지 않는다', () => {
    expect(letterDropOf(l2Session('all', 0).class)).toBeUndefined();
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
