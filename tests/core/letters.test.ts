import { describe, expect, it } from 'vitest';
import { deliveredSlots, isSlotExpired, letterForSlot, letterSlots, mailbox, makeSlots } from '../../src/core/letters';
import { applyAction } from '../../src/core/rules';
import { createPlayer } from '../../src/core/state';
import type { ClassState, LetterSlotInfo } from '../../src/core/types';
import { letterRewards, rewardPattern, difficultyPattern, slotAt } from '../../src/data/letterSchedule';
import { lettersById } from '../../src/data/letters';
import type { LessonId } from '../../src/data/types';
import { act, makeSession, player, run, teach } from './helpers';

/** 슬롯 n개를 라운드 2부터 차례로(첫 라운드 제외) */
function slots(stage: LessonId | LessonId[], n: number): LetterSlotInfo[] {
  return makeSlots(Array.from({ length: n }, (_, i) => ({ stage: Array.isArray(stage) ? stage[i % stage.length] : stage, round: i + 2 })));
}

describe('편지 슬롯·회전 출제(PRD 6.7.4)', () => {
  it('보상·난이도는 letterSchedule 순환 패턴 그대로', () => {
    const list = slots('L1', 10);
    list.forEach((s, i) => {
      expect(s.reward).toBe(rewardPattern[i % rewardPattern.length]);
      expect(s.difficulty).toBe(difficultyPattern[i % difficultyPattern.length]);
      expect(s).toMatchObject({ slotId: slotAt(i).slotId });
    });
  });

  it('배치표의 letter 항목에서 슬롯을 만든다', () => {
    const s = makeSession({ n: 1, scope: ['L1', 'L2'], playUnit: 'unit' });
    const cls: ClassState = {
      ...s.class,
      schedule: {
        ...s.class.schedule,
        items: [
          { id: 'i1', kind: 'letter', refId: 'S1', stage: 'L1', at: 200, durSec: 0, form: 'full', status: 'pending', round: 2 },
          { id: 'i2', kind: 'letter', refId: 'S2', stage: 'L2', at: 600, durSec: 0, form: 'full', status: 'pending', round: 4 },
        ],
      },
    };
    expect(letterSlots(cls)).toEqual([
      { slotId: 'S1', index: 0, stage: 'L1', round: 2, reward: rewardPattern[0], difficulty: 'easy' },
      { slotId: 'S2', index: 1, stage: 'L2', round: 4, reward: rewardPattern[1], difficulty: 'normal' },
    ]);
  });

  it.each(['L1', 'L2', 'L3', 'L4'] as const)('%s 단독 판 10통: 좌석 1~40 모두 한 학생에게 중복 없음, 같은 슬롯 같은 난이도', (stage) => {
    const s = makeSession({ n: 0, scope: [stage] });
    const list = slots(stage, 10);
    for (let seat = 1; seat <= 40; seat++) {
      const p = createPlayer(s.meta, s.class, { seat, pid: `x${seat}`, deviceToken: 't', companyName: '회사', now: 0 });
      const ids = list.map((slot) => {
        const q = letterForSlot(p, slot, list);
        expect(q, `seat ${seat} ${slot.slotId}`).not.toBeNull();
        expect(q!.difficulty).toBe(slot.difficulty);
        expect([stage, 'common']).toContain(q!.lesson);
        return q!.id;
      });
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('단원 한 판(4구간 섞임, 공통 문항 공유)에서도 중복 없음', () => {
    const s = makeSession({ n: 0, scope: ['L1', 'L2', 'L3', 'L4'], playUnit: 'unit' });
    const list = slots(['L1', 'L1', 'L2', 'L2', 'L2', 'L3', 'L3', 'L3', 'L4', 'L4'], 10);
    for (let seat = 1; seat <= 40; seat++) {
      const p = createPlayer(s.meta, s.class, { seat, pid: `x${seat}`, deviceToken: 't', companyName: '회사', now: 0 });
      const ids = list.map((slot) => letterForSlot(p, slot, list)?.id);
      expect(ids.every(Boolean)).toBe(true);
      expect(new Set(ids).size).toBe(10);
    }
  });

  it('옆 번호 학생은 같은 슬롯에서 다른 문제를 받는다(베끼기 방지)', () => {
    const s = makeSession({ n: 0, scope: ['L1'] });
    const [slot] = slots('L1', 1);
    const q = (seat: number) =>
      letterForSlot(createPlayer(s.meta, s.class, { seat, pid: `x${seat}`, deviceToken: 't', companyName: '회사', now: 0 }), slot)!.id;
    expect(q(1)).not.toBe(q(2));
    expect(q(2)).not.toBe(q(3));
  });
});

describe('편지 도착·답·보상', () => {
  function withSlots(n: number) {
    let s = makeSession({ n: 3, scope: ['L1'] });
    s = { ...s, class: { ...s.class, letters: { ...s.class.letters, slots: slots('L1', n) } } };
    return s;
  }

  it('라운드 시작에 도착(첫 라운드 제외), 건너뛴 슬롯은 도착하지 않음', () => {
    let s = withSlots(3);
    s = teach(s, { type: 'startRound' });
    expect(s.class.letters.delivered).toEqual([]);
    s = teach(s, { type: 'endRound' });
    s = teach(s, { type: 'skipLetterSlot', slotId: 'S2' });
    s = teach(s, { type: 'startRound' });
    expect(s.class.letters.delivered).toEqual(['S1']);
    s = teach(s, { type: 'endRound' });
    s = teach(s, { type: 'startRound' });
    expect(deliveredSlots(s.class).map((x) => x.slotId)).toEqual(['S1']);
    s = teach(s, { type: 'endRound' });
    s = teach(s, { type: 'startRound' });
    expect(deliveredSlots(s.class).map((x) => x.slotId)).toEqual(['S1', 'S3']);
  });

  it('정답이면 슬롯 보상(데이터 값) 1회 + 무역 박사 +1, 같은 슬롯 다시 답할 수 없음', () => {
    let s = withSlots(1);
    s = teach(s, { type: 'startRound' });
    s = teach(s, { type: 'endRound' });
    s = teach(s, { type: 'startRound' });
    const p = player(s, 1);
    const slot = deliveredSlots(s.class)[0];
    expect(slot.reward).toBe('money');
    const q = letterForSlot(p, slot, deliveredSlots(s.class))!;
    const r = applyAction(s.class, p, { type: 'answerLetter', slotId: 'S1', answer: q.answer });
    expect(r.error).toBeUndefined();
    expect(r.player.game.money).toBe(p.game.money + letterRewards.money.money!);
    expect(r.player.game.metrics.quizRight).toBe(1);
    expect(r.player.game.letters.answered).toEqual([q.id]);
    const again = applyAction(s.class, r.player, { type: 'answerLetter', slotId: 'S1', answer: q.answer });
    expect(again.error).toBe('ANSWERED');
  });

  it('오답이면 보상·벌칙 없음', () => {
    let s = withSlots(1);
    s = { ...s, class: { ...s.class, round: 2, phase: 'round', letters: { ...s.class.letters, delivered: ['S1'] } } };
    const p = player(s, 2);
    const q = letterForSlot(p, deliveredSlots(s.class)[0])!;
    const wrong = q.type === 'ox' ? (q.answer === 'O' ? 'X' : 'O') : ((q.answer as number) + 1) % 3;
    const r = applyAction(s.class, p, { type: 'answerLetter', slotId: 'S1', answer: wrong });
    expect(r.player.game.money).toBe(p.game.money);
    expect(r.player.game.letters.slots.S1).toBe('wrong');
    expect(lettersById[q.id]).toBeDefined();
  });

  it('신속 통관·순풍·도감 카드 보상', () => {
    let s = withSlots(5);
    s = { ...s, class: { ...s.class, round: 6, phase: 'round', letters: { ...s.class.letters, delivered: ['S1', 'S2', 'S3', 'S4', 'S5'] } } };
    // 만료 판정을 피하려고 각 슬롯을 바로 다음 라운드에 답하는 대신, 만료되지 않은 마지막 두 슬롯 + 직접 확인
    const list = deliveredSlots(s.class);
    const p0 = player(s, 1);
    const answer = (slotId: string, round: number, p = p0) => {
      const cls = { ...s.class, round };
      const q = letterForSlot(p, list.find((x) => x.slotId === slotId)!, list)!;
      return applyAction(cls, p, { type: 'answerLetter', slotId, answer: q.answer });
    };
    const fc = answer('S2', 3); // fastCustoms
    expect(fc.player.game.effects.fastCustomsStage).toBe('L1');
    const tw = answer('S3', 4, fc.player); // tailwind
    expect(tw.player.game.effects.tailwind).toBe(1);
    const q5 = letterForSlot(tw.player, list[4], list)!;
    const dx = answer('S5', 6, tw.player); // dexCard
    expect(dx.player.game.metrics.dex).toContain(q5.dexCard);
  });
});

describe('편지 만료(PRD 6.7.2 v0.3)', () => {
  const base = makeSession({ n: 1, scope: ['L1'] });
  const list = makeSlots([
    { stage: 'L1', round: 2 },
    { stage: 'L1', round: 3 },
    { stage: 'L1', round: 6 },
  ]);
  const cls = (round: number, extra: Partial<ClassState> = {}): ClassState => ({
    ...base.class,
    round,
    phase: 'round',
    letters: { ...base.class.letters, slots: list, delivered: list.filter((x) => x.round <= round).map((x) => x.slotId) },
    ...extra,
  });

  it('다음 편지가 와도 최소 2라운드는 열 수 있다', () => {
    expect(isSlotExpired(cls(3), list[0])).toBe(false);
    expect(isSlotExpired(cls(4), list[0])).toBe(true);
  });

  it('2라운드가 지나도 다음 편지가 오기 전까지는 열 수 있다', () => {
    expect(isSlotExpired(cls(5), list[1])).toBe(false);
    expect(isSlotExpired(cls(6), list[1])).toBe(true);
  });

  it('마지막 편지는 무역 시간이 끝나면 만료, 만료된 편지는 답할 수 없음', () => {
    expect(isSlotExpired(cls(20), list[2])).toBe(false);
    expect(isSlotExpired(cls(20, { tradeEnded: true, phase: 'wrapup' }), list[2])).toBe(true);
    const p = player(base, 1);
    const q = letterForSlot(p, list[0], list)!;
    expect(applyAction(cls(4), p, { type: 'answerLetter', slotId: 'S1', answer: q.answer }).error).toBe('EXPIRED');
  });
});

describe('수정 1회차: 건너뛰기·문항 고정', () => {
  function threeSlots() {
    let s = makeSession({ n: 3, scope: ['L1'] });
    s = { ...s, class: { ...s.class, letters: { ...s.class.letters, slots: makeSlots([{ stage: 'L1', round: 2 }, { stage: 'L1', round: 3 }, { stage: 'L1', round: 4 }]) } } };
    s = teach(s, { type: 'startRound' }); // 라운드 1
    s = teach(s, { type: 'endRound' });
    s = teach(s, { type: 'startRound' }); // 라운드 2: S1 도착
    return s;
  }

  it('편지가 도착하는 순간 학생별 문항이 기록된다(늦게 온 학생도 입장 때)', () => {
    let s = threeSlots();
    for (let seat = 1; seat <= 3; seat++) expect(player(s, seat).game.letters.assigned.S1).toBeTruthy();
    expect(player(s, 1).game.letters.assigned.S1).not.toBe(player(s, 2).game.letters.assigned.S1);
    s = run(s, { type: 'join', seat: 20, pid: 'late20', deviceToken: 'tok-20', companyName: '늦게무역', nameKey: '늦게무역' }).snapshot;
    expect(player(s, 20).game.letters.assigned.S1).toBeTruthy();
  });

  it('재현: 좌석 1이 S1에 답 → S3 도착 뒤 S1 건너뛰기는 거절, 뒤 슬롯 문항은 답한 문항과 겹치지 않음', () => {
    let s = threeSlots();
    const q1 = letterForSlot(player(s, 1), deliveredSlots(s.class)[0], deliveredSlots(s.class))!;
    s = act(s, 1, { type: 'answerLetter', slotId: 'S1', answer: q1.answer }).snapshot;
    for (const _ of [3, 4]) {
      s = teach(s, { type: 'endRound' });
      s = teach(s, { type: 'startRound' });
    }
    expect(s.class.letters.delivered).toEqual(['S1', 'S2', 'S3']);
    const before = mailbox(s.class, player(s, 1)).map((v) => v.question?.id);
    const r = run(s, { type: 'teacher', action: { type: 'skipLetterSlot', slotId: 'S1' } });
    expect(r.outputs).toContainEqual(expect.objectContaining({ to: 'teacher', code: 'ALREADY_DELIVERED' }));
    expect(r.snapshot.class.letters.delivered).toEqual(['S1', 'S2', 'S3']);
    const after = mailbox(r.snapshot.class, player(r.snapshot, 1)).map((v) => v.question?.id);
    expect(after).toEqual(before);
    expect(new Set(after).size).toBe(3);
    expect(after.slice(1)).not.toContain(q1.id);
  });

  it('안전장치: 배정 기록이 없어도 이미 답한 문항은 다시 고르지 않는다', () => {
    const s = threeSlots();
    const p = player(s, 1);
    const list = makeSlots([{ stage: 'L1', round: 2 }, { stage: 'L1', round: 3 }, { stage: 'L1', round: 4 }]);
    const firstOfS3 = letterForSlot({ ...p, game: { ...p.game, letters: { answered: [], slots: {}, assigned: {} } } }, list[2], [list[2]])!;
    const q = letterForSlot({ ...p, game: { ...p.game, letters: { answered: [firstOfS3.id], slots: {}, assigned: {} } } }, list[2], [list[2]])!;
    expect(q.id).not.toBe(firstOfS3.id);
  });

  it('출석번호를 바꿔도(reassignSeat) 이미 도착한 편지 문항은 그대로', () => {
    let s = threeSlots();
    const before = mailbox(s.class, player(s, 2)).map((v) => v.question?.id);
    s = teach(s, { type: 'reassignSeat', from: 2, to: 9 });
    expect(mailbox(s.class, player(s, 9)).map((v) => v.question?.id)).toEqual(before);
  });

  it('아직 도착하지 않은 슬롯은 건너뛸 수 있다', () => {
    let s = threeSlots();
    s = teach(s, { type: 'skipLetterSlot', slotId: 'S2' });
    expect(s.class.letters.skipped).toEqual(['S2']);
    s = teach(s, { type: 'endRound' });
    s = teach(s, { type: 'startRound' });
    expect(s.class.letters.delivered).toEqual(['S1']);
  });
});
