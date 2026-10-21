/**
 * 작업 154 — 설명 영상 v2(155 선생님용·156 학생용)에 쓸 실제 게임 화면 촬영.
 * 실행: `npx playwright test -c scripts/guide/playwright.video.config.ts` (먼저 `npm run build && npm run build:server`)
 *
 * - 촬영 목록: .orch/tasks/154-video-shots/shotlist.md (id 그대로). 공통 기준: 같은 폴더 video-common.md.
 * - 판 A = 차시 한 판 · 1차시 · 무역 25분, 판 B = 차시 한 판 · 2차시 · 무역 25분. 판 설정은 기본값 그대로([고급 설정]은 펼쳐 보기만).
 * - 기기: 교사·학생 1366×768 deviceScaleFactor 2, TV(공용 화면) 1920×1080 dsf 1.
 *   공용 화면은 교사 창과 같은 브라우저 문맥이어야 상태를 받으므로(BroadcastChannel) 교사 문맥 안의 창으로 열고,
 *   그 창만 CDP `Emulation.setDeviceMetricsOverride`로 dsf 1로 바꾼다.
 * - 학생: 촬영 학생 7번 해오름무역(실제 브라우저) + 봇 3명(3 별빛상회 · 12 파도상회 · 18 고래상회, scripts/guide/video-bots.ts).
 *   촬영 학생은 개념 카드·라운드 사고팔기·학습지에서 교사 화면을 먼저 찍은 뒤 누른다.
 * - 빨리 감기(e2e/support/fast-clock.ts)는 기다리는 구간만. 토스트처럼 짧게 뜨는 화면은 속도 0.3 이하에서 찍는다.
 * - 결과: `VIDEO_OUT`(기본 tmp/video) 아래 raw/<id>.png + shots.json(ShotBook 형식) + warnings.json(경고·필수 누락·내용 확인).
 *   필수 화면을 못 찍어도 시험을 실패로 끝내지 않고 계속 진행하며 경고에 남긴다.
 * - 공략집 촬영(capture.ts, tmp/guide)·e2e 도우미는 고치지 않고 가져다 쓰기만 한다.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { chromium, expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { FastClock } from '../../e2e/support/fast-clock';
import { freePort, startRelayProcess, ROOT, type RelayProcess } from '../../e2e/support/voyage-servers';
import { finishMinigame, watchErrors, type Env } from '../../e2e/support/voyage-ui';
import { ShotBook, type MarkSpec } from './shots';
import { startGuideSite, PRETTY_HOST, type GuideSite } from './site';

const OUT = process.env.VIDEO_OUT ?? join(ROOT, 'tmp', 'video');
const PC = { width: 1366, height: 768 };
const TV = { width: 1920, height: 1080 };
const BANNED_PORTS = new Set([8765, 8766, 5173, 4190]);
const NAMES = ['해오름무역', '별빛상회', '파도상회', '고래상회'];
const WHO_T = '선생님 PC';
const WHO_S = '학생 크롬북';
const WHO_TV = 'TV(공용 화면)';

/** shotlist.md 필수(●) */
const REQUIRED = [
  'a-t-start', 'a-t-setup', 'a-t-setup-adv', 'a-t-lobby', 'a-t-ready', 'a-t-card-notdone', 'a-t-round-free', 'a-t-help-filter', 'a-t-paused',
  'a-t-ws-W01', 'a-t-wrap-awards', 'a-t-wrap-after',
  'a-tv-code', 'a-tv-slide-title', 'a-tv-slide-body', 'a-tv-map', 'a-tv-awards',
  'a-s-title', 'a-s-entry', 'a-s-found', 'a-s-concept-tv', 'a-s-card-done', 'a-s-ws-W01', 'a-s-map-free', 'a-s-port', 'a-s-buy', 'a-s-pick-sail',
  'a-s-arrived', 'a-s-sell', 'a-s-sold', 'a-s-fare-paid', 'a-s-paused', 'a-s-ti-1', 'a-s-ti-2', 'a-s-ti-3', 'a-s-ws-W03', 'a-s-dex', 'a-s-awards',
  'b-t-setup', 'b-s-mission-first', 'b-s-ws-W05',
];
/** shotlist.md 선택(○) */
const OPTIONAL = [
  'a-t-title', 'a-t-card-alldone', 'a-t-ended', 'a-tv-paused', 'a-tv-ws', 'a-s-prep', 'a-s-bk', 'a-s-tutorial', 'a-s-map-loop', 'a-s-ws-W04', 'a-s-letter',
  'b-tv-slide', 'b-s-factory', 'b-s-map-free', 'b-s-ws-W06', 'b-t-ws-W05',
  // (작업 158 뒤 메인 추가 지시) 공용 화면 ㉮·㉯ 나라 이야기 결과 장면
  'a-tv-ti-result',
];

const look = (loc: Locator, text?: string, noCoverCheck?: boolean): MarkSpec => ({ loc, kind: 'look', text, noCoverCheck });
const press = (loc: Locator, text?: string, noCoverCheck?: boolean): MarkSpec => ({ loc, kind: 'press', text, noCoverCheck });

const vis = (l: Locator) => l.first().isVisible().catch(() => false);

