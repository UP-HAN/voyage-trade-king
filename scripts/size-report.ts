/**
 * 작업 133 — 첫 화면 전송량 측정: `npm run size:report` (빌드 + 중계 서버 빌드 뒤 이 파일을 run-ts.mjs 로 실행)
 *
 * 빌드본 `dist/`를 `/voyage/` 하위 경로로 주는 정적 서버 + 로컬 중계 서버(e2e/support/voyage-servers.ts — 실제 배포 구조 흉내)를 띄우고,
 * **캐시를 끈 새 브라우저 문맥**에서 아래 세 경로의 전송 바이트(CDP `Network.loadingFinished.encodedDataLength`)를 잰다.
 *   (가) 타이틀만 열고 네트워크가 잠잠해질 때까지 — 이미지 합계 1MB 이하
 *   (나) 학생: 타이틀 → [학생으로 참여] → 입장 → 회사 설립(준비) → 교사 [무역 시작] → 해도가 보일 때까지 — 누적 3MB 이하
 *   (다) 교사: 타이틀 → [선생님으로 시작] → 교사 시작 화면(T01) — 누적 3MB 이하
 * 뷰포트: (가)(나) 1366×768 @1·1180×820 @2, (다) 1366×768 @1·1920×1080 @1 (PRD 10.8).
 *
 * 출력: 경로·뷰포트별 합계 표(이미지·글꼴·스크립트·스타일·그 밖) + 큰 파일 상위 10개. 결과는 tmp/size-report/report.md·summary.json 에도 쓴다.
 * 예산을 넘으면 종료 코드 1. 1MB = 1,000,000 바이트(보수적으로 10진).
 *
 * (나)에서는 측정이 끝난 뒤 해도를 휠로 확대해 큰 사본으로 바뀌는지·그 사이 그림이 비는 프레임이 없는지(깜박임)도 본다(합계에는 넣지 않음).
 * 인자: `--out <폴더>` 결과 폴더(기본 tmp/size-report).
 * fs.rmSync·fs.cpSync 는 쓰지 않는다(이 폴더 경로에서 Node 24가 죽음 — CLAUDE.md).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { ROOT, startRelayProcess, startStatic, type RelayProcess, type StaticServer } from '../e2e/support/voyage-servers';

const MB = 1_000_000;

type Kind = 'image' | 'font' | 'script' | 'style' | 'other';
interface Entry {
  url: string;
  kind: Kind;
  bytes: number;
}
interface Run {
  route: string;
  label: string;
  viewport: string;
  budget: number;
  entries: Entry[];
  totals: Record<Kind | 'all', number>;
  ok: boolean;
  /** (나) 해도 확대 → 큰 사본 바꿔 끼우기 확인(측정 합계에는 넣지 않음) */
  zoom?: ZoomResult;
}
interface ZoomResult {
  before: string;
  after: string;
  /** 바꾸는 동안 그림이 비거나(naturalWidth 0·미완료) 흐려진(is-loaded 빠짐) 프레임 수 */
  blankFrames: number;
  frames: number;
  ok: boolean;
}

/**
 * 해도 확대(휠) → 지도가 멈추면 큰 사본을 뒤에서 받아 바꿔 끼우는지, 그 사이 그림이 비는 프레임이 없는지(깜박임 없음) 본다.
 * 매 프레임(requestAnimationFrame) 바다 그림의 currentSrc·complete·naturalWidth·is-loaded 를 기록한다.
 * (수정 1회차) 첫 사본을 처음 배율 기준으로 고르므로 학생 기본 보기(폭 750px 이상)는 처음부터 원본 폭 2700 —
 * 그때는 "바뀌지 않고(이미 최대) 빈 프레임 없음"이 OK. 바꿔 끼우기 자체는 좁은 가로 화면(700×500, 처음 2560) 확인 실행에서 본다.
 */
