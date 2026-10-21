/**
 * 학생 표(30명) 줄·필터·정렬·요약 칩 — 순수 함수 (작업 109, PRD 7.5 학생 표 v0.3.1).
 * 이 표는 **교사 화면 전용**이다(출석번호·자금·응답 여부). 공용 화면·발표 모드에서는 렌더하지 않는다.
 */
import { FLAG_COLORS, respondedTo, seatKey, type ClassState, type Player } from '../core';
import { eventsById } from '../data/events';
import type { NameStatus } from '../sync/app-messages';
import type { HostView } from '../sync/host-session';
import { portsById } from '../data/ports';
import type { TeacherGame } from './game';

export interface StudentRow {
  seat: number;
  pid: string;
  companyName: string;
  nameStatus: NameStatus;
  flagColor: string;
  online: boolean;
  /** 마지막으로 접속이 끊긴 시각(교사 화면이 본 것, 없으면 null) */
  lastSeenAt: number | null;
  founded: boolean;
  port: string;
  portName: string;
  dest: string | null;
  money: number;
  exports: number;
  missionsDone: number;
  missionsTotal: number;
  ready: boolean;
  /** 현재 사건 응답: true/false, 사건이 없거나 응답이 필요 없으면 null */
  responded: boolean | null;
  /** 지금 떠 있는 학습지를 다 썼나(학습지가 없으면 null) */
  worksheetDone: boolean | null;
  lettersRight: number;
  rejoinRequested: boolean;
  /** (작업 148) '지금 할 일' 한 칸 — done=false 면 '도움이 필요해요'에 든다, null 이면 할 일 없음 */
  now: NowTask;
}

/** '지금 할 일' 칸(작업 148, PRD 7.5.2.2) */
export interface NowTask {
  text: string;
  done: boolean | null;
}

export type FilterId = 'all' | 'help' | 'offline' | 'noResponse' | 'notReady' | 'missionTodo' | 'noWorksheet' | 'rejoin' | 'nameCheck';

/**
 * (작업 137, PRD 7.5.2.2) 필터는 [전체] [도움이 필요해요 n] [더 보기 ▾] — 나머지는 [더 보기] 안(쉬운 말).
 * '도움이 필요해요' = 들어오지 않음 ∪ 지금 활동에 응답 안 함 ∪ 학습지 팝업 중 안 씀 ∪ 다시 들어오기 요청 ∪ 이름 확인
 *   ∪ (작업 148) 지금 할 일(카드 확인·학습지·출항 준비)을 아직 안 함(`now.done === false`).
 */
export const FILTERS: readonly { id: FilterId; label: string }[] = [
  { id: 'all', label: '전체' },
  { id: 'help', label: '도움이 필요해요' },
  { id: 'offline', label: '들어오지 않음' },
  { id: 'noResponse', label: '응답 안 함' },
  { id: 'notReady', label: '출항 준비 안 함' },
  { id: 'missionTodo', label: '임무 아직' },
  { id: 'noWorksheet', label: '학습지 안 씀' },
  { id: 'rejoin', label: '다시 들어오기 요청' },
  { id: 'nameCheck', label: '이름 확인' },
];

/** [더 보기 ▾] 안 필터 */
export const MORE_FILTERS: readonly FilterId[] = ['offline', 'noResponse', 'notReady', 'missionTodo', 'noWorksheet', 'rejoin', 'nameCheck'];

/**
 * '도움이 필요해요'를 이루는 필터 — 들어오지 않음 ∪ 지금 활동에 응답 안 함 ∪ 학습지 팝업 중 안 씀 ∪ 다시 들어오기 요청 ∪ 이름 확인
 * ∪ 지금 할 일(카드 확인·학습지·출항 준비)을 아직 안 함. 마지막 것은 필터 칩이 따로 없어 `matchesFilter('help')`가 `r.now.done === false`로 더한다.
 */
export const HELP_FILTERS: readonly FilterId[] = ['offline', 'noResponse', 'noWorksheet', 'rejoin', 'nameCheck'];

export type SortId = 'seat' | 'money' | 'exports' | 'company';
export const SORTS: readonly { id: SortId; label: string }[] = [
  { id: 'seat', label: '번호' },
  { id: 'money', label: '자금' },
  { id: 'exports', label: '수출액' },
  { id: 'company', label: '회사 이름' },
];

