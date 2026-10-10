/**
 * 방 라우팅 순수 로직 (PRD 10.4·10.5·10.10, v0.3.1).
 *
 * 중계 서버(작업 105)와 브라우저 안 가짜 서버(MemoryNetwork·LocalAdapter, 작업 104)가 **같은 코드**를 쓴다.
 * - 시각·난수·해시·전송·끊기는 모두 주입받는다(`RelayDeps`). 타이머가 없다 — 바깥에서 `sweep()`을 주기적으로(예: 1초) 부른다.
 * - 메시지 **내용**은 해석·저장하지 않는다. 역할·방·크기·빈도만 검사한다.
 * - DOM·Node 전용 API를 쓰지 않는다. 기본 난수는 `globalThis.crypto.getRandomValues`(브라우저·Node 공통 Web Crypto).
 */
import {
  CLOSE_CODES,
  PROTOCOL_VERSION,
  isRoomCode,
  noticeInWindow,
  normalizeNotice,
  parseClientMessage,
  type ActiveNotice,
  type ClientMessage,
  type ErrorCode,
  type Notice,
  type NoticeLevel,
  type RoomCloseReason,
  type ServerMessage,
  type ServerNoticeMsg,
} from './protocol.js';

// ───────────────────────────── 설정 ─────────────────────────────

/**
 * 중계 설정. 시간 값은 모두 **초**(환경 변수와 같은 단위).
 *
 * 설정 키 ↔ 환경 변수(`/etc/voyage-relay.env`, docs/server-setup.md 3.3) 대응표:
 * | 키                 | 환경 변수            | 기본값 |
 * |--------------------|----------------------|--------|
 * | maxRooms           | MAX_ROOMS            | 50 (v0.3.2) |
 * | maxPeers           | MAX_PEERS            | 45     |
 * | maxConn            | MAX_CONN             | 2300 (v0.3.2 = 50 × 46) |
 * | maxConnPerIp       | MAX_CONN_PER_IP      | 500 (v0.3.2) |
 * | maxRoomsPerIp      | MAX_ROOMS_PER_IP     | 10     |
 * | roomCreateLimit    | ROOM_CREATE_LIMIT    | 20     |
 * | roomCreateWindow   | ROOM_CREATE_WINDOW   | 3600   |
 * | emptyRoomTtl       | EMPTY_ROOM_TTL       | 1200   |
 * | unjoinedTimeout    | UNJOINED_TIMEOUT     | 30     |
 * | msgRate            | MSG_RATE             | 20     |
 * | msgBurst           | MSG_BURST            | 40     |
 * | hostMsgRate        | HOST_MSG_RATE        | 120 (105 추가 — 호스트 역할 연결) |
 * | hostMsgBurst       | HOST_MSG_BURST       | 240 (105 추가) |
 * | maxMsgBytes        | MAX_MSG_BYTES        | 65536  |
 * | joinFailLimit      | JOIN_FAIL_LIMIT      | 30     |
 * | joinFailWindow     | JOIN_FAIL_WINDOW     | 300    |
 * | joinBlockSec       | JOIN_BLOCK_SEC       | 120    |
 * | joinBlockMax       | JOIN_BLOCK_MAX       | 1800   |
 * | idleTtl            | IDLE_TTL             | 1800   |
 * | hostGrace          | HOST_GRACE           | 1800   |
 * | maxRoomAge         | MAX_ROOM_AGE         | 28800  |
 * | codeReuseBlock     | CODE_REUSE_BLOCK     | 7200   |
 * | resumeGrace        | RESUME_GRACE         | 600    | (104 추가 — server-setup 표에 아직 없음) 서버 시작 뒤 기록 없는 코드 재열기를 받는 시간
 * 서버 전용(relay-core 밖, 작업 105): HOST, PORT, ALLOWED_ORIGINS, TRUST_PROXY, NOTICE_FILE, NODE_OPTIONS, LOG_LEVEL.
 */
export interface RelayConfig {
  maxRooms: number;
  maxPeers: number;
  maxConn: number;
  maxConnPerIp: number;
  maxRoomsPerIp: number;
  roomCreateLimit: number;
  roomCreateWindow: number;
  emptyRoomTtl: number;
  unjoinedTimeout: number;
  msgRate: number;
  msgBurst: number;
  /** (105 추가) 호스트 역할 연결의 초당 메시지 수(학생은 msgRate) — 호스트는 학생 30명 응답·공개 상태를 보낸다 */
  hostMsgRate: number;
  /** (105 추가) 호스트 역할 연결의 순간 허용 */
  hostMsgBurst: number;
  maxMsgBytes: number;
  joinFailLimit: number;
  joinFailWindow: number;
  joinBlockSec: number;
  joinBlockMax: number;
  idleTtl: number;
  hostGrace: number;
  maxRoomAge: number;
  codeReuseBlock: number;
  /** 서버(코어) 시작 뒤 이 시간(초) 안에만 기록 없는 wantCode 재열기를 허용(서버 재시작 복구용) */
  resumeGrace: number;
}

