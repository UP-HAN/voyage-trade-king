/**
 * 작업 114 e2e 공용 화면 조작(실제 교사·공용 화면·학생 화면, `/voyage/` 하위 경로 빌드본 + 로컬 중계 서버).
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { FastClock } from './fast-clock';
import { ROOT } from './voyage-servers';

/** 스크린숏 폴더(.orch/tasks/114-lesson1-integration/shots) — SHOT_DIR이 있으면 그쪽 */
export const SHOTS = process.env.SHOT_DIR ?? join(ROOT, '.orch', 'tasks', '114-lesson1-integration', 'shots');

export async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  await page.evaluate(() => document.fonts.ready).catch(() => undefined);
  await page.screenshot({ path: join(SHOTS, name) });
}

/** 페이지 오류·콘솔 오류 모으기 */
/**
 * 페이지 오류·콘솔 오류·실패한 요청 모으기. 브라우저가 찍는 "Failed to load resource" 콘솔 줄은 요청 단위로 따로 본다:
 * 선택 파일 `config.json`이 없을 때의 404만 허용(배포에 config.json을 두지 않는 것이 기본 — README), 그 밖의 4xx·5xx는 오류.
 */
export function watchErrors(p: Page, label: string, out: string[], o: { ignoreConsole?: RegExp[]; allowServerDown?: boolean } = {}): void {
  const push = (s: string) => {
    if (out.length < 200) out.push(s);
  };
  p.on('pageerror', (e) => push(`${label} pageerror: ${e.message}`));
  let seen = 0;
  p.on('console', (m) => {
    seen++;
    if (process.env.FC_LOG && (seen <= 5 || seen === 500 || seen === 5000)) console.log(`[console ${label} #${seen}] ${m.type()}: ${m.text().slice(0, 200)}`);
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/^Failed to load resource/.test(t)) return;
    if (o.ignoreConsole?.some((r) => r.test(t))) return;
    push(`${label} console: ${t}`);
  });
  p.on('response', (r) => {
    if (r.status() < 400) return;
    const path = new URL(r.url()).pathname;
    if (r.status() === 404 && path.endsWith('/config.json')) return;
    if (o.allowServerDown && r.status() === 502 && /\/(health|notice)$/.test(path)) return;
    push(`${label} http ${r.status()}: ${path}`);
  });
  p.on('requestfailed', (r) => {
    const path = new URL(r.url()).pathname;
    if (/\/(health|notice)$/.test(path)) return; // 서버를 일부러 멈춘 시험에서만 생김 — 시험이 따로 확인
    push(`${label} requestfailed: ${path} ${r.failure()?.errorText ?? ''}`);
  });
}

export interface Env {
  browser: Browser;
  base: string;
  clock: FastClock;
  errors: string[];
  contexts: BrowserContext[];
}

export async function newContext(env: Env, viewport: { width: number; height: number } = { width: 1366, height: 768 }): Promise<BrowserContext> {
  const ctx = await env.browser.newContext({ baseURL: env.base, viewport });
  await env.clock.attach(ctx);
  env.contexts.push(ctx);
  return ctx;
}

/**
 * 교사: 시작 화면 → 판 설정(차시 L1 또는 단원) → 무역 n분 → [방 열기].
 * (작업 151) voyage: 항해 방식([고급 설정]) — 주지 않으면 판 기본(1차시 차시 판 = 자유롭게)
 */
export async function openTeacher(
  env: Env,
  o: { unit?: boolean; minutes: number; label?: string; voyage?: 'free' | 'round'; /** (작업 153) 학습지 넣는 때 */ ws?: 'auto' | 'each' | 'stageEnd' | 'after' | 'off' },
): Promise<{ ctx: BrowserContext; t: Page; code: string }> {
  const ctx = await newContext(env);
  const t = await ctx.newPage();
  watchErrors(t, o.label ?? 'teacher', env.errors);
  await t.goto('./#/teacher');
  await expect(t.getByTestId('teacher-start')).toBeVisible();
  await t.getByTestId('btn-new').click();
  if (o.unit) await t.getByTestId('unit-unit').click();
  else {
    await t.getByTestId('unit-lesson').click();
    await t.getByTestId('lesson-L1').click();
  }
  const custom = t.getByTestId('trade-minutes-custom');
  await custom.fill(String(o.minutes));
  await custom.blur();
  await expect(custom).toHaveValue(String(o.minutes));
  if (o.voyage) await pickVoyageMode(t, o.voyage);
  if (o.ws) await pickWorksheetMode(t, o.ws);
  await expect(t.getByTestId('btn-open')).toBeEnabled();
  await t.getByTestId('btn-open').click();
  const codeEl = t.getByTestId('room-code');
  await expect(codeEl).toHaveText(/^\d{6}$/, { timeout: 15_000 });
  return { ctx, t, code: (await codeEl.innerText()).trim() };
}

/**
 * (작업 138) 판 설정 [고급 설정](`setup-advanced`)을 펼친다 — 이미 펼쳐져 있으면 그대로.
 * 학습지 넣는 때·활동 비중·순위 공개·진행 방식·연속 구간은 이 안에 있다.
 */
