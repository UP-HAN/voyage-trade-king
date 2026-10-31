import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { OLD_TEACHER_TERMS } from '../src/teacher/teacher-terms';
import { openTvMenu } from './support/voyage-ui';
import { expectedContainerPct, wrapRound } from './support/wrap174';
import { AWARD_ORDER } from '../src/data/awards';

/**
 * 작업 173 — 4차시 판(차시 한 판 L4) 끝에서 끝까지(`?sync=local` + 빌드본 미리보기 + Playwright 가짜 시계 — lesson3-full.spec.ts와 같은 기반).
 * `LESSON_READY.L4`는 174까지 끝난 뒤 연다 — 이 시험은 개발 열쇠(localStorage `voyage.dev.fullUnit`)로 4차시를 연다.
 * 교사는 '지금 할 일' 카드의 큰 버튼만 누른다. 학생 3명:
 *  - 1번 해오름무역: 관세를 매겨요 · 공장 지음(정당한 임금 + 환경 설비 설치)
 *  - 2번 바다상회: 관세를 매겨요 · 공장 지음(낮은 임금 + 설비 안 함) → 근로 환경 보도 → 임금 올리기·설비 설치로 모두 고침
 *  - 3번 고래해운: 매기지 않아요 · 공장 짓지 않음(다른 회사의 공장 이야기)
 * 앞 시간: 표지 → 요약 → 1970년대 철강 투표·결과·회상 3단계·실제 사례 → ⑬ → 라운드(베트남 공장 결정) → 보도·개선 → 관세사 카드 → ⑭⑮ → 마지막 항해 → 마무리.
 * 뒤 시간 15분: 표지 → 라운드 → 마무리 목록(컨테이너 OX → 결산 → 되돌아보기 3문항 → 잡지 표지) 구성만(마무리 화면은 174).
 * 매 단계 TV·학생 innerText에 개발 표기 /\bL[1-4]\b/ 0건, 학생 화면 '선택' 0건, 페이지 오류 0.
 * TV·다른 학생 화면에 낮은 임금을 고른 회사(바다상회)의 이름이 공장·임금·보도 내용과 함께 나오지 않는다.
 * 실행: tests/e2e-preview.playwright.config.ts(LESSON4_E2E=1). 스크린숏은 .orch/tasks/173-lesson4-choices/shots/.
 */
const RUN = process.env.LESSON4_E2E === '1';
const SHOTS = process.env.SHOT_DIR ?? join(process.cwd(), '.orch', 'tasks', '173-lesson4-choices', 'shots');

async function shot(page: Page, name: string) {
  mkdirSync(SHOTS, { recursive: true });
  await page.evaluate(() => document.fonts.ready).catch(() => undefined);
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(SHOTS, name) });
}

test.use({ actionTimeout: 15_000 });

const stateOf = (t: Page) => t.getByTestId('now-card').getAttribute('data-state');
const visible = (p: Page, id: string) => p.getByTestId(id).first().isVisible().catch(() => false);

type Part = 'front' | 'back' | 'all';

const PART_TEXT: Record<Part, string> = {
  front: '4차시 앞 시간: 수입과 기업의 결정 (교과서 108~110쪽)',
  back: '4차시 뒤 시간: 항해를 마치며 (교과서 111~113쪽)',
  all: '4차시 두 시간 모두 (교과서 108~113쪽)',
};

async function checkTerms(t: Page, where: string) {
  const text = await t.evaluate(() => {
    const root = document.querySelector('[data-testid="route-teacher"]') as HTMLElement | null;
    if (!root) return '';
    const ver = (root.querySelector('[data-testid="schedule-version"]') as HTMLElement | null)?.innerText ?? '';
    return ver ? root.innerText.replace(ver, '') : root.innerText;
  });
  const m = text.match(OLD_TEACHER_TERMS);
  expect(m ? `${where}: "${m[0]}"` : null).toBeNull();
}

