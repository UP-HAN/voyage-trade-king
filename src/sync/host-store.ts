/**
 * 교사 브라우저 저장 (작업 124, PRD 7.3·10.7).
 *
 * - 키 `voyage.host.<code>`: 판 전체 기록(`StoredHost` = 세션 장부 + 리듀서 스냅숏 + hostToken + savedAt). 1초 묶음 저장은 host-session이 한다.
 * - 키 `voyage.host.last`: 마지막 판 코드(이어하기용).
 * - 2MB(UTF-8 바이트)를 넘으면 주입된 `compact(record)`(기본: 학생별 `log` 배열 앞부분 자르기)를 되풀이한 뒤 저장.
 * - 판이 끝나면(`endedAt`) 24시간 뒤 삭제. 끝나지 않은 기록도 마지막 저장 뒤 24시간이 지나면 삭제(방은 서버에서 최대 8시간).
 *   `purgeExpired()`는 열 때마다 부른다.
 * - 판 옮기기 파일(hostToken 포함 + 경고 문구), 결과 파일(JSON·CSV, UTF-8 BOM).
 *
 * 판 전체 상태는 **교사 localStorage에만** 저장한다(서버·학생 기기에 저장하지 않음).
 */
import type { JsonObject } from '@shared/protocol';
import type { SessionData } from './host-session';

export const HOST_KEY_PREFIX = 'voyage.host.';
export const HOST_LAST_KEY = 'voyage.host.last';
/** 마지막 틱 시각만 따로(가벼운 키 — 출력 없는 틱에는 판 전체를 저장하지 않으므로 끊긴 시간 계산용). `voyage.host.` 아래에 두지 않는다(목록과 겹치지 않게) */
export const HOST_TICK_PREFIX = 'voyage.hosttick.';
export const HOST_MAX_BYTES = 2 * 1024 * 1024;
export const EXPIRE_MS = 24 * 60 * 60 * 1000;
export const MOVE_FILE_KIND = 'voyage-move';
export const MOVE_FILE_WARNING =
  '이 파일이 있으면 선생님 권한을 가질 수 있어요. 다른 사람에게 보내지 말고, 판을 옮긴 뒤에는 지워 주세요.';

/** 저장 형식(버전 v: 3) */
export interface StoredHost<G = unknown> {
  v: 3;
  kind: 'voyage-host';
  code: string;
  hostToken: string;
  savedAt: number;
  /** 판이 끝난 시각(없으면 null) — 24시간 뒤 삭제 */
  endedAt: number | null;
  session: SessionData;
  game: G;
}

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

export interface HostStoreOptions {
  storage?: StorageLike | null;
  now?: () => number;
  /** 크기 상한(바이트). 기본 2MB */
  maxBytes?: number;
  /** 너무 클 때 줄이는 함수. 기본 `compactLogs` */
  compact?: (record: StoredHost) => StoredHost;
}

export interface SaveResult {
  ok: boolean;
  bytes: number;
  compacted: number;
  error?: 'QUOTA' | 'NO_STORAGE';
}

export interface HostStore {
  load(code: string): StoredHost | null;
  /** 마지막 판(없으면 null) */
  loadLast(): StoredHost | null;
  lastCode(): string | null;
  save(record: StoredHost): SaveResult;
  remove(code: string): void;
  /** 만료된 기록 삭제. 지운 코드 목록 */
  purgeExpired(): string[];
  /** 저장된 판 코드 목록 */
  list(): string[];
  /** 마지막 틱 시각 기록·읽기(없으면 null) */
  saveTick(code: string, at: number): void;
  loadTick(code: string): number | null;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function byteLength(s: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s).length;
  return s.length * 3;
}

/**
 * 기본 줄이기: `game` 안의 `players.*` 아래에 있는 `log` 배열을 찾아 앞쪽 절반을 자른다(최소 10개는 남김).
 * 한 번 부를 때마다 한 번 줄인다. 더 줄일 것이 없으면 같은 객체를 돌려준다.
 */
export function compactLogs(record: StoredHost): StoredHost {
  const game = record.game as JsonObject | null;
  const players = game && typeof game === 'object' ? (game.players as Record<string, unknown> | undefined) : undefined;
  if (!players || typeof players !== 'object') return record;
  let changed = false;
  const trim = (o: unknown, depth: number): unknown => {
    if (depth > 6 || !o || typeof o !== 'object' || Array.isArray(o)) return o;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (k === 'log' && Array.isArray(v) && v.length > 10) {
        const keep = Math.max(10, Math.ceil(v.length / 2));
        out[k] = v.slice(v.length - keep);
        changed = true;
      } else out[k] = trim(v, depth + 1);
    }
    return out;
  };
  const nextPlayers: Record<string, unknown> = {};
  for (const [k, p] of Object.entries(players)) nextPlayers[k] = trim(p, 0);
  if (!changed) return record;
  return { ...record, game: { ...game, players: nextPlayers } };
}

