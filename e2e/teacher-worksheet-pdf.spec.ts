import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { openAdvanced } from './support/voyage-ui';
import { ROOT } from './support/voyage-servers';

/**
 * 작업 138 — 학습지 PDF(PRD 7.5.3)와 판 설정·시작 화면 정리(7.5.2.3·7.5.2.4).
 * - 기본 `npm run e2e`(빌드본 vite preview, 4173): dist/print/ 의 PDF 가 열린다(200·application/pdf·10KB 초과) + 스크린숏 3장.
 * - `tests/teacher/playwright.config.ts`(개발 서버 5199): 같은 주소를 개발 서버 미들웨어가 준다(npm run dev 와 같은 길).
 * 이름이 teacher-로 시작해 두 설정 모두에서 돈다.
 */

const SHOTS = join(ROOT, '.orch', 'tasks', '138-worksheet-pdf-setup-simplify', 'shots');
const DEV = process.env.TEACHER_E2E === '1';

async function shot(page: Page, name: string) {
  if (DEV) return; // 스크린숏은 빌드본에서만
  mkdirSync(SHOTS, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(SHOTS, name) });
}

async function freshTeacher(page: Page) {
  await page.goto('./?sync=local#/teacher');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
  // (수정 1회차) 부하가 큰 전체 실행에서 교사 묶음 첫 로드가 5초를 넘는 일이 있어 첫 대기만 30초
  await expect(page.getByTestId('teacher-start')).toBeVisible({ timeout: 30_000 });
}

/** 링크를 눌러 새 탭이 열리는지 + 같은 주소를 직접 받아 200·application/pdf·10KB 초과인지 */
async function opensPdf(page: Page, testId: string) {
  const link = page.getByTestId(testId);
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener');
  const href = (await link.getAttribute('href')) ?? '';
  expect(href).toMatch(/^\.\/print\/logbook-[A-Za-z0-9-]+\.pdf\?v=[0-9a-f]+$/);
  const ctx = page.context();
  const resp = ctx.waitForEvent('response', { predicate: (r) => r.url().includes(href.slice(2).split('?')[0]!), timeout: 15_000 });
  const popupP = ctx.waitForEvent('page', { timeout: 15_000 });
  await link.click();
  const popup = await popupP;
  const r = await resp;
  expect(r.status()).toBe(200);
  expect(r.headers()['content-type'] ?? '').toContain('application/pdf');
  await popup.close().catch(() => undefined);
  // 응답 본문 크기(새 탭은 PDF 보기라 본문을 읽기 어려워 같은 주소를 한 번 더 받는다)
  const abs = new URL(href, page.url()).toString();
  const direct = await page.request.get(abs);
  expect(direct.status()).toBe(200);
  expect(direct.headers()['content-type'] ?? '').toContain('application/pdf');
  const body = await direct.body();
  expect(body.length).toBeGreaterThan(10_000);
  expect(body.subarray(0, 5).toString()).toBe('%PDF-');
  return { href, bytes: body.length };
}

