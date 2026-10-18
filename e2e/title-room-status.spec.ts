import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * 작업 131: 타이틀의 "사용 중인 방 n/최대"·하단 이용 안내 한 줄·[이용 안내] 창.
 * 작업 132(v0.3.4): 타이틀의 방 수는 기본 숨김(`display.titleRoomCount: true`일 때만), 하단 둘째 줄 저작권·문의(글자만),
 *   [이용 안내] 9번 = 기본 문의, 타이틀을 열기만 해서는 /health를 읽지 않음([이용 안내]를 처음 열 때 1번).
 * 미리보기(빌드)는 syncMode()가 relay라서 `./health`를 읽는다. 응답은 page.route로 흉내 낸다.
 * SHOT_DIR 환경 변수가 있으면 그 폴더에 스크린숏을 남긴다(작업 결과 보고용).
 */

const SHOT_DIR = process.env.SHOT_DIR;

async function shot(page: Page, name: string) {
  if (!SHOT_DIR) return;
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: join(SHOT_DIR, name) });
}

interface Mock {
  health?: unknown | 'fail' | 'http500';
  config?: unknown;
}

/** /health·/notice·config.json 흉내. 반환값: /health 요청 횟수를 읽는 함수 */
async function mockServer(page: Page, m: Mock): Promise<() => number> {
  let healthCount = 0;
  await page.route('**/health', async (route: Route) => {
    healthCount += 1;
    if (m.health === 'fail') return route.abort('failed');
    if (m.health === 'http500') return route.fulfill({ status: 500, body: 'error' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(m.health ?? {}) });
  });
  await page.route('**/notice', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ level: null }) }),
  );
  await page.route('**/config.json', (route) =>
    m.config === undefined
      ? route.fulfill({ status: 404, body: 'not found' })
      : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(m.config) }),
  );
  return () => healthCount;
}

/** 타이틀에 방 수를 보이게 하는 설정(v0.3.4 기본은 숨김) */
const SHOW = { display: { titleRoomCount: true } };
const CREDIT = 'Copyright 2026. hanuipyo';

const health = (rooms: number, maxRooms = 50, acceptingNewRooms = rooms < maxRooms) => ({
  ok: true,
  version: '0.1.0',
  rooms,
  maxRooms,
  acceptingNewRooms,
  notice: null,
});

