/**
 * 중계 프로토콜 (PRD 10.5, v0.3.1) — 브라우저와 중계 서버가 함께 쓴다.
 *
 * - 모든 메시지는 JSON `{ v: 3, t: '<종류>', … }`, 한 메시지 최대 64KB(설정 `maxMsgBytes`).
 * - 같은 이름의 종류가 방향에 따라 모양이 다르다(예: `peer.msg` — 학생→서버는 `{msg}`, 서버→호스트는 `{peerId, msg}`).
 *   그래서 `ClientMessage`(클라이언트 → 서버)와 `ServerMessage`(서버 → 클라이언트)를 따로 둔다.
 * - 이 파일은 DOM·Node 전용 API를 쓰지 않는다(shared/README.md).
 */

/** 프로토콜 버전(PRD 10.3 `v: 3`) */
export const PROTOCOL_VERSION = 3;
export type ProtocolVersion = typeof PROTOCOL_VERSION;

/** 한 메시지 최대 크기 기본값(바이트, UTF-8 기준) */
export const DEFAULT_MAX_MSG_BYTES = 65536;

/** 메시지 내용(서버는 해석하지 않는 JSON 객체) */
export type JsonObject = { [key: string]: unknown };

/** 방 코드: 6자리 숫자 문자열(100000~999999) */
export type RoomCode = string;

export function isRoomCode(value: unknown): value is RoomCode {
  return typeof value === 'string' && /^[1-9]\d{5}$/.test(value);
}

// ───────────────────────────── 오류 코드 ─────────────────────────────

/** 서버(중계)가 보내는 오류 코드 */
export const ERROR_CODES = [
  'NO_ROOM',
  'LOCKED',
  'FULL',
  'HOST_OFFLINE',
  'RATE_LIMITED',
  'BUSY',
  'ROOM_LIMIT',
  'MAINTENANCE',
  'BAD_MESSAGE',
  'TOO_LARGE',
  'ORIGIN',
  'VERSION',
  'UNJOINED_TIMEOUT',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}

/**
 * 앱 쪽(작업 124, 호스트 판정) 입장 거절 사유. 서버는 `host.reject {reason}`을 해석하지 않고 그대로 전달한다.
 * 사람 말 문구 표는 124가 둔다(여기서는 이름만 공유).
 */
export const APP_REJECT_REASONS = [
  'NAME_TAKEN',
  'BAD_NAME',
  'NAME_FORMAT',
  'SEAT_TAKEN',
  'SEAT_ONLINE',
  'KICKED',
  'TOO_MANY_TRIES',
] as const;
export type AppRejectReason = (typeof APP_REJECT_REASONS)[number];

/** `errorToKorean`에 줄 수 있는 덧붙임 정보(BUSY의 방 수 표시용) */
export interface ErrorContext {
  rooms?: number;
  maxRooms?: number;
  /** MAINTENANCE: 서버가 함께 보낸 점검 문구(있으면 그대로 보여 줌) */
  text?: string;
}

const ERROR_KOREAN: Record<ErrorCode, string> = {
  NO_ROOM: '그런 방이 없어요. 칠판의 여섯 자리 숫자를 다시 봐요.',
  LOCKED: '지금은 새로 들어올 수 없어요. 선생님께 말해요.',
  FULL: '방이 가득 찼어요. 선생님께 말해요.',
  HOST_OFFLINE: '선생님 화면이 아직 연결되지 않았어요. 잠시 뒤에 다시 해 봐요.',
  RATE_LIMITED: '잠시 뒤에 다시 해 봐요.',
  // PRD 7.2·docs/teacher-setup.md 4장 문구(작업 114에서 맞춤)
  BUSY: '지금 서버에 방이 가득 찼어요. 몇 분 뒤 다시 해 보세요.',
  ROOM_LIMIT: '이 학교(같은 인터넷 주소)에서 연 방이 너무 많아요. 쓰지 않는 방을 닫고 다시 해 보세요.',
  MAINTENANCE: '서버 점검 중이에요. 공지를 확인해 주세요.',
  BAD_MESSAGE: '알 수 없는 요청이에요. 새로 고침해 주세요.',
  TOO_LARGE: '보낸 내용이 너무 커요.',
  ORIGIN: '허용되지 않은 주소에서 접속했어요.',
  VERSION: '앱이 새 버전으로 바뀌었어요. 새로 고침해 주세요.',
  UNJOINED_TIMEOUT: '연결이 오래 멈춰 있어서 끊었어요. 다시 해 봐요.',
};

