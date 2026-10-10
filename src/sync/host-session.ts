/**
 * 호스트 세션 (작업 124, PRD 7.2~7.4·7.8·10.4·10.7 — v0.3.1).
 *
 * 교사 브라우저(호스트)에서 돈다. 전송 계층(HostTransport) 위에서 **게임 규칙을 모르는** 세션 일을 한다:
 * 학생 입장 판정(5단계)·좌석(출석번호)↔기기 토큰 묶기·다른 기기 재입장 허락·내보내기·회사 이름 관리,
 * 학생 행동 `{seq, action}`을 주입된 리듀서로 확정하고 결과 보내기(공개 상태 1초 묶음, 개인 상태·ack는 본인에게만),
 * 판 전체를 교사 localStorage에 1초 묶음으로 저장하고 새로 고침·서버 재시작 뒤 이어 가기.
 *
 * `src/core`를 import하지 않는다(리듀서·보기 함수는 주입). 콘솔에 출석번호·회사 이름을 찍지 않는다.
 */
import { errorToKorean, type JsonObject } from '@shared/protocol';
import type { ConnectionStatus, HostTransport, OpenRoomError, ResumeRoomResult, Unsub } from './adapter';
import { Listeners } from './adapter';
import {
  assertNoSeatInPublic,
  diffPublic,
  encodeRejectReason,
  msgType,
  parseHello,
  stripSeatKeys,
  type AdmitMode,
  type HelloMsg,
  type HostToPeer,
  type JoinRejectReason,
  type NameStatus,
} from './app-messages';
import { hasBadWord, nameKey, normalizeCompanyName, validateCompanyName, type CompanyNameError } from './company-name';
import {
  buildResultFiles,
  exportMoveFile as makeMoveFile,
  importMoveFile as readMoveFile,
  type HostStore,
  type ResultFiles,
  type ResultTable,
  type StoredHost,
} from './host-store';
import type { ScreenPublisher } from './screen-bridge';
import { createThrottle, realTimers, TokenBucket, type Throttle, type Timers } from './throttle';

// ───────────────────────────── 상수 ─────────────────────────────

export const MIN_SEAT = 1;
export const MAX_SEAT = 40;
/** 이어하기 때 이만큼 넘게 끊겼으면 리듀서에 `hostGap`(끊긴 시간 일시정지 처리, PRD 4.2.2·7.8) */
export const HOST_GAP_MIN_MS = 5_000;
/** 앱 쪽 입장 실패 제한: 같은 기기 토큰의 거절이 5분에 10번이 되면 1분 동안 TOO_MANY_TRIES만 */
export const JOIN_FAIL_WINDOW_MS = 5 * 60_000;
export const JOIN_FAIL_LIMIT = 10;
export const JOIN_FAIL_BLOCK_MS = 60_000;
/** 좌석마다 기억하는 최근 ack 수(같은 seq가 다시 오면 같은 ack) */
export const ACK_CACHE_SIZE = 30;
/** 교사 '입장 문제' 목록 상한(오래된 것부터 버림) */
export const JOIN_PROBLEM_MAX = 50;
/** 손님 연결(허락 대기·거절 뒤) 상한 — 넘으면 가장 오래된 손님을 내보냄 */
export const GUEST_MAX = 20;
/** 옮겨진 연결 기억 수(호스트 새로 고침 뒤에도 알아보기) */
export const MOVED_PEER_MAX = 50;
export const DEFAULT_MAX_PEERS = 45;
/** 호스트가 중계 서버로 보내는 메시지 속도(서버 상한 초당 20개·순간 40개보다 조금 낮게) */
export const HOST_SEND_RATE = 18;
export const HOST_SEND_BURST = 36;
/** 묶음(multi) 메시지 하나의 최대 크기(서버 상한 64KB보다 작게) */
export const MULTI_MAX_CHARS = 40_000;
export const BEFORE_UNLOAD_MESSAGE = '수업 중인 판이 있어요. 닫으면 학생들이 기다려야 해요.';

// ───────────────────────────── 리듀서 계약 ─────────────────────────────

/** 교사 행동(모양만 — 실제 종류는 작업 103의 TeacherAction) */
export interface TeacherActionLike {
  type: string;
  [k: string]: unknown;
}

/**
 * 세션이 리듀서에 넣는 입력. 학생 행동·교사 행동·시계 틱 외에 입장·접속 알림과 끊긴 시간이 있다.
 * 세션이 직접 처리하고 리듀서에도 알리는 교사 행동(이름 바꾸기 등)은 `teacher`로 들어간다 — PROTOCOL.md 표 참고.
 */
export type SessionInput =
  | { type: 'join'; seat: number; pid: string; companyName: string; nameKey: string; nameStatus: NameStatus }
  | { type: 'presence'; seat: number; online: boolean }
  | { type: 'act'; seat: number; seq: number; action: unknown }
  | { type: 'teacher'; action: TeacherActionLike }
  | { type: 'tick' }
  | { type: 'hostGap'; gapMs: number };

/** 리듀서 출력 */
export type SessionOutput =
  /** 공개 상태가 바뀜(세션이 `views.public(game)`으로 다시 읽어 1초 묶음으로 보냄) */
  | { type: 'public'; data?: JsonObject }
  /** 그 좌석 개인 상태(없으면 `views.me`) — 본인 연결로만 */
  | { type: 'me'; seat: number; data?: JsonObject }
  /** 학생 행동 결과(없으면 ok로 봄) */
  | { type: 'ack'; seat: number; seq: number; ok: boolean; error?: string }
  /** 교사 화면 전용 정보(다음 예정 사건 등) */
  | { type: 'teacher'; data: JsonObject };

/** `reducer(snapshot, input, now) → { snapshot, outputs }` (작업 103 `hostReduce`와 같은 모양, 스냅숏은 게임 부분) */
export type SessionReducer<G> = (snapshot: G, input: SessionInput, now: number) => { snapshot: G; outputs: SessionOutput[] };

/** 필요할 때 전체 상태를 읽는 보기 함수(입장·이어하기 때 전체를 보냄) */
export interface SessionViews<G> {
  /** 학급 공개 상태 — 출석번호(`seat`) 키 금지(pid로) */
  public(game: G): JsonObject;
  /** 그 좌석 개인 상태 */
  me(game: G, seat: number): JsonObject | null;
  /** 공용 화면에 보낼 학급 보기(선택, 공개 정보만) */
  screen?(game: G): JsonObject | null;
}

// ───────────────────────────── 세션 장부(저장됨) ─────────────────────────────

export interface AckRecord {
  seq: number;
  ok: boolean;
  error?: string;
  version: number;
}

export interface SeatRecord {
  seat: number;
  /** 공개 ID(무작위 6자 영숫자, 방 안 유일) */
  pid: string;
  /** 이 좌석에 묶인 기기 토큰(호스트만 앎) */
  deviceToken: string;
  companyName: string;
  nameKey: string;
  nameStatus: NameStatus;
  joinedAt: number;
  /** 마지막으로 처리한 행동 seq */
  lastSeq: number;
  acks: AckRecord[];
  /** 개인 상태 버전 */
  meVersion: number;
  /** 지금 연결된 peerId(새로 고침 뒤 다시 찾기용, 없으면 null) */
  peerId: string | null;
}

export interface JoinProblem {
  seat: number;
  attempts: number;
  lastAt: number;
  peerId: string;
  /** 교사 화면에 보이지 않음 — [이 기기를 n번 회사로 연결]에 씀 */
  deviceToken: string;
}

