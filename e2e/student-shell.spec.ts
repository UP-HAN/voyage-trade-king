import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * 작업 107 학생 앱 틀: `?sync=local`로 테스트용 호스트 탭(tests/student/host-harness.ts — 교사 화면 109와 독립) + 학생 탭.
 * 입장(6자리) → 준비 단계 회사 설립 → 무역 시작 → 목적지·출항 준비 → 라운드 끝 → 도착 → 새로 고침 자동 재입장
 * → 호스트 탭 닫기 → "선생님 화면을 기다리고 있어요" → 호스트 복귀 후 대기한 행동 반영.
 * v0.3.1: 같은 이름 다시 입력(제안 버튼은 자동 제출 안 함), 다른 기기 같은 번호·같은 이름 → 허락 요청, 막힌 이름 다시 짓기,
 * 학생 화면에 다른 학생 출석번호·"사용 중인 방" 없음.
 *
 * 호스트 묶음: 미리보기 서버(dist)에는 하네스가 없으므로 Vite로 한 파일로 묶어 page.route로 같은 주소에 끼워 넣는다.
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

async function openStudent(ctx: BrowserContext, as: string): Promise<Page> {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => {
    throw e;
  });
  await p.goto(`./?sync=local&as=${as}#/play`);
  await expect(p.getByTestId('route-student')).toBeVisible();
  return p;
}

async function enter(p: Page, code: string, seat: number, name: string) {
  await expect(p.getByTestId('student-entry')).toBeVisible();
  await p.getByTestId('entry-code').fill(code);
  await p.getByTestId('entry-seat').selectOption(String(seat));
  await p.getByTestId('entry-name').fill(name);
  await p.getByTestId('entry-submit').click();
}

const teacher = (host: Page, action: Record<string, unknown>) => host.evaluate((a) => window.__host!.teacher(a as never), action);
const hostPlayer = (host: Page, seat: number) =>
  host.evaluate((s) => window.__host!.player(s), seat) as Promise<{ game: { money: number; port: string; dest: string | null; ready: boolean } } | null>;

async function noHorizontalScroll(p: Page) {
  const r = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(r.sw).toBeLessThanOrEqual(r.cw);
}

test.describe.configure({ mode: 'serial' });

