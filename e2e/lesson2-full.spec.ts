import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { OLD_TEACHER_TERMS } from '../src/teacher/teacher-terms';
import { openTvMenu } from './support/voyage-ui';

/**
 * 작업 115 — 2차시 판(차시 한 판 L2) 끝에서 끝까지(`?sync=local` + 빌드본 미리보기 + Playwright 가짜 시계 — teacher-first-time.spec.ts와 같은 기반).
 * 교사는 '지금 할 일' 카드의 큰 버튼만 누른다(라운드 끝내기 확인 포함). 학생 3명이 각자 맡은 길을 간다:
 *  - s1 공장: 포트헤들랜드 철광석 → 부산에 1상자 팔기[수입] → [공장] 철강 만들기(첫 생산 순환 카드) (25분 판 — 라운드 3개)
 *  - s2 중계: (작업 167) 싱가포르 잠김 확인 → 방콕 쌀 사기 → 담맘에 팔기[중계] (15분 판은 사기까지).
 *    30분 '두 시간 모두'는 ⑥ 팝업이 닫힌 뒤(오늘 순서를 다 했어요, 자유 항해) 싱가포르 열림 → 첫 입항 개념 카드 → 쌀 → 담맘[중계]
 *  - s3 수출: 부산 자동차 사기 → 상하이에 팔기[수출]
 * 공용 화면: 세관 게시판 장면(학급 수입·수출 순위 + 교과서 100쪽). 학습지 ⑤~⑧ 팝업, 마무리 → 수업 끝.
 * (작업 154, v0.3.9) 2차시는 [앞 시간(기본)/뒤 시간/두 시간 모두]를 고른다. 15·25분은 앞 시간(기본) — 학습지 ⑤ → ⑥만, 확인 퀴즈·싱가포르 카드·중계 임무 없음.
 *  싱가포르 첫 입항 카드·중계 임무·⑦⑧은 30분 '두 시간 모두' 판에서 본다. 차시 한 판 2차시에는 확인 퀴즈가 없다.
 * 실행: tests/e2e-preview.playwright.config.ts(LESSON2_E2E=1). 스크린숏은 .orch/tasks/115-lesson2-factory-relay/shots/(SHOT_DIR 있으면 그쪽).
 */
const RUN = process.env.LESSON2_E2E === '1';
const SHOTS = process.env.SHOT_DIR ?? join(process.cwd(), '.orch', 'tasks', '115-lesson2-factory-relay', 'shots');

/** (작업 162) 추천 시간 스크린숏 */
const SHOTS162 = process.env.SHOT_DIR_162 ?? join(process.cwd(), '.orch', 'tasks', '162-no-time-end', 'shots');

/** (작업 162) 학생·TV 화면에 시간 숫자·'시간 끝/곧 끝나요' 말이 없다(학습지 [다 썼어요] 버튼의 "(n초 뒤에 켜져요)"는 뺀다) */
async function noTimeText(p: Page, where: string) {
  const text = await p.evaluate(() => document.body.innerText);
  const clean = text.replace(/\(\d+초 뒤에 켜져요\)/g, '');
  expect(clean, `${where}: m:ss`).not.toMatch(/\b\d{1,2}:\d{2}\b/);
  expect(clean, `${where}: 시간 끝 말`).not.toMatch(/무역 시간이 끝|곧 끝|시간이 다 됐|남은 시간|추천 시간/);
}

async function shot(page: Page, name: string, dir = SHOTS) {
  mkdirSync(dir, { recursive: true });
  await page.evaluate(() => document.fonts.ready).catch(() => undefined);
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(dir, name) });
}

test.use({ actionTimeout: 15_000 });

const stateOf = (t: Page) => t.getByTestId('now-card').getAttribute('data-state');
const visible = (p: Page, id: string) => p.getByTestId(id).first().isVisible().catch(() => false);

async function checkTerms(t: Page, where: string) {
  const text = await t.evaluate(() => {
    const root = document.querySelector('[data-testid="route-teacher"]') as HTMLElement | null;
    if (!root) return '';
    const ver = (root.querySelector('[data-testid="schedule-version"]') as HTMLElement | null)?.innerText ?? '';
    return ver ? root.innerText.replace(ver, '') : root.innerText;
  });
  const m = text.match(OLD_TEACHER_TERMS);
  expect(m ? `${where}: "${m[0]}"` : null).toBeNull();
  expect(text, `${where}: 교사 화면에 'L2' 개발 용어`).not.toMatch(/\bL2\b/);
}

type Part = 'front' | 'back' | 'all';

/** (작업 154) 자원 수입→생산→수출 임무 — 임무가 여럿이면 칩(mission-M-IPE), 하나면 한 줄 막대(mission[data-mission=M-IPE]) */
const ipeMission = (s: Page) => s.locator('[data-testid="mission-M-IPE"], [data-testid="mission"][data-mission="M-IPE"]');

