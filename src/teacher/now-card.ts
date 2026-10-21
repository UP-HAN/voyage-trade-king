/**
 * '지금 할 일' 카드 상태 계산 — 순수 함수 (작업 137, PRD 7.5.2.1·7.5.2.7).
 *
 * 입력(판 스냅숏·세션 보기·지금 시각·화면 상태) → 카드 하나(상태 id·꼬리표·한 줄·보조 정보·큰 버튼·작은 글자 버튼·알림 줄·TV 꼬리표).
 * 여러 상태가 겹치면 PRD 표의 우선순위(작은 번호)가 이긴다. 화면(NowCard.tsx)은 이 결과만 그리고, 버튼 동작은 `kind`로 Dashboard가 처리한다
 * (동작은 기존 교사 행동만 — startTrade·closeEvent·endResult·fireNow·startRoundNow·endRound·closeWorksheet·finishNow·setWrapStep·pause/resume·endSession).
 *
 * 카드·진행 줄 문구에 차시(L1)를 박지 않는다 — 배치표·마무리 목록에서 읽으므로 단원 한 판에서도 그대로 쓴다.
 */
import {
  firstRoundPreview, hasResultView, inputFromClass, resultShowing, roundNowPlan, tradeClock, tryBuildSchedule,
  type ClassState, type RoundNowBlock, type ScheduleItem, type WrapItem,
} from '../core';
import { eventsById } from '../data/events';
import type { LessonId, WorksheetId } from '../data/types';
import { worksheetById } from '../data/worksheet';
import { parseScreenData, pickScene, type SceneId } from '../screen/model';
import type { HostView } from '../sync/host-session';
import { liveWrapStep, publicView, screenView, type TeacherGame } from './game';
import { eventDefOf, isTier1, itemLabel, minSecText, mmss, ROUND_NOW_BLOCK_TEXT, worksheetNo } from './schedule-view';
import { respondedToCurrent } from './table';
import { eul, lessonText, MANUAL_HINT, SCENE_CHOICE_TEXT, teacherTitle } from './teacher-terms';

// ─────────────────────────── 타입 ───────────────────────────

/** 카드 상태(PRD 7.5.2.1 표 13줄 — 1번 줄은 끊김·가져감 둘) */
export type NowState =
  | 'disconnected' | 'replaced' // 1
  | 'paused' // 2
  | 'ended' // 3
  | 'wrapup' // 4
  | 'timeUp' // 5
  | 'result' // 6
  | 'worksheet' // 7
  | 'respond' // 8
  | 'card' // 9
  | 'round' // 10
  | 'waiting' // 11
  | 'ready' // 12
  | 'lobby'; // 13

export const NOW_PRIORITY: Readonly<Record<NowState, number>> = {
  disconnected: 1, replaced: 1, paused: 2, ended: 3, wrapup: 4, timeUp: 5, result: 6, worksheet: 7, respond: 8, card: 9, round: 10, waiting: 11, ready: 12, lobby: 13,
};

/** 버튼이 하는 일(Dashboard가 기존 교사 행동으로 바꾼다) */
export type NowActionKind =
  | 'startTrade' // 확인 창(134 문구) → startTrade
  | 'resume'
  | 'pause'
  | 'exit' // [처음으로]
  | 'saveResult'
  | 'wrapNext' // 지금 마무리 항목 끝 → 다음 항목 시작
  | 'wrapSkip' // 지금 마무리 항목 건너뜀 → 다음 항목 시작
  | 'wrapStart' // 멈춰 있는 다음 마무리 항목 시작
  | 'endSession' // 수업 끝내기(확인 2번)
  | 'finishNow' // 지금 마무리로(시간이 끝났을 때 — 확인 없음)
  | 'finishEarly' // 지금 마무리로(시간이 남았을 때 — 확인 1번)
  | 'dismissTimeUp' // [이 활동 끝나고]
  | 'endResult'
  | 'closeEvent' // 응답 받기 끝내기(결과가 있으면 결과를 TV에)
  | 'reveal' // TV에 결과 보여 주기
  | 'next' // 떠 있는 것을 끝내고 다음 항목 시작(fireNow clear)
  | 'startItem' // 다음 항목 지금 시작(fireNow)
  | 'closeWorksheet'
  | 'endRound' // 라운드 끝내기(남은 시간이 있고 모두 준비가 아니면 확인 1번)
  | 'roundNow' // 라운드 지금 시작(134 확인 흐름)
  | 'lock' // 새 학생 그만 받기/다시 받기
  | 'dismissLock' // [계속 받기]
  | 'openScreen' // 공용 화면 창 열기
  | 'autoScene' // TV 장면 '알아서 바꾸기'로
  | 'showNoWorksheet' // 학생 표를 '학습지 안 씀'으로
  | 'showFold'; // 접힘 영역 펼치기([보기])

export type FoldId = 'time' | 'order' | 'entry' | 'worksheet' | 'more';

export interface NowButton {
  label: string;
  kind: NowActionKind;
  /** 기존 시험·리허설 도구가 쓰는 data-testid(없으면 화면이 정함) */
  testId?: string;
  disabled?: boolean;
  /** 비활성 까닭(버튼 아래 작은 글씨) */
  reason?: string;
  /** 큰 버튼 색: 주 색 / 보조 색 */
  tone?: 'primary' | 'secondary' | 'danger';
  /** 대상 배치표 항목 ID(next·startItem) */
  itemId?: string;
  /** 마무리 항목(wrapNext·wrapSkip·wrapStart): 지금 항목 / 다음 항목 */
  wrapId?: string;
  nextWrapId?: string;
  /** showFold 대상 */
  fold?: FoldId;
}

export interface NowSub {
  text: string;
  testId?: string;
  /** 시험용 data-event(지금 활동 사건 ID) */
  eventId?: string;
  strong?: boolean;
  /** 마무리 학습지 도움말 [학습지 열기] 자리 */
  pdfLink?: boolean;
  /** 준비 체크(✓ 여부) */
  check?: boolean | null;
}

export interface NowNote {
  id: 'rejoin' | 'seatProblem' | 'nameCheck' | 'lockSuggest' | 'codeChanged';
  text: string;
  testId?: string;
  buttons: NowButton[];
}

export interface TvChip {
  /** off = 공용 화면 창이 없음(회색), fixed = 손으로 고정(주황), auto = 알아서 바꾸기 */
  kind: 'off' | 'fixed' | 'auto';
  text: string;
  scene: SceneId | null;
  button: NowButton | null;
}

