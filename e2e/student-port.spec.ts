import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * 작업 108 항구 시장 e2e: `?sync=local`로 실제 교사 화면(109 #/teacher) 탭 + 학생 탭(#/play).
 * 부산에서 반도체 5상자 사기 → 상하이로 출항(교사 [라운드 끝]으로 라운드 진행) → 처음 입항 항구 카드 → 팔기 → [수출] 도장·이익 토스트·개념 카드
 * → 포트헤들랜드(장면·천연가스 아이콘을 일부러 막아 대체 표시 확인)에서 천연가스 사기 → 부산에 팔기 → [수입] 도장 + 관세 10%.
 * 실행: `npx playwright test -c tests/student/playwright.port.config.ts` (개발 서버 5288). 다른 설정에서는 건너뛴다.
 * SHOT_DIR 환경 변수가 있으면 스크린숏을 남긴다.
 */

const RUN = process.env.PORT_E2E === '1';
const SHOT_DIR = process.env.SHOT_DIR;

async function shot(page: Page, name: string) {
  if (!SHOT_DIR) return;
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(SHOT_DIR, name) });
}

async function noHorizontalScroll(p: Page) {
  const r = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(r.sw).toBeLessThanOrEqual(r.cw);
}

async function openTeacher(ctx: BrowserContext): Promise<{ page: Page; code: string }> {
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
  await page.getByTestId('trade-minutes').getByRole('button', { name: '10분' }).click();
  await page.getByTestId('btn-open').click();
  const codeEl = page.getByTestId('room-code');
  await expect(codeEl).toHaveText(/^\d{6}$/);
  return { page, code: (await codeEl.innerText()).trim() };
}

async function openStudent(ctx: BrowserContext, as: string): Promise<Page> {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => {
    throw e;
  });
  await p.goto(`./?sync=local&as=${as}#/play`);
  await expect(p.getByTestId('route-student')).toBeVisible();
  return p;
}

/** 교사 화면에서 라운드가 진행 중이 되게 한다: 앞 활동 마감·건너뛰기(1등급은 확인) */
async function ensureRound(t: Page) {
  for (let i = 0; i < 30; i++) {
    if (await t.getByTestId('round-info').count()) return;
    const close = t.getByTestId('btn-close-event');
    if (await close.isVisible().catch(() => false)) {
      await close.click();
      await t.waitForTimeout(800);
      continue;
    }
    const item = t.getByTestId('tl-next-item').filter({ has: t.getByTestId('tl-skip') }).first();
    if (await item.count()) {
      await item.getByTestId('tl-skip').click();
      const conf = t.getByTestId('confirm-skip-tier1');
      if (await conf.isVisible().catch(() => false)) await t.getByTestId('confirm-ok').click();
    }
    await t.waitForTimeout(1200);
  }
  await expect(t.getByTestId('round-info')).toBeVisible({ timeout: 30_000 });
}

const roundNo = async (t: Page) => {
  if (!(await t.getByTestId('round-info').count())) return 0;
  const m = /라운드 (\d+)/.exec(await t.getByTestId('round-info').innerText());
  return m ? Number(m[1]) : 0;
};

/** 학생이 해도에서 목적지를 고르고 출항 준비 → 교사 [라운드 끝] → 도착 */
async function sailTo(s: Page, t: Page, port: string, label: string) {
  await clearLayers(s, t);
  if (await s.getByTestId('port-screen').count()) await s.getByTestId('port-back').click();
  await s.locator(`.wm-port[data-port="${port}"] .wm-port-hit`).click();
  await expect(s.getByTestId('pick-panel')).toHaveAttribute('data-kind', 'ok');
  await s.getByTestId('pick-confirm').click();
  await s.getByTestId('set-ready').click();
  await expect(s.getByTestId('ready-note')).toBeVisible();
  await expect(t.getByTestId('ready-count')).toContainText('출항 준비 1/1');
  const r0 = await roundNo(t);
  await t.getByTestId('btn-end-round').click();
  await expect.poll(() => roundNo(t), { timeout: 10_000 }).not.toBe(r0);
  await expect(s.getByTestId('toasts')).toContainText(`${label}에 도착했어요`, { timeout: 15_000 });
}

