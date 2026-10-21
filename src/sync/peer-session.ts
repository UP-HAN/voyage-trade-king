/**
 * 학생 세션 (작업 124, PRD 7.2~7.4·7.8 — v0.3.1).
 *
 * 학생 기기에서 돈다. 입장(방 코드 + 출석번호 + 회사 이름)·자동 재입장(기기 토큰)·다른 기기 허락 대기,
 * 행동 `{seq, action}`을 보내기 전에 주입된 `predict`로 바로 화면에 반영(낙관적 표시)하고 호스트 `ack`로 확정,
 * 거절되면 호스트가 보낸 개인 상태로 되돌림. 호스트가 없거나 다시 연결 중이면 행동을 최대 20개까지 기기에 모아 두었다가
 * 돌아오면 차례로 보낸다.
 *
 * `src/core`를 import하지 않는다(predict는 주입). 콘솔에 출석번호·회사 이름을 찍지 않는다.
 */
import type { JsonObject } from '@shared/protocol';
import type { ConnectionStatus, JoinResult, PeerRoomEvent, PeerTransport, Unsub } from './adapter';
import { Listeners } from './adapter';
import {
  appErrorToKorean,
  applyPublicPatch,
  decodeRejectReason,
  msgType,
  type AdmitMode,
  type NameStatus,
  type PeerToHost,
  type PublicPatch,
} from './app-messages';
import { validateCompanyName } from './company-name';
import type { PeerStore } from './peer-store';
import { realTimers, type Timers } from './throttle';

export type PeerStatus =
  | 'idle'
  | 'joining'
  | 'waitingApproval'
  | 'in'
  | 'hostOffline'
  | 'reconnecting'
  | 'kicked'
  | 'moved'
  | 'roomClosed'
  | 'codeChanged';

/** 호스트가 없을 때 기기에 모아 두는 행동 수 */
export const MAX_QUEUED_ACTIONS = 20;
/** 자동 재입장 재시도 간격(ms) */
export const REJOIN_BACKOFF_MS = [1000, 2000, 4000, 8000, 15000];
/**
 * 서버 재시작·방 없음(NO_ROOM)·호스트 없음(HOST_OFFLINE) 때 같은 코드로 다시 해 보는 간격(ms, 마지막 값 되풀이).
 * 그동안 상태는 'hostOffline'("선생님 화면을 기다리고 있어요"). 서버의 연결당 속도 제한(초당 20)과는 거리가 멀다.
 */
export const WAIT_HOST_BACKOFF_MS = [2000, 4000, 8000, 15000];
/**
 * 같은 코드 재시도를 그만두고 'codeChanged'로 가는 시간(첫 NO_ROOM부터).
 * 서버는 재시작 뒤 RESUME_GRACE(600초) 동안 같은 코드 재열기를 받고 그동안 NO_ROOM을 IP 실패로 세지 않으므로(105),
 * 그보다 조금 짧게 둔다(유예가 끝난 뒤 세어지는 시도를 줄임).
 */
export const NO_ROOM_GIVE_UP_MS = 540_000;

export interface PeerState<M, P> {
  status: PeerStatus;
  /** 오류 코드(앱·전송)와 사람 말 문구 */
  errorCode: string | null;
  error: string | null;
  /** NAME_TAKEN 때 제안 이름(버튼으로 보여 주고 학생이 눌러야 정해짐) */
  suggestions: string[];
  code: string | null;
  /** 본인 출석번호(본인 기기 설정 화면에만 작게) */
  seat: number | null;
  pid: string | null;
  companyName: string | null;
  nameStatus: NameStatus | null;
  admitMode: AdmitMode | null;
  /** 화면에 보일 내 회사 상태(호스트 확정 + 아직 확정 안 된 행동 미리 계산) */
  me: M | null;
  /** 학급 공개 상태 */
  public: P | null;
  publicVersion: number;
  /** 확정 기다리는 행동 수 / 그중 아직 못 보낸 수 */
  pendingCount: number;
  queuedCount: number;
  /** 호스트가 끊긴 시각(15초 넘으면 "선생님 화면을 기다리고 있어요" 띠 — 화면이 판단) */
  hostOfflineSince: number | null;
  /** (작업 145) 같은 코드 재시도를 시작한 시각(기기 시각, 새로 고침 전 것도 이어짐). 재시도 중이 아니면 null */
  waitSince: number | null;
  /** 앱 버전이 호스트와 다름 → "새로 고침해 주세요" */
  versionMismatch: boolean;
  /** 판이 끝남(보기 전용) */
  ended: boolean;
}

