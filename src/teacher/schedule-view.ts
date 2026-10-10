/**
 * 타임라인(배치표) 묶기·이름·구간 띠 — 순수 함수 (작업 109, PRD 6.11.2·7.5 타임라인).
 * 배치표 계산은 123(`src/core/schedule.ts`), 여기서는 화면용으로 나누기만 한다.
 */
import {
  firstRoundPreview, inputFromClass, LINKED_EVENTS, nextRoundWait, tradeClock, tryBuildSchedule,
  type ClassState, type PlayUnit, type RoundNowBlock, type RoundNowPlan, type ScheduleItem,
} from '../core';
import { eventsById } from '../data/events';
import { lessonsById } from '../data/lessons';
import type { LessonId } from '../data/types';
import { DURING_MARK } from '../data/worksheet';

/** 사건 정의(연결 사건 L3-E5 → L3-E2 앞 사건 기준) */
export function eventDefOf(item: Pick<ScheduleItem, 'kind' | 'refId'>) {
  if (item.kind !== 'event') return null;
  return eventsById[item.refId] ?? eventsById[LINKED_EVENTS[item.refId] ?? ''] ?? null;
}

/** 항목 이름(교사 화면) */
export function itemLabel(it: ScheduleItem): string {
  switch (it.kind) {
    case 'round':
      return `라운드 ${it.round ?? it.refId}`;
    case 'event': {
      const d = eventDefOf(it);
      return d ? d.title : it.refId;
    }
    case 'worksheet': {
      if (it.placement === 'during') return `학습지 ${worksheetNo(it.refId)}${DURING_MARK} 지금 쓰기`;
      const ids = it.refIds?.length ? it.refIds : [it.refId];
      return `학습지 ${ids.map(worksheetNo).join('')}`;
    }
    case 'letter':
      return `편지 ${it.refId}`;
    case 'stageCover':
      if (it.variant === 'summary') return '앞 차시 요약 카드';
      if (it.variant === 'lesson') return `${it.stage} 차시 표지`;
      return `${it.stage} 구간 표지`;
    case 'forecast':
      return '돌발 사건 예보';
    case 'incident':
      return '돌발 사건';
    case 'comeback':
      return '역전 장치';
    default:
      return it.refId;
  }
}

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
/** 'W03' → '③' */
export function worksheetNo(id: string): string {
  const n = Number(id.replace(/^W/, ''));
  return n >= 1 && n <= 20 ? (CIRCLED[n - 1] as string) : id;
}

export function isTier1(it: ScheduleItem): boolean {
  if (it.kind !== 'event') return false;
  const d = eventDefOf(it);
  return (it.tier ?? d?.tier) === 1 || !!d?.required;
}

/** 지금 쓰기 번호가 뜨는 자리(미리보기 문구) */
const DURING_WHERE: Readonly<Record<string, string>> = { W03: '두 섬 뒤', W14: '베트남 결정 뒤' };

/** 판 설정 미리보기 한 줄: "지금 쓰기: ③(두 섬 뒤) ⑭(베트남 결정 뒤)" — 넣은 번호가 없으면 null (작업 132, PRD 4.3.3.1) */
export function duringPreviewLine(placed: readonly string[]): string | null {
  if (!placed.length) return null;
  return `지금 쓰기: ${placed.map((id) => `${worksheetNo(id)}(${DURING_WHERE[id] ?? '체험 뒤'})`).join(' ')}`;
}

