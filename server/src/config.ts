/**
 * 중계 서버 설정 읽기 — 환경 변수(`/etc/voyage-relay.env`, docs/server-setup.md 3.3).
 *
 * - relay-core 설정(MAX_ROOMS 등 21개)은 `RELAY_CONFIG_ENV` 대응표 그대로, 서버 전용 값(HOST·PORT·ALLOWED_ORIGINS·
 *   TRUST_PROXY·NOTICE_FILE·LOG_LEVEL)과 개발 옵션 ALLOW_LOCALHOST는 여기서 읽는다.
 * - 잘못된 값이 하나라도 있으면 `ConfigError`(이유 목록)를 던진다 → 진입점이 이유를 출력하고 시작하지 않는다.
 *   (relay-core의 `relayConfigFromEnv`는 잘못된 값을 조용히 기본값으로 바꾸므로 여기서 먼저 검사한다.)
 */
import { DEFAULT_RELAY_CONFIG, RELAY_CONFIG_ENV, type RelayConfig } from '../../shared/relay-core.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

/** 서버 전용 기본값(docs/server-setup.md 3.3) */
export const SERVER_DEFAULTS = Object.freeze({
  HOST: '127.0.0.1',
  PORT: 8787,
  ALLOWED_ORIGINS: 'https://lab.ches.es.kr',
  TRUST_PROXY: '127.0.0.1',
  NOTICE_FILE: '/etc/voyage-relay.notice.json',
  LOG_LEVEL: 'info' as LogLevel,
});

export interface ServerConfig {
  host: string;
  port: number;
  /** 허용 출처(정규화된 origin 문자열) */
  allowedOrigins: string[];
  /** 개발 옵션: http://localhost:*, http://127.0.0.1:* 허용 */
  allowLocalhost: boolean;
  /** 이 주소에서 온 연결만 X-Real-IP를 믿는다 */
  trustProxy: string[];
  noticeFile: string;
  logLevel: LogLevel;
  relay: RelayConfig;
}

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`설정 오류 ${problems.length}개: ${problems.join(' / ')}`);
    this.name = 'ConfigError';
  }
}

type Env = Record<string, string | undefined>;

const present = (v: string | undefined): v is string => v !== undefined && v.trim() !== '';

/** IPv4-mapped IPv6(`::ffff:1.2.3.4`)를 IPv4로 */
export function normalizeIp(ip: string): string {
  const s = ip.trim();
  const m = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(s);
  return m ? (m[1] as string) : s;
}

function isIpLike(s: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(s) || (/^[0-9a-f:]+$/i.test(s) && s.includes(':'));
}

