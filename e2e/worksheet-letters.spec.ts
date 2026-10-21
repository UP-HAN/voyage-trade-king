import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { lettersById } from '../src/data/letters';
import { worksheetById } from '../src/data/worksheet';
import { openFold, openTvMenu } from './support/voyage-ui';

/**
 * 작업 112 학습지 "잠깐!" 팝업 + 편지·갈매기 퀴즈 + 항해 기록장 e2e(`?sync=local`):
 * 실제 교사 화면(#/teacher) + 공용 화면(#/screen, 1920×1080) + 학생 탭 2개(#/play). 브라우저 문맥 전체에 가짜 시계를 깔고
 * 자동 진행 배치표를 앞으로 돌린다.
 *
 * A. 차시 한 판 L1 40분(학습지 '중간마다'): ① 팝업(두 학생 모달·공용 화면 0/2·[다 썼어요] 15초 대기) → 한 학생 [다 썼어요] → 1/2 →
 *    교사 [모두 닫기]. 라운드 2 시작 → 두 학생에게 편지 1통(갈매기·배지) → 서로 다른 문제(좌석 회전) → 한 명 정답(보상 반영)·
 *    한 명 오답(해설·쪽수·[알겠어요]) → 같은 편지 재답 불가. 라운드 중 교사 ② [지금 띄우기] → "라운드가 끝나면 띄우기" 예약 →
 *    라운드 끝에 팝업. 다음 배치 학습지 [건너뛰기]. 라운드 5 시작 → 열지 않은 S2 만료("답장 기한이 지났어요", 해설 보기).
 * B. 차시 한 판 L1 30분(학습지 '구간 끝 묶음' + ③★ 지금 쓰기, v0.3.4 — 작업 132): 두 섬 뒤 "잠깐! ③★ 지금 써요"(★ 완료는 번호와 따로) →
 *    "잠깐! ①②③④" 묶음 → [다 썼어요] 1번으로 4개 완료 → 3분 뒤 안내.
 * C. 차시 한 판 L1 10분(학습지 '끝나고 쓰기'): 마무리 단계 "오늘 쓸 학습지: ① ② ③ ④"(⑱ 없음, 판 단위 꼬리표) + 항해 기록장 →
 *    판이 끝난 뒤 타이틀 [항해 기록장]이 새로 고침해도 열린다.
 *
 * 실행: `npx playwright test -c tests/worksheet-letters.playwright.config.ts`(개발 서버 5401). 다른 설정에서는 건너뛴다.
 */

const RUN = process.env.WSL112_E2E === '1';
const SHOT_DIR = process.env.SHOT_DIR;

async function shot(page: Page, name: string) {
  if (!SHOT_DIR) return;
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(SHOT_DIR, name) });
}

async function openTeacher(ctx: BrowserContext, minutes: number): Promise<{ page: Page; code: string }> {
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
  await custom.fill(String(minutes));
  await custom.blur();
  await expect(custom).toHaveValue(String(minutes));
  await page.getByTestId('btn-open').click();
  const codeEl = page.getByTestId('room-code');
  await expect(codeEl).toHaveText(/^\d{6}$/);
  return { page, code: (await codeEl.innerText()).trim() };
}

async function openScreen(ctx: BrowserContext, t: Page): Promise<Page> {
  await openTvMenu(t); // (작업 137) [TV 화면 ▾] 안
  const [scr] = await Promise.all([ctx.waitForEvent('page'), t.getByTestId('btn-open-screen').click()]);
  await scr.setViewportSize({ width: 1920, height: 1080 });
  await expect(scr.getByTestId('route-screen')).toBeVisible();
  return scr;
}

async function joinStudent(ctx: BrowserContext, as: string, code: string, seat: number, name: string): Promise<Page> {
  const p = await ctx.newPage();
  await p.goto(`./?sync=local&as=${as}#/play`);
  await expect(p.getByTestId('route-student')).toBeVisible({ timeout: 60_000 });
  await p.getByTestId('entry-code').fill(code);
  await p.getByTestId('entry-seat').selectOption(String(seat));
  await p.getByTestId('entry-name').fill(name);
  await p.getByTestId('entry-submit').click();
  await expect(p.getByTestId('found-company')).toBeVisible({ timeout: 15_000 });
  await p.getByTestId('found-submit').click();
  await expect(p.getByTestId('prep-wait')).toBeVisible();
  return p;
}

