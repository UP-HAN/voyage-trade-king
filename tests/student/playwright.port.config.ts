import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * 작업 108 항구 시장 e2e 전용 설정: `npx playwright test -c tests/student/playwright.port.config.ts`
 * - 개발 서버(Vite, 포트 5288)에서 `?sync=local` — 실제 교사 화면(109, #/teacher) 탭 + 학생 탭(#/play).
 * - 포트 8765(작업 뷰어)·5199·8799·4317·4173(다른 작업 e2e)은 쓰지 않는다. 끝나면 Playwright가 서버를 정리한다.
 * - SHOT_DIR 환경 변수가 있으면 스크린숏을 남긴다.
 */
const PORT = 5288;
process.env.PORT_E2E = '1';

export default defineConfig({
  testDir: '../../e2e',
  testMatch: /student-port\.spec\.ts$/,
  outputDir: '../../test-results/student-108',
  reporter: [['list']],
  fullyParallel: false,
  workers: 1,
  timeout: 240_000,
  use: {
    baseURL: `http://127.0.0.1:${PORT}/`,
    trace: 'retain-on-failure',
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
