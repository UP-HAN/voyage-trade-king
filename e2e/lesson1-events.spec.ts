import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * 작업 111 사건·결정 카드 e2e(`?sync=local`): 실제 교사 화면(#/teacher) + 공용 화면(#/screen, 1920×1080) + 학생 탭(#/play, 107 실제 화면).
 * 브라우저 문맥 전체에 가짜 시계(`context.clock`)를 깔고 자동 진행 배치표를 앞으로 돌린다(실제 18분을 몇 분에).
 *
 * A. 차시 한 판 L1 18분(+ L1-E8 확인 퀴즈 [넣기]) — 처음부터 끝까지:
 *    배치표 시각에 L1-E1(미니게임 — 113) → L1-E2 개념 → 1라운드 L1-E6 천연가스 뉴스·임무 + 튜토리얼 → L1-E4(짧게) →
 *    2라운드 L1-E7 흑연 결정(응답 2/2 → [결과 공개] 막대) → L1-E5(미니게임 — 113 화면을 [마치기]까지) → 늦게 온 3번째 학생 따라잡기 →
 *    3라운드 부산 천연가스 판매로 임무 완료 → [이 학생만 사건 다시 보내기] → L1-E8 확인 퀴즈(응답 수·정답률·해설) → 마무리.
 * B. 단원 한 판 25분: L1-E2 짧은 형태, L1-E4 전체(상황 카드 2장), L1-E7 카드에 unitOnlyNote(학생·공용 화면).
 *
 * 실행: `npx playwright test -c tests/student/playwright.events.config.ts`(개발 서버 5311). 다른 설정에서는 건너뛴다.
 * SHOT_DIR 환경 변수가 있으면 스크린숏을 남긴다.
 */

const RUN = process.env.EVENTS_E2E === '1';
const SHOT_DIR = process.env.SHOT_DIR;

async function shot(page: Page, name: string) {
  if (!SHOT_DIR) return;
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(450); // 카드 등장(0.3초) 뒤
  await page.screenshot({ path: join(SHOT_DIR, name) });
}

async function openTeacher(
  ctx: BrowserContext,
  o: { unit?: boolean; minutes: number; forms?: Record<string, '넣기' | '짧게'>; worksheetOff?: boolean },
): Promise<{ page: Page; code: string }> {
  const page = await ctx.newPage();
  await page.goto('./?sync=local#/teacher');
  await page.evaluate((unit: boolean) => {
    localStorage.clear();
    sessionStorage.clear();
    // (작업 134) 단원 한 판은 기능 플래그로 막혀 있다 — 시험에서는 개발용 열쇠로 연다
    if (unit) localStorage.setItem('voyage.dev.fullUnit', '1');
  }, !!o.unit);
  await page.reload();
  await page.getByTestId('btn-new').click();
  if (o.unit) await page.getByTestId('unit-unit').click();
  else {
    await page.getByTestId('unit-lesson').click();
    await page.getByTestId('lesson-L1').click();
  }
  const custom = page.getByTestId('trade-minutes-custom');
  await custom.fill(String(o.minutes));
  await custom.blur();
  await expect(custom).toHaveValue(String(o.minutes));
  if (o.worksheetOff) {
    const seg = page.getByTestId('worksheet-mode').getByRole('button', { name: '끄기', exact: true });
    await seg.click();
    await expect(seg).toHaveAttribute('aria-pressed', 'true');
  }
  for (const [id, label] of Object.entries(o.forms ?? {})) {
    await page.getByTestId(`act-${id}`).getByRole('button', { name: label }).click();
    await expect(page.getByTestId(`act-${id}`).getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'true');
  }
  await page.getByTestId('btn-open').click();
  const codeEl = page.getByTestId('room-code');
  await expect(codeEl).toHaveText(/^\d{6}$/);
  return { page, code: (await codeEl.innerText()).trim() };
}

/**
 * (수정 2회차) 공용 화면 기기 시계를 일부러 어긋나게 한다(가짜 시계 위에 Date.now만 skewMs 더함 — #/screen 페이지만).
 * 결과 표시·무역 시계는 호스트 시각(다리 메시지 hostNow)으로 보정되어야 한다.
 */
async function skewScreenClock(scr: Page, skewMs: number) {
  // 페이지가 열린 뒤 바꾼다(가짜 시계가 Date를 다시 깔기 때문). 화면 코드는 부를 때마다 Date.now()를 읽는다
  await scr.evaluate((ms: number) => {
    const orig = Date.now.bind(Date);
    Date.now = () => orig() + ms;
  }, skewMs);
}

async function expectScreenSkew(scr: Page, t: Page, skewMs: number) {
  const a = await scr.evaluate(() => Date.now());
  const b = await t.evaluate(() => Date.now());
  expect(Math.abs(a - b - skewMs)).toBeLessThan(5000);
}

async function openScreen(ctx: BrowserContext, t: Page): Promise<Page> {
  const [scr] = await Promise.all([ctx.waitForEvent('page'), t.getByTestId('btn-open-screen').click()]);
  await scr.setViewportSize({ width: 1920, height: 1080 });
  await expect(scr.getByTestId('route-screen')).toBeVisible();
  return scr;
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
  return p;
}

/** 교사 화면 무역 시계로 경과 초 */
async function elapsed(t: Page, total: number): Promise<number> {
  const sec = Number(await t.getByTestId('trade-clock').getAttribute('data-sec'));
  return total - sec;
}

/** 가짜 시계를 target 초(무역 경과)까지 돌린다 */
async function advanceTo(ctx: BrowserContext, t: Page, total: number, target: number) {
  for (let i = 0; i < 2000; i++) {
    const e = await elapsed(t, total);
    if (e >= target) return e;
    const step = Math.min(4000, Math.max(1000, (target - e) * 1000));
    await ctx.clock.runFor(step);
    await t.waitForTimeout(60);
  }
  throw new Error(`시계를 ${target}초까지 돌리지 못했어요`);
}

/** 조건이 맞을 때까지 1초씩 돌린다(최대 maxSec) */
async function advanceUntil(ctx: BrowserContext, t: Page, check: () => Promise<boolean>, maxSec: number) {
  for (let i = 0; i < maxSec; i++) {
    if (await check()) return;
    await ctx.clock.runFor(1000);
    await t.waitForTimeout(80);
  }
  expect(await check()).toBe(true);
}

const cardOf = (p: Page, id: string) => p.locator(`[data-testid="event-card"][data-event="${id}"], [data-testid="decision-card"][data-event="${id}"], [data-testid="quiz-card"][data-event="${id}"]`);
const screenEvent = (scr: Page, id: string) => scr.locator(`[data-testid="scene-event"][data-event="${id}"]`);

async function sailTo(s: Page, port: string) {
  if (await s.getByTestId('port-screen').count()) await s.getByTestId('port-back').click();
  const hit = s.locator(`.wm-port[data-port="${port}"] .wm-port-hit`);
  const box = await hit.boundingBox();
  const vp = s.viewportSize()!;
  // 지금 화면 밖이면(포트헤들랜드 등) [전체 보기]로 지도를 넓힌다 — 튜토리얼 안내 그대로
  if (!box || box.y + box.height / 2 > vp.height - 100 || box.x < 0 || box.x > vp.width) await s.getByRole('button', { name: '전체 보기' }).click();
  await hit.click();
  await expect(s.getByTestId('pick-panel')).toHaveAttribute('data-kind', 'ok');
  await s.getByTestId('pick-confirm').click();
  await s.getByTestId('set-ready').click();
  await expect(s.getByTestId('ready-note')).toBeVisible();
}

/**
 * (작업 113) 미니게임(벽란도·두 섬)을 짧게 끝낸다 — 자리표시 [닫기] 대신 실제 화면을 [마치기]까지.
 * 벽란도: 카드를 정답 바구니에 누르기로 넣고 [다 넣었어요] → [다음] → (재분류 질문이 있으면 정답) → [마치기].
 * 두 섬: [예시 따라 하기](짧은 형태·따라잡기면 처음부터)가 있으면 그것으로, 없으면 3단계에서 검산 예를 넣고 [바꾸기 완료] → [마치기].
 * 결과 버튼은 연속 클릭 가드(500ms)가 있어 사이에 0.55초 쉰다.
 */
const BK_SOLD = new Set(['silk', 'medicine', 'books', 'instrument', 'jewel']);
async function finishMinigame(s: Page) {
  const mg = s.getByTestId('minigame');
  await expect(mg).toBeVisible();
  const id = await mg.getAttribute('data-event');
  const pause = () => s.waitForTimeout(550);
  if (id === 'L1-E1') {
    const trayCard = s.locator('[data-testid="bk-card"][data-place="tray"]');
    for (let i = 0; i < 12 && (await trayCard.count()) > 0; i++) {
      const item = (await trayCard.first().getAttribute('data-item')) ?? '';
      await s.locator(`[data-testid="bk-card"][data-item="${item}"]`).click();
      await s.getByTestId(`bk-basket-btn-${BK_SOLD.has(item) ? 'sold' : 'bought'}`).click();
      await expect(s.locator(`[data-testid="bk-card"][data-item="${item}"]`)).not.toHaveAttribute('data-place', 'tray');
    }
    await s.getByTestId('bk-submit').click();
    await pause();
    await s.getByTestId('bk-next').click();
    for (const [item, w] of [['silk', 'import'], ['ginseng', 'export']]) {
      const q = s.locator(`[data-testid="bk-q"][data-item="${item}"]`);
      if (!(await q.count())) continue;
      await pause();
      await q.getByTestId(`bk-q-${w}`).click();
    }
  } else if (id === 'L1-E5') {
    if (await s.getByTestId('ti-example').count()) {
      await s.getByTestId('ti-example').click();
    } else {
      while ((await mg.getAttribute('data-step')) !== 'stage3') {
        await s.getByTestId('ti-next').click();
        await pause();
      }
      await s.getByTestId('ti-A-slider').fill('2');
      await s.getByTestId('ti-B-slider').fill('10');
      for (let i = 0; i < 10; i++) await s.getByTestId('ti-units-plus').click();
      await pause();
      await s.getByTestId('ti-complete').click();
    }
  }
  await pause();
  await s.getByTestId('minigame-finish').click();
  await expect(s.locator(`[data-testid="minigame"][data-event="${id}"]`)).toHaveCount(0);
}

async function closePortCard(s: Page) {
  const ok = s.getByTestId('port-card-ok');
  if (await ok.isVisible().catch(() => false)) await ok.click();
}

test.describe.configure({ mode: 'serial' });

test('A. 차시 한 판 L1: 모든 사건이 배치표 시각에 뜨고 응답·결정·따라잡기가 반영된다', async ({ browser, baseURL }) => {
  test.skip(!RUN, 'tests/student/playwright.events.config.ts(개발 서버 + 실제 교사·공용 화면)로 실행');
  const TOTAL = 18 * 60;
  const ctx = await browser.newContext({ baseURL, viewport: { width: 1366, height: 768 } });
  await ctx.clock.install();
  const errors: string[] = [];
  // (작업 132) 사건 시각을 고정하려고 학습지 배치를 '끄기'로 둔다 — v0.3.4 '지금 쓰기' ③★(40초)가 들어가면 라운드가 3 → 2개로
  // 바뀌어 아래 시각표가 달라진다. 지금 쓰기는 worksheet-letters·lesson1-full e2e가 확인한다
  const { page: t, code } = await openTeacher(ctx, { minutes: 18, forms: { 'L1-E8': '넣기' }, worksheetOff: true });
  t.on('pageerror', (e) => errors.push(`teacher: ${e.message}`));
  const scr = await openScreen(ctx, t);
  await skewScreenClock(scr, 30_000); // 공용 화면 기기 시계 +30초
  await expectScreenSkew(scr, t, 30_000);
  scr.on('pageerror', (e) => errors.push(`screen: ${e.message}`));
  const s1 = await joinStudent(ctx, 'p01', code, 1, '해오름무역');
  const s2 = await joinStudent(ctx, 'p02', code, 2, '바다상회');
  await expect(s1.getByTestId('prep-wait')).toBeVisible();
  await expect(s2.getByTestId('prep-wait')).toBeVisible();

  await t.getByTestId('btn-start-trade').click();
  await t.getByTestId('confirm-ok').click();
  await expect(t.getByTestId('trade-clock')).toBeVisible();
  // 배치표(18분 + 확인 퀴즈 넣기): 표지 0 · L1-E1 20(짧게) · L1-E2 170 · 1라운드+L1-E6 290 · L1-E4 444(짧게) ·
  // 2라운드+L1-E7 504 · L1-E5 657(짧게) · 3라운드 807 · L1-E8 960
  const tlText = await t.getByTestId('tl-next').innerText();
  expect(tlText).toContain('벽란도 시장');

  // ── L1-E1 벽란도 시장(미니게임 — 113) ──
  await advanceTo(ctx, t, TOTAL, 17);
  await expect(s1.getByTestId('minigame')).toHaveCount(0);
  await advanceTo(ctx, t, TOTAL, 21);
  for (const s of [s1, s2]) await expect(s.getByTestId('minigame')).toHaveAttribute('data-event', 'L1-E1');
  await expect(screenEvent(scr, 'L1-E1')).toBeVisible();
  await finishMinigame(s1);
  await expect(s1.getByTestId('event-waiting')).toBeVisible();

  // ── L1-E2 개념: 무역·수입·수출(전체 형태) ──
  await advanceTo(ctx, t, TOTAL, 167);
  await expect(cardOf(s1, 'L1-E2')).toHaveCount(0);
  await advanceTo(ctx, t, TOTAL, 171);
  for (const s of [s1, s2]) {
    const c = cardOf(s, 'L1-E2');
    await expect(c).toBeVisible();
    await expect(c).toHaveAttribute('data-short', '0');
    await expect(c.getByTestId('card-band')).toContainText('개념');
    await expect(c.getByTestId('card-pages')).toHaveText('교과서 연결 p.96');
    await expect(c.getByTestId('card-body')).toContainText('고려 입장에서');
    await expect(c.getByTestId('card-effects')).toContainText('도감 카드: 무역·수입·수출');
  }
  await expect(screenEvent(scr, 'L1-E2').getByTestId('card-title')).toHaveText('무역·수입·수출');
  await shot(s1, 'student-L1-E2-full-1366.png');
  await shot(scr, 'screen-L1-E2-full-1920.png');
  await s1.getByTestId('card-confirm').dblclick();
  await expect(cardOf(s1, 'L1-E2')).toHaveCount(0);
  await expect(t.getByTestId('tl-responses')).toHaveCount(0); // 응답이 필요 없는 사건
  // 도감에 개념 카드
  await expect(s1.getByTestId('hud-dex')).toBeVisible();

  // ── 1라운드: L1-E6 천연가스 뉴스(비차단 패널) + 임무 + 튜토리얼 ──
  await advanceTo(ctx, t, TOTAL, 287);
  await expect(s1.getByTestId('event-panel')).toHaveCount(0);
  await advanceTo(ctx, t, TOTAL, 291);
  for (const s of [s1, s2]) {
    const panel = s.getByTestId('event-panel');
    await expect(panel).toHaveAttribute('data-event', 'L1-E6');
    await expect(panel.getByTestId('card-band')).toContainText('가상 뉴스 — 교과서 내용을 바탕으로 만든 이야기예요');
    await expect(panel.getByTestId('card-effects')).toContainText('부산 천연가스 값 ↑ (이번 차시)');
    await expect(s.getByTestId('mission')).toHaveAttribute('data-mission', 'M-GAS');
    await expect(s.getByTestId('tutorial')).toHaveAttribute('data-step', 'pickDest');
  }
  await expect(screenEvent(scr, 'L1-E6').getByTestId('card-band')).toContainText('가상 뉴스 — 교과서 내용을 바탕으로 만든 이야기예요');
  await shot(s1, 'student-L1-E6-panel-tutorial-1366.png');
  await shot(scr, 'screen-L1-E6-1920.png');
  // 패널이 떠 있어도 거래가 된다(s2: 부산 반도체 1상자)
  await s2.getByTestId('tutorial-skip').click();
  await expect(s2.getByTestId('tutorial')).toHaveCount(0);
  await s2.getByTestId('enter-port').click();
  // 항구 화면에서는 패널이 접힌 채(펼치기 단추) 떠 있다 — 사기 버튼을 가리지 않는다
  await expect(s2.getByTestId('event-panel-folded')).toHaveAttribute('data-event', 'L1-E6');
  await s2.getByTestId('buy-card-chip').getByTestId('buy-chip').click();
  await expect(s2.getByTestId('hud-cargo')).toContainText('1/20');
  await shot(s2, 'student-L1-E6-panel-trade-1366.png');
  await s2.getByTestId('port-back').click();
  // s1: 튜토리얼대로 ① 포트헤들랜드 ② 출항 준비
  await expect(s1.getByTestId('tutorial-finger')).toBeVisible();
  await sailTo(s1, 'PHE');
  await expect(s1.getByTestId('tutorial')).toHaveAttribute('data-step', 'arrive');
  await s1.getByTestId('event-panel').getByTestId('card-confirm').click();
  await expect(s1.getByTestId('event-panel')).toHaveCount(0);

  // ── L1-E4 무역이 없다면?(짧은 형태: 상황 카드 1장) ──
  await advanceTo(ctx, t, TOTAL, 441);
  await expect(cardOf(s1, 'L1-E4')).toHaveCount(0);
  await advanceTo(ctx, t, TOTAL, 447);
  await expect(s1.getByTestId('tutorial')).toHaveAttribute('data-step', 'enterPort'); // 라운드 끝에 포트헤들랜드 도착(토스트는 가짜 시계로 금방 사라질 수 있어 상태로 확인)
  for (const s of [s1, s2]) {
    const c = cardOf(s, 'L1-E4');
    await expect(c).toHaveAttribute('data-short', '1');
    await expect(c.getByTestId('card-situation')).toHaveCount(1);
    await expect(c.getByTestId('card-situation')).toContainText('천연가스를 생산할 수 없다면');
    await expect(c.getByTestId('card-quote')).toContainText('교과서 연결 p.97');
  }
  await expect(screenEvent(scr, 'L1-E4')).toHaveAttribute('data-short', '1');
  await shot(s1, 'student-L1-E4-short-1366.png');
  await shot(scr, 'screen-L1-E4-short-1920.png');
  for (const s of [s1, s2]) await s.getByTestId('card-confirm').click();
  await closePortCard(s1);

  // ── 2라운드: L1-E7 흑연 결정(비차단 패널) — 패널이 열린 채 천연가스 사기 ──
  await advanceTo(ctx, t, TOTAL, 501);
  await expect(s1.getByTestId('event-panel')).toHaveCount(0);
  await advanceTo(ctx, t, TOTAL, 506);
  await closePortCard(s1);
  for (const s of [s1, s2]) await expect(s.getByTestId('event-panel')).toHaveAttribute('data-event', 'L1-E7');
  await expect(s1.getByTestId('tutorial')).toHaveAttribute('data-step', 'enterPort');
  await s1.getByTestId('enter-port').click();
  await expect(s1.getByTestId('tutorial')).toHaveAttribute('data-step', 'buyGas');
  await expect(s1.getByTestId('event-panel-folded')).toHaveAttribute('data-event', 'L1-E7');
  const gas = s1.getByTestId('buy-card-gas');
  for (let i = 0; i < 2; i++) await s1.getByTestId('buy-gas-plus').click();
  await gas.getByTestId('buy-gas').click();
  await expect(s1.getByTestId('hud-cargo')).toContainText('3/20');
  await expect(s1.getByTestId('tutorial')).toHaveAttribute('data-step', 'done');
  await shot(s1, 'student-L1-E7-panel-buy-gas-1366.png');
  await s1.getByTestId('tutorial-close').click();
  // 항구 화면에서 패널을 펼쳐 결정할 수도 있다
  await s1.getByTestId('event-panel-unfold').click();
  await expect(s1.getByTestId('event-panel')).toHaveAttribute('data-event', 'L1-E7');
  // 결정: s1 상하이, s2 부산(국내산)
  await expect(t.getByTestId('tl-resp-count')).toHaveText('응답 0/2');
  await s1.getByTestId('decision-opt-SHA').click();
  await s1.getByTestId('decision-reason').fill('값이 싸서');
  await s1.getByTestId('decision-submit').dblclick();
  await expect(s1.getByTestId('decision-chosen')).toHaveAttribute('data-choice', 'SHA');
  await expect(s1.getByTestId('decision-reveal')).toContainText('교과서 연결 p.99');
  await expect(s1.getByTestId('event-panel').getByTestId('card-unit-note')).toHaveCount(0); // 차시 한 판: 숨김
  await s2.getByTestId('decision-opt-BUS').click();
  await s2.getByTestId('decision-submit').click();
  await expect(t.getByTestId('tl-resp-count')).toHaveText('응답 2/2');
  await expect(t.locator('[data-testid="cell-response"][data-v="yes"]')).toHaveCount(2);
  await expect(screenEvent(scr, 'L1-E7').getByTestId('event-count')).toHaveText('응답한 회사 2/2');
  await expect(scr.getByTestId('decision-bars')).toHaveCount(0); // [결과 공개] 전에는 수만
  await shot(s1, 'student-L1-E7-decided-1366.png');
  await shot(t, 'teacher-L1-E7-responses-1366.png');
  // 결정 기록(교사 학생 상세): decisions.graphiteChoice
  await t.locator('[data-testid="student-row"][data-seat="1"] [data-testid="cell-company"]').click();
  await expect(t.getByTestId('student-drawer')).toContainText('graphiteChoice: SHA');
  await t.getByTestId('drawer-close').click();
  // s1: 부산으로
  await s1.getByTestId('port-back').click();
  await sailTo(s1, 'BUS');
  // (수정 1회차) 자동 마감 경로: [결과 공개]를 누르지 않아도 배치표가 라운드 칸 끝 20초 전(657−20=637초)에 마감하고 결과를 20초 보인다
  await advanceTo(ctx, t, TOTAL, 634);
  await expect(scr.getByTestId('decision-bars')).toHaveCount(0);
  await advanceTo(ctx, t, TOTAL, 639);
  const bars = screenEvent(scr, 'L1-E7').getByTestId('decision-bars');
  await expect(bars).toBeVisible();
  await expect(bars).toContainText('상하이에서 살래요');
  await expect(bars).not.toContainText('해오름무역');
  await expect(bars).not.toContainText('바다상회');
  await expect(screenEvent(scr, 'L1-E7').getByTestId('decision-reveal')).toContainText('교과서 연결 p.99');
  await expect(t.getByTestId('tl-result')).toHaveAttribute('data-event', 'L1-E7');
  for (const s of [s1, s2]) await expect(s.locator('[data-testid="event-panel"][data-result="1"]').getByTestId('event-result')).toBeVisible();
  await expect(s2.getByTestId('decision-chosen')).toHaveAttribute('data-choice', 'BUS');
  await shot(scr, 'screen-L1-E7-bars-autoclose-1920.png');
  await shot(s2, 'student-L1-E7-result-autoclose-1366.png');
  await advanceTo(ctx, t, TOTAL, 652);
  await expect(scr.getByTestId('decision-bars')).toHaveCount(0); // 20초 뒤 해도로
  await expect(s2.locator('[data-testid="event-panel"][data-result="1"]')).toHaveCount(0);

  // ── L1-E5 두 섬 이야기(미니게임 — 113) + 늦게 온 3번째 학생 ──
  await advanceTo(ctx, t, TOTAL, 660);
  for (const s of [s1, s2]) await expect(s.getByTestId('minigame')).toHaveAttribute('data-event', 'L1-E5');
  const s3 = await joinStudent(ctx, 'p03', code, 3, '늦은배무역');
  await expect(s3.getByTestId('minigame')).toHaveAttribute('data-event', 'L1-E5'); // 지금 열린 사건 먼저
  await finishMinigame(s3);
  // (113) 지금 사건을 마친 학생은 사건이 닫힐 때까지 "기다려요" → 배치표가 L1-E5를 닫으면 따라잡기
  await expect(s3.getByTestId('event-waiting')).toBeVisible();
  await expect(s3.getByTestId('catchup')).toHaveCount(0);
  await advanceUntil(ctx, t, async () => (await s3.getByTestId('catchup').count()) > 0, 200);
  // 따라잡기 1/3: 요약 카드(발동 순 L1-E2·L1-E6·L1-E4)
  await expect(s3.getByTestId('catchup-kicker')).toHaveText('놓친 활동 따라잡기 1/3');
  await expect(s3.getByTestId('catchup')).toHaveAttribute('data-ids', 'L1-E2,L1-E6,L1-E4');
  await expect(s3.getByTestId('summary-row')).toHaveCount(3);
  await shot(s3, 'student-late-catchup-summary-1366.png');
  await s3.getByTestId('catchup-ok').click();
  // 2/3: L1-E1 벽란도(미니게임 — 113, 따라잡기로 직접)
  await expect(s3.getByTestId('catchup-kicker')).toHaveText('놓친 활동 따라잡기 2/3');
  await expect(s3.getByTestId('catchup')).toHaveAttribute('data-event', 'L1-E1');
  await finishMinigame(s3);
  // 3/3: L1-E7 흑연 결정(마감 전이라도 따라잡기로)
  await expect(s3.getByTestId('catchup-kicker')).toHaveText('놓친 활동 따라잡기 3/3');
  await expect(s3.getByTestId('catchup')).toHaveAttribute('data-event', 'L1-E7');
  await s3.getByTestId('decision-opt-none').click();
  await s3.getByTestId('decision-submit').click();
  await expect(s3.getByTestId('decision-chosen')).toHaveAttribute('data-choice', 'none');
  await shot(s3, 'student-late-catchup-decision-1366.png');
  await s3.getByTestId('catchup-next').click();
  await expect(s3.getByTestId('catchup')).toHaveCount(0);

  // ── 3라운드: 부산에서 천연가스 팔기 → [수입] + 임무 완료(하단 바 막대 가득) ──
  await advanceTo(ctx, t, TOTAL, 810);
  await expect(s1.getByTestId('hud-cargo')).toBeVisible();
  await s1.getByTestId('enter-port').click();
  await expect(s1.getByTestId('port-screen')).toHaveAttribute('data-port', 'BUS');
  await s1.getByTestId('sell-card-gas').getByTestId('sell-gas').click();
  await expect(s1.getByTestId('result-stamp-import')).toContainText('수입');
  const conceptOk = s1.getByTestId('concept-ok');
  if (await conceptOk.isVisible().catch(() => false)) await conceptOk.click();
  await s1.getByTestId('port-back').click();
  const mission = s1.getByTestId('mission');
  await expect(mission).toHaveAttribute('data-status', 'done');
  await expect(mission).toHaveAttribute('data-done', '2');
  await expect(mission).toContainText('완료');
  await shot(s1, 'student-mission-done-1366.png');
  // [이 학생만 사건 다시 보내기]: s2에게 L1-E2
  await t.locator('[data-testid="student-row"][data-seat="2"] [data-testid="cell-company"]').click();
  await t.getByTestId('resend-select').selectOption('L1-E2');
  await t.getByTestId('btn-resend-event').click();
  await t.getByTestId('drawer-close').click();
  await expect(s2.getByTestId('catchup')).toHaveAttribute('data-event', 'L1-E2');
  await expect(s2.getByTestId('catchup')).toHaveAttribute('data-mode', 'resend');
  await s2.getByTestId('card-confirm').click();
  await expect(s2.getByTestId('catchup')).toHaveCount(0);

  // ── L1-E8 확인 퀴즈 ──
  await advanceTo(ctx, t, TOTAL, 957);
  await expect(cardOf(s1, 'L1-E8')).toHaveCount(0);
  await advanceTo(ctx, t, TOTAL, 962);
  for (const s of [s1, s2, s3]) await expect(cardOf(s, 'L1-E8')).toBeVisible();
  await expect(screenEvent(scr, 'L1-E8').getByTestId('quiz-q')).toHaveCount(2);
  const answer = async (s: Page, qid: string, a: string) => s.getByTestId(`quiz-${qid}-${a}`).click();
  await answer(s1, 'CQ-L1-1', 'O');
  await s1.waitForTimeout(600);
  await answer(s1, 'CQ-L1-2', '0');
  await answer(s2, 'CQ-L1-1', 'X');
  await s2.waitForTimeout(600);
  await answer(s2, 'CQ-L1-2', '0');
  await expect(s1.getByTestId('quiz-sent')).toHaveCount(2);
  await expect(t.getByTestId('tl-resp-count')).toHaveText('응답 2/3');
  await expect(screenEvent(scr, 'L1-E8').getByTestId('event-count')).toHaveText('응답한 회사 2/3');
  await expect(t.locator('[data-testid="cell-response"][data-v="no"]')).toHaveCount(1);
  // (수정 1회차) [결과 공개] 없이 바로 [마감] → 결과 20초(정답률·해설·쪽수), 마지막 계획 항목이어도 무역이 바로 끝나지 않음
  await t.getByTestId('btn-close-event').click();
  await expect(t.getByTestId('tl-result')).toHaveAttribute('data-event', 'L1-E8');
  const rates = screenEvent(scr, 'L1-E8').getByTestId('quiz-rate');
  await expect(rates).toHaveCount(2);
  await expect(rates.nth(0)).toContainText('정답률 50%');
  await expect(rates.nth(1)).toContainText('정답률 100%');
  await expect(screenEvent(scr, 'L1-E8').getByTestId('quiz-explain').first()).toContainText('교과서 연결 p.96');
  await expect(screenEvent(scr, 'L1-E8').getByTestId('quiz-explain').first()).not.toContainText('(교과서 96쪽)'); // 쪽수는 한 번
  for (const s of [s1, s2, s3]) await expect(s.getByTestId('event-result')).toBeVisible();
  await expect(s3.getByTestId('quiz-explain')).toHaveCount(2); // 답하지 않은 학생도 해설을 본다
  await expect(s2.getByTestId('quiz-explain').first()).toContainText('다시 생각해 봐요');
  await expect(s1.getByTestId('quiz-explain').first()).toContainText('맞았어요');
  await shot(scr, 'screen-L1-E8-rates-1920.png');
  await shot(s2, 'student-L1-E8-explain-1366.png');

  // 결과를 보여 주는 동안은 무역이 끝나지 않는다 → 교사 [다음]으로 일찍 넘기면 계획 끝 → 마무리
  await ctx.clock.runFor(8000);
  await t.waitForTimeout(300);
  await expect(s1.getByTestId('trade-over')).toHaveCount(0);
  await expect(screenEvent(scr, 'L1-E8').getByTestId('quiz-rate')).toHaveCount(2);
  await t.getByTestId('btn-end-result').click();
  await advanceUntil(ctx, t, async () => (await s1.getByTestId('trade-over').count()) > 0, 10);
  for (const s of [s1, s2, s3]) await expect(s.getByTestId('trade-over')).toBeVisible({ timeout: 15_000 });
  expect(errors).toEqual([]);
  await ctx.close();
});

test('B. 단원 한 판: L1-E2 짧은 형태, L1-E4 전체, L1-E7 카드에 unitOnlyNote', async ({ browser, baseURL }) => {
  test.skip(!RUN, 'tests/student/playwright.events.config.ts로 실행');
  const TOTAL = 25 * 60;
  const ctx = await browser.newContext({ baseURL, viewport: { width: 1366, height: 768 } });
  await ctx.clock.install();
  const { page: t, code } = await openTeacher(ctx, { unit: true, minutes: 25, forms: { 'L1-E4': '넣기' } });
  const scr = await openScreen(ctx, t);
  await skewScreenClock(scr, -30_000); // 공용 화면 기기 시계 −30초
  await expectScreenSkew(scr, t, -30_000);
  const s1 = await joinStudent(ctx, 'u01', code, 4, '단원무역');
  await expect(s1.getByTestId('prep-wait')).toBeVisible();
  await t.getByTestId('btn-start-trade').click();
  await t.getByTestId('confirm-ok').click();
  await expect(t.getByTestId('trade-clock')).toBeVisible();

  await advanceUntil(ctx, t, async () => (await cardOf(s1, 'L1-E2').count()) > 0, 200);
  const e2 = cardOf(s1, 'L1-E2');
  await expect(e2).toHaveAttribute('data-short', '1');
  await expect(e2.getByTestId('card-body')).not.toContainText('고려');
  await expect(e2.getByTestId('card-band')).toContainText('짧게');
  await expect(screenEvent(scr, 'L1-E2')).toHaveAttribute('data-short', '1');
  await shot(s1, 'student-L1-E2-short-1366.png');
  await shot(scr, 'screen-L1-E2-short-1920.png');
  await s1.getByTestId('card-confirm').click();

  await advanceUntil(ctx, t, async () => (await cardOf(s1, 'L1-E4').count()) > 0, 400);
  const e4 = cardOf(s1, 'L1-E4');
  await expect(e4).toHaveAttribute('data-short', '0');
  await expect(e4.getByTestId('card-situation')).toHaveCount(2);
  await expect(e4.getByTestId('card-situation').nth(1)).toContainText('비행기를 만드는 기술이 없다면');
  await shot(s1, 'student-L1-E4-full-1366.png');
  await shot(scr, 'screen-L1-E4-full-1920.png');
  await s1.getByTestId('card-confirm').click();

  // 미니게임(113)이 뜨면 짧게 끝내고 L1-E7까지
  await advanceUntil(
    ctx,
    t,
    async () => {
      if (await s1.getByTestId('minigame').isVisible().catch(() => false)) await finishMinigame(s1);
      return (await s1.locator('[data-testid="event-panel"][data-event="L1-E7"]').count()) > 0;
    },
    600,
  );
  await expect(s1.getByTestId('event-panel').getByTestId('card-unit-note')).toHaveText('흑연은 다음 구간(L2)에서 배터리를 만드는 재료가 돼요.');
  await expect(screenEvent(scr, 'L1-E7').getByTestId('card-unit-note')).toHaveText('흑연은 다음 구간(L2)에서 배터리를 만드는 재료가 돼요.');
  // 단원 한 판 효과 문구는 '이번 구간'
  await shot(s1, 'student-L1-E7-unit-note-1366.png');
  await shot(scr, 'screen-L1-E7-unit-note-1920.png');
  // [결과 공개] 경로: 마감 전에 공개 → 막대, 그 뒤 [마감] → 결과 20초 유지 → 해도
  await s1.getByTestId('decision-opt-SHA').click();
  await s1.getByTestId('decision-submit').click();
  await t.getByTestId('btn-reveal-event').click();
  await expect(screenEvent(scr, 'L1-E7').getByTestId('decision-bars')).toContainText('상하이에서 살래요');
  await expect(screenEvent(scr, 'L1-E7')).toHaveAttribute('data-revealed', '1');
  await t.getByTestId('btn-close-event').click();
  await expect(t.getByTestId('tl-result')).toBeVisible();
  await expect(screenEvent(scr, 'L1-E7').getByTestId('decision-bars')).toBeVisible();
  // 기기 시계가 −30초여도 결과 20초 동안 유지(보정 없으면 50초로 늘어남) → 21초 뒤 끝
  await ctx.clock.runFor(12_000);
  await t.waitForTimeout(300);
  await expect(screenEvent(scr, 'L1-E7').getByTestId('decision-bars')).toBeVisible();
  await ctx.clock.runFor(9_000);
  await t.waitForTimeout(500);
  await expect(screenEvent(scr, 'L1-E7')).toHaveCount(0);
  await ctx.close();
});
