/**
 * 작업 112: 학생 "잠깐!" 팝업 렌더(가짜 DOM) — [다 썼어요] 대기 시간(호스트 시각 기준), 묶음 팝업, 다 쓴 뒤 "친구들을 기다려요",
 * 마무리 '끝나고 쓰기' 목록, 판 단위 꼬리표. 교사 학습지 패널(출석번호 + 회사 이름, 완료율 표·끄기), 공용 화면 장면(출석번호 없음).
 */
import { render, type VNode } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAction, playerView, publicClass, seatKey, type HostSnapshot, type TeacherAction } from '../src/core';
import type { WorksheetId } from '../src/data/types';
import { hostReduce } from '../src/core/host';
import { parseScreenData } from '../src/screen/model';
import { AfterWorksheetBand, pickAfterWorksheetScene, WorksheetScene } from '../src/screen/scenes/WorksheetScene';
import { StoreContext } from '../src/student/hooks';
import type { StudentStore } from '../src/student/store';
import { allDone, openWorksheetIds, waitLeftSec, WorksheetLayer, worksheetOrderParts } from '../src/student/worksheet/WorksheetLayer';
import { demoActions, type TeacherActions } from '../src/teacher/actions';
import { publicView, screenView, type TeacherGame } from '../src/teacher/game';
import { completionGroups, popupProgress, seatLabel, WorksheetPanel } from '../src/teacher/panels/WorksheetPanel';
import { makeSession, teach } from './core/helpers';
import { installFakeDom, type FakeElement } from './map/fake-dom';

let dom: ReturnType<typeof installFakeDom>;
beforeEach(() => {
  dom = installFakeDom();
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
});
afterEach(() => {
  act(() => render(null, dom.root as unknown as Element));
  vi.useRealTimers();
  dom.restore();
});

const byTest = (id: string) => dom.root.find((el) => el.getAttribute('data-testid') === id);
const text = (el: FakeElement | undefined): string => (el ? ((el as unknown as { textContent: string }).textContent ?? '') : '');
const allText = () => text(dom.root);

function mount(node: VNode) {
  act(() => {
    render(node, dom.root as unknown as Element);
  });
}

const NOW = Date.UTC(2026, 9, 14, 1, 0, 0);

/** 학습지가 떠 있는 판(학생 2명, 회사 설립) */
function snapWith(ids: WorksheetId[], o: { waitSec?: 0 | 15 | 30; phase?: 'worksheet' | 'wrapup'; playUnit?: 'lesson' | 'unit'; scope?: ('L1' | 'L2' | 'L3' | 'L4')[] } = {}): HostSnapshot {
  let s = makeSession({ n: 2, playUnit: o.playUnit ?? 'lesson', scope: o.scope ?? ['L1'] });
  for (const seat of [1, 2]) {
    const r = applyAction(s.class, s.players[seatKey(seat)], { type: 'foundCompany', color: 'red', emblem: 'anchor', avatar: 'a1' });
    if (!r.error) s = { ...s, players: { ...s.players, [seatKey(seat)]: r.player } };
  }
  s = teach(s, { type: 'updateSettings', settings: { worksheetWaitSec: o.waitSec ?? 15 } });
  s = { ...s, class: { ...s.class, phase: o.phase ?? 'worksheet', worksheet: { ...s.class.worksheet, current: ids, openedAt: NOW } } };
  return s;
}

function fakeStore(snap: HostSnapshot, nowMs: () => number): StudentStore {
  return {
    getState: () => ({ peer: { code: snap.meta.code, public: { class: publicClass(snap.class), public: null } } }),
    serverNow: nowMs,
  } as unknown as StudentStore;
}

function mountStudent(snap: HostSnapshot, seat = 1, now: () => number = () => NOW, actFn = vi.fn(() => 'sent' as const)) {
  const me = playerView(snap.players[seatKey(seat)]);
  mount(
    <StoreContext.Provider value={fakeStore(snap, now)}>
      <WorksheetLayer classState={publicClass(snap.class)} player={me} act={actFn} />
    </StoreContext.Provider>,
  );
  return actFn;
}

