/**
 * 교사 시범 화면(작업 169) — 수업 방과 완전히 따로 도는 '시범 판' 하나.
 *
 * 이 페이지 안에서만 돈다: MemoryNetwork(가짜 중계, src/sync/memory.ts) + 호스트 세션(124) + 학생 저장소(107).
 * 실제 중계 서버·BroadcastChannel·공용 화면(TV)·교사 저장본(localStorage `voyage.host`)·학생 방 기록(`voyage.peer`)에
 * 아무것도 쓰거나 보내지 않는다(저장소는 모두 이 페이지 메모리).
 *
 * 판 모양: 2차시 차시 한 판·앞 시간(`lessonPart: 'front'`, 열린 항구는 `startSession`이 정함 — 싱가포르 하드코딩 없음),
 * 자유 항해, 시범 회사 '시범무역'(1번)이 설립된 채 부산에서 2차시 시작값(800만 원·원유 2상자)으로 시작한다.
 *
 * 수업 흐름 끄기: 호스트 리듀서에서 시계 틱(`tick`)·끊긴 시간(`hostGap`)을 무시하고 무역 훅(배치표·사건·편지·학습지 자동 진행)을
 * 붙이지 않는다 → 라운드 1이 끝나지 않고, 사건·학습지·편지·갈매기 힌트·잠깐 멈춤이 뜨지 않는다. 운항비 정산(라운드 끝)도 없다.
 */
import type { JsonObject } from '@shared/protocol';
import {
  createSessionReducer,
  playerView,
  publicPayload,
  seatKey,
  startSession,
  type HostSnapshot,
  type NameValidator,
} from '../core';
import { defaultFlag } from '../core/company';
import { validateCompanyName } from '../sync/company-name';
import { createHostSession, type HostSession, type SessionReducer } from '../sync/host-session';
import { createHostStore } from '../sync/host-store';
import { MemoryNetwork } from '../sync/memory';
import { createPeerStore } from '../sync/peer-store';
import { realTimers, type Timers } from '../sync/throttle';
import { createStudentStore, type StudentStore } from '../student/store';

export const DEMO_COMPANY = '시범무역';
export const DEMO_SEAT = 1;
/** 시범 판 길이(초) — 사실상 끝나지 않음(틱을 무시하므로 이 값으로 끝나지도 않는다). 숫자는 화면에 나오지 않는다 */
export const DEMO_FOREVER_SEC = 7 * 24 * 60 * 60;

/** 이 페이지 메모리에만 두는 저장소(localStorage 모양) */
export class MemoryStorage {
  readonly map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.has(k) ? (this.map.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, String(v));
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
  get length(): number {
    return this.map.size;
  }
}

/** 시범 판 처음 상태(학생 입장 전) — 2차시 앞 시간·자유 항해·수동 진행, 무역 시계는 이미 '무역 중' */
export function demoGame(now: number): HostSnapshot {
  const g = startSession({
    code: '000000',
    className: '시범',
    playUnit: 'lesson',
    scope: ['L2'],
    seed: 2026,
    now,
    settings: { progressMode: 'manual', voyageMode: 'free', lessonPart: 'front', tradeMinutes: DEMO_FOREVER_SEC / 60 },
  });
  const durationSec = DEMO_FOREVER_SEC;
  return {
    ...g,
    class: {
      ...g.class,
      clock: { ...g.class.clock, durationSec, startedAt: now, endsAt: now + durationSec * 1000 },
      letters: { ...g.class.letters, enabled: false },
    },
  };
}

/** 무역 훅 없이 + 틱·끊긴 시간 무시: 수업 흐름(자동 진행·라운드 마감·갈매기 힌트)이 돌지 않는다 */
export function demoReducer(): SessionReducer<HostSnapshot> {
  const base = createSessionReducer({ validateName: validateCompanyName as unknown as NameValidator }) as unknown as SessionReducer<HostSnapshot>;
  return (snapshot, input, now) => {
    if (input.type === 'tick' || input.type === 'hostGap') return { snapshot, outputs: [] };
    return base(snapshot, input, now);
  };
}

