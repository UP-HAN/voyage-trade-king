/**
 * 작업 114 통합 중 고친 규칙(112 참고 반영):
 * (a) 라운드 중 예약만 걸린 학습지 팝업도 '학습지 팝업 끄기'(closeWorksheet all)로 취소된다.
 * (b) 학습지 팝업이 떠 있는 동안 [구간 시작](startStage)은 [라운드 시작]처럼 WORKSHEET_OPEN으로 거절된다(PRD 7.7).
 * 그리고 마무리 사건 L4-E7·L4-E9 본문이 채워졌다(차시 한 판 L1 마무리에도 쓰임).
 */
import { describe, expect, it } from 'vitest';
import { applyTeacherAction } from '../../src/core/lesson';
import { eventsById } from '../../src/data/events';
import { worksheetById } from '../../src/data/worksheet';
import { makeSession, startFirstRound, teach } from './helpers';

describe('학습지 팝업 끄기 — 예약까지 취소(작업 114)', () => {
  it('라운드 중 예약만 있을 때 closeWorksheet all → 예약이 지워지고, 라운드가 끝나도 팝업이 뜨지 않는다', () => {
    let s = startFirstRound(makeSession({ n: 2 }));
    s = teach(s, { type: 'openWorksheet', ids: ['W01'] });
    expect(s.class.worksheet.pending).toEqual([['W01']]);
    expect(s.class.worksheet.current).toBeNull();
    s = teach(s, { type: 'closeWorksheet', all: true });
    expect(s.class.worksheet.pending).toEqual([]);
    s = teach(s, { type: 'endRound' });
    expect(s.class.phase).not.toBe('worksheet');
    expect(s.class.worksheet.current).toBeNull();
  });

  it('떠 있는 팝업 + 예약 → all이면 한 번에 모두 닫힌다(all 없으면 예약이 올라온다)', () => {
    let s = makeSession({ n: 1 });
    s = teach(s, { type: 'openWorksheet', ids: ['W01'] });
    s = teach(s, { type: 'openWorksheet', ids: ['W02'] });
    expect(s.class.worksheet.current).toEqual(['W01']);
    expect(s.class.worksheet.pending).toEqual([['W02']]);
    const one = teach(s, { type: 'closeWorksheet' });
    expect(one.class.worksheet.current).toEqual(['W02']);
    const all = teach(s, { type: 'closeWorksheet', all: true });
    expect(all.class.worksheet.current).toBeNull();
    expect(all.class.worksheet.pending).toEqual([]);
    expect(all.class.phase).not.toBe('worksheet');
  });

  it('닫을 것이 없으면 NO_WORKSHEET', () => {
    const s = makeSession({ n: 1 });
    expect(applyTeacherAction(s.class, { type: 'closeWorksheet', all: true }, 1000).error).toBe('NO_WORKSHEET');
  });
});

describe('학습지 팝업 중 [구간 시작] 거절(작업 114)', () => {
  it('팝업이 떠 있으면 startStage → WORKSHEET_OPEN, 닫은 뒤에는 시작된다', () => {
    let s = makeSession({ n: 1, playUnit: 'unit', scope: ['L1', 'L2', 'L3', 'L4'] });
    s = teach(s, { type: 'openWorksheet', ids: ['W01'] });
    expect(s.class.phase).toBe('worksheet');
    expect(applyTeacherAction(s.class, { type: 'startStage', stage: 'L2' }, 1000).error).toBe('WORKSHEET_OPEN');
    s = teach(s, { type: 'closeWorksheet' });
    const r = applyTeacherAction(s.class, { type: 'startStage', stage: 'L2' }, 1000);
    expect(r.error).toBeUndefined();
    expect(r.class.stage).toBe('L2');
  });
});

describe('마무리 사건 본문(작업 114)', () => {
  it('L4-E7 결산·시상, L4-E9 되돌아보기: TODO 없음, 교과서 쪽수 111~115, ⑱ 3문항과 같은 문항', () => {
    for (const id of ['L4-E7', 'L4-E9']) {
      const e = eventsById[id]!;
      expect(e.body).not.toMatch(/TODO/);
      expect(e.body.length).toBeGreaterThan(20);
      expect(e.textbook.length).toBeGreaterThan(0);
      for (const t of e.textbook) for (const p of t.pages) expect(p).toBeGreaterThanOrEqual(111);
      for (const t of e.textbook) for (const p of t.pages) expect(p).toBeLessThanOrEqual(115);
    }
    const q = eventsById['L4-E9']!.reflectQuestions!;
    expect(q).toHaveLength(3);
    expect(q[0]).toContain('가장 이익이 컸던 무역');
    expect(q[1]).toContain('상호 의존');
    expect(q[2]).toContain('사회적 책임');
    expect(worksheetById.W18.afterEvent).toBe('L4-E9');
  });
});
