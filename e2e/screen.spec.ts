import { mkdirSync } from 'node:fs';
import { join as pathJoin } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { openFold, openOrderRow, openTvMenu } from './support/voyage-ui';

/**
 * 작업 110 공용 화면(#/screen) e2e.
 * 전부 실행: `npx playwright test -c tests/screen/playwright.config.ts` (개발 서버 5288)
 * 기본 `npm run e2e`(빌드 미리보기)에서는 호스트 없음 안내만 확인하고 나머지는 건너뛴다.
 * SHOT_DIR 환경 변수가 있으면 스크린숏을 남긴다.
 */

const SHOT_DIR = process.env.SHOT_DIR;
const FULL = process.env.SCREEN_E2E === '1';
const CODE = '482137';

async function shot(page: Page, name: string) {
  if (!SHOT_DIR) return;
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(450); // 장면 페이드
  await page.screenshot({ path: pathJoin(SHOT_DIR, name) });
}

/** 공용 화면 DOM(글자 + 모든 속성) */
async function screenDump(page: Page): Promise<string> {
  return page.evaluate(() => {
    const root = document.querySelector('[data-testid="route-screen"]') as HTMLElement | null;
    if (!root) return '';
    const parts = [root.innerText];
    root.querySelectorAll('*').forEach((el) => {
      for (const a of Array.from(el.attributes)) parts.push(`${a.name}=${a.value}`);
    });
    return parts.join('\n');
  });
}

/** 금지 정보: 출석번호(`seat`, "7번" 꼴), 방 수, 응답·접속 명단 + extra(학생별 자금 값 "523만" 등) */
async function expectNoPrivate(page: Page, extra: string[] = []) {
  const text = await screenDump(page);
  expect(text).not.toMatch(/\d+\s*번(?!째)/);
  expect(text).not.toMatch(/seat/i);
  expect(text).not.toContain('출석');
  expect(text).not.toMatch(/사용 중인 방|\d+\s*\/\s*50\b/);
  expect(text).not.toMatch(/미접속|미응답|재접속/);
  for (const s of extra) expect(text).not.toContain(s);
}

/** 화면 밖으로 나가거나 잘린 글자 */
async function overflowProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const vw = innerWidth;
    const vh = innerHeight;
    const bad: string[] = [];
    const root = document.querySelector('[data-testid="route-screen"]');
    if (!root) return ['no root'];
    root.querySelectorAll('*').forEach((node) => {
      const el = node as HTMLElement;
      if (el.closest('.world-map') || el.closest('svg')) return;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.opacity === '0' || cs.position === 'fixed') return;
      const label = `${el.tagName.toLowerCase()}.${el.className}`;
      if (r.right > vw + 1 || r.bottom > vh + 1 || r.left < -1 || r.top < -1) bad.push(`밖: ${label} ${Math.round(r.right)}×${Math.round(r.bottom)}`);
      if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) bad.push(`말줄임: ${label} "${el.textContent}"`);
      if ((cs.overflowY === 'hidden' || cs.overflow === 'hidden') && el.scrollHeight > el.clientHeight + 2 && !el.classList.contains('scr-code__names') && !el.classList.contains('scr-cover__art'))
        bad.push(`세로 잘림: ${label}`);
    });
    return bad;
  });
}

/** 보이는 글자의 가장 작은 크기(px) — 전체 화면 버튼·지도 이름표 제외 */
async function minFontPx(page: Page): Promise<number> {
  return page.evaluate(() => {
    let min = Infinity;
    const root = document.querySelector('[data-testid="route-screen"]');
    if (!root) return 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent?.trim()) continue;
      const el = n.parentElement as HTMLElement;
      if (el.closest('.scr-fs') || el.closest('.world-map') || el.closest('.t-present__back')) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      min = Math.min(min, parseFloat(getComputedStyle(el).fontSize));
    }
    return min === Infinity ? 0 : min;
  });
}