export function createHostStore(o: HostStoreOptions = {}): HostStore {
  const storage = o.storage === undefined ? defaultStorage() : o.storage;
  const now = o.now ?? (() => Date.now());
  const maxBytes = o.maxBytes ?? HOST_MAX_BYTES;
  const compact = o.compact ?? compactLogs;

  const read = (key: string): StoredHost | null => {
    if (!storage) return null;
    try {
      const raw = storage.getItem(key);
      if (!raw) return null;
      const rec = JSON.parse(raw) as StoredHost;
      return isStoredHost(rec) ? rec : null;
    } catch {
      return null;
    }
  };

  const api: HostStore = {
    load(code) {
      return read(HOST_KEY_PREFIX + code);
    },
    loadLast() {
      const c = api.lastCode();
      return c ? api.load(c) : null;
    },
    lastCode() {
      try {
        return storage?.getItem(HOST_LAST_KEY) ?? null;
      } catch {
        return null;
      }
    },
    save(record) {
      if (!storage) return { ok: false, bytes: 0, compacted: 0, error: 'NO_STORAGE' };
      let rec = record;
      let json = JSON.stringify(rec);
      let bytes = byteLength(json);
      let compacted = 0;
      while (bytes > maxBytes && compacted < 20) {
        const next = compact(rec);
        if (next === rec) break;
        rec = next;
        compacted++;
        json = JSON.stringify(rec);
        bytes = byteLength(json);
      }
      try {
        storage.setItem(HOST_KEY_PREFIX + rec.code, json);
        storage.setItem(HOST_LAST_KEY, rec.code);
        return { ok: true, bytes, compacted };
      } catch {
        return { ok: false, bytes, compacted, error: 'QUOTA' };
      }
    },
    remove(code) {
      try {
        storage?.removeItem(HOST_KEY_PREFIX + code);
        storage?.removeItem(HOST_TICK_PREFIX + code);
        if (api.lastCode() === code) storage?.removeItem(HOST_LAST_KEY);
      } catch {
        /* 무시 */
      }
    },
    saveTick(code, at) {
      try {
        storage?.setItem(HOST_TICK_PREFIX + code, String(at));
      } catch {
        /* 무시(판 저장 실패는 save가 알림) */
      }
    },
    loadTick(code) {
      try {
        const v = Number(storage?.getItem(HOST_TICK_PREFIX + code));
        return Number.isFinite(v) && v > 0 ? v : null;
      } catch {
        return null;
      }
    },
    list() {
      if (!storage) return [];
      const out: string[] = [];
      try {
        for (let i = 0; i < storage.length; i++) {
          const k = storage.key(i);
          if (k && k.startsWith(HOST_KEY_PREFIX) && k !== HOST_LAST_KEY) out.push(k.slice(HOST_KEY_PREFIX.length));
        }
      } catch {
        /* 무시 */
      }
      return out;
    },
    purgeExpired() {
      const t = now();
      const gone: string[] = [];
      for (const code of api.list()) {
        const key = HOST_KEY_PREFIX + code;
        const rec = read(key);
        const expired =
          !rec || (rec.endedAt !== null && t - rec.endedAt >= EXPIRE_MS) || t - rec.savedAt >= EXPIRE_MS;
        if (expired) {
          api.remove(code);
          gone.push(code);
        }
      }
      // 판 기록 없이 남은 틱 키 정리
      if (storage) {
        try {
          const orphan: string[] = [];
          for (let i = 0; i < storage.length; i++) {
            const k = storage.key(i);
            if (k && k.startsWith(HOST_TICK_PREFIX) && !read(HOST_KEY_PREFIX + k.slice(HOST_TICK_PREFIX.length))) orphan.push(k);
          }
          for (const k of orphan) storage.removeItem(k);
        } catch {
          /* 무시 */
        }
      }
      return gone;
    },
  };
  return api;
}