describe('학생 "잠깐!" 팝업', () => {
  it('[다 썼어요] 대기 시간: 15초 뒤 켜짐(호스트 openedAt 기준), 0초면 바로', () => {
    expect(waitLeftSec(NOW, 15, NOW)).toBe(15);
    expect(waitLeftSec(NOW, 15, NOW + 14_100)).toBe(1);
    expect(waitLeftSec(NOW, 15, NOW + 15_000)).toBe(0);
    expect(waitLeftSec(NOW, 0, NOW)).toBe(0);
    expect(waitLeftSec(null, 30, NOW)).toBe(0);
  });

  it('번호 하나: 잠깐! · 꼬리표 · ③ · 문구 · 쪽수 · 도우미, 15초 동안 [다 썼어요] 꺼짐 → 뒤에 켜짐 → markWorksheetDone', () => {
    const snap = snapWith(['W03']);
    let t = NOW + 2000;
    const actFn = mountStudent(snap, 1, () => t);
    expect(text(byTest('worksheet-head')[0])).toBe('잠깐!');
    expect(text(byTest('worksheet-tag')[0])).toBe('1차시');
    expect(text(byTest('worksheet-no')[0])).toBe('③');
    expect(text(byTest('worksheet-pages')[0])).toBe('교과서 98~99쪽');
    expect(text(byTest('worksheet-helper')[0])).toBe('[내 기록: 아직 기록이 없어요]');
    const btn = () => byTest('worksheet-done')[0]!;
    expect(btn().hasAttribute('disabled')).toBe(true);
    expect(text(btn())).toContain('13초 뒤에 켜져요');
    t = NOW + 15_500;
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(btn().hasAttribute('disabled')).toBe(false);
    act(() => {
      btn().dispatch('click');
    });
    expect(actFn).toHaveBeenCalledWith({ type: 'markWorksheetDone', ids: ['W03'] });
    // 연속 클릭은 한 번만
    act(() => {
      btn().dispatch('click');
    });
    expect(actFn).toHaveBeenCalledTimes(1);
  });

  it('묶음 팝업: "잠깐! ①②③④" + 번호마다 한 줄, [다 썼어요]는 1개', () => {
    mountStudent(snapWith(['W01', 'W02', 'W03', 'W04'], { waitSec: 0 }));
    expect(text(byTest('worksheet-head')[0])).toBe('잠깐! ①②③④');
    expect(byTest('worksheet-row')).toHaveLength(4);
    expect(byTest('worksheet-done')).toHaveLength(1);
    // ②는 helper 없음 → 도우미 줄 3개
    expect(byTest('worksheet-helper')).toHaveLength(3);
  });

  it('묶음 팝업 3분이 지나면 "다 못 쓴 번호는 마무리 때 이어 써요"', () => {
    mountStudent(snapWith(['W01', 'W02', 'W03', 'W04'], { waitSec: 0 }), 1, () => NOW + 181_000);
    expect(text(byTest('worksheet-late')[0])).toBe('다 못 쓴 번호는 마무리 때 이어 써요');
  });

  it('다 쓴 학생은 "친구들을 기다려요"(도감·편지함·항해 기록장 버튼)', () => {
    let s = snapWith(['W01']);
    const r = applyAction(s.class, s.players[seatKey(1)], { type: 'markWorksheetDone' });
    s = { ...s, players: { ...s.players, [seatKey(1)]: r.player } };
    expect(allDone(playerView(r.player), ['W01'])).toBe(true);
    mountStudent(s);
    expect(byTest('worksheet-waiting')).toHaveLength(1);
    expect(byTest('worksheet-done')).toHaveLength(0);
    expect(byTest('worksheet-tool-dex')).toHaveLength(1);
    expect(byTest('worksheet-tool-letters')).toHaveLength(1);
    act(() => {
      byTest('worksheet-tool-logbook')[0]!.dispatch('click');
    });
    expect(text(byTest('logbook-title')[0])).toMatch(/^항해 기록장 — 1차시 · \d+월 \d+일$/);
  });

  it('단원 한 판이면 꼬리표 "단원 한 판 · L3 구간"', () => {
    mountStudent(snapWith(['W09'], { playUnit: 'unit', scope: ['L1', 'L2', 'L3', 'L4'] }));
    expect(text(byTest('worksheet-tag')[0])).toBe('단원 한 판 · 3차시');
  });

  it('떠 있는 팝업이 없으면(늦게 온 학생 — 이미 닫힌 팝업) 아무것도 그리지 않는다', () => {
    const s = snapWith(['W01']);
    const closed = { ...s, class: { ...s.class, phase: 'between' as const, worksheet: { ...s.class.worksheet, current: null, openedAt: null } } };
    expect(openWorksheetIds(publicClass(closed.class))).toEqual([]);
    mountStudent(closed);
    expect(byTest('worksheet-popup')).toHaveLength(0);
  });

  it("마무리 단계 '끝나고 쓰기': \"오늘 쓸 학습지: ① ② ③ ④\" + 차시 한 판 · L1 + [항해 기록장]", () => {
    const s = snapWith([], { phase: 'wrapup' });
    const wrap = { ...s, class: { ...s.class, worksheet: { ...s.class.worksheet, current: null }, schedule: { ...s.class.schedule, wrapup: [{ id: 'afterWorksheet' as const, label: '끝나고 쓰기', minutes: 0, worksheetIds: ['W01', 'W02', 'W03', 'W04'] as WorksheetId[] }] } } };
    mountStudent(wrap);
    expect(text(byTest('after-tag')[0])).toBe('1차시');
    expect(text(byTest('after-title')[0])).toBe('오늘 쓸 학습지: ① ② ③ ④');
    expect(byTest('after-row')).toHaveLength(4);
    expect(allText()).not.toContain('⑱');
  });
});

