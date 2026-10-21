/**
 * 작업 135 리허설 — 시나리오 하나를 처음부터 끝까지 돌리고 막힘 탐지기로 문제를 모은다.
 *
 * 참여자: 교사 1(실제 교사 화면) + 공용 화면 1(#/screen 창) + 학생 25명(실제 학생 화면 브라우저 4 + 봇 21, 모두 실제 중계 서버 연결).
 * 시간: e2e 빨리 감기 시계(e2e/support/fast-clock.ts — 서버 pong을 빠른 시각으로 바꿔 게임 시계 = 빠른 시각). `--realtime`이면 1배.
 * 앱 코드는 고치지 않는다. 화면은 testid·보이는 글자만, 학급 진행은 봇이 받는 공개 상태(PublicPayload)만 본다.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { COMPANY_NAMES, rng } from '../sim/bot';
import { nameFilter } from '../../src/data/name-filter';
import { validateCompanyName } from '../../src/sync/company-name';
import { FastClock } from '../../e2e/support/fast-clock';
import { startRelayProcess, ROOT, type RelayProcess, getJson } from '../../e2e/support/voyage-servers';
import { startSite, type SiteServer } from './static';
import { newContext, type Env } from '../../e2e/support/voyage-ui';
import { openBotPage, readAppVersion } from './bots';
import { chaosAct, newChaosStats } from './chaos';
import type { BotSpec, BotStatus, PubSummary } from './bot-page';
import {
  Collector,
  EXPECTED_REJECTS,
  Streak,
  hasRoundGuidance,
  hasStartConfirmRoundHint,
  hasTeacherRoundCountdown,
  isPreviewAct,
  layerLegit,
  mergeCounts,
  mmss,
  parseHudMoney,
  parseTableMoney,
  type DetectorKind,
  type Severity,
} from './detector';
import { relayEnv } from './env';
import type { ScenarioResult } from './report';
import { NAME_PLAN, type BreakId, type CrowdOp, type Scenario, type TeacherOp, type Timed } from './scenarios';
import { canTrade, hasTask, newBrainMem, probeStudent, studentStep, type BrainMem, type StudentProbe } from './student';

/** 준비 중 기능(기능 플래그가 꺼짐) 때문에 시나리오를 더 진행할 수 없음 — 도구 오류가 아니라 '준비 중 기능(참고)' */
class PreviewBlocked extends Error {}

export interface RunOptions {
  outDir: string;
  /** null = 로컬(빌드본 + 로컬 중계 서버) */
  target: string | null;
  speed: number;
  breaks: BreakId[];
  seed: number;
  /** 전체 health 기록(보고서 맨 위) */
  health: { maxPeers: number; maxConns: number; maxMemMB: number };
  pids: number[];
  /** 로컬: 실행 시작 때 복사한 빌드본(dist/ 사본) */
  siteDir?: string;
}