async function setup(browser: import('@playwright/test').Browser, baseURL: string | undefined, minutes: number, part: Part) {
  const ctx = await browser.newContext({ baseURL, viewport: { width: 1366, height: 768 } });
  await ctx.clock.install();
  const t = await ctx.newPage();
  const errors: string[] = [];
  t.on('pageerror', (e) => errors.push(`teacher: ${e.message}`));
  await t.goto('./?sync=local#/teacher');
  await t.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await t.reload();
  // 열쇠 없이는 4차시가 '준비 중'
  await expect(t.getByTestId('teacher-start')).toBeVisible();
  await t.getByTestId('btn-new').click();
  await t.getByTestId('unit-lesson').click();
  await expect(t.getByTestId('lesson-L4')).toBeDisabled();
  await expect(t.getByTestId('lesson-L4')).toContainText('준비 중');
  // (작업 173) 174 전에는 개발 열쇠로만 4차시를 연다
  await t.evaluate(() => localStorage.setItem('voyage.dev.fullUnit', '1'));
  await t.reload();
  await expect(t.getByTestId('teacher-start')).toBeVisible();
  await t.getByTestId('btn-new').click();
  await t.getByTestId('unit-lesson').click();
  await expect(t.getByTestId('lesson-L4')).toBeEnabled();
  await t.getByTestId('lesson-L4').click();
  // 어느 시간 내용을 할까요? — 버튼 세 개, 기본 '앞 시간'
  await expect(t.locator('[data-testid^="lesson-part-"]:not([data-testid="lesson-part-pick"])')).toHaveCount(3);
  await expect(t.getByTestId('lesson-part-front')).toHaveAttribute('aria-pressed', 'true');
  await expect(t.getByTestId('lesson-part-pick')).toContainText('교과서 108~110쪽');
  await expect(t.getByTestId('lesson-part-pick')).toContainText('교과서 111~113쪽');
  if (part !== 'front') await t.getByTestId(`lesson-part-${part}`).click();
  await expect(t.getByTestId('preview-part')).toHaveText(PART_TEXT[part]);
  const custom = t.getByTestId('trade-minutes-custom');
  await custom.fill(String(minutes));
  await custom.blur();
  await expect(custom).toHaveValue(String(minutes));
  const order = (await t.getByTestId('preview-order').innerText()).trim();
  if (part === 'front') {
    await expect(t.getByTestId('preview-ws-order')).toHaveText('학습지: 활동마다 바로 ⑬ → ⑭ → ⑮');
    await expect(t.getByTestId('lesson4-time-hint')).toContainText('결산·시상·되돌아보기만');
    expect(order).not.toMatch(/컨테이너|잡지/);
  }
  if (part === 'back') {
    await expect(t.getByTestId('preview-ws-order')).toHaveCount(0);
    await expect(t.getByTestId('lesson4-time-hint')).toContainText('무역 10~15분');
    expect(order).not.toMatch(/철강|베트남|공장|관세사|근로 환경/);
  }
  await shot(t, `L4-${part}-${minutes}-01-setup.png`);
  await t.getByTestId('btn-open').click();
  const codeEl = t.getByTestId('room-code');
  await expect(codeEl).toHaveText(/^\d{6}$/);
  return { ctx, t, code: (await codeEl.innerText()).trim(), errors };
}

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

async function tick(ctx: BrowserContext, t: Page, ms: number) {
  await ctx.clock.runFor(ms);
  await t.waitForTimeout(30);
}

async function run(ctx: BrowserContext, t: Page, sec: number) {
  for (let i = 0; i < sec; i++) await tick(ctx, t, 1000);
}

async function pressBig(t: Page): Promise<{ state: string | null; label: string }> {
  const state = await stateOf(t);
  const btn = t.getByTestId('now-primary').locator('button');
  await expect(btn).toBeEnabled();
  const label = (await btn.innerText()).trim();
  await btn.click();
  for (let i = 0; i < 3; i++) {
    await t.waitForTimeout(120);
    const dlg = t.locator('[role="dialog"]');
    if (!(await dlg.count())) break;
    await t.getByTestId('confirm-ok').click();
  }
  return { state, label };
}

interface Plan {
  vote: 'tariff' | 'noTariff';
  vn: 'fair' | 'low' | 'none';
}

interface Seen {
  worksheets: Set<string>;
  cards: Set<string>;
  shots: Set<string>;
  helpers: Map<string, string>;
}