async function setup(browser: import('@playwright/test').Browser, baseURL: string | undefined, minutes: number, part: Part = 'front') {
  const ctx = await browser.newContext({ baseURL, viewport: { width: 1366, height: 768 } });
  await ctx.clock.install();
  const t = await ctx.newPage();
  t.on('pageerror', (e) => {
    throw e;
  });
  await t.goto('./?sync=local#/teacher');
  await t.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await t.reload();
  await expect(t.getByTestId('teacher-start')).toBeVisible();
  await t.getByTestId('btn-new').click();
  await t.getByTestId('unit-lesson').click();
  // 판 설정: 1·2차시는 고를 수 있고 3·4차시는 준비 중, 단원 한 판도 준비 중
  await expect(t.getByTestId('lesson-L1')).toBeEnabled();
  await expect(t.getByTestId('lesson-L2')).toBeEnabled();
  await expect(t.getByTestId('lesson-L3')).toBeDisabled();
  await expect(t.getByTestId('lesson-L4')).toBeDisabled();
  await expect(t.getByTestId('unit-unit')).toBeDisabled();
  await t.getByTestId('lesson-L2').click();
  // (작업 154) 어느 시간 내용을 할까요? — 기본 '앞 시간'이 눌려 있다
  await expect(t.getByTestId('lesson-part-front')).toHaveAttribute('aria-pressed', 'true');
  await expect(t.getByTestId('preview-part')).toHaveText('2차시 앞 시간: 우리나라 무역의 특징 (교과서 100~102쪽)');
  if (part !== 'front') {
    await t.getByTestId(`lesson-part-${part}`).click();
    await expect(t.getByTestId(`lesson-part-${part}`)).toHaveAttribute('aria-pressed', 'true');
  }
  const custom = t.getByTestId('trade-minutes-custom');
  await custom.fill(String(minutes));
  await custom.blur();
  await expect(custom).toHaveValue(String(minutes));
  if (minutes === 25) await shot(t, `L2-01-setup-lesson2.png`);
  if (part === 'front') await expect(t.getByTestId('preview-ws-order')).toHaveText('학습지: 활동마다 바로 ⑤ → ⑥');
  if (part === 'all') await expect(t.getByTestId('preview-ws-order')).toHaveText('학습지: 활동마다 바로 ⑤ → ⑥ → ⑦ → ⑧');
  await t.getByTestId('btn-open').click();
  const codeEl = t.getByTestId('room-code');
  await expect(codeEl).toHaveText(/^\d{6}$/);
  return { ctx, t, code: (await codeEl.innerText()).trim() };
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

/** 가짜 시계 ms(작게 — 거래 연속 클릭 가드 500ms를 넘기려고) */
async function tick(ctx: BrowserContext, t: Page, ms: number) {
  await ctx.clock.runFor(ms);
  await t.waitForTimeout(30);
}

async function run(ctx: BrowserContext, t: Page, sec: number) {
  for (let i = 0; i < sec; i++) await tick(ctx, t, 1000);
}

async function confirmIfAsked(t: Page): Promise<string | null> {
  const dlg = t.locator('[role="dialog"]');
  if (!(await dlg.count())) return null;
  const id = await dlg.first().getAttribute('data-testid');
  await t.getByTestId('confirm-ok').click();
  return id;
}

async function pressBig(t: Page): Promise<{ state: string | null; label: string; confirms: string[] }> {
  const state = await stateOf(t);
  const btn = t.getByTestId('now-primary').locator('button');
  await expect(btn).toBeEnabled();
  const label = (await btn.innerText()).trim();
  await btn.click();
  const confirms: string[] = [];
  for (let i = 0; i < 3; i++) {
    await t.waitForTimeout(120);
    const id = await confirmIfAsked(t);
    if (!id) break;
    confirms.push(id);
  }
  return { state, label, confirms };
}

interface Seen {
  worksheets: Set<string>;
  /** (작업 153) 학습지 번호 → 그 팝업의 '오늘 학습지' 줄 */
  orders: Map<string, string>;
  quiz: Set<string>;
  shots: Set<string>;
  /** 학생이 본 사건 카드(확인 전) */
  cards: Set<string>;
  helperCustoms: string | null;
  /** (작업 165) '잠깐! 학습지 ⑥' 함께 쓰기 카드를 본 학생 / 맨 끝 ⑥ 팝업 한 줄 / 스크린숏 이름 머리 */
  along: Set<string>;
  alongLine: string | null;
  tag: string;
}

/** (작업 165) 스크린숏 */
const SHOTS165 = process.env.SHOT_DIR_165 ?? join(process.cwd(), '.orch', 'tasks', '165-worksheet6-alongside', 'shots');

/** (작업 165) 안내 카드가 떠 있어도 이 버튼들(보이는 것)은 화면 안이고 위에 다른 것이 덮지 않는다 */
async function notCovered(s: Page, re: string, what: string) {
  const r = await s.evaluate((src) => {
    const rx = new RegExp(src);
    const els = [...document.querySelectorAll('button[data-testid]')].filter((e) => rx.test(e.getAttribute('data-testid') ?? ''));
    const bad: string[] = [];
    let n = 0;
    // 스크롤 상자 밖으로 잘린 버튼(스크롤하면 보임)은 빼고, 보이는 영역 안에 다 들어온 버튼만 본다
    const clipOf = (el: Element) => {
      let top = 0;
      let bottom = innerHeight;
      for (let p = el.parentElement; p; p = p.parentElement) {
        const o = getComputedStyle(p);
        if (/(auto|scroll|hidden)/.test(o.overflowY)) {
          const r = p.getBoundingClientRect();
          top = Math.max(top, r.top);
          bottom = Math.min(bottom, r.bottom);
        }
      }
      return { top, bottom };
    };
    for (const el of els) {
      const b = el.getBoundingClientRect();
      const clip = clipOf(el);
      if (b.width === 0 || b.top < clip.top - 1 || b.bottom > clip.bottom + 1) continue;
      n++;
      const hit = document.elementFromPoint(b.left + b.width / 2, Math.min(b.top + b.height / 2, innerHeight - 1));
      if (b.bottom > innerHeight + 1 || !hit || !(el === hit || el.contains(hit))) bad.push(el.getAttribute('data-testid') ?? '');
    }
    return { n, bad };
  }, re);
  expect(r.n, `${what}: 버튼이 보인다`).toBeGreaterThan(0);
  expect(r.bad, `${what}: 가려진 버튼`).toEqual([]);
}

/** (작업 165) 카드: 문구, 해도·항구 화면 스크린숏(1366×768), 하단 바·항구 버튼을 가리지 않음 */
async function alongShots(s: Page, tag: string) {
  await expect(s.getByTestId('ws6-along-text')).toHaveText('지금부터는 학습지 ⑥의 문항을 동시에 쓰면서 게임을 해 보세요!');
  await expect(s.getByTestId('ws6-along')).toContainText('잠깐! 학습지 ⑥');
  if (await s.getByTestId('port-screen').count()) await s.getByTestId('port-back').click();
  await expect(s.getByTestId('ws6-along')).toBeVisible();
  await notCovered(s, '^(enter-port|hud-dex)$', '해도');
  await shot(s, `165-${tag}-ws6-along-map.png`, SHOTS165);
  await s.getByTestId('enter-port').click();
  await expect(s.getByTestId('port-screen')).toBeVisible();
  if (await visible(s, 'port-card-ok')) await s.getByTestId('port-card-ok').click();
  await expect(s.getByTestId('ws6-along')).toBeVisible();
  await notCovered(s, '^(port-back|(buy|sell|make)-[a-z0-9]+)$', '항구 화면');
  await shot(s, `165-${tag}-ws6-along-port.png`, SHOTS165);
}

/** 학생 화면에 떠 있는 것 정리(카드 확인·임무 패널·학습지 다 썼어요·확인 퀴즈 답·항구 카드·개념 카드) */
async function tidy(s: Page, seen: Seen, label: string) {
  for (let k = 0; k < 6; k++) {
    let did = false;
    // 학습지 팝업: 번호 기록 → 다 썼어요
    if (await visible(s, 'worksheet-popup')) {
      const ids = await s.locator('[data-testid="worksheet-row"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-id') ?? ''));
      ids.forEach((id) => seen.worksheets.add(id));
      // (작업 153) 팝업 머리 아래 '오늘 학습지' 순서 한 줄 — 번호마다 처음 본 글을 남긴다
      const order = s.getByTestId('worksheet-order');
      if (label === 's1' && ids[0] && !seen.orders.has(ids[0]) && (await order.count())) {
        seen.orders.set(ids[0], (await order.innerText()).trim());
        if (!seen.shots.has(`ws-order-${ids[0]}`)) {
          seen.shots.add(`ws-order-${ids[0]}`);
          await shot(s, `L2-07c-student-worksheet-order-${ids[0]}.png`);
        }
      }
      // (작업 165) 맨 끝 ⑥ 팝업: "아직 못 쓴 친구들은 …" 한 줄
      const alongLine = s.getByTestId('worksheet-along');
      if (label === 's1' && ids[0] === 'W06' && seen.alongLine === null && (await alongLine.count())) {
        seen.alongLine = (await alongLine.innerText()).trim();
        await shot(s, `165-${seen.tag}-ws6-last-popup.png`, SHOTS165);
      }
      const helper = s.locator('[data-testid="worksheet-helper"][data-helper="customsBoard"]');
      if (await helper.count()) {
        seen.helperCustoms = (await helper.first().innerText()).trim();
        if (!seen.shots.has('ws5')) {
          seen.shots.add('ws5');
          await shot(s, `L2-07-student-worksheet-05-${label}.png`);
        }
      }
      const done = s.getByTestId('worksheet-done');
      if ((await done.isVisible().catch(() => false)) && (await done.isEnabled().catch(() => false))) {
        await done.click();
        did = true;
      }
    }
    // (작업 165) '잠깐! 학습지 ⑥' 함께 쓰기 카드(막지 않음) → [알겠어요]로 닫으면 같은 판에서 다시 안 뜸
    if (await visible(s, 'ws6-along')) {
      if (label === 's1' && !seen.shots.has('ws6-along')) {
        seen.shots.add('ws6-along');
        await alongShots(s, seen.tag);
      }
      seen.along.add(label);
      await s.getByTestId('ws6-along-ok').click();
      await expect(s.getByTestId('ws6-along')).toHaveCount(0);
      did = true;
    }
    // 확인 퀴즈: 문항마다 첫 보기
    const qBtns = s.locator('[data-testid="quiz-card"] button[data-testid^="quiz-CQ-"]:not([disabled])');
    const tids = await qBtns.evaluateAll((els) => els.map((e) => e.getAttribute('data-testid') ?? ''));
    for (const tid of tids) {
      const qid = tid.replace(/^quiz-/, '').replace(/-[^-]+$/, '');
      const key = `${label}:${qid}`;
      if (seen.quiz.has(key)) continue;
      seen.quiz.add(key);
      await s.getByTestId(tid).click();
      did = true;
      break;
    }
    const cardIds = await s.locator('[data-testid="event-card"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-event') ?? ''));
    for (const id of cardIds) {
      if (id === 'L2-E2' && !seen.shots.has(`card-${label}`) && label === 's1') {
        seen.shots.add(`card-${label}`);
        await shot(s, `L2-02b-student-factory-open-card.png`);
      }
      seen.cards.add(id);
    }
    if (await visible(s, 'mission-panel')) {
      seen.cards.add('missions');
      // (작업 153) 처음 연 임무 패널: '먼저 할 일'과 [확인]이 스크롤 없이 화면 안(1366×768)
      if (!seen.shots.has(`missions-${label}`)) {
        seen.shots.add(`missions-${label}`);
        await expect(s.getByTestId('mission-first')).toBeVisible();
        const inView = async (sel: string) => s.locator(sel).first().evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; });
        expect(await inView('[data-testid="mission-first"]'), `${label} 먼저 할 일`).toBe(true);
        expect(await inView('[data-role="mission-panel-ok"]'), `${label} 임무 패널 [확인]`).toBe(true);
        if (label === 's1') await shot(s, 'L2-04b-student-mission-panel-1366.png');
      }
    }
    // 싱가포르 첫 입항 개념 카드(따라잡기 말 없이 'arrival')
    const arrival = s.locator('[data-testid="catchup"][data-mode="arrival"][data-event="L2-E5"]');
    if ((await arrival.count()) && !seen.cards.has(`arrival:${label}`)) {
      seen.cards.add(`arrival:${label}`);
      await expect(s.getByTestId('catchup-kicker')).toHaveText('처음 온 항구예요');
      await shot(s, `L2-06-student-singapore-card.png`);
    }
    for (const id of ['mission-panel-ok', 'card-confirm', 'port-card-ok', 'concept-ok', 'factory-cycle-ok', 'catchup-ok', 'catchup-next', 'event-result-close']) {
      if (await visible(s, id)) {
        // 다른 층(마무리 화면 등)에 가려 눌리지 않는 가벼운 창은 건너뛴다(무한 대기 방지)
        if (await s.getByTestId(id).first().click({ timeout: 3000 }).then(() => true, () => false)) did = true;
      }
    }
    if (!did) return;
    await s.waitForTimeout(80);
  }
}