const SEA_MAX = 2700;
let shotDir = '';
async function zoomCheck(page: Page, tag: string): Promise<ZoomResult> {
  const sea = page.locator('img.wm-sea').first();
  const before = (await sea.getAttribute('data-sea-width')) ?? '';
  if (shotDir) await page.screenshot({ path: join(shotDir, `map-${tag}-default.png`) });
  await page.evaluate(() => {
    const w = window as unknown as { __seaFrames: { src: string; ok: boolean }[]; __seaStop: boolean };
    w.__seaFrames = [];
    w.__seaStop = false;
    const tick = () => {
      const el = document.querySelector<HTMLImageElement>('img.wm-sea');
      if (el) w.__seaFrames.push({ src: el.currentSrc, ok: el.complete && el.naturalWidth > 0 && el.classList.contains('is-loaded') });
      if (!w.__seaStop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const box = await page.getByTestId('world-map').boundingBox();
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, -240);
    await page.waitForTimeout(60);
  }
  let after = before;
  const already = Number(before) >= SEA_MAX;
  for (let i = 0; i < (already ? 20 : 100) && after === before; i++) {
    await page.waitForTimeout(100);
    after = (await sea.getAttribute('data-sea-width')) ?? '';
  }
  await page.waitForTimeout(500);
  if (shotDir) await page.screenshot({ path: join(shotDir, `map-${tag}-zoomed-${after}.png`) });
  const frames = await page.evaluate(() => {
    const w = window as unknown as { __seaFrames: { src: string; ok: boolean }[]; __seaStop: boolean };
    w.__seaStop = true;
    return w.__seaFrames;
  });
  const blankFrames = frames.filter((f) => !f.ok).length;
  const swapped = already ? after === before : Number(after) > Number(before);
  return { before, after, blankFrames, frames: frames.length, ok: swapped && blankFrames === 0 };
}

function kindOf(type: string | undefined, mime: string | undefined, url: string): Kind {
  const t = (type ?? '').toLowerCase();
  const m = (mime ?? '').toLowerCase();
  if (t === 'image' || m.startsWith('image/') || /\.(png|webp|avif|jpe?g|svg|gif)(\?|$)/i.test(url)) return 'image';
  if (t === 'font' || m.startsWith('font/') || /\.(woff2?|ttf|otf)(\?|$)/i.test(url)) return 'font';
  if (t === 'script' || m.includes('javascript')) return 'script';
  if (t === 'stylesheet' || m.includes('css')) return 'style';
  return 'other';
}

/** 캐시를 끈 새 문맥 + CDP로 응답별 전송 바이트를 모은다 */
async function measured(browser: Browser, vp: { width: number; height: number; dpr: number }) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.dpr });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  const meta = new Map<string, { url: string; type?: string; mime?: string }>();
  const pending = new Set<string>();
  const entries: Entry[] = [];
  let lastActivity = Date.now();
  cdp.on('Network.requestWillBeSent', (e: { requestId: string; request: { url: string }; type?: string }) => {
    if (e.request.url.startsWith('data:')) return;
    meta.set(e.requestId, { url: e.request.url, type: e.type });
    pending.add(e.requestId);
    lastActivity = Date.now();
  });
  cdp.on('Network.responseReceived', (e: { requestId: string; type?: string; response: { mimeType?: string } }) => {
    const m = meta.get(e.requestId);
    if (m) {
      m.mime = e.response.mimeType;
      m.type = e.type ?? m.type;
    }
  });
  cdp.on('Network.loadingFinished', (e: { requestId: string; encodedDataLength: number }) => {
    const m = meta.get(e.requestId);
    pending.delete(e.requestId);
    lastActivity = Date.now();
    if (!m) return;
    entries.push({ url: m.url, kind: kindOf(m.type, m.mime, m.url), bytes: e.encodedDataLength });
  });
  cdp.on('Network.loadingFailed', (e: { requestId: string }) => {
    pending.delete(e.requestId);
    lastActivity = Date.now();
  });
  /** 진행 중 요청이 없고 quietMs 동안 새 요청이 없을 때까지(최대 maxMs) */
  const quiet = async (quietMs = 1500, maxMs = 30_000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      if (pending.size === 0 && Date.now() - lastActivity >= quietMs) return;
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  return { ctx, page, entries, quiet };
}

function summarize(route: string, label: string, viewport: string, budget: number, entries: Entry[]): Run {
  const totals: Record<Kind | 'all', number> = { image: 0, font: 0, script: 0, style: 0, other: 0, all: 0 };
  for (const e of entries) {
    totals[e.kind] += e.bytes;
    totals.all += e.bytes;
  }
  return { route, label, viewport, budget, entries, totals, ok: totals.image <= budget };
}

async function waitVisible(page: Page, testId: string, timeout = 20_000) {
  await page.getByTestId(testId).first().waitFor({ state: 'visible', timeout });
}

