import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { OLD_TEACHER_TERMS } from '../src/teacher/teacher-terms';
import { openTvMenu } from './support/voyage-ui';

/**
 * 작업 172 — 3차시 판(차시 한 판 L3) 끝에서 끝까지(`?sync=local` + 빌드본 미리보기 + Playwright 가짜 시계 — lesson2-full.spec.ts와 같은 기반).
 * `LESSON_READY.L3`는 verifier PASS 전까지 false — 이 시험은 개발 열쇠(localStorage `voyage.dev.fullUnit`)로 3차시를 연다.
 * 교사는 '지금 할 일' 카드의 큰 버튼만 누른다. 학생 3명(1번 반도체 팀, 2번 배터리 팀, 3번 정밀 화학 원료 팀):
 *  - 앞 시간·두 시간 모두: 광물 협력 기사(밑줄 → 결정), 부산 [조립장]에 부품 넣기. 25분 앞 시간은 부품 6종을 모두 모아 '스마트폰 완성!'.
 *  - 뒤 시간·두 시간 모두: AI 기술 연구비(비공개), 자동화 항만 투표(투표 공통 카드), 경제 게이지, 경쟁 세 가지 카드(카드만).
 * 매 단계 TV·학생 innerText에 개발 표기 /\bL[1-4]\b/ 0건, 학생 화면에 '선택' 낱말 0건, 페이지 오류 0.
 * 실행: tests/e2e-preview.playwright.config.ts(LESSON3_E2E=1). 스크린숏은 .orch/tasks/172-lesson3-interdependence/shots/.
 */
const RUN = process.env.LESSON3_E2E === '1';
const SHOTS = process.env.SHOT_DIR ?? join(process.cwd(), '.orch', 'tasks', '172-lesson3-interdependence', 'shots');

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
  front: '3차시 앞 시간: 서로 기대는 무역 (교과서 106쪽)',
  back: '3차시 뒤 시간: 서로 겨루는 무역 (교과서 107쪽)',
  all: '3차시 두 시간 모두 (교과서 106~107쪽)',
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
    // (작업 172) verifier PASS 전에는 개발 열쇠로만 3차시를 연다
    localStorage.setItem('voyage.dev.fullUnit', '1');
  });
  await t.reload();
  await expect(t.getByTestId('teacher-start')).toBeVisible();
  await t.getByTestId('btn-new').click();
  await t.getByTestId('unit-lesson').click();
  await expect(t.getByTestId('lesson-L3')).toBeEnabled();
  await t.getByTestId('lesson-L3').click();
  // 어느 시간 내용을 할까요? — 기본 '앞 시간'
  await expect(t.getByTestId('lesson-part-front')).toHaveAttribute('aria-pressed', 'true');
  await expect(t.getByTestId('lesson-part-pick')).toContainText('교과서 106쪽');
  await expect(t.getByTestId('lesson-part-pick')).toContainText('교과서 107쪽');
  if (part !== 'front') await t.getByTestId(`lesson-part-${part}`).click();
  await expect(t.getByTestId('preview-part')).toHaveText(PART_TEXT[part]);
  const custom = t.getByTestId('trade-minutes-custom');
  await custom.fill(String(minutes));
  await custom.blur();
  await expect(custom).toHaveValue(String(minutes));
  const order = (await t.getByTestId('preview-order').innerText()).trim();
  if (part === 'front') {
    await expect(t.getByTestId('preview-ws-order')).toHaveText('학습지: 활동마다 바로 ⑨ → ⑩');
    expect(order).not.toMatch(/기술 경쟁|자동화 항만|경쟁 세 가지|경제 게이지/);
  }
  if (part === 'back') {
    await expect(t.getByTestId('preview-ws-order')).toHaveText('학습지: 활동마다 바로 ⑪ → ⑫');
    expect(order).not.toMatch(/광물 협력|스마트폰/);
  }
  if (part === 'all') await expect(t.getByTestId('preview-ws-order')).toHaveText('학습지: 활동마다 바로 ⑨ → ⑩ → ⑪ → ⑫');
  // (검증 반영) 두 시간 모두: 스마트폰이 전체 형태가 되는 무역 시간 안내(25분이면 보임)
  if (part === 'all') await expect(t.getByTestId('lesson3-all-phone-hint')).toContainText("'우리 반 스마트폰'이 전체 형태로");
  else await expect(t.getByTestId('lesson3-all-phone-hint')).toHaveCount(0);
  await shot(t, `L3-${part}-${minutes}-01-setup.png`);
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