export interface SessionData {
  locked: boolean;
  /** 키 's07' */
  seats: Record<string, SeatRecord>;
  kickedTokens: string[];
  /** 이 판에서 교사가 막은 이름의 비교 키 */
  bannedNameKeys: string[];
  joinProblems: JoinProblem[];
  /** 금칙어로 거절된 수(이름은 기록하지 않음) */
  badNameRejects: number;
  publicVersion: number;
  /** 다른 기기로 옮겨진 옛 연결 peerId(새로 고침 뒤에도 hello.again을 보내지 않으려고) */
  movedPeerIds?: string[];
  startedAt: number;
}

export const seatKey = (seat: number) => `s${String(seat).padStart(2, '0')}`;

function emptySession(now: number): SessionData {
  return {
    locked: false,
    seats: {},
    kickedTokens: [],
    bannedNameKeys: [],
    joinProblems: [],
    badNameRejects: 0,
    publicVersion: 0,
    startedAt: now,
  };
}

// ───────────────────────────── 교사 화면 보기 ─────────────────────────────

export type HostStatus = 'idle' | 'opening' | 'open' | 'reconnecting' | 'offline' | 'replaced' | 'closed';

export interface RejoinRequestView {
  seat: number;
  companyName: string;
  /** 옛 기기가 아직 접속 중("지금 접속 중인 기기가 있어요" 경고) */
  oldOnline: boolean;
  at: number;
  peerId: string;
}

export interface HostView<G> {
  status: HostStatus;
  connection: ConnectionStatus;
  code: string | null;
  /** 서버 재시작 뒤 새 코드를 받았으면 {from, to} — 공용 화면에 크게 */
  codeChanged: { from: string; to: string } | null;
  locked: boolean;
  ended: boolean;
  /** 교사 화면 학생 표(출석번호는 교사 화면에만) */
  seats: { seat: number; pid: string; companyName: string; nameStatus: NameStatus; online: boolean; joinedAt: number }[];
  rejoinRequests: RejoinRequestView[];
  /** '입장 문제'(다른 이름으로 같은 번호 입장 시도) — 이름은 넣지 않음 */
  joinProblems: { seat: number; attempts: number; lastAt: number; peerId: string }[];
  badNameRejects: number;
  /** 리듀서의 교사 전용 출력(마지막 값) */
  teacher: JsonObject | null;
  game: G | null;
  /** 교사 브라우저 저장 실패('QUOTA' 저장 공간 부족·'NO_STORAGE' 저장 차단) — 109가 띠로 알림 */
  storageError: 'QUOTA' | 'NO_STORAGE' | null;
  /** 호스트 연결이 끊긴 시각(끊긴 동안 틱 정지, 없으면 null) */
  disconnectedAt: number | null;
}

// ───────────────────────────── 옵션·결과 ─────────────────────────────

export interface HostSessionOptions<G> {
  transport: HostTransport;
  reducer: SessionReducer<G>;
  views: SessionViews<G>;
  store: HostStore;
  appVersion: string;
  now?: () => number;
  /** 1초 틱·묶음 전송용 타이머. null이면 `tick()`을 직접 부른다(테스트) */
  timers?: Timers | null;
  /** 게임 단계 읽기(이름 바꾸기 허용 'prep', 판 끝 'ended'). 기본 `game.class.phase` */
  phaseOf?: (game: G) => string | undefined;
  /** 결과 표(작업 103 scoring). 없으면 exportResult 불가 */
  resultTable?: (game: G) => ResultTable;
  /** 공용 화면 다리 만들기(코드가 바뀌면 새로 만듦). 없으면 공용 화면에 보내지 않음 */
  screenFactory?: ((code: string) => ScreenPublisher) | null;
  /** 교사 추가 금칙어(P1) */
  extraBannedWords?: () => string[];
  /** 공개 상태에 출석번호 키가 있으면 예외(테스트). 기본: 개발 모드 콘솔 오류 + 키 지우고 보냄 */
  strictPublic?: boolean;
  maxPeers?: number;
  /** 무작위 정수 [0, n) — pid 생성(테스트 주입) */
  randomInt?: (n: number) => number;
  publicIntervalMs?: number;
  saveIntervalMs?: number;
  tickMs?: number;
  /** 보내기 속도(초당·순간). 기본 18·36. rate를 0으로 주면 속도 맞추기 없이 바로 보냄 */
  sendRate?: number;
  sendBurst?: number;
}

export type OpenResult = { ok: true; code: string } | { ok: false; error: OpenRoomError; text: string };
export type AttachMode = 'resumed' | 'reopened' | 'newCode';
export type ResumeResult =
  | { ok: true; code: string; mode: AttachMode; gapMs: number }
  | { ok: false; error: Exclude<ResumeRoomResult, 'ok' | 'NO_ROOM'> | OpenRoomError | 'NO_SAVE' | 'BAD_FILE' | 'VERSION'; text: string };

export type RenameResult = { ok: true; companyName: string; warning?: 'BAD_NAME' } | { ok: false; error: CompanyNameError | 'NO_SEAT' };

export interface HostSession<G> {
  open(settings: { game: G; maxPeers?: number }): Promise<OpenResult>;
  /** 저장된 판 이어하기(코드 생략 = 마지막 판) */
  resume(code?: string): Promise<ResumeResult>;
  /** 판 옮기기 파일 열기 → 같은 코드로 이어 감 */
  importMoveFile(json: string): Promise<ResumeResult>;
  exportMoveFile(): string;
  exportResult(meta?: { className?: string }): ResultFiles | null;

  dispatchTeacher(action: TeacherActionLike): void;
  setLocked(locked: boolean): void;
  kick(seat: number): boolean;
  approveRejoin(seat: number): boolean;
  denyRejoin(seat: number): boolean;
  renameCompany(seat: number, newName: string): RenameResult;
  blockCompanyName(seat: number): boolean;
  reassignSeat(fromSeat: number, toSeat: number): boolean;
  bindDeviceToSeat(peerId: string, seat: number): boolean;

  /** 1초 틱(타이머가 없을 때 직접) */
  tick(): void;
  /** 저장 대기분을 바로 저장 */
  flushSave(): void;
  /** 판 끝내기·방 닫기 */
  close(): Promise<void>;
  dispose(): void;

  subscribe(cb: (v: HostView<G>) => void): Unsub;
  getView(): HostView<G>;
  /** beforeunload 경고가 필요한가(판 진행 중) */
  shouldWarnBeforeUnload(): boolean;
  /** window에 beforeunload·pagehide 연결(해제 함수) */
  installBeforeUnload(target?: Pick<Window, 'addEventListener' | 'removeEventListener'>): () => void;
}

// ───────────────────────────── 구현 ─────────────────────────────

interface Guest {
  hello: HelloMsg;
  /** 재입장 요청 중인 좌석(요청 중이 아니면 null) */
  pendingSeat: number | null;
  oldOnline: boolean;
  at: number;
}

const PID_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

function defaultRandomInt(n: number): number {
  const c = (globalThis as { crypto?: { getRandomValues<T extends ArrayBufferView>(x: T): T } }).crypto;
  if (c?.getRandomValues) {
    const a = new Uint32Array(1);
    c.getRandomValues(a);
    return (a[0] as number) % n;
  }
  return Math.floor(Math.random() * n);
}

function localDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const defaultPhaseOf = (game: unknown): string | undefined => {
  const c = (game as { class?: { phase?: unknown } } | null)?.class;
  return typeof c?.phase === 'string' ? c.phase : undefined;
};

