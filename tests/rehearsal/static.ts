/**
 * 작업 135 리허설 — 빌드본 **사본**을 `/voyage/` 하위 경로로 주는 작은 정적 서버(nginx 흉내: `/voyage/ws`·`/voyage/health`·`/voyage/notice`를
 * 중계 서버로 넘김). e2e/support/voyage-servers.ts의 startStatic과 같은 구조지만, 리허설이 도는 몇 분 동안 다른 작업이 `npm run build`로
 * dist/를 비웠다 다시 채워도 흔들리지 않게 **실행 시작 때 dist/를 보고서 폴더로 복사**해 그 사본을 준다.
 * (fs.cpSync·fs.rmSync는 쓰지 않는다 — 이 폴더 경로에서 Node 24가 죽음. CLAUDE.md)
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { connect, type Socket } from 'node:net';
import { extname, join, normalize, sep } from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
};

/** dist/ → dest 재귀 복사(파일 수 반환) */
export function snapshotDir(src: string, dest: string): number {
  let n = 0;
  mkdirSync(dest, { recursive: true });
  for (const e of readdirSync(src, { withFileTypes: true })) {
    const from = join(src, e.name);
    const to = join(dest, e.name);
    if (e.isDirectory()) n += snapshotDir(from, to);
    else if (e.isFile()) {
      copyFileSync(from, to);
      n++;
    }
  }
  return n;
}

export interface SiteServer {
  port: number;
  base: string;
  addFile(rel: string, body: string, type: string): void;
  close(): Promise<void>;
}

export async function startSite(o: { dir: string; relayPort: () => number }): Promise<SiteServer> {
  const extra = new Map<string, { body: string; type: string }>();
  const sockets = new Set<Socket>();
  const proxyHttp = (req: IncomingMessage, res: ServerResponse, path: string) => {
    const port = o.relayPort();
    const up = httpRequest({ host: '127.0.0.1', port, path, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${port}`, 'x-real-ip': '127.0.0.1' } }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    up.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('Bad Gateway');
    });
    req.pipe(up);
  };
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    if (path === '/voyage') {
      res.writeHead(301, { Location: '/voyage/' });
      res.end();
      return;
    }
    if (!path.startsWith('/voyage/')) {
      res.writeHead(404);
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
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('no config');
      return;
    }
    const file = normalize(join(o.dir, rel === '' ? 'index.html' : rel));
    if (!file.startsWith(o.dir + sep) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': rel === '' || rel === 'index.html' ? 'no-store' : 'max-age=60' });
    res.end(readFileSync(file));
  });
  server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
    if ((req.url ?? '/').split('?')[0] !== '/voyage/ws') {
      socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
      return;
    }
    const port = o.relayPort();
    const up = connect(port, '127.0.0.1', () => {
      const lines = ['GET /ws HTTP/1.1'];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const k = req.rawHeaders[i]!;
        if (/^host$/i.test(k) || /^x-real-ip$/i.test(k)) continue;
        lines.push(`${k}: ${req.rawHeaders[i + 1]}`);
      }
      lines.push(`Host: 127.0.0.1:${port}`, 'X-Real-IP: 127.0.0.1', '', '');
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
  return {
    port,
    base: `http://127.0.0.1:${port}/voyage/`,
    addFile: (rel, body, type) => extra.set(rel, { body, type }),
    close: () =>
      new Promise<void>((res) => {
        for (const s of sockets) s.destroy();
        server.closeAllConnections?.();
        server.close(() => res());
      }),
  };
}
