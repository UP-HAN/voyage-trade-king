/**
 * 중계 서버 부하 테스트 (작업 105 brief 16 → v0.3.1-6 → v0.3.2-5).
 *
 *   npm run loadtest -- --rooms 50 --students 30 --minutes 5
 *   (루트에서. 빌드 뒤 node server/dist/server/scripts/loadtest.js 를 실행한다)
 *
 * - 서버: 이 파일을 `--role server`로 fork한 자식 프로세스(실제 startRelayServer) — CPU·RSS를 따로 잰다.
 * - 부하 생성기: `--role worker` 자식 프로세스 여러 개(기본 4) — 생성기가 병목이 되지 않게 방을 나눠 맡는다.
 * - 방마다 호스트 1 + 학생 N. 학생은 interval(기본 0.3초)마다 200B 행동, 호스트는 학생 메시지마다 150B ack(host.to)
 *   + 1초마다 3KB 공개 상태(host.all). 메시지마다 보낸 시각을 넣어 받는 쪽에서 지연을 잰다(방의 호스트·학생이 같은 생성기
 *   프로세스에 있으므로 같은 시계).
 * - 단계: 기본 10 → 30 → 50방(각 단계 stageMinutes(2분) 측정, 마지막 단계는 minutes(5분)). 단계마다 지연 p50/p95/p99,
 *   서버 RSS 최대·평균, 서버 CPU(1코어 기준 %), 초당 메시지(생성기가 보낸 = 서버가 받은)·프레임(생성기가 받은 = 서버가 보낸)·
 *   바이트, 예기치 않은 끊김, 오류 코드 수.
 * - 상한 확인(--check-limits, 기본 켬): 기본 설정 서버에서 50방이 찬 뒤 51번째 host.open → BUSY + /health acceptingNewRooms:false,
 *   같은 IP 11번째 방 → ROOM_LIMIT(여러 학교는 X-Real-IP로 흉내).
 * - 로컬 전용: 서버는 127.0.0.1 임의 포트. 외부에 접속하지 않는다. 디스크에 쓰지 않는다(결과는 표준 출력).
 *
 * 부하 실행 때 서버 환경 변수: MAX_ROOMS_PER_IP=1000, ROOM_CREATE_LIMIT=1000, MAX_CONN_PER_IP=10000(생성기가 한 IP라서),
 * 메시지 속도 상한은 기본값 그대로(학생 MSG_RATE 20/s, 호스트 HOST_MSG_RATE 120/s — 이 부하 모양에서 호스트는 초당 약 101개).
 */
import { fork, type ChildProcess } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import WebSocket from 'ws';
import { createLogger, loadServerConfig, startRelayServer, type RelayServer } from '../src/index.js';

// ───────────────────────────── 선택지 ─────────────────────────────

export interface LoadOptions {
  rooms: number;
  students: number;
  /** 마지막 단계 측정 시간(분) */
  minutes: number;
  /** 단계(방 수). 기본: rooms가 50이면 10,30,50 */
  stages: number[];
  /** 마지막이 아닌 단계 측정 시간(분) */
  stageMinutes: number;
  /** 단계마다 측정 전 안정화(초) */
  warmupSec: number;
  workers: number;
  /** 학생 행동 간격(초) */
  interval: number;
  studentBytes: number;
  ackBytes: number;
  stateBytes: number;
  /** 서버 MAX_ROOMS(기본 max(50, rooms)) */
  maxRooms: number;
  checkLimits: boolean;
  /** 테스트용: 한 프로세스 안에서(서버·생성기 fork 없이) */
  inProcess: boolean;
  /** 진행 로그 출력 */
  quiet: boolean;
}

export function defaultStages(rooms: number): number[] {
  if (rooms >= 50) return [...new Set([10, Math.round(rooms * 0.6), rooms])].filter((n) => n <= rooms);
  if (rooms >= 3) return [...new Set([Math.max(1, Math.round(rooms / 5)), Math.round(rooms * 0.6), rooms])];
  return [rooms];
}