type OutOp =
  | { kind: 'admit' | 'kick'; peerId: string }
  | { kind: 'reject'; peerId: string; reason: string }
  | { kind: 'to'; peerId: string; msgs: HostToPeer[]; size: number }
  | { kind: 'all'; msg: HostToPeer };

/**
 * 보낼 함: 호스트가 중계 서버로 보내는 모든 명령(admit·reject·kick·sendTo·broadcast)을 순서대로 모아
 * 서버 속도 상한 안에서 보낸다. 같은 학생에게 같은 순간 생긴 메시지는 `multi` 하나로 묶고(예: state.me + ack),
 * 아직 못 보낸 묶음 안의 옛 state.me는 새것으로 바꾼다(최신만 의미 있음).
 */
class HostOutbox {
  private readonly q: OutOp[] = [];
  private readonly lastFor = new Map<string, OutOp>();
  private scheduled = false;
  private timer: unknown = null;
  constructor(
    private readonly t: HostTransport,
    private readonly bucket: TokenBucket | null,
    private readonly timers: Timers | null,
  ) {}

  get size(): number {
    return this.q.length;
  }
  admit(peerId: string) {
    this.push({ kind: 'admit', peerId });
  }
  kick(peerId: string) {
    this.push({ kind: 'kick', peerId });
  }
  reject(peerId: string, reason: string) {
    this.push({ kind: 'reject', peerId, reason });
  }
  all(msg: HostToPeer) {
    this.push({ kind: 'all', msg });
  }
  to(peerId: string, msg: HostToPeer) {
    const size = JSON.stringify(msg).length;
    const last = this.lastFor.get(peerId);
    if (last && last.kind === 'to' && last.size + size < MULTI_MAX_CHARS) {
      if (msg.t === 'state.me') {
        const i = last.msgs.findIndex((m) => m.t === 'state.me');
        if (i >= 0) last.msgs.splice(i, 1);
      }
      last.msgs.push(msg);
      last.size += size;
      return;
    }
    this.push({ kind: 'to', peerId, msgs: [msg], size });
  }
  /** 남은 것을 속도와 상관없이 모두 보냄(방 닫기 직전) */
  flushNow() {
    while (this.q.length) this.exec(this.q.shift() as OutOp);
    this.lastFor.clear();
  }
  dispose() {
    if (this.timer !== null && this.timers) this.timers.clearTimeout(this.timer);
    this.timer = null;
    this.q.length = 0;
    this.lastFor.clear();
  }

  private push(op: OutOp) {
    this.q.push(op);
    if (op.kind !== 'all') this.lastFor.set(op.peerId, op);
    if (!this.scheduled) {
      this.scheduled = true;
      queueMicrotask(() => {
        this.scheduled = false;
        this.drain();
      });
    }
  }

  private drain() {
    while (this.q.length && (!this.bucket || this.bucket.take())) {
      const op = this.q.shift() as OutOp;
      if (op.kind !== 'all' && this.lastFor.get(op.peerId) === op) this.lastFor.delete(op.peerId);
      this.exec(op);
    }
    if (this.q.length && this.bucket && this.timers && this.timer === null) {
      this.timer = this.timers.setTimeout(() => {
        this.timer = null;
        this.drain();
      }, Math.max(1, this.bucket.waitMs()));
    }
  }

  private exec(op: OutOp) {
    switch (op.kind) {
      case 'admit':
        return this.t.admit(op.peerId);
      case 'kick':
        return this.t.kick(op.peerId);
      case 'reject':
        return this.t.reject(op.peerId, op.reason);
      case 'all':
        return this.t.broadcast(op.msg);
      case 'to':
        return this.t.sendTo(op.peerId, op.msgs.length === 1 ? (op.msgs[0] as HostToPeer) : { t: 'multi', msgs: op.msgs });
    }
  }
}

class HostSessionImpl<G> implements HostSession<G> {
  private readonly t: HostTransport;
  private readonly now: () => number;
  private readonly timers: Timers | null;
  private readonly phaseOf: (g: G) => string | undefined;
  private readonly randomInt: (n: number) => number;
  private readonly strict: boolean;
  private readonly tickMs: number;

  private status: HostStatus = 'idle';
  private code: string | null = null;
  private hostToken: string | null = null;
  private maxPeers: number;
  private game: G | null = null;
  private data: SessionData;
  private endedAt: number | null = null;
  private codeChanged: { from: string; to: string } | null = null;
  private storageError: 'QUOTA' | 'NO_STORAGE' | null = null;
  /** 호스트 연결(서버)이 끊긴 시각 — 끊긴 동안 틱을 멈추고, 다시 붙으면 끊긴 시간을 hostGap으로 */
  private disconnectedAt: number | null = null;
  private teacherData: JsonObject | null = null;

  private readonly peerSeat = new Map<string, number>();
  private readonly guests = new Map<string, Guest>();
  private readonly movedPeers = new Set<string>();
  private readonly fails = new Map<string, number[]>();
  private readonly blockedUntil = new Map<string, number>();

  private lastPublic: JsonObject | null = null;
  private lastPublicJson = '';
  private readonly publicThrottle: Throttle;
  private readonly saveThrottle: Throttle;
  private tickTimer: unknown = null;
  private attaching: Promise<ResumeResult> | null = null;
  private closing = false;
  private screen: ScreenPublisher | null = null;
  private readonly out: HostOutbox;

  private readonly viewL = new Listeners<[HostView<G>]>();
  private readonly unsubs: Unsub[] = [];

  constructor(private readonly o: HostSessionOptions<G>) {
    this.t = o.transport;
    this.now = o.now ?? (() => Date.now());
    this.timers = o.timers === undefined ? realTimers : o.timers;
    this.phaseOf = o.phaseOf ?? (defaultPhaseOf as (g: G) => string | undefined);
    this.randomInt = o.randomInt ?? defaultRandomInt;
    this.strict = o.strictPublic ?? false;
    this.tickMs = o.tickMs ?? 1000;
    this.maxPeers = o.maxPeers ?? DEFAULT_MAX_PEERS;
    this.data = emptySession(this.now());
    const rate = o.sendRate ?? HOST_SEND_RATE;
    this.out = new HostOutbox(
      this.t,
      rate > 0 ? new TokenBucket(rate, o.sendBurst ?? HOST_SEND_BURST, this.now) : null,
      this.timers,
    );
    this.publicThrottle = createThrottle(() => this.flushPublic(), {
      intervalMs: o.publicIntervalMs ?? 1000,
      now: this.now,
      timers: this.timers,
    });
    this.saveThrottle = createThrottle(() => this.saveNow(), {
      intervalMs: o.saveIntervalMs ?? 1000,
      now: this.now,
      timers: this.timers,
    });
    this.unsubs.push(
      this.t.onPeerHello((peerId, hello) => this.handleHello(peerId, hello, false)),
      this.t.onPeerMessage((peerId, msg) => this.handlePeerMessage(peerId, msg)),
      this.t.onPeerLeave((peerId) => this.handleLeave(peerId)),
      this.t.onStatus((s) => this.handleStatus(s)),
      this.t.onRoomClosed((reason) => this.handleRoomClosed(reason)),
    );
  }

  // ── 방 열기·이어하기 ──

