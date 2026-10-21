/**
 * 공용 화면 모델 — 순수 함수 (작업 110, PRD 7.6·6.14.2·4.1.1).
 *
 * 공용 화면은 호스트 탭(교사 대시보드)이 `screen-bridge`(124)로 보내는 공개 상태만 받는다:
 * `publicState = { class: PublicClass, public: PublicState, screenScene }`, `classView = { screenScene, className, playUnit, scope }`.
 * 여기에는 출석번호·학생별 자금·응답 여부 명단이 없다(103 aggregate). 이 파일은 그중 **화면에 쓸 것만 골라** 장면을 정한다.
 * 학생 표시는 늘 회사 이름 + 깃발(이름이 null이면 "이름 짓는 중")뿐이다.
 */
import { tradeClock, type LeaderEntry, type PublicClass, type PublicState, type ScheduleItem } from '../core';
import { metrics as METRICS, type MetricId } from '../data/awards';
import { checkQuizFor } from '../data/checkQuiz';
import { ruleCards, summaryCards } from '../data/dex';
import { COVER_EVENT_IDS, eventsById } from '../data/events';
import { lessonsById } from '../data/lessons';
import { lessonCards, DURING_AFTER_NEWS_TEXT } from '../data/schedule';
import type { LessonId, WorksheetId } from '../data/types';
import { worksheetById, duringLabel } from '../data/worksheet';

/** 교사가 고르는 장면(109 `SCREEN_SCENES`와 같은 값) */
export type ScreenChoice = 'auto' | 'leaderboard' | 'map' | 'code' | 'black';

/** 실제로 그리는 장면 */
export type SceneId =
  | 'code'
  | 'rules'
  | 'cover'
  | 'summary'
  | 'event'
  | 'bars'
  | 'map'
  | 'leaderboard'
  | 'worksheet'
  | 'pause'
  | 'awards'
  | 'ended'
  | 'black';

export interface ScreenData {
  cls: PublicClass;
  pub: PublicState;
  choice: ScreenChoice;
  playUnit: string;
  scope: LessonId[];
}

const CHOICES: readonly ScreenChoice[] = ['auto', 'leaderboard', 'map', 'code', 'black'];
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** 다리로 받은 내용 → 화면 자료(모양이 맞지 않으면 null) */
export function parseScreenData(publicState: unknown, classView: unknown): ScreenData | null {
  if (!isObj(publicState) || !isObj(publicState.class) || !isObj(publicState.public)) return null;
  const cls = publicState.class as unknown as PublicClass;
  const pub = publicState.public as unknown as PublicState;
  if (!isObj(cls.clock) || !isObj(cls.schedule) || !Array.isArray(pub.companies)) return null;
  const cv = isObj(classView) ? classView : {};
  const rawChoice = (cv.screenScene ?? publicState.screenScene) as ScreenChoice;
  const choice = CHOICES.includes(rawChoice) ? rawChoice : 'auto';
  const scopeRaw = Array.isArray(cv.scope) ? cv.scope : cls.settings?.scope;
  const scope = (Array.isArray(scopeRaw) ? scopeRaw : [cls.stage]).filter((s): s is LessonId => typeof s === 'string' && s in lessonsById);
  const playUnit = typeof cv.playUnit === 'string' ? cv.playUnit : (cls.settings?.playUnit ?? 'unit');
  return { cls, pub, choice, playUnit, scope: scope.length ? scope : [cls.stage] };
}

// ─────────────────────────── 시계 ───────────────────────────

