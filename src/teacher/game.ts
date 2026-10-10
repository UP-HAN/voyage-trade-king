/**
 * 교사 화면 = 호스트 (작업 109). 세션(124)에 넣는 게임 상태·리듀서·보기 함수.
 *
 * - 게임 상태는 103의 `HostSnapshot`에 교사 화면 전용 필드 두 개를 더한 것(`TeacherGame`):
 *   `screenScene`(공용 화면 장면 선택), `wrapProgress`(마무리 항목 진행 표시). 103 리듀서는 스냅숏을 펼쳐 복사하므로
 *   두 필드는 그대로 남고, 교사 행동 `setScreenScene`·`setWrapStep`만 이 파일에서 처리한다.
 * - 리듀서 = 103 `createSessionReducer(createTradeHooks({ validateName }))`(123 무역 시계·배치표 훅 + 124 이름 검사).
 *   학급 상태는 반드시 이 리듀서(= hostReduce)로만 바꾼다.
 * - 공개 상태 = 103 `publicPayload` + `screenScene`. 출석번호·자금·응답 명단 없음(개발 모드에서 124 `assertNoSeatInPublic`).
 */
import {
  awards as computeAwards,
  autoRoundSec,
  createSessionReducer,
  createTradeHooks,
  metricValue,
  playerView,
  publicPayload,
  seatKey,
  startSession,
  type ClassSettings,
  type HostSnapshot,
  type ItemForm,
  type PlayUnit,
} from '../core';
import { metrics as METRICS, type MetricId } from '../data/awards';
import { playUnits } from '../data/schedule';
import type { LessonId } from '../data/types';
import type { JsonObject } from '@shared/protocol';
import { assertNoSeatInPublic } from '../sync/app-messages';
import { validateCompanyName } from '../sync/company-name';
import type { SessionInput, SessionOutput, SessionReducer, SessionViews } from '../sync/host-session';
import type { ResultTable } from '../sync/host-store';

/** 공용 화면 장면(PRD 7.5 공용 화면 제어). 'auto' = 현재 사건·상황에 맞게(110이 정함) */
export type ScreenScene = 'auto' | 'leaderboard' | 'map' | 'code' | 'black';
export const SCREEN_SCENES: readonly { id: ScreenScene; label: string }[] = [
  { id: 'auto', label: '자동' },
  { id: 'leaderboard', label: '순위판' },
  { id: 'map', label: '해도' },
  { id: 'code', label: '방 코드' },
  { id: 'black', label: '검은 화면' },
];

export type WrapStepStatus = 'live' | 'done' | 'skipped';

export type TeacherGame = HostSnapshot & {
  /** 공용 화면 장면(교사 선택). 없으면 'auto' */
  screenScene?: ScreenScene;
  /** 마무리 항목 진행(WrapItem id → 상태). 내용 화면은 118·112 */
  wrapProgress?: Record<string, WrapStepStatus>;
};

/** 교사 화면 전용 행동(103 TeacherAction 밖 — 이 파일의 리듀서가 처리) */
export type TeacherLocalAction =
  | { type: 'setScreenScene'; scene: ScreenScene }
  | { type: 'setWrapStep'; id: string; status: WrapStepStatus | null }
  | { type: 'setRoomCode'; code: string };

const LOCAL_TYPES = new Set(['setScreenScene', 'setWrapStep', 'setRoomCode']);

const coreReducer = createSessionReducer(createTradeHooks({ validateName: (raw, o) => validateCompanyName(raw, o) }));

/** 세션(124)에 주입하는 리듀서. 교사 화면 전용 행동만 여기서, 나머지는 모두 103 hostReduce */
export const teacherReducer: SessionReducer<TeacherGame> = (snapshot, input: SessionInput, now) => {
  if (input.type === 'teacher' && LOCAL_TYPES.has(input.action.type)) {
    const a = input.action as unknown as TeacherLocalAction;
    if (a.type === 'setScreenScene') {
      if (!SCREEN_SCENES.some((s) => s.id === a.scene) || snapshot.screenScene === a.scene) return { snapshot, outputs: [] };
      return { snapshot: { ...snapshot, screenScene: a.scene }, outputs: [{ type: 'public' }] };
    }
    if (a.type === 'setWrapStep') {
      const wp = { ...(snapshot.wrapProgress ?? {}) };
      if (a.status) wp[a.id] = a.status;
      else delete wp[a.id];
      // (작업 132) 학생 마무리 화면이 따르도록 공개 상태도 다시 보낸다
      return { snapshot: { ...snapshot, wrapProgress: wp }, outputs: [{ type: 'teacher', data: { notice: 'WRAP_STEP' } }, { type: 'public' }] };
    }
    if (a.type === 'setRoomCode') {
      if (snapshot.meta.code === a.code) return { snapshot, outputs: [] };
      return { snapshot: { ...snapshot, meta: { ...snapshot.meta, code: a.code } }, outputs: [] };
    }
  }
  const r = coreReducer(snapshot, input as never, now);
  return { snapshot: r.snapshot as TeacherGame, outputs: r.outputs as unknown as SessionOutput[] };
};

