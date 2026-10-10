/**
 * 저장 없는 WebSocket 중계 서버 (PRD 10.5·10.9·10.10, docs/server-setup.md).
 *
 * - HTTP(Node 내장): `GET /health`(현황, 방 코드·IP·이름 없음), `GET /notice`(서버 공지). 그 밖 404.
 * - WebSocket(`ws`): `/ws` 경로 업그레이드만. 방 라우팅 규칙은 모두 `shared/relay-core.ts`가 한다.
 * - 디스크·DB에 아무것도 쓰지 않는다. 공지 파일은 읽기만 한다(notice-file.ts).
 */
import { randomBytes, randomInt, createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { CLOSE_CODES, PROTOCOL_VERSION, noticeInWindow, type Notice } from '../../shared/protocol.js';
import { createRelayCore, type RelayCore, type RelayEvent, type RelayStats } from '../../shared/relay-core.js';
import { clientIp, configWarnings, originAllowed, type ServerConfig } from './config.js';
import { errInfo, maskCode, type Logger } from './log.js';
import { readNoticeFile, type NoticeFileResult } from './notice-file.js';

/** `/health` 응답 형식(PRD 10.10 v0.3.2) */
export interface HealthBody {
  ok: boolean;
  version: string;
  uptimeSec: number;
  rooms: number;
  maxRooms: number;
  acceptingNewRooms: boolean;
  peers: number;
  conns: number;
  maxConn: number;
  memMB: number;
  notice: RelayStats['notice'];
  blockedIps: number;
  joinFailPerMin: number;
}

/** `/notice` 응답 형식 */
export type NoticeBody = { level: Notice['level']; text: string; until?: string } | { level: null };

/** 시간 값(ms). 테스트에서 줄인다 */
export interface RelayTimers {
  /** relay-core sweep 주기(기본 15초) */
  sweepMs: number;
  /** 서버 쪽 WebSocket ping 주기(기본 20초) */
  heartbeatMs: number;
  /** 이 시간 동안 아무것도(메시지·pong) 오지 않으면 끊음(기본 45초) */
  heartbeatTimeoutMs: number;
  /** 거부 사유 집계 로그 주기(기본 60초) */
  statsLogMs: number;
  /** server.restarting 뒤 종료까지(기본 2초) */
  shutdownGraceMs: number;
}

export const DEFAULT_TIMERS: Readonly<RelayTimers> = Object.freeze({
  sweepMs: 15_000,
  heartbeatMs: 20_000,
  heartbeatTimeoutMs: 45_000,
  statsLogMs: 60_000,
  shutdownGraceMs: 2_000,
});

/** 한 연결의 보내기 대기열이 이보다 커지면(받는 쪽이 너무 느림) 끊는다 */
export const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;

export interface RelayServerOptions {
  config: ServerConfig;
  logger: Logger;
  version?: string;
  timers?: Partial<RelayTimers>;
  /** 시각(ms). 기본 Date.now */
  now?: () => number;
  /** 테스트용: 만든 relay-core를 감싸 바꿔 끼운다(예외 주입 등) */
  wrapCore?: (core: RelayCore) => RelayCore;
}

export interface RelayServer {
  /** 실제로 듣는 포트(PORT=0이면 임의 포트) */
  readonly port: number;
  readonly core: RelayCore;
  health(): HealthBody;
  noticeBody(): NoticeBody;
  /** 공지 파일 다시 읽기(SIGHUP) */
  reloadNotice(): NoticeFileResult;
  /** SIGTERM/SIGINT: 새 연결 거부 → 모두에게 server.restarting → grace 뒤 모든 연결 닫고 끝 */
  shutdown(): Promise<void>;
  /** 테스트용: 기다리지 않고 바로 모두 닫기 */
  close(): Promise<void>;
}

interface Sock {
  ws: WebSocket;
  lastSeen: number;
}

/** 1분 집계(로그). 키 = 오류 코드 또는 사건 이름 */
class Counter {
  private readonly m = new Map<string, number>();
  add(k: string, n = 1) {
    this.m.set(k, (this.m.get(k) ?? 0) + n);
  }
  take(): Record<string, number> {
    const out = Object.fromEntries(this.m);
    this.m.clear();
    return out;
  }
  get size() {
    return this.m.size;
  }
}

const json = (res: ServerResponse, status: number, body: unknown, head = false) => {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Length': Buffer.byteLength(data),
  });
  res.end(head ? undefined : data);
};

