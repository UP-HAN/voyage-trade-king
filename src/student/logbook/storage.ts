/**
 * 항해 기록장 기기 저장(작업 112, PRD 4.3.3 "판이 끝난 뒤에도 그 기기에서 24시간").
 *
 * - 키 `voyage.logbook`: `{ v: 1, entries: LogbookEntry[] }`. 판마다 한 항목(방 코드 + 판 씨앗) — 다른 날 판과 섞지 않는다.
 * - 같은 기기에서 새 판에 들어가면 이전 판 항목은 끝난 것으로 표시(endedAt)하고 목록에 따로 남겼다가 24시간 뒤 지운다.
 * - 판이 끝나면(endedAt) 24시간 뒤, 끝나지 않은 항목도 마지막 저장 뒤 24시간이 지나면 지운다(124 peer-store와 같은 규칙).
 * - 저장소는 124와 같이 고른다(`?as=` 탭은 sessionStorage, 아니면 localStorage — `peerStorageForHref`).
 *   124의 `voyage.peer` 기록(`logbook` 칸 한 개)은 방을 나가면 지워지고 판 하나만 담아서, 판별 목록을 이 키에 따로 둔다(result.md 가정).
 * 학생 자기 회사 기록만 담는다(다른 학생 정보·출석번호 없음).
 */
import { peerStorageForHref, type PeerStorageLike } from '../../sync/peer-store';
import type { LogbookEntry } from './model';

export const LOGBOOK_KEY = 'voyage.logbook';
/** 보관 시간(ms) */
export const LOGBOOK_KEEP_MS = 24 * 60 * 60 * 1000;
/** 기기에 남기는 판 수 상한 */
export const LOGBOOK_MAX = 10;

export function logbookStorage(href?: string): PeerStorageLike | null {
  const h = href ?? (typeof location !== 'undefined' ? location.href : 'http://localhost/');
  return peerStorageForHref(h);
}

function read(storage: PeerStorageLike | null): LogbookEntry[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(LOGBOOK_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw) as { v?: number; entries?: unknown };
    if (!data || data.v !== 1 || !Array.isArray(data.entries)) return [];
    return data.entries.filter((e): e is LogbookEntry => !!e && typeof e === 'object' && typeof (e as LogbookEntry).key === 'string' && Array.isArray((e as LogbookEntry).rows));
  } catch {
    return [];
  }
}

function write(storage: PeerStorageLike | null, entries: LogbookEntry[]): void {
  if (!storage) return;
  try {
    if (entries.length) storage.setItem(LOGBOOK_KEY, JSON.stringify({ v: 1, entries }));
    else storage.removeItem(LOGBOOK_KEY);
  } catch {
    /* 저장 못 해도 게임은 계속 */
  }
}

export function isExpired(e: Pick<LogbookEntry, 'endedAt' | 'savedAt'>, now: number): boolean {
  return (e.endedAt !== null && now - e.endedAt >= LOGBOOK_KEEP_MS) || now - e.savedAt >= LOGBOOK_KEEP_MS;
}

/** 만료된 기록을 지우고 남은 기록(최근 판 먼저) */
export function loadLogbooks(storage: PeerStorageLike | null, now: number = Date.now()): LogbookEntry[] {
  const all = read(storage);
  const keep = all.filter((e) => !isExpired(e, now));
  if (keep.length !== all.length) write(storage, keep);
  return [...keep].sort((a, b) => b.date - a.date || b.savedAt - a.savedAt);
}

export function findLogbook(storage: PeerStorageLike | null, key: string, now: number = Date.now()): LogbookEntry | null {
  return loadLogbooks(storage, now).find((e) => e.key === key) ?? null;
}

/** 이 판 기록 저장(같은 판이면 바꿔 쓰고, 다른 판의 끝나지 않은 기록은 끝난 것으로 표시) */
export function saveLogbook(storage: PeerStorageLike | null, entry: LogbookEntry, now: number = Date.now()): LogbookEntry[] {
  const list = loadLogbooks(storage, now)
    .filter((e) => e.key !== entry.key)
    .map((e) => (e.endedAt === null ? { ...e, endedAt: now } : e));
  const next = [entry, ...list].slice(0, LOGBOOK_MAX);
  write(storage, next);
  return next;
}

/** 기록 내용이 같은가(저장 시각 제외) — 같으면 다시 쓰지 않는다 */
export function sameContent(a: LogbookEntry | null, b: LogbookEntry): boolean {
  if (!a) return false;
  const strip = (e: LogbookEntry) => JSON.stringify({ ...e, savedAt: 0 });
  return strip(a) === strip(b);
}