/** 교사 호스트(측정하지 않음): 판 설정(L1) → 방 열기 → 방 코드 */
async function openTeacherHost(browser: Browser, base: string): Promise<{ ctx: BrowserContext; t: Page; code: string }> {
  const ctx = await browser.newContext({ baseURL: base, viewport: { width: 1366, height: 768 } });
  const t = await ctx.newPage();
  await t.goto('./#/teacher');
  await waitVisible(t, 'teacher-start');
  await t.getByTestId('btn-new').click();
  await t.getByTestId('unit-lesson').click();
  await t.getByTestId('lesson-L1').click();
  const custom = t.getByTestId('trade-minutes-custom');
  await custom.fill('15');
  await custom.blur();
  await t.getByTestId('btn-open').click();
  const codeEl = t.getByTestId('room-code');
  await codeEl.waitFor({ state: 'visible', timeout: 15_000 });
  for (let i = 0; i < 150; i++) {
    const s = (await codeEl.innerText()).trim();
    if (/^\d{6}$/.test(s)) return { ctx, t, code: s };
    await t.waitForTimeout(100);
  }
  throw new Error('방 코드가 나오지 않음');
}

const VP = {
  '1366x768@1': { width: 1366, height: 768, dpr: 1 },
  '1180x820@2': { width: 1180, height: 820, dpr: 2 },
  '1920x1080@1': { width: 1920, height: 1080, dpr: 1 },
  /** 해도 바꿔 끼우기 확인용(예산 표에는 넣지 않음) — 처음 배율 기준 2560 사본에서 시작 */
  '700x500@1': { width: 700, height: 500, dpr: 1 },
} as const;
type VpKey = keyof typeof VP;

async function routeTitle(browser: Browser, web: StaticServer, vpKey: VpKey): Promise<Run> {
  const m = await measured(browser, VP[vpKey]);
  try {
    await m.page.goto(`${web.base}#/`);
    await waitVisible(m.page, 'route-title');
    await m.quiet();
    return summarize('가', '타이틀', vpKey, 1 * MB, m.entries);
  } finally {
    await m.ctx.close();
  }
}

let seatNo = 0;
async function routeStudent(browser: Browser, web: StaticServer, vpKey: VpKey): Promise<Run> {
  const host = await openTeacherHost(browser, web.base);
  const m = await measured(browser, VP[vpKey]);
  try {
    await m.page.goto(`${web.base}#/`);
    await waitVisible(m.page, 'route-title');
    await m.page.getByRole('link', { name: '학생으로 참여' }).click();
    await waitVisible(m.page, 'student-entry');
    seatNo++;
    await m.page.getByTestId('entry-code').fill(host.code);
    await m.page.getByTestId('entry-seat').selectOption(String(seatNo));
    await m.page.getByTestId('entry-name').fill(`측정상회${seatNo}`);
    await m.page.getByTestId('entry-submit').click();
    await waitVisible(m.page, 'found-company');
    await m.page.getByTestId('found-submit').click();
    await waitVisible(m.page, 'prep-wait');
    await m.quiet(1000);
    // 교사 [무역 시작] → 학생 해도
    await host.t.getByTestId('btn-start-trade').click();
    await host.t.getByTestId('confirm-ok').click();
    await waitVisible(m.page, 'world-map', 30_000);
    await m.page.locator('.wm-sea.is-loaded').first().waitFor({ state: 'attached', timeout: 30_000 });
    await m.quiet();
    const run = summarize('나', '학생 → 해도', vpKey, 3 * MB, [...m.entries]);
    run.zoom = await zoomCheck(m.page, vpKey.replace('@', '-'));
    return run;
  } finally {
    await m.ctx.close();
    await host.ctx.close();
  }
}

async function routeTeacher(browser: Browser, web: StaticServer, vpKey: VpKey): Promise<Run> {
  const m = await measured(browser, VP[vpKey]);
  try {
    await m.page.goto(`${web.base}#/`);
    await waitVisible(m.page, 'route-title');
    await m.page.getByRole('link', { name: '선생님으로 시작' }).click();
    await waitVisible(m.page, 'teacher-start');
    await m.quiet();
    return summarize('다', '교사 → T01', vpKey, 3 * MB, m.entries);
  } finally {
    await m.ctx.close();
  }
}

const kb = (n: number) => `${(n / 1000).toFixed(1)} KB`;
const mb = (n: number) => `${(n / MB).toFixed(2)} MB`;

