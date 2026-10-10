/**
 * 작업 112: 편지·갈매기 퀴즈 학생 화면(가짜 DOM) + 교사 편지 패널.
 * - 편지 패널은 모달이 아니다(층 틀·어두운 배경 없음 → 시장 거래를 막지 않음). 편지함이 열린 채 사기 행동이 그대로 된다.
 * - 라운드 시작 도착 → 배지 숫자·갈매기, 옆 좌석은 다른 문제, 정답(보상·도장·칭찬)·오답(해설·쪽수·[알겠어요]로만 닫힘)·재답 불가,
 *   만료 표시("답장 기한이 지났어요" + 해설 보기), 보상 미리보기 문구, 무역 기초 꼬리표, 두루마리 아래 여백.
 * - 관세사를 '관세를 깎아 주는 사람'으로 그리지 않는다.
 */
import { readFileSync } from 'node:fs';
import { render, type VNode } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyAction,
  makeSlots,
  playerView,
  publicClass,
  seatKey,
  type Action,
  type HostSnapshot,
  type LetterSlotInfo,
} from '../src/core';
import { hostReduce } from '../src/core/host';
import { letterRewards } from '../src/data/letterSchedule';
import { lettersById } from '../src/data/letters';
import { LetterBadge } from '../src/student/letters/LetterBadge';
import { LetterLayer } from '../src/student/letters/LetterLayer';
import { letterBox, pagesText, rewardPreview, slotTag, unansweredCount } from '../src/student/letters/model';
import { openLetters, resetLetterUi, setLetterUi } from '../src/student/letters/ui';
import type { MeView } from '../src/student/predict';
import { demoActions, type TeacherActions } from '../src/teacher/actions';
import type { TeacherGame } from '../src/teacher/game';
import { LettersPanel, nextSlot, slotRows } from '../src/teacher/panels/LettersPanel';
import { makeSession } from './core/helpers';
import { installFakeDom, type FakeElement } from './map/fake-dom';

let dom: ReturnType<typeof installFakeDom>;
beforeEach(() => {
  dom = installFakeDom();
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
  resetLetterUi();
});
afterEach(() => {
  act(() => render(null, dom.root as unknown as Element));
  vi.useRealTimers();
  dom.restore();
});

const byTest = (id: string) => dom.root.find((el) => el.getAttribute('data-testid') === id);
const text = (el: FakeElement | undefined): string => (el ? ((el as unknown as { textContent: string }).textContent ?? '') : '');
function mount(node: VNode) {
  act(() => {
    render(node, dom.root as unknown as Element);
  });
}

/** L1 슬롯 3개(라운드 2·3·5) — 직접 넣은 목록 */
const SLOTS: LetterSlotInfo[] = makeSlots([
  { stage: 'L1', round: 2 },
  { stage: 'L1', round: 3 },
  { stage: 'L1', round: 5 },
]);

function play(n = 3): HostSnapshot {
  let s = makeSession({ n });
  for (let seat = 1; seat <= n; seat++) {
    const r = applyAction(s.class, s.players[seatKey(seat)], { type: 'foundCompany', color: 'red', emblem: 'anchor', avatar: 'a1' });
    if (!r.error) s = { ...s, players: { ...s.players, [seatKey(seat)]: r.player } };
  }
  return { ...s, class: { ...s.class, letters: { ...s.class.letters, slots: SLOTS } } };
}
const T = (s: HostSnapshot, action: { type: string; [k: string]: unknown }) => hostReduce(s, { type: 'teacher', action: action as never }, 1000).snapshot;
const startRound = (s: HostSnapshot) => T(s, { type: 'startRound' });
const endRound = (s: HostSnapshot) => T(s, { type: 'endRound' });
const me = (s: HostSnapshot, seat: number): MeView => playerView(s.players[seatKey(seat)]);
const answer = (s: HostSnapshot, seat: number, a: Action) => {
  const r = hostReduce(s, { type: 'act', seat, seq: 1, action: a }, 1000);
  return r.snapshot;
};

/** 라운드 2까지 진행(S1 도착) */
function toRound2(): HostSnapshot {
  let s = play();
  s = endRound(startRound(s));
  return startRound(s);
}