  async open(settings: { game: G; maxPeers?: number }): Promise<OpenResult> {
    this.o.store.purgeExpired();
    if (settings.maxPeers) this.maxPeers = settings.maxPeers;
    this.status = 'opening';
    this.emitView();
    const r = await this.t.openRoom({ maxPeers: this.maxPeers });
    if (typeof r === 'string') {
      this.status = 'idle';
      this.emitView();
      return { ok: false, error: r, text: errorToKorean(r, this.t.lastError() ?? undefined) };
    }
    this.code = r.code;
    this.hostToken = r.hostToken;
    this.game = settings.game;
    this.data = emptySession(this.now());
    this.endedAt = null;
    this.status = 'open';
    this.setScreen(r.code);
    this.startTicking();
    this.saveNow();
    this.publicThrottle.request();
    this.emitView();
    return { ok: true, code: r.code };
  }

  async resume(code?: string): Promise<ResumeResult> {
    this.o.store.purgeExpired();
    const rec = code ? this.o.store.load(code) : this.o.store.loadLast();
    if (!rec) return { ok: false, error: 'NO_SAVE', text: '이어 할 판이 없어요.' };
    return this.resumeFrom(rec as StoredHost<G>);
  }

  async importMoveFile(json: string): Promise<ResumeResult> {
    const r = readMoveFile(json);
    if (!r.ok) {
      return {
        ok: false,
        error: r.error,
        text: r.error === 'VERSION' ? '다른 버전의 게임에서 만든 파일이라 열 수 없어요.' : '판 옮기기 파일이 아니에요.',
      };
    }
    this.o.store.save(r.record);
    return this.resumeFrom(r.record as StoredHost<G>);
  }

  private async resumeFrom(rec: StoredHost<G>): Promise<ResumeResult> {
    this.code = rec.code;
    this.hostToken = rec.hostToken;
    this.game = rec.game;
    this.data = { ...emptySession(this.now()), ...rec.session };
    this.endedAt = rec.endedAt;
    this.peerSeat.clear();
    for (const s of Object.values(this.data.seats)) if (s.peerId) this.peerSeat.set(s.peerId, s.seat);
    this.movedPeers.clear();
    for (const id of this.data.movedPeerIds ?? []) this.movedPeers.add(id);
    this.disconnectedAt = null;
    this.publicThrottle.cancel();
    this.lastPublic = null;
    this.lastPublicJson = '';
    // 끊긴 시간 = 지금 − max(마지막 저장, 마지막 틱). 출력 없는 틱에는 판을 저장하지 않으므로 틱 시각을 따로 봄
    const lastAlive = Math.max(rec.savedAt, this.o.store.loadTick?.(rec.code) ?? 0);
    const gapMs = Math.max(0, this.now() - lastAlive);
    this.status = 'opening';
    this.emitView();
    const r = await this.attach();
    if (!r.ok) {
      this.status = 'idle';
      this.emitView();
      return r;
    }
    if (gapMs >= HOST_GAP_MIN_MS) this.reduce({ type: 'hostGap', gapMs });
    this.startTicking();
    this.saveNow();
    return { ...r, gapMs };
  }

  /**
   * 서버에 다시 붙기: resumeRoom → (방 없음) 같은 코드로 다시 열기 → (막힘) 새 코드.
   * 붙은 뒤 지금 연결된 학생에게 최신 상태를 다시 보낸다.
   */
  private attach(): Promise<ResumeResult> {
    if (this.attaching) return this.attaching;
    this.attaching = this.doAttach().finally(() => {
      this.attaching = null;
    });
    return this.attaching;
  }

  private async doAttach(): Promise<ResumeResult> {
    const code = this.code as string;
    const token = this.hostToken as string;
    let mode: AttachMode;
    const r = await this.t.resumeRoom(code, token);
    if (r === 'ok') mode = 'resumed';
    else if (r === 'NO_ROOM') {
      const o = await this.t.openRoom({ maxPeers: this.maxPeers, wantCode: code, hostToken: token });
      if (typeof o === 'string') return { ok: false, error: o, text: errorToKorean(o, this.t.lastError() ?? undefined) };
      if (o.code === code) mode = 'reopened';
      else {
        mode = 'newCode';
        this.switchCode(o.code, o.hostToken);
      }
    } else return { ok: false, error: r, text: errorToKorean(r, this.t.lastError() ?? undefined) };

    // 연결 다시 맞추기
    const connected = new Set(mode === 'resumed' ? this.t.connectedPeers() : []);
    this.peerSeat.clear();
    this.guests.clear();
    for (const s of Object.values(this.data.seats)) {
      if (s.peerId && connected.has(s.peerId)) this.peerSeat.set(s.peerId, s.seat);
      else if (s.peerId) {
        s.peerId = null;
        this.reduce({ type: 'presence', seat: s.seat, online: false });
      }
    }
    this.status = 'open';
    if (!this.screen && this.code) this.setScreen(this.code);
    this.lastPublic = null;
    this.lastPublicJson = '';
    this.publicThrottle.request();
    for (const id of connected) {
      const seat = this.peerSeat.get(id);
      if (seat !== undefined) {
        this.sendFullPublic(id);
        this.sendMe(seat);
      } else if (!this.movedPeers.has(id)) this.send(id, { t: 'hello.again' });
    }
    // 연결만 끊겼던 경우(교사 탭은 살아 있음): 끊긴 시간을 일시정지로(PRD 7.3·7.8)
    let gapMs = 0;
    if (this.disconnectedAt !== null) {
      gapMs = Math.max(0, this.now() - this.disconnectedAt);
      this.disconnectedAt = null;
      if (gapMs >= HOST_GAP_MIN_MS) this.reduce({ type: 'hostGap', gapMs });
    }
    this.saveThrottle.request();
    this.emitView();
    return { ok: true, code: this.code as string, mode, gapMs };
  }

  private switchCode(newCode: string, newToken: string) {
    const old = this.code as string;
    this.o.store.remove(old);
    this.code = newCode;
    this.hostToken = newToken;
    this.codeChanged = { from: old, to: newCode };
    if (this.screen) {
      this.screen.codeChanged(newCode);
      this.screen.dispose();
      this.screen = null;
    }
    this.setScreen(newCode);
    this.out.all({ t: 'code.changed', newCode });
  }

  private setScreen(code: string) {
    if (!this.o.screenFactory) return;
    this.screen?.dispose();
    this.screen = this.o.screenFactory(code);
  }

  // ── 전송 계층 사건 ──

  private handleStatus(s: ConnectionStatus) {
    if (this.status === 'closed' || this.status === 'replaced' || this.status === 'idle') {
      this.emitView();
      return;
    }
    if (s === 'online') {
      if (this.code && !this.t.roomCode() && !this.closing) void this.attach();
    } else if (this.status === 'open' || this.status === 'reconnecting' || this.status === 'offline') {
      this.status = s === 'reconnecting' ? 'reconnecting' : 'offline';
      this.disconnectedAt ??= this.now();
    }
    this.emitView();
  }

  private handleRoomClosed(reason: string) {
    if (reason === 'replaced') {
      // 다른 탭·PC가 같은 방을 이어 감 — 이 세션은 멈춘다
      this.status = 'replaced';
      this.stopTicking();
      this.emitView();
      return;
    }
    if (this.closing || reason === 'closed' || this.status === 'closed') return;
    // 무활동·빈 방·호스트 부재 등으로 서버가 방을 지움 → 같은 코드로 다시 열기(그동안 틱 정지)
    if (this.endedAt === null && this.code) {
      this.disconnectedAt ??= this.now();
      void this.attach();
    }
  }

