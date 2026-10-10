import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';

/**
 * 작업 113 미니게임 e2e(`?sync=local`): 실제 교사 화면(#/teacher) + 공용 화면(#/screen, 1920×1080) + 학생 탭(#/play, 1366×768).
 * 가짜 시계(`context.clock`)로 자동 진행 배치표를 앞으로 돌린다.
 *
 * A. 차시 한 판 L1 25분(벽란도 [넣기] = 전체 형태, 두 섬 전체):
 *    벽란도 — s1 끌어 놓기(마우스·터치)+누르기, 새로 고침해도 배치 유지, 전부 맞힘(+180만) / s2 2장 틀림(+140만) →
 *    정답 공개·정의 카드(p.96)·재분류(비단=수입, 인삼=수출) → 공용 화면 분포(이름 없음) →
 *    두 섬 — s1 1·2단계(힌트)·3단계 검산 예로 성공(막대그래프·끝 문장 p.99, +50만) / s2 1단계 그대로 교환 0 → 실패, 3분 뒤 [예시 따라 하기] →
 *    교사 일시정지가 미니게임을 덮음 → 공용 화면 "성공 2명" → 늦게 온 s3: 지금 열린 두 섬 → 따라잡기로 벽란도(전체 형태).
 * B. 차시 한 판 L1 10분(벽란도·두 섬 짧은 형태): 벽란도 카드 5장(×36만, 최대 180만, 재분류 없음),
 *    s2는 정답 공개 화면에서 교사가 [마감] → 화면이 닫히며 결과가 보내져 보너스 반영 / 두 섬 3단계부터 + [예시 따라 하기] 처음부터.
 *
 * 실행: `npx playwright test -c tests/minigames/playwright.config.ts`(개발 서버 5402). 다른 설정에서는 건너뛴다.
 * SHOT_DIR 환경 변수가 있으면 스크린숏을 남긴다.
 */

const RUN = process.env.MINIGAMES_E2E === '1';
const SHOT_DIR = process.env.SHOT_DIR;

const SOLD = ['silk', 'medicine', 'books', 'instrument', 'jewel'];
const BOUGHT = ['hemp', 'ramie', 'ginseng', 'paper'];
const answerOf = (id: string) => (SOLD.includes(id) ? 'sold' : 'bought');
const other = (side: string) => (side === 'sold' ? 'bought' : 'sold');

async function shot(page: Page, name: string) {
  if (!SHOT_DIR) return;
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(SHOT_DIR, name) });
}

async function openTeacher(ctx: BrowserContext, o: { minutes: number; forms?: Record<string, '넣기' | '짧게'> }): Promise<{ page: Page; code: string }> {
  const page = await ctx.newPage();
  await page.goto('./?sync=local#/teacher');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
  await page.getByTestId('btn-new').click();
  await page.getByTestId('unit-lesson').click();
  await page.getByTestId('lesson-L1').click();
  const custom = page.getByTestId('trade-minutes-custom');
  await custom.fill(String(o.minutes));
  await custom.blur();
  await expect(custom).toHaveValue(String(o.minutes));
  for (const [id, label] of Object.entries(o.forms ?? {})) {
    await page.getByTestId(`act-${id}`).getByRole('button', { name: label }).click();
    await expect(page.getByTestId(`act-${id}`).getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'true');
  }
  await page.getByTestId('btn-open').click();
  const codeEl = page.getByTestId('room-code');
  await expect(codeEl).toHaveText(/^\d{6}$/);
  return { page, code: (await codeEl.innerText()).trim() };
}

async function openScreen(ctx: BrowserContext, t: Page): Promise<Page> {
  const [scr] = await Promise.all([ctx.waitForEvent('page'), t.getByTestId('btn-open-screen').click()]);
  await scr.setViewportSize({ width: 1920, height: 1080 });
  await expect(scr.getByTestId('route-screen')).toBeVisible();
  return scr;
}

async function joinStudent(ctx: BrowserContext, as: string, code: string, seat: number, name: string, errors: string[]): Promise<Page> {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${as}: ${e.message}`));
  await p.goto(`./?sync=local&as=${as}#/play`);
  await expect(p.getByTestId('route-student')).toBeVisible();
  await p.getByTestId('entry-code').fill(code);
  await p.getByTestId('entry-seat').selectOption(String(seat));
  await p.getByTestId('entry-name').fill(name);
  await p.getByTestId('entry-submit').click();
  await expect(p.getByTestId('found-company')).toBeVisible({ timeout: 15_000 });
  await p.getByTestId('found-submit').click();
  return p;
}

