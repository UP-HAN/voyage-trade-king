/**
 * 작업 114 통합 시뮬레이션 도구: MemoryNetwork(= shared/relay-core 그대로) + **실제 교사 호스트**(109 teacherReducer =
 * 103 hostReduce + 123 무역 시계 훅 + 124 이름 검사, teacherViews) + **실제 학생 저장소**(107 createStudentStore, studentPredict).
 * 화면은 없다. 가상 시계(advance)로 판을 끝까지 돌린다.
 *
 * - 계측: 학생→서버, 서버→학생, 호스트→서버, 서버→호스트 메시지 수·바이트(가상 시각 1초 단위 버킷),
 *   호스트 리듀서 1회 처리 시간, 공개 상태·스냅숏 크기.
 * - 비노출 검사: 서버→학생 메시지 전부(봉투 풀어서)와 공용 화면 다리 메시지를 기록한다.
 * - 봇: 학생 저장소 상태(public·me)만 보고 무작위로 행동한다(호스트 상태를 엿보지 않음).
 */
import type { JsonObject } from '@shared/protocol';
import type { LessonId } from '../../src/data/types';
import { createStudentStore, type StudentStore } from '../../src/student/store';
import { createHostSession, type HostSession, type SessionReducer } from '../../src/sync/host-session';
import { createHostStore } from '../../src/sync/host-store';
import { MemoryNetwork, type MemoryHost, type MemoryPeer } from '../../src/sync/memory';
import { createPeerStore } from '../../src/sync/peer-store';
import type { ScreenPublisher } from '../../src/sync/screen-bridge';
import { ManualTimers } from '../../src/sync/throttle';
import {
  newTeacherGame,
  resultTableOf,
  teacherReducer,
  teacherViews,
  type TeacherGame,
} from '../../src/teacher/game';
import type { PlayUnit } from '../../src/core';
import { MemStorage } from '../sync/session-helpers';

export { MemStorage };

// ───────────────────────── 계측 ─────────────────────────

export type Dir = 'studentOut' | 'studentIn' | 'hostOut' | 'hostIn';

export class Meter {
  readonly total: Record<Dir, { n: number; bytes: number }> = {
    studentOut: { n: 0, bytes: 0 },
    studentIn: { n: 0, bytes: 0 },
    hostOut: { n: 0, bytes: 0 },
    hostIn: { n: 0, bytes: 0 },
  };
  /** 초 → 방향별 수·바이트 */
  readonly perSec = new Map<number, Record<Dir, { n: number; bytes: number }>>();
  enabled = true;
  constructor(private readonly now: () => number) {}
  add(dir: Dir, data: string): void {
    if (!this.enabled) return;
    const b = Buffer.byteLength(data, 'utf8');
    this.total[dir].n++;
    this.total[dir].bytes += b;
    const s = Math.floor(this.now() / 1000);
    let rec = this.perSec.get(s);
    if (!rec) {
      rec = { studentOut: { n: 0, bytes: 0 }, studentIn: { n: 0, bytes: 0 }, hostOut: { n: 0, bytes: 0 }, hostIn: { n: 0, bytes: 0 } };
      this.perSec.set(s, rec);
    }
    rec[dir].n++;
    rec[dir].bytes += b;
  }
  /** 방향별 초당 평균·최대(구간 [fromSec, toSec]) */
  rates(fromSec: number, toSec: number): Record<Dir, { avgN: number; maxN: number; avgBytes: number; maxBytes: number }> {
    const out = {} as Record<Dir, { avgN: number; maxN: number; avgBytes: number; maxBytes: number }>;
    const span = Math.max(1, toSec - fromSec + 1);
    for (const d of ['studentOut', 'studentIn', 'hostOut', 'hostIn'] as Dir[]) {
      let n = 0;
      let bytes = 0;
      let maxN = 0;
      let maxBytes = 0;
      for (let s = fromSec; s <= toSec; s++) {
        const r = this.perSec.get(s)?.[d];
        if (!r) continue;
        n += r.n;
        bytes += r.bytes;
        maxN = Math.max(maxN, r.n);
        maxBytes = Math.max(maxBytes, r.bytes);
      }
      out[d] = { avgN: n / span, maxN, avgBytes: bytes / span, maxBytes };
    }
    return out;
  }
}

