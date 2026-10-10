/**
 * 세션 테스트 도구(작업 124): 메모리 저장소, 장난감 리듀서, MemoryNetwork + 가상 타이머 묶음.
 * 장난감 리듀서는 게임 규칙을 흉내만 낸다 — 개인 상태에 '비공개' 필드(secret)를 두어 새지 않는지 본다.
 */
import type { JsonObject } from '../../src/sync/adapter';
import { createHostSession, seatKey, type HostSession, type SessionInput, type SessionOutput } from '../../src/sync/host-session';
import { createHostStore, type HostStore, type ResultTable } from '../../src/sync/host-store';
import { MemoryNetwork, type MemoryHost, type MemoryPeer } from '../../src/sync/memory';
import { createPeerSession, type PeerSession } from '../../src/sync/peer-session';
import { createPeerStore, type PeerStore } from '../../src/sync/peer-store';
import type { ScreenPublisher } from '../../src/sync/screen-bridge';
import { ManualTimers } from '../../src/sync/throttle';

export class MemStorage {
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

// ───────────── 장난감 게임 ─────────────

export interface ToyPlayer {
  pid: string;
  name: string;
  blocked: boolean;
  money: number;
  secret: string;
  log: string[];
}
export interface ToyGame {
  class: { phase: string };
  ticks: number;
  gaps: number[];
  players: Record<string, ToyPlayer>;
  teacherLog: string[];
  pad?: string;
}
export type ToyAction = { type: 'buy'; n: number } | { type: 'setCompanyName'; name: string };

export const newToyGame = (phase = 'prep'): ToyGame => ({ class: { phase }, ticks: 0, gaps: [], players: {}, teacherLog: [] });

export function toyReducer(g: ToyGame, input: SessionInput): { snapshot: ToyGame; outputs: SessionOutput[] } {
  const n: ToyGame = structuredClone(g);
  const out: SessionOutput[] = [];
  switch (input.type) {
    case 'join':
      n.players[seatKey(input.seat)] = {
        pid: input.pid,
        name: input.companyName,
        blocked: false,
        money: 100,
        secret: `비밀-${input.pid}`,
        log: [],
      };
      out.push({ type: 'public' }, { type: 'me', seat: input.seat });
      break;
    case 'presence':
      break;
    case 'act': {
      const p = n.players[seatKey(input.seat)];
      const a = input.action as ToyAction;
      if (!p) {
        out.push({ type: 'ack', seat: input.seat, seq: input.seq, ok: false, error: 'NO_PLAYER' });
        break;
      }
      if (a.type === 'buy') {
        if (p.money < a.n) out.push({ type: 'ack', seat: input.seat, seq: input.seq, ok: false, error: 'NO_MONEY' });
        else {
          p.money -= a.n;
          p.log.push(`buy${a.n}`);
          out.push({ type: 'me', seat: input.seat }, { type: 'public' }, { type: 'ack', seat: input.seat, seq: input.seq, ok: true });
        }
      } else if (a.type === 'setCompanyName') {
        p.name = a.name;
        p.blocked = false;
        out.push({ type: 'public' }, { type: 'me', seat: input.seat });
      }
      break;
    }
    case 'teacher': {
      const a = input.action as { type: string; [k: string]: unknown };
      const key = typeof a.seat === 'number' ? seatKey(a.seat) : '';
      if (a.type === 'renameCompany' && n.players[key]) {
        n.players[key]!.name = String(a.name);
        n.players[key]!.blocked = false;
      } else if (a.type === 'blockCompanyName' && n.players[key]) n.players[key]!.blocked = true;
      else if (a.type === 'reassignSeat') {
        const from = seatKey(a.from as number);
        const to = seatKey(a.to as number);
        n.players[to] = n.players[from]!;
        delete n.players[from];
      } else if (a.type === 'kick') delete n.players[key];
      else if (a.type === 'setPhase') n.class.phase = String(a.phase);
      else if (a.type === 'note') {
        n.teacherLog.push(String(a.text));
        out.push({ type: 'teacher', data: { notes: n.teacherLog.length } });
      }
      out.push({ type: 'public' });
      break;
    }
    case 'tick':
      n.ticks++;
      break;
    case 'hostGap':
      n.gaps.push(input.gapMs);
      out.push({ type: 'public' });
      break;
  }
  return { snapshot: n, outputs: out };
}

export const toyViews = {
  public(g: ToyGame): JsonObject {
    const ps = Object.values(g.players).sort((a, b) => (a.pid < b.pid ? -1 : 1));
    return {
      phase: g.class.phase,
      joined: ps.length,
      total: ps.reduce((s, p) => s + p.money, 0),
      companies: ps.map((p) => ({ pid: p.pid, name: p.blocked ? null : p.name })),
      gaps: g.gaps.length,
    };
  },
  me(g: ToyGame, seat: number): JsonObject | null {
    const p = g.players[seatKey(seat)];
    return p ? ({ ...p, logbook: { count: p.log.length } } as unknown as JsonObject) : null;
  },
};

export function toyPredict(me: ToyPlayer, _pub: unknown, a: ToyAction): ToyPlayer {
  if (a.type === 'buy') {
    if (me.money < a.n) throw new Error('no money');
    return { ...me, money: me.money - a.n, log: [...me.log, `buy${a.n}`] };
  }
  return me;
}

export const toyResult = (g: ToyGame): ResultTable => ({
  playUnit: '차시마다 한 판',
  scope: 'L1',
  metrics: [
    { key: 'money', label: '최종 자산' },
    { key: 'buys', label: '거래 수' },
  ],
  rows: Object.entries(g.players).map(([k, p]) => ({
    seat: Number(k.slice(1)),
    values: { money: p.money, buys: p.log.length },
    awards: p.money < 100 ? ['무역왕상'] : [],
  })),
});

// ───────────── 세계(네트워크 + 시계) ─────────────

export interface Sent {
  peerId: string;
  msg: JsonObject;
}

export interface HostRig {
  transport: MemoryHost;
  session: HostSession<ToyGame>;
  store: HostStore;
  storage: MemStorage;
  sentTo: Sent[];
  broadcasts: { at: number; msg: JsonObject }[];
}

export interface StudentRig {
  transport: MemoryPeer;
  session: PeerSession<ToyPlayer, JsonObject, ToyAction>;
  store: PeerStore;
  storage: MemStorage;
  received: JsonObject[];
}

export function makeWorld(o: { resumeGrace?: number } = {}) {
  const net = new MemoryNetwork({
    startTime: Date.UTC(2026, 9, 9, 1, 0, 0),
    ...(o.resumeGrace !== undefined ? { config: { resumeGrace: o.resumeGrace } } : {}),
  });
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

  function host(
    opts: {
      storage?: MemStorage;
      ip?: string;
      strict?: boolean;
      screenFactory?: (code: string) => ScreenPublisher;
      views?: typeof toyViews;
      reducer?: typeof toyReducer;
    } = {},
  ): HostRig {
    const transport = net.createHost({ ip: opts.ip ?? '1.1.1.1' });
    const sentTo: Sent[] = [];
    const broadcasts: { at: number; msg: JsonObject }[] = [];
    const origTo = transport.sendTo.bind(transport);
    const origAll = transport.broadcast.bind(transport);
    transport.sendTo = (peerId: string, msg: object) => {
      const m = structuredClone(msg) as JsonObject;
      // 묶음(multi)은 풀어서 기록
      if (m.t === 'multi') for (const x of m.msgs as JsonObject[]) sentTo.push({ peerId, msg: x });
      else sentTo.push({ peerId, msg: m });
      origTo(peerId, msg);
    };
    transport.broadcast = (msg: object) => {
      broadcasts.push({ at: net.now(), msg: structuredClone(msg) as JsonObject });
      origAll(msg);
    };
    const storage = opts.storage ?? new MemStorage();
    const store = createHostStore({ storage, now });
    const session = createHostSession<ToyGame>({
      transport,
      reducer: opts.reducer ?? toyReducer,
      views: opts.views ?? toyViews,
      screenFactory: opts.screenFactory ?? null,
      store,
      appVersion: 'v1',
      now,
      timers,
      strictPublic: opts.strict ?? true,
      resultTable: toyResult,
    });
    return { transport, session, store, storage, sentTo, broadcasts };
  }

  function student(opts: { storage?: MemStorage; ip?: string; appVersion?: string } = {}): StudentRig {
    const transport = net.createPeer({ ip: opts.ip ?? '2.2.2.2' });
    const storage = opts.storage ?? new MemStorage();
    const store = createPeerStore({ storage, now, randomToken: () => `tok${String(++tokenSeq).padStart(8, '0')}abcdef` });
    const session = createPeerSession<ToyPlayer, JsonObject, ToyAction>({
      transport,
      predict: toyPredict,
      store,
      appVersion: opts.appVersion ?? 'v1',
      now,
      timers,
      rejoinDelayMs: () => 200,
    });
    // RelayAdapter(105)처럼: 서버가 방 밖 연결을 정리해 끊긴 뒤에는 다음 join 때 다시 연결
    const origJoin = transport.join.bind(transport);
    transport.join = (code: string, hello: Parameters<MemoryPeer['join']>[1]) => {
      if (transport.getStatus() === 'offline') net.reconnect(transport);
      return origJoin(code, hello);
    };
    const received: JsonObject[] = [];
    transport.onMessage((m) => {
      if (m.t === 'multi') received.push(...(m.msgs as JsonObject[]));
      else received.push(m);
    });
    return { transport, session, store, storage, received };
  }

  return { net, now, timers, advance, host, student };
}

export type World = ReturnType<typeof makeWorld>;

/** 학생 n명을 1번부터 입장시킴 */
export async function joinMany(w: World, code: string, n: number, from = 1): Promise<StudentRig[]> {
  const list: StudentRig[] = [];
  for (let i = 0; i < n; i++) {
    const s = w.student();
    list.push(s);
    void s.session.join(code, from + i, `회사${String.fromCharCode(0xac00 + (from + i) * 37)}무역`);
  }
  // 입장마다 호스트 메시지 2개(admit + 묶음) — 서버 속도 상한 안에서 나눠 보내므로 넉넉히
  await w.advance(Math.max(300, n * 120));
  return list;
}