/**
 * 지금 사건에 응답했나 — 103 `aggregate()`(src/core/aggregate.ts "현재 사건 응답 수")와 같은 규칙.
 * 응답이 필요 없는 사건이거나 사건이 없으면 null(표 "·", 미응답·필터에서 뺌).
 * 확인 퀴즈(kind 'checkQuiz')는 답이 `game.checkQuiz`에 쌓이므로 그것을 본다.
 */
export function respondedToCurrent(cs: ClassState, p: Player): boolean | null {
  const ce = cs.currentEvent;
  const def = ce ? eventsById[ce.id] : undefined;
  if (!ce || !def || !def.needsResponse) return null;
  // 규칙은 103 aggregate 와 하나(core `respondedTo`): 확인 퀴즈는 그 구간 문항을 모두 답했을 때, 마감 때 채운 '응답 없음'은 응답 아님(작업 111)
  return respondedTo(ce.id, p);
}

/** 지금 사건 응답 수(타임라인 "응답 n/m") — 응답이 필요 없는 사건이면 null */
export function currentResponseCount(g: TeacherGame): { responded: number; total: number } | null {
  const players = Object.values(g.players);
  const ce = g.class.currentEvent;
  if (!ce || !eventsById[ce.id]?.needsResponse) return null;
  return { responded: players.filter((p) => respondedToCurrent(g.class, p) === true).length, total: players.length };
}

/** 학습지 팝업 번호를 다 썼나 — ★ 지금 쓰기면 duringDone, 묶음이면 worksheetDone(now-card `worksheetProgress`와 같은 규칙) */
function worksheetAllDone(g: TeacherGame, p: Player, ws: readonly string[]): boolean {
  const list: readonly string[] = g.class.worksheet.during === true ? (p.game.duringDone ?? []) : p.game.worksheetDone;
  return ws.every((w) => list.includes(w));
}

/**
 * (작업 148, PRD 7.5.2.2) 학생 한 명의 '지금 할 일' — 위에서부터 처음 맞는 것.
 * done=false 인 학생이 교사 카드(147) "아직 못 한 학생 n명"이고 '도움이 필요해요'에 든다.
 * 라운드 중 문구(8번)는 151(자유 항해)이 바꾼다 — `roundTask` 한 곳만 고치면 된다.
 */
export function nowTaskOf(g: TeacherGame, p: Player | undefined): NowTask {
  const c = g.class;
  if (!p || c.tradeEnded || c.phase === 'wrapup' || c.phase === 'ended') return { text: '·', done: null };
  if (!p.company.founded) return { text: '회사 만드는 중', done: false };
  if (c.clock.startedAt === null) return { text: '회사 만듦', done: true };
  if (c.paused) return { text: '멈춤', done: null };
  const ws = c.worksheet.current;
  if (ws?.length) {
    const done = worksheetAllDone(g, p, ws);
    return { text: done ? '학습지 다 씀' : '학습지 쓰는 중', done };
  }
  const ce = c.currentEvent;
  if (ce && !ce.closed && c.phase !== 'round') {
    const resp = respondedToCurrent(c, p);
    if (resp !== null) return { text: resp ? '응답함' : '응답하는 중', done: resp };
    const read = p.game.responses[ce.id] !== undefined;
    return { text: read ? '카드 읽음' : '카드 읽는 중', done: read };
  }
  if (c.phase === 'round') return c.settings.voyageMode === 'free' ? freeRoundTask(c.round, p) : roundTask(p);
  // (작업 153 추가) 자유 항해 판의 라운드 사이도 항해·사고팔기 시간
  if (c.phase === 'between' && c.settings.voyageMode === 'free' && c.round >= 1 && !c.tradeEnded) return freeRoundTask(c.round, p);
  return { text: '기다리는 중', done: null };
}

/** (작업 151, PRD 4.3.7.1) 자유 항해 라운드: 이번 라운드 사고팔기 했는가 + 항해 횟수 */
function freeRoundTask(round: number, p: Player): NowTask {
  const log = p.game.log;
  const traded = log.some((l) => l.round === round && (l.kind === 'buy' || l.kind === 'sell' || l.kind === 'produce'));
  const k = p.game.sailsThisRound ?? log.filter((l) => l.round === round && l.kind === 'voyage').length;
  return traded ? { text: `사고팔기 ✓ · 항해 ${k}번`, done: true } : { text: `아직 사고팔기 전 · 항해 ${k}번`, done: false };
}

/** 라운드 중 할 일 — 출항 준비(라운드마다 판) */
function roundTask(p: Player): NowTask {
  const pg = p.game;
  if (pg.ready) return { text: '출항 준비 끝', done: true };
  if (pg.dest) return { text: `목적지 ${portsById[pg.dest]?.name ?? pg.dest} · 출항 준비 아직`, done: false };
  return { text: '목적지 고르는 중', done: false };
}