// ─── 교사 패널 · 공용 화면 ───

function teacherGame(ids: WorksheetId[]): TeacherGame {
  const s = snapWith(ids);
  return { ...s, screenScene: 'auto', wrapProgress: {} } as TeacherGame;
}

function viewOf(g: TeacherGame) {
  return {
    game: g,
    seats: Object.values(g.players).map((p) => ({ seat: p.seat, pid: p.pid, companyName: p.company.name, nameStatus: 'ok', online: true, joinedAt: 0 })),
  } as never;
}

describe('교사 학습지 패널', () => {
  it('학생 표시는 "7 해오름무역"(출석번호 + 회사 이름)', () => {
    expect(seatLabel(7, '해오름무역')).toBe('7 해오름무역');
  });

  it('완료 수 "1/2"와 아직 안 쓴 회사 목록(출석번호 + 회사 이름)', () => {
    let g = teacherGame(['W01']);
    const r = applyAction(g.class, g.players[seatKey(1)], { type: 'markWorksheetDone' });
    g = { ...g, players: { ...g.players, [seatKey(1)]: r.player } };
    const prog = popupProgress(g, [
      { seat: 1, companyName: '해오름1' },
      { seat: 2, companyName: '해오름2' },
    ]);
    expect(prog).toMatchObject({ done: 1, total: 2, missing: ['2 해오름2'] });
    mount(<WorksheetPanel game={g} view={viewOf(g)} actions={demoActions(() => NOW)} now={NOW} />);
    expect(text(byTest('ws-panel-done')[0])).toBe('1/2');
    expect(text(byTest('ws-missing')[0])).toBe('아직 안 쓴 회사: 2 해오름2');
  });

  it('①~⑳ 완료율 표: 이번 판 번호(L1)만 펼치고 나머지는 접어 회색', () => {
    const g = teacherGame(['W01']);
    const groups = completionGroups(g);
    expect(groups.map((x) => x.lesson)).toEqual(['L1', 'L2', 'L3', 'L4', 'optional']);
    mount(<WorksheetPanel game={g} view={viewOf(g)} actions={demoActions(() => NOW)} now={NOW} />);
    const rows = byTest('ws-rate-group');
    expect(rows.map((r) => r.getAttribute('data-lesson'))).toEqual(['L1', 'L2', 'L3', 'L4', 'optional']);
    // 판을 열기 전 배치표가 비어 있으면 이번 판 번호 없음 → 모두 접힘. 배치표가 있으면 L1만 펼침
    const withSched = {
      ...g,
      class: { ...g.class, schedule: { ...g.class.schedule, items: [{ id: 'ws:W01', kind: 'worksheet' as const, refId: 'W01', refIds: ['W01'], stage: 'L1' as const, at: 0, durSec: 120, form: 'full' as const, status: 'pending' as const }] } },
    };
    mount(<WorksheetPanel game={withSched} view={viewOf(withSched)} actions={demoActions(() => NOW)} now={NOW} />);
    const g2 = byTest('ws-rate-group');
    expect(g2.map((r) => r.getAttribute('data-inplay'))).toEqual(['1', '0', '0', '0', '0']);
    expect(g2[0]!.hasAttribute('open')).toBe(true);
    expect(g2[1]!.hasAttribute('open')).toBe(false);
  });

  it('라운드 중이면 [지금 띄우기]가 "라운드가 끝나면 띄우기", 예약 목록이 보인다', () => {
    const g = teacherGame(['W01']);
    const inRound = { ...g, class: { ...g.class, phase: 'round' as const, worksheet: { ...g.class.worksheet, current: null, pending: [['W02']] as WorksheetId[][] } } };
    mount(<WorksheetPanel game={inRound} view={viewOf(inRound)} actions={demoActions(() => NOW)} now={NOW} />);
    expect(text(byTest('ws-open-now')[0])).toBe('라운드가 끝나면 띄우기');
    expect(text(byTest('ws-reserved')[0])).toBe('라운드가 끝나면 띄우기: ②');
  });

  it("'학습지 팝업 끄기': 남은 학습지 항목을 먼저 건너뛰고 설정을 끈다", () => {
    const g0 = teacherGame([]);
    const g = {
      ...g0,
      class: {
        ...g0.class,
        phase: 'between' as const,
        worksheet: { ...g0.class.worksheet, current: null },
        schedule: {
          ...g0.class.schedule,
          items: (['W01', 'W02'] as WorksheetId[]).map((w, i) => ({ id: `ws:${w}`, kind: 'worksheet' as const, refId: w, refIds: [w], stage: 'L1' as const, at: 100 * (i + 1), durSec: 120, form: 'full' as const, status: 'pending' as const })),
        },
      },
    };
    const sent: TeacherAction[] = [];
    const actions: TeacherActions = { ...demoActions(() => NOW), dispatch: (a) => void sent.push(a as TeacherAction) };
    mount(<WorksheetPanel game={g} view={viewOf(g)} actions={actions} now={NOW} />);
    act(() => {
      byTest('ws-off')[0]!.dispatch('click');
    });
    expect(sent).toEqual([
      { type: 'skipItem', id: 'ws:W01' },
      { type: 'skipItem', id: 'ws:W02' },
      { type: 'updateSettings', settings: { worksheetMode: 'off' } },
    ]);
  });
});

