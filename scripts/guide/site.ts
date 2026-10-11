/**
 * 작업 141 공략집 촬영용 정적 서버 — `dist/`를 `/voyage/` 하위 경로로 주고, `/voyage/ws`·`/voyage/health`·`/voyage/notice`를
 * 로컬 중계 서버로 넘긴다(e2e/support/voyage-servers.ts startStatic과 같은 구조, nginx 흉내).
 *
 * 공략집 화면에 실제 수업 주소(lab.ches.es.kr/voyage)가 보이도록, 브라우저가 이 이름을 127.0.0.1로 찾게 하고
 * (크로뮴 `--host-resolver-rules`) 이 서버를 127.0.0.1:80에 띄운다. 80번을 못 쓰면 빈 포트로 띄우고(주소에 127.0.0.1:포트가 보임) 경고한다.
 * 중계 서버는 https 출처만 허용하므로 WebSocket 업그레이드의 Origin 머리글을 `http://127.0.0.1`로 바꿔 넘긴다(ALLOW_LOCALHOST=1).
 * 파일 추가(`addFile`)는 봇 페이지(e2e/support/bots.ts)용.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
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
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
};

export interface GuideSite {
  port: number;
  /** 브라우저가 여는 주소(…/voyage/) */
  base: string;
  /** 80번 + 실제 수업 주소 이름을 쓰는가 */
  pretty: boolean;
  host: string;
  addFile(rel: string, body: string, type: string): void;
  close(): Promise<void>;
}

export const PRETTY_HOST = 'lab.ches.es.kr';

export async function startGuideSite(o: { dist: string; relayPort: number }): Promise<GuideSite> {
  const extra = new Map<string, { body: string; type: string }>();
  const sockets = new Set<Socket>();
  const proxyHttp = (req: IncomingMessage, res: ServerResponse, path: string) => {
    const up = httpRequest(
      { host: '127.0.0.1', port: o.relayPort, path, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${o.relayPort}`, 'x-real-ip': '127.0.0.1' } },
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
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    if (path === '/voyage') {
      res.writeHead(301, { Location: '/voyage/' });
      res.end();
      return;
    }
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
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('no config');
      return;
    }
    const file = normalize(join(o.dist, rel === '' ? 'index.html' : rel));
    if (!file.startsWith(o.dist + sep) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(readFileSync(file));
  });
  server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
    if ((req.url ?? '/').split('?')[0] !== '/voyage/ws') {
      socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
      return;
    }
    const up = connect(o.relayPort, '127.0.0.1', () => {
      const lines = ['GET /ws HTTP/1.1'];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const k = req.rawHeaders[i]!;
        if (/^(host|x-real-ip|origin)$/i.test(k)) continue;
        lines.push(`${k}: ${req.rawHeaders[i + 1]}`);
      }
      lines.push(`Host: 127.0.0.1:${o.relayPort}`, 'Origin: http://127.0.0.1', 'X-Real-IP: 127.0.0.1', '', '');
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
  const listen = (port: number) =>
    new Promise<number>((res, rej) => {
      const onErr = (e: Error) => rej(e);
      server.once('error', onErr);
      server.listen(port, '127.0.0.1', () => {
        server.off('error', onErr);
        res((server.address() as { port: number }).port);
      });
    });
  let port: number;
  let pretty = true;
  try {
    port = await listen(process.env.GUIDE_PORT ? Number(process.env.GUIDE_PORT) : 80);
  } catch (e) {
    console.warn(`[guide] 80번 포트를 쓸 수 없어 빈 포트로 띄워요 — 화면의 주소가 127.0.0.1:포트로 보여요 (${(e as Error).message})`);
    pretty = false;
    port = await listen(0);
  }
  if (pretty && port !== 80) pretty = false;
  const host = pretty ? PRETTY_HOST : `127.0.0.1:${port}`;
  return {
    port,
    pretty,
    host,
    base: `http://${host}/voyage/`,
    addFile: (rel, body, type) => extra.set(rel, { body, type }),
    close: () =>
      new Promise<void>((res) => {
        for (const s of sockets) s.destroy();
        server.closeAllConnections?.();
        server.close(() => res());
      }),
  };
}