export const DEFAULT_RELAY_CONFIG: Readonly<RelayConfig> = Object.freeze({
  maxRooms: 50,
  maxPeers: 45,
  maxConn: 2300,
  maxConnPerIp: 500,
  maxRoomsPerIp: 10,
  roomCreateLimit: 20,
  roomCreateWindow: 3600,
  emptyRoomTtl: 1200,
  unjoinedTimeout: 30,
  msgRate: 20,
  msgBurst: 40,
  hostMsgRate: 120,
  hostMsgBurst: 240,
  maxMsgBytes: 65536,
  joinFailLimit: 30,
  joinFailWindow: 300,
  joinBlockSec: 120,
  joinBlockMax: 1800,
  idleTtl: 1800,
  hostGrace: 1800,
  maxRoomAge: 28800,
  codeReuseBlock: 7200,
  resumeGrace: 600,
});

/** 설정 키 → 환경 변수 이름 */
export const RELAY_CONFIG_ENV: Readonly<Record<keyof RelayConfig, string>> = Object.freeze({
  maxRooms: 'MAX_ROOMS',
  maxPeers: 'MAX_PEERS',
  maxConn: 'MAX_CONN',
  maxConnPerIp: 'MAX_CONN_PER_IP',
  maxRoomsPerIp: 'MAX_ROOMS_PER_IP',
  roomCreateLimit: 'ROOM_CREATE_LIMIT',
  roomCreateWindow: 'ROOM_CREATE_WINDOW',
  emptyRoomTtl: 'EMPTY_ROOM_TTL',
  unjoinedTimeout: 'UNJOINED_TIMEOUT',
  msgRate: 'MSG_RATE',
  msgBurst: 'MSG_BURST',
  hostMsgRate: 'HOST_MSG_RATE',
  hostMsgBurst: 'HOST_MSG_BURST',
  maxMsgBytes: 'MAX_MSG_BYTES',
  joinFailLimit: 'JOIN_FAIL_LIMIT',
  joinFailWindow: 'JOIN_FAIL_WINDOW',
  joinBlockSec: 'JOIN_BLOCK_SEC',
  joinBlockMax: 'JOIN_BLOCK_MAX',
  idleTtl: 'IDLE_TTL',
  hostGrace: 'HOST_GRACE',
  maxRoomAge: 'MAX_ROOM_AGE',
  codeReuseBlock: 'CODE_REUSE_BLOCK',
  resumeGrace: 'RESUME_GRACE',
});

/** 환경 변수 객체 → 설정(양수로 읽히지 않는 값은 기본값). 105가 `process.env`를 넘긴다 */
export function relayConfigFromEnv(env: Record<string, string | undefined>): RelayConfig {
  const out = { ...DEFAULT_RELAY_CONFIG } as RelayConfig;
  for (const key of Object.keys(RELAY_CONFIG_ENV) as (keyof RelayConfig)[]) {
    const raw = env[RELAY_CONFIG_ENV[key]];
    if (raw === undefined || raw.trim() === '') continue;
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) out[key] = n;
  }
  return out;
}

/** 방 밖에 있는 호스트 연결을 끊기까지(초). 방을 닫은 뒤 다시 열 시간을 주려고 학생(unjoinedTimeout)보다 길게 둔다 */
export const ROOMLESS_HOST_TIMEOUT = 300;

/** 공지 문구 없이 새 방이 막혔을 때(blockNewRooms가 켜졌지만 공지 시간 밖 등) MAINTENANCE 오류에 붙이는 기본 문구 */
export const DEFAULT_MAINTENANCE_TEXT = '서버 점검 중이라 지금은 새 방을 열 수 없어요. 잠시 후 다시 시도해 주세요.';

/** 같은 IP가 다시 막힐 때 시간을 두 배로 늘리는 기준(이전 차단이 끝난 뒤 이 시간 안이면), 초 */
export const JOIN_REBLOCK_WINDOW = 3600;

// ───────────────────────────── 주입 ─────────────────────────────

export type ConnId = string;

export interface ConnMeta {
  ip: string;
  origin?: string;
}

export interface RelayDeps {
  /** 현재 시각(ms) */
  now(): number;
  /** [min, max] 정수(양 끝 포함). 기본: Web Crypto */
  randomInt?(min: number, max: number): number;
  /** 128비트 무작위 토큰 문자열. 기본: Web Crypto 16바이트 → 16진 32자 */
  randomToken?(): string;
  /** 호스트 토큰 해시. 기본: 순수 JS SHA-256(16진). 서버는 node:crypto를 넣어도 됨(같은 결과여야 함) */
  hash?(s: string): string;
  /** 연결에 이미 직렬화된 JSON 문자열을 보낸다(방 전체 메시지는 한 번만 직렬화해 여러 연결에 같은 문자열을 보냄) */
  send(connId: ConnId, data: string): void;
  /**
   * 연결을 끊는다. relay-core는 이 호출 전에 그 연결을 자기 표에서 지운다 —
   * 그 뒤 바깥에서 `onDisconnect(connId)`를 불러도 아무 일도 하지 않는다.
   */
  close(connId: ConnId, code: number, reason?: string): void;
  /**
   * (작업 105 추가, 선택) 운영 로그용 사건 알림 — 방 열림·다시 붙음·닫힘, 보낸 오류 코드.
   * 동작에는 영향이 없다. 받는 쪽은 코드 전체·이름·내용을 로그에 남기지 않아야 한다.
   */
  observe?(e: RelayEvent): void;
}

/** (작업 105) 운영 로그용 사건 */
export type RelayEvent =
  | { type: 'room.opened'; code: string; reopened: boolean }
  | { type: 'room.resumed'; code: string }
  | { type: 'room.closed'; code: string; reason: RoomCloseReason; peers: number }
  | { type: 'error'; code: ErrorCode };

