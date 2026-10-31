import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { openTvMenu } from './support/voyage-ui';
import { shot174, wrapRound, type WrapSeen } from './support/wrap174';

/**
 * 작업 174 — 단원 한 판 25분(1~4차시)을 마무리 끝까지(`?sync=local` + 빌드본 미리보기 + Playwright 가짜 시계).
 * `LESSON_READY.L4`는 순서표 6단계에서 연다 — 지금은 개발 열쇠(localStorage `voyage.dev.fullUnit`)로 단원 한 판을 연다.
 * 교사는 '지금 할 일' 카드의 큰 버튼만 누른다(잡지 표지는 종이로 한 번 본 뒤 [게임에서 써요], 표지 고르기는 마무리 순서 목록에서).
 * 학생 3명은 무역 중에는 카드 확인·학습지 [다 썼어요]만, 마무리에서는 컨테이너 싣기·자기 평가·되돌아보기·잡지 표지를 한다.
 * 매 단계 TV·학생 innerText에 개발 표기 /\bL[1-4]\b/ 0건, 학생 화면 '선택' 0건, 페이지 오류 0.
 * 실행: tests/e2e-preview.playwright.config.ts(UNIT_E2E=1). 스크린숏은 .orch/tasks/174-finale-ox-awards-cover/shots/.
 */
const RUN = process.env.UNIT_E2E === '1';

test.use({ actionTimeout: 15_000 });

const stateOf = (t: Page) => t.getByTestId('now-card').getAttribute('data-state');
const visible = (p: Page, id: string) => p.getByTestId(id).first().isVisible().catch(() => false);

async function joinStudent(ctx: BrowserContext, as: string, code: string, seat: number, name: string, errors: string[]): Promise<Page> {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`s${seat}: ${e.message}`));
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

async function run(ctx: BrowserContext, t: Page, sec: number) {
  for (let i = 0; i < sec; i++) {
    await ctx.clock.runFor(1000);
    await t.waitForTimeout(30);
  }
}

async function pressBig(t: Page): Promise<{ state: string | null; label: string }> {
  const state = await stateOf(t);
  const btn = t.getByTestId('now-primary').locator('button');
  await expect(btn).toBeEnabled();
  const label = (await btn.innerText()).trim();
  await btn.click();
  for (let i = 0; i < 3; i++) {
    await t.waitForTimeout(120);
    if (!(await t.locator('[role="dialog"]').count())) break;
    await t.getByTestId('confirm-ok').click();
  }
  return { state, label };
}

/** 무역 중 학생: 카드 확인·학습지만(응답하지 않은 활동은 교사 [마감]이 닫는다) */
async function tidy(s: Page) {
  for (let k = 0; k < 6; k++) {
    let did = false;
    const done = s.getByTestId('worksheet-done');
    if ((await done.isVisible().catch(() => false)) && (await done.isEnabled().catch(() => false))) {
      await done.click();
      did = true;
    }
    for (const id of ['card-confirm', 'port-card-ok', 'concept-ok', 'catchup-ok', 'catchup-next', 'event-result-close', 'event-panel-close', 'minigame-close']) {
      if (await visible(s, id)) {
        if (await s.getByTestId(id).first().click({ timeout: 3000 }).then(() => true, () => false)) did = true;
      }
    }
    if (!did) return;
    await s.waitForTimeout(80);
  }
}

