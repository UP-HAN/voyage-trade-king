/**
 * 전송 계층 인터페이스 (PRD 10.4, v0.3.1) + 어댑터 공용 바탕 클래스.
 *
 * 어댑터는 방 만들기·입장·메시지 전달만 한다. 좌석·재접속·상태 동기화는 세션 계층(작업 124)이 한다.
 * 어댑터는 연결이 끊겼다 다시 붙어도 **스스로 방에 다시 들어가지 않는다** — 상태가 'online'으로 돌아오면
 * 세션 계층이 `resumeRoom`(호스트) / `join`(학생)을 다시 부른다(새 연결이므로 학생의 peerId도 새로 나온다).
 *
 * 메시지 내용은 `object`로만 다루고 게임(`src/core`)을 모른다.
 */
import {
  PROTOCOL_VERSION,
  parseServerMessage,
  type ActiveNotice,
  type ClientMessage,
  type ErrorCode,
  type JsonObject,
  type RoomCloseReason,
  type ServerMessage,
} from '@shared/protocol';

export type Unsub = () => void;
export type TransportKind = 'memory' | 'local' | 'relay';
/** 연결 상태 */
export type ConnectionStatus = 'online' | 'reconnecting' | 'offline';
export type { JsonObject, ActiveNotice };

/** 학생 입장 인사(PRD 10.4 — v0.3.1: name → company). 어댑터는 내용을 해석하지 않는다 */
export interface PeerHello extends JsonObject {
  seat?: number;
  company?: string;
  deviceToken?: string;
  appVersion?: string;
}

export interface OpenRoomOptions {
  maxPeers: number;
  /** 서버 재시작 뒤 같은 코드로 다시 열기(hostToken과 함께) */
  wantCode?: string;
  hostToken?: string;
}
export interface OpenedRoom {
  code: string;
  hostToken: string;
}
/**
 * 어댑터 쪽 결과 값: `OFFLINE` = 서버와 연결되어 있지 않거나 응답 전에 끊김,
 * `TIMEOUT` = `REQUEST_TIMEOUT_MS` 안에 응답이 없음(예: 속도 제한 오류 응답마저 제한된 경우).
 */
export type TransportFailure = 'OFFLINE' | 'TIMEOUT';
export type OpenRoomError = 'BUSY' | 'ROOM_LIMIT' | 'MAINTENANCE' | 'RATE_LIMITED' | 'BAD_MESSAGE' | TransportFailure;
export type OpenRoomResult = OpenedRoom | OpenRoomError;
export type ResumeRoomResult = 'ok' | 'NO_ROOM' | 'RATE_LIMITED' | 'BAD_MESSAGE' | TransportFailure;
export type JoinResult =
  | 'pending'
  | 'NO_ROOM'
  | 'LOCKED'
  | 'FULL'
  | 'HOST_OFFLINE'
  | 'RATE_LIMITED'
  | 'BUSY'
  | 'MAINTENANCE'
  | 'BAD_MESSAGE'
  | TransportFailure;

/** 학생 쪽 방 사건(입장 결과·내보내기·방 닫힘) */
export type PeerRoomEvent =
  | { type: 'admitted'; peerId: string }
  | { type: 'rejected'; reason: string }
  | { type: 'kicked' }
  | { type: 'closed'; reason: RoomCloseReason };

/** 마지막 요청 실패 정보 — `errorToKorean(code, {rooms, maxRooms, text})`에 그대로 넘기면 됨 */
export interface LastError {
  code: string;
  req?: string;
  rooms?: number;
  maxRooms?: number;
  text?: string;
}

/** 응답을 기다리는 요청의 시간 제한(ms) */
export const REQUEST_TIMEOUT_MS = 10_000;

/** 서버 현황(교사 화면 "사용 중인 방 n/50") */
export interface ServerStatsInfo {
  rooms: number;
  maxRooms: number;
}