export interface RelayStats {
  rooms: number;
  maxRooms: number;
  /** 방에 들어와 있는 학생 연결 수(대기 + 입장) */
  peers: number;
  conns: number;
  maxConn: number;
  /** 지금 입장 요청이 막힌 IP 수 */
  blockedIps: number;
  /** 최근 1분 동안의 NO_ROOM 실패 수 */
  joinFailPerMin: number;
  /** 지금 보이는 공지 단계(없으면 null) */
  notice: NoticeLevel | null;
  /** 지금 재사용이 아닌 새 host.open을 받을 수 있는가(host.open 거절 판정과 같은 함수, maxConn은 보지 않음) */
  acceptingNewRooms: boolean;
}

export interface RelayCore {
  /** 새 연결. 상한을 넘으면 오류를 보내고 끊은 뒤 false */
  onConnect(connId: ConnId, meta: ConnMeta): boolean;
  /** 받은 문자열 하나 처리 */
  onMessage(connId: ConnId, raw: string): void;
  /** 연결이 끊김(바깥에서 감지) */
  onDisconnect(connId: ConnId): void;
  /** 만료 처리(방 수명·빈 방·빈 연결·기록 정리·공지 시간 경계). 1초쯤마다 부른다 */
  sweep(): void;
  /** 현황(방 코드·IP 없음) */
  stats(): RelayStats;
  /** 공지 설정(105가 공지 파일에서 읽어 넣음). 모든 연결에 `server.notice`를 보낸다 */
  setNotice(notice: Notice | null): void;
  /** 서버 재시작 직전 모든 연결에 `server.restarting` */
  announceRestart(): void;
}

// ───────────────────────────── 기본 난수·해시 ─────────────────────────────

function cryptoObj(): { getRandomValues<T extends ArrayBufferView>(a: T): T } {
  const c = (globalThis as { crypto?: { getRandomValues<T extends ArrayBufferView>(a: T): T } }).crypto;
  if (!c || typeof c.getRandomValues !== 'function') throw new Error('Web Crypto(getRandomValues)를 쓸 수 없어요');
  return c;
}

/** 암호학적 난수 [min, max] 정수 */
export function secureRandomInt(min: number, max: number): number {
  const range = max - min + 1;
  if (range <= 0 || range > 0x100000000) throw new RangeError('range');
  const limit = Math.floor(0x100000000 / range) * range;
  const buf = new Uint32Array(1);
  for (;;) {
    cryptoObj().getRandomValues(buf);
    const x = buf[0] as number;
    if (x < limit) return min + (x % range);
  }
}

/** 128비트 무작위 16진 문자열 */
export function secureRandomToken(): string {
  const b = new Uint8Array(16);
  cryptoObj().getRandomValues(b);
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
}

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function utf8Bytes(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

/** 순수 JS SHA-256 → 16진 64자(동기). 호스트 토큰 해시용 */
export function sha256Hex(s: string): string {
  const bytes = utf8Bytes(s);
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const hi = Math.floor(bitLen / 0x100000000);
  const lo = bitLen >>> 0;
  bytes.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255);
  bytes.push((lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < bytes.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4;
      W[i] = ((bytes[j]! << 24) | (bytes[j + 1]! << 16) | (bytes[j + 2]! << 8) | bytes[j + 3]!) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const w15 = W[i - 15]!;
      const w2 = W[i - 2]!;
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      W[i] = (W[i - 16]! + s0 + W[i - 7]! + s1) >>> 0;
    }
    let a = H[0]!, b = H[1]!, c = H[2]!, d = H[3]!, e = H[4]!, f = H[5]!, g = H[6]!, h = H[7]!;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i]! + W[i]!) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0]! + a) >>> 0;
    H[1] = (H[1]! + b) >>> 0;
    H[2] = (H[2]! + c) >>> 0;
    H[3] = (H[3]! + d) >>> 0;
    H[4] = (H[4]! + e) >>> 0;
    H[5] = (H[5]! + f) >>> 0;
    H[6] = (H[6]! + g) >>> 0;
    H[7] = (H[7]! + h) >>> 0;
  }
  let out = '';
  for (const x of H) out += x.toString(16).padStart(8, '0');
  return out;
}

// ───────────────────────────── 내부 상태 ─────────────────────────────

interface Conn {
  id: ConnId;
  ip: string;
  role: 'none' | 'host' | 'peer';
  connectedAt: number;
  room: Room | null;
  peerId: string | null;
  admitted: boolean;
  hello: Record<string, unknown> | null;
  tokens: number;
  refillAt: number;
  /** 속도 제한 오류 응답용 버킷(오류 응답 자체도 제한) */
  errTokens: number;
  errRefillAt: number;
  /** 방 밖에 있게 된 시각(연결·거절·방 떠남·방 사라짐). 방 안이면 의미 없음 */
  roomlessSince: number;
}

interface Room {
  code: string;
  tokenHash: string;
  hostIp: string;
  host: Conn | null;
  createdAt: number;
  lastActivity: number;
  hostLeftAt: number | null;
  locked: boolean;
  maxPeers: number;
  peers: Map<string, Conn>;
  everAdmitted: boolean;
}

interface JoinFailState {
  fails: number[];
  blockedUntil: number;
  lastBlockEnd: number;
  lastBlockSec: number;
}

