/**
 * 작업 114 e2e 전용 서버 도구(실제 배포 구조 흉내 — PRD 10.9, docs/server-setup.md):
 *
 * - `startStatic`: `dist/`를 **`/voyage/` 하위 경로**로 주는 작은 Node 정적 서버. nginx 조각처럼 `/voyage/ws`(WebSocket 업그레이드)·
 *   `/voyage/health`·`/voyage/notice`를 중계 서버로 넘긴다. `config.json`은 시험이 넣었다 뺐다 한다(`setConfig`).
 * - `startRelayProcess`: 빌드된 중계 서버 `node server/dist/index.js`를 자식 프로세스로 띄운다(환경 변수 그대로, 표준 출력 기록).
 *   멈추기·같은 포트로 다시 띄우기(서버 재시작 시험).
 * - `startRelayInProcess`: 같은 빌드 코드(`server/dist/server/src/server.js`)를 이 프로세스 안에서 띄운다 — Windows에는 SIGHUP이 없어
 *   공지 다시 읽기(`systemctl reload` = SIGHUP 처리기 = `server.reloadNotice()`)를 직접 부르기 위해서다.
 *
 * 포트는 모두 빈 포트를 그때그때 고른다(8765·4173 등 다른 작업 포트와 겹치지 않음). 시험이 끝나면 닫는다.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { connect, createServer as netServer, type Socket } from 'node:net';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const DIST = join(ROOT, 'dist');

export async function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = netServer();
    s.once('error', rej);
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => res(p));
    });
  });
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

export interface StaticServer {
  port: number;
  /** http://127.0.0.1:port/voyage/ */
  base: string;
  /** null이면 config.json 없음(404) */
  setConfig(c: unknown | null): void;
  setRelayPort(p: number): void;
  /** 경로별 요청 수(질의 제외) */
  hits: Map<string, number>;
  /** 시험 전용 파일을 `/voyage/<rel>`에 끼워 넣는다(실제 로컬 출처라야 WebSocket이 로컬 네트워크 검사를 지난다) */
  addFile(rel: string, body: string, type: string): void;
  close(): Promise<void>;
}

export async function startStatic(o: { relayPort: number; config?: unknown | null }): Promise<StaticServer> {
  let relayPort = o.relayPort;
  let config: unknown | null = o.config ?? null;
  const hits = new Map<string, number>();
  const sockets = new Set<Socket>();
  const extra = new Map<string, { body: string; type: string }>();

  const proxyHttp = (req: IncomingMessage, res: ServerResponse, path: string) => {
    const up = httpRequest(
      { host: '127.0.0.1', port: relayPort, path, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${relayPort}`, 'x-real-ip': '127.0.0.1' } },
      (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
      },
    );
    up.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('Bad Gateway');
    });
    req.pipe(up);
  };

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const path = decodeURIComponent(url.pathname);
    hits.set(path, (hits.get(path) ?? 0) + 1);
    if (path === '/voyage') {
      res.writeHead(301, { Location: '/voyage/' });
      res.end();
      return;
    }
    // config.json `relayUrl` 시험용 두 번째 중계 경로(같은 출처, 다른 경로)
    if (/^\/relay2\/(health|notice)$/.test(path)) return proxyHttp(req, res, path.slice('/relay2'.length));
    if (!path.startsWith('/voyage/')) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not voyage');
      return;
    }
    const rel = path.slice('/voyage/'.length);
    if (rel === 'health' || rel === 'notice') return proxyHttp(req, res, `/${rel}`);
    const x = extra.get(rel);
    if (x) {
      res.writeHead(200, { 'Content-Type': x.type, 'Cache-Control': 'no-store' });
      res.end(x.body);
      return;
    }
    if (rel === 'config.json') {
      if (config === null) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('no config');
      } else {
        res.writeHead(200, { 'Content-Type': MIME['.json']!, 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(config));
      }
      return;
    }
    const file = normalize(join(DIST, rel === '' ? 'index.html' : rel));
    if (!file.startsWith(DIST + sep) && file !== join(DIST, 'index.html')) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (!existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }
    const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': rel === '' || rel === 'index.html' ? 'no-store' : 'max-age=60' });
    res.end(readFileSync(file));
  });

  // WebSocket: /voyage/ws → 중계 서버 /ws (nginx proxy_pass 흉내)
  server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
    const path = (req.url ?? '/').split('?')[0];
    hits.set(path, (hits.get(path) ?? 0) + 1);
    if (path !== '/voyage/ws' && path !== '/relay2/ws') {
      socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
      return;
    }
    const up = connect(relayPort, '127.0.0.1', () => {
      const lines = [`GET /ws HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const k = req.rawHeaders[i]!;
        if (/^host$/i.test(k) || /^x-real-ip$/i.test(k)) continue;
        lines.push(`${k}: ${req.rawHeaders[i + 1]}`);
      }
      lines.push(`Host: 127.0.0.1:${relayPort}`, 'X-Real-IP: 127.0.0.1', '', '');
      up.write(lines.join('\r\n'));
      if (head.length) up.write(head);
      up.pipe(socket);
      socket.pipe(up);
    });
    sockets.add(socket);
    sockets.add(up);
    const done = () => {
      sockets.delete(socket);
      sockets.delete(up);
      socket.destroy();
      up.destroy();
    };
    up.on('error', done);
    socket.on('error', done);
    up.on('close', done);
    socket.on('close', done);
  });

  const port = await new Promise<number>((res) => server.listen(0, '127.0.0.1', () => res((server.address() as { port: number }).port)));
  const diag = process.env.FC_LOG
    ? setInterval(() => {
        const top = [...hits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
        console.log(`[static] ${top.map(([k, v]) => `${k}=${v}`).join(' ')}`);
      }, 5000)
    : null;
  diag?.unref();
  return {
    port,
    base: `http://127.0.0.1:${port}/voyage/`,
    setConfig: (c) => (config = c),
    setRelayPort: (p) => (relayPort = p),
    hits,
    addFile: (rel, body, type) => extra.set(rel, { body, type }),
    close: () =>
      new Promise<void>((res) => {
        for (const s of sockets) s.destroy();
        server.closeAllConnections?.();
        server.close(() => res());
      }),
  };
}

