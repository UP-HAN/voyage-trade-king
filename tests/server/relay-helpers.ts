/**
 * 중계 서버 테스트 도우미: 실제 서버를 임의 포트(PORT=0)로 띄우고 `ws` 클라이언트로 붙는다.
 * 테스트용 임시 공지 파일은 OS 임시 폴더에 쓴다(서버 코드는 읽기만 함).
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import {
  createLogger,
  loadServerConfig,
  startRelayServer,
  type RelayServer,
  type RelayServerOptions,
  type RelayTimers,
} from '../../server/src/index';

export const TEST_ORIGIN = 'http://localhost:5173';

export interface TestServer {
  server: RelayServer;
  port: number;
  url: string;
  http: string;
  logs: string[];
  noticeFile: string;
  writeNotice(content: string | object | null): void;
  stop(): Promise<void>;
}

/** 임시 폴더 하나(테스트 끝에 지움) */
export function tempDir(): { dir: string; cleanup(): Promise<void> } {
  const dir = mkdtempSync(join(tmpdir(), 'voyage-relay-test-'));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

export async function startTestServer(
  env: Record<string, string> = {},
  timers: Partial<RelayTimers> = {},
  opts: { port?: number; noticeFile?: string; wrapCore?: RelayServerOptions['wrapCore'] } = {},
): Promise<TestServer> {
  const tmp = opts.noticeFile ? null : tempDir();
  const noticeFile = opts.noticeFile ?? join(tmp!.dir, 'notice.json');
  const logs: string[] = [];
  const config = loadServerConfig({
    HOST: '127.0.0.1',
    PORT: String(opts.port ?? 0),
    ALLOW_LOCALHOST: '1',
    NOTICE_FILE: noticeFile,
    LOG_LEVEL: 'debug',
    ...env,
  });
  const server = await startRelayServer({
    config,
    logger: createLogger(config.logLevel, (l) => logs.push(l)),
    version: 'test',
    timers: { shutdownGraceMs: 200, ...timers },
    ...(opts.wrapCore ? { wrapCore: opts.wrapCore } : {}),
  });
  const port = server.port;
  return {
    server,
    port,
    url: `ws://127.0.0.1:${port}/ws`,
    http: `http://127.0.0.1:${port}`,
    logs,
    noticeFile,
    writeNotice(content) {
      if (content === null) writeFileSync(noticeFile, '');
      else writeFileSync(noticeFile, typeof content === 'string' ? content : JSON.stringify(content));
    },
    async stop() {
      await server.close();
      await tmp?.cleanup();
    },
  };
}

export type Msg = Record<string, unknown> & { t?: string };

/** 받은 메시지를 모아 두고 기다릴 수 있는 ws 클라이언트 */
export class TestClient {
  readonly msgs: Msg[] = [];
  readonly ws: WebSocket;
  closeCode: number | null = null;
  readonly opened: Promise<void>;
  readonly closed: Promise<number>;
  private waiters: Array<() => void> = [];

  constructor(url: string, o: { origin?: string | null; realIp?: string; autoPong?: boolean } = {}) {
    const headers: Record<string, string> = {};
    if (o.realIp) headers['X-Real-IP'] = o.realIp;
    this.ws = new WebSocket(url, {
      ...(o.origin === null ? {} : { origin: o.origin ?? TEST_ORIGIN }),
      headers,
      ...(o.autoPong === false ? { autoPong: false } : {}),
    });
    this.opened = new Promise((resolve, reject) => {
      this.ws.once('open', () => resolve());
      this.ws.once('error', reject);
    });
    this.closed = new Promise((resolve) => {
      this.ws.on('close', (code) => {
        this.closeCode = code;
        this.wake();
        resolve(code);
      });
    });
    this.ws.on('error', () => {
      /* closed가 처리 */
    });
    this.ws.on('message', (d) => {
      try {
        this.msgs.push(JSON.parse(String(d)) as Msg);
      } catch {
        /* 무시 */
      }
      this.wake();
    });
  }

  private wake() {
    for (const w of this.waiters.splice(0)) w();
  }

  send(m: object | string) {
    this.ws.send(typeof m === 'string' ? m : JSON.stringify({ v: 3, ...m }));
  }

  /** 조건에 맞는 메시지를 기다림(이미 받았으면 바로). 꺼내지 않는다 */
  async wait(pred: (m: Msg) => boolean, ms = 3000): Promise<Msg> {
    const end = Date.now() + ms;
    for (;;) {
      const found = this.msgs.find(pred);
      if (found) return found;
      const left = end - Date.now();
      if (left <= 0) throw new Error(`메시지를 기다리다 시간 초과: 받은 것 ${JSON.stringify(this.msgs.map((m) => m.t))}`);
      await new Promise<void>((r) => {
        const t = setTimeout(r, left);
        this.waiters.push(() => {
          clearTimeout(t);
          r();
        });
      });
    }
  }

  waitT(t: string, ms?: number) {
    return this.wait((m) => m.t === t, ms);
  }

  count(t: string) {
    return this.msgs.filter((m) => m.t === t).length;
  }

  close() {
    this.ws.close();
  }
}

export async function connect(url: string, o?: ConstructorParameters<typeof TestClient>[1]): Promise<TestClient> {
  const c = new TestClient(url, o);
  await c.opened;
  return c;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 호스트 연결 + 방 열기 */
export async function openRoom(url: string, o: { realIp?: string; maxPeers?: number } = {}) {
  const host = await connect(url, o.realIp ? { realIp: o.realIp } : {});
  host.send({ t: 'host.open', maxPeers: o.maxPeers ?? 40 });
  const m = await host.wait((x) => x.t === 'room.opened' || x.t === 'error');
  if (m.t !== 'room.opened') throw new Error(`방 열기 실패 ${JSON.stringify(m)}`);
  return { host, code: m.code as string, hostToken: m.hostToken as string };
}

/** 학생 입장 + 호스트가 admit */
export async function joinAndAdmit(url: string, host: TestClient, code: string, hello: object) {
  const peer = await connect(url);
  peer.send({ t: 'peer.join', code, hello });
  const pending = await peer.waitT('peer.pending');
  const peerId = pending.peerId as string;
  await host.wait((m) => m.t === 'peer.hello' && m.peerId === peerId);
  host.send({ t: 'host.admit', peerId });
  await peer.waitT('admitted');
  return { peer, peerId };
}