/** 경과 초 → "m:ss" */
export function mmss(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export interface TimelineGroups {
  done: ScheduleItem[];
  live: ScheduleItem[];
  next: ScheduleItem[];
  /** 빠진 항목(회색, [넣기]) — 사건 중 form 'dropped' */
  dropped: ScheduleItem[];
  /** 그 밖의 대기 항목 수(다음 3개 뒤) */
  laterCount: number;
}

/** 완료 / 진행 중 / 다음 3개 / 빠진 항목 */
export function groupTimeline(items: readonly ScheduleItem[], nextCount = 3): TimelineGroups {
  const sorted = [...items].sort((a, b) => a.at - b.at);
  const dropped = sorted.filter((it) => it.kind === 'event' && it.form === 'dropped' && it.status === 'pending');
  const pending = sorted.filter((it) => it.status === 'pending' && it.form !== 'dropped');
  return {
    done: sorted.filter((it) => it.status === 'done' || it.status === 'skipped'),
    live: sorted.filter((it) => it.status === 'live'),
    next: pending.slice(0, nextCount),
    dropped,
    laterCount: Math.max(0, pending.length - nextCount),
  };
}

export interface StageBand {
  stage: LessonId;
  label: string;
  /** 무역 시간 중 비율 0~1 */
  startRatio: number;
  ratio: number;
  current: boolean;
  /** 이 구간 안에서 지난 비율 0~1 */
  progress: number;
}

/** 상단 구간 띠: 배치표의 구간별 첫 시각으로 나눈다(차시 한 판이면 한 칸) */
export function stageBands(cs: ClassState, scope: readonly LessonId[], playUnit: string, now: number): StageBand[] {
  const T = Math.max(1, cs.clock.durationSec);
  const e = tradeClock.elapsedSec(cs.clock, now);
  const starts = scope.map((st, i) => {
    const firsts = cs.schedule.items.filter((it) => it.stage === st).map((it) => it.at);
    return firsts.length ? Math.min(...firsts) : (T * i) / scope.length;
  });
  return scope.map((st, i) => {
    const start = i === 0 ? 0 : Math.min(T, starts[i] as number);
    const end = i === scope.length - 1 ? T : Math.min(T, starts[i + 1] as number);
    const len = Math.max(0, end - start);
    const title = lessonsById[st]?.title ?? st;
    return {
      stage: st,
      label: playUnit === 'lesson' ? `${st} ${title}` : st,
      startRatio: start / T,
      ratio: len / T,
      current: cs.stage === st && cs.clock.startedAt !== null,
      progress: len > 0 ? Math.min(1, Math.max(0, (e - start) / len)) : 0,
    };
  });
}

/** 라운드 남은 초(없으면 null) */
export function roundRemainingSec(cs: ClassState, now: number): number | null {
  if (cs.phase !== 'round') return null;
  if (cs.paused && cs.roundRemainingMs !== null) return Math.max(0, cs.roundRemainingMs / 1000);
  if (cs.roundEndsAt === null) return null;
  return Math.max(0, (cs.roundEndsAt - now) / 1000);
}

/** 무역 시계 남은 초 */
export function tradeRemainingSec(cs: ClassState, now: number): number {
  return tradeClock.remaining(cs.clock, now);
}

// ─── (작업 134) 라운드 시작 안내 ─────────────────────────────

/** 초 → "m분 s초"(0분이면 "s초", 0초면 "m분") */
export function minSecText(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (!m) return `${r}초`;
  return r ? `${m}분 ${r}초` : `${m}분`;
}

/** 이름 목록 "A·B·C" */
function joinNames(names: readonly string[]): string {
  return [...new Set(names)].join('·');
}

/**
 * [무역 시작] 확인 창 본문(교사 결정 3): 배치표에서 라운드 1 앞 활동과 라운드 1까지 시간을 계산한다.
 * 예: "먼저 벽란도 시장·무역·수입·수출 활동을 하고 약 3분 50초 뒤 라운드 1이 시작돼요([지금 라운드 시작]으로 당길 수 있어요)."
 */
export function startConfirmText(cs: ClassState, playUnit: PlayUnit, scope: readonly LessonId[]): string {
  const head = `무역 시간 ${Math.round(cs.settings.tradeMinutes)}분이 시작돼요.`;
  const r = tryBuildSchedule(inputFromClass(cs, playUnit, scope));
  if (!r.ok) return `${head} 시계가 흐르고 활동이 정해진 시각에 나와요.`;
  const p = firstRoundPreview(r.schedule.items);
  if (!p) return `${head} 시계가 흐르고 활동이 정해진 시각에 나와요.`;
  const names = p.activities.map(itemLabel);
  const when = `약 ${minSecText(p.atSec)} 뒤 라운드 ${p.round}이 시작돼요`;
  const first = names.length ? `먼저 ${joinNames(names)} 활동을 하고 ${when}` : `표지를 보고 ${when}`;
  const manual = cs.settings.progressMode === 'manual';
  const tail = manual
    ? ' 수동 진행이라 [발동]을 눌러야 다음 항목이 시작돼요(계획 시각은 안내예요).'
    : ' 그동안 학생 화면에는 라운드까지 남은 시간이 보여요.';
  return `${head} ${first}([지금 라운드 시작]으로 당길 수 있어요).${tail}`;
}

/** 교사 화면 "라운드 1까지 m:ss" / "다음 라운드까지 m:ss"(라운드 중·무역 전이면 null) */
export function nextRoundText(cs: ClassState, now: number): string | null {
  const w = nextRoundWait(cs, now);
  if (!w) return null;
  const who = w.first ? `라운드 ${w.round}까지` : `다음 라운드(${w.round})까지`;
  if (w.manual) return w.sec > 0 ? `${who} 계획 ${mmss(w.sec)}` : `라운드 ${w.round} 차례예요`;
  return w.sec > 0 ? `${who} ${mmss(w.sec)}` : `${who} 0:00 · 지금 활동이 끝나면 시작`;
}

/** [지금 라운드 시작] 비활성 이유 문구 */
export const ROUND_NOW_BLOCK_TEXT: Readonly<Record<RoundNowBlock, string>> = {
  NOT_STARTED: '무역을 시작한 뒤에 누를 수 있어요',
  TRADE_ENDED: '무역이 끝났어요',
  ROUND_IN_PROGRESS: '라운드가 진행 중이에요',
  WORKSHEET_OPEN: '학습지 시간이 끝나면 누를 수 있어요',
  PAUSED: '일시정지 중이에요',
  TIME_IS_UP: '무역 시간이 끝났어요',
  NO_NEXT_ROUND: '남은 라운드가 없어요',
};

/** [지금 라운드 시작] 1등급 확인 창 본문(무엇이 빠지는지 이름으로) */
export function roundNowConfirmBody(plan: RoundNowPlan): string {
  const tier1 = plan.tier1.map((x) => (x.live ? `「${x.title}」(진행 중 — 지금 닫혀요)` : `「${x.title}」`));
  const others = plan.skip.filter((it) => it.kind !== 'worksheet' || it.placement === 'during').filter((it) => !(it.kind === 'event' && plan.tier1.some((x) => x.id === it.refId))).map(itemLabel);
  const ws = plan.movedWorksheets.map(worksheetNo).join('');
  const lines = [tier1.length ? `핵심(1등급) 활동 ${tier1.join(', ')}을(를) 건너뛰고 지금 라운드를 시작할까요?` : '남은 사전 활동을 건너뛰고 지금 라운드를 시작할까요?'];
  if (ws) lines.push(`건너뛴 학습지 ${ws}은(는) 끝나고 써요.`);
  if (others.length) lines.push(`함께 건너뛰는 활동: ${joinNames(others)}.`);
  const cur = plan.closing ? eventsById[plan.closing] : undefined;
  if (cur && !cur.isCover && !plan.tier1.some((x) => x.id === plan.closing)) lines.push(`지금 하던 「${cur.title}」은(는) 닫혀요.`);
  return lines.join(' ');
}