/** 예외 → 로그용(오류 종류 + 스택의 "at …" 줄 앞 4개. 메시지 문구는 받은 내용이 섞일 수 있어 남기지 않음) */
export function crashInfo(e: unknown): Record<string, unknown> {
  if (!(e instanceof Error)) return { err: typeof e };
  const frames = (e.stack ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('at '))
    .slice(0, 4)
    // 경로는 파일 이름:줄:칸만
    .map((l) => l.replace(/\(.*[\\/]([^\\/]+:\d+:\d+)\)$/, '($1)'));
  return { err: e.name, stack: frames };
}

const rejectUpgrade = (socket: Duplex, status: number, text: string) => {
  try {
    socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  } catch {
    /* 이미 닫힘 */
  }
  socket.destroy();
};

export async function startRelayServer(opts: RelayServerOptions): Promise<RelayServer> {
  const { config, logger } = opts;
  const timers: RelayTimers = { ...DEFAULT_TIMERS, ...(opts.timers ?? {}) };
  const now = opts.now ?? Date.now;
  const version = opts.version ?? '0.0.0';
  const startedAt = now();

  const sockets = new Map<string, Sock>();
  const counts = new Counter();
  let connSeq = 0;
  let shuttingDown = false;
  let notice: Notice | null = null;

  const observe = (e: RelayEvent) => {
    switch (e.type) {
      case 'room.opened':
        counts.add('roomsOpened');
        logger.info('room.open', { code: maskCode(e.code), reopened: e.reopened });
        return;
      case 'room.resumed':
        counts.add('roomsResumed');
        logger.debug('room.resume', { code: maskCode(e.code) });
        return;
      case 'room.closed':
        counts.add('roomsClosed');
        if (e.reason === 'empty') counts.add('emptyRoomsCleaned');
        logger.info('room.close', { code: maskCode(e.code), reason: e.reason, peers: e.peers });
        return;
      case 'error':
        counts.add(e.code);
        if (e.code === 'UNJOINED_TIMEOUT') counts.add('idleConnsCleaned');
        return;
    }
  };

  const core = (opts.wrapCore ?? ((c: RelayCore) => c))(createRelayCore(config.relay, {
    now,
    randomInt: (min, max) => randomInt(min, max + 1),
    randomToken: () => randomBytes(16).toString('hex'),
    hash: (s) => createHash('sha256').update(s, 'utf8').digest('hex'),
    send(connId, data) {
      const s = sockets.get(connId);
      if (!s || s.ws.readyState !== WebSocket.OPEN) return;
      if (s.ws.bufferedAmount > MAX_BUFFERED_BYTES) {
        counts.add('slowClosed');
        s.ws.terminate();
        return;
      }
      s.ws.send(data);
    },
    close(connId, code, reason) {
      const s = sockets.get(connId);
      if (!s) return;
      try {
        s.ws.close(code, reason);
      } catch {
        s.ws.terminate();
      }
      // 상대가 닫기에 응답하지 않으면 3초 뒤 강제로
      setTimeout(() => {
        if (s.ws.readyState !== WebSocket.CLOSED) s.ws.terminate();
      }, 3000).unref();
    },
    observe,
  }));

  /**
   * relay-core 호출 보호: 예기치 않은 예외가 나도 서버 전체가 죽지 않게 로그(오류 종류·스택 앞부분만 — 메시지 내용·코드·IP
   * 없음)를 남기고 **그 연결만** 닫는다(1011). 연결과 무관한 호출(sweep)은 로그만.
   */
  const guard = (where: string, connId: string | null, fn: () => void): boolean => {
    try {
      fn();
      return true;
    } catch (e) {
      counts.add('coreErrors');
      logger.error('core.error', { where, ...crashInfo(e) });
      if (connId) {
        const s = sockets.get(connId);
        sockets.delete(connId);
        try {
          core.onDisconnect(connId);
        } catch {
          /* 표 정리도 실패하면 그대로 */
        }
        if (s) {
          try {
            s.ws.close(1011, 'internal error');
          } catch {
            s.ws.terminate();
          }
          setTimeout(() => s.ws.terminate(), 3000).unref();
        }
      }
      return false;
    }
  };

  // ── 공지 ──
  const applyNotice = (r: NoticeFileResult, when: 'start' | 'reload') => {
    notice = r.notice;
    core.setNotice(notice);
    const fields = { when, status: r.status, noticeLevel: notice?.level ?? null, blockNewRooms: !!notice?.blockNewRooms };
    if (r.status === 'bad_json' || r.status === 'bad_fields' || r.status === 'unreadable') {
      logger.warn('notice.invalid', { ...fields, file: config.noticeFile });
    } else {
      logger.info('notice.load', { ...fields, ...(r.truncated ? { truncated: true } : {}) });
    }
  };
  const reloadNotice = () => {
    const r = readNoticeFile(config.noticeFile);
    applyNotice(r, 'reload');
    return r;
  };
  applyNotice(readNoticeFile(config.noticeFile), 'start');

  const noticeBody = (): NoticeBody => {
    if (!notice || !noticeInWindow(notice, now())) return { level: null };
    return { level: notice.level, text: notice.text, ...(notice.until ? { until: notice.until } : {}) };
  };

  const health = (): HealthBody => {
    const s = core.stats();
    return {
      ok: !shuttingDown,
      version,
      uptimeSec: Math.floor((now() - startedAt) / 1000),
      rooms: s.rooms,
      maxRooms: s.maxRooms,
      acceptingNewRooms: !shuttingDown && s.acceptingNewRooms,
      peers: s.peers,
      conns: s.conns,
      maxConn: s.maxConn,
      memMB: Math.round(process.memoryUsage.rss() / (1024 * 1024)),
      notice: s.notice,
      blockedIps: s.blockedIps,
      joinFailPerMin: s.joinFailPerMin,
    };
  };

  // ── HTTP ──
  const onRequest = (req: IncomingMessage, res: ServerResponse) => {
    const path = (req.url ?? '/').split('?')[0];
    const isGet = req.method === 'GET' || req.method === 'HEAD';
    if (path === '/health' || path === '/notice') {
      if (!isGet) {
        res.writeHead(405, { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' });
        res.end();
        return;
      }
      if (path === '/health') {
        counts.add('healthReqs');
        json(res, 200, health(), req.method === 'HEAD');
      } else {
        counts.add('noticeReqs');
        json(res, 200, noticeBody(), req.method === 'HEAD');
      }
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('Not Found');
  };

  const http: Server = createServer(onRequest);
  http.keepAliveTimeout = 5000;
  http.headersTimeout = 10_000;
  http.requestTimeout = 15_000;

  // ── WebSocket ──
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: config.relay.maxMsgBytes });

  const onConnection = (ws: WebSocket, req: IncomingMessage) => {
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
    if (!originAllowed(config, origin)) {
      counts.add('ORIGIN');
      ws.send(JSON.stringify({ v: PROTOCOL_VERSION, t: 'error', code: 'ORIGIN' }));
      ws.close(CLOSE_CODES.ORIGIN, 'ORIGIN');
      setTimeout(() => ws.terminate(), 3000).unref();
      return;
    }
    const ip = clientIp(config.trustProxy, req.socket.remoteAddress, req.headers['x-real-ip']);
    const id = `c${(++connSeq).toString(36)}`;
    const sock: Sock = { ws, lastSeen: now() };
    sockets.set(id, sock);
    ws.on('message', (data: RawData) => {
      sock.lastSeen = now();
      const text = Buffer.isBuffer(data)
        ? data.toString('utf8')
        : Array.isArray(data)
          ? Buffer.concat(data).toString('utf8')
          : Buffer.from(data).toString('utf8');
      if (!sockets.has(id)) return;
      guard('onMessage', id, () => core.onMessage(id, text));
    });
    ws.on('pong', () => {
      sock.lastSeen = now();
    });
    ws.on('error', (e: Error & { code?: string }) => {
      if (e.code === 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH') counts.add('TOO_LARGE');
      else logger.debug('ws.error', errInfo(e));
    });
    ws.on('close', () => {
      if (!sockets.delete(id)) return; // guard가 이미 정리함
      guard('onDisconnect', null, () => core.onDisconnect(id));
    });
    guard('onConnect', id, () => core.onConnect(id, { ip, ...(origin ? { origin } : {}) }));
  };

  http.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on('error', () => socket.destroy());
    const path = (req.url ?? '/').split('?')[0];
    if (path !== '/ws') return rejectUpgrade(socket, 404, 'Not Found');
    if (shuttingDown) return rejectUpgrade(socket, 503, 'Service Unavailable');
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, req));
  });

  http.on('clientError', (_e, socket) => {
    if (socket.writable) rejectUpgrade(socket, 400, 'Bad Request');
    else socket.destroy();
  });

  // ── 타이머 ──
  const sweepTimer = setInterval(() => {
    guard('sweep', null, () => core.sweep());
  }, timers.sweepMs);
  const heartbeatTimer = setInterval(() => {
    const t = now();
    for (const s of sockets.values()) {
      if (t - s.lastSeen > timers.heartbeatTimeoutMs) {
        counts.add('heartbeatTimeouts');
        s.ws.terminate();
      } else if (s.ws.readyState === WebSocket.OPEN) {
        try {
          s.ws.ping();
        } catch {
          /* 닫히는 중 */
        }
      }
    }
  }, timers.heartbeatMs);
  const statsTimer = setInterval(() => {
    const s = core.stats();
    const c = counts.take();
    if (s.rooms === 0 && s.conns === 0 && Object.keys(c).length === 0) return;
    logger.info('stats', {
      rooms: s.rooms,
      peers: s.peers,
      conns: s.conns,
      memMB: Math.round(process.memoryUsage.rss() / (1024 * 1024)),
      blockedIps: s.blockedIps,
      joinFailPerMin: s.joinFailPerMin,
      counts: c,
    });
  }, timers.statsLogMs);
  for (const t of [sweepTimer, heartbeatTimer, statsTimer]) t.unref();

  await new Promise<void>((resolve, reject) => {
    const onErr = (e: Error) => reject(e);
    http.once('error', onErr);
    http.listen(config.port, config.host, () => {
      http.off('error', onErr);
      resolve();
    });
  });
  http.on('error', (e) => logger.error('http.error', errInfo(e)));
  const addr = http.address();
  const port = typeof addr === 'object' && addr ? addr.port : config.port;

  logger.info('start', {
    version,
    node: process.version,
    host: config.host,
    port,
    allowedOrigins: config.allowedOrigins,
    allowLocalhost: config.allowLocalhost,
    trustProxy: config.trustProxy,
    noticeFile: config.noticeFile,
    heapLimit: /--max-old-space-size=(\d+)/.exec(process.env.NODE_OPTIONS ?? '')?.[1] ?? null,
    limits: { ...config.relay },
  });
  for (const w of configWarnings(config)) logger.warn('config.warning', { warning: w });

  let closed: Promise<void> | null = null;
  const closeAll = (code: number, reason: string): Promise<void> => {
    if (closed) return closed;
    clearInterval(sweepTimer);
    clearInterval(heartbeatTimer);
    clearInterval(statsTimer);
    closed = new Promise<void>((resolve) => {
      for (const s of sockets.values()) {
        try {
          s.ws.close(code, reason);
        } catch {
          s.ws.terminate();
        }
      }
      const force = setTimeout(() => {
        for (const s of sockets.values()) s.ws.terminate();
      }, 1000);
      force.unref();
      wss.close();
      http.close(() => {
        clearTimeout(force);
        resolve();
      });
      http.closeAllConnections?.();
      // 열린 소켓이 다 닫힐 때까지 기다리지 않아도 되게 1.5초 뒤 끝
      setTimeout(resolve, 1500).unref();
    });
    return closed;
  };

  return {
    port,
    core,
    health,
    noticeBody,
    reloadNotice,
    async shutdown() {
      if (shuttingDown) return closed ?? Promise.resolve();
      shuttingDown = true;
      const s = core.stats();
      logger.info('shutdown', { rooms: s.rooms, conns: s.conns, graceMs: timers.shutdownGraceMs });
      http.close(); // 새 HTTP 연결을 받지 않음(업그레이드도 거부 — shuttingDown)
      core.announceRestart();
      await new Promise((r) => setTimeout(r, timers.shutdownGraceMs));
      await closeAll(1012, 'restart');
    },
    close() {
      shuttingDown = true;
      return closeAll(1001, 'close');
    },
  };
}