/** 공용 화면 QR을 표준 디코더(jsQR)로 해독. JSQR_PATH(jsQR.js 경로)가 없으면 null */
async function decodeQr(page: Page): Promise<string | null> {
  const p = process.env.JSQR_PATH;
  if (!p) return null;
  await page.addScriptTag({ path: p });
  return page.evaluate(async () => {
    const svg = document.querySelector('[data-testid="screen-qr"]') as SVGSVGElement;
    const xml = new XMLSerializer().serializeToString(svg);
    const im = new Image();
    im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
    await im.decode();
    const c = document.createElement('canvas');
    c.width = c.height = 400;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(im, 0, 0, 400, 400);
    const data = ctx.getImageData(0, 0, 400, 400);
    const r = (window as unknown as { jsQR: (d: Uint8ClampedArray, w: number, h: number) => { data: string } | null }).jsQR(data.data, 400, 400);
    return r ? r.data : 'DECODE_FAILED';
  });
}

const sceneOf = (page: Page) => page.getByTestId('route-screen').getAttribute('data-scene');

test('호스트 탭이 없으면 "선생님 대시보드 창을 열어 주세요"', async ({ page }) => {
  await page.goto(`./#/screen?room=${CODE}`);
  await expect(page.getByTestId('route-screen')).toBeVisible();
  await expect(page.getByRole('heading', { name: '공용 화면' })).toBeVisible();
  await expect(page.getByTestId('wait-text')).toHaveText('선생님 대시보드 창을 열어 주세요', { timeout: 6000 });
});

test('QR 주소(?room=코드#/play)로 열면 학생 입장 화면의 방 코드 칸이 미리 채워진다', async ({ page }) => {
  await page.goto('./?room=482137#/play');
  await expect(page.getByTestId('student-entry')).toBeVisible();
  await expect(page.getByTestId('entry-code')).toHaveValue('482137');
  await page.goto('./?room=12ab#/play');
  await page.reload();
  await expect(page.getByTestId('entry-code')).toHaveValue('');
});