/** 호스트(교사 브라우저)용 */
export interface HostTransport {
  readonly kind: TransportKind;
  openRoom(opts: OpenRoomOptions): Promise<OpenRoomResult>;
  /** 새로 고침 뒤 다시 붙기. 성공하면 `connectedPeers()`가 지금 입장해 있는 학생으로 채워지고, 기다리던 입장 요청은 onPeerHello로 다시 온다 */
  resumeRoom(code: string, hostToken: string): Promise<ResumeRoomResult>;
  closeRoom(): Promise<void>;
  /** 서버도 새 입장 요청을 막음 */
  setLocked(locked: boolean): void;
  admit(peerId: string): void;
  reject(peerId: string, reason: string): void;
  kick(peerId: string): void;
  sendTo(peerId: string, msg: object): void;
  /** 서버가 방 전원(입장한 학생)에게 나눠 줌 — 호스트 업로드 1번 */
  broadcast(msg: object): void;
  onPeerHello(cb: (peerId: string, hello: PeerHello) => void): Unsub;
  onPeerMessage(cb: (peerId: string, msg: JsonObject) => void): Unsub;
  onPeerLeave(cb: (peerId: string) => void): Unsub;
  onStatus(cb: (s: ConnectionStatus) => void): Unsub;
  /** (104 확장) 서버 공지 — v0.3.1 */
  onNotice(cb: (n: ActiveNotice | null) => void): Unsub;
  /** (104 확장) 방이 서버에서 사라짐(교사가 닫음·무활동·빈 방 등) */
  onRoomClosed(cb: (reason: RoomCloseReason) => void): Unsub;
  serverNow(): number;
  /** (104 확장) 지금 열린 방 코드(없으면 null) */
  roomCode(): string | null;
  /** (104 확장) 지금 입장(admit)해 있는 학생 peerId 목록 */
  connectedPeers(): string[];
  /** (104 확장) 지금 연결 상태 */
  getStatus(): ConnectionStatus;
  /** (104 확장) 서버 현황 조회 — 역할이 없어도 됨. 연결이 없거나 응답이 없으면 null */
  queryStats(): Promise<ServerStatsInfo | null>;
  /** (104 확장) 마지막으로 실패한 요청의 오류(코드 + 서버 문구). openRoom이 'MAINTENANCE'면 text에 점검 문구 */
  lastError(): LastError | null;
}

/** 학생 기기·공용 화면(원격)용 */
export interface PeerTransport {
  readonly kind: TransportKind;
  /** 'pending'이면 호스트 판정을 기다림 → 결과는 onRoomEvent */
  join(code: string, hello: PeerHello): Promise<JoinResult>;
  onNotice(cb: (n: ActiveNotice | null) => void): Unsub;
  /** 호스트에게만 감(입장 허락 뒤에만) */
  send(msg: object): void;
  /** 호스트가 보낸 메시지(개인 `host.to` + 전체 `host.all`) */
  onMessage(cb: (msg: JsonObject) => void): Unsub;
  /** (104 확장) 입장 결과·내보내기·방 닫힘 — PRD의 "onMessage로 admit/reject/kick"을 따로 뺐다 */
  onRoomEvent(cb: (e: PeerRoomEvent) => void): Unsub;
  /** 호스트 끊김 알림(서버가 보냄) */
  onHostStatus(cb: (online: boolean) => void): Unsub;
  onStatus(cb: (s: ConnectionStatus) => void): Unsub;
  serverNow(): number;
  leave(): void;
  getStatus(): ConnectionStatus;
  queryStats(): Promise<ServerStatsInfo | null>;
  lastError(): LastError | null;
}

// ───────────────────────────── 공용 구현 ─────────────────────────────

/** 구독 목록 */
export class Listeners<A extends unknown[]> {
  private readonly list = new Set<(...a: A) => void>();
  add(cb: (...a: A) => void): Unsub {
    this.list.add(cb);
    return () => {
      this.list.delete(cb);
    };
  }
  emit(...a: A): void {
    for (const cb of [...this.list]) {
      try {
        cb(...a);
      } catch (e) {
        console.error('[sync] 구독 함수 오류', e);
      }
    }
  }
}