describe('공용 화면 학습지 장면', () => {
  it('"잠깐! ③ 학습지를 써요" + 수만(출석번호·회사 이름 없음)', () => {
    let g = teacherGame(['W03']);
    const r = applyAction(g.class, g.players[seatKey(2)], { type: 'markWorksheetDone' });
    g = { ...g, players: { ...g.players, [seatKey(2)]: r.player } };
    g = hostReduce(g, { type: 'tick' }, NOW).snapshot as TeacherGame;
    const d = parseScreenData(publicView(g), screenView(g))!;
    mount(<WorksheetScene d={d} now={NOW} code="482137" address={{ display: 'x', url: 'x' }} />);
    expect(text(byTest('ws-title')[0])).toBe('잠깐! ③ 학습지를 써요');
    expect(text(byTest('ws-done-count')[0])).toBe('1/2');
    expect(text(byTest('ws-tag')[0])).toBe('1차시');
    const all = allText();
    expect(all).not.toMatch(/\d+번/);
    expect(all).not.toContain('해오름');
    for (const el of dom.root.all()) for (const [k, v] of el.attributes) expect(`${k}=${v}`).not.toMatch(/seat/i);
  });

  it("마무리 장면 우선순위: 시상 > 결산 순위판(+아래 '끝나고 쓰기' 띠) > '끝나고 쓰기' 장면", () => {
    const g = teacherGame([]);
    const wrap = {
      ...g,
      class: { ...g.class, phase: 'wrapup' as const, tradeEnded: true, worksheet: { ...g.class.worksheet, current: null }, schedule: { ...g.class.schedule, wrapup: [{ id: 'afterWorksheet' as const, label: '끝나고 쓰기', minutes: 0, worksheetIds: ['W01', 'W02'] as WorksheetId[] }] } },
    } as TeacherGame;
    const d = parseScreenData(publicView(wrap), screenView(wrap))!;
    const noBoard = { ...d, pub: { ...d.pub, awards: [] }, cls: { ...d.cls, settings: { ...d.cls.settings, leaderboardTopN: 0 as const } } };
    expect(pickAfterWorksheetScene(noBoard)).toBe('afterWorksheet');
    expect(pickAfterWorksheetScene({ ...noBoard, cls: { ...noBoard.cls, phase: 'round' } })).toBeNull();
    // 마무리 순서(정산 → 결산·시상 → … → 끝나고 쓰기): 결산 순위판(N>0)이 있으면 순위판이 먼저(번호는 아래 띠)
    expect(pickAfterWorksheetScene({ ...noBoard, cls: { ...noBoard.cls, settings: { ...noBoard.cls.settings, leaderboardTopN: 3 as const } } })).toBeNull();
    mount(<AfterWorksheetBand d={{ ...noBoard, cls: { ...noBoard.cls, settings: { ...noBoard.cls.settings, leaderboardTopN: 3 as const } } }} sceneId="leaderboard" />);
    expect(text(byTest('after-nos')[0])).toBe('① ②');
    expect(text(byTest('after-tag')[0])).toBe('1차시');
    mount(<AfterWorksheetBand d={noBoard} sceneId="awards" />);
    expect(byTest('after-band')).toHaveLength(0);
  });
});