test.describe('타이틀 — 사용 중인 방', () => {
  test('정상 23/50: [선생님으로 시작] 아래 같은 열에 보인다', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await mockServer(page, { health: health(23), config: SHOW });
    await page.goto('./');
    const rc = page.getByTestId('room-count');
    await expect(rc).toHaveText('사용 중인 방 23/50');
    await expect(rc).toHaveAttribute('data-kind', 'ok');
    await expect(rc).toHaveAttribute('aria-live', 'polite');
    // 같은 열(선생님 버튼 바로 아래), 학생 버튼 쪽에는 없음
    const col = page.getByTestId('title-teacher-col');
    await expect(col.getByRole('link', { name: '선생님으로 시작' })).toBeVisible();
    await expect(col.getByTestId('room-count')).toBeVisible();
    const t = await page.getByRole('link', { name: '선생님으로 시작' }).boundingBox();
    const r = await rc.boundingBox();
    expect(r!.y).toBeGreaterThan(t!.y + t!.height - 1);
    // 글자 16px 이상
    const fs = await page.getByTestId('room-count-text').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(fs).toBeGreaterThanOrEqual(16);
    await page.evaluate(() => document.fonts.ready);
    await shot(page, 'title-ok-23.png');
    expect(errors).toEqual([]);
  });

  test('응답의 maxRooms를 따른다(7/30)', async ({ page }) => {
    await mockServer(page, { health: health(7, 30), config: SHOW });
    await page.goto('./');
    await expect(page.getByTestId('room-count')).toHaveText('사용 중인 방 7/30');
  });

  test('붐빔 42/50', async ({ page }) => {
    await mockServer(page, { health: health(42), config: SHOW });
    await page.goto('./');
    await expect(page.getByTestId('room-count')).toHaveText('사용 중인 방 42/50 · 붐벼요');
  });

  test('가득 참 50/50 — [선생님으로 시작]은 막지 않는다', async ({ page }) => {
    await mockServer(page, { health: health(50), config: SHOW });
    await page.goto('./');
    await expect(page.getByTestId('room-count')).toHaveText('사용 중인 방 50/50 · 가득 찼어요');
    await expect(page.getByTestId('room-count')).toHaveAttribute('data-kind', 'full');
    await page.evaluate(() => document.fonts.ready);
    await shot(page, 'title-full-50.png');
    await page.getByRole('link', { name: '선생님으로 시작' }).click();
    await expect(page).toHaveURL(/#\/teacher$/);
  });

  test('점검(acceptingNewRooms false) 12/50', async ({ page }) => {
    await mockServer(page, { health: health(12, 50, false), config: SHOW });
    await page.goto('./');
    await expect(page.getByTestId('room-count')).toHaveText('사용 중인 방 12/50 · 점검 중이라 새 방을 열 수 없어요');
  });

  test('응답 실패 → 알 수 없음 + [다시 확인]', async ({ page }) => {
    let mode: 'fail' | 'ok' = 'fail';
    let count = 0;
    await page.route('**/health', (route) => {
      count += 1;
      return mode === 'fail'
        ? route.abort('failed')
        : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(health(23)) });
    });
    await page.route('**/notice', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"level":null}' }));
    await page.route('**/config.json', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SHOW) }));
    await page.goto('./');
    const rc = page.getByTestId('room-count');
    await expect(rc).toContainText('사용 중인 방: 알 수 없음');
    const again = page.getByRole('button', { name: '다시 확인' });
    await expect(again).toBeVisible();
    const box = await again.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(48);
    await page.evaluate(() => document.fonts.ready);
    await shot(page, 'title-unknown.png');
    mode = 'ok';
    await again.click();
    await expect(rc).toHaveText('사용 중인 방 23/50');
    expect(count).toBe(2);
  });

  test('HTTP 500 → 알 수 없음', async ({ page }) => {
    await mockServer(page, { health: 'http500', config: SHOW });
    await page.goto('./');
    await expect(page.getByTestId('room-count')).toContainText('알 수 없음');
  });

  test('로컬 모드(?sync=local)면 방 수를 보이지 않고 /health를 읽지 않는다', async ({ page }) => {
    const count = await mockServer(page, { health: health(23) });
    await page.goto('./?sync=local#/');
    await expect(page.getByTestId('route-title')).toBeVisible();
    await expect(page.getByTestId('service-footer')).toBeVisible();
    await page.waitForTimeout(500);
    await expect(page.getByTestId('room-count')).toHaveCount(0);
    expect(count()).toBe(0);
  });

  test('(v0.3.4) 기본(config 없음)이면 타이틀에 방 수가 없고, [이용 안내]를 열기 전에는 /health 0번 → 처음 열 때 1번', async ({ page }) => {
    const count = await mockServer(page, { health: health(23) });
    await page.goto('./');
    await expect(page.getByTestId('service-footer')).toBeVisible();
    await expect(page.getByTestId('service-footer-credit')).toHaveText(CREDIT);
    await page.waitForTimeout(800);
    await expect(page.getByTestId('room-count')).toHaveCount(0);
    expect(await page.locator('body').innerText()).not.toContain('사용 중인 방');
    expect(count()).toBe(0);
    await page.evaluate(() => document.fonts.ready);
    await shot(page, 'title-default-hidden-1366.png');
    // [이용 안내]를 처음 열 때 1번 읽어 상한을 채운다
    await page.getByRole('button', { name: '이용 안내' }).click();
    await expect(page.getByTestId('service-notice-items').locator('li').nth(2)).toContainText('방은 50개');
    expect(count()).toBe(1);
    await page.getByRole('button', { name: '닫기' }).click();
    await page.getByRole('button', { name: '이용 안내' }).click();
    await expect(page.getByTestId('service-notice-items').locator('li').nth(2)).toContainText('방은 50개');
    expect(count()).toBe(1);
  });

  test('config.json display.titleRoomCount=false면 타이틀에서 숨긴다', async ({ page }) => {
    await mockServer(page, { health: health(23), config: { display: { titleRoomCount: false } } });
    await page.goto('./');
    await expect(page.getByTestId('service-footer')).toBeVisible();
    // 이용 안내 창의 상한 숫자는 그대로 읽힌다
    await page.getByRole('button', { name: '이용 안내' }).click();
    await expect(page.getByTestId('service-notice-items')).toContainText('방은 50개');
    await expect(page.getByTestId('room-count')).toHaveCount(0);
  });

  test('타이틀은 주기적으로 /health를 읽지 않는다(titleRoomCount true — 60초 동안 1번)', async ({ page }) => {
    await page.clock.install();
    const count = await mockServer(page, { health: health(23), config: SHOW });
    await page.goto('./');
    await expect(page.getByTestId('room-count')).toHaveText('사용 중인 방 23/50');
    await page.clock.runFor(60_000);
    await page.waitForTimeout(300);
    await page.clock.runFor(60_000);
    await page.waitForTimeout(300);
    expect(count()).toBe(1);
  });
});