/** 받은 문자열 앞부분에서 종류(t)만 싸게 꺼낸다(속도 제한에 걸린 메시지는 전체 파싱하지 않음) */
function peekType(raw: string): string | undefined {
  const m = /"t"\s*:\s*"([a-z.]{1,32})"/.exec(raw.slice(0, 256));
  return m ? m[1] : undefined;
}

/** 같은 방식으로 요청 id(rid)만 꺼낸다(작업 105) */
function peekRid(raw: string): string | undefined {
  const m = /"rid"\s*:\s*"([A-Za-z0-9_-]{1,16})"/.exec(raw.slice(0, 256));
  return m ? m[1] : undefined;
}

/** 직접 응답에 요청 id를 붙인다(작업 105) */
function withRid<M extends ServerMessage>(m: M, rid: string | undefined): M {
  return rid ? { ...m, rid } : m;
}

const CODE_MIN = 100000;
const CODE_MAX = 999999;
const CODE_TRIES = 200;

// ───────────────────────────── 본체 ─────────────────────────────

export function createRelayCore(config: Partial<RelayConfig> = {}, deps: RelayDeps): RelayCore {
  const cfg: RelayConfig = { ...DEFAULT_RELAY_CONFIG, ...config };
  const randomInt = deps.randomInt ?? secureRandomInt;
  const randomToken = deps.randomToken ?? secureRandomToken;
  const hash = deps.hash ?? sha256Hex;
  const observe = deps.observe?.bind(deps);
  const sec = (s: number) => s * 1000;

  const conns = new Map<ConnId, Conn>();
  const connsPerIp = new Map<string, number>();
  const rooms = new Map<string, Room>();
  /** 최근 닫힌 코드 → 닫힌 시각·호스트 토큰 해시 */
  const recentlyClosed = new Map<string, { at: number; tokenHash: string }>();
  /** IP → 방 생성 시각들(시간 창 안) */
  const roomCreates = new Map<string, number[]>();
  const joinFails = new Map<string, JoinFailState>();
  /** 모든 IP의 NO_ROOM 실패 시각(최근 1분) */
  let recentFails: number[] = [];
  let notice: Notice | null = null;
  /** 마지막으로 모두에게 알린 공지(직렬화 문자열) — sweep에서 시간 경계 변화를 알아챈다 */
  let lastNoticeKey = JSON.stringify({ v: PROTOCOL_VERSION, t: 'server.notice', level: null });
  let peerSeq = 0;
  const startedAt = deps.now();

  // ── 보내기 ──
  const encode = (m: ServerMessage) => JSON.stringify(m);
  const sendTo = (c: Conn, m: ServerMessage) => deps.send(c.id, encode(m));
  const sendError = (
    c: Conn,
    code: ErrorCode,
    req?: string,
    extra?: { rooms?: number; maxRooms?: number; text?: string },
    rid?: string,
  ) => {
    observe?.({ type: 'error', code });
    sendTo(c, { v: PROTOCOL_VERSION, t: 'error', code, ...(req ? { req } : {}), ...(extra ?? {}), ...(rid ? { rid } : {}) });
  };
  const admittedPeers = (room: Room) => [...room.peers.values()].filter((p) => p.admitted);
  const sendToAdmitted = (room: Room, m: ServerMessage) => {
    const data = encode(m);
    for (const p of room.peers.values()) if (p.admitted) deps.send(p.id, data);
  };

  // ── 공지 ──
  function activeNotice(now: number): ActiveNotice | null {
    if (!notice || !noticeInWindow(notice, now)) return null;
    return { level: notice.level, text: notice.text, ...(notice.until ? { until: notice.until } : {}) };
  }
  function noticeMsg(now: number): ServerNoticeMsg {
    const a = activeNotice(now);
    return a ? { v: PROTOCOL_VERSION, t: 'server.notice', ...a } : { v: PROTOCOL_VERSION, t: 'server.notice', level: null };
  }
  function broadcastNotice(now: number) {
    const m = noticeMsg(now);
    const data = encode(m);
    lastNoticeKey = data;
    for (const c of conns.values()) deps.send(c.id, data);
  }
  function maintenanceActive(now: number): boolean {
    if (!notice) return false;
    if (notice.blockNewRooms) return true;
    return notice.level === 'maintenance' && noticeInWindow(notice, now);
  }
  /**
   * 새 방(확인된 재열기가 아닌 host.open)을 지금 받을 수 없는 까닭. 받을 수 있으면 null.
   * host.open 거절과 stats().acceptingNewRooms가 이 함수 하나를 같이 쓴다(maxConn은 보지 않음).
   */
  function newRoomBlock(now: number): 'MAINTENANCE' | 'BUSY' | null {
    if (maintenanceActive(now)) return 'MAINTENANCE';
    if (rooms.size >= cfg.maxRooms) return 'BUSY';
    return null;
  }
  function maintenanceText(now: number): string {
    return activeNotice(now)?.text || DEFAULT_MAINTENANCE_TEXT;
  }

  // ── 연결 정리 ──
  /** 방에서 떼어 낸다. notify면 상대에게 알림(peer.left / host.status) */
  function detach(c: Conn, notify: boolean, now: number) {
    const room = c.room;
    if (!room) return;
    if (c.role === 'peer' && c.peerId) {
      if (room.peers.get(c.peerId) === c) {
        room.peers.delete(c.peerId);
        if (notify && room.host) sendTo(room.host, { v: PROTOCOL_VERSION, t: 'peer.left', peerId: c.peerId });
      }
    } else if (c.role === 'host' && room.host === c) {
      room.host = null;
      room.hostLeftAt = now;
      if (notify) sendToAdmitted(room, { v: PROTOCOL_VERSION, t: 'host.status', online: false });
    }
    c.room = null;
    c.peerId = null;
    c.admitted = false;
    c.hello = null;
    c.roomlessSince = now;
  }

  function forget(c: Conn) {
    if (!conns.delete(c.id)) return;
    const n = (connsPerIp.get(c.ip) ?? 1) - 1;
    if (n <= 0) connsPerIp.delete(c.ip);
    else connsPerIp.set(c.ip, n);
  }

  /** 서버가 끊는다(표에서 먼저 지운 뒤 deps.close) */
  function closeConn(c: Conn, code: number, reason?: string) {
    forget(c);
    deps.close(c.id, code, reason);
  }

  function destroyRoom(room: Room, reason: RoomCloseReason, now: number, hostRid?: string) {
    if (rooms.get(room.code) !== room) return;
    rooms.delete(room.code);
    observe?.({ type: 'room.closed', code: room.code, reason, peers: room.peers.size });
    recentlyClosed.set(room.code, { at: now, tokenHash: room.tokenHash });
    const closed: ServerMessage = { v: PROTOCOL_VERSION, t: 'room.closed', reason };
    const data = encode(closed);
    for (const p of [...room.peers.values()]) {
      deps.send(p.id, data);
      p.room = null;
      p.peerId = null;
      p.admitted = false;
      p.hello = null;
      closeConn(p, CLOSE_CODES.ROOM_CLOSED, 'room closed');
    }
    room.peers.clear();
    // 호스트 연결은 남겨 둔다(같은 코드 다시 열기 등을 할 수 있게)
    if (room.host) {
      deps.send(room.host.id, hostRid ? encode({ ...closed, rid: hostRid }) : data);
      room.host.room = null;
      room.host.roomlessSince = now;
      room.host = null;
    }
  }

  // ── 코드 ──
  function closedEntry(code: string, now: number) {
    const e = recentlyClosed.get(code);
    if (!e) return undefined;
    if (now - e.at >= sec(cfg.codeReuseBlock)) {
      recentlyClosed.delete(code);
      return undefined;
    }
    return e;
  }
  function newCode(now: number): string | null {
    for (let i = 0; i < CODE_TRIES; i++) {
      const code = String(randomInt(CODE_MIN, CODE_MAX));
      if (!rooms.has(code) && !closedEntry(code, now)) return code;
    }
    return null;
  }

  // ── 속도 제한 ──
  function takeToken(c: Conn, now: number): boolean {
    const elapsed = Math.max(0, now - c.refillAt) / 1000;
    // (105) 호스트 역할 연결은 따로(더 큰) 상한
    const host = c.role === 'host';
    const rate = host ? cfg.hostMsgRate : cfg.msgRate;
    const burst = host ? cfg.hostMsgBurst : cfg.msgBurst;
    c.tokens = Math.min(burst, c.tokens + elapsed * rate);
    c.refillAt = now;
    if (c.tokens < 1) return false;
    c.tokens -= 1;
    return true;
  }

  function takeErrToken(c: Conn, now: number): boolean {
    const elapsed = Math.max(0, now - c.errRefillAt) / 1000;
    c.errTokens = Math.min(cfg.msgBurst, c.errTokens + elapsed * cfg.msgRate);
    c.errRefillAt = now;
    if (c.errTokens < 1) return false;
    c.errTokens -= 1;
    return true;
  }

  function isJoinBlocked(ip: string, now: number) {
    const st = joinFails.get(ip);
    return !!st && st.blockedUntil > now;
  }
  function recordJoinFail(ip: string, now: number) {
    let st = joinFails.get(ip);
    if (!st) {
      st = { fails: [], blockedUntil: 0, lastBlockEnd: 0, lastBlockSec: 0 };
      joinFails.set(ip, st);
    }
    const from = now - sec(cfg.joinFailWindow);
    st.fails = st.fails.filter((t) => t > from);
    st.fails.push(now);
    recentFails.push(now);
    if (st.fails.length >= cfg.joinFailLimit) {
      const again = st.lastBlockEnd > 0 && now - st.lastBlockEnd < sec(JOIN_REBLOCK_WINDOW);
      const blockSec = again ? Math.min(st.lastBlockSec * 2, cfg.joinBlockMax) : Math.min(cfg.joinBlockSec, cfg.joinBlockMax);
      st.blockedUntil = now + sec(blockSec);
      st.lastBlockEnd = st.blockedUntil;
      st.lastBlockSec = blockSec;
      st.fails = [];
    }
  }

  function roomsOfIp(ip: string) {
    let n = 0;
    for (const r of rooms.values()) if (r.hostIp === ip) n++;
    return n;
  }
  function createsInWindow(ip: string, now: number) {
    const from = now - sec(cfg.roomCreateWindow);
    const list = (roomCreates.get(ip) ?? []).filter((t) => t > from);
    if (list.length) roomCreates.set(ip, list);
    else roomCreates.delete(ip);
    return list;
  }

  // ── 처리 ──
  function handleHostOpen(c: Conn, m: Extract<ClientMessage, { t: 'host.open' }>, now: number) {
    const rid = m.rid;
    if (c.role === 'peer' || c.room) return sendError(c, 'BAD_MESSAGE', m.t, undefined, rid);
    // 같은 코드 다시 열기
    //  ① 확인된 재열기: 최근 닫힌 기록이 있고 hostToken 해시가 같음 → 점검·생성 수 면제
    //  ② 기록 없는 재열기(서버 재시작 복구): 코어 시작 뒤 resumeGrace 안에서만 그 코드를 쓸 수 있음.
    //     점검(MAINTENANCE)·생성 수 상한 검사는 받지만 생성 수에 넣지는 않음
    //  그 밖(이미 열린 코드, 다른 토큰, 유예 시간 지남)은 새 방과 똑같이 처리하고 새 코드를 줌
    let mode: 'new' | 'verified' | 'unverified' = 'new';
    let tokenHash = '';
    if (m.wantCode !== undefined && isRoomCode(m.wantCode) && m.hostToken && !rooms.has(m.wantCode)) {
      const h = hash(m.hostToken);
      const closed = closedEntry(m.wantCode, now);
      if (closed && closed.tokenHash === h) mode = 'verified';
      else if (!closed && now - startedAt < sec(cfg.resumeGrace)) mode = 'unverified';
      if (mode !== 'new') tokenHash = h;
    }
    if (mode === 'verified') {
      if (rooms.size >= cfg.maxRooms) return sendError(c, 'BUSY', m.t, { rooms: rooms.size, maxRooms: cfg.maxRooms }, rid);
    } else {
      const block = newRoomBlock(now);
      if (block === 'MAINTENANCE') return sendError(c, 'MAINTENANCE', m.t, { text: maintenanceText(now) }, rid);
      if (block === 'BUSY') return sendError(c, 'BUSY', m.t, { rooms: rooms.size, maxRooms: cfg.maxRooms }, rid);
    }
    if (roomsOfIp(c.ip) >= cfg.maxRoomsPerIp) return sendError(c, 'ROOM_LIMIT', m.t, undefined, rid);
    if (mode !== 'verified' && createsInWindow(c.ip, now).length >= cfg.roomCreateLimit)
      return sendError(c, 'ROOM_LIMIT', m.t, undefined, rid);

    let code: string;
    let hostToken: string;
    if (mode !== 'new') {
      code = m.wantCode as string;
      hostToken = m.hostToken as string;
    } else {
      const fresh = newCode(now);
      if (!fresh) return sendError(c, 'BUSY', m.t, { rooms: rooms.size, maxRooms: cfg.maxRooms }, rid);
      code = fresh;
      hostToken = randomToken();
      tokenHash = hash(hostToken);
      const list = roomCreates.get(c.ip) ?? [];
      list.push(now);
      roomCreates.set(c.ip, list);
    }
    recentlyClosed.delete(code);
    const maxPeers = Math.max(1, Math.min(cfg.maxPeers, Math.floor(m.maxPeers)));
    const room: Room = {
      code,
      tokenHash,
      hostIp: c.ip,
      host: c,
      createdAt: now,
      lastActivity: now,
      hostLeftAt: null,
      locked: false,
      maxPeers,
      peers: new Map(),
      everAdmitted: false,
    };
    rooms.set(code, room);
    c.role = 'host';
    c.room = room;
    observe?.({ type: 'room.opened', code, reopened: mode !== 'new' });
    sendTo(c, withRid({ v: PROTOCOL_VERSION, t: 'room.opened', code, hostToken }, rid));
  }

  function handleHostResume(c: Conn, m: Extract<ClientMessage, { t: 'host.resume' }>, now: number) {
    const rid = m.rid;
    if (c.role === 'peer' || c.room) return sendError(c, 'BAD_MESSAGE', m.t, undefined, rid);
    const room = rooms.get(m.code);
    if (!room || hash(m.hostToken) !== room.tokenHash) return sendError(c, 'NO_ROOM', m.t, undefined, rid);
    const wasOffline = room.host === null;
    const old = room.host;
    if (old && old !== c) {
      sendTo(old, { v: PROTOCOL_VERSION, t: 'room.closed', reason: 'replaced' });
      old.room = null;
      room.host = null;
      closeConn(old, CLOSE_CODES.REPLACED, 'replaced');
    }
    room.host = c;
    room.hostLeftAt = null;
    room.hostIp = c.ip;
    room.lastActivity = now;
    c.role = 'host';
    c.room = room;
    observe?.({ type: 'room.resumed', code: room.code });
    sendTo(
      c,
      withRid(
        {
          v: PROTOCOL_VERSION,
          t: 'room.opened',
          code: room.code,
          hostToken: m.hostToken,
          resumed: true,
          peers: admittedPeers(room).map((p) => p.peerId as string),
        },
        rid,
      ),
    );
    // 기다리던 입장 요청을 새 호스트 연결에 다시 넘긴다
    for (const p of room.peers.values()) {
      if (!p.admitted && p.peerId) sendTo(c, { v: PROTOCOL_VERSION, t: 'peer.hello', peerId: p.peerId, hello: p.hello ?? {} });
    }
    if (wasOffline) sendToAdmitted(room, { v: PROTOCOL_VERSION, t: 'host.status', online: true });
  }

  function handlePeerJoin(c: Conn, m: Extract<ClientMessage, { t: 'peer.join' }>, now: number) {
    const rid = m.rid;
    if (c.role === 'host' || c.room) return sendError(c, 'BAD_MESSAGE', m.t, undefined, rid);
    c.role = 'peer';
    if (isJoinBlocked(c.ip, now)) return sendError(c, 'RATE_LIMITED', m.t, undefined, rid);
    const room = rooms.get(m.code);
    if (!room) {
      // (105) IP 실패 횟수에 세지 않는 NO_ROOM: ① 서버 시작 뒤 resumeGrace 안(재시작 직후 아직 다시 열리지 않은 방)
      // ② 최근(codeReuseBlock 안)에 닫힌 코드(무활동·호스트 부재 등으로 닫힌 방에 학생 기기가 자동 재입장을 되풀이).
      // 한 교실(같은 IP) 30명이 막히지 않게. 존재한 적 없는 코드(무작위 대입)는 그대로 센다. 현황(joinFailPerMin)에는 센다
      const known = isRoomCode(m.code) && closedEntry(m.code, now) !== undefined;
      if (known || now - startedAt < sec(cfg.resumeGrace)) recentFails.push(now);
      else recordJoinFail(c.ip, now);
      return sendError(c, 'NO_ROOM', m.t, undefined, rid);
    }
    if (room.locked) return sendError(c, 'LOCKED', m.t, undefined, rid);
    if (room.peers.size >= room.maxPeers) return sendError(c, 'FULL', m.t, undefined, rid);
    if (!room.host) return sendError(c, 'HOST_OFFLINE', m.t, undefined, rid);
    const peerId = `p${(++peerSeq).toString(36)}`;
    c.room = room;
    c.peerId = peerId;
    c.admitted = false;
    c.hello = m.hello;
    room.peers.set(peerId, c);
    room.lastActivity = now;
    sendTo(c, withRid({ v: PROTOCOL_VERSION, t: 'peer.pending', peerId }, rid));
    sendTo(room.host, { v: PROTOCOL_VERSION, t: 'peer.hello', peerId, hello: m.hello });
  }

  function handleHostCommand(c: Conn, m: ClientMessage, now: number) {
    const room = c.room;
    if (c.role !== 'host' || !room || room.host !== c) return sendError(c, 'BAD_MESSAGE', m.t, undefined, m.rid);
    room.lastActivity = now;
    switch (m.t) {
      case 'host.lock':
        room.locked = true;
        return;
      case 'host.unlock':
        room.locked = false;
        return;
      case 'host.admit': {
        const p = room.peers.get(m.peerId);
        if (!p || p.admitted) return;
        p.admitted = true;
        room.everAdmitted = true;
        sendTo(p, { v: PROTOCOL_VERSION, t: 'admitted', peerId: m.peerId });
        return;
      }
      case 'host.reject': {
        const p = room.peers.get(m.peerId);
        if (!p || p.admitted) return;
        room.peers.delete(m.peerId);
        p.room = null;
        p.peerId = null;
        p.hello = null;
        p.roomlessSince = now;
        // 연결은 남는다(다른 이름으로 다시 join 가능)
        sendTo(p, { v: PROTOCOL_VERSION, t: 'rejected', reason: m.reason });
        return;
      }
      case 'host.kick': {
        const p = room.peers.get(m.peerId);
        if (!p) return;
        room.peers.delete(m.peerId);
        p.room = null;
        p.peerId = null;
        p.admitted = false;
        sendTo(p, { v: PROTOCOL_VERSION, t: 'kicked' });
        closeConn(p, CLOSE_CODES.KICKED, 'kicked');
        return;
      }
      case 'host.close':
        destroyRoom(room, 'closed', now, m.rid);
        return;
      case 'host.to': {
        const p = room.peers.get(m.peerId);
        if (!p || !p.admitted) return;
        sendTo(p, { v: PROTOCOL_VERSION, t: 'host.to', msg: m.msg });
        return;
      }
      case 'host.all':
        sendToAdmitted(room, { v: PROTOCOL_VERSION, t: 'host.all', msg: m.msg });
        return;
      default:
        return sendError(c, 'BAD_MESSAGE', m.t);
    }
  }

  function handlePeerMsg(c: Conn, m: Extract<ClientMessage, { t: 'peer.msg' }>, now: number) {
    const room = c.room;
    if (c.role !== 'peer' || !room || !c.admitted || !c.peerId) return sendError(c, 'BAD_MESSAGE', m.t);
    if (!room.host) return sendError(c, 'HOST_OFFLINE', m.t);
    room.lastActivity = now;
    sendTo(room.host, { v: PROTOCOL_VERSION, t: 'peer.msg', peerId: c.peerId, msg: m.msg });
  }

  // ── 공개 함수 ──
  return {
    onConnect(connId, meta) {
      if (conns.has(connId)) return true;
      const now = deps.now();
      const ip = meta.ip || 'unknown';
      if (conns.size >= cfg.maxConn) {
        observe?.({ type: 'error', code: 'BUSY' });
        deps.send(connId, encode({ v: PROTOCOL_VERSION, t: 'error', code: 'BUSY' }));
        deps.close(connId, CLOSE_CODES.BUSY, 'BUSY');
        return false;
      }
      if ((connsPerIp.get(ip) ?? 0) >= cfg.maxConnPerIp) {
        observe?.({ type: 'error', code: 'RATE_LIMITED' });
        deps.send(connId, encode({ v: PROTOCOL_VERSION, t: 'error', code: 'RATE_LIMITED' }));
        deps.close(connId, CLOSE_CODES.RATE_LIMITED, 'RATE_LIMITED');
        return false;
      }
      const c: Conn = {
        id: connId,
        ip,
        role: 'none',
        connectedAt: now,
        room: null,
        peerId: null,
        admitted: false,
        hello: null,
        tokens: cfg.msgBurst,
        refillAt: now,
        errTokens: cfg.msgBurst,
        errRefillAt: now,
        roomlessSince: now,
      };
      conns.set(connId, c);
      connsPerIp.set(ip, (connsPerIp.get(ip) ?? 0) + 1);
      const nm = noticeMsg(now);
      sendTo(c, nm);
      return true;
    },

    onMessage(connId, raw) {
      const c = conns.get(connId);
      if (!c) return;
      const now = deps.now();
      if (!takeToken(c, now)) {
        // 응답을 기다리는 쪽이 풀 수 있게 req를 붙여 매번 답한다. 단 오류 응답도 따로 속도 제한(넘치면 버림 — 어댑터 시간 제한이 처리)
        if (takeErrToken(c, now)) sendError(c, 'RATE_LIMITED', peekType(raw), undefined, peekRid(raw));
        return;
      }
      const parsed = parseClientMessage(raw, cfg.maxMsgBytes);
      if (!parsed.ok) return sendError(c, parsed.code, parsed.t, undefined, peekRid(raw));
      const m = parsed.msg;
      switch (m.t) {
        case 'ping':
          return sendTo(c, { v: PROTOCOL_VERSION, t: 'pong', at: m.at, serverNow: now });
        case 'server.stats':
          return sendTo(c, withRid({ v: PROTOCOL_VERSION, t: 'server.stats', rooms: rooms.size, maxRooms: cfg.maxRooms }, m.rid));
        case 'host.open':
          return handleHostOpen(c, m, now);
        case 'host.resume':
          return handleHostResume(c, m, now);
        case 'peer.join':
          return handlePeerJoin(c, m, now);
        case 'peer.msg':
          return handlePeerMsg(c, m, now);
        default:
          return handleHostCommand(c, m, now);
      }
    },

    onDisconnect(connId) {
      const c = conns.get(connId);
      if (!c) return;
      detach(c, true, deps.now());
      forget(c);
    },

    sweep() {
      const now = deps.now();
      // 방 밖에 남은 연결(역할 없음·입장 실패·거절된 학생·방이 사라진 호스트)
      for (const c of [...conns.values()]) {
        if (c.room) continue;
        const limit = c.role === 'host' ? Math.max(cfg.unjoinedTimeout, ROOMLESS_HOST_TIMEOUT) : cfg.unjoinedTimeout;
        if (now - c.roomlessSince >= sec(limit)) {
          sendError(c, 'UNJOINED_TIMEOUT');
          closeConn(c, CLOSE_CODES.UNJOINED_TIMEOUT, 'UNJOINED_TIMEOUT');
        }
      }
      // 방 수명
      for (const room of [...rooms.values()]) {
        let reason: RoomCloseReason | null = null;
        if (now - room.createdAt >= sec(cfg.maxRoomAge)) reason = 'max_age';
        else if (room.host === null && room.hostLeftAt !== null && now - room.hostLeftAt >= sec(cfg.hostGrace)) reason = 'host_gone';
        else if (now - room.lastActivity >= sec(cfg.idleTtl)) reason = 'idle';
        else if (!room.everAdmitted && now - room.createdAt >= sec(cfg.emptyRoomTtl)) reason = 'empty';
        if (reason) destroyRoom(room, reason, now);
      }
      // 기록 정리
      for (const [code, e] of recentlyClosed) if (now - e.at >= sec(cfg.codeReuseBlock)) recentlyClosed.delete(code);
      for (const ip of [...roomCreates.keys()]) createsInWindow(ip, now);
      const failFrom = now - sec(cfg.joinFailWindow);
      for (const [ip, st] of joinFails) {
        st.fails = st.fails.filter((t) => t > failFrom);
        if (!st.fails.length && st.blockedUntil <= now && now - st.lastBlockEnd >= sec(JOIN_REBLOCK_WINDOW)) joinFails.delete(ip);
      }
      recentFails = recentFails.filter((t) => t > now - 60_000);
      // 공지 시간 경계가 지나 보이는 공지가 바뀌었으면 다시 알림
      if (encode(noticeMsg(now)) !== lastNoticeKey) broadcastNotice(now);
    },

    stats() {
      const now = deps.now();
      let peers = 0;
      for (const r of rooms.values()) peers += r.peers.size;
      let blockedIps = 0;
      for (const st of joinFails.values()) if (st.blockedUntil > now) blockedIps++;
      return {
        rooms: rooms.size,
        maxRooms: cfg.maxRooms,
        peers,
        conns: conns.size,
        maxConn: cfg.maxConn,
        blockedIps,
        joinFailPerMin: recentFails.filter((t) => t > now - 60_000).length,
        notice: activeNotice(now)?.level ?? null,
        acceptingNewRooms: newRoomBlock(now) === null,
      };
    },

    setNotice(n) {
      notice = n ? normalizeNotice(n) : null;
      broadcastNotice(deps.now());
    },

    announceRestart() {
      const data = encode({ v: PROTOCOL_VERSION, t: 'server.restarting' });
      for (const c of conns.values()) deps.send(c.id, data);
    },
  };
}
