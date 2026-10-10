import { defineConfig, devices } from '@playwright/test';

/**
 * 작업 114 전용 설정: `npx playwright test -c tests/lesson1-full.playwright.config.ts`
 * 이미 빌드된 `dist/`(npm run build)와 `server/dist/`(npm run build:server)를 쓴다 — 서버는 시험이 직접 띄운다
 * (`/voyage/` 하위 경로 정적 서버 + 로컬 중계 서버, 빈 포트). 정식 실행은 루트 `npm run e2e`(빌드 후 같은 시험 포함).
 */
export default defineConfig({
  testDir: '../e2e',
  testMatch: /lesson1-full\.spec\.ts$/,
  outputDir: '../test-results/lesson1-full',
  reporter: [['list']],
  fullyParallel: false,
  workers: 1,
  timeout: 600_000,
  use: { trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 } } }],
});