export interface NowCard {
  state: NowState;
  priority: number;
  /** 단계 꼬리표(작게) */
  tag: string;
  /** 한 줄(굵고 크게) */
  line: string;
  lineTestId?: string;
  /** 지금 활동 사건 ID(응답·결과 상태 — 시험이 data-event로 확인) */
  eventId?: string;
  sub: NowSub[];
  primary: NowButton | null;
  secondary: NowButton | null;
  notes: NowNote[];
  tv: TvChip;
  /** [잠깐 멈춤]을 보이는가(무역 시작 뒤 수업 끝 전, 멈춤·연결 문제 상태가 아닐 때) */
  showPause: boolean;
  manual: boolean;
  /**
   * (작업 147, PRD 7.5.2.1 v0.3.8 단순화) 자동 진행의 카드·응답·라운드·기다림·결과 상태 — 판이 저절로 흐르므로
   * 큰 버튼은 '급할 때만' 작은 버튼으로, [잠깐 멈춤]을 큰 주 색 버튼으로 그린다(버튼 종류·testid·동작은 그대로).
   * nowCard()는 늘 true/false로 채운다(선택 필드인 것은 카드를 손으로 만드는 다른 시험과 맞추려고 — 없으면 false).
   */
  quiet?: boolean;
  /** 같은 상태 안에서도 내용이 바뀌면 달라지는 열쇠(두 번 누름 막기·강조 효과) */
  key: string;
}

export type NowView = Pick<HostView<TeacherGame>, 'status' | 'connection' | 'disconnectedAt' | 'ended' | 'seats' | 'code' | 'locked' | 'rejoinRequests' | 'codeChanged'>;

export interface NowUi {
  /** [이 활동 끝나고]를 눌렀다 */
  timeUpDismissed?: boolean;
  /** 공용 화면 창이 연결돼 있다(screen-bridge hello 신호) */
  screenConnected: boolean;
  /** 무시하지 않은 '같은 번호 다른 이름' 시도 수 */
  seatProblems?: number;
  /** "새 학생을 그만 받을까요?"에 [계속 받기]를 눌렀다 */
  lockSuggestDismissed?: boolean;
}

// ─────────────────────────── 작은 계산 ───────────────────────────

/** (작업 147) 자동 진행에서 '조용한' 카드가 되는 상태 */
const QUIET_STATES: ReadonlySet<NowState> = new Set<NowState>(['card', 'respond', 'round', 'waiting', 'result']);

/** (작업 147) 자동 진행 대상 상태 보조 정보 맨 끝 안내 */
export const AUTO_HINT_TEXT = '누르지 않아도 저절로 넘어가요 · 기다려 줄 학생이 있으면 [잠깐 멈춤]';

/** (작업 147) "아직 못 한 학생" 한 줄 — 보조 정보 맨 앞(굵게) */
function notDone(n: number, some: (n: number) => string, none: string): NowSub {
  return { text: n > 0 ? some(n) : none, strong: true, testId: 'now-not-done' };
}

/** 남은 초 → "45초" / "1:20" */
export function leftText(sec: number): string {
  const s = Math.max(0, Math.ceil(sec - 1e-9));
  return s < 60 ? `${s}초` : mmss(s);
}

const firable = (it: ScheduleItem) => it.status === 'pending' && it.form !== 'dropped' && it.kind !== 'letter';

/** (작업 151) 이번 라운드에 사고팔기(사기·팔기·생산)를 했는가 — 자유 항해 카드·학생 표 */
export function tradedThisRound(round: number, p: { game: { log: readonly { round: number; kind: string }[] } }): boolean {
  return p.game.log.some((l) => l.round === round && (l.kind === 'buy' || l.kind === 'sell' || l.kind === 'produce'));
}

/** (작업 151) 이번 라운드 항해 횟수(자유 항해 기록 기준) */
export function sailsInRound(round: number, p: { game: { log: readonly { round: number; kind: string }[] } }): number {
  return p.game.log.filter((l) => l.round === round && l.kind === 'voyage').length;
}

/** 다음에 시작할 배치표 항목(core 자동 진행과 같은 순서) */
export function nextItemOf(c: Pick<ClassState, 'schedule'>): ScheduleItem | null {
  return c.schedule.items.find(firable) ?? null;
}

/** 이 사건이 응답을 받는가 */
function needsResponse(id: string): boolean {
  return !!eventsById[id]?.needsResponse;
}

/** 진행 중 배치표 항목(사건 ID로) */
function liveItemOf(c: ClassState, refId: string): ScheduleItem | undefined {
  return c.schedule.items.find((it) => it.status === 'live' && it.refId === refId && (it.kind === 'event' || it.kind === 'stageCover'));
}

/** 활동 이름(교사 화면) — 표지는 "1차시 표지" */
function eventTitle(c: ClassState, id: string): string {
  const live = liveItemOf(c, id);
  if (live) return itemLabel(live);
  const def = eventsById[id];
  return def ? teacherTitle(def.title) : id;
}

/** 응답 없는 소식 패널 줄 — 2차시~ 임무·첫 입항 사건은 학생 화면 '○차시 임무' 패널 */
function newsLine(c: ClassState, id: string): string {
  const def = eventsById[id];
  if (def && def.lesson !== 'L1' && (def.kind === 'mission' || def.trigger.type === 'firstArrival')) return `학생 화면에 '${lessonText(def.lesson)} 임무' 안내가 떠 있어요`;
  return `학생 화면에 '${eventTitle(c, id)}' 소식이 떠 있어요`;
}

/** 라운드 앞 사전 활동(표지·편지·라운드 안 비차단 활동 제외) */
function preActivities(c: ClassState): ScheduleItem[] {
  const items = c.schedule.items;
  const idx = items.findIndex((it) => it.kind === 'round' && it.form !== 'dropped');
  if (idx < 0) return [];
  const r = items[idx]!;
  return items.filter((it, i) => (it.kind === 'event' || it.kind === 'worksheet') && it.form !== 'dropped'
    && !(it.kind === 'event' && it.blocking === false && it.at >= r.at)
    && (it.at < r.at || (it.at === r.at && i < idx)));
}