/**
 * 오류 코드 → 사람 말 문구. 모르는 값이면 일반 문구.
 * `BUSY`에 `maxRooms`를 주면 "(n/상한)"을 붙인다 — 예: "지금 서버에 방이 가득 찼어요(50/50). 몇 분 뒤 다시 해 보세요." (PRD 7.2)
 */
export function errorToKorean(code: string, ctx?: ErrorContext): string {
  if (code === 'MAINTENANCE' && ctx?.text) return ctx.text;
  if (code === 'BUSY' && ctx && typeof ctx.maxRooms === 'number') {
    const rooms = typeof ctx.rooms === 'number' ? ctx.rooms : ctx.maxRooms;
    return `지금 서버에 방이 가득 찼어요(${rooms}/${ctx.maxRooms}). 몇 분 뒤 다시 해 보세요.`;
  }
  if (isErrorCode(code)) return ERROR_KOREAN[code];
  return '문제가 생겼어요. 잠시 뒤에 다시 해 봐요.';
}

// ───────────────────────────── 공지 ─────────────────────────────

export type NoticeLevel = 'info' | 'warn' | 'maintenance';
export const NOTICE_LEVELS: readonly NoticeLevel[] = ['info', 'warn', 'maintenance'];
/** 공지 문구 최대 길이(운영 문서는 80자 이내 권장, 넘으면 잘라냄) */
export const NOTICE_TEXT_MAX = 200;

/** 서버 공지(공지 파일 형식, docs/server-setup.md 2.4). 시각은 ISO 8601 문자열 */
export interface Notice {
  level: NoticeLevel;
  text: string;
  from?: string;
  until?: string;
  blockNewRooms?: boolean;
}

/** 화면에 보여 줄 공지(`server.notice`의 내용). 공지 없음은 null */
export interface ActiveNotice {
  level: NoticeLevel;
  text: string;
  until?: string;
}

/**
 * 공지 값 검사(공지 파일을 읽은 뒤 105가 쓰고, relay-core도 쓴다). 형식이 틀리면 null.
 * `from`/`until`이 시각으로 읽히지 않으면 그 경계는 없는 것으로 본다.
 */
export function normalizeNotice(raw: unknown): Notice | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.level !== 'string' || !(NOTICE_LEVELS as readonly string[]).includes(r.level)) return null;
  if (typeof r.text !== 'string') return null;
  const out: Notice = { level: r.level as NoticeLevel, text: r.text.slice(0, NOTICE_TEXT_MAX) };
  const from = toIsoTime(r.from);
  const until = toIsoTime(r.until);
  if (from) out.from = from;
  if (until) out.until = until;
  if (r.blockNewRooms === true) out.blockNewRooms = true;
  return out;
}

function toIsoTime(v: unknown): string | undefined {
  if (typeof v !== 'string' && typeof v !== 'number') return undefined;
  const ms = typeof v === 'number' ? v : Date.parse(v);
  if (!Number.isFinite(ms)) return undefined;
  return new Date(ms).toISOString();
}

/** 지금(`nowMs`)이 공지의 `from`~`until` 안인가(경계가 없으면 열린 구간) */
export function noticeInWindow(n: Notice, nowMs: number): boolean {
  if (n.from && nowMs < Date.parse(n.from)) return false;
  if (n.until && nowMs > Date.parse(n.until)) return false;
  return true;
}

// ───────────────────────────── 메시지 ─────────────────────────────

/** 방이 사라진 까닭 */
export type RoomCloseReason = 'closed' | 'idle' | 'host_gone' | 'max_age' | 'empty' | 'replaced';

interface Base<T extends string> {
  v: ProtocolVersion;
  t: T;
  /**
   * (작업 105 추가) 요청 id — 클라이언트가 응답을 기다리는 요청(`host.open`·`host.resume`·`host.close`·`peer.join`·`server.stats`)에
   * 붙이면, 서버가 그 요청에 대한 직접 응답(`room.opened`·`peer.pending`·`room.closed`(host.close)·`server.stats`·`error`)에
   * 같은 값을 돌려준다. 늦게 온 응답이 다른 요청에 잘못 붙지 않게 한다. 없어도 된다(그때는 종류별 먼저 온 순서).
   */
  rid?: string;
}