async function setWaitSec(t: Page, sec: 0 | 15 | 30) {
  await t.getByTestId('btn-settings').click();
  const modal = t.getByTestId('settings-modal');
  // (작업 137) '다 썼어요' 대기 시간은 설정 [고급] 안
  const adv = t.getByTestId('settings-advanced');
  if ((await adv.getAttribute('open')) === null) await adv.locator(':scope > summary').click();
  await modal.getByRole('button', { name: `${sec}초`, exact: true }).click();
  await expect(modal.getByRole('button', { name: `${sec}초`, exact: true })).toHaveAttribute('aria-pressed', 'true');
  await t.getByTestId('settings-close').click();
}

async function startTrade(t: Page) {
  await t.getByTestId('btn-start-trade').click();
  await t.getByTestId('confirm-ok').click();
  await expect(t.getByTestId('trade-clock')).toBeVisible();
  // 학습지·편지 패널 펼치기(작업 137: 접힘 영역 '학습지'·'편지·돌발 사건·공정한 바다')
  await openFold(t, 'worksheet');
  await openFold(t, 'more');
}

async function elapsed(t: Page, total: number): Promise<number> {
  const sec = Number(await t.getByTestId('trade-clock').getAttribute('data-sec'));
  return total - sec;
}

async function advanceTo(ctx: BrowserContext, t: Page, total: number, target: number) {
  for (let i = 0; i < 3000; i++) {
    const e = await elapsed(t, total);
    if (e >= target) return e;
    const step = Math.min(4000, Math.max(1000, (target - e) * 1000));
    await ctx.clock.runFor(step);
    await t.waitForTimeout(50);
  }
  throw new Error(`시계를 ${target}초까지 돌리지 못했어요`);
}

async function advanceUntil(ctx: BrowserContext, t: Page, check: () => Promise<boolean>, maxSec: number) {
  for (let i = 0; i < maxSec; i++) {
    if (await check()) return;
    await ctx.clock.runFor(1000);
    await t.waitForTimeout(60);
  }
  expect(await check()).toBe(true);
}

/** 학생 화면에 떠 있을 수 있는 튜토리얼·항구 카드 정리(학습지·편지 확인과 무관) */
async function tidy(s: Page) {
  for (const id of ['tutorial-skip', 'tutorial-close', 'port-card-ok']) {
    const b = s.getByTestId(id);
    if (await b.isVisible().catch(() => false)) await b.click().catch(() => undefined);
  }
}

async function moneyOf(s: Page): Promise<string> {
  return (await s.getByTestId('hud-money').innerText()).replace(/\s+/g, ' ');
}

/** 학생 화면 DOM에 출석번호 꼴("7번")이 없는가 */
async function noSeatText(p: Page) {
  const text = await p.locator('body').innerText();
  expect(text).not.toMatch(/\d+번(?!째)/);
}

test.describe.configure({ mode: 'serial' });