/**
 * (작업 133 수정 1회차) 학생 화면을 덮는 층(교사가 띄운 사건 — 확인 퀴즈 등, 그 뒤 학습지 팝업)을 걷어 내며 누른다.
 * 까닭: 이 시험은 실제 시간으로 돌고 `ensureRound`가 앞 활동을 건너뛰므로, 포트헤들랜드 도착(교사 [라운드 끝] = 라운드 2 끝)이
 * 곧 구간 끝이 되어 **같은 순간** 확인 퀴즈(L1-E8, anchor 'stageEnd')가 뜬다. 예전에는 항구 카드 [시장 둘러보기] 클릭이
 * 사건 층보다 수 ms 먼저 들어가 통과했다(성공 trace: 도착 26.3초 → 클릭 26.4초 → 교사가 26.4초에 사건 닫음). 페이지가 조금만 늦어도
 * (앞 시험이 돈 뒤, 그림 디코드 등) 사건 층·학습지 층이 먼저 덮어 클릭이 4분 동안 막혔다 — 앱 결함이 아니라 시험의 경쟁 상태.
 * 그래서 가려지면 교사가 사건을 닫고(btn-close-event), 학습지 팝업은 학생이 [다 썼어요]로 닫은 뒤 다시 누른다.
 */
async function clearLayers(s: Page, t: Page) {
  const close = t.getByTestId('btn-close-event');
  if (await close.isVisible().catch(() => false)) await close.click().catch(() => undefined);
  const done = s.getByTestId('worksheet-done');
  if ((await done.isVisible().catch(() => false)) && (await done.isEnabled().catch(() => false))) await done.click().catch(() => undefined);
}

async function clickPastLayers(s: Page, t: Page, testId: string) {
  const target = s.getByTestId(testId);
  for (let i = 0; i < 60; i++) {
    try {
      await target.click({ timeout: 1500 });
      return;
    } catch {
      await clearLayers(s, t);
    }
  }
  await target.click();
}

async function plus(s: Page, testId: string, times: number) {
  for (let i = 0; i < times; i++) await s.getByTestId(`${testId}-plus`).click();
}

test.describe.configure({ mode: 'serial' });

