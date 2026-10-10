import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * 작업 109 교사 대시보드 e2e 전용 설정: `npx playwright test -c tests/teacher/playwright.config.ts`
 * - 개발 서버(Vite, 포트 5199): `?sync=local` 탭 연결 + 학생 테스트 하네스(tests/teacher/harness/student.html) + `?demo=30`.
 * - 로컬 중계 서버(server/dist, 포트 8799, ALLOW_LOCALHOST=1): "사용 중인 방"이 가득 참 → 풀림 → [방 열기] 성공을 실제 relay로 확인.
 * 포트 8765(작업 뷰어)·4173(기본 e2e 미리보기)은 쓰지 않는다. 끝나면 Playwright가 두 서버를 정리한다.
 * 기본 설정(`npm run e2e`, 빌드 미리보기)에서는 하네스·데모·relay가 필요한 시험은 건너뛴다(TEACHER_E2E 없음).
 */
const PORT = 5199;
const RELAY_PORT = 8799;
/** 이미 떠 있는 빌드 미리보기를 볼 때(예: TEACHER_BASE=http://127.0.0.1:5198/) — 하네스·데모·relay 시험은 건너뜀 */
const EXTERNAL = process.env.TEACHER_BASE;
if (!EXTERNAL) {
  process.env.TEACHER_E2E = '1';
  process.env.TEACHER_RELAY = `ws://127.0.0.1:${RELAY_PORT}/ws`;
}

export default defineConfig({
  testDir: '../../e2e',
  testMatch: /teacher.*\.spec\.ts$/,
  outputDir: '../../test-results/teacher',
  reporter: [['list']],
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  use: {
    baseURL: EXTERNAL ?? `http://127.0.0.1:${PORT}/`,
    trace: 'retain-on-failure',
    // (작업 114) 탭 여러 개(교사·공용 화면·학생 하네스)를 함께 돌릴 때 뒤 탭 타이머가 늦어져 옛 기기가 잠깐 '미접속'으로
    // 보이는 일이 있었다(전체 흐름의 "지금 접속 중인 기기가 있어요" 간헐 실패). 교실에서는 기기마다 앞 창이므로 늦추지 않게 한다
    launchOptions: { args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 } } }],
  webServer: EXTERNAL
    ? []
    : [
        {
          command: `npx vite --host 127.0.0.1 --port ${PORT} --strictPort`,
          url: `http://127.0.0.1:${PORT}/`,
          cwd: ROOT,
          reuseExistingServer: false,
          timeout: 120_000,
        },
        {
          command: `node server/dist/index.js`,
          url: `http://127.0.0.1:${RELAY_PORT}/health`,
          cwd: ROOT,
          env: { PORT: String(RELAY_PORT), HOST: '127.0.0.1', ALLOW_LOCALHOST: '1', ALLOWED_ORIGINS: '', LOG_LEVEL: 'warn' },
          reuseExistingServer: false,
          timeout: 60_000,
        },
      ],
});