test('A. 차시 한 판 L1 40분: 중간마다 팝업·작성 현황·예약·건너뛰기 + 편지 배달·정답/오답·재답 불가·만료', async ({ browser, baseURL }) => {
  test.skip(!RUN, 'tests/worksheet-letters.playwright.config.ts로 실행');
  const TOTAL = 40 * 60;
  const ctx = await browser.newContext({ baseURL, viewport: { width: 1366, height: 768 } });
  await ctx.clock.install();
  const errors: string[] = [];
  const { page: t, code } = await openTeacher(ctx, 40);
  t.on('pageerror', (e) => errors.push(`teacher: ${e.message}`));
  const scr = await openScreen(ctx, t);
  scr.on('pageerror', (e) => errors.push(`screen: ${e.message}`));
  const s1 = await joinStudent(ctx, 'w01', code, 1, '해오름무역');
  const s2 = await joinStudent(ctx, 'w02', code, 2, '바다상회');
  for (const [n, s] of [['s1', s1], ['s2', s2]] as const) s.on('pageerror', (e) => errors.push(`${n}: ${e.message}`));
  await startTrade(t);

  // ── ① 학습지 팝업(배치표 607초, 중간마다) ──
  await advanceTo(ctx, t, TOTAL, 600);
  await expect(s1.getByTestId('worksheet-popup')).toHaveCount(0);
  await advanceUntil(ctx, t, async () => (await s1.getByTestId('worksheet-popup').count()) > 0, 30);
  const w1 = worksheetById.W01;
  for (const s of [s1, s2]) {
    const pop = s.getByTestId('worksheet-popup');
    await expect(pop).toHaveAttribute('data-ids', 'W01');
    await expect(pop.getByTestId('worksheet-head')).toHaveText('잠깐!');
    await expect(pop.getByTestId('worksheet-tag')).toHaveText('1차시');
    await expect(pop.getByTestId('worksheet-no')).toHaveText('①');
    await expect(pop.getByTestId('worksheet-prompt')).toHaveText(w1.prompt);
    await expect(pop.getByTestId('worksheet-pages')).toHaveText('교과서 95~96쪽');
    await expect(pop.getByTestId('worksheet-helper')).toContainText('[내 기록:');
    // 기본 대기 15초: 아직 못 누름
    await expect(pop.getByTestId('worksheet-done')).toBeDisabled();
  }
  await expect(scr.getByTestId('scene-worksheet')).toHaveAttribute('data-ids', 'W01');
  await expect(scr.getByTestId('ws-title')).toHaveText('잠깐! ① 학습지를 써요');
  await expect(scr.getByTestId('ws-done-count')).toHaveText('0/2');
  await expect(t.getByTestId('ws-panel-done')).toHaveText('0/2');
  await expect(t.getByTestId('ws-missing')).toHaveText('아직 안 쓴 회사: 1 해오름무역, 2 바다상회');
  await shot(s1, 'A1-student-popup-W01-wait-1366.png');
  await ctx.clock.runFor(16_000);
  await t.waitForTimeout(100);
  await expect(s1.getByTestId('worksheet-done')).toBeEnabled();
  await s1.getByTestId('worksheet-done').dblclick();
  await expect(s1.getByTestId('worksheet-waiting')).toBeVisible();
  await expect(scr.getByTestId('ws-done-count')).toHaveText('1/2');
  await expect(t.getByTestId('ws-panel-done')).toHaveText('1/2');
  await expect(t.getByTestId('ws-missing')).toHaveText('아직 안 쓴 회사: 2 바다상회');
  // 공용 화면·학생 화면에는 출석번호가 없다
  await noSeatText(scr);
  await noSeatText(s1);
  await shot(s1, 'A2-student-waiting-1366.png');
  await shot(scr, 'A3-screen-worksheet-1of2-1920.png');
  await t.getByTestId('panel-WorksheetPanel').scrollIntoViewIfNeeded();
  await shot(t, 'A4-teacher-worksheet-panel-1366.png');
  // 기다리는 동안 도감·편지함·항해 기록장을 볼 수 있다
  await s1.getByTestId('worksheet-tool-logbook').click();
  await expect(s1.getByTestId('logbook-title')).toContainText('항해 기록장 — 1차시 ·');
  await expect(s1.getByTestId('logbook-row')).toHaveCount(4);
  await s1.getByTestId('logbook-close').click();
  await t.getByTestId('ws-close-all').click();
  for (const s of [s1, s2]) await expect(s.getByTestId('worksheet-popup')).toHaveCount(0);
  await expect(t.getByTestId('ws-none')).toBeVisible();

  // ── [이 학생에게 학습지 다시 보내기]: ①을 못 쓴 2번 학생에게만 ──
  await t.locator('[data-testid="student-row"][data-seat="2"] [data-testid="cell-company"]').click();
  await expect(t.getByTestId('resend-ws-select')).toHaveValue('W01');
  await t.getByTestId('btn-resend-ws').click();
  await expect(t.getByTestId('toasts')).toContainText('학습지 ①을(를) 이 학생에게 다시 보냈어요');
  await expect(t.getByTestId('resend-ws-pending')).toHaveText('보낸 학습지(아직 안 씀): ①');
  await t.getByTestId('panel-WorksheetPanel').scrollIntoViewIfNeeded().catch(() => undefined);
  const p2 = s2.getByTestId('worksheet-popup');
  await expect(p2).toHaveAttribute('data-personal', '1');
  await expect(p2).toHaveAttribute('data-ids', 'W01');
  await expect(s1.getByTestId('worksheet-popup')).toHaveCount(0); // 1번은 이미 씀 → 안 뜸
  await shot(s2, 'A2b-student-resent-W01-1366.png');
  await ctx.clock.runFor(16_000);
  await t.waitForTimeout(100);
  await s2.getByTestId('worksheet-done').click();
  await expect(s2.getByTestId('worksheet-popup')).toHaveCount(0);
  await expect(t.getByTestId('resend-ws-pending')).toHaveCount(0);
  // 1번 학생 상세에는 이미 쓴 ①이 고를 목록에 없다(거절 대상은 미리 거름 — 호스트 거절은 단위 테스트)
  await t.getByTestId('drawer-close').click();
  await t.locator('[data-testid="student-row"][data-seat="1"] [data-testid="cell-company"]').click();
  await expect(t.locator('[data-testid="resend-ws-select"] option[value="W01"]')).toHaveCount(0);
  await t.getByTestId('drawer-close').click();

  // ── 라운드 2(727초): 편지 S1 도착 ──
  // 라운드 1(320초)에는 편지가 없다(판의 첫 라운드 제외) — 지금은 0통
  for (const s of [s1, s2]) await expect(s.getByTestId('hud-letters')).toHaveAttribute('data-count', '0');
  await advanceTo(ctx, t, TOTAL, 720);
  await advanceUntil(ctx, t, async () => (await s1.getByTestId('hud-letters').getAttribute('data-count')) === '1', 30);
  await expect(s2.getByTestId('hud-letters')).toHaveAttribute('data-count', '1');
  const qid: Record<string, string> = {};
  for (const [n, s] of [['s1', s1], ['s2', s2]] as const) {
    await tidy(s);
    await s.getByTestId('hud-letters').click();
    await expect(s.getByTestId('letter-panel')).toBeVisible();
    await s.locator('[data-testid="letter-item"][data-slot="S1"]').click();
    const read = s.getByTestId('letter-read');
    await expect(read).toHaveAttribute('data-result', 'open');
    qid[n] = (await read.getAttribute('data-question'))!;
    await expect(s.getByTestId('letter-reward')).toHaveText('맞히면: 감사 사례금 — 자금 +30만 원(모두 같은 금액)');
    await expect(s.getByTestId('letter-tag')).toHaveText(/1차시|무역 기초/);
  }
  expect(qid.s1).not.toBe(qid.s2); // 옆 좌석은 다른 문제
  await shot(s1, 'A5-student-letter-open-1366.png');
  // 편지 패널이 열린 채 시장 거래(사기)가 된다 — s2 부산 반도체 1상자
  await s2.getByTestId('enter-port').click();
  await s2.getByTestId('buy-card-chip').getByTestId('buy-chip').click();
  await expect(s2.getByTestId('hud-cargo')).toContainText('1/20');
  await expect(s2.getByTestId('letter-panel')).toBeVisible();
  await shot(s2, 'A6-student-letter-panel-trade-1366.png');
  // s1 정답
  const q1 = lettersById[qid.s1];
  const before = await moneyOf(s1);
  await s1.locator(`[data-testid="letter-choice"][data-answer="${q1.answer}"]`).dblclick();
  await expect(s1.getByTestId('letter-right')).toBeVisible();
  await expect(s1.getByTestId('letter-reward-done')).toHaveText('감사 사례금 30만 원을 받았어요');
  await expect(s1.getByTestId('letter-explain')).toBeVisible();
  await expect(s1.getByTestId('hud-money')).not.toHaveText(before);
  await shot(s1, 'A7-student-letter-right-1366.png');
  // s2 오답 → 해설·쪽수, [알겠어요]로만 닫힘
  const q2 = lettersById[qid.s2];
  const wrong = q2.type === 'ox' ? (q2.answer === 'O' ? 'X' : 'O') : String(((q2.answer as number) + 1) % 3);
  const before2 = await moneyOf(s2);
  await s2.locator(`[data-testid="letter-choice"][data-answer="${wrong}"]`).click();
  await expect(s2.getByTestId('letter-wrong')).toBeVisible();
  await expect(s2.getByTestId('letter-pages')).toHaveText(/^교과서 \d+/);
  await expect(s2.getByTestId('letter-explain')).toContainText(q2.explain.slice(0, 10));
  await expect(s2.getByTestId('letter-close')).toHaveCount(0);
  await expect(s2.getByTestId('letter-back')).toHaveCount(0);
  await shot(s2, 'A8-student-letter-wrong-1366.png');
  await s2.getByTestId('letter-ack').click();
  await expect(s2.getByTestId('letter-list')).toBeVisible();
  expect(await moneyOf(s2)).toBe(before2); // 벌칙 없음
  // 다시 열면 결과·해설만(재답 불가)
  await s2.locator('[data-testid="letter-item"][data-slot="S1"]').click();
  await expect(s2.getByTestId('letter-read')).toHaveAttribute('data-result', 'wrong');
  await expect(s2.getByTestId('letter-choice')).toHaveCount(0);
  await s2.getByTestId('letter-close').click();
  await expect(s1.getByTestId('hud-letters')).toHaveAttribute('data-count', '0');
  // 교사 편지 패널: 슬롯별 정답률(이름 없이)
  const lp = t.locator('[data-testid="lp-slot"][data-slot="S1"]');
  await expect(lp).toHaveAttribute('data-state', 'delivered');
  await expect(lp.getByTestId('lp-rate')).toContainText('정답 1/2');
  await t.getByTestId('panel-LettersPanel').scrollIntoViewIfNeeded();
  await shot(t, 'A9-teacher-letters-panel-1366.png');

  // ── 라운드 중 ② [지금 띄우기] → 예약 → 라운드 끝에 팝업 ──
  await setWaitSec(t, 0);
  await t.getByTestId('ws-pick').selectOption('W02');
  await expect(t.getByTestId('ws-open-now')).toHaveText('라운드가 끝나면 띄우기');
  await t.getByTestId('ws-open-now').click();
  await expect(t.getByTestId('ws-reserved')).toHaveText('라운드가 끝나면 띄우기: ②');
  await expect(s1.getByTestId('worksheet-popup')).toHaveCount(0);
  await t.getByTestId('ws-reserved').scrollIntoViewIfNeeded();
  await shot(t, 'A10-teacher-reserved-1366.png');
  await advanceUntil(ctx, t, async () => (await s1.getByTestId('worksheet-popup').count()) > 0, 200);
  await expect(s1.getByTestId('worksheet-popup')).toHaveAttribute('data-ids', 'W02');
  await expect(s2.getByTestId('worksheet-popup')).toHaveAttribute('data-ids', 'W02');
  await expect(s1.getByTestId('worksheet-helper')).toHaveCount(0); // ②는 helper 없음
  await expect(s1.getByTestId('worksheet-done')).toBeEnabled(); // 대기 0초
  await expect(t.getByTestId('ws-reserved')).toHaveCount(0);
  for (const s of [s1, s2]) await s.getByTestId('worksheet-done').click();
  await expect(t.getByTestId('ws-panel-done')).toHaveText('2/2');
  await t.getByTestId('ws-close-all').click();
  // 배치표의 다음 학습지(②, 1014초)는 이미 썼으니 [건너뛰기]
  await expect(t.getByTestId('ws-next')).toContainText('②');
  await t.getByTestId('ws-skip').click();
  await expect(t.getByTestId('ws-next')).toContainText('③');

  // ── 라운드 3(1134초) 편지 S2 도착 — 아무도 열지 않음 → 라운드 5(1948초) 시작에 만료 ──
  await advanceTo(ctx, t, TOTAL, 1140);
  await advanceUntil(ctx, t, async () => (await s1.getByTestId('hud-letters').getAttribute('data-count')) === '1', 30);
  // ③ 팝업(1661초)은 닫으며 지나간다
  await advanceUntil(
    ctx,
    t,
    async () => {
      if ((await s1.getByTestId('worksheet-popup').count()) > 0) await t.getByTestId('ws-close-all').click().catch(() => undefined);
      return (await elapsed(t, TOTAL)) >= 1950;
    },
    1200,
  );
  for (const s of [s1, s2]) {
    await tidy(s);
    if (!(await s.getByTestId('letter-panel').isVisible().catch(() => false))) await s.getByTestId('hud-letters').click();
    if (await s.getByTestId('letter-back').isVisible().catch(() => false)) await s.getByTestId('letter-back').click();
    await expect(s.locator('[data-testid="letter-item"][data-slot="S2"]')).toHaveAttribute('data-status', 'expired');
    // 라운드 5: S3(라운드 4)·S4(라운드 5)는 아직 열 수 있다 — 배지는 그 2통
    await expect(s.getByTestId('hud-letters')).toHaveAttribute('data-count', '2');
  }
  await s1.locator('[data-testid="letter-item"][data-slot="S2"]').click();
  await expect(s1.getByTestId('letter-expired')).toContainText('답장 기한이 지났어요');
  await expect(s1.getByTestId('letter-choice')).toHaveCount(0);
  await s1.getByTestId('letter-show-explain').click();
  await expect(s1.getByTestId('letter-pages')).toHaveText(/^교과서 \d+/);
  await shot(s1, 'A11-student-letter-expired-1366.png');
  expect(errors).toEqual([]);
  await ctx.close();
});

