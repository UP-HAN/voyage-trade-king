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
  type AwardResult,
  type PublicWrap,
  type WrapItem,
} from '../core';
import { metrics as METRICS, type MetricId } from '../data/awards';
import { playUnits } from '../data/schedule';
import type { LessonId } from '../data/types';
import type { JsonObject } from '@shared/protocol';
import { assertNoSeatInPublic } from '../sync/app-messages';
import { hasBadWord, looksLikePersonalInfo, validateCompanyName } from '../sync/company-name';
import { publicCompanyName } from '../core/scoring';
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

/** (작업 174) 잡지 표지를 어디에 쓰나: 종이(교과서 112~113쪽·학습지 ⑰) / 게임 */
export type MagazineMode = 'paper' | 'game';
/** (작업 174, 교사 확정 2026-10-30·PRD 16.2-2) 무역 시간이 이 값(분) 이상이면 잡지 표지 기본이 '게임에서 써요', 아니면 '종이' */
export const MAGAZINE_GAME_MIN_MINUTES = 40;
/** (작업 174) 마무리 항목이 시작될 때 코어에서 함께 발동하는 사건(학생 응답을 받는 것만 — 결산·시상 L4-E7은 응답이 없어 그대로) */
export const WRAP_FIRE_EVENTS: ReadonlySet<string> = new Set(['L4-E6', 'L4-E8', 'L4-E9']);

export type TeacherGame = HostSnapshot & {
  /** 공용 화면 장면(교사 선택). 없으면 'auto' */
  screenScene?: ScreenScene;
  /** 마무리 항목 진행(WrapItem id → 상태). 내용 화면은 118·112 */
  wrapProgress?: Record<string, WrapStepStatus>;
  /** (작업 137) 마무리 첫 항목을 저절로 시작했는가(새로 고침 뒤 두 번 시작하지 않게) */
  wrapAutoStarted?: boolean;
  /** (작업 174) 시상식에서 공개한 상 수(수상 회사가 있는 상, 발표 순서 `AWARD_ORDER`). 없으면 0 */
  awardsShown?: number;
  /**
   * (작업 178) 시상 결과 고정: 시상식 [첫 상 공개]를 누르는 순간(시상식을 건너뛰었으면 수업을 끝낼 때) 상 목록을 저장한다.
   * 이후 TV·학생·끝 화면·결과 파일의 상은 이 목록을 쓴다(잡지 표지 +10 등 뒤에 바뀐 지표 값은 지표 칸에만 남음).
   */
  awardsFrozen?: AwardResult[] | null;
  /** (작업 174) 컨테이너 싣기 문장별 정답률을 TV에 보였는가([결과 보기]) */
  containersResult?: boolean;
  /** (작업 174) 잡지 표지를 어디에 쓰나(교사가 고름). 없으면 무역 시간으로 기본값(`magazineModeOf`) */
  magazineMode?: MagazineMode;
  /** (작업 174) TV 갤러리에 크게 보일 표지(교사가 고른 회사 pid). 고르기 전에는 글을 공개 상태에 싣지 않는다 */
  coverPick?: string | null;
};

/** 교사 화면 전용 행동(103 TeacherAction 밖 — 이 파일의 리듀서가 처리) */
export type TeacherLocalAction =
  | { type: 'setScreenScene'; scene: ScreenScene }
  | { type: 'setWrapStep'; id: string; status: WrapStepStatus | null }
  | { type: 'setRoomCode'; code: string }
  /** (작업 174) 시상식: 다음 상 공개(마지막 상 다음은 전체 목록) */
  | { type: 'awardNext' }
  /** (작업 174) 컨테이너 싣기 결과(문장별 정답률)를 TV에 보이기/감추기 */
  | { type: 'setContainersResult'; show: boolean }
  /** (작업 174) 잡지 표지: 종이 / 게임 */
  | { type: 'setMagazineMode'; mode: MagazineMode }
  /** (작업 174) TV 갤러리에 보일 표지(pid, null이면 내림) */
  | { type: 'pickCover'; pid: string | null };