export function parseArgs(argv: string[]): LoadOptions {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    if (i >= 0) return argv[i + 1];
    const eq = argv.find((a) => a.startsWith(`--${name}=`));
    return eq ? eq.slice(name.length + 3) : undefined;
  };
  const num = (name: string, d: number) => {
    const v = get(name);
    if (v === undefined) return d;
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`--${name} 값이 잘못됐어요: ${v}`);
    return n;
  };
  const rooms = Math.floor(num('rooms', 50));
  const stagesRaw = get('stages');
  const stages = stagesRaw ? stagesRaw.split(',').map((s) => Math.floor(Number(s))).filter((n) => n > 0) : defaultStages(rooms);
  return {
    rooms,
    students: Math.floor(num('students', 30)),
    minutes: num('minutes', 5),
    stages: stages.length ? stages : [rooms],
    stageMinutes: num('stage-minutes', 2),
    warmupSec: num('warmup', 10),
    workers: Math.floor(num('workers', 4)),
    interval: num('interval', 0.3),
    studentBytes: Math.floor(num('student-bytes', 200)),
    ackBytes: Math.floor(num('ack-bytes', 150)),
    stateBytes: Math.floor(num('state-bytes', 3000)),
    maxRooms: Math.floor(num('max-rooms', Math.max(50, rooms))),
    checkLimits: get('check-limits') !== '0' && !argv.includes('--no-check-limits'),
    inProcess: argv.includes('--in-process'),
    quiet: argv.includes('--quiet'),
  };
}

// ───────────────────────────── 히스토그램 ─────────────────────────────

/** 0.1ms 칸, 최대 10초(넘으면 마지막 칸) */
const BIN_MS = 0.1;
const BINS = 100_000;

class Histogram {
  bins = new Uint32Array(BINS);
  count = 0;
  max = 0;
  add(ms: number) {
    const v = ms < 0 ? 0 : ms;
    const i = Math.min(BINS - 1, Math.floor(v / BIN_MS));
    this.bins[i]!++;
    this.count++;
    if (v > this.max) this.max = v;
  }
  reset() {
    this.bins.fill(0);
    this.count = 0;
    this.max = 0;
  }
  /** 희소 형태(IPC로 보내기) */
  toSparse(): { i: number[]; n: number[]; count: number; max: number } {
    const i: number[] = [];
    const n: number[] = [];
    for (let k = 0; k < BINS; k++) if (this.bins[k]) {
      i.push(k);
      n.push(this.bins[k]!);
    }
    return { i, n, count: this.count, max: this.max };
  }
  merge(s: { i: number[]; n: number[]; count: number; max: number }) {
    s.i.forEach((k, j) => (this.bins[k]! += s.n[j]!));
    this.count += s.count;
    if (s.max > this.max) this.max = s.max;
  }
  pct(p: number): number {
    if (!this.count) return NaN;
    const target = Math.ceil((p / 100) * this.count);
    let acc = 0;
    for (let k = 0; k < BINS; k++) {
      acc += this.bins[k]!;
      if (acc >= target) return k === BINS - 1 ? this.max : (k + 1) * BIN_MS;
    }
    return this.max;
  }
}

// ───────────────────────────── 부하 생성기 ─────────────────────────────

interface GenSpec {
  url: string;
  origin: string;
  students: number;
  intervalMs: number;
  studentBytes: number;
  ackBytes: number;
  stateBytes: number;
}

interface GenCollect {
  hist: { up: ReturnType<Histogram['toSparse']>; ack: ReturnType<Histogram['toSparse']>; state: ReturnType<Histogram['toSparse']> };
  sent: number;
  sentBytes: number;
  recvFrames: number;
  recvBytes: number;
  errors: Record<string, number>;
  unexpectedClose: number;
  cpuUserUs: number;
  cpuSystemUs: number;
  wallMs: number;
  conns: number;
  rooms: number;
}

const pad = (n: number) => 'x'.repeat(Math.max(0, n));

/** 메시지 크기를 목표 바이트에 맞추기 위한 덧붙임 길이 */
function padFor(target: number, base: object): number {
  return Math.max(0, target - Buffer.byteLength(JSON.stringify({ ...base, p: '' })));
}