/** origin 문자열 정규화(끝 `/` 없음). http/https가 아니거나 경로가 붙어 있으면 null */
export function normalizeOrigin(value: string): string | null {
  try {
    const u = new URL(value.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if ((u.pathname && u.pathname !== '/') || u.search || u.hash || u.username || u.password) return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** 환경 변수 → 서버 설정. 문제가 있으면 ConfigError */
export function loadServerConfig(env: Env): ServerConfig {
  const problems: string[] = [];

  const host = present(env.HOST) ? env.HOST.trim() : SERVER_DEFAULTS.HOST;

  let port: number = SERVER_DEFAULTS.PORT;
  if (present(env.PORT)) {
    const n = Number(env.PORT);
    if (!Number.isInteger(n) || n < 0 || n > 65535) problems.push(`PORT는 0~65535 정수여야 해요(받은 값: ${env.PORT})`);
    else port = n;
  }

  const allowedOrigins: string[] = [];
  const originsRaw = env.ALLOWED_ORIGINS !== undefined ? env.ALLOWED_ORIGINS : SERVER_DEFAULTS.ALLOWED_ORIGINS;
  for (const part of originsRaw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const o = normalizeOrigin(part);
    if (!o) problems.push(`ALLOWED_ORIGINS의 "${part}"는 https://도메인 형식이어야 해요(경로 없이)`);
    else if (!allowedOrigins.includes(o)) allowedOrigins.push(o);
  }

  let allowLocalhost = false;
  if (present(env.ALLOW_LOCALHOST)) {
    const v = env.ALLOW_LOCALHOST.trim().toLowerCase();
    if (v === '1' || v === 'true') allowLocalhost = true;
    else if (v === '0' || v === 'false') allowLocalhost = false;
    else problems.push(`ALLOW_LOCALHOST는 1 또는 0이어야 해요(받은 값: ${env.ALLOW_LOCALHOST})`);
  }
  if (!allowedOrigins.length && !allowLocalhost) problems.push('ALLOWED_ORIGINS가 비어 있어요(허용할 웹 주소가 하나도 없음)');

  const trustProxy: string[] = [];
  const trustRaw = env.TRUST_PROXY !== undefined ? env.TRUST_PROXY : SERVER_DEFAULTS.TRUST_PROXY;
  for (const part of trustRaw.split(',').map((s) => s.trim()).filter(Boolean)) {
    if (!isIpLike(part)) problems.push(`TRUST_PROXY의 "${part}"는 IP 주소여야 해요`);
    else trustProxy.push(normalizeIp(part));
  }

  const noticeFile = present(env.NOTICE_FILE) ? env.NOTICE_FILE.trim() : SERVER_DEFAULTS.NOTICE_FILE;

  let logLevel: LogLevel = SERVER_DEFAULTS.LOG_LEVEL;
  if (present(env.LOG_LEVEL)) {
    const v = env.LOG_LEVEL.trim().toLowerCase();
    if ((LOG_LEVELS as readonly string[]).includes(v)) logLevel = v as LogLevel;
    else problems.push(`LOG_LEVEL은 debug·info·warn·error 중 하나여야 해요(받은 값: ${env.LOG_LEVEL})`);
  }

  const relay = { ...DEFAULT_RELAY_CONFIG } as RelayConfig;
  for (const key of Object.keys(RELAY_CONFIG_ENV) as (keyof RelayConfig)[]) {
    const name = RELAY_CONFIG_ENV[key];
    const raw = env[name];
    if (!present(raw)) continue;
    const n = Number(raw.trim());
    if (!Number.isInteger(n) || n <= 0) problems.push(`${name}는 양의 정수여야 해요(받은 값: ${raw})`);
    else relay[key] = n;
  }
  if (relay.maxMsgBytes < 1024) problems.push(`MAX_MSG_BYTES는 1024 이상이어야 해요(받은 값: ${relay.maxMsgBytes})`);

  if (problems.length) throw new ConfigError(problems);
  return { host, port, allowedOrigins, allowLocalhost, trustProxy, noticeFile, logLevel, relay };
}

/** 오류가 아닌 경고(시작 로그에 남김) */
export function configWarnings(cfg: ServerConfig): string[] {
  const out: string[] = [];
  const need = cfg.relay.maxRooms * (cfg.relay.maxPeers + 1);
  if (cfg.relay.maxConn < need) {
    out.push(`MAX_CONN(${cfg.relay.maxConn})이 MAX_ROOMS × (MAX_PEERS + 1) = ${need}보다 작아요 — 방이 다 차기 전에 연결이 막힐 수 있어요`);
  }
  if (cfg.allowLocalhost) out.push('ALLOW_LOCALHOST=1 — 개발용 출처(localhost)를 허용하고 있어요. 운영 서버에서는 끄세요');
  return out;
}

const LOCALHOST_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

/** WebSocket Origin 허용 여부 */
export function originAllowed(cfg: Pick<ServerConfig, 'allowedOrigins' | 'allowLocalhost'>, origin: string | undefined): boolean {
  if (!origin) return false;
  const o = origin.trim().replace(/\/$/, '');
  if (cfg.allowedOrigins.includes(o)) return true;
  return cfg.allowLocalhost && LOCALHOST_ORIGIN.test(o);
}

/** 클라이언트 IP: TRUST_PROXY 주소에서 온 연결일 때만 X-Real-IP를 믿는다 */
export function clientIp(trustProxy: readonly string[], remoteAddress: string | undefined, realIpHeader: string | string[] | undefined): string {
  const remote = normalizeIp(remoteAddress ?? '') || 'unknown';
  if (!trustProxy.includes(remote)) return remote;
  const h = Array.isArray(realIpHeader) ? realIpHeader[0] : realIpHeader;
  if (typeof h !== 'string') return remote;
  const v = normalizeIp(h);
  return v && v.length <= 64 && isIpLike(v) ? v : remote;
}
