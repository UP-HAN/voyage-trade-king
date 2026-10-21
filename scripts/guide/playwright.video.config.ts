import { defineConfig, devices } from '@playwright/test';

/**
 * 작업 154 설명 영상 v2 촬영 전용 설정 — `npx playwright test -c scripts/guide/playwright.video.config.ts`
 * 이미 빌드된 `dist/`·`server/dist/`를 쓴다(먼저 `npm run build && npm run build:server`). 서버는 촬영 스크립트가 직접 띄우고 닫는다.
 * 결과는 `VIDEO_OUT`(기본 tmp/video). 공략집 촬영(capture.ts, tmp/guide)과 섞이지 않는다.
 */
export default defineConfig({
  testDir: '.',
  testMatch: /capture-video\.ts$/,
  outputDir: '../../test-results/video-shots',
  reporter: [['list']],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60 * 60_000,
  expect: { timeout: 20_000 },
  use: { trace: 'off', actionTimeout: 15_000 },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
