/**
 * 작업 137: 교사 카드 [다음으로] = `fireNow { clear: true }` — 자동 진행에서도 떠 있는 표지·카드·학습지·결과 보여 주기를 끝내고
 * 다음 항목을 연다(hostReduce 경유). clear 가 없으면 예전과 같다(자동 진행: 차단형 활동이 떠 있으면 'CANNOT_FIRE_NOW').
 */
import { describe, expect, it } from 'vitest';
import { teacherReducer, type TeacherGame } from '../../src/teacher/game';
import type { SessionInput } from '../../src/sync/host-session';
import { gameWith } from '../teacher/helpers';

const T0 = 2_000_000;

function play() {
  const h = gameWith(2, { minutes: 10 });
  let t = 0;
  let notices: string[] = [];
  const run = (i: SessionInput) => {
    const r = teacherReducer(h.get(), i, T0 + t * 1000);
    notices = r.outputs.filter((o) => o.type === 'teacher').map((o) => String((o as { data?: { notice?: string } }).data?.notice ?? ''));
    h.run(i, T0 + t * 1000);
  };
  run({ type: 'teacher', action: { type: 'startTrade' } });
  const to = (sec: number) => {
    for (; t < sec; ) {
      t += 1;
      run({ type: 'tick' });
    }
  };
  const teacher = (action: Record<string, unknown>) => run({ type: 'teacher', action } as unknown as SessionInput);
  return { g: (): TeacherGame => h.get(), to, teacher, notices: () => notices };
}

const status = (g: TeacherGame, id: string) => g.class.schedule.items.find((it) => it.id === id)?.status;

describe('fireNow clear(작업 137)', () => {
  it('clear 없이: 자동 진행 표지 중 [지금]은 예전처럼 거절, 표지는 그대로', () => {
    const p = play();
    p.to(5);
    p.teacher({ type: 'fireNow', id: 'ev:L1-E1' });
    expect(p.notices()).toContain('CANNOT_FIRE_NOW');
    expect(status(p.g(), 'cover:L1')).toBe('live');
    expect(status(p.g(), 'ev:L1-E1')).toBe('pending');
  });

  it('clear: 표지를 끝내고(계획 길이 = 실제) 벽란도를 지금 연다, 뒤 항목 시각은 그대로', () => {
    const p = play();
    p.to(5);
    const e2At = p.g().class.schedule.items.find((it) => it.id === 'ev:L1-E2')!.at;
    p.teacher({ type: 'fireNow', id: 'ev:L1-E1', clear: true });
    const g = p.g();
    const cover = g.class.schedule.items.find((it) => it.id === 'cover:L1')!;
    expect(cover.status).toBe('done');
    expect(cover.durSec).toBe(5);
    expect(status(g, 'ev:L1-E1')).toBe('live');
    expect(g.class.currentEvent).toMatchObject({ id: 'L1-E1', closed: false });
    expect(g.class.schedule.items.find((it) => it.id === 'ev:L1-E1')!.at).toBe(5);
    expect(g.class.schedule.items.find((it) => it.id === 'ev:L1-E2')!.at).toBe(e2At);
    expect(g.class.phase).toBe('event');
  });

  it('clear: 학습지 팝업이면 닫고(계획 길이 = 실제) 다음 항목(라운드)을 연다', () => {
    const p = play();
    p.to(475); // ③★ 지금 쓰기
    expect(p.g().class.worksheet.current).toEqual(['W03']);
    p.teacher({ type: 'fireNow', id: 'r:2', clear: true });
    const g = p.g();
    expect(g.class.worksheet.current).toBeNull();
    expect(status(g, 'wsd:W03')).toBe('done');
    expect(g.class.phase).toBe('round');
    expect(g.class.round).toBe(2);
  });
});
