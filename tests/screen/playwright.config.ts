import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * 작업 110 공용 화면 e2e 전용 설정: `npx playwright test -c tests/screen/playwright.config.ts`
 * - 개발 서버(Vite, 포트 5288): `?sync=local` 교사 탭 + 공용 화면 탭 + 학생 탭(107 실제 화면), 그리고
 *   장면별 스크린숏용 가짜 호스트(`tests/screen/fixtures.ts`를 개발 서버에서 import → screen-bridge로 보냄).
 * 포트 8765(작업 뷰어)·5199·8799(109)·4173(기본 e2e)·4317(107)은 쓰지 않는다. 끝나면 Playwright가 서버를 정리한다.
 * 기본 설정(`npm run e2e`, 빌드 미리보기)에서는 개발 서버가 필요한 시험을 건너뛴다(SCREEN_E2E 없음).
 */
const PORT = 5288;
process.env.SCREEN_E2E = '1';

export default defineConfig({
  testDir: '../../e2e',
  testMatch: /screen.*\.spec\.ts$/,
  outputDir: '../../test-results/screen',
  reporter: [['list']],
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  use: {
    baseURL: `http://127.0.0.1:${PORT}/`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } } }],
  webServer: {
    command: `npx vite --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}/`,
    cwd: ROOT,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
