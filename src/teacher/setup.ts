/**
 * 판 설정(T01 다음 화면) 값·기억·미리보기 입력·[방 열기] 비활성 이유 — 순수 함수 (작업 109, PRD 4.1.1·7.5·7.5.1).
 *
 * 기억(`voyage.teacher.prefs`, 교사 localStorage): 마지막 판 단위·차시·무역 시간·설정값만. 학생 정보는 넣지 않는다.
 */
import { previewSchedule, type IncidentFreq, type ItemForm, type PlayUnit, type SchedulePreview, type TopN, type WorksheetPlacement } from '../core';
import { leaderboardRules } from '../data/awards';
import { eventsById } from '../data/events';
import { lessons, lessonsById } from '../data/lessons';
import { activityRatio as RATIO, FULL_UNIT_READY, incidentCountRule, playUnits, READY_LESSONS_BEFORE_FULL, tradeMinutes as TRADE_MINUTES } from '../data/schedule';
import type { LessonId } from '../data/types';
import { canOpenRoom, type RoomStatus } from '../ui/common/server-status';

export const PREFS_KEY = 'voyage.teacher.prefs';
export const ALL_LESSONS: readonly LessonId[] = ['L1', 'L2', 'L3', 'L4'];

export interface SetupValues {
  /** 판 단위(기본 선택 없음) */
  playUnit: PlayUnit | null;
  /** 차시 한 판의 차시 */
  lesson: LessonId | null;
  /** (고급) 연속 구간 */
  customScope: LessonId[];
  className: string;
  tradeMinutes: number;
  activityRatio: number;
  worksheetMode: 'auto' | WorksheetPlacement;
  incidentFreq: IncidentFreq;
  comeback: boolean;
  leaderboardTopN: TopN;
  progressMode: 'auto' | 'manual';
  /** 미리보기 [넣기/짧게/빼기](사건 ID → 형태) — 기억하지 않는다(판마다 다름) */
  overrides: Record<string, ItemForm>;
}

export function defaultSetup(): SetupValues {
  return {
    playUnit: null,
    lesson: null,
    customScope: ['L1', 'L2'],
    className: '',
    tradeMinutes: TRADE_MINUTES.default,
    activityRatio: RATIO.default,
    worksheetMode: 'auto',
    incidentFreq: incidentCountRule.default,
    comeback: true,
    leaderboardTopN: leaderboardRules.topNDefault as TopN,
    progressMode: 'auto',
    overrides: {},
  };
}

/**
 * (작업 134) 개발·시험용으로 기능 플래그를 이 브라우저에서만 켜는 열쇠(localStorage 값 '1').
 * 교사 화면에는 드러내지 않는다 — 단원 판 e2e 등이 L2~L4 화면을 계속 시험하도록.
 */
export const DEV_FULL_UNIT_KEY = 'voyage.dev.fullUnit';

/** 단원 전체 한 판·L2~L4를 고를 수 있는가(기능 플래그 `FULL_UNIT_READY`, 데이터 schedule.ts) */
export function fullUnitReady(): boolean {
  if (FULL_UNIT_READY) return true;
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(DEV_FULL_UNIT_KEY) === '1';
  } catch {
    return false;
  }
}

/** 기능 플래그상 고를 수 있는 차시인가 */
export function lessonReleased(id: LessonId): boolean {
  return fullUnitReady() || READY_LESSONS_BEFORE_FULL.includes(id);
}

/** '준비 중' 안내(판 설정 화면) */
export const NOT_READY_TEXT = '준비 중 — L2~L4 활동을 만들고 있어요. 지금은 차시 L1만 할 수 있어요';

/** 구현이 끝난 차시인가(기능 플래그로 열렸고, 데이터에 본문 'TODO'인 사건이 없으면 구현됨) — 아니면 회색 "준비 중" */
export function lessonImplemented(id: LessonId): boolean {
  if (!lessonReleased(id)) return false;
  const l = lessonsById[id];
  if (!l) return false;
  return l.eventQueue.every((eid) => {
    const e = eventsById[eid];
    return !e || e.body !== 'TODO';
  });
}

export function implementedLessons(): LessonId[] {
  return lessons.map((l) => l.id).filter(lessonImplemented);
}

/** 판 단위 → 학습 범위(없으면 null) */
export function scopeOf(v: SetupValues): LessonId[] | null {
  if (v.playUnit === 'unit') return [...ALL_LESSONS];
  if (v.playUnit === 'lesson') return v.lesson ? [v.lesson] : null;
  if (v.playUnit === 'custom') return v.customScope.length ? [...v.customScope].sort() : null;
  return null;
}

/** 연속 구간인가(L1~L2처럼 빈틈 없이) */
export function isContiguous(scope: readonly LessonId[]): boolean {
  const idx = scope.map((s) => ALL_LESSONS.indexOf(s)).sort((a, b) => a - b);
  return idx.every((v, i) => i === 0 || v === (idx[i - 1] as number) + 1);
}

export type PreviewResult = SchedulePreview | { ok: false; error: string; message: string } | null;

/** 미리보기(판 단위를 고르기 전에는 null) */
export function previewOf(v: SetupValues): PreviewResult {
  const scope = scopeOf(v);
  if (!v.playUnit || !scope) return null;
  if (!isContiguous(scope)) return { ok: false, error: 'BAD_SCOPE', message: '이어지는 구간만 고를 수 있어요' };
  return previewSchedule({
    playUnit: v.playUnit,
    scope,
    tradeMinutes: v.tradeMinutes,
    activityRatio: v.activityRatio,
    worksheetMode: v.worksheetMode,
    overrides: v.overrides,
    letters: true,
    seed: 0,
    incidentFreq: v.incidentFreq,
    comeback: v.comeback,
  });
}