/** 조건이 맞을 때까지 1초씩 돌린다(최대 maxSec) */
async function advanceUntil(ctx: BrowserContext, t: Page, check: () => Promise<boolean>, maxSec: number) {
  for (let i = 0; i < maxSec; i++) {
    if (await check()) return;
    await ctx.clock.runFor(1000);
    await t.waitForTimeout(60);
  }
  expect(await check()).toBe(true);
}

const mg = (p: Page, id?: string) => (id ? p.locator(`[data-testid="minigame"][data-event="${id}"]`) : p.getByTestId('minigame'));
const card = (p: Page, id: string) => p.locator(`[data-testid="bk-card"][data-item="${id}"]`);

async function money(p: Page): Promise<number> {
  const txt = (await p.getByTestId('hud-money').innerText()).replace(/\s+/g, ' ');
  const m = txt.match(/(?:(\d+)억\s*)?([\d,]+)만/);
  if (!m) throw new Error(`자금 글자: ${txt}`);
  return Number(m[1] ?? 0) * 10000 + Number(m[2].replace(/,/g, ''));
}

/** 1366×768에서 스크롤 없이: 미니게임 틀이 화면 안이고, 안쪽이 넘치지 않는다 */
async function expectNoScroll(p: Page) {
  const r = await p.evaluate(() => {
    const el = document.querySelector('[data-testid="minigame"]') as HTMLElement | null;
    if (!el) return null;
    const b = el.getBoundingClientRect();
    const over = [el, ...Array.from(el.querySelectorAll<HTMLElement>('.mg-body, .bk-baskets, .bk-basket__cards, .ti-islands'))].filter((x) => x.scrollHeight > x.clientHeight + 2).map((x) => x.className);
    return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, vw: innerWidth, vh: innerHeight, over, docScroll: document.scrollingElement!.scrollHeight > innerHeight + 1 };
  });
  expect(r).not.toBeNull();
  expect(r!.over, '넘치는 칸').toEqual([]);
  expect(r!.top).toBeGreaterThanOrEqual(0);
  expect(r!.bottom).toBeLessThanOrEqual(r!.vh);
  expect(r!.right).toBeLessThanOrEqual(r!.vw);
  expect(r!.docScroll).toBe(false);
}

/** 마우스로 카드를 바구니에 끌어 놓기 */
async function mouseDrag(p: Page, id: string, side: string) {
  const from = (await card(p, id).boundingBox())!;
  const to = (await p.getByTestId(`bk-basket-${side}`).boundingBox())!;
  await p.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await p.mouse.down();
  await p.mouse.move(from.x + from.width / 2 + 15, from.y + from.height / 2 + 15, { steps: 3 });
  await p.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
  await p.mouse.up();
}

/** 터치(크롬북·태블릿)로 끌어 놓기 — pointerType 'touch' 포인터 이벤트 */
async function touchDrag(p: Page, id: string, side: string) {
  const c = card(p, id);
  const from = (await c.boundingBox())!;
  const to = (await p.getByTestId(`bk-basket-${side}`).boundingBox())!;
  const base = { pointerId: 41, pointerType: 'touch', isPrimary: true, button: 0, bubbles: true, cancelable: true };
  const fx = from.x + from.width / 2;
  const fy = from.y + from.height / 2;
  const tx = to.x + to.width / 2;
  const ty = to.y + to.height / 2;
  await c.dispatchEvent('pointerdown', { ...base, clientX: fx, clientY: fy, buttons: 1 });
  for (let i = 1; i <= 6; i++) await c.dispatchEvent('pointermove', { ...base, clientX: fx + ((tx - fx) * i) / 6, clientY: fy + ((ty - fy) * i) / 6, buttons: 1 });
  await c.dispatchEvent('pointerup', { ...base, clientX: tx, clientY: ty, buttons: 0 });
}

/** 누르기 → 바구니 누르기 */
async function tapPlace(p: Page, id: string, side: string) {
  await card(p, id).click();
  await expect(card(p, id)).toHaveAttribute('aria-pressed', 'true');
  await p.getByTestId(`bk-basket-btn-${side}`).click();
  await expect(card(p, id)).toHaveAttribute('data-place', side);
}

/** 벽란도: 남은 카드를 모두 누르기로 넣는다(wrong에 든 카드는 반대 바구니) */
async function placeRest(p: Page, ids: readonly string[], wrong: readonly string[] = []) {
  for (const id of ids) {
    if ((await card(p, id).getAttribute('data-place')) !== 'tray') continue;
    await tapPlace(p, id, wrong.includes(id) ? other(answerOf(id)) : answerOf(id));
  }
}

