/**
 * 학생 상태 저장소 (작업 107, PRD 7.2~7.4·7.8).
 *
 * `select`(104)로 전송 어댑터 → `peer-session`(124) → `autoRejoin()` → 공개 상태·내 상태 구독.
 * - `act(action)`: peer-session의 `act` — 미리 계산(`studentPredict`)으로 바로 화면에 보이고, 호스트 ack로 확정,
 *   거절이면 호스트 상태로 되돌리고 토스트 "값이 바뀌어서 다시 계산했어요".
 * - 항해는 **호스트가** 처리한다. 학생 기기는 `state.me`의 `resolvedRound`가 오르면 `fx.sail()` → 도착 토스트만 한다.
 * - 학생 기기는 회사 상태를 확정하거나 저장하지 않는다(peer-store의 보기용 사본은 124가 관리).
 * - 일시정지·이름 막힘 중에는 행동을 보내지 않는다(조작 막힘).
 */
import type { ActiveNotice } from '@shared/protocol';
import type { Action, GameEvent, PublicPayload } from '../core';
import { portLabel } from '../data/ports';
import { APP_VERSION, readQueryParam } from '../config/deploy';
import type { JoinResult, PeerTransport, Unsub } from '../sync/adapter';
import { msgType } from '../sync/app-messages';
import { localDeviceToken } from '../sync/local';
import { createPeerSession, type ActResult, type PeerSession, type PeerState } from '../sync/peer-session';
import { createPeerStore, peerStorageForHref, type PeerRecord, type PeerStorageLike, type PeerStore } from '../sync/peer-store';
import { createPeerTransport } from '../sync/select';
import { realTimers, type Timers } from '../sync/throttle';
import { fx } from '../ui/common/fx';
import { studentPredict, type MeView } from './predict';
import { withEuro } from './text';

export type StudentPeerState = PeerState<MeView, PublicPayload>;

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'warn' | 'arrive';
}

export interface StudentState {
  peer: StudentPeerState;
  toasts: Toast[];
  /** 처음 자동 재입장을 시도하는 중(저장된 회사로 돌아가는 중) */
  booting: boolean;
  /** 다른 기기 허락을 기다리던 중 연결이 끊김 → [다시 들어가기] 버튼 */
  approvalLost: boolean;
  /** 입장 화면에 미리 채울 값(기기에 남은 번호·회사 이름) */
  saved: { code: string | null; seat: number | null; companyName: string | null } | null;
  /** 이름 바꾸기 요청을 보내고 결과를 기다리는 중 */
  nameRequest: { pending: boolean; error: string | null; suggestions: string[] };
  /** 호스트 부재로 입장이 막혀 자동으로 다시 해 보는 중 */
  retryingJoin: boolean;
  /** (작업 145) 자동 재입장을 시작한 시각(기기 시각, store의 `now`) — `booting`이 끝나면 null */
  bootingSince: number | null;
  /** (작업 145) [새 방 코드로 들어가기]로 입장 화면에 옴 → 맨 위 안내. 입장 성공·코드 바뀜·다른 입장 시도 때 꺼짐 */
  newCodeHint: boolean;
}

export type StudentActResult = ActResult | 'blocked';

export interface StudentStore {
  getState(): StudentState;
  subscribe(cb: (s: StudentState) => void): Unsub;
  join(code: string, seat: number, companyName: string): Promise<JoinResult | 'LOCAL_CHECK'>;
  /** 저장된 회사로 자동 재입장(저장값이 없으면 false) */
  autoRejoin(): boolean;
  act(action: Action): StudentActResult;
  /** 조작이 막혀 있나(일시정지·이름 막힘·연결 전) */
  isBlocked(): boolean;
  setCompanyName(name: string): boolean;
  requestRejoin(): void;
  /** 입장 시도 취소(허락 대기 등) */
  cancelJoin(): void;
  /** [게임 나가기]: 연결을 끊고 이 기기의 방 기록(voyage.peer)을 지운다(기기 토큰은 남김) */
  leaveGame(): void;
  /**
   * (작업 145) [새 방 코드로 들어가기]: 재시도를 멈추고 연결을 끊고 방 기록(voyage.peer)을 지운다(기기 토큰은 남김).
   * 번호·회사 이름은 남기고 방 코드만 비운 채 입장 화면으로(`newCodeHint`).
   */
  leaveForNewCode(): void;
  dismissToast(id: number): void;
  toast(text: string, kind?: Toast['kind']): void;
  serverNow(): number;
  /** 연출용 게임 이벤트(도착·머무름 등) */
  onGameEvents(cb: (events: GameEvent[]) => void): Unsub;
  notice(): ActiveNotice | null;
  onNotice(cb: (n: ActiveNotice | null) => void): Unsub;
  readonly session: PeerSession<MeView, PublicPayload, Action>;
  readonly transport: PeerTransport;
  dispose(): void;
}

