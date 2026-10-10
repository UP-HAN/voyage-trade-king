import { defineConfig, devices } from '@playwright/test';

/**
 * 작업 107 확인용 Playwright 설정(다른 작업과 dist/·4173 포트가 겹치지 않게 따로 빌드·미리보기).
 * 실행: npx playwright test -c tests/student/playwright.student.config.ts
 * 정식 확인은 `npm run e2e`(루트 playwright.config.ts)로 같은 e2e/student-shell.spec.ts를 돈다.
 */
const PORT = 4317;

export default defineConfig({
  testDir: '../../e2e',
  testMatch: /student-.*\.spec\.ts/,
  outputDir: '../../test-results/student-107',
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}/`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 } } }],
  webServer: {
    env: { VITE_CONFIG_NATIVE_IGNORE_WARNING: 'true' },
    command: `npx vite build -c tests/student/vite.student.config.ts --outDir tmp/dist-107 && npx vite preview -c tests/student/vite.student.config.ts --outDir tmp/dist-107 --host 127.0.0.1 --port ${PORT} --strictPort`,
    cwd: '../..',
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