test('단원 한 판 25분 — 카드 큰 버튼만으로 마무리(컨테이너 OX → 결산·시상 → 되돌아보기 → 잡지 표지 → 끝나고 쓰기) 끝까지', async ({ browser, baseURL }) => {
  test.skip(!RUN, 'tests/e2e-preview.playwright.config.ts로 실행');
  test.setTimeout(1_500_000);
  const P = 'unit-25';
  const ctx = await browser.newContext({ baseURL, viewport: { width: 1366, height: 768 } });
  await ctx.clock.install();
  const t = await ctx.newPage();
  const errors: string[] = [];
  t.on('pageerror', (e) => errors.push(`teacher: ${e.message}`));
  await t.goto('./?sync=local#/teacher');
  await t.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('voyage.dev.fullUnit', '1');
  });
  await t.reload();
  await expect(t.getByTestId('teacher-start')).toBeVisible();
  await t.getByTestId('btn-new').click();
  await expect(t.getByTestId('unit-unit')).toBeEnabled();
  await t.getByTestId('unit-unit').click();
  const custom = t.getByTestId('trade-minutes-custom');
  await custom.fill('25');
  await custom.blur();
  await expect(custom).toHaveValue('25');
  await t.getByTestId('btn-open').click();
  const codeEl = t.getByTestId('room-code');
  await expect(codeEl).toHaveText(/^\d{6}$/);
  const code = (await codeEl.innerText()).trim();
  await openTvMenu(t);
  const [scr] = await Promise.all([ctx.waitForEvent('page'), t.getByTestId('btn-open-screen').click()]);
  scr.on('pageerror', (e) => errors.push(`tv: ${e.message}`));
  await scr.setViewportSize({ width: 1920, height: 1080 });
  await expect(scr.getByTestId('route-screen')).toBeVisible();
  const s1 = await joinStudent(ctx, 'u1', code, 1, '해오름무역', errors);
  const s2 = await joinStudent(ctx, 'u2', code, 2, '바다상회', errors);
  const s3 = await joinStudent(ctx, 'u3', code, 3, '고래해운', errors);
  const students = [s1, s2, s3];
  await t.bringToFront();
  await expect(t.getByTestId('now-card')).toHaveAttribute('data-state', 'ready');

  const seen: WrapSeen = { cards: new Set(), shots: new Set(), helpers: new Map() };
  const scenes = new Set<string>();
  const log: string[] = [];
  let wrapIds: string[] = [];
  for (let step = 0; step < 400; step++) {
    const st = (await stateOf(t)) ?? '';
    if (st === 'ended') break;
    if (st !== 'wrapup') for (const s of students) await tidy(s);
    scenes.add((await scr.getByTestId('route-screen').getAttribute('data-scene')) ?? '');
    if (step % 3 === 0 || st === 'wrapup') {
      for (const [label, pg] of [['TV', scr], ['s1', s1], ['s2', s2], ['s3', s3]] as const) {
        const txt = await pg.evaluate(() => document.body.innerText);
        const m = txt.match(/\bL[1-4]\b/);
        expect(m ? `${label} 단계 ${step} ${st}: …${txt.slice(Math.max(0, (m.index ?? 0) - 30), (m.index ?? 0) + 30)}…` : null).toBeNull();
        if (label !== 'TV') {
          const sel = txt.match(/선택/);
          expect(sel ? `${label} 단계 ${step}: …${txt.slice(Math.max(0, (sel.index ?? 0) - 30), (sel.index ?? 0) + 30)}…` : null).toBeNull();
        }
      }
    }
    const line = (await t.locator('.t-now__line').innerText().catch(() => '')).trim();
    if (st === 'wrapup') {
      if (!wrapIds.length) wrapIds = await t.locator('[data-testid="wrap-item"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-id') ?? ''));
      const r = await wrapRound({ t, scr, students, seen, scenes, P, line, tick: (sec) => run(ctx, t, sec) });
      if (r === 'continue') continue;
    }
    const res = await pressBig(t);
    log.push(`${res.state}:${res.label}`);
    await run(ctx, t, 1);
  }
  await expect(t.getByTestId('now-card')).toHaveAttribute('data-state', 'ended');
  await shot174(t, `${P}-teacher-ended.png`);
  test.info().annotations.push({ type: '누른 순서', description: log.slice(-30).join(' → ') });
  expect(errors, '페이지 오류').toEqual([]);
  expect(wrapIds.filter((x) => x !== 'settle')).toEqual(['containers', 'awards', 'reflect', 'magazine', 'afterWorksheet']);
  const cards = [...seen.cards];
  for (const l of ['s1', 's2', 's3']) {
    expect(cards, `컨테이너 ${l}`).toContain(`containers-done:${l}`);
    expect(cards, `되돌아보기 ${l}`).toContain(`reflect-sent:${l}`);
    expect(cards, `잡지 표지 ${l}`).toContain(`magazine-sent:${l}`);
  }
  expect(cards).toContain('reflect-inputs:3');
  expect(cards).toContain('magazine-paper:s1');
  expect(cards).toContain('tv-gallery');
  expect(cards.some((c) => c.startsWith('tv-award:intro:'))).toBe(true);
  expect(cards).toContain('tv-award-list');
  expect(scenes.has('containers') && scenes.has('reflect') && scenes.has('gallery') && scenes.has('awards'), [...scenes].join(',')).toBe(true);
  await ctx.close();
});
