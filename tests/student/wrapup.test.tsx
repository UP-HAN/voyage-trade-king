/**
 * 작업 132(114 검증 반영): 차시 한 판 L1 마무리 학생 화면(최소 형태) — 교사가 [시작]한 마무리 단계를 따른다.
 */
import { render, type VNode } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { aggregate, applyAction, buildWrapup, playerView, publicClass, seatKey, type HostSnapshot } from '../../src/core';
import { liveWrapStep, publicView, teacherReducer, type TeacherGame } from '../../src/teacher/game';
import { reflectQuestions, WrapupView } from '../../src/student/wrapup/WrapupView';
import { makeSession } from '../core/helpers';
import { installFakeDom } from '../map/fake-dom';

let dom: ReturnType<typeof installFakeDom>;
beforeEach(() => {
  dom = installFakeDom();
});
afterEach(() => {
  act(() => render(null, dom.root as unknown as Element));
  dom.restore();
});
const byTest = (id: string) => dom.root.find((el) => el.getAttribute('data-testid') === id);
const text = (el: unknown): string => ((el as { textContent?: string } | undefined)?.textContent ?? '');
function mount(node: VNode) {
  act(() => {
    render(node, dom.root as unknown as Element);
  });
}

/** 차시 한 판 L1 무역이 끝난 판(학생 2명) */
function wrapSnap(scope: ('L1' | 'L4')[] = ['L1'], playUnit: 'lesson' | 'unit' = 'lesson'): TeacherGame {
  let s: HostSnapshot = makeSession({ n: 2, playUnit, scope: playUnit === 'unit' ? ['L1', 'L2', 'L3', 'L4'] : scope });
  for (const seat of [1, 2]) {
    const r = applyAction(s.class, s.players[seatKey(seat)], { type: 'foundCompany', color: 'red', emblem: 'anchor', avatar: 'a1' });
    if (!r.error) s = { ...s, players: { ...s.players, [seatKey(seat)]: r.player } };
  }
  const wrapup = buildWrapup(playUnit, s.class.settings.scope, []);
  s = { ...s, class: { ...s.class, phase: 'wrapup', tradeEnded: true, schedule: { ...s.class.schedule, wrapup } } };
  return { ...s, screenScene: 'auto', wrapProgress: {} } as TeacherGame;
}

function mountFor(g: TeacherGame, seat = 1) {
  const pub = aggregate(g.class, g.players);
  mount(<WrapupView cls={publicClass(g.class)} pub={pub} me={playerView(g.players[seatKey(seat)])} wrapLive={liveWrapStep(g)} />);
}

describe('마무리 학생 화면', () => {
  it('교사가 [시작]하기 전: "무역 시간이 끝났어요"', () => {
    mountFor(wrapSnap());
    expect(text(byTest('trade-over')[0])).toContain('무역 시간이 끝났어요');
  });

  it('setWrapStep(awards live) → 공개 상태 wrapLive, 학생 화면 결산 요약(차시 한 판은 사회적 책임·협력 숨김) + 시상', () => {
    let g = wrapSnap();
    const r = teacherReducer(g, { type: 'teacher', action: { type: 'setWrapStep', id: 'awards', status: 'live' } as never }, 0);
    g = r.snapshot;
    expect(r.outputs.some((o) => o.type === 'public')).toBe(true);
    expect((publicView(g) as { wrapLive: string }).wrapLive).toBe('awards');
    mountFor(g);
    expect(byTest('trade-over')[0]!.getAttribute('data-wrap')).toBe('awards');
    expect(text(byTest('wrap-awards')[0])).toContain('결산·시상');
    const metrics = byTest('wrap-metrics')[0]!.find((el) => el.getAttribute('data-metric') !== null).map((el) => el.getAttribute('data-metric'));
    expect(metrics).toEqual(['finalAsset', 'exports', 'dex', 'quiz', 'explore']);
    expect(text(byTest('wrap-metrics')[0])).toContain('최종 자산');
  });

  it('되돌아보기(차시 한 판 L1): 앞 2문항 + 쓰는 곳 안내(⑱은 단원 마지막에)', () => {
    let g = wrapSnap();
    g = teacherReducer(g, { type: 'teacher', action: { type: 'setWrapStep', id: 'awards', status: 'done' } as never }, 0).snapshot;
    g = teacherReducer(g, { type: 'teacher', action: { type: 'setWrapStep', id: 'reflect', status: 'live' } as never }, 0).snapshot;
    mountFor(g);
    const sec = byTest('wrap-reflect')[0]!;
    expect(sec.getAttribute('data-questions')).toBe('2');
    const qs = text(byTest('wrap-reflect-questions')[0]);
    for (const q of reflectQuestions(2)) expect(qs).toContain(q);
    expect(qs).not.toContain(reflectQuestions(3)[2]!);
    expect(text(byTest('wrap-reflect-where')[0])).toContain('학습지 ⑱');
  });

  it('되돌아보기(단원 한 판): 3문항 + "학습지 ⑱(교과서 111쪽, 115쪽)에"', () => {
    let g = wrapSnap(['L1'], 'unit');
    g = teacherReducer(g, { type: 'teacher', action: { type: 'setWrapStep', id: 'reflect', status: 'live' } as never }, 0).snapshot;
    mountFor(g);
    expect(byTest('wrap-reflect')[0]!.getAttribute('data-questions')).toBe('3');
    expect(text(byTest('wrap-reflect-where')[0])).toBe('학습지 ⑱(교과서 111쪽, 115쪽)에 한 줄씩 써요.');
  });
});