/** 세션 보기(좌석·접속) + 게임 상태(자금·항구 등) → 표 줄 */
export function buildRows(
  g: TeacherGame | null,
  view: Pick<HostView<TeacherGame>, 'seats' | 'rejoinRequests'>,
  lastSeen: ReadonlyMap<number, number> = new Map(),
): StudentRow[] {
  const ws = g?.class.worksheet.current ?? null;
  const requests = new Set(view.rejoinRequests.map((r) => r.seat));
  return view.seats.map((s) => {
    const p: Player | undefined = g?.players[seatKey(s.seat)];
    const pg = p?.game;
    const missions = pg ? Object.values(pg.missions) : [];
    const port = pg?.port ?? '';
    return {
      seat: s.seat,
      pid: s.pid,
      companyName: s.companyName,
      nameStatus: s.nameStatus,
      flagColor: FLAG_COLORS.find((c) => c.id === p?.company.color)?.hex ?? '#8A8A8A',
      online: s.online,
      lastSeenAt: s.online ? null : (lastSeen.get(s.seat) ?? null),
      founded: !!p?.company.founded,
      port,
      portName: port ? (portsById[port as keyof typeof portsById]?.name ?? port) : '',
      dest: pg?.dest ? (portsById[pg.dest]?.name ?? pg.dest) : null,
      money: pg?.money ?? 0,
      exports: pg?.metrics.exports ?? 0,
      missionsDone: missions.filter((m) => m.status === 'done').length,
      missionsTotal: missions.length,
      ready: !!pg?.ready,
      responded: g && p ? respondedToCurrent(g.class, p) : null,
      worksheetDone: g && ws && ws.length && p ? worksheetAllDone(g, p, ws) : null,
      lettersRight: pg ? Object.values(pg.letters.slots).filter((x) => x === 'right').length : 0,
      rejoinRequested: requests.has(s.seat),
      now: g ? nowTaskOf(g, p) : { text: '·', done: null },
    };
  });
}

export function matchesFilter(r: StudentRow, f: FilterId): boolean {
  switch (f) {
    case 'all':
      return true;
    case 'help':
      return HELP_FILTERS.some((f) => matchesFilter(r, f)) || r.now.done === false;
    case 'offline':
      return !r.online;
    case 'noResponse':
      return r.responded === false;
    case 'notReady':
      return !r.ready;
    case 'missionTodo':
      return r.missionsTotal > r.missionsDone;
    case 'noWorksheet':
      return r.worksheetDone === false;
    case 'rejoin':
      return r.rejoinRequested;
    case 'nameCheck':
      return r.nameStatus === 'checkRealName';
  }
}

export function filterRows(rows: readonly StudentRow[], f: FilterId): StudentRow[] {
  return rows.filter((r) => matchesFilter(r, f));
}

export function filterCounts(rows: readonly StudentRow[]): Record<FilterId, number> {
  const out = {} as Record<FilterId, number>;
  for (const f of FILTERS) out[f.id] = rows.filter((r) => matchesFilter(r, f.id)).length;
  return out;
}

export function sortRows(rows: readonly StudentRow[], s: SortId): StudentRow[] {
  const list = [...rows];
  switch (s) {
    case 'seat':
      return list.sort((a, b) => a.seat - b.seat);
    case 'money':
      return list.sort((a, b) => b.money - a.money || a.seat - b.seat);
    case 'exports':
      return list.sort((a, b) => b.exports - a.exports || a.seat - b.seat);
    case 'company':
      return list.sort((a, b) => (a.companyName < b.companyName ? -1 : a.companyName > b.companyName ? 1 : a.seat - b.seat));
  }
}

/** 상단 요약 칩 "들어옴 24/25 · 출항 준비 12 · 응답 안 함 5"(작업 137 쉬운 말) */
export function summaryText(rows: readonly StudentRow[]): string {
  const online = rows.filter((r) => r.online).length;
  const ready = rows.filter((r) => r.ready).length;
  const noResp = rows.filter((r) => r.responded === false).length;
  return `들어옴 ${online}/${rows.length} · 출항 준비 ${ready} · 응답 안 함 ${noResp}`;
}

/** 자금 표시(만 원 단위 숫자 — 데이터의 돈 단위가 만 원) */
export function moneyText(n: number): string {
  return `${Math.round(n).toLocaleString('ko-KR')}`;
}