export interface StudentStoreOptions {
  transport: PeerTransport;
  href?: string;
  storage?: PeerStorageLike | null;
  /** 지정하면 그 기기 토큰(테스트). 없으면 `?as=`면 탭 전용, 아니면 저장소 토큰 */
  deviceToken?: string | null;
  peerStore?: PeerStore;
  appVersion?: string;
  now?: () => number;
  timers?: Timers | null;
  rejoinDelayMs?: () => number;
  toastMs?: number;
  /** 호스트 부재로 막힌 입장을 다시 해 보는 간격(ms) */
  joinRetryMs?: number;
}

/** 앱 버전은 교사(호스트, src/teacher/host.ts)와 같은 값 `APP_VERSION`(패키지 버전 + 빌드 시각)을 쓴다 — 다르면 124가 version.mismatch 를 보낸다 */
const TOAST_MS = 3500;
const MAX_TOASTS = 3;
export const JOIN_RETRY_MS = 3000;
/** (작업 145) 대기 화면(Booting)에 [새 방 코드로 들어가기]가 나오기까지(자동 재입장 시작부터) */
export const REJOIN_ESCAPE_BOOT_MS = 10_000;
/** (작업 145) 게임 화면 기다림 띠에 [새 방 코드로]가 나오기까지(호스트가 끊긴 때부터) */
export const REJOIN_ESCAPE_GAME_MS = 60_000;

/** 이 상태들에서는 화면(게임)이 보인다 */
export const IN_GAME: readonly StudentPeerState['status'][] = ['in', 'hostOffline', 'reconnecting'];

/**
 * (작업 145) [새 방 코드로 들어가기]를 보일까(순수). `now`는 기기 시각(store의 `now`·`hostOfflineSince`와 같은 시계).
 * - 대기 화면: `booting`이 10초 넘게 이어짐(세부 상태는 따지지 않음). 새로 고침 전부터 같은 코드를 기다리던 중이면
 *   기기 방 기록에 남은 시작 시각(`peer.waitSince`)부터 센다(교사 추가 요구 2026-10-21)
 * - 게임 화면: 'hostOffline'이 60초 넘게 이어짐
 */
export function showRejoinEscape(st: StudentState, now: number): boolean {
  if (st.booting) {
    if (st.bootingSince === null) return false;
    const since = st.peer.waitSince !== null ? Math.min(st.bootingSince, st.peer.waitSince) : st.bootingSince;
    return now - since >= REJOIN_ESCAPE_BOOT_MS;
  }
  const p = st.peer;
  return p.status === 'hostOffline' && p.hostOfflineSince !== null && now - p.hostOfflineSince >= REJOIN_ESCAPE_GAME_MS;
}

function emptyName(): StudentState['nameRequest'] {
  return { pending: false, error: null, suggestions: [] };
}