test('학생 앱 틀: 입장 → 회사 설립 → 항해 → 재입장 → 호스트 대기 → 일시정지', async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext({ baseURL, viewport: { width: 1366, height: 768 } });
  await installHarness(ctx);
  const server = await openServer(ctx);
  // 서버 공지(입장 화면 맨 위 띠)
  await server.evaluate(() => window.__server!.setNotice({ level: 'info', text: '오늘 18시에 서버 점검이 있어요. 수업은 그 전에 마쳐 주세요.' }));
  let { page: host, code } = await openHost(ctx);
  expect(code).toMatch(/^\d{6}$/);

  // ── 입장 화면(S02): 실명 칸 없음, 안내 문구, 공지 띠 ──
  const s1 = await openStudent(ctx, 's01');
  await expect(s1.getByTestId('student-entry')).toBeVisible();
  await expect(s1.getByRole('heading', { name: '학생 화면' })).toBeVisible(); // e2e/smoke.spec.ts가 보는 제목과 호환
  await expect(s1.getByTestId('entry-guide')).toHaveText('실제 이름은 쓰지 않아요. 우리 회사 이름을 지어요.');
  await expect(s1.getByTestId('notice-banner')).toBeVisible();
  await expect(s1.locator('input')).toHaveCount(2); // 방 코드 + 회사 이름(실명 칸 없음)
  await s1.getByTestId('entry-name').fill('ㅋㅋ');
  await expect(s1.getByTestId('entry-name-hint')).toContainText('낱자');
  await expect(s1.getByTestId('entry-name-count')).toHaveText('2/10');
  await s1.getByTestId('entry-code').fill(code.slice(0, 3));
  await shot(s1, 'entry-notice-1366.png');

  await enter(s1, code, 1, '해오름무역');
  // 준비 단계: 회사 설립(S04) — 이름 입력 칸 없이 큰 이름
  await expect(s1.getByTestId('found-company')).toBeVisible();
  await expect(s1.getByTestId('found-company-name')).toHaveText('해오름무역');
  await s1.getByTestId('found-color-blue').click();
  await s1.getByTestId('found-emblem-compass').click();
  await s1.getByTestId('found-avatar-captain-2').click();
  await shot(s1, 'found-company-1366.png');
  await s1.getByTestId('found-submit').click();
  await expect(s1.getByTestId('prep-wait')).toBeVisible();
  await expect(s1.getByTestId('rule-cards').locator('li')).toHaveCount(4);
  await expect(s1.getByTestId('hud-money')).toContainText('500만 원');
  await expect(s1.getByTestId('hud-cargo')).toContainText('0/20');
  await expect(s1.getByTestId('hud-trade-left')).toContainText('무역');
  await shot(s1, 'prep-wait-1366.png');

  // ── 같은 회사 이름 → 다시 입력(제안 버튼은 칸만 채움) ──
  const s2 = await openStudent(ctx, 's02');
  await enter(s2, code, 2, '해오름 무역');
  await expect(s2.getByTestId('entry-error')).toHaveAttribute('data-code', 'NAME_TAKEN');
  await expect(s2.getByTestId('entry-error')).toContainText('이미 다른 회사가 쓰는 이름이에요');
  const sug = s2.getByTestId('entry-suggestion').first();
  const sugText = (await sug.textContent())!.trim();
  await sug.click();
  await expect(s2.getByTestId('entry-name')).toHaveValue(sugText);
  await s2.waitForTimeout(500);
  await expect(s2.getByTestId('student-entry')).toBeVisible(); // 자동 제출하지 않음
  await s2.getByTestId('entry-new-name').click();
  await expect(s2.getByTestId('entry-name')).toHaveValue('');
  await s2.getByTestId('entry-name').fill('별빛상회');
  await s2.getByTestId('entry-submit').click();
  await expect(s2.getByTestId('found-company')).toBeVisible();
  await s2.getByTestId('found-submit').click();
  await expect(s2.getByTestId('prep-wait')).toBeVisible();

  // ── 다른 기기 같은 번호 + 같은 이름 → 허락 요청 / 다른 이름 → SEAT_TAKEN ──
  const s3 = await openStudent(ctx, 's03');
  await enter(s3, code, 3, '바다상사');
  await expect(s3.getByTestId('found-company')).toBeVisible();
  await s3.getByTestId('found-submit').click();
  const s3c = await openStudent(ctx, 's03c');
  await enter(s3c, code, 3, '파도무역');
  await expect(s3c.getByTestId('entry-error')).toHaveAttribute('data-code', 'SEAT_TAKEN');
  await expect(s3c.getByTestId('entry-error')).not.toContainText('바다상사');
  await s3c.close();
  const s3b = await openStudent(ctx, 's03b');
  await enter(s3b, code, 3, '바다상사');
  await expect(s3b.getByTestId('entry-waiting-approval')).toBeVisible();
  await expect(s3b.getByTestId('entry-waiting-approval')).toContainText('다른 기기에서 쓰던 회사예요');
  await host.waitForFunction(() => (window.__host!.view() as { rejoinRequests: unknown[] }).rejoinRequests.length > 0);
  await host.evaluate(() => window.__host!.approveRejoin(3));
  await expect(s3b.getByTestId('student-game')).toBeVisible();
  await expect(s3.getByTestId('student-moved')).toBeVisible();
  await s3.close();

  // ── 무역 시작 → 라운드 → 목적지·출항 준비 ──
  await teacher(host, { type: 'startTrade' });
  await teacher(host, { type: 'startRound', durationSec: 180 });
  await expect(s1.getByTestId('world-map')).toBeVisible();
  await expect(s1.getByTestId('hud-time')).toContainText('라운드');

  // 무역 중 늦게 들어온 학생: 해도보다 회사 설립(S04)이 먼저, 설립 전에는 하단 행동 바 없음(수정 1회차)
  const s4 = await openStudent(ctx, 's04');
  await enter(s4, code, 4, '늦깎이상회');
  await expect(s4.getByTestId('found-company')).toBeVisible();
  await expect(s4.getByTestId('bottom-bar')).toHaveCount(0);
  await expect(s4.getByTestId('world-map')).toHaveCount(0);
  await s4.getByTestId('found-color-green').click();
  await s4.getByTestId('found-submit').click();
  await expect(s4.getByTestId('world-map')).toBeVisible();
  await expect(s4.getByTestId('bottom-bar')).toBeVisible();
  await expect
    .poll(async () => {
      const p = (await host.evaluate(() => window.__host!.player(4))) as { company: { founded: boolean; color: string }; game: { responses: Record<string, unknown> } } | null;
      return p ? `${p.company.founded}/${p.company.color}/${p.game.responses['L1-E3']}` : '';
    })
    .toBe('true/green/true');
  await s4.close();
  await s1.locator('.wm-port[data-port="SHA"] .wm-port-hit').click();
  await expect(s1.getByTestId('pick-panel')).toHaveAttribute('data-kind', 'ok');
  const body = (await s1.getByTestId('pick-body').textContent())!;
  const cost = Number(/운항비 (\d+)만 원/.exec(body)![1]);
  expect(cost).toBeGreaterThan(0);
  await s1.getByTestId('pick-confirm').click();
  await expect(s1.getByTestId('bottom-status')).toContainText(`목적지: 상하이(중국) · 운항비 ${cost}만 원`);
  // 빠르게 두 번 눌러도 출항 준비가 취소되지 않음(수정 1회차)
  await s1.getByTestId('set-ready').dblclick();
  await expect(s1.getByTestId('ready-note')).toHaveText('라운드가 끝나면 출발해요'); // 누르는 즉시(미리 계산)
  await s1.waitForTimeout(800);
  await expect(s1.getByTestId('ready-note')).toBeVisible();
  await expect.poll(async () => (await hostPlayer(host, 1))?.game.ready).toBe(true);
  await shot(s1, 'map-1366.png');
  await noHorizontalScroll(s1);

  // 1180×820에서도 가로 스크롤 없이 HUD·지도·하단 바
  await s1.setViewportSize({ width: 1180, height: 820 });
  await expect(s1.getByTestId('hud')).toBeVisible();
  await expect(s1.getByTestId('bottom-bar')).toBeVisible();
  await noHorizontalScroll(s1);
  const box = await s1.getByTestId('bottom-bar').boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(820);
  await shot(s1, 'map-1180.png');
  await s1.setViewportSize({ width: 1366, height: 768 });
  // 전체 보기(이름표 겹침 처리 확인용 스크린숏)
  await s1.getByRole('button', { name: '전체 보기' }).click();
  await s1.waitForTimeout(600);
  await shot(s1, 'map-full-1366.png');
  await s1.getByRole('button', { name: '내 배로' }).click();
  await s1.waitForTimeout(600);

  // 다른 학생 출석번호·"사용 중인 방"이 학생 화면에 없음
  const text1 = await s1.evaluate(() => document.body.innerText);
  expect(text1).not.toMatch(/[234]번/);
  expect(text1).not.toContain('사용 중인 방');

  // ── 라운드 끝(호스트가 항해 처리) → 도착 ──
  await teacher(host, { type: 'endRound' });
  await expect(s1.getByTestId('toast').filter({ hasText: '상하이(중국)에 도착했어요' })).toBeVisible();
  await expect(s1.getByTestId('hud-money')).toContainText(`${500 - cost}만 원`);
  const p1 = await hostPlayer(host, 1);
  expect(p1!.game.port).toBe('SHA');
  expect(p1!.game.money).toBe(500 - cost);
  await expect(s1.locator('.wm-port.is-here[data-port="SHA"]')).toHaveCount(1);
  await expect(s1.getByTestId('bottom-status')).toContainText('라운드가 열리면 거래할 수 있어요');

  // ── 새로 고침 → 같은 회사·같은 위치로 자동 재입장 ──
  await s1.reload();
  await expect(s1.getByTestId('toast').filter({ hasText: '해오름무역으로 돌아왔어요!' })).toBeVisible();
  await expect(s1.getByTestId('student-game')).toBeVisible();
  await expect(s1.getByTestId('hud-company')).toHaveText('해오름무역');
  await expect(s1.locator('.wm-port.is-here[data-port="SHA"]')).toHaveCount(1);

  // ── 호스트 탭 닫기 → 띠 → 행동 대기 → 호스트 복귀 후 반영 ──
  await teacher(host, { type: 'startRound', durationSec: 300 });
  await expect(s1.getByTestId('hud-time')).toContainText('라운드 2');
  // 교사 화면 저장은 1초 묶음 — 닫기 직전 상태까지 저장해 두고 닫는다(저장 전 1초 안의 일은 잃을 수 있음, 124 가정)
  await host.evaluate(() => window.__host!.flush());
  await host.close();
  await expect(s1.getByTestId('band-hostWait')).toBeVisible({ timeout: 25_000 });
  await expect(s1.getByTestId('band-hostWait')).toHaveText(/선생님 화면을 기다리고 있어요/);
  await s1.locator('.wm-port[data-port="YOK"] .wm-port-hit').click();
  await s1.getByTestId('pick-confirm').click();
  await s1.getByTestId('set-ready').click();
  await expect(s1.getByTestId('sending')).toBeVisible();
  await expect(s1.getByTestId('ready-note')).toBeVisible();
  await shot(s1, 'host-wait-1366.png');
  ({ page: host } = await openHost(ctx, true));
  await expect(s1.getByTestId('band-hostWait')).toHaveCount(0, { timeout: 15_000 });
  await expect(s1.getByTestId('sending')).toHaveCount(0);
  await expect
    .poll(async () => {
      const p = await hostPlayer(host, 1);
      return p ? `${p.game.dest}/${p.game.ready}` : '';
    })
    .toBe('YOK/true');

  // ── 막힌 이름 → 다시 짓기 창(조작 막힘) → ok 뒤 풀림 ──
  await host.evaluate(() => window.__host!.blockName(2));
  await expect(s2.getByTestId('name-blocked')).toBeVisible();
  await s2.getByTestId('name-blocked-form-input').fill('은하상단');
  await s2.getByTestId('name-blocked-form-submit').click();
  await expect(s2.getByTestId('name-blocked')).toHaveCount(0);
  await expect(s2.getByTestId('hud-company')).toHaveText('은하상단');

  // ── 일시정지: 모든 조작 막힘 ──
  await teacher(host, { type: 'pause' });
  await expect(s1.getByTestId('pause-overlay')).toBeVisible();
  await expect(s1.getByTestId('pause-overlay')).toContainText('선생님을 보세요');
  await expect(s1.getByTestId('game-base')).toHaveAttribute('inert', /.*/); // 키보드 포커스도 막힘(HUD·도감·설정 포함)
  const blocked = await s1
    .getByTestId('cancel-ready')
    .click({ timeout: 1500, trial: true })
    .then(() => false)
    .catch(() => true);
  expect(blocked).toBe(true);
  await shot(s1, 'paused-1366.png');
  await teacher(host, { type: 'resume' });
  await expect(s1.getByTestId('pause-overlay')).toHaveCount(0);

  // ── 도감: 탭 5개 ──
  await s1.getByTestId('hud-dex').click();
  await expect(s1.getByTestId('dex')).toBeVisible();
  for (const t of ['goods', 'ports', 'concepts', 'exportTypes', 'rules']) await expect(s1.getByTestId(`dex-tab-${t}`)).toBeVisible();
  await expect(s1.getByTestId('dex-tab-ports')).toContainText('/12');
  await shot(s1, 'dex-1366.png');

  const text2 = await s2.evaluate(() => document.body.innerText);
  expect(text2).not.toMatch(/(^|[^0-9])[134]번/);
  expect(text2).not.toContain('사용 중인 방');

  await ctx.close();
});
