import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * 작업 113 미니게임 e2e 전용 설정: `npx playwright test -c tests/minigames/playwright.config.ts`
 * - 개발 서버(Vite, 포트 5402)에서 `?sync=local` — 실제 교사 화면(#/teacher) + 공용 화면(#/screen) + 학생 탭(#/play).
 * - 포트 8765(작업 뷰어)는 쓰지 않는다. 끝나면 Playwright가 서버를 정리한다.
 * - SHOT_DIR 환경 변수가 있으면 스크린숏을 남긴다.
 */
const PORT = 5402;
process.env.MINIGAMES_E2E = '1';

export default defineConfig({
  testDir: '../../e2e',
  testMatch: /minigames-l1\.spec\.ts$/,
  outputDir: '../../test-results/minigames-113',
  reporter: [['list']],
  fullyParallel: false,
  workers: 1,
  timeout: 600_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://127.0.0.1:${PORT}/`,
    trace: 'retain-on-failure',
    actionTimeout: 15_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 } } }],
  webServer: {
    command: `npx vite --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}/`,
    cwd: ROOT,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
