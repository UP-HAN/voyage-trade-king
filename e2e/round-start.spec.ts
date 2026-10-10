import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { pickProgressMode } from './support/voyage-ui';

/**
 * 작업 134 "라운드가 안 시작돼요" 혼란 해결 e2e(`?sync=local`, 가짜 시계): 실제 교사 화면 + 학생 탭.
 * A. 차시 L1 10분 자동: [무역 시작] 확인 창 안내(먼저 할 활동·약 3분 50초) → 학생 상태 카드 "라운드 1까지 m:ss"(거래·출항 버튼 없음)
 *    → 교사 "라운드 1까지 m:ss" + [지금 라운드 시작](1등급 무역·수입·수출 → 확인 창) → 학생이 즉시 거래·출항 준비.
 * B. 차시 L1 10분 자동: 아무것도 누르지 않으면 3:50에 라운드 1이 열린다.
 * C. 차시 L1 10분 수동: [발동](상단 진행 바, 첫 화면 안)만 눌러 표지 → 활동 → 라운드 1까지 간다(표지에서 막히지 않음).
 *
 * 실행: tests/e2e-preview.playwright.config.ts(ROUNDSTART_E2E=1). SHOT_DIR 이 있으면 스크린숏을 남긴다.
 */
const RUN = process.env.ROUNDSTART_E2E === '1';
const SHOT_DIR = process.env.SHOT_DIR;

async function shot(page: Page, name: string) {
  if (!SHOT_DIR) return;
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(SHOT_DIR, name) });
}

async function openTeacher(ctx: BrowserContext, o: { minutes: 10; manual?: boolean }): Promise<{ t: Page; code: string }> {
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
  await t.getByTestId('trade-minutes').getByRole('button', { name: `${o.minutes}분` }).click();
  if (o.manual) await pickProgressMode(t, 'manual'); // (작업 138) [고급 설정] 안
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
  await expect(p.getByTestId('route-student')).toBeVisible();
  await p.getByTestId('entry-code').fill(code);
  await p.getByTestId('entry-seat').selectOption(String(seat));
  await p.getByTestId('entry-name').fill(name);
  await p.getByTestId('entry-submit').click();
  await expect(p.getByTestId('found-company')).toBeVisible({ timeout: 15_000 });
  await p.getByTestId('found-submit').click();
  await expect(p.getByTestId('prep-wait')).toBeVisible();
  return p;
}

async function advanceUntil(ctx: BrowserContext, t: Page, check: () => Promise<boolean>, maxSec: number) {
  for (let i = 0; i < maxSec; i++) {
    if (await check()) return;
    await ctx.clock.runFor(1000);
    await t.waitForTimeout(60);
  }
  expect(await check()).toBe(true);
}

const elapsed = async (t: Page, total: number) => total - Number(await t.getByTestId('trade-clock').getAttribute('data-sec'));

/** 튜토리얼·항구 카드 같은 가벼운 창 닫기 */
async function dismissLight(s: Page) {
  for (const id of ['tutorial-skip', 'tutorial-close', 'port-card-ok']) {
    const b = s.getByTestId(id);
    if (await b.isVisible().catch(() => false)) await b.click().catch(() => undefined);
  }
}

test.describe.configure({ mode: 'serial' });