/** 벽란도 정의 카드·재분류(전체 형태) → [마치기] */
async function finishDefine(p: Page, reclass: boolean) {
  await p.waitForTimeout(550); // 연속 클릭 가드(500ms)
  const def = p.getByTestId('bk-define');
  await expect(def).toContainText('교과서 p.96');
  await expect(def).toContainText('무역');
  await expect(def).toContainText('수입');
  await expect(def).toContainText('수출');
  if (reclass) {
    await p.locator('[data-testid="bk-q"][data-item="silk"]').getByTestId('bk-q-import').click();
    await expect(p.locator('[data-testid="bk-q"][data-item="silk"]').getByTestId('bk-q-result')).toHaveAttribute('data-ok', '1');
    await p.waitForTimeout(550); // 연속 클릭 가드(500ms)
    await p.locator('[data-testid="bk-q"][data-item="ginseng"]').getByTestId('bk-q-import').click(); // 일부러 틀림 → 정답 수출
    const r = p.locator('[data-testid="bk-q"][data-item="ginseng"]').getByTestId('bk-q-result');
    await expect(r).toHaveAttribute('data-ok', '0');
    await expect(r).toContainText('정답은 수출');
  } else {
    await expect(p.getByTestId('bk-reclass')).toHaveCount(0);
  }
  await p.waitForTimeout(550);
}

async function setDays(p: Page, island: 'A' | 'B', days: number) {
  const box = p.getByTestId(`ti-island-${island}`);
  for (let i = 0; i < 12; i++) {
    const cur = Number(await box.getAttribute('data-rice-days'));
    if (cur === days) return;
    await p.getByTestId(`ti-${island}-rice-${cur < days ? 'plus' : 'minus'}`).click();
  }
  await expect(box).toHaveAttribute('data-rice-days', String(days));
}

async function setUnits(p: Page, units: number) {
  const tr = p.getByTestId('ti-trade');
  for (let i = 0; i < 30; i++) {
    const cur = Number(await tr.getAttribute('data-units'));
    if (cur === units) return;
    await p.getByTestId(cur < units ? 'ti-units-plus' : 'ti-units-minus').click();
  }
  await expect(tr).toHaveAttribute('data-units', String(units));
}

async function screenResult(scr: Page, id: string): Promise<Locator> {
  const l = scr.locator(`[data-testid="scene-minigameResult"][data-event="${id}"]`);
  await expect(l).toBeVisible();
  return l;
}

test.describe.configure({ mode: 'serial' });

