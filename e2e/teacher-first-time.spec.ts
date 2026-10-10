import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { OLD_TEACHER_TERMS } from '../src/teacher/teacher-terms';
import { openFold, openTvMenu } from './support/voyage-ui';

/**
 * 작업 137 "처음 쓰는 교사" e2e(`?sync=local` + 빌드본 미리보기, Playwright 가짜 시계 — round-start.spec.ts와 같은 기반).
 * 차시 L1 10분 판, 학생 3명.
 * (가) 카드만으로 끝까지: 시작 화면 → [새 판 열기] → 차시 한 판 → 1차시 → 10분 → [방 열기] → 학생 3명 입장·회사 설립 →
 *      '지금 할 일' 카드의 큰 버튼과 [잠깐 멈춤]/[이어서 하기] 1번만(접힘 영역·위쪽 띠·오늘 순서는 한 번도 누르지 않음) →
 *      마무리 → 수업 끝내기(확인 2번) → ended → [처음으로]. 단계마다 큰 버튼이 정확히 1개.
 * (나) 기다리기만: [무역 시작] 뒤 아무것도 누르지 않아도 활동 → 라운드 1 → … → 무역 시간 끝 → 마무리 첫 항목 자동 시작. 그 뒤 [다음으로]·수업 끝내기.
 * (다) 수동 진행: [설정] → [고급] → '선생님이 하나씩 넘기기' 뒤 카드 [다음으로]만으로 라운드 1이 열리고 끝까지.
 * (라) 스크린숏 보충: 무역 시간 끝(활동 중), 접힘 영역 모두 펼침, 1280×720 라운드 화면.
 * 용어 검사: 단계마다 교사 화면 보이는 글자에 옛 말(1등급·배치 n판·발동·빠진 활동·입장 마감·출항 준비·일시정지·발표 모드·마감)이 없다.
 * 실행: tests/e2e-preview.playwright.config.ts(FIRSTTIME_E2E=1). 스크린숏은 .orch/tasks/137-teacher-ux-now-card/shots/(SHOT_DIR 있으면 그쪽).
 */
const RUN = process.env.FIRSTTIME_E2E === '1';
const SHOTS = process.env.SHOT_DIR ?? join(process.cwd(), '.orch', 'tasks', '137-teacher-ux-now-card', 'shots');

async function shot(page: Page, name: string) {
  mkdirSync(SHOTS, { recursive: true });
  await page.evaluate(() => document.fonts.ready).catch(() => undefined);
  await page.waitForTimeout(350);
  await page.screenshot({ path: join(SHOTS, name) });
}

/** 교사 화면에 보이는 글자에 옛 말이 없다(설정 [고급] 맨 아래 작은 글씨 "배치 n판"은 뺀다) */
async function checkTerms(t: Page, where: string) {
  const text = await t.evaluate(() => {
    const root = document.querySelector('[data-testid="route-teacher"]') as HTMLElement | null;
    if (!root) return '';
    const ver = (root.querySelector('[data-testid="schedule-version"]') as HTMLElement | null)?.innerText ?? '';
    return ver ? root.innerText.replace(ver, '') : root.innerText;
  });
  // ★는 학습지 '지금 쓰기' 칸 표시(데이터 DURING_MARK, 학습지 문서와 같은 기호)라 뺀다
  expect((text.match(/\p{Extended_Pictographic}/gu) ?? []).filter((x) => x !== '★'), `${where}: 이모지(그림 문자) 없음`).toEqual([]);
  const m = text.match(OLD_TEACHER_TERMS);
  expect(m ? `${where}: "${m[0]}" — …${text.slice(Math.max(0, (m.index ?? 0) - 40), (m.index ?? 0) + 40)}…` : null).toBeNull();
}

/** 큰 버튼이 정확히 1개(보이는 것) */
async function oneBigButton(t: Page, where: string) {
  const n = await t.locator('.t-now__big').evaluateAll((els) => els.filter((e) => (e as HTMLElement).offsetParent !== null).length);
  expect(n, `${where}: 큰 버튼 수`).toBe(1);
  await expect(t.getByTestId('now-primary')).toHaveCount(1);
}