export type PeerEvent =
  | { type: 'rollback'; seq: number; error: string | null; message: string }
  | { type: 'queueFull'; message: string }
  | { type: 'nameResult'; ok: boolean; error?: string; message?: string; suggestions?: string[] }
  | { type: 'nameBlocked' };

export type ActResult = 'sent' | 'queued' | 'queueFull' | 'notIn';

export interface PeerSessionOptions<M, P, A> {
  transport: PeerTransport;
  /** 낙관적 표시용: (내 상태, 공개 상태, 행동) → 새 내 상태. 예외면 그 행동은 미리 보이지 않음 */
  predict: (myState: M, publicState: P | null, action: A) => M;
  store: PeerStore;
  appVersion: string;
  now?: () => number;
  timers?: Timers | null;
  /** 기기 토큰 대신 쓸 값(로컬 모드 `?as=` 탭 — `localDeviceToken()`) */
  deviceToken?: string | null;
  /** 다시 연결된 뒤 재입장까지 기다리는 시간(ms, 학생들이 한꺼번에 몰리지 않게 무작위 더함). 기본 300 + 0~1200 */
  rejoinDelayMs?: () => number;
}

export interface PeerSession<M, P, A> {
  /** 입장(학생이 입력). 회사 이름은 같은 규칙으로 미리 검사한다(최종 판정은 호스트) */
  join(code: string, seat: number, companyName: string): Promise<JoinResult | 'LOCAL_CHECK'>;
  /** 저장된 `{code, seat, companyName}` + 기기 토큰으로 자동 재입장. 저장값이 없으면 false */
  autoRejoin(): boolean;
  act(action: A): ActResult;
  /** 준비 단계 또는 이름이 막혔을 때 새 회사 이름 */
  setCompanyName(name: string): boolean;
  /** 거절된 뒤 다시 들어가기 요청 */
  requestRejoin(): void;
  leave(): void;
  getState(): PeerState<M, P>;
  subscribe(cb: (s: PeerState<M, P>) => void): Unsub;
  onRollback(cb: (message: string, error: string | null) => void): Unsub;
  onEvent(cb: (e: PeerEvent) => void): Unsub;
  dispose(): void;
}

interface Pending<A> {
  seq: number;
  action: A;
  sent: boolean;
}

const ACTIVE: readonly PeerStatus[] = ['in', 'hostOffline', 'reconnecting'];

class PeerSessionImpl<M, P, A> implements PeerSession<M, P, A> {
  private readonly t: PeerTransport;
  private readonly now: () => number;
  private readonly timers: Timers | null;
  private readonly token: string;
  private readonly rejoinDelay: () => number;

  private status: PeerStatus = 'idle';
  private errorCode: string | null = null;
  private suggestions: string[] = [];
  private code: string | null = null;
  private seat: number | null = null;
  private pid: string | null = null;
  private companyName: string | null = null;
  private nameStatus: NameStatus | null = null;
  private admitMode: AdmitMode | null = null;
  private confirmedMe: M | null = null;
  private pub: P | null = null;
  private publicVersion = 0;
  private pending: Pending<A>[] = [];
  /** state.me가 먼저 와서 지운 행동 seq — 뒤늦게 온 거절 ack도 되돌림 알림을 하려고 */
  private readonly settledByState = new Set<number>();
  private nextSeq = 0;
  private hostOfflineSince: number | null = null;
  private versionMismatch = false;
  private ended = false;

  private target: { code: string; seat: number; company: string } | null = null;
  private auto = false;
  private transportAdmitted = false;
  private joinInFlight = false;
  private retryTimer: unknown = null;
  private attempt = 0;
  /** 같은 코드 재시도를 시작한 시각(NO_ROOM·HOST_OFFLINE 첫 응답) */
  private waitSince: number | null = null;
  /** (작업 145) leave()마다 1 증가 — 끊기 전에 보낸 입장 요청의 늦은 결과가 상태·오류를 바꾸지 않게 */
  private gen = 0;