function mountStudent(s: HostSnapshot, seat: number, act$ = vi.fn((_a: Action) => 'sent' as const)) {
  mount(
    <div>
      <LetterBadge classState={publicClass(s.class)} player={me(s, seat)} />
      <LetterLayer classState={publicClass(s.class)} player={me(s, seat)} act={act$} />
    </div>,
  );
  return act$;
}

describe('편지 도착·출제', () => {
  it('라운드 시작에 모든 학생이 1통씩 받고, 옆 좌석은 다른 문제, 같은 학생에게 같은 문제가 다시 나오지 않는다', () => {
    let s = toRound2();
    const q2 = [1, 2, 3].map((seat) => s.players[seatKey(seat)].game.letters.assigned.S1);
    expect(q2.every(Boolean)).toBe(true);
    expect(q2[0]).not.toBe(q2[1]);
    expect(q2[1]).not.toBe(q2[2]);
    for (const seat of [1, 2, 3]) expect(letterBox(publicClass(s.class), me(s, seat))).toHaveLength(1);
    s = startRound(endRound(s)); // 라운드 3: S2
    for (const seat of [1, 2, 3]) {
      const a = s.players[seatKey(seat)].game.letters.assigned;
      expect(a.S2).toBeTruthy();
      expect(a.S2).not.toBe(a.S1);
    }
  });

  it('배지 숫자 = 답하지 않았고 기한이 남은 편지 수, 새 편지가 오면 갈매기(fx.gull 자리)', () => {
    const s1 = endRound(startRound(play()));
    mountStudent(s1, 1);
    expect(byTest('hud-letters')[0]!.getAttribute('data-count')).toBe('0');
    expect(byTest('gull')).toHaveLength(0);
    const s2 = startRound(s1);
    mountStudent(s2, 1);
    expect(byTest('hud-letters')[0]!.getAttribute('data-count')).toBe('1');
    expect(text(byTest('letter-count')[0])).toBe('1');
    expect(byTest('gull')).toHaveLength(1);
    expect(byTest('gull')[0]!.getAttribute('data-slots')).toBe('S1');
    act(() => {
      vi.advanceTimersByTime(2500);
    });
    expect(byTest('gull')).toHaveLength(0);
  });
});