const stateOf = (t: Page) => t.getByTestId('now-card').getAttribute('data-state');

async function openTeacher(ctx: BrowserContext): Promise<{ t: Page; code: string }> {
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
  await t.getByTestId('lesson-L1').click();
  await t.getByTestId('trade-minutes').getByRole('button', { name: '10분' }).click();
  await t.getByTestId('btn-open').click();
  const codeEl = t.getByTestId('room-code');
  await expect(codeEl).toHaveText(/^\d{6}$/);
  return { t, code: (await codeEl.innerText()).trim() };
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

async function setup(browser: import('@playwright/test').Browser, baseURL: string | undefined, viewport = { width: 1366, height: 768 }) {
  const ctx = await browser.newContext({ baseURL, viewport });
  await ctx.clock.install();
  const { t, code } = await openTeacher(ctx);
  return { ctx, t, code };
}

/** 가짜 시계를 sec초 돌린다(1초씩 — 호스트 틱이 빠짐없이) */
async function run(ctx: BrowserContext, t: Page, sec: number) {
  for (let i = 0; i < sec; i++) {
    await ctx.clock.runFor(1000);
    await t.waitForTimeout(25);
  }
}

/** 확인 창이 떠 있으면 행동 버튼(0.5초 뒤 눌림 — Playwright가 눌릴 때까지 기다린다) */
async function confirmIfAsked(t: Page): Promise<string | null> {
  const dlg = t.locator('[role="dialog"]');
  if (!(await dlg.count())) return null;
  const id = await dlg.first().getAttribute('data-testid');
  // 안전한 버튼이 기본 포커스(PRD 7.5.2.6) — 창은 그린 뒤(useEffect) 포커스를 옮기므로 기다리는 검사로(수정 1회차)
  await expect(t.getByTestId('confirm-cancel')).toBeFocused();
  await t.getByTestId('confirm-ok').click();
  return id;
}

/** 카드 큰 버튼 누르기(+ 확인 창) */
async function pressBig(t: Page): Promise<{ state: string | null; kind: string | null; label: string; confirms: string[] }> {
  const state = await stateOf(t);
  const wrap = t.getByTestId('now-primary');
  const kind = await wrap.getAttribute('data-kind');
  const btn = wrap.locator('button');
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
  return { state, kind, label, confirms };
}

test.describe.configure({ mode: 'serial' });

test('(가) 카드만으로 끝까지 — 큰 버튼과 [잠깐 멈춤]/[이어서 하기] 1번만, 단계마다 큰 버튼 1개, 옛 말 없음', async ({ browser, baseURL }) => {
  test.skip(!RUN, 'tests/e2e-preview.playwright.config.ts로 실행');
  test.setTimeout(600_000);
  const { ctx, t, code } = await setup(browser, baseURL);
  // 입장 대기(13): 학생 0명 — [무역 시작] 비활성 + 까닭
  await expect(t.getByTestId('now-card')).toHaveAttribute('data-state', 'lobby');
  await expect(t.getByTestId('btn-start-trade')).toBeDisabled();
  await expect(t.getByTestId('now-reason')).toHaveText('학생이 1명 이상 들어오면 눌러요');
  await oneBigButton(t, '입장 대기');
  await checkTerms(t, '입장 대기');
  await shot(t, '137-01-lobby.png');
  const students = [
    await joinStudent(ctx, 'f01', code, 1, '해오름무역'),
    await joinStudent(ctx, 'f02', code, 2, '바다상회'),
    await joinStudent(ctx, 'f03', code, 3, '고래해운'),
  ];
  await t.bringToFront();
  // 무역 시작 전(12)
  await expect(t.getByTestId('now-card')).toHaveAttribute('data-state', 'ready');
  await expect(t.getByTestId('now-start-summary')).toContainText('약 3분 50초 뒤 라운드 1');
  await oneBigButton(t, '무역 시작 전');
  await checkTerms(t, '무역 시작 전');
  await shot(t, '137-02-ready.png');

  const log: string[] = [];
  const seen = new Set<string>();
  let paused = false;
  for (let step = 0; step < 80; step++) {
    const st = (await stateOf(t)) ?? '';
    seen.add(st);
    if (st === 'ended') break;
    await oneBigButton(t, `단계 ${step} ${st}`);
    await checkTerms(t, `단계 ${step} ${st}`);
    // 라운드 1에서 [잠깐 멈춤] → [이어서 하기] 한 번
    if (st === 'round' && !paused) {
      paused = true;
      await t.getByTestId('now-pause').click();
      await expect(t.getByTestId('now-card')).toHaveAttribute('data-state', 'paused');
      await expect(t.getByTestId('now-pause')).toHaveCount(0);
      seen.add('paused');
      await oneBigButton(t, '잠깐 멈춤');
      await checkTerms(t, '잠깐 멈춤');
      for (const s of students) await expect(s.locator('[data-layer="pause"]')).toBeVisible();
      await shot(t, '137-07-paused.png');
      const r = await pressBig(t); // [이어서 하기]
      expect(r.kind).toBe('resume');
      log.push(`${r.state}:${r.label}`);
      await run(ctx, t, 1);
      continue;
    }
    if (st === 'respond' && !seen.has('shot-respond')) {
      seen.add('shot-respond');
      await shot(t, '137-03-pre-activity-respond.png');
    }
    if (st === 'round' && (await t.getByTestId('tl-resp-count').count()) && !seen.has('shot-round-decision')) {
      // (수정 1회차) 라운드 중 결정: 라운드 카드 그대로 + 보조 정보·작은 글자 [응답 받기 끝내기]
      seen.add('shot-round-decision');
      await expect(t.getByTestId('btn-end-round')).toBeVisible();
      await expect(t.getByTestId('btn-close-event')).toBeVisible();
      await shot(t, '137-05b-round-decision.png');
    }
    if (st === 'result' && !seen.has('shot-result')) {
      seen.add('shot-result');
      await shot(t, '137-04-result.png');
    }
    if (st === 'round' && !seen.has('shot-round')) {
      seen.add('shot-round');
      await shot(t, '137-05-round.png');
    }
    if (st === 'worksheet' && !seen.has('shot-ws')) {
      seen.add('shot-ws');
      await expect(t.getByTestId('now-line')).toHaveText('학습지 ③★ 지금 바로 쓰기');
      await shot(t, '137-06-worksheet-during.png');
    }
    if (st === 'wrapup' && !seen.has('shot-wrap')) {
      seen.add('shot-wrap');
      await expect(t.getByTestId('now-line')).toHaveText('결산·시상 하는 중');
      await shot(t, '137-09-wrapup.png');
    }
    const r = await pressBig(t);
    log.push(`${r.state}:${r.label}${r.confirms.length ? `(${r.confirms.join('+')})` : ''}`);
    await run(ctx, t, 1);
  }
  await expect(t.getByTestId('now-card')).toHaveAttribute('data-state', 'ended');
  await expect(t.getByTestId('ended')).toBeVisible();
  await oneBigButton(t, '끝');
  await checkTerms(t, '끝');
  await shot(t, '137-10-ended.png');
  // 수업 끝내기는 확인 2번
  expect(log.find((x) => x.includes('confirm-end-1+confirm-end-2'))).toBeTruthy();
  // 지나간 상태: 준비 → 표지·카드 → 응답 활동 → 라운드 → 학습지 → 결과 → 마무리 → 끝
  for (const s of ['ready', 'card', 'respond', 'round', 'worksheet', 'paused', 'wrapup', 'ended', 'shot-round-decision']) expect([...seen], `상태 ${s} — ${log.join(' / ')}`).toContain(s);
  // [처음으로]
  await pressBig(t);
  await expect(t.getByTestId('teacher-start')).toBeVisible();
  test.info().annotations.push({ type: '누른 순서', description: log.join(' → ') });
  await ctx.close();
});

test('(나) 기다리기만 — 활동 → 라운드 1 → … → 무역 시간 끝 → 마무리 첫 항목 자동 시작, 그 뒤 [다음으로]·수업 끝내기', async ({ browser, baseURL }) => {
  test.skip(!RUN, 'tests/e2e-preview.playwright.config.ts로 실행');
  test.setTimeout(600_000);
  const { ctx, t, code } = await setup(browser, baseURL);
  const s1 = await joinStudent(ctx, 'w01', code, 1, '해오름무역');
  await joinStudent(ctx, 'w02', code, 2, '바다상회');
  await joinStudent(ctx, 'w03', code, 3, '고래해운');
  await t.bringToFront();
  const r0 = await pressBig(t); // [무역 시작] + 확인
  expect(r0.confirms).toEqual(['confirm-start']);
  // 이제 아무것도 누르지 않는다 — 카드 상태와 줄을 기록
  const trail: string[] = [];
  for (let sec = 0; sec < 640; sec++) {
    const st = (await stateOf(t)) ?? '';
    const line = (await t.locator('.t-now__line').innerText().catch(() => '')).trim();
    // (수정 1회차) 라운드 중 결정·결과는 라운드 카드의 보조 정보 — 줄 뒤에 표시를 붙여 기록
    const extra = st !== 'round' ? '' : (await t.getByTestId('tl-result').count()) ? '+result' : (await t.getByTestId('tl-resp-count').count()) ? '+decision' : '';
    if (extra === '+result' && !trail.some((x) => x.endsWith('+result'))) await shot(t, '137-04-result.png');
    const key = `${st}|${line.replace(/\d+:\d{2}/g, 'm:ss')}${extra}`;
    if (trail[trail.length - 1] !== key) trail.push(key);
    if (st === 'wrapup') break;
    // 자동 진행 문구: 활동 중에는 "n초 뒤 저절로 다음"
    if ((st === 'respond' || st === 'card') && sec % 30 === 5) await expect(t.locator('.t-now__sub')).toContainText(/뒤 저절로 다음|저절로/);
    await run(ctx, t, 1);
  }
  const states = trail.map((x) => x.split('|')[0]);
  const lines = trail.map((x) => x.split('|')[1]);
  // 차례: 표지 → 벽란도 → 무역·수입·수출 → 라운드 1 → 두 섬 → ③★ → 라운드 2(흑연 결정) → 결과 → 마무리
  const order = ['1차시 표지를 TV에 보여 주는 중', '벽란도 시장 하는 중', '무역·수입·수출을 TV에 보여 주는 중', '라운드 1 · 학생들이 사고팔고 항해하는 중', '두 섬 이야기 하는 중', '학습지 ③★ 지금 바로 쓰기', '라운드 2 · 학생들이 사고팔고 항해하는 중+decision', '라운드 2 · 학생들이 사고팔고 항해하는 중+result', '결산·시상 하는 중'];
  let at = -1;
  for (const want of order) {
    const i = lines.findIndex((l, k) => k > at && l === want);
    expect(i, `${want} — 지나간 줄: ${trail.join(' / ')}`).toBeGreaterThan(at);
    at = i;
  }
  expect(states[states.length - 1]).toBe('wrapup');
  // 마무리 첫 항목(결산·시상)이 저절로 시작 — 학생 화면도 결산
  await expect(t.locator('[data-testid="wrap-item"][data-id="awards"]')).toHaveAttribute('data-status', 'live');
  await expect(s1.getByTestId('wrap-awards')).toBeVisible({ timeout: 15_000 });
  // 그 뒤는 시간으로 넘기지 않는다(16.2-20) — 1분을 기다려도 결산·시상 그대로
  await run(ctx, t, 60);
  await expect(t.getByTestId('now-line')).toHaveText('결산·시상 하는 중');
  // [다음으로: 되돌아보기] → [다음으로: …] → [수업 끝내기](확인 2번)
  let ended = false;
  for (let i = 0; i < 6 && !ended; i++) {
    const r = await pressBig(t);
    if (r.kind === 'endSession') {
      expect(r.confirms).toEqual(['confirm-end-1', 'confirm-end-2']);
      ended = true;
    }
    await run(ctx, t, 1);
  }
  await expect(t.getByTestId('now-card')).toHaveAttribute('data-state', 'ended');
  await ctx.close();
});

test('(다) 수동 진행 — [설정]→[고급]→선생님이 하나씩 넘기기, 카드 [다음으로]만으로 라운드 1이 열리고 끝까지', async ({ browser, baseURL }) => {
  test.skip(!RUN, 'tests/e2e-preview.playwright.config.ts로 실행');
  test.setTimeout(600_000);
  const { ctx, t, code } = await setup(browser, baseURL);
  await joinStudent(ctx, 'm01', code, 1, '해오름무역');
  await joinStudent(ctx, 'm02', code, 2, '바다상회');
  await t.bringToFront();
  await t.getByTestId('btn-settings').click();
  await t.getByTestId('settings-advanced').locator(':scope > summary').click();
  await t.getByTestId('mode-manual').click();
  await expect(t.getByTestId('mode-manual')).toHaveAttribute('aria-pressed', 'true');
  await expect(t.getByTestId('mode-manual')).toHaveText('선생님이 하나씩 넘기기');
  await checkTerms(t, '설정 창(고급 펼침)');
  await t.getByTestId('settings-close').click();
  const r0 = await pressBig(t); // [무역 시작]
  expect(r0.confirms).toEqual(['confirm-start']);
  await run(ctx, t, 2);
  // 기다리는 항목(11, 수동) — 저절로 넘어가지 않는다
  await expect(t.getByTestId('now-card')).toHaveAttribute('data-manual', '1');
  await expect(t.getByTestId('tl-waiting')).toHaveText('다음: 1차시 표지');
  await expect(t.locator('.t-now__sub')).toContainText('선생님이 [다음으로]를 눌러야 넘어가요');
  await expect(t.getByTestId('btn-fire')).toHaveText(/다음으로/);
  await oneBigButton(t, '수동 대기');
  await checkTerms(t, '수동 대기');
  await shot(t, '137-11-manual-waiting.png');
  await run(ctx, t, 30);
  await expect(t.getByTestId('tl-waiting')).toHaveText('다음: 1차시 표지');
  // [다음으로]만으로 라운드 1까지
  const fired: string[] = [];
  for (let i = 0; i < 12 && (await stateOf(t)) !== 'round'; i++) {
    await oneBigButton(t, `수동 ${i}`);
    const r = await pressBig(t);
    fired.push(`${r.state}:${r.label}`);
    await run(ctx, t, 2);
    // 표지·카드는 시각이 지나도 저절로 끝나지 않는다
    if ((await stateOf(t)) === 'card') {
      await run(ctx, t, 40);
      await expect(t.getByTestId('now-card')).toHaveAttribute('data-state', 'card');
    }
  }
  await expect(t.getByTestId('round-info')).toContainText('라운드 1');
  expect(fired.length).toBeGreaterThanOrEqual(4); // 표지·벽란도·무역·수입·수출·라운드 1
  // 끝까지: 카드의 큰 버튼만(라운드 끝내기 확인 포함)
  for (let i = 0; i < 40 && (await stateOf(t)) !== 'ended'; i++) {
    await oneBigButton(t, `수동 끝까지 ${i}`);
    await checkTerms(t, `수동 끝까지 ${i}`);
    const r = await pressBig(t);
    fired.push(`${r.state}:${r.label}`);
    await run(ctx, t, 2);
  }
  await expect(t.getByTestId('now-card')).toHaveAttribute('data-state', 'ended');
  test.info().annotations.push({ type: '누른 순서', description: fired.join(' → ') });
  await ctx.close();
});

test('(라) 스크린숏 보충 — 무역 시간 끝(활동 중), 접힘 영역 모두 펼침, 1280×720 라운드 화면 + 큰 버튼 두 번 클릭', async ({ browser, baseURL }) => {
  test.skip(!RUN, 'tests/e2e-preview.playwright.config.ts로 실행');
  test.setTimeout(400_000);
  const { ctx, t, code } = await setup(browser, baseURL);
  for (const [i, n] of [[1, '해오름무역'], [2, '바다상회']] as const) await joinStudent(ctx, `x0${i}`, code, i, n);
  await t.bringToFront();
  await pressBig(t);
  await run(ctx, t, 30); // 벽란도 시장(응답 받는 활동)
  await expect(t.getByTestId('now-card')).toHaveAttribute('data-state', 'respond');
  // 큰 버튼 빠른 두 번 클릭: 한 단계만(응답 받기 끝내기 → 다음 항목 기다림), 그다음 [지금 시작]까지 가지 않는다
  await t.getByTestId('now-primary').locator('button').dblclick();
  await t.waitForTimeout(200);
  await expect(t.getByTestId('now-card')).toHaveAttribute('data-state', 'waiting');
  await expect(t.locator('.t-now__line')).toHaveText(/^다음: 무역·수입·수출 · /);
  await run(ctx, t, 2);
  await expect(t.getByTestId('now-card')).toHaveAttribute('data-state', 'waiting');
  // 무역 시간 끝(활동 중): '시간 조절'에서 줄여 활동 중에 시간이 끝나게
  await t.getByTestId('now-primary').locator('button').click(); // [지금 시작] 무역·수입·수출(카드)
  await run(ctx, t, 1);
  await expect(t.getByTestId('now-card')).toHaveAttribute('data-state', 'card');
  await openFold(t, 'time');
  const left = Number(await t.getByTestId('trade-clock').getAttribute('data-sec'));
  await t.getByTestId('custom-min').fill(String(Math.floor((left - 20) / 60)));
  await t.getByTestId('btn-custom-shorten').click();
  await confirmIfAsked(t);
  await expect.poll(async () => Number(await t.getByTestId('trade-clock').getAttribute('data-sec'))).toBeLessThan(80);
  for (let i = 0; i < 90 && (await stateOf(t)) !== 'timeUp'; i++) await run(ctx, t, 1);
  await expect(t.getByTestId('now-card')).toHaveAttribute('data-state', 'timeUp');
  await expect(t.getByTestId('btn-finish-now')).toBeVisible();
  await expect(t.getByTestId('btn-after-activity')).toBeVisible();
  await oneBigButton(t, '무역 시간 끝');
  await checkTerms(t, '무역 시간 끝');
  await shot(t, '137-08-time-up.png');
  await ctx.close();

  // 접힘 영역 모두 펼침(라운드 중) + 1280×720 라운드
  const b = await setup(browser, baseURL);
  for (const [i, n] of [[1, '해오름무역'], [2, '바다상회'], [3, '고래해운']] as const) await joinStudent(b.ctx, `y0${i}`, b.code, i, n);
  await b.t.bringToFront();
  await pressBig(b.t);
  await run(b.ctx, b.t, 235);
  await expect(b.t.getByTestId('now-card')).toHaveAttribute('data-state', 'round');
  for (const f of ['time', 'order', 'entry', 'worksheet', 'more'] as const) await openFold(b.t, f);
  await checkTerms(b.t, '접힘 영역 모두 펼침');
  // 오른쪽 단만 스크롤(페이지는 그대로) — 위(시간 조절·오늘 순서·입장 관리)와 아래(학습지·편지…) 두 장
  await b.t.getByTestId('side-folds').evaluate((el) => (el.scrollTop = 0));
  await shot(b.t, '137-12-all-folds-open.png');
  await b.t.getByTestId('side-folds').evaluate((el) => (el.scrollTop = el.scrollHeight));
  await shot(b.t, '137-12b-all-folds-open-bottom.png');
  expect(await b.t.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
  // 1366×768: 카드·진행 줄이 첫 화면, 학생 표 8줄 이상(접힘을 다시 닫고)
  for (const f of ['time', 'order', 'entry', 'worksheet', 'more'] as const) await b.t.getByTestId(`fold-${f}-head`).click();
  const inView = async (id: string) => b.t.getByTestId(id).evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; });
  expect(await inView('now-primary')).toBe(true);
  expect(await inView('now-pause')).toBe(true);
  expect(await inView('progress-line')).toBe(true);
  expect(await b.t.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
  await openTvMenu(b.t);
  await b.t.keyboard.press('Escape');
  await b.t.setViewportSize({ width: 1280, height: 720 });
  await b.t.waitForTimeout(300);
  expect(await inView('now-primary')).toBe(true);
  expect(await inView('now-pause')).toBe(true);
  await shot(b.t, '137-13-round-1280x720.png');
  await b.ctx.close();
});