async function enterPort(s: Page) {
  if (!(await s.getByTestId('port-screen').count())) await s.getByTestId('enter-port').click();
  await expect(s.getByTestId('port-screen')).toBeVisible();
  if (await visible(s, 'port-card-ok')) await s.getByTestId('port-card-ok').click();
}

async function sailTo(s: Page, port: string) {
  if (await s.getByTestId('port-screen').count()) await s.getByTestId('port-back').click();
  const hit = s.locator(`.wm-port[data-port="${port}"] .wm-port-hit`);
  const box = await hit.boundingBox();
  const vp = s.viewportSize()!;
  if (!box || box.y + box.height / 2 > vp.height - 100 || box.x < 0 || box.x > vp.width) await s.getByRole('button', { name: '전체 보기' }).click();
  await hit.click();
  await expect(s.getByTestId('pick-panel')).toHaveAttribute('data-kind', 'ok');
  // (작업 151) 2차시 차시 판 기본 = 자유 항해: [여기로 출발] → 바로 도착해 항구 화면이 열린다(운항비는 라운드 끝에)
  await expect(s.getByTestId('pick-sail')).toBeVisible();
  await expect(s.getByTestId('pick-body')).toContainText('라운드가 끝나면 한꺼번에 내요');
  await s.getByTestId('pick-sail').click();
  await expect(s.locator(`[data-testid="port-screen"][data-port="${port}"]`)).toBeVisible();
  await expect(s.getByTestId('hud-fare-due')).toBeVisible();
}