/** 학생 화면 정리: 학습지·투표·기사·공장 결정·보도 고치기·카드 확인 */
async function tidy(s: Page, seen: Seen, label: string, plan: Plan, P: string) {
  for (let k = 0; k < 10; k++) {
    let did = false;
    if (await visible(s, 'worksheet-popup')) {
      const ids = await s.locator('[data-testid="worksheet-row"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-id') ?? ''));
      ids.forEach((id) => seen.worksheets.add(id));
      const helpers = await s.locator('[data-testid="worksheet-helper"]').evaluateAll((els) => els.map((e) => [e.getAttribute('data-helper') ?? '', (e as HTMLElement).innerText.trim()] as const));
      for (const [h, txt] of helpers) if (!seen.helpers.has(`${label}:${h}`)) seen.helpers.set(`${label}:${h}`, txt);
      if (label === 's2' && ids[0] && !seen.shots.has(`ws-${ids[0]}`)) {
        seen.shots.add(`ws-${ids[0]}`);
        await shot(s, `${P}-student-worksheet-${ids[0]}.png`);
      }
      const done = s.getByTestId('worksheet-done');
      if ((await done.isVisible().catch(() => false)) && (await done.isEnabled().catch(() => false))) {
        await done.click();
        did = true;
      }
    }
    // 1970년대 철강 투표(투표 공통 카드)
    if (await visible(s, `vote-${plan.vote}`)) {
      await s.getByTestId(`vote-${plan.vote}`).click();
      did = true;
      if (label === 's1' && !seen.shots.has('vote')) {
        seen.shots.add('vote');
        await expect(s.getByTestId('vote-done')).toBeVisible();
        await shot(s, `${P}-student-vote.png`);
      }
    }
    for (const id of ['steel-card', 'steel-real']) {
      if (await visible(s, id)) {
        const k2 = `${id}:${(await s.getByTestId(id).first().getAttribute('data-event')) ?? ''}`;
        if (!seen.cards.has(k2)) {
          seen.cards.add(k2);
          if (label === 's1') await shot(s, `${P}-student-${k2.replace(/[:]/g, '-')}.png`);
        }
      }
    }
    // 베트남 기사(전체 형태: 밑줄 / 짧은 형태: 요약) → 공장 결정 3단계
    if (await visible(s, 'article-done')) {
      seen.cards.add('vn-article');
      const sents = s.locator('[data-testid="article-card"] [data-testid="article-sentence"]');
      if (await sents.count()) {
        seen.cards.add('vn-article-full');
        await sents.nth(1).click();
      }
      if (label === 's1' && !seen.shots.has('vn-article')) {
        seen.shots.add('vn-article');
        await shot(s, `${P}-student-vn-article.png`);
      }
      await s.getByTestId('article-done').click();
      did = true;
    }
    if (await visible(s, 'vn-card')) {
      const step = Number(await s.getByTestId('vn-card').getAttribute('data-step'));
      const pick = step === 0 ? (plan.vn === 'none' ? 'vn-build-no' : 'vn-build-yes') : step === 1 ? (plan.vn === 'low' ? 'vn-wage-low' : 'vn-wage-fair') : step === 2 ? (plan.vn === 'low' ? 'vn-env-skip' : 'vn-env-install') : null;
      if (label === 's2' && !seen.shots.has(`vn-step-${step}`)) {
        seen.shots.add(`vn-step-${step}`);
        await shot(s, `${P}-student-vn-step${step}.png`);
      }
      if (pick) await s.getByTestId(pick).click();
      else {
        if (label === 's2') await s.getByTestId('vn-reason').fill('수익을 더 얻고 싶어서');
        await s.getByTestId('vn-submit').click();
      }
      did = true;
    }
    if (await visible(s, 'vn-decided')) {
      const k2 = `vn-decided:${label}`;
      if (!seen.cards.has(k2)) {
        seen.cards.add(k2);
        seen.cards.add(`vn-line:${label}:${(await s.getByTestId('vn-result-line').innerText()).trim()}`);
        if (await visible(s, 'vn-other-story')) seen.cards.add(`vn-story:${label}`);
        await shot(s, `${P}-student-vn-decided-${label}.png`);
      }
    }
    // 근로 환경 보도: 2번은 고치기 두 번, 나머지는 '다른 회사 공장 이야기'
    if (await visible(s, 'vn-report-mine')) {
      seen.cards.add(`report-mine:${label}`);
      if (!seen.shots.has(`report-${label}`)) {
        seen.shots.add(`report-${label}`);
        await shot(s, `${P}-student-report-${label}.png`);
      }
      for (const w of ['wage', 'env']) {
        if (await visible(s, `vn-fix-${w}`)) {
          await s.getByTestId(`vn-fix-${w}`).click();
          await s.waitForTimeout(300);
          did = true;
          break;
        }
      }
      if (await visible(s, 'vn-fixed-all')) {
        seen.cards.add(`fixed-all:${label}`);
        if (!seen.shots.has(`fixed-${label}`)) {
          seen.shots.add(`fixed-${label}`);
          await shot(s, `${P}-student-report-fixed-${label}.png`);
        }
      }
    }
    if (await visible(s, 'vn-report-other')) {
      if (!seen.cards.has(`report-other:${label}`)) {
        seen.cards.add(`report-other:${label}`);
        await shot(s, `${P}-student-report-other-${label}.png`);
      }
    }
    if (await visible(s, 'event-panel-folded')) {
      await s.getByTestId('event-panel-unfold').click();
      did = true;
    }
    const cardIds = await s.locator('[data-testid="event-card"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-event') ?? ''));
    cardIds.forEach((id) => seen.cards.add(id));
    if (cardIds.includes('L4-E4') && label === 's1' && !seen.shots.has('broker')) {
      seen.shots.add('broker');
      await shot(s, `${P}-student-broker-card.png`);
    }
    for (const id of ['card-confirm', 'port-card-ok', 'concept-ok', 'catchup-ok', 'catchup-next', 'event-result-close', 'event-panel-close']) {
      if (await visible(s, id)) {
        if (await s.getByTestId(id).first().click({ timeout: 3000 }).then(() => true, () => false)) did = true;
      }
    }
    if (!did) return;
    await s.waitForTimeout(80);
  }
}