test('B. 차시 한 판 L1 30분: ③★ 지금 쓰기 → 구간 끝 묶음 팝업 "잠깐! ①②③④" — [다 썼어요] 1번으로 4개 완료', async ({ browser, baseURL }) => {
  test.skip(!RUN, 'tests/worksheet-letters.playwright.config.ts로 실행');
  const TOTAL = 30 * 60;
  const ctx = await browser.newContext({ baseURL, viewport: { width: 1366, height: 768 } });
  await ctx.clock.install();
  const { page: t, code } = await openTeacher(ctx, 30);
  const scr = await openScreen(ctx, t);
  const s1 = await joinStudent(ctx, 'b01', code, 3, '별빛해운');
  const s2 = await joinStudent(ctx, 'b02', code, 4, '파도상회');
  await setWaitSec(t, 0);
  await startTrade(t);
  await expect(t.getByTestId('ws-modes')).toContainText('차시 끝에 모아서'); // (작업 137) 옛 '구간 끝 묶음'
  // ── 지금 쓰기 ③★: 두 섬 이야기(17:35~23:35) 바로 뒤 40초 ──
  await advanceTo(ctx, t, TOTAL, 1400);
  await advanceUntil(ctx, t, async () => (await s1.getByTestId('worksheet-popup').count()) > 0, 120);
  const dpop = s1.getByTestId('worksheet-popup');
  await expect(dpop).toHaveAttribute('data-during', '1');
  await expect(dpop).toHaveAttribute('data-ids', 'W03');
  await expect(dpop.getByTestId('worksheet-head')).toHaveText('잠깐! ③★ 지금 써요');
  await expect(dpop.getByTestId('worksheet-prompt')).toHaveText(worksheetById.W03.during!.prompt);
  await expect(dpop.getByTestId('worksheet-during-rest')).toHaveText('나머지 칸은 구간 끝에 써요');
  await expect(scr.getByTestId('ws-title')).toHaveText('잠깐! ③★ 지금 써요');
  await shot(s1, 'B0-student-during-W03-1366.png');
  await s1.getByTestId('worksheet-done').click();
  await expect(s1.getByTestId('worksheet-waiting')).toBeVisible();
  await expect(scr.getByTestId('ws-done-count')).toHaveText('1/2');
  // 교사 패널: ③★ 줄이 ③ 줄과 따로(★ 1/2, ③ 0/2)
  await expect(t.locator('[data-testid="ws-rate-during"][data-id="W03"]')).toContainText('③★ 1/2');
  await expect(t.locator('[data-testid="ws-rate-row"][data-id="W03"]')).toContainText('0/2');
  await expect(t.getByTestId('ws-now')).toHaveAttribute('data-during', '1');
  await t.getByTestId('panel-WorksheetPanel').scrollIntoViewIfNeeded();
  await shot(t, 'B0-teacher-during-panel-1366.png');
  // 40초 뒤 저절로 닫힌다
  await advanceUntil(ctx, t, async () => (await s1.getByTestId('worksheet-popup').count()) === 0, 60);
  // ── 구간 끝 묶음(27:00~) ──
  await advanceTo(ctx, t, TOTAL, 1610);
  await advanceUntil(ctx, t, async () => (await s1.getByTestId('worksheet-popup').count()) > 0, 120);
  const pop = s1.getByTestId('worksheet-popup');
  await expect(pop).toHaveAttribute('data-ids', 'W01,W02,W03,W04');
  await expect(pop.getByTestId('worksheet-head')).toHaveText('잠깐! ①②③④');
  await expect(pop.getByTestId('worksheet-row')).toHaveCount(4);
  await expect(pop.getByTestId('worksheet-pages')).toHaveText(['교과서 95~96쪽', '교과서 97쪽', '교과서 98~99쪽', '교과서 99쪽']);
  await expect(scr.getByTestId('ws-title')).toHaveText('잠깐! ①②③④ 학습지를 써요');
  await expect(scr.getByTestId('ws-done-count')).toHaveText('0/2');
  await shot(s1, 'B1-student-bundle-1366.png');
  await s1.getByTestId('worksheet-done').click();
  await expect(s1.getByTestId('worksheet-waiting')).toBeVisible();
  await expect(scr.getByTestId('ws-done-count')).toHaveText('1/2');
  for (const id of ['W01', 'W02', 'W03', 'W04']) await expect(t.locator(`[data-testid="ws-rate-row"][data-id="${id}"]`)).toContainText('1/2');
  await expect(t.locator('[data-testid="ws-rate-group"][data-lesson="L1"]')).toHaveAttribute('data-inplay', '1');
  await expect(t.locator('[data-testid="ws-rate-group"][data-lesson="L2"]')).toHaveAttribute('data-inplay', '0');
  await shot(scr, 'B2-screen-bundle-1920.png');
  await t.getByTestId('panel-WorksheetPanel').scrollIntoViewIfNeeded();
  await expect(t.getByTestId('ws-panel-done')).toHaveText('1/2');
  await expect(t.getByTestId('ws-missing')).toHaveText('아직 안 쓴 회사: 4 파도상회');
  await shot(t, 'B3-teacher-bundle-panel-1366.png');
  // 자동 진행: 구간 끝 묶음 3분(180초)이 지나면 닫히고 순서가 끝난다(묶음이 판의 마지막 칸) — 끝나고 쓸 번호 없음
  // (작업 162) 판은 저절로 끝나지 않는다 — '오늘 순서를 다 했어요' 카드의 [마무리로]
  await advanceUntil(ctx, t, async () => (await s1.getByTestId('worksheet-popup').count()) === 0, 240);
  await expect(s2.getByTestId('worksheet-popup')).toHaveCount(0);
  await advanceUntil(ctx, t, async () => (await t.getByTestId('now-finish').count()) > 0, 120);
  await t.getByTestId('now-finish').click();
  await advanceUntil(ctx, t, async () => (await s1.getByTestId('trade-over').count()) > 0, 30);
  await expect(s1.getByTestId('after-worksheets-student')).toHaveCount(0);
  await ctx.close();
});