/** 리듀서 처리 시간(ms) 기록 */
export class ReduceTimer {
  readonly samples: number[] = [];
  readonly byType: Record<string, number[]> = {};
  record(type: string, ms: number): void {
    this.samples.push(ms);
    (this.byType[type] ??= []).push(ms);
  }
  static stats(xs: number[]): { n: number; avg: number; p95: number; max: number } {
    if (!xs.length) return { n: 0, avg: 0, p95: 0, max: 0 };
    const s = [...xs].sort((a, b) => a - b);
    return { n: s.length, avg: s.reduce((a, b) => a + b, 0) / s.length, p95: s[Math.floor(s.length * 0.95)]!, max: s[s.length - 1]! };
  }
}

/** 받은 원문(봉투 포함) → 앱 메시지 목록(multi 풀기) */
export function unwrapToApp(raw: string): JsonObject[] {
  let m: JsonObject;
  try {
    m = JSON.parse(raw) as JsonObject;
  } catch {
    return [];
  }
  const inner = m.msg as JsonObject | undefined;
  if (!inner || typeof inner !== 'object') return [];
  if (inner.t === 'multi') return (inner.msgs as JsonObject[]) ?? [];
  return [inner];
}

// ───────────────────────── 세계 ─────────────────────────

export interface SimHost {
  transport: MemoryHost;
  session: HostSession<TeacherGame>;
  storage: MemStorage;
  teacher(a: { type: string; [k: string]: unknown }): void;
  game(): TeacherGame;
  /** 공용 화면 다리로 나간 메시지(공개 상태·학급 보기) */
  screenMsgs: JsonObject[];
}

export interface SimStudent {
  seat: number;
  name: string;
  transport: MemoryPeer;
  store: StudentStore;
  storage: MemStorage;
  token: string;
  /** 서버→이 학생 앱 메시지(봉투 푼 것) */
  inbox: JsonObject[];
  rollbacks: number;
  errors: string[];
}

export interface GameSetup {
  playUnit: PlayUnit;
  scope: LessonId[];
  tradeMinutes: number;
  progressMode?: 'auto' | 'manual';
  seed?: number;
  overrides?: Record<string, 'full' | 'short' | 'dropped'>;
  settings?: Record<string, unknown>;
}

