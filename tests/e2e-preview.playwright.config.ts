import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

/**
 * 작업 114: 개발 서버로만 돌던 화면 흐름 e2e(111 사건·113 미니게임·112 학습지·편지·108 항구)를 **빌드본(미리보기)** 으로 돈다.
 * 이 시험들은 앱 화면만 쓰므로(`?sync=local` + 가짜 시계) 빌드본에서 그대로 돈다 — 작업 중 파일이 바뀌어도 흔들리지 않게.
 * 실행: `npx playwright test -c tests/e2e-preview.playwright.config.ts` (먼저 빌드, 포트 4319 미리보기)
 * 개발 서버 전용 부분(교사 하네스·?demo=30·공용 화면 가짜 호스트)은 tests/teacher·tests/screen 설정으로 따로 돈다(`npm run e2e:all`).
 */
const PORT = 4319;
process.env.EVENTS_E2E = '1';
process.env.MINIGAMES_E2E = '1';
process.env.WSL112_E2E = '1';
process.env.PORT_E2E = '1';
process.env.ROUNDSTART_E2E = '1';
process.env.FIRSTTIME_E2E = '1';

export default defineConfig({
  testDir: '../e2e',
  testMatch: /(lesson1-events|minigames-l1|worksheet-letters|student-port|round-start|teacher-first-time)\.spec\.ts$/,
  outputDir: '../test-results/e2e-preview',
  reporter: [['list']],
  fullyParallel: false,
  // 각 시험이 가짜 시계로 교사·공용 화면·학생 탭을 함께 돌린다 — 한 번에 하나씩(원래 설정과 같음)
  workers: 1,
  timeout: 900_000,
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
