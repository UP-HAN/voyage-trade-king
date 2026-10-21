import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { openTvMenu } from './support/voyage-ui';

/**
 * 작업 169 교사 시범 화면 e2e(빌드본 미리보기, `?sync=local`, 실제 시계).
 * 교사 시작 화면에 [시범 화면 열기] → 2차시 판(앞 시간) 방 열기 + 학생 1명 입장 → [무역 시작] → 대시보드 [TV 화면 ▾] [시범 화면 열기] →
 * 새 창(#/demo): 시범 띠·시범무역·800만 원·부산·원유 2상자 → 교사가 실제 방을 [잠깐 멈춤](학생 화면은 멈춤 층) →
 * 시범 창은 멈추지 않고 부산 [공장]에서 원유로 석유 제품 만들기 → 자유 항해로 다른 항구 → [처음부터 다시] → 처음 상태.
 * 실제 수업 저장본(voyage.host)에 시범 회사가 섞이지 않고, 기기에 기록장(voyage.logbook)·방 기록(voyage.peer)이 생기지 않는다.
 * 실행: `npx playwright test -c tests/teacher-demo.playwright.config.ts` (포트 5199). 스크린숏 .orch/tasks/169-teacher-demo/shots/.
 */
const RUN = process.env.DEMO_E2E === '1';
const SHOTS = process.env.SHOT_DIR ?? join(process.cwd(), '.orch', 'tasks', '169-teacher-demo', 'shots');

async function shot(page: Page, name: string) {
  mkdirSync(SHOTS, { recursive: true });
  await page.evaluate(() => document.fonts.ready).catch(() => undefined);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(SHOTS, name) });
}

/** 학생 화면 규칙(159): 시간 숫자(m:ss)·남은 시간 말이 없다 */
async function noTimeText(p: Page, where: string) {
  const text = await p.evaluate(() => document.body.innerText);
  expect(text, `${where}: m:ss`).not.toMatch(/\b\d{1,2}:\d{2}\b/);
  expect(text, `${where}: 시간 말`).not.toMatch(/남은 시간|곧 끝|시간이 다 됐|추천 시간/);
}

const cargoText = (p: Page) => p.getByTestId('route-demo').innerText();

