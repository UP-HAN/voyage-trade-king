/**
 * 학생 기기 저장 (작업 124, PRD 7.3·7.9·10.7).
 *
 * - `voyage.device`: 기기 토큰(128비트 무작위, 16진 32자). 처음 한 번 만든다. 화면에 보이지 않는다.
 * - `voyage.peer`: `{code, seat, companyName, pid, lastMe(마지막 회사 상태, 보기용), logbook(항해 기록장 값), endedAt, savedAt}`.
 * - 판이 끝나면(`endedAt`) 24시간 뒤 둘 다 삭제. 끝나지 않은 기록도 마지막 저장 뒤 24시간이 지나면 삭제.
 * - 로컬 모드 `?as=s07` 탭은 sessionStorage를 넘겨 탭마다 다른 학생이 되게 한다(`peerStorageForHref`).
 *
 * 판 전체 상태는 저장하지 않는다(자기 회사 상태와 항해 기록장만).
 */
import { readQueryParam } from '../config/deploy';
import type { JsonObject } from '@shared/protocol';
import type { NameStatus } from './app-messages';
import { EXPIRE_MS } from './host-store';

export const PEER_DEVICE_KEY = 'voyage.device';
export const PEER_RECORD_KEY = 'voyage.peer';

export type PeerStorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface PeerRecord {
  code: string | null;
  seat: number | null;
  companyName: string | null;
  pid: string | null;
  nameStatus: NameStatus | null;
  /** 마지막 회사 상태(보기용 — 호스트 것이 항상 우선) */
  lastMe: JsonObject | null;
  /** 항해 기록장 값(호스트가 state.me의 `logbook`에 담아 보냄) */
  logbook: unknown;
  endedAt: number | null;
  /**
   * (작업 145 추가 요구) 같은 코드 재시도를 시작한 시각(첫 NO_ROOM·HOST_OFFLINE, 기기 시각).
   * 새로 고침해도 9분(NO_ROOM_GIVE_UP_MS) 판정·[새 방 코드로 들어가기] 판정을 이어서 센다. 정상 입장(admitted)하면 null.
   */
  waitSince: number | null;
  savedAt: number;
}

export interface PeerStore {
  /** 기기 토큰(없으면 만들어 저장) */
  deviceToken(): string;
  load(): PeerRecord | null;
  save(patch: Partial<Omit<PeerRecord, 'savedAt'>>): PeerRecord;
  /** 방 정보만 지움(옮겨짐·내보내짐) — 기기 토큰은 남김 */
  clearRoom(): void;
  /** 모두 지움(기기 토큰 포함) */
  clearAll(): void;
  markEnded(at?: number): void;
  /** 만료면 지우고 true */
  purgeExpired(): boolean;
}

export interface PeerStoreOptions {
  storage?: PeerStorageLike | null;
  now?: () => number;
  /** 128비트 무작위 토큰 생성기(테스트 주입) */
  randomToken?: () => string;
}

export function randomHexToken(bytes = 16): string {
  const a = new Uint8Array(bytes);
  const c = (globalThis as { crypto?: { getRandomValues<T extends ArrayBufferView>(x: T): T } }).crypto;
  if (c?.getRandomValues) c.getRandomValues(a);
  else for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** URL에 `?as=`가 있으면 sessionStorage(탭마다 다른 학생), 아니면 localStorage */
export function peerStorageForHref(href: string): PeerStorageLike | null {
  try {
    if (readQueryParam(href, 'as')) return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

const EMPTY: Omit<PeerRecord, 'savedAt'> = {
  code: null,
  seat: null,
  companyName: null,
  pid: null,
  nameStatus: null,
  lastMe: null,
  logbook: null,
  endedAt: null,
  waitSince: null,
};

export function createPeerStore(o: PeerStoreOptions = {}): PeerStore {
  const storage =
    o.storage === undefined ? (typeof localStorage !== 'undefined' ? (localStorage as PeerStorageLike) : null) : o.storage;
  const now = o.now ?? (() => Date.now());
  const rand = o.randomToken ?? (() => randomHexToken(16));
  let memToken: string | null = null;
  let memRecord: PeerRecord | null = null;

  const get = (k: string): string | null => {
    try {
      return storage?.getItem(k) ?? null;
    } catch {
      return null;
    }
  };
  const set = (k: string, v: string) => {
    try {
      storage?.setItem(k, v);
    } catch {
      /* 저장 실패 — 메모리 사본으로 계속 */
    }
  };
  const del = (k: string) => {
    try {
      storage?.removeItem(k);
    } catch {
      /* 무시 */
    }
  };

  const api: PeerStore = {
    deviceToken() {
      const t = get(PEER_DEVICE_KEY) ?? memToken;
      if (t) return t;
      const fresh = rand();
      memToken = fresh;
      set(PEER_DEVICE_KEY, fresh);
      return fresh;
    },
    load() {
      const raw = get(PEER_RECORD_KEY);
      if (!raw) return memRecord;
      try {
        const r = JSON.parse(raw) as PeerRecord;
        return r && typeof r === 'object' ? { ...EMPTY, ...r } : null;
      } catch {
        return null;
      }
    },
    save(patch) {
      const cur = api.load();
      const next: PeerRecord = { ...EMPTY, ...(cur ?? {}), ...patch, savedAt: now() };
      memRecord = next;
      set(PEER_RECORD_KEY, JSON.stringify(next));
      return next;
    },
    clearRoom() {
      memRecord = null;
      del(PEER_RECORD_KEY);
    },
    clearAll() {
      memRecord = null;
      memToken = null;
      del(PEER_RECORD_KEY);
      del(PEER_DEVICE_KEY);
    },
    markEnded(at) {
      const cur = api.load();
      if (cur) api.save({ endedAt: at ?? now() });
    },
    purgeExpired() {
      const r = api.load();
      if (!r) return false;
      const t = now();
      const expired = (r.endedAt !== null && t - r.endedAt >= EXPIRE_MS) || t - r.savedAt >= EXPIRE_MS;
      if (expired) api.clearAll();
      return expired;
    },
  };
  return api;
}