const LOCAL_TYPES = new Set(['setScreenScene', 'setWrapStep', 'setRoomCode', 'awardNext', 'setContainersResult', 'setMagazineMode', 'pickCover']);
const PUBLIC_OUT: SessionOutput[] = [{ type: 'teacher', data: { notice: 'WRAP_STEP' } }, { type: 'public' }];

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
      // (작업 174) 진행 중인 항목은 하나만 — 다른 항목을 시작하면 지금 하던 항목은 끝난 것으로(학생 화면·TV·코어 사건이 한 항목을 따르게)
      if (a.status === 'live') for (const [k, v] of Object.entries(wp)) if (v === 'live' && k !== a.id) wp[k] = 'done';
      if (a.status) wp[a.id] = a.status;
      else delete wp[a.id];
      let next: TeacherGame = { ...snapshot, wrapProgress: wp };
      // (작업 174) 시상식을 다시 시작하면 처음 상부터
      if (a.id === 'awards' && a.status === 'live' && snapshot.wrapProgress?.awards !== 'live') next = { ...next, awardsShown: 0 };
      // (작업 132) 학생 마무리 화면이 따르도록 공개 상태도 다시 보낸다. (작업 174) 응답을 받는 항목이면 코어 사건도 함께 발동
      const fired = a.status === 'live' ? fireWrapEvent(next, now) : null;
      if (fired) return { snapshot: fired.snapshot, outputs: [...fired.outputs, ...PUBLIC_OUT] };
      return { snapshot: next, outputs: PUBLIC_OUT };
    }
    if (a.type === 'awardNext') {
      if (snapshot.wrapProgress?.awards !== 'live') return { snapshot, outputs: [] };
      // (작업 178) [첫 상 공개]를 누르는 순간 상 목록을 고정
      const frozen = freezeAwards(snapshot);
      const total = wrapAwardList(frozen).length;
      const cur = Math.max(0, frozen.awardsShown ?? 0);
      // 마지막 상 다음 한 번 더 = 전체 목록(total + 1)
      if (cur > total) return { snapshot: frozen, outputs: frozen === snapshot ? [] : PUBLIC_OUT };
      return { snapshot: { ...frozen, awardsShown: cur + 1 }, outputs: PUBLIC_OUT };
    }
    if (a.type === 'setContainersResult') {
      if (!!snapshot.containersResult === a.show) return { snapshot, outputs: [] };
      return { snapshot: { ...snapshot, containersResult: a.show }, outputs: PUBLIC_OUT };
    }
    if (a.type === 'setMagazineMode') {
      if (a.mode !== 'paper' && a.mode !== 'game') return { snapshot, outputs: [] };
      return { snapshot: { ...snapshot, magazineMode: a.mode, ...(a.mode === 'paper' ? { coverPick: null } : {}) }, outputs: PUBLIC_OUT };
    }
    if (a.type === 'pickCover') {
      const pid = a.pid && Object.values(snapshot.players).some((p) => p.pid === a.pid && coverOf(p)) ? a.pid : null;
      if ((snapshot.coverPick ?? null) === pid) return { snapshot, outputs: [] };
      return { snapshot: { ...snapshot, coverPick: pid }, outputs: PUBLIC_OUT };
    }
    if (a.type === 'setRoomCode') {
      if (snapshot.meta.code === a.code) return { snapshot, outputs: [] };
      return { snapshot: { ...snapshot, meta: { ...snapshot.meta, code: a.code } }, outputs: [] };
    }
  }
  const r = coreReducer(snapshot, input as never, now);
  let next = r.snapshot as TeacherGame;
  // (작업 178) 시상식을 건너뛰었거나 공개하지 않고 수업을 끝내면 끝낼 때 상 목록을 고정
  if (next.class.phase === 'ended' && snapshot.class.phase !== 'ended' && next.class.tradeEnded) next = freezeAwards(next);
  const outputs = r.outputs as unknown as SessionOutput[];
  // (작업 137, PRD 7.5.2.9) 무역 시간이 끝나 마무리 단계가 되는 순간 첫 마무리 항목을 저절로 시작한다(한 번만)
  const auto = autoStartWrap(snapshot, next);
  if (auto) {
    // (작업 174) 첫 항목이 응답을 받는 활동(4차시 마무리의 컨테이너 싣기)이면 코어 사건도 함께 발동
    const fired = fireWrapEvent(auto, now);
    if (fired) return { snapshot: fired.snapshot, outputs: [...outputs, ...fired.outputs, ...PUBLIC_OUT] };
    return { snapshot: auto, outputs: [...outputs, ...PUBLIC_OUT] };
  }
  return { snapshot: next, outputs };
};