test('C. 차시 한 판 L1 10분: 끝나고 쓰기 목록 + 항해 기록장(판 종료 뒤 새로 고침해도 열림)', async ({ browser, baseURL }) => {
  test.skip(!RUN, 'tests/worksheet-letters.playwright.config.ts로 실행');
  const TOTAL = 10 * 60;
  const ctx = await browser.newContext({ baseURL, viewport: { width: 1366, height: 768 } });
  await ctx.clock.install();
  const { page: t, code } = await openTeacher(ctx, 10);
  const scr = await openScreen(ctx, t);
  const s1 = await joinStudent(ctx, 'c01', code, 5, '고래무역');
  // (수정 1회차) 무역 시작 전 팝업을 띄웠다 닫으면 'prep' 그대로 — 공용 화면은 방 코드·규칙, 학생 HUD는 "준비 시간"
  await openFold(t, 'worksheet');
  await t.getByTestId('ws-pick').selectOption('W19');
  await t.getByTestId('ws-open-now').click();
  await expect(s1.getByTestId('worksheet-popup')).toHaveAttribute('data-ids', 'W19');
  await expect(scr.getByTestId('route-screen')).toHaveAttribute('data-scene', 'worksheet');
  await t.getByTestId('ws-close-all').click();
  await expect(s1.getByTestId('worksheet-popup')).toHaveCount(0);
  await expect(scr.getByTestId('route-screen')).toHaveAttribute('data-scene', /^(code|rules)$/);
  await expect(s1.getByTestId('hud-time')).toContainText('준비 시간');
  await expect(t.getByTestId('btn-start-trade')).toBeVisible();
  await startTrade(t);
  await expect(t.getByTestId('ws-modes')).toContainText('게임 끝나고'); // (작업 137) 옛 '끝나고 쓰기'
  await expect(t.getByTestId('ws-after-ids')).toHaveText(' · 게임 끝나고 쓸 번호 ①②③④');
  // (작업 137, PRD 7.5.2.9) 무역이 끝나면 첫 마무리 항목(결산·시상)이 저절로 시작 → 학생 화면은 결산을 덮지 않게 목록을 접어 둔다(132).
  // 그 항목을 [끝]으로 끝내면(진행 중 항목 없음) 예전처럼 '끝나고 쓰기' 목록이 펼쳐진다
  const liveWrap = t.locator('[data-testid="wrap-item"][data-status="live"]');
  await advanceUntil(ctx, t, async () => (await liveWrap.count()) > 0, TOTAL + 200);
  await expect(liveWrap).toHaveAttribute('data-id', 'awards');
  await expect(s1.getByTestId('after-unfold')).toBeVisible();
  await liveWrap.getByRole('button', { name: '끝' }).click();
  await advanceUntil(ctx, t, async () => (await s1.getByTestId('after-worksheets-student').count()) > 0, 30);
  const after = s1.getByTestId('after-worksheets-student');
  await expect(after).toHaveAttribute('data-ids', 'W01,W02,W03,W04'); // ⑱ 없음(L1 판)
  await expect(after.getByTestId('after-tag')).toHaveText('1차시');
  await expect(after.getByTestId('after-title')).toHaveText('오늘 쓸 학습지: ① ② ③ ④');
  await expect(scr.getByTestId('after-worksheets').first()).toContainText('① ② ③ ④');
  await expect(scr.getByTestId('after-tag').first()).toHaveText('1차시');
  await shot(s1, 'C1-student-after-list-1366.png');
  await shot(scr, 'C2-screen-after-list-1920.png');
  await s1.getByTestId('after-logbook').click();
  await expect(s1.getByTestId('logbook-title')).toHaveText(/^항해 기록장 — 1차시 · \d+월 \d+일$/);
  await expect(s1.getByTestId('logbook-row')).toHaveCount(4);
  await expect(s1.locator('[data-testid="logbook-row"][data-id="W04"] [data-testid="logbook-helper"]')).toContainText('내 기록:');
  await shot(s1, 'C3-student-logbook-1366.png');
  await s1.getByTestId('logbook-close').click();
  // 판 끝내기·방 닫기 → 학생은 타이틀로 → [항해 기록장]
  t.on('dialog', (d) => void d.accept());
  await t.getByTestId('btn-settings').click();
  await t.getByTestId('btn-end').click();
  const ok = t.getByTestId('confirm-ok');
  if (await ok.isVisible().catch(() => false)) await ok.click();
  await s1.goto('./?sync=local&as=c01#/');
  await expect(s1.getByTestId('title-logbook')).toBeVisible();
  await s1.reload();
  await s1.getByTestId('title-logbook').click();
  await expect(s1.getByTestId('logbook-title')).toHaveText(/^항해 기록장 — 1차시 · /);
  await expect(s1.getByTestId('logbook-row')).toHaveCount(4);
  await shot(s1, 'C4-title-logbook-after-end-1366.png');
  // [인쇄]: 인쇄 때는 기록장 시트만, A4 한 장(흑백)
  await s1.evaluate(() => document.documentElement.classList.add('lb-printing'));
  await s1.emulateMedia({ media: 'print' });
  if (SHOT_DIR) await s1.pdf({ path: join(SHOT_DIR, 'C5-logbook-print-A4.pdf'), format: 'A4', printBackground: true });
  const pdf = await s1.pdf({ format: 'A4' });
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
  expect(pages).toBe(1);
  await shot(s1, 'C5-logbook-print-media-1366.png');
  // (작업 132) A4 단면: 한 장을 넘으면 2쪽 이상으로 넘어가고 쪽마다 머리띠(판 단위·차시·날짜)가 되풀이된다.
  // 줄을 여러 번 복제해 길게 만든 뒤 인쇄 — 머리띠는 표 머리(thead)라 쪽마다 다시 그려진다(쪽별 글자는 result.md의 PDF 검사)
  await s1.evaluate(() => {
    const body = document.querySelector('.lb-table tbody');
    if (!body) return;
    const rows = [...body.querySelectorAll('tr.lb-row')];
    for (let i = 0; i < 6; i++) for (const r of rows) body.appendChild(r.cloneNode(true));
  });
  await expect(s1.getByTestId('logbook-band')).toHaveCount(1);
  const pdf2 = await s1.pdf({ format: 'A4', ...(SHOT_DIR ? { path: join(SHOT_DIR, 'C6-logbook-print-multipage-A4.pdf') } : {}) });
  const pages2 = (pdf2.toString('latin1').match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
  expect(pages2).toBeGreaterThanOrEqual(2);
  await ctx.close();
});