/** 단계 꼬리표: 라운드 1 전 "사전 활동 k/n", 그 뒤 "라운드 사이"(라운드 중이면 "라운드 r/R") */
function stageTag(c: ClassState, focus: ScheduleItem | null): string {
  if (c.phase === 'round') return `라운드 ${c.round}/${totalRounds(c)}`;
  if (c.round > 0) return '라운드 사이';
  const pre = preActivities(c);
  const k = focus ? pre.findIndex((it) => it.id === focus.id) : -1;
  return k >= 0 && pre.length ? `사전 활동 ${k + 1}/${pre.length}` : '사전 활동';
}

/** 판 전체 라운드 수(빠지지 않은 라운드 항목) */
export function totalRounds(c: Pick<ClassState, 'schedule' | 'round'>): number {
  return Math.max(c.round, c.schedule.items.filter((it) => it.kind === 'round' && it.form !== 'dropped' && it.status !== 'skipped').length);
}

const elapsedOf = (c: ClassState, now: number) => tradeClock.elapsedSec(c.clock, now);

/** "1:20 뒤 저절로 다음: 무역·수입·수출" / 수동이면 안내 */
function autoNext(c: ClassState, endSec: number | null, next: ScheduleItem | null, now: number): NowSub {
  if (c.schedule.mode === 'manual') return { text: next ? `${MANUAL_HINT} · 다음: ${itemLabel(next)}` : MANUAL_HINT, testId: next ? 'tl-waiting' : undefined };
  const e = elapsedOf(c, now);
  if (!next) return { text: `${leftText(c.clock.durationSec - e)} 뒤 저절로 마무리로 넘어가요` };
  const at = Math.max(endSec ?? next.at, next.at);
  return { text: `${leftText(at - e)} 뒤 저절로 다음: ${itemLabel(next)}` };
}

/** 지금 학습지 팝업 완료 수(묶음은 번호 모두를 다 쓴 학생만, 지금 쓰기는 ★ 칸) */
export function worksheetProgress(g: TeacherGame): { ids: WorksheetId[]; during: boolean; done: number; total: number } {
  const ids = (g.class.worksheet.current ?? []).filter((id) => worksheetById[id]);
  const during = g.class.worksheet.during === true;
  const players = Object.values(g.players);
  let done = 0;
  for (const p of players) {
    const list = during ? (p.game.duringDone ?? []) : p.game.worksheetDone;
    if (ids.length && ids.every((id) => list.includes(id))) done += 1;
  }
  return { ids, during, done, total: players.length };
}

/** 묶음 팝업 시간(초) — 넘으면 "다 못 쓴 번호는 마무리 때 이어 써요" 강조(WorksheetPanel과 같은 값) */
const BUNDLE_LONG_SEC = 180;

/** [무역 시작] 전 한 줄 요약(134 startConfirmText 요약): "먼저 벽란도 시장·무역·수입·수출을 하고 약 3분 50초 뒤 라운드 1" */
export function startSummary(c: ClassState, g: TeacherGame): string | null {
  const r = tryBuildSchedule(inputFromClass(c, g.meta.playUnit, g.meta.scope));
  if (!r.ok) return null;
  const p = firstRoundPreview(r.schedule.items);
  if (!p) return null;
  const names = [...new Set(p.activities.map(itemLabel))];
  const when = `약 ${minSecText(p.atSec)} 뒤 라운드 ${p.round}`;
  return names.length ? `무역을 시작하면 먼저 ${eul(names.join('·'))} 하고 ${when}` : `무역을 시작하면 표지를 보고 ${when}`;
}

// ─────────────────────────── 마무리 ───────────────────────────

/** 마무리 항목 한 줄 도움말(PRD 7.5.2.1 상태 4) */
export function wrapHelp(w: WrapItem): NowSub {
  switch (w.id) {
    case 'awards':
      return { text: 'TV에서 상을 차례로 보여 줘요 · 학생 화면에는 내 회사 결산과 받은 상이 보여요' };
    case 'reflect':
      return { text: `학생 화면에 되돌아보기 문항이 떠요${w.worksheetIds.length ? ` · 학습지 ${w.worksheetIds.map(worksheetNo).join('')}에 써요` : ' · 학습지에 써요'}` };
    case 'afterWorksheet':
      return { text: `학습지 ${w.worksheetIds.map(worksheetNo).join('') || ''}를 항해 기록장을 보며 써요`.replace('학습지 를', '학습지를'), pdfLink: true };
    case 'containers':
      return { text: `컨테이너 이야기를 함께 봐요${w.worksheetIds.length ? ` · 학습지 ${w.worksheetIds.map(worksheetNo).join('')}` : ''}` };
    case 'magazine':
      return { text: `잡지 표지 원고를 써요${w.worksheetIds.length ? ` · 학습지 ${w.worksheetIds.map(worksheetNo).join('')}` : ''}`, pdfLink: true };
    default:
      return { text: '마지막 라운드까지 정산했어요' };
  }
}

/** 마무리 카드에 세는 항목(0분짜리 '마지막 라운드 정산'은 빼고) */
export function wrapSteps(c: Pick<ClassState, 'schedule'>): WrapItem[] {
  return (c.schedule.wrapup ?? []).filter((w) => w.id !== 'settle');
}

function wrapCard(g: TeacherGame): Pick<NowCard, 'tag' | 'line' | 'sub' | 'primary' | 'secondary' | 'lineTestId'> {
  const steps = wrapSteps(g.class);
  const wp = g.wrapProgress ?? {};
  const liveId = liveWrapStep(g);
  const live = steps.find((w) => w.id === liveId) ?? null;
  const n = steps.length;
  const save: NowButton = { label: '결과 파일 저장', kind: 'saveResult', testId: 'now-save-result' };
  const end: NowButton = { label: '수업 끝내기', kind: 'endSession', testId: 'now-end-session', tone: 'danger' };
  if (live) {
    const k = steps.indexOf(live) + 1;
    const next = steps.slice(k).find((w) => !wp[w.id]) ?? null;
    const sub: NowSub[] = [wrapHelp(live)];
    if (next) sub.push({ text: `다음: ${next.label}` });
    return {
      tag: `마무리 ${k}/${n}`,
      line: `${live.label} 하는 중`,
      sub,
      primary: next ? { label: `다음으로: ${next.label}`, kind: 'wrapNext', testId: 'now-wrap-next', wrapId: live.id, nextWrapId: next.id, tone: 'primary' } : end,
      secondary: next ? { label: '이 항목 건너뛰기', kind: 'wrapSkip', testId: 'now-wrap-skip', wrapId: live.id, nextWrapId: next.id } : save,
    };
  }
  const pending = steps.find((w) => !wp[w.id]) ?? null;
  if (pending) {
    const k = steps.indexOf(pending) + 1;
    return {
      tag: `마무리 ${k}/${n}`,
      line: `다음 마무리: ${pending.label}`,
      sub: [wrapHelp(pending)],
      primary: { label: `시작: ${pending.label}`, kind: 'wrapStart', testId: 'now-wrap-start', nextWrapId: pending.id, tone: 'primary' },
      secondary: save,
    };
  }
  return {
    tag: n ? `마무리 ${n}/${n}` : '마무리',
    line: '마무리를 모두 했어요',
    sub: [{ text: '[수업 끝내기]를 누르면 방이 닫혀요. 결과 파일은 닫은 뒤에도 저장할 수 있어요' }],
    primary: end,
    secondary: save,
  };
}