describe('편지 화면(S14)', () => {
  it('편지 패널은 모달이 아니다(층 틀·어두운 배경 없음) — 열린 채 시장 사기가 된다', () => {
    const s = toRound2();
    openLetters();
    mountStudent(s, 1);
    expect(byTest('letter-panel')).toHaveLength(1);
    expect(dom.root.find((el) => el.hasClass('st-layer') || el.hasClass('st-layer--dim'))).toHaveLength(0);
    expect(dom.root.find((el) => el.getAttribute('data-layer') === 'letter')[0]!.hasClass('lt-dock')).toBe(true);
    // 거래(사기)는 편지와 상관없이 그대로 처리된다
    const r = applyAction(s.class, s.players[seatKey(1)], { type: 'buy', good: 'chip', qty: 1 });
    expect(r.error).toBeUndefined();
  });

  it('보상 미리보기·꼬리표·발신 형식·쪽수 문구', () => {
    expect(rewardPreview('tailwind')).toBe('맞히면: 순풍 — 다음 출항 운항비 0원');
    expect(rewardPreview('money')).toBe(`맞히면: 감사 사례금 — ${letterRewards.money.effect}`);
    expect(pagesText([95, 96])).toBe('교과서 95~96쪽');
    expect(pagesText([96, 103])).toBe('교과서 96쪽, 103쪽');
    const s = toRound2();
    const v = letterBox(publicClass(s.class), me(s, 1))[0]!;
    expect(slotTag(v)).toBe(v.question!.common ? '무역 기초' : 'L1 구간');
    const common = { ...v, question: { ...v.question!, common: true } };
    expect(slotTag(common)).toBe('무역 기초');
  });

  it('정답: "정답!" 도장 + 보상(사례금 +30만 원, 슬롯당 1회) + 칭찬 + 무역 박사 +1', () => {
    let s = toRound2();
    const q = lettersById[s.players[seatKey(1)].game.letters.assigned.S1]!;
    const before = s.players[seatKey(1)].game.money;
    s = answer(s, 1, { type: 'answerLetter', slotId: 'S1', answer: q.answer });
    const p = s.players[seatKey(1)];
    expect(p.game.letters.slots.S1).toBe('right');
    expect(p.game.money).toBe(before + 30);
    expect(p.game.metrics.quizRight).toBe(1);
    // 같은 편지 다시 답하기 → 거절(보상 두 번 없음)
    const again = hostReduce(s, { type: 'act', seat: 1, seq: 2, action: { type: 'answerLetter', slotId: 'S1', answer: q.answer } }, 1000);
    expect(again.snapshot.players[seatKey(1)].game.money).toBe(before + 30);
    setLetterUi({ open: true, slotId: 'S1' });
    mountStudent(s, 1);
    expect(byTest('letter-right')).toHaveLength(1);
    expect(text(byTest('letter-reward-done')[0])).toBe('감사 사례금 30만 원을 받았어요');
    expect(byTest('letter-praise')).toHaveLength(1);
    expect(byTest('letter-choice')).toHaveLength(0); // 재답 불가
  });

  it('오답: 보상·벌칙 없음, 정답·해설·교과서 쪽수, [알겠어요]로만 닫힘', () => {
    const s = toRound2();
    const q = lettersById[s.players[seatKey(2)].game.letters.assigned.S1]!;
    const wrong = q.type === 'ox' ? (q.answer === 'O' ? 'X' : 'O') : ((q.answer as number) + 1) % 3;
    // 학생 기기처럼 act → 미리 계산된 결과로 다시 그린다
    let cur = s;
    const act$ = vi.fn((a: Action) => {
      cur = answer(cur, 2, a);
      return 'sent' as const;
    });
    setLetterUi({ open: true, slotId: 'S1' });
    mountStudent(cur, 2, act$);
    expect(text(byTest('letter-reward')[0])).toBe(rewardPreview('money'));
    const btn = byTest('letter-choice').find((b) => b.getAttribute('data-answer') === String(wrong))!;
    act(() => {
      btn.dispatch('click');
    });
    expect(act$).toHaveBeenCalledWith({ type: 'answerLetter', slotId: 'S1', answer: wrong });
    const before = s.players[seatKey(2)].game.money;
    expect(cur.players[seatKey(2)].game.money).toBe(before);
    expect(cur.players[seatKey(2)].game.letters.slots.S1).toBe('wrong');
    // 새 상태로 다시 그림(같은 패널 상태 유지)
    act(() => {
      render(
        <div>
          <LetterLayer classState={publicClass(cur.class)} player={me(cur, 2)} act={act$} />
        </div>,
        dom.root as unknown as Element,
      );
    });
    expect(byTest('letter-wrong')).toHaveLength(1);
    expect(text(byTest('letter-explain')[0])).toContain(q.explain.slice(0, 12));
    expect(text(byTest('letter-pages')[0])).toBe(pagesText(q.pages));
    expect(byTest('letter-close')).toHaveLength(0);
    expect(byTest('letter-back')).toHaveLength(0);
    act(() => {
      byTest('letter-ack')[0]!.dispatch('click');
    });
    expect(byTest('letter-list')).toHaveLength(1);
    expect(byTest('letter-close')).toHaveLength(1);
  });

  it('만료: 다음 편지가 오고 도착 뒤 2라운드가 지나면 "답장 기한이 지났어요"(해설 보기), 무역이 끝나면 모두 만료', () => {
    let s = toRound2(); // S1 라운드 2
    s = startRound(endRound(s)); // 라운드 3: S2 도착, S1은 아직(2라운드 미만)
    expect(letterBox(publicClass(s.class), me(s, 1)).map((v) => v.expired)).toEqual([false, false]);
    s = startRound(endRound(s)); // 라운드 4: S1 만료(다음 편지 왔고 2라운드 지남)
    const box = letterBox(publicClass(s.class), me(s, 1));
    expect(box.map((v) => v.expired)).toEqual([true, false]);
    expect(unansweredCount(box)).toBe(1);
    setLetterUi({ open: true, slotId: 'S1' });
    mountStudent(s, 1);
    expect(text(byTest('letter-expired')[0])).toContain('답장 기한이 지났어요');
    expect(byTest('letter-choice')).toHaveLength(0);
    act(() => {
      byTest('letter-show-explain')[0]!.dispatch('click');
    });
    expect(byTest('letter-explain')).toHaveLength(1);
    // 무역 시간 끝 → 모두 만료
    const ended = T(endRound(s), { type: 'endTrade' });
    expect(letterBox(publicClass(ended.class), me(ended, 1)).every((v) => v.expired)).toBe(true);
  });

  it('두루마리(바다 소식)는 아래쪽 안쪽 여백을 둔다(014: 오른쪽 아래 말린 귀퉁이)', () => {
    const css = readFileSync(new URL('../src/student/letters/letters.css', import.meta.url), 'utf8');
    const block = css.slice(css.indexOf('.lt-sheet--scroll {'), css.indexOf('}', css.indexOf('.lt-sheet--scroll {')));
    expect(block).toContain('border-image-slice: 180 150 140 150 fill');
    expect(block).toMatch(/padding: 0 0 (1[0-9]|2[0-9])px/);
  });

  it("관세사를 '관세를 깎아 주는 사람'으로 그리는 문구가 없다", () => {
    for (const f of ['../src/student/letters/LetterLayer.tsx', '../src/student/letters/model.ts', '../src/student/letters/LetterBadge.tsx']) {
      const src = readFileSync(new URL(f, import.meta.url), 'utf8');
      expect(src, f).not.toMatch(/관세를?\s*(깎|줄여|낮춰|면제)/);
    }
  });
});

