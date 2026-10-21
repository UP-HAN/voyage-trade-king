import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * 작업 145 — 판 끝내기 알림을 못 받은 학생 기기가 옛 방 코드로 자동 재입장하며 갇히면 [새 방 코드로 들어가기].
 * `?sync=local` + 테스트용 호스트 탭(tests/student/host-harness.ts). 하네스 묶기는 e2e/student-shell.spec.ts와 같다.
 * 1) 방 A 입장 → 학생 탭이 떠남(알림 못 받음) → 교사가 방 A 끝내기 → 방 B 열기 → 학생 탭 복귀 → 대기 화면 10초 뒤 버튼
 *    → 확인 창([계속 기다리기]에 포커스) → 입장 화면(코드 비움·번호/이름 채움) → 방 B → 새로 고침해도 방 B
 * 2) 게임 중 교사 화면만 꺼짐 → 기다림 띠 60초 뒤 [새 방 코드로] → 같은 코드 → 원래 회사
 * SHOT_DIR 환경 변수가 있으면 스크린숏을 남긴다.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHOT_DIR = process.env.SHOT_DIR;

let harnessJs: string | null = null;

async function buildHarness(): Promise<string> {
  if (harnessJs) return harnessJs;
  const { build } = await import('vite');
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string };
  const res = await build({
    configFile: false,
    root: ROOT,
    logLevel: 'error',
    resolve: { alias: { '@shared': join(ROOT, 'shared') } },
    define: { __APP_VERSION__: JSON.stringify(pkg.version), __BUILD_TIME__: JSON.stringify('') },
    build: {
      write: false,
      minify: false,
      emptyOutDir: false,
      lib: { entry: join(ROOT, 'tests', 'student', 'host-harness.ts'), formats: ['es'], fileName: 'harness' },
    },
  });
  const outputs = (Array.isArray(res) ? res : [res]) as { output: { type: string; isEntry?: boolean; code?: string }[] }[];
  const entry = outputs.flatMap((o) => o.output).find((c) => c.type === 'chunk' && c.isEntry);
  if (!entry?.code) throw new Error('하네스를 묶지 못했어요');
  harnessJs = entry.code;
  return harnessJs;
}

async function installHarness(ctx: BrowserContext) {
  const js = await buildHarness();
  await ctx.route('**/__harness.html*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><meta charset="utf-8"><title>host harness</title><pre id="out">…</pre><script type="module" src="./__harness.js"></script>',
    }),
  );
  await ctx.route('**/__harness.js', (route) => route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: js }));
}

async function shot(page: Page, name: string) {
  if (!SHOT_DIR) return;
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: join(SHOT_DIR, name) });
}

async function openServer(ctx: BrowserContext): Promise<Page> {
  const p = await ctx.newPage();
  await p.goto('./__harness.html?role=server');
  await p.waitForFunction(() => window.__ready === true);
  return p;
}

async function openHost(ctx: BrowserContext, resume = false): Promise<{ page: Page; code: string }> {
  const p = await ctx.newPage();
  await p.goto(`./__harness.html?role=host${resume ? '&resume=1' : ''}`);
  await p.waitForFunction(() => window.__ready === true && !!window.__host?.code());
  const code = (await p.evaluate(() => window.__host!.code())) as string;
  return { page: p, code };
}

const STUDENT_URL = './?sync=local&as=s01#/play';

async function enter(p: Page, code: string, seat: number, name: string) {
  await expect(p.getByTestId('student-entry')).toBeVisible();
  await p.getByTestId('entry-code').fill(code);
  await p.getByTestId('entry-seat').selectOption(String(seat));
  await p.getByTestId('entry-name').fill(name);
  await p.getByTestId('entry-submit').click();
}

const peerRecord = (p: Page) =>
  p.evaluate(() => JSON.parse(sessionStorage.getItem('voyage.peer') ?? 'null') as { code: string | null } | null);

test.describe.configure({ mode: 'serial' });