export interface DemoWorld {
  readonly store: StudentStore;
  readonly host: HostSession<HostSnapshot>;
  readonly net: MemoryNetwork;
  /** 시범 회사가 설립되고 라운드가 열렸으면 resolve */
  readonly ready: Promise<void>;
  dispose(): void;
}

export interface DemoWorldOptions {
  /** 시각(기본 Date.now). 가상 시계를 쓰면 `realClock: false` */
  now?: () => number;
  timers?: Timers | null;
  /** 가짜 중계의 시계를 실제 시각에 맞춰 0.5초마다 앞으로. 기본 true */
  realClock?: boolean;
  appVersion?: string;
  /** 학생 저장소에 넘길 주소(기본 location.href) */
  href?: string;
}

const BIG = 10 * 365 * 24 * 60 * 60;

export function createDemoWorld(o: DemoWorldOptions = {}): DemoWorld {
  const wall = o.now ?? (() => Date.now());
  // 시범 판은 오래 켜 두어도 방이 정리되지 않게(가짜 중계 안에서만의 설정)
  const net = new MemoryNetwork({ startTime: wall(), config: { maxRoomAge: BIG, idleTtl: BIG, emptyRoomTtl: BIG, hostGrace: BIG } });
  // 세션(호스트·학생)은 실제 시각, 가짜 중계 시계는 0.5초마다 실제 시각을 따라간다(속도 제한 토큰 채우기)
  const now = wall;
  const timers = o.timers === undefined ? realTimers : o.timers;
  let ticker: ReturnType<typeof setInterval> | null = null;
  if (o.realClock !== false) {
    ticker = setInterval(() => {
      const d = wall() - net.now();
      if (d > 0) void net.advanceTime(d);
    }, 500);
  }

  const reducer = demoReducer();
  const host = createHostSession<HostSnapshot>({
    transport: net.createHost({ ip: '10.0.0.1' }),
    reducer,
    views: {
      public: (g) => publicPayload(g) as unknown as JsonObject,
      me: (g, seat) => {
        const p = g.players[seatKey(seat)];
        return p ? (playerView(p) as unknown as JsonObject) : null;
      },
    },
    store: createHostStore({ storage: new MemoryStorage(), now }),
    ...(o.appVersion ? { appVersion: o.appVersion } : { appVersion: 'demo' }),
    now,
    timers,
    screenFactory: null,
  });
  const store = createStudentStore({
    transport: net.createPeer({ ip: '10.0.0.2' }),
    href: o.href ?? (typeof location !== 'undefined' ? location.href : 'http://localhost/#/demo'),
    peerStore: createPeerStore({ storage: new MemoryStorage(), now }),
    appVersion: o.appVersion ?? 'demo',
    now,
    timers,
    deviceToken: null,
  });

  let disposed = false;
  const ready = (async () => {
    // 라운드 1을 연 판으로 방을 연다(첫 공개 상태부터 '라운드 중')
    const t = now();
    const game = reducer(demoGame(t), { type: 'teacher', action: { type: 'startRound', durationSec: DEMO_FOREVER_SEC } }, t).snapshot;
    const r = await host.open({ game });
    if (!r.ok) throw new Error(r.error);
    const j = await store.join(r.code, DEMO_SEAT, DEMO_COMPANY);
    if (j !== 'pending') throw new Error(String(j));
    await waitFor(store, () => store.getState().peer.status === 'in' && !!store.getState().peer.me);
    store.act({ type: 'foundCompany', ...defaultFlag(DEMO_SEAT) });
    await waitFor(store, () => !!store.getState().peer.me?.company.founded);
  })();

  return {
    store,
    host,
    net,
    ready,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (ticker !== null) clearInterval(ticker);
      store.dispose();
      void host.close().catch(() => undefined);
    },
  };
}

function waitFor(store: StudentStore, ok: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    if (ok()) return resolve();
    const un = store.subscribe(() => {
      if (!ok()) return;
      queueMicrotask(() => un());
      resolve();
    });
  });
}