  private readonly stateL = new Listeners<[PeerState<M, P>]>();
  private readonly rollbackL = new Listeners<[string, string | null]>();
  private readonly eventL = new Listeners<[PeerEvent]>();
  private readonly unsubs: Unsub[] = [];

  constructor(private readonly o: PeerSessionOptions<M, P, A>) {
    this.t = o.transport;
    this.now = o.now ?? (() => Date.now());
    this.timers = o.timers === undefined ? realTimers : o.timers;
    o.store.purgeExpired(); // 만료된 기록·기기 토큰을 먼저 지우고 토큰을 읽는다
    this.token = o.deviceToken || o.store.deviceToken();
    this.rejoinDelay = o.rejoinDelayMs ?? (() => 300 + Math.floor(Math.random() * 1200));
    this.unsubs.push(
      this.t.onMessage((m) => this.handleMessage(m)),
      this.t.onRoomEvent((e) => this.handleRoomEvent(e)),
      this.t.onHostStatus((online) => this.handleHostStatus(online)),
      this.t.onStatus((s) => this.handleStatus(s)),
    );
  }

  // ── 입장 ──

  async join(code: string, seat: number, companyName: string): Promise<JoinResult | 'LOCAL_CHECK'> {
    const v = validateCompanyName(companyName);
    if (!v.ok) {
      this.setError(v.error, v.suggestions);
      this.status = 'idle';
      this.emit();
      return 'LOCAL_CHECK';
    }
    this.auto = false;
    return this.start({ code: code.trim(), seat, company: v.name });
  }

  autoRejoin(): boolean {
    this.o.store.purgeExpired();
    const r = this.o.store.load();
    if (!r || !r.code || r.seat === null || !r.companyName || r.endedAt !== null) return false;
    this.auto = true;
    // (작업 145) 새로 고침 전에 이미 기다리던 시각을 이어받는다(9분 판정이 처음부터 다시 시작되지 않게)
    void this.start({ code: r.code, seat: r.seat, company: r.companyName }, typeof r.waitSince === 'number' ? r.waitSince : null);
    return true;
  }

  private start(target: { code: string; seat: number; company: string }, waitSince: number | null = null): Promise<JoinResult | 'LOCAL_CHECK'> {
    this.clearRetry();
    if (this.code !== target.code) {
      // 다른 방이면 이전 판 상태를 버린다
      this.confirmedMe = null;
      this.pub = null;
      this.publicVersion = 0;
      this.pending = [];
      this.nextSeq = 0;
    }
    this.target = target;
    this.code = target.code;
    this.waitSince = waitSince;
    this.attempt = 0;
    this.errorCode = null;
    this.suggestions = [];
    this.status = 'joining';
    this.emit();
    return this.sendHello();
  }

  private async sendHello(): Promise<JoinResult> {
    const tg = this.target;
    if (!tg) return 'BAD_MESSAGE';
    const hello = { seat: tg.seat, company: tg.company, deviceToken: this.token, appVersion: this.o.appVersion };
    if (this.transportAdmitted) {
      // 손님 연결(허락 대기·거절 뒤)은 같은 연결로 다시 인사
      this.post({ t: 'hello', ...hello });
      return 'pending';
    }
    if (this.joinInFlight) return 'pending';
    const gen = this.gen;
    this.joinInFlight = true;
    let r: JoinResult;
    try {
      r = await this.t.join(tg.code, hello);
    } finally {
      if (this.gen === gen) this.joinInFlight = false;
    }
    // (작업 145) 기다리는 동안 leave()로 끊었으면 옛 시도의 결과는 무시(새 코드 입장 화면에 옛 오류가 뜨지 않게)
    if (this.gen !== gen) return r;
    if (r !== 'pending') this.joinFailed(r);
    return r;
  }

