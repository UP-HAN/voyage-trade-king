import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { openFold, openOrderRow, openTvMenu } from './support/voyage-ui';

/**
 * 작업 176 같은 거래 반복 폭풍·다양한 무역 보너스 e2e(빌드본, `?sync=local` — 교사·TV·학생 탭).
 * 1차시 10분 자유 항해 판. 학생 A가 '호찌민 쌀 → 요코하마' 길로 4번 팔면: 3번째 갈매기 예보 카드 → 4번째 폭풍 카드,
 * 요코하마 시장 쌀 카드에 '폭풍 때문에 값이 내려갔어요' + 반값, 포트헤들랜드에 팔면 정상 값(꼬리표 없음), 거래한 나라 3곳 보너스 토스트.
 * 학생 B 화면엔 예보·폭풍 카드가 없고, 교사 학생 표에만 "폭풍 1번", TV 띠는 이름 없는 한 줄.
 * 실행: `npx playwright test -c tests/e2e-preview.playwright.config.ts fair-trade` (FAIR_E2E=1은 설정이 켬)
 * 스크린숏: `.orch/tasks/176-anti-grind-diversity/shots/`(SHOT_DIR로 바꿀 수 있음)
 */
const RUN = process.env.FAIR_E2E === '1';
const SHOTS = process.env.SHOT_DIR ?? join(process.cwd(), '.orch', 'tasks', '176-anti-grind-diversity', 'shots');

async function shot(p: Page, name: string) {
  mkdirSync(SHOTS, { recursive: true });
  await p.waitForTimeout(700); // 카드·토스트 나타나는 움직임이 끝난 뒤
  await p.evaluate(() => document.fonts.ready).catch(() => undefined);
  await p.screenshot({ path: join(SHOTS, name) });
}

async function openTeacher(ctx: BrowserContext): Promise<{ t: Page; code: string }> {
  const t = await ctx.newPage();
  await t.goto('./?sync=local#/teacher');
  await t.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await t.reload();
  await t.getByTestId('btn-new').click();
  await t.getByTestId('unit-lesson').click();
  await t.getByTestId('lesson-L1').click();
  await t.getByTestId('trade-minutes').getByRole('button', { name: '10분' }).click();
  // [고급 설정]에 켜기/끄기(기본 켬)
  const adv = t.getByTestId('setup-advanced');
  if (!(await adv.evaluate((d) => (d as HTMLDetailsElement).open))) await adv.locator('summary').click();
  await expect(t.getByTestId('fair-trade').locator('[data-value="true"]')).toHaveAttribute('aria-pressed', 'true');
  await t.getByTestId('btn-open').click();
  const codeEl = t.getByTestId('room-code');
  await expect(codeEl).toHaveText(/^\d{6}$/);
  return { t, code: (await codeEl.innerText()).trim() };
}

async function joinStudent(ctx: BrowserContext, as: string, code: string, seat: number, name: string): Promise<Page> {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => {
    throw e;
  });
  await p.goto(`./?sync=local&as=${as}#/play`);
  await p.getByTestId('entry-code').fill(code);
  await p.getByTestId('entry-seat').selectOption(String(seat));
  await p.getByTestId('entry-name').fill(name);
  await p.getByTestId('entry-submit').click();
  await expect(p.getByTestId('found-company')).toBeVisible();
  await p.getByTestId('found-submit').click();
  await expect(p.getByTestId('prep-wait')).toBeVisible();
  return p;
}

/** 라운드가 열릴 때까지 앞 활동을 닫거나 건너뛴다(student-port 와 같은 방식) */
async function ensureRound(t: Page) {
  for (let i = 0; i < 30; i++) {
    if (await t.getByTestId('round-info').count()) return;
    const close = t.getByTestId('btn-close-event');
    if (await close.isVisible().catch(() => false)) {
      await close.click();
      await t.waitForTimeout(800);
      continue;
    }
    await openFold(t, 'order');
    const item = t.locator('[data-testid="tl-next-item"]:has(.t-ord__head:not([disabled]))').filter({ hasNotText: '라운드' }).first();
    if (await item.count()) {
      await openOrderRow(t, item);
      await item.getByTestId('tl-skip').click();
      const conf = t.getByTestId('confirm-skip-tier1');
      if (await conf.isVisible().catch(() => false)) await t.getByTestId('confirm-ok').click();
    }
    await t.waitForTimeout(1200);
  }
  await expect(t.getByTestId('round-info')).toBeVisible({ timeout: 30_000 });
}

/** 학생 화면을 덮는 가벼운 층·교사 사건 걷어 내기 */
async function clear(s: Page, t: Page) {
  const close = t.getByTestId('btn-close-event');
  if (await close.isVisible().catch(() => false)) await close.click().catch(() => undefined);
  for (const id of ['port-card-ok', 'concept-ok', 'tutorial-skip', 'tutorial-close', 'worksheet-done']) {
    const b = s.getByTestId(id);
    if ((await b.isVisible().catch(() => false)) && (await b.isEnabled().catch(() => false))) await b.click().catch(() => undefined);
  }
}