test('설명 영상 v2 촬영 — 판 A(1차시 25분)·판 B(2차시 25분)', async () => {
  test.setTimeout(80 * 60_000);
  const t0 = Date.now();
  // 이전 실행의 그림 지우기(이 촬영의 결과만 — 다시 돌리면 같은 목록)
  const rawDir = join(OUT, 'raw');
  if (existsSync(rawDir)) for (const f of readdirSync(rawDir)) if (f.endsWith('.png')) await rm(join(rawDir, f), { force: true });
  const book = new ShotBook(OUT);
  const warn: string[] = [];
  const checks: Record<string, unknown> = {};
  const privacy: { id: string; instagram: boolean; atHandle: boolean; names: string[]; badNames: string[] }[] = [];
  const timing: Record<string, number> = {};
  let relay: RelayProcess | null = null;
  let site: GuideSite | null = null;
  let browser: Browser | null = null;
  const mark = (k: string) => (timing[k] = Math.round((Date.now() - t0) / 1000));

  // ── 찍기(실패해도 계속) ──
  const snap = async (p: Page, id: string, who: string, marks: (Locator | MarkSpec)[] = [], o: { settleMs?: number; alt?: (Locator | MarkSpec)[] } = {}): Promise<boolean> => {
    try {
      await book.shot(p, id, who, marks, { settleMs: o.settleMs });
    } catch (e) {
      const msg = String((e as Error).message ?? e).split('\n')[0];
      if (o.alt) {
        try {
          await book.shot(p, id, who, o.alt, { settleMs: o.settleMs });
          warn.push(`${id}: 처음 표시 목록으로 못 찍어 줄인 목록으로 찍음 (${msg})`);
        } catch (e2) {
          warn.push(`${id}: 못 찍음 — ${String((e2 as Error).message ?? e2).split('\n')[0]}`);
          return false;
        }
      } else {
        warn.push(`${id}: 못 찍음 — ${msg}`);
        return false;
      }
    }
    // TV: 교사 문맥(dsf 2)에서 그렸으므로 1920×1080으로 줄여 dsf 1로 맞춘다(좌표는 CSS px 그대로)
    if (who === WHO_TV) {
      const rec = book.records[book.records.length - 1]!;
      if (rec.dsf !== 1) {
        const file = join(OUT, rec.file);
        const buf = await sharp(file).resize({ width: rec.vw, height: rec.vh, kernel: 'lanczos3' }).png().toBuffer();
        writeFileSync(file, buf);
        rec.dsf = 1;
        book.save();
      }
    }
    // 개인정보·표기 검사(DOM 글자)
    try {
      const txt = await p.evaluate(() => document.body.innerText);
      const names = await p
        .locator('[data-testid="cell-company"]')
        .evaluateAll((els) => els.map((e) => (e as HTMLElement).innerText.trim()).filter(Boolean))
        .catch(() => [] as string[]);
      const bad = names.filter((n) => !NAMES.some((x) => n.includes(x)));
      privacy.push({ id, instagram: /instagram|인스타/i.test(txt), atHandle: /@hanuipyo/i.test(txt), names, badNames: bad });
    } catch {
      /* 페이지가 닫히는 중 */
    }
    return true;
  };

  try {
    // 금지 포트를 피해 중계 서버 포트 고르기
    let rp = await freePort();
    while (BANNED_PORTS.has(rp)) rp = await freePort();
    relay = await startRelayProcess({ port: rp });
    site = await startGuideSite({ dist: join(ROOT, 'dist'), relayPort: relay.port });
    if (BANNED_PORTS.has(site.port)) throw new Error(`정적 서버가 금지 포트 ${site.port}를 받음 — GUIDE_PORT를 바꿔 주세요`);
    if (!site.pretty) warn.push(`80번 포트를 못 써 주소가 ${site.host}로 보여요`);
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
    const ctxOf = async (viewport: { width: number; height: number }, dsf: number): Promise<BrowserContext> => {
      const ctx = await env.browser.newContext({ baseURL: env.base, viewport, deviceScaleFactor: dsf });
      await env.clock.attach(ctx);
      env.contexts.push(ctx);
      return ctx;
    };
    /** 교사 문맥 안의 공용 화면 창을 1920×1080 · dsf 1로 */
    const tvMetrics = async (p: Page) => {
      await p.setViewportSize(TV);
      const cdp = await p.context().newCDPSession(p);
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: TV.width, height: TV.height, deviceScaleFactor: 1, mobile: false });
      await p.waitForTimeout(300);
    };
    const slow = (sp = 0.3) => clock.setSpeed(sp);
    const ff = (check: () => Promise<boolean>, label: string, o: { speed?: number; maxFastMs?: number } = {}) =>
      clock.fastForwardUntil(check, { speed: o.speed ?? 6, maxFastMs: o.maxFastMs ?? 20 * 60_000, label }).then(
        () => true,
        async (e) => {
          warn.push(`빨리 감기 실패(${label}): ${String((e as Error).message ?? e).split('\n')[0]}`);
          let n = 0;
          for (const c of env.contexts) for (const pg of c.pages()) if (!pg.url().includes('__vbots')) await pg.screenshot({ path: join(OUT, `_ff-${label.replace(/[^\w가-힣]+/g, '_')}-${++n}.png`) }).catch(() => undefined);
          return false;
        },
      );
    const vbotsJs = await buildVideoBots();
    const openBotsPage = async (ctx: BrowserContext): Promise<Page> => {
      site!.addFile('__vbots.html', '<!doctype html><meta charset="utf-8"><title>bots</title><pre id="out">…</pre><script type="module" src="./__vbots.js"></script>', 'text/html; charset=utf-8');
      site!.addFile('__vbots.js', vbotsJs, 'text/javascript; charset=utf-8');
      const p = await ctx.newPage();
      await p.goto('./__vbots.html');
      await p.waitForFunction(() => document.getElementById('out')?.textContent === 'bots ready');
      return p;
    };
    const BOT_SEATS = [
      { seat: 3, name: '별빛상회' },
      { seat: 12, name: '파도상회' },
      { seat: 18, name: '고래상회' },
    ];

    /** 학생 화면 정리(가벼운 창 닫기 · 카드 확인 · 학습지 다 썼어요) — 빨리 감는 동안 부른다 */
    const tidy = async (s: Page, o: { ws?: boolean; cards?: boolean; quiz?: boolean; missions?: boolean } = {}) => {
      for (const id of ['port-card-ok', 'concept-ok', 'tutorial-skip', 'tutorial-close', 'catchup-ok', 'catchup-next', 'event-result-close', 'factory-cycle-ok']) {
        const b = s.getByTestId(id).first();
        if (await b.isVisible().catch(() => false)) await b.click({ timeout: 2000 }).catch(() => undefined);
      }
      if (o.cards !== false) {
        const sels = ['[data-testid="event-card"] [data-testid="card-confirm"]', '[data-testid="event-panel"] [data-testid="card-confirm"]'];
        if (o.missions !== false) sels.push('[data-testid="mission-panel"] [data-testid="card-confirm"]');
        for (const sel of sels) {
          const b = s.locator(sel).first();
          if ((await b.isVisible().catch(() => false)) && (await b.isEnabled().catch(() => false))) await b.click({ timeout: 2000 }).catch(() => undefined);
        }
      }
      if (o.ws) {
        const d = s.getByTestId('worksheet-done');
        if ((await d.isVisible().catch(() => false)) && (await d.isEnabled().catch(() => false))) await d.click({ timeout: 2000 }).catch(() => undefined);
      }
      if (o.quiz !== false) {
        const q = s.locator('[data-testid="quiz-card"] button[data-testid^="quiz-CQ-"]:not([disabled])').first();
        if (await q.isVisible().catch(() => false)) await q.click({ timeout: 2000 }).catch(() => undefined);
      }
      // 미니게임(벽란도 등)이 열려 있으면 끝까지
      const mg = s.getByTestId('minigame');
      if (await mg.isVisible().catch(() => false)) {
        const id = await mg.getAttribute('data-event').catch(() => null);
        if (id && id !== 'L1-E5') await finishMinigame(s).catch(() => undefined);
      }
    };
    const wsIds = (s: Page) => s.locator('[data-testid="worksheet-row"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-id') ?? ''));
    const nowState = (t: Page) => t.getByTestId('now-card').getAttribute('data-state').catch(() => null);
    const nowNotDone = async (t: Page) => ((await t.getByTestId('now-not-done').first().innerText().catch(() => '')) ?? '').trim();

    // ═════════════════════════ 판 A — 1차시 25분 ═════════════════════════
    mark('A 시작');
    const tctx = await ctxOf(PC, 2);
    const t = await tctx.newPage();
    watchErrors(t, 'teacher', env.errors);
    await t.goto('./');
    await expect(t.getByTestId('route-title')).toBeVisible();
    await snap(t, 'a-t-title', WHO_T, [press(t.getByRole('link', { name: '선생님으로 시작' }))]);
    await t.getByRole('link', { name: '선생님으로 시작' }).click();
    await expect(t.getByTestId('teacher-start')).toBeVisible();
    {
      const marks: MarkSpec[] = [press(t.getByTestId('worksheet-pdf-toggle')), press(t.getByTestId('btn-new'))];
      if (await t.getByTestId('guide-pdf-links').count()) marks.push(look(t.getByTestId('guide-pdf-links'), '공략집'));
      else warn.push('a-t-start: 공략집 링크(guide-pdf-links)가 없음');
      await snap(t, 'a-t-start', WHO_T, marks, { alt: marks.slice(0, 2) });
    }
    await t.getByTestId('btn-new').click();
    await expect(t.getByTestId('teacher-setup')).toBeVisible();
    await t.getByTestId('unit-lesson').click();
    await t.getByTestId('lesson-L1').click();
    const min25 = t.getByTestId('trade-minutes').getByRole('button', { name: '25분' });
    // 기본값이 25분이면 누르지 않아도 같다 — 영상 표시용으로 눌러 둔다(값은 그대로)
    checks['A 25분 기본 눌림(누르기 전)'] = await min25.getAttribute('aria-pressed').catch(() => null);
    await min25.click();
    await t.evaluate(() => window.scrollTo(0, 0));
    checks['A preview-voyage'] = { mode: await t.getByTestId('preview-voyage').getAttribute('data-mode').catch(() => null), text: (await t.getByTestId('preview-voyage').innerText().catch(() => '')).trim() };
    checks['A preview-ws-order'] = (await t.getByTestId('preview-ws-order').innerText().catch(() => '')).trim();
    checks['A preview-order'] = (await t.getByTestId('preview-order').innerText().catch(() => '')).trim().slice(0, 300);
    {
      const top: MarkSpec[] = [press(t.getByTestId('unit-lesson')), press(t.getByTestId('lesson-L1'), '1차시'), press(min25, '25분')];
      const prev: MarkSpec[] = [look(t.getByTestId('preview-order'), '오늘 순서'), look(t.getByTestId('preview-voyage'), '항해 방식'), look(t.getByTestId('preview-ws-order'), '학습지 순서'), press(t.getByTestId('btn-open'))];
      const okAll = await allInView(t, [...top, ...prev]);
      if (okAll) await snap(t, 'a-t-setup', WHO_T, [...top, ...prev]);
      else {
        const topIn = await inViewOnly(t, [...top, ...prev]);
        await snap(t, 'a-t-setup', WHO_T, topIn);
        await t.getByTestId('preview-ws-order').scrollIntoViewIfNeeded();
        await t.getByTestId('btn-open').scrollIntoViewIfNeeded();
        await snap(t, 'a-t-setup-preview', WHO_T, await inViewOnly(t, prev), { alt: [look(t.getByTestId('preview-ws-order'), '학습지 순서')] });
        warn.push('a-t-setup: 한 화면에 안 들어와 a-t-setup-preview(내린 화면)로 나눔');
      }
    }
    // 고급 설정 펼쳐 보기(값은 기본 그대로)
    const adv = t.getByTestId('setup-advanced');
    if ((await adv.getAttribute('open')) === null) await adv.locator(':scope > summary').click();
    await expect(adv).toHaveAttribute('open', '');
    for (const id of ['progress-mode', 'worksheet-mode', 'voyage-mode']) {
      checks[`A ${id} 선택`] = await t
        .locator(`[data-testid="${id}"] button[aria-pressed="true"]`)
        .evaluateAll((els) => els.map((e) => `${e.getAttribute('data-value')}:${(e as HTMLElement).innerText.trim()}`))
        .catch(() => []);
    }
    await t.getByTestId('progress-mode').scrollIntoViewIfNeeded();
    {
      const m = [look(t.getByTestId('progress-mode')), look(t.getByTestId('worksheet-mode')), look(t.getByTestId('voyage-mode'))];
      if (!(await allInView(t, m))) {
        await t.getByTestId('voyage-mode').evaluate((el) => el.scrollIntoView({ block: 'end' }));
      }
      await snap(t, 'a-t-setup-adv', WHO_T, m, { alt: await inViewOnly(t, m) });
    }
    await adv.locator(':scope > summary').click();
    await t.getByTestId('btn-open').click();
    await expect(t.getByTestId('room-code')).toHaveText(/^\d{6}$/, { timeout: 20_000 });
    const code = (await t.getByTestId('room-code').innerText()).trim();
    await snap(t, 'a-t-lobby', WHO_T, [look(t.getByTestId('room-code'), '방 코드'), press(t.getByTestId('now-open-screen'))]);

    // ── 공용 화면(TV) ──
    const [scr] = await Promise.all([tctx.waitForEvent('page'), t.getByTestId('now-open-screen').click()]);
    await tvMetrics(scr);
    watchErrors(scr, 'screen', env.errors);
    await expect(scr.getByTestId('route-screen')).toBeVisible();
    await expect(scr.getByTestId('screen-room-code')).toBeVisible({ timeout: 40_000 });
    checks['TV devicePixelRatio'] = await scr.evaluate(() => window.devicePixelRatio);
    await snap(scr, 'a-tv-code', WHO_TV, [look(scr.getByTestId('screen-room-code'), '방 코드'), look(scr.getByTestId('screen-qr'), 'QR 코드')]);
    await t.bringToFront();

    // ── 촬영 학생: 타이틀 → 입장 → 회사 세우기 ──
    const sctx = await ctxOf(PC, 2);
    const st = await sctx.newPage();
    watchErrors(st, 'student', env.errors);
    await st.goto('./');
    await expect(st.getByTestId('route-title')).toBeVisible();
    checks['타이틀 저작권 줄'] = await st.evaluate(() => {
      const txt = document.body.innerText;
      const m = txt.match(/Copyright[^\n]*/);
      return { line: m ? m[0] : null, instagram: /instagram|인스타/i.test(txt) };
    });
    await snap(st, 'a-s-title', WHO_S, [press(st.getByRole('link', { name: '학생으로 참여' }))]);
    await st.getByRole('link', { name: '학생으로 참여' }).click();
    await expect(st.getByTestId('student-entry')).toBeVisible();
    await st.getByTestId('entry-code').fill(code);
    await st.getByTestId('entry-seat').selectOption('7');
    await st.getByTestId('entry-name').fill('해오름무역');
    await st.getByTestId('entry-name').blur();
    await snap(st, 'a-s-entry', WHO_S, [
      press(st.getByTestId('entry-code'), '방 코드'),
      press(st.getByTestId('entry-seat'), '출석번호'),
      press(st.getByTestId('entry-name'), '회사 이름'),
      press(st.getByTestId('entry-submit')),
      look(st.getByTestId('entry-guide'), '실제 이름은 쓰지 않아요'),
    ]);
    await st.getByTestId('entry-submit').click();
    await expect(st.getByTestId('found-company')).toBeVisible({ timeout: 15_000 });
    {
      const color = st.locator('[data-testid^="found-color-"]').nth(1);
      const emblem = st.locator('[data-testid^="found-emblem-"]').nth(4);
      const avatar = st.locator('[data-testid^="found-avatar-"]').nth(1);
      await color.click();
      await emblem.click();
      await avatar.click();
      await snap(st, 'a-s-found', WHO_S, [press(color, '깃발 색'), press(emblem, '깃발 문양'), press(avatar, '선장'), press(st.getByTestId('found-submit'))], {
        alt: [press(color, '깃발 색'), press(emblem, '깃발 문양'), press(st.getByTestId('found-submit'))],
      });
    }
    await st.getByTestId('found-submit').click();
    await expect(st.getByTestId('prep-wait')).toBeVisible();
    await snap(st, 'a-s-prep', WHO_S, [look(st.getByTestId('rule-cards'), '항해 규칙')]);

    // ── 봇 3명 ──
    const botCtx = await ctxOf({ width: 800, height: 600 }, 1);
    const botsA = await openBotsPage(botCtx);
    await botsA.evaluate(([c, seats]) => window.__vbots!.start(c as string, seats as { seat: number; name: string }[], 154), [code, BOT_SEATS] as const);
    await expect(t.getByTestId('student-row')).toHaveCount(4, { timeout: 30_000 });
    await expect.poll(async () => (await nowState(t)) ?? '', { timeout: 30_000 }).toBe('ready');
    await t.bringToFront();
    await snap(t, 'a-t-ready', WHO_T, [look(t.getByTestId('student-table'), '학생 표'), press(t.getByTestId('btn-start-trade'))]);

    // ── 무역 시작 ──
    await t.getByTestId('btn-start-trade').click();
    await t.getByTestId('confirm-ok').click({ timeout: 5000 }).catch(() => undefined);
    await expect(t.getByTestId('trade-clock')).toBeVisible();
    mark('A 무역 시작');

    // 벽란도(있으면 첫 화면만 찍고 끝까지)
    await ff(async () => (await st.getByTestId('minigame').count()) > 0 || (await st.locator('[data-testid="event-card"][data-event="L1-E2"]').count()) > 0, '벽란도 또는 L1-E2', { speed: 6 });
    if ((await st.locator('[data-testid="minigame"][data-event="L1-E1"]').count()) > 0) {
      await slow(0.5);
      const tray = st.locator('[data-testid="bk-card"][data-place="tray"]').first();
      await snap(st, 'a-s-bk', WHO_S, [press(tray, '물건 카드')]);
      await finishMinigame(st).catch((e) => warn.push(`벽란도 마치기 실패: ${e}`));
    } else warn.push('a-s-bk: 벽란도 시장이 L1-E2 전에 나오지 않음');

    // ── 개념 카드 L1-E2(무역·수입·수출) ──
    const e2Card = st.locator('[data-testid="event-card"][data-event="L1-E2"]');
    await ff(async () => (await e2Card.count()) > 0, 'L1-E2 카드', { speed: 6 });
    await slow(0.3);
    mark('A L1-E2');
    const slides = scr.getByTestId('concept-slides');
    if (await slides.isVisible({ timeout: 8000 }).catch(() => false)) {
      checks['TV L1-E2 첫 장'] = { slide: await slides.getAttribute('data-slide'), total: await slides.getAttribute('data-total') };
      if ((await slides.getAttribute('data-slide')) === '0') await snap(scr, 'a-tv-slide-title', WHO_TV, [look(slides, '개념 슬라이드')], { settleMs: 900 });
      else warn.push('a-tv-slide-title: 찍을 때 이미 첫 장이 지나감');
    } else warn.push('a-tv-slide-title: TV에 concept-slides가 안 보임');
    await snap(st, 'a-s-concept-tv', WHO_S, [look(st.getByTestId('event-tv-title')), look(st.getByTestId('event-tv-note'), '도감 안내'), press(e2Card.getByTestId('card-confirm'))]);
    // 봇 3명이 모두 [다 봤어요] → "카드를 아직 안 읽은 학생 1명"
    await ff(async () => /1명/.test(await nowNotDone(t)), '카드 안 읽은 학생 1명', { speed: 1, maxFastMs: 90_000 });
    await t.bringToFront();
    checks['a-t-card-notdone now-not-done'] = await nowNotDone(t);
    await snap(t, 'a-t-card-notdone', WHO_T, [
      look(t.getByTestId('now-not-done').first(), '카드를 아직 안 읽은 학생'),
      press(t.getByTestId('btn-pause'), '잠깐 멈춤'),
      look(t.getByTestId('now-quiet-cap'), '급할 때만'),
      look(t.getByTestId('now-primary')),
      look(t.getByTestId('now-auto-hint')),
      look(t.getByTestId('tv-chip'), 'TV'),
    ]);
    // TV 정의 장(본문 첫 장)
    if (await slides.isVisible().catch(() => false)) {
      const atBody = async () => (await slides.getAttribute('data-slide').catch(() => null)) === '1';
      if (!(await atBody())) await ff(atBody, 'TV 본문 장', { speed: 1, maxFastMs: 60_000 });
      if (!(await atBody())) {
        await scr.keyboard.press('ArrowRight');
        warn.push('a-tv-slide-body: 저절로 넘어가지 않아 → 키로 한 장 넘김');
      }
      await scr.waitForTimeout(700);
      checks['TV 본문 장 글'] = (await scr.getByTestId('concept-slide').innerText().catch(() => '')).trim();
      await snap(scr, 'a-tv-slide-body', WHO_TV, [look(slides.getByTestId('card-title').first(), '제목'), look(scr.getByTestId('slide-num'), '장 번호'), look(scr.getByTestId('slide-dots'), '점 표시')], { settleMs: 700 });
    } else warn.push('a-tv-slide-body: 슬라이드가 이미 닫힘');
    // 촬영 학생 [다 봤어요]
    await st.bringToFront();
    if (await vis(e2Card.getByTestId('card-confirm'))) {
      await e2Card.getByTestId('card-confirm').click();
      const wait = st.getByTestId('round-wait-card');
      if (await wait.isVisible({ timeout: 10_000 }).catch(() => false)) {
        checks['a-s-card-done 줄'] = (await st.getByTestId('round-wait-line').innerText().catch(() => '')).trim();
        await snap(st, 'a-s-card-done', WHO_S, [look(wait, '기다림 카드'), look(st.getByTestId('round-wait-line'))]);
      } else {
        await snap(st, 'a-s-card-done', WHO_S, []);
        warn.push('a-s-card-done: round-wait-card가 안 보여 표시 없이 찍음');
      }
      await expect.poll(async () => nowNotDone(t), { timeout: 15_000 }).toMatch(/모두/).catch(() => undefined);
      checks['a-t-card-alldone now-not-done'] = await nowNotDone(t);
      if (/모두/.test(await nowNotDone(t))) await snap(t, 'a-t-card-alldone', WHO_T, [look(t.getByTestId('now-not-done').first(), '모두 카드를 읽었어요')]);
      else warn.push('a-t-card-alldone: "모두 카드를 읽었어요"가 안 보임');
    } else warn.push('a-s-card-done: 카드가 이미 닫혀 [다 봤어요]를 못 누름');

    // ── 학습지 ① ──
    const popup = st.getByTestId('worksheet-popup');
    await ff(async () => (await popup.count()) > 0, '학습지 ①', { speed: 4 });
    await slow(0.3);
    mark('A 학습지 ①');
    checks['A 첫 학습지'] = await wsIds(st);
    {
      const m: MarkSpec[] = [look(t.getByTestId('now-ws-done'), '다 쓴 학생'), look(t.getByTestId('now-ws-missing')), press(t.getByTestId('btn-pause'), '잠깐 멈춤')];
      await snap(t, 'a-t-ws-W01', WHO_T, m, { alt: [look(t.getByTestId('now-ws-done'), '다 쓴 학생'), look(t.locator('.t-now__line'))] });
      await snap(scr, 'a-tv-ws', WHO_TV, []);
    }
    await ff(async () => (await st.getByTestId('worksheet-done').isEnabled().catch(() => false)) || !(await popup.count()), '다 썼어요 켜짐 ①', { speed: 2, maxFastMs: 120_000 });
    await slow(0.3);
    if (await popup.count()) {
      checks['a-s-ws-W01 worksheet-order'] = (await st.getByTestId('worksheet-order').innerText().catch(() => '')).trim();
      await snap(st, 'a-s-ws-W01', WHO_S, [look(st.getByTestId('worksheet-head'), '학습지 번호'), look(st.getByTestId('worksheet-order'), '오늘 학습지'), press(st.getByTestId('worksheet-done')), look(st.getByTestId('worksheet-tool-logbook'))], { settleMs: 300 });
      await st.getByTestId('worksheet-done').click().catch(() => undefined);
    } else warn.push('a-s-ws-W01: [다 썼어요]가 켜지기 전에 팝업이 닫힘');

    // ── 라운드 1 ──
    await ff(async () => {
      await tidy(st, { ws: true });
      return (await nowState(t)) === 'round';
    }, '라운드 1', { speed: 6 });
    await slow(0.3);
    mark('A 라운드 1');
    // 튜토리얼(첫 라운드)
    if (await vis(st.getByTestId('tutorial'))) {
      await snap(st, 'a-s-tutorial', WHO_S, [press(st.getByTestId('tutorial-skip'))]);
      await st.getByTestId('tutorial-skip').click().catch(() => undefined);
    } else warn.push('a-s-tutorial: 첫 라운드 튜토리얼이 안 보임');
    // 봇 3명이 사고팔기를 하면 "아직 사고팔지 않은 학생 1명"
    await ff(async () => /1명/.test(await nowNotDone(t)), '사고팔지 않은 학생 1명', { speed: 1, maxFastMs: 120_000 });
    await slow(0.3);
    await t.bringToFront();
    checks['a-t-round-free now-not-done'] = await nowNotDone(t);
    await snap(t, 'a-t-round-free', WHO_T, [look(t.getByTestId('now-not-done').first(), '아직 사고팔지 않은 학생'), look(t.getByTestId('now-free-pause')), press(t.getByTestId('btn-pause'), '잠깐 멈춤')], {
      alt: [look(t.getByTestId('now-not-done').first()), press(t.getByTestId('btn-pause'), '잠깐 멈춤')],
    });
    // 도움이 필요해요 필터
    await t.getByTestId('filter-help').click();
    const row7 = t.locator('[data-testid="student-row"][data-seat="7"]');
    if (await row7.isVisible({ timeout: 3000 }).catch(() => false)) await snap(t, 'a-t-help-filter', WHO_T, [press(t.getByTestId('filter-help'), '도움이 필요해요'), look(row7, '7번 해오름무역')]);
    else {
      await snap(t, 'a-t-help-filter', WHO_T, [press(t.getByTestId('filter-help'), '도움이 필요해요')]);
      warn.push('a-t-help-filter: 도움 필터에 7번 줄이 안 보임');
    }
    checks['도움 필터 줄'] = await t.locator('[data-testid="student-row"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-seat')));
    await t.getByTestId('filter-all').click().catch(() => undefined);
    // 잠깐 멈춤
    await t.getByTestId('btn-pause').click();
    await t.getByTestId('confirm-ok').click({ timeout: 2000 }).catch(() => undefined);
    await expect(t.getByTestId('now-card')).toHaveAttribute('data-state', 'paused', { timeout: 10_000 });
    checks['멈춤 카드 줄'] = (await t.locator('.t-now__line').innerText().catch(() => '')).trim();
    await snap(t, 'a-t-paused', WHO_T, [look(t.locator('.t-now__line'), '잠깐 멈춤 중이에요'), press(t.getByTestId('btn-resume-trade'))]);
    await expect(st.getByTestId('pause-overlay')).toBeVisible({ timeout: 10_000 }).catch(() => undefined);
    await snap(st, 'a-s-paused', WHO_S, [look(st.getByTestId('pause-overlay'), '선생님을 보세요')]);
    await snap(scr, 'a-tv-paused', WHO_TV, []);
    await t.getByTestId('btn-resume-trade').click();
    await expect(t.getByTestId('now-card')).not.toHaveAttribute('data-state', 'paused', { timeout: 10_000 });
    await expect(st.getByTestId('pause-overlay')).toHaveCount(0, { timeout: 10_000 }).catch(() => undefined);

    // 학생: 해도 → 부산 항구 → 사기
    await st.bringToFront();
    await tidy(st);
    if (await st.getByTestId('port-screen').count()) await st.getByTestId('port-back').click();
    checks['a-s-map-free round-steps'] = { mode: await st.getByTestId('round-steps').getAttribute('data-mode').catch(() => null), text: (await st.getByTestId('round-steps').innerText().catch(() => '')).trim() };
    checks['a-s-map-free 항구'] = await st.locator('[data-testid="hud-port"], .st-hud__port').first().innerText().catch(() => null);
    await snap(st, 'a-s-map-free', WHO_S, [look(st.getByTestId('round-steps'), '할 일 띠'), look(st.getByTestId('hud-money')), look(st.getByTestId('hud-time'), '시간'), press(st.getByTestId('enter-port'))]);
    await st.getByTestId('enter-port').click();
    await expect(st.getByTestId('port-screen')).toBeVisible();
    await tidy(st);
    await snap(st, 'a-s-port', WHO_S, [look(st.getByTestId('port-name'), '항구 이름'), look(st.getByTestId('buy-list'), '사기'), press(st.getByTestId('tab-market'))]);
    const carCard = st.getByTestId('buy-card-car');
    const buyCard = (await carCard.count()) ? carCard : st.locator('[data-testid^="buy-card-"]:not(.is-off)').first();
    const good = ((await buyCard.getAttribute('data-testid')) ?? '').replace('buy-card-', '');
    checks['산 상품'] = good;
    const plus = st.getByTestId(`buy-${good}-plus`);
    await plus.scrollIntoViewIfNeeded().catch(() => undefined);
    await plus.click();
    await snap(st, 'a-s-buy', WHO_S, [press(plus, '+'), press(buyCard.getByTestId(`buy-${good}`), '사기'), look(st.getByTestId('hud-cargo'))]);
    await buyCard.getByTestId(`buy-${good}`).click();
    await st.waitForTimeout(800);
    await tidy(st);
    // 지도에서 포트헤들랜드
    await st.getByTestId('port-back').click();
    await tidy(st);
    const hit = st.locator('.wm-port[data-port="PHE"] .wm-port-hit');
    {
      const box = await hit.boundingBox();
      if (!box || box.y + box.height / 2 > PC.height - 100 || box.x < 0 || box.x > PC.width) await st.getByRole('button', { name: '전체 보기' }).click();
      await st.waitForTimeout(700);
    }
    await hit.click();
    await expect(st.getByTestId('pick-panel')).toHaveAttribute('data-kind', 'ok');
    checks['a-s-pick-sail pick-body'] = (await st.getByTestId('pick-body').innerText().catch(() => '')).trim();
    await snap(st, 'a-s-pick-sail', WHO_S, [look(st.getByTestId('pick-body'), '운항비 안내'), press(st.getByTestId('pick-sail'), '여기로 출발')]);
    await slow(0.2);
    await st.getByTestId('pick-sail').click();
    await expect(st.locator('[data-testid="port-screen"][data-port="PHE"]')).toBeVisible({ timeout: 15_000 });
    {
      const arrive = st.getByTestId('toast').filter({ hasText: '도착' });
      const m: MarkSpec[] = [];
      if (await vis(arrive)) m.push(look(arrive.first(), '도착 토스트', true));
      else warn.push('a-s-arrived: 도착 토스트가 안 보임(찍을 때)');
      m.push(look(st.getByTestId('port-name'), '항구 이름', true), look(st.getByTestId('hud-fare-due'), '낼 운항비'));
      checks['a-s-arrived hud-fare-due'] = (await st.getByTestId('hud-fare-due').innerText().catch(() => '')).trim();
      await snap(st, 'a-s-arrived', WHO_S, m, { settleMs: 250, alt: [look(st.getByTestId('port-name'), '항구 이름', true), look(st.getByTestId('hud-fare-due'), '낼 운항비')] });
    }
    await slow(0.3);
    await tidy(st);
    const sellCard = st.locator('[data-testid^="sell-card-"]:not(.is-off)').first();
    if (await sellCard.count()) {
      const sg = ((await sellCard.getAttribute('data-testid')) ?? '').replace('sell-card-', '');
      checks['판 상품'] = sg;
      await sellCard.scrollIntoViewIfNeeded().catch(() => undefined);
      await snap(st, 'a-s-sell', WHO_S, [look(sellCard, '판매 카드'), press(sellCard.getByTestId(`sell-${sg}`), '팔기')]);
      await slow(0.2);
      await sellCard.getByTestId(`sell-${sg}`).click();
      const profit = st.getByTestId('toast').filter({ hasNotText: '도착' }).last();
      await profit.waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined);
      checks['이익 토스트'] = (await profit.innerText().catch(() => '')).trim();
      const m: MarkSpec[] = [look(st.getByTestId('hud-money'))];
      if (await vis(profit)) m.push(look(profit, '이익 토스트', true));
      else warn.push('a-s-sold: 이익 토스트가 안 보임');
      await snap(st, 'a-s-sold', WHO_S, m, { settleMs: 250, alt: [look(st.getByTestId('hud-money'))] });
      await slow(0.3);
    } else warn.push('a-s-sell: 팔 수 있는 판매 카드가 없음');
    await tidy(st);
    await st.getByTestId('port-back').click().catch(() => undefined);
    await tidy(st);
    // TV 해도: 라운드 첫머리에는 소식 카드가 떠 있다 — 지금 해도면 찍고, 아니면 뒤 라운드에서 찍는다(아래 두 나라 가는 길)
    let tvMapShot = false;
    const tvMap = async () => {
      tvMapShot = true;
      await slow(0.3);
      checks['TV 해도 줄'] = (await scr.getByTestId('map-ready').innerText().catch(() => '')).trim();
      checks['TV 해도 장면 때 라운드'] = (await t.getByTestId('round-info').innerText().catch(() => '')).trim();
      await snap(scr, 'a-tv-map', WHO_TV, [look(scr.getByTestId('map-ready'), '이번 라운드 항해 n번')]);
    };
    if (await vis(scr.getByTestId('map-ready'))) await tvMap();
    else {
      // 1차시 라운드에는 라운드 소식 카드(강추위·흑연)가 라운드 내내 열려 있어 TV가 '자동'이면 소식 카드를 보여 준다.
      // 교사가 [TV 화면 ▾] → 장면 고르기 '해도'로 바꿔 찍고, 다시 '자동'으로 돌린다.
      try {
        await t.getByTestId('tv-menu').click();
        await t.getByTestId('scene-select').selectOption('map');
        await t.getByTestId('tv-menu').click().catch(() => undefined);
        await scr.getByTestId('map-ready').waitFor({ state: 'visible', timeout: 10_000 });
        await tvMap();
        warn.push("a-tv-map: 라운드 소식 카드가 열려 있어 TV 자동 장면이 해도가 아님 → 교사 [TV 화면 ▾] 장면 고르기 '해도'로 찍고 '자동'으로 되돌림");
      } catch (e) {
        warn.push(`a-tv-map: 해도 장면으로 못 바꿈 — ${String((e as Error).message ?? e).split('\n')[0]}`);
      } finally {
        if (!(await vis(t.getByTestId('scene-select')))) await t.getByTestId('tv-menu').click().catch(() => undefined);
        await t.getByTestId('scene-select').selectOption('auto').catch(() => undefined);
        await t.getByTestId('tv-menu').click().catch(() => undefined);
      }
    }
    if (await vis(st.getByTestId('round-step-loop'))) await snap(st, 'a-s-map-loop', WHO_S, [look(st.getByTestId('round-step-loop'), '도착하면 바로 ①부터 다시')]);
    // 도감 → 개념 '무역·수입·수출'
    try {
      await st.getByTestId('hud-dex').click();
      await expect(st.getByTestId('dex')).toBeVisible();
      await st.getByTestId('dex-tab-concepts').click();
      const card = st.locator('[data-testid="dex-grid"] button.st-dex-card:not([disabled])').filter({ hasText: /무역.*수입.*수출|수입.*수출/ }).first();
      if (await card.count()) {
        await card.click();
        await expect(st.getByTestId('dex-detail')).toBeVisible();
        checks['도감 카드'] = (await st.getByTestId('dex-detail').innerText().catch(() => '')).trim().slice(0, 200);
        await snap(st, 'a-s-dex', WHO_S, [look(st.getByTestId('dex-detail'), "도감 '무역·수입·수출'")]);
      } else {
        checks['도감 개념 카드들'] = await st.locator('[data-testid="dex-grid"] button').evaluateAll((els) => els.map((e) => `${(e as HTMLButtonElement).disabled ? '×' : '○'}${(e as HTMLElement).innerText.split('\n')[0]}`));
        await snap(st, 'a-s-dex', WHO_S, [look(st.getByTestId('dex-grid'), '도감 개념')]);
        warn.push("a-s-dex: '무역·수입·수출' 카드를 못 찾아 개념 탭 목록으로 찍음");
      }
      for (let i = 0; i < 3 && (await st.getByTestId('dex').count()); i++) {
        await st.keyboard.press('Escape');
        await st.waitForTimeout(200);
      }
    } catch (e) {
      warn.push(`a-s-dex: ${String((e as Error).message ?? e).split('\n')[0]}`);
    }
    await tidy(st);

    // ── 라운드 끝 운항비 정산 토스트 ──
    const fareToast = st.getByTestId('toast').filter({ hasText: /운항비 .*냈어요/ });
    // 라운드 끝 20초 전까지는 빨리, 그 뒤는 거의 실제 속도로(토스트 3.5초를 놓치지 않게)
    const roundLeft = async () => Number((await st.getByTestId('hud-time').innerText().catch(() => '')).match(/(\d+):(\d\d)/)?.slice(1).reduce((m, x, i) => (i ? m * 60 + Number(x) : Number(x)), 0) ?? NaN);
    await ff(async () => (await fareToast.count()) > 0 || (await roundLeft()) <= 20, '라운드 1 끝 20초 전', { speed: 6, maxFastMs: 10 * 60_000 });
    if (!(await fareToast.count())) await ff(async () => (await fareToast.count()) > 0, '운항비 정산 토스트', { speed: 0.8, maxFastMs: 3 * 60_000 });
    mark('A 라운드 1 끝');
    if (await vis(fareToast)) {
      checks['운항비 토스트'] = (await fareToast.first().innerText().catch(() => '')).trim();
      await snap(st, 'a-s-fare-paid', WHO_S, [look(fareToast.first(), '운항비 토스트', true), look(st.getByTestId('hud-money'))], { settleMs: 200 });
    } else warn.push('a-s-fare-paid: 토스트를 찍기 전에 사라짐');
    await slow(0.3);

    // ── 두 나라 이야기까지(학습지 ②·카드는 촬영 학생도 처리) — 가는 길에 편지가 오면 찍는다 ──
    let letterShot = false;
    const ti = st.locator('[data-testid="minigame"][data-event="L1-E5"]');
    for (let guard = 0; guard < 10; guard++) {
      await ff(async () => {
        if ((await ti.count()) > 0) return true;
        if (!tvMapShot && (await vis(scr.getByTestId('map-ready')))) return true;
        await tidy(st, { ws: true });
        return !letterShot && (await st.getByTestId('hud-letters').getAttribute('data-count').catch(() => '0')) !== '0' && (await nowState(t)) === 'round';
      }, '두 나라 이야기', { speed: 6 });
      if (await ti.count()) break;
      if (!tvMapShot && (await vis(scr.getByTestId('map-ready')))) {
        await tvMap();
        continue;
      }
      if (!letterShot) {
        letterShot = true;
        await slow(0.3);
        try {
          await st.getByTestId('hud-letters').click();
          const item = st.getByTestId('letter-item').first();
          await item.click({ timeout: 5000 });
          const choice = st.getByTestId('letter-choice').first();
          await choice.waitFor({ state: 'visible', timeout: 5000 });
          await snap(st, 'a-s-letter', WHO_S, [look(st.getByTestId('letter-question'), '편지 질문'), press(choice, '답 하나')]);
          await choice.click();
          await st.waitForTimeout(500);
          for (const id of ['letter-ack', 'letter-close']) if (await vis(st.getByTestId(id))) await st.getByTestId(id).click().catch(() => undefined);
          await st.keyboard.press('Escape').catch(() => undefined);
        } catch (e) {
          warn.push(`a-s-letter: ${String((e as Error).message ?? e).split('\n')[0]}`);
          await st.keyboard.press('Escape').catch(() => undefined);
        }
      }
    }
    if (!letterShot) warn.push('a-s-letter: 두 나라 이야기 전까지 편지가 오지 않음');
    if (!tvMapShot) {
      await snap(scr, 'a-tv-map', WHO_TV, []);
      warn.push('a-tv-map: 두 나라 이야기 전까지 TV 해도 장면(map-ready)을 못 봄 — 그때 장면을 표시 없이 찍음');
    }
    if (await ti.count()) {
      await slow(0.4);
      mark('A 두 나라');
      await snap(st, 'a-s-ti-1', WHO_S, [look(st.getByTestId('ti-scene-title'), '장면 제목'), press(st.getByTestId('ti-focus'))]);
      checks['두 나라 제목'] = (await st.getByTestId('ti-scene-title').innerText().catch(() => '')).trim();
      await st.getByTestId('ti-focus').click();
      await st.waitForTimeout(800);
      await snap(st, 'a-s-ti-2', WHO_S, [look(st.getByTestId('ti-bar').first(), '모자라요 막대'), press(st.getByTestId('ti-trade'))], { alt: [press(st.getByTestId('ti-trade'))] });
      await st.getByTestId('ti-trade').click();
      await st.waitForTimeout(800);
      await snap(st, 'a-s-ti-3', WHO_S, [look(st.getByTestId('ti-arrows').first(), '바꾸기 화살표'), look(st.getByTestId('ti-end'), '끝 문장'), press(st.getByTestId('ti-done'))], { alt: [press(st.getByTestId('ti-done'))] });
      await st.getByTestId('ti-done').click();
      await expect(ti).toHaveCount(0, { timeout: 10_000 }).catch(() => warn.push('두 나라 [다 했어요] 뒤 미니게임이 바로 닫히지 않음'));
      // 공용 화면 두 나라 결과(활동이 닫히면 TV에 결과 막대)
      const tiRes = scr.locator('[data-testid="scene-minigameResult"][data-event="L1-E5"]');
      await ff(async () => (await tiRes.count()) > 0, 'TV 두 나라 결과', { speed: 2, maxFastMs: 180_000 });
      await slow(0.3);
      if (await tiRes.count()) {
        checks['TV 두 나라 결과 글'] = (await tiRes.innerText().catch(() => '')).trim().slice(0, 300);
        await snap(scr, 'a-tv-ti-result', WHO_TV, [look(scr.getByTestId('mg-result-bars'), '결과 막대')], { settleMs: 1200, alt: [] });
      } else warn.push('a-tv-ti-result: TV에 두 나라 결과 장면이 나오지 않음');
    } else warn.push('a-s-ti-1~3: 두 나라 이야기가 나오지 않음');

    // ── 학습지 ③ ──
    await ff(async () => {
      if ((await popup.count()) > 0 && (await wsIds(st)).includes('W03')) return true;
      if ((await popup.count()) > 0) await tidy(st, { ws: true });
      else await tidy(st);
      return false;
    }, '학습지 ③', { speed: 4 });
    await slow(0.3);
    mark('A 학습지 ③');
    if ((await popup.count()) > 0) {
      checks['a-s-ws-W03 worksheet-order'] = (await st.getByTestId('worksheet-order').innerText().catch(() => '')).trim();
      const helper = st.getByTestId('worksheet-helper').first();
      const m: MarkSpec[] = [look(st.getByTestId('worksheet-order'), '오늘 학습지')];
      if (await vis(helper)) m.push(look(helper, '[내 기록] 도우미'));
      else m.push(look(st.getByTestId('worksheet-tool-logbook')));
      await snap(st, 'a-s-ws-W03', WHO_S, m, { settleMs: 300 });
      await ff(async () => (await st.getByTestId('worksheet-done').isEnabled().catch(() => false)) || !(await popup.count()), '다 썼어요 켜짐 ③', { speed: 2, maxFastMs: 120_000 });
      await st.getByTestId('worksheet-done').click({ timeout: 3000 }).catch(() => undefined);
    }
    // ── 학습지 ④(선택) ──
    await ff(async () => {
      if ((await popup.count()) > 0 && (await wsIds(st)).includes('W04')) return true;
      if ((await popup.count()) > 0) await tidy(st, { ws: true });
      else await tidy(st);
      return (await st.getByTestId('trade-over').count()) > 0 || (await st.getByTestId('wrap-awards').count()) > 0;
    }, '학습지 ④', { speed: 6 });
    await slow(0.3);
    if ((await popup.count()) > 0 && (await wsIds(st)).includes('W04')) {
      checks['a-s-ws-W04 worksheet-order'] = (await st.getByTestId('worksheet-order').innerText().catch(() => '')).trim();
      await snap(st, 'a-s-ws-W04', WHO_S, [look(st.getByTestId('worksheet-order'), '오늘 학습지')], { settleMs: 300 });
      await ff(async () => (await st.getByTestId('worksheet-done').isEnabled().catch(() => false)) || !(await popup.count()), '다 썼어요 켜짐 ④', { speed: 2, maxFastMs: 120_000 });
      await st.getByTestId('worksheet-done').click({ timeout: 3000 }).catch(() => undefined);
    } else warn.push('a-s-ws-W04: 학습지 ④ 팝업을 못 봄');

    // ── 마무리 ──
    await ff(async () => {
      await tidy(st, { ws: true });
      return (await st.getByTestId('wrap-awards').count()) > 0;
    }, '마무리 시상', { speed: 6 });
    await slow(0.5);
    mark('A 마무리');
    await t.bringToFront();
    await expect(t.getByTestId('now-card')).toHaveAttribute('data-state', 'wrapup', { timeout: 15_000 }).catch(() => undefined);
    await snap(t, 'a-t-wrap-awards', WHO_T, [look(t.locator('.t-now__line')), look(t.getByTestId('now-wrap-next'))]);
    await ff(async () => (await scr.getByTestId('route-screen').getAttribute('data-scene')) === 'awards', 'TV 시상', { speed: 4, maxFastMs: 60_000 });
    await slow(0.5);
    await snap(scr, 'a-tv-awards', WHO_TV, [], { settleMs: 1500 });
    await snap(st, 'a-s-awards', WHO_S, [look(st.getByTestId('wrap-metrics'), '결산'), look(st.getByTestId('wrap-my-awards'), '받은 상')]);
    // 마지막 단계(결과 저장·수업 끝내기)까지 [다음으로]
    for (let i = 0; i < 6; i++) {
      const next = t.getByTestId('now-wrap-next');
      if (!(await vis(next))) break;
      await next.click();
      await t.waitForTimeout(1200);
      await t.getByTestId('confirm-ok').click({ timeout: 1000 }).catch(() => undefined);
    }
    if ((await vis(t.getByTestId('now-save-result'))) && (await vis(t.getByTestId('now-end-session')))) {
      await snap(t, 'a-t-wrap-after', WHO_T, [press(t.getByTestId('now-save-result')), press(t.getByTestId('now-end-session'))]);
    } else warn.push('a-t-wrap-after: [결과 파일 저장]·[수업 끝내기]가 함께 보이는 단계를 못 찾음');
    // 수업 끝내기(확인 2번)
    try {
      await t.getByTestId('now-end-session').click();
      await t.getByTestId('confirm-ok').click();
      await t.getByTestId('confirm-ok').click();
      await expect(t.getByTestId('ended')).toBeVisible({ timeout: 10_000 });
      await snap(t, 'a-t-ended', WHO_T, [look(t.locator('.t-now__line'))]);
    } catch (e) {
      warn.push(`a-t-ended: ${String((e as Error).message ?? e).split('\n')[0]}`);
    }
    await botsA.evaluate(() => window.__vbots?.stop()).catch(() => undefined);
    await botsA.close().catch(() => undefined);
    await scr.close().catch(() => undefined);
    await sctx.close().catch(() => undefined);
    mark('A 끝');

    // ═════════════════════════ 판 B — 2차시 25분 ═════════════════════════
    await clock.setSpeed(1);
    await t.goto('./#/teacher');
    await t.reload();
    await expect(t.getByTestId('teacher-start')).toBeVisible({ timeout: 20_000 });
    await t.getByTestId('btn-new').click();
    await expect(t.getByTestId('teacher-setup')).toBeVisible();
    await t.getByTestId('unit-lesson').click();
    await t.getByTestId('lesson-L2').click();
    const min25b = t.getByTestId('trade-minutes').getByRole('button', { name: '25분' });
    await min25b.click();
    await t.evaluate(() => window.scrollTo(0, 0));
    checks['B preview-voyage'] = { mode: await t.getByTestId('preview-voyage').getAttribute('data-mode').catch(() => null), text: (await t.getByTestId('preview-voyage').innerText().catch(() => '')).trim() };
    checks['B preview-ws-order'] = (await t.getByTestId('preview-ws-order').innerText().catch(() => '')).trim();
    for (const id of ['progress-mode', 'worksheet-mode', 'voyage-mode']) {
      checks[`B ${id} 선택`] = await t
        .locator(`[data-testid="${id}"] button[aria-pressed="true"]`)
        .evaluateAll((els) => els.map((e) => `${e.getAttribute('data-value')}:${(e as HTMLElement).innerText.trim()}`))
        .catch(() => []);
    }
    {
      const m = [press(t.getByTestId('lesson-L2'), '2차시'), look(t.getByTestId('preview-ws-order'), '학습지 순서'), look(t.getByTestId('preview-voyage'), '항해 방식')];
      if (!(await allInView(t, m))) await t.getByTestId('preview-ws-order').evaluate((el) => el.scrollIntoView({ block: 'end' }));
      await snap(t, 'b-t-setup', WHO_T, m, { alt: await inViewOnly(t, m) });
    }
    await t.getByTestId('btn-open').click();
    await expect(t.getByTestId('room-code')).toHaveText(/^\d{6}$/, { timeout: 20_000 });
    const codeB = (await t.getByTestId('room-code').innerText()).trim();
    const [scrB] = await Promise.all([tctx.waitForEvent('page'), t.getByTestId('now-open-screen').click()]);
    await tvMetrics(scrB);
    watchErrors(scrB, 'screenB', env.errors);
    await expect(scrB.getByTestId('route-screen')).toBeVisible();
    const sctxB = await ctxOf(PC, 2);
    const sb = await sctxB.newPage();
    watchErrors(sb, 'studentB', env.errors);
    await sb.goto('./#/play');
    await expect(sb.getByTestId('student-entry')).toBeVisible();
    await sb.getByTestId('entry-code').fill(codeB);
    await sb.getByTestId('entry-seat').selectOption('7');
    await sb.getByTestId('entry-name').fill('해오름무역');
    await sb.getByTestId('entry-submit').click();
    await expect(sb.getByTestId('found-company')).toBeVisible({ timeout: 15_000 });
    await sb.locator('[data-testid^="found-color-"]').nth(1).click();
    await sb.locator('[data-testid^="found-emblem-"]').nth(4).click();
    await sb.getByTestId('found-submit').click();
    await expect(sb.getByTestId('prep-wait')).toBeVisible();
    const botsB = await openBotsPage(botCtx);
    await botsB.evaluate(([c, seats]) => window.__vbots!.start(c as string, seats as { seat: number; name: string }[], 155), [codeB, BOT_SEATS] as const);
    await expect(t.getByTestId('student-row')).toHaveCount(4, { timeout: 30_000 });
    await expect.poll(async () => (await nowState(t)) ?? '', { timeout: 30_000 }).toBe('ready');
    await t.getByTestId('btn-start-trade').click();
    await t.getByTestId('confirm-ok').click({ timeout: 5000 }).catch(() => undefined);
    await expect(t.getByTestId('trade-clock')).toBeVisible();
    mark('B 무역 시작');
    // L2-E2 부산 공장 개장 슬라이드(선택) 또는 라운드 1 임무 패널
    const slidesB = scrB.getByTestId('concept-slides');
    const mission = sb.getByTestId('mission-panel');
    let tvSlideShot = false;
    await ff(async () => {
      if (!tvSlideShot && (await slidesB.count()) > 0 && (await slidesB.getAttribute('data-event').catch(() => '')) === 'L2-E2') return true;
      if ((await mission.count()) > 0) return true;
      await tidy(sb, { ws: true, missions: false });
      return (await mission.count()) > 0;
    }, 'L2-E2 또는 임무 패널', { speed: 6 });
    if (!(await mission.count()) && (await slidesB.count()) > 0) {
      await slow(0.4);
      tvSlideShot = true;
      await snap(scrB, 'b-tv-slide', WHO_TV, [look(slidesB, '개념 슬라이드')], { settleMs: 800 });
      await ff(async () => {
        if ((await mission.count()) > 0) return true;
        await tidy(sb, { ws: true, missions: false });
        return (await mission.count()) > 0;
      }, '임무 패널', { speed: 6 });
    }
    if (!tvSlideShot) warn.push('b-tv-slide: L2-E2 슬라이드를 못 봄');
    await slow(0.3);
    mark('B 임무 패널');
    if (await mission.count()) {
      checks['b-s-mission-first'] = (await sb.getByTestId('mission-first').innerText().catch(() => '')).trim();
      const opt = sb.locator('.ev-missions__opt').first();
      const m: MarkSpec[] = [look(sb.getByTestId('mission-first'), '먼저 할 일'), look(sb.getByTestId('mission-start-cargo'))];
      if (await vis(opt)) m.push(look(opt, '· 시간 나면'));
      else warn.push("b-s-mission-first: '· 시간 나면' 꼬리표가 안 보임");
      m.push(press(mission.getByTestId('card-confirm'), '확인'));
      await snap(sb, 'b-s-mission-first', WHO_S, m, { alt: [look(sb.getByTestId('mission-first'), '먼저 할 일'), press(mission.getByTestId('card-confirm'), '확인')] });
      await mission.getByTestId('card-confirm').click().catch(() => undefined);
    } else warn.push('b-s-mission-first: 임무 패널이 안 보임');
    // 부산 공장(선택)
    try {
      await tidy(sb);
      if (!(await sb.getByTestId('port-screen').count())) await sb.getByTestId('enter-port').click();
      await expect(sb.getByTestId('port-screen')).toBeVisible();
      await tidy(sb);
      await sb.getByTestId('tab-factory').click();
      await expect(sb.getByTestId('factory')).toBeVisible();
      const make = sb.locator('[data-testid^="make-"]:not([disabled])').filter({ hasNotText: /^[+−-]$/ }).first();
      const rec = sb.locator('[data-testid^="recipe-"]:not(.is-off)').first();
      const rid = ((await rec.getAttribute('data-recipe').catch(() => null)) ?? '').trim();
      const oil = sb.getByTestId('make-oilp');
      const btn = (await oil.count()) ? oil : rid ? sb.getByTestId(`make-${rid}`) : make;
      checks['공장 만들기 버튼'] = (await oil.count()) ? 'make-oilp' : rid ? `make-${rid}` : await make.getAttribute('data-testid').catch(() => null);
      await btn.scrollIntoViewIfNeeded().catch(() => undefined);
      await snap(sb, 'b-s-factory', WHO_S, [press(btn, '만들기')]);
      await btn.click().catch(() => undefined);
      await sb.waitForTimeout(800);
      await tidy(sb);
      await sb.getByTestId('port-back').click().catch(() => undefined);
      await tidy(sb);
    } catch (e) {
      warn.push(`b-s-factory: ${String((e as Error).message ?? e).split('\n')[0]}`);
    }
    if (await vis(sb.getByTestId('round-steps'))) await snap(sb, 'b-s-map-free', WHO_S, [look(sb.getByTestId('round-steps'), '할 일 띠')]);
    else warn.push('b-s-map-free: 할 일 띠가 안 보임');
    // 학습지 ⑤
    const popupB = sb.getByTestId('worksheet-popup');
    await ff(async () => {
      if ((await popupB.count()) > 0 && (await wsIds(sb)).includes('W05')) return true;
      if ((await popupB.count()) > 0) await tidy(sb, { ws: true });
      else await tidy(sb);
      return false;
    }, '학습지 ⑤', { speed: 6 });
    await slow(0.3);
    mark('B 학습지 ⑤');
    if (await popupB.count()) {
      await t.bringToFront();
      await snap(t, 'b-t-ws-W05', WHO_T, [look(t.getByTestId('now-ws-done'), '다 쓴 학생')]);
      await ff(async () => (await sb.getByTestId('worksheet-done').isEnabled().catch(() => false)) || !(await popupB.count()), '다 썼어요 켜짐 ⑤', { speed: 2, maxFastMs: 120_000 });
      await slow(0.3);
      checks['b-s-ws-W05 worksheet-order'] = (await sb.getByTestId('worksheet-order').innerText().catch(() => '')).trim();
      await snap(sb, 'b-s-ws-W05', WHO_S, [look(sb.getByTestId('worksheet-order'), '오늘 학습지'), press(sb.getByTestId('worksheet-done'))], { settleMs: 300 });
      await sb.getByTestId('worksheet-done').click({ timeout: 3000 }).catch(() => undefined);
    } else warn.push('b-s-ws-W05: 학습지 ⑤ 팝업을 못 봄');
    // 학습지 ⑥(선택)
    await ff(async () => {
      if ((await popupB.count()) > 0 && (await wsIds(sb)).includes('W06')) return true;
      if ((await popupB.count()) > 0) await tidy(sb, { ws: true });
      else await tidy(sb);
      return (await sb.getByTestId('wrap-awards').count()) > 0;
    }, '학습지 ⑥', { speed: 6 });
    await slow(0.3);
    if ((await popupB.count()) > 0 && (await wsIds(sb)).includes('W06')) {
      checks['b-s-ws-W06 worksheet-order'] = (await sb.getByTestId('worksheet-order').innerText().catch(() => '')).trim();
      await snap(sb, 'b-s-ws-W06', WHO_S, [look(sb.getByTestId('worksheet-order'), '오늘 학습지')], { settleMs: 300 });
    } else warn.push('b-s-ws-W06: 학습지 ⑥ 팝업을 못 봄');
    mark('B 끝');

    await botsB.evaluate(() => window.__vbots?.stop()).catch(() => undefined);
    const errs = env.errors.filter((e) => !/requestfailed|ERR_INTERNET_DISCONNECTED|net::ERR/.test(e));
    if (errs.length) warn.push(...errs.slice(0, 30).map((e) => `화면 오류: ${e}`));
    for (const c of env.contexts) await c.close().catch(() => undefined);
  } catch (e) {
    warn.push(`촬영 중단: ${String((e as Error).message ?? e).replace(/\u001b\[\d+m/g, '').split('\n').slice(0, 4).join(' / ')}`);
    // 멈춘 자리 확인용 그림(VIDEO_OUT/_fail-n.png)
    let n = 0;
    for (const c of browser?.contexts() ?? []) for (const pg of c.pages()) await pg.screenshot({ path: join(OUT, `_fail-${++n}.png`) }).catch(() => undefined);
  } finally {
    book.save();
    const got = new Set(book.records.map((r) => r.id));
    const missingRequired = REQUIRED.filter((id) => !got.has(id));
    const missingOptional = OPTIONAL.filter((id) => !got.has(id));
    const dsf = Object.fromEntries(book.records.map((r) => [r.id, r.dsf]));
    writeFileSync(
      join(OUT, 'warnings.json'),
      JSON.stringify(
        {
          made: new Date().toISOString(),
          host: site?.host ?? null,
          pretty: site?.pretty ?? false,
          seconds: Math.round((Date.now() - t0) / 1000),
          timing,
          required: { total: REQUIRED.length, got: REQUIRED.length - missingRequired.length, missing: missingRequired },
          optional: { total: OPTIONAL.length, got: OPTIONAL.length - missingOptional.length, missing: missingOptional },
          extra: [...got].filter((id) => !REQUIRED.includes(id) && !OPTIONAL.includes(id)),
          toastSelector: '[data-testid="toast"] (학생 st-toast, 글자로 거름: 도착 / 운항비 …냈어요 / 이익)',
          dsf,
          checks,
          privacy: {
            instagram: privacy.filter((x) => x.instagram).map((x) => x.id),
            atHandle: privacy.filter((x) => x.atHandle).map((x) => x.id),
            badNames: privacy.filter((x) => x.badNames.length).map((x) => `${x.id}: ${x.badNames.join(',')}`),
            checked: privacy.length,
          },
          warnings: warn,
        },
        null,
        2,
      ),
    );
    console.log(`[video] 필수 ${REQUIRED.length - missingRequired.length}/${REQUIRED.length}, 선택 ${OPTIONAL.length - missingOptional.length}/${OPTIONAL.length} — 필수 누락 ${missingRequired.length}: ${missingRequired.join(', ')}`);
    await browser?.close().catch(() => undefined);
    await site?.close().catch(() => undefined);
    await relay?.stop().catch(() => undefined);
  }
});