// ───────────────────────── 중계 서버(자식 프로세스) ─────────────────────────

export interface RelayProcess {
  port: number;
  /** 표준 출력·오류 줄(JSON 로그) */
  logs: string[];
  proc: ChildProcess | null;
  health(): Promise<Record<string, unknown> | null>;
  /** 멈춤(Windows는 바로 끝남 — 서버 재시작/장애 흉내) */
  stop(): Promise<void>;
  /** 같은 포트로 다시 띄움 */
  restart(): Promise<void>;
}

export async function getJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return null;
    return (await r.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function startRelayProcess(o: { env?: Record<string, string>; port?: number } = {}): Promise<RelayProcess> {
  const port = o.port ?? (await freePort());
  const logs: string[] = [];
  const env = {
    ...process.env,
    PORT: String(port),
    HOST: '127.0.0.1',
    ALLOW_LOCALHOST: '1',
    ALLOWED_ORIGINS: '',
    LOG_LEVEL: 'info',
    NOTICE_FILE: join(ROOT, 'tmp', 'no-notice.json'),
    ...(o.env ?? {}),
  };
  const rp: RelayProcess = {
    port,
    logs,
    proc: null,
    health: () => getJson(`http://127.0.0.1:${port}/health`),
    async stop() {
      const p = rp.proc;
      if (!p || p.exitCode !== null) return;
      await new Promise<void>((res) => {
        p.once('exit', () => res());
        p.kill();
      });
      rp.proc = null;
    },
    async restart() {
      await rp.stop();
      await launch();
    },
  };
  const launch = async () => {
    const p = spawn(process.execPath, [join(ROOT, 'server', 'dist', 'index.js')], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    rp.proc = p;
    const take = (b: Buffer) => logs.push(...b.toString('utf8').split(/\r?\n/).filter(Boolean));
    p.stdout!.on('data', take);
    p.stderr!.on('data', take);
    for (let i = 0; i < 100; i++) {
      if (await rp.health()) return;
      if (p.exitCode !== null) throw new Error(`중계 서버가 시작하지 못함: ${logs.join('\n')}`);
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('중계 서버 /health 응답 없음');
  };
  await launch();
  return rp;
}

// ───────────────────────── 중계 서버(같은 프로세스 — 공지 다시 읽기) ─────────────────────────

export interface RelayInProcess {
  port: number;
  logs: string[];
  reloadNotice(): unknown;
  health(): Promise<Record<string, unknown> | null>;
  close(): Promise<void>;
}

export async function startRelayInProcess(env: Record<string, string>): Promise<RelayInProcess> {
  const base = pathToFileURL(join(ROOT, 'server', 'dist', 'server', 'src')).href;
  const { loadServerConfig } = (await import(`${base}/config.js`)) as { loadServerConfig: (e: Record<string, string | undefined>) => unknown };
  const { createLogger } = (await import(`${base}/log.js`)) as { createLogger: (l: string, sink: (s: string) => void) => unknown };
  const { startRelayServer } = (await import(`${base}/server.js`)) as {
    startRelayServer: (o: { config: unknown; logger: unknown; version?: string }) => Promise<{
      port: number;
      reloadNotice(): unknown;
      close(): Promise<void>;
    }>;
  };
  const logs: string[] = [];
  const config = loadServerConfig({ HOST: '127.0.0.1', PORT: '0', ALLOW_LOCALHOST: '1', ALLOWED_ORIGINS: '', LOG_LEVEL: 'info', ...env });
  const server = await startRelayServer({ config, logger: createLogger('info', (s) => logs.push(s)), version: 'e2e' });
  return {
    port: server.port,
    logs,
    reloadNotice: () => server.reloadNotice(),
    health: () => getJson(`http://127.0.0.1:${server.port}/health`),
    close: () => server.close(),
  };
}