test('항구 시장: 부산 반도체 → 상하이 [수출] + 이익, 포트헤들랜드 천연가스 → 부산 [수입] + 관세 10%', async ({ browser, baseURL }) => {
  test.skip(!RUN, 'tests/student/playwright.port.config.ts(개발 서버 + 실제 교사 화면)로 실행');
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ baseURL, viewport: { width: 1366, height: 768 } });
  // 대체 표시 확인용: 포트헤들랜드 장면·천연가스 아이콘을 없는 파일처럼
  // (작업 133) 빌드본은 원본 PNG 대신 해시 붙은 WebP/AVIF 사본(porthedland.<해시>.<폭>.webp 등)을 받으므로 사본까지 막는다
  await ctx.route(/\/assets\/images\/ports\/porthedland\.(png|[0-9a-f]{8}\.\d+\.(webp|avif))$/, (r) => r.fulfill({ status: 404, body: '' }));
  await ctx.route(/\/assets\/images\/goods\/gas\.(png|[0-9a-f]{8}\.\d+\.(webp|avif))$/, (r) => r.fulfill({ status: 404, body: '' }));
  const { page: t, code } = await openTeacher(ctx);

  // ── 학생 입장·회사 설립(선장 4 썸네일 확인) ──
  const s = await openStudent(ctx, 'p01');
  await s.getByTestId('entry-code').fill(code);
  await s.getByTestId('entry-seat').selectOption('5');
  await s.getByTestId('entry-name').fill('해오름무역');
  await s.getByTestId('entry-submit').click();
  await expect(s.getByTestId('found-company')).toBeVisible();
  const cap4 = s.locator('[data-testid="found-avatar-captain-4"] img');
  await expect(cap4).toBeVisible();
  await expect.poll(() => cap4.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(600);
  // 썸네일 칸 안에 사람(머리~허리)이 크게 보임: 칸보다 큰 그림을 잘라 보임
  const crop = await s.locator('[data-testid="found-avatar-captain-4"] .st-avatar__crop').boundingBox();
  expect(crop!.width).toBeGreaterThanOrEqual(60);
  await s.getByTestId('found-avatar-captain-4').click();
  await shot(s, 'found-company-avatars-1366.png');
  await s.getByTestId('found-submit').click();
  await expect(s.getByTestId('prep-wait')).toBeVisible();

  // ── 무역 시작 직후(라운드 전 사전 활동): 거래·출항 버튼 대신 상태 카드 + 라운드 1까지 남은 시간(작업 134) ──
  await t.getByTestId('btn-start-trade').click();
  await t.getByTestId('confirm-ok').click();
  await expect(t.getByTestId('trade-clock')).toBeVisible();
  await expect(s.getByTestId('world-map')).toBeVisible();
  expect(await roundNo(t)).toBe(0);
  await expect(s.getByTestId('round-wait-card')).toBeVisible();
  await expect(s.getByTestId('round-wait-line')).toHaveText(/^라운드 1까지 \d:\d{2}$/);
  await expect(s.getByTestId('enter-port')).toHaveCount(0);
  await expect(s.getByTestId('set-ready')).toHaveCount(0);
  await ensureRound(t);
  await expect(s.getByTestId('round-wait-card')).toHaveCount(0);

  // ── 부산 시장 ──
  await s.getByTestId('enter-port').click();
  await expect(s.getByTestId('port-screen')).toHaveAttribute('data-port', 'BUS');
  await expect(s.getByTestId('port-name')).toHaveText('부산 (대한민국)');
  await expect(s.getByTestId('not-trading')).toHaveCount(0);
  await expect(s.getByTestId('sell-empty')).toBeVisible();
  const chip = s.getByTestId('buy-card-chip');
  await expect(chip.getByTestId('buy-tag')).toHaveText('싸게 살 수 있어요');
  const chipPrice = Number(/(\d+)만 원/.exec(await chip.getByTestId('buy-price').innerText())![1]);
  expect(chipPrice).toBeGreaterThan(80);
  await expect(s.getByTestId('buy-card-graphite').getByTestId('buy-tag')).toHaveText('국내산');
  // K-콘텐츠 = 계약서 카드(배에 싣지 않음)
  await expect(s.getByTestId('buy-card-kcon').getByTestId('service-mark')).toContainText('배에 싣지 않아요');
  await expect(s.getByTestId('hold-info')).toHaveText('배 빈칸 20 · 자금 500만 원');
  // 용어 풀이
  await s.getByTestId('term-goodsMaterial').click();
  await expect(s.getByTestId('term-bubble-goodsMaterial')).toContainText('교과서 96쪽');
  await s.getByTestId('wanted-toggle').click();
  await expect(s.getByTestId('wanted-list')).toContainText('천연가스');
  await expect(s.getByTestId('wanted-list').locator('li.is-hot')).toContainText('천연가스'); // L1 부산 인기
  await shot(s, 'port-busan-1366.png');
  await noHorizontalScroll(s);
  await s.getByTestId('wanted-toggle').click();

  // 반도체 5상자 사기(빠르게 두 번 눌러도 한 번만)
  await plus(s, 'buy-chip', 4);
  await expect(chip.getByTestId('buy-chip-qty')).toContainText('5');
  await chip.getByTestId('buy-chip').dblclick();
  await expect(s.getByTestId('hud-cargo')).toContainText('5/20');
  await expect(s.getByTestId('toasts')).toContainText('반도체 5상자를 샀어요');
  await s.waitForTimeout(700);
  await expect(s.getByTestId('hud-cargo')).toContainText('5/20');
  await expect(s.getByTestId('hud-money')).toContainText(`${500 - chipPrice * 5}만 원`);
  // 부산 특산품은 부산에서 팔 수 없음
  await expect(s.getByTestId('sell-card-chip').getByTestId('sell-reason')).toHaveText('여기서 만드는 상품이라 사지 않아요');
  await expect(s.getByTestId('sell-card-chip')).toContainText(`산 값 ${chipPrice}`);
  await s.getByTestId('tab-story').click();
  await expect(s.getByTestId('port-story')).toContainText('교과서 101쪽');
  await s.getByTestId('tab-market').click();

  // 1180×820에서도 가로 스크롤 없음
  await s.setViewportSize({ width: 1180, height: 820 });
  await noHorizontalScroll(s);
  await shot(s, 'port-busan-1180.png');
  await s.setViewportSize({ width: 1366, height: 768 });

  // ── 상하이로(라운드 진행) → 처음 입항 항구 카드 ──
  await sailTo(s, t, 'SHA', '상하이(중국)');
  await expect(s.getByTestId('port-card')).toBeVisible();
  await expect(s.getByTestId('port-card')).toContainText('세계적인 무역항');
  await expect(s.getByTestId('port-card')).toContainText('교과서 104쪽');
  await expect(s.getByTestId('port-card')).toContainText('이 나라가 싸게 파는 까닭');
  await shot(s, 'port-card-shanghai-1366.png');
  await s.getByTestId('port-card-ok').click();
  await ensureRound(t);

  // ── 상하이 시장: 반도체 팔기 → [수출] 도장 + 이익 토스트 + 개념 카드 ──
  await s.getByTestId('enter-port').click();
  await expect(s.getByTestId('port-screen')).toHaveAttribute('data-port', 'SHA');
  const sellChip = s.getByTestId('sell-card-chip');
  await expect(sellChip.getByTestId('hot-tag')).toContainText('비싸게 팔 수 있어요');
  await expect(sellChip.getByTestId('tariff-badge')).toHaveText('관세 10%'); // 중국 항구에 다른 나라(우리나라) 상품 — 관세 10%(PRD 6.6)
  const sellPrice = Number(/(\d+)만 원/.exec(await sellChip.getByTestId('sell-price').innerText())![1]);
  // 카드 한 장의 숫자: 값·수량·작은 산 값만(+ 관세 도장 글자 "관세 10%")
  const tariffText = await sellChip.getByTestId('tariff-badge').innerText();
  const nums = ((await sellChip.innerText()).replace(tariffText, '').match(/\d+/g) ?? []).map(Number);
  expect(nums.sort((a, b) => a - b)).toEqual([1, chipPrice, sellPrice].sort((a, b) => a - b));
  await expect(s.getByTestId('limit-sentence')).toContainText('이 항구는 반도체를 20상자까지 제값에 사요');
  await expect(s.getByTestId('tariff-who')).toHaveText('중국은 다른 나라에서 들어오는 상품에 관세를 매겨요.');
  await expect(sellChip.getByTestId('tariff-rule-tag')).toHaveText('게임 규칙');
  await plus(s, 'sell-chip', 4);
  await shot(s, 'port-shanghai-sell-1366.png');
  await sellChip.getByTestId('sell-chip').click();
  await expect(s.getByTestId('result-stamp-export')).toBeVisible();
  await expect(s.getByTestId('result-stamp-export')).toContainText('수출');
  const profit = sellPrice * 5 - chipPrice * 5 - Math.round(sellPrice * 5 * 0.1);
  await expect(s.getByTestId('result-stamp-tariff')).toContainText('관세 10%');
  await expect(s.getByTestId('sale-tariff-line')).toContainText('중국에서는 우리 상품이 수입품이라 중국에 관세를 냈어요');
  await expect(s.getByTestId('profit-text')).toHaveText(`+${profit}만 원 남았어요!`);
  await expect(s.getByTestId('toasts')).toContainText(`+${profit}만 원 남았어요!`);
  await expect(s.getByTestId('concept-pop')).toContainText('무역·수입·수출');
  await expect(s.getByTestId('concept-pop')).toContainText('교과서 96쪽');
  await shot(s, 'port-shanghai-export-1366.png');
  await s.getByTestId('concept-ok').click();
  await expect(s.getByTestId('sell-empty')).toBeVisible();

  // ── 포트헤들랜드(장면·아이콘 없음 → 대체 표시)에서 천연가스 사기 ──
  await sailTo(s, t, 'PHE', '포트헤들랜드(오스트레일리아)');
  await expect(s.getByTestId('port-card')).toBeVisible();
  await expect(s.getByTestId('port-card').getByTestId('port-scene-fallback')).toBeVisible();
  // 도착 = 구간 끝 → 확인 퀴즈·학습지 층과 겹칠 수 있다(clickPastLayers 설명)
  await clickPastLayers(s, t, 'port-card-ok');
  await ensureRound(t);
  await clickPastLayers(s, t, 'enter-port');
  await expect(s.getByTestId('port-screen')).toHaveAttribute('data-port', 'PHE');
  await expect(s.getByTestId('port-scene-fallback')).toBeVisible();
  const gas = s.getByTestId('buy-card-gas');
  await expect(gas.getByTestId('good-fallback-gas')).toHaveText('천');
  await plus(s, 'buy-gas', 5);
  await gas.getByTestId('buy-gas').click();
  await expect(s.getByTestId('hud-cargo')).toContainText('6/20');
  await shot(s, 'port-porthedland-fallback-1366.png');

  // ── 부산에 천연가스 팔기 → [수입] 도장 + 관세 10% ──
  await sailTo(s, t, 'BUS', '부산(대한민국)');
  await ensureRound(t);
  await clickPastLayers(s, t, 'enter-port');
  await expect(s.getByTestId('port-screen')).toHaveAttribute('data-port', 'BUS');
  const sellGas = s.getByTestId('sell-card-gas');
  await expect(sellGas.getByTestId('tariff-badge')).toHaveText('관세 10%');
  await expect(sellGas.getByTestId('hot-tag')).toBeVisible();
  await expect(s.getByTestId('tariff-who')).toHaveText('우리나라는 다른 나라에서 들어오는 상품에 관세를 매겨요.');
  await plus(s, 'sell-gas', 5);
  await sellGas.getByTestId('sell-gas').click();
  await expect(s.getByTestId('result-stamp-import')).toContainText('수입');
  await expect(s.getByTestId('result-stamp-tariff')).toContainText('관세 10%');
  await expect(s.getByTestId('sale-tariff-line')).toContainText('우리나라에 관세를 냈어요');
  await expect(s.getByTestId('profit-text')).toContainText('만 원');
  await shot(s, 'port-busan-import-tariff-1366.png');
  await noHorizontalScroll(s);

  await ctx.close();
});
