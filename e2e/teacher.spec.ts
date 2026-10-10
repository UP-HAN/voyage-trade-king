import { mkdirSync, writeFileSync } from 'node:fs';
import { join as pathJoin } from 'node:path';
import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test';

/**
 * 작업 109 교사 대시보드(호스트) e2e.
 * 전부 실행: `npx playwright test -c tests/teacher/playwright.config.ts` (개발 서버 + 학생 하네스 + 로컬 중계 서버)
 * 기본 `npm run e2e`(빌드 미리보기)에서는 하네스·데모·relay가 필요한 시험을 건너뛴다.
 * SHOT_DIR 환경 변수가 있으면 스크린숏을 남긴다.
 */

const SHOT_DIR = process.env.SHOT_DIR;
const FULL = process.env.TEACHER_E2E === '1';
const RELAY = process.env.TEACHER_RELAY ?? '';

async function shot(page: Page, name: string) {
  if (!SHOT_DIR) return;
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: pathJoin(SHOT_DIR, name) });
}

const health = (rooms: number, maxRooms = 50, acceptingNewRooms = rooms < maxRooms) => ({
  ok: true,
  version: '0.1.0',
  rooms,
  maxRooms,
  acceptingNewRooms,
  notice: null,
});

type HealthMode = { body: unknown } | 'fail';

/** /health·/notice·config.json 흉내. mode를 바꾸면 다음 요청부터 반영 */
async function mockServer(page: Page, first: HealthMode, notice: unknown = { level: null }) {
  const st = { mode: first, count: 0 };
  await page.route('**/health', async (route: Route) => {
    st.count += 1;
    if (st.mode === 'fail') return route.abort('failed');
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(st.mode.body) });
  });
  await page.route('**/notice', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(notice) }));
  await page.route('**/config.json', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ serverInfo: { operator: '테스트 운영 선생님', contact: 'mailto:test@example.org' } }),
    }),
  );
  return st;
}

async function clearPrefs(page: Page) {
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
}

test.describe('T01 시작 화면', () => {
  test('사용 중인 방 n/50 + 공지 띠 + 하단 이용 안내, [이용 안내] 창 포커스 가두기', async ({ page }) => {
    await mockServer(page, { body: health(23) }, { level: 'info', text: '10월 12일 18시~19시 서버 점검이 있어요.' });
    await page.goto('./?sync=relay#/teacher');
    await clearPrefs(page);
    await page.reload();
    await expect(page.getByTestId('teacher-start')).toBeVisible();
    await expect(page.getByTestId('room-count')).toHaveText('사용 중인 방 23/50');
    await expect(page.getByTestId('service-footer')).toBeVisible();
    await expect(page.getByText('서버 점검이 있어요')).toBeVisible();
    // v0.3.1 문구는 쓰지 않음
    await expect(page.getByText('서버 좋음')).toHaveCount(0);
    await shot(page, 't01-start.png');
    // [이용 안내] 창: Tab이 창 밖으로 나가지 않는다
    await page.getByTestId('service-footer-open').click();
    const dlg = page.getByTestId('service-notice-dialog');
    await expect(dlg).toBeVisible();
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(() => !!document.activeElement?.closest('[data-testid="service-notice-dialog"]'));
      expect(inside).toBe(true);
    }
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[data-testid="service-notice-dialog"]'))).toBe(true);
    await shot(page, 't01-service-notice.png');
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
  });
});

