import { expect, test } from '@playwright/test';

test('타이틀이 뜨고 4개 라우트가 열린다', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('./');
  const title = page.getByTestId('route-title');
  await expect(title).toBeVisible();
  await expect(page.getByRole('heading', { name: '대항해 무역왕' })).toBeVisible();
  await expect(page.getByText('6학년 사회 · 세계 속의 무역')).toBeVisible();
  await expect(page.getByRole('link', { name: '학생으로 참여' })).toBeVisible();
  await expect(page.getByRole('link', { name: '선생님으로 시작' })).toBeVisible();

  // 키아트 그림이 실제로 내려받아지는지(작업 133: CSS 배경 → <img>, 빌드본은 크기별 WebP/AVIF 사본)
  const art = page.getByTestId('title-keyart');
  await expect.poll(() => art.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  const src = await art.evaluate((el: HTMLImageElement) => el.currentSrc);
  expect(src).toMatch(/assets\/images\/title\/keyart\.[0-9a-f]{8}\.\d+\.(webp|avif)$/);
  // 원본 PNG도 대비용으로 남아 있다
  const keyart = await page.request.get('./assets/images/title/keyart.png');
  expect(keyart.status()).toBe(200);

  // 학생으로 참여 → #/play
  await page.getByRole('link', { name: '학생으로 참여' }).click();
  await expect(page).toHaveURL(/#\/play$/);
  await expect(page.getByTestId('route-student')).toBeVisible();
  await expect(page.getByRole('heading', { name: '학생 화면' })).toBeVisible();

  for (const [hash, testId, heading] of [
    ['#/teacher', 'route-teacher', '선생님 대시보드'],
    ['#/screen', 'route-screen', '공용 화면'],
    ['#/', 'route-title', '대항해 무역왕'],
  ] as const) {
    await page.goto(`./${hash}`);
    await expect(page.getByTestId(testId)).toBeVisible();
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  }

  // 글꼴이 로드되는지(동봉 woff2)
  await page.goto('./');
  const fontsOk = await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([document.fonts.load('20px "Song Myung"', '대항해'), document.fonts.load('18px "Gowun Dodum"', '무역')]);
    return document.fonts.check('20px "Song Myung"', '대항해') && document.fonts.check('18px "Gowun Dodum"', '무역');
  });
  expect(fontsOk).toBe(true);

  expect(errors).toEqual([]);
});
