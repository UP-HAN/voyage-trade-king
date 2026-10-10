/**
 * 항해 기록장(S26, PRD 4.3.3·4.1.1) 모델 — 순수 함수 (작업 112).
 *
 * 이번 판의 학습지 번호(배치표에 들어간 번호만 — 차시 한 판이면 그 차시 번호만)별로 문구·쪽수·기록 도우미 값을 모은다.
 * 도우미 값 계산은 `src/core/worksheet-helpers.ts`. 학생 기기가 자기 상태(`state.me`) + 공개 상태로 계산해 기기에 저장한다(storage.ts).
 * 제목: "항해 기록장 — 차시 한 판 L2 · 10월 14일"(학급 이름은 학생 기기에 오지 않아 넣지 않는다 — result.md 가정).
 */
import type { PublicClass, PublicState } from '../../core';
import {
  playUnitTitle,
  playWorksheetIds,
  worksheetHelperRows,
  type HelperPublic,
} from '../../core/worksheet-helpers';
import { worksheetById } from '../../data/worksheet';
import type { HelperKey, LessonId, WorksheetId } from '../../data/types';
import type { MeView } from '../predict';

export interface LogbookRow {
  id: WorksheetId;
  /** 원문자 ①~⑳ */
  label: string;
  lesson: LessonId | 'optional';
  prompt: string;
  pagesLabel: string;
  helper: HelperKey | null;
  /** 도우미 한 줄(helper가 없으면 null) */
  text: string | null;
  hasRecord: boolean;
  /** 이 기기에서 [다 썼어요]를 눌렀는가 */
  done: boolean;
  /** (작업 132) 이 기기에서 '지금 쓰기' (별표) 칸 [다 썼어요]를 눌렀는가(③·⑭) — "(별표) 2번 칸은 이미 썼어요" */
  duringDone?: boolean;
  /** 지금 쓰기 칸 번호(예: '2') */
  duringPart?: string;
}

export interface LogbookEntry {
  /** 판 구별(같은 기기의 다른 판과 섞지 않음): 방 코드 + 판 씨앗 */
  key: string;
  playUnit: string;
  scope: string[];
  /** "차시 한 판 L2" */
  unitTitle: string;
  /** "10월 14일" */
  dateLabel: string;
  /** 판 날짜 기준 시각(무역 시작, 없으면 처음 저장) ms */
  date: number;
  companyName: string;
  rows: LogbookRow[];
  /** 무역이 끝난 시각(이때부터 24시간 보관). 진행 중이면 null */
  endedAt: number | null;
  savedAt: number;
}

export function dateLabelOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

/** 기록장 제목 */
export function logbookTitle(e: Pick<LogbookEntry, 'unitTitle' | 'dateLabel'>, className?: string | null): string {
  const parts = [className?.trim(), e.unitTitle, e.dateLabel].filter((x): x is string => !!x);
  return `항해 기록장 — ${parts.join(' · ')}`;
}

export function logbookKey(code: string | null | undefined, cls: Pick<PublicClass, 'seed'>): string {
  return `${code ?? 'room'}:${cls.seed}`;
}

/** 지금 상태로 기록장 한 판을 만든다 */
export function buildLogbookEntry(o: {
  cls: PublicClass;
  me: MeView;
  pub?: PublicState | null;
  code?: string | null;
  now: number;
  prev?: LogbookEntry | null;
}): LogbookEntry {
  const { cls, me } = o;
  const ids = playWorksheetIds(cls.schedule);
  const helperRows = worksheetHelperRows(ids, { cls, player: me, pub: (o.pub ?? null) as HelperPublic | null });
  const rows: LogbookRow[] = helperRows.map((h) => {
    const w = worksheetById[h.id];
    return {
      id: h.id,
      label: w.label,
      lesson: w.lesson,
      prompt: w.prompt,
      pagesLabel: w.pagesLabel,
      helper: h.helper,
      text: h.text,
      hasRecord: h.hasRecord,
      done: me.game.worksheetDone.includes(h.id),
      ...(w.during && (me.game.duringDone ?? []).includes(h.id) ? { duringDone: true, duringPart: w.during.part } : {}),
    };
  });
  const date = cls.clock.startedAt ?? o.prev?.date ?? o.now;
  const ended = cls.tradeEnded || cls.phase === 'wrapup' || cls.phase === 'ended';
  const scope = [...cls.settings.scope];
  return {
    key: logbookKey(o.code, cls),
    playUnit: cls.settings.playUnit,
    scope,
    unitTitle: playUnitTitle(cls.settings.playUnit, scope),
    dateLabel: dateLabelOf(date),
    date,
    companyName: me.company.name,
    rows,
    endedAt: o.prev?.endedAt ?? (ended ? o.now : null),
    savedAt: o.now,
  };
}

/** 단원 한 판이면 구간별로 묶는다(차시 한 판은 한 묶음) */
export function groupRows(e: Pick<LogbookEntry, 'rows' | 'playUnit'>): { stage: string | null; rows: LogbookRow[] }[] {
  if (e.playUnit === 'lesson') return [{ stage: null, rows: e.rows }];
  const out: { stage: string | null; rows: LogbookRow[] }[] = [];
  for (const r of e.rows) {
    const st = r.lesson === 'optional' ? '선택 활동' : r.lesson;
    const g = out.find((x) => x.stage === st);
    if (g) g.rows.push(r);
    else out.push({ stage: st, rows: [r] });
  }
  return out;
}
