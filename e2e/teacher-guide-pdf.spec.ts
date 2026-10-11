import { expect, test, type Page } from '@playwright/test';

/**
 * 작업 141 — 교사 시작 화면 '공략집' 링크(선생님 편·학생 편 PDF).
 * - 기본 `npm run e2e`(빌드본 vite preview): dist/print/guide-*.pdf 가 새 탭으로 열린다(200·application/pdf·%PDF-).
 * - `tests/teacher/playwright.config.ts`(개발 서버): 같은 주소를 개발 서버 미들웨어가 print/dist 원본에서 준다.
 * 공략집 PDF는 `npm run guide:build`가 만든다(print/dist/대항해무역왕_공략집_*.pdf). 없으면 링크 줄 자체가 없다.
 */

async function freshTeacher(page: Page) {
  await page.goto('./?sync=local#/teacher');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
  await expect(page.getByTestId('teacher-start')).toBeVisible({ timeout: 30_000 });
}

test.describe('공략집 PDF(작업 141)', () => {
  test('시작 화면 [공략집] 선생님 편·학생 편 → 새 탭 PDF', async ({ page }) => {
    await freshTeacher(page);
    const row = page.getByTestId('guide-pdf-links');
    await expect(row).toBeVisible();
    await expect(row).toContainText('공략집');
    for (const [key, label] of [
      ['guide-teacher', '선생님 편'],
      ['guide-student', '학생 편'],
    ] as const) {
      const link = page.getByTestId(`guide-pdf-${key}`);
      await expect(link).toContainText(label);
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', 'noopener');
      const href = (await link.getAttribute('href')) ?? '';
      expect(href).toMatch(new RegExp(`^\\./print/${key}\\.pdf\\?v=[0-9a-f]+$`));
      const ctx = page.context();
      const resp = ctx.waitForEvent('response', { predicate: (r) => r.url().includes(`/print/${key}.pdf`), timeout: 15_000 });
      const popupP = ctx.waitForEvent('page', { timeout: 15_000 });
      await link.click();
      const popup = await popupP;
      const r = await resp;
      expect(r.status()).toBe(200);
      expect(r.headers()['content-type'] ?? '').toContain('application/pdf');
      await popup.close().catch(() => undefined);
      const direct = await page.request.get(new URL(href, page.url()).toString());
      expect(direct.status()).toBe(200);
      const body = await direct.body();
      expect(body.subarray(0, 5).toString()).toBe('%PDF-');
      expect(body.length).toBeGreaterThan(100_000);
    }
  });

  test('타이틀·학생·공용 화면에는 공략집 링크가 없다', async ({ page }) => {
    for (const route of ['#/', '#/play', '#/screen']) {
      await page.goto(`./?sync=local${route}`);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('a[href*="print/guide-"]')).toHaveCount(0);
    }
  });
});
