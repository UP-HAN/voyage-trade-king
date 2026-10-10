/**
 * 앱 메시지 (작업 124, PRD 7.2~7.4·10.4 — v0.3.1). 설명 표는 `src/sync/PROTOCOL.md`.
 *
 * 전송 계층(104·105)의 `host.to` / `host.all` / `peer.msg` 안에 싣는 내용이다. 서버는 해석하지 않는다.
 * 모든 앱 메시지는 `{ t: '<종류>', … }` 모양의 JSON 객체(바깥 봉투의 `v: 3`은 전송 계층이 붙인다).
 * 입장 인사(hello)는 `peer.join {hello}`로 가고, 입장 거절 사유는 `host.reject {reason}` 문자열로 간다.
 *
 * 개인정보(PRD 7.9): **공개 상태(`state.public`)와 공용 화면에는 출석번호(`seat`)를 넣지 않는다.** 회사는 `pid`로 가리킨다.
 * 출석번호가 담기는 메시지는 본인 기기로만 가는 `admitted`·`seat.changed`뿐이다.
 */
import { errorToKorean, type JsonObject } from '@shared/protocol';

// ───────────────────────────── 입장 ─────────────────────────────

/** 학생 → 호스트 입장 인사(`peer.join {hello}`, 손님 연결이면 `peer.msg`로 `{t:'hello', …}`) */
export interface HelloMsg {
  seat: number;
  /** 회사 이름(학생이 입력한 그대로 — 호스트가 정리·검사) */
  company: string;
  deviceToken: string;
  appVersion: string;
}

export type AdmitMode = 'new' | 'same-device' | 'approved';
export type NameStatus = 'ok' | 'blocked' | 'checkRealName';

/**
 * 입장 거절 사유(`host.reject {reason}` 또는 손님 연결의 `hello.rejected {reason}`).
 * PRD 10.5의 목록 + `LOCKED`(입장 마감, 앱 판정) + `BAD_HELLO`(인사 모양 오류) + `REJOIN_DENIED`.
 * `SEAT_ONLINE`은 v0.3.1부터 판정에 쓰지 않는다(옛 기기가 접속 중이어도 요청은 받음) — 이름만 남겨 둔다.
 */
export const JOIN_REJECT_REASONS = [
  'NAME_TAKEN',
  'BAD_NAME',
  'NAME_FORMAT',
  'SEAT_TAKEN',
  'SEAT_ONLINE',
  'LOCKED',
  'KICKED',
  'TOO_MANY_TRIES',
  'BAD_HELLO',
  'REJOIN_DENIED',
] as const;
export type JoinRejectReason = (typeof JOIN_REJECT_REASONS)[number];

export function isJoinRejectReason(v: unknown): v is JoinRejectReason {
  return typeof v === 'string' && (JOIN_REJECT_REASONS as readonly string[]).includes(v);
}

/**
 * 거절 사유 문자열 만들기. `NAME_TAKEN`은 제안 이름 1~2개를 붙인다: `NAME_TAKEN:해오름무역2,해오름무역3`.
 * (전송 계층의 reason은 64자 이하 문자열 하나 — 회사 이름에는 쉼표·쌍점을 쓸 수 없으므로 겹치지 않는다)
 */
export function encodeRejectReason(reason: JoinRejectReason, suggestions?: readonly string[]): string {
  if (!suggestions?.length) return reason;
  let out = `${reason}:${suggestions[0]}`;
  if (suggestions[1] && out.length + 1 + suggestions[1].length <= 64) out += `,${suggestions[1]}`;
  return out.slice(0, 64);
}

export function decodeRejectReason(raw: string): { reason: string; suggestions: string[] } {
  const i = raw.indexOf(':');
  if (i < 0) return { reason: raw, suggestions: [] };
  return {
    reason: raw.slice(0, i),
    suggestions: raw
      .slice(i + 1)
      .split(',')
      .filter((s) => s.length > 0)
      .slice(0, 2),
  };
}

// ───────────────────────────── 메시지 ─────────────────────────────