test('옛 방 코드로 갇힘 → [새 방 코드로 들어가기] → 새 방 → 게임 띠 버튼으로 같은 방·원래 회사', async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ baseURL, viewport: { width: 1366, height: 768 } });
  await installHarness(ctx);
  await openServer(ctx);
  const { page: hostA, code: codeA } = await openHost(ctx);

  // ── 1. 방 A 입장·회사 설립 ──
  const s1 = await ctx.newPage();
  s1.on('pageerror', (e) => {
    throw e;
  });
  await s1.goto(STUDENT_URL);
  await enter(s1, codeA, 5, '별빛상회');
  await expect(s1.getByTestId('found-company')).toBeVisible();
  await s1.getByTestId('found-submit').click();
  await expect(s1.getByTestId('prep-wait')).toBeVisible();
  expect((await peerRecord(s1))?.code).toBe(codeA);

  // ── 2. 학생 탭이 떠남(알림 못 받음 흉내 — 같은 탭이라 sessionStorage는 남음) → 판 끝내기 → 방 B ──
  await s1.goto('about:blank');
  await hostA.evaluate(() => window.__host!.close());
  await hostA.close();
  const { page: hostB, code: codeB } = await openHost(ctx);
  expect(codeB).not.toBe(codeA);

  // ── 3. 학생 탭 복귀 → 대기 화면, 10초 전에는 버튼 없음 → 뒤에 버튼 ──
  await s1.goto(STUDENT_URL);
  await expect(s1.getByTestId('student-booting')).toBeVisible();
  await expect(s1.getByTestId('student-booting')).toContainText('별빛상회 회사로 돌아가는 중이에요');
  await s1.waitForTimeout(4000);
  await expect(s1.getByTestId('student-booting')).toBeVisible();
  await expect(s1.getByTestId('rejoin-escape')).toHaveCount(0);
  await expect(s1.getByTestId('rejoin-escape')).toBeVisible({ timeout: 15_000 });
  await expect(s1.getByTestId('student-booting')).toContainText('선생님이 새 방을 열었나요?');
  await expect(s1.getByTestId('rejoin-escape')).toHaveText('새 방 코드로 들어가기');
  await shot(s1, 'shot-1-booting-escape.png');

  // 확인 창: [계속 기다리기]에 포커스 → 누르면 대기 화면 그대로
  await s1.getByTestId('rejoin-escape').click();
  const dlg = s1.getByTestId('rejoin-escape-confirm');
  await expect(dlg).toBeVisible();
  await expect(dlg).toContainText('새 방 코드로 들어갈까요?');
  await expect(dlg).toContainText('같은 방 코드를 다시 넣으면 원래 회사로 돌아가요.');
  await expect(dlg.getByTestId('confirm-cancel')).toHaveText('계속 기다리기');
  await expect(dlg.getByTestId('confirm-cancel')).toBeFocused();
  await expect(dlg.getByTestId('confirm-ok')).toHaveText('새 코드 넣기');
  await shot(s1, 'shot-2-confirm.png');
  await dlg.getByTestId('confirm-cancel').click();
  await expect(dlg).toHaveCount(0);
  await expect(s1.getByTestId('student-booting')).toBeVisible();

  // ── 4. [새 코드 넣기] → 입장 화면(코드 비움, 번호·이름 채움) → 방 B ──
  await s1.getByTestId('rejoin-escape').click();
  await s1.getByTestId('rejoin-escape-confirm').getByTestId('confirm-ok').click();
  await expect(s1.getByTestId('student-entry')).toBeVisible();
  await expect(s1.getByTestId('entry-new-code')).toHaveText('선생님 화면의 새 방 코드를 넣어요. 출석번호와 회사 이름은 그대로 두면 돼요.');
  await expect(s1.getByTestId('entry-code')).toHaveValue('');
  await expect(s1.getByTestId('entry-seat')).toHaveValue('5');
  await expect(s1.getByTestId('entry-name')).toHaveValue('별빛상회');
  await expect(s1.getByTestId('entry-error')).toHaveCount(0);
  expect(await peerRecord(s1)).toBeNull();
  expect(new URL(s1.url()).hash).toBe('#/play');
  await shot(s1, 'shot-3-entry-new-code.png');
  // 늦게 온 옛 결과가 오류를 띄우지 않음
  await s1.waitForTimeout(3000);
  await expect(s1.getByTestId('entry-error')).toHaveCount(0);
  await expect(s1.getByTestId('student-entry')).toBeVisible();

  await s1.getByTestId('entry-code').fill(codeB);
  await s1.getByTestId('entry-submit').click();
  await expect(s1.getByTestId('found-company')).toBeVisible();
  await s1.getByTestId('found-submit').click();
  await expect(s1.getByTestId('prep-wait')).toBeVisible();
  await expect(s1.getByTestId('entry-new-code')).toHaveCount(0);
  expect((await peerRecord(s1))?.code).toBe(codeB);

  // ── 5. 새로 고침 → 방 A가 아니라 방 B로 자동 재입장 ──
  await s1.reload();
  await expect(s1.getByTestId('prep-wait')).toBeVisible({ timeout: 15_000 });
  expect((await peerRecord(s1))?.code).toBe(codeB);

  // ── 6. 게임 중 교사 화면만 꺼짐 → 띠 60초 뒤 [새 방 코드로] → 같은 코드 → 원래 회사 ──
  await hostB.evaluate(() => window.__host!.flush());
  await hostB.close();
  await expect(s1.getByTestId('band-hostWait')).toBeVisible({ timeout: 25_000 });
  await expect(s1.getByTestId('band-rejoin-escape')).toHaveCount(0);
  await expect(s1.getByTestId('band-rejoin-escape')).toBeVisible({ timeout: 60_000 });
  await expect(s1.getByTestId('band-rejoin-escape')).toHaveText('새 방 코드로');
  await s1.getByTestId('band-rejoin-escape').click();
  const dlg2 = s1.getByTestId('rejoin-escape-confirm');
  await expect(dlg2).toBeVisible();
  await expect(dlg2.getByTestId('confirm-cancel')).toBeFocused();
  await dlg2.getByTestId('confirm-cancel').click();
  await expect(s1.getByTestId('prep-wait')).toBeVisible();
  await s1.getByTestId('band-rejoin-escape').click();
  await s1.getByTestId('rejoin-escape-confirm').getByTestId('confirm-ok').click();
  await expect(s1.getByTestId('entry-new-code')).toBeVisible();
  await expect(s1.getByTestId('entry-code')).toHaveValue('');
  await expect(s1.getByTestId('entry-seat')).toHaveValue('5');
  await expect(s1.getByTestId('entry-name')).toHaveValue('별빛상회');
  await s1.getByTestId('entry-code').fill(codeB);
  await s1.getByTestId('entry-submit').click();
  const { page: hostB2 } = await openHost(ctx, true);
  await expect(s1.getByTestId('prep-wait')).toBeVisible({ timeout: 20_000 }); // 원래 회사(설립 화면이 다시 나오지 않음)
  await expect(s1.getByTestId('found-company')).toHaveCount(0);
  const seats = (await hostB2.evaluate(() => (window.__host!.view() as { seats: { seat: number }[] }).seats.map((s) => s.seat))) as number[];
  expect(seats).toEqual([5]);
  await ctx.close();
});