interface Seen {
  worksheets: Set<string>;
  cards: Set<string>;
  shots: Set<string>;
  quiz: Set<string>;
  decided: Set<string>;
  helpers: Map<string, string>;
}

/** 학생 화면 정리: 학습지 다 썼어요·카드 확인·임무 패널·기사 → 결정·연구비·투표·결과 닫기 */
async function tidy(s: Page, seen: Seen, label: string, choose: { coop: 'join' | 'none'; invest: string; vote: 'yes' | 'no' }) {
  for (let k = 0; k < 8; k++) {
    let did = false;
    if (await visible(s, 'worksheet-popup')) {
      const ids = await s.locator('[data-testid="worksheet-row"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-id') ?? ''));
      ids.forEach((id) => seen.worksheets.add(id));
      const helpers = await s.locator('[data-testid="worksheet-helper"]').evaluateAll((els) => els.map((e) => [e.getAttribute('data-helper') ?? '', (e as HTMLElement).innerText.trim()] as const));
      for (const [h, txt] of helpers) if (label === 's1' && !seen.helpers.has(h)) seen.helpers.set(h, txt);
      if (label === 's1' && ids[0] && !seen.shots.has(`ws-${ids[0]}`)) {
        seen.shots.add(`ws-${ids[0]}`);
        await shot(s, `L3-student-worksheet-${ids[0]}.png`);
      }
      const done = s.getByTestId('worksheet-done');
      if ((await done.isVisible().catch(() => false)) && (await done.isEnabled().catch(() => false))) {
        await done.click();
        did = true;
      }
    }
    // 광물 협력 기사(전체 형태): 밑줄 하나 긋고 → 고르러 가기
    if (await visible(s, 'article-done')) {
      seen.cards.add('article');
      await s.getByTestId('article-sentence').nth(1).click();
      if (label === 's1' && !seen.shots.has('article')) {
        seen.shots.add('article');
        await s.getByTestId('article-show').click();
        await shot(s, 'L3-student-article.png');
      }
      await s.getByTestId('article-done').click();
      did = true;
    }
    // 결정 카드(광물 협력·연구비)
    const card = s.locator('[data-testid="decision-card"]:has([data-testid="decision-submit"])');
    if (await card.count()) {
      const id = (await card.first().getAttribute('data-event')) ?? '';
      const pick = id === 'L3-E1' ? choose.coop : id === 'L3-E3' ? choose.invest : null;
      if (pick && !seen.decided.has(`${label}:${id}`)) {
        await s.getByTestId(`decision-opt-${pick}`).first().click();
        if (label === 's1' && !seen.shots.has(`decide-${id}`)) {
          seen.shots.add(`decide-${id}`);
          await shot(s, `L3-student-decision-${id}.png`);
        }
        await s.getByTestId('decision-submit').first().click();
        seen.decided.add(`${label}:${id}`);
        did = true;
      }
    }
    // 투표 공통 카드
    if (await visible(s, `vote-${choose.vote}`)) {
      await s.getByTestId(`vote-${choose.vote}`).click();
      seen.decided.add(`${label}:vote`);
      did = true;
      if (label === 's1' && !seen.shots.has('vote')) {
        seen.shots.add('vote');
        await expect(s.getByTestId('vote-done')).toBeVisible();
        await shot(s, 'L3-student-vote.png');
      }
    }
    if (await visible(s, 'tech-result')) seen.cards.add(`tech:${label}:${await s.getByTestId('tech-result').getAttribute('data-won')}`);
    if (await visible(s, 'phone-result')) {
      seen.cards.add('phone-result');
      if (label === 's1' && !seen.shots.has('phone-result')) {
        seen.shots.add('phone-result');
        await shot(s, 'L3-student-phone-result.png');
      }
    }
    if (await visible(s, 'mission-panel')) {
      seen.cards.add('missions');
      if (await visible(s, 'phone-team-line')) seen.cards.add(`team:${label}:${await s.getByTestId('phone-team-line').getAttribute('data-team')}`);
      if (label === 's1' && !seen.shots.has('missions')) {
        seen.shots.add('missions');
        await shot(s, 'L3-student-mission-panel.png');
      }
    }
    const cardIds = await s.locator('[data-testid="event-card"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-event') ?? ''));
    cardIds.forEach((id) => seen.cards.add(id));
    for (const id of ['mission-panel-ok', 'card-confirm', 'port-card-ok', 'concept-ok', 'factory-cycle-ok', 'catchup-ok', 'catchup-next', 'event-result-close', 'event-panel-close']) {
      if (await visible(s, id)) {
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
  await s.getByTestId('pick-sail').click();
  await expect(s.locator(`[data-testid="port-screen"][data-port="${port}"]`)).toBeVisible();
  if (await visible(s, 'port-card-ok')) await s.getByTestId('port-card-ok').click();
}

async function trade(ctx: BrowserContext, t: Page, s: Page, kind: 'buy' | 'sell' | 'make' | 'put', good: string, n: number) {
  for (let i = 1; i < n; i++) await s.getByTestId(`${kind}-${good}-plus`).click();
  await expect(s.getByTestId(`${kind}-${good}-qty`)).toContainText(String(n));
  await s.getByTestId(`${kind}-${good}`).click();
  await tick(ctx, t, 600);
}

/** 부산 조립장에 넣기 */
async function put(ctx: BrowserContext, t: Page, s: Page, good: string, n: number) {
  await enterPort(s);
  await s.getByTestId('tab-assembly').click();
  await expect(s.getByTestId('assembly')).toBeVisible();
  await trade(ctx, t, s, 'put', good, n);
}

for (const [minutes, part] of [[25, 'front'], [25, 'back'], [25, 'all'], [15, 'front']] as const) {
  test(`3차시 ${minutes}분 ${part === 'front' ? '앞 시간' : part === 'back' ? '뒤 시간' : '두 시간 모두'} — 카드 큰 버튼만으로 끝까지`, async ({ browser, baseURL }) => {
    test.skip(!RUN, 'tests/e2e-preview.playwright.config.ts로 실행');
    test.setTimeout(900_000);
    const front = part !== 'back';
    const back = part !== 'front';
    const P = `L3-${part}-${minutes}`;
    const { ctx, t, code, errors } = await setup(browser, baseURL, minutes, part);
    await openTvMenu(t);
    const [scr] = await Promise.all([ctx.waitForEvent('page'), t.getByTestId('btn-open-screen').click()]);
    scr.on('pageerror', (e) => errors.push(`tv: ${e.message}`));
    await scr.setViewportSize({ width: 1920, height: 1080 });
    await expect(scr.getByTestId('route-screen')).toBeVisible();
    const s1 = await joinStudent(ctx, `c${minutes}${part}1`, code, 1, '해오름무역', errors);
    const s2 = await joinStudent(ctx, `c${minutes}${part}2`, code, 2, '바다상회', errors);
    const s3 = await joinStudent(ctx, `c${minutes}${part}3`, code, 3, '고래해운', errors);
    const students = [s1, s2, s3];
    const choices = [
      { coop: 'join' as const, invest: '300', vote: 'yes' as const },
      { coop: 'none' as const, invest: '100', vote: 'yes' as const },
      { coop: 'join' as const, invest: '0', vote: 'no' as const },
    ];
    await t.bringToFront();
    await expect(t.getByTestId('now-card')).toHaveAttribute('data-state', 'ready');

    const seen: Seen = { worksheets: new Set(), cards: new Set(), shots: new Set(), quiz: new Set(), decided: new Set(), helpers: new Map() };
    const roundsDone = new Set<number>();
    const log: string[] = [];
    const scenes = new Set<string>();
    const lines = new Set<string>();
    const fullPhone = part === 'front' && minutes === 25;
    for (let step = 0; step < 160; step++) {
      const st = (await stateOf(t)) ?? '';
      if (st === 'ended') break;
      for (const [i, s] of students.entries()) await tidy(s, seen, `s${i + 1}`, choices[i]!);
      const scene = (await scr.getByTestId('route-screen').getAttribute('data-scene')) ?? '';
      scenes.add(scene);
      if (step % 4 === 0) await checkTerms(t, `단계 ${step} ${st}`);
      for (const [label, pg] of [['TV', scr], ['s1', s1], ['s2', s2], ['s3', s3]] as const) {
        const txt = await pg.evaluate(() => document.body.innerText);
        const m = txt.match(/\bL[1-4]\b/);
        expect(m ? `${label} 단계 ${step} ${st}: …${txt.slice(Math.max(0, (m.index ?? 0) - 30), (m.index ?? 0) + 30)}…` : null).toBeNull();
        if (label !== 'TV') {
          const sel = txt.match(/선택/);
          expect(sel ? `${label} 단계 ${step}: …${txt.slice(Math.max(0, (sel.index ?? 0) - 30), (sel.index ?? 0) + 30)}…` : null).toBeNull();
        }
      }
      const line = (await t.locator('.t-now__line').innerText().catch(() => '')).trim();
      lines.add(line);
      // TV 장면 스크린숏
      for (const sc of ['cover', 'event', 'bars', 'phone', 'worksheet']) {
        if (scene === sc && !seen.shots.has(`tv-${sc}-${line}`) && ![...seen.shots].some((x) => x.startsWith(`tv-${sc}-`) && sc !== 'event')) {
          seen.shots.add(`tv-${sc}-${line}`);
          await shot(scr, `${P}-tv-${sc}-${seen.shots.size}.png`);
          if (sc === 'phone') await shot(t, `${P}-teacher-phone-result.png`);
        }
      }
      if (st === 'respond' && !seen.shots.has(`t-${line}`)) {
        seen.shots.add(`t-${line}`);
        await shot(t, `${P}-teacher-${seen.shots.size}.png`);
      }

      if (st === 'round') {
        const r = Number(((await t.getByTestId('round-info').innerText()).match(/라운드 (\d+)/) ?? [])[1]);
        if (!roundsDone.has(r)) {
          roundsDone.add(r);
          await run(ctx, t, 1);
          for (const [i, s] of students.entries()) await tidy(s, seen, `s${i + 1}`, choices[i]!);
          if (front && r === 1) {
            // 부품 팀 칩: 1번 반도체 팀
            if (await s1.getByTestId('port-screen').count()) await s1.getByTestId('port-back').click();
            await expect(s1.getByTestId('phone-chip')).toContainText('스마트폰 부품 · 반도체');
            await shot(s1, `${P}-student-phone-chip.png`);
            // s1: 부산 반도체 사서 조립장에
            await enterPort(s1);
            await trade(ctx, t, s1, 'buy', 'chip', 2);
            await s1.getByTestId('tab-assembly').click();
            // 필요 수량: 팀 인원 × 2(라운드 2개뿐이거나 짧은 형태면 절반)
            const need = Number(await s1.locator('[data-testid="part-chip"]').getAttribute('data-need'));
            expect(need).toBe(fullPhone ? 2 : 1);
            await put(ctx, t, s1, 'chip', need);
            await expect(s1.locator('[data-testid="part-chip"]')).toHaveAttribute('data-have', String(need));
            await shot(s1, `${P}-student-assembly.png`);
            await s1.getByTestId('port-back').click();
            await expect(s1.getByTestId('phone-chip')).toContainText(`반도체 ${need}/${need}`);
            if (fullPhone) {
              // s1: 상하이 흑연·자카르타 니켈(배터리 재료까지), s3: 요코하마 정밀 화학 원료, s2: 로스앤젤레스 프로그램 계약
              await sailTo(s1, 'SHA');
              await trade(ctx, t, s1, 'buy', 'graphite', 4);
              await sailTo(s1, 'JKT');
              await tidy(s1, seen, 's1', choices[0]!);
              await enterPort(s1);
              await trade(ctx, t, s1, 'buy', 'nickel', 4);
              await sailTo(s1, 'YOK');
              await enterPort(s1);
              await trade(ctx, t, s1, 'buy', 'chem', 2);
              await sailTo(s2, 'LAX');
              await enterPort(s2);
              await trade(ctx, t, s2, 'buy', 'program', 2);
              await sailTo(s3, 'ROT');
              await enterPort(s3);
              await trade(ctx, t, s3, 'buy', 'chem', 2);
            }
          } else if (front && fullPhone && r === 2) {
            // 부산에서 넣기: s1 흑연·니켈 → 배터리 만들기 → 넣기, s2 프로그램, s3 정밀 화학 원료 → 스마트폰 완성
            await sailTo(s1, 'BUS');
            await put(ctx, t, s1, 'graphite', 2);
            await trade(ctx, t, s1, 'put', 'nickel', 2);
            await s1.getByTestId('tab-factory').click();
            // (검증 반영) 배터리는 필요 수량 절반(3명 판 = 1)
            await trade(ctx, t, s1, 'make', 'battery', 1);
            if (await visible(s1, 'factory-cycle-ok')) await s1.getByTestId('factory-cycle-ok').click();
            await put(ctx, t, s1, 'battery', 1);
            await sailTo(s2, 'BUS');
            await put(ctx, t, s2, 'program', 2);
            await sailTo(s3, 'BUS');
            await put(ctx, t, s3, 'chem', 2);
            await tick(ctx, t, 800);
            await expect(s3.getByTestId('assembly-complete')).toBeVisible();
            await shot(s3, `${P}-student-phone-complete.png`);
            await expect(scr.getByTestId('phone-band')).toContainText('스마트폰 완성!');
            await shot(scr, `${P}-tv-round-phone-band.png`);
          } else if (back && r >= 2 && !seen.shots.has('aichip')) {
            // 기술 경쟁 뒤: 연구비 300만 원(1번)은 부산 [공장]에 AI 반도체 레시피
            const won = await s1.evaluate(() => document.body.innerText.includes('AI 반도체'));
            void won;
            await enterPort(s1);
            if (await s1.getByTestId('tab-factory').count()) {
              await s1.getByTestId('tab-factory').click();
              if (await s1.getByTestId('recipe-aichip').count()) {
                seen.shots.add('aichip');
                await shot(s1, `${P}-student-aichip-recipe.png`);
              }
            }
            await s1.getByTestId('port-back').click();
          }
          await t.bringToFront();
        }
      }
      const res = await pressBig(t);
      log.push(`${res.state}:${res.label}`);
      await run(ctx, t, 1);
    }
    await expect(t.getByTestId('now-card')).toHaveAttribute('data-state', 'ended');
    test.info().annotations.push({ type: '누른 순서', description: log.join(' → ') });
    expect(errors, '페이지 오류').toEqual([]);
    // 학습지: 그 시간 번호만
    const wantWs = part === 'front' ? ['W09', 'W10'] : part === 'back' ? ['W11', 'W12'] : ['W09', 'W10', 'W11', 'W12'];
    expect([...seen.worksheets], `학습지 — ${log.join(' / ')}`).toEqual(wantWs);
    // 확인 퀴즈 문항 없음
    expect(await s1.locator('[data-testid="quiz-card"]').count()).toBe(0);
    const allLines = [...lines].join(' / ');
    if (front) {
      expect(seen.cards.has('missions'), '3차시 임무 패널').toBe(true);
      expect([...seen.cards]).toContain('team:s1:chip');
      expect([...scenes]).toContain('phone');
      // 두 시간 모두 짧은 판은 광물 협력이 라운드 중 패널(짧게) — 라운드 카드가 이긴다
      if (part === 'front') expect(allLines).toContain('광물 협력 기사를 읽고 있어요');
      else expect(allLines).toContain('광물 협력');
      if (fullPhone) expect(seen.cards.has('phone-result')).toBe(true);
      expect(seen.helpers.get('mineralCoopChoice') ?? '').toContain('광물 협력: 참여했어요');
    } else {
      expect([...seen.cards].some((c) => c.startsWith('team:'))).toBe(false);
      expect(allLines).not.toMatch(/광물 협력|스마트폰/);
    }
    if (back) {
      expect(allLines).toContain('자동화 항만 투표');
      expect([...scenes]).toContain('bars');
      expect([...seen.cards].some((c) => c.startsWith('tech:s1:1'))).toBe(true);
      expect(seen.helpers.get('competitionRecord') ?? '').toContain('기술 연구비: 300만 원');
    } else {
      expect(allLines).not.toMatch(/기술 연구비|자동화 항만|경제 게이지/);
    }
    expect(roundsDone.size).toBeGreaterThanOrEqual(2);
    await ctx.close();
  });
}
