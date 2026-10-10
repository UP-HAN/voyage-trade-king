/**
 * 중계 서버 공개 모듈 — 테스트·부하 테스트가 import 한다. 프로세스 진입점은 `main.ts`(→ 빌드 뒤 `dist/index.js`).
 * shared/ 는 상대 경로 + .js 확장자로 import 한다(shared/README.md 참고).
 */
import { readFileSync } from 'node:fs';
import { PROTOCOL_VERSION } from '../../shared/protocol.js';

export { loadServerConfig, configWarnings, originAllowed, clientIp, normalizeOrigin, ConfigError, SERVER_DEFAULTS } from './config.js';
export type { ServerConfig, LogLevel } from './config.js';
export { createLogger, maskCode, maskIp } from './log.js';
export type { Logger, LogSink } from './log.js';
export { readNoticeFile, parseNoticeText, NOTICE_FILE_TEXT_MAX } from './notice-file.js';
export { startRelayServer, DEFAULT_TIMERS, MAX_BUFFERED_BYTES } from './server.js';
export type { RelayServer, RelayServerOptions, RelayTimers, HealthBody, NoticeBody } from './server.js';

/** server/package.json 의 version(못 읽으면 '0.0.0'). 소스(server/src)·빌드(server/dist/server/src) 어느 쪽에서도 찾는다 */
export function relayVersion(): string {
  for (const rel of ['../package.json', '../../../package.json']) {
    try {
      const pkg = JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8')) as { name?: string; version?: string };
      if (pkg.name === 'voyage-relay' && typeof pkg.version === 'string') return pkg.version;
    } catch {
      /* 다음 후보 */
    }
  }
  return '0.0.0';
}

export function describeRelay(): string {
  return `voyage-relay ${relayVersion()} (protocol v${PROTOCOL_VERSION})`;
}