describe('[이 학생에게 학습지 다시 보내기]', () => {
  it('core resendWorksheet: 기록으로 남고 [다 썼어요] 전까지 유지, 이미 쓴 번호·없는 번호·없는 좌석은 거절 알림', async () => {
    const { hostReduce: reduce, resentWorksheets } = await import('../src/core/host');
    let s = snapWith([]);
    s = { ...s, class: { ...s.class, phase: 'between', worksheet: { ...s.class.worksheet, current: null } } };
    const notices = (r: ReturnType<typeof reduce>) => r.outputs.filter((o) => o.kind === 'notice').map((o) => (o as { code: string }).code);
    let r = reduce(s, { type: 'teacher', action: { type: 'resendWorksheet', seat: 2, wId: 'W03' } }, NOW);
    expect(notices(r)).toEqual([]);
    s = r.snapshot;
    expect(resentWorksheets(s.players[seatKey(2)])).toEqual(['W03']);
    expect(resentWorksheets(s.players[seatKey(1)])).toEqual([]);
    expect(r.outputs.some((o) => o.kind === 'me' && o.seat === 2)).toBe(true);
    expect(r.outputs.some((o) => o.kind === 'me' && o.seat === 1)).toBe(false);
    // 학생 기기: 그 학생에게만 개인 팝업
    mountStudent(s, 2);
    expect(byTest('worksheet-popup')[0]!.getAttribute('data-personal')).toBe('1');
    expect(byTest('worksheet-popup')[0]!.getAttribute('data-ids')).toBe('W03');
    expect(text(byTest('worksheet-personal')[0])).toBe('선생님이 다시 보낸 학습지예요');
    mountStudent(s, 1);
    expect(byTest('worksheet-popup')).toHaveLength(0);
    // 라운드 중에는 뜨지 않는다(라운드가 끝나면)
    mountStudent({ ...s, class: { ...s.class, phase: 'round' } }, 2);
    expect(byTest('worksheet-popup')).toHaveLength(0);
    // [다 썼어요] → 끝
    r = reduce(s, { type: 'act', seat: 2, seq: 1, action: { type: 'markWorksheetDone', ids: ['W03'] } }, NOW);
    s = r.snapshot;
    expect(resentWorksheets(s.players[seatKey(2)])).toEqual([]);
    mountStudent(s, 2);
    expect(byTest('worksheet-popup')).toHaveLength(0);
    // 거절: 이미 다 씀 / 없는 번호 / 없는 좌석
    expect(notices(reduce(s, { type: 'teacher', action: { type: 'resendWorksheet', seat: 2, wId: 'W03' } }, NOW))).toEqual(['ALREADY_DONE']);
    expect(notices(reduce(s, { type: 'teacher', action: { type: 'resendWorksheet', seat: 2, wId: 'W99' as WorksheetId } }, NOW))).toEqual(['NO_WORKSHEET']);
    expect(notices(reduce(s, { type: 'teacher', action: { type: 'resendWorksheet', seat: 9, wId: 'W01' } }, NOW))).toEqual(['NO_SEAT']);
  });
});

