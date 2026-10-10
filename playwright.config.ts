import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

// 스모크: 빌드 결과(dist/)를 vite preview 로 띄워 타이틀과 4개 라우트를 확인한다(크로미움만).
export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  reporter: [['list']],
  fullyParallel: true,
  use: {
    baseURL: `http://127.0.0.1:${PORT}/`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', testIgnore: /lesson1-full\.spec\.ts$/, use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 } } },
    // (작업 114) 1차시 통합 e2e는 로컬 중계 서버·정적 서버를 직접 띄우고 창을 많이 연다 — 다른 시험이 다 끝난 뒤 혼자 돈다
    {
      name: 'lesson1-full',
      testMatch: /lesson1-full\.spec\.ts$/,
      dependencies: ['chromium'],
      timeout: 900_000,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 } },
    },
  ],
  webServer: {
    command: `npm run build && npx vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