test('교사 시범 화면: 수업 방과 따로 돌고, 멈춤이 떠도 공장에서 석유 제품을 만든다', async ({ browser, baseURL }) => {
  test.skip(!RUN, 'tests/teacher-demo.playwright.config.ts로 실행');
  test.setTimeout(240_000);
  const errors: string[] = [];
  const ctx = await browser.newContext({ baseURL, viewport: { width: 1366, height: 768 } });
  const t = await ctx.newPage();
  t.on('pageerror', (e) => errors.push(`teacher: ${e.message}`));
  await t.goto('./?sync=local#/teacher');
  await t.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await t.reload();
  await expect(t.getByTestId('teacher-start')).toBeVisible();
  // 시작 화면: [시범 화면 열기] + 설명 한 줄
  await expect(t.getByTestId('btn-open-demo')).toBeVisible();
  await expect(t.getByTestId('demo-open-hint')).toHaveText('수업과 따로 도는 연습 화면이에요. 멈춤이 떠도 이 화면은 안 멈춰요.');
  await shot(t, '01-teacher-start-demo-button.png');

  // 실제 수업 방: 2차시 앞 시간
  await t.getByTestId('btn-new').click();
  await t.getByTestId('unit-lesson').click();
  await t.getByTestId('lesson-L2').click();
  await expect(t.getByTestId('lesson-part-front')).toHaveAttribute('aria-pressed', 'true');
  await t.getByTestId('btn-open').click();
  const codeEl = t.getByTestId('room-code');
  await expect(codeEl).toHaveText(/^\d{6}$/, { timeout: 15_000 });
  const code = (await codeEl.innerText()).trim();

  const s = await ctx.newPage();
  s.on('pageerror', (e) => errors.push(`student: ${e.message}`));
  await s.goto('./?sync=local&as=d1#/play');
  await s.getByTestId('entry-code').fill(code);
  await s.getByTestId('entry-seat').selectOption('1');
  await s.getByTestId('entry-name').fill('해오름무역');
  await s.getByTestId('entry-submit').click();
  await expect(s.getByTestId('found-company')).toBeVisible({ timeout: 15_000 });
  await s.getByTestId('found-submit').click();
  await expect(s.getByTestId('prep-wait')).toBeVisible();

  // 대시보드 [TV 화면 ▾] → [시범 화면 열기] → 새 창
  await openTvMenu(t);
  await expect(t.getByTestId('tv-menu-list')).toContainText('시범 화면 열기');
  await expect(t.getByTestId('demo-open-hint')).toBeVisible();
  await shot(t, '02-teacher-dashboard-tv-menu-demo-button.png');
  const [d] = await Promise.all([ctx.waitForEvent('page'), t.getByTestId('btn-open-demo').click()]);
  d.on('pageerror', (e) => errors.push(`demo: ${e.message}`));
  await d.setViewportSize({ width: 1366, height: 768 });
  expect(new URL(d.url()).hash).toBe('#/demo');
  await expect(d.getByTestId('demo-band')).toContainText('시범 화면 — 수업과 상관없어요');
  await expect(d.getByTestId('student-game')).toBeVisible({ timeout: 15_000 });
  await expect(d.getByTestId('route-demo')).toContainText('시범무역');
  await expect(d.getByTestId('route-demo')).toContainText('800');
  await expect(d.getByTestId('student-entry')).toHaveCount(0);
  // 페이지가 가로·세로로 넘치지 않는다(띠만큼 게임 높이를 줄임)
  const over = await d.evaluate(() => ({ h: document.documentElement.scrollHeight - innerHeight, w: document.documentElement.scrollWidth - innerWidth }));
  expect(over.h).toBeLessThanOrEqual(1);
  expect(over.w).toBeLessThanOrEqual(1);
  await noTimeText(d, '시범 해도');
  await shot(d, '03-demo-map.png');

  // 교사가 실제 수업 방을 [무역 시작] → [잠깐 멈춤]: 학생 화면은 멈춤 층
  await t.keyboard.press('Escape');
  const start = t.getByTestId('btn-start-trade');
  if (await start.isVisible().catch(() => false)) {
    await start.click();
    const ok = t.getByTestId('confirm-ok');
    if (await ok.isVisible({ timeout: 1500 }).catch(() => false)) await ok.click();
  }
  await t.getByTestId('btn-pause').click();
  await expect(s.getByTestId('pause-overlay')).toBeVisible({ timeout: 10_000 });

  // 시범 창은 멈추지 않는다: 부산 항구 → [공장] → 석유 제품 만들기
  await expect(d.getByTestId('pause-overlay')).toHaveCount(0);
  await d.getByTestId('enter-port').click();
  await expect(d.getByTestId('port-screen')).toBeVisible();
  if (await d.getByTestId('port-card-ok').isVisible().catch(() => false)) await d.getByTestId('port-card-ok').click();
  await noTimeText(d, '시범 항구');
  await shot(d, '04-demo-port-busan.png');
  await d.getByTestId('tab-factory').click();
  await expect(d.getByTestId('factory')).toBeVisible();
  await expect(d.getByTestId('recipe-oilp')).toHaveAttribute('data-max', '2');
  await expect(d.getByTestId('factory-start-cargo')).toBeVisible();
  await shot(d, '05-demo-factory.png');
  await d.waitForTimeout(600); // 거래 연속 클릭 가드
  await d.getByTestId('make-oilp').click();
  await expect(d.getByTestId('factory-cycle-card')).toBeVisible({ timeout: 10_000 });
  await shot(d, '06-demo-factory-made.png');
  await d.getByTestId('factory-cycle-ok').click();
  await expect(d.getByTestId('recipe-oilp')).toHaveAttribute('data-max', '1');
  await expect(d.getByTestId('pause-overlay')).toHaveCount(0);
  // 학생은 여전히 멈춤
  await expect(s.getByTestId('pause-overlay')).toBeVisible();

  // 실제 수업 저장본에 시범 회사가 섞이지 않고, 이 기기에 기록장·방 기록이 생기지 않는다
  await t.waitForTimeout(1500);
  const store = await d.evaluate(() => ({
    keys: Object.keys(localStorage),
    host: Object.keys(localStorage)
      .filter((k) => k.startsWith('voyage.host'))
      .map((k) => localStorage.getItem(k) ?? '')
      .join('\n'),
  }));
  expect(store.keys.filter((k) => k.startsWith('voyage.logbook') || k === 'voyage.peer')).toEqual([]);
  expect(store.host).toContain('해오름무역');
  expect(store.host).not.toContain('시범무역');

  // [처음부터 다시] → 다시 부산·원유 2상자(석유 제품 없음)
  await d.getByTestId('demo-reset').click();
  await expect(d.getByTestId('student-game')).toBeVisible({ timeout: 15_000 });
  // 해도에서 다시 시작(항구 화면 기억도 지움)
  await expect(d.getByTestId('port-screen')).toHaveCount(0);
  await d.getByTestId('enter-port').click();
  await expect(d.getByTestId('port-screen')).toBeVisible();
  if (await d.getByTestId('port-card-ok').isVisible().catch(() => false)) await d.getByTestId('port-card-ok').click();
  await d.getByTestId('tab-factory').click();
  await expect(d.getByTestId('recipe-oilp')).toHaveAttribute('data-max', '2');
  expect(await cargoText(d)).toContain('시범무역');

  expect(errors).toEqual([]);
  await ctx.close();
});
