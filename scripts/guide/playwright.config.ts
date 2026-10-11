import { defineConfig, devices } from '@playwright/test';

/**
 * 작업 141 공략집 촬영 전용 설정 — 직접 부르지 말고 `npm run guide:build`(scripts/guide/build.mjs)로 돌린다.
 * 이미 빌드된 `dist/`·`server/dist/`를 쓰고, 서버(정적 /voyage/ + 로컬 중계)는 촬영 스크립트가 빈 포트로 직접 띄운다(8765 안 씀).
 */
export default defineConfig({
  testDir: '.',
  testMatch: /capture\.ts$/,
  outputDir: '../../test-results/guide',
  reporter: [['list']],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30 * 60_000,
  use: { trace: 'off', actionTimeout: 15_000 },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