/** 요청 id 형식: 영문·숫자·`_`·`-` 1~16자 */
export function isRequestId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,16}$/.test(value);
}

// 클라이언트 → 서버
export interface HostOpenMsg extends Base<'host.open'> { maxPeers: number; wantCode?: string; hostToken?: string }
export interface HostResumeMsg extends Base<'host.resume'> { code: string; hostToken: string }
export interface HostLockMsg extends Base<'host.lock'> {}
export interface HostUnlockMsg extends Base<'host.unlock'> {}
export interface HostAdmitMsg extends Base<'host.admit'> { peerId: string }
export interface HostRejectMsg extends Base<'host.reject'> { peerId: string; reason: string }
export interface HostKickMsg extends Base<'host.kick'> { peerId: string }
export interface HostCloseMsg extends Base<'host.close'> {}
export interface HostToMsg extends Base<'host.to'> { peerId: string; msg: JsonObject }
export interface HostAllMsg extends Base<'host.all'> { msg: JsonObject }
export interface PeerJoinMsg extends Base<'peer.join'> { code: string; hello: JsonObject }
export interface PeerMsgMsg extends Base<'peer.msg'> { msg: JsonObject }
/** 시각 보정. PRD 표의 `ping {t}`는 종류 이름 `t`와 겹쳐서 `at`(보낸 쪽 시각 ms)으로 한다 */
export interface PingMsg extends Base<'ping'> { at: number }
/** 역할 없이도 보낼 수 있는 가벼운 서버 현황 요청(교사 화면 "사용 중인 방 n/50") */
export interface StatsRequestMsg extends Base<'server.stats'> {}

export type ClientMessage =
  | HostOpenMsg
  | HostResumeMsg
  | HostLockMsg
  | HostUnlockMsg
  | HostAdmitMsg
  | HostRejectMsg
  | HostKickMsg
  | HostCloseMsg
  | HostToMsg
  | HostAllMsg
  | PeerJoinMsg
  | PeerMsgMsg
  | PingMsg
  | StatsRequestMsg;
export type ClientMessageType = ClientMessage['t'];

// 서버 → 클라이언트
/** 방 열림(`host.open`) 또는 다시 붙음(`host.resume`, `resumed: true` + 지금 입장해 있는 학생 `peers`) */
export interface RoomOpenedMsg extends Base<'room.opened'> { code: string; hostToken: string; resumed?: boolean; peers?: string[] }
/** 입장 요청을 호스트에 넘겼음(호스트의 admit/reject를 기다림). PRD 표에 없던 확인 메시지 — 작업 104 추가 */
export interface PeerPendingMsg extends Base<'peer.pending'> { peerId: string }
export interface PeerHelloMsg extends Base<'peer.hello'> { peerId: string; hello: JsonObject }
export interface PeerFromMsg extends Base<'peer.msg'> { peerId: string; msg: JsonObject }
export interface PeerLeftMsg extends Base<'peer.left'> { peerId: string }
export interface HostStatusMsg extends Base<'host.status'> { online: boolean }
export interface AdmittedMsg extends Base<'admitted'> { peerId: string }
export interface RejectedMsg extends Base<'rejected'> { reason: string }
export interface KickedMsg extends Base<'kicked'> {}
export interface RoomClosedMsg extends Base<'room.closed'> { reason: RoomCloseReason }
export interface ServerRestartingMsg extends Base<'server.restarting'> {}
export interface ServerNoticeMsg extends Base<'server.notice'> { level: NoticeLevel | null; text?: string; until?: string }
export interface StatsReplyMsg extends Base<'server.stats'> { rooms: number; maxRooms: number }
/** 호스트가 보낸 개인 메시지(학생이 받음) */
export interface HostToPeerMsg extends Base<'host.to'> { msg: JsonObject }
/** 호스트가 보낸 전체 메시지(학생이 받음) */
export interface HostAllPeerMsg extends Base<'host.all'> { msg: JsonObject }
export interface PongMsg extends Base<'pong'> { at: number; serverNow: number }
/** `req`: 실패한 요청의 종류. `BUSY`(방 상한)이면 `rooms`/`maxRooms`, `MAINTENANCE`면 점검 문구 `text`가 붙는다 */
export interface ErrorMsg extends Base<'error'> { code: ErrorCode; req?: string; rooms?: number; maxRooms?: number; text?: string }