/** 표시 요소가 모두 창 안에 있는가(스크롤하지 않고) */
async function allInView(p: Page, marks: MarkSpec[]): Promise<boolean> {
  const vp = p.viewportSize()!;
  for (const m of marks) {
    const b = await m.loc.boundingBox().catch(() => null);
    if (!b || b.y < 0 || b.x < 0 || b.y + b.height > vp.height || b.x + b.width > vp.width) return false;
  }
  return true;
}

/** 지금 창 안에 있는 표시만 */
async function inViewOnly(p: Page, marks: MarkSpec[]): Promise<MarkSpec[]> {
  const vp = p.viewportSize()!;
  const out: MarkSpec[] = [];
  for (const m of marks) {
    const b = await m.loc.boundingBox().catch(() => null);
    if (b && b.y >= 0 && b.x >= 0 && b.y + b.height <= vp.height && b.x + b.width <= vp.width) out.push(m);
  }
  return out;
}

/** video-bots.ts를 Vite로 한 파일로 묶는다(e2e/support/bots.ts의 build와 같은 설정) */
async function buildVideoBots(): Promise<string> {
  const { build: viteBuild } = await import('vite');
  const preact = (await import('@preact/preset-vite')).default;
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string };
  const res = await viteBuild({
    configFile: false,
    root: ROOT,
    logLevel: 'error',
    plugins: [preact()],
    resolve: { alias: { '@shared': join(ROOT, 'shared') } },
    define: { __APP_VERSION__: JSON.stringify(pkg.version), __BUILD_TIME__: JSON.stringify('2026-10-21T00:00:00.000Z') },
    build: {
      write: false,
      minify: false,
      emptyOutDir: false,
      cssCodeSplit: false,
      lib: { entry: join(ROOT, 'scripts', 'guide', 'video-bots.ts'), formats: ['es'], fileName: 'vbots' },
    },
  });
  const outputs = (Array.isArray(res) ? res : [res]) as { output: { type: string; isEntry?: boolean; code?: string }[] }[];
  const entry = outputs.flatMap((o) => o.output).find((c) => c.type === 'chunk' && c.isEntry);
  if (!entry?.code) throw new Error('촬영용 봇 페이지를 묶지 못했어요');
  return entry.code;
}