/** 응답 메시지, 또는 어댑터 쪽 실패 */
export type RequestOutcome = ServerMessage | TransportFailure;
type Waiter = (m: RequestOutcome) => void;
/** 응답을 기다리는 요청 하나(요청 id `rid`로 응답을 짝짓는다 — 작업 105) */
interface Pending {
  rid: string;
  w: Waiter;
}

/**
 * 메시지 문자열을 주고받는 연결 하나 위의 공용 클라이언트 동작.
 * 하위 클래스는 `sendRaw`, `closeWire`만 구현하고, 받은 문자열을 `receive`, 연결 사건을 `connectionOpened`/`connectionLost`로 넘긴다.
 * (작업 105의 RelayAdapter도 이 클래스를 그대로 쓸 수 있다.)
 */
export abstract class ClientBase {
  abstract readonly kind: TransportKind;
  protected status: ConnectionStatus = 'offline';
  private offset = 0;
  private readonly waiters = new Map<string, Pending[]>();
  private ridSeq = 0;
  private notice: ActiveNotice | null = null;
  private lastErr: LastError | null = null;
  /** 요청 시간 제한(ms). 테스트에서 줄일 수 있다 */
  requestTimeoutMs = REQUEST_TIMEOUT_MS;
  protected readonly statusL = new Listeners<[ConnectionStatus]>();
  protected readonly noticeL = new Listeners<[ActiveNotice | null]>();

  constructor(protected readonly clock: () => number = () => Date.now()) {}

  /** 연결로 문자열을 보낸다(연결이 없으면 버림) */
  protected abstract sendRaw(data: string): void;
  /** 연결을 영구히 닫는다(leave) */
  protected abstract closeWire(): void;
  /** 메시지 하나 처리(공용 처리 뒤) */
  protected abstract handle(m: ServerMessage): void;
  /** 연결이 끊겼을 때 방 상태 초기화 */
  protected abstract resetRoom(): void;

  getStatus(): ConnectionStatus {
    return this.status;
  }
  onStatus(cb: (s: ConnectionStatus) => void): Unsub {
    return this.statusL.add(cb);
  }
  onNotice(cb: (n: ActiveNotice | null) => void): Unsub {
    return this.noticeL.add(cb);
  }
  /** 마지막으로 받은 공지 */
  currentNotice(): ActiveNotice | null {
    return this.notice;
  }
  lastError(): LastError | null {
    return this.lastErr;
  }
  serverNow(): number {
    return this.clock() + this.offset;
  }

  protected setStatus(s: ConnectionStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.statusL.emit(s);
  }

  /** 하위 클래스: 연결됨 */
  connectionOpened(): void {
    this.setStatus('online');
    this.syncClock();
  }

  /** 하위 클래스: 연결 끊김. reconnecting이면 다시 붙는 중 */
  connectionLost(reconnecting: boolean): void {
    for (const [, list] of this.waiters) for (const p of list.splice(0)) p.w('OFFLINE');
    this.resetRoom();
    this.setStatus(reconnecting ? 'reconnecting' : 'offline');
  }

  /** ping으로 서버 시각 차이를 잰다(왕복의 절반 보정) */
  syncClock(): void {
    this.post({ v: PROTOCOL_VERSION, t: 'ping', at: this.clock() });
  }

  protected post(m: ClientMessage): void {
    if (this.status !== 'online') return;
    this.sendRaw(JSON.stringify(m));
  }