export type ServerMessage =
  | RoomOpenedMsg
  | PeerPendingMsg
  | PeerHelloMsg
  | PeerFromMsg
  | PeerLeftMsg
  | HostStatusMsg
  | AdmittedMsg
  | RejectedMsg
  | KickedMsg
  | RoomClosedMsg
  | ServerRestartingMsg
  | ServerNoticeMsg
  | StatsReplyMsg
  | HostToPeerMsg
  | HostAllPeerMsg
  | PongMsg
  | ErrorMsg;
export type ServerMessageType = ServerMessage['t'];

/** 클라이언트 메시지 중 호스트만 보낼 수 있는 종류 */
export const HOST_MESSAGE_TYPES = [
  'host.open',
  'host.resume',
  'host.lock',
  'host.unlock',
  'host.admit',
  'host.reject',
  'host.kick',
  'host.close',
  'host.to',
  'host.all',
] as const;
/** 클라이언트 메시지 중 학생(원격 공용 화면 포함)만 보낼 수 있는 종류 */
export const PEER_MESSAGE_TYPES = ['peer.join', 'peer.msg'] as const;

/** 메시지 종류 전체(PRD 10.5 + 104 추가 `peer.pending`, `server.stats`) */
export const MESSAGE_TYPES = [
  ...HOST_MESSAGE_TYPES,
  'room.opened',
  'peer.join',
  'peer.pending',
  'peer.hello',
  'peer.msg',
  'peer.left',
  'host.status',
  'admitted',
  'rejected',
  'kicked',
  'room.closed',
  'server.restarting',
  'server.notice',
  'server.stats',
  'ping',
  'pong',
  'error',
] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];
export type Message = ClientMessage | ServerMessage;

/** 보낼 메시지 만들기: `v`를 붙여 JSON 문자열로 */
export function encodeMessage(msg: Message): string {
  return JSON.stringify(msg);
}

// ───────────────────────────── 검사 ─────────────────────────────

export type ParseResult<M> = { ok: true; msg: M } | { ok: false; code: 'BAD_MESSAGE' | 'TOO_LARGE' | 'VERSION'; t?: string };

/** UTF-8 바이트 수(TextEncoder 없이 계산 — 브라우저·Node 공통) */
export function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        n += 4;
        i++;
      } else n += 3;
    } else n += 3;
  }
  return n;
}

const ID_MAX = 64;
const TOKEN_MAX = 128;
const REASON_MAX = 64;

const isObj = (v: unknown): v is JsonObject => !!v && typeof v === 'object' && !Array.isArray(v);
const isStr = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const optStr = (v: unknown, max: number) => v === undefined || isStr(v, max);

type Check = (m: Record<string, unknown>) => boolean;

const CLIENT_CHECKS: Record<ClientMessageType, Check> = {
  'host.open': (m) => isNum(m.maxPeers) && m.maxPeers >= 1 && optStr(m.wantCode, 16) && optStr(m.hostToken, TOKEN_MAX),
  'host.resume': (m) => isStr(m.code, 16) && isStr(m.hostToken, TOKEN_MAX),
  'host.lock': () => true,
  'host.unlock': () => true,
  'host.admit': (m) => isStr(m.peerId, ID_MAX),
  'host.reject': (m) => isStr(m.peerId, ID_MAX) && isStr(m.reason, REASON_MAX),
  'host.kick': (m) => isStr(m.peerId, ID_MAX),
  'host.close': () => true,
  'host.to': (m) => isStr(m.peerId, ID_MAX) && isObj(m.msg),
  'host.all': (m) => isObj(m.msg),
  'peer.join': (m) => isStr(m.code, 16) && isObj(m.hello),
  'peer.msg': (m) => isObj(m.msg),
  ping: (m) => isNum(m.at),
  'server.stats': () => true,
};