test('A. 전체 형태: 벽란도·두 섬 — 끌어 놓기·정답 공개·보너스·결과 장면·일시정지·늦은 입장 따라잡기', async ({ browser, baseURL }) => {
  test.skip(!RUN, 'tests/minigames/playwright.config.ts(개발 서버 + 실제 교사·공용 화면)로 실행');
  const ctx = await browser.newContext({ baseURL, viewport: { width: 1366, height: 768 } });
  await ctx.clock.install();
  const errors: string[] = [];
  const { page: t, code } = await openTeacher(ctx, { minutes: 25, forms: { 'L1-E1': '넣기', 'L1-E5': '넣기' } });
  t.on('pageerror', (e) => errors.push(`teacher: ${e.message}`));
  const scr = await openScreen(ctx, t);
  scr.on('pageerror', (e) => errors.push(`screen: ${e.message}`));
  const s1 = await joinStudent(ctx, 'm01', code, 1, '해오름무역', errors);
  const s2 = await joinStudent(ctx, 'm02', code, 2, '바다상회', errors);
  await expect(s1.getByTestId('prep-wait')).toBeVisible();
  await expect(s2.getByTestId('prep-wait')).toBeVisible();
  const start1 = await money(s1);
  const start2 = await money(s2);

  await t.getByTestId('btn-start-trade').click();
  await t.getByTestId('confirm-ok').click();
  await expect(t.getByTestId('trade-clock')).toBeVisible();

  // ── 벽란도 시장(전체 형태 9장) ──
  await advanceUntil(ctx, t, async () => (await mg(s1, 'L1-E1').count()) > 0 && (await mg(s2, 'L1-E1').count()) > 0, 120);
  for (const s of [s1, s2]) {
    await expect(mg(s, 'L1-E1')).toHaveAttribute('data-step', 'sort');
    await expect(s.getByTestId('bk-card')).toHaveCount(9);
    await expect(s.getByTestId('minigame-short')).toHaveCount(0);
  }
  await expect(s1.getByTestId('bk-basket-sold')).toContainText('다른 나라 상인이 판 물건');
  await expect(s1.getByTestId('bk-basket-bought')).toContainText('다른 나라 상인이 사 간 물건');
  await expectNoScroll(s1);
  await shot(s1, 'A-student-bk-sort-1366.png');
  // 공용 화면: 아직 아무도 안 했으면 사건 카드
  await expect(scr.locator('[data-testid="scene-event"][data-event="L1-E1"]')).toBeVisible();

  // s1: 마우스 끌기 2장, 터치 끌기 1장, 누르기 1장
  await mouseDrag(s1, 'silk', 'sold');
  await expect(card(s1, 'silk')).toHaveAttribute('data-place', 'sold');
  await mouseDrag(s1, 'ginseng', 'bought');
  await expect(card(s1, 'ginseng')).toHaveAttribute('data-place', 'bought');
  await touchDrag(s1, 'paper', 'bought');
  await expect(card(s1, 'paper')).toHaveAttribute('data-place', 'bought');
  await tapPlace(s1, 'jewel', 'sold');
  // 바구니 안 카드를 다른 바구니로 옮기고 다시 되돌리기(누르기)
  await tapPlace(s1, 'jewel', 'bought');
  await tapPlace(s1, 'jewel', 'sold');
  await shot(s1, 'A-student-bk-sorting-1366.png');
  // 새로 고침해도 배치 유지
  await s1.reload();
  await expect(mg(s1, 'L1-E1')).toBeVisible({ timeout: 15_000 });
  for (const [id, side] of [['silk', 'sold'], ['ginseng', 'bought'], ['paper', 'bought'], ['jewel', 'sold']]) await expect(card(s1, id)).toHaveAttribute('data-place', side);
  await expect(s1.getByTestId('bk-submit')).toBeDisabled();
  await placeRest(s1, [...SOLD, ...BOUGHT]);
  await s1.getByTestId('bk-submit').click();
  await expect(mg(s1, 'L1-E1')).toHaveAttribute('data-step', 'reveal');
  await expect(s1.getByTestId('bk-score')).toHaveAttribute('data-correct', '9');
  await expect(s1.getByTestId('bk-bonus')).toHaveText('180만 원');
  await expect(s1.getByTestId('bk-reveal-card')).toHaveCount(9);
  await expect(mg(s1, 'L1-E1')).toContainText('교과서 p.95');

  // s2: 2장 틀림(악기 → 사 간, 모시 → 판)
  await placeRest(s2, [...SOLD, ...BOUGHT], ['instrument', 'ramie']);
  await s2.getByTestId('bk-submit').click();
  await expect(s2.getByTestId('bk-score')).toHaveAttribute('data-correct', '7');
  await expect(s2.getByTestId('bk-bonus')).toHaveText('140만 원');
  const moved = s2.locator('[data-testid="bk-reveal-card"][data-ok="0"]');
  await expect(moved).toHaveCount(2);
  // 틀린 카드는 올바른 바구니로 옮겨 짧은 이유
  await expect(s2.getByTestId('bk-basket-sold').locator('[data-item="instrument"]')).toContainText('악기는 다른 나라 상인이 가져와서 판 물건이에요.');
  await expect(s2.getByTestId('bk-basket-bought').locator('[data-item="ramie"]')).toContainText('모시는 다른 나라 상인이 고려에서 사 간 물건이에요.');
  await expectNoScroll(s2);
  await shot(s2, 'A-student-bk-reveal-1366.png');

  // 정의 카드 + 재분류 → 마치기
  await s1.getByTestId('bk-next').click();
  await expect(mg(s1, 'L1-E1')).toHaveAttribute('data-step', 'define');
  await finishDefine(s1, true);
  await expectNoScroll(s1);
  await shot(s1, 'A-student-bk-define-1366.png');
  await s1.getByTestId('minigame-finish').click();
  await expect(mg(s1)).toHaveCount(0);
  await expect(s1.getByTestId('event-waiting')).toBeVisible();
  await expect.poll(() => money(s1)).toBe(start1 + 180);

  // 공용 화면: 한 명이 마치면 결과 장면(이름 없음)
  const r1 = await screenResult(scr, 'L1-E1');
  await expect(r1.getByTestId('mg-result-count')).toHaveText(/다 한 친구\s*1\s*명/);
  await expect(r1.getByTestId('mg-result-bar')).toHaveCount(10);

  await s2.getByTestId('bk-next').click();
  await finishDefine(s2, true);
  await s2.getByTestId('minigame-finish').click();
  await expect(mg(s2)).toHaveCount(0);
  await expect.poll(() => money(s2)).toBe(start2 + 140);
  await expect(r1).toHaveAttribute('data-done', '2');
  await expect(r1.getByTestId('mg-result-count')).toHaveText(/다 한 친구\s*2\s*명/);
  const barsText = await r1.getByTestId('mg-result-bars').innerText();
  expect(barsText).not.toContain('해오름무역');
  expect(barsText).not.toContain('바다상회');
  await expect(r1.getByTestId('mg-result-bar').nth(9)).toHaveAttribute('data-value', '1');
  await expect(r1.getByTestId('mg-result-bar').nth(7)).toHaveAttribute('data-value', '1');
  await shot(scr, 'A-screen-bk-result-1920.png');

  // ── 두 섬 이야기(전체 형태) ──
  await advanceUntil(ctx, t, async () => (await mg(s1, 'L1-E5').count()) > 0 && (await mg(s2, 'L1-E5').count()) > 0, 900);
  const afterBk1 = await money(s1);
  const afterBk2 = await money(s2);
  await expect(mg(s1, 'L1-E5')).toHaveAttribute('data-step', 'stage1');
  await expect(s1.getByTestId('ti-island-A')).toContainText('하루 일하면 쌀 6 또는 옷 12');
  await expect(s1.getByTestId('ti-island-B')).toContainText('하루 일하면 쌀 5 또는 옷 2');
  await expect(s1.getByTestId('ti-A-made')).toHaveAttribute('data-rice', '30');
  await expect(s1.getByTestId('ti-A-made')).toHaveAttribute('data-clothes', '60');
  await expect(s1.getByTestId('ti-B-made')).toHaveAttribute('data-rice', '25');
  await expect(s1.getByTestId('ti-B-made')).toHaveAttribute('data-clothes', '10');
  await expect(s1.getByTestId('ti-example')).toHaveCount(0); // 3분 전에는 없음
  // 숫자 큰 글씨(24px 이상)
  const fs = await s1.getByTestId('ti-A-made').locator('.mg-num').first().evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  expect(fs).toBeGreaterThanOrEqual(24);
  await expectNoScroll(s1);
  await shot(s1, 'A-student-ti-stage1-1366.png');
  // 1단계: 슬라이더로 바꿔 보기(생산량 즉시)
  await s1.getByTestId('ti-A-slider').fill('7');
  await expect(s1.getByTestId('ti-A-made')).toHaveAttribute('data-rice', '42');
  await s1.getByTestId('ti-A-slider').fill('5');
  await s1.getByTestId('ti-next').click();
  await expect(mg(s1, 'L1-E5')).toHaveAttribute('data-step', 'stage2');
  await s1.waitForTimeout(550);
  await s1.getByTestId('ti-hint').click();
  await expect(s1.getByTestId('ti-hint-text')).toContainText('㉯섬은 쌀에, ㉮섬은 옷에 더 많은 날을 써 보세요.');
  await setDays(s1, 'A', 2);
  await setDays(s1, 'B', 10);
  await expect(s1.getByTestId('ti-A-made')).toHaveAttribute('data-clothes', '96');
  await expect(s1.getByTestId('ti-B-made')).toHaveAttribute('data-rice', '50');
  await expectNoScroll(s1);
  await shot(s1, 'A-student-ti-stage2-1366.png');
  await s1.waitForTimeout(550);
  await s1.getByTestId('ti-next').click();
  await expect(mg(s1, 'L1-E5')).toHaveAttribute('data-step', 'stage3');
  await expect(s1.getByTestId('ti-status')).toHaveAttribute('data-success', '0');
  await expect(s1.getByTestId('ti-complete')).toBeDisabled();
  await setUnits(s1, 4);
  await expect(s1.getByTestId('ti-A-judge')).toHaveAttribute('data-ok', '0');
  await expect(s1.getByTestId('ti-A-judge')).toContainText('모자라요');
  await shot(s1, 'A-student-ti-stage3-partial-1366.png');
  await setUnits(s1, 10);
  await expect(s1.getByTestId('ti-give-clothes')).toHaveText('30');
  await expect(s1.getByTestId('ti-give-rice')).toHaveText('20');
  await expect(s1.getByTestId('ti-A-after')).toHaveAttribute('data-rice', '32');
  await expect(s1.getByTestId('ti-A-after')).toHaveAttribute('data-clothes', '66');
  await expect(s1.getByTestId('ti-B-after')).toHaveAttribute('data-rice', '30');
  await expect(s1.getByTestId('ti-B-after')).toHaveAttribute('data-clothes', '30');
  await expect(s1.getByTestId('ti-A-judge')).toContainText('목표 달성');
  await expect(s1.getByTestId('ti-B-judge')).toHaveAttribute('data-ok', '1');
  await expect(s1.getByTestId('ti-status')).toHaveAttribute('data-success', '1');
  await expectNoScroll(s1);
  await shot(s1, 'A-student-ti-stage3-success-1366.png');
  await s1.waitForTimeout(550);
  await s1.getByTestId('ti-complete').click();
  await expect(mg(s1, 'L1-E5')).toHaveAttribute('data-step', 'result');
  await expect(s1.getByTestId('ti-chart')).toBeVisible();
  await expect(s1.getByTestId('ti-bar-s1')).toHaveCount(4);
  await expect(s1.getByTestId('ti-end')).toContainText('각 나라가 잘 만드는 것을 수출하고, 만들기 어려운 것을 수입하면 더 좋은 상품을 더 싸게 쓸 수 있어요.');
  await expect(s1.getByTestId('ti-end')).toContainText('p.99');
  await expectNoScroll(s1);
  await shot(s1, 'A-student-ti-result-1366.png');

  // s2: 1단계 그대로 + 교환 0이면 실패(완료 버튼 꺼짐), 1단계 그대로 교환해도 실패
  await s2.getByTestId('ti-next').click();
  await s2.waitForTimeout(550);
  await s2.getByTestId('ti-next').click();
  await expect(mg(s2, 'L1-E5')).toHaveAttribute('data-step', 'stage3');
  await expect(s2.getByTestId('ti-status')).toHaveAttribute('data-success', '0');
  await expect(s2.getByTestId('ti-complete')).toBeDisabled();
  // 교환 0: 섬별 ✓ 없이 "아직 바꾸지 않았어요"(수정 1회차)
  for (const k of ['A', 'B']) {
    await expect(s2.getByTestId(`ti-${k}-judge`)).toHaveAttribute('data-ok', '0');
    await expect(s2.getByTestId(`ti-${k}-judge`)).toContainText('아직 바꾸지 않았어요');
  }
  await setUnits(s2, 1);
  await expect(s2.getByTestId('ti-status')).toHaveAttribute('data-success', '0');
  await expect(s2.getByTestId('ti-complete')).toBeDisabled();

  // 교사 일시정지 → 미니게임 위를 덮음
  await t.getByTestId('btn-pause').click();
  await expect(s2.locator('[data-layer="pause"]')).toBeVisible();
  const z = await s2.evaluate(() => {
    const pz = Number(getComputedStyle(document.querySelector('[data-layer="pause"]')!).zIndex);
    const mz = Number(getComputedStyle(document.querySelector('[data-layer="minigame"]')!).zIndex);
    return { pz, mz };
  });
  expect(z.pz).toBeGreaterThan(z.mz);
  await shot(s2, 'A-student-ti-paused-1366.png');
  await t.getByTestId('btn-resume-trade').click();
  await expect(s2.locator('[data-layer="pause"]')).toHaveCount(0);

  // 3분 뒤 [예시 따라 하기]
  await advanceUntil(ctx, t, async () => (await s2.getByTestId('ti-example').count()) > 0, 200);
  await expect(mg(s2, 'L1-E5')).toBeVisible();
  await s2.getByTestId('ti-example').click();
  await expect(mg(s2, 'L1-E5')).toHaveAttribute('data-step', 'result');
  await expect(s2.getByTestId('ti-success')).toContainText('예시를 따라 했어요');
  await s2.waitForTimeout(550);
  await s2.getByTestId('minigame-finish').click();
  await expect(mg(s2)).toHaveCount(0);
  await expect.poll(() => money(s2)).toBe(afterBk2 + 50);

  await s1.getByTestId('minigame-finish').click();
  await expect(mg(s1)).toHaveCount(0);
  await expect.poll(() => money(s1)).toBe(afterBk1 + 50);

  const r5 = await screenResult(scr, 'L1-E5');
  await expect(r5.getByTestId('mg-result-count')).toHaveText(/성공\s*2\s*명\s*\/\s*참여\s*2\s*명/);
  await expect(r5.getByTestId('mg-result-bar')).toHaveCount(4);
  const r5Text = await r5.innerText();
  expect(r5Text).not.toContain('해오름무역');
  expect(r5Text).not.toContain('바다상회');
  // 두 명 모두 검산 예(합계 쌀 62·옷 96) → 평균 62·96, 1단계 55·70
  await expect(r5.getByTestId('mg-result-bar').nth(0)).toContainText('55');
  await expect(r5.getByTestId('mg-result-bar').nth(1)).toContainText('62');
  await expect(r5.getByTestId('mg-result-bar').nth(2)).toContainText('70');
  await expect(r5.getByTestId('mg-result-bar').nth(3)).toContainText('96');
  await shot(scr, 'A-screen-ti-result-1920.png');

  // ── 늦게 온 s3: 지금 열린 두 섬 → 따라잡기(벽란도 전체 형태) ──
  const s3 = await joinStudent(ctx, 'm03', code, 3, '늦은배무역', errors);
  await expect(mg(s3, 'L1-E5')).toBeVisible({ timeout: 15_000 });
  const start3 = await money(s3);
  // 3단계까지 가서 직접 성공
  await s3.getByTestId('ti-next').click();
  await s3.waitForTimeout(550);
  await s3.getByTestId('ti-next').click();
  await setDays(s3, 'A', 2);
  await setDays(s3, 'B', 10);
  await setUnits(s3, 10);
  await s3.waitForTimeout(550);
  await s3.getByTestId('ti-complete').click();
  await s3.waitForTimeout(550);
  await s3.getByTestId('minigame-finish').click();
  await expect(r5.getByTestId('mg-result-count')).toHaveText(/성공\s*3\s*명/);
  // 지금 사건이 열려 있는 동안은 "기다려요"(111) — 교사가 마감하면 따라잡기가 뜬다
  await expect(s3.getByTestId('event-waiting')).toBeVisible();
  await t.getByTestId('btn-close-event').click();
  await expect(s3.getByTestId('event-waiting')).toHaveCount(0);
  await expect(s3.getByTestId('catchup'), await s3.locator('body').innerText()).toBeVisible({ timeout: 10_000 });
  // 따라잡기 큐를 끝까지(요약 카드·결정은 넘기고, 벽란도는 실제로)
  let sawBk = false;
  for (let i = 0; i < 8; i++) {
    const cu = s3.getByTestId('catchup');
    if (!(await cu.count())) {
      await s3.waitForTimeout(400);
      if (!(await cu.count())) break;
    }
    const mode = await cu.getAttribute('data-mode');
    const ev = await cu.getAttribute('data-event');
    if (mode === 'summary') {
      await s3.getByTestId('catchup-ok').click();
    } else if (ev === 'L1-E1') {
      sawBk = true;
      await expect(mg(s3, 'L1-E1')).toBeVisible();
      await expect(s3.getByTestId('bk-card')).toHaveCount(9);
      await expect(mg(s3, 'L1-E1')).toContainText('놓친 활동');
      await expectNoScroll(s3);
      await shot(s3, 'A-student-late-catchup-bk-1366.png');
      await placeRest(s3, [...SOLD, ...BOUGHT], ['hemp']);
      await s3.getByTestId('bk-submit').click();
      await expect(s3.getByTestId('bk-score')).toHaveAttribute('data-correct', '8');
      await s3.waitForTimeout(550);
      await s3.getByTestId('bk-next').click();
      await finishDefine(s3, true);
      await s3.getByTestId('minigame-finish').click();
      await expect(mg(s3, 'L1-E1')).toHaveCount(0);
    } else if (await s3.getByTestId('decision-opt-none').count()) {
      await s3.getByTestId('decision-opt-none').click();
      await s3.getByTestId('decision-submit').click();
      await s3.getByTestId('catchup-next').click();
    } else if (await s3.getByTestId('card-confirm').count()) {
      await s3.getByTestId('card-confirm').click();
    } else break;
    await s3.waitForTimeout(300);
  }
  expect(sawBk).toBe(true);
  await expect.poll(() => money(s3)).toBe(start3 + 50 + 160);

  expect(errors).toEqual([]);
  await ctx.close();
});