// ─────────────────────────── TV 꼬리표 ───────────────────────────

const SCENE_TEXT: Readonly<Record<SceneId, string>> = {
  code: '방 코드',
  rules: '항해 규칙',
  cover: '표지',
  summary: '앞 차시 요약',
  event: '활동 카드',
  bars: '결과 막대',
  map: '해도',
  leaderboard: '순위판',
  worksheet: '학습지 시간',
  pause: "'선생님을 보세요'",
  awards: '시상식',
  ended: '끝 화면',
  black: '검은 화면',
};

/** 지금 공용 화면에 나오는 장면 이름(공용 화면 규칙 `pickScene`을 읽기만 한다) */
export function tvSceneOf(g: TeacherGame, now: number): { scene: SceneId | null; text: string } {
  try {
    const d = parseScreenData(publicView(g), screenView(g));
    if (!d) return { scene: null, text: '' };
    const scene = pickScene(d, now);
    const ce = g.class.currentEvent;
    if ((scene === 'event' || scene === 'cover') && ce) return { scene, text: `${eventTitle(g.class, ce.id)} 카드` };
    if (scene === 'bars' && ce) return { scene, text: `${eventTitle(g.class, ce.id)} 결과` };
    return { scene, text: SCENE_TEXT[scene] };
  } catch {
    return { scene: null, text: '' };
  }
}

export function tvChipOf(g: TeacherGame, now: number, screenConnected: boolean): TvChip {
  const choice = g.screenScene ?? 'auto';
  const { scene, text } = tvSceneOf(g, now);
  if (!screenConnected) return { kind: 'off', text: 'TV 화면 창이 열려 있지 않아요', scene, button: { label: '열기', kind: 'openScreen', testId: 'tv-open' } };
  if (choice !== 'auto') {
    return { kind: 'fixed', text: `TV가 '${SCENE_CHOICE_TEXT[choice]}'에 고정돼 있어요`, scene, button: { label: '알아서 바꾸기로', kind: 'autoScene', testId: 'tv-auto' } };
  }
  return { kind: 'auto', text: `TV: ${text || '연결됨'}`, scene, button: null };
}

// ─────────────────────────── 알림 줄 ───────────────────────────

/** 무역 시작 뒤 새 학생 그만 받기 제안까지(초) */
export const LOCK_SUGGEST_SEC = 300;

export function notesOf(g: TeacherGame, view: NowView, now: number, ui: NowUi): NowNote[] {
  const out: NowNote[] = [];
  const c = g.class;
  if (view.rejoinRequests.length) {
    out.push({ id: 'rejoin', text: `다른 기기에서 다시 들어오기 요청 ${view.rejoinRequests.length}명`, testId: 'note-rejoin', buttons: [{ label: '보기', kind: 'showFold', fold: 'entry', testId: 'note-rejoin-show' }] });
  }
  if (ui.seatProblems) {
    out.push({ id: 'seatProblem', text: `같은 번호로 다른 이름 입장 시도 ${ui.seatProblems}건`, testId: 'note-seat', buttons: [{ label: '보기', kind: 'showFold', fold: 'entry', testId: 'note-seat-show' }] });
  }
  const check = view.seats.filter((s) => s.nameStatus === 'checkRealName').length;
  if (check) out.push({ id: 'nameCheck', text: `이름 확인이 필요한 회사 ${check}`, testId: 'note-name', buttons: [{ label: '보기', kind: 'showFold', fold: 'entry', testId: 'note-name-show' }] });
  const started = c.clock.startedAt !== null;
  const ended = view.ended || view.status === 'closed' || c.phase === 'ended';
  if (started && !ended && !c.tradeEnded && !view.locked && !ui.lockSuggestDismissed && elapsedOf(c, now) >= LOCK_SUGGEST_SEC) {
    out.push({
      id: 'lockSuggest',
      text: '무역 시작 5분이 지났어요. 새 학생을 그만 받을까요?',
      testId: 'lock-suggest',
      buttons: [
        { label: '그만 받기', kind: 'lock', testId: 'lock-yes' },
        { label: '계속 받기', kind: 'dismissLock', testId: 'lock-no' },
      ],
    });
  }
  if (view.codeChanged) out.push({ id: 'codeChanged', text: `방 코드가 바뀌었어요: ${view.codeChanged.to}`, testId: 'code-changed', buttons: [] });
  return out;
}

// ─────────────────────────── 카드 ───────────────────────────

type Body = Pick<NowCard, 'state' | 'tag' | 'line' | 'sub' | 'primary' | 'secondary'> & { lineTestId?: string; eventId?: string; keyExtra?: string };

/** [라운드 지금 시작] 버튼(134 roundNowPlan 그대로 — 막히면 비활성 + 까닭) */
function roundNowButton(c: ClassState, now: number, label: string, testId: string, tone: NowButton['tone']): NowButton | null {
  const plan = roundNowPlan(c, now);
  if (plan.block === 'NO_NEXT_ROUND' || plan.block === 'TRADE_ENDED') return null;
  const blocked = plan.block as RoundNowBlock | null;
  return { label, kind: 'roundNow', testId, tone, disabled: !!blocked, reason: blocked ? ROUND_NOW_BLOCK_TEXT[blocked] : undefined };
}

/**
 * (수정 1회차) 라운드 1 전 사전 활동 카드(8·9)의 작은 글자 [라운드 바로 시작] — [무역 시작] 확인 창 안내와 같은 길(134 startRoundNow).
 * 다음 항목이 바로 라운드면 큰 버튼 [다음으로]가 그 일을 하므로 두지 않는다.
 */