/**
 * (작업 174) 지금 진행 중인 마무리 항목이 학생 응답을 받는 활동(L4-E6·L4-E8·L4-E9)이고 아직 발동하지 않았으면 코어 `fireEvent`를 보낸다.
 * 호스트 상태(`firedEvents`·`currentEvent`)에 남으므로 새로 고침·늦은 입장·복구에도 이어진다. 이미 발동했으면 null(다시 보내지 않음).
 * 마무리 단계(`tradeEnded`)에서 발동해도 단계는 'wrapup' 그대로(core lesson.ts fire 규칙).
 */
export function fireWrapEvent(g: TeacherGame, now: number): { snapshot: TeacherGame; outputs: SessionOutput[] } | null {
  if (!g.class.tradeEnded || g.class.phase !== 'wrapup') return null;
  const live = liveWrapStep(g);
  const item = (g.class.schedule.wrapup ?? []).find((w) => w.id === live);
  const id = item?.eventId;
  if (!id || !WRAP_FIRE_EVENTS.has(id) || g.class.firedEvents.includes(id)) return null;
  const r = coreReducer(g, { type: 'teacher', action: { type: 'fireEvent', id } } as never, now);
  const snap = r.snapshot as TeacherGame;
  if (!snap.class.firedEvents.includes(id)) return null;
  return { snapshot: snap, outputs: r.outputs as unknown as SessionOutput[] };
}

/** (작업 174) 시상식 상 목록(수상 회사가 있는 상만, 발표 순서). (작업 178) 고정했으면 고정한 목록 */
export function wrapAwardList(g: TeacherGame): AwardResult[] {
  if (Array.isArray(g.awardsFrozen)) return g.awardsFrozen;
  return computeAwards(Object.values(g.players), {
    perPrize: g.class.settings.awardsPerPrize,
    hideFlatMetrics: g.meta.playUnit === 'lesson',
    off: g.class.settings.awardsOff,
    nameReview: g.class.settings.nameReview,
  }).filter((a) => a.winners.length > 0);
}

/** (작업 178) 상 목록 고정(이미 고정했으면 그대로) */
export function freezeAwards(g: TeacherGame): TeacherGame {
  if (Array.isArray(g.awardsFrozen)) return g;
  return { ...g, awardsFrozen: wrapAwardList(g) };
}

/**
 * (작업 174) 학생·TV가 볼 수 있는 상 수. 시상식(awards)이 진행 중이면 교사가 공개한 만큼, 시상식을 끝냈거나 건너뛰었으면 전부,
 * 아직 시작 전이면 0(미리 보이지 않게).
 */
export function awardsRevealed(g: TeacherGame): number {
  const st = g.wrapProgress?.awards;
  const total = wrapAwardList(g).length;
  if (st === 'live') return Math.min(total, Math.max(0, g.awardsShown ?? 0));
  if (st === 'done' || st === 'skipped' || g.class.phase === 'ended') return total;
  return 0;
}