export async function openAdvanced(t: Page): Promise<void> {
  await openDetails(t, 'setup-advanced');
}

/** (작업 138) 판 설정 미리보기 [활동 직접 고치기](`preview-activities-toggle`)를 펼친다(act-* 버튼) */
export async function openActivities(t: Page): Promise<void> {
  await openDetails(t, 'preview-activities-toggle');
}

async function openDetails(t: Page, testId: string): Promise<void> {
  const d = t.getByTestId(testId);
  await d.waitFor({ state: 'attached' });
  if ((await d.getAttribute('open')) === null) await d.locator(':scope > summary').click();
  await expect(d).toHaveAttribute('open', '');
}

/** (작업 138) 판 설정에서 진행 방식 고르기 — [고급 설정]을 먼저 펼치고, 버튼은 값(data-value)으로 찾는다(보이는 말이 바뀌어도 그대로) */
export async function pickProgressMode(t: Page, mode: 'auto' | 'manual'): Promise<void> {
  await openAdvanced(t);
  const b = t.locator(`[data-testid="progress-mode"] button[data-value="${mode}"]`);
  await b.click();
  await expect(b).toHaveAttribute('aria-pressed', 'true');
}

/**
 * (작업 151) 판 설정에서 항해 방식 고르기(값: free = 자유롭게 / round = 라운드마다). 1·2차시 차시 판 기본은 자유롭게.
 * 출항 준비 흐름을 보는 시험은 'round'를 고른다.
 */
export async function pickVoyageMode(t: Page, mode: 'free' | 'round'): Promise<void> {
  await openAdvanced(t);
  const b = t.locator(`[data-testid="voyage-mode"] button[data-value="${mode}"]`);
  await b.click();
  await expect(b).toHaveAttribute('aria-pressed', 'true');
  await expect(t.getByTestId('preview-voyage')).toHaveAttribute('data-mode', mode);
}

/** (작업 138) 판 설정에서 학습지 넣는 때 고르기(값: auto/each/stageEnd/after/off) */
export async function pickWorksheetMode(t: Page, mode: 'auto' | 'each' | 'stageEnd' | 'after' | 'off'): Promise<void> {
  await openAdvanced(t);
  const b = t.locator(`[data-testid="worksheet-mode"] button[data-value="${mode}"]`);
  await b.click();
  await expect(b).toHaveAttribute('aria-pressed', 'true');
}

// ─── (작업 137) 교사 대시보드 새 배치: 접힘 영역·TV 화면 메뉴·라운드 끝내기 확인 ───

export type FoldId = 'time' | 'order' | 'entry' | 'worksheet' | 'more';

/** 오른쪽 접힘 영역을 펼친다(이미 펼쳐져 있으면 그대로) — 시간 조절·오늘 순서·입장 관리·학습지·편지/돌발/공정한 바다 */
export async function openFold(t: Page, id: FoldId): Promise<void> {
  const f = t.getByTestId(`fold-${id}`);
  await f.waitFor({ state: 'attached' });
  if ((await f.getAttribute('data-open')) !== '1') await t.getByTestId(`fold-${id}-head`).click();
  await expect(f).toHaveAttribute('data-open', '1');
}

/** 위쪽 띠 [TV 화면 ▾]를 펼친다(공용 화면 창 열기·장면 고르기·이 화면을 TV로 보여 주기) */
export async function openTvMenu(t: Page): Promise<void> {
  const list = t.getByTestId('tv-menu-list');
  if (!(await list.isVisible().catch(() => false))) await t.getByTestId('tv-menu').click();
  await expect(list).toBeVisible();
}

/** 학생 표 [더 보기 ▾](나머지 필터·정렬)를 펼친다 */
export async function openMoreFilters(t: Page): Promise<void> {
  const list = t.getByTestId('filter-more-list');
  if (!(await list.isVisible().catch(() => false))) await t.getByTestId('filter-more').click();
  await expect(list).toBeVisible();
}

/** '오늘 순서'에서 항목 줄을 눌러 [지금 시작]·[1분 미루기]·[이번엔 빼기]를 연다 */
export async function openOrderRow(t: Page, row: ReturnType<Page['locator']>): Promise<void> {
  await openFold(t, 'order');
  const head = row.locator('.t-ord__head');
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click();
  await expect(head).toHaveAttribute('aria-expanded', 'true');
}

/** [라운드 끝내기] — 남은 시간이 있고 모두 준비가 아니면 확인 창(PRD 7.5.2.6)이 뜨므로 확인까지 */
export async function endRound(t: Page): Promise<void> {
  await t.getByTestId('btn-end-round').click();
  const conf = t.getByTestId('confirm-end-round');
  await conf.waitFor({ state: 'visible', timeout: 1500 }).catch(() => undefined);
  if (await conf.isVisible().catch(() => false)) await t.getByTestId('confirm-ok').click();
}