export function createStudentStore(o: StudentStoreOptions): StudentStore {
  const href = o.href ?? (typeof location !== 'undefined' ? location.href : 'http://localhost/');
  const timers = o.timers === undefined ? realTimers : o.timers;
  const now = o.now ?? (() => Date.now());
  const peerStore =
    o.peerStore ?? createPeerStore({ storage: o.storage === undefined ? peerStorageForHref(href) : o.storage, ...(o.now ? { now: o.now } : {}) });
  let as: string | null = null;
  try {
    as = readQueryParam(href, 'as');
  } catch {
    as = null;
  }
  const deviceToken = o.deviceToken !== undefined ? o.deviceToken : as ? localDeviceToken(as) : null;
  const session = createPeerSession<MeView, PublicPayload, Action>({
    transport: o.transport,
    predict: studentPredict,
    store: peerStore,
    appVersion: o.appVersion ?? APP_VERSION,
    ...(o.now ? { now: o.now } : {}),
    timers,
    deviceToken,
    ...(o.rejoinDelayMs ? { rejoinDelayMs: o.rejoinDelayMs } : {}),
  });

  const listeners = new Set<(s: StudentState) => void>();
  const gameListeners = new Set<(e: GameEvent[]) => void>();
  const unsubs: Unsub[] = [];
  let toastSeq = 0;
  let disposed = false;
  let joinRetryTimer: unknown = null;
  /** (작업 145) 나가기·새 코드로 갈 때마다 1 증가 — 그 전에 보낸 join의 늦은 결과로 재시도 타이머를 걸지 않게 */
  let epoch = 0;

  const savedRec = (r: PeerRecord | null): StudentState['saved'] =>
    r ? { code: r.code, seat: r.seat, companyName: r.companyName } : null;

  let st: StudentState = {
    peer: session.getState(),
    toasts: [],
    booting: false,
    approvalLost: false,
    saved: savedRec(peerStore.load()),
    nameRequest: emptyName(),
    retryingJoin: false,
    bootingSince: null,
    newCodeHint: false,
  };

  const emit = () => {
    for (const cb of [...listeners]) cb(st);
  };
  const set = (patch: Partial<StudentState>) => {
    st = { ...st, ...patch };
    emit();
  };

  const dismissToast = (id: number) => {
    if (!st.toasts.some((t) => t.id === id)) return;
    set({ toasts: st.toasts.filter((t) => t.id !== id) });
  };
  const toast = (text: string, kind: Toast['kind'] = 'info') => {
    const id = ++toastSeq;
    set({ toasts: [...st.toasts, { id, text, kind }].slice(-MAX_TOASTS) });
    if (timers) timers.setTimeout(() => dismissToast(id), o.toastMs ?? TOAST_MS);
  };

  const clearJoinRetry = () => {
    if (joinRetryTimer !== null && timers) timers.clearTimeout(joinRetryTimer);
    joinRetryTimer = null;
  };

  // ── 항해 결과(호스트가 처리) → 연출 + 도착 토스트 ──
  let lastResolved: number | null = null;
  let lastPid: string | null = null;
  const onPeer = (p: StudentPeerState) => {
    const prev = st.peer;
    const patch: Partial<StudentState> = { peer: p };
    // 허락을 기다리던 손님 연결은 자동 재입장 대상이 아니라(124) 연결이 끊기면 '다시 연결 중'에 머문다 → [다시 들어가기]
    if (prev.status === 'waitingApproval' && p.status === 'reconnecting') patch.approvalLost = true;
    if (p.status === 'waitingApproval' || p.status === 'in' || p.status === 'joining') patch.approvalLost = false;
    if (st.booting && p.status !== 'joining' && (p.status !== 'hostOffline' || p.me !== null) && p.status !== 'reconnecting')
      patch.booting = false;
    if (patch.booting === false) patch.bootingSince = null;
    if (st.newCodeHint && (p.status === 'in' || p.status === 'codeChanged')) patch.newCodeHint = false;
    if (st.retryingJoin && p.status !== 'idle') {
      patch.retryingJoin = false;
      clearJoinRetry();
    }
    if (p.status === 'codeChanged' || p.status === 'moved' || p.status === 'kicked' || p.status === 'idle')
      patch.saved = { code: p.status === 'codeChanged' ? null : p.code ?? st.saved?.code ?? null, seat: p.seat ?? st.saved?.seat ?? null, companyName: p.companyName ?? st.saved?.companyName ?? null };
    st = { ...st, ...patch };

    // 라운드 처리 결과: 확정된 내 상태의 resolvedRound가 오르면(같은 회사일 때만)
    const me = p.me;
    if (me && p.pid) {
      const r = me.game.resolvedRound;
      if (lastPid === p.pid && lastResolved !== null && r > lastResolved) announceVoyage(me);
      lastResolved = r;
      lastPid = p.pid;
    }
    emit();
  };

  const announceVoyage = (me: MeView) => {
    const events = me.events ?? [];
    for (const cb of [...gameListeners]) cb(events);
    const arrived = [...events].reverse().find((e) => e.type === 'arrived') as Extract<GameEvent, { type: 'arrived' }> | undefined;
    const stayed = [...events].reverse().find((e) => e.type === 'stayed') as Extract<GameEvent, { type: 'stayed' }> | undefined;
    void fx.sail().then(() => fx.arrive());
    if (arrived) toast(`${portLabel(arrived.port)}에 도착했어요`, 'arrive');
    else if (stayed) {
      const why =
        stayed.reason === 'noMoney'
          ? ' 운항비가 모자랐어요.'
          : stayed.reason === 'portClosed'
            ? ' 그 항구가 막혀 있었어요.'
            : stayed.reason === 'notReady'
              ? ' 출항 준비를 누르지 않았어요.'
              : '';
      toast(`${portLabel(stayed.port)}에 머물렀어요.${why}`, 'info');
    } else toast(`${portLabel(me.game.port)}에 있어요`, 'arrive');
  };

  unsubs.push(session.subscribe(onPeer));
  unsubs.push(session.onRollback((message) => toast(message, 'warn')));
  unsubs.push(
    session.onEvent((e) => {
      if (e.type === 'queueFull') toast(e.message, 'warn');
      else if (e.type === 'nameResult') {
        if (e.ok) set({ nameRequest: emptyName() });
        else set({ nameRequest: { pending: false, error: e.message ?? null, suggestions: e.suggestions ?? [] } });
      } else if (e.type === 'nameBlocked') set({ nameRequest: emptyName() });
    }),
  );

  // 같은 기기 재입장·교사가 이름을 바꿈 → 토스트(출석번호는 넣지 않음)
  const scan = (m: unknown) => {
    const t = msgType(m);
    if (!t) return;
    const x = m as Record<string, unknown>;
    if (t === 'multi' && Array.isArray(x.msgs)) {
      for (const y of x.msgs) scan(y);
      return;
    }
    if (t === 'admitted' && x.mode === 'same-device' && typeof x.companyName === 'string') {
      toast(`${withEuro(x.companyName)} 돌아왔어요!`, 'info');
    } else if (t === 'name.changed' && typeof x.companyName === 'string') {
      toast(`선생님이 회사 이름을 '${x.companyName}'${nameParticle(x.companyName)} 바꿨어요`, 'info');
    }
  };
  unsubs.push(o.transport.onMessage((m) => scan(m)));

  /** [게임 나가기]·[새 방 코드로 들어가기] 공통: 재시도 멈춤 → 연결 끊기 → 방 기록 삭제(기기 토큰은 남김) */
  const leaveRoom = () => {
    epoch++;
    clearJoinRetry();
    session.leave();
    peerStore.clearRoom();
    lastResolved = null;
    lastPid = null;
  };

  const api: StudentStore = {
    session,
    transport: o.transport,
    getState: () => st,
    subscribe(cb) {
      listeners.add(cb);
      cb(st);
      return () => {
        listeners.delete(cb);
      };
    },
    async join(code, seat, companyName) {
      clearJoinRetry();
      set({ retryingJoin: false, approvalLost: false, newCodeHint: false });
      const e = epoch;
      const r = await session.join(code, seat, companyName);
      if (r === 'HOST_OFFLINE' && !disposed && timers && e === epoch) {
        // 선생님 화면이 켜질 때까지 자동으로 다시 해 봄
        set({ retryingJoin: true });
        joinRetryTimer = timers.setTimeout(() => {
          joinRetryTimer = null;
          const cur = session.getState();
          if (cur.status === 'idle' && cur.errorCode === 'HOST_OFFLINE') void api.join(code, seat, companyName);
          else set({ retryingJoin: false });
        }, o.joinRetryMs ?? JOIN_RETRY_MS);
      }
      return r;
    },
    autoRejoin() {
      const ok = session.autoRejoin();
      if (ok) set({ booting: true, bootingSince: now() });
      return ok;
    },
    isBlocked() {
      const p = st.peer;
      if (!IN_GAME.includes(p.status)) return true;
      if (p.nameStatus === 'blocked') return true;
      if (p.public?.class?.paused) return true;
      return false;
    },
    act(action) {
      if (api.isBlocked()) return 'blocked';
      return session.act(action);
    },
    setCompanyName(name) {
      const ok = session.setCompanyName(name);
      if (ok) set({ nameRequest: { pending: true, error: null, suggestions: [] } });
      return ok;
    },
    requestRejoin() {
      set({ approvalLost: false });
      session.requestRejoin();
    },
    cancelJoin() {
      epoch++;
      clearJoinRetry();
      session.leave();
      set({ retryingJoin: false, approvalLost: false });
    },
    leaveGame() {
      leaveRoom();
      set({ saved: null, booting: false, bootingSince: null, retryingJoin: false, approvalLost: false, newCodeHint: false });
    },
    leaveForNewCode() {
      // 번호·이름은 지금 회사 값(이름이 바뀌었을 수 있음) → 없으면 기기에 남은 값
      const p = st.peer;
      const seat = p.seat ?? st.saved?.seat ?? null;
      const companyName = p.companyName ?? st.saved?.companyName ?? null;
      leaveRoom();
      set({
        saved: { code: null, seat, companyName },
        booting: false,
        bootingSince: null,
        retryingJoin: false,
        approvalLost: false,
        newCodeHint: true,
      });
    },
    dismissToast,
    toast,
    serverNow: () => o.transport.serverNow(),
    onGameEvents(cb) {
      gameListeners.add(cb);
      return () => {
        gameListeners.delete(cb);
      };
    },
    notice() {
      const t = o.transport as PeerTransport & { currentNotice?: () => ActiveNotice | null };
      return t.currentNotice?.() ?? null;
    },
    onNotice: (cb) => o.transport.onNotice(cb),
    dispose() {
      disposed = true;
      clearJoinRetry();
      for (const u of unsubs.splice(0)) u();
      session.dispose();
    },
  };
  return api;
}

/** "'해오름'으로" / "'바다'로" 의 조사만 */
function nameParticle(name: string): string {
  return withEuro(name).slice(name.length);
}

/** 화면에서 쓰는 기본 저장소(전송 어댑터는 URL로 고름) */
export async function openStudentStore(opts: Partial<StudentStoreOptions> = {}): Promise<StudentStore> {
  const transport = opts.transport ?? (await createPeerTransport());
  return createStudentStore({ ...opts, transport });
}