/** 학생 → 호스트 (`peer.msg`) */
export type PeerToHost =
  | ({ t: 'hello' } & HelloMsg)
  | { t: 'act'; seq: number; action: unknown }
  | { t: 'rejoin.request' }
  | { t: 'name.set'; companyName: string }
  | { t: 'sync' }
  | { t: 'state.need' };

/** 공개 상태 변경분: 최상위 키 단위(`set`은 새 값, `del`은 지운 키) */
export interface PublicPatch {
  set: JsonObject;
  del: string[];
}

/** 호스트 → 학생 (`host.to` 개인 / `host.all` 전체) */
export type HostToPeer =
  // 개인(본인에게만)
  | { t: 'admitted'; seat: number; pid: string; companyName: string; mode: AdmitMode; lastSeq: number; nameStatus: NameStatus }
  | { t: 'hello.rejected'; reason: string; suggestions?: string[] }
  | { t: 'hello.again' }
  | { t: 'rejoin.pending' }
  | { t: 'rejoin.denied' }
  | { t: 'ack'; seq: number; ok: boolean; error?: string; version: number }
  | { t: 'state.me'; version: number; seq: number; data: JsonObject | null }
  | { t: 'moved' }
  | { t: 'kicked' }
  | { t: 'version.mismatch'; hostVersion: string }
  | { t: 'name.blocked'; reason: 'teacher' }
  | { t: 'name.result'; ok: boolean; error?: string; suggestions?: string[]; companyName?: string }
  | { t: 'name.changed'; companyName: string }
  | { t: 'seat.changed'; seat: number }
  // 개인 또는 전체
  | { t: 'state.public'; version: number; data: JsonObject }
  // 전체
  | { t: 'state.public'; version: number; base: number; patch: PublicPatch }
  | { t: 'code.changed'; newCode: string }
  | { t: 'host.ending' }
  // 묶음: 같은 학생에게 같은 순간 보낼 메시지 여러 개를 한 번에(중계 서버의 연결당 초당 메시지 상한 때문)
  | { t: 'multi'; msgs: HostToPeer[] };

export type HostToPeerType = HostToPeer['t'];

/** 받은 객체에서 앱 메시지 종류 꺼내기 */
export function msgType(m: unknown): string | null {
  return m && typeof m === 'object' && typeof (m as { t?: unknown }).t === 'string' ? ((m as { t: string }).t) : null;
}

/** hello 모양 검사(값 범위는 호스트 판정에서) */
export function parseHello(raw: unknown): HelloMsg | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.deviceToken !== 'string' || r.deviceToken.length < 8 || r.deviceToken.length > 128) return null;
  const seat = typeof r.seat === 'number' ? r.seat : Number(r.seat);
  return {
    seat,
    company: typeof r.company === 'string' ? r.company.slice(0, 64) : '',
    deviceToken: r.deviceToken,
    appVersion: typeof r.appVersion === 'string' ? r.appVersion.slice(0, 64) : '',
  };
}

// ───────────────────────────── 공개 상태 변경분 ─────────────────────────────

/** prev → next 최상위 키 변경분(없으면 null) */
export function diffPublic(prev: JsonObject, next: JsonObject): PublicPatch | null {
  const set: JsonObject = {};
  const del: string[] = [];
  let changed = false;
  for (const k of Object.keys(next)) {
    if (!(k in prev) || JSON.stringify(prev[k]) !== JSON.stringify(next[k])) {
      set[k] = next[k];
      changed = true;
    }
  }
  for (const k of Object.keys(prev)) {
    if (!(k in next)) {
      del.push(k);
      changed = true;
    }
  }
  return changed ? { set, del } : null;
}

export function applyPublicPatch(base: JsonObject, patch: PublicPatch): JsonObject {
  const out: JsonObject = { ...base, ...patch.set };
  for (const k of patch.del) delete out[k];
  return out;
}

// ───────────────────────────── 출석번호 검사 ─────────────────────────────

const SEAT_KEYS = new Set(['seat', 'seats']);

/**
 * 공개 상태에 `seat`·`seats` 키가 있는지 재귀 검사. 찾은 경로 목록을 돌려준다(값은 담지 않음).
 * 빈 배열이면 통과.
 */