test.describe('학습지 PDF(작업 138)', () => {
  test('시작 화면 [학습지 열기 ▾] → 1차시·교사용 PDF 새 탭', async ({ page }) => {
    await freshTeacher(page);
    const guide = page.getByTestId('start-guide');
    await expect(guide).toHaveAttribute('open', '');
    await expect(guide).toContainText('처음이세요? 수업 준비 3단계');
    // 큰 버튼은 하나([새 판 열기]), 나머지는 작은 글자 버튼
    await expect(page.getByTestId('btn-new')).toHaveClass(/btn--large/);
    await expect(page.getByTestId('btn-import')).toHaveClass(/link-small/);
    await expect(page.getByTestId('btn-conn')).toHaveClass(/link-small/);
    await shot(page, 'start-1366.png');

    await page.getByTestId('worksheet-pdf-toggle').click();
    await expect(page.getByTestId('worksheet-pdf-list')).toBeVisible();
    await expect(page.getByTestId('worksheet-pdf-list').locator('a')).toHaveCount(8);
    await shot(page, 'start-pdf-menu-1366.png');
    const l1 = await opensPdf(page, 'worksheet-pdf-L1');
    expect(l1.bytes).toBeGreaterThan(10_000);
    await page.getByTestId('worksheet-pdf-toggle').click();
    await opensPdf(page, 'worksheet-pdf-teacher-answers');

    // 접으면 기억
    await guide.locator(':scope > summary').click();
    await expect(guide).not.toHaveAttribute('open', '');
    await page.reload();
    await expect(page.getByTestId('start-guide')).not.toHaveAttribute('open', '');
  });

  test('판 설정: 기본 4가지 + [고급 설정] 접힘, L1을 고르면 이 차시 학습지 = 1차시', async ({ page }) => {
    await freshTeacher(page);
    await page.getByTestId('btn-new').click();
    await page.getByTestId('unit-lesson').click();
    await page.getByTestId('lesson-L1').click();
    await expect(page.getByTestId('lesson-L1')).toContainText('1차시 (L1)');
    await page.getByTestId('trade-minutes').getByRole('button', { name: '10분' }).click();
    // 기본으로 보이는 것 / 고급 설정 안(접힘)
    const adv = page.getByTestId('setup-advanced');
    await expect(adv).not.toHaveAttribute('open', '');
    for (const id of ['trade-minutes', 'class-name']) await expect(page.getByTestId(id)).toBeVisible();
    for (const id of ['worksheet-mode', 'activity-ratio', 'incident-freq', 'comeback', 'top-n', 'progress-mode', 'custom-scope']) {
      await expect(page.getByTestId(id)).toBeHidden();
    }
    // 미리보기 맨 위: 오늘 순서·예상 시간·이 차시 학습지, 활동 표는 접힘
    await expect(page.getByTestId('preview-order')).toContainText('차시 표지 → 벽란도 시장');
    await expect(page.getByTestId('preview-order')).toContainText('→ 마무리');
    await expect(page.getByTestId('expected-time')).toContainText('무역 10분');
    const sheet = page.getByTestId('preview-worksheets');
    await expect(sheet).toContainText('이 차시 학습지');
    await expect(sheet.getByTestId('worksheet-pdf-L1')).toHaveAttribute('data-highlight', 'true');
    await expect(page.getByTestId('preview-activities')).toBeHidden();
    await expect(page.locator('body')).not.toContainText('1등급');
    await shot(page, 'setup-basic-1366.png');
    await opensPdf(page, 'worksheet-pdf-L1');
    // 다른 학습지 ▾ → 교사용 예시 답
    await sheet.getByTestId('worksheet-pdf-toggle').click();
    await opensPdf(page, 'worksheet-pdf-teacher-answers');

    // 고급 설정 펼침 — 쉬운 말, 기본값(알아서·저절로)
    await openAdvanced(page);
    await expect(page.getByTestId('progress-mode')).toContainText('시간 맞춰 저절로 넘어가기');
    await expect(page.locator('[data-testid="progress-mode"] button[data-value="auto"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('worksheet-mode')).toContainText('학습지 안 씀');
    await expect(page.getByTestId('activity-ratio')).toContainText('반반');
    await page.mouse.move(0, 0);
    await page.getByTestId('progress-mode').scrollIntoViewIfNeeded();
    await shot(page, 'setup-advanced-1366.png');
    await page.getByTestId('preview-activities-toggle').locator(':scope > summary').click();
    await expect(page.getByTestId('preview-activities')).toBeVisible();
    await expect(page.getByTestId('preview-activities')).toContainText('꼭 할 활동');
    await expect(page.getByTestId('btn-open')).toBeEnabled();
  });

  test('타이틀·학생·공용 화면에는 학습지 PDF 링크가 없다', async ({ page }) => {
    const scripts: string[] = [];
    page.on('response', async (r) => {
      if (/\.js(\?|$)/.test(r.url())) scripts.push(await r.text().catch(() => ''));
    });
    for (const route of ['#/', '#/play', '#/screen']) {
      await page.goto(`./?sync=local${route}`);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('a[href*="print/logbook"]')).toHaveCount(0);
      expect(await page.locator('body').innerText()).not.toContain('학습지 열기');
    }
    expect(scripts.length).toBeGreaterThan(0);
    if (!DEV) for (const s of scripts) expect(s).not.toMatch(/logbook-[A-Za-z0-9-]+\.pdf/); // 빌드본: 교사 묶음 밖에는 없다
  });
});