test('A. 차시 L1 10분: [무역 시작] 안내 → 학생 상태 카드·남은 시간 → [지금 라운드 시작] → 즉시 거래', async ({ browser, baseURL }) => {
  test.skip(!RUN, 'tests/e2e-preview.playwright.config.ts로 실행');
  test.setTimeout(300_000);
  const ctx = await browser.newContext({ baseURL, viewport: { width: 1366, height: 768 } });
  await ctx.clock.install();
  const { t, code } = await openTeacher(ctx, { minutes: 10 });
  const s = await joinStudent(ctx, 'r01', code, 1, '해오름무역');

  // 교사 결정 3: [무역 시작] 확인 창에 먼저 할 활동과 라운드 1까지 시간
  await t.getByTestId('btn-start-trade').click();
  const confirm = t.getByTestId('confirm-start');
  await expect(confirm).toContainText('먼저 벽란도 시장·무역·수입·수출 활동을 하고 약 3분 50초 뒤 라운드 1이 시작돼요');
  await expect(confirm).toContainText('[지금 라운드 시작]으로 당길 수 있어요');
  await shot(t, '134-A1-teacher-start-confirm.png');
  await t.getByTestId('confirm-ok').click();
  await expect(t.getByTestId('trade-clock')).toBeVisible();

  // 표지가 떠 있는 동안(5초 뒤): 학생 화면에 상태 카드 — 거래·출항 버튼 대신
  await advanceUntil(ctx, t, async () => (await elapsed(t, 600)) >= 5, 10);
  await expect(s.getByTestId('round-wait-line')).toHaveText(/^라운드 1까지 3:\d{2}$/);
  await shot(s, '134-A3a-student-wait-card-cover.png');
  // 20초 뒤(표지 → 벽란도 시장 시작 무렵)
  await advanceUntil(ctx, t, async () => (await elapsed(t, 600)) >= 20, 40);
  // 교사: 무역 시계 옆 "라운드 1까지 m:ss" + [지금 라운드 시작]
  await expect(t.getByTestId('next-round')).toHaveText(/^라운드 1까지 3:\d{2}$/);
  await expect(t.getByTestId('btn-round-now')).toBeEnabled();
  await shot(t, '134-A2-teacher-next-round.png');
  // 학생: 상태 카드(활동 화면이 떠 있으면 그 화면이 위) — 거래·출항 버튼 없음
  await expect(s.getByTestId('round-wait-card')).toBeAttached();
  await expect(s.getByTestId('round-wait-line')).toHaveText(/^라운드 1까지 3:\d{2}$/);
  await expect(s.getByTestId('bottom-status')).toContainText('라운드가 열리면 거래할 수 있어요');
  await expect(s.getByTestId('enter-port')).toHaveCount(0);
  await expect(s.getByTestId('set-ready')).toHaveCount(0);
  await shot(s, '134-A3b-student-activity-over-card.png');

  // [지금 라운드 시작] → 1등급(무역·수입·수출)이 빠지므로 이름이 든 확인 창
  await t.getByTestId('btn-round-now').click();
  const conf = t.getByTestId('confirm-round-now');
  await expect(conf).toContainText('「무역·수입·수출」');
  await expect(conf).toContainText('벽란도 시장');
  await shot(t, '134-A4-teacher-round-now-confirm.png');
  await t.getByTestId('confirm-ok').click();
  await expect(t.getByTestId('round-info')).toContainText('라운드 1');
  await expect(t.getByTestId('btn-round-now')).toHaveCount(0);
  await shot(t, '134-A5-teacher-round1.png');

  // 학생: 즉시 거래·출항 가능
  await expect(s.getByTestId('round-wait-card')).toHaveCount(0);
  await dismissLight(s);
  await expect(s.getByTestId('enter-port')).toBeVisible();
  await s.getByTestId('enter-port').click();
  await expect(s.getByTestId('not-trading')).toHaveCount(0);
  await s.getByTestId('buy-card-chip').getByTestId('buy-chip').click();
  await expect(s.getByTestId('hud-cargo')).toContainText('1/20');
  await s.getByTestId('port-back').click();
  await dismissLight(s);
  await expect(s.getByTestId('set-ready')).toBeVisible();
  await shot(s, '134-A6-student-trading.png');
  await ctx.close();
});

test('B. 차시 L1 10분 자동: 누르지 않으면 3:50에 라운드 1이 열린다', async ({ browser, baseURL }) => {
  test.skip(!RUN, 'tests/e2e-preview.playwright.config.ts로 실행');
  test.setTimeout(300_000);
  const ctx = await browser.newContext({ baseURL, viewport: { width: 1366, height: 768 } });
  await ctx.clock.install();
  const { t, code } = await openTeacher(ctx, { minutes: 10 });
  const s = await joinStudent(ctx, 'r02', code, 2, '바다상회');
  await t.getByTestId('btn-start-trade').click();
  await t.getByTestId('confirm-ok').click();
  await advanceUntil(ctx, t, async () => (await t.getByTestId('round-info').count()) > 0, 300);
  const e = await elapsed(t, 600);
  expect(e).toBeGreaterThanOrEqual(229);
  expect(e).toBeLessThanOrEqual(234);
  await expect(s.getByTestId('round-wait-card')).toHaveCount(0);
  await ctx.close();
});

test('C. 차시 L1 10분 수동: [발동]만으로 표지 → 활동 → 라운드 1(표지에서 막히지 않음, 버튼은 첫 화면 안)', async ({ browser, baseURL }) => {
  test.skip(!RUN, 'tests/e2e-preview.playwright.config.ts로 실행');
  test.setTimeout(300_000);
  const ctx = await browser.newContext({ baseURL, viewport: { width: 1366, height: 768 } });
  await ctx.clock.install();
  const { t, code } = await openTeacher(ctx, { minutes: 10, manual: true });
  const s = await joinStudent(ctx, 'r03', code, 3, '고래해운');
  await t.getByTestId('btn-start-trade').click();
  await expect(t.getByTestId('confirm-start')).toContainText('수동 진행이라 [발동]을 눌러야 다음 항목이 시작돼요');
  await t.getByTestId('confirm-ok').click();
  await expect(s.getByTestId('round-wait-line')).toHaveText('선생님이 시작하면 라운드가 열려요');
  const fired: string[] = [];
  for (let i = 0; i < 400 && !(await t.getByTestId('round-info').count()); i++) {
    const fire = t.getByTestId('btn-fire');
    if (await fire.isVisible().catch(() => false)) {
      const box = await fire.boundingBox();
      expect(box && box.y + box.height <= 768).toBe(true); // 첫 화면 안
      const label = await t.getByTestId('tl-waiting').innerText();
      if (!fired.length) await shot(t, '134-C1-teacher-manual-fire.png');
      await fire.click();
      fired.push(label);
      await t.waitForTimeout(150);
      // 누르면 기다리던 항목이 바뀐다(같은 항목에서 막히지 않음)
      if (await t.getByTestId('tl-waiting').isVisible().catch(() => false)) expect(await t.getByTestId('tl-waiting').innerText()).not.toBe(label);
    }
    await ctx.clock.runFor(1000);
    await t.waitForTimeout(40);
  }
  await expect(t.getByTestId('round-info')).toContainText('라운드 1');
  expect(fired.length).toBeGreaterThanOrEqual(3); // 표지·벽란도 시장·무역·수입·수출 … 라운드 1
  await ctx.close();
});