test.describe('장면(가짜 호스트 = 실제 교사 리듀서 상태)', () => {
  test.skip(!FULL, '개발 서버 전용(tests/screen/playwright.config.ts)');

  /** 호스트 탭: fixtures로 판을 만들어 screen-bridge로 보냄 */
  async function fakeHost(context: BrowserContext) {
    const host = await context.newPage();
    await host.goto('./#/');
    await host.evaluate(async (code) => {
      const fx = await import('/tests/screen/fixtures.ts' as string);
      const br = await import('/src/sync/screen-bridge.ts' as string);
      const pub = br.createScreenPublisher(code, { strict: true });
      const w = window as unknown as Record<string, unknown>;
      w.__send = (scene: string, opts: Record<string, unknown>) => {
        const p = fx.scenePayload(scene, { now: Date.now(), ...opts });
        pub.publishToScreen(p.publicState, p.classView);
        return Object.values((fx.buildGame(scene, { now: Date.now(), ...opts }) as { players: Record<string, { game: { money: number } }> }).players).map(
          (p) => p.game.money,
        );
      };
      w.__codeChanged = (c: string) => pub.codeChanged(c);
    }, CODE);
    return {
      send: (scene: string, opts: Record<string, unknown> = {}) =>
        host.evaluate(([s, o]) => (window as unknown as { __send: (s: string, o: unknown) => number[] }).__send(s as string, o), [scene, opts] as const),
      codeChanged: (c: string) => host.evaluate((x) => (window as unknown as { __codeChanged: (c: string) => void }).__codeChanged(x), c),
    };
  }

  test('1920×1080: 장면 8종 + 순위판 N(0/3/4/5)·시상·차시 표지·요약 카드, 글자 크기, 금지 정보 없음', async ({ page, context }) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const host = await fakeHost(context);
    await page.goto(`./#/screen?room=${CODE}`);
    await expect(page.getByTestId('scene-wait')).toBeVisible();

    const cases: { scene: string; opts?: Record<string, unknown>; want: string; file: string; check?: () => Promise<void> }[] = [
      {
        scene: 'prep',
        opts: { blockSeats: [5] },
        want: 'code',
        file: '01-code.png',
        check: async () => {
          await expect(page.getByTestId('screen-room-code')).toHaveText('482 137');
          await expect(page.getByTestId('screen-joined')).toHaveText('들어온 회사 27개');
          await expect(page.getByTestId('screen-qr')).toBeVisible();
          const qr = await decodeQr(page);
          if (qr !== null) expect(qr).toBe(new URL('./?room=482137#/play', page.url()).href);
          await expect(page.getByTestId('screen-company-list')).toContainText('이름 짓는 중');
          const px = await page.getByTestId('screen-room-code').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
          expect(px).toBeGreaterThanOrEqual(140);
        },
      },
      {
        scene: 'cover',
        want: 'cover',
        file: '02-cover-lesson-L1.png',
        check: async () => {
          await expect(page.getByTestId('cover-kicker')).toHaveText('1차시');
          await expect(page.getByTestId('cover-question')).toContainText('생산지가 다양한 까닭');
          await expect(page.getByTestId('screen-clock-stage')).toHaveText('1차시 · 물건은 어디에서 왔을까? 왜 무역을 할까?');
        },
      },
      {
        // (작업 113) 벽란도 진행 중 마친 학생이 있으면 미니게임 결과 장면
        scene: 'vote',
        want: 'minigameResult',
        file: '03-minigame-live.png',
        check: async () => {
          await expect(page.getByTestId('mg-result-count')).toHaveText(/다 한 친구\s*21\s*명/);
          await expect(page.getByTestId('mg-result-bar')).toHaveCount(10);
        },
      },
      {
        scene: 'map',
        want: 'map',
        file: '04-map.png',
        check: async () => {
          // (작업 159) TV에는 라운드 남은 시간 숫자가 없다 — 라운드 번호만 큰 글씨
          await expect(page.getByTestId('map-round-left')).toHaveCount(0);
          await expect(page.getByTestId('map-round-now')).toHaveText(/^라운드 \d+$/);
          const px = await page.getByTestId('map-round-now').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
          expect(px).toBeGreaterThanOrEqual(72);
          await expect(page.getByTestId('map-ready')).toHaveText(/^출항 준비 \d+\/27$/);
        },
      },
      {
        scene: 'between',
        opts: { topN: 3, choice: 'leaderboard', blockSeats: [18] },
        want: 'leaderboard',
        file: '05-leaderboard-top3.png',
        check: async () => {
          await expect(page.getByTestId('board-row')).toHaveCount(3);
          // 1위 회사(18번)는 이름이 막혀 수출액 탭에서 "이름 짓는 중"(탭은 10초마다 돌아감)
          if ((await page.getByTestId('scene-leaderboard').getAttribute('data-tab')) === 'exports')
            await expect(page.getByTestId('board-row').first()).toContainText('이름 짓는 중');
        },
      },
      {
        // (작업 113) 마감한 벽란도 결과는 미니게임 결과 장면(맞힌 수 0~9장)
        scene: 'bars',
        want: 'minigameResult',
        file: '06-bars-byeokrando.png',
        check: async () => {
          await expect(page.getByTestId('mg-result-bar')).toHaveCount(10);
          await expect(page.locator('.scr-mg__fill').first()).toBeVisible();
          await expect(page.getByTestId('mg-result-count')).toHaveText(/다 한 친구\s*27\s*명/);
        },
      },
      {
        // (작업 113 수정 1회차) 미니게임이 아닌 결과 막대: L3-E4 투표 공개 뒤 라운드 사이 → 일반 막대 장면
        scene: 'barsVote',
        want: 'bars',
        file: '06b-bars-vote.png',
        check: async () => {
          await expect(page.getByTestId('scene-bars')).toHaveAttribute('data-event', 'L3-E4');
          await expect(page.getByTestId('screen-bar')).toHaveCount(2);
          await expect(page.locator('.scr-bar__fill').first()).toBeVisible();
          await expect(page.getByTestId('bars-count')).toHaveText(/응답한 회사\s*22\/27/);
        },
      },
      {
        scene: 'worksheetBundle',
        want: 'worksheet',
        file: '07-worksheet-bundle.png',
        check: async () => {
          await expect(page.getByTestId('ws-title')).toHaveText('잠깐! ①②③④ 학습지를 써요');
          await expect(page.getByTestId('ws-done-count')).toHaveText('18/27');
        },
      },
      {
        // (10-22) 학습지 ⑤: TV는 세관 게시판을 그대로 보이고 아래에 '잠깐! ⑤' 띠
        scene: 'worksheetCustoms',
        want: 'worksheet',
        file: '07b-worksheet-5-customs.png',
        check: async () => {
          await expect(page.getByTestId('scene-customs')).toBeVisible();
          await expect(page.getByTestId('ws-title')).toHaveText('잠깐! ⑤ 학습지를 써요');
          await expect(page.getByTestId('ws-done-count')).toHaveText('18/27');
          // 띠가 게시판 아래에 있고(위로 겹치지 않음) 화면 안에 다 보인다
          const strip = await page.locator('.scr-ws__strip').boundingBox();
          const board = await page.getByTestId('scene-customs').boundingBox();
          expect(strip && board && strip.y >= board.y + board.height - 2).toBeTruthy();
          expect(strip && strip.y + strip.height <= 1080).toBeTruthy();
        },
      },
      { scene: 'pause', want: 'pause', file: '08-pause.png', check: async () => expect(page.getByTestId('screen-clock-paused')).toBeVisible() },
      { scene: 'worksheet', want: 'worksheet', file: '09-worksheet-single.png', check: async () => expect(page.getByTestId('ws-title')).toHaveText('잠깐! ③ 학습지를 써요') },
      { scene: 'between', opts: { topN: 0, choice: 'leaderboard' }, want: 'leaderboard', file: '10-leaderboard-top0.png', check: async () => expect(page.getByTestId('board-hidden')).toHaveText('순위는 시상식에서 공개해요') },
      { scene: 'between', opts: { topN: 4, choice: 'leaderboard' }, want: 'leaderboard', file: '11-leaderboard-top4.png', check: async () => expect(page.getByTestId('board-row')).toHaveCount(4) },
      { scene: 'between', opts: { topN: 5, choice: 'leaderboard' }, want: 'leaderboard', file: '12-leaderboard-top5.png', check: async () => expect(page.getByTestId('board-row')).toHaveCount(5) },
      { scene: 'awards', want: 'awards', file: '13-awards.png', check: async () => expect(page.getByTestId('award-card').first()).toBeVisible() },
      { scene: 'summary', want: 'summary', file: '14-summary-card-L2.png', check: async () => expect(page.getByTestId('scene-summary')).toContainText('1차시 요약') },
      { scene: 'unitL2Cover', opts: { topN: 3 }, want: 'cover', file: '15-cover-unit-L2-top3.png', check: async () => expect(page.getByTestId('cover-top')).toContainText('지금까지 상위 3개 회사') },
      { scene: 'map', opts: { choice: 'black' }, want: 'black', file: '16-black.png' },
    ];

    for (const [i, c] of cases.entries()) {
      let money = await host.send(c.scene, c.opts ?? {});
      if (i === 0) {
        // (작업 114) 가짜 호스트는 한 번만 보낸다 — 공용 화면이 채널을 막 연 순간이면 첫 메시지를 놓칠 수 있어 장면이 바뀔 때까지 다시 보낸다
        // (실제 교사 화면은 공용 화면이 열리면 다시 보내 준다)
        await expect
          .poll(async () => {
            if ((await sceneOf(page)) === 'wait') money = await host.send(c.scene, c.opts ?? {});
            return sceneOf(page);
          }, { timeout: 10_000, intervals: [1000] })
          .not.toBe('wait');
      }
      // 준비 단계는 방 코드 20초 ↔ 항해 규칙 12초라 방 코드는 최대 13초 기다린다
      await expect.poll(() => sceneOf(page), { timeout: c.want === 'code' ? 15_000 : 2000 }).toBe(c.want);
      if (c.check) await c.check();
      if (c.want !== 'black') {
        const min = await minFontPx(page);
        expect(min, `${c.file} 가장 작은 글자`).toBeGreaterThanOrEqual(32);
      }
      await expectNoPrivate(page, money.map((m) => `${m}만`));
      expect(await overflowProblems(page), c.file).toEqual([]);
      await shot(page, c.file);
    }

    // 준비 단계: 항해 규칙 카드(방 코드와 번갈아)
    await host.send('prep');
    await expect.poll(() => sceneOf(page), { timeout: 35_000, intervals: [500] }).toBe('rules');
    await expect(page.getByTestId('rule-card')).toHaveCount(4);
    await shot(page, '17-rules.png');

    // 방 코드가 바뀌면 빨간 띠 + 새 코드
    await host.send('map');
    await host.codeChanged('905113');
    await expect(page.getByTestId('code-changed')).toBeVisible();
    await expect(page.getByTestId('code-changed-overlay').getByTestId('screen-room-code')).toHaveText('905 113');
    await shot(page, '18-code-changed.png');

    // 커서·[전체 화면] 3초 뒤 숨김
    await page.mouse.move(100, 100);
    await expect(page.getByTestId('screen-fullscreen')).toHaveCSS('opacity', '1');
    await page.waitForTimeout(3600);
    await expect(page.getByTestId('route-screen')).toHaveClass(/scr--idle/);
    expect(errors).toEqual([]);
  });

  test('1280×720·1366×768에서도 잘리지 않는다', async ({ page, context }) => {
    test.setTimeout(120_000);
    const host = await fakeHost(context);
    for (const vp of [
      { width: 1280, height: 720 },
      { width: 1366, height: 768 },
    ]) {
      await page.setViewportSize(vp);
      await page.goto(`./#/screen?room=${CODE}`);
      for (const [scene, opts, want] of [
        ['prep', { blockSeats: [5] }, 'code'],
        ['cover', {}, 'cover'],
        ['event', {}, 'event'],
        ['vote', {}, 'minigameResult'],
        ['barsVote', {}, 'bars'],
        ['between', { topN: 5, choice: 'leaderboard' }, 'leaderboard'],
        ['worksheetBundle', {}, 'worksheet'],
        ['awards', {}, 'awards'],
        ['map', {}, 'map'],
      ] as const) {
        await host.send(scene, opts);
        await expect.poll(() => sceneOf(page), { timeout: want === 'code' ? 15_000 : 2000 }).toBe(want);
        expect(await overflowProblems(page), `${vp.width} ${scene}`).toEqual([]);
        if (vp.width === 1280 && (want === 'leaderboard' || want === 'code' || want === 'event' || want === 'bars')) await shot(page, `w1280-${want}.png`);
      }
    }
  });
});

