import { defineConfig, devices } from '@playwright/test';

/**
 * 작업 135 리허설 전용 설정 — 직접 부르지 말고 `npm run rehearsal`(scripts/rehearsal.mjs)로 돌린다.
 * 이미 빌드된 `dist/`·`server/dist/`를 쓰고, 서버는 시나리오가 직접 띄운다(빈 포트, 8765 안 씀).
 */
export default defineConfig({
  testDir: '.',
  testMatch: /rehearsal\.spec\.ts$/,
  outputDir: '../../test-results/rehearsal',
  reporter: [['list']],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60 * 60_000,
  use: { trace: 'off', viewport: { width: 1366, height: 768 } },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 } } }],
});