function preRoundNow(c: ClassState, next: ScheduleItem | null, now: number): NowButton | null {
  if (c.round !== 0 || !next || next.kind === 'round') return null;
  return roundNowButton(c, now, '라운드 바로 시작', 'now-round-now', undefined);
}

/** 수동 진행의 [다음으로](옛 [발동] — 134 "지금 항목 끝내고 다음 항목 시작") */
function manualNext(next: ScheduleItem): NowButton {
  return { label: '다음으로', kind: 'next', testId: 'btn-fire', itemId: next.id, tone: 'primary' };
}

function body(g: TeacherGame, view: NowView, now: number, ui: NowUi): Body {
  const c = g.class;
  const started = c.clock.startedAt !== null;
  const ended = view.ended || view.status === 'closed' || c.phase === 'ended';
  const manual = c.schedule.mode === 'manual';
  const next = started && !c.tradeEnded ? nextItemOf(c) : null;
  const e = started ? elapsedOf(c, now) : 0;
  const ce = c.currentEvent;

  // 1. 연결
  if (view.status === 'replaced') {
    return { state: 'replaced', tag: '연결', line: '다른 탭이나 PC에서 이 판을 이어 가고 있어요', lineTestId: 'replaced', sub: [{ text: '이 탭은 멈췄어요' }], primary: null, secondary: null };
  }
  if (!ended && (view.status === 'reconnecting' || view.status === 'offline')) {
    return {
      state: 'disconnected', tag: '연결', line: '서버와 다시 연결하고 있어요', lineTestId: 'disconnected',
      sub: [{ text: '끊긴 동안은 멈춤으로 처리돼 학생 시간이 줄지 않아요' }], primary: null, secondary: null,
    };
  }
  // 2. 잠깐 멈춤
  if (c.paused && !ended) {
    return {
      state: 'paused', tag: '멈춤', line: '잠깐 멈춤 중이에요',
      sub: [{ text: "학생 화면에 '선생님을 보세요'가 떠 있고 시계도 멈췄어요" }],
      primary: { label: '이어서 하기', kind: 'resume', testId: 'btn-resume-trade', tone: 'primary' }, secondary: null,
    };
  }
  // 3. 판 끝
  if (ended) {
    return {
      state: 'ended', tag: '끝', line: '수업이 끝났어요', sub: [{ text: '이 브라우저의 기록은 24시간 뒤 저절로 지워져요' }],
      primary: { label: '처음으로', kind: 'exit', testId: 'btn-exit', tone: 'primary' },
      secondary: { label: '결과 파일 저장', kind: 'saveResult', testId: 'now-save-result' },
    };
  }
  // 4. 마무리
  if (c.tradeEnded) {
    const w = wrapCard(g);
    return { state: 'wrapup', ...w, keyExtra: `${liveWrapStep(g) ?? ''}` };
  }
  // 5. 무역 시간 끝(활동 진행 중)
  if (started && c.schedule.timeUp) {
    return {
      state: 'timeUp', tag: '마무리 직전', line: '무역 시간이 끝났어요',
      sub: [{ text: '지금 활동이 끝나면(최대 2분) 저절로 마무리로 넘어가요' }],
      primary: { label: '지금 마무리로', kind: 'finishNow', testId: 'btn-finish-now', tone: 'primary' },
      secondary: ui.timeUpDismissed ? null : { label: '이 활동 끝나고', kind: 'dismissTimeUp', testId: 'btn-after-activity' },
    };
  }
  // 6. 결과를 TV에 보여 주는 중
  // (수정 1회차, PRD 7.5.2.1 예외) 라운드 중에는 라운드 카드가 이긴다 — 라운드에 붙은 결정의 결과는 라운드 카드 보조 정보로
  if (started && ce && resultShowing(c, now) && c.phase !== 'round') {
    const title = eventTitle(c, ce.id);
    const sub: NowSub[] = [];
    if (manual) sub.push(autoNext(c, null, next, now));
    else if (next) sub.push({ text: `${leftText(Math.max((ce.resultUntil! - now) / 1000, next.at - e))} 뒤 저절로 다음: ${itemLabel(next)}` });
    else sub.push({ text: `${leftText((ce.resultUntil! - now) / 1000)} 뒤 저절로 결과가 닫혀요` });
    return {
      state: 'result', tag: stageTag(c, liveItemOf(c, ce.id) ?? null), line: `${title} 결과를 TV에 보여 주는 중`, lineTestId: 'tl-result',
      sub,
      primary: manual && next ? manualNext(next) : { label: '다음으로', kind: 'endResult', testId: 'btn-end-result', tone: 'primary' },
      secondary: null, keyExtra: ce.id, eventId: ce.id,
    };
  }
  // 7. 학습지 팝업
  if (c.worksheet.current?.length) {
    const p = worksheetProgress(g);
    const nos = p.ids.map(worksheetNo).join('');
    const live = c.schedule.items.find((it) => it.kind === 'worksheet' && it.status === 'live');
    const long = p.ids.length > 1 && c.worksheet.openedAt !== null && now - c.worksheet.openedAt >= BUNDLE_LONG_SEC * 1000;
    const sub: NowSub[] = [{ text: `다 쓴 학생 ${p.done}/${p.total}`, testId: 'now-ws-done' }];
    if (manual) sub.push(autoNext(c, null, next, now));
    else if (live) sub.push({ text: `${leftText(live.at + live.durSec - e)} 뒤 저절로 닫혀요` });
    else sub.push({ text: '선생님이 [다음으로]를 누르면 닫혀요' });
    if (long) sub.push({ text: '다 못 쓴 번호는 마무리 때 이어 써요', strong: true, testId: 'now-ws-long' });
    const missing = p.total - p.done;
    return {
      state: 'worksheet', tag: '학습지', line: p.during ? `학습지 ${nos}★ 지금 바로 쓰기` : `학습지 ${nos} 쓰는 시간`,
      sub,
      primary: manual && next && started ? manualNext(next) : { label: '다음으로', kind: 'closeWorksheet', testId: 'now-ws-close', tone: 'primary' },
      secondary: missing > 0 ? { label: '아직 안 쓴 학생 보기', kind: 'showNoWorksheet', testId: 'now-ws-missing' } : null,
      keyExtra: p.ids.join(','),
    };
  }
  if (started) {
    // 8. 응답을 받는 활동 / 9. 응답 없는 카드·표지(라운드 중의 비차단 소식 패널은 라운드 카드로)
    if (ce && !ce.closed && needsResponse(ce.id) && c.phase !== 'round') {
      const title = eventTitle(c, ce.id);
      const players = Object.values(g.players);
      const responded = players.filter((p) => respondedToCurrent(c, p) === true).length;
      const total = players.length;
      const live = liveItemOf(c, ce.id);
      const sub: NowSub[] = [];
      // (작업 147) 자동 진행: 맨 앞 '아직 응답 안 한 학생 n명' 한 줄 + 응답 수 한 줄만(옛 '모두 응답했어요'·'응답 없음' 안내는 뺌)
      if (!manual) sub.push(notDone(players.filter((p) => respondedToCurrent(c, p) !== true).length, (n) => `아직 응답 안 한 학생 ${n}명`, '모두 응답했어요'));
      sub.push({ text: `학생 ${responded}/${total} 응답`, testId: 'tl-resp-count' });
      sub.push(autoNext(c, live ? live.at + live.durSec : null, next, now));
      if (manual) {
        if (total > 0 && responded >= total) sub.push({ text: '모두 응답했어요', strong: true, testId: 'now-all-responded' });
        else if (responded * 2 < total) sub.push({ text: "아직 응답 안 한 학생은 '응답 없음'이 돼요" });
      }
      const withResult = hasResultView(eventsById[ce.id]);
      return {
        state: 'respond', tag: stageTag(c, live ?? null), line: `${title} 하는 중`, lineTestId: 'tl-responses',
        sub,
        primary: manual && next ? manualNext(next) : { label: '다음으로', kind: 'closeEvent', testId: 'btn-close-event', tone: 'primary' },
        // 작은 글자 버튼 하나: 결과 화면이 있으면 [TV에 결과 보여 주기], 없고 라운드 1 전이면 [라운드 바로 시작](수정 1회차)
        secondary: withResult && !ce.revealed ? { label: 'TV에 결과 보여 주기', kind: 'reveal', testId: 'btn-reveal-event' } : preRoundNow(c, next, now),
        keyExtra: ce.id, eventId: ce.id,
      };
    }
    const summary = c.schedule.items.find((it) => it.kind === 'stageCover' && it.variant === 'summary' && it.status === 'live' && e < it.at + it.durSec);
    if ((ce && !ce.closed && c.phase === 'event') || (summary && c.phase !== 'round')) {
      const id = ce && !ce.closed && c.phase === 'event' ? ce.id : null;
      const live = id ? liveItemOf(c, id) : summary!;
      const name = id ? eventTitle(c, id) : itemLabel(summary!);
      const cover = !!id && !!eventsById[id]?.isCover;
      const sub: NowSub[] = [];
      // (작업 147) 자동 진행: 사건 카드·표지면 맨 앞 '카드를 아직 안 읽은 학생 n명'(앞 차시 요약 카드는 없음)
      if (!manual && id) {
        sub.push(notDone(Object.values(g.players).filter((p) => p.game.responses[id] === undefined).length, (n) => `카드를 아직 안 읽은 학생 ${n}명`, '모두 카드를 읽었어요'));
      }
      if (cover) sub.push({ text: '차시 질문을 함께 읽어요' });
      sub.push(autoNext(c, live ? live.at + live.durSec : null, next, now));
      return {
        state: 'card', tag: stageTag(c, live ?? null), line: `${eul(name)} TV에 보여 주는 중`,
        sub,
        primary: next
          ? manual ? manualNext(next) : { label: '다음으로', kind: 'next', testId: 'now-next', itemId: next.id, tone: 'primary' }
          : id ? { label: '다음으로', kind: 'closeEvent', testId: 'btn-close-event', tone: 'primary' } : null,
        secondary: preRoundNow(c, next, now),
        keyExtra: id ?? summary!.id,
      };
    }
    // 10. 라운드 진행 중(PRD 7.5.2.1 예외: 라운드에 붙은 결정·소식이 열려 있어도 라운드 카드 — 그 진행은 보조 정보 + 작은 글자 버튼)
    if (c.phase === 'round') {
      const players = Object.values(g.players);
      const joined = view.seats.length;
      // (작업 151, PRD 4.3.7.1) 자유 항해: 출항 준비가 없다 — '아직 사고팔지 않은 학생 n명'(이번 라운드 사기·팔기·생산 기록), 준비 수 줄 없음
      const free = c.settings.voyageMode === 'free';
      const ready = free ? 0 : players.filter((p) => p.game.ready).length;
      const allReady = !free && joined > 0 && ready >= joined;
      const sub: NowSub[] = free
        ? [
            ...(manual ? [] : [notDone(players.filter((p) => !tradedThisRound(c.round, p)).length, (n) => `이번 라운드에 아직 사고팔지 않은 학생 ${n}명`, '모두 사고팔기를 했어요')]),
            { text: roundLeftText(c, now), testId: 'now-round-left' },
            // (작업 153 추가, 교사 결정) 라운드 끝은 운항비 정산 때일 뿐 — 학생 항해를 멈추는 것은 선생님
            { text: FREE_PAUSE_HINT, testId: 'now-free-pause' },
          ]
        : [
            // (작업 147) 자동 진행: 맨 앞 '출항 준비 안 한 학생 n명'
            ...(manual ? [] : [notDone(players.filter((p) => !p.game.ready).length, (n) => `출항 준비 안 한 학생 ${n}명`, '모두 출항 준비했어요')]),
            { text: roundLeftText(c, now), testId: 'now-round-left' },
            { text: `출항 준비 끝낸 학생 ${ready}/${joined}`, testId: 'ready-count' },
          ];
      let secondary: NowButton | null = null;
      // 라운드에 붙은 결정(응답 받는 활동) 진행
      if (ce && !ce.closed && needsResponse(ce.id)) {
        const responded = players.filter((p) => respondedToCurrent(c, p) === true).length;
        sub.push({ text: `${eventTitle(c, ce.id)} 학생 ${responded}/${players.length} 응답${ce.revealed ? ' · TV에 결과 보여 주는 중' : ''}`, testId: 'tl-resp-count', eventId: ce.id, strong: true });
        secondary = { label: '응답 받기 끝내기', kind: 'closeEvent', testId: 'btn-close-event' };
      } else if (ce && resultShowing(c, now)) {
        sub.push({ text: `${eventTitle(c, ce.id)} 결과를 TV에 보여 주는 중 · ${leftText((ce.resultUntil! - now) / 1000)}`, testId: 'tl-result', eventId: ce.id, strong: true });
        secondary = { label: '결과 닫기', kind: 'endResult', testId: 'btn-end-result' };
      } else if (ce && !ce.closed) {
        // 응답 없는 소식 패널(천연가스 소식 등). (작업 115 수정 1회차) 2차시 차시 시작 임무·첫 입항 사건은 학생 화면에 '임무' 패널로 뜬다
        sub.push({ text: newsLine(c, ce.id), testId: 'now-news' });
      }
      const endBtn: NowButton = { label: '라운드 끝내기', kind: 'endRound', testId: 'btn-end-round', tone: allReady ? 'primary' : 'secondary' };
      // 수동 진행: 라운드 중에 열 수 있는 항목(라운드에 붙은 소식·결정 패널)을 선생님이 기다리고 있으면 보조 정보 + 작은 글자 [열기: ○○](옛 [발동])
      const waitingId = manual ? c.schedule.waiting ?? null : null;
      const waitItem = waitingId ? c.schedule.items.find((it) => it.id === waitingId && it.status === 'pending') ?? null : null;
      if (waitItem) {
        sub.push({ text: `${itemLabel(waitItem)} — 선생님이 열어야 학생 화면에 떠요`, testId: 'tl-waiting' });
        if (!secondary) secondary = { label: `열기: ${itemLabel(waitItem)}`, kind: 'next', testId: 'btn-fire', itemId: waitItem.id };
      } else if (next) sub.push({ text: `다음: ${itemLabel(next)}` });
      return {
        state: 'round', tag: `라운드 ${c.round}/${totalRounds(c)}`,
        line: free
          ? `라운드 ${c.round} · 학생들이 자유롭게 항해하며 사고파는 중`
          : manual
          ? allReady ? '모두 준비됐어요 — 라운드를 끝낼까요?' : `라운드 ${c.round} · 학생들이 사고팔고 항해하는 중`
          : allReady ? '모두 출항 준비했어요 · 곧 저절로 다음 순서로 가요' : `라운드 ${c.round} · 학생들이 사고팔고 출항 준비하는 중`,
        lineTestId: allReady ? 'all-ready' : undefined,
        sub,
        primary: endBtn,
        secondary,
        keyExtra: `${c.round}${allReady ? 'r' : ''}`,
        eventId: ce && (!ce.closed || resultShowing(c, now)) ? ce.id : undefined,
      };
    }
    // 11. 다음 항목을 기다림
    // (다듬기) 라운드 밖에서 응답 없는 소식 패널이 떠 있으면(수동 진행에서 라운드 뒤 [다음으로]로 연 소식 등) 그것도 보인다 — 다음 항목을 열 때까지
    const news: NowSub[] = ce && !ce.closed && !needsResponse(ce.id) ? [{ text: newsLine(c, ce.id), testId: 'now-news' }] : [];
    // (작업 153 추가) 자유 항해 판의 라운드 사이: 학생은 계속 항해·사고팔기를 한다
    if (c.settings.voyageMode === 'free' && c.phase === 'between' && c.round >= 1) news.push({ text: FREE_BETWEEN_HINT, testId: 'now-free-pause' });
    if (next) {
      const wait = Math.max(0, next.at - e);
      const isRound = next.kind === 'round';
      const focus = stageTag(c, next);
      if (manual) {
        return {
          state: 'waiting', tag: focus,
          line: `다음: ${itemLabel(next)}`, lineTestId: 'tl-waiting',
          sub: [...news, { text: MANUAL_HINT }, ...(wait > 0 ? [{ text: `계획 시각까지 ${mmss(wait)}` }] : [])],
          primary: manualNext(next), secondary: null, keyExtra: next.id,
        };
      }
      const line = isRound ? `라운드 ${next.round ?? c.round + 1}까지 ${mmss(wait)}` : `다음: ${itemLabel(next)} · ${mmss(wait)} 뒤`;
      const laterRound = !isRound && c.schedule.items.some((it) => it.kind === 'round' && firable(it));
      return {
        state: 'waiting', tag: focus, line,
        sub: [...news, { text: '학생 화면에는 남은 시간이 보여요' }],
        primary: isRound
          ? roundNowButton(c, now, '라운드 지금 시작', 'btn-round-now', 'primary')
          : { label: '지금 시작', kind: 'startItem', testId: 'now-start', itemId: next.id, tone: 'primary' },
        secondary: laterRound ? roundNowButton(c, now, '라운드 바로 시작', 'now-round-now', undefined) : null,
        keyExtra: next.id,
      };
    }
    // 남은 항목 없음(자동 진행: 계획이 막 끝남 — 다음 틱에 마무리로 / 수동 진행: 선생님이 마무리로 넘김, 그대로 두면 무역 시간이 끝날 때)
    return {
      state: 'waiting', tag: '라운드 사이', line: '계획한 활동을 모두 했어요',
      sub: [{ text: manual ? `[지금 마무리로]를 누르면 마무리로 넘어가요 · 그대로 두면 ${leftText(c.clock.durationSec - e)} 뒤` : '곧 저절로 마무리로 넘어가요' }],
      primary: { label: '지금 마무리로', kind: 'finishEarly', testId: 'now-finish', tone: 'primary' }, secondary: null,
    };
  }
  // 12·13. 무역 시작 전
  const players = Object.values(g.players);
  const joined = view.seats.length;
  const founded = players.filter((p) => p.company.founded).length;
  const making = Math.max(0, joined - founded);
  const lock: NowButton = { label: view.locked ? '새 학생 다시 받기' : '새 학생 그만 받기', kind: 'lock', testId: 'now-lock' };
  if (joined > 0 && making === 0) {
    const sum = startSummary(c, g);
    return {
      state: 'ready', tag: '준비 3/3', line: '모두 들어왔으면 무역을 시작하세요',
      sub: [{ text: `들어온 학생 ${joined} · 회사 만든 학생 ${founded}`, testId: 'prep-counts' }, ...(sum ? [{ text: sum, testId: 'now-start-summary' }] : [])],
      primary: { label: '무역 시작', kind: 'startTrade', testId: 'btn-start-trade', tone: 'primary' },
      secondary: lock,
    };
  }
  const code = view.code ?? '';
  return {
    state: 'lobby', tag: '준비', line: `학생들이 들어오고 있어요 · 방 코드 ${code}`,
    sub: [
      { text: ui.screenConnected ? '① TV에 방 코드 띄우기 — 공용 화면 창이 열려 있어요' : '① TV에 방 코드 띄우기 — [공용 화면 창 열기]를 눌러 TV로 옮겨요', check: ui.screenConnected },
      { text: `② 학생 입장 · 들어온 ${joined} · 회사 만든 ${founded} · 만드는 중 ${making}`, testId: 'prep-counts', check: joined > 0 && making === 0 },
      { text: '③ 무역 시작', check: false },
    ],
    primary: {
      label: '무역 시작', kind: 'startTrade', testId: 'btn-start-trade', tone: 'secondary',
      disabled: joined === 0, reason: joined === 0 ? '학생이 1명 이상 들어오면 눌러요' : undefined,
    },
    secondary: ui.screenConnected ? null : { label: '공용 화면 창 열기', kind: 'openScreen', testId: 'now-open-screen' },
    keyExtra: `${joined > 0}`,
  };
}