export function findSeatKeys(obj: unknown, path = '', out: string[] = [], depth = 0): string[] {
  if (depth > 32 || obj === null || typeof obj !== 'object') return out;
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => findSeatKeys(v, `${path}[${i}]`, out, depth + 1));
    return out;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const p = path ? `${path}.${k}` : k;
    if (SEAT_KEYS.has(k)) out.push(p);
    findSeatKeys(v, p, out, depth + 1);
  }
  return out;
}

export class SeatInPublicError extends Error {
  constructor(readonly paths: string[]) {
    super(`공개 상태에 출석번호 키가 있어요: ${paths.slice(0, 5).join(', ')}`);
  }
}

/**
 * 공개 상태 검사 도우미(브리프 v0.3.1-7). `strict`면 예외(테스트), 아니면 개발 모드에서 콘솔 오류.
 * 통과하면 true. 콘솔에는 키 경로만 찍고 값(출석번호·회사 이름)은 찍지 않는다.
 */
export function assertNoSeatInPublic(obj: unknown, strict = false): boolean {
  const paths = findSeatKeys(obj);
  if (!paths.length) return true;
  if (strict) throw new SeatInPublicError(paths);
  if (isDev()) console.error('[sync] 공개 상태에 출석번호 키가 있어 지웠어요(리듀서 확인 필요):', paths.slice(0, 5).join(', '));
  return false;
}

/** `seat`·`seats` 키를 지운 사본 */
export function stripSeatKeys<T>(obj: T, depth = 0): T {
  if (depth > 32 || obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map((v) => stripSeatKeys(v, depth + 1)) as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (SEAT_KEYS.has(k)) continue;
    out[k] = stripSeatKeys(v, depth + 1);
  }
  return out as T;
}

function isDev(): boolean {
  try {
    return Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);
  } catch {
    return false;
  }
}

// ───────────────────────────── 문구 ─────────────────────────────

const APP_KOREAN: Record<string, string> = {
  NAME_TAKEN: '이미 다른 회사가 쓰는 이름이에요. 다른 이름을 지어요.',
  BAD_NAME: '회사 이름으로 쓸 수 없는 말이 있어요. 다른 이름을 지어요.',
  NAME_FORMAT: '회사 이름은 2~10자의 한글·영문·숫자로 지어요. (ㅋ 같은 낱자·그림 문자·기호는 쓸 수 없어요)',
  SEAT_TAKEN: '이 번호는 이미 다른 회사가 쓰고 있어요. 번호를 확인하거나 선생님께 말해요.',
  SEAT_ONLINE: '이 번호의 회사는 지금 다른 기기에서 쓰고 있어요. 선생님께 말해요.',
  LOCKED: '지금은 새로 들어올 수 없어요. 선생님께 말해요.',
  KICKED: '이번 판에는 다시 들어올 수 없어요. 선생님께 말해요.',
  TOO_MANY_TRIES: '잠시 뒤에 다시 해 봐요.',
  BAD_HELLO: '출석번호(1~40)와 회사 이름을 다시 확인해요.',
  REJOIN_DENIED: '선생님이 이 기기로 들어오는 것을 허락하지 않았어요. 선생님께 말해요.',
  REJOIN_PENDING: '이 번호의 회사는 다른 기기에서 쓰던 회사예요. 선생님이 허락하면 들어가요.',
  MOVED: '다른 기기로 옮겨졌어요.',
  NOT_SEATED: '아직 회사에 들어가지 않았어요.',
  NAME_LOCKED: '무역이 시작된 뒤에는 선생님만 회사 이름을 바꿀 수 있어요.',
  QUEUE_FULL: '선생님 화면이 돌아오면 다시 해요.',
  ROLLBACK: '값이 바뀌어서 다시 계산했어요.',
  CODE_CHANGED: '방 코드가 바뀌었어요. 선생님 화면(TV)의 새 코드를 입력해요.',
};

/** 앱 오류 코드(입장 거절·세션 오류) + 전송 오류 코드 → 사람 말 문구 */
export function appErrorToKorean(code: string, ctx?: { rooms?: number; maxRooms?: number; text?: string }): string {
  return APP_KOREAN[code] ?? errorToKorean(code, ctx);
}
