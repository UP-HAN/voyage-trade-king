/**
 * 작업 135 리허설 — 로컬 중계 서버 환경 변수(운영과 같게). node 전용.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

/** 운영과 같은 중계 서버 환경 변수: deploy/env.example + docs/server-setup.md 1.3.2 결정(MAX_ROOMS=30, MAX_CONN=1380) */
export function relayEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  try {
    for (const line of readFileSync(join(ROOT, 'deploy', 'env.example'), 'utf8').split(/\r?\n/)) {
      const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
      if (m) env[m[1]!] = m[2]!;
    }
  } catch {
    /* 없으면 기본값 */
  }
  // 1.3.2 결정(30방) + 로컬 실행에 필요한 값
  Object.assign(env, { MAX_ROOMS: '30', MAX_CONN: '1380', HOST: '127.0.0.1', ALLOW_LOCALHOST: '1', ALLOWED_ORIGINS: '', TRUST_PROXY: '127.0.0.1', NOTICE_FILE: join(ROOT, 'tmp', 'rehearsal-no-notice.json'), LOG_LEVEL: 'info', NODE_OPTIONS: '--max-old-space-size=192' });
  delete env.PORT;
  return env;
}