test.describe('하단 이용 안내', () => {
  test('두 줄(안내 + 저작권·문의, 둘째 줄은 글자만) + [이용 안내] 창 열고 닫기(버튼·Esc·바깥 클릭), 9번 기본 문의', async ({ page }) => {
    await mockServer(page, { health: health(23) });
    await page.goto('./');
    const footer = page.getByTestId('service-footer');
    await expect(footer).toBeVisible();
    const text = page.getByTestId('service-footer-text');
    await expect(text).toHaveText(
      '이 게임 서버는 교사 한 사람이 개인적으로 운영하는 무료 서버예요. 예고 없이 점검하거나 멈출 수 있어요. 학생 실명은 받지 않고, 학생 정보는 서버에 저장하지 않아요.',
    );
    await expect(text).not.toContainText('문의');
    const fs = await text.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(fs).toBeGreaterThanOrEqual(14);
    // 둘째 줄: 저작권·문의(12px 이상, 같은 띠 안, 링크 없음, 흰 글씨)
    const credit = page.getByTestId('service-footer-credit');
    await expect(credit).toHaveText(CREDIT);
    await expect(credit.locator('a')).toHaveCount(0);
    await expect(footer.locator('a')).toHaveCount(0);
    const cfs = await credit.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(cfs).toBeGreaterThanOrEqual(12);
    expect(await credit.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(255, 255, 255)');
    const fb = (await footer.boundingBox())!;
    const crb = (await credit.boundingBox())!;
    const tb = (await text.boundingBox())!;
    expect(crb.y).toBeGreaterThanOrEqual(tb.y + tb.height - 0.5); // 첫 줄 아래
    expect(crb.y + crb.height).toBeLessThanOrEqual(fb.y + fb.height + 0.5); // 같은 띠 안
    const open = page.getByRole('button', { name: '이용 안내' });
    const ob = await open.boundingBox();
    expect(ob!.height).toBeGreaterThanOrEqual(48);

    // 버튼으로 열고 [닫기]
    await open.click();
    const dlg = page.getByRole('dialog', { name: '이용 안내' });
    await expect(dlg).toBeVisible();
    await expect(dlg).toBeFocused();
    const items = page.getByTestId('service-notice-items').locator('li');
    await expect(items).toHaveCount(9);
    await expect(items.nth(2)).toContainText('동시에 열 수 있는 방은 50개');
    await expect(items.nth(2)).toContainText("선생님 시작 화면과 판 설정의 [방 열기] 위 '사용 중인 방'에서 확인할 수 있습니다.");
    await expect(items.nth(8)).toHaveText('문의: GitHub 저장소(github.com/UP-HAN/voyage-trade-king)');
    await expect(dlg.locator('a')).toHaveCount(0);
    // [닫기]가 화면 안에 온전히 보인다(1366×768)
    const cb = (await page.getByRole('button', { name: '닫기' }).boundingBox())!;
    expect(cb.y + cb.height).toBeLessThanOrEqual(768);
    await page.evaluate(() => document.fonts.ready);
    await shot(page, 'service-notice-dialog.png');
    await page.getByRole('button', { name: '닫기' }).click();
    await expect(dlg).toHaveCount(0);
    await expect(open).toBeFocused();

    // Esc
    await open.click();
    await expect(dlg).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
    await expect(open).toBeFocused();

    // 바깥 클릭
    await open.click();
    await expect(dlg).toBeVisible();
    await page.mouse.click(5, 5);
    await expect(dlg).toHaveCount(0);
  });

  test('config.json serverInfo가 있으면 문의 줄이 보인다(글자로만, 안전한 링크만)', async ({ page }) => {
    await mockServer(page, {
      health: health(23),
      config: {
        serverInfo: { operator: '<b>홍길동</b>', contact: 'mailto:teacher@example.org', repoUrl: 'https://github.com/example/voyage' },
      },
    });
    await page.goto('./');
    const text = page.getByTestId('service-footer-text');
    await expect(text).toContainText(' · 문의: <b>홍길동</b> mailto:teacher@example.org');
    await expect(text.locator('b')).toHaveCount(0); // HTML로 해석되지 않음
    const mail = text.getByRole('link', { name: 'mailto:teacher@example.org' });
    await expect(mail).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(mail).toHaveAttribute('target', '_blank');
    await page.getByRole('button', { name: '이용 안내' }).click();
    const items = page.getByTestId('service-notice-items').locator('li');
    await expect(items).toHaveCount(9);
    await expect(items.nth(8)).toHaveText('문의: <b>홍길동</b> · mailto:teacher@example.org');
    // 저작권 줄은 serverInfo와 관계없이 그대로
    await expect(page.getByTestId('service-footer-credit')).toHaveText(CREDIT);
    await expect(items.nth(7)).toContainText('설치 안내: https://github.com/example/voyage');
    await expect(items.nth(7).getByRole('link')).toHaveAttribute('href', 'https://github.com/example/voyage');
  });

  test('링크가 아닌 연락처(javascript: 등)는 글자로만', async ({ page }) => {
    await mockServer(page, { health: health(23), config: { serverInfo: { contact: 'javascript:alert(1)' } } });
    await page.goto('./');
    const text = page.getByTestId('service-footer-text');
    await expect(text).toContainText('문의: javascript:alert(1)');
    await expect(text.getByRole('link')).toHaveCount(0);
  });

  test('/health를 못 읽으면 창의 상한은 "정해진 수"', async ({ page }) => {
    await mockServer(page, { health: 'fail' });
    await page.goto('./');
    await page.getByRole('button', { name: '이용 안내' }).click();
    await expect(page.getByTestId('service-notice-items').locator('li').nth(2)).toContainText('방은 정해진 수, 같은 학교');
  });
});

test.describe('보이지 않아야 하는 곳', () => {
  for (const hash of ['#/play', '#/screen']) {
    test(`${hash}에는 방 수·이용 안내가 없다`, async ({ page }) => {
      const count = await mockServer(page, { health: health(23) });
      await page.goto(`./${hash}`);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(500);
      const body = await page.locator('body').innerText();
      expect(body).not.toContain('사용 중인 방');
      expect(body).not.toContain('이용 안내');
      await expect(page.getByTestId('room-count')).toHaveCount(0);
      await expect(page.getByTestId('service-footer')).toHaveCount(0);
      expect(count()).toBe(0);
    });
  }
});

test.describe('배치 — 겹침·잘림 없음', () => {
  for (const [w, h] of [
    [1920, 1080],
    [1366, 768],
    [1180, 820],
  ] as const) {
    test(`${w}×${h}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await mockServer(page, { health: health(23), config: SHOW });
      await page.goto('./');
      await expect(page.getByTestId('room-count')).toHaveText('사용 중인 방 23/50');
      await page.evaluate(() => document.fonts.ready);
      const box = async (sel: ReturnType<Page['locator']>) => (await sel.boundingBox())!;
      const panel = await box(page.locator('.title-screen__panel'));
      const footer = await box(page.getByTestId('service-footer'));
      const btn = await box(page.getByRole('button', { name: '이용 안내' }));
      const rc = await box(page.getByTestId('room-count'));
      const credit = await box(page.getByTestId('service-footer-credit'));
      // 모두 화면 안
      for (const b of [panel, footer, btn, rc, credit]) {
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.y).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width).toBeLessThanOrEqual(w + 0.5);
        expect(b.y + b.height).toBeLessThanOrEqual(h + 0.5);
      }
      // 패널과 하단 줄이 겹치지 않음
      expect(panel.y + panel.height).toBeLessThanOrEqual(footer.y + 0.5);
      // 버튼이 하단 줄 안에 온전히
      expect(btn.x + btn.width).toBeLessThanOrEqual(footer.x + footer.width + 0.5);
      // 가로 스크롤 없음
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(sw).toBeLessThanOrEqual(w);
      if (w === 1180) await shot(page, 'title-1180x820.png');
    });
  }
});