class Generator {
  private readonly up = new Histogram();
  private readonly ack = new Histogram();
  private readonly state = new Histogram();
  private sent = 0;
  private sentBytes = 0;
  private recvFrames = 0;
  private recvBytes = 0;
  private errors: Record<string, number> = {};
  private unexpectedClose = 0;
  private sockets = new Set<WebSocket>();
  private timers = new Set<ReturnType<typeof setInterval>>();
  private stopping = false;
  private roomCount = 0;
  private cpu0 = process.cpuUsage();
  private wall0 = performance.now();
  private readonly studentPad: number;
  private readonly ackPad: number;
  private readonly statePad: number;

  constructor(private readonly spec: GenSpec) {
    this.studentPad = padFor(spec.studentBytes, { v: 3, t: 'peer.msg', msg: { k: 'a', ts: 123456.1234 } });
    this.ackPad = padFor(spec.ackBytes, { v: 3, t: 'host.to', peerId: 'p1abc', msg: { k: 'ack', ts: 123456.1234 } });
    this.statePad = padFor(spec.stateBytes, { v: 3, t: 'host.all', msg: { k: 'st', ts: 123456.1234 } });
  }

  private open(): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.spec.url, { origin: this.spec.origin, perMessageDeflate: false });
      ws.once('open', () => resolve(ws));
      ws.once('error', reject);
      ws.on('close', () => {
        this.sockets.delete(ws);
        if (!this.stopping) this.unexpectedClose++;
      });
      this.sockets.add(ws);
    });
  }

  private send(ws: WebSocket, obj: object) {
    if (ws.readyState !== WebSocket.OPEN) return;
    const s = JSON.stringify(obj);
    this.sent++;
    this.sentBytes += s.length;
    ws.send(s);
  }

  private onFrame(data: WebSocket.RawData): Record<string, unknown> {
    const s = String(data);
    this.recvFrames++;
    this.recvBytes += Buffer.byteLength(s);
    const m = JSON.parse(s) as Record<string, unknown>;
    if (m.t === 'error') this.errors[String(m.code)] = (this.errors[String(m.code)] ?? 0) + 1;
    return m;
  }

  /** 방 하나: 호스트 열기 → 학생 N 입장·허락 → 메시지 시작 */
  async addRoom(): Promise<void> {
    const host = await this.open();
    const code = await new Promise<string>((resolve, reject) => {
      const onMsg = (d: WebSocket.RawData) => {
        const m = this.onFrame(d);
        if (m.t === 'room.opened') {
          host.off('message', onMsg);
          resolve(m.code as string);
        } else if (m.t === 'error') reject(new Error(`host.open ${String(m.code)}`));
      };
      host.on('message', onMsg);
      this.send(host, { v: 3, t: 'host.open', maxPeers: 45 });
    });
    const now = () => performance.now();
    host.on('message', (d) => {
      const m = this.onFrame(d);
      if (m.t === 'peer.hello') this.send(host, { v: 3, t: 'host.admit', peerId: m.peerId });
      else if (m.t === 'peer.msg') {
        const msg = m.msg as { ts: number };
        this.up.add(now() - msg.ts);
        this.send(host, { v: 3, t: 'host.to', peerId: m.peerId, msg: { k: 'ack', ts: now(), p: pad(this.ackPad) } });
      }
    });
    const peers: WebSocket[] = [];
    await Promise.all(
      Array.from({ length: this.spec.students }, async (_x, i) => {
        const p = await this.open();
        await new Promise<void>((resolve, reject) => {
          p.on('message', (d) => {
            const m = this.onFrame(d);
            if (m.t === 'admitted') resolve();
            else if (m.t === 'host.to') this.ack.add(now() - (m.msg as { ts: number }).ts);
            else if (m.t === 'host.all') this.state.add(now() - (m.msg as { ts: number }).ts);
            else if (m.t === 'error') reject(new Error(`peer.join ${String(m.code)}`));
          });
          this.send(p, { v: 3, t: 'peer.join', code, hello: { seat: i + 1 } });
        });
        peers.push(p);
      }),
    );
    // 학생 행동: 처음 위상을 흩뜨림
    for (const p of peers) {
      const start = setTimeout(() => {
        const t = setInterval(() => this.send(p, { v: 3, t: 'peer.msg', msg: { k: 'a', ts: now(), p: pad(this.studentPad) } }), this.spec.intervalMs);
        this.timers.add(t);
      }, Math.random() * this.spec.intervalMs);
      this.timers.add(start as unknown as ReturnType<typeof setInterval>);
    }
    // 공개 상태 1초마다
    const st = setInterval(() => this.send(host, { v: 3, t: 'host.all', msg: { k: 'st', ts: now(), p: pad(this.statePad) } }), 1000);
    this.timers.add(st);
    this.roomCount++;
  }

  reset() {
    this.up.reset();
    this.ack.reset();
    this.state.reset();
    this.sent = this.sentBytes = this.recvFrames = this.recvBytes = 0;
    this.errors = {};
    this.unexpectedClose = 0;
    this.cpu0 = process.cpuUsage();
    this.wall0 = performance.now();
  }

  collect(): GenCollect {
    const cpu = process.cpuUsage(this.cpu0);
    return {
      hist: { up: this.up.toSparse(), ack: this.ack.toSparse(), state: this.state.toSparse() },
      sent: this.sent,
      sentBytes: this.sentBytes,
      recvFrames: this.recvFrames,
      recvBytes: this.recvBytes,
      errors: { ...this.errors },
      unexpectedClose: this.unexpectedClose,
      cpuUserUs: cpu.user,
      cpuSystemUs: cpu.system,
      wallMs: performance.now() - this.wall0,
      conns: this.sockets.size,
      rooms: this.roomCount,
    };
  }

  async stop() {
    this.stopping = true;
    for (const t of this.timers) clearInterval(t);
    this.timers.clear();
    for (const ws of this.sockets) ws.terminate();
    this.sockets.clear();
  }
}