/** (작업 153 추가) 자유 항해 판 교사 안내 */
export const FREE_PAUSE_HINT = '학생 항해를 멈추려면 [잠깐 멈춤]';
export const FREE_BETWEEN_HINT = '학생들은 계속 자유롭게 항해해요 · 멈추려면 [잠깐 멈춤]';

/** "라운드 2 남은 1:10" */
function roundLeftText(c: ClassState, now: number): string {
  const left = c.paused && c.roundRemainingMs !== null ? c.roundRemainingMs / 1000 : c.roundEndsAt !== null ? (c.roundEndsAt - now) / 1000 : 0;
  return `라운드 ${c.round} 남은 ${mmss(Math.max(0, left))}`;
}

/** 카드 하나 고르기(PRD 7.5.2.1 표의 우선순위) */
export function nowCard(g: TeacherGame, view: NowView, now: number, ui: NowUi): NowCard {
  const b = body(g, view, now, ui);
  const c = g.class;
  const started = c.clock.startedAt !== null;
  const showPause = started && b.state !== 'paused' && b.state !== 'ended' && b.state !== 'disconnected' && b.state !== 'replaced';
  const quiet = c.schedule.mode === 'auto' && QUIET_STATES.has(b.state);
  // (작업 147) 자동 진행 대상 상태: 보조 정보 맨 끝에 안내 한 줄
  const sub = quiet ? [...b.sub, { text: AUTO_HINT_TEXT, testId: 'now-auto-hint' }] : b.sub;
  return {
    state: b.state,
    priority: NOW_PRIORITY[b.state],
    tag: b.tag,
    line: b.line,
    lineTestId: b.lineTestId,
    eventId: b.eventId,
    sub,
    primary: b.primary,
    secondary: b.secondary,
    notes: notesOf(g, view, now, ui),
    tv: tvChipOf(g, now, ui.screenConnected),
    showPause,
    manual: c.schedule.mode === 'manual',
    quiet,
    key: `${b.state}:${b.keyExtra ?? ''}:${b.primary?.kind ?? ''}:${b.primary?.itemId ?? ''}`,
  };
}