/** 수량 n으로 사기·팔기·만들기(거래 가드 500ms를 가짜 시계로 넘김) */
async function trade(ctx: BrowserContext, t: Page, s: Page, kind: 'buy' | 'sell' | 'make', good: string, n: number) {
  for (let i = 1; i < n; i++) await s.getByTestId(`${kind}-${good}-plus`).click();
  await expect(s.getByTestId(`${kind}-${good}-qty`)).toContainText(String(n));
  await s.getByTestId(`${kind}-${good}`).click();
  await tick(ctx, t, 600);
}

// (작업 154) 15·25분 = 앞 시간(기본), 30분 = 두 시간 모두(싱가포르·중계·⑦⑧ 확인)
for (const [minutes, part] of [[15, 'front'], [25, 'front'], [30, 'all']] as const) {
  const front = part === 'front';
  test(`2차시 ${minutes}분 ${front ? '앞 시간' : '두 시간 모두'} — 카드 큰 버튼만으로 끝까지(공장·수출·${front ? '' : '중계·'}세관 게시판·학습지 ${front ? '⑤⑥' : '⑤~⑧'}, 확인 퀴즈 없음)(v0.3.9)`, async ({ browser, baseURL }) => {
    test.skip(!RUN, 'tests/e2e-preview.playwright.config.ts로 실행');
    test.setTimeout(900_000);
    const P = minutes === 25 ? 'L2' : `L2-${minutes}`;
    const { ctx, t, code } = await setup(browser, baseURL, minutes, part);
    await openTvMenu(t);
    const [scr] = await Promise.all([ctx.waitForEvent('page'), t.getByTestId('btn-open-screen').click()]);
    await scr.setViewportSize({ width: 1920, height: 1080 });
    await expect(scr.getByTestId('route-screen')).toBeVisible();
    const s1 = await joinStudent(ctx, `a${minutes}1`, code, 1, '해오름무역');
    const s2 = await joinStudent(ctx, `a${minutes}2`, code, 2, '바다상회');
    const s3 = await joinStudent(ctx, `a${minutes}3`, code, 3, '고래해운');
    const students = [s1, s2, s3];
    await t.bringToFront();
    await expect(t.getByTestId('now-card')).toHaveAttribute('data-state', 'ready');

    const seen: Seen = { worksheets: new Set(), orders: new Map(), quiz: new Set(), shots: new Set(), cards: new Set(), helperCustoms: null, along: new Set(), alongLine: null, tag: P };
    const roundsDone = new Set<number>();
    const log: string[] = [];
    const scenes = new Set<string>();
    let customsShot = false;
    let ipeDone = false;
    for (let step = 0; step < 140; step++) {
      const st = (await stateOf(t)) ?? '';
      if (st === 'ended') break;
      for (const [i, s] of students.entries()) await tidy(s, seen, `s${i + 1}`);
      scenes.add((await scr.getByTestId('route-screen').getAttribute('data-scene')) ?? '');
      if (step % 4 === 0) await checkTerms(t, `단계 ${step} ${st}`);
      // (수정 1회차) TV·학생 화면에 개발 용어 L1~L4가 없다
      for (const [label, pg] of [['TV', scr], ['s1', s1], ['s2', s2], ['s3', s3]] as const) {
        const txt = await pg.evaluate(() => document.body.innerText);
        const m = txt.match(/L[1-4]/);
        expect(m ? `${label} 단계 ${step} ${st}: …${txt.slice(Math.max(0, (m.index ?? 0) - 30), (m.index ?? 0) + 30)}…` : null).toBeNull();
      }
      const line = (await t.locator('.t-now__line').innerText().catch(() => '')).trim();

      if (st === 'card' && line.includes('부산 공장 개장') && !seen.shots.has('e2')) {
        seen.shots.add('e2');
        await shot(t, `${P}-02-teacher-card-factory-open.png`);
        await shot(scr, `${P}-03-screen-factory-open.png`);
      }
      // 세관 게시판: 공용 화면 장면
      if (!customsShot && (await scr.getByTestId('route-screen').getAttribute('data-scene')) === 'customs') {
        customsShot = true;
        await expect(scr.getByTestId('scene-customs')).toBeVisible();
        await expect(scr.getByTestId('customs-exports')).toContainText('자동차');
        await expect(scr.getByTestId('customs-exports')).toContainText('석유 제품');
        // (수정 1회차) 15분 판에서도 수입 칸이 비지 않는다(공장에서 쓴 원유)
        await expect(scr.getByTestId('customs-imports')).toContainText('원유');
        await expect(scr.getByTestId('customs-imports-book')).toContainText('원유');
        await shot(scr, `${P}-08-screen-customs-board.png`);
        await shot(t, `${P}-08b-teacher-customs.png`);
      }

      if (st === 'round') {
        const r = Number(((await t.getByTestId('round-info').innerText()).match(/라운드 (\d+)/) ?? [])[1]);
        if (!roundsDone.has(r)) {
          roundsDone.add(r);
          await run(ctx, t, 1);
          for (const [i, s] of students.entries()) await tidy(s, seen, `s${i + 1}`);
          if (r === 1) {
            // 임무 3종: 아래 줄 칩
            // (작업 154) 두 시간 모두 = 임무 3종 칩 줄. 앞 시간은 임무가 하나(자원 수입→생산→수출)라 한 줄 막대(data-testid=mission)
            // (작업 167·168) 두 시간 모두도 라운드 1에는 임무가 하나(수출국 4유형은 ⑥ 팝업이 닫힐 때, 중계는 ⑥ 뒤 싱가포르 첫 입항 때)
            for (const s of students) await expect(s.getByTestId('mission')).toBeVisible();
            for (const s of students) await expect(s.getByTestId('mission-M-EXPORT4')).toHaveCount(0);
            await expect(ipeMission(s1)).toBeVisible();
            await shot(s1, `${P}-04-student-missions.png`);
            // s1: 처음 화물(담맘 원유 2상자) → 부산 [공장]에서 석유 제품 → 호찌민으로
            await enterPort(s1);
            await s1.getByTestId('tab-factory').click();
            await expect(s1.getByTestId('factory')).toBeVisible();
            await expect(s1.getByTestId('factory-record')).toContainText('원유 수입(담맘) → 아직 생산 전');
            await expect(s1.getByTestId('recipe-oilp')).toHaveAttribute('data-max', '2');
            await shot(s1, `${P}-09-student-factory.png`);
            await trade(ctx, t, s1, 'make', 'oilp', 2);
            await expect(s1.getByTestId('factory-cycle-card')).toBeVisible();
            await shot(s1, `${P}-10-student-factory-cycle-card.png`);
            await s1.getByTestId('factory-cycle-ok').click();
            await expect(s1.getByTestId('factory-record')).toContainText('원유 수입(담맘) → 석유 제품 생산 → 아직 수출 전');
            await sailTo(s1, 'HCM');
            // (작업 167) 싱가포르는 잠김(앞 시간 = 끝까지, 두 시간 모두 = ⑥ 팝업이 닫힐 때까지): 회색 점·누를 수 없음
            if (await s2.getByTestId('port-screen').count()) await s2.getByTestId('port-back').click();
            const sin2 = s2.locator('.wm-port[data-port="SIN"]');
            await expect(sin2).toHaveClass(/is-locked/);
            await expect(sin2.locator('.wm-port-hit')).toBeDisabled();
            await expect(sin2.locator('.wm-port-hit')).toHaveAttribute('aria-label', /아직 열리지 않은 항구/);
            // 스크린숏은 싱가포르가 보이게 전체 보기로
            await s2.getByRole('button', { name: '전체 보기' }).click();
            await tick(ctx, t, 800);
            await shot(s2, `${P}-06f-student-singapore-locked.png`);
            const tvSin = scr.locator('.wm-port[data-port="SIN"]');
            if (await tvSin.count()) {
              await expect(tvSin).toHaveClass(/is-locked/);
              seen.shots.add('tv-sin-locked');
            }
            // s2: 방콕 쌀 → 담맘(다른 나라끼리 [중계] 도장)
            await sailTo(s2, 'BKK');
            await enterPort(s3);
            await trade(ctx, t, s3, 'buy', 'car', 2);
            await sailTo(s3, 'SHA');
            await shot(t, `${P}-05-teacher-round.png`);
          } else if (r === 2) {
            // s1: 호찌민에 석유 제품 팔기[수출] → 자원 수입 → 생산 → 수출 임무 완료
            await tidy(s1, seen, 's1');
            await enterPort(s1);
            await trade(ctx, t, s1, 'sell', 'oilp', 2);
            await expect(s1.getByTestId('result-stamp-export')).toBeVisible();
            await tidy(s1, seen, 's1');
            await s1.getByTestId('port-back').click();
            await expect(ipeMission(s1)).toHaveAttribute('data-status', 'done');
            ipeDone = true;
            await shot(s1, `${P}-10b-student-ipe-done.png`);
            // s2: 방콕에서 쌀 사기. (작업 167) 앞 시간·두 시간 모두(⑥ 전) 모두 싱가포르의 비밀 카드·중계·4유형 임무가 없다
            await tidy(s2, seen, 's2');
            // (작업 151) 자유 항해는 도착하면 항구 화면이 열린 채로 다음 라운드가 될 수 있다 — 임무 칩(하단 바)은 해도에서 본다
            if (await s2.getByTestId('port-screen').count()) await s2.getByTestId('port-back').click();
            expect([...seen.cards]).not.toContain('arrival:s2');
            await expect(s2.getByTestId('mission-M-RELAY')).toHaveCount(0);
            await expect(s2.getByTestId('mission-M-EXPORT4')).toHaveCount(0);
            await expect(s2.locator('.wm-port[data-port="SIN"]')).toHaveClass(/is-locked/);
            await enterPort(s2);
            await expect(s2.locator('[data-testid="port-screen"][data-port="BKK"]')).toBeVisible();
            await trade(ctx, t, s2, 'buy', 'rice', 2);
            await s2.getByTestId('port-back').click();
            await sailTo(s2, 'DAM');
            await enterPort(s3);
            await trade(ctx, t, s3, 'sell', 'car', 2);
            await expect(s3.getByTestId('result-stamp-export')).toBeVisible();
            await tidy(s3, seen, 's3');
          } else if (r === 3) {
            // s2: 담맘에 쌀 팔기[중계]
            await tidy(s2, seen, 's2');
            await enterPort(s2);
            await trade(ctx, t, s2, 'sell', 'rice', 2);
            await expect(s2.getByTestId('result-stamp-relay')).toBeVisible();
            // (작업 154·167) [중계] 도장 분류는 그대로, '싱가포르의 무역' 개념 카드는 뜨지 않는다(앞 시간 = 늘, 두 시간 모두 = 싱가포르가 열리기 전)
            await expect(s2.getByTestId('concept-pop')).toHaveCount(0);
            await s2.getByTestId('port-back').click();
            await tidy(s2, seen, 's2');
          }
          await t.bringToFront();
        }
      }
      // (작업 162) 순서를 다 해도 판은 저절로 끝나지 않는다 — 1분을 더 기다려도 그대로, 학생은 계속 자유 항해(라운드 사이 사고팔기·출발).
      // 결산·시상은 선생님 [마무리로](큰 버튼, 남은 순서가 없어 확인 없음) 뒤에만
      if (st === 'waiting' && line === '오늘 순서를 다 했어요' && !seen.shots.has('plan-done')) {
        seen.shots.add('plan-done');
        await expect(t.getByTestId('now-plan-done-hint')).toHaveText('학생들은 계속 자유롭게 항해해요 · 끝낼 때 [마무리로]를 누르세요');
        await run(ctx, t, 60);
        await expect(t.getByTestId('now-card')).toHaveAttribute('data-state', 'waiting');
        await expect(t.getByTestId('now-plan-done')).toHaveText('오늘 순서를 다 했어요');
        for (const [i, s] of students.entries()) await tidy(s, seen, `s${i + 1}`);
        await sailTo(s3, 'BUS');
        await tidy(s3, seen, 's3');
        if (front) {
          // (작업 167) 앞 시간: ⑥ 팝업이 닫힌 뒤에도 싱가포르는 잠김, 4유형·중계 임무 없음
          for (const s of students) if (await s.getByTestId('port-screen').count()) await s.getByTestId('port-back').click();
          await expect(s2.locator('.wm-port[data-port="SIN"]')).toHaveClass(/is-locked/);
          for (const s of students) await expect(s.getByTestId('mission-M-EXPORT4')).toHaveCount(0);
          for (const s of students) await expect(s.getByTestId('mission-M-RELAY')).toHaveCount(0);
          // (작업 167) 흑연(사 주는 곳이 싱가포르뿐): 다른 항구 팔기 카드에 '사 주는 항구' 줄 없이 공장 재료 줄만
          await sailTo(s2, 'SHA');
          await tidy(s2, seen, 's2');
          await enterPort(s2);
          await trade(ctx, t, s2, 'buy', 'graphite', 1);
          await sailTo(s2, 'YOK');
          await tidy(s2, seen, 's2');
          await enterPort(s2);
          const gcard = s2.getByTestId('sell-card-graphite');
          await expect(gcard.getByTestId('sell-hint-factory')).toHaveText('부산 공장에서 배터리 재료로 써요(흑연·니켈·정밀 화학 원료 1상자씩)');
          await expect(gcard.getByTestId('sell-hint-ports')).toHaveCount(0);
          await expect(gcard.getByTestId('sell-hint')).not.toContainText('싱가포르');
          await gcard.scrollIntoViewIfNeeded();
          await shot(s2, `${P}-06h-student-graphite-hint-front.png`);
          await s2.getByTestId('port-back').click();
        } else {
          // (작업 167·168) 두 시간 모두: ⑥ 팝업이 닫힌 뒤 — 싱가포르 열림 + 수출국 4유형 임무(칩 줄)
          // 임무 칩(하단 바)은 해도에서 본다 — 항구 화면에 있는 학생은 해도로
          for (const s of students) if (await s.getByTestId('port-screen').count()) await s.getByTestId('port-back').click();
          await expect(s2.locator('.wm-port[data-port="SIN"]')).toHaveCount(1);
          await expect(s2.locator('.wm-port[data-port="SIN"]')).not.toHaveClass(/is-locked/);
          for (const s of students) await expect(s.getByTestId('mission-M-EXPORT4')).toBeVisible();
          const tvSinOpen = scr.locator('.wm-port[data-port="SIN"]');
          if (await tvSinOpen.count()) await expect(tvSinOpen).not.toHaveClass(/is-locked/);
          await s2.getByRole('button', { name: '전체 보기' }).click();
          await tick(ctx, t, 800);
          await shot(s2, `${P}-06g-student-singapore-open.png`);
          // 싱가포르 첫 입항 개념 카드(p.104) → 중계 임무 → 쌀 사기 → 도감 4유형 '내가 사고판 상품: 쌀' → 담맘에 팔기[중계]
          await sailTo(s2, 'SIN');
          await tidy(s2, seen, 's2');
          expect([...seen.cards]).toContain('arrival:s2');
          if (await s2.getByTestId('port-screen').count()) await s2.getByTestId('port-back').click();
          await expect(s2.getByTestId('mission-M-RELAY')).toBeVisible();
          await enterPort(s2);
          await expect(s2.getByTestId('singapore-note')).toBeVisible();
          await trade(ctx, t, s2, 'buy', 'rice', 2);
          await s2.getByTestId('port-back').click();
          await s2.getByTestId('hud-dex').click();
          await s2.getByTestId('dex-tab-exportTypes').click();
          await expect(s2.locator('[data-testid="dex-mine"][data-card="export-agri"]')).toHaveText('내가 사고판 상품: 쌀');
          await shot(s2, `${P}-12-student-dex-mine.png`);
          await s2.keyboard.press('Escape');
          await expect(s2.getByTestId('dex')).toHaveCount(0);
          await sailTo(s2, 'DAM');
          await tidy(s2, seen, 's2');
          await enterPort(s2);
          await trade(ctx, t, s2, 'sell', 'rice', 2);
          await expect(s2.getByTestId('result-stamp-relay')).toBeVisible();
          await s2.getByTestId('port-back').click();
          await tidy(s2, seen, 's2');
          await expect(s2.getByTestId('mission-M-RELAY')).toHaveAttribute('data-status', 'done');
        }
        await t.bringToFront();
        if (minutes === 25) {
          // 공개수업 판: 추천 시간(25분)이 지날 때까지 그대로 두어도 끝나지 않는다 — T 뒤 교사·TV·학생 화면
          const clock = t.getByTestId('trade-clock');
          for (let i = 0; i < 26 * 60 && (await clock.getAttribute('data-over')) !== '1'; i++) await tick(ctx, t, 1000);
          await run(ctx, t, 70);
          await expect(clock).toHaveAttribute('data-over', '1');
          await expect(t.getByTestId('now-late')).toHaveText('추천 시간이 지났어요 · 1분 더 하는 중');
          await expect(t.getByTestId('now-plan-done')).toHaveText('오늘 순서를 다 했어요');
          await sailTo(s3, 'SHA'); // T 뒤에도 자유 항해
          await tidy(s3, seen, 's3');
          await t.bringToFront();
          await shot(t, '162-plan-done-teacher-L2-25.png', SHOTS162);
          await shot(scr, '162-plan-done-tv-L2-25.png', SHOTS162);
          await shot(s3, '162-plan-done-student-L2-25.png', SHOTS162);
        }
        await noTimeText(scr, 'TV(순서를 다 함)');
        for (const [i, s] of students.entries()) await noTimeText(s, `s${i + 1}(순서를 다 함)`);
        await expect(t.getByTestId('now-primary')).toHaveAttribute('data-kind', 'finishEarly');
      }
      const res = await pressBig(t);
      log.push(`${res.state}:${res.label}${res.confirms.length ? `(${res.confirms.join('+')})` : ''}`);
      await run(ctx, t, 1);
      if ((await stateOf(t)) === 'wrapup' && !seen.shots.has('wrap')) {
        seen.shots.add('wrap');
        await shot(t, `${P}-11-teacher-wrapup.png`);
      }
    }
    await expect(t.getByTestId('now-card')).toHaveAttribute('data-state', 'ended');
    test.info().annotations.push({ type: '누른 순서', description: log.join(' → ') });
    // (작업 162) 순서를 다 한 카드에서 [마무리로]를 눌러 마무리로 갔다(저절로 가지 않음)
    expect(seen.shots.has('plan-done'), `순서를 다 함 카드 — ${log.join(' / ')}`).toBe(true);
    expect(log.some((x) => x.startsWith('waiting:마무리로'))).toBe(true);
    // 지나간 장면·학습지·임무
    expect([...scenes]).toContain('customs');
    expect(customsShot).toBe(true);
    // (작업 154) 앞 시간은 ⑤ → ⑥ 두 장만, 두 시간 모두는 ⑤~⑧. 어느 쪽이든 확인 퀴즈는 없다
    const wantWs = front ? ['W05', 'W06'] : ['W05', 'W06', 'W07', 'W08'];
    expect([...seen.worksheets], `학습지 — ${log.join(' / ')}`).toEqual(wantWs);
    expect([...seen.quiz], '확인 퀴즈 없음').toEqual([]);
    expect(log.join(' / '), '교사 카드에 확인 퀴즈 없음').not.toContain('확인 퀴즈');
    if (front) {
      expect(seen.orders.get('W05')).toBe('오늘 학습지: ⑤ 지금 → ⑥');
      expect(seen.orders.get('W06')).toMatch(/^오늘 학습지: ⑤✓? → ⑥ 지금$/);
    } else {
      // (작업 153) 학습지가 번호 순으로 한 장씩: ⑤ → ⑥ → ⑦ → ⑧, 팝업마다 '오늘 학습지' 줄(앞 번호 ✓·지금 번호 '지금')
      expect([...seen.worksheets]).toEqual(['W05', 'W06', 'W07', 'W08']);
      expect(seen.orders.get('W05')).toBe('오늘 학습지: ⑤ 지금 → ⑥ → ⑦ → ⑧');
      // 앞 번호는 그 학생이 [다 썼어요]를 눌렀으면 ✓(이 시험은 교사가 [다음으로]로 빨리 닫아 못 쓴 번호가 있을 수 있다)
      expect(seen.orders.get('W06')).toMatch(/^오늘 학습지: ⑤✓? → ⑥ 지금 → ⑦ → ⑧$/);
      expect(seen.orders.get('W08')).toMatch(/^오늘 학습지: ⑤✓? → ⑥✓? → ⑦✓? → ⑧ 지금$/);
    }
    // (작업 165) 세관 게시판·⑤ 뒤 라운드에 '⑥ 함께 쓰기' 카드(학생 모두), 맨 끝 ⑥ 팝업에 한 줄
    expect([...seen.along].sort(), '⑥ 함께 쓰기 카드를 본 학생').toEqual(['s1', 's2', 's3']);
    expect(seen.alongLine).toBe('아직 못 쓴 친구들은 남은 문제를 다 풀어보아요. ⑥의 1·2·3번을 모두 쓰고 [다 썼어요]를 눌러요.');
    // (작업 165) 15분 앞 시간(라운드 2개)은 세관 게시판·⑤가 라운드 1 뒤로 와서, 수출(라운드 2에 팖)이 ⑤ 도우미에 아직 없다
    if (minutes === 15) expect(seen.helperCustoms ?? '').toContain('많이 내보낸 상품: —');
    else expect(seen.helperCustoms ?? '').toContain('자동차');
    expect(seen.helperCustoms ?? '').toMatch(/들여온 상품: [^/]*원유/);
    expect(roundsDone.size).toBeGreaterThanOrEqual(2);
    // 자원 수입 → 생산 → 수출 순환을 끝까지(수정 1회차, 2차시 핵심 p.101)
    expect(ipeDone).toBe(true);
    expect([...seen.cards]).toEqual(expect.arrayContaining(front ? ['L2-E2', 'missions'] : ['L2-E2', 'missions', 'arrival:s2']));
    if (front) expect([...seen.cards]).not.toContain('arrival:s2');
    await ctx.close();
  });
}