// ───────────────────────────── 서버 측정 ─────────────────────────────

interface ServerSample {
  rssMaxMB: number;
  rssAvgMB: number;
  cpuPct: number;
  wallMs: number;
}

class ServerMeter {
  private cpu0 = process.cpuUsage();
  private wall0 = performance.now();
  private rssMax = 0;
  private rssSum = 0;
  private rssN = 0;
  private timer: ReturnType<typeof setInterval>;
  constructor() {
    this.timer = setInterval(() => this.sample(), 1000);
    this.timer.unref();
  }
  private sample() {
    const r = process.memoryUsage.rss();
    if (r > this.rssMax) this.rssMax = r;
    this.rssSum += r;
    this.rssN++;
  }
  reset() {
    this.cpu0 = process.cpuUsage();
    this.wall0 = performance.now();
    this.rssMax = 0;
    this.rssSum = 0;
    this.rssN = 0;
    this.sample();
  }
  collect(): ServerSample {
    this.sample();
    const cpu = process.cpuUsage(this.cpu0);
    const wall = performance.now() - this.wall0;
    const MB = 1024 * 1024;
    return {
      rssMaxMB: this.rssMax / MB,
      rssAvgMB: this.rssN ? this.rssSum / this.rssN / MB : 0,
      cpuPct: wall > 0 ? ((cpu.user + cpu.system) / 1000 / wall) * 100 : 0,
      wallMs: wall,
    };
  }
  stop() {
    clearInterval(this.timer);
  }
}

/** 부하 실행용 서버 환경 변수 */
export function loadServerEnv(o: Pick<LoadOptions, 'maxRooms'>): Record<string, string> {
  return {
    HOST: '127.0.0.1',
    PORT: '0',
    ALLOWED_ORIGINS: 'http://loadtest.localhost',
    TRUST_PROXY: '127.0.0.1',
    NOTICE_FILE: '/nonexistent/voyage-loadtest-notice.json',
    LOG_LEVEL: 'warn',
    MAX_ROOMS: String(o.maxRooms),
    MAX_CONN: String(o.maxRooms * 46),
    MAX_ROOMS_PER_IP: '1000',
    ROOM_CREATE_LIMIT: '1000',
    MAX_CONN_PER_IP: '10000',
  };
}

const ORIGIN = 'http://loadtest.localhost';

async function startServerHere(env: Record<string, string>): Promise<RelayServer> {
  const config = loadServerConfig(env);
  return startRelayServer({ config, logger: createLogger(config.logLevel, (l) => process.stderr.write(l + '\n')), version: 'loadtest' });
}

// ───────────────────────────── 자식 프로세스 역할 ─────────────────────────────

type Ipc = { id?: number; type: string; [k: string]: unknown };