/** (작업 174) 시상식 전체 목록 단계인가(마지막 상 다음 [전체 목록 보기]를 눌렀거나, 시상식을 끝냈·건너뛰었음) */
export function awardsListShown(g: TeacherGame): boolean {
  const st = g.wrapProgress?.awards;
  if (st === 'live') return Math.max(0, g.awardsShown ?? 0) > wrapAwardList(g).length;
  return st === 'done' || st === 'skipped' || g.class.phase === 'ended';
}

/** (작업 174) 잡지 표지 방식: 교사가 고른 것, 없으면 무역 시간 40분 이상 = 게임, 미만 = 종이 */
export function magazineModeOf(g: Pick<TeacherGame, 'magazineMode' | 'class'>): MagazineMode {
  if (g.magazineMode === 'paper' || g.magazineMode === 'game') return g.magazineMode;
  return (g.class.settings.tradeMinutes ?? 0) >= MAGAZINE_GAME_MIN_MINUTES ? 'game' : 'paper';
}

/** (작업 174) 학생이 게임에서 쓴 잡지 표지(없으면 null) */
export function coverOf(p: { game: { cover?: unknown; responses: Record<string, unknown> } }): { fields: string[]; bg: number } | null {
  const c = p.game.cover as { fields?: unknown; bg?: unknown } | null | undefined;
  if (!c || typeof c !== 'object' || !Array.isArray(c.fields) || p.game.responses['L4-E8'] === undefined) return null;
  const bg = Number(c.bg);
  return { fields: c.fields.map((f) => String(f ?? '')), bg: Number.isInteger(bg) && bg >= 1 && bg <= 3 ? bg : 1 };
}

/** (작업 174) 표지를 다 쓴 학생(출석번호 순 — 교사 화면 전용) */
export function writtenCovers(g: TeacherGame) {
  return Object.values(g.players)
    .filter((p) => coverOf(p))
    .sort((a, b) => a.seat - b.seat);
}

/** (작업 174) [다음 표지 TV에]: 지금 고른 표지 다음(끝이면 처음) 학생 pid. 다 쓴 표지가 없으면 null */
export function nextCoverPid(g: TeacherGame): string | null {
  const list = writtenCovers(g);
  if (!list.length) return null;
  const i = list.findIndex((p) => p.pid === g.coverPick);
  return list[(i + 1) % list.length].pid;
}

/**
 * (작업 178) 단위가 붙은 숫자(연도·금액·수량 — "2030년", "1000만 원", "5000개")는 개인정보 형태(숫자 4자리 이상) 검사에서 뺀다.
 * 전화번호·학번처럼 단위 없는 숫자 덩어리는 그대로 걸린다.
 */
const UNIT_NUMBER = /\d{4,}(?=\s*(?:년|만|억|원|개|명|상자|톤|대|%|퍼센트))/g;

/** (작업 174) TV에 올리는 학생 글: 회사 이름 금칙어·개인정보 형태 검사와 같은 검사에 걸리면 '***' */
export function screenSafeText(s: string, extraWords: readonly string[] = []): string {
  const t = String(s ?? '').trim();
  if (!t) return '';
  return hasBadWord(t, extraWords) || looksLikePersonalInfo(t.replace(UNIT_NUMBER, '0')) ? '***' : t;
}

/** (작업 178) 이 글이 TV에서 가려지는가(교사 고르기 목록 표시용) */
export function hiddenOnScreen(s: string, extraWords: readonly string[] = []): boolean {
  return screenSafeText(s, extraWords) === '***';
}

/** (작업 174) 공개 상태에 싣는 마무리 정보(교사 화면 전용 진행 값에서) */
export type WrapPublic = PublicWrap;