const LOW_NAME = '바다상회';


for (const [minutes, part] of [[30, 'front'], [25, 'front'], [15, 'front'], [15, 'back'], [25, 'all']] as const) {
  test(`4차시 ${minutes}분 ${part === 'front' ? '앞 시간' : part === 'back' ? '뒤 시간' : '두 시간 모두'} — 카드 큰 버튼만으로 끝까지`, async ({ browser, baseURL }) => {
    test.skip(!RUN, 'tests/e2e-preview.playwright.config.ts로 실행');
    test.setTimeout(900_000);
    const front = part !== 'back';
    const P = `L4-${part}-${minutes}`;
    const { ctx, t, code, errors } = await setup(browser, baseURL, minutes, part);
    await openTvMenu(t);
    const [scr] = await Promise.all([ctx.waitForEvent('page'), t.getByTestId('btn-open-screen').click()]);
    scr.on('pageerror', (e) => errors.push(`tv: ${e.message}`));
    await scr.setViewportSize({ width: 1920, height: 1080 });
    await expect(scr.getByTestId('route-screen')).toBeVisible();
    const s1 = await joinStudent(ctx, `d${minutes}${part}1`, code, 1, '해오름무역', errors);
    const s2 = await joinStudent(ctx, `d${minutes}${part}2`, code, 2, LOW_NAME, errors);
    const s3 = await joinStudent(ctx, `d${minutes}${part}3`, code, 3, '고래해운', errors);
    const students = [s1, s2, s3];
    const plans: Plan[] = [
      { vote: 'tariff', vn: 'fair' },
      { vote: 'tariff', vn: 'low' },
      { vote: 'noTariff', vn: 'none' },
    ];
    await t.bringToFront();
    await expect(t.getByTestId('now-card')).toHaveAttribute('data-state', 'ready');
    // (작업 178) 상별 수상 인원 1명 — 학생 3명이라도 상이 여러 개 나와 시상 차례(도약상 → 무역왕상)가 실제로 돈다
    await t.getByTestId('btn-settings').click();
    await t.getByTestId('settings-advanced').locator(':scope > summary').click();
    await t.getByTestId('set-awards-per-1').click();
    await expect(t.getByTestId('set-awards-per-1')).toHaveAttribute('aria-pressed', 'true');
    await t.getByTestId('settings-close').click();

    const seen: Seen = { worksheets: new Set(), cards: new Set(), shots: new Set(), helpers: new Map() };
    const log: string[] = [];
    const scenes = new Set<string>();
    const steelSteps = new Set<string>();
    const lines = new Set<string>();
    const roundsDone = new Set<number>();
    let wrapIds: string[] = [];
    let reflectQs: string | null = null;
    for (let step = 0; step < 200; step++) {
      const st = (await stateOf(t)) ?? '';
      if (st === 'ended') break;
      for (const [i, s] of students.entries()) await tidy(s, seen, `s${i + 1}`, plans[i]!, P);
      const scene = (await scr.getByTestId('route-screen').getAttribute('data-scene')) ?? '';
      scenes.add(scene);
      if (scene === 'steel') steelSteps.add((await scr.getByTestId('scene-steel').getAttribute('data-step')) ?? '');
      if (await scr.getByTestId('vn-bars').count()) {
        seen.cards.add('tv-vn-bars');
        // (검증 반영) 세 줄 모두 1920×1080 화면 안에, 줄마다 이름·수가 한 칸(다른 줄 이름에 붙지 않음)
        for (const r of ['build', 'wage', 'env']) {
          const box = await scr.getByTestId(`vn-row-${r}`).locator('.scr-vn__val').boundingBox();
          expect(box && box.y + box.height <= 1080, `TV 막대 ${r} 화면 안`).toBe(true);
        }
        expect(await scr.getByTestId('vn-row-wage').locator('.scr-vn__val').innerText()).toMatch(/^정당한 임금 \d+ · 낮은 임금 \d+/);
        if (!seen.shots.has('tv-vn-bars')) {
          seen.shots.add('tv-vn-bars');
          await shot(scr, `${P}-tv-vn-bars.png`);
        }
      }
      if (step % 4 === 0) await checkTerms(t, `단계 ${step} ${st}`);
      for (const [label, pg] of [['TV', scr], ['s1', s1], ['s2', s2], ['s3', s3]] as const) {
        const txt = await pg.evaluate(() => document.body.innerText);
        const m = txt.match(/\bL[1-4]\b/);
        expect(m ? `${label} 단계 ${step} ${st}: …${txt.slice(Math.max(0, (m.index ?? 0) - 30), (m.index ?? 0) + 30)}…` : null).toBeNull();
        if (label !== 'TV') {
          const sel = txt.match(/선택/);
          expect(sel ? `${label} 단계 ${step}: …${txt.slice(Math.max(0, (sel.index ?? 0) - 30), (sel.index ?? 0) + 30)}…` : null).toBeNull();
        }
        // 낮은 임금을 고른 회사 이름은 TV·다른 학생 화면에 공장·임금·보도 내용과 함께 나오지 않는다
        if (label !== 's2' && /임금|근로 환경|공장 결정|환경 설비/.test(txt)) expect(txt.includes(LOW_NAME), `${label} 단계 ${step}: 낮은 임금 회사 이름`).toBe(false);
      }
      const line = (await t.locator('.t-now__line').innerText().catch(() => '')).trim();
      lines.add(line);
      // TV 장면 스크린숏
      const key = scene === 'steel' ? `steel-${[...steelSteps].pop()}` : scene === 'event' ? `event-${(await scr.getByTestId('scene-event').getAttribute('data-event').catch(() => '')) ?? ''}-${await scr.getByTestId('scene-event').getAttribute('data-revealed').catch(() => '')}` : scene;
      if (['cover', 'event', 'steel', 'bars', 'worksheet', 'summary'].includes(scene) && !seen.shots.has(`tv-${key}`)) {
        seen.shots.add(`tv-${key}`);
        await shot(scr, `${P}-tv-${key}.png`);
      }
      if ((st === 'respond' || line.includes('1970년대')) && !seen.shots.has(`t-${line}`)) {
        seen.shots.add(`t-${line}`);
        await shot(t, `${P}-teacher-${seen.shots.size}.png`);
      }
      if (st === 'round') {
        const r = Number(((await t.getByTestId('round-info').innerText()).match(/라운드 (\d+)/) ?? [])[1]);
        if (!roundsDone.has(r)) {
          roundsDone.add(r);
          await run(ctx, t, 1);
          for (const [i, s] of students.entries()) await tidy(s, seen, `s${i + 1}`, plans[i]!, P);
          await shot(scr, `${P}-tv-round-${r}.png`);
          const txt = await t.getByTestId('now-card').innerText();
          if (txt.includes('근로 환경 보도')) {
            seen.cards.add('teacher-report-line');
            await shot(t, `${P}-teacher-report.png`);
          }
          await t.bringToFront();
        }
      }
      if (st === 'wrapup' && !wrapIds.length) {
        wrapIds = await t.locator('[data-testid="wrap-item"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-id') ?? ''));
        await shot(t, `${P}-teacher-wrapup.png`);
      }
      if (st === 'wrapup' && (await visible(s1, 'wrap-reflect')) && reflectQs === null) {
        reflectQs = await s1.getByTestId('wrap-reflect').getAttribute('data-questions');
        await shot(s1, `${P}-student-reflect.png`);
      }
      // ── (작업 174) 마무리: 학생 행동 + 교사 고르기 + TV 확인(e2e/support/wrap174.ts) ──
      if (st === 'wrapup') {
        const r = await wrapRound({ t, scr, students, seen, scenes, P, line, tick: (sec) => run(ctx, t, sec) });
        if (r === 'continue') continue;
      }
      const res = await pressBig(t);
      log.push(`${res.state}:${res.label}`);
      await run(ctx, t, 1);
    }
    await expect(t.getByTestId('now-card')).toHaveAttribute('data-state', 'ended');
    test.info().annotations.push({ type: '누른 순서', description: log.join(' → ') });
    expect(errors, '페이지 오류').toEqual([]);
    const allLines = [...lines].join(' / ');
    const wantWs = part !== 'back' ? ['W13', 'W14', 'W15'] : [];
    expect([...seen.worksheets].filter((w) => /^W1[3-5]$/.test(w)), `학습지 — ${log.join(' / ')}`).toEqual(wantWs);
    if (front) {
      // 1970년대 철강: TV 장면이 단계대로
      // (검증 반영) 무역 30분 미만은 회상 3단계를 빼고(짧게) 베트남을 전체 형태로
      expect([...steelSteps]).toEqual(minutes >= 30 ? ['result', 's1', 's2', 's3', 'real'] : ['result', 'real']);
      if (minutes >= 25) expect(seen.cards.has('vn-article-full'), '베트남 기사 밑줄(전체 형태)').toBe(true);
      expect(allLines).toContain('1970년대 철강 투표');
      // 공장 결정·보도·개선
      expect(seen.cards.has('vn-decided:s1') && seen.cards.has('vn-decided:s2') && seen.cards.has('vn-decided:s3'), [...seen.cards].join(',')).toBe(true);
      expect([...seen.cards]).toContain('vn-line:s1:공장 수익 +300만 원 · 사회적 책임 +40');
      expect([...seen.cards]).toContain('vn-story:s3');
      expect([...seen.cards]).toContain('report-mine:s2');
      expect([...seen.cards]).toContain('fixed-all:s2');
      expect([...seen.cards]).toContain('report-other:s1');
      expect(seen.cards.has('L4-E4'), '관세사 카드').toBe(true);
      expect(seen.cards.has('tv-vn-bars'), 'TV 공장 결정 막대').toBe(true);
      expect(seen.helpers.get('s1:voteResult1970') ?? '').toContain('관세를 매겨요');
      expect(seen.helpers.get('s2:factoryDecision') ?? '').toContain('낮은 임금');
      expect([...scenes]).toContain('steel');
      // 마무리: 컨테이너 OX·잡지 표지 없음, 되돌아보기 2문항
      if (part === 'front') {
        expect(wrapIds.filter((x) => x !== 'settle')).toEqual(['awards', 'reflect', 'afterWorksheet']);
        if (reflectQs !== null) expect(reflectQs).toBe('2');
      }
    } else {
      expect([...steelSteps]).toEqual([]);
      expect(allLines).not.toMatch(/철강|공장 결정|근로 환경|관세사/);
      expect(seen.cards.has('L4-E4')).toBe(false);
      expect(wrapIds.filter((x) => x !== 'settle')).toEqual(['containers', 'awards', 'reflect', 'magazine', 'afterWorksheet']);
    }
    if (part === 'all') {
      expect(wrapIds.filter((x) => x !== 'settle')).toEqual(['containers', 'awards', 'reflect', 'magazine', 'afterWorksheet']);
    }
    // (작업 174) 마무리 전체
    const cards = [...seen.cards];
    if (part === 'front') {
      expect(cards.some((c) => c.startsWith('containers-done'))).toBe(false);
      expect(cards).toContain('reflect-inputs:2');
      expect(scenes.has('gallery')).toBe(false);
    } else {
      for (const l of students.map((_, i) => `s${i + 1}`)) {
        expect(cards, `컨테이너 ${l}`).toContain(`containers-done:${l}`);
        expect(cards, `잡지 표지 ${l}`).toContain(`magazine-sent:${l}`);
      }
      expect(cards).toContain('containers-score:s1:컨테이너 8개 중 8개 맞혔어요. 옳은 문장은 4개예요.');
      expect(cards).toContain('containers-score:s3:컨테이너 8개 중 5개 맞혔어요. 옳은 문장은 4개예요.');
      // TV 문장별 정답률(3명): 맞힌 회사 수 ÷ 다 실은 회사 수
      expect(cards).toContain(`tv-containers-pct:${expectedContainerPct(students.map((_, i) => `s${i + 1}`))}`);
      expect(seen.helpers.get('s1:containerResult') ?? '').toContain('컨테이너 OX 8개 중 8개 맞혔어요');
      expect(cards).toContain('reflect-inputs:3');
      expect(cards).toContain('magazine-paper:s1');
      expect(cards).toContain('tv-gallery');
      expect(scenes.has('containers') && scenes.has('reflect') && scenes.has('gallery'), [...scenes].join(',')).toBe(true);
    }
    for (const l of students.map((_, i) => `s${i + 1}`)) expect(cards, `되돌아보기 ${l}`).toContain(`reflect-sent:${l}`);
    expect(cards).toContain('reflect-copy');
    // (작업 178) '마지막 항해예요' 강조 줄: 앞 시간 판에는 없고, 뒤 시간·두 시간 모두 판에는 있다(TV 안내 장면도 같은 규칙)
    expect(cards).toContain(`half-cargo:${part !== 'front'}`);
    expect(cards).not.toContain(`half-cargo:${part === 'front'}`);
    // 시상 차례: 안내 → 한 장씩 → 전체 목록, 도약상은 무역왕상 바로 앞(뒤 시간 15분은 거래가 없어 받을 회사가 있는 상이 없을 수 있다 — 상이 있을 때만)
    const anyAward = cards.some((c) => c.startsWith('tv-award:'));
    if (part !== 'back' || anyAward) {
      const one = cards.filter((c) => c.startsWith('tv-award:one:')).sort((a, b) => Number(a.split(':')[2]) - Number(b.split(':')[2])).map((c) => c.split(':')[3]);
      expect(cards.some((c) => c.startsWith('tv-award:intro:'))).toBe(true);
      expect(one.length).toBeGreaterThan(0);
      test.info().annotations.push({ type: '시상 차례', description: one.join(' → ') });
      if (one.includes('leap') && one.includes('finalAsset')) expect(one.indexOf('leap')).toBe(one.indexOf('finalAsset') - 1);
      // (작업 178) 상별 1명이라 상이 여러 개 — TV에 나온 차례가 발표 순서(AWARD_ORDER) 그대로, 무역왕상이 맨 끝(도약상 → 무역왕상 차례는 거래 없는 이 판에서 도약상이 안 생겨 e2e/screen.spec.ts 시상식 차례 시험이 실제 판 상태로 확인)
      if (part !== 'back') {
        expect(one.length, one.join(' → ')).toBeGreaterThan(1);
        expect(one).toEqual(AWARD_ORDER.filter((id) => one.includes(id)));
        expect(one.at(-1)).toBe('finalAsset');
      }
      expect(cards).toContain('tv-award-list');
      expect(cards.some((c) => c.startsWith('cheer:')), '내 상 축하 카드').toBe(true);
    }
    // 4차시 두 시간 모두는 공장 결정으로 사회적 책임 값이 달라 결산 요약에 보인다
    if (part === 'all') expect(cards.find((c) => c.startsWith('metrics:')) ?? '').toContain('csr');
    expect(roundsDone.size).toBeGreaterThanOrEqual(2);
    await ctx.close();
  });
}
