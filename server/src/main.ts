/**
 * 중계 서버 프로세스 진입점. 빌드 뒤 `node dist/index.js`(systemd ExecStart, docs/server-setup.md 1.4)가 이 파일을 부른다.
 * - 환경 변수가 잘못되면 이유를 출력하고 종료 코드 1.
 * - SIGTERM/SIGINT: 새 연결 거부 → server.restarting → 2초 뒤 종료.
 * - SIGHUP(`systemctl reload`): 공지 파일만 다시 읽음(연결 유지).
 */
import { ConfigError, loadServerConfig } from './config.js';
import { createLogger, errInfo } from './log.js';
import { relayVersion } from './index.js';
import { crashInfo, startRelayServer } from './server.js';

async function main(): Promise<number> {
  let config;
  try {
    config = loadServerConfig(process.env);
  } catch (e) {
    const problems = e instanceof ConfigError ? e.problems : [String(e)];
    createLogger('error').error('config.invalid', { problems });
    for (const p of problems) process.stderr.write(`설정 오류: ${p}\n`);
    return 1;
  }
  const logger = createLogger(config.logLevel);
  let server;
  try {
    server = await startRelayServer({ config, logger, version: relayVersion() });
  } catch (e) {
    logger.error('start.failed', errInfo(e));
    return 1;
  }

  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info('signal', { signal });
    server
      .shutdown()
      .catch((e) => logger.error('shutdown.error', errInfo(e)))
      .finally(() => process.exit(0));
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
  // Windows에는 SIGHUP이 없다(개발 PC). 리눅스 서버에서만 등록
  if (process.platform !== 'win32') {
    process.on('SIGHUP', () => {
      logger.info('signal', { signal: 'SIGHUP' });
      server.reloadNotice();
    });
  }
  // 최후 수단: 그래도 잡히지 않은 예외면 가능한 한 server.restarting을 알리고(클라이언트가 곧 다시 붙게) 끝낸다
  process.on('uncaughtException', (e) => {
    logger.error('uncaught', crashInfo(e));
    try {
      server.core.announceRestart();
    } catch {
      /* 알림도 실패하면 그대로 종료 */
    }
    setTimeout(() => process.exit(1), 300).unref();
  });
  process.on('unhandledRejection', (e) => logger.error('unhandledRejection', errInfo(e)));
  return 0;
}

const code = await main();
if (code !== 0) process.exit(code);