  /**
   * 응답을 기다리는 요청. 응답 메시지(또는 오류)·연결 끊김('OFFLINE')·시간 초과('TIMEOUT')를 map으로 바꾼다.
   * 모든 요청은 `requestTimeoutMs` 안에 반드시 끝난다.
   */
  protected request<T>(m: ClientMessage, map: (r: RequestOutcome) => T): Promise<T> {
    if (this.status !== 'online') return Promise.resolve(map('OFFLINE'));
    return new Promise<T>((resolve) => {
      const list = this.waiters.get(m.t) ?? [];
      let done = false;
      // 요청 id: 서버가 응답에 그대로 돌려준다. 시간이 지나 늦게 온 응답은 다른 요청에 붙지 않는다
      const rid = `r${(++this.ridSeq).toString(36)}`;
      const timer = setTimeout(() => {
        const cur = this.waiters.get(m.t);
        const i = cur ? cur.indexOf(entry) : -1;
        if (cur && i >= 0) cur.splice(i, 1);
        waiter('TIMEOUT');
      }, this.requestTimeoutMs);
      const waiter: Waiter = (r) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (typeof r === 'string') this.lastErr = { code: r, req: m.t };
        else if (r.t === 'error') {
          this.lastErr = {
            code: r.code,
            req: m.t,
            ...(r.rooms !== undefined ? { rooms: r.rooms } : {}),
            ...(r.maxRooms !== undefined ? { maxRooms: r.maxRooms } : {}),
            ...(r.text !== undefined ? { text: r.text } : {}),
          };
        }
        resolve(map(r));
      };
      const entry: Pending = { rid, w: waiter };
      list.push(entry);
      this.waiters.set(m.t, list);
      this.post({ ...m, rid });
    });
  }

  /**
   * 응답을 대기에 넘긴다. 응답에 요청 id(`rid`)가 있으면 그 요청에만(없는 id = 이미 끝난 요청의 늦은 응답 → false),
   * 없으면(요청 id를 모르는 서버) 요청 종류 req의 가장 오래된 대기에.
   */
  protected settle(req: string, m: ServerMessage): boolean {
    const list = this.waiters.get(req);
    if (!list) return false;
    let i = 0;
    if (m.rid !== undefined) {
      i = list.findIndex((p) => p.rid === m.rid);
      if (i < 0) return false;
    } else if (!list.length) return false;
    const [p] = list.splice(i, 1);
    p!.w(m);
    return true;
  }

  /** 이 응답이 이미 끝난(시간 초과·끊김) 요청의 늦은 응답인가 — 요청 id가 있고 기다리는 요청이 없을 때 */
  protected isStale(req: string, m: ServerMessage): boolean {
    if (m.rid === undefined) return false;
    return !(this.waiters.get(req) ?? []).some((p) => p.rid === m.rid);
  }

  queryStats(): Promise<ServerStatsInfo | null> {
    return this.request({ v: PROTOCOL_VERSION, t: 'server.stats' }, (r) =>
      typeof r !== 'string' && r.t === 'server.stats' ? { rooms: r.rooms, maxRooms: r.maxRooms } : null,
    );
  }

  /** 하위 클래스: 연결에서 받은 문자열 */
  receive(data: string): void {
    const p = parseServerMessage(data);
    if (!p.ok) {
      console.warn('[sync] 알 수 없는 서버 메시지', p.code, p.t);
      return;
    }
    const m = p.msg;
    switch (m.t) {
      case 'pong': {
        const now = this.clock();
        this.offset = m.serverNow + (now - m.at) / 2 - now;
        return;
      }
      case 'server.notice': {
        this.notice = m.level ? { level: m.level, text: m.text ?? '', ...(m.until ? { until: m.until } : {}) } : null;
        this.noticeL.emit(this.notice);
        return;
      }
      case 'server.stats':
        this.settle('server.stats', m);
        return;
      case 'error':
        // 점검으로 거절됐는데 보이는 공지가 없으면(공지 시간 밖 blockNewRooms 등) 서버 문구로 공지를 대신 띄운다
        if (m.code === 'MAINTENANCE' && m.text && !this.notice) {
          this.notice = { level: 'maintenance', text: m.text };
          this.noticeL.emit(this.notice);
        }
        if (m.req && this.settle(m.req, m)) return;
        this.handle(m);
        return;
      default:
        this.handle(m);
    }
  }
}

