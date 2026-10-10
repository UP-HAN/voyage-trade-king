/**
 * 학생 저장소 테스트 도구(작업 107): MemoryNetwork + 가상 타이머 + 실제 호스트 세션(103 리듀서 + 123 시계 훅 + 124 이름 검사)
 * + 학생 저장소(createStudentStore). 교사 화면(109)과 독립.
 */
import type { JsonObject } from '@shared/protocol';
import {
  createSessionReducer,
  createTradeHooks,
  playerView,
  publicPayload,
  seatKey,
  startSession,
  type HostSnapshot,
  type NameValidator,
  type TeacherAction,
} from '../../src/core';
import { validateCompanyName } from '../../src/sync/company-name';
import { createHostSession, type HostSession, type SessionReducer } from '../../src/sync/host-session';
import { createHostStore } from '../../src/sync/host-store';
import { MemoryNetwork, type MemoryHost, type MemoryPeer } from '../../src/sync/memory';
import { createPeerStore, type PeerStore } from '../../src/sync/peer-store';
import { ManualTimers } from '../../src/sync/throttle';
import { createStudentStore, type StudentStore } from '../../src/student/store';
import { MemStorage } from '../sync/session-helpers';

export { MemStorage };

export function newGame(now: number, opts: { comeback?: boolean } = {}): HostSnapshot {
  return startSession({
    code: '000000',
    playUnit: 'lesson',
    scope: ['L1'],
    seed: 7,
    now,
    settings: { progressMode: 'manual', comeback: opts.comeback ?? true },
  });
}

export interface HostRig {
  transport: MemoryHost;
  session: HostSession<HostSnapshot>;
  storage: MemStorage;
  teacher(a: TeacherAction): void;
  player(seat: number): HostSnapshot['players'][string] | undefined;
}

export interface StudentRig {
  transport: MemoryPeer;
  store: StudentStore;
  peerStore: PeerStore;
  storage: MemStorage;
}

export function makeStudentWorld() {
  const net = new MemoryNetwork({ startTime: Date.UTC(2026, 9, 9, 1, 0, 0) });
  const now = () => net.now();
  const timers = new ManualTimers(now);
  let tokenSeq = 0;

  async function advance(ms: number, step = 100) {
    await net.flush();
    let left = ms;
    while (left > 0) {
      const d = Math.min(step, left);
      left -= d;
      await net.advanceTime(d);
      timers.runDue();
      await net.flush();
      timers.runDue();
      await net.flush();
    }
  }

  function host(opts: { storage?: MemStorage; appVersion?: string } = {}): HostRig {
    const transport = net.createHost({ ip: '1.1.1.1' });
    const storage = opts.storage ?? new MemStorage();
    const hooks = createTradeHooks({ validateName: validateCompanyName as unknown as NameValidator });
    const session = createHostSession<HostSnapshot>({
      transport,
      reducer: createSessionReducer(hooks) as unknown as SessionReducer<HostSnapshot>,
      views: {
        public: (g) => publicPayload(g) as unknown as JsonObject,
        me: (g, seat) => {
          const p = g.players[seatKey(seat)];
          return p ? (playerView(p) as unknown as JsonObject) : null;
        },
      },
      store: createHostStore({ storage, now }),
      appVersion: opts.appVersion ?? 'v1',
      now,
      timers,
      strictPublic: true,
    });
    return {
      transport,
      session,
      storage,
      teacher: (a) => session.dispatchTeacher(a as unknown as { type: string }),
      player: (seat) => session.getView().game?.players[seatKey(seat)],
    };
  }

  /** appVersion: null 이면 저장소 기본값(src/config/deploy.ts APP_VERSION)을 쓴다 */
  function student(opts: { storage?: MemStorage; token?: string; appVersion?: string | null } = {}): StudentRig {
    const transport = net.createPeer({ ip: '2.2.2.2' });
    const storage = opts.storage ?? new MemStorage();
    const token = opts.token ?? `tok${String(++tokenSeq).padStart(8, '0')}abcdef0123456789`;
    const peerStore = createPeerStore({ storage, now, randomToken: () => token });
    // RelayAdapter(105)처럼: 서버가 끊은 뒤에는 다음 join 때 다시 연결
    const origJoin = transport.join.bind(transport);
    transport.join = (code: string, hello: Parameters<MemoryPeer['join']>[1]) => {
      if (transport.getStatus() === 'offline') net.reconnect(transport);
      return origJoin(code, hello);
    };
    const store = createStudentStore({
      transport,
      href: 'http://localhost/#/play',
      peerStore,
      ...(opts.appVersion === null ? {} : { appVersion: opts.appVersion ?? 'v1' }),
      now,
      timers,
      deviceToken: null,
      rejoinDelayMs: () => 200,
    });
    return { transport, store, peerStore, storage };
  }

  async function openRoom(storage?: MemStorage) {
    const h = host(storage ? { storage } : {});
    const r = await h.session.open({ game: newGame(now()) });
    if (!r.ok) throw new Error(r.error);
    await advance(200);
    return { h, code: r.code };
  }

  /** 입장 + 회사 설립까지 */
  async function joinFounded(code: string, seat: number, name: string, rig?: StudentRig): Promise<StudentRig> {
    const s = rig ?? student();
    await s.store.join(code, seat, name);
    await advance(800);
    s.store.act({ type: 'foundCompany', color: 'blue', emblem: 'star', avatar: 'captain-2' });
    await advance(1500);
    return s;
  }

  return { net, now, timers, advance, host, student, openRoom, joinFounded };
}

export type StudentWorld = ReturnType<typeof makeStudentWorld>;