  private handleLeave(peerId: string) {
    this.guests.delete(peerId);
    this.movedPeers.delete(peerId);
    const seat = this.peerSeat.get(peerId);
    if (seat === undefined) {
      this.emitView();
      return;
    }
    this.peerSeat.delete(peerId);
    const rec = this.data.seats[seatKey(seat)];
    if (rec && rec.peerId === peerId) {
      rec.peerId = null;
      this.reduce({ type: 'presence', seat, online: false });
    }
    this.saveThrottle.request();
    this.emitView();
  }

  // ── 입장 판정 ──

  private recordFail(token: string) {
    const t = this.now();
    const list = (this.fails.get(token) ?? []).filter((x) => t - x < JOIN_FAIL_WINDOW_MS);
    list.push(t);
    if (list.length >= JOIN_FAIL_LIMIT) {
      this.blockedUntil.set(token, t + JOIN_FAIL_BLOCK_MS);
      this.fails.delete(token);
    } else this.fails.set(token, list);
  }

  private isBlocked(token: string): boolean {
    const until = this.blockedUntil.get(token);
    if (until === undefined) return false;
    if (this.now() < until) return true;
    this.blockedUntil.delete(token);
    return false;
  }

  private refuse(
    peerId: string,
    reason: JoinRejectReason,
    viaApp: boolean,
    token: string | null,
    suggestions?: string[],
    count = true,
  ) {
    if (count && token) this.recordFail(token);
    if (viaApp) {
      const g = this.guests.get(peerId);
      if (g) g.pendingSeat = null;
      this.send(peerId, { t: 'hello.rejected', reason, ...(suggestions?.length ? { suggestions } : {}) });
    } else this.out.reject(peerId, encodeRejectReason(reason, suggestions));
  }

  private findSeatByToken(token: string): SeatRecord | null {
    for (const s of Object.values(this.data.seats)) if (s.deviceToken === token) return s;
    return null;
  }

  private isOnline(rec: SeatRecord): boolean {
    return rec.peerId !== null && this.peerSeat.get(rec.peerId) === rec.seat;
  }

  private takenKeys(exceptSeat?: number): string[] {
    return Object.values(this.data.seats)
      .filter((s) => s.seat !== exceptSeat)
      .map((s) => s.nameKey);
  }

  private newPid(): string {
    const used = new Set(Object.values(this.data.seats).map((s) => s.pid));
    for (;;) {
      let p = '';
      for (let i = 0; i < 6; i++) p += PID_ALPHABET[this.randomInt(PID_ALPHABET.length)];
      if (!used.has(p)) return p;
    }
  }

  /**
   * 입장 판정(PRD 7.2, v0.3.1):
   * (0) 실패 제한 → TOO_MANY_TRIES  ① 차단된 기기 토큰 → KICKED  ② 이 기기 토큰이 묶인 좌석 → 그 좌석으로 자동 재입장
   * ③ 빈 번호: 마감이면 LOCKED, 아니면 회사 이름 검사 → 새 좌석  ④ 같은 이름의 회사 → 다른 기기 재입장 요청(교사 허락)
   * ⑤ 다른 이름의 회사 → SEAT_TAKEN(그 회사 이름은 보내지 않음) + 교사 '입장 문제' 목록
   */
  private handleHello(peerId: string, raw: unknown, viaApp: boolean) {
    if (this.status === 'closed' || this.status === 'replaced') return;
    const h = parseHello(raw);
    if (!h) return this.refuse(peerId, 'BAD_HELLO', viaApp, null);
    const token = h.deviceToken;
    if (this.isBlocked(token)) return this.refuse(peerId, 'TOO_MANY_TRIES', viaApp, token, undefined, false);
    // ①
    if (this.data.kickedTokens.includes(token)) return this.refuse(peerId, 'KICKED', viaApp, token);
    // ②
    const bound = this.findSeatByToken(token);
    if (bound) return this.admitTo(peerId, bound, 'same-device', h, viaApp);
    if (!Number.isInteger(h.seat) || h.seat < MIN_SEAT || h.seat > MAX_SEAT) return this.refuse(peerId, 'BAD_HELLO', viaApp, token);
    const rec = this.data.seats[seatKey(h.seat)];
    // ③
    if (!rec) {
      if (this.data.locked) return this.refuse(peerId, 'LOCKED', viaApp, token);
      const v = validateCompanyName(h.company, {
        takenKeys: this.takenKeys(),
        bannedKeys: this.data.bannedNameKeys,
        extraWords: this.o.extraBannedWords?.() ?? [],
      });
      if (!v.ok) {
        if (v.error === 'BAD_NAME') this.data.badNameRejects++;
        return this.refuse(peerId, v.error, viaApp, token, v.suggestions);
      }
      const seatRec: SeatRecord = {
        seat: h.seat,
        pid: this.newPid(),
        deviceToken: token,
        companyName: v.name,
        nameKey: v.key,
        nameStatus: v.realNameHint ? 'checkRealName' : 'ok',
        joinedAt: this.now(),
        lastSeq: 0,
        acks: [],
        meVersion: 0,
        peerId: null,
      };
      this.data.seats[seatKey(h.seat)] = seatRec;
      this.reduce({
        type: 'join',
        seat: seatRec.seat,
        pid: seatRec.pid,
        companyName: seatRec.companyName,
        nameKey: seatRec.nameKey,
        nameStatus: seatRec.nameStatus,
      });
      return this.admitTo(peerId, seatRec, 'new', h, viaApp);
    }
    // ④
    if (nameKey(normalizeCompanyName(h.company)) === rec.nameKey) {
      if (!viaApp) this.out.admit(peerId); // 손님 연결로 들여 둠(교사 허락 전에는 좌석 없음)
      for (const [id, g] of this.guests) if (id !== peerId && g.hello.deviceToken === token) this.guests.delete(id);
      this.guests.set(peerId, { hello: h, pendingSeat: rec.seat, oldOnline: this.isOnline(rec), at: this.now() });
      this.trimGuests();
      this.send(peerId, { t: 'rejoin.pending' });
      this.emitView();
      return;
    }
    // ⑤
    const prob = this.data.joinProblems.find((p) => p.seat === rec.seat && p.deviceToken === token);
    if (prob) {
      prob.attempts++;
      prob.lastAt = this.now();
      prob.peerId = peerId;
    } else {
      this.data.joinProblems.push({ seat: rec.seat, attempts: 1, lastAt: this.now(), peerId, deviceToken: token });
      if (this.data.joinProblems.length > JOIN_PROBLEM_MAX) {
        this.data.joinProblems.sort((a, b) => a.lastAt - b.lastAt);
        this.data.joinProblems.splice(0, this.data.joinProblems.length - JOIN_PROBLEM_MAX);
      }
    }
    this.refuse(peerId, 'SEAT_TAKEN', viaApp, token);
    this.saveThrottle.request();
    this.emitView();
  }

  /** 손님 연결이 너무 많으면 가장 오래된 것부터 내보냄(방 자리·교사 목록 보호) */
  private trimGuests() {
    while (this.guests.size > GUEST_MAX) {
      let oldest: [string, Guest] | null = null;
      for (const e of this.guests) if (!oldest || e[1].at < oldest[1].at) oldest = e;
      if (!oldest) return;
      this.guests.delete(oldest[0]);
      this.send(oldest[0], { t: 'hello.rejected', reason: 'TOO_MANY_TRIES' });
      this.out.kick(oldest[0]);
    }
  }

  private markMoved(peerId: string) {
    this.movedPeers.add(peerId);
    const list = (this.data.movedPeerIds ??= []);
    if (!list.includes(peerId)) list.push(peerId);
    if (list.length > MOVED_PEER_MAX) list.splice(0, list.length - MOVED_PEER_MAX);
  }