describe('(수정 1회차) 학습지 팝업을 닫으면 팝업 전 단계로 돌아간다', () => {
  const T = (s: HostSnapshot, action: TeacherAction, now = NOW) => hostReduce(s, { type: 'teacher', action }, now).snapshot;

  it("무역 시작 전(prep): 열고 [모두 닫기] → 'prep' 그대로, 공용 화면은 방 코드·규칙 장면", async () => {
    const { pickScene } = await import('../src/screen/model');
    let s = makeSession({ n: 1 });
    expect(s.class.phase).toBe('prep');
    s = T(s, { type: 'openWorksheet', ids: ['W19'] });
    expect(s.class.phase).toBe('worksheet');
    s = T(s, { type: 'closeWorksheet' });
    expect(s.class.phase).toBe('prep');
    expect(s.class.worksheet.current).toBeNull();
    const g = { ...s, screenScene: 'auto', wrapProgress: {} } as TeacherGame;
    const d = parseScreenData(publicView(g), screenView(g))!;
    expect(['code', 'rules']).toContain(pickScene(d, NOW));
  });

  it("무역 중 라운드(trading): [지금 띄우기]는 예약, 라운드 끝에 팝업 → 닫으면 'between'", () => {
    let s = makeSession({ n: 1 });
    s = { ...s, class: { ...s.class, clock: { ...s.class.clock, startedAt: NOW - 60_000 }, phase: 'between' } };
    s = T(s, { type: 'startRound' });
    s = T(s, { type: 'openWorksheet', ids: ['W02'] });
    expect(s.class.phase).toBe('round');
    expect(s.class.worksheet.pending).toEqual([['W02']]);
    s = T(s, { type: 'endRound' });
    expect(s.class.phase).toBe('worksheet');
    s = T(s, { type: 'closeWorksheet' });
    expect(s.class.phase).toBe('between');
  });

  it("라운드 사이(between): 열고 닫으면 'between'", () => {
    let s = makeSession({ n: 1 });
    s = { ...s, class: { ...s.class, clock: { ...s.class.clock, startedAt: NOW - 60_000 }, phase: 'between' } };
    s = T(s, { type: 'openWorksheet', ids: ['W01'] });
    expect(s.class.phase).toBe('worksheet');
    expect(T(s, { type: 'closeWorksheet' }).class.phase).toBe('between');
  });

  it("무역 시작 전에 연 팝업이 떠 있는 채 무역을 시작하면, 닫을 때 'between'", () => {
    let s = makeSession({ n: 1 });
    s = T(s, { type: 'openWorksheet', ids: ['W19'] });
    s = { ...s, class: { ...s.class, clock: { ...s.class.clock, startedAt: NOW } } };
    expect(T(s, { type: 'closeWorksheet' }).class.phase).toBe('between');
  });

  it("마무리(wrapup): 열고 닫아도 'wrapup' 그대로", () => {
    let s = makeSession({ n: 1 });
    s = { ...s, class: { ...s.class, clock: { ...s.class.clock, startedAt: NOW - 60_000 }, phase: 'between' } };
    s = T(s, { type: 'endTrade' });
    expect(s.class.phase).toBe('wrapup');
    s = T(s, { type: 'openWorksheet', ids: ['W18'] });
    expect(s.class.phase).toBe('wrapup');
    expect(s.class.worksheet.current).toEqual(['W18']);
    s = T(s, { type: 'closeWorksheet' });
    expect(s.class.phase).toBe('wrapup');
    expect(s.class.worksheet.current).toBeNull();
  });

  it("'학습지 팝업 끄기'는 떠 있는 팝업(+그 뒤 예약)도 닫는다", () => {
    const g0 = teacherGame(['W01']);
    const g = { ...g0, class: { ...g0.class, worksheet: { ...g0.class.worksheet, pending: [['W02']] as WorksheetId[][] } } };
    const sent: TeacherAction[] = [];
    const actions: TeacherActions = { ...demoActions(() => NOW), dispatch: (a) => void sent.push(a as TeacherAction) };
    mount(<WorksheetPanel game={g} view={viewOf(g)} actions={actions} now={NOW} />);
    act(() => {
      byTest('ws-off')[0]!.dispatch('click');
    });
    // (작업 114) 떠 있는 팝업과 예약을 한 번에 닫는다(closeWorksheet all)
    expect(sent.filter((a) => a.type === 'closeWorksheet')).toEqual([{ type: 'closeWorksheet', all: true }]);
    let s: HostSnapshot = g;
    for (const a of sent) s = T(s, a);
    expect(s.class.worksheet.current).toBeNull();
    expect(s.class.worksheet.pending).toEqual([]);
    expect(s.class.settings.worksheetMode).toBe('off');
  });

  it("(작업 114) 라운드 중 예약만 걸린 팝업도 '학습지 팝업 끄기'로 취소된다", () => {
    const g0 = teacherGame(['W01']);
    const g = { ...g0, class: { ...g0.class, phase: 'round' as const, worksheet: { ...g0.class.worksheet, current: null, pending: [['W02']] as WorksheetId[][] } } };
    const sent: TeacherAction[] = [];
    const actions: TeacherActions = { ...demoActions(() => NOW), dispatch: (a) => void sent.push(a as TeacherAction) };
    mount(<WorksheetPanel game={g} view={viewOf(g)} actions={actions} now={NOW} />);
    act(() => {
      byTest('ws-off')[0]!.dispatch('click');
    });
    expect(sent.filter((a) => a.type === 'closeWorksheet')).toEqual([{ type: 'closeWorksheet', all: true }]);
    let s: HostSnapshot = g;
    for (const a of sent) s = T(s, a);
    expect(s.class.worksheet.pending).toEqual([]);
  });

  it('개인(다시 보낸) 팝업은 차단형 사건 카드 중에는 뜨지 않는다', () => {
    let s = snapWith([]);
    s = { ...s, class: { ...s.class, phase: 'between', worksheet: { ...s.class.worksheet, current: null } } };
    s = T(s, { type: 'resendWorksheet', seat: 1, wId: 'W02' });
    mountStudent({ ...s, class: { ...s.class, phase: 'event' } }, 1);
    expect(byTest('worksheet-popup')).toHaveLength(0);
    mountStudent(s, 1);
    expect(byTest('worksheet-popup')).toHaveLength(1);
  });
});