async function retry(s: Page, t: Page, fn: () => Promise<void>) {
  for (let i = 0; i < 20; i++) {
    try {
      await fn();
      return;
    } catch {
      await clear(s, t);
      await s.waitForTimeout(400);
    }
  }
  await fn();
}

/** 자유 항해 [여기로 출발] → 항구 화면 */
async function sail(s: Page, t: Page, port: string) {
  await retry(s, t, async () => {
    if (await s.getByTestId('port-screen').count()) await s.getByTestId('port-back').click({ timeout: 2000 });
    const hit = s.locator(`.wm-port[data-port="${port}"] .wm-port-hit`);
    const box = await hit.boundingBox();
    const vp = s.viewportSize()!;
    if (!box || box.y + box.height / 2 > vp.height - 100 || box.x < 0 || box.x > vp.width) await s.getByRole('button', { name: '전체 보기' }).click({ timeout: 2000 });
    await hit.click({ timeout: 2000 });
    await s.getByTestId('pick-sail').click({ timeout: 2000 });
    await expect(s.getByTestId('port-screen')).toHaveAttribute('data-port', port, { timeout: 5000 });
  });
}

async function plus(s: Page, testId: string, times: number) {
  for (let i = 0; i < times; i++) await s.getByTestId(`${testId}-plus`).click();
}

const priceOf = async (s: Page) => Number(/(\d+)만 원/.exec(await s.getByTestId('sell-card-rice').getByTestId('sell-price').innerText())![1]);

/** 쌀 n상자 팔기(확정까지) */
async function sellRice(s: Page, t: Page, n: number) {
  await retry(s, t, async () => {
    const card = s.getByTestId('sell-card-rice');
    const left = Number(/(\d+)/.exec((await s.getByTestId('hud-cargo').innerText()) ?? '')![1]);
    await plus(s, 'sell-rice', n - 1);
    await card.getByTestId('sell-rice').click({ timeout: 2000 });
    await expect(s.getByTestId('hud-cargo')).toContainText(`${left - n}/20`, { timeout: 5000 });
  });
}

async function buyRice(s: Page, t: Page, n: number) {
  await retry(s, t, async () => {
    const left = Number(/(\d+)/.exec(await s.getByTestId('hud-cargo').innerText())![1]);
    await plus(s, 'buy-rice', n - 1);
    await s.getByTestId('buy-card-rice').getByTestId('buy-rice').click({ timeout: 2000 });
    await expect(s.getByTestId('hud-cargo')).toContainText(`${left + n}/20`, { timeout: 5000 });
  });
}

test.describe.configure({ mode: 'serial' });