  private joinFailed(code: string) {
    const transient = code === 'NO_ROOM' || code === 'HOST_OFFLINE' || code === 'TIMEOUT' || code === 'RATE_LIMITED';
    const waiting = this.waitSince !== null;
    if (this.auto && (code === 'NO_ROOM' || code === 'HOST_OFFLINE' || (waiting && code === 'OFFLINE'))) {
      // 서버 재시작 뒤 호스트가 같은 코드로 다시 열 때까지 기다리며 계속 시도(코드를 다시 입력하지 않게).
      // 기다리는 동안 서버가 방 밖 연결을 정리(UNJOINED_TIMEOUT)해 OFFLINE이 되어도 계속 — RelayAdapter는 다음 join 때 다시 연결함
      const t = this.now();
      this.markWaiting(t);
      if (t - (this.waitSince ?? t) >= NO_ROOM_GIVE_UP_MS) {
        this.status = 'codeChanged';
        this.setError('CODE_CHANGED');
        this.emit();
        return;
      }
      this.status = 'hostOffline';
      this.hostOfflineSince ??= t;
      this.emit();
      this.scheduleRetry(WAIT_HOST_BACKOFF_MS[Math.min(this.attempt++, WAIT_HOST_BACKOFF_MS.length - 1)] as number);
      return;
    }
    if (this.auto && code === 'OFFLINE') {
      // 연결이 돌아오면(onStatus online) 다시 해 봄
      this.status = 'reconnecting';
      this.emit();
      return;
    }
    if (this.auto && transient) {
      this.status = 'reconnecting';
      this.emit();
      this.scheduleRetry(REJOIN_BACKOFF_MS[Math.min(this.attempt++, REJOIN_BACKOFF_MS.length - 1)] as number);
      return;
    }
    this.status = 'idle';
    this.setError(code);
    this.emit();
  }

  /** (작업 145) 같은 코드 재시도 시작 시각을 정하고 기기 방 기록에도 남긴다(새로 고침 뒤 이어서 셈) */
  private markWaiting(t: number) {
    if (this.waitSince !== null) return;
    this.waitSince = t;
    if (this.o.store.load()?.code === this.code) this.o.store.save({ waitSince: t });
  }

  private scheduleRetry(ms: number) {
    this.clearRetry();
    if (!this.timers) return;
    this.retryTimer = this.timers.setTimeout(() => {
      this.retryTimer = null;
      if (this.status === 'reconnecting' || this.status === 'joining' || (this.status === 'hostOffline' && !this.transportAdmitted))
        void this.sendHello();
    }, ms);
  }