const errCode = (r: RequestOutcome): ErrorCode | TransportFailure =>
  typeof r === 'string' ? r : r.t === 'error' ? r.code : 'BAD_MESSAGE';

/** 호스트 공용 구현 */
export abstract class HostBase extends ClientBase implements HostTransport {
  private code: string | null = null;
  private readonly peers = new Set<string>();
  private readonly helloL = new Listeners<[string, PeerHello]>();
  private readonly msgL = new Listeners<[string, JsonObject]>();
  private readonly leaveL = new Listeners<[string]>();
  private readonly closedL = new Listeners<[RoomCloseReason]>();

  roomCode(): string | null {
    return this.code;
  }
  connectedPeers(): string[] {
    return [...this.peers];
  }

  openRoom(opts: OpenRoomOptions): Promise<OpenRoomResult> {
    const msg: ClientMessage = {
      v: PROTOCOL_VERSION,
      t: 'host.open',
      maxPeers: opts.maxPeers,
      ...(opts.wantCode ? { wantCode: opts.wantCode } : {}),
      ...(opts.hostToken ? { hostToken: opts.hostToken } : {}),
    };
    return this.request<OpenRoomResult>(msg, (r) => {
      if (typeof r !== 'string' && r.t === 'room.opened') return { code: r.code, hostToken: r.hostToken };
      return errCode(r) as OpenRoomError;
    });
  }

  resumeRoom(code: string, hostToken: string): Promise<ResumeRoomResult> {
    // 늦게 온 resume 응답으로 이미 그 방에 붙어 있으면 그대로 성공(같은 연결로 다시 보내면 서버가 BAD_MESSAGE)
    if (this.code === code && this.status === 'online') return Promise.resolve('ok');
    return this.request<ResumeRoomResult>({ v: PROTOCOL_VERSION, t: 'host.resume', code, hostToken }, (r) => {
      if (typeof r !== 'string' && r.t === 'room.opened') return 'ok';
      return errCode(r) as ResumeRoomResult;
    });
  }

  closeRoom(): Promise<void> {
    if (!this.code) return Promise.resolve();
    return this.request<void>({ v: PROTOCOL_VERSION, t: 'host.close' }, () => undefined);
  }

  setLocked(locked: boolean): void {
    this.post({ v: PROTOCOL_VERSION, t: locked ? 'host.lock' : 'host.unlock' });
  }
  admit(peerId: string): void {
    this.peers.add(peerId);
    this.post({ v: PROTOCOL_VERSION, t: 'host.admit', peerId });
  }
  reject(peerId: string, reason: string): void {
    this.post({ v: PROTOCOL_VERSION, t: 'host.reject', peerId, reason });
  }
  kick(peerId: string): void {
    this.peers.delete(peerId);
    this.post({ v: PROTOCOL_VERSION, t: 'host.kick', peerId });
  }
  sendTo(peerId: string, msg: object): void {
    this.post({ v: PROTOCOL_VERSION, t: 'host.to', peerId, msg: msg as JsonObject });
  }
  broadcast(msg: object): void {
    this.post({ v: PROTOCOL_VERSION, t: 'host.all', msg: msg as JsonObject });
  }

  onPeerHello(cb: (peerId: string, hello: PeerHello) => void): Unsub {
    return this.helloL.add(cb);
  }
  onPeerMessage(cb: (peerId: string, msg: JsonObject) => void): Unsub {
    return this.msgL.add(cb);
  }
  onPeerLeave(cb: (peerId: string) => void): Unsub {
    return this.leaveL.add(cb);
  }
  onRoomClosed(cb: (reason: RoomCloseReason) => void): Unsub {
    return this.closedL.add(cb);
  }