function serveIpc(handler: (m: Ipc) => Promise<unknown>) {
  process.on('message', (m: Ipc) => {
    handler(m).then(
      (r) => process.send?.({ id: m.id, ok: true, result: r }),
      (e: unknown) => process.send?.({ id: m.id, ok: false, error: String((e as Error)?.message ?? e) }),
    );
  });
}

async function roleServer() {
  const env = JSON.parse(process.env.LOADTEST_SERVER_ENV ?? '{}') as Record<string, string>;
  const server = await startServerHere(env);
  const meter = new ServerMeter();
  serveIpc(async (m) => {
    if (m.type === 'port') return server.port;
    if (m.type === 'reset') return meter.reset();
    if (m.type === 'collect') return { ...meter.collect(), health: server.health() };
    if (m.type === 'stop') {
      meter.stop();
      await server.close();
      setTimeout(() => process.exit(0), 50);
      return true;
    }
    throw new Error(`모르는 요청 ${m.type}`);
  });
  process.send?.({ type: 'ready' });
}

async function roleWorker() {
  let gen: Generator | null = null;
  serveIpc(async (m) => {
    if (m.type === 'init') {
      gen = new Generator(m.spec as GenSpec);
      return true;
    }
    if (!gen) throw new Error('init 먼저');
    if (m.type === 'add') {
      const n = m.n as number;
      // 방을 조금씩(한 번에 2개) 연다 — 입장 폭주를 피함
      for (let i = 0; i < n; i += 2) await Promise.all(Array.from({ length: Math.min(2, n - i) }, () => gen!.addRoom()));
      return true;
    }
    if (m.type === 'reset') return gen.reset();
    if (m.type === 'collect') return gen.collect();
    if (m.type === 'stop') {
      await gen.stop();
      setTimeout(() => process.exit(0), 50);
      return true;
    }
    throw new Error(`모르는 요청 ${m.type}`);
  });
  process.send?.({ type: 'ready' });
}

// ───────────────────────────── 부모: 조율 ─────────────────────────────

/** 자식 하나(또는 같은 프로세스 안의 대리)에 요청 보내기 */
interface Remote {
  call<T>(type: string, extra?: Record<string, unknown>): Promise<T>;
  kill(): void;
}

function forkRemote(role: 'server' | 'worker', env: Record<string, string> = {}): Promise<Remote> {
  const file = fileURLToPath(import.meta.url);
  const child: ChildProcess = fork(file, ['--role', role], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  let seq = 0;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  return new Promise((resolve, reject) => {
    child.on('message', (m: { id?: number; type?: string; ok?: boolean; result?: unknown; error?: string }) => {
      if (m.type === 'ready') {
        resolve({
          call<T>(type: string, extra: Record<string, unknown> = {}) {
            const id = ++seq;
            return new Promise<T>((res, rej) => {
              pending.set(id, { resolve: res as (v: unknown) => void, reject: rej });
              child.send({ id, type, ...extra });
            });
          },
          kill() {
            if (child.exitCode === null) child.kill();
          },
        });
        return;
      }
      if (m.id === undefined) return;
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.ok) p.resolve(m.result);
      else p.reject(new Error(m.error));
    });
    child.once('exit', (code) => {
      for (const p of pending.values()) p.reject(new Error(`${role} 프로세스 종료(${code})`));
      reject(new Error(`${role} 프로세스가 준비 전에 끝남(${code})`));
    });
  });
}

/** 같은 프로세스 안의 대리(스모크 테스트) */
async function localServerRemote(env: Record<string, string>): Promise<Remote> {
  const server = await startServerHere(env);
  const meter = new ServerMeter();
  return {
    async call<T>(type: string): Promise<T> {
      if (type === 'port') return server.port as T;
      if (type === 'reset') return meter.reset() as T;
      if (type === 'collect') return { ...meter.collect(), health: server.health() } as T;
      if (type === 'stop') {
        meter.stop();
        await server.close();
        return true as T;
      }
      throw new Error(type);
    },
    kill() {},
  };
}

