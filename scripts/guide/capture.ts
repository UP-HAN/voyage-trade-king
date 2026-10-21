/**
 * 작업 141 — 공략집 자동 촬영. `npm run guide:build`(scripts/guide/build.mjs)가 Playwright로 부른다. 직접 부르지 않는다.
 *
 * 실제 한 판을 진행하며 찍는다: 빌드본 `dist/`를 `/voyage/` 하위 경로로 주는 정적 서버(scripts/guide/site.ts) + 로컬 중계 서버
 * (`server/dist`, e2e/support/voyage-servers.ts) + 교사(1366×768) + 공용 화면(1920×1080) + 실제 학생 화면 1명(크롬북 1366×768)
 * + 봇 학생 3명(e2e/support/bots.ts — 실제 학생 코드, 가상 회사 이름). 차시 L1 무역 10분, 진행 방식·학습지는 기본값(저절로·알아서).
 * 시간은 e2e 빨리 감기 시계(e2e/support/fast-clock.ts)로 기다리는 구간만 빨리, 학생이 조작하는 구간은 느리게 돌린다(화면은 실제와 같다).
 *
 * 결과: `GUIDE_OUT`(기본 tmp/guide) 아래 raw/<화면>.png + shots.json(눌러야 할 요소의 위치·화면 이름).
 * 화면 이름은 공략집 내용(print/guide/content.mjs)이 그대로 가져다 쓴다.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { openBots } from '../../e2e/support/bots';
import { FastClock } from '../../e2e/support/fast-clock';
import { startRelayProcess, ROOT, type RelayProcess, type StaticServer } from '../../e2e/support/voyage-servers';
import { finishMinigame, newContext, openFold, watchErrors, type Env } from '../../e2e/support/voyage-ui';
import { ShotBook, type MarkSpec } from './shots';
import { startGuideSite, PRETTY_HOST, type GuideSite } from './site';

const OUT = process.env.GUIDE_OUT ?? join(ROOT, 'tmp', 'guide');
const TEACHER = { width: 1366, height: 768 };
const STUDENT = { width: 1366, height: 768 };
const TV = { width: 1920, height: 1080 };

const look = (loc: Locator, text?: string): MarkSpec => ({ loc, kind: 'look', text });
const press = (loc: Locator, text?: string): MarkSpec => ({ loc, kind: 'press', text });

test('공략집 촬영 — 차시 L1 10분 한 판', async () => {
  test.setTimeout(40 * 60_000);
  const book = new ShotBook(OUT);
  let relay: RelayProcess | null = null;
  let site: GuideSite | null = null;
  let browser: Browser | null = null;
  const warn: string[] = [];
  try {
    relay = await startRelayProcess();
    site = await startGuideSite({ dist: join(ROOT, 'dist'), relayPort: relay.port });
    browser = await chromium.launch({
      args: [
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
        ...(site.pretty ? [`--host-resolver-rules=MAP ${PRETTY_HOST} 127.0.0.1`, `--unsafely-treat-insecure-origin-as-secure=http://${PRETTY_HOST}`] : []),
      ],
    });
    const env: Env = { browser, base: site.base, clock: new FastClock(), errors: [], contexts: [] };
    const clock = env.clock;
    const s = (p: Page, id: string, who: string, marks: (Locator | MarkSpec)[] = [], o?: { settleMs?: number }) => book.shot(p, id, who, marks, o);

    // ───────────── 교사: 타이틀 → 시작 화면 → 학습지 → 판 설정 → 방 열기 ─────────────
    const tctx = await newContext(env, TEACHER);
    const t = await tctx.newPage();
    watchErrors(t, 'teacher', env.errors);
    await t.goto('./');
    await expect(t.getByTestId('route-title')).toBeVisible();
    await s(t, 't-title', '선생님 PC', [press(t.getByRole('link', { name: '선생님으로 시작' })), look(t.getByRole('link', { name: '학생으로 참여' }))]);
    await t.getByRole('link', { name: '선생님으로 시작' }).click();
    await expect(t.getByTestId('teacher-start')).toBeVisible();
    const guideLinks = t.getByTestId('guide-pdf-links');
    const startMarks: (Locator | MarkSpec)[] = [press(t.getByTestId('worksheet-pdf-toggle')), press(t.getByTestId('btn-new'))];
    if (await guideLinks.count()) startMarks.push(look(guideLinks, '공략집'));
    else warn.push('시작 화면에 공략집 링크가 없어요(처음 만들 때는 정상 — 다시 돌리면 보여요)');
    await s(t, 't-start', '선생님 PC', startMarks);
    await t.getByTestId('worksheet-pdf-toggle').click();
    await expect(t.getByTestId('worksheet-pdf-list')).toBeVisible();
    await s(t, 't-worksheet-menu', '선생님 PC', [press(t.getByTestId('worksheet-pdf-L1')), look(t.getByTestId('worksheet-pdf-teacher-answers'))]);
    await t.getByTestId('worksheet-pdf-toggle').click();

    await t.getByTestId('btn-new').click();
    await expect(t.getByTestId('teacher-setup')).toBeVisible();
    await t.getByTestId('unit-lesson').click();
    await t.getByTestId('lesson-L1').click();
    const ten = t.getByTestId('trade-minutes').getByRole('button', { name: '10분' });
    await ten.click();
    await t.evaluate(() => window.scrollTo(0, 0));
    await s(t, 't-setup', '선생님 PC', [
      press(t.getByTestId('unit-lesson')),
      press(t.getByTestId('lesson-L1'), '1차시 (L1)'),
      press(ten),
      press(t.getByTestId('btn-open')),
      look(t.getByTestId('preview-order'), '오늘 순서'),
      look(t.getByTestId('preview-worksheets'), '이 차시 학습지'),
    ]);
    // 고급 설정(펼쳐 보기만 — 값은 기본 그대로)
    const adv = t.getByTestId('setup-advanced');
    await adv.locator(':scope > summary').click();
    await expect(adv).toHaveAttribute('open', '');
    await s(t, 't-setup-advanced', '선생님 PC', [look(t.getByTestId('worksheet-mode')), look(t.getByTestId('progress-mode'))]);
    await adv.locator(':scope > summary').click();
    await t.getByTestId('btn-open').click();
    await expect(t.getByTestId('room-code')).toHaveText(/^\d{6}$/, { timeout: 20_000 });
    const code = (await t.getByTestId('room-code').innerText()).trim();
    await s(t, 't-lobby', '선생님 PC', [look(t.getByTestId('room-code'), '방 코드'), press(t.getByTestId('now-open-screen'))]);

    // ── 공용 화면(TV) ──
    const [scr] = await Promise.all([tctx.waitForEvent('page'), t.getByTestId('now-open-screen').click()]);
    await scr.setViewportSize(TV);
    watchErrors(scr, 'screen', env.errors);
    await expect(scr.getByTestId('route-screen')).toBeVisible();
    await expect(scr.getByTestId('screen-room-code')).toBeVisible({ timeout: 40_000 });
    await s(scr, 'tv-code', 'TV(공용 화면)', [press(scr.getByTestId('screen-fullscreen')), look(scr.getByTestId('screen-room-code'), '방 코드'), look(scr.getByTestId('screen-qr'), 'QR 코드')]);
    await t.bringToFront();
    await t.getByTestId('tv-menu').click();
    await expect(t.getByTestId('tv-menu-list')).toBeVisible();
    await s(t, 't-tv-menu', '선생님 PC', [press(t.getByTestId('tv-menu')), look(t.getByTestId('tv-menu-list'), 'TV 화면 메뉴')]);
    await t.getByTestId('tv-menu').click();

    // ───────────── 학생: 타이틀 → 입장 → 회사 세우기 ─────────────
    const sctx = await newContext(env, STUDENT);
    const st = await sctx.newPage();
    watchErrors(st, 'student', env.errors);
    await st.goto('./');
    await s(st, 's-title', '학생 크롬북', [press(st.getByRole('link', { name: '학생으로 참여' }))]);
    await st.getByRole('link', { name: '학생으로 참여' }).click();
    await expect(st.getByTestId('student-entry')).toBeVisible();
    await st.getByTestId('entry-code').fill(code);
    await st.getByTestId('entry-seat').selectOption('7');
    await st.getByTestId('entry-name').fill('해오름무역');
    await s(st, 's-entry', '학생 크롬북', [
      press(st.getByTestId('entry-code'), '방 코드'),
      press(st.getByTestId('entry-seat'), '출석번호'),
      press(st.getByTestId('entry-name'), '회사 이름'),
      press(st.getByTestId('entry-submit')),
    ]);
    // QR로 들어오면 방 코드가 채워져 있다
    const qctx = await newContext(env, STUDENT);
    const q = await qctx.newPage();
    await q.goto(`./?room=${code}#/play`);
    await expect(q.getByTestId('student-entry')).toBeVisible();
    await s(q, 's-entry-qr', '학생 크롬북', [look(q.getByTestId('entry-code'), '방 코드')]);
    await qctx.close();
    await st.getByTestId('entry-submit').click();
    await expect(st.getByTestId('found-company')).toBeVisible({ timeout: 15_000 });
    const color = st.locator('[data-testid^="found-color-"]').nth(1);
    const emblem = st.locator('[data-testid^="found-emblem-"]').nth(4);
    const avatar = st.locator('[data-testid^="found-avatar-"]').nth(1);
    await color.click();
    await emblem.click();
    await avatar.click();
    await s(st, 's-found', '학생 크롬북', [press(color, '깃발 색'), press(emblem, '깃발 문양'), press(avatar, '선장'), press(st.getByTestId('found-submit'))]);
    await st.getByTestId('found-submit').click();
    await expect(st.getByTestId('prep-wait')).toBeVisible();
    await s(st, 's-prep', '학생 크롬북', [look(st.getByTestId('rule-cards'), '항해 규칙')]);

    // ── 봇 학생 3명 ──
    const botCtx = await newContext(env);
    const bots = await openBots(botCtx, site as unknown as StaticServer);
    await bots.evaluate(([c]) => window.__bots!.start(c as string, [{ seat: 3, name: '별빛상회' }, { seat: 12, name: '파도무역' }, { seat: 18, name: '고래상회' }], 141), [code]);
    await expect(t.getByTestId('student-row')).toHaveCount(4, { timeout: 30_000 });
    await expect.poll(async () => (await t.getByTestId('now-card').getAttribute('data-state')) ?? '', { timeout: 30_000 }).toBe('ready');

    // ───────────── 문제가 생기면(입장 전에 미리 찍기): 이름 바꾸기·끊김·다시 들어오기 허락·새로 고침 ─────────────
    // 이름 바꾸기(학생 상세)
    const botRow = t.locator('[data-testid="student-row"][data-seat="12"] [data-testid="cell-company"]');
    await botRow.click();
    await expect(t.getByTestId('student-drawer')).toBeVisible();
    await t.getByTestId('rename-input').fill('파도상회');
    await s(t, 't-rename', '선생님 PC', [press(botRow), press(t.getByTestId('rename-input'), '새 이름 칸'), press(t.getByTestId('btn-rename')), look(t.getByTestId('btn-kick'))]);
    await t.getByTestId('btn-rename').click();
    await t.getByTestId('confirm-ok').click({ timeout: 3000 }).catch(() => undefined);
    await t.getByTestId('drawer-close').click();
    await expect(t.getByTestId('student-drawer')).toHaveCount(0);

    // 다른 기기 학생: 들어왔다가 끊김 → 새 기기로 다시 들어오기 요청 → 허락
    const dctx = await newContext(env, STUDENT);
    // 이 기기의 연결을 끊었다 다시 못 붙게 하는 장치(촬영용): 새 WebSocket을 닫힌 포트로 보낸다
    await dctx.addInitScript(() => {
      const w = window as unknown as { WebSocket: typeof WebSocket; __socks: WebSocket[]; __blockWs?: boolean };
      const W = w.WebSocket;
      w.__socks = [];
      class B extends W {
        constructor(u: string | URL, p?: string | string[]) {
          super(w.__blockWs ? 'ws://127.0.0.1:9/' : u, p);
          w.__socks.push(this);
        }
      }
      w.WebSocket = B as unknown as typeof WebSocket;
    });
    const d1 = await dctx.newPage();
    await d1.goto('./#/play');
    await d1.getByTestId('entry-code').fill(code);
    await d1.getByTestId('entry-seat').selectOption('21');
    await d1.getByTestId('entry-name').fill('달빛상회');
    await d1.getByTestId('entry-submit').click();
    await expect(d1.getByTestId('found-company')).toBeVisible({ timeout: 15_000 });
    await d1.getByTestId('found-submit').click();
    await expect(t.getByTestId('student-row')).toHaveCount(5, { timeout: 15_000 });
    await d1.evaluate(() => {
      const w = window as unknown as { __socks: WebSocket[]; __blockWs?: boolean };
      w.__blockWs = true;
      for (const x of w.__socks) x.close();
    });
    const row21 = t.locator('[data-testid="student-row"][data-seat="21"]');
    await expect.poll(async () => (await row21.getByTestId('cell-online').innerText()).trim(), { timeout: 30_000 }).not.toBe('들어옴');
    await d1.waitForTimeout(2500);
    await s(d1, 's-offline', '학생 크롬북');
    await s(t, 't-offline', '선생님 PC', [look(row21.getByTestId('cell-online'), '나감'), press(t.getByTestId('filter-help'), '도움이 필요해요')]);
    const d2ctx = await newContext(env, STUDENT);
    const d2 = await d2ctx.newPage();
    await d2.goto('./#/play');
    await d2.getByTestId('entry-code').fill(code);
    await d2.getByTestId('entry-seat').selectOption('21');
    await d2.getByTestId('entry-name').fill('달빛상회');
    await d2.getByTestId('entry-submit').click();
    await expect(d2.getByTestId('entry-waiting-approval')).toBeVisible({ timeout: 15_000 });
    await s(d2, 's-rejoin-wait', '학생 크롬북', [look(d2.getByTestId('entry-waiting-approval'))]);
    await expect(t.getByTestId('note-rejoin')).toBeVisible({ timeout: 15_000 });
    await s(t, 't-rejoin-note', '선생님 PC', [look(t.getByTestId('note-rejoin'), '다시 들어오기 요청 알림'), press(t.getByTestId('note-rejoin-show'))]);
    await t.getByTestId('note-rejoin-show').click();
    await expect(t.getByTestId('btn-approve')).toBeVisible();
    await s(t, 't-rejoin-approve', '선생님 PC', [press(t.getByTestId('btn-approve')), look(t.getByTestId('btn-deny'))]);
    await t.getByTestId('btn-approve').click();
    await expect(d2.getByTestId('rule-cards').or(d2.getByTestId('student-game')).first()).toBeVisible({ timeout: 20_000 }).catch(() => warn.push('다시 들어오기 허락 뒤 학생 화면이 안 바뀜'));
    await s(d2, 's-rejoin-ok', '학생 크롬북').catch((e) => warn.push(`s-rejoin-ok: ${e}`));
    await openFold(t, 'entry'); // 열린 상태 그대로 두면 다음 화면이 달라지므로 닫는다
    await t.getByTestId('fold-entry-head').click();
    // 촬영용 학생(21번)은 판에서 내보낸다(나머지 화면은 학생 4명으로)
    await row21.getByTestId('cell-company').click();
    await expect(t.getByTestId('student-drawer')).toBeVisible();
    await t.getByTestId('btn-kick').click();
    await t.getByTestId('confirm-ok').click();
    await t.getByTestId('confirm-ok').click();
    await expect(t.getByTestId('student-row')).toHaveCount(4, { timeout: 15_000 });
    if (await t.getByTestId('drawer-close').isVisible().catch(() => false)) await t.getByTestId('drawer-close').click();
    await dctx.close();
    await d2ctx.close();

    // 교사 새로 고침 → 이어하기
    await t.reload();
    await expect(t.getByTestId('teacher-dashboard').or(t.getByTestId('resume-card'))).toBeVisible({ timeout: 20_000 });
    if (await t.getByTestId('resume-card').isVisible().catch(() => false)) {
      await s(t, 't-reload', '선생님 PC', [press(t.getByTestId('btn-resume'))]);
      await t.getByTestId('btn-resume').click();
    } else {
      await s(t, 't-reload', '선생님 PC', [look(t.getByTestId('now-card'))]);
    }
    await expect(t.getByTestId('now-card')).toBeVisible({ timeout: 20_000 });
    // 5번째(다른 기기) 학생은 이 판에서 빼지 않고 둔다(끊김으로 남음) — 화면 수 4/5가 보일 수 있다
    await expect.poll(async () => (await t.getByTestId('now-card').getAttribute('data-state')) ?? '', { timeout: 30_000 }).toBe('ready');

    // ───────────── 무역 시작 ─────────────
    await s(t, 't-ready', '선생님 PC', [look(t.getByTestId('student-table'), '학생 표'), press(t.getByTestId('btn-start-trade'))]);
    await s(scr, 'tv-joined', 'TV(공용 화면)', [look(scr.getByTestId('screen-joined'))]).catch((e) => warn.push(`tv-joined: ${e}`));
    await t.getByTestId('btn-start-trade').click();
    await expect(t.getByTestId('confirm-ok')).toBeVisible();
    await s(t, 't-start-confirm', '선생님 PC', [press(t.getByTestId('confirm-ok'))]);
    await t.getByTestId('confirm-ok').click();
    await expect(t.getByTestId('trade-clock')).toBeVisible();

    // 사전 활동: 1차시 표지 → 벽란도 시장(미니게임) → 무역·수입·수출
    await expect.poll(async () => t.getByTestId('now-card').getAttribute('data-state'), { timeout: 20_000 }).toMatch(/card|respond/);
    if ((await t.getByTestId('now-card').getAttribute('data-state')) === 'card') {
      await s(t, 't-cover', '선생님 PC', [look(t.locator('.t-now__line')), press(t.getByTestId('now-primary').locator('button'))]);
      await s(scr, 'tv-cover', 'TV(공용 화면)').catch((e) => warn.push(`tv-cover: ${e}`));
      await s(st, 's-cover', '학생 크롬북').catch((e) => warn.push(`s-cover: ${e}`));
    }
    await clock.fastForwardUntil(async () => (await st.getByTestId('minigame').count()) > 0, { speed: 6, label: '벽란도' });
    await clock.setSpeed(0.5);
    await s(t, 't-pre-activity', '선생님 PC', [look(t.locator('.t-now__line')), look(t.getByTestId('tl-resp-count')), press(t.getByTestId('btn-close-event'))]);
    await s(scr, 'tv-event', 'TV(공용 화면)');
    // 학생: 벽란도 시장
    const mg = st.getByTestId('minigame');
    await expect(mg).toHaveAttribute('data-event', 'L1-E1');
    const tray = st.locator('[data-testid="bk-card"][data-place="tray"]').first();
    await s(st, 's-bk-1', '학생 크롬북', [press(tray, '물건 카드')]);
    await tray.click();
    await s(st, 's-bk-2', '학생 크롬북', [press(st.getByTestId('bk-basket-btn-sold')), press(st.getByTestId('bk-basket-btn-bought'))]);
    await finishMinigameShots(st, s);
    await expect(st.getByTestId('event-waiting')).toBeVisible({ timeout: 15_000 });
    await s(st, 's-event-waiting', '학생 크롬북', [look(st.getByTestId('event-waiting'), '기다리는 안내')]).catch((e) => warn.push(`s-event-waiting: ${e}`));
    await s(t, 't-responses', '선생님 PC', [look(t.getByTestId('tl-resp-count')), look(t.getByTestId('student-table'), '학생 표')]).catch((e) => warn.push(`t-responses: ${e}`));

    // 무역·수입·수출(개념 카드)
    await clock.fastForwardUntil(async () => (await st.locator('[data-testid="event-card"][data-event="L1-E2"]').count()) > 0, { speed: 6, label: 'L1-E2' });
    await clock.setSpeed(0.5);
    await s(st, 's-concept', '학생 크롬북', [press(st.getByTestId('card-confirm'))]);
    await s(t, 't-card', '선생님 PC', [look(t.locator('.t-now__line')), press(t.getByTestId('now-primary').locator('button')), look(t.getByTestId('tv-chip'))]);
    await s(scr, 'tv-concept', 'TV(공용 화면)');
    await st.getByTestId('card-confirm').click();
    await expect(st.getByTestId('round-wait-card')).toBeVisible({ timeout: 15_000 });
    await s(st, 's-round-wait', '학생 크롬북', [look(st.getByTestId('round-wait-card'), '라운드 전 대기 카드'), look(st.getByTestId('hud-money')), look(st.getByTestId('hud-cargo')), look(st.getByTestId('hud-time'), '시간')]);
    await s(st, 's-round-wait-card', '학생 크롬북', [look(st.getByTestId('round-wait-card'), '라운드 전 대기 카드')]).catch((e) => warn.push(`s-round-wait-card: ${e}`));
    await s(t, 't-waiting', '선생님 PC', [look(t.locator('.t-now__line')), look(t.getByTestId('trade-clock'), '무역 시간'), press(t.getByTestId('btn-time-fold'))]).catch((e) => warn.push(`t-waiting: ${e}`));

    // ───────────── 라운드 1 ─────────────
    await clock.fastForwardUntil(async () => (await st.getByTestId('event-panel').count()) > 0, { speed: 6, label: 'round 1' });
    await clock.setSpeed(0.35);
    // 튜토리얼(처음 라운드): 찍고 건너뛰기
    if (await st.getByTestId('tutorial').isVisible().catch(() => false)) {
      await s(st, 's-tutorial', '학생 크롬북', [press(st.getByTestId('tutorial-skip'))]).catch((e) => warn.push(`s-tutorial: ${e}`));
      await st.getByTestId('tutorial-skip').click().catch(() => undefined);
    }
    await s(st, 's-news', '학생 크롬북', [look(st.getByTestId('event-panel'), '소식 카드'), press(st.getByTestId('event-panel').getByTestId('card-confirm')), look(st.getByTestId('mission'))]);
    await s(t, 't-round', '선생님 PC', [look(t.locator('.t-now__line')), look(t.getByTestId('ready-count')), press(t.getByTestId('btn-end-round')), press(t.getByTestId('btn-pause'))]);
    await s(scr, 'tv-map', 'TV(공용 화면)').catch((e) => warn.push(`tv-map: ${e}`));
    await st.getByTestId('event-panel').getByTestId('card-confirm').click();
    await dismissAll(st);
    await s(st, 's-map', '학생 크롬북', [
      press(st.getByTestId('enter-port')),
      look(st.getByTestId('hud-money')),
      look(st.getByTestId('hud-cargo')),
      look(st.getByTestId('hud-time'), '시간'),
      press(st.getByRole('button', { name: '전체 보기' })),
      press(st.getByTestId('hud-letters')),
    ]);
    // 항구 들어가기 → 사기
    await st.getByTestId('enter-port').click();
    await expect(st.getByTestId('port-screen')).toBeVisible();
    await dismissAll(st);
    await s(st, 's-port', '학생 크롬북', [look(st.getByTestId('port-name'), '항구 이름'), press(st.getByTestId('tab-market')), press(st.getByTestId('tab-story')), press(st.getByTestId('port-back')), look(st.getByTestId('sell-list').or(st.getByTestId('sell-empty')).first(), '팔기'), look(st.getByTestId('buy-list'), '사기')]).catch((e) => warn.push(`s-port: ${e}`));
    // 포트헤들랜드에서 비싸게 팔리는 자동차를 산다(없으면 첫 상품)
    const carCard = st.getByTestId('buy-card-car');
    const buyCard = (await carCard.count()) ? carCard : st.locator('[data-testid^="buy-card-"]').first();
    const good = ((await buyCard.getAttribute('data-testid')) ?? '').replace('buy-card-', '');
    const plus = st.getByTestId(`buy-${good}-plus`);
    await plus.click();
    await s(st, 's-buy', '학생 크롬북', [press(plus, '+'), press(buyCard.getByTestId(`buy-${good}`)), look(st.getByTestId('hud-cargo'))]);
    await buyCard.getByTestId(`buy-${good}`).click();
    await st.waitForTimeout(600);
    await dismissAll(st);
    await s(st, 's-bought', '학생 크롬북', [look(st.getByTestId('hud-money')), look(st.getByTestId('hud-cargo')), press(st.getByTestId('port-back'))]).catch((e) => warn.push(`s-bought: ${e}`));
    await st.getByTestId('port-back').click();
    // 출항 준비: 포트헤들랜드
    const hit = st.locator('.wm-port[data-port="PHE"] .wm-port-hit');
    await st.getByRole('button', { name: '전체 보기' }).click();
    await st.waitForTimeout(700);
    await s(st, 's-pick', '학생 크롬북', [press(hit, '항구 표시')], { settleMs: 900 });
    await hit.click();
    await expect(st.getByTestId('pick-panel')).toHaveAttribute('data-kind', 'ok');
    await s(st, 's-pick-confirm', '학생 크롬북', [look(st.getByTestId('pick-body'), '항해 정보'), press(st.getByTestId('pick-confirm'))]);
    await st.getByTestId('pick-confirm').click();
    await s(st, 's-set-ready', '학생 크롬북', [press(st.getByTestId('set-ready'))]);
    await st.getByTestId('set-ready').click();
    await expect(st.getByTestId('ready-note')).toBeVisible();
    await s(st, 's-ready', '학생 크롬북', [look(st.getByTestId('ready-note')), press(st.getByTestId('cancel-ready'))]).catch((e) => warn.push(`s-ready: ${e}`));

    // 잠깐 멈춤·이어서 하기(교사) + 학생 멈춤 화면
    await t.getByTestId('btn-pause').click();
    await t.getByTestId('confirm-ok').click({ timeout: 2000 }).catch(() => undefined);
    await expect(t.getByTestId('now-card')).toHaveAttribute('data-state', 'paused', { timeout: 10_000 });
    await s(t, 't-paused', '선생님 PC', [look(t.locator('.t-now__line')), press(t.getByTestId('btn-resume-trade'))]);
    await expect(st.getByTestId('pause-overlay')).toBeVisible({ timeout: 10_000 });
    await s(st, 's-paused', '학생 크롬북', [look(st.getByTestId('pause-overlay'))]);
    await s(scr, 'tv-paused', 'TV(공용 화면)').catch((e) => warn.push(`tv-paused: ${e}`));
    // 시간 조절 펼치기(누르지는 않음)
    await openFold(t, 'time');
    await s(t, 't-time', '선생님 PC', [look(t.getByTestId('time-fold'), '시간 조절 칸'), press(t.getByTestId('btn-extend-1')), press(t.getByTestId('btn-shorten-1')), press(t.getByTestId('btn-finish-early'))]);
    await t.getByTestId('fold-time-head').click();
    await t.getByTestId('btn-resume-trade').click();
    await expect(t.getByTestId('now-card')).not.toHaveAttribute('data-state', 'paused', { timeout: 10_000 });

    // 라운드 끝(저절로) → 두 섬 이야기
    await clock.fastForwardUntil(async () => (await st.getByTestId('minigame').count()) > 0, { speed: 6, label: '두 섬' });
    await clock.setSpeed(0.5);
    await s(t, 't-between', '선생님 PC', [look(t.locator('.t-now__line')), look(t.getByTestId('tl-resp-count')), press(t.getByTestId('btn-close-event'))]).catch((e) => warn.push(`t-between: ${e}`));
    await expect(st.getByTestId('minigame')).toHaveAttribute('data-event', 'L1-E5');
    await twoIslandsShots(st, s);
    // 잠깐! 학습지 ③★
    await clock.fastForwardUntil(async () => (await st.getByTestId('worksheet-popup').count()) > 0, { speed: 4, label: '학습지 팝업' });
    await clock.setSpeed(0.5);
    await s(st, 's-worksheet', '학생 크롬북', [look(st.getByTestId('worksheet-head')), press(st.getByTestId('worksheet-done'), '다 썼어요'), press(st.getByTestId('worksheet-tool-logbook'))], { settleMs: 300 });
    await s(t, 't-worksheet', '선생님 PC', [look(t.locator('.t-now__line')), look(t.getByTestId('now-ws-done')), press(t.getByTestId('now-ws-close')), press(t.getByTestId('now-ws-missing'))]);
    await s(scr, 'tv-worksheet', 'TV(공용 화면)').catch((e) => warn.push(`tv-worksheet: ${e}`));
    await clock.fastForwardUntil(async () => await st.getByTestId('worksheet-done').isEnabled(), { speed: 2, label: '다 썼어요 켜짐', maxFastMs: 60_000 });
    await clock.setSpeed(0.5);
    await s(st, 's-worksheet-done', '학생 크롬북', [press(st.getByTestId('worksheet-done'))]);
    // 교사: 새 학생 그만 받을까요? 알림(무역 5분 뒤)
    if (await t.getByTestId('lock-yes').isVisible().catch(() => false)) {
      await s(t, 't-lock', '선생님 PC', [look(t.getByTestId('lock-suggest'), '새 학생 그만 받을까요? 알림'), press(t.getByTestId('lock-yes')), press(t.getByTestId('lock-no'))]).catch((e) => warn.push(`t-lock: ${e}`));
    }
    await st.getByTestId('worksheet-done').click();

    // ───────────── 라운드 2: 흑연 결정 + 편지 ─────────────
    await clock.fastForwardUntil(async () => (await st.locator('[data-testid="event-panel"][data-event="L1-E7"]').count()) > 0, { speed: 6, label: 'round 2' });
    await clock.setSpeed(0.3);
    await dismissAll(st);
    const opt = st.locator('[data-testid^="decision-opt-"]:not([data-testid="decision-options"])').first();
    if (!(await opt.isVisible().catch(() => false)) && (await st.getByTestId('event-panel-unfold').isVisible().catch(() => false))) await st.getByTestId('event-panel-unfold').click();
    await opt.click();
    await s(st, 's-decision', '학생 크롬북', [press(opt, '보기 하나')]);
    await s(st, 's-decision-submit', '학생 크롬북', [press(st.getByTestId('decision-submit'))]);
    await st.getByTestId('decision-submit').click();
    await s(t, 't-round2', '선생님 PC', [look(t.getByTestId('tl-resp-count')), press(t.getByTestId('btn-close-event')), press(t.getByTestId('btn-end-round'))]);
    await s(scr, 'tv-decision', 'TV(공용 화면)').catch((e) => warn.push(`tv-decision: ${e}`));
    // 오늘 순서 → [TV에 결과 보여 주기]
    await openFold(t, 'order');
    const live = t.locator('[data-testid="tl-live-item"]').filter({ has: t.locator('.t-ord__head:not([disabled])') }).first();
    if (await live.count()) {
      const head = live.locator('.t-ord__head');
      if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click();
      await expect(t.getByTestId('tl-reveal')).toBeVisible();
      await s(t, 't-order', '선생님 PC', [look(t.getByTestId('timeline'), '오늘 순서'), press(head, '흑연을 어디서 살까요?'), press(t.getByTestId('tl-reveal')), press(t.getByTestId('tl-close'))]);
    } else warn.push('오늘 순서에서 진행 중인 결정 줄을 못 찾음');
    await t.getByTestId('fold-order-head').click();
    // 학생: 팔기·사기(포트헤들랜드) — 도착했으면
    await dismissAll(st);
    if (await st.getByTestId('enter-port').isEnabled().catch(() => false)) {
      await st.getByTestId('enter-port').click();
      await expect(st.getByTestId('port-screen')).toBeVisible();
      await dismissAll(st);
      const sellCard = st.locator('[data-testid^="sell-card-"]:not(.is-off)').first();
      if (await sellCard.count()) {
        const sg = ((await sellCard.getAttribute('data-testid')) ?? '').replace('sell-card-', '');
        await s(st, 's-sell', '학생 크롬북', [look(sellCard, '판매 카드'), press(sellCard.getByTestId(`sell-${sg}`))]).catch((e) => warn.push(`s-sell: ${e}`));
        await sellCard.getByTestId(`sell-${sg}`).click();
        await st.waitForTimeout(800);
        const soldMarks: (Locator | MarkSpec)[] = [look(st.getByTestId('hud-money'))];
        if (await st.getByTestId('concept-ok').isVisible().catch(() => false)) soldMarks.push(press(st.getByTestId('concept-ok')));
        await s(st, 's-sold', '학생 크롬북', soldMarks).catch((e) => warn.push(`s-sold: ${e}`));
        await dismissAll(st);
      } else warn.push('팔 물건 카드가 없음');
      await st.getByTestId('port-back').click().catch(() => undefined);
    } else warn.push('라운드 2에 항구에 도착하지 않음');
    // 편지(갈매기)
    await dismissAll(st);
    await expect(st.getByTestId('hud-letters')).toHaveAttribute('data-count', /[1-9]/, { timeout: 20_000 });
    await s(st, 's-letter-badge', '학생 크롬북', [press(st.getByTestId('hud-letters'))]);
    await st.getByTestId('hud-letters').click();
    const item = st.getByTestId('letter-item').first();
    await expect(item).toBeVisible();
    await s(st, 's-letter-list', '학생 크롬북', [press(item, '편지')]).catch((e) => warn.push(`s-letter-list: ${e}`));
    await item.click();
    const choice = st.getByTestId('letter-choice').first();
    await expect(choice).toBeVisible();
    await s(st, 's-letter', '학생 크롬북', [look(st.getByTestId('letter-question'), '편지 질문'), press(choice, '답 하나')]);
    await choice.click();
    await expect(st.getByTestId('letter-read')).toHaveAttribute('data-result', /right|wrong/);
    const after: (Locator | MarkSpec)[] = [];
    for (const id of ['letter-ack', 'letter-close']) if (await st.getByTestId(id).isVisible().catch(() => false)) after.push(press(st.getByTestId(id)));
    await s(st, 's-letter-result', '학생 크롬북', after).catch((e) => warn.push(`s-letter-result: ${e}`));
    for (const id of ['letter-ack', 'letter-close']) if (await st.getByTestId(id).isVisible().catch(() => false)) await st.getByTestId(id).click().catch(() => undefined);

    // ───────────── 마무리 ─────────────
    await clock.fastForwardUntil(async () => (await st.getByTestId('trade-over').count()) > 0, { speed: 6, label: 'trade over' });
    await clock.setSpeed(0.5);
    await expect(t.getByTestId('now-card')).toHaveAttribute('data-state', 'wrapup', { timeout: 15_000 });
    await expect(st.getByTestId('wrap-awards')).toBeVisible({ timeout: 15_000 });
    await s(t, 't-wrap-awards', '선생님 PC', [look(t.locator('.t-now__line')), press(t.getByTestId('now-wrap-next')), press(t.getByTestId('now-wrap-skip'))]);
    await clock.fastForwardUntil(async () => (await scr.getByTestId('route-screen').getAttribute('data-scene')) === 'awards', { speed: 4, maxFastMs: 60_000, label: 'tv awards' }).catch(() => undefined);
    await clock.setSpeed(0.5);
    await s(scr, 'tv-awards', 'TV(공용 화면)', [], { settleMs: 1500 }).catch((e) => warn.push(`tv-awards: ${e}`));
    await s(st, 's-awards', '학생 크롬북', [look(st.getByTestId('wrap-metrics'), '결산'), look(st.getByTestId('wrap-my-awards'), '받은 상')]).catch((e) => warn.push(`s-awards: ${e}`));
    await t.getByTestId('now-wrap-next').click();
    await expect(st.getByTestId('wrap-reflect')).toBeVisible({ timeout: 15_000 });
    await t.waitForTimeout(800);
    await s(t, 't-wrap-reflect', '선생님 PC', [look(t.locator('.t-now__line')), press(t.getByTestId('now-wrap-next'))]);
    await s(st, 's-reflect', '학생 크롬북', [look(st.getByTestId('wrap-reflect-questions'), '되돌아보기 질문'), look(st.getByTestId('wrap-reflect-where'), '쓰는 곳 안내')]);
    await s(scr, 'tv-reflect', 'TV(공용 화면)').catch((e) => warn.push(`tv-reflect: ${e}`));
    await t.getByTestId('now-wrap-next').click();
    await expect(st.getByTestId('after-worksheets-student').or(st.getByTestId('after-unfold'))).toBeVisible({ timeout: 15_000 });
    await t.waitForTimeout(1200);
    await s(t, 't-wrap-after', '선생님 PC', [look(t.locator('.t-now__line')), press(t.getByTestId('now-save-result')), press(t.getByTestId('now-end-session'))]);
    // '끝나고 쓰기' 항목이 시작되면 학생 목록이 접힌 단추로 보인다(작업 132 동작) — 펼쳐서 찍는다
    await st.waitForTimeout(2500);
    if (await st.getByTestId('after-unfold').isVisible().catch(() => false)) {
      await s(st, 's-after-pill', '학생 크롬북', [press(st.getByTestId('after-unfold'))]);
      await st.getByTestId('after-unfold').click();
      warn.push("'끝나고 쓰기' 항목이 시작되면 학생 화면의 끝나고 쓰기 목록이 접힌 채로 보임(학생이 단추를 눌러 펼쳐야 함)");
    }
    await s(st, 's-after', '학생 크롬북', [look(st.getByTestId('after-worksheets-student'), '오늘 쓸 학습지'), press(st.getByTestId('after-logbook'))]);
    await s(scr, 'tv-after', 'TV(공용 화면)').catch((e) => warn.push(`tv-after: ${e}`));
    await st.getByTestId('after-logbook').click();
    await expect(st.getByTestId('logbook')).toBeVisible();
    await s(st, 's-logbook', '학생 크롬북', [press(st.getByTestId('logbook-close'))]).catch((e) => warn.push(`s-logbook: ${e}`));
    await st.getByTestId('logbook-close').click();
    // 결과 파일 저장(내려받기는 기다리지 않음)
    await t.getByTestId('now-save-result').click();
    await expect(t.getByTestId('confirm-result')).toBeVisible();
    await s(t, 't-save-confirm', '선생님 PC', [look(t.getByTestId('confirm-result'), '저장 안내'), press(t.getByTestId('confirm-ok'))]);
    await t.getByTestId('confirm-ok').click();
    await t.waitForTimeout(1500);
    // 수업 끝내기(확인 2번)
    await t.getByTestId('now-end-session').click();
    await expect(t.getByTestId('confirm-end-1')).toBeVisible();
    await s(t, 't-end-1', '선생님 PC', [press(t.getByTestId('confirm-ok'))]);
    await t.getByTestId('confirm-ok').click();
    await expect(t.getByTestId('confirm-end-2')).toBeVisible();
    await s(t, 't-end-2', '선생님 PC', [press(t.getByTestId('confirm-ok'))]);
    await t.getByTestId('confirm-ok').click();
    await expect(t.getByTestId('ended')).toBeVisible();
    await s(t, 't-ended', '선생님 PC', [look(t.locator('.t-now__line')), press(t.getByTestId('btn-exit')), press(t.getByTestId('now-save-result'))]).catch((e) => warn.push(`t-ended: ${e}`));
    await expect(st.getByTestId('student-room-closed')).toBeVisible({ timeout: 15_000 });
    await s(st, 's-closed', '학생 크롬북', [press(st.getByTestId('student-room-closed').getByRole('link'))]).catch((e) => warn.push(`s-closed: ${e}`));

    await bots.evaluate(() => window.__bots?.stop()).catch(() => undefined);
    const errs = env.errors.filter((e) => !/requestfailed|ERR_INTERNET_DISCONNECTED|net::ERR/.test(e));
    if (errs.length) warn.push(...errs.map((e) => `화면 오류: ${e}`));
    for (const c of env.contexts) await c.close().catch(() => undefined);
  } finally {
    book.save();
    writeFileSync(join(OUT, 'warnings.json'), JSON.stringify({ host: site?.host ?? null, pretty: site?.pretty ?? false, warnings: warn }, null, 2));
    await browser?.close().catch(() => undefined);
    await site?.close().catch(() => undefined);
    await relay?.stop().catch(() => undefined);
  }
});

type Snap = (p: Page, id: string, who: string, marks?: (Locator | MarkSpec)[], o?: { settleMs?: number }) => Promise<unknown>;

/** 떠 있는 가벼운 창 닫기(항구 카드·개념 팝업·튜토리얼) */
async function dismissAll(p: Page): Promise<void> {
  for (const id of ['port-card-ok', 'concept-ok', 'tutorial-skip', 'tutorial-close']) {
    const b = p.getByTestId(id);
    if (await b.isVisible().catch(() => false)) await b.click().catch(() => undefined);
  }
}