export async function openScreen(t: Page): Promise<Page> {
  await openTvMenu(t);
  const [scr] = await Promise.all([t.context().waitForEvent('page'), t.getByTestId('btn-open-screen').click()]);
  await scr.setViewportSize({ width: 1920, height: 1080 });
  await expect(scr.getByTestId('route-screen')).toBeVisible();
  return scr;
}

/** 학생 기기(새 문맥 = 새 기기) */
export async function openStudent(env: Env, label: string, viewport: { width: number; height: number } = { width: 1366, height: 768 }): Promise<Page> {
  const ctx = await newContext(env, viewport);
  const p = await ctx.newPage();
  watchErrors(p, label, env.errors);
  await p.goto('./#/play');
  await expect(p.getByTestId('route-student')).toBeVisible();
  return p;
}

export async function enter(p: Page, code: string, seat: number, name: string): Promise<void> {
  await expect(p.getByTestId('student-entry')).toBeVisible();
  await p.getByTestId('entry-code').fill(code);
  await p.getByTestId('entry-seat').selectOption(String(seat));
  await p.getByTestId('entry-name').fill(name);
  await p.getByTestId('entry-submit').click();
}

export async function found(p: Page): Promise<void> {
  await expect(p.getByTestId('found-company')).toBeVisible({ timeout: 15_000 });
  await p.getByTestId('found-submit').click();
  await expect(p.getByTestId('prep-wait')).toBeVisible();
}

export const cardOf = (p: Page, id: string) =>
  p.locator(`[data-testid="event-card"][data-event="${id}"], [data-testid="decision-card"][data-event="${id}"], [data-testid="quiz-card"][data-event="${id}"]`);

const BK_SOLD = new Set(['silk', 'medicine', 'books', 'instrument', 'jewel']);

/** 미니게임(벽란도·두 섬)을 [마치기]까지 — 작업 113 e2e와 같은 순서 */
export async function finishMinigame(s: Page): Promise<void> {
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
    // (작업 150) ㉮·㉯ 나라 3장면·버튼 2번: [잘하는 것을 많이 만들어 보기] → [옷 30벌 ↔ 쌀 20포대 바꾸기] → [다 했어요]
    if ((await mg.getAttribute('data-step')) === 'scene1') {
      await s.getByTestId('ti-focus').click();
      await pause();
    }
    if ((await mg.getAttribute('data-step')) === 'scene2') {
      await s.getByTestId('ti-trade').click();
      await pause();
    }
    if (await s.getByTestId('ti-done').count()) {
      await s.getByTestId('ti-done').click();
      await expect(s.locator(`[data-testid="minigame"][data-event="${id}"]`)).toHaveCount(0);
      return;
    }
  }
  await pause();
  await s.getByTestId('minigame-finish').click();
  await expect(s.locator(`[data-testid="minigame"][data-event="${id}"]`)).toHaveCount(0);
}

/**
 * 항해 도우미(작업 151 — 방식에 따라): 자유 항해면 [여기로 출발](`pick-sail`) → 바로 도착해 항구 화면이 열림,
 * 라운드마다면 [여기로 정하기](`pick-confirm`) → [출항 준비](`set-ready`). 돌려주는 값: 어느 방식이었는가
 */
export async function sailTo(s: Page, port: string): Promise<'free' | 'round'> {
  if (await s.getByTestId('port-screen').count()) await s.getByTestId('port-back').click();
  const hit = s.locator(`.wm-port[data-port="${port}"] .wm-port-hit`);
  const box = await hit.boundingBox();
  const vp = s.viewportSize()!;
  if (!box || box.y + box.height / 2 > vp.height - 100 || box.x < 0 || box.x > vp.width) await s.getByRole('button', { name: '전체 보기' }).click();
  await hit.click();
  await expect(s.getByTestId('pick-panel')).toHaveAttribute('data-kind', 'ok');
  if (await s.getByTestId('pick-sail').isVisible().catch(() => false)) {
    await s.getByTestId('pick-sail').click();
    await expect(s.getByTestId('port-screen')).toBeVisible();
    return 'free';
  }
  await s.getByTestId('pick-confirm').click();
  await s.getByTestId('set-ready').click();
  await expect(s.getByTestId('ready-note')).toBeVisible();
  return 'round';
}

/** 떠 있는 가벼운 창 닫기(항구 카드·개념 팝업·튜토리얼) */
export async function dismissLight(s: Page): Promise<void> {
  for (const id of ['port-card-ok', 'concept-ok', 'tutorial-skip', 'tutorial-close']) {
    const b = s.getByTestId(id);
    if (await b.isVisible().catch(() => false)) await b.click().catch(() => undefined);
  }
}

/** 교사 무역 시계 남은 초 */
export async function tradeLeft(t: Page): Promise<number> {
  return Number(await t.getByTestId('trade-clock').getAttribute('data-sec'));
}

/** DOM 텍스트(보이는 글자) */
export async function bodyText(p: Page): Promise<string> {
  return p.evaluate(() => document.body.innerText);
}