function localWorkerRemote(): Remote {
  let gen: Generator | null = null;
  return {
    async call<T>(type: string, extra: Record<string, unknown> = {}): Promise<T> {
      if (type === 'init') {
        gen = new Generator(extra.spec as GenSpec);
        return true as T;
      }
      if (!gen) throw new Error('init');
      if (type === 'add') {
        for (let i = 0; i < (extra.n as number); i++) await gen.addRoom();
        return true as T;
      }
      if (type === 'reset') return gen.reset() as T;
      if (type === 'collect') return gen.collect() as T;
      if (type === 'stop') return (await gen.stop()) as T;
      throw new Error(type);
    },
    kill() {},
  };
}

export interface StageRow {
  rooms: number;
  conns: number;
  seconds: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  /** 종류별 p95: 학생→호스트, ack, 공개 상태 */
  p95up: number;
  p95ack: number;
  p95state: number;
  samples: number;
  serverRssMaxMB: number;
  serverRssAvgMB: number;
  serverCpuPct: number;
  genCpuPct: number;
  inPerSec: number;
  outFramesPerSec: number;
  outBytesPerSec: number;
  inBytesPerSec: number;
  unexpectedClose: number;
  errors: Record<string, number>;
}

export interface LimitCheck {
  busyAt51: boolean;
  healthAcceptingFalse: boolean;
  roomLimitAt11: boolean;
  detail: string;
}

export interface LoadResult {
  options: LoadOptions;
  stages: StageRow[];
  limits: LimitCheck | null;
  platform: string;
}

const sleepMs = (ms: number) => new Promise((r) => setTimeout(r, ms));

function log(o: LoadOptions, s: string) {
  if (!o.quiet) process.stdout.write(s + '\n');
}