export function makeSimWorld(o: { latencyMs?: number; resumeGrace?: number; recordInbox?: boolean } = {}) {
  const net = new MemoryNetwork({
    startTime: Date.UTC(2026, 9, 12, 0, 50, 0),
    ...(o.latencyMs ? { latencyMs: o.latencyMs } : {}),
    ...(o.resumeGrace !== undefined ? { config: { resumeGrace: o.resumeGrace } } : {}),
  });
  const now = () => net.now();
  const timers = new ManualTimers(now);
  const meter = new Meter(now);
  const reduceTimer = new ReduceTimer();
  const pageErrors: string[] = [];
  /** 서버가 보낸 오류 메시지(t:'error') — 속도 제한·크기 초과 등 */
  const serverErrors: string[] = [];
  const watchErrors = (raw: string) => {
    if (raw.includes('"t":"error"')) {
      try {
        const m = JSON.parse(raw) as { t?: string; code?: string };
        if (m.t === 'error') serverErrors.push(String(m.code));
      } catch {
        /* 무시 */
      }
    }
  };
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

  function meterClient(t: MemoryHost | MemoryPeer, out: Dir, inn: Dir, onIn?: (raw: string) => void) {
    const anyT = t as unknown as { sendRaw(d: string): void; receive(d: string): void };
    const origSend = anyT.sendRaw.bind(t);
    anyT.sendRaw = (d: string) => {
      meter.add(out, d);
      origSend(d);
    };
    const origRecv = anyT.receive.bind(t);
    anyT.receive = (d: string) => {
      meter.add(inn, d);
      onIn?.(d);
      origRecv(d);
    };
  }

  const timedReducer: SessionReducer<TeacherGame> = (snap, input, at) => {
    const t0 = performance.now();
    const r = teacherReducer(snap, input, at);
    reduceTimer.record(input.type === 'act' ? `act:${(input.action as { type?: string })?.type}` : input.type === 'teacher' ? `teacher:${input.action.type}` : input.type, performance.now() - t0);
    return r;
  };

  function host(opts: { storage?: MemStorage; ip?: string } = {}): SimHost {
    const transport = net.createHost({ ip: opts.ip ?? '1.1.1.1' });
    meterClient(transport, 'hostOut', 'hostIn', watchErrors);
    const storage = opts.storage ?? new MemStorage();
    const screenMsgs: JsonObject[] = [];
    const screenFactory = (_code: string): ScreenPublisher => ({
      publishToScreen: (p, cv) => screenMsgs.push(structuredClone({ publicState: p, classView: cv ?? null }) as JsonObject),
      codeChanged: (c) => screenMsgs.push({ codeChanged: c }),
      closed: () => undefined,
      dispose: () => undefined,
    });
    const session = createHostSession<TeacherGame>({
      transport,
      reducer: timedReducer,
      views: {
        // 공개 상태·공용 화면 보기는 strict(출석번호 키가 있으면 예외 → 시험 실패)
        public: (g) => teacherViews.public(g),
        me: teacherViews.me,
        screen: teacherViews.screen,
      },
      store: createHostStore({ storage, now }),
      appVersion: 'v1',
      now,
      timers,
      phaseOf: (g) => g.class.phase,
      resultTable: resultTableOf,
      screenFactory,
      strictPublic: true,
    });
    return {
      transport,
      session,
      storage,
      screenMsgs,
      teacher: (a) => session.dispatchTeacher(a),
      game: () => session.getView().game as TeacherGame,
    };
  }

  function student(seat: number, name: string, opts: { storage?: MemStorage; token?: string; ip?: string } = {}): SimStudent {
    const transport = net.createPeer({ ip: opts.ip ?? '2.2.2.2' });
    const inbox: JsonObject[] = [];
    meterClient(transport, 'studentOut', 'studentIn', (raw) => {
      watchErrors(raw);
      if (o.recordInbox !== false) inbox.push(...unwrapToApp(raw));
    });
    const storage = opts.storage ?? new MemStorage();
    const token = opts.token ?? `sim${String(++tokenSeq).padStart(6, '0')}abcdef0123456789abcd`;
    const peerStore = createPeerStore({ storage, now, randomToken: () => token });
    const origJoin = transport.join.bind(transport);
    transport.join = (code: string, hello: Parameters<MemoryPeer['join']>[1]) => {
      if (transport.getStatus() === 'offline') net.reconnect(transport);
      return origJoin(code, hello);
    };
    // RelayPeer(105)처럼: leave()는 연결을 닫지만 다음 join이 다시 연다(MemoryPeer는 영구히 닫으므로 흉내)
    transport.leave = () => {
      (transport as unknown as { resetRoom(): void }).resetRoom();
      net.disconnect(transport);
    };
    const store = createStudentStore({
      transport,
      href: 'http://localhost/voyage/#/play',
      peerStore,
      appVersion: 'v1',
      now,
      timers,
      deviceToken: null,
      rejoinDelayMs: () => 300,
    });
    const s: SimStudent = { seat, name, transport, store, storage, token, inbox, rollbacks: 0, errors: [] };
    return s;
  }

  async function openGame(h: SimHost, setup: GameSetup): Promise<string> {
    const game = newTeacherGame({
      className: '6학년 1반',
      playUnit: setup.playUnit,
      scope: setup.scope,
      tradeMinutes: setup.tradeMinutes,
      settings: { progressMode: setup.progressMode ?? 'auto', ...(setup.settings ?? {}) },
      overrides: setup.overrides ?? {},
      seed: setup.seed ?? 20261012,
      now: now(),
    });
    const r = await h.session.open({ game });
    if (!r.ok) throw new Error(`방 열기 실패 ${r.error}`);
    h.teacher({ type: 'setRoomCode', code: r.code });
    await advance(300);
    return r.code;
  }

  return { net, now, timers, advance, host, student, openGame, meter, reduceTimer, pageErrors, serverErrors };
}

export type SimWorld = ReturnType<typeof makeSimWorld>;

export { botAction, COMPANY_NAMES, rng } from './bot';