export function mmss(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function tradeRemainingSec(cls: PublicClass, now: number): number {
  return tradeClock.remaining(cls.clock, now);
}

/** 라운드 남은 초(라운드 중이 아니면 null) */
export function roundRemainingSec(cls: PublicClass, now: number): number | null {
  if (cls.phase !== 'round') return null;
  if (cls.paused && cls.roundRemainingMs !== null) return Math.max(0, cls.roundRemainingMs / 1000);
  if (cls.roundEndsAt === null) return null;
  return Math.max(0, (cls.roundEndsAt - now) / 1000);
}

export interface ClockInfo {
  /** 'trade' = 남은 시간 표시, 'prep' = "곧 무역이 시작돼요", 'hidden' = 마무리·끝 */
  mode: 'trade' | 'prep' | 'hidden';
  stageLabel: string;
  remaining: string;
  remainingSec: number;
  paused: boolean;
}

/** 위쪽 구석 무역 시계: "L2 · 자원을 사 와서 만들어 팔아요 · 14:20" */
export function clockInfo(d: ScreenData, now: number): ClockInfo {
  const { cls } = d;
  const lesson = lessonsById[cls.stage];
  // (작업 115 수정 1회차) 개발 용어 'L2' 대신 '2차시'
  const stageLabel = `${cls.stage.replace(/^L/, '')}차시 · ${shortTitle(lesson?.title ?? '')}`;
  const sec = tradeRemainingSec(cls, now);
  const base = { stageLabel, remaining: mmss(sec), remainingSec: sec, paused: !!cls.paused };
  if (cls.phase === 'wrapup' || cls.phase === 'ended' || cls.tradeEnded) return { ...base, mode: 'hidden' };
  if (cls.clock.startedAt === null) return { ...base, mode: 'prep' };
  return { ...base, mode: 'trade' };
}

/** 긴 구간 제목은 첫 마디만(" · ", " — " 앞) */
export function shortTitle(title: string): string {
  return title.split(/ · | — /)[0] ?? title;
}

// ─────────────────────────── 장면 고르기 ───────────────────────────

/** 지금 진행 중인 배치표 항목(종류) */
export function liveItem(cls: PublicClass, pred: (it: ScheduleItem) => boolean): ScheduleItem | undefined {
  return cls.schedule.items.find((it) => it.status === 'live' && pred(it));
}

const COVER_IDS = new Set<string>(Object.values(COVER_EVENT_IDS));

/** 표지 사건인가(구간 표지·차시 표지) */
export function isCoverEvent(id: string): boolean {
  return COVER_IDS.has(id) || !!eventsById[id]?.isCover;
}

/** 결과 막대를 그릴 수 있는 사건인가(벽란도·두 섬·확인 퀴즈·투표) */
export function hasResultBars(d: ScreenData, eventId: string): boolean {
  const def = eventsById[eventId];
  if (!def) return false;
  if (eventId === 'L1-E1' || eventId === 'L1-E5' || def.kind === 'checkQuiz') return true;
  return def.kind === 'vote' && d.pub.vote?.id === eventId;
}

/** 수상 회사가 있는 상(수상자 없는 상은 공용 화면에 그리지 않는다) */
export function awardsWithWinners(d: ScreenData) {
  return (d.pub.awards ?? []).filter((a) => a.winners.length > 0);
}

export function hasAwardWinners(d: ScreenData): boolean {
  return awardsWithWinners(d).length > 0;
}

/** 순위판을 보여 줄 수 있는가(N>0) */
export function leaderboardOn(d: ScreenData): boolean {
  return d.cls.settings.leaderboardTopN > 0;
}

/** 준비 단계: 회사가 들어오기 시작하면 방 코드 20초 ↔ 항해 규칙 12초 */
const PREP_CODE_SEC = 20;
const PREP_RULES_SEC = 12;

/**
 * 장면 고르기. 교사가 고른 장면(순위판·해도·방 코드·검은 화면)이 있으면 그대로,
 * '자동'이면 일시정지 > 학습지 시간 > 앞 차시 요약 > 현재 사건(표지·사건·투표) > 라운드 중 해도 > 준비(방 코드) 순.
 */
export function pickScene(d: ScreenData, now: number): SceneId {
  const { cls, pub } = d;
  if (d.choice !== 'auto') return d.choice;
  if (cls.phase === 'ended') return hasAwardWinners(d) ? 'awards' : 'ended';
  if (cls.paused) return 'pause';
  if (cls.worksheet.current && cls.worksheet.current.length) return 'worksheet';
  if (liveItem(cls, (it) => it.kind === 'stageCover' && it.variant === 'summary')) return 'summary';
  const ce = cls.currentEvent;
  // (작업 115 수정 1회차) 2차시~ 라운드 시작 임무(L2-E3·E4)·첫 입항 사건(L2-E5)은 학생 화면의 임무 패널 — TV는 라운드 해도 그대로
  const introDef = ce && !ce.closed ? eventsById[ce.id] : undefined;
  const missionIntro = !!introDef && introDef.lesson !== 'L1' && (introDef.kind === 'mission' || introDef.trigger.type === 'firstArrival');
  if (ce && !ce.closed && !(missionIntro && cls.phase === 'round')) {
    if (isCoverEvent(ce.id)) return 'cover';
    const def = eventsById[ce.id];
    if (def?.kind === 'vote' && pub.vote?.id === ce.id && pub.vote.revealed) return 'bars';
    return 'event';
  }
  if (cls.phase === 'round') return 'map';
  if (cls.phase === 'prep') {
    if (pub.joinedCount > 0) {
      const t = Math.floor(now / 1000) % (PREP_CODE_SEC + PREP_RULES_SEC);
      if (t >= PREP_CODE_SEC) return 'rules';
    }
    return 'code';
  }
  if (cls.phase === 'wrapup') return hasAwardWinners(d) ? 'awards' : leaderboardOn(d) ? 'leaderboard' : 'map';
  // 라운드 사이·사건 뒤: 방금 끝난 사건 결과 막대 → 순위판 → 해도
  if (ce && ce.closed && hasResultBars(d, ce.id)) return 'bars';
  if (cls.phase === 'between' && leaderboardOn(d)) return 'leaderboard';
  return 'map';
}

// ─────────────────────────── 순위판 ───────────────────────────

/** 순위판 탭 순서(PRD 7.6: 수출액·도감·사회적 책임·협력·무역 박사·개척·최종 자산 + 도약) */
export const LEADER_TAB_ORDER: readonly MetricId[] = ['exports', 'dex', 'csr', 'coop', 'quiz', 'explore', 'finalAsset', 'leap'];
export const LEADER_ROTATE_SEC = 10;

export interface LeaderTab {
  id: MetricId;
  name: string;
  unit: string;
  /**
   * 'ok' = 순위를 보인다(10초마다 돌아가는 탭), 'soon' = 도약 탭 "곧 공개"(순환에서 뺌),
   * 'flat' = 모든 회사 값이 같다(거래 전 등 — 1위·1위·1위 대신 순환에서 뺌, 103 hideFlatMetrics와 같은 취지)
   */
  state: 'ok' | 'soon' | 'flat';
  /** 상위 N(동점이 있어도 N줄 이하, 하위 순위 없음). 'ok'가 아니면 빈 배열 */
  entries: LeaderEntry[];
}

/** 공개된 지표 탭 전부(상태 포함) */
export function leaderTabs(d: ScreenData): LeaderTab[] {
  const topN = d.cls.settings.leaderboardTopN;
  if (topN <= 0) return [];
  const joined = d.pub.joinedCount;
  const out: LeaderTab[] = [];
  for (const id of LEADER_TAB_ORDER) {
    const raw = d.pub.leaderboard[id];
    if (raw === undefined) continue;
    const m = METRICS.find((x) => x.id === id);
    if (!m) continue;
    if (raw === 'soon') {
      out.push({ id, name: m.name, unit: m.unit, state: 'soon', entries: [] });
      continue;
    }
    // 103 leaderboard()는 rank<=N인 회사를 모두 준다 → 전원이 1위면 모든 값이 같다
    const flat = joined > 1 && raw.length >= joined && raw.every((e) => e.rank === 1);
    if (flat) {
      out.push({ id, name: m.name, unit: m.unit, state: 'flat', entries: [] });
      continue;
    }
    // 경쟁 순위(1,2,2,4)에서 앞 N개는 늘 rank<=N → 회사가 N개 이상이면 언제나 N줄
    const entries = raw.filter((e) => e.rank <= topN).slice(0, topN);
    out.push({ id, name: m.name, unit: m.unit, state: entries.length ? 'ok' : 'flat', entries });
  }
  return out;
}

/** 순환하는 탭(줄이 있는 탭만 — TV에 빈 순위판이 10초 동안 뜨지 않게) */
export function rotatingTabs(d: ScreenData): LeaderTab[] {
  return leaderTabs(d).filter((t) => t.state === 'ok');
}

/** 10초마다 돌아가는 탭 */
export function currentLeaderTab(tabs: readonly LeaderTab[], now: number): number {
  if (tabs.length === 0) return -1;
  return Math.floor(now / 1000 / LEADER_ROTATE_SEC) % tabs.length;
}

/** 회사 이름 표시(막힌·확인 전 이름은 "이름 짓는 중") */
export function companyLabel(name: string | null | undefined): string {
  return name && name.trim() ? name : '이름 짓는 중';
}


// ─────────────────────────── 막대(투표·결과) ───────────────────────────

export interface BarRow {
  label: string;
  value: number;
}

export interface BarsModel {
  eventId: string;
  title: string;
  question: string;
  /** true면 막대 없이 응답 수만(투표 결과 공개 전) */
  countOnly: boolean;
  responded: number;
  total: number;
  rows: BarRow[];
  /** 막대 최댓값(비율이면 100) */
  max: number;
  /** 값 뒤에 붙는 말 */
  suffix: string;
  /** 비율 막대(확인 퀴즈 정답률) */
  percent: boolean;
}

const VOTE_LABELS: Readonly<Record<string, string>> = { yes: '찬성', no: '반대', tariff: '관세를 매겨요', noTariff: '관세를 매기지 않아요' };

/** 사건 결과 → 막대(이름 없음, 수만) */
export function barsFor(d: ScreenData, eventId: string): BarsModel | null {
  const def = eventsById[eventId];
  if (!def) return null;
  const { pub } = d;
  const ev = pub.event && pub.event.id === eventId ? pub.event : null;
  const base = { eventId, title: def.title, responded: ev?.responded ?? 0, total: ev?.total ?? pub.joinedCount };
  if (eventId === 'L1-E1') {
    const rows = pub.byeokrando.map((n, i) => ({ label: `${i}장`, value: n }));
    // 아무도 맞히지 못한 뒤쪽 칸은 줄인다(최소 6칸)
    let last = rows.length - 1;
    while (last > 5 && (rows[last]?.value ?? 0) === 0) last--;
    const shown = rows.slice(0, last + 1);
    const total = shown.reduce((a, r) => a + r.value, 0);
    return { ...base, question: '맞힌 카드 수', countOnly: false, rows: shown, max: Math.max(1, ...shown.map((r) => r.value)), suffix: '개 회사', percent: false, responded: total, total: Math.max(total, base.total) };
  }
  if (eventId === 'L1-E5') {
    const t = pub.twoIslands;
    return {
      ...base,
      question: '두 나라의 교환에 성공한 회사',
      countOnly: false,
      rows: [
        { label: '성공', value: t.success },
        { label: '다시 해 봐요', value: Math.max(0, t.total - t.success) },
      ],
      max: Math.max(1, t.total),
      suffix: '개 회사',
      percent: false,
      responded: t.total,
      total: Math.max(t.total, base.total),
    };
  }
  if (def.kind === 'checkQuiz') {
    const qs = checkQuizFor(def.lesson);
    const rows = qs.map((q, i) => {
      const r = pub.checkQuiz[q.id];
      return { label: `문제 ${i + 1}`, value: r && r.total > 0 ? Math.round((r.right / r.total) * 100) : 0 };
    });
    const answered = Math.max(0, ...qs.map((q) => pub.checkQuiz[q.id]?.total ?? 0));
    return { ...base, question: '문항별 정답률', countOnly: false, rows, max: 100, suffix: '%', percent: true, responded: ev?.responded ?? answered };
  }
  if (def.kind === 'vote') {
    const v = pub.vote && pub.vote.id === eventId ? pub.vote : null;
    const counts = v?.counts ?? {};
    const votes = Object.values(counts).reduce((a, n) => a + n, 0);
    const opt = (k: string) => def.options?.find((o) => o.id === k)?.label ?? VOTE_LABELS[k] ?? k;
    return {
      ...base,
      question: def.body && def.body !== 'TODO' ? firstSentence(def.body) : def.title,
      countOnly: !v?.revealed,
      rows: Object.entries(counts).map(([k, n]) => ({ label: opt(k), value: n })),
      max: Math.max(1, votes),
      suffix: '표',
      percent: false,
      responded: ev?.responded ?? votes,
    };
  }
  return null;
}

function firstSentence(s: string): string {
  const m = s.match(/^.*?[.?!요다](?=\s|$)/);
  return (m ? m[0] : s).trim();
}

// ─────────────────────────── 표지·학습지·규칙 ───────────────────────────

export interface CoverModel {
  lesson: LessonId;
  /** 'lesson' = 차시 표지(차시 한 판), 'stage' = 구간 표지(단원 한 판) */
  variant: 'lesson' | 'stage';
  kicker: string;
  title: string;
  question: string;
  pages: string;
  image: string | null;
  /** 단원 한 판 L2 표지: "지금까지 상위 N개 회사"(N=0이면 null) */
  topCompanies: LeaderEntry[] | null;
}

export function coverFor(d: ScreenData, eventId: string): CoverModel {
  const def = eventsById[eventId];
  const lesson = (def?.lesson ?? d.cls.stage) as LessonId;
  const card = lessonCards.find((c) => c.id === lesson);
  const item = liveItem(d.cls, (it) => it.kind === 'stageCover' && it.variant !== 'summary') ?? d.cls.schedule.items.find((it) => it.kind === 'stageCover' && it.refId === eventId);
  const variant: 'lesson' | 'stage' = item?.variant === 'lesson' || (d.playUnit === 'lesson' && item?.variant !== 'stage') ? 'lesson' : 'stage';
  let topCompanies: LeaderEntry[] | null = null;
  const topN = d.cls.settings.leaderboardTopN;
  if (item?.topCompanies && topN > 0) {
    const raw = d.pub.leaderboard.finalAsset ?? d.pub.leaderboard.exports;
    if (Array.isArray(raw)) topCompanies = raw.filter((e) => e.rank <= topN).slice(0, topN);
  }
  return {
    lesson,
    variant,
    kicker: variant === 'lesson' ? `${lesson.replace(/^L/, '')}차시` : `단원 한 판 · ${lesson.replace(/^L/, '')}차시`,
    title: card?.title ?? lessonsById[lesson]?.title ?? '',
    question: card?.question ?? '',
    pages: card ? `교과서 ${card.pages}쪽` : '',
    image: def?.image ?? null,
    topCompanies,
  };
}

export interface SummaryModel {
  title: string;
  lines: { text: string; pages: string }[];
}

export function summaryFor(d: ScreenData): SummaryModel[] {
  const it = liveItem(d.cls, (x) => x.kind === 'stageCover' && x.variant === 'summary');
  const ids = it?.refIds ?? [];
  return summaryCards
    .filter((c) => ids.includes(c.id))
    .map((c) => ({ title: c.title, lines: c.lines.map((l) => ({ text: l.text, pages: `${l.pages.join('·')}쪽` })) }));
}

export interface WorksheetRow {
  id: WorksheetId;
  label: string;
  prompt: string;
  pages: string;
  done: number;
}

/** during = '지금 쓰기' ★ 칸 팝업(작업 132): 번호 뒤 ★, 문구 = during.prompt(+ 보도 앞 덧붙임), 완료 수 = ★ 칸 완료 */
export function worksheetRows(d: ScreenData, ids: readonly string[], during = false): WorksheetRow[] {
  return ids
    .map((id) => worksheetById[id as WorksheetId])
    .filter((w): w is NonNullable<typeof w> => !!w)
    .map((w) =>
      during && w.during
        ? {
            id: w.id,
            label: duringLabel(w.id),
            prompt: d.cls.worksheet.afterNews ? `${w.during.prompt} ${DURING_AFTER_NEWS_TEXT}` : w.during.prompt,
            pages: w.pagesLabel,
            done: d.pub.duringDone?.[w.id] ?? 0,
          }
        : { id: w.id, label: w.label, prompt: w.prompt, pages: w.pagesLabel, done: d.pub.worksheetDone[w.id] ?? 0 },
    );
}

/** 마무리 단계 '끝나고 쓰기' 학습지 번호 */
export function afterWorksheets(d: ScreenData): WorksheetRow[] {
  const wrap = d.cls.schedule.wrapup ?? [];
  const ids = wrap.find((w) => w.id === 'afterWorksheet')?.worksheetIds ?? [];
  return worksheetRows(d, ids);
}

/** 항해 규칙 카드(역전 장치가 꺼진 판이면 2번 숨김, 돌발 사건이 꺼진 판이면 돌발 사건 카드 숨김) */
export function rulesFor(d: ScreenData) {
  const s = d.cls.settings;
  return ruleCards.filter((r) => (r.requires !== 'comeback' || s.comeback) && (r.requires !== 'incidents' || s.incidentFreq !== 'off'));
}

/** QR 주소: 학생 입장 화면으로 바로 가고 방 코드 칸이 미리 채워진다(`?room=482137#/play`) */
export function joinUrl(baseUrl: string, code: string): string {
  return /^\d{6}$/.test(code) ? `${baseUrl}?room=${code}#/play` : baseUrl;
}

/** 주소 표시(해시·검색어 제외, 프로토콜 없이): "lab.ches.es.kr/voyage" */
export function shortAddress(href: string): { display: string; url: string } {
  try {
    const u = new URL(href);
    let path = u.pathname.replace(/index\.html$/, '');
    const url = `${u.origin}${path}`;
    path = path.replace(/\/+$/, '');
    return { display: `${u.host}${path}`, url };
  } catch {
    return { display: href, url: href };
  }
}

/** "482137" → "482 137" */
export function spacedCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}