test.describe('실제 흐름: 교사 탭 + 공용 화면 탭 + 학생 탭(?sync=local)', () => {
  test.skip(!FULL, '개발 서버 전용(tests/screen/playwright.config.ts)');

  test('[공용 화면 창 열기] → 방 코드 → 장면 바꾸기 2초 → 순위 N → 무역 시작 차시 표지 → 사건 → 일시정지 → 발표 모드 → 시상', async ({ page, context }) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`teacher: ${e.message}`));
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('./?sync=local#/teacher');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload();
    await page.getByTestId('btn-new').click();
    await page.getByTestId('unit-lesson').click();
    await page.getByTestId('lesson-L1').click();
    await page.getByTestId('trade-minutes').getByRole('button', { name: '10분' }).click();
    await page.getByTestId('class-name').fill('6-3');
    await page.getByTestId('btn-open').click();
    const codeEl = page.getByTestId('room-code');
    await expect(codeEl).toHaveText(/^\d{6}$/);
    const code = (await codeEl.innerText()).trim();

    // [공용 화면 창 열기] → 새 창(같은 브라우저)
    await openTvMenu(page); // (작업 137) 위쪽 띠 [TV 화면 ▾]
    const [screen] = await Promise.all([context.waitForEvent('page'), page.getByTestId('btn-open-screen').click()]);
    screen.on('pageerror', (e) => errors.push(`screen: ${e.message}`));
    await screen.setViewportSize({ width: 1920, height: 1080 });
    await expect(screen).toHaveURL(new RegExp(`#/screen\\?room=${code}$`));
    await expect(screen.getByTestId('screen-room-code')).toHaveAttribute('data-code', code);
    await expect(screen.getByTestId('screen-joined')).toHaveText('들어온 회사 0개');

    // QR = 주소 + ?room=코드#/play. JSQR_PATH(표준 디코더 jsQR)가 있으면 화면의 QR을 실제로 해독해 그 주소로 학생 탭을 연다
    const qrUrl = await decodeQr(screen);
    const expectUrl = new URL(`./?room=${code}#/play`, screen.url()).href;
    if (qrUrl !== null) expect(qrUrl).toBe(expectUrl);
    // 학생 탭(107 실제 화면): QR 주소로 열면 방 코드 칸이 미리 채워짐 → 7번 · 해오름무역만 입력
    const s1 = await context.newPage();
    s1.on('pageerror', (e) => errors.push(`student: ${e.message}`));
    await s1.goto(qrUrl ?? expectUrl);
    await expect(s1.getByTestId('student-entry')).toBeVisible();
    await expect(s1.getByTestId('entry-code')).toHaveValue(code);
    await s1.getByTestId('entry-seat').selectOption('7');
    await s1.getByTestId('entry-name').fill('해오름무역');
    await s1.getByTestId('entry-submit').click();
    await expect(s1.getByTestId('found-company')).toBeVisible();
    await s1.getByTestId('found-submit').click();
    await expect(s1.getByTestId('prep-wait')).toBeVisible();
    expect(new URL(s1.url()).searchParams.get('room')).toBeNull(); // 입장 뒤 주소창의 room은 지움
    // 준비 단계는 방 코드 20초 ↔ 항해 규칙 12초
    await expect.poll(() => sceneOf(screen), { timeout: 15_000 }).toBe('code');
    await expect(screen.getByTestId('screen-joined')).toHaveText('들어온 회사 1개');
    await expect(screen.getByTestId('screen-company-list')).toContainText('해오름무역');
    await expectNoPrivate(screen, ['500만']);
    await shot(screen, 'flow-01-code-1student.png');

    // 교사가 장면을 바꾸면 2초 안에
    const pick = async (scene: string, want: string) => {
      await openTvMenu(page);
      const t0 = Date.now();
      await page.getByTestId('scene-select').selectOption(scene);
      await expect.poll(() => sceneOf(screen), { timeout: 2000 }).toBe(want);
      return Date.now() - t0;
    };
    expect(await pick('black', 'black')).toBeLessThan(2000);
    expect(await pick('map', 'map')).toBeLessThan(2000);
    expect(await pick('leaderboard', 'leaderboard')).toBeLessThan(2000);

    // 순위 공개 N: 0 → 안내, 3 → 회사 1개(들어온 회사 수만큼)
    await page.getByTestId('btn-settings').click();
    const modal = page.getByTestId('settings-modal');
    await modal.getByRole('button', { name: '안 보임' }).click();
    await expect(screen.getByTestId('board-hidden')).toHaveText('순위는 시상식에서 공개해요');
    await modal.getByRole('button', { name: '상위 4' }).click();
    await expect(screen.getByTestId('scene-leaderboard')).toHaveAttribute('data-topn', '4');
    await expect(screen.getByTestId('board-row').first()).toContainText('해오름무역');
    await expectNoPrivate(screen, ['500만']);
    await shot(screen, 'flow-02-leaderboard.png');
    await modal.getByRole('button', { name: '상위 3' }).click();
    await page.getByTestId('settings-close').click();
    await openTvMenu(page);
    await page.getByTestId('scene-select').selectOption('auto');
    await expect.poll(() => sceneOf(screen), { timeout: 2000 }).toMatch(/^(code|rules)$/);

    // 발표 모드(이 화면을 TV로 보여 주기): 교사 창이 공용 화면으로 → [선생님 화면으로]
    await openTvMenu(page);
    await page.getByTestId('btn-present').click();
    await expect(page.getByTestId('presentation').getByTestId('route-screen')).toBeVisible();
    await expect.poll(() => sceneOf(page), { timeout: 15_000 }).toBe('code');
    await expect(page.getByTestId('presentation').getByTestId('screen-room-code')).toHaveAttribute('data-code', code);
    await expect(page.getByTestId('student-table')).toHaveCount(0);
    await expectNoPrivate(page);
    expect(await overflowProblems(page)).toEqual([]);
    await shot(page, 'flow-03-presentation-1366.png');
    await page.getByTestId('btn-back-dashboard').click();
    await expect(page.getByTestId('teacher-dashboard')).toBeVisible();

    // 무역 시작 → 차시 표지(L1) + 무역 시계
    await page.getByTestId('btn-start-trade').click();
    await page.getByTestId('confirm-ok').click();
    await expect.poll(() => sceneOf(screen), { timeout: 4000 }).toBe('cover');
    await expect(screen.getByTestId('cover-kicker')).toHaveText('1차시');
    await expect(screen.getByTestId('screen-clock')).toHaveAttribute('data-mode', 'trade');
    await expect(screen.getByTestId('screen-clock-stage')).toContainText('1차시 · ');
    await shot(screen, 'flow-04-cover.png');

    // 다음 사건 [지금] → 사건 카드(표지가 끝난 뒤)
    // (작업 137) '오늘 순서'에서 줄을 눌러 [지금 시작]
    await openFold(page, 'order');
    const nextEvent = page.locator('[data-testid="tl-next-item"][data-item^="ev:"]').first();
    await expect(nextEvent).toBeVisible({ timeout: 30_000 });
    await openOrderRow(page, nextEvent);
    await nextEvent.getByTestId('tl-now').click();
    await expect.poll(() => sceneOf(screen), { timeout: 30_000 }).toMatch(/^(event|bars)$/);
    await expectNoPrivate(screen, ['500만']);
    await shot(screen, 'flow-05-event.png');

    // 일시정지 → 시계 멈춤. (10-22 교사 피드백) TV에 설명할 내용(사건 카드·슬라이드)이 떠 있으면 '선생님을 보세요' 대신 그 장면을 그대로 둔다
    await page.getByTestId('btn-pause').click();
    await expect.poll(() => sceneOf(screen), { timeout: 2000 }).toMatch(/^(event|bars)$/);
    await expect(screen.getByTestId('screen-clock-paused')).toBeVisible();
    const sec1 = await screen.getByTestId('screen-clock').getAttribute('data-sec');
    await screen.waitForTimeout(2200);
    expect(await screen.getByTestId('screen-clock').getAttribute('data-sec')).toBe(sec1);
    await shot(screen, 'flow-06-pause.png');
    await page.getByTestId('btn-resume-trade').click();
    await expect.poll(() => sceneOf(screen), { timeout: 2000 }).not.toBe('pause');

    // 무역 시간을 줄여 끝냄 → 마무리(시계 숨김). 학생 1명 차시 한 판은 모든 지표 값이 같아 상이 자동으로 숨겨지므로(PRD 4.1.1)
    // 시상 목록 대신 순위판이 나온다 — 시상 장면 자체는 위 '장면' 시험(27개 회사)에서 확인
    await openFold(page, 'time'); // (작업 137) '시간 조절' 접힘 영역: 직접 __분 [줄이기]
    await page.getByTestId('custom-min').fill('9');
    await page.getByTestId('btn-custom-shorten').click();
    const shortConf = page.getByTestId('confirm-shorten');
    await shortConf.waitFor({ state: 'visible', timeout: 1000 }).catch(() => undefined);
    if (await shortConf.isVisible().catch(() => false)) await page.getByTestId('confirm-ok').click();
    // (작업 162) 추천 시간을 줄여도 판은 저절로 끝나지 않는다 — '시간 조절'의 [지금 마무리로](남은 순서가 있으면 확인 1번)
    await page.getByTestId('btn-finish-early').click();
    const finConf = page.getByTestId('confirm-finish');
    await finConf.waitFor({ state: 'visible', timeout: 1000 }).catch(() => undefined);
    if (await finConf.isVisible().catch(() => false)) await page.getByTestId('confirm-ok').click();
    await expect.poll(() => sceneOf(screen), { timeout: 120_000, intervals: [1000] }).toMatch(/^(awards|leaderboard)$/);
    await expect(screen.getByTestId('screen-clock')).toHaveCount(0);
    await expect(screen.getByTestId('route-screen')).toContainText('해오름무역');
    await expectNoPrivate(screen, ['500만']);
    await shot(screen, 'flow-07-wrapup.png');
    expect(errors).toEqual([]);
  });
});