// ─────────────────────────── 라운드 끝내기 확인 ───────────────────────────

/**
 * (PRD 7.5.2.6, 수정 1회차) [라운드 끝내기] 확인 창이 필요한가와 본문.
 * - 남은 시간이 있고 모두 준비가 아니면 확인. 모두 준비면 확인 없음 — 단, 라운드에 붙은 결정을 아직 안 한 학생이 있으면 확인(응답 없음이 되므로).
 * - 뒤에 시작할 순서가 없으면(마지막 라운드) 실제로 일어나는 일: 자동 진행 = 무역을 마치고 마무리로, 수동 진행 = 남은 순서 없음.
 */
export function endRoundConfirm(g: TeacherGame, joined: number, now: number): { needed: boolean; title: string; body: string } {
  const c = g.class;
  const players = Object.values(g.players);
  const ready = players.filter((p) => p.game.ready).length;
  // (작업 151) 자유 항해에는 출항 준비가 없다 → '모두 준비'로 보지 않는다
  const allReady = c.settings.voyageMode !== 'free' && joined > 0 && ready >= joined;
  const left = c.phase !== 'round' ? 0 : c.paused && c.roundRemainingMs !== null ? c.roundRemainingMs / 1000 : c.roundEndsAt !== null ? Math.max(0, (c.roundEndsAt - now) / 1000) : 0;
  const ce = c.currentEvent;
  const openDecision = ce && !ce.closed && needsResponse(ce.id) ? ce : null;
  const notYet = openDecision ? players.filter((p) => respondedToCurrent(c, p) !== true).length : 0;
  const lines: string[] = [];
  const last = !c.schedule.items.some(firable);
  const tradeLeft = Math.max(0, c.clock.durationSec - elapsedOf(c, now));
  if (last) {
    lines.push(
      c.schedule.mode === 'auto'
        ? `마지막 라운드예요. 지금 끝내면 무역을 마치고 마무리(결산·시상)로 넘어가요. 남은 무역 시간(${mmss(tradeLeft)})은 쓰지 않아요.`
        : `마지막 라운드예요. 지금 끝내면 학생들의 거래가 멈추고, 남은 순서가 없어 [지금 마무리로]를 누르면 마무리로 넘어가요.`,
    );
  } else lines.push(`라운드가 ${mmss(left)} 남았어요. 지금 끝내면 학생들의 거래가 멈추고 다음 순서로 넘어가요.`);
  if (notYet > 0) {
    const kind = eventsById[openDecision!.id]?.kind === 'decision' ? '결정하지' : '응답하지';
    lines.push(`아직 ${kind} 않은 학생은 '응답 없음'이 돼요(${notYet}명).`);
  }
  const needed = (left >= 1 && !allReady) || notYet > 0;
  return { needed, title: last ? '마지막 라운드를 끝낼까요?' : '라운드를 지금 끝낼까요?', body: lines.join(' ') };
}

// ─────────────────────────── 꼬리표 ───────────────────────────

/** 이 항목이 꼭 할 활동인가('오늘 순서' 꼬리표 — 표지는 빼고) */
export const isMust = (it: ScheduleItem) => isTier1(it) && !eventDefOf(it)?.isCover;

/** 진행 줄 차시 이름 */
export const bandLabel = (stage: LessonId) => lessonText(stage);