test('같은 길 4번 → 갈매기 예보 → 폭풍(그 항구·그 상품 반값), 다른 항구는 정상, 보너스 토스트, 교사 표에만 "폭풍 1번"', async ({ browser, baseURL }) => {
  test.skip(!RUN, 'tests/e2e-preview.playwright.config.ts 로 실행');
  test.setTimeout(420_000);
  const ctx = await browser.newContext({ baseURL, viewport: { width: 1366, height: 768 } });
  const { t, code } = await openTeacher(ctx);
  const a = await joinStudent(ctx, 'p01', code, 5, '해오름무역');
  const b = await joinStudent(ctx, 'p02', code, 6, '바다상회');
  // 준비 화면 항해 규칙 아래 한 줄
  await expect(a.getByTestId('rule-fair')).toContainText('같은 거래만 되풀이하면');

  await t.getByTestId('btn-start-trade').click();
  await t.getByTestId('confirm-ok').click();
  await ensureRound(t);

  // 호찌민에서 쌀 20상자
  await sail(a, t, 'HCM');
  await clear(a, t);
  await buyRice(a, t, 20);
  // 요코하마에 5상자씩 — 1·2번째는 아무 일 없음
  for (let i = 1; i <= 2; i++) {
    await sail(a, t, 'YOK');
    await sellRice(a, t, 5);
    await expect(a.getByTestId('fair-card')).toHaveCount(0);
    await sail(a, t, 'HCM');
  }
  await sail(a, t, 'YOK');
  const normal = await priceOf(a);
  await sellRice(a, t, 5);
  // 3번째: 갈매기 예보(손해 없음) + 피하는 길 추천
  const card = a.getByTestId('fair-card');
  await expect(card).toHaveAttribute('data-kind', 'forecast', { timeout: 10_000 });
  await expect(card).toContainText('갈매기 예보');
  await expect(card).toContainText('호찌민 → 요코하마 바닷길');
  await expect(card).toContainText('다른 나라, 다른 상품과 거래해 보세요!');
  await expect(card.getByTestId('fair-tip').first()).toBeVisible();
  await expect(card).toContainText('가상 뉴스');
  const cardText = await card.innerText();
  expect(cardText).not.toMatch(/선택|패널티|반칙/);
  await shot(a, 'fair-forecast-1366.png');
  // 카드가 거래 버튼을 가리지 않는다(흐름 안)
  await expect(a.getByTestId('sell-card-rice').getByTestId('sell-rice')).toBeVisible();
  expect(await priceOf(a)).toBe(normal);
  await card.getByTestId('fair-ok').click();
  await expect(a.getByTestId('fair-card')).toHaveCount(0);

  // 호찌민에서 10상자 더 → 요코하마에 5상자(4번째) → 폭풍
  await sail(a, t, 'HCM');
  await buyRice(a, t, 10);
  await sail(a, t, 'YOK');
  await sellRice(a, t, 5);
  await expect(a.getByTestId('fair-card')).toHaveAttribute('data-kind', 'storm', { timeout: 10_000 });
  await expect(a.getByTestId('fair-card')).toContainText('폭풍이 왔어요!');
  await expect(a.getByTestId('fair-card')).toContainText('요코하마 항구에서는 당분간 쌀을 반값에 사 가요');
  await expect(a.getByTestId('fair-lesson')).toContainText('한 가지 상품·한 나라에만 기대면');
  await shot(a, 'fair-storm-1366.png');
  // 팔기 전에 보이는 꼬리표와 줄어든 값
  const rice = a.getByTestId('sell-card-rice');
  await expect(rice.getByTestId('storm-tag')).toHaveText('폭풍 때문에 값이 내려갔어요');
  const half = await priceOf(a);
  // 반값(라운드가 바뀌면 시세가 ±5% 흔들릴 수 있어 넉넉히)
  expect(half).toBeLessThan(normal);
  expect(half).toBeLessThanOrEqual(Math.ceil(normal * 0.5 * 1.12) + 1);
  await a.getByTestId('fair-ok').click();
  await shot(a, 'fair-storm-market-1366.png');

  // 다른 항구(포트헤들랜드)에 팔면 정상 값·꼬리표 없음 → 거래한 나라 3곳 보너스
  await sail(a, t, 'PHE');
  await clear(a, t);
  await expect(a.getByTestId('sell-card-rice').getByTestId('storm-tag')).toHaveCount(0);
  await sellRice(a, t, 5);
  await expect(a.getByTestId('toasts')).toContainText('다양한 무역 보너스! 새 나라 3곳과 거래했어요 +30만 원', { timeout: 10_000 });
  await expect(a.getByTestId('toasts')).toContainText('거래한 나라 3/5');
  await shot(a, 'fair-bonus-toast-1366.png');

  // 다른 학생 화면: 예보·폭풍 카드·꼬리표 없음, 다른 회사 이름과 '폭풍' 이야기 없음
  await expect(b.getByTestId('fair-card')).toHaveCount(0);
  expect(await b.evaluate(() => document.body.innerText)).not.toContain('폭풍');

  // 교사 학생 표: "같은 거래 반복 — 폭풍 1번"(교사 화면만)
  const rowA = t.locator('[data-testid="student-row"][data-seat="5"]');
  await expect(rowA.getByTestId('cell-grind')).toHaveText('같은 거래 반복 — 폭풍 1번', { timeout: 10_000 });
  await expect(t.locator('[data-testid="student-row"][data-seat="6"]').getByTestId('cell-grind')).toHaveCount(0);
  await rowA.scrollIntoViewIfNeeded();
  await shot(t, 'fair-teacher-table-1366.png');
  await rowA.getByTestId('cell-company').click();
  await expect(t.getByTestId('drawer-grind')).toContainText('폭풍 1번');
  await shot(t, 'fair-teacher-drawer-1366.png');
  await t.keyboard.press('Escape');

  // TV: 해도 장면이면 이름 없는 한 줄
  await openTvMenu(t);
  const [scr] = await Promise.all([ctx.waitForEvent('page'), t.getByTestId('btn-open-screen').click()]);
  await scr.setViewportSize({ width: 1920, height: 1080 });
  await expect(scr.getByTestId('route-screen')).toBeVisible();
  const news = scr.getByTestId('map-storm-news');
  if (await scr.getByTestId('scene-map').isVisible({ timeout: 8000 }).catch(() => false)) {
    await expect(news).toHaveText('갈매기 소식: 바다 어딘가에 폭풍이 지나갔어요 · 여러 나라와 거래하면 안전해요');
    await shot(scr, 'fair-tv-map-1920.png');
  }
  // TV 어디에도 '폭풍'과 회사 이름이 한 줄에 같이 나오지 않는다
  const tvText = await scr.evaluate(() => document.body.innerText);
  for (const line of tvText.split('\n')) if (line.includes('폭풍')) expect(line).not.toContain('해오름무역');
  await ctx.close();
});