export async function runLoadTest(o: LoadOptions): Promise<LoadResult> {
  const env = loadServerEnv(o);
  const server = o.inProcess ? await localServerRemote(env) : await forkRemote('server', { LOADTEST_SERVER_ENV: JSON.stringify(env) });
  const workers: Remote[] = [];
  const result: LoadResult = { options: o, stages: [], limits: null, platform: `${process.platform} ${process.arch} node ${process.version}` };
  try {
    const port = await server.call<number>('port');
    const url = `ws://127.0.0.1:${port}/ws`;
    const nWorkers = o.inProcess ? 1 : Math.max(1, Math.min(o.workers, o.rooms));
    for (let i = 0; i < nWorkers; i++) workers.push(o.inProcess ? localWorkerRemote() : await forkRemote('worker'));
    const spec: GenSpec = {
      url,
      origin: ORIGIN,
      students: o.students,
      intervalMs: o.interval * 1000,
      studentBytes: o.studentBytes,
      ackBytes: o.ackBytes,
      stateBytes: o.stateBytes,
    };
    await Promise.all(workers.map((w) => w.call('init', { spec })));
    log(o, `부하 테스트: 방 ${o.stages.join(' → ')} × (호스트 1 + 학생 ${o.students}), 생성기 ${nWorkers}개, 서버 ${url}`);

    let current = 0;
    const stages = o.stages.filter((n) => n <= o.rooms);
    for (let si = 0; si < stages.length; si++) {
      const target = stages[si]!;
      const add = target - current;
      // 방을 생성기에 고르게 나눔
      const per = workers.map((_w, i) => Math.floor(add / nWorkers) + (i < add % nWorkers ? 1 : 0));
      const t0 = Date.now();
      await Promise.all(workers.map((w, i) => (per[i]! > 0 ? w.call('add', { n: per[i] }) : Promise.resolve())));
      current = target;
      log(o, `  방 ${target}개 준비(${((Date.now() - t0) / 1000).toFixed(1)}초) → 안정화 ${o.warmupSec}초`);
      await sleepMs(o.warmupSec * 1000);
      await Promise.all([server.call('reset'), ...workers.map((w) => w.call('reset'))]);
      const last = si === stages.length - 1;
      const measureMs = (last ? o.minutes : o.stageMinutes) * 60_000;
      log(o, `  측정 ${(measureMs / 1000).toFixed(0)}초…`);
      await sleepMs(measureMs);
      const [srv, ...gens] = await Promise.all([
        server.call<ServerSample & { health: { conns: number; rooms: number } }>('collect'),
        ...workers.map((w) => w.call<GenCollect>('collect')),
      ]);
      const all = new Histogram();
      const up = new Histogram();
      const ack = new Histogram();
      const state = new Histogram();
      let sent = 0;
      let sentBytes = 0;
      let recvFrames = 0;
      let recvBytes = 0;
      let unexpected = 0;
      let genCpuUs = 0;
      let wall = 0;
      const errors: Record<string, number> = {};
      for (const g of gens) {
        for (const h of [g.hist.up, g.hist.ack, g.hist.state]) all.merge(h);
        up.merge(g.hist.up);
        ack.merge(g.hist.ack);
        state.merge(g.hist.state);
        sent += g.sent;
        sentBytes += g.sentBytes;
        recvFrames += g.recvFrames;
        recvBytes += g.recvBytes;
        unexpected += g.unexpectedClose;
        genCpuUs += g.cpuUserUs + g.cpuSystemUs;
        wall = Math.max(wall, g.wallMs);
        for (const [k, v] of Object.entries(g.errors)) errors[k] = (errors[k] ?? 0) + v;
      }
      const sec = wall / 1000;
      const r1 = (x: number) => Math.round(x * 10) / 10;
      const row: StageRow = {
        rooms: target,
        conns: srv.health.conns,
        seconds: Math.round(sec),
        p50: r1(all.pct(50)),
        p95: r1(all.pct(95)),
        p99: r1(all.pct(99)),
        max: r1(all.max),
        p95up: r1(up.pct(95)),
        p95ack: r1(ack.pct(95)),
        p95state: r1(state.pct(95)),
        samples: all.count,
        serverRssMaxMB: r1(srv.rssMaxMB),
        serverRssAvgMB: r1(srv.rssAvgMB),
        serverCpuPct: r1(srv.cpuPct),
        genCpuPct: r1((genCpuUs / 1000 / wall) * 100),
        inPerSec: Math.round(sent / sec),
        outFramesPerSec: Math.round(recvFrames / sec),
        outBytesPerSec: Math.round(recvBytes / sec),
        inBytesPerSec: Math.round(sentBytes / sec),
        unexpectedClose: unexpected,
        errors,
      };
      result.stages.push(row);
      log(
        o,
        `  방 ${row.rooms} · 연결 ${row.conns}: 지연 p50 ${row.p50}ms p95 ${row.p95}ms p99 ${row.p99}ms (최대 ${row.max}) · 서버 RSS 최대 ${row.serverRssMaxMB}MB 평균 ${row.serverRssAvgMB}MB · 서버 CPU ${row.serverCpuPct}% · 생성기 CPU ${row.genCpuPct}% · 들어옴 ${row.inPerSec}/s · 나감 ${row.outFramesPerSec}프레임/s ${(row.outBytesPerSec / 1e6).toFixed(2)}MB/s · 끊김 ${row.unexpectedClose} · 오류 ${JSON.stringify(row.errors)}`,
      );
    }
  } finally {
    await Promise.allSettled(workers.map((w) => w.call('stop')));
    await server.call('stop').catch(() => undefined);
    for (const w of workers) w.kill();
    server.kill();
  }
  if (o.checkLimits) result.limits = await checkLimits(o);
  return result;
}

// ───────────────────────────── 상한 확인 ─────────────────────────────

function getHealth(port: number): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path: '/health', method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve(JSON.parse(body) as Record<string, unknown>));
    });
    req.on('error', reject);
    req.end();
  });
}