const BK_SOLD = new Set(['silk', 'medicine', 'books', 'instrument', 'jewel']);

/** 벽란도 시장 나머지(카드 모두 담기 → 확인 → 다음 → 다시 나누기 → 마치기)를 하며 중요한 화면을 찍는다 */
async function finishMinigameShots(s: Page, snap: Snap): Promise<void> {
  const pause = () => s.waitForTimeout(550);
  // 첫 카드는 이미 골라 둠
  const first = s.locator('[data-testid="bk-card"][aria-pressed="true"], [data-testid="bk-card"].is-picked').first();
  void first;
  const trayCard = s.locator('[data-testid="bk-card"][data-place="tray"]');
  let firstDone = false;
  for (let i = 0; i < 14 && (await trayCard.count()) > 0; i++) {
    const item = (await trayCard.first().getAttribute('data-item')) ?? '';
    if (firstDone || i > 0) await s.locator(`[data-testid="bk-card"][data-item="${item}"]`).click();
    firstDone = true;
    await s.getByTestId(`bk-basket-btn-${BK_SOLD.has(item) ? 'sold' : 'bought'}`).click();
    await expect(s.locator(`[data-testid="bk-card"][data-item="${item}"]`)).not.toHaveAttribute('data-place', 'tray');
  }
  await snap(s, 's-bk-submit', '학생 크롬북', [press(s.getByTestId('bk-submit'))]);
  await s.getByTestId('bk-submit').click();
  await pause();
  await snap(s, 's-bk-result', '학생 크롬북', [look(s.getByTestId('bk-score')), press(s.getByTestId('bk-next'))]);
  await s.getByTestId('bk-next').click();
  await pause();
  const qs = s.getByTestId('bk-q');
  const n = await qs.count();
  if (n) await snap(s, 's-bk-reclass', '학생 크롬북', [look(qs.first(), '질문'), press(qs.first().getByTestId('bk-q-import'), '수입'), press(qs.first().getByTestId('bk-q-export'), '수출')]);
  for (const [item, w] of [['silk', 'import'], ['ginseng', 'export']] as const) {
    const q = s.locator(`[data-testid="bk-q"][data-item="${item}"]`);
    if (!(await q.count())) continue;
    await pause();
    await q.getByTestId(`bk-q-${w}`).click();
  }
  await pause();
  await snap(s, 's-bk-finish', '학생 크롬북', [press(s.getByTestId('minigame-finish'))]);
  await s.getByTestId('minigame-finish').click();
  await expect(s.locator('[data-testid="minigame"][data-event="L1-E1"]')).toHaveCount(0);
}

/** 두 섬 이야기: (작업 150 새 흐름, 153 정리) 장면 1 [ti-focus] → 장면 2 [ti-trade] → 장면 3 [ti-done], 장면마다 찍는다 */
async function twoIslandsShots(s: Page, snap: Snap): Promise<void> {
  const pause = () => s.waitForTimeout(600);
  await snap(s, 's-ti-stage1', '학생 크롬북', [press(s.getByTestId('ti-focus'))]);
  await s.getByTestId('ti-focus').click();
  await pause();
  await snap(s, 's-ti-stage2', '학생 크롬북', [press(s.getByTestId('ti-trade'))]);
  await s.getByTestId('ti-trade').click();
  await pause();
  await snap(s, 's-ti-finish', '학생 크롬북', [press(s.getByTestId('ti-done'))]);
  await s.getByTestId('ti-done').click();
  await expect(s.locator('[data-testid="minigame"][data-event="L1-E5"]')).toHaveCount(0);
}

void finishMinigame;