const SERVER_CHECKS: Record<ServerMessageType, Check> = {
  'room.opened': (m) =>
    isStr(m.code, 16) &&
    isStr(m.hostToken, TOKEN_MAX) &&
    (m.resumed === undefined || typeof m.resumed === 'boolean') &&
    (m.peers === undefined || (Array.isArray(m.peers) && m.peers.every((p) => typeof p === 'string'))),
  'peer.pending': (m) => isStr(m.peerId, ID_MAX),
  'peer.hello': (m) => isStr(m.peerId, ID_MAX) && isObj(m.hello),
  'peer.msg': (m) => isStr(m.peerId, ID_MAX) && isObj(m.msg),
  'peer.left': (m) => isStr(m.peerId, ID_MAX),
  'host.status': (m) => typeof m.online === 'boolean',
  admitted: (m) => isStr(m.peerId, ID_MAX),
  rejected: (m) => typeof m.reason === 'string',
  kicked: () => true,
  'room.closed': (m) => typeof m.reason === 'string',
  'server.restarting': () => true,
  'server.notice': (m) =>
    (m.level === null || (typeof m.level === 'string' && (NOTICE_LEVELS as readonly string[]).includes(m.level))) &&
    (m.text === undefined || typeof m.text === 'string') &&
    (m.until === undefined || typeof m.until === 'string'),
  'server.stats': (m) => isNum(m.rooms) && isNum(m.maxRooms),
  'host.to': (m) => isObj(m.msg),
  'host.all': (m) => isObj(m.msg),
  pong: (m) => isNum(m.at) && isNum(m.serverNow),
  error: (m) =>
    isErrorCode(m.code) && (m.req === undefined || typeof m.req === 'string') && (m.text === undefined || typeof m.text === 'string'),
};

function parseWith<M>(raw: unknown, checks: Record<string, Check>, maxBytes: number): ParseResult<M> {
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    if (raw.length > maxBytes || utf8Length(raw) > maxBytes) return { ok: false, code: 'TOO_LARGE' };
    try {
      obj = JSON.parse(raw);
    } catch {
      return { ok: false, code: 'BAD_MESSAGE' };
    }
  }
  if (!isObj(obj)) return { ok: false, code: 'BAD_MESSAGE' };
  const t = typeof obj.t === 'string' ? obj.t.slice(0, 32) : undefined;
  if (obj.v !== PROTOCOL_VERSION) return { ok: false, code: 'VERSION', t };
  if (obj.rid !== undefined && !isRequestId(obj.rid)) return { ok: false, code: 'BAD_MESSAGE', t };
  if (t === undefined || !Object.prototype.hasOwnProperty.call(checks, t)) return { ok: false, code: 'BAD_MESSAGE', t };
  const check = checks[t] as Check;
  if (!check(obj)) return { ok: false, code: 'BAD_MESSAGE', t };
  return { ok: true, msg: obj as M };
}

/** 클라이언트 → 서버 메시지 검사(중계 서버·relay-core가 씀). 문자열이면 크기 검사 후 JSON 파싱 */
export function parseClientMessage(raw: unknown, maxBytes: number = DEFAULT_MAX_MSG_BYTES): ParseResult<ClientMessage> {
  return parseWith<ClientMessage>(raw, CLIENT_CHECKS, maxBytes);
}

/** 서버 → 클라이언트 메시지 검사(어댑터가 씀) */
export function parseServerMessage(raw: unknown, maxBytes: number = Number.MAX_SAFE_INTEGER): ParseResult<ServerMessage> {
  return parseWith<ServerMessage>(raw, SERVER_CHECKS, maxBytes);
}

/** `parseMessage(raw)` — 기본은 클라이언트가 보낸 메시지 검사. `from: 'server'`면 서버 메시지 검사 */
export function parseMessage(raw: unknown, opts: { from?: 'client' | 'server'; maxBytes?: number } = {}): ParseResult<Message> {
  return opts.from === 'server'
    ? parseServerMessage(raw, opts.maxBytes)
    : parseClientMessage(raw, opts.maxBytes ?? DEFAULT_MAX_MSG_BYTES);
}

// ───────────────────────────── 연결 끊기 코드 ─────────────────────────────

/** 서버가 연결을 끊을 때 쓰는 WebSocket close 코드 */
export const CLOSE_CODES = {
  NORMAL: 1000,
  TOO_LARGE: 1009,
  KICKED: 4001,
  ROOM_CLOSED: 4002,
  UNJOINED_TIMEOUT: 4003,
  BUSY: 4004,
  REPLACED: 4005,
  RATE_LIMITED: 4006,
  ORIGIN: 4007,
  VERSION: 4008,
} as const;
export type CloseCode = (typeof CLOSE_CODES)[keyof typeof CLOSE_CODES];