  private clearRetry() {
    if (this.retryTimer !== null && this.timers) this.timers.clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  requestRejoin(): void {
    if (this.transportAdmitted && (this.status === 'idle' || this.status === 'waitingApproval')) {
      this.post({ t: 'rejoin.request' });
    } else if (this.target) void this.start(this.target);
  }

  // ── 행동 ──

  act(action: A): ActResult {
    if (!ACTIVE.includes(this.status)) return 'notIn';
    const online = this.status === 'in';
    if (!online && this.pending.filter((p) => !p.sent).length >= MAX_QUEUED_ACTIONS) {
      this.eventL.emit({ type: 'queueFull', message: appErrorToKorean('QUEUE_FULL') });
      return 'queueFull';
    }
    const seq = ++this.nextSeq;
    this.pending.push({ seq, action, sent: online });
    if (online) this.post({ t: 'act', seq, action });
    this.emit();
    return online ? 'sent' : 'queued';
  }

  setCompanyName(name: string): boolean {
    if (this.status !== 'in' && this.status !== 'hostOffline') return false;
    const v = validateCompanyName(name);
    if (!v.ok) {
      this.eventL.emit({
        type: 'nameResult',
        ok: false,
        error: v.error,
        message: appErrorToKorean(v.error),
        ...(v.suggestions ? { suggestions: v.suggestions } : {}),
      });
      return false;
    }
    this.post({ t: 'name.set', companyName: v.name });
    return true;
  }

  private post(m: PeerToHost) {
    this.t.send(m);
  }

  /** 모아 둔 행동과 확정 안 된 행동을 차례로 다시 보냄(호스트가 seq로 중복을 거름) */
  private resendPending() {
    for (const p of this.pending) {
      p.sent = true;
      this.post({ t: 'act', seq: p.seq, action: p.action });
    }
  }

  /** 호스트와 다시 맞춰짐 → 'in' */
  private synced() {
    const was = this.status;
    if (was === 'in') return;
    if (!(was === 'hostOffline' || was === 'reconnecting' || was === 'joining' || was === 'waitingApproval' || was === 'idle')) return;
    this.status = 'in';
    this.hostOfflineSince = null;
    this.errorCode = null;
    this.suggestions = [];
    this.clearRetry();
    this.resendPending();
  }

  // ── 받은 메시지 ──

  private handleMessage(m: JsonObject) {
    switch (msgType(m)) {
      case 'multi':
        if (Array.isArray(m.msgs)) for (const x of m.msgs) if (x && typeof x === 'object') this.handleMessage(x as JsonObject);
        return;
      case 'admitted': {
        const lastSeq = Number(m.lastSeq) || 0;
        this.seat = Number(m.seat);
        this.pid = String(m.pid);
        this.companyName = String(m.companyName);
        this.nameStatus = (m.nameStatus as NameStatus) ?? 'ok';
        this.admitMode = m.mode as AdmitMode;
        this.nextSeq = Math.max(this.nextSeq, lastSeq);
        this.pending = this.pending.filter((p) => p.seq > lastSeq);
        this.ended = false;
        this.waitSince = null;
        this.attempt = 0;
        this.auto = true; // 이후 끊기면 자동 재입장
        if (this.target) this.target = { ...this.target, seat: this.seat, company: this.companyName };
        this.o.store.save({
          code: this.code,
          seat: this.seat,
          companyName: this.companyName,
          pid: this.pid,
          nameStatus: this.nameStatus,
          endedAt: null,
          waitSince: null,
        });
        this.synced();
        this.emit();
        return;
      }
      case 'hello.rejected': {
        this.status = 'idle';
        this.auto = false;
        this.setError(String(m.reason), Array.isArray(m.suggestions) ? (m.suggestions as string[]) : []);
        this.emit();
        return;
      }
      case 'hello.again':
        // 끝난 상태(옮겨짐·내보내짐·방 닫힘·코드 바뀜)나 자동 재입장 대상이 아닌 대기 상태에서는 무시 —
        // 학생이 요청하지 않은 재입장 요청이 교사 화면에 생기지 않게
        if (
          this.status === 'moved' ||
          this.status === 'kicked' ||
          this.status === 'roomClosed' ||
          this.status === 'codeChanged' ||
          (this.status === 'idle' && !this.auto)
        )
          return;
        if (this.target) {
          this.post({
            t: 'hello',
            seat: this.target.seat,
            company: this.target.company,
            deviceToken: this.token,
            appVersion: this.o.appVersion,
          });
        }
        return;
      case 'rejoin.pending':
        this.status = 'waitingApproval';
        this.errorCode = 'REJOIN_PENDING';
        this.emit();
        return;
      case 'rejoin.denied':
        this.status = 'idle';
        this.auto = false;
        this.setError('REJOIN_DENIED');
        this.emit();
        return;
      case 'ack':
        return this.handleAck(m);
      case 'state.me': {
        const seq = Number(m.seq) || 0;
        this.confirmedMe = (m.data as M | null) ?? null;
        for (const p of this.pending) if (p.seq <= seq) this.settledByState.add(p.seq);
        if (this.settledByState.size > 100) {
          const keep = [...this.settledByState].slice(-50);
          this.settledByState.clear();
          for (const k of keep) this.settledByState.add(k);
        }
        this.pending = this.pending.filter((p) => p.seq > seq);
        const data = m.data as JsonObject | null;
        this.o.store.save({ lastMe: data, ...(data && 'logbook' in data ? { logbook: data.logbook } : {}) });
        this.synced();
        this.emit();
        return;
      }
      case 'state.public': {
        if (m.data && typeof m.data === 'object') {
          this.pub = m.data as P;
          this.publicVersion = Number(m.version) || 0;
        } else if (m.patch && typeof m.patch === 'object') {
          if (Number(m.version) <= this.publicVersion) return; // 이미 받은 것보다 옛것
          if (this.pub && Number(m.base) === this.publicVersion) {
            this.pub = applyPublicPatch(this.pub as JsonObject, m.patch as PublicPatch) as P;
            this.publicVersion = Number(m.version) || 0;
          } else {
            if (this.status === 'in' || this.status === 'hostOffline') this.post({ t: 'state.need' });
            return;
          }
        }
        this.emit();
        return;
      }
      case 'moved':
        this.status = 'moved';
        this.auto = false;
        this.pending = [];
        this.clearRetry();
        this.o.store.clearRoom();
        this.emit();
        return;
      case 'kicked':
        this.becomeKicked();
        return;
      case 'version.mismatch':
        this.versionMismatch = true;
        this.emit();
        return;
      case 'name.blocked':
        this.nameStatus = 'blocked';
        this.o.store.save({ nameStatus: 'blocked' });
        this.eventL.emit({ type: 'nameBlocked' });
        this.emit();
        return;
      case 'name.result': {
        const ok = m.ok === true;
        if (ok && typeof m.companyName === 'string') {
          this.companyName = m.companyName;
          this.nameStatus = 'ok';
          if (this.target) this.target = { ...this.target, company: m.companyName };
          this.o.store.save({ companyName: m.companyName, nameStatus: 'ok' });
        }
        const err = typeof m.error === 'string' ? m.error : undefined;
        this.eventL.emit({
          type: 'nameResult',
          ok,
          ...(err ? { error: err, message: appErrorToKorean(err) } : {}),
          ...(Array.isArray(m.suggestions) ? { suggestions: m.suggestions as string[] } : {}),
        });
        this.emit();
        return;
      }
      case 'name.changed':
        if (typeof m.companyName === 'string') {
          this.companyName = m.companyName;
          this.nameStatus = 'ok';
          if (this.target) this.target = { ...this.target, company: m.companyName };
          this.o.store.save({ companyName: m.companyName, nameStatus: 'ok' });
          this.emit();
        }
        return;
      case 'seat.changed':
        if (typeof m.seat === 'number') {
          this.seat = m.seat;
          if (this.target) this.target = { ...this.target, seat: m.seat };
          this.o.store.save({ seat: m.seat });
          this.emit();
        }
        return;
      case 'code.changed':
        // 지금 방에 있는 채로는 다른 방에 들어갈 수 없다 — 화면이 새 코드로 다시 입장하게 안내
        this.status = 'codeChanged';
        this.setError('CODE_CHANGED');
        this.emit();
        return;
      case 'host.ending':
        this.ended = true;
        this.o.store.markEnded(this.now());
        this.emit();
        return;
      default:
        return;
    }
  }

  private handleAck(m: JsonObject) {
    const seq = Number(m.seq);
    const i = this.pending.findIndex((p) => p.seq === seq);
    if (i >= 0) this.pending.splice(i, 1);
    else if (this.settledByState.has(seq)) this.settledByState.delete(seq);
    else return;
    if (m.ok !== true) {
      const error = typeof m.error === 'string' ? m.error : null;
      if (error === 'MOVED') {
        this.handleMessage({ t: 'moved' });
        return;
      }
      const message = appErrorToKorean('ROLLBACK');
      this.rollbackL.emit(message, error);
      this.eventL.emit({ type: 'rollback', seq, error, message });
    }
    this.emit();
  }

  private becomeKicked() {
    this.status = 'kicked';
    this.auto = false;
    this.pending = [];
    this.clearRetry();
    this.setError('KICKED');
    this.o.store.clearRoom();
    this.emit();
  }

  private handleRoomEvent(e: PeerRoomEvent) {
    switch (e.type) {
      case 'admitted':
        this.transportAdmitted = true;
        return;
      case 'rejected': {
        this.transportAdmitted = false;
        const { reason, suggestions } = decodeRejectReason(e.reason);
        if (reason === 'KICKED') return this.becomeKicked();
        this.status = 'idle';
        this.setError(reason, suggestions);
        this.emit();
        return;
      }
      case 'kicked':
        this.transportAdmitted = false;
        // 자리에 앉은(또는 들어가는 중) 기기만 '내보내짐'. 손님 연결 정리(거절 뒤)는 상태를 바꾸지 않음
        if (ACTIVE.includes(this.status) || this.status === 'joining') this.becomeKicked();
        else this.emit();
        return;
      case 'closed':
        this.transportAdmitted = false;
        if (e.reason === 'closed') {
          this.status = 'roomClosed';
          this.auto = false;
          this.ended = true;
          this.o.store.markEnded(this.now());
        } else if (ACTIVE.includes(this.status) && this.auto) {
          // 무활동·빈 방 등 — 호스트가 같은 코드로 다시 열 수 있으니 같은 코드로 계속 재입장 시도
          // (서버가 학생 연결을 닫아도 RelayAdapter는 다음 join 때 다시 연결)
          this.status = 'hostOffline';
          this.hostOfflineSince ??= this.now();
          this.markWaiting(this.now());
          this.scheduleRetry(WAIT_HOST_BACKOFF_MS[0] as number);
        }
        this.emit();
        return;
    }
  }

  private handleHostStatus(online: boolean) {
    if (!online) {
      if (this.status === 'in') {
        this.status = 'hostOffline';
        this.hostOfflineSince = this.now();
        for (const p of this.pending) p.sent = false;
        this.emit();
      }
      return;
    }
    if (this.status === 'hostOffline') this.post({ t: 'sync' }); // 호스트가 최신 상태(또는 hello.again)를 보내면 'in'
  }

  private handleStatus(s: ConnectionStatus) {
    // 같은 코드 재시도로 기다리는 중(방 밖)이면 연결이 끊겨도 재시도 타이머를 그대로 둔다
    if (this.waitSince !== null && this.status === 'hostOffline' && !this.transportAdmitted) return;
    if (s !== 'online') {
      this.transportAdmitted = false;
      this.clearRetry();
      if (ACTIVE.includes(this.status) || this.status === 'joining' || this.status === 'waitingApproval') {
        this.status = 'reconnecting';
        for (const p of this.pending) p.sent = false;
        this.emit();
      }
      return;
    }
    if (this.status === 'reconnecting' && this.target && this.auto) {
      this.clearRetry();
      if (this.timers) {
        this.retryTimer = this.timers.setTimeout(() => {
          this.retryTimer = null;
          if (this.status === 'reconnecting') void this.sendHello();
        }, this.rejoinDelay());
      } else void this.sendHello();
    }
  }

  leave(): void {
    this.clearRetry();
    this.gen++;
    this.joinInFlight = false;
    this.auto = false;
    this.t.leave();
    this.status = 'idle';
    this.emit();
  }

  dispose(): void {
    this.clearRetry();
    for (const u of this.unsubs.splice(0)) u();
  }

  // ── 상태 ──

  private setError(code: string | null, suggestions: string[] = []) {
    this.errorCode = code;
    this.suggestions = suggestions;
  }

  private display(): M | null {
    let me = this.confirmedMe;
    if (me === null) return null;
    for (const p of this.pending) {
      try {
        me = this.o.predict(me as M, this.pub, p.action);
      } catch {
        /* 미리 계산할 수 없는 행동은 호스트 결과를 기다림 */
      }
    }
    return me;
  }

  getState(): PeerState<M, P> {
    return {
      status: this.status,
      errorCode: this.errorCode,
      error: this.errorCode ? appErrorToKorean(this.errorCode) : null,
      suggestions: this.suggestions,
      code: this.code,
      seat: this.seat,
      pid: this.pid,
      companyName: this.companyName,
      nameStatus: this.nameStatus,
      admitMode: this.admitMode,
      me: this.display(),
      public: this.pub,
      publicVersion: this.publicVersion,
      pendingCount: this.pending.length,
      queuedCount: this.pending.filter((p) => !p.sent).length,
      hostOfflineSince: this.hostOfflineSince,
      waitSince: this.waitSince,
      versionMismatch: this.versionMismatch,
      ended: this.ended,
    };
  }

  subscribe(cb: (s: PeerState<M, P>) => void): Unsub {
    const u = this.stateL.add(cb);
    cb(this.getState());
    return u;
  }
  onRollback(cb: (message: string, error: string | null) => void): Unsub {
    return this.rollbackL.add(cb);
  }
  onEvent(cb: (e: PeerEvent) => void): Unsub {
    return this.eventL.add(cb);
  }

  private emit() {
    this.stateL.emit(this.getState());
  }
}

export function createPeerSession<M = JsonObject, P = JsonObject, A = unknown>(
  opts: PeerSessionOptions<M, P, A>,
): PeerSession<M, P, A> {
  return new PeerSessionImpl<M, P, A>(opts);
}