function shortUrl(u: string): string {
  try {
    return decodeURIComponent(new URL(u).pathname.replace(/^\/voyage\//, ''));
  } catch {
    return u;
  }
}

function zoomLine(r: Run): string {
  const z = r.zoom!;
  const how = Number(z.before) >= SEA_MAX ? '처음부터 원본 폭 — 바꿀 필요 없음' : '큰 사본으로 바뀜';
  return `해도 확대 확인 (${r.viewport}): 사본 폭 ${z.before} → ${z.after}, 기록한 프레임 ${z.frames}개 중 그림이 빈 프레임 ${z.blankFrames}개 — ${z.ok ? `OK(${how}, 깜박임 없음)` : '실패'}`;
}

function report(runs: Run[], swap: Run | null): string {
  const lines: string[] = [];
  lines.push('| 경로 | 뷰포트 | 이미지 | 글꼴 | 스크립트 | 스타일 | 그 밖 | 전체 | 이미지 예산 | 판정 |');
  lines.push('|---|---|---:|---:|---:|---:|---:|---:|---:|---|');
  for (const r of runs) {
    const t = r.totals;
    lines.push(
      `| (${r.route}) ${r.label} | ${r.viewport} | ${mb(t.image)} | ${kb(t.font)} | ${kb(t.script)} | ${kb(t.style)} | ${kb(t.other)} | ${mb(t.all)} | ${mb(r.budget)} | ${r.ok ? 'OK' : '초과'} |`,
    );
  }
  for (const r of runs.filter((x) => x.zoom)) lines.push('', zoomLine(r));
  if (swap?.zoom) lines.push('', `${zoomLine(swap)} (바꿔 끼우기 확인용 좁은 화면, 예산 표 밖 — 이 실행의 이미지 ${mb(swap.totals.image)})`);
  for (const r of runs) {
    lines.push('', `### (${r.route}) ${r.label} ${r.viewport} — 큰 파일 상위 10개`, '', '| 파일 | 종류 | 크기 |', '|---|---|---:|');
    for (const e of [...r.entries].sort((a, b) => b.bytes - a.bytes).slice(0, 10)) lines.push(`| ${shortUrl(e.url)} | ${e.kind} | ${kb(e.bytes)} |`);
  }
  return lines.join('\n');
}

export default async function main(args: string[]): Promise<number> {
  const oi = args.indexOf('--out');
  const out = resolve(ROOT, oi >= 0 && args[oi + 1] ? args[oi + 1]! : join('tmp', 'size-report'));
  if (!existsSync(join(ROOT, 'dist', 'index.html')) || !existsSync(join(ROOT, 'server', 'dist', 'index.js'))) {
    console.error('dist/·server/dist/가 없어요 — npm run build && npm run build:server 뒤에 돌리세요(npm run size:report 는 둘 다 함).');
    return 2;
  }
  mkdirSync(join(ROOT, 'tmp'), { recursive: true });
  mkdirSync(out, { recursive: true });
  shotDir = out;
  let relay: RelayProcess | null = null;
  let web: StaticServer | null = null;
  let browser: Browser | null = null;
  const runs: Run[] = [];
  let swapRun: Run | null = null;
  try {
    relay = await startRelayProcess();
    web = await startStatic({ relayPort: relay.port });
    browser = await chromium.launch();
    for (const v of ['1366x768@1', '1180x820@2'] as const) runs.push(await routeTitle(browser, web, v));
    for (const v of ['1366x768@1', '1180x820@2'] as const) runs.push(await routeStudent(browser, web, v));
    swapRun = await routeStudent(browser, web, '700x500@1');
    for (const v of ['1366x768@1', '1920x1080@1'] as const) runs.push(await routeTeacher(browser, web, v));
  } finally {
    await browser?.close();
    await web?.close();
    await relay?.stop();
  }
  const md = report(runs, swapRun);
  console.log(md);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'report.md'), `# 첫 화면 전송량 (npm run size:report)\n\n${new Date().toISOString()}\n\n${md}\n`, 'utf8');
  writeFileSync(
    join(out, 'summary.json'),
    JSON.stringify(
      runs.map((r) => ({ route: r.route, label: r.label, viewport: r.viewport, budget: r.budget, ok: r.ok, totals: r.totals, zoom: r.zoom ?? null, files: r.entries.map((e) => ({ path: shortUrl(e.url), kind: e.kind, bytes: e.bytes })) })),
      null,
      2,
    ),
    'utf8',
  );
  const bad = [...runs.filter((r) => !r.ok || (r.zoom && !r.zoom.ok)), ...(swapRun?.zoom && !swapRun.zoom.ok ? [swapRun] : [])];
  if (bad.length) {
    console.error(
      `\n예산 초과·확대 확인 실패: ${bad.map((r) => `(${r.route}) ${r.viewport} 이미지 ${mb(r.totals.image)} / 예산 ${mb(r.budget)}${r.zoom && !r.zoom.ok ? ' · 해도 확대 확인 실패' : ''}`).join(', ')}`,
    );
    return 1;
  }
  console.log(`\n모든 경로가 예산 안이에요. 결과: ${join(out, 'report.md')}`);
  return 0;
}