/** 기본 설정(MAX_ROOMS 50, IP 한도 기본) 서버: 51번째 BUSY·/health false·같은 IP 11번째 ROOM_LIMIT */
export async function checkLimits(o: Pick<LoadOptions, 'quiet'>): Promise<LimitCheck> {
  const server = await startServerHere({
    HOST: '127.0.0.1',
    PORT: '0',
    ALLOWED_ORIGINS: ORIGIN,
    TRUST_PROXY: '127.0.0.1',
    NOTICE_FILE: '/nonexistent/voyage-loadtest-notice.json',
    LOG_LEVEL: 'warn',
  });
  const url = `ws://127.0.0.1:${server.port}/ws`;
  const sockets: WebSocket[] = [];
  const openRoomAs = (ip: string) =>
    new Promise<{ ws: WebSocket; reply: Record<string, unknown> }>((resolve, reject) => {
      const ws = new WebSocket(url, { origin: ORIGIN, headers: { 'X-Real-IP': ip } });
      sockets.push(ws);
      ws.on('error', reject);
      ws.on('open', () => ws.send(JSON.stringify({ v: 3, t: 'host.open', maxPeers: 30 })));
      ws.on('message', (d) => {
        const m = JSON.parse(String(d)) as Record<string, unknown>;
        if (m.t === 'room.opened' || m.t === 'error') resolve({ ws, reply: m });
      });
    });
  try {
    const opened: WebSocket[] = [];
    for (let school = 0; school < 5; school++) {
      for (let i = 0; i < 10; i++) {
        const r = await openRoomAs(`10.0.${school}.1`);
        if (r.reply.t !== 'room.opened') throw new Error(`방 ${opened.length + 1} 열기 실패 ${JSON.stringify(r.reply)}`);
        opened.push(r.ws);
      }
    }
    const r51 = await openRoomAs('10.0.9.1');
    const h1 = await getHealth(server.port);
    // 한 방 닫고 같은 IP에서 11번째
    opened[49]!.send(JSON.stringify({ v: 3, t: 'host.close' }));
    await sleepMs(100);
    const r11 = await openRoomAs('10.0.0.1');
    const out: LimitCheck = {
      busyAt51: r51.reply.t === 'error' && r51.reply.code === 'BUSY',
      healthAcceptingFalse: h1.acceptingNewRooms === false && h1.rooms === 50,
      roomLimitAt11: r11.reply.t === 'error' && r11.reply.code === 'ROOM_LIMIT',
      detail: `51번째: ${JSON.stringify(r51.reply)} / health: rooms ${String(h1.rooms)}, acceptingNewRooms ${String(h1.acceptingNewRooms)} / 같은 IP 11번째: ${JSON.stringify(r11.reply)}`,
    };
    log({ quiet: o.quiet } as LoadOptions, `상한 확인: ${out.busyAt51 && out.healthAcceptingFalse && out.roomLimitAt11 ? '통과' : '실패'} — ${out.detail}`);
    return out;
  } finally {
    for (const ws of sockets) ws.terminate();
    await server.close();
  }
}

// ───────────────────────────── 진입 ─────────────────────────────

function printTable(r: LoadResult) {
  const lines = [
    '',
    '| 방 | 연결 | 측정(초) | p50 ms | p95 ms | p99 ms | 서버 RSS 최대/평균 MB | 서버 CPU %(1코어) | 생성기 CPU % | 들어옴 msg/s | 나감 프레임/s | 나감 MB/s | 끊김 | 오류 |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...r.stages.map(
      (s) =>
        `| ${s.rooms} | ${s.conns} | ${s.seconds} | ${s.p50} | ${s.p95} | ${s.p99} | ${s.serverRssMaxMB} / ${s.serverRssAvgMB} | ${s.serverCpuPct} | ${s.genCpuPct} | ${s.inPerSec} | ${s.outFramesPerSec} | ${(s.outBytesPerSec / 1e6).toFixed(2)} | ${s.unexpectedClose} | ${Object.keys(s.errors).length ? JSON.stringify(s.errors) : 0} |`,
    ),
    '',
  ];
  process.stdout.write(lines.join('\n') + '\n');
  process.stdout.write('JSON ' + JSON.stringify({ stages: r.stages, limits: r.limits, platform: r.platform }) + '\n');
}

const isMain = (() => {
  try {
    if (!process.argv[1]) return false;
    const norm = (x: string) => (process.platform === 'win32' ? resolve(x).toLowerCase() : resolve(x));
    return norm(fileURLToPath(import.meta.url)) === norm(process.argv[1]);
  } catch {
    return false;
  }
})();

if (isMain) {
  const argv = process.argv.slice(2);
  const ri = argv.indexOf('--role');
  const role = ri >= 0 ? argv[ri + 1] : 'main';
  if (role === 'server') void roleServer();
  else if (role === 'worker') void roleWorker();
  else {
    runLoadTest(parseArgs(argv))
      .then((r) => {
        printTable(r);
        process.exit(0);
      })
      .catch((e: unknown) => {
        process.stderr.write(`부하 테스트 실패: ${String((e as Error)?.stack ?? e)}\n`);
        process.exit(1);
      });
  }
}