test('B. 짧은 형태: 벽란도 5장(×36만)·마감 때 결과 보내기, 두 섬 3단계부터·[예시 따라 하기] 처음부터', async ({ browser, baseURL }) => {
  test.skip(!RUN, 'tests/minigames/playwright.config.ts로 실행');
  const ctx = await browser.newContext({ baseURL, viewport: { width: 1366, height: 768 } });
  await ctx.clock.install();
  const errors: string[] = [];
  const { page: t, code } = await openTeacher(ctx, { minutes: 10, forms: { 'L1-E1': '짧게', 'L1-E5': '짧게' } });
  const scr = await openScreen(ctx, t);
  const s1 = await joinStudent(ctx, 'n01', code, 1, '짧은무역', errors);
  const s2 = await joinStudent(ctx, 'n02', code, 2, '빠른상회', errors);
  await expect(s1.getByTestId('prep-wait')).toBeVisible();
  const start1 = await money(s1);
  const start2 = await money(s2);
  await t.getByTestId('btn-start-trade').click();
  await t.getByTestId('confirm-ok').click();
  await expect(t.getByTestId('trade-clock')).toBeVisible();

  await advanceUntil(ctx, t, async () => (await mg(s1, 'L1-E1').count()) > 0 && (await mg(s2, 'L1-E1').count()) > 0, 120);
  for (const s of [s1, s2]) {
    await expect(s.getByTestId('minigame-short')).toBeVisible();
    await expect(s.getByTestId('bk-card')).toHaveCount(5);
  }
  const ids = await s1.getByTestId('bk-card').evaluateAll((els) => els.map((e) => e.getAttribute('data-item')));
  expect([...ids].sort()).toEqual(['books', 'ginseng', 'medicine', 'paper', 'silk']);
  await expect(mg(s1, 'L1-E1')).toContainText('36만 원');
  await expectNoScroll(s1);
  await shot(s1, 'B-student-bk-short-sort-1366.png');
  await placeRest(s1, ['silk', 'medicine', 'books', 'ginseng', 'paper']);
  await s1.getByTestId('bk-submit').click();
  await expect(s1.getByTestId('bk-score')).toHaveAttribute('data-total', '5');
  await expect(s1.getByTestId('bk-bonus')).toHaveText('180만 원');
  await s1.waitForTimeout(550);
  await s1.getByTestId('bk-next').click();
  await finishDefine(s1, false); // 짧은 형태: 정의 카드만, 재분류 없음
  await shot(s1, 'B-student-bk-short-define-1366.png');
  await s1.getByTestId('minigame-finish').click();
  await expect.poll(() => money(s1)).toBe(start1 + 180);

  // s2: 1장 틀리고 정답 공개 화면에서 멈춤 → 교사 [마감] → 화면이 닫히며 첫 제출 결과가 보내져 보너스 4 × 36 = 144
  await placeRest(s2, ['silk', 'medicine', 'books', 'ginseng', 'paper'], ['books']);
  await s2.getByTestId('bk-submit').click();
  await expect(s2.getByTestId('bk-bonus')).toHaveText('144만 원');
  await t.getByTestId('btn-close-event').click();
  await expect(mg(s2)).toHaveCount(0);
  await expect.poll(() => money(s2)).toBe(start2 + 144);
  const r1 = await screenResult(scr, 'L1-E1');
  await expect(r1.getByTestId('mg-result-bar')).toHaveCount(6); // 0~5장
  await expect(r1).toHaveAttribute('data-done', '2');
  await shot(scr, 'B-screen-bk-short-result-1920.png');

  // 두 섬(짧게): 3단계부터, 예시 버튼 처음부터
  await advanceUntil(ctx, t, async () => (await mg(s1, 'L1-E5').count()) > 0 && (await mg(s2, 'L1-E5').count()) > 0, 600);
  const m1 = await money(s1);
  const m2 = await money(s2);
  for (const s of [s1, s2]) {
    await expect(mg(s, 'L1-E5')).toHaveAttribute('data-step', 'stage3');
    await expect(s.getByTestId('ti-example')).toBeVisible();
    await expect(s.getByTestId('ti-guide')).toContainText('쌀 30·옷 60');
    await expect(s.getByTestId('ti-A-judge')).toHaveAttribute('data-ok', '0');
    await expect(s.getByTestId('ti-B-judge')).toContainText('아직 바꾸지 않았어요');
  }
  await expectNoScroll(s1);
  await shot(s1, 'B-student-ti-short-stage3-1366.png');
  await s1.getByTestId('ti-example').click();
  await expect(mg(s1, 'L1-E5')).toHaveAttribute('data-step', 'result');
  await expect(s1.getByTestId('ti-end')).toContainText('p.99');
  await s1.waitForTimeout(550);
  await s1.getByTestId('minigame-finish').click();
  await expect.poll(() => money(s1)).toBe(m1 + 50);
  // s2: 직접
  await setDays(s2, 'A', 2);
  await setDays(s2, 'B', 10);
  await setUnits(s2, 10);
  await expect(s2.getByTestId('ti-status')).toHaveAttribute('data-success', '1');
  await s2.waitForTimeout(550);
  await s2.getByTestId('ti-complete').click();
  await s2.waitForTimeout(550);
  await s2.getByTestId('minigame-finish').click();
  await expect.poll(() => money(s2)).toBe(m2 + 50);
  const r5 = await screenResult(scr, 'L1-E5');
  await expect(r5.getByTestId('mg-result-count')).toHaveText(/성공\s*2\s*명/);
  await shot(scr, 'B-screen-ti-short-result-1920.png');
  expect(errors).toEqual([]);
  await ctx.close();
});