/** 금칙어가 섞인 회사 이름(보고서에는 낱말을 쓰지 않는다) */
function badName(): string {
  for (const w of [...nameFilter.categories.teasing, ...nameFilter.categories.profanity]) {
    const n = `${w}무역`;
    const v = validateCompanyName(n);
    if (!v.ok && v.error === 'BAD_NAME' && [...n].length <= 10) return n;
  }
  return '바보무역';
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Slot {
  seat: number;
  label: string;
  name: string;
  ctx: BrowserContext;
  page: Page | null;
  probe: StudentProbe | null;
  probeAt: number;
  mem: BrainMem;
  diligence: number;
  /** 지금 떠 있는 학습지 묶음 가운데 이 학생이 본 것 */
  wsSeen: Set<string>;
  wsProbes: Map<string, number>;
  joinedRound: number;
  idleWait: Streak;
  noAction: Streak;
  /** (수정 1) 맨 위 층이 공개 상태와 맞지 않는 채 이어진 시간 / 화면 가운데 창이 이어진 시간(빠른 시계) */
  layerBad: Streak;
  modalLong: Streak;
  busy: boolean;
  gone: boolean;
}

interface Frames {
  sent: number;
  recv: number;
  buckets: Map<number, number>;
}

interface Reconnect {
  who: string;
  kind: 'bot' | 'browser' | 'teacher' | 'server';
  startReal: number;
  startFast: number;
  seat?: number;
  done: boolean;
  limitRealMs: number;
}

export async function runScenario(browser: Browser, sc: Scenario, o: RunOptions): Promise<ScenarioResult> {
  const col = new Collector(sc.id);
  const real0 = Date.now();
  const shotsDir = join(o.outDir, 'shots');
  mkdirSync(shotsDir, { recursive: true });
  const breaks = new Set(o.breaks);
  const metrics: Record<string, unknown> = {};
  const rand = rng(o.seed + sc.id.charCodeAt(0));
  const local = o.target === null;
  let relay: RelayProcess | null = null;
  let web: SiteServer | null = null;
  const env: Env = { browser, base: '', clock: new FastClock(), errors: [], contexts: [] };
  const errs: { at: number; label: string; text: string }[] = [];
  const frames = new Map<string, Frames>();
  const codes: { at: number; who: string; code: string; dir: string; act?: string }[] = [];
  const lastAct = new Map<string, string>();
  const healthSamples: { t: number; peers: number; conns: number; memMB: number; rooms: number }[] = [];
  const windows: { from: number; to: number; why: string }[] = []; // 서버 재시작·교사 새로 고침 구간(실제 ms) — 그때 끊김은 의도
  const reconnects: Reconnect[] = [];
  const slots = new Map<number, Slot>();
  let shotN = 0;
  let pub = null as PubSummary | null;
  let tp = null as TeacherProbe | null;
  let stop = false as boolean;
  let tradeStartFast: number | null = null;
  let tradeEndFast = null as number | null;
  let extraAllowFast = 0;
  let firstRoundFast: number | null = null;
  let roundsSeen = 0;
  let lastPhase = '';
  let breaksApplied = false;
  let noEndPause = false;
  let hideFireOn = false;
  /** (수정 1) 층·가림 고장 플래그를 넣은 학생 자리 — 그 학생의 '도구 문제' 참고는 빼고 탐지 결과만 남긴다 */
  const breakSeats = new Set<number>();
  const wsEpisode = { key: '', startReal: 0, startRound: 0 };
  const results: ScenarioResult = {
    id: sc.id,
    title: sc.title,
    target: o.target ?? 'local',
    speed: o.speed,
    breaks: [...breaks],
    finished: false,
    tradeSec: null,
    allowedSec: null,
    realSec: 0,
    problems: col.problems,
    steps: col.steps,
    metrics,
  };
  const now = () => env.clock.now();
  const at = () => (pub && pub.startedAt ? mmss(tradeElapsed(pub)) : '시작 전');
  const step = (s: string) => {
    col.step(`[${at()}] ${s}`);
    if (process.env.REHEARSAL_LOG) console.log(`  ${sc.id} [${at()}] ${s}`);
  };

  const snap = async (p: Page | null | undefined, name: string): Promise<string[]> => {
    if (!p || p.isClosed() || shotN >= 40) return [];
    const f = `${sc.id}-${String(++shotN).padStart(2, '0')}-${name.replace(/[^\w가-힣-]/g, '_')}.png`;
    try {
      await p.screenshot({ path: join(shotsDir, f), timeout: 8000 });
      return [`shots/${f}`];
    } catch {
      return [];
    }
  };
  const relayTail = (n = 8) => (relay ? relay.logs.filter((l) => !/"stats"/.test(l)).slice(-n) : []);
  const problem = async (p: { kind: DetectorKind; severity: Severity; key: string; title: string; detail: string; who?: string[]; page?: Page | null; logs?: string[] }) => {
    const fresh = !col.has(p.key);
    const pr = col.add({ kind: p.kind, severity: p.severity, key: p.key, title: p.title, detail: p.detail, at: at(), who: p.who ?? [], logs: p.logs ?? [] });
    if (fresh) {
      step(`탐지: [${p.severity}] ${p.title}`);
      if (p.page) pr.shots.push(...(await snap(p.page, p.kind)));
      if (!p.logs) pr.logs.push(...errs.slice(-5).map((e) => `${e.label}: ${e.text}`), ...relayTail(4));
    }
  };

  const watch = (p: Page, label: string) => {
    p.on('pageerror', (e) => errs.push({ at: Date.now(), label, text: `pageerror: ${e.message}` }));
    p.on('console', (m) => {
      if (m.type() !== 'error') return;
      const t = m.text();
      if (/^Failed to load resource/.test(t)) return;
      errs.push({ at: Date.now(), label, text: `console: ${t.slice(0, 300)}` });
    });
    p.on('response', (r) => {
      if (r.status() < 400) return;
      const path = new URL(r.url()).pathname;
      if (r.status() === 404 && path.endsWith('/config.json')) return;
      errs.push({ at: Date.now(), label, text: `http ${r.status()}: ${path}` });
    });
    p.on('requestfailed', (r) => {
      const path = new URL(r.url()).pathname;
      if (/__rehearsal/.test(path)) return;
      errs.push({ at: Date.now(), label, text: `requestfailed: ${path} ${r.failure()?.errorText ?? ''}` });
    });
    const fr = frames.get(label) ?? { sent: 0, recv: 0, buckets: new Map<number, number>() };
    frames.set(label, fr);
    p.on('websocket', (ws) => {
      // 이 연결이 보낸 마지막 행동(되돌림 응답과 짝지어 보고서에 적는다 — 봇 페이지는 봇마다 연결이 따로라 연결 단위로 기억)
      const wsKey = `${label}#${ws.url()}#${Math.random()}`;
      ws.on('framesent', (f) => {
        fr.sent++;
        if (typeof f.payload === 'string' && f.payload.includes('act')) {
          const ty = /type\\?":\\?"(\w+)/.exec(f.payload)?.[1];
          const ev = /(?:eventId|qid|slotId)\\?":\\?"([\w-]+)/.exec(f.payload)?.[1];
          if (ty) lastAct.set(wsKey, ev ? `${ty} ${ev}` : ty);
        }
        const sec = Math.floor(Date.now() / 1000);
        fr.buckets.set(sec, (fr.buckets.get(sec) ?? 0) + 1);
      });
      ws.on('framereceived', (f) => {
        fr.recv++;
        const s = typeof f.payload === 'string' ? f.payload : '';
        if (s.length > 20000 || !/ok\\?":false|t\\?":\\?"error|reject|denied/.test(s)) return;
        for (const m of s.matchAll(/(?:error|reason|code)\\?"\s*:\s*\\?"([A-Z][A-Z_]{2,})/g)) {
          const dir = /reject|denied/.test(s) ? '입장' : /t\\?":\\?"error/.test(s) ? '서버' : '행동';
          const act = dir === '행동' ? lastAct.get(wsKey) : undefined;
          codes.push({ at: Date.now(), who: label, code: m[1]!, dir, ...(act ? { act } : {}) });
        }
      });
    });
  };

  const newPage = async (label: string, ctx?: BrowserContext): Promise<{ ctx: BrowserContext; page: Page }> => {
    const c = ctx ?? (await newContext(env));
    const page = await c.newPage();
    watch(page, label);
    return { ctx: c, page };
  };

  let t: Page | null = null;
  let scr: Page | null = null;
  let bots: Page | null = null;
  let code = '';
  let ended = false;
  const loops: Promise<void>[] = [];

  try {
    // ── 서버 ──
    if (local) {
      relay = await startRelayProcess({ env: relayEnv() });
      if (relay.proc?.pid) o.pids.push(relay.proc.pid);
      const rp = relay;
      web = await startSite({ dir: o.siteDir ?? join(ROOT, 'dist'), relayPort: () => rp.port });
      env.base = web.base;
    } else env.base = o.target!.endsWith('/') ? o.target! : `${o.target}/`;
    const healthUrl = new URL('health', env.base).href;
    const h0 = await getJson(healthUrl);
    step(`서버 /health: rooms ${String(h0?.rooms)} / maxRooms ${String(h0?.maxRooms)} · maxConn ${String(h0?.maxConn)} · 버전 ${String(h0?.version)}`);
    metrics.server = h0 ? { maxRooms: h0.maxRooms, maxConn: h0.maxConn, version: h0.version } : null;
    const appVersion = await readAppVersion(env.base);

    // health 주기 기록(2초)
    loops.push(
      (async () => {
        let fails = 0;
        while (!stop) {
          const h = await getJson(healthUrl);
          const inWin = windows.some((w) => Date.now() >= w.from && Date.now() <= w.to + 15_000);
          if (h) {
            fails = 0;
            const s = { t: Date.now() - real0, peers: Number(h.peers) || 0, conns: Number(h.conns) || 0, memMB: Number(h.memMB) || 0, rooms: Number(h.rooms) || 0 };
            healthSamples.push(s);
            o.health.maxPeers = Math.max(o.health.maxPeers, s.peers);
            o.health.maxConns = Math.max(o.health.maxConns, s.conns);
            o.health.maxMemMB = Math.max(o.health.maxMemMB, s.memMB);
            if (s.memMB > 150) await problem({ kind: 'health', severity: '문제', key: 'health-mem', title: `중계 서버 메모리 ${s.memMB}MB(150MB 넘음)`, detail: `30방 목표 RSS 150MB(docs/server-setup.md 1.3.2)를 방 1개에서 넘었어요. peers ${s.peers}, conns ${s.conns}.` });
          } else if (!inWin && ++fails >= 3) {
            await problem({ kind: 'health', severity: '문제', key: 'health-down', title: '/health 응답 없음(6초 넘게)', detail: '서버 재시작 구간이 아닌데 /health가 응답하지 않았어요.' });
          }
          await sleep(2000);
        }
      })(),
    );

    // ── 교사: 판 설정 → 방 열기 ──
    const tp0 = await newPage('교사');
    t = tp0.page;
    await t.goto('./#/teacher');
    await t.getByTestId('teacher-start').waitFor({ timeout: 30_000 });
    await t.getByTestId('btn-new').click();
    if (sc.unit) {
      // (보완 1) 단원 한 판은 기능 플래그 FULL_UNIT_READY=false로 '준비 중'(선택 불가). 시나리오에 preview가 있으면 개발용 열쇠로 이 교사 브라우저에서만 연다
      const unitBtn = t.getByTestId('unit-unit');
      const soon = await t.getByTestId('unit-soon').innerText({ timeout: 2000 }).catch(() => '');
      const disabled = await unitBtn.isDisabled().catch(() => false);
      if (disabled && sc.preview) {
        step(`단원 한 판 '준비 중'(${soon.replace(/\s+/g, ' ').slice(0, 60) || 'unit-unit 비활성'}) → 개발용 열쇠 ${sc.preview.devKey}로 이 교사 브라우저에서만 엶`);
        await t.evaluate((k) => localStorage.setItem(k, '1'), sc.preview.devKey);
        await t.reload();
        await t.getByTestId('teacher-start').waitFor({ timeout: 30_000 });
        await t.getByTestId('btn-new').click();
        metrics.preview = `${sc.preview.why} — 개발용 열쇠 ${sc.preview.devKey}로 열어 돌림`;
      } else if (!disabled && sc.preview) metrics.preview = '단원 한 판이 이미 열려 있음(FULL_UNIT_READY=true?) — 열쇠 없이 돌림';
      if (await unitBtn.isDisabled().catch(() => false)) {
        col.add({ kind: 'preview', severity: '참고', key: 'preview-blocked', title: `[준비 중 기능] 단원 한 판을 고를 수 없어 시나리오 ${sc.id}를 건너뜀`, detail: `판 설정 화면의 [단원 한 판]이 비활성이에요(기능 플래그 FULL_UNIT_READY=false${sc.preview ? `, 개발용 열쇠 ${sc.preview.devKey}로도 열리지 않음` : ''}). 안내: "${soon.replace(/\s+/g, ' ').slice(0, 80)}". 앱 문제가 아니라 준비 중 기능이에요.`, at: '시작 전', shots: await snap(t, 'unit-soon') });
        throw new PreviewBlocked('단원 한 판 준비 중');
      }
      await unitBtn.click();
    } else {
      await t.getByTestId('unit-lesson').click();
      await t.getByTestId(`lesson-${sc.lesson ?? 'L1'}`).click();
    }
    const custom = t.getByTestId('trade-minutes-custom');
    await custom.fill(String(sc.minutes));
    await custom.blur();
    if (sc.manual) {
      // (작업 138) 진행 방식은 판 설정 [고급 설정] 안 — 접혀 있으면 먼저 펼친다. 버튼은 값(data-value)으로 찾는다(보이는 말: '선생님이 하나씩 넘기기')
      const adv = t.getByTestId('setup-advanced');
      const wasOpen = (await adv.getAttribute('open')) !== null;
      if (!wasOpen) await adv.locator(':scope > summary').click();
      const manualBtn = t.locator('[data-testid="progress-mode"] button[data-value="manual"]');
      await manualBtn.click();
      const pressed = await manualBtn.getAttribute('aria-pressed');
      step(`[고급 설정] ${wasOpen ? '이미 펼쳐짐' : '펼침'} → 진행 방식 '${(await manualBtn.innerText()).trim()}'(수동) 선택(aria-pressed=${pressed})`);
    }
    await t.getByTestId('btn-open').click();
    await t.getByTestId('room-code').waitFor({ timeout: 20_000 });
    code = (await t.getByTestId('room-code').innerText()).trim();
    step(`교사: 방 열기(${sc.unit ? '단원 한 판' : `차시 ${sc.lesson ?? 'L1'}`} ${sc.minutes}분 ${sc.manual ? '수동' : '자동'}) — 방 코드 받음`);
    // 공용 화면 창(작업 137: 위쪽 띠 [TV 화면 ▾] 안)
    await t.getByTestId('tv-menu').click();
    const [screenPage] = await Promise.all([t.context().waitForEvent('page'), t.getByTestId('btn-open-screen').click()]);
    scr = screenPage;
    watch(scr, '공용 화면');
    await scr.setViewportSize({ width: 1920, height: 1080 }).catch(() => undefined);

    // ── 봇 페이지 ──
    const botCtx = await newContext(env);
    bots = await openBotPage(botCtx, env.base, web ?? undefined);
    watch(bots, '봇');
    if (process.env.REHEARSAL_LOG) bots.on('console', (m) => console.log(`  [봇 콘솔 ${m.type()}] ${m.text().slice(0, 200)}`));
    await bots.evaluate((a) => window.__rb!.init(a), { code, seed: o.seed, appVersion, tickMs: 2000 });
    const botsPage = bots;
    const botStatus = async (): Promise<BotStatus[]> => botsPage.evaluate(() => window.__rb!.status()).catch(() => []);

    // ── 이름 계획 ──
    const names = COMPANY_NAMES.slice(0, 40);
    const bad = badName();
    const nameOf = (seat: number) => names[seat - 1]!;
    const lateSeats = new Set(sc.crowd.flatMap((c) => (c.do.op === 'lateJoin' ? c.do.seats : [])));
    const botSpec = (seat: number): BotSpec => {
      const profile = seat % 7 === 0 ? 'idle' : seat % 4 === 0 ? 'slow' : 'good';
      const first = seat === NAME_PLAN.botDup ? nameOf(NAME_PLAN.botDupOf) : seat === NAME_PLAN.botBad ? bad : nameOf(seat);
      return { seat, names: [first, nameOf(seat), `${nameOf(seat)}${seat}`], profile };
    };

    // ── 브라우저 학생 4명 입장(2번: 1번과 같은 이름 → 거절 → 새 이름, 3번: 금칙어 → 거절 → 새 이름) ──
    const browserSeats = [1, 2, 3, 4];
    const enterBrowser = async (seat: number) => {
      const { ctx, page } = await newPage(`학생${seat}`);
      await page.goto('./#/play');
      await page.getByTestId('student-entry').waitFor({ timeout: 20_000 });
      const slot: Slot = {
        seat,
        label: `학생${seat}`,
        name: nameOf(seat),
        ctx,
        page,
        probe: null,
        probeAt: 0,
        mem: newBrainMem(),
        diligence: seat === 4 ? 0.3 : seat === 3 ? 0.6 : 0.9,
        wsSeen: new Set(),
        wsProbes: new Map(),
        joinedRound: pub?.round ?? 0,
        idleWait: new Streak(),
        layerBad: new Streak(),
        modalLong: new Streak(),
        noAction: new Streak(),
        busy: false,
        gone: false,
      };
      slots.set(seat, slot);
      const tryName = async (name: string): Promise<string | null> => {
        await page.getByTestId('entry-code').fill(code);
        await page.getByTestId('entry-seat').selectOption(String(seat));
        await page.getByTestId('entry-name').fill(name);
        await page.getByTestId('entry-submit').click({ timeout: 3000 }).catch(() => undefined);
        for (let i = 0; i < 40; i++) {
          if (await page.getByTestId('found-company').isVisible().catch(() => false)) return null;
          if (await page.getByTestId('hud').isVisible().catch(() => false)) return null;
          const err = page.getByTestId('entry-error');
          if (await err.isVisible().catch(() => false)) return (await err.getAttribute('data-code')) ?? 'ERROR';
          const hint = page.getByTestId('entry-name-hint');
          if (i > 6 && (await hint.isVisible().catch(() => false)) && (await page.getByTestId('entry-submit').isDisabled().catch(() => false))) return 'BAD_NAME(기기 검사)';
          await sleep(250);
        }
        return 'TIMEOUT';
      };
      const first = seat === NAME_PLAN.browserDup ? nameOf(NAME_PLAN.browserDupOf) : seat === NAME_PLAN.browserBad ? bad : slot.name;
      const r1 = await tryName(first);
      if (r1) {
        codes.push({ at: Date.now(), who: slot.label, code: r1, dir: '입장(화면)' });
        step(`${slot.label}: 첫 이름 거절(${r1}) → 다시 짓기`);
        const r2 = await tryName(slot.name);
        if (r2) await problem({ kind: 'reconnect', severity: '막힘', key: `enter-${seat}`, title: `${slot.label} 입장 실패(${r2})`, detail: '새 이름으로도 들어가지 못했어요.', who: [slot.label], page });
      }
    };
    for (const s of browserSeats) await enterBrowser(s);
    // 봇 21명(늦게 오는 학생 제외)
    for (let seat = 5; seat <= 25; seat++) if (!lateSeats.has(seat)) await botsPage.evaluate((s) => window.__rb!.add(s), botSpec(seat));
    // 회사 설립까지 기다림
    const wantNow = 25 - lateSeats.size;
    for (let i = 0; i < 120; i++) {
      for (const s of slots.values()) if (s.page && (await s.page.getByTestId('found-company').isVisible().catch(() => false))) await s.page.getByTestId('found-submit').click().catch(() => undefined);
      const st = await botStatus();
      const rows = await t.getByTestId('student-row').count();
      if (st.filter((b) => b.status === 'in' && b.founded).length >= wantNow - 4 && rows >= wantNow) break;
      await sleep(500);
    }
    const st0 = await botStatus();
    for (const b of st0.filter((x) => x.status !== 'in')) step(`봇 ${b.seat}번 아직 못 들어옴: ${b.status} ${b.err ?? ''} 시도 ${b.joinTries} 거절 ${JSON.stringify(b.rejects)} ${b.statusLog.map((x) => x.status).join('→')}`);
    step(`입장: 교사 표 ${await t.getByTestId('student-row').count()}줄, 봇 in ${st0.filter((b) => b.status === 'in').length}/${st0.length}, 설립 ${st0.filter((b) => b.founded).length}`);
    if (st0.some((b) => b.versionMismatch)) await problem({ kind: 'harness', severity: '참고', key: 'bot-version', title: '봇 앱 버전이 교사와 다름(도구)', detail: `빌드 버전을 읽지 못했어요(appVersion='${appVersion}').` });

    // ── [무역 시작] ──
    await t.getByTestId('btn-start-trade').click();
    const confirmText = await t.getByTestId('confirm-start').innerText({ timeout: 5000 }).catch(async () => t!.locator('[role="dialog"]').first().innerText().catch(() => ''));
    metrics.startConfirmText = confirmText.replace(/\s+/g, ' ').slice(0, 300);
    if (!hasStartConfirmRoundHint(confirmText))
      await problem({ kind: 'teacher-guidance', severity: '혼란', key: 'start-confirm-hint', title: '[무역 시작] 확인 창에 "라운드 1까지 얼마나" 안내 없음', detail: `확인 창 글: "${metrics.startConfirmText as string}" — 먼저 할 활동과 라운드 1이 시작되는 시각이 없어 교사가 라운드가 언제 열리는지 알 수 없어요(134에서 고칠 예정).`, page: t });
    await t.getByTestId('confirm-ok').click();
    await t.getByTestId('trade-clock').waitFor({ timeout: 15_000 });
    tradeStartFast = now();
    step('교사: [무역 시작]');
    if (breaks.has('hide-fire') && sc.manual) {
      await t.addStyleTag({ content: '[data-testid="tl-waiting"],[data-testid="btn-fire"]{display:none!important}' });
      hideFireOn = true;
      step('고장 플래그 hide-fire: 교사 [발동] 안내 숨김');
    }
    // (작업 137) 학습지·편지 패널은 오른쪽 접힘 영역 '학습지'·'편지·돌발 사건·공정한 바다'
    for (const f of ['worksheet', 'more']) await openFoldOf(t, f);
    await env.clock.setSpeed(o.speed);

    // ── 학생 두뇌(브라우저 4명): 화면 훑기 → 한 가지 행동 ──
    const wsKey = () => (pub?.worksheet.current.length ? `${pub.worksheet.current.join('+')}${pub.worksheet.during ? '*' : ''}` : '');
    const CHAOS_SEATS = new Set(process.env.REHEARSAL_CHAOS ? [2, 3, 4] : []);
    const chaosStats = newChaosStats();
    const brain = async (slot: Slot) => {
      while (!stop) {
        const p = slot.page;
        if (!p || p.isClosed() || slot.busy) {
          await sleep(300);
          continue;
        }
        if (CHAOS_SEATS.has(slot.seat) && rand() < 0.55) {
          const what = await chaosAct(p, rand, chaosStats);
          if (chaosStats.clicks + chaosStats.dbl + chaosStats.burst + chaosStats.typed + chaosStats.keys < 6 || what.includes('앱 밖') || what.startsWith('실패') && chaosStats.fails < 4) step(`말썽 학생${slot.seat}: ${what}`);
          const tot = chaosStats.clicks + chaosStats.dbl + chaosStats.burst + chaosStats.typed + chaosStats.keys;
          if (tot % 60 === 0) step(`말썽 학생 누적: 클릭 ${chaosStats.clicks} · 더블 ${chaosStats.dbl} · 연타 ${chaosStats.burst} · 입력 ${chaosStats.typed} · 키 ${chaosStats.keys} · 새로고침 ${chaosStats.reloads} · 뒤로 ${chaosStats.backs} · 앱 이탈 ${chaosStats.strays} · 실패 ${chaosStats.fails}`);
          await sleep(120 + Math.floor(rand() * 250));
          continue;
        }
        const pr = await probeStudent(p);
        if (pr) {
          slot.probe = pr;
          slot.probeAt = Date.now();
          if (pr.letters > 0) slot.mem.seen.add('letter');
          const k = wsKey();
          if (k) {
            slot.wsProbes.set(k, (slot.wsProbes.get(k) ?? 0) + 1);
            if (pr.worksheet) slot.wsSeen.add(k);
          }
          await studentStep(p, pr, { label: slot.label, diligence: slot.diligence, rand, ports: () => (pub?.openPorts ?? []).filter((x) => x), phase: () => pub?.phase ?? null, log: (s) => step(s), shot: (name) => snap(p, `${slot.label}-${name}`), now: () => env.clock.now(), blockedClick: (id, top, shots) => void blocked(slot, id, top, shots) }, slot.mem);
        }
        await sleep(250);
      }
    };
    // (수정 1) 핵심 버튼(거래·출항·학습지)이 정상 층이 아닌 것에 가려 눌리지 않음 — 횟수와 상관없이 [문제](고장 플래그 대상이어도 그대로 — 탐지 확인용)
    const blocked = async (slot: Slot, id: string, top: string, shots: string[]) => {
      const key = `blocked-click-${slot.seat}-${id.replace(/ .*/, '')}`;
      const fresh = !col.has(key);
      const pr = col.add({ kind: 'blocked-click', severity: '문제', key, title: `${slot.label}: [${id.replace(/ .*/, '')}]가 정상 층이 아닌 것에 가려 눌리지 않음`, detail: `단계 ${pub?.phase ?? '-'}${pub?.phase === 'round' ? ` ${pub.round}` : ''}. 맨 위 요소: ${top}. 사건·학습지·창 같은 정상 층이 아닌데 버튼을 덮고 있어요(투명 층·남은 요소·pointer-events 등).`, at: at(), who: [slot.label], logs: [`${slot.label}: ${top}`] });
      if (fresh) {
        step(`탐지: [문제] ${pr.title}`);
        pr.shots.push(...shots);
      }
    };
    for (const s of slots.values()) loops.push(brain(s));

    // ── 공개 상태 받기(봇 페이지) ──
    loops.push(
      (async () => {
        while (!stop) {
          const p = await botsPage.evaluate(() => window.__rb!.pub()).catch(() => null);
          if (p) pub = p;
          await sleep(400);
        }
      })(),
    );

    // ── 교사 화면 훑기 ──
    loops.push(
      (async () => {
        while (!stop) {
          if (t && !t.isClosed()) tp = await probeTeacher(t);
          await sleep(500);
        }
      })(),
    );

    // ── 예약된 일(교사 조작·학생 무리) ──
    const pendingT = [...sc.teacher];
    const pendingC = [...sc.crowd];
    const backs: { dueFast: number; seat: number; newDevice: boolean }[] = [];
    const browserBacks: { dueFast: number; seat: number }[] = [];
    let teacherBusy = false;
    let fireSeenAt: number | null = null;
    const fireNoEffect = new Map<string, number>();
    let approveSeenAt: number | null = null;
    let timeUpSeenAt: number | null = null;
    let finishSeenAt: number | null = null;
    let planDoneSeenAt: number | null = null;
    let startRoundNowUsed: string = '안 함';

    const ready = (x: Timed<unknown>): boolean => {
      if (!pub || !pub.startedAt) return false;
      const frac = tradeElapsed(pub) / Math.max(1, pub.durationSec);
      if (frac < x.at) return false;
      if (x.phase === 'round') return pub.phase === 'round';
      if (x.phase === 'event-open') return Boolean(pub.event && !pub.event.closed);
      if (x.phase === 'pre-round') return pub.round === 0 && pub.phase !== 'round';
      return true;
    };

    const doTeacher = async (op: TeacherOp) => {
      const T = t!;
      teacherBusy = true;
      try {
        switch (op.op) {
          case 'pause': {
            await T.getByTestId('btn-pause').click();
            step(`교사: 일시정지(${op.holdSec}초)`);
            const p0 = now();
            while (now() - p0 < op.holdSec * 1000 && !stop) await sleep(200);
            await T.getByTestId('btn-resume-trade').click();
            extraAllowFast += now() - p0;
            step('교사: 이어서 하기');
            break;
          }
          case 'extend1':
            await openFoldOf(T, 'time'); // (작업 137) '시간 조절' 접힘 영역
            await T.getByTestId('btn-extend-1').click();
            extraAllowFast += 60_000;
            step('교사: 무역 +1분');
            break;
          case 'endRound': {
            // (작업 137) 카드 [라운드 끝내기] — 라운드에 붙은 결정 패널이 떠 있으면 카드가 그 활동(우선)이라 [다음으로]로 먼저 끝낸다.
            // 남은 시간이 있고 모두 준비가 아니면 확인 창
            for (let i = 0; i < 4 && !(await T.getByTestId('btn-end-round').isVisible().catch(() => false)); i++) {
              for (const id of ['btn-close-event', 'btn-end-result']) {
                const b = T.getByTestId(id);
                if (await b.isVisible().catch(() => false)) await b.click({ timeout: 3000 }).catch(() => undefined);
              }
              await sleep(800);
            }
            await T.getByTestId('btn-end-round').click({ timeout: 5000 });
            if (await T.getByTestId('confirm-end-round').isVisible({ timeout: 1500 }).catch(() => false)) await T.getByTestId('confirm-ok').click();
            step('교사: [라운드 끝내기]');
            break;
          }
          case 'closeEvent': {
            // 응답 받는 활동은 [다음으로](응답 받기 끝내기), 표지·카드는 [다음으로](끝내고 다음 항목)
            const close = T.getByTestId('btn-close-event');
            if (await close.isVisible().catch(() => false)) await close.click({ timeout: 5000 });
            else await T.getByTestId('now-primary').locator('button').click({ timeout: 5000 });
            step(`교사: 카드 [다음으로](${pub?.event?.id ?? '?'})`);
            break;
          }
          case 'lock':
            await openFoldOf(T, 'entry');
            if (((await T.getByTestId('btn-lock').first().innerText()) ?? '').includes('그만 받기')) await T.getByTestId('btn-lock').first().click();
            step('교사: 새 학생 그만 받기');
            break;
          case 'startRoundNow': {
            // (작업 137) 카드 [라운드 지금 시작]/[라운드 바로 시작], 없으면 '오늘 순서'의 라운드 줄 [지금 시작]
            let b = T.getByRole('button', { name: /라운드 (지금|바로) 시작/ });
            if (!((await b.count()) && (await b.first().isVisible().catch(() => false)))) {
              await openFoldOf(T, 'order');
              const row = T.locator('[data-testid="tl-next-item"][data-item^="r:"]').first();
              if (await row.count()) {
                const head = row.locator('.t-ord__head');
                if ((await head.getAttribute('aria-expanded').catch(() => null)) !== 'true') await head.click().catch(() => undefined);
              }
              b = row.getByTestId('tl-now');
            }
            if ((await b.count()) && (await b.first().isVisible().catch(() => false))) {
              await b.first().click();
              if (await T.getByTestId('confirm-ok').isVisible({ timeout: 2000 }).catch(() => false)) await T.getByTestId('confirm-ok').click();
              startRoundNowUsed = '눌렀음';
              step('교사: [라운드 지금 시작]');
            } else {
              startRoundNowUsed = '버튼 없음(134 전) — 건너뜀';
              step('교사: [지금 라운드 시작] 버튼 없음 — 건너뜀');
            }
            break;
          }
          case 'teacherReload': {
            const w = { from: Date.now(), to: Date.now() + 60_000, why: '교사 새로 고침' };
            windows.push(w);
            const r: Reconnect = { who: '교사', kind: 'teacher', startReal: Date.now(), startFast: now(), done: false, limitRealMs: 30_000 };
            reconnects.push(r);
            const f0 = now();
            step('교사: 새로 고침(F5)');
            await T.reload();
            const okDash = await T.getByTestId('teacher-dashboard').waitFor({ timeout: 30_000 }).then(() => true, () => false);
            r.done = okDash;
            w.to = Date.now();
            extraAllowFast += now() - f0 + 10_000;
            if (!okDash) await problem({ kind: 'reconnect', severity: '막힘', key: 'teacher-reload', title: '교사 새로 고침 뒤 대시보드로 돌아오지 못함', detail: '30초 안에 teacher-dashboard가 보이지 않았어요.', page: T });
            else step('교사: 새로 고침 뒤 대시보드 복귀');
            break;
          }
          case 'serverRestart': {
            if (!relay) {
              step('서버 재시작: 운영 대상이라 건너뜀');
              break;
            }
            const w = { from: Date.now(), to: Date.now() + 90_000, why: '서버 재시작' };
            windows.push(w);
            const f0 = now();
            step('중계 서버 재시작(로컬)');
            await relay.restart();
            if (relay.proc?.pid) o.pids.push(relay.proc.pid);
            reconnects.push({ who: '서버 재시작 뒤 전원', kind: 'server', startReal: Date.now(), startFast: now(), done: false, limitRealMs: 60_000 });
            extraAllowFast += now() - f0 + 30_000;
            break;
          }
        }
      } catch (e) {
        step(`교사 조작 실패(${op.op}): ${String(e).split('\n')[0]!.slice(0, 140)}`);
      } finally {
        teacherBusy = false;
      }
    };

    const uiSnap = async (pg: Page | null | undefined) => {
      if (!pg || pg.isClosed()) return null;
      return pg.evaluate(() => {
        const q = (x: string) => document.querySelector(x) as HTMLElement | null;
        const missions = [...document.querySelectorAll('[data-testid="mission"]')].map((e) => ({ id: e.getAttribute('data-mission') ?? '?', status: e.getAttribute('data-status') ?? '', done: Number(e.getAttribute('data-done') ?? 0) || 0 }));
        return {
          hud: Boolean(q('[data-testid="hud"]') || q('[data-testid="student-game"]')),
          money: (q('[data-testid="hud-money"]')?.innerText ?? '').replace(/\s+/g, ' ').trim(),
          company: (q('[data-testid="hud-company"]')?.innerText ?? '').trim(),
          letters: Number(q('[data-testid="hud-letters"]')?.getAttribute('data-count') ?? 0) || 0,
          missions,
          missionPanel: Boolean(q('[data-testid="mission-panel"]')),
        };
      }).catch(() => null);
    };

    const doCrowd = async (op: CrowdOp) => {
      try {
        switch (op.op) {
          case 'lateJoin':
            for (const seat of op.seats) await botsPage.evaluate((s) => window.__rb!.add(s), botSpec(seat));
            step(`늦게 온 학생 입장: ${op.seats.map((s) => `${s}번`).join(', ')}`);
            break;
          case 'botDrop':
            await botsPage.evaluate((s) => window.__rb!.drop(s), op.seat);
            backs.push({ dueFast: now() + op.backAfterSec * 1000, seat: op.seat, newDevice: Boolean(op.newDevice) });
            step(`${op.seat}번(봇) 연결 끊김 — ${op.backAfterSec}초 뒤 ${op.newDevice ? '다른 기기로' : '같은 기기로'} 돌아옴`);
            break;
          case 'refresh': {
            const s = slots.get(op.student);
            if (!s?.page) break;
            s.busy = true;
            reconnects.push({ who: s.label, kind: 'browser', seat: s.seat, startReal: Date.now(), startFast: now(), done: false, limitRealMs: 30_000 });
            step(`${s.label} 새로 고침`);
            const before = await uiSnap(s.page);
            await s.page.reload().catch(() => undefined);
            // 돌아온 화면(HUD)이 뜰 때까지 기다린 뒤 전후 비교
            let after = null as Awaited<ReturnType<typeof uiSnap>>;
            for (let i = 0; i < 40; i++) {
              await sleep(500);
              after = await uiSnap(s.page);
              if (after?.hud) break;
            }
            const diffs: string[] = [];
            if (!after?.hud) diffs.push('30초 안에 게임 화면(HUD)이 돌아오지 않음');
            if (before && after?.hud) {
              if (before.company !== after.company) diffs.push(`회사 이름 바뀜: ${before.company} → ${after.company}`);
              for (const m of before.missions) {
                const n = after.missions.find((x) => x.id === m.id);
                if (!n) diffs.push(`임무 ${m.id} 안 보임`);
                else if (m.done > n.done || (m.status === 'done' && n.status !== 'done')) diffs.push(`임무 ${m.id} 진행 줄어듦(${m.done}→${n.done}, ${m.status}→${n.status})`);
              }
              if (before.letters > after.letters) diffs.push(`편지 수 줄어듦 ${before.letters}→${after.letters}`);
            }
            step(`${s.label} 새로 고침 전후: 돈 ${before?.money ?? '-'} → ${after?.money ?? '-'} · 임무 ${before?.missions.map((m) => `${m.id}:${m.done}`).join(',') ?? '-'} → ${after?.missions.map((m) => `${m.id}:${m.done}`).join(',') ?? '-'} · 편지 ${before?.letters ?? '-'} → ${after?.letters ?? '-'}${diffs.length ? ' · ✗ ' + diffs.join(' / ') : ' · ✓ 유지'}`);
            metrics.refreshChecks = [...((metrics.refreshChecks as unknown[]) ?? []), { who: s.label, at: at(), before, after, diffs }];
            if (diffs.length && !CHAOS_SEATS.has(s.seat)) await problem({ kind: 'reconnect', severity: '막힘', key: `refresh-lost-${s.seat}-${at()}`, title: `${s.label}: 새로 고침 뒤 정보가 유지되지 않음`, detail: diffs.join(' / '), who: [s.label], page: s.page });
            s.busy = false;
            break;
          }
          case 'browserDrop': {
            const s = slots.get(op.student);
            if (!s?.page) break;
            s.busy = true;
            await s.page.close().catch(() => undefined);
            s.page = null;
            s.gone = true;
            browserBacks.push({ dueFast: now() + op.backAfterSec * 1000, seat: s.seat });
            step(`${s.label} 탭 닫힘 — ${op.backAfterSec}초 뒤 다시 엶`);
            s.busy = false;
            break;
          }
        }
      } catch (e) {
        step(`학생 조작 실패(${op.op}): ${String(e).split('\n')[0]!.slice(0, 140)}`);
      }
    };

    const applyBreaks = async () => {
      breaksApplied = true;
      const s1 = slots.get(1)?.page;
      const s2 = slots.get(2)?.page;
      const s3 = slots.get(3)?.page;
      const s4 = slots.get(4)?.page;
      if (breaks.has('console-error') && s1) {
        await s1.evaluate(() => console.error('[리허설 고장 플래그] console-error')).catch(() => undefined);
        step('고장 플래그 console-error: 1번 학생 화면 console.error');
      }
      if (breaks.has('no-actions') && s2) {
        await s2.addStyleTag({ content: '[data-testid="bottom-bar"],[data-testid="port-screen"]{display:none!important}' }).catch(() => undefined);
        step('고장 플래그 no-actions: 2번 학생 아래 막대 숨김');
      }
      if (breaks.has('fake-money') && s3) {
        await s3
          .evaluate(() => {
            setInterval(() => {
              const n = document.querySelector('[data-testid="hud-money"] .st-hud__num');
              if (n && n.textContent !== '9억 9,999만 원') n.textContent = '9억 9,999만 원';
            }, 200);
          })
          .catch(() => undefined);
        step('고장 플래그 fake-money: 3번 학생 HUD 자금 바꿈');
      }
      if (breaks.has('hide-worksheet') && s4) {
        await s4.addStyleTag({ content: '[data-testid="worksheet-popup"]{display:none!important}' }).catch(() => undefined);
        step('고장 플래그 hide-worksheet: 4번 학생 학습지 팝업 숨김');
      }
      // (수정 1) 층·가림 고장 — 200ms마다 다시 넣고(앱이 지워도), 새로 고침 뒤에도 남게 init script로도 넣는다
      const stick = async (pg: Page | null | undefined, js: string, why: string) => {
        if (!pg) return;
        const loop = `setInterval(() => { try { if (document.body) { ${js} } } catch (e) {} }, 200);`;
        await pg.addInitScript({ content: loop }).catch(() => undefined);
        await pg.evaluate(loop).catch(() => undefined);
        step(why);
      };
      if (breaks.has('stuck-layer')) {
        breakSeats.add(1);
        await stick(s1, `if (!document.getElementById('rb-stuck')) { const d = document.createElement('div'); d.id = 'rb-stuck'; d.className = 'st-layer st-layer--dim'; d.setAttribute('data-layer', 'event'); d.style.cssText = 'position:fixed;inset:0;z-index:60'; document.body.appendChild(d); }`, '고장 플래그 stuck-layer: 1번 학생 화면에 닫힌 사건 층(dim, data-layer=event)이 남음');
      }
      if (breaks.has('stuck-modal')) {
        breakSeats.add(2);
        await stick(s2, `if (!document.getElementById('rb-modal')) { const d = document.createElement('div'); d.id = 'rb-modal'; d.className = 'st-modal'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.style.cssText = 'position:fixed;inset:0;z-index:40;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center'; d.innerHTML = '<div class="st-modal__box">고장 플래그: 닫기 없는 창</div>'; document.body.appendChild(d); }`, '고장 플래그 stuck-modal: 2번 학생 화면에 닫기 없는 가운데 창(aria-modal)이 남음');
      }
      if (breaks.has('click-shield')) {
        breakSeats.add(3);
        await stick(s3, `if (!document.getElementById('rb-shield')) { const d = document.createElement('div'); d.id = 'rb-shield'; d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;height:200px;z-index:45;background:transparent'; document.body.appendChild(d); }`, '고장 플래그 click-shield: 3번 학생 아래 막대 위에 투명 층(data-layer 없음)');
      }
      if (breaks.has('bar-no-pointer')) {
        breakSeats.add(4);
        await stick(s4, `if (!document.getElementById('rb-nopointer')) { const st = document.createElement('style'); st.id = 'rb-nopointer'; st.textContent = '[data-testid="bottom-bar"],[data-testid="bottom-bar"] *{pointer-events:none!important}'; document.head.appendChild(st); }`, '고장 플래그 bar-no-pointer: 4번 학생 아래 막대 pointer-events:none');
      }
      if (breaks.has('no-end')) {
        await t!.getByTestId('btn-pause').click().catch(() => undefined);
        noEndPause = true;
        step('고장 플래그 no-end: 교사 일시정지(풀지 않음)');
      }
    };

    // 교사 + 일정 실행 고리
    loops.push(
      (async () => {
        while (!stop) {
          try {
            const T = t!;
            if (pub && !teacherBusy && !T.isClosed()) {
              // 예약된 교사 조작
              const ti = pendingT.findIndex((x) => ready(x) && !(noEndPause && x.do.op !== 'teacherReload' && x.do.op !== 'serverRestart'));
              if (ti >= 0) {
                const [x] = pendingT.splice(ti, 1);
                await doTeacher(x!.do);
              }
              // 예약된 학생 무리
              const ci = pendingC.findIndex((x) => ready(x));
              if (ci >= 0) {
                const [x] = pendingC.splice(ci, 1);
                await doCrowd(x!.do);
              }
              // 돌아오는 봇
              for (const b of backs.filter((x) => now() >= x.dueFast)) {
                backs.splice(backs.indexOf(b), 1);
                const bad = breaks.has('bad-rejoin');
                await botsPage.evaluate(([s, nd, c]) => window.__rb!.back(s as number, { newDevice: nd as boolean, ...(c ? { code: c as string } : {}) }), [b.seat, b.newDevice, bad ? '000000' : ''] as const);
                reconnects.push({ who: `${b.seat}번(봇)${b.newDevice ? ' 다른 기기' : ''}`, kind: 'bot', seat: b.seat, startReal: Date.now(), startFast: now(), done: false, limitRealMs: b.newDevice ? 60_000 : 40_000 });
                step(`${b.seat}번(봇) 돌아옴${b.newDevice ? '(다른 기기 — 교사 허락 필요)' : ''}${bad ? ' [고장 플래그 bad-rejoin: 틀린 코드]' : ''}`);
              }
              // 다시 여는 브라우저 학생(같은 기기 = 같은 문맥)
              for (const b of browserBacks.filter((x) => now() >= x.dueFast)) {
                browserBacks.splice(browserBacks.indexOf(b), 1);
                const s = slots.get(b.seat)!;
                const np = await newPage(s.label, s.ctx);
                s.page = np.page;
                s.gone = false;
                reconnects.push({ who: s.label, kind: 'browser', seat: s.seat, startReal: Date.now(), startFast: now(), done: false, limitRealMs: 30_000 });
                await np.page.goto('./#/play').catch(() => undefined);
                step(`${s.label} 탭 다시 엶`);
              }
              // 일반 반응: 수동 진행 [발동], 재접속 허락, 무역 시간 끝 창
              const tpx = tp;
              if (tpx) {
                if (tpx.fireVisible) {
                  fireSeenAt ??= now();
                  if (now() - fireSeenAt > 6000 + rand() * 10_000) {
                    const before = pub.waiting;
                    const err = await T.getByTestId('btn-fire').click({ timeout: 3000 }).then(() => '', (e: unknown) => String(e).split('\n')[0]!.slice(0, 100));
                    step(`교사: 카드 [다음으로](옛 발동, ${before ?? ''})${err ? ` 실패: ${err}` : ''}`);
                    fireSeenAt = null;
                    // 눌렀는데 진행되지 않음(같은 항목을 계속 기다림) — 3번이면 막힘
                    const t1 = now();
                    while (now() - t1 < 4000 && pub?.waiting === before) await sleep(200);
                    if (pub?.waiting === before && before) {
                      fireNoEffect.set(before, (fireNoEffect.get(before) ?? 0) + 1);
                      if (fireNoEffect.get(before) === 3)
                        await problem({ kind: 'teacher-guidance', severity: '막힘', key: `fire-no-effect-${before}`, title: `수동 진행: [발동]을 눌러도 ${before}가 시작되지 않음`, detail: `교사가 [발동]을 3번 눌렀는데(클릭 ${err ? `실패: ${err}` : '성공'}) 배치표가 계속 같은 항목(${before})을 기다려요. 단계 ${pub?.phase}, 사건 ${pub?.event?.id ?? '-'}${pub?.event?.closed ? '(마감)' : ''}. 학생은 그동안 다음 활동·라운드로 가지 못해요. 교사 화면 알림: "${tp?.toasts || '없음'}".`, page: T });
                    }
                  }
                } else fireSeenAt = null;
                // (작업 137) 수동 진행: 카드 큰 버튼이 [발동] 말고 다른 것(응답 받기 끝내기·결과 끝·학습지 닫기·남은 순서가 없을 때 [지금 마무리로](확인 1번))이면
                // 교사가 카드대로 누른다(라운드 끝내기는 시나리오 동작으로만)
                const finishBtn = T.locator('[data-testid="now-primary"]:is([data-kind="finishEarly"],[data-kind="closeEvent"],[data-kind="endResult"],[data-kind="closeWorksheet"]) button');
                if (pub.mode === 'manual' && (await finishBtn.isVisible().catch(() => false))) {
                  finishSeenAt ??= now();
                  if (now() - finishSeenAt > 6000) {
                    await finishBtn.click({ timeout: 3000 }).catch(() => undefined);
                    if (await T.getByTestId('confirm-finish').isVisible({ timeout: 2000 }).catch(() => false)) await T.getByTestId('confirm-ok').click().catch(() => undefined);
                    step('교사: 카드 큰 버튼(수동 진행 — 발동 아닌 것)');
                    finishSeenAt = null;
                  }
                } else finishSeenAt = null;
                // (작업 162) 자동 진행도 판이 저절로 끝나지 않는다 — '오늘 순서를 다 했어요' 카드의 [마무리로]를 교사가 누른다
                const planDoneBtn = T.locator('[data-testid="now-primary"][data-kind="finishEarly"] button');
                if (pub.mode !== 'manual' && (await planDoneBtn.isVisible().catch(() => false))) {
                  planDoneSeenAt ??= now();
                  if (now() - planDoneSeenAt > 6000) {
                    await planDoneBtn.click({ timeout: 3000 }).catch(() => undefined);
                    if (await T.getByTestId('confirm-finish').isVisible({ timeout: 2000 }).catch(() => false)) await T.getByTestId('confirm-ok').click().catch(() => undefined);
                    step('교사: 오늘 순서를 다 함 카드 [마무리로]');
                    planDoneSeenAt = null;
                  }
                } else planDoneSeenAt = null;
                if (tpx.rejoinReqs > 0) {
                  approveSeenAt ??= now();
                  if (now() - approveSeenAt > 5000) {
                    await T.getByTestId('rejoin-request').first().getByTestId('btn-approve').click({ timeout: 3000 }).catch(() => undefined);
                    step('교사: 다른 기기 재입장 허락');
                    approveSeenAt = null;
                  }
                } else approveSeenAt = null;
                if (tpx.timeUp) {
                  timeUpSeenAt ??= now();
                  if (now() - timeUpSeenAt > 5000) {
                    await T.getByTestId('btn-after-activity').click({ timeout: 3000 }).catch(() => undefined);
                    step('교사: 무역 시간 끝 카드 [이 활동 끝나고]');
                    timeUpSeenAt = null;
                  }
                } else timeUpSeenAt = null;
              }
              if (!breaksApplied && pub.phase === 'round' && breaks.size) await applyBreaks();
            }
          } catch (e) {
            step(`교사 고리 오류: ${String(e).split('\n')[0]!.slice(0, 140)}`);
          }
          await sleep(300);
        }
      })(),
    );

    // ── 막힘 탐지기 고리(1초) ──
    const fireHidden = new Streak();
    const wrapMissing = new Streak();
    const timeUpMissing = new Streak();
    let timeUpModalSeen = false;
    const teacherNoCountdown = new Streak();
    const idleTotals = new Map<string, number>();
    let lastDet = now();
    const checkConsistency = async (label: string) => {
      let last: string[] = [];
      for (let tryN = 0; tryN < 3; tryN++) {
        const rows = await readTeacherRows(t!);
        const bs = await botStatus();
        const mism: string[] = [];
        for (const b of bs) {
          if (b.status !== 'in' || b.money === null) continue;
          const r = rows.get(b.seat);
          if (r && r.money !== null && r.money !== Math.round(b.money)) mism.push(`${b.seat}번(봇) 학생 ${Math.round(b.money)} ≠ 교사 표 ${r.money}`);
          if (r && pub?.event && !pub.event.closed && r.resp !== 'na') {
            const said = b.responses.includes(pub.event.id);
            if (said !== (r.resp === 'yes')) mism.push(`${b.seat}번(봇) 응답(${pub.event.id}) 학생 ${said ? '함' : '안 함'} ≠ 교사 표 ${r.resp}`);
          }
        }
        for (const s of slots.values()) {
          if (!s.probe || !s.probe.money || s.gone) continue;
          const pr = await probeStudent(s.page!).catch(() => null);
          const m = pr?.money ? parseHudMoney(pr.money) : null;
          const r = rows.get(s.seat);
          if (m !== null && r && r.money !== null && m !== r.money) mism.push(`${s.label} 화면 ${m} ≠ 교사 표 ${r.money}`);
        }
        if (!mism.length) return;
        last = mism;
        await sleep(1500);
      }
      await problem({ kind: 'mismatch', severity: '문제', key: `mismatch-${label}-${last[0]!.split(' ')[0]}`, title: `학생 화면과 교사 표가 다름(${label})`, detail: `3번(1.5초 간격) 다시 봐도 달라요: ${last.slice(0, 6).join(' / ')}`, who: last.map((x) => x.split(' ')[0]!), page: t });
    };
    let consistencyBusy = false;
    loops.push(
      (async () => {
        while (!stop) {
          await sleep(1000);
          const n = now();
          const dt = n - lastDet;
          lastDet = n;
          if (!pub || !pub.startedAt || tradeEndFast !== null) continue;
          const P = pub;
          // 단계 바뀜
          if (P.phase !== lastPhase) {
            step(`단계: ${lastPhase || '-'} → ${P.phase}${P.phase === 'round' ? ` ${P.round}` : ''}${P.event ? ` (사건 ${P.event.id})` : ''}`);
            if (P.phase === 'round' && lastPhase !== 'round') {
              roundsSeen++;
              firstRoundFast ??= n;
              if (roundsSeen === 1 && tradeStartFast !== null) metrics.round1AtSec = Math.round((n - tradeStartFast) / 1000);
            }
            if (lastPhase === 'round' && P.phase !== 'round' && !consistencyBusy) {
              consistencyBusy = true;
              void checkConsistency(`라운드 ${P.round} 뒤`).finally(() => (consistencyBusy = false));
            }
            lastPhase = P.phase;
          }
          // 학습지 묶음(팝업) 판정
          const k = wsKey();
          if (k !== wsEpisode.key) {
            if (wsEpisode.key && Date.now() - wsEpisode.startReal > 4000) {
              for (const s of slots.values()) {
                if (s.joinedRound > wsEpisode.startRound || (s.wsProbes.get(wsEpisode.key) ?? 0) < 3) continue;
                if (!s.wsSeen.has(wsEpisode.key)) await problem({ kind: 'missing-screen', severity: '문제', key: `ws-missing-${s.seat}`, title: `학습지 팝업이 ${s.label} 화면에 뜨지 않음`, detail: `공개 상태에 학습지 ${wsEpisode.key}가 떠 있는 ${Math.round((Date.now() - wsEpisode.startReal) / 1000)}초(실제) 동안 이 학생 화면에 worksheet-popup이 한 번도 보이지 않았어요.`, who: [s.label], page: s.page });
              }
            }
            wsEpisode.key = k;
            wsEpisode.startReal = Date.now();
            wsEpisode.startRound = P.round;
          }
          // 학생(브라우저) 판정
          for (const s of slots.values()) {
            const pr = s.probe;
            if (!pr || s.gone || Date.now() - s.probeAt > 4000 || !pr.inGame || pr.tradeOver || pr.paused || pr.hostWait || P.paused) {
              s.idleWait.update(false, n);
              s.noAction.update(false, n);
              s.layerBad.update(false, n);
              s.modalLong.update(false, n);
              continue;
            }
            // 1c. (수정 1) 맨 위 층이 공개 상태와 맞지 않음(닫혀야 할 층이 남음) → 30초 [문제], 60초 [막힘] / 화면 가운데 창이 30초 넘게 안 닫힘 → [막힘]
            const legit = layerLegit(pr.topLayer, { catchup: pr.catchup, minigame: Boolean(pr.minigame), eventResult: pr.eventResult, worksheet: pr.worksheet }, { event: P.event, worksheetOn: P.worksheet.current.length > 0, paused: P.paused, phase: P.phase });
            const lb = s.layerBad.update(legit === false, n);
            if (lb > 30_000 && !col.has(`layer-mismatch-${s.seat}`))
              await problem({ kind: 'blocked-click', severity: '문제', key: `layer-mismatch-${s.seat}`, title: `${s.label}: 공개 상태로는 없어야 할 '${pr.topLayer}' 층이 화면을 덮고 있음`, detail: `${Math.round(lb / 1000)}초(빠른 시계) 동안 '${pr.topLayer}' 층이 떠 있는데 학급 상태는 단계 ${P.phase}${P.phase === 'round' ? ` ${P.round}` : ''}, 사건 ${P.event ? `${P.event.id}(${P.event.closed ? '마감' : '진행'}·${P.event.blocking ? '차단형' : '비차단'})` : '없음'}, 학습지 ${P.worksheet.current.join('+') || '없음'}이에요. 닫혀야 할 층이 남은 것으로 보여요. 덮인 버튼 위 맨 위 요소: ${pr.blockedTop ?? '-'}`, who: [s.label], page: s.page });
            if (lb > 60_000 && !s.layerBad.reported) {
              s.layerBad.reported = true;
              await problem({ kind: 'blocked-click', severity: '막힘', key: `layer-stuck-${s.seat}`, title: `${s.label}: '${pr.topLayer}' 층이 닫히지 않아 ${Math.round(lb / 1000)}초 넘게 아무것도 누를 수 없음`, detail: `학급 상태와 맞지 않는 층이 화면 전체를 덮은 채 남아 있어요(단계 ${P.phase}, 사건 ${P.event?.id ?? '없음'}). 덮인 버튼 위 맨 위 요소: ${pr.blockedTop ?? '-'}`, who: [s.label], page: s.page });
            }
            const ml = s.modalLong.update(pr.topLayer === 'modal', n);
            if (ml > 30_000 && !s.modalLong.reported) {
              s.modalLong.reported = true;
              await problem({ kind: 'blocked-click', severity: '막힘', key: `modal-stuck-${s.seat}`, title: `${s.label}: 화면 가운데 창이 ${Math.round(ml / 1000)}초 넘게 닫히지 않음`, detail: `aria-modal 창이 화면을 덮고 있고 학생 봇이 [확인]·[닫기]를 눌러도(또는 그 버튼이 없어) 닫히지 않아요. 덮인 버튼 위 맨 위 요소: ${pr.blockedTop ?? '-'}`, who: [s.label], page: s.page });
            }
            // 1. 라운드 중 할 수 있는 행동 없음(거래 버튼은 '보이고 실제로 눌리는' 것만 — 수정 1). 정상 층이 덮은 동안은 층 판정(1c)에 맡긴다
            const noAct = P.phase === 'round' && !hasTask(pr) && !canTrade(pr) && !pr.worksheet && !(pr.topLayer && legit !== false);
            const na = s.noAction.update(noAct, n);
            if (na > 20_000 && !s.noAction.reported) {
              s.noAction.reported = true;
              await problem({ kind: 'no-action', severity: '막힘', key: `no-action-${s.seat}`, title: `${s.label}: 라운드 중 ${Math.round(na / 1000)}초 넘게 할 수 있는 행동이 없음`, detail: `라운드 ${P.round} 중인데 항구 들어가기·출항 준비·활동 어느 것도 화면에 없거나 눌리지 않아요. 아래 글: "${pr.bottomStatus}"${pr.blockedTop ? `. 버튼 위 맨 위 요소: ${pr.blockedTop}` : ''}`, who: [s.label], page: s.page });
            }
            // 1b. 라운드 밖 대기: 할 일이 없는데 남은 시간·할 일 안내도 없음
            const waiting = P.phase !== 'round' && !hasTask(pr) && !pr.worksheet && !pr.minigame;
            const w = s.idleWait.update(waiting, n);
            if (waiting) idleTotals.set(P.round === 0 ? 'pre' : 'between', (idleTotals.get(P.round === 0 ? 'pre' : 'between') ?? 0) + dt);
            if (w > 30_000 && !s.idleWait.reported && !hasRoundGuidance(pr.text)) {
              s.idleWait.reported = true;
              const pre = P.round === 0;
              const nextIn = P.nextRoundAt !== null ? P.nextRoundAt - tradeElapsed(P) : null;
              const mis = [pr.enterPort ? '[항구 들어가기]' : '', pr.setReady !== 'none' ? `[출항 준비](${pr.setReady === 'disabled' ? '눌리지 않음' : '눌림'})` : ''].filter(Boolean).join('·');
              await problem({
                kind: 'wait-guidance',
                severity: '혼란',
                key: `wait-guidance-${pre ? 'pre' : 'between'}-${P.mode}`,
                title: pre ? `라운드 1 전 사전 활동 동안 학생이 할 일·남은 시간 안내 없음${P.mode === 'manual' ? '(수동 진행)' : ''}` : `라운드 사이 대기 중 할 일·다음 라운드까지 남은 시간 안내 없음${P.mode === 'manual' ? '(수동 진행)' : ''}`,
                detail: `학생 화면에 활동·카드·팝업이 없는 채로 ${Math.round(w / 1000)}초(빠른 시계) 넘게 기다렸는데 '라운드까지 m:ss'·'선생님이 시작하면' 같은 안내가 없어요. 단계 ${P.phase}${P.event ? `(사건 ${P.event.id}${P.event.closed ? ' 마감' : ''})` : ''}${nextIn !== null ? `, 배치표상 다음 라운드까지 약 ${mmss(nextIn)}` : ''}. 아래 글: "${pr.bottomStatus}", 상태 카드: ${pr.roundWaitLine === null ? '안 보임' : `"${pr.roundWaitLine}"`}${mis ? `. 보이는 버튼: ${mis} — 누르면 "선생님 활동이 끝나면 이어서 해요"만 나와요` : ''}.`,
                who: [s.label],
                page: s.page,
                logs: [],
              });
            }
          }
          // 2. 교사가 눌러야 하는데 안내 없음
          const T0 = tp;
          if (T0) {
            const fh = fireHidden.update(P.mode === 'manual' && Boolean(P.waiting) && !T0.fireVisible, n);
            if (fh > 10_000 && !fireHidden.reported) {
              fireHidden.reported = true;
              await problem({ kind: 'teacher-guidance', severity: '막힘', key: 'fire-hidden', title: `수동 진행: [발동]을 눌러야 다음(${P.waiting})이 나오는데 교사 화면에 안내가 없음`, detail: `배치표가 ${Math.round(fh / 1000)}초(빠른 시계) 넘게 교사 [발동]을 기다리는데 tl-waiting·btn-fire가 보이지 않아요. 학생도 그동안 멈춰 있어요.`, page: t });
              if (hideFireOn) {
                hideFireOn = false;
                await t!.addStyleTag({ content: '[data-testid="tl-waiting"],[data-testid="btn-fire"]{display:revert!important}' }).catch(() => undefined);
                step('고장 플래그 hide-fire 해제(탐지 확인 뒤 진행 계속)');
              }
            }
            if (P.mode === 'manual' && P.waiting && T0.fireVisible && !T0.fireInView)
              await problem({ kind: 'teacher-guidance', severity: '혼란', key: 'fire-offscreen', title: '수동 진행 [발동] 버튼이 첫 화면 밖(스크롤해야 보임)', detail: `교사 화면 1366×768에서 [발동](${P.waiting})이 보이는 영역 밖에 있어요.`, page: t });
            const wm = wrapMissing.update(P.tradeEnded && !T0.wrapup, n);
            if (wm > 15_000 && !wrapMissing.reported) {
              wrapMissing.reported = true;
              await problem({ kind: 'teacher-guidance', severity: '막힘', key: 'wrap-missing', title: '무역이 끝났는데 교사 화면에 마무리 패널이 없음', detail: '공개 상태 tradeEnded인데 wrapup-panel이 보이지 않아요.', page: t });
            }
            // (작업 162) 추천 시간이 지나도 '무역 시간 끝(timeUp)' 카드는 더 없다(지금 카드 그대로 + 늦음 줄) — 옛 'timeup-missing' 검사는 끔
            if (T0.timeUp) timeUpModalSeen = true;
            void timeUpMissing;
            const nc = teacherNoCountdown.update(P.mode === 'auto' && P.round === 0 && P.phase !== 'round' && !hasTeacherRoundCountdown(T0.text), n);
            if (nc > 30_000 && !teacherNoCountdown.reported) {
              teacherNoCountdown.reported = true;
              await problem({ kind: 'teacher-guidance', severity: '혼란', key: 'teacher-countdown', title: '교사 화면에 "라운드 1까지 m:ss" 표시·[지금 라운드 시작] 없음', detail: `사전 활동 ${Math.round(nc / 1000)}초(빠른 시계) 동안 교사 화면에 라운드가 언제 열리는지 표시가 없어요(무역 시계 ${T0.clockSec ?? '?'}초 남음). 교사가 "라운드를 시작 안 하는 버그"로 받아들일 수 있어요(134에서 고칠 예정).`, page: t });
            }
          }
          // 5. 판이 끝나지 않음(허용 시간 + 여유)
          if (tradeStartFast !== null) {
            const allowed = sc.minutes * 60_000 + extraAllowFast + 150_000;
            if (n - tradeStartFast > allowed + (breaks.has('no-end') ? 60_000 : 480_000)) {
              await problem({ kind: 'overtime', severity: '막힘', key: 'no-end', title: '판이 끝나지 않음', detail: `무역 시작 뒤 ${mmss((n - tradeStartFast) / 1000)}(빠른 시계)이 지났는데 무역이 끝나지 않았어요(허용 ${mmss(allowed / 1000)}). 단계 ${P.phase}, 라운드 ${P.round}, 일시정지 ${P.paused}.`, page: t });
              stop = true;
            }
          }
        }
      })(),
    );

    // ── 재접속 판정 고리 ──
    loops.push(
      (async () => {
        while (!stop) {
          await sleep(1000);
          const open = reconnects.filter((r) => !r.done);
          if (!open.length) continue;
          const bs = await botStatus();
          for (const r of open) {
            let ok = false;
            if (r.kind === 'bot') ok = bs.find((b) => b.seat === r.seat)?.status === 'in';
            else if (r.kind === 'browser') {
              const s = slots.get(r.seat!);
              ok = Boolean(s?.page && !s.page.isClosed() && (await s.page.getByTestId('hud').isVisible().catch(() => false)));
            } else if (r.kind === 'server') {
              const inBots = bs.filter((b) => b.status !== 'dropped' && b.status !== 'in').length === 0;
              let inBrowsers = true;
              for (const s of slots.values()) if (s.page && !s.gone && !(await s.page.getByTestId('hud').isVisible().catch(() => false))) inBrowsers = false;
              const teacherOk = t ? (await t.getByTestId('disconnected').count().catch(() => 1)) === 0 : false;
              ok = inBots && inBrowsers && teacherOk;
            } else ok = true;
            if (ok) {
              r.done = true;
              step(`재접속 확인: ${r.who} ${((Date.now() - r.startReal) / 1000).toFixed(1)}초(실제)`);
            } else if (Date.now() - r.startReal > r.limitRealMs) {
              r.done = true;
              const s = r.seat ? slots.get(r.seat) : undefined;
              const b = r.seat ? bs.find((x) => x.seat === r.seat) : undefined;
              await problem({
                kind: 'reconnect',
                severity: '막힘',
                key: `reconnect-${r.who}`,
                title: `재접속 실패: ${r.who}`,
                detail: `${Math.round(r.limitRealMs / 1000)}초(실제) 안에 다시 들어오지 못했어요.${b ? ` 봇 상태 ${b.status}, 오류 ${b.err ?? '-'}, 상태 기록 ${b.statusLog.slice(-4).map((x) => `${x.status}${x.code ? `(${x.code})` : ''}`).join('→')}` : ''}`,
                who: [r.who],
                page: s?.page ?? (r.kind === 'server' ? t : null),
              });
            }
          }
        }
      })(),
    );

    // ── 무역 끝까지 기다림 ──
    let wrapSince: number | null = null;
    while (!stop) {
      if (tp?.wrapup && pub?.tradeEnded) break;
      if (existsSync(join(o.outDir, 'STOP'))) {
        step('STOP 파일 — 중단');
        stop = true;
        break;
      }
      // 공개 상태를 못 받을 때(봇이 모두 끊김 등)도 교사 화면 마무리 패널이 30초 이어지면 끝으로 본다
      if (tp?.wrapup) {
        wrapSince ??= now();
        if (now() - wrapSince > 30_000) break;
      } else wrapSince = null;
      if (now() - tradeStartFast > sc.minutes * 60_000 + extraAllowFast + 150_000 + 600_000) {
        await problem({ kind: 'overtime', severity: '막힘', key: 'no-end', title: '판이 끝나지 않음', detail: `무역 시작 뒤 ${mmss((now() - tradeStartFast) / 1000)}(빠른 시계)이 지나도 교사 화면에 마무리 패널이 없어요.`, page: t });
        stop = true;
      }
      await sleep(500);
    }
    if (!stop) {
      tradeEndFast = now();
      results.tradeSec = (tradeEndFast - tradeStartFast!) / 1000;
      results.allowedSec = (sc.minutes * 60_000 + extraAllowFast + 150_000) / 1000;
      step(`무역 끝(${mmss(results.tradeSec)})`);
      if (results.tradeSec > results.allowedSec)
        await problem({ kind: 'overtime', severity: '문제', key: 'overtime', title: `판이 T를 넘김(${mmss(results.tradeSec)} > 허용 ${mmss(results.allowedSec)})`, detail: `무역 ${sc.minutes}분 + 연장·일시정지·끊김 ${mmss(extraAllowFast / 1000)} + 활동 마무리 여유 2분 30초를 넘었어요.`, page: t });
      await env.clock.setSpeed(1);
      // 학생 결과 화면(trade-over)
      const t0 = Date.now();
      for (const s of slots.values()) {
        if (!s.page || s.gone) continue;
        const ok = await s.page.getByTestId('trade-over').waitFor({ timeout: Math.max(1000, 20_000 - (Date.now() - t0)) }).then(() => true, () => false);
        if (!ok) await problem({ kind: 'missing-screen', severity: '문제', key: `trade-over-${s.seat}`, title: `무역이 끝났는데 ${s.label} 화면에 결과(무역 끝) 화면이 없음`, detail: '20초(실제) 안에 trade-over가 보이지 않았어요.', who: [s.label], page: s.page });
      }
      await checkConsistency('무역 끝');
      // 마무리: (작업 137) 첫 항목은 저절로 시작(PRD 7.5.2.9) → 학생 화면 → [끝], 다음 항목은 [시작] → 학생 화면 → [끝]
      const items = t!.locator('[data-testid="wrap-item"]');
      await items.first().waitFor({ timeout: 10_000 }).catch(() => undefined);
      const nItems = await items.count();
      const wrapLog: string[] = [];
      if (nItems && (await items.first().getAttribute('data-status').catch(() => null)) !== 'live')
        await problem({ kind: 'teacher-guidance', severity: '문제', key: 'wrap-auto-start', title: '무역 시간이 끝났는데 첫 마무리 항목이 저절로 시작되지 않음', detail: `첫 마무리 항목 상태: ${await items.first().getAttribute('data-status').catch(() => '?')} — PRD 7.5.2.9는 저절로 시작.`, page: t });
      for (let i = 0; i < nItems; i++) {
        const it = items.nth(i);
        const label = ((await it.innerText().catch(() => '')) ?? '').split('\n')[0]!.slice(0, 20);
        if ((await it.getAttribute('data-status').catch(() => null)) !== 'live') {
          const start = it.getByRole('button', { name: '시작' });
          if (!(await start.count())) continue;
          await start.click({ timeout: 5000 }).catch(() => undefined);
        }
        const want = /결산|시상/.test(label) ? 'wrap-awards' : /되돌아/.test(label) ? 'wrap-reflect' : null;
        if (want) {
          for (const s of slots.values()) {
            if (!s.page || s.gone) continue;
            const ok = await s.page.getByTestId(want).waitFor({ timeout: 15_000 }).then(() => true, () => false);
            if (!ok) await problem({ kind: 'missing-screen', severity: '문제', key: `wrap-${want}-${s.seat}`, title: `마무리 "${label}" [시작] 뒤 ${s.label} 화면이 바뀌지 않음`, detail: `15초 안에 ${want}가 보이지 않았어요.`, who: [s.label], page: s.page });
          }
        }
        wrapLog.push(label);
        await sleep(1500);
        await it.getByRole('button', { name: '끝' }).click({ timeout: 5000 }).catch(() => undefined);
      }
      step(`마무리 진행: ${wrapLog.join(' → ') || '항목 없음'}`);
      metrics.wrapItems = wrapLog;
      // 편지: 봇이 편지를 받았다면 브라우저 학생도 한 번은 편지 표시를 봤어야 한다
      const bsEnd = await botStatus();
      if (bsEnd.some((b) => b.letters > 0)) {
        for (const s of slots.values()) if (s.joinedRound === 0 && !s.mem.seen.has('letter')) await problem({ kind: 'missing-screen', severity: '문제', key: `letter-missing-${s.seat}`, title: `편지가 ${s.label} 화면에 한 번도 표시되지 않음`, detail: `봇 ${bsEnd.filter((b) => b.letters > 0).length}명은 편지를 받았는데 이 학생 HUD 편지 수(hud-letters)가 끝까지 0이었어요.`, who: [s.label], page: s.page });
      }
      metrics.bots = {
        in: bsEnd.filter((b) => b.status === 'in').length,
        total: bsEnd.length,
        acts: bsEnd.reduce((a, b) => a + b.acts, 0),
        rounds: [...new Set(bsEnd.map((b) => b.resolvedRound))],
        letters: bsEnd.filter((b) => b.letters > 0).length,
        lettersAnswered: bsEnd.reduce((a, b) => a + b.lettersAnswered, 0),
        worksheetDone: bsEnd.reduce((a, b) => a + b.worksheetDone.length, 0),
        noActionMaxSec: Math.round(Math.max(0, ...bsEnd.map((b) => b.noActionMaxMs)) / 1000),
      };
      // ── (측정) 회사별 결과·학습지·돌아온 학생 비교 ──
      {
        const fastSec = (ms: number) => Math.round(ms / 1000);
        const rows = bsEnd.map((b) => {
          const ws = Object.entries(b.wsLog ?? {});
          const done = ws.filter(([, e]) => e.done !== null);
          const secs = done.map(([, e]) => fastSec((e.done ?? 0) - e.shown));
          const mDone = Object.values(b.missions ?? {}).filter((m) => m.status === 'done').length;
          return { seat: b.seat, profile: b.profile, money: b.money, startMoney: b.startMoney, loan: b.loan, ship: b.ship, missions: `${mDone}/${Object.keys(b.missions ?? {}).length}`, wsShown: ws.length, wsDone: done.length, wsSecAvg: secs.length ? Math.round(secs.reduce((a, c) => a + c, 0) / secs.length) : null, wsSecMax: secs.length ? Math.max(...secs) : null, letters: b.lettersAnswered, dropped: Boolean(b.preDrop), lost: b.lost ?? [], afterBackShown: b.backAt ? ws.filter(([, e]) => e.shown >= b.backAt!).length : null, afterBackDone: b.backAt ? ws.filter(([, e]) => e.shown >= b.backAt! && e.done !== null).length : null, wsList: ws.map(([k, e]) => `${k}:${e.done === null ? '미완' : fastSec(e.done - e.shown) + '초'}(팝업 ${e.closed ? fastSec(e.closed - e.shown) + '초 열림' : '안 닫힘'})`).join(' '), wsDetail: ws.map(([k, e]) => ({ id: k, openSec: e.closed ? fastSec(e.closed - e.shown) : null, doneSec: e.done === null ? null : fastSec(e.done - e.shown) })) };
        });
        metrics.botTable = rows.length;
        try { (await import('node:fs')).writeFileSync(join(o.outDir, `bots-${sc.id}.json`), JSON.stringify(rows, null, 1)); } catch { /* 보고서 본문에는 요약만 */ }
        const rich = rows.filter((r) => r.money !== null);
        const gain = rich.map((r) => (r.money as number) - (r.startMoney ?? 0));
        metrics.economy = { companies: rich.length, avgGain: Math.round(gain.reduce((a, c) => a + c, 0) / Math.max(1, gain.length)), minGain: Math.min(...gain), maxGain: Math.max(...gain), inLoan: rich.filter((r) => (r.loan ?? 0) > 0).length, missionsAllDone: rows.filter((r) => r.missions.split('/')[0] === r.missions.split('/')[1] && r.missions !== '0/0').length };
        for (const r of rows.filter((x) => x.lost.length)) await problem({ kind: 'reconnect', severity: '막힘', key: `rejoin-lost-${r.seat}`, title: `${r.seat}번(봇): 끊겼다 돌아온 뒤 정보가 사라짐`, detail: r.lost.join(' / '), who: [`${r.seat}번(봇)`] });
        for (const r of rows.filter((x) => x.dropped && (x.afterBackShown ?? 0) > (x.afterBackDone ?? 0) && x.profile === 'good')) await problem({ kind: 'reconnect', severity: '참고', key: `rejoin-ws-${r.seat}`, title: `${r.seat}번(봇): 돌아온 뒤 뜬 학습지를 끝내지 못함`, detail: `뜬 ${r.afterBackShown} · 끝낸 ${r.afterBackDone}. ${r.wsList}`, who: [`${r.seat}번(봇)`] });
      }
      for (const b of bsEnd.filter((x) => x.noActionMaxMs > 20_000)) await problem({ kind: 'no-action', severity: '막힘', key: `bot-no-action-${b.seat}`, title: `${b.seat}번(봇): 라운드 중 ${Math.round(b.noActionMaxMs / 1000)}초 할 수 있는 행동 없음`, detail: '갈 수 있는 항구·살 수 있는 물건·팔 수 있는 짐이 모두 없었어요.', who: [`${b.seat}번(봇)`] });
      // 학생 화면에서 같은 버튼이 계속 눌리지 않음 — 정상 층(사건·학습지·편지 등)에 가린 것은 층을 먼저 처리했으므로 빼고(metrics.layerFirst),
      // 정상 층이 아닌 것에 가렸거나 다른 이유로 실패한 것만 참고로(맨 위 요소·스크린숏 첨부). 고장 플래그로 숨긴 것은 뺀다
      for (const s of slots.values())
        for (const [id, n] of s.mem.fails) {
          if (n < 3 || (breaks.has('no-actions') && s.seat === 2) || (breaks.has('hide-worksheet') && s.seat === 4) || breakSeats.has(s.seat)) continue;
          if (s.mem.coverTop.has(id) && /^(enter-port|set-ready|pick-confirm|pick-sail|worksheet-done|항구 )/.test(id)) continue; // 이미 [문제]로 올림
          const top = s.mem.coverTop.get(id);
          const pr = col.add({ kind: 'harness', severity: '참고', key: `fail-${id}`, title: `학생 화면 [${id}] 조작이 여러 번 실패${top ? '(정상 층이 아닌 것에 가림)' : ''}`, detail: `${s.label} ${n}번. 마지막 이유: ${s.mem.failWhy.get(id) ?? '?'}${top ? ` — 맨 위 요소: ${top}` : ''} — 버튼이 보이는데 눌리지 않으면 앱 문제일 수 있어요(확인 필요).`, at: '-', who: [s.label] });
          for (const f of s.mem.coverShots.get(id) ?? []) if (!pr.shots.includes(f)) pr.shots.push(f);
          if (top && !pr.logs.some((l) => l.startsWith(s.label))) pr.logs.push(`${s.label}: ${top}`);
        }
      // 정상 층에 가려 같은 버튼을 10번 넘게 못 누름 — 층이 정상이어도 비정상으로 오래 덮음
      for (const s of slots.values())
        for (const [k, n] of s.mem.layerFirst)
          if (n >= 10 && !k.includes('화면 밖')) col.add({ kind: 'blocked-click', severity: '문제', key: `layer-first-${s.seat}-${k}`, title: `${s.label}: 정상 층에 가려 [${k.split('@')[0]}]를 ${n}번 못 누름(${k.split('@')[1]} 층)`, detail: '층이 정상 층이어도 같은 버튼을 이렇게 여러 번 가렸다면 층이 너무 오래 남아 있는 것일 수 있어요.', at: '-', who: [s.label] });
      metrics.layerFirst = Object.fromEntries([...slots.values()].map((s) => [s.label, Object.fromEntries(s.mem.layerFirst)]));
      // ── 판 끝내기·방 닫기 ──
      ended = await endRoom(t!);
      step(ended ? '교사: 판 끝내기·방 닫기' : '교사: 방 닫기 실패');
      if (ended) {
        for (const s of slots.values()) {
          if (!s.page || s.gone) continue;
          const ok = await s.page.getByTestId('student-room-closed').waitFor({ timeout: 15_000 }).then(() => true, () => false);
          if (!ok) await problem({ kind: 'missing-screen', severity: '문제', key: `closed-${s.seat}`, title: `방을 닫았는데 ${s.label} 화면에 "판을 끝냈어요"가 없음`, detail: '15초 안에 student-room-closed가 보이지 않았어요.', who: [s.label], page: s.page });
        }
      } else await problem({ kind: 'teacher-guidance', severity: '문제', key: 'end-room', title: '판 끝내기·방 닫기를 하지 못함', detail: '마무리 패널의 [판 끝내기·방 닫기] → 확인 두 번 뒤 ended가 보이지 않았어요.', page: t });
      results.finished = true;
    }
    metrics.startRoundNow = startRoundNowUsed;
    metrics.idleWaitSecByStudents = Object.fromEntries([...idleTotals].map(([k, v]) => [k, Math.round(v / 1000)]));
  } catch (e) {
    if (e instanceof PreviewBlocked) {
      results.skipped = '준비 중 기능';
      step('준비 중 기능이라 시나리오를 건너뜀');
    } else {
      results.error = String(e).split('\n').slice(0, 3).join(' ');
      col.add({ kind: 'harness', severity: '참고', key: 'harness-error', title: '리허설 도구 오류로 시나리오 중단', detail: results.error, at: '진행 중' });
    }
  } finally {
    stop = true;
    await Promise.race([Promise.allSettled(loops), sleep(15_000)]);
    // 운영 대상이면 방이 반드시 닫혀야 한다
    if (!ended && t && !t.isClosed() && code) {
      ended = await endRoomViaSettings(t).catch(() => false);
      step(ended ? '정리: 설정 → 판 끝내기·방 닫기' : '정리: 방 닫기 실패(서버 EMPTY_ROOM_TTL로 정리됨)');
    }
    if (bots && !bots.isClosed()) await bots.evaluate(() => window.__rb?.stop()).catch(() => undefined);
    for (const c of env.contexts) await c.close().catch(() => undefined);
    // ── 오류·거절·메시지율 정리 ──
    const inWin = (x: number) => windows.some((w) => x >= w.from - 2000 && x <= w.to + 60_000);
    const grouped = new Map<string, { n: number; label: Set<string>; sample: string; expected: boolean }>();
    // 없는 그림 파일(404 /assets/images/…)은 한 문제로 묶는다
    const missingImgs = new Map<string, Set<string>>();
    for (const e of errs) {
      const im = /^http 404: (\/.*\/assets\/images\/.+)$/.exec(e.text);
      if (im) {
        const set = missingImgs.get(im[1]!) ?? new Set<string>();
        set.add(e.label);
        missingImgs.set(im[1]!, set);
        continue;
      }
      const norm = e.text.replace(/\d+/g, '#').slice(0, 120);
      const expected = inWin(e.at) && /requestfailed|WebSocket|ERR_|http 502|websocket/i.test(e.text);
      const g = grouped.get(norm) ?? { n: 0, label: new Set(), sample: `${e.label}: ${e.text}`, expected };
      g.n++;
      g.label.add(e.label);
      grouped.set(norm, g);
    }
    for (const [norm, g] of grouped) {
      const breakErr = norm.includes('리허설 고장 플래그');
      col.add({ kind: 'page-error', severity: g.expected ? '참고' : '문제', key: `err-${norm}`, title: `${g.expected ? '(재시작·새로 고침 중 의도된 끊김) ' : ''}${breakErr ? '[고장 플래그] ' : ''}화면 오류: ${g.sample.slice(0, 90)}`, detail: `${g.n}번, 화면: ${[...g.label].join(', ')}`, at: '-', who: [...g.label], logs: [g.sample] });
    }
    if (missingImgs.size && sc.preview)
      col.add({ kind: 'preview', severity: '참고', key: 'missing-images', title: `[준비 중 기능] 단원 판에서 그림 파일 ${missingImgs.size}개가 없음(404)`, detail: `단원 판(L2~L4 포함)이 요청한 빌드본에 없는 그림: ${[...missingImgs.keys()].map((x) => x.replace(/^.*\/assets\/images\//, '')).join(', ')}. L1에서도 쓰는 그림이 없으면 차시 L1 시나리오(a·b·d·e)에서 [문제]로 따로 잡혀요.`, at: '-', who: [], logs: [...missingImgs.keys()] });
    else if (missingImgs.size)
      col.add({ kind: 'page-error', severity: '문제', key: 'missing-images', title: `그림 파일 ${missingImgs.size}개가 없음(404)`, detail: `화면이 요청했지만 빌드본에 없는 그림: ${[...missingImgs.keys()].map((x) => x.replace(/^.*\/assets\/images\//, '')).join(', ')} — 화면: ${[...new Set([...missingImgs.values()].flatMap((x) => [...x]))].join(', ')}`, at: '-', who: [], logs: [...missingImgs.keys()] });
    // 거절 응답 표
    const rej: Record<string, number> = {};
    // (보완 1) 준비 중 기능 시나리오(단원 판)에서 L2~L4 사건·활동에 대한 행동이 되돌려진 것은 따로 센다(미구현 때문 — 참고)
    const PV = '(준비 중 L2~L4)';
    const pvOf = (c: (typeof codes)[number]) => Boolean(sc.preview && isPreviewAct(c.act));
    for (const c of codes) {
      const k = `${c.dir}:${c.code}${inWin(c.at) ? '(재시작·새로 고침 중)' : pvOf(c) ? PV : ''}`;
      rej[k] = (rej[k] ?? 0) + 1;
    }
    const bsFinal = await (async () => {
      try {
        return bots && !bots.isClosed() ? await bots.evaluate(() => window.__rb!.status()) : [];
      } catch {
        return [];
      }
    })();
    const botRejects: Record<string, number> = {};
    const botRollbacks: Record<string, number> = {};
    for (const b of bsFinal) {
      mergeCounts(botRejects, b.rejects);
      mergeCounts(botRollbacks, b.rollbacks);
    }
    metrics.rejections = { frames: rej, botJoin: botRejects, botRollbacks };
    for (const [k, n] of Object.entries(rej)) {
      const codeOnly = k.split(':')[1]!.replace(/\(.*$/, '');
      if (EXPECTED_REJECTS.test(codeOnly) || k.includes('재시작')) continue;
      const isPv = k.endsWith(PV);
      const mine = codes.filter((c) => `${c.dir}:${c.code}` === k.replace(/\(.*$/, '') && pvOf(c) === isPv && !inWin(c.at));
      if (isPv) {
        const acts: Record<string, number> = {};
        for (const c of mine) if (c.act) acts[c.act] = (acts[c.act] ?? 0) + 1;
        const actText = Object.entries(acts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([a, x]) => `${a} ×${x}`).join(', ');
        col.add({ kind: 'preview', severity: '참고', key: `rej-${k}`, title: `[준비 중 기능] 거절 응답 ${k.replace(PV, '')} ×${n} — L2~L4 사건·활동`, detail: `기능 플래그로 꺼 둔 L2~L4 사건에 대한 응답이 되돌려졌어요(받은 쪽: ${[...new Set(mine.map((c) => c.who))].join(', ')}). 행동: ${actText || '알 수 없음'}. L2~L4 본편(115~118) 구현 때 확인할 것 — 지금 수업(L1)에는 영향 없음.`, at: '-', who: [] });
        continue;
      }
      const serious = /RATE_LIMITED|TOO_LARGE|SERVER_FULL|ROOM_FULL|BAD_HELLO|TOO_MANY_TRIES|INTERNAL|BAD_MSG/.test(codeOnly);
      const fromBrowser = mine.some((c) => /^학생/.test(c.who) && c.dir === '행동');
      const acts: Record<string, number> = {};
      for (const c of mine) if (c.act && /^학생/.test(c.who)) acts[c.act] = (acts[c.act] ?? 0) + 1;
      const actText = Object.entries(acts).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([a, x]) => `${a} ×${x}`).join(', ');
      col.add({ kind: 'rejections', severity: serious || fromBrowser ? '문제' : '참고', key: `rej-${k}`, title: `거절 응답 ${k} ×${n}`, detail: `받은 쪽: ${[...new Set(mine.map((c) => c.who))].join(', ')}${fromBrowser ? ` — 실제 학생 화면에서 누른 행동이 되돌려졌어요(직전에 보낸 행동: ${actText || '알 수 없음'})` : ''}`, at: '-', who: [] });
    }
    // 메시지율
    const rate = (label: string) => {
      const f = frames.get(label);
      if (!f) return null;
      const vals = [...f.buckets.values()];
      return { sent: f.sent, recv: f.recv, peakSentPerSec: vals.length ? Math.max(...vals) : 0 };
    };
    metrics.messages = Object.fromEntries([...frames.keys()].map((k) => [k, rate(k)]));
    const tr = rate('교사');
    const hostRate = Number(relayEnv().HOST_MSG_RATE ?? 120);
    if (tr && tr.peakSentPerSec > hostRate * 0.8)
      col.add({ kind: 'health', severity: '문제', key: 'host-rate', title: `교사(호스트) 보내는 메시지 최고 ${tr.peakSentPerSec}개/초(상한 ${hostRate}의 80% 넘음)`, detail: `빨리 감기 ${o.speed}배라 실제 수업보다 많을 수 있어요(실제 수업 환산 약 ${Math.round(tr.peakSentPerSec / Math.max(1, o.speed))}개/초).`, at: '-', who: ['교사'] });
    if (relay) {
      // 서버 재시작·교사 새로 고침 구간(및 그 뒤 1분 통계)의 속도 제한은 재접속 몰림 — 화면 쪽 거절 표와 같이 참고로 가른다
      const logAt = (l: string) => Date.parse(/"time":"([^"]+)"/.exec(l)?.[1] ?? '') || 0;
      const inRelayWin = (l: string) => {
        const x = logAt(l);
        return x > 0 && windows.some((w) => x >= w.from - 2000 && x <= w.to + 120_000);
      };
      const rlAll = relay.logs.filter((l) => /RATE_LIMITED|core\.error|slowClosed/.test(l));
      const rlWin = rlAll.filter((l) => inRelayWin(l) && !/core\.error/.test(l));
      const rl = rlAll.filter((l) => !rlWin.includes(l));
      if (rlWin.length) col.add({ kind: 'health', severity: '참고', key: 'relay-log-win', title: `(재시작·새로 고침 중 재접속 몰림) 중계 서버 로그에 속도 제한 ${rlWin.length}줄`, detail: rlWin.slice(0, 3).join(' | ').slice(0, 400), at: '-', who: [], logs: rlWin.slice(0, 10) });
      if (rl.length) col.add({ kind: 'health', severity: '문제', key: 'relay-log', title: `중계 서버 로그에 속도 제한·오류 ${rl.length}줄`, detail: rl.slice(0, 3).join(' | ').slice(0, 400), at: '-', who: [], logs: rl.slice(0, 10) });
      metrics.relayStats = relay.logs.filter((l) => /"stats"/.test(l)).slice(-3);
    }
    metrics.health = {
      samples: healthSamples.length,
      maxPeers: Math.max(0, ...healthSamples.map((s) => s.peers)),
      maxConns: Math.max(0, ...healthSamples.map((s) => s.conns)),
      maxMemMB: Math.max(0, ...healthSamples.map((s) => s.memMB)),
      firstMemMB: healthSamples[0]?.memMB ?? null,
      lastMemMB: healthSamples.at(-1)?.memMB ?? null,
    };
    const hp = metrics.health as { maxPeers: number };
    // 학생 입장·무역 시작까지 간 판만 본다(설정 단계에서 멈추거나 준비 중 기능으로 건너뛴 판은 학생이 붙을 기회가 없었음)
    if (healthSamples.length && tradeStartFast !== null && hp.maxPeers < 25) col.add({ kind: 'health', severity: '문제', key: 'peers-low', title: `/health peers 최대 ${hp.maxPeers}(25 미만)`, detail: '학생 25명이 동시에 중계 서버에 붙지 않았어요.', at: '-', who: [] });
    metrics.reconnects = reconnects.map((r) => ({ who: r.who, ok: r.done }));
    if (web) await web.close().catch(() => undefined);
    if (relay) await relay.stop().catch(() => undefined);
    results.realSec = (Date.now() - real0) / 1000;
  }
  return results;
}

// ───────────────────────── 교사 화면 ─────────────────────────

interface TeacherProbe {
  dashboard: boolean;
  clockSec: number | null;
  fireVisible: boolean;
  fireInView: boolean;
  timeUp: boolean;
  wrapup: boolean;
  rejoinReqs: number;
  ended: boolean;
  toasts: string;
  text: string;
}

async function probeTeacher(t: Page): Promise<TeacherProbe | null> {
  try {
    return await t.evaluate(() => {
      const vis = (el: Element | null) => {
        if (!el) return false;
        const r = (el as HTMLElement).getBoundingClientRect();
        const cs = getComputedStyle(el as HTMLElement);
        return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden';
      };
      const q = (id: string) => document.querySelector(`[data-testid="${id}"]`);
      const fire = q('btn-fire');
      const fr = fire?.getBoundingClientRect();
      const clock = q('trade-clock');
      return {
        dashboard: vis(q('teacher-dashboard')),
        clockSec: clock ? Number(clock.getAttribute('data-sec')) : null,
        fireVisible: vis(fire),
        fireInView: Boolean(fr && fr.top >= 0 && fr.bottom <= innerHeight && fr.left >= 0 && fr.right <= innerWidth),
        // (작업 137) 옛 time-up 창 → '지금 할 일' 카드 상태 5
        timeUp: q('now-card')?.getAttribute('data-state') === 'timeUp',
        wrapup: vis(q('wrapup-panel')),
        rejoinReqs: [...document.querySelectorAll('[data-testid="rejoin-request"]')].filter(vis).length,
        ended: vis(q('ended')),
        toasts: ((q('toasts') as HTMLElement | null)?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 200),
        text: document.body.innerText.slice(0, 5000),
      };
    });
  } catch {
    return null;
  }
}

async function readTeacherRows(t: Page): Promise<Map<number, { money: number | null; resp: string }>> {
  const rows = await t
    .evaluate(() => {
      const head = [...document.querySelectorAll('[data-testid="student-table"] thead th')].map((x) => (x as HTMLElement).innerText);
      const mi = head.findIndex((h) => h.includes('자금'));
      return [...document.querySelectorAll('[data-testid="student-row"]')].map((r) => {
        const tds = r.querySelectorAll('td');
        return {
          seat: Number(r.getAttribute('data-seat')),
          money: mi >= 0 ? (tds[mi] as HTMLElement | undefined)?.innerText ?? '' : '',
          resp: r.querySelector('[data-testid="cell-response"]')?.getAttribute('data-v') ?? 'na',
        };
      });
    })
    .catch(() => [] as { seat: number; money: string; resp: string }[]);
  return new Map(rows.map((r) => [r.seat, { money: parseTableMoney(r.money), resp: r.resp }]));
}

/** 무역 경과(초, 호스트 기준 — 일시정지 빼고) */
function tradeElapsed(p: PubSummary): number {
  if (!p.startedAt || !p.endsAt) return 0;
  const remaining = p.paused ? null : (p.endsAt - p.serverNow) / 1000;
  if (remaining === null) return Math.max(0, ((p.pausedAt ?? p.serverNow) - p.startedAt) / 1000 - p.pausedTotalSec);
  return Math.max(0, p.durationSec - remaining);
}

/** (작업 137) 교사 대시보드 오른쪽 접힘 영역 펼치기(이미 펼쳐져 있으면 그대로) */
async function openFoldOf(t: Page, id: string): Promise<void> {
  const f = t.getByTestId(`fold-${id}`);
  if ((await f.getAttribute('data-open').catch(() => null)) !== '1') await t.getByTestId(`fold-${id}-head`).click({ timeout: 5000 }).catch(() => undefined);
}

async function endRoom(t: Page): Promise<boolean> {
  const btn = t.getByTestId('wrapup-panel').getByRole('button', { name: '판 끝내기·방 닫기' });
  if (!(await btn.isVisible().catch(() => false))) return endRoomViaSettings(t);
  await btn.click();
  for (let i = 0; i < 3; i++) {
    if (await t.getByTestId('ended').isVisible().catch(() => false)) break;
    await t.getByTestId('confirm-ok').click({ timeout: 4000 }).catch(() => undefined);
  }
  return t.getByTestId('ended').waitFor({ timeout: 15_000 }).then(() => true, () => false);
}

async function endRoomViaSettings(t: Page): Promise<boolean> {
  if (await t.getByTestId('ended').isVisible().catch(() => false)) {
    if (await t.getByTestId('btn-close-room').isVisible().catch(() => false)) await t.getByTestId('btn-close-room').click().catch(() => undefined);
    return true;
  }
  await t.getByTestId('btn-settings').click({ timeout: 5000 });
  await t.getByTestId('btn-end').click({ timeout: 5000 });
  for (let i = 0; i < 3; i++) {
    if (await t.getByTestId('ended').isVisible().catch(() => false)) break;
    await t.getByTestId('confirm-ok').click({ timeout: 4000 }).catch(() => undefined);
  }
  return t.getByTestId('ended').waitFor({ timeout: 15_000 }).then(() => true, () => false);
}