export type DisableReason = { kind: 'unit' | 'time' | 'server'; text: string } | null;

/** [방 열기] 비활성 이유(여러 개면 판 단위 → 시간 → 서버 순서로 하나만, brief v0.3.2 2) */
export function openDisabledReason(v: SetupValues, preview: PreviewResult, rooms: RoomStatus | null | undefined): DisableReason {
  if (!v.playUnit) return { kind: 'unit', text: '판 단위를 먼저 골라 주세요' };
  if (v.playUnit === 'unit' && !fullUnitReady()) return { kind: 'unit', text: '단원 전체 한 판은 아직 준비 중이에요' };
  if (v.playUnit === 'custom' && !v.customScope.every(lessonReleased)) return { kind: 'unit', text: '고른 구간에 아직 준비 중인 차시가 있어요' };
  if (v.playUnit === 'lesson' && !v.lesson) return { kind: 'unit', text: '오늘 할 차시를 골라 주세요' };
  if (v.playUnit === 'lesson' && v.lesson && !lessonImplemented(v.lesson)) return { kind: 'unit', text: '이 차시는 아직 준비 중이에요' };
  if (!preview) return { kind: 'unit', text: '판 단위를 먼저 골라 주세요' };
  if (!preview.ok) return { kind: 'time', text: preview.message || '범위를 줄이거나 시간을 늘려 주세요' };
  if (!canOpenRoom(rooms)) {
    return { kind: 'server', text: rooms?.kind === 'blocked' ? '점검 중이라 새 방을 열 수 없어요' : '서버에 방이 가득 찼어요' };
  }
  return null;
}

/** 무역 시간 값 고치기(5~90분 정수) */
export function clampMinutes(n: number): number {
  if (!Number.isFinite(n)) return TRADE_MINUTES.default;
  return Math.min(TRADE_MINUTES.customMax, Math.max(TRADE_MINUTES.customMin, Math.round(n)));
}

/** 판 단위를 고를 때 무역 시간 기본값(데이터 `playUnits`) */
export function defaultMinutesFor(u: PlayUnit): number {
  if (u === 'lesson') return playUnits.lesson.defaultMinutes;
  return playUnits.unit.defaultMinutes;
}

// ─────────────────────────── 기억(prefs) ───────────────────────────

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const PREF_FIELDS = [
  'playUnit',
  'lesson',
  'customScope',
  'className',
  'tradeMinutes',
  'activityRatio',
  'worksheetMode',
  'incidentFreq',
  'comeback',
  'leaderboardTopN',
  'progressMode',
] as const;

export type TeacherPrefs = Pick<SetupValues, (typeof PREF_FIELDS)[number]>;

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** 저장된 값을 읽어 기본값 위에 얹는다(형식이 틀린 값은 버림) */
export function loadPrefs(storage: StorageLike | null = defaultStorage()): SetupValues {
  const base = defaultSetup();
  let raw: unknown = null;
  try {
    const s = storage?.getItem(PREFS_KEY);
    raw = s ? JSON.parse(s) : null;
  } catch {
    raw = null;
  }
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Record<string, unknown>;
  const out: SetupValues = { ...base };
  if (r.playUnit === 'lesson' || r.playUnit === 'unit' || r.playUnit === 'custom') out.playUnit = r.playUnit;
  if (typeof r.lesson === 'string' && (ALL_LESSONS as readonly string[]).includes(r.lesson)) out.lesson = r.lesson as LessonId;
  if (Array.isArray(r.customScope)) {
    const cs = r.customScope.filter((x): x is LessonId => typeof x === 'string' && (ALL_LESSONS as readonly string[]).includes(x));
    if (cs.length) out.customScope = cs;
  }
  if (typeof r.className === 'string') out.className = r.className.slice(0, 20);
  if (typeof r.tradeMinutes === 'number') out.tradeMinutes = clampMinutes(r.tradeMinutes);
  if (typeof r.activityRatio === 'number' && RATIO.options.some((o) => o.value === r.activityRatio)) out.activityRatio = r.activityRatio;
  if (typeof r.worksheetMode === 'string' && ['auto', 'each', 'stageEnd', 'after', 'off'].includes(r.worksheetMode)) {
    out.worksheetMode = r.worksheetMode as SetupValues['worksheetMode'];
  }
  if (r.incidentFreq === 'off' || r.incidentFreq === 'some' || r.incidentFreq === 'often') out.incidentFreq = r.incidentFreq;
  if (typeof r.comeback === 'boolean') out.comeback = r.comeback;
  if (typeof r.leaderboardTopN === 'number' && (leaderboardRules.topNOptions as readonly number[]).includes(r.leaderboardTopN)) {
    out.leaderboardTopN = r.leaderboardTopN as TopN;
  }
  if (r.progressMode === 'auto' || r.progressMode === 'manual') out.progressMode = r.progressMode;
  // 차시를 기억했지만 지금은 준비 중이면 고르지 않은 상태로
  if (out.lesson && !lessonImplemented(out.lesson)) out.lesson = null;
  // (작업 134) 단원 한 판·준비 중 차시가 든 연속 구간을 기억했으면 판 단위를 고르지 않은 상태로
  if ((out.playUnit === 'unit' && !fullUnitReady()) || (out.playUnit === 'custom' && !out.customScope.every(lessonReleased))) out.playUnit = null;
  return out;
}

/** 지금 값을 기억(학생 정보 없음 — 판 단위·차시·시간·설정만) */
export function savePrefs(v: SetupValues, storage: StorageLike | null = defaultStorage()): void {
  const p: Record<string, unknown> = {};
  for (const k of PREF_FIELDS) p[k] = v[k];
  try {
    storage?.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* 저장 못 해도 판은 열린다 */
  }
}