export function isStoredHost(r: unknown): r is StoredHost {
  if (!r || typeof r !== 'object') return false;
  const x = r as Partial<StoredHost>;
  return (
    x.v === 3 &&
    x.kind === 'voyage-host' &&
    typeof x.code === 'string' &&
    typeof x.hostToken === 'string' &&
    typeof x.savedAt === 'number' &&
    !!x.session &&
    typeof x.session === 'object'
  );
}

// ───────────────────────────── 판 옮기기 파일 ─────────────────────────────

export interface MoveFile {
  kind: typeof MOVE_FILE_KIND;
  v: 3;
  warning: string;
  exportedAt: number;
  record: StoredHost;
}

/** 판 옮기기 파일(JSON 문자열). hostToken이 들어 있다 — 경고 문구 포함 */
export function exportMoveFile(record: StoredHost, at: number): string {
  const file: MoveFile = { kind: MOVE_FILE_KIND, v: 3, warning: MOVE_FILE_WARNING, exportedAt: at, record };
  return JSON.stringify(file, null, 1);
}

export type ImportMoveResult = { ok: true; record: StoredHost } | { ok: false; error: 'BAD_FILE' | 'VERSION' };

/** 판 옮기기 파일 읽기(버전 v:3 확인) */
export function importMoveFile(json: string): ImportMoveResult {
  let f: Partial<MoveFile>;
  try {
    f = JSON.parse(json) as Partial<MoveFile>;
  } catch {
    return { ok: false, error: 'BAD_FILE' };
  }
  if (!f || typeof f !== 'object' || f.kind !== MOVE_FILE_KIND) return { ok: false, error: 'BAD_FILE' };
  if (f.v !== 3 || (f.record as { v?: unknown } | undefined)?.v !== 3) return { ok: false, error: 'VERSION' };
  if (!isStoredHost(f.record)) return { ok: false, error: 'BAD_FILE' };
  return { ok: true, record: f.record };
}

export const MOVE_FILE_ERRORS: Record<'BAD_FILE' | 'VERSION', string> = {
  BAD_FILE: '판 옮기기 파일이 아니에요. 다른 파일을 골라 주세요.',
  VERSION: '다른 버전의 게임에서 만든 파일이라 열 수 없어요.',
};

// ───────────────────────────── 결과 파일 ─────────────────────────────

/** 리듀서가 주는 결과 표(학생 줄은 출석번호로 — 회사 이름은 세션 장부에서 채움) */
export interface ResultTable {
  /** 판 단위 표시(예: '차시마다 한 판', '단원 전체 한 판') */
  playUnit: string;
  /** 차시(범위) 표시(예: 'L1', 'L1~L4') */
  scope: string;
  metrics: { key: string; label: string }[];
  rows: { seat: number; values: Record<string, number | string | null>; awards: string[] }[];
}

export interface ResultFiles {
  json: string;
  csv: string;
  /** 파일 이름(확장자 없이) 예: `대항해무역왕-6학년1반-2026-10-09` */
  fileBase: string;
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  // 수식 주입 방지: = + - @ 로 시작하는 글자 값은 앞에 작은따옴표
  const safe = typeof v === 'string' && /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * 결과 파일. CSV 열 = 출석번호, 회사 이름, 판 단위, 차시(범위), 지표들, 상 (실명 열 없음, UTF-8 BOM, CRLF).
 */
export function buildResultFiles(
  table: ResultTable,
  companyOf: (seat: number) => string,
  meta: { className?: string; date: string },
): ResultFiles {
  const header = ['출석번호', '회사 이름', '판 단위', '차시(범위)', ...table.metrics.map((m) => m.label), '상'];
  const rows = [...table.rows].sort((a, b) => a.seat - b.seat);
  const lines = [header.map(csvCell).join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.seat,
        companyOf(r.seat),
        table.playUnit,
        table.scope,
        ...table.metrics.map((m) => r.values[m.key] ?? ''),
        r.awards.join(' / '),
      ]
        .map(csvCell)
        .join(','),
    );
  }
  const csv = '﻿' + lines.join('\r\n') + '\r\n';
  const json = JSON.stringify(
    {
      kind: 'voyage-result',
      v: 3,
      className: meta.className ?? '',
      date: meta.date,
      playUnit: table.playUnit,
      scope: table.scope,
      metrics: table.metrics,
      rows: rows.map((r) => ({ seat: r.seat, companyName: companyOf(r.seat), values: r.values, awards: r.awards })),
    },
    null,
    1,
  );
  const safeClass = (meta.className ?? '').replace(/[\\/:*?"<>|\s]+/g, '') || '학급';
  return { json, csv, fileBase: `대항해무역왕-${safeClass}-${meta.date}` };
}