test.describe('판 설정', () => {
  test('판 단위 카드 2장·기본 선택 없음 → 미리보기(차시 L1 25분 / 단원 25분 / 차시 L1 10분)', async ({ page }) => {
    await mockServer(page, { body: health(23) });
    await page.goto('./?sync=relay#/teacher');
    await clearPrefs(page);
    await page.reload();
    await page.getByTestId('btn-new').click();
    await expect(page.getByTestId('unit-cards').getByRole('button')).toHaveCount(2);
    await expect(page.getByTestId('unit-lesson')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('unit-unit')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('btn-open')).toBeDisabled();
    await expect(page.getByTestId('open-reason')).toHaveText('판 단위를 먼저 골라 주세요');
    await expect(page.getByTestId('preview-empty')).toBeVisible();
    await shot(page, 'setup-no-unit.png');

    await page.getByTestId('unit-lesson').click();
    await expect(page.getByTestId('btn-open')).toBeDisabled();
    await page.getByTestId('lesson-L1').click();
    await expect(page.getByTestId('preview-band')).toHaveCount(1);
    const t25 = await page.getByTestId('expected-time').innerText();
    expect(t25).toContain('무역 25분');
    await expect(page.getByTestId('btn-open')).toBeEnabled();
    await shot(page, 'setup-lesson-L1-25.png');

    // (작업 134) 단원 한 판은 L2~L4 본편(115~118) 전까지 '준비 중'(선택 불가 + 이유)
    await expect(page.getByTestId('unit-unit')).toBeDisabled();
    await expect(page.getByTestId('unit-soon')).toContainText('준비 중');
    await shot(page, 'setup-unit-soon.png');
    // 개발용 열쇠로 열면 미리보기 4구간(플래그를 켰을 때 모습)
    await page.evaluate(() => localStorage.setItem('voyage.dev.fullUnit', '1'));
    await page.reload();
    await page.getByTestId('btn-new').click();
    await page.getByTestId('unit-unit').click();
    await expect(page.getByTestId('preview-band')).toHaveCount(4);
    await expect(page.getByTestId('expected-time')).toContainText('무역 25분');
    await shot(page, 'setup-unit-25.png');
    await page.evaluate(() => localStorage.removeItem('voyage.dev.fullUnit'));

    await page.getByTestId('unit-lesson').click();
    await page.getByTestId('lesson-L1').click();
    await page.getByTestId('trade-minutes').getByRole('button', { name: '10분' }).click();
    await expect(page.getByTestId('expected-time')).toContainText('무역 10분');
    expect(await page.getByTestId('expected-time').innerText()).not.toBe(t25);
    await shot(page, 'setup-lesson-L1-10.png');

    // 다음 방문 때 마지막 선택이 미리 골라져 있다
    await page.reload();
    await page.getByTestId('btn-new').click();
    await expect(page.getByTestId('unit-lesson')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('lesson-L1')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('trade-minutes').getByRole('button', { name: '10분' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('사용 중인 방: 정상 → 켜짐, 가득 참·점검 → 꺼짐 + 안내, 알 수 없음 → 켜짐', async ({ page }) => {
    const st = await mockServer(page, { body: health(23) });
    await page.goto('./?sync=relay#/teacher');
    await clearPrefs(page);
    await page.reload();
    await page.getByTestId('btn-new').click();
    await page.getByTestId('unit-lesson').click();
    await page.getByTestId('lesson-L1').click();
    const btn = page.getByTestId('btn-open');
    await expect(page.getByTestId('room-count')).toHaveText('사용 중인 방 23/50');
    await expect(btn).toBeEnabled();
    // [방 열기] 바로 위에 "사용 중인 방"
    const rc = await page.getByTestId('room-count').boundingBox();
    const b = await btn.boundingBox();
    expect(rc!.y + rc!.height).toBeLessThanOrEqual(b!.y + 1);
    await shot(page, 'setup-rooms-ok.png');

    const bump = () => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    st.mode = { body: health(50) };
    await bump();
    await expect(page.getByTestId('room-count')).toHaveText('사용 중인 방 50/50 · 가득 찼어요');
    await expect(btn).toBeDisabled();
    await expect(page.getByTestId('room-full-notice')).toContainText('지금 서버에 방이 가득 찼어요');
    await expect(page.getByTestId('open-reason')).toHaveText('서버에 방이 가득 찼어요');
    await page.getByTestId('room-full-notice').scrollIntoViewIfNeeded();
    await shot(page, 'setup-rooms-full.png');

    st.mode = { body: health(12, 50, false) };
    await bump();
    await expect(btn).toBeDisabled();
    await expect(page.getByTestId('room-full-notice')).toContainText('점검 중이라');

    st.mode = 'fail';
    await bump();
    await expect(page.getByTestId('room-count')).toContainText('알 수 없음');
    await expect(page.getByTestId('room-count-refresh')).toBeVisible();
    await expect(btn).toBeEnabled();
    await btn.scrollIntoViewIfNeeded();
    await shot(page, 'setup-rooms-unknown.png');
  });

  test('가득 참 → [다시 확인]으로 풀림 → 방 열기 성공(실제 로컬 relay) → 대시보드에 방 수 없음·/health 읽기 멈춤', async ({ page }) => {
    test.skip(!FULL || !RELAY, 'tests/teacher/playwright.config.ts(로컬 relay)로 실행');
    const st = await mockServer(page, { body: health(50) });
    await page.goto(`./?sync=relay&relay=${encodeURIComponent(RELAY)}#/teacher`);
    await clearPrefs(page);
    await page.reload();
    await page.getByTestId('btn-new').click();
    await page.getByTestId('unit-lesson').click();
    await page.getByTestId('lesson-L1').click();
    await page.getByTestId('trade-minutes').getByRole('button', { name: '10분' }).click();
    const btn = page.getByTestId('btn-open');
    await expect(btn).toBeDisabled();
    // 응답이 바뀌기 전 한 번 실패 → [다시 확인] → 49/50
    st.mode = 'fail';
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(page.getByTestId('room-count-refresh')).toBeVisible();
    st.mode = { body: health(49) };
    await page.getByTestId('room-count-refresh').click();
    await expect(page.getByTestId('room-count')).toHaveText('사용 중인 방 49/50 · 붐벼요');
    await expect(btn).toBeEnabled();
    // 설정 값 그대로
    await expect(page.getByTestId('lesson-L1')).toHaveAttribute('aria-pressed', 'true');
    await btn.click();
    await expect(page.getByTestId('teacher-dashboard')).toBeVisible();
    await expect(page.getByTestId('room-code')).toHaveText(/^\d{6}$/);
    await expect(page.getByText('사용 중인 방')).toHaveCount(0);
    const before = st.count;
    await page.waitForTimeout(3000);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForTimeout(1000);
    expect(st.count).toBe(before);
    // 판 끝내기(방 정리)
    await page.getByTestId('btn-settings').click();
    await page.getByTestId('btn-end').click();
    await page.getByTestId('confirm-ok').click();
    await page.getByTestId('confirm-ok').click();
    await expect(page.getByTestId('ended')).toBeVisible();
  });
});

// ─────────────────────────── 학생 하네스(로컬 탭 연결) ───────────────────────────

async function student(ctx: BrowserContext, as: string): Promise<Page> {
  const p = await ctx.newPage();
  await p.goto(`./tests/teacher/harness/student.html?sync=local&as=${as}`);
  await p.waitForFunction(() => !!(window as unknown as { __h?: unknown }).__h);
  return p;
}

type W = { __h: { join(c: string, s: number, n: string): Promise<unknown>; state(): { companyName: string | null }; publicState(): unknown; setName(n: string): boolean } };

const join = (p: Page, code: string, seat: number, name: string) =>
  p.evaluate(([c, s, n]) => (window as unknown as W).__h.join(c, s, n).then(() => null), [code, seat, name] as const);
const companyOf = (p: Page) => p.evaluate(() => (window as unknown as W).__h.state().companyName);
const publicOf = (p: Page) => p.evaluate(() => (window as unknown as W).__h.publicState());
const setName = (p: Page, n: string) => p.evaluate((x) => (window as unknown as W).__h.setName(x), n);

async function statusOf(p: Page): Promise<string> {
  return (await p.locator('#status').getAttribute('data-status')) ?? '';
}

test.describe('교사 대시보드 — 전체 흐름(LocalAdapter)', () => {
  test.skip(!FULL, 'tests/teacher/playwright.config.ts(개발 서버 + 학생 하네스)로 실행');

  test('방 열기 → 입장·이름 관리 → 무역 시계 → 재접속·내보내기·마감 → 새로 고침 복귀 → 결과 파일', async ({ page, context }) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('./?sync=local#/teacher');
    await clearPrefs(page);
    await page.reload();
    await page.getByTestId('btn-new').click();
    await page.getByTestId('unit-lesson').click();
    await page.getByTestId('lesson-L1').click();
    await page.getByTestId('trade-minutes').getByRole('button', { name: '10분' }).click();
    await expect(page.getByTestId('expected-time')).toContainText('무역 10분');
    await page.getByTestId('class-name').fill('6-3');
    await page.getByTestId('btn-open').click();
    const codeEl = page.getByTestId('room-code');
    await expect(codeEl).toHaveText(/^\d{6}$/);
    const code = (await codeEl.innerText()).trim();

    // 공용 화면 다리(같은 브라우저) 구독 — 출석번호가 없는지 보려고
    const screen = await context.newPage();
    await screen.goto('./?sync=local#/screen');
    await screen.evaluate(async (c) => {
      const m = await import('/src/sync/screen-bridge.ts' as string);
      (window as unknown as { __screen: unknown[] }).__screen = [];
      m.subscribeScreen(c, (e: unknown) => (window as unknown as { __screen: unknown[] }).__screen.push(e));
    }, code);

    // 학생 2명: 같은 회사 이름 → 두 번째는 다시 입력
    const s1 = await student(context, 's1');
    const s2 = await student(context, 's2');
    await join(s1, code, 7, '해오름무역');
    await expect.poll(() => statusOf(s1)).toBe('in');
    await join(s2, code, 2, '해오름무역');
    await expect.poll(() => s2.locator('#error').getAttribute('data-code')).toBe('NAME_TAKEN');
    await join(s2, code, 2, '푸른바다상사');
    await expect.poll(() => statusOf(s2)).toBe('in');

    const rows = page.getByTestId('student-row');
    await expect(rows).toHaveCount(2);
    await expect(page.locator('[data-seat="7"] [data-testid="cell-company"]')).toContainText('해오름무역');
    await expect(page.locator('[data-seat="2"] [data-testid="cell-company"]')).toContainText('푸른바다상사');
    await expect(page.locator('[data-seat="7"] [data-testid="cell-online"]')).toContainText('접속');
    await expect(page.getByTestId('student-table').getByRole('columnheader')).toHaveText([
      '번호', '회사 이름', '접속', '항구', '자금(만 원)', '임무', '응답', '학습지', '편지',
    ]);
    await expect(page.getByTestId('prep-counts')).toContainText('들어온 회사 2');
    await shot(page, 'dash-prep-2students.png');

    // [회사 이름 바꾸기] → 공용 화면 상태에 새 이름, 출석번호 없음
    await page.locator('[data-seat="2"] [data-testid="cell-company"]').click();
    await page.getByTestId('rename-input').fill('은빛무역');
    await page.getByTestId('btn-rename').click();
    await expect(page.locator('[data-seat="2"] [data-testid="cell-company"]')).toContainText('은빛무역');
    await expect.poll(() => s2.locator('#company').innerText()).toBe('은빛무역');
    await expect
      .poll(async () => screen.evaluate(() => JSON.stringify((window as unknown as { __screen: unknown[] }).__screen.at(-1) ?? null)))
      .toContain('은빛무역');
    const screenJson = await screen.evaluate(() => JSON.stringify((window as unknown as { __screen: unknown[] }).__screen));
    expect(screenJson).not.toMatch(/"seat"\s*:/);
    expect(screenJson).not.toContain('"money"');
    const pubJson = JSON.stringify(await publicOf(s1));
    expect(pubJson).toContain('은빛무역');
    expect(pubJson).not.toMatch(/"seat"\s*:/);

    // [이름 막기] → 학생이 다시 지음
    await page.getByTestId('btn-block').click();
    await page.getByTestId('confirm-ok').click();
    await expect(page.locator('[data-seat="2"]')).toContainText('이름 짓는 중');
    await expect.poll(() => setName(s2, '새바다무역')).toBe(true);
    await expect(page.locator('[data-seat="2"] [data-testid="cell-company"]')).toContainText('새바다무역');
    await page.getByTestId('drawer-close').click();

    // SEAT_TAKEN: 다른 기기가 7번에 다른 이름 → [이 기기를 7번 회사로 연결]
    const s3 = await student(context, 's3');
    await join(s3, code, 7, '다른회사');
    await expect.poll(() => s3.locator('#error').getAttribute('data-code')).toBe('SEAT_TAKEN');
    const prob = page.getByTestId('seat-problem');
    await expect(prob).toContainText('7번으로 다른 회사 이름 입장 시도 — 1회');
    await expect(prob).not.toContainText('다른회사');
    await expect(page.getByTestId('issue-badge')).toContainText('입장 문제 1');
    await shot(page, 'dash-entry-problem.png');
    await prob.getByTestId('btn-bind').click();
    await join(s3, code, 7, '다른회사');
    await expect.poll(() => statusOf(s3)).toBe('in');
    await expect.poll(() => companyOf(s3)).toBe('해오름무역');
    await expect.poll(() => statusOf(s1)).toBe('moved');

    // [번호 바꾸기] 2 → 12
    await page.locator('[data-seat="2"] [data-testid="cell-company"]').click();
    await page.getByTestId('reseat-select').selectOption('12');
    await page.getByTestId('btn-reseat').click();
    await page.getByTestId('confirm-ok').click();
    await expect(page.locator('[data-seat="12"] [data-testid="cell-seat"]')).toHaveText('12');
    await expect(page.locator('[data-seat="2"]')).toHaveCount(0);
    await page.getByTestId('drawer-close').click();

    // [무역 시작] → 시계 감소
    await page.getByTestId('btn-start-trade').click();
    await expect(page.getByTestId('confirm-start')).toContainText('무역 시간 10분이 시작돼요');
    await page.getByTestId('confirm-ok').click();
    const clock = page.getByTestId('trade-clock');
    await expect(clock).toBeVisible();
    const sec = async () => Number(await clock.getAttribute('data-sec'));
    const c0 = await sec();
    await expect.poll(sec, { timeout: 5000 }).toBeLessThan(c0);
    await expect(page.getByTestId('room-count')).toHaveCount(0);

    // 1등급 활동 건너뛰기 → 확인 창
    const tier1 = page.getByTestId('tl-next-item').filter({ hasText: '1등급' }).first();
    await expect(tier1).toBeVisible();
    await tier1.getByTestId('tl-skip').click();
    await expect(page.getByTestId('confirm-skip-tier1')).toContainText('핵심 경험이에요. 정말 건너뛸까요?');
    await shot(page, 'dash-skip-tier1-confirm.png');
    await page.getByTestId('confirm-cancel').click();
    await expect(page.getByTestId('confirm-skip-tier1')).toHaveCount(0);

    // [일시정지] → 시계 멈춤 + 학생 오버레이
    await page.getByTestId('btn-pause').click();
    await expect(clock).toContainText('멈춤');
    await expect(s3.locator('#paused')).toBeVisible();
    const p0 = await sec();
    await page.waitForTimeout(2200);
    expect(await sec()).toBe(p0);
    const studentRemain = Number(await s3.locator('#remaining').innerText());
    expect(Math.abs(studentRemain - p0)).toBeLessThanOrEqual(2);
    await page.getByTestId('btn-resume-trade').click();
    await expect(s3.locator('#paused')).toBeHidden();

    // [+3] → 시계 +180초, 배치표 다시 배치(버전 증가), 학생 남은 시간도 늘어남
    const v0 = await page.getByTestId('timeline').locator('h2').innerText();
    const b3 = await sec();
    await page.getByTestId('btn-extend-3').click();
    await expect.poll(sec).toBeGreaterThan(b3 + 170);
    await expect.poll(() => page.getByTestId('timeline').locator('h2').innerText()).not.toBe(v0);
    await expect.poll(async () => Number(await s3.locator('#remaining').innerText())).toBeGreaterThan(b3 + 160);
    // [−1]
    const b1 = await sec();
    await page.getByTestId('btn-shorten-1').click();
    await expect.poll(sec).toBeLessThan(b1 - 50);

    // 라운드: 앞 활동을 [건너뛰기](1등급은 확인 창에서 확인) → 다시 배치되어 라운드 1이 곧 시작 → [라운드 끝]
    for (let i = 0; i < 6 && !(await page.getByTestId('round-info').count()); i++) {
      const item = page.getByTestId('tl-next-item').filter({ has: page.getByTestId('tl-skip') }).first();
      if (!(await item.count())) break;
      await item.getByTestId('tl-skip').click();
      const conf = page.getByTestId('confirm-skip-tier1');
      if (await conf.isVisible().catch(() => false)) await page.getByTestId('confirm-ok').click();
      await page.waitForTimeout(1200);
    }
    await expect(page.getByTestId('round-info')).toBeVisible({ timeout: 60_000 });
    await shot(page, 'dash-round.png');
    const roundText = async () => ((await page.getByTestId('round-info').count()) ? (await page.getByTestId('round-info').innerText()).split('·')[0]!.trim() : '');
    const r0 = await roundText();
    expect(r0).toBe('라운드 1');
    await page.getByTestId('btn-end-round').click();
    // 라운드 1이 끝남(일찍 끝내면 남은 시간으로 다시 배치되어 다음 항목이 바로 이어질 수 있음 — 123 R7)
    await expect.poll(roundText, { timeout: 10_000 }).not.toBe('라운드 1');

    // 재접속 요청(다른 기기, 같은 번호 + 같은 회사 이름) → [허락]
    const s4 = await student(context, 's4');
    await join(s4, code, 12, '새바다무역');
    await expect.poll(() => statusOf(s4)).toBe('waitingApproval');
    const req = page.getByTestId('rejoin-request');
    await expect(req).toContainText('12번 새바다무역 — 다른 기기에서 다시 들어오기 요청');
    await expect(req).toContainText('지금 접속 중인 기기가 있어요');
    await shot(page, 'dash-rejoin-request.png');
    await req.getByTestId('btn-approve').click();
    await expect.poll(() => statusOf(s4)).toBe('in');
    await expect.poll(() => statusOf(s2)).toBe('moved');

    // [내보내기](두 번 확인) → 학생 kicked
    await page.locator('[data-seat="12"] [data-testid="cell-company"]').click();
    await page.getByTestId('btn-kick').click();
    await page.getByTestId('confirm-ok').click();
    await expect(page.getByTestId('confirm-kick-2')).toContainText('이 기기는 이번 판에 다시 들어올 수 없어요');
    await page.getByTestId('confirm-ok').click();
    await expect.poll(() => statusOf(s4)).toBe('kicked');
    await expect(page.locator('[data-seat="12"]')).toHaveCount(0);

    // [입장 마감] → 새 번호 입장 불가
    await page.getByTestId('btn-lock').click();
    const s5 = await student(context, 's5');
    await join(s5, code, 20, '늦은무역');
    await expect.poll(() => s5.locator('#error').getAttribute('data-code')).toBe('LOCKED');

    // 교사 탭 새로 고침 → 같은 판으로 자동 복귀, 끊긴 시간만큼 남은 시간이 줄지 않음
    await page.getByTestId('btn-pause').click();
    await expect(clock).toContainText('멈춤');
    await page.getByTestId('btn-resume-trade').click();
    const beforeReload = await sec();
    await page.reload();
    await expect(page.getByTestId('teacher-dashboard')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('room-code-small')).toContainText(code);
    await page.waitForTimeout(1500);
    const afterReload = await sec();
    expect(Math.abs(afterReload - beforeReload)).toBeLessThanOrEqual(5);
    await expect.poll(() => statusOf(s3), { timeout: 30_000 }).toBe('in');

    // 결과 파일 저장(JSON·CSV, BOM, 실명 열 없음)
    await page.getByTestId('btn-settings').click();
    // (작업 114) 파일 내용은 페이지가 만든 Blob에서 읽고, 내려받기는 '시작'(download 이벤트 2번)까지만 기다린다.
    // 이 PC의 헤드리스 브라우저는 blob 두 개를 잇달아 내려받으면 '완료'가 수십 초 늦거나 'canceled'가 되는 일이 있었다(앱과 무관)
    await page.evaluate(() => {
      const w = window as unknown as { __blobs: { text: string; head: number[] }[] };
      w.__blobs = [];
      const orig = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (b: Blob | MediaSource) => {
        if (b instanceof Blob)
          void b.arrayBuffer().then((buf) => w.__blobs.push({ text: new TextDecoder().decode(buf), head: [...new Uint8Array(buf).slice(0, 3)] }));
        return orig(b);
      };
    });
    const dlNames: string[] = [];
    page.on('download', (d) => dlNames.push(d.suggestedFilename()));
    await page.getByTestId('btn-save-result').click();
    await expect(page.getByTestId('confirm-result')).toContainText('실명은 들어 있지 않아요. 명렬표와 대조해 쓰세요.');
    await page.getByTestId('confirm-ok').click();
    await expect.poll(() => dlNames.length, { timeout: 15_000 }).toBe(2);
    expect(dlNames.some((n) => n.endsWith('.csv')) && dlNames.some((n) => n.endsWith('.json'))).toBe(true);
    const blobs = await page.evaluate(() => (window as unknown as { __blobs: { text: string; head: number[] }[] }).__blobs);
    const csvBlob = blobs.find((b) => b.text.includes('출석번호,'))!;
    expect(csvBlob.head).toEqual([0xef, 0xbb, 0xbf]);
    const csv = csvBlob.text.replace(/^\uFEFF/, '');
    const header = csv.split(/\r?\n/)[0] as string;
    expect(header.startsWith('출석번호,회사 이름,판 단위,차시(범위)')).toBe(true);
    expect(header).not.toMatch(/실명|학생 이름/);
    expect(csv).toContain('차시마다 한 판');
    expect(csv).toContain('해오름무역');
    if (SHOT_DIR) {
      mkdirSync(SHOT_DIR, { recursive: true });
      writeFileSync(pathJoin(SHOT_DIR, 'result-sample.csv'), csvBlob.text);
    }
    await page.getByTestId('settings-close').click();
    await shot(page, 'dash-trade.png');

    // 공용 화면 장면 선택 → 공개 상태(screenScene), [발표 모드]에서는 학생 표를 그리지 않음
    await page.getByTestId('scene-select').selectOption('leaderboard');
    await expect.poll(async () => JSON.stringify(await publicOf(s3))).toContain('"screenScene":"leaderboard"');
    await page.getByTestId('btn-present').click();
    await expect(page.getByTestId('presentation')).toBeVisible();
    await expect(page.getByTestId('student-table')).toHaveCount(0);
    // 회사 이름은 공용 화면 순위판(110, 상위 N 회사 이름 + 깃발)에는 나올 수 있다 — 교사 표·서랍에는 없어야 한다(작업 111에서 보정:
    // 순위판 탭 순환 시점에 따라 이름이 보여 흔들리던 검사)
    await expect(page.getByTestId('cell-company')).toHaveCount(0);
    const names = page.getByText('해오름무역');
    for (let i = 0; i < (await names.count()); i++) {
      expect(await names.nth(i).evaluate((el) => !!el.closest('[data-testid="route-screen"]'))).toBe(true);
    }
    await shot(page, 'dash-presentation.png');
    await page.getByTestId('btn-back-dashboard').click();
    await expect(page.getByTestId('student-table')).toBeVisible();

    // 탭 닫기 경고(판 진행 중)
    let dialogType = '';
    page.on('dialog', async (d) => {
      dialogType = d.type();
      await d.dismiss();
    });
    await page.close({ runBeforeUnload: true });
    await expect.poll(() => dialogType).toBe('beforeunload');
    expect(errors).toEqual([]);
  });
});

test.describe('이어하기', () => {
  test('새 탭에서 열면 시작 화면에 [이어하기]가 크게 보인다', async ({ page, context }) => {
    await page.goto('./?sync=local#/teacher');
    await clearPrefs(page);
    await page.reload();
    await page.getByTestId('btn-new').click();
    await page.getByTestId('unit-lesson').click();
    await page.getByTestId('lesson-L1').click();
    await page.getByTestId('btn-open').click();
    await expect(page.getByTestId('room-code')).toHaveText(/^\d{6}$/);
    const code = (await page.getByTestId('room-code').innerText()).trim();
    await page.waitForTimeout(1500); // 1초 묶음 저장
    const p2 = await context.newPage();
    await p2.goto('./?sync=local#/teacher');
    await expect(p2.getByTestId('resume-card')).toContainText(code);
    await shot(p2, 't01-resume.png');
    await p2.close();
  });
});

test.describe('?demo=30 (개발 서버)', () => {
  test.skip(!FULL, '개발 서버에서만(tests/teacher/playwright.config.ts)');

  test('1366×768에서 학생 표 10줄 이상 보이고 필터 8종이 동작한다', async ({ page }) => {
    await page.goto('./?sync=local#/teacher?demo=30');
    await expect(page.getByTestId('teacher-dashboard')).toBeVisible();
    const rows = page.getByTestId('student-row');
    await expect(rows).toHaveCount(30);
    const visible = await rows.evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().bottom <= window.innerHeight).length);
    expect(visible).toBeGreaterThanOrEqual(10);
    const fs = await rows.first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(fs).toBeGreaterThanOrEqual(16);
    await shot(page, 'dash-demo30.png');
    const ids = ['offline', 'noResponse', 'notReady', 'missionTodo', 'noWorksheet', 'rejoin', 'nameCheck'];
    for (const id of ids) {
      const chip = page.getByTestId(`filter-${id}`);
      const n = Number(await chip.locator('.t-chip__n').innerText());
      await chip.click();
      await expect(rows).toHaveCount(n);
      if (id === 'nameCheck') await shot(page, 'dash-demo30-filter-namecheck.png');
    }
    await page.getByTestId('filter-all').click();
    await expect(rows).toHaveCount(30);
    // 정렬: 자금
    await page.getByTestId('sort').selectOption('money');
    const money = await rows.evaluateAll((els) => els.map((e) => Number((e.children[4] as HTMLElement).innerText.replace(/,/g, ''))));
    expect([...money].sort((a, b) => b - a)).toEqual(money);
  });
});