  protected resetRoom(): void {
    this.code = null;
    this.peers.clear();
  }

  protected handle(m: ServerMessage): void {
    switch (m.t) {
      case 'room.opened':
        // 시간 초과로 이미 포기한 host.open의 늦은 응답: 아무도 모르는 방이 남지 않게 바로 닫는다(작업 105)
        if (!m.resumed && this.isStale('host.open', m)) {
          this.post({ v: PROTOCOL_VERSION, t: 'host.close' });
          return;
        }
        this.code = m.code;
        this.peers.clear();
        for (const p of m.peers ?? []) this.peers.add(p);
        this.settle(m.resumed ? 'host.resume' : 'host.open', m);
        return;
      case 'peer.hello':
        this.helloL.emit(m.peerId, m.hello as PeerHello);
        return;
      case 'peer.msg':
        this.msgL.emit(m.peerId, m.msg);
        return;
      case 'peer.left':
        this.peers.delete(m.peerId);
        this.leaveL.emit(m.peerId);
        return;
      case 'room.closed':
        this.code = null;
        this.peers.clear();
        this.settle('host.close', m);
        this.closedL.emit(m.reason);
        return;
      case 'error':
        console.warn('[sync] 서버 오류', m.code, m.req ?? '');
        return;
      default:
        return;
    }
  }
}

/** 학생 공용 구현 */
export abstract class PeerBase extends ClientBase implements PeerTransport {
  private peerId: string | null = null;
  private admitted = false;
  private readonly msgL = new Listeners<[JsonObject]>();
  private readonly roomL = new Listeners<[PeerRoomEvent]>();
  private readonly hostL = new Listeners<[boolean]>();

  /** 지금 peerId(입장 요청 뒤) */
  currentPeerId(): string | null {
    return this.peerId;
  }
  isAdmitted(): boolean {
    return this.admitted;
  }

  join(code: string, hello: PeerHello): Promise<JoinResult> {
    return this.request<JoinResult>({ v: PROTOCOL_VERSION, t: 'peer.join', code, hello }, (r) => {
      if (typeof r !== 'string' && r.t === 'peer.pending') return 'pending';
      return errCode(r) as JoinResult;
    });
  }
  send(msg: object): void {
    if (!this.admitted) return;
    this.post({ v: PROTOCOL_VERSION, t: 'peer.msg', msg: msg as JsonObject });
  }
  onMessage(cb: (msg: JsonObject) => void): Unsub {
    return this.msgL.add(cb);
  }
  onRoomEvent(cb: (e: PeerRoomEvent) => void): Unsub {
    return this.roomL.add(cb);
  }
  onHostStatus(cb: (online: boolean) => void): Unsub {
    return this.hostL.add(cb);
  }
  leave(): void {
    this.resetRoom();
    this.closeWire();
  }

  protected resetRoom(): void {
    this.peerId = null;
    this.admitted = false;
  }

  protected handle(m: ServerMessage): void {
    switch (m.t) {
      case 'peer.pending':
        this.peerId = m.peerId;
        this.admitted = false;
        this.settle('peer.join', m);
        return;
      case 'admitted':
        this.admitted = true;
        this.roomL.emit({ type: 'admitted', peerId: m.peerId });
        return;
      case 'rejected':
        this.resetRoom();
        this.roomL.emit({ type: 'rejected', reason: m.reason });
        return;
      case 'kicked':
        this.resetRoom();
        this.roomL.emit({ type: 'kicked' });
        return;
      case 'room.closed':
        this.resetRoom();
        this.roomL.emit({ type: 'closed', reason: m.reason });
        return;
      case 'host.status':
        this.hostL.emit(m.online);
        return;
      case 'host.to':
      case 'host.all':
        this.msgL.emit(m.msg);
        return;
      case 'error':
        console.warn('[sync] 서버 오류', m.code, m.req ?? '');
        return;
      default:
        return;
    }
  }
}