  private admitTo(peerId: string, rec: SeatRecord, mode: AdmitMode, h: HelloMsg | null, viaApp: boolean) {
    if (!viaApp) this.out.admit(peerId);
    this.guests.delete(peerId);
    this.movedPeers.delete(peerId);
    const old = rec.peerId;
    if (old && old !== peerId && this.peerSeat.get(old) === rec.seat) {
      // 같은 기기의 다른 탭·옛 기기 → 옮겨짐
      this.peerSeat.delete(old);
      this.markMoved(old);
      this.send(old, { t: 'moved' });
    }
    const wasOnline = this.isOnline(rec);
    rec.peerId = peerId;
    this.peerSeat.set(peerId, rec.seat);
    this.send(peerId, {
      t: 'admitted',
      seat: rec.seat,
      pid: rec.pid,
      companyName: rec.companyName,
      mode,
      lastSeq: rec.lastSeq,
      nameStatus: rec.nameStatus,
    });
    if (h && h.appVersion && h.appVersion !== this.o.appVersion) {
      this.send(peerId, { t: 'version.mismatch', hostVersion: this.o.appVersion });
    }
    if (rec.nameStatus === 'blocked') this.send(peerId, { t: 'name.blocked', reason: 'teacher' });
    this.sendFullPublic(peerId);
    this.sendMe(rec.seat);
    if (!wasOnline || old !== peerId) this.reduce({ type: 'presence', seat: rec.seat, online: true });
    this.saveThrottle.request();
    this.emitView();
  }

  // ── 학생 메시지 ──

  private handlePeerMessage(peerId: string, msg: JsonObject) {
    if (this.status === 'closed' || this.status === 'replaced') return;
    switch (msgType(msg)) {
      case 'hello':
        return this.handleHello(peerId, msg, true);
      case 'act':
        return this.handleAct(peerId, msg);
      case 'rejoin.request': {
        const g = this.guests.get(peerId);
        if (g && g.pendingSeat === null) this.handleHello(peerId, g.hello, true);
        else if (g) this.send(peerId, { t: 'rejoin.pending' });
        return;
      }
      case 'name.set':
        return this.handleNameSet(peerId, msg);
      case 'sync': {
        const seat = this.peerSeat.get(peerId);
        if (seat !== undefined) {
          this.sendFullPublic(peerId);
          this.sendMe(seat);
        } else if (this.guests.get(peerId)?.pendingSeat != null) this.send(peerId, { t: 'rejoin.pending' });
        else if (!this.guests.has(peerId) && !this.movedPeers.has(peerId)) this.send(peerId, { t: 'hello.again' });
        return;
      }
      case 'state.need':
        if (this.peerSeat.has(peerId)) this.sendFullPublic(peerId);
        return;
      default:
        return;
    }
  }

  private handleAct(peerId: string, msg: JsonObject) {
    const seq = msg.seq;
    if (typeof seq !== 'number' || !Number.isInteger(seq) || seq <= 0) return;
    const seat = this.peerSeat.get(peerId);
    if (seat === undefined) {
      if (this.movedPeers.has(peerId)) this.send(peerId, { t: 'ack', seq, ok: false, error: 'MOVED', version: 0 });
      else if (this.guests.has(peerId)) this.send(peerId, { t: 'ack', seq, ok: false, error: 'NOT_SEATED', version: 0 });
      else this.send(peerId, { t: 'hello.again' }); // 호스트 새로 고침 직후 등 — 다시 인사하면 같은 기기로 들어옴
      return;
    }
    const rec = this.data.seats[seatKey(seat)] as SeatRecord;
    if (seq <= rec.lastSeq) {
      const cached = rec.acks.find((a) => a.seq === seq);
      this.send(peerId, { t: 'ack', ...(cached ?? { seq, ok: true, version: rec.meVersion }) });
      return;
    }
    rec.lastSeq = seq;
    const outputs = this.reduce({ type: 'act', seat, seq, action: msg.action });
    const a = outputs?.find((x): x is Extract<SessionOutput, { type: 'ack' }> => x.type === 'ack' && x.seat === seat && x.seq === seq);
    const ack: AckRecord = {
      seq,
      ok: outputs === null ? false : (a?.ok ?? true),
      ...(outputs === null ? { error: 'ERROR' } : a?.error ? { error: a.error } : {}),
      version: rec.meVersion,
    };
    rec.acks.push(ack);
    if (rec.acks.length > ACK_CACHE_SIZE) rec.acks.splice(0, rec.acks.length - ACK_CACHE_SIZE);
    this.send(peerId, { t: 'ack', ...ack });
  }

  private handleNameSet(peerId: string, msg: JsonObject) {
    const seat = this.peerSeat.get(peerId);
    if (seat === undefined) return;
    const rec = this.data.seats[seatKey(seat)] as SeatRecord;
    const phase = this.game ? this.phaseOf(this.game) : undefined;
    if (!(phase === 'prep' || rec.nameStatus === 'blocked')) {
      this.send(peerId, { t: 'name.result', ok: false, error: 'NAME_LOCKED' });
      return;
    }
    const v = validateCompanyName(typeof msg.companyName === 'string' ? msg.companyName : '', {
      takenKeys: this.takenKeys(seat),
      bannedKeys: this.data.bannedNameKeys,
      extraWords: this.o.extraBannedWords?.() ?? [],
    });
    if (!v.ok) {
      if (v.error === 'BAD_NAME') this.data.badNameRejects++;
      this.send(peerId, { t: 'name.result', ok: false, error: v.error, ...(v.suggestions ? { suggestions: v.suggestions } : {}) });
      this.emitView();
      return;
    }
    rec.companyName = v.name;
    rec.nameKey = v.key;
    rec.nameStatus = v.realNameHint ? 'checkRealName' : 'ok';
    this.reduce({ type: 'act', seat, seq: 0, action: { type: 'setCompanyName', name: v.name, nameKey: v.key, nameStatus: rec.nameStatus } });
    this.send(peerId, { t: 'name.result', ok: true, companyName: v.name });
    this.publicThrottle.request();
    this.saveThrottle.request();
    this.emitView();
  }

  // ── 리듀서 호출·출력 라우팅 ──

  /** 리듀서 호출. 오류면 상태를 바꾸지 않고 null */
  private reduce(input: SessionInput): SessionOutput[] | null {
    if (this.game === null) return [];
    let res: { snapshot: G; outputs: SessionOutput[] };
    try {
      res = this.o.reducer(this.game, input, this.now());
    } catch (e) {
      // 오류 문구에 출석번호·회사 이름이 섞일 수 있어 종류 이름만 찍는다
      console.error('[sync] 리듀서 오류(입력 종류:', input.type, ')', e instanceof Error ? e.name : typeof e);
      return null;
    }
    this.game = res.snapshot;
    for (const out of res.outputs ?? []) {
      if (out.type === 'public') this.publicThrottle.request();
      else if (out.type === 'me') this.sendMe(out.seat, out.data);
      else if (out.type === 'teacher') this.teacherData = out.data;
    }
    if (input.type !== 'tick' || (res.outputs ?? []).length) {
      this.checkEnded();
      this.saveThrottle.request();
      if (input.type !== 'tick' || res.outputs.some((x) => x.type === 'teacher')) this.emitView();
    }
    return res.outputs ?? [];
  }

  private checkEnded() {
    if (this.endedAt !== null || !this.game) return;
    if (this.phaseOf(this.game) === 'ended') {
      this.endedAt = this.now();
      this.out.all({ t: 'host.ending' });
    }
  }

