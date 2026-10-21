import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

/**
 * 작업 169 교사 시범 화면 e2e — 빌드본 미리보기(포트 5199: 4319·5288·8765와 겹치지 않음).
 * 실행: `npx playwright test -c tests/teacher-demo.playwright.config.ts` (먼저 빌드)
 */
const PORT = 5199;
process.env.DEMO_E2E = '1';

export default defineConfig({
  testDir: '../e2e',
  testMatch: /teacher-demo\.spec\.ts$/,
  outputDir: '../test-results/teacher-demo',
  reporter: [['list']],
  workers: 1,
  timeout: 300_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://127.0.0.1:${PORT}/`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 } } }],
  webServer: {
    command: `npm run build && npx vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}/`,
    cwd: ROOT,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