describe("(작업 132) 지금 쓰기 ③★·⑭★ 팝업", () => {
  /** 지금 쓰기 팝업이 떠 있는 판 */
  function duringSnap(id: WorksheetId, o: { afterNews?: boolean; mode?: 'after' | 'stageEnd'; scope?: ('L1' | 'L4')[] } = {}): HostSnapshot {
    const s = snapWith([id], { waitSec: 0, scope: o.scope });
    const stage = id === 'W14' ? 'L4' : 'L1';
    return {
      ...s,
      class: {
        ...s.class,
        stage,
        worksheet: { ...s.class.worksheet, during: true, afterNews: o.afterNews ?? false },
        schedule: {
          ...s.class.schedule,
          stageModes: { [stage]: o.mode ?? 'after' },
          items: [{ id: `wsd:${id}`, kind: 'worksheet', refId: id, refIds: [id], placement: 'during', stage, at: 0, durSec: 40, form: 'full', status: 'live' }],
        },
      },
    };
  }

  it('머리말 "잠깐! ③★ 지금 써요" + during.prompt + "나머지 칸은 끝나고 써요", [다 썼어요] → during:true', () => {
    const snap = duringSnap('W03');
    const actFn = mountStudent(snap, 1, () => NOW + 1000);
    expect(byTest('worksheet-popup')[0]!.getAttribute('data-during')).toBe('1');
    expect(text(byTest('worksheet-head')[0])).toBe('잠깐! ③★ 지금 써요');
    expect(text(byTest('worksheet-prompt')[0])).toBe('지금 써요! 두 나라가 잘 만드는 것을 바꾸었더니 무엇이 좋아졌는지 ③의 2번 칸에 한 문장으로 써요.');
    expect(text(byTest('worksheet-pages')[0])).toBe('교과서 98~99쪽');
    expect(text(byTest('worksheet-helper')[0])).toContain('[내 기록:');
    expect(text(byTest('worksheet-during-rest')[0])).toBe('나머지 칸은 끝나고 써요');
    expect(byTest('worksheet-order')).toHaveLength(0); // (작업 153) ★ 팝업에는 '오늘 학습지' 줄 없음
    act(() => {
      byTest('worksheet-done')[0]!.dispatch('click');
    });
    expect(actFn).toHaveBeenCalledWith({ type: 'markWorksheetDone', ids: ['W03'], during: true });
  });

  it('⑭★: 구간 끝 방식이면 "나머지 칸은 구간 끝에 써요", 보도와 같은 라운드면 문구 뒤에 덧붙임', () => {
    const snap = duringSnap('W14', { afterNews: true, mode: 'stageEnd', scope: ['L4'] });
    mountStudent(snap);
    expect(text(byTest('worksheet-head')[0])).toBe('잠깐! ⑭★ 지금 써요');
    expect(text(byTest('worksheet-prompt')[0])).toBe('지금 써요! 베트남 공장을 그렇게 결정한 까닭을 ⑭의 2번 칸에 한 줄로 써요. 보도를 보기 전의 생각을 떠올려 써요.');
    expect(text(byTest('worksheet-during-rest')[0])).toBe('나머지 칸은 구간 끝에 써요');
  });

  it('★ 칸을 다 썼어도 ③ 번호는 끝나지 않는다(allDone 은 종류별)', () => {
    let snap = duringSnap('W03');
    const r = applyAction(snap.class, snap.players[seatKey(1)], { type: 'markWorksheetDone' });
    snap = { ...snap, players: { ...snap.players, [seatKey(1)]: r.player } };
    const me = playerView(snap.players[seatKey(1)]);
    expect(me.game.duringDone).toEqual(['W03']);
    expect(allDone(me, ['W03'], true)).toBe(true);
    expect(allDone(me, ['W03'])).toBe(false);
  });

  it('교사 패널: 지금 쓰기 완료 현황은 ★ 완료로, 완료율 표에 ③★ 줄이 따로', () => {
    let g = { ...duringSnap('W03'), screenScene: 'auto', wrapProgress: {} } as TeacherGame;
    const r = applyAction(g.class, g.players[seatKey(1)], { type: 'markWorksheetDone' });
    g = { ...g, players: { ...g.players, [seatKey(1)]: r.player } };
    expect(popupProgress(g, [{ seat: 1, companyName: '해오름1' }, { seat: 2, companyName: '해오름2' }])).toMatchObject({ during: true, done: 1, total: 2 });
    const l1 = completionGroups(g).find((x) => x.lesson === 'L1')!;
    expect(l1.rows.map((x) => x.label)).toEqual(['①', '②', '③', '③★', '④']);
    expect(l1.rows.find((x) => x.label === '③★')).toMatchObject({ done: 1, total: 2, during: true });
    expect(l1.rows.find((x) => x.label === '③')).toMatchObject({ done: 0 });
    mount(<WorksheetPanel game={g} view={viewOf(g)} actions={demoActions(() => NOW)} now={NOW} />);
    expect(byTest('ws-now')[0]!.getAttribute('data-during')).toBe('1');
    expect(text(byTest('ws-now')[0])).toContain('③★ 지금 바로 쓰기');
    const star = byTest('ws-rate-during');
    expect(star).toHaveLength(1);
    expect(text(star[0])).toContain('③★ 1/2');
    // 판에 지금 쓰기가 없으면 ★ 줄도 없다
    const plain = teacherGame(['W01']);
    expect(completionGroups(plain).flatMap((x) => x.rows).some((x) => x.during)).toBe(false);
  });

  it('공용 화면: "잠깐! ③★ 지금 써요" + ★ 완료 수', () => {
    let g = { ...duringSnap('W03'), screenScene: 'auto', wrapProgress: {} } as TeacherGame;
    const r = applyAction(g.class, g.players[seatKey(2)], { type: 'markWorksheetDone' });
    g = { ...g, players: { ...g.players, [seatKey(2)]: r.player } };
    const d = parseScreenData(publicView(g), screenView(g))!;
    mount(<WorksheetScene d={d} now={NOW} code="482137" address={{ display: 'x', url: 'x' }} />);
    expect(text(byTest('ws-title')[0])).toBe('잠깐! ③★ 지금 써요');
    expect(text(byTest('ws-done-count')[0])).toBe('1/2');
  });
});