  private send(peerId: string, msg: HostToPeer) {
    this.out.to(peerId, msg);
  }

  private sendMe(seat: number, data?: JsonObject) {
    const rec = this.data.seats[seatKey(seat)];
    if (!rec || !rec.peerId || !this.game) return;
    const me = data ?? this.o.views.me(this.game, seat);
    rec.meVersion++;
    this.send(rec.peerId, { t: 'state.me', version: rec.meVersion, seq: rec.lastSeq, data: me });
  }

  private currentPublic(): JsonObject | null {
    if (!this.game) return null;
    const data = this.o.views.public(this.game);
    return assertNoSeatInPublic(data, this.strict) ? data : stripSeatKeys(data);
  }

  /** 1초 묶음으로 불림: 바뀌었으면 방 전체에 1번(가능하면 변경분) */
  private flushPublic() {
    if (!this.code || this.status === 'closed' || this.status === 'replaced') return;
    const data = this.currentPublic();
    if (!data) return;
    const json = JSON.stringify(data);
    if (json === this.lastPublicJson) return;
    const prev = this.lastPublic;
    const version = ++this.data.publicVersion;
    const patch = prev ? diffPublic(prev, data) : null;
    if (patch && JSON.stringify(patch).length < json.length) {
      this.out.all({ t: 'state.public', version, base: version - 1, patch });
    } else this.out.all({ t: 'state.public', version, data });
    this.lastPublic = data;
    this.lastPublicJson = json;
    if (this.screen && this.game) this.screen.publishToScreen(data, this.o.views.screen?.(this.game) ?? null);
  }

  /** 한 학생에게 마지막으로 보낸 공개 상태 전체(그 뒤 변경분은 묶음으로 따라감) */
  private sendFullPublic(peerId: string) {
    if (!this.lastPublic) this.publicThrottle.request();
    if (this.lastPublic) {
      this.send(peerId, { t: 'state.public', version: this.data.publicVersion, data: this.lastPublic });
    }
    this.publicThrottle.request();
  }

  // ── 저장 ──

  private record(): StoredHost<G> {
    return {
      v: 3,
      kind: 'voyage-host',
      code: this.code as string,
      hostToken: this.hostToken as string,
      savedAt: this.now(),
      endedAt: this.endedAt,
      session: this.data,
      game: this.game as G,
    };
  }

  private saveNow() {
    if (!this.code || !this.hostToken || this.game === null || this.status === 'replaced') return;
    const r = this.o.store.save(this.record() as StoredHost);
    const err = r.ok ? null : (r.error ?? 'QUOTA');
    if (err !== this.storageError) {
      this.storageError = err;
      if (err) console.warn('[sync] 판 저장 실패', err);
      this.emitView();
    }
  }

  flushSave(): void {
    this.saveThrottle.flush();
  }

  // ── 틱 ──

  private startTicking() {
    if (!this.timers || this.tickTimer !== null) return;
    const loop = () => {
      this.tickTimer = this.timers!.setTimeout(() => {
        this.tickTimer = null;
        this.tick();
        if (this.status !== 'closed' && this.status !== 'replaced') loop();
      }, this.tickMs);
    };
    loop();
  }

  private stopTicking() {
    if (this.tickTimer !== null && this.timers) this.timers.clearTimeout(this.tickTimer);
    this.tickTimer = null;
  }

  tick(): void {
    if (this.status === 'closed' || this.status === 'replaced' || this.game === null) return;
    // 호스트 연결이 끊긴 동안은 게임 시계를 멈춘다(오케스트레이터 결정 — 다시 붙으면 hostGap)
    if (this.disconnectedAt !== null || this.status !== 'open') return;
    this.reduce({ type: 'tick' });
    if (this.code && this.endedAt === null) this.o.store.saveTick?.(this.code, this.now());
    this.publicThrottle.poll();
    this.saveThrottle.poll();
  }

  // ── 교사 행동 ──

  dispatchTeacher(action: TeacherActionLike): void {
    this.reduce({ type: 'teacher', action });
  }

  setLocked(locked: boolean): void {
    // 서버 잠금(setLocked)은 쓰지 않는다: 서버는 잠긴 방의 모든 join을 막아 재접속까지 막히기 때문(PRD: 재접속은 허용)
    this.data.locked = locked;
    this.reduce({ type: 'teacher', action: { type: locked ? 'lockJoin' : 'unlockJoin' } });
    this.saveThrottle.request();
    this.emitView();
  }

  kick(seat: number): boolean {
    const rec = this.data.seats[seatKey(seat)];
    if (!rec) return false;
    if (!this.data.kickedTokens.includes(rec.deviceToken)) this.data.kickedTokens.push(rec.deviceToken);
    if (rec.peerId) {
      this.send(rec.peerId, { t: 'kicked' });
      this.out.kick(rec.peerId);
      this.peerSeat.delete(rec.peerId);
    }
    for (const [id, g] of this.guests) {
      if (g.pendingSeat === seat) {
        g.pendingSeat = null;
        this.send(id, { t: 'rejoin.denied' });
      }
    }
    delete this.data.seats[seatKey(seat)];
    this.data.joinProblems = this.data.joinProblems.filter((p) => p.seat !== seat);
    this.reduce({ type: 'teacher', action: { type: 'kick', seat } });
    this.publicThrottle.request();
    this.saveThrottle.request();
    this.emitView();
    return true;
  }

  approveRejoin(seat: number): boolean {
    const rec = this.data.seats[seatKey(seat)];
    let pick: [string, Guest] | null = null;
    for (const e of this.guests) if (e[1].pendingSeat === seat && (!pick || e[1].at > pick[1].at)) pick = e;
    if (!rec || !pick) return false;
    const [peerId, g] = pick;
    // 다른 요청은 거절
    for (const [id, other] of this.guests) {
      if (id !== peerId && other.pendingSeat === seat) {
        other.pendingSeat = null;
        this.send(id, { t: 'rejoin.denied' });
      }
    }
    this.moveOldDevice(rec);
    rec.deviceToken = g.hello.deviceToken;
    this.reduce({ type: 'teacher', action: { type: 'approveRejoin', seat } });
    this.admitTo(peerId, rec, 'approved', g.hello, true);
    return true;
  }

  denyRejoin(seat: number): boolean {
    let any = false;
    for (const [id, g] of this.guests) {
      if (g.pendingSeat === seat) {
        g.pendingSeat = null;
        this.send(id, { t: 'rejoin.denied' });
        any = true;
      }
    }
    this.emitView();
    return any;
  }

  /** 옛 기기 연결을 좌석에서 떼고 '옮겨짐'을 알림 */
  private moveOldDevice(rec: SeatRecord) {
    const old = rec.peerId;
    if (old) {
      if (this.peerSeat.get(old) === rec.seat) {
        this.peerSeat.delete(old);
        this.markMoved(old);
        this.send(old, { t: 'moved' });
      }
      rec.peerId = null;
    }
  }

  renameCompany(seat: number, newName: string): RenameResult {
    const rec = this.data.seats[seatKey(seat)];
    if (!rec) return { ok: false, error: 'NO_SEAT' };
    // 교사 권한: 길이·형식·중복은 검사, 금칙어는 경고만(PRD 6.1.1)
    const v = validateCompanyName(newName, { takenKeys: this.takenKeys(seat), skipBadWords: true });
    if (!v.ok) return { ok: false, error: v.error };
    const warning = hasBadWord(v.name, this.o.extraBannedWords?.() ?? []) ? ('BAD_NAME' as const) : undefined;
    rec.companyName = v.name;
    rec.nameKey = v.key;
    rec.nameStatus = 'ok';
    if (rec.peerId) this.send(rec.peerId, { t: 'name.changed', companyName: v.name });
    this.reduce({ type: 'teacher', action: { type: 'renameCompany', seat, name: v.name, nameKey: v.key } });
    this.publicThrottle.request();
    this.saveThrottle.request();
    this.emitView();
    return warning ? { ok: true, companyName: v.name, warning } : { ok: true, companyName: v.name };
  }