describe('교사 편지 패널', () => {
  function tg(s: HostSnapshot): TeacherGame {
    return { ...s, screenScene: 'auto', wrapProgress: {} } as TeacherGame;
  }
  it('슬롯별 상태·정답률(이름 없이), 다음 편지 건너뛰기', () => {
    let s = toRound2();
    const q1 = lettersById[s.players[seatKey(1)].game.letters.assigned.S1]!;
    s = answer(s, 1, { type: 'answerLetter', slotId: 'S1', answer: q1.answer });
    const rows = slotRows(tg(s));
    expect(rows.map((r) => [r.slot.slotId, r.state])).toEqual([
      ['S1', 'delivered'],
      ['S2', 'pending'],
      ['S3', 'pending'],
    ]);
    expect(rows[0]).toMatchObject({ right: 1, answered: 1, total: 3 });
    expect(nextSlot(s.class)?.slotId).toBe('S2');
    const sent: unknown[] = [];
    const actions: TeacherActions = { ...demoActions(() => 0), dispatch: (a) => void sent.push(a) };
    mount(<LettersPanel game={tg(s)} view={{} as never} actions={actions} now={0} />);
    expect(text(byTest('lp-rate')[0])).toContain('정답 1/1');
    expect(text(dom.root)).not.toContain('해오름');
    act(() => {
      byTest('lp-skip')[0]!.dispatch('click');
    });
    expect(sent).toEqual([{ type: 'skipLetterSlot', slotId: 'S2' }]);
    // 건너뛴 슬롯은 모두에게 똑같이 오지 않는다
    s = T(s, { type: 'skipLetterSlot', slotId: 'S2' });
    s = startRound(endRound(s));
    for (const seat of [1, 2, 3]) expect(s.players[seatKey(seat)].game.letters.assigned.S2).toBeUndefined();
    act(() => {
      byTest('lp-toggle')[0]!.dispatch('click');
    });
    expect(sent[1]).toEqual({ type: 'toggleLetters', enabled: false });
  });
});

describe('(수정 1회차) 해설 쪽수 중복 없음', () => {
  it('해설 끝 "(교과서 95쪽)"은 빼고 아래 쪽수 줄 하나만', async () => {
    const { explainBody } = await import('../src/student/letters/model');
    expect(explainBody('비단을 팔았어요. (교과서 95쪽)')).toBe('비단을 팔았어요.');
    expect(explainBody('무역이라고 해요(96쪽). 수입해요(103쪽).')).toBe('무역이라고 해요(96쪽). 수입해요(103쪽).');
  });
});