describe('(작업 153) 팝업 "오늘 학습지 순서" 한 줄', () => {
  const orderOf = () => {
    const el = byTest('worksheet-order')[0];
    return { text: text(el), bold: el ? el.find((x) => (x as unknown as { tagName?: string }).tagName?.toLowerCase() === 'b').map((b) => text(b)) : [] };
  };
  const doneSnap = (s: HostSnapshot, ids: WorksheetId[]) => {
    const k = seatKey(1);
    return { ...s, players: { ...s.players, [k]: { ...s.players[k], game: { ...s.players[k].game, worksheetDone: [...s.players[k].game.worksheetDone, ...ids] } } } };
  };

  it('2차시 ⑤ 팝업: "오늘 학습지: ⑤ 지금 → ⑥ → ⑦ → ⑧"(⑤ 굵게)', () => {
    mountStudent(snapWith(['W05'], { scope: ['L2'] }));
    expect(orderOf()).toEqual({ text: '오늘 학습지: ⑤ 지금 → ⑥ → ⑦ → ⑧', bold: ['⑤ 지금'] });
  });

  it('⑤를 쓴 뒤 ⑥ 팝업: "오늘 학습지: ⑤✓ → ⑥ 지금 → ⑦ → ⑧"', () => {
    mountStudent(doneSnap(snapWith(['W06'], { scope: ['L2'] }), ['W05']));
    expect(orderOf()).toEqual({ text: '오늘 학습지: ⑤✓ → ⑥ 지금 → ⑦ → ⑧', bold: ['⑥ 지금'] });
  });

  it('1차시 ① 팝업: "오늘 학습지: ① 지금 → ② → ③ → ④"', () => {
    mountStudent(snapWith(['W01']));
    expect(orderOf().text).toBe('오늘 학습지: ① 지금 → ② → ③ → ④');
  });

  it('묶음 팝업이면 지금 번호가 모두 굵게', () => {
    mountStudent(snapWith(['W01', 'W02', 'W03', 'W04']));
    expect(orderOf()).toEqual({ text: '오늘 학습지: ① 지금 → ② 지금 → ③ 지금 → ④ 지금', bold: ['① 지금', '② 지금', '③ 지금', '④ 지금'] });
  });

  // (작업 154) 2차시 나눠 고르기: 고른 시간의 번호만
  const withPart = (s: HostSnapshot, part: 'front' | 'back'): HostSnapshot => ({ ...s, class: { ...s.class, settings: { ...s.class.settings, lessonPart: part } } });
  it('2차시 앞 시간 ⑤ 팝업: "오늘 학습지: ⑤ 지금 → ⑥"(v0.3.9)', () => {
    mountStudent(withPart(snapWith(['W05'], { scope: ['L2'] }), 'front'));
    expect(orderOf()).toEqual({ text: '오늘 학습지: ⑤ 지금 → ⑥', bold: ['⑤ 지금'] });
  });
  it('2차시 뒤 시간 ⑦ 팝업: "오늘 학습지: ⑦ 지금 → ⑧"(v0.3.9)', () => {
    mountStudent(withPart(snapWith(['W07'], { scope: ['L2'] }), 'back'));
    expect(orderOf()).toEqual({ text: '오늘 학습지: ⑦ 지금 → ⑧', bold: ['⑦ 지금'] });
  });
  it('worksheetOrderParts: 앞 시간 → ⑤⑥만, 단원 한 판은 거르지 않음(v0.3.9)', () => {
    const me = playerView(snapWith(['W05'], { scope: ['L2'] }).players[seatKey(1)]);
    expect(worksheetOrderParts(me, ['W05'], { playUnit: 'lesson', scope: ['L2'], lessonPart: 'front' }).map((x) => x.id)).toEqual(['W05', 'W06']);
    expect(worksheetOrderParts(me, ['W05'], { playUnit: 'unit', scope: ['L1', 'L2', 'L3', 'L4'], lessonPart: 'front' }).map((x) => x.id)).toEqual(['W05', 'W06', 'W07', 'W08']);
  });

  it("마무리 '끝나고 쓰기' 목록에는 없다", () => {
    const s = snapWith([], { phase: 'wrapup' });
    mountStudent({ ...s, class: { ...s.class, worksheet: { ...s.class.worksheet, current: null } } });
    expect(byTest('worksheet-order')).toHaveLength(0);
  });
});