  blockCompanyName(seat: number): boolean {
    const rec = this.data.seats[seatKey(seat)];
    if (!rec) return false;
    if (!this.data.bannedNameKeys.includes(rec.nameKey)) this.data.bannedNameKeys.push(rec.nameKey);
    rec.nameStatus = 'blocked';
    if (rec.peerId) this.send(rec.peerId, { t: 'name.blocked', reason: 'teacher' });
    this.reduce({ type: 'teacher', action: { type: 'blockCompanyName', seat } });
    this.publicThrottle.request();
    this.saveThrottle.request();
    this.emitView();
    return true;
  }

  reassignSeat(fromSeat: number, toSeat: number): boolean {
    const rec = this.data.seats[seatKey(fromSeat)];
    if (!rec || fromSeat === toSeat) return false;
    if (!Number.isInteger(toSeat) || toSeat < MIN_SEAT || toSeat > MAX_SEAT) return false;
    if (this.data.seats[seatKey(toSeat)]) return false;
    delete this.data.seats[seatKey(fromSeat)];
    rec.seat = toSeat;
    this.data.seats[seatKey(toSeat)] = rec;
    if (rec.peerId && this.peerSeat.get(rec.peerId) === fromSeat) this.peerSeat.set(rec.peerId, toSeat);
    for (const g of this.guests.values()) if (g.pendingSeat === fromSeat) g.pendingSeat = toSeat;
    for (const p of this.data.joinProblems) if (p.seat === fromSeat) p.seat = toSeat;
    this.reduce({ type: 'teacher', action: { type: 'reassignSeat', from: fromSeat, to: toSeat } });
    if (rec.peerId) {
      this.send(rec.peerId, { t: 'seat.changed', seat: toSeat });
      this.sendMe(toSeat);
    }
    this.saveThrottle.request();
    this.emitView();
    return true;
  }

  bindDeviceToSeat(peerId: string, seat: number): boolean {
    const rec = this.data.seats[seatKey(seat)];
    if (!rec) return false;
    const prob = this.data.joinProblems.find((p) => p.peerId === peerId);
    const guest = this.guests.get(peerId);
    const token = prob?.deviceToken ?? guest?.hello.deviceToken;
    if (!token) return false;
    const other = this.findSeatByToken(token);
    if (other && other.seat !== seat) return false; // 이미 다른 회사에 묶인 기기
    this.moveOldDevice(rec);
    rec.deviceToken = token;
    this.data.joinProblems = this.data.joinProblems.filter((p) => p.deviceToken !== token);
    this.reduce({ type: 'teacher', action: { type: 'bindDeviceToSeat', seat } });
    // 손님 연결로 남아 있으면 바로 들여보냄, 아니면 학생이 [다시 들어가기]를 누르면 ②로 들어옴
    if (guest) this.admitTo(peerId, rec, 'approved', guest.hello, true);
    this.saveThrottle.request();
    this.emitView();
    return true;
  }

  // ── 끝내기 ──

  async close(): Promise<void> {
    if (this.status === 'closed') return;
    this.closing = true;
    if (this.endedAt === null) this.endedAt = this.now();
    this.publicThrottle.flush();
    this.out.all({ t: 'host.ending' });
    this.out.flushNow();
    this.saveNow();
    this.stopTicking();
    this.screen?.closed();
    await this.t.closeRoom();
    this.status = 'closed';
    this.closing = false;
    this.emitView();
  }

  dispose(): void {
    this.stopTicking();
    this.out.dispose();
    this.publicThrottle.cancel();
    this.saveThrottle.flush();
    this.saveThrottle.cancel();
    for (const u of this.unsubs.splice(0)) u();
    this.screen?.dispose();
    this.screen = null;
  }

  // ── 파일 ──

  exportMoveFile(): string {
    this.saveThrottle.flush();
    return makeMoveFile(this.record() as StoredHost, this.now());
  }

  exportResult(meta: { className?: string } = {}): ResultFiles | null {
    if (!this.o.resultTable || this.game === null) return null;
    const table = this.o.resultTable(this.game);
    const nameOf = (seat: number) => this.data.seats[seatKey(seat)]?.companyName ?? '';
    return buildResultFiles(table, nameOf, { ...meta, date: localDate(this.now()) });
  }

  // ── 교사 화면 ──

  subscribe(cb: (v: HostView<G>) => void): Unsub {
    const u = this.viewL.add(cb);
    cb(this.getView());
    return u;
  }

  getView(): HostView<G> {
    const seats = Object.values(this.data.seats)
      .sort((a, b) => a.seat - b.seat)
      .map((s) => ({
        seat: s.seat,
        pid: s.pid,
        companyName: s.companyName,
        nameStatus: s.nameStatus,
        online: this.isOnline(s),
        joinedAt: s.joinedAt,
      }));
    const rejoinRequests: RejoinRequestView[] = [];
    for (const [peerId, g] of this.guests) {
      if (g.pendingSeat === null) continue;
      const rec = this.data.seats[seatKey(g.pendingSeat)];
      if (!rec) continue;
      rejoinRequests.push({ seat: g.pendingSeat, companyName: rec.companyName, oldOnline: this.isOnline(rec), at: g.at, peerId });
    }
    return {
      status: this.status,
      connection: this.t.getStatus(),
      code: this.code,
      codeChanged: this.codeChanged,
      locked: this.data.locked,
      ended: this.endedAt !== null,
      seats,
      rejoinRequests,
      joinProblems: this.data.joinProblems.map(({ seat, attempts, lastAt, peerId }) => ({ seat, attempts, lastAt, peerId })),
      badNameRejects: this.data.badNameRejects,
      teacher: this.teacherData,
      storageError: this.storageError,
      disconnectedAt: this.disconnectedAt,
      game: this.game,
    };
  }

  private emitView() {
    this.viewL.emit(this.getView());
  }

  shouldWarnBeforeUnload(): boolean {
    return (this.status === 'open' || this.status === 'reconnecting' || this.status === 'offline') && this.endedAt === null;
  }

  installBeforeUnload(target?: Pick<Window, 'addEventListener' | 'removeEventListener'>): () => void {
    const w = target ?? (typeof window !== 'undefined' ? window : null);
    if (!w) return () => undefined;
    const onBefore = (e: BeforeUnloadEvent) => {
      this.flushSave();
      if (!this.shouldWarnBeforeUnload()) return undefined;
      e.preventDefault();
      e.returnValue = BEFORE_UNLOAD_MESSAGE;
      return BEFORE_UNLOAD_MESSAGE;
    };
    const onHide = () => this.flushSave();
    w.addEventListener('beforeunload', onBefore as EventListener);
    w.addEventListener('pagehide', onHide);
    return () => {
      w.removeEventListener('beforeunload', onBefore as EventListener);
      w.removeEventListener('pagehide', onHide);
    };
  }
}

export function createHostSession<G>(opts: HostSessionOptions<G>): HostSession<G> {
  return new HostSessionImpl<G>(opts);
}