const isDev = (() => {
  try {
    return !!import.meta.env?.DEV;
  } catch {
    return false;
  }
})();

/** 지금 진행 중(교사가 [시작])인 마무리 단계 ID — 마무리 목록 순서로 첫 번째 */
export function liveWrapStep(g: Pick<TeacherGame, 'wrapProgress' | 'class'>): string | null {
  const wp = g.wrapProgress ?? {};
  const order = (g.class.schedule.wrapup ?? []).map((w) => w.id as string);
  return order.find((id) => wp[id] === 'live') ?? Object.keys(wp).find((id) => wp[id] === 'live') ?? null;
}

/** 공개 상태(학생 전원·공용 화면 공통). 출석번호·개인 자금·응답 명단 없음 */
export function publicView(g: TeacherGame, strict = false): JsonObject {
  const data = { ...publicPayload(g), screenScene: g.screenScene ?? 'auto', wrapLive: liveWrapStep(g) } as unknown as JsonObject;
  if (isDev || strict) assertNoSeatInPublic(data, strict);
  return data;
}

/** 공용 화면에 같이 보내는 학급 보기(공개 정보만) */
export function screenView(g: TeacherGame, strict = false): JsonObject {
  const data: JsonObject = {
    screenScene: g.screenScene ?? 'auto',
    className: g.meta.className,
    playUnit: g.meta.playUnit,
    scope: [...g.meta.scope],
  };
  if (isDev || strict) assertNoSeatInPublic(data, strict);
  return data;
}

export const teacherViews: SessionViews<TeacherGame> = {
  public: (g) => publicView(g),
  me: (g, seat) => {
    const p = g.players[seatKey(seat)];
    return p ? (playerView(p) as unknown as JsonObject) : null;
  },
  screen: (g) => screenView(g),
};

// ─────────────────────────── 새 판 만들기 ───────────────────────────

export interface NewGameInput {
  className: string;
  playUnit: PlayUnit;
  scope: LessonId[];
  tradeMinutes: number;
  settings: Partial<ClassSettings>;
  overrides: Record<string, ItemForm>;
  seed: number;
  now: number;
}

/** 판 설정 → 새 스냅숏(phase 'prep'). 방 코드는 열린 뒤 `setRoomCode`로 채운다 */
export function newTeacherGame(i: NewGameInput): TeacherGame {
  const stageSec = (i.tradeMinutes * 60) / Math.max(1, i.scope.length);
  const snap = startSession({
    code: '',
    className: i.className,
    playUnit: i.playUnit,
    scope: i.scope,
    seed: i.seed,
    now: i.now,
    settings: { ...i.settings, tradeMinutes: i.tradeMinutes, roundSec: autoRoundSec(stageSec) },
  });
  return {
    ...snap,
    class: {
      ...snap.class,
      schedule: { ...snap.class.schedule, overrides: { ...i.overrides }, roundSecAuto: true },
    },
    screenScene: 'auto',
    wrapProgress: {},
  };
}

// ─────────────────────────── 결과 파일 ───────────────────────────

export function playUnitLabel(u: PlayUnit): string {
  if (u === 'lesson') return playUnits.lesson.label;
  if (u === 'unit') return playUnits.unit.label;
  return '연속 구간';
}

export function scopeLabel(scope: readonly LessonId[]): string {
  if (scope.length === 0) return '';
  if (scope.length === 1) return scope[0] as string;
  return `${scope[0]}~${scope[scope.length - 1]}`;
}

/** 결과 표(PRD 10.7, v0.3.1): 출석번호·회사 이름은 세션이 붙이고 여기서는 지표와 상만. 실명 없음 */
export function resultTableOf(g: TeacherGame): ResultTable {
  const players = Object.values(g.players);
  const prizes = computeAwards(players, {
    perPrize: g.class.settings.awardsPerPrize,
    hideFlatMetrics: g.meta.playUnit === 'lesson',
    off: g.class.settings.awardsOff,
  });
  const seatByPid = new Map(players.map((p) => [p.pid, p.seat]));
  const awardsBySeat = new Map<number, string[]>();
  for (const a of prizes) {
    for (const w of a.winners) {
      const seat = seatByPid.get(w.pid);
      if (seat === undefined) continue;
      awardsBySeat.set(seat, [...(awardsBySeat.get(seat) ?? []), a.award]);
    }
  }
  const metricList = METRICS.map((m) => ({ key: m.id, label: `${m.name}(${m.unit})` }));
  return {
    playUnit: playUnitLabel(g.meta.playUnit),
    scope: scopeLabel(g.meta.scope),
    metrics: metricList,
    rows: players.map((p) => ({
      seat: p.seat,
      values: Object.fromEntries(
        METRICS.map((m) => {
          const v = metricValue(p, m.id as MetricId);
          return [m.id, Number.isFinite(v) ? Math.round(v * 100) / 100 : null];
        }),
      ),
      awards: awardsBySeat.get(p.seat) ?? [],
    })),
  };
}