export function wrapPublic(g: TeacherGame): WrapPublic {
  const pick = g.coverPick ? Object.values(g.players).find((p) => p.pid === g.coverPick) : undefined;
  const cv = pick ? coverOf(pick) : null;
  const extra = g.class.settings.extraBannedWords ?? [];
  const mode = magazineModeOf(g);
  return {
    awardsShown: awardsRevealed(g),
    awardsTotal: wrapAwardList(g).length,
    awardsList: awardsListShown(g),
    containersResult: !!g.containersResult,
    magazineMode: mode,
    cover:
      pick && cv && mode === 'game'
        ? {
            pid: pick.pid,
            company: publicCompanyName(pick, g.class.settings.nameReview),
            flag: { color: pick.company.color, emblem: pick.company.emblem },
            fields: cv.fields.map((f) => screenSafeText(f, extra)),
            bg: cv.bg,
          }
        : null,
  };
}

/** 마무리 단계 중 저절로 시작할 첫 항목(내용이 있는 첫 항목 — 0분짜리 '마지막 라운드 정산'은 끝난 것으로 둔다) */
export function firstWrapStep(items: readonly WrapItem[]): WrapItem | null {
  return items.find((w) => w.id !== 'settle') ?? null;
}

/**
 * (작업 137) 마무리 첫 항목 자동 시작 — 호스트 상태(스냅숏)로 처리한다.
 * 무역이 끝나는 바로 그 입력(틱의 시간 끝·[지금 마무리로]·계획 끝)에서만 일어나고, 표시(`wrapAutoStarted`)를 남겨
 * 새로 고침·복구(스냅숏 다시 읽기) 뒤에 두 번 시작하지 않는다. 교사가 이미 무엇이든 시작했으면 건드리지 않는다.
 */
export function autoStartWrap(prev: TeacherGame, next: TeacherGame): TeacherGame | null {
  if (next.wrapAutoStarted || prev.class.tradeEnded || !next.class.tradeEnded || next.class.phase !== 'wrapup') return null;
  const items = next.class.schedule.wrapup ?? [];
  const first = firstWrapStep(items);
  const wp = { ...(next.wrapProgress ?? {}) };
  if (Object.values(wp).some((v) => v === 'live')) return { ...next, wrapAutoStarted: true };
  for (const w of items) {
    if (w === first) break;
    if (!wp[w.id]) wp[w.id] = 'done';
  }
  if (first && !wp[first.id]) wp[first.id] = 'live';
  return { ...next, wrapProgress: wp, wrapAutoStarted: true };
}

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
  const payload = publicPayload(g);
  // (작업 178) 마무리 단계의 공개 상태 상 목록은 고정 목록에서 **공개한 상만**(아직 공개 안 된 상이 학생 기기로 새지 않게)
  if (g.class.tradeEnded) payload.public = { ...payload.public, awards: wrapAwardList(g).slice(0, awardsRevealed(g)) };
  const data = { ...payload, screenScene: g.screenScene ?? 'auto', wrapLive: liveWrapStep(g), ...(g.class.tradeEnded ? { wrap: wrapPublic(g) } : {}) } as unknown as JsonObject;
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
  // (작업 178) 시상식에서 고정한 상(없으면 지금 계산) — TV·학생 화면과 같은 결과
  const prizes = wrapAwardList(g);
  const seatByPid = new Map(players.map((p) => [p.pid, p.seat]));
  const awardsBySeat = new Map<number, string[]>();
  for (const a of prizes) {
    for (const w of a.winners) {
      const seat = seatByPid.get(w.pid);
      if (seat === undefined) continue;
      awardsBySeat.set(seat, [...(awardsBySeat.get(seat) ?? []), a.award]);
    }
  }
  // (작업 176) 개척 = 실제로 사고판 항구 수 — 지난 결과 파일(방문 항구 수)과 섞이지 않게 열 이름을 바꾼다
  const metricList = METRICS.map((m) => ({ key: m.id, label: m.id === 'explore' ? `${m.name}-사고판 항구(${m.unit})` : `${m.name}(${m.unit})` }));
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
