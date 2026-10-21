import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { COMPANY_NAMES } from '../tests/sim/bot';
import { openBots } from './support/bots';
import { FastClock } from './support/fast-clock';
import { startRelayInProcess, startRelayProcess, startStatic, ROOT, type RelayProcess, type StaticServer } from './support/voyage-servers';
import {
  bodyText,
  cardOf,
  dismissLight,
  enter,
  finishMinigame,
  found,
  newContext,
  openFold,
  openScreen,
  openTvMenu,
  openStudent,
  openTeacher,
  sailTo,
  shot,
  tradeLeft,
  watchErrors,
  type Env,
} from './support/voyage-ui';

/**
 * 작업 114 — 1차시 통합 E2E(끝에서 끝까지). **빌드본 `dist/`를 `/voyage/` 하위 경로로** 주는 정적 서버(nginx처럼 `/voyage/ws`·
 * `/voyage/health`·`/voyage/notice`를 넘김) + **로컬 중계 서버**(`node server/dist/index.js`, ALLOW_LOCALHOST=1, 빈 포트)를 거친다.
 * 시간은 e2e 전용 빨리 감기 시계(support/fast-clock.ts — 빌드에 들어가지 않음)로 돌린다.
 *
 * A. [차시마다 한 판] L1 무역 15분 자동 진행: 교사(대시보드) + 공용 화면 + 학생 3명(각자 다른 기기 = 다른 브라우저 문맥)
 *    입장(출석번호 + 회사 이름, 같은 이름 거절 → 다시 입력) → 회사 설립 → [무역 시작] → 배치표대로 L1 활동·라운드·학습지·편지 →
 *    한 학생 새로 고침(자동 재입장), 한 학생은 L1-E4 뒤 늦게 입장(따라잡기) → 무역 끝 → 마무리(결산·시상·되돌아보기·끝나고 쓰기) →
 *    대시보드에 천연가스 임무·흑연 결정·편지 결과·학습지 완료, 공용 화면 장면 전환, 출석번호·"사용 중인 방" 비노출, 서버 로그에 이름·번호 없음.
 */

const DIST_OK = (() => {
  try {
    return readFileSync(join(ROOT, 'dist', 'index.html'), 'utf8').length > 0 && readFileSync(join(ROOT, 'server', 'dist', 'index.js'), 'utf8').length > 0;
  } catch {
    return false;
  }
})();

test.describe.configure({ mode: 'serial' });
// 창 여러 개(교사·공용 화면·학생)가 동시에 움직이므로 뒤에 있는 창의 타이머를 늦추지 않게 한다(교실에서는 기기마다 앞 창)
test.use({ actionTimeout: 15_000, launchOptions: { args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] } });

let relay: RelayProcess;
let web: StaticServer;

test.beforeAll(async () => {
  test.skip(!DIST_OK, 'dist/와 server/dist/가 필요해요(npm run build, npm run build:server)');
  mkdirSync(join(ROOT, 'tmp'), { recursive: true });
  relay = await startRelayProcess();
  web = await startStatic({ relayPort: relay.port });
});

test.afterAll(async () => {
  await web?.close();
  await relay?.stop();
});

function makeEnv(browser: import('@playwright/test').Browser): Env {
  return { browser, base: web.base, clock: new FastClock(), errors: [], contexts: [] };
}

async function closeEnv(env: Env) {
  for (const c of env.contexts) await c.close().catch(() => undefined);
}

const SCENE = (scr: Page) => scr.getByTestId('route-screen').getAttribute('data-scene');

/** 다른 학생의 출석번호가 학생 화면에 보이지 않는다(data-seat 속성·"n번 회사이름" 글자) */
async function expectNoOtherSeats(s: Page, others: { seat: number; name: string }[]) {
  expect(await s.locator('[data-seat]').count()).toBe(0);
  const text = await bodyText(s);
  for (const o of others) {
    expect(text).not.toMatch(new RegExp(`${o.seat}\\s*번\\s*${o.name}`));
    expect(text).not.toMatch(new RegExp(`${o.name}\\s*\\(?\\s*${o.seat}\\s*번`));
  }
  expect(text).not.toContain('사용 중인 방');
}

const t0 = Date.now();
const step = (m: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);

test('A. 차시 한 판 L1 15분 — 로컬 중계 서버 + /voyage/ 하위 경로, 끝에서 끝까지', async ({ browser }) => {
  test.setTimeout(900_000);
  const env = makeEnv(browser);
  const clock = env.clock;
  const healthByPage = new Map<string, number>();
  const countHealth = (p: Page, label: string) =>
    p.on('request', (r) => {
      if (new URL(r.url()).pathname.endsWith('/health')) healthByPage.set(label, (healthByPage.get(label) ?? 0) + 1);
    });

  // ── 교사: 판 설정 → 방 열기 ──
  // (작업 153) v0.3.8 차시 한 판 15분 '알아서'(활동마다 바로)는 학습지 시간 때문에 L1-E4·두 섬이 빠진다 — 이 끝에서 끝까지 시험은
  // 두 섬·늦은 학생 따라잡기를 보므로 학습지를 '게임 끝나고'로 고정한다(학습지 순서는 tests/core·worksheet-helpers·teacher-first-time e2e가 본다)
  const { t, code } = await openTeacher(env, { minutes: 15, ws: 'after' });
  countHealth(t, 'teacher');
  // 방을 연 뒤의 교사 대시보드에는 "사용 중인 방"이 없다(v0.3.2)
  expect(await bodyText(t)).not.toContain('사용 중인 방');
  const scr = await openScreen(t);
  countHealth(scr, 'screen');
  const scenes: string[] = [];
  const noteScene = async () => {
    const s = await SCENE(scr);
    if (s && scenes.at(-1) !== s) scenes.push(s);
  };
  await expect.poll(() => SCENE(scr), { timeout: 15_000 }).toMatch(/code|rules/);
  await noteScene();
  await expect(scr.getByTestId('screen-room-code')).toHaveText(`${code.slice(0, 3)} ${code.slice(3)}`, { timeout: 40_000 });

  // ── 학생 입장: s1 해오름무역, s2 같은 이름 → 거절 → 바다상회 ──
  const s1 = await openStudent(env, 's1');
  countHealth(s1, 's1');
  const s2 = await openStudent(env, 's2');
  countHealth(s2, 's2');
  // 학생 입장 화면: "사용 중인 방"·이용 안내 한 줄 없음(v0.3.2)
  for (const s of [s1, s2]) {
    const text = await bodyText(s);
    expect(text).not.toContain('사용 중인 방');
    expect(text).not.toContain('개인적으로 운영하는 무료 서버');
  }
  await enter(s1, code, 1, '해오름무역');
  await found(s1);
  await enter(s2, code, 2, '해오름무역');
  await expect(s2.getByTestId('entry-error')).toHaveAttribute('data-code', 'NAME_TAKEN');
  await expect(s2.getByTestId('entry-error')).toContainText('이미 다른 회사가 쓰는 이름이에요');
  await shot(s2, 'A01-student-name-taken-1366.png');
  await s2.getByTestId('entry-name').fill('바다상회');
  await s2.getByTestId('entry-submit').click();
  await found(s2);
  await expect(t.getByTestId('student-row')).toHaveCount(2);
  // 준비 단계 공용 화면은 방 코드(20초) ↔ 항해 규칙(12초)을 번갈아 보인다
  await expect(scr.getByTestId('screen-joined')).toHaveText('들어온 회사 2개', { timeout: 40_000 });
  await expectNoOtherSeats(s2, [{ seat: 1, name: '해오름무역' }]);
  await expectNoOtherSeats(scr, [{ seat: 1, name: '해오름무역' }, { seat: 2, name: '바다상회' }]);

  // ── [무역 시작] ──
  await t.getByTestId('btn-start-trade').click();
  await t.getByTestId('confirm-ok').click();
  await expect(t.getByTestId('trade-clock')).toBeVisible();
  const total = await tradeLeft(t);
  // 학습지·편지 패널 펼치기(작업 137: 접힘 영역 '학습지'·'편지·돌발 사건·공정한 바다')
  await openFold(t, 'worksheet');
  await openFold(t, 'more');
  expect(total).toBeGreaterThan(14 * 60);

  // ── L1-E1 벽란도 시장(짧은 형태) ──
  await clock.fastForwardUntil(async () => (await s1.getByTestId('minigame').count()) > 0, { label: 'L1-E1' });
  await noteScene();
  await expect(s1.getByTestId('minigame')).toHaveAttribute('data-event', 'L1-E1');
  await finishMinigame(s1);
  await finishMinigame(s2);
  await expect(s1.getByTestId('event-waiting')).toBeVisible();

  // ── L1-E2 개념 카드 ──
  await clock.fastForwardUntil(async () => (await cardOf(s1, 'L1-E2').count()) > 0, { label: 'L1-E2' });
  await noteScene();
  for (const s of [s1, s2]) {
    await expect(cardOf(s, 'L1-E2')).toBeVisible();
    await s.getByTestId('card-confirm').click();
  }

  // ── 1라운드: L1-E6 천연가스 뉴스·임무 + 튜토리얼 ──
  await clock.fastForwardUntil(async () => (await s1.getByTestId('event-panel').count()) > 0, { label: 'round 1' });
  await noteScene();
  await expect(s1.getByTestId('event-panel')).toHaveAttribute('data-event', 'L1-E6');
  await expect(s1.getByTestId('mission')).toHaveAttribute('data-mission', 'M-GAS');
  await sailTo(s1, 'PHE');
  await s1.getByTestId('event-panel').getByTestId('card-confirm').click().catch(() => undefined);
  // s2: 튜토리얼 건너뛰고 상하이로
  await s2.getByTestId('tutorial-skip').click().catch(() => undefined);
  await s2.getByTestId('event-panel').getByTestId('card-confirm').click().catch(() => undefined);
  // (작업 151) 1차시 차시 판 기본 = 자유 항해: [여기로 출발]로 바로 도착(운항비는 라운드 끝에)
  expect(await sailTo(s2, 'SHA')).toBe('free');
  await expect(s2.getByTestId('hud-fare-due')).toBeVisible();
  // s2 새로 고침 → 같은 기기 자동 재입장(회사 그대로, 도착한 항구 그대로)
  await s2.reload();
  await expect(s2.getByTestId('hud-company')).toContainText('바다상회', { timeout: 20_000 });
  await expect(t.locator('[data-testid="student-row"][data-seat="2"]')).toContainText('상하이');
  await expect(s2.getByTestId('hud-fare-due')).toBeVisible();
  // 교사: 학습지 ① 지금 띄우기(라운드 중이면 예약 → 라운드가 끝나면 뜸)
  await t.getByTestId('panel-WorksheetPanel').scrollIntoViewIfNeeded();
  await t.getByTestId('ws-pick').selectOption('W01');
  await t.getByTestId('ws-open-now').click();
  await expect(t.getByTestId('ws-reserved')).toContainText('①');
  await shot(t, 'A02-teacher-round1-1366.png');
  await shot(scr, 'A03-screen-round1-1920.png');

  // ── 라운드 끝 → 예약한 학습지 팝업 ①, 학생 [다 썼어요] → 대시보드 완료 수 ──
  await clock.fastForwardUntil(async () => (await s1.getByTestId('worksheet-popup').count()) > 0, { label: 'W01 popup' });
  await noteScene();
  await s1.getByTestId('worksheet-done').click();
  await s2.getByTestId('worksheet-done').click();
  await expect(t.getByTestId('panel-WorksheetPanel')).toContainText('2/2');
  await t.getByTestId('ws-close-all').click();

  // ── L1-E4 무역이 없다면? ──
  await clock.fastForwardUntil(async () => (await cardOf(s1, 'L1-E4').count()) > 0, { label: 'L1-E4' });
  await noteScene();
  for (const s of [s1, s2]) {
    await dismissLight(s);
    await s.getByTestId('card-confirm').click();
  }

  // ── L1-E5 두 섬 이야기 + 늦게 온 3번째 학생(따라잡기) ──
  await clock.fastForwardUntil(async () => (await s1.getByTestId('minigame').count()) > 0, { label: 'L1-E5' });
  await noteScene();
  await expect(s1.getByTestId('minigame')).toHaveAttribute('data-event', 'L1-E5');
  const s3 = await openStudent(env, 's3');
  countHealth(s3, 's3');
  await enter(s3, code, 3, '늦은배무역');
  await expect(s3.getByTestId('found-company')).toBeVisible({ timeout: 15_000 });
  await s3.getByTestId('found-submit').click();
  for (const s of [s1, s2]) await finishMinigame(s);
  await expect(s3.getByTestId('minigame')).toHaveAttribute('data-event', 'L1-E5', { timeout: 15_000 });
  await finishMinigame(s3);
  // (작업 153, PRD 4.3.3 v0.3.8 규칙 2) 차시 한 판에는 ★ 지금 쓰기가 없다 — 두 섬 뒤 '지금 써요' 팝업이 뜨지 않는다
  await expect(s1.locator('[data-testid="worksheet-popup"][data-during="1"]')).toHaveCount(0);
  // 사건이 닫히면 따라잡기(요약 → 벽란도)
  await clock.fastForwardUntil(async () => (await s3.getByTestId('catchup').count()) > 0, { label: 's3 catchup', speed: 8 });
  for (let i = 0; i < 6 && (await s3.getByTestId('catchup').count()); i++) {
    if (await s3.getByTestId('catchup-ok').isVisible().catch(() => false)) await s3.getByTestId('catchup-ok').click();
    else if (await s3.getByTestId('minigame').isVisible().catch(() => false)) await finishMinigame(s3);
    else if (await s3.getByTestId('card-confirm').isVisible().catch(() => false)) await s3.getByTestId('card-confirm').click();
    else if (await s3.getByTestId('catchup-next').isVisible().catch(() => false)) await s3.getByTestId('catchup-next').click();
    await s3.waitForTimeout(300);
  }
  await expect(s3.getByTestId('catchup')).toHaveCount(0);
  await expect(s3.getByTestId('mission')).toHaveAttribute('data-mission', 'M-GAS');

  // ── 2라운드: L1-E7 흑연 결정 + 편지 S1 + s1 포트헤들랜드 천연가스 사기 ──
  await clock.fastForwardUntil(async () => (await s1.locator('[data-testid="event-panel"][data-event="L1-E7"]').count()) > 0, { label: 'round 2' });
  await noteScene();
  for (const s of [s1, s2, s3]) await dismissLight(s);
  // s1: 포트헤들랜드에서 천연가스 3상자
  await s1.getByTestId('enter-port').click();
  await expect(s1.getByTestId('port-screen')).toHaveAttribute('data-port', 'PHE');
  for (let i = 0; i < 2; i++) await s1.getByTestId('buy-gas-plus').click();
  await s1.getByTestId('buy-card-gas').getByTestId('buy-gas').click();
  await expect(s1.getByTestId('hud-cargo')).toContainText('3/20');
  await dismissLight(s1);
  await s1.getByTestId('event-panel-unfold').click();
  // 결정: s1 상하이, s2 부산, s3 사지 않기
  await s1.getByTestId('decision-opt-SHA').click();
  await s1.getByTestId('decision-submit').click();
  await expect(s1.getByTestId('decision-chosen')).toHaveAttribute('data-choice', 'SHA');
  await s2.getByTestId('decision-opt-BUS').click();
  await s2.getByTestId('decision-submit').click();
  await s3.getByTestId('decision-opt-none').click();
  await s3.getByTestId('decision-submit').click();
  await expect(t.getByTestId('tl-resp-count')).toHaveText('흑연을 어디서 살까요? 학생 3/3 응답'); // (작업 137 수정 1회차) 라운드 중 결정은 라운드 카드 보조 정보
  // s1: 부산으로 출항
  await s1.getByTestId('port-back').click();
  await sailTo(s1, 'BUS');
  // 편지(라운드 2에 도착): 셋 다 열어 첫 보기로 답한다
  for (const s of [s1, s2, s3]) {
    await expect(s.getByTestId('hud-letters')).toHaveAttribute('data-count', '1', { timeout: 15_000 });
    await s.getByTestId('hud-letters').click();
    await s.locator('[data-testid="letter-item"][data-slot="S1"]').click();
    await s.getByTestId('letter-choice').first().click();
    await expect(s.getByTestId('letter-read')).toHaveAttribute('data-result', /right|wrong/);
    if (await s.getByTestId('letter-ack').isVisible().catch(() => false)) await s.getByTestId('letter-ack').click();
    if (await s.getByTestId('letter-close').isVisible().catch(() => false)) await s.getByTestId('letter-close').click();
  }
  await shot(s1, 'A04-student-round2-1366.png');
  for (const [s, others] of [
    [s1, [{ seat: 2, name: '바다상회' }, { seat: 3, name: '늦은배무역' }]],
    [s2, [{ seat: 1, name: '해오름무역' }, { seat: 3, name: '늦은배무역' }]],
    [s3, [{ seat: 1, name: '해오름무역' }, { seat: 2, name: '바다상회' }]],
  ] as const)
    await expectNoOtherSeats(s, [...others]);

  // ── 무역 끝 → 마무리 ──
  // (작업 162) 순서를 다 해도 판은 저절로 끝나지 않는다 — '오늘 순서를 다 했어요' 카드의 큰 [마무리로](남은 순서가 없어 확인 없음)
  await clock.fastForwardUntil(async () => (await t.getByTestId('now-finish').count()) > 0, { label: 'plan done' });
  await expect(t.getByTestId('now-plan-done')).toHaveText('오늘 순서를 다 했어요');
  expect(await s1.getByTestId('trade-over').count()).toBe(0);
  await t.getByTestId('now-finish').click();
  await clock.fastForwardUntil(async () => (await s1.getByTestId('trade-over').count()) > 0, { label: 'trade over' });
  await noteScene();
  for (const s of [s1, s2, s3]) await expect(s.getByTestId('trade-over')).toBeVisible({ timeout: 15_000 });
  await expect(t.getByTestId('wrapup-panel')).toBeVisible();
  const wrapText = await t.getByTestId('wrapup-panel').innerText();
  expect(wrapText).toContain('결산·시상');
  expect(wrapText).toContain('되돌아보기');
  // (작업 137) 첫 마무리 항목(결산·시상)이 저절로 시작되므로 학생 화면은 바로 결산 — '끝나고 쓰기' 목록은 진행 중 항목이 없을 때(아래) 확인
  await shot(t, 'A05-teacher-wrapup-1366.png');
  // (작업 132) 마무리 단계를 따라 학생 화면이 바뀐다: 결산·시상 → 결산 요약, 되돌아보기 → 2문항
  // (작업 137, PRD 7.5.2.9) 첫 항목(결산·시상)은 무역 시간이 끝나면 저절로 시작, 그다음은 카드 [다음으로: 되돌아보기]
  const wrapItem = (label: string) => t.locator('[data-testid="wrap-item"]').filter({ hasText: label });
  await expect(wrapItem('결산·시상')).toHaveAttribute('data-status', 'live');
  await expect(t.getByTestId('now-card')).toHaveAttribute('data-state', 'wrapup');
  await expect(s1.getByTestId('wrap-awards')).toBeVisible({ timeout: 15_000 });
  await expect(s1.getByTestId('wrap-metrics')).toContainText('최종 자산');
  await shot(s1, 'A06b-student-wrap-awards-1366.png');
  await expect(t.getByTestId('now-wrap-next')).toHaveText(/다음으로: 되돌아보기/);
  await t.getByTestId('now-wrap-next').click();
  await expect(wrapItem('결산·시상')).toHaveAttribute('data-status', 'done');
  await expect(s1.getByTestId('wrap-reflect')).toHaveAttribute('data-questions', '2', { timeout: 15_000 });
  await shot(s1, 'A06c-student-wrap-reflect-1366.png');
  await wrapItem('되돌아보기').getByRole('button', { name: '끝' }).click();
  await expect(s1.getByTestId('trade-over')).toHaveAttribute('data-wrap', '');
  await expect(s1.getByTestId('after-worksheets-student')).toBeVisible();
  await shot(s1, 'A06-student-trade-over-1366.png');
  await clock.fastForwardUntil(async () => (await SCENE(scr)) !== 'map', { label: 'screen wrap', maxFastMs: 60_000 }).catch(() => undefined);
  await noteScene();
  await shot(scr, 'A07-screen-wrapup-1920.png');

  // ── 대시보드 반영: 임무·결정·편지·학습지 ──
  await t.locator('[data-testid="student-row"][data-seat="1"] [data-testid="cell-company"]').click();
  const drawer = t.getByTestId('student-drawer');
  await expect(drawer).toContainText('graphiteChoice: SHA');
  await expect(drawer).toContainText(/천연가스|M-GAS/);
  const drawerText = await drawer.innerText();
  await t.getByTestId('drawer-close').click();
  // 학생 표: 임무 진행(15분 판은 2라운드라 포트헤들랜드 → 부산 도착이 무역 끝과 같아 '완료'까지는 못 감 — 0/1), 편지 정답 수
  for (const seat of [1, 2, 3]) {
    const row = t.locator(`[data-testid="student-row"][data-seat="${seat}"]`);
    await expect(row).toContainText(/[01]\/1/);
  }
  // 편지 패널: S1 배달·답함 3/3
  await expect(t.locator('[data-testid="lp-slot"][data-slot="S1"]').getByTestId('lp-rate')).toContainText('답함 3/3');
  // 학습지 패널: ① 완료 표(2명 — 3번은 ① 팝업 뒤에 들어옴)
  await expect(t.locator('[data-testid="ws-rate-row"][data-id="W01"]')).toContainText('2/3');
  await shot(t, 'A08-teacher-wrapup-panels-1366.png');

  // 항해 기록장(학생 탭)에도 "사용 중인 방" 없음
  await s1.getByTestId('after-logbook').click();
  await expect(s1.getByTestId('logbook')).toBeVisible();
  expect(await bodyText(s1)).not.toContain('사용 중인 방');
  await shot(s1, 'A09-student-logbook-1366.png');
  await s1.getByTestId('logbook-close').click();

  // ── 결과 파일 저장(마무리 패널) → [판 끝내기·방 닫기] (리허설 9단계) ──
  // 결과 파일 내용은 페이지가 만든 Blob에서 읽는다(이 PC의 헤드리스 브라우저는 blob 내려받기 '완료'가 수십 초 늦거나 멈추는 일이
  // 있어 — 내려받기 시작(download 이벤트 2번)까지만 기다린다. 작업 114 result.md 가정)
  await t.evaluate(() => {
    const w = window as unknown as { __blobs: string[] };
    w.__blobs = [];
    const orig = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (b: Blob | MediaSource) => {
      if (b instanceof Blob) void b.text().then((x) => w.__blobs.push(x));
      return orig(b);
    };
  });
  let started = 0;
  t.on('download', () => started++);
  // (작업 137) 마무리 카드의 [결과 파일 저장](작은 글자 버튼 — 다음 마무리 항목을 기다릴 때·마지막 항목에서)
  await t.getByTestId('now-save-result').click();
  await expect(t.getByTestId('confirm-result')).toContainText('실명은 들어 있지 않아요');
  await t.getByTestId('confirm-ok').click();
  await expect.poll(() => started, { timeout: 15_000 }).toBe(2);
  const blobs = await t.evaluate(() => (window as unknown as { __blobs: string[] }).__blobs);
  const csv = (blobs.find((x) => x.includes('출석번호,')) ?? '').replace(/^\uFEFF/, '');
  expect(csv.split(/\r?\n/)[0]).toMatch(/^출석번호,회사 이름,판 단위,차시\(범위\)/);
  expect(blobs.some((x) => x.trim().startsWith('{'))).toBe(true);
  for (const n of ['해오름무역', '바다상회', '늦은배무역']) expect(csv).toContain(n);
  // [수업 끝내기(방 닫기)] — 확인 2번(PRD 7.5.2.6). 마무리 중간이면 [설정] 맨 아래에서
  await t.getByTestId('btn-settings').click();
  await t.getByTestId('btn-end').click();
  await expect(t.getByTestId('confirm-end-1')).toBeVisible();
  await t.getByTestId('confirm-ok').click();
  await expect(t.getByTestId('confirm-end-2')).toBeVisible();
  await t.getByTestId('confirm-ok').click();
  await expect(t.getByTestId('ended')).toBeVisible();
  for (const s of [s1, s2, s3]) await expect(s.getByTestId('student-room-closed')).toBeVisible({ timeout: 15_000 });
  await shot(t, 'A10-teacher-ended-1366.png');

  // ── 비노출·오류 ──
  for (const label of ['s1', 's2', 's3', 'screen']) expect(healthByPage.get(label) ?? 0, `${label} /health`).toBeLessThanOrEqual(1);
  const logs = relay.logs.join('\n');
  for (const n of ['해오름무역', '바다상회', '늦은배무역', code]) expect(logs).not.toContain(n);
  expect(env.errors).toEqual([]);
  writeFileSync(
    join(ROOT, 'tmp', '114-e2e-A.json'),
    JSON.stringify({ scenes, healthByPage: Object.fromEntries(healthByPage), drawer: drawerText, relayLogLines: relay.logs.length }, null, 2),
  );
  // 공용 화면 장면 전환: 방 코드 → 사건 → 학습지 → … → 시상(마무리)
  expect(scenes[0]).toMatch(/code|rules/);
  expect(scenes).toEqual(expect.arrayContaining(['event', 'worksheet', 'awards']));
  expect(scenes.at(-1)).toBe('awards');
  await closeEnv(env);
});

// ───────────────────────── B. 사용 중인 방·가득 참·경쟁·점검·알 수 없음·이용 안내 ─────────────────────────

/** docs/teacher-setup.md 0.1(= PRD 10.12.1)의 이용 안내 1~8번과 하단 한 줄(굵게 ** 뺌) */
/** teacher-setup.md 0.1(v0.3.3): 1~9(9번 = 기본 문의), 화면 맨 아래 두 줄(한 줄 + 저작권·문의 줄) */
function docServiceNotice(): { items: string[]; short: string; credit: string } {
  const md = readFileSync(join(ROOT, 'docs', 'teacher-setup.md'), 'utf8');
  const sec = md.slice(md.indexOf('### 0.1'), md.indexOf('### 0.2'));
  const items = [...sec.matchAll(/^(\d)\. (.+)$/gm)].filter((m) => Number(m[1]) <= 9).map((m) => m[2]!.replace(/\*\*/g, '').trim());
  const short = /화면 맨 아래[^"]*"([^"]+?) \[이용 안내\]"/.exec(sec)?.[1] ?? '';
  const credit = /"(Copyright [^"]+)"/.exec(sec)?.[1] ?? '';
  return { items, short, credit };
}

async function teacherSetup(env: Env, label: string): Promise<Page> {
  const ctx = await newContext(env);
  const p = await ctx.newPage();
  watchErrors(p, label, env.errors, { allowServerDown: true });
  await p.goto('./#/teacher');
  await p.getByTestId('btn-new').click();
  await p.getByTestId('unit-lesson').click();
  await p.getByTestId('lesson-L1').click();
  const custom = p.getByTestId('trade-minutes-custom');
  await custom.fill('10');
  await custom.blur();
  return p;
}

const roomText = (p: Page) => p.getByTestId('room-count-text');

async function endAndClose(p: Page) {
  await p.getByTestId('btn-settings').click();
  await p.getByTestId('btn-end').click();
  await p.getByTestId('confirm-ok').click();
  await p.getByTestId('confirm-ok').click();
  await expect(p.getByTestId('ended')).toBeVisible();
}

test('B. 사용 중인 방 n/1 → 가득 참 → 풀림 → 경쟁(BUSY) → 알 수 없음, 이용 안내 문구(로컬 중계 서버 MAX_ROOMS=1)', async ({ browser }) => {
  test.setTimeout(600_000);
  const r1 = await startRelayInProcess({ MAX_ROOMS: '1', NOTICE_FILE: join(ROOT, 'tmp', '114-e2e-no-notice.json') });
  const w1 = await startStatic({ relayPort: r1.port });
  const env: Env = { browser, base: w1.base, clock: new FastClock(), errors: [], contexts: [] };
  const doc = docServiceNotice();
  expect(doc.items).toHaveLength(9);
  expect(doc.items[8]).toBe('문의: GitHub 저장소(github.com/UP-HAN/voyage-trade-king)');
  expect(doc.short.length).toBeGreaterThan(20);
  expect(doc.credit).toBe('Copyright 2026. hanuipyo');
  try {
    // ── 타이틀(v0.3.4): 사용 중인 방은 기본 숨김, 하단 두 줄·[이용 안내] 전문 = 문서(상한 자리는 서버 값 1) ──
    const titleCtx = await newContext(env);
    const title = await titleCtx.newPage();
    watchErrors(title, 'title', env.errors);
    await title.goto('./');
    await expect(title.getByTestId('service-footer-text')).toHaveText(doc.short);
    await expect(title.getByTestId('service-footer-credit')).toHaveText(doc.credit);
    await expect(roomText(title)).toHaveCount(0);
    await shot(title, 'B01-title-room-count-footer-1366.png');
    await title.getByRole('button', { name: '이용 안내' }).click();
    const items = title.getByTestId('service-notice-items').locator('li');
    await expect(items).toHaveCount(9);
    await expect(items.nth(2)).toContainText('방은 1개');
    const shown = (await items.allInnerTexts()).map((x) => x.trim());
    expect(shown).toEqual(doc.items.map((x) => x.replace('방은 50개', '방은 1개')));
    await shot(title, 'B02-title-service-notice-1366.png');
    await title.getByRole('button', { name: '닫기' }).click();
    // display.titleRoomCount: true 면 타이틀에도 '사용 중인 방'
    w1.setConfig({ display: { titleRoomCount: true } });
    const tr = await titleCtx.newPage();
    await tr.goto('./');
    await expect(roomText(tr)).toHaveText('사용 중인 방 0/1');
    await tr.close();
    // config.json serverInfo.contact가 있으면 문의가 그 값으로(한 줄 끝·9번), 저작권 줄은 그대로
    w1.setConfig({ serverInfo: { contact: 'mailto:voyage@example.org' } });
    const t2 = await titleCtx.newPage();
    await t2.goto('./');
    await expect(t2.getByTestId('service-footer-text')).toHaveText(`${doc.short} · 문의: mailto:voyage@example.org`);
    await expect(t2.getByTestId('service-footer-credit')).toHaveText(doc.credit);
    await t2.getByRole('button', { name: '이용 안내' }).click();
    await expect(t2.getByTestId('service-notice-items').locator('li')).toHaveCount(9);
    await expect(t2.getByTestId('service-notice-items').locator('li').nth(8)).toHaveText('문의: mailto:voyage@example.org');
    await t2.close();
    w1.setConfig(null);
    await expect(title.getByTestId('service-footer-text')).not.toContainText('문의');

    // ── T01: 0/1 + 하단 한 줄 → 판 설정: 0/1 → 방 열기 ──
    const a = await teacherSetup(env, 'teacherA');
    await expect(roomText(a)).toHaveText('사용 중인 방 0/1');
    await shot(a, 'B03-setup-ok-0of1-1366.png');
    await a.getByTestId('btn-open').click();
    await expect(a.getByTestId('room-code')).toHaveText(/^\d{6}$/);
    expect(await bodyText(a)).not.toContain('사용 중인 방'); // 방을 연 뒤 대시보드

    // ── 다른 브라우저 문맥: 1/1 · 가득 찼어요 + [방 열기] 꺼짐 + 안내 상자 ──
    const b = await teacherSetup(env, 'teacherB');
    await expect(roomText(b)).toHaveText('사용 중인 방 1/1 · 가득 찼어요');
    await expect(b.getByTestId('btn-open')).toBeDisabled();
    await expect(b.getByTestId('room-full-notice')).toContainText('지금 서버에 방이 가득 찼어요');
    await shot(b, 'B04-setup-full-1of1-1366.png');
    // 판 설정은 30초마다 다시 읽는다(빠른 시계로 약 95초 → 2~4번)
    const h0 = w1.hits.get('/voyage/health') ?? 0;
    await env.clock.setSpeed(10);
    await b.waitForTimeout(9_500);
    await env.clock.setSpeed(1);
    const polls = (w1.hits.get('/voyage/health') ?? 0) - h0;
    expect(polls).toBeGreaterThanOrEqual(2);
    expect(polls).toBeLessThanOrEqual(5);

    // ── 첫 방 [판 끝내기·방 닫기] → 30초 안에 b의 버튼이 켜지고 방 열기 성공 ──
    await endAndClose(a);
    await env.clock.fastForwardUntil(async () => (await roomText(b).innerText()) === '사용 중인 방 0/1', { speed: 10, maxFastMs: 40_000, label: '풀림' });
    await expect(b.getByTestId('btn-open')).toBeEnabled();
    await b.getByTestId('btn-open').click();
    await expect(b.getByTestId('room-code')).toHaveText(/^\d{6}$/);
    await endAndClose(b);

    // ── 경쟁: 두 문맥이 동시에 [방 열기] → 하나만 성공, 다른 하나는 BUSY 문구 + 표시 갱신 ──
    const c = await teacherSetup(env, 'teacherC');
    const d = await teacherSetup(env, 'teacherD');
    for (const p of [c, d]) await expect(roomText(p)).toHaveText('사용 중인 방 0/1');
    await Promise.all([c.getByTestId('btn-open').click(), d.getByTestId('btn-open').click()]);
    await expect.poll(async () => (await c.getByTestId('room-code').count()) + (await d.getByTestId('room-code').count()), { timeout: 15_000 }).toBe(1);
    const lose = (await c.getByTestId('room-code').count()) ? d : c;
    await expect(lose.getByTestId('open-error')).toHaveAttribute('data-code', 'BUSY');
    await expect(lose.getByTestId('open-error')).toContainText('지금 서버에 방이 가득 찼어요(1/1)');
    await expect(roomText(lose)).toHaveText('사용 중인 방 1/1 · 가득 찼어요');
    await expect(lose.getByTestId('btn-open')).toBeDisabled();
    await shot(lose, 'B05-setup-race-busy-1366.png');

    // ── 중계 서버를 멈춘 상태: 알 수 없음 + [방 열기]는 켜짐 → 누르면 연결 실패 안내 ──
    await r1.close();
    await env.clock.fastForwardUntil(async () => (await roomText(lose).innerText()).includes('알 수 없음'), { speed: 10, maxFastMs: 60_000, label: '알 수 없음' });
    await expect(roomText(lose)).toHaveText('사용 중인 방: 알 수 없음');
    await expect(lose.getByTestId('room-count-refresh')).toBeVisible();
    await expect(lose.getByTestId('btn-open')).toBeEnabled();
    await shot(lose, 'B06-setup-unknown-1366.png');
    await lose.getByTestId('btn-open').click();
    await expect(lose.getByTestId('open-error')).not.toHaveAttribute('data-code', 'BUSY', { timeout: 30_000 });
    await expect(lose.getByTestId('open-error')).toBeVisible();
    await shot(lose, 'B07-setup-unknown-open-failed-1366.png');
  } finally {
    await closeEnv(env);
    await w1.close();
    await r1.close().catch(() => undefined);
  }
  // 서버를 일부러 멈춘 뒤의 연결 실패(WebSocket·/health)는 시험 의도라 뺀다
  expect(env.errors.filter((e) => !/requestfailed|WebSocket|ERR_CONNECTION/.test(e))).toEqual([]);
});

test('B2. 점검 공지(blockNewRooms) 다시 읽기: 새 방 막힘·띠, 이미 열린 방 거래는 정상 + 기본 서버 /health maxRooms 50', async ({ browser }) => {
  test.setTimeout(300_000);
  const noticeFile = join(ROOT, 'tmp', '114-e2e-notice2.json');
  await rm(noticeFile, { force: true });
  const r2 = await startRelayInProcess({ NOTICE_FILE: noticeFile });
  const w2 = await startStatic({ relayPort: r2.port });
  const env: Env = { browser, base: w2.base, clock: new FastClock(), errors: [], contexts: [] };
  try {
    const { t, code } = await openTeacher(env, { minutes: 10, label: 'teacherN' });
    const s = await openStudent(env, 'sN');
    await enter(s, code, 5, '등대무역');
    await found(s);
    await t.getByTestId('btn-start-trade').click();
    await t.getByTestId('confirm-ok').click();
    // 공지 파일 + SIGHUP(= reloadNotice — Windows에는 SIGHUP이 없어 같은 처리기를 직접 부름)
    writeFileSync(noticeFile, JSON.stringify({ level: 'warn', text: '오늘 17시 서버 점검이 있어요. 새 방은 열 수 없어요.', blockNewRooms: true }));
    expect((r2.reloadNotice() as { status: string }).status).toBe('ok');
    expect(await r2.health()).toMatchObject({ acceptingNewRooms: false, notice: 'warn' });
    // 새 교사: 판 설정 = 점검 중 + 버튼 꺼짐 + 공지 띠
    const n = await teacherSetup(env, 'teacherNew');
    await expect(roomText(n)).toHaveText('사용 중인 방 1/50 · 점검 중이라 새 방을 열 수 없어요');
    await expect(n.getByTestId('btn-open')).toBeDisabled();
    await expect(n.getByTestId('room-full-notice')).toHaveAttribute('data-kind', 'blocked');
    await expect(n.getByTestId('notice-banner')).toContainText('오늘 17시 서버 점검');
    await shot(n, 'B08-setup-maintenance-1366.png');
    // 타이틀·학생 입장 화면에도 띠
    const ti = await (await newContext(env)).newPage();
    await ti.goto('./');
    await expect(ti.getByTestId('notice-banner')).toContainText('오늘 17시 서버 점검');
    // (v0.3.4) 타이틀에는 '사용 중인 방'을 기본으로 보이지 않는다(학생도 거치는 화면)
    await expect(roomText(ti)).toHaveCount(0);
    const st = await openStudent(env, 'sEntry');
    await expect(st.getByTestId('notice-banner')).toContainText('오늘 17시 서버 점검');
    expect(await bodyText(st)).not.toContain('사용 중인 방');
    // 이미 열린 방의 학생 거래는 정상(1라운드에 부산에서 1상자 사기)
    await env.clock.fastForwardUntil(async () => (await s.getByTestId('event-panel').count()) > 0, { label: 'N round 1' });
    await dismissLight(s);
    await s.getByTestId('event-panel').getByTestId('card-confirm').click().catch(() => undefined);
    await s.getByTestId('enter-port').click();
    await s.getByTestId('buy-card-chip').getByTestId('buy-chip').click();
    await expect(s.getByTestId('hud-cargo')).toContainText('1/20');
  } finally {
    await closeEnv(env);
    await w2.close();
    await r2.close();
  }
  // 기본 설정(MAX_ROOMS 없음) 빌드 서버 /health → maxRooms 50
  const def = await startRelayProcess();
  try {
    expect(await def.health()).toMatchObject({ ok: true, maxRooms: 50, acceptingNewRooms: true, rooms: 0 });
  } finally {
    await def.stop();
  }
  expect(env.errors).toEqual([]);
});

// ───────────────────────── C. 재접속·장애(실제 중계 서버) ─────────────────────────

test('C. 일시정지 중 입장 · 중계 서버 재시작(같은 코드) · 교사 탭 닫힘 2분 → 이어하기 · 다른 기기 허락 · 내보내기 · 교사 새로 고침', async ({ browser }) => {
  test.setTimeout(600_000);
  const rc = await startRelayProcess();
  const wc = await startStatic({ relayPort: rc.port });
  const env: Env = { browser, base: wc.base, clock: new FastClock(), errors: [], contexts: [] };
  // 서버 재시작·교사 탭 닫힘 동안의 연결 끊김은 시험 의도
  const expected = /requestfailed|WebSocket|ERR_CONNECTION|http 502/;
  try {
    const { ctx: tctx, t, code } = await openTeacher(env, { minutes: 10, label: 'teacherC' });
    const scr = await openScreen(t);
    const s1 = await openStudent(env, 'c1');
    await enter(s1, code, 1, '해오름무역');
    await found(s1);
    const s2 = await openStudent(env, 'c2');
    await enter(s2, code, 2, '바다상회');
    await found(s2);
    await t.getByTestId('btn-start-trade').click();
    await t.getByTestId('confirm-ok').click();
    await env.clock.fastForwardUntil(async () => (await s1.locator('[data-testid="event-panel"][data-event="L1-E6"]').count()) > 0, { label: 'C round 1' });

    // ── 일시정지 중 입장한 학생도 오버레이 ──
    await t.getByTestId('btn-pause').click();
    await expect(s1.getByTestId('pause-overlay')).toBeVisible();
    const s3 = await openStudent(env, 'c3');
    await enter(s3, code, 3, '늦은배무역');
    // 입장하자마자 일시정지 오버레이가 회사 설립 화면까지 덮는다
    await expect(s3.getByTestId('pause-overlay')).toBeVisible({ timeout: 15_000 });
    await shot(s3, 'C01-student-joined-during-pause-1366.png');
    await t.getByTestId('btn-resume-trade').click();
    await expect(s3.getByTestId('pause-overlay')).toHaveCount(0);
    await found(s3).catch(async () => {
      // 무역 중 입장이면 회사 설립 뒤 바로 게임 화면(prep-wait 없음)
      await expect(s3.getByTestId('hud-company')).toBeVisible();
    });

    // ── 중계 서버 재시작 → 같은 코드로 이어짐 ──
    const leftBefore = await tradeLeft(t);
    await rc.restart();
    await expect(t.getByTestId('conn-dot').or(t.getByTestId('disconnected')).first()).toBeVisible();
    await expect.poll(async () => (await t.getByTestId('room-code-small').innerText()).replace(/\D/g, ''), { timeout: 40_000 }).toBe(code);
    await expect(t.getByTestId('disconnected')).toHaveCount(0, { timeout: 40_000 });
    await expect(t.getByTestId('code-changed')).toHaveCount(0);
    for (const s of [s1, s2, s3]) await expect(s.getByTestId('hud-company')).toBeVisible({ timeout: 40_000 });
    await expect.poll(async () => t.locator('[data-testid="cell-online"]').filter({ hasText: /^\s*들어옴\s*$/ }).count(), { timeout: 40_000 }).toBe(3);
    expect(await tradeLeft(t)).toBeLessThanOrEqual(leftBefore);
    // 재시작 뒤에도 행동이 호스트까지 간다
    await dismissLight(s2);
    await s2.getByTestId('tutorial-skip').click().catch(() => undefined);
    await s2.getByTestId('event-panel').getByTestId('card-confirm').click().catch(() => undefined);
    await sailTo(s2, 'SHA');
    await expect(t.locator('[data-testid="student-row"][data-seat="2"]')).toContainText('상하이');

    // ── 교사 탭 닫힘 → 2분(빠른 시계) 뒤 다시 열기 → [이어하기] 같은 판·남은 시간 유지·대기 행동 반영 ──
    await t.waitForTimeout(1500); // 1초 묶음 저장
    const left0 = await tradeLeft(t);
    await t.close({ runBeforeUnload: false });
    await expect(s1.getByTestId('band-hostWait')).toBeVisible({ timeout: 30_000 });
    await shot(s1, 'C02-student-host-wait-band-1366.png');
    // 호스트가 없는 동안 s1 목적지(대기 행동)
    await dismissLight(s1);
    await s1.getByTestId('tutorial-skip').click().catch(() => undefined);
    await s1.getByTestId('event-panel').getByTestId('card-confirm').click().catch(() => undefined);
    await sailTo(s1, 'YOK').catch(() => undefined);
    await env.clock.setSpeed(20);
    await s1.waitForTimeout(6_000); // 빠른 시각 약 2분
    await env.clock.setSpeed(1);
    const t2 = await tctx.newPage();
    watchErrors(t2, 'teacherC2', env.errors);
    await t2.goto('./#/teacher');
    await expect(t2.getByTestId('btn-resume')).toBeVisible();
    await shot(t2, 'C03-teacher-resume-card-1366.png');
    await t2.getByTestId('btn-resume').click();
    await expect(t2.getByTestId('teacher-dashboard')).toBeVisible({ timeout: 20_000 });
    await expect(t2.getByTestId('room-code-small')).toContainText(code.slice(0, 3));
    const left1 = await tradeLeft(t2);
    expect(Math.abs(left1 - left0)).toBeLessThanOrEqual(8); // 끊긴 2분은 일시정지 처리
    await expect(s1.getByTestId('band-hostWait')).toHaveCount(0, { timeout: 20_000 });
    await expect(t2.locator('[data-testid="student-row"][data-seat="1"]')).toContainText('요코하마', { timeout: 20_000 });

    // ── 다른 기기(같은 번호 + 같은 회사 이름) → 교사 허락 → 옛 기기 moved ──
    const s1b = await openStudent(env, 'c1b');
    await enter(s1b, code, 1, '해오름무역');
    await expect(s1b.getByTestId('entry-waiting-approval')).toBeVisible();
    const req = t2.getByTestId('rejoin-request');
    await expect(req).toContainText('1번 해오름무역 — 다른 기기에서 다시 들어오기 요청');
    await expect(req).toContainText('지금 접속 중인 기기가 있어요');
    await shot(t2, 'C04-teacher-rejoin-request-1366.png');
    await req.getByTestId('btn-approve').click();
    await expect(s1b.getByTestId('hud-company')).toContainText('해오름무역', { timeout: 20_000 });
    await expect(s1.getByTestId('student-moved')).toBeVisible();

    // ── 내보내기 → 같은 기기 재입장 거부 ──
    await t2.locator('[data-testid="student-row"][data-seat="2"] [data-testid="cell-company"]').click();
    await t2.getByTestId('btn-kick').click();
    await t2.getByTestId('confirm-ok').click();
    await t2.getByTestId('confirm-ok').click();
    await expect(s2.getByTestId('student-kicked')).toBeVisible();
    // 같은 기기로 다시 열면(기기에 남은 기록으로 자동 재입장 시도) 다시 거부되거나, 입장 화면에서 넣어도 거부
    await s2.goto('./#/play');
    await expect(s2.getByTestId('student-kicked').or(s2.getByTestId('student-entry')).first()).toBeVisible({ timeout: 15_000 });
    if (await s2.getByTestId('student-entry').isVisible().catch(() => false)) await enter(s2, code, 2, '바다상회');
    await expect(s2.getByTestId('student-kicked').or(s2.getByTestId('entry-error')).first()).toBeVisible({ timeout: 15_000 });
    await expect(s2.getByTestId('hud-company')).toHaveCount(0);

    // ── 교사 화면 새로 고침(F5) → 같은 판으로 바로 복귀 ──
    const left2 = await tradeLeft(t2);
    await t2.reload();
    await expect(t2.getByTestId('teacher-dashboard')).toBeVisible({ timeout: 20_000 });
    await expect(t2.getByTestId('room-code-small')).toContainText(code.slice(0, 3));
    expect(Math.abs((await tradeLeft(t2)) - left2)).toBeLessThanOrEqual(8);
    // 공용 화면은 교사 창이 돌아오면 다시 장면을 받는다
    await expect.poll(() => SCENE(scr), { timeout: 20_000 }).not.toBe('wait');
  } finally {
    await closeEnv(env);
    await wc.close();
    await rc.stop();
  }
  expect(env.errors.filter((e) => !expected.test(e))).toEqual([]);
});

// ───────────────────────── 화면 점검 도구(가독성·이모지·터치) ─────────────────────────

/** 보이는 글자 가운데 가장 작은 것(px)과 그 요소, below 미만 글자 목록. exclude: 이 선택자 안의 글자는 뺀다 */
async function minFont(p: Page, exclude: string[] = [], below = 0): Promise<{ px: number; where: string; under: string[] }> {
  return p.evaluate(([ex, lim]) => {
    let min = Infinity;
    let where = '';
    const under = new Set<string>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent?.trim()) continue;
      const el = n.parentElement as HTMLElement | null;
      if (!el || ex.some((s) => el.closest(s))) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
      if (el.closest('[aria-hidden="true"]') || el.closest('[inert]')) continue;
      const px = parseFloat(cs.fontSize);
      const label = `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} "${n.textContent.trim().slice(0, 20)}" ${px}px`;
      if (px < (lim as number)) under.add(label);
      if (px < min) {
        min = px;
        where = label;
      }
    }
    return { px: min === Infinity ? 0 : min, where, under: [...under].slice(0, 40) };
  }, [exclude, below] as const);
}

/** 화면 글자에 그림 문자(이모지)가 있는가 */
async function emojis(p: Page): Promise<string[]> {
  const text = await bodyText(p);
  return [...new Set(text.match(/\p{Extended_Pictographic}/gu) ?? [])];
}

/** 보이는 버튼 가운데 48px보다 작은 것(가로·세로 중 작은 쪽) */
async function smallTargets(p: Page, exclude: string[] = []): Promise<string[]> {
  return p.evaluate((ex) => {
    const out: string[] = [];
    document.querySelectorAll('button, [role="button"], a[href], select, input:not([type="hidden"])').forEach((node) => {
      const el = node as HTMLElement;
      if (ex.some((s) => el.closest(s))) return;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > innerHeight) return;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') return;
      if (el.closest('[inert]') || el.closest('[aria-hidden="true"]')) return;
      if (Math.min(r.width, r.height) < 47.5) out.push(`${el.getAttribute('data-testid') ?? el.tagName.toLowerCase()}(${Math.round(r.width)}×${Math.round(r.height)}) "${(el.textContent ?? el.getAttribute('aria-label') ?? '').trim().slice(0, 16)}"`);
    });
    return out;
  }, exclude);
}

interface ScreenReport {
  file: string;
  minFont: { px: number; where: string; under: string[] };
  emojis: string[];
  smallTargets?: string[];
}

// ───────────────────────── D. 하위 경로 배포 확인 ─────────────────────────

test('D. /voyage/ 하위 경로: 4개 라우트·이미지·글꼴, config.json 없음/있음 → 중계 주소, 콘솔 오류 0', async ({ browser }) => {
  test.setTimeout(300_000);
  const rd = await startRelayProcess();
  const wd = await startStatic({ relayPort: rd.port });
  const env: Env = { browser, base: wd.base, clock: new FastClock(), errors: [], contexts: [] };
  const report: Record<string, unknown> = {};
  try {
    for (const mode of ['none', 'config'] as const) {
      // config.json이 있으면 그 relayUrl(같은 출처의 다른 경로 /relay2/ws — 다른 출처는 /notice·/health CORS가 없어 '기획 확인 필요')
      wd.setConfig(mode === 'config' ? { relayUrl: `ws://127.0.0.1:${wd.port}/relay2/ws` } : null);
      const ctx = await newContext(env);
      const sockets: string[] = [];
      const bad: string[] = [];
      ctx.on('response', (r) => {
        const path = new URL(r.url()).pathname;
        if (r.status() >= 400 && !(r.status() === 404 && path.endsWith('/config.json'))) bad.push(`${r.status()} ${path}`);
      });
      for (const route of ['#/', '#/teacher', '#/play', '#/screen']) {
        const p = await ctx.newPage();
        p.on('websocket', (ws) => sockets.push(`${route} ${ws.url()}`));
        watchErrors(p, `${mode} ${route}`, env.errors);
        await p.goto(`./${route}`);
        await p.waitForLoadState('networkidle');
        await expect(p.locator('[data-testid^="route-"]').first()).toBeVisible();
        // 글꼴(동봉) 로드
        const fonts = await p.evaluate(async () => {
          await document.fonts.ready;
          return [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/"/g, ''));
        });
        expect(fonts.join(','), `${route} 글꼴`).toMatch(/Gowun Dodum/);
        // 그림이 모두 열림
        const broken = await p.evaluate(() => [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src));
        expect(broken, `${route} 깨진 그림`).toEqual([]);
        if (route === '#/teacher') {
          // 교사 시작 화면은 중계 서버에 연결해 본다(사용 중인 방)
          await expect(p.getByTestId('room-count-text')).toHaveText('사용 중인 방 0/50');
        }
        if (route === '#/play') {
          await p.getByTestId('entry-code').fill('123456');
          await p.getByTestId('entry-seat').selectOption('1');
          await p.getByTestId('entry-name').fill('점검무역');
          await p.getByTestId('entry-submit').click();
          await expect(p.getByTestId('entry-error')).toBeVisible({ timeout: 15_000 }); // 그런 방이 없어요(중계 서버까지 감)
        }
        await shot(p, `D-${mode}-${route.replace(/[#/]/g, '') || 'title'}-1366.png`);
      }
      const want = mode === 'config' ? `ws://127.0.0.1:${wd.port}/relay2/ws` : `${wd.base.replace('http:', 'ws:')}ws`;
      expect(sockets.length).toBeGreaterThan(0);
      for (const s of sockets) expect(s.split(' ')[1], s).toBe(want);
      expect(bad).toEqual([]);
      report[mode] = { sockets: [...new Set(sockets.map((s) => s.split(' ')[1]))] };
      await ctx.close();
    }
  } finally {
    await closeEnv(env);
    await wd.close();
    await rd.stop();
  }
  writeFileSync(join(ROOT, 'tmp', '114-e2e-D.json'), JSON.stringify(report, null, 2));
  expect(JSON.stringify(env.errors.filter((e) => !/123456|NO_ROOM/.test(e)), null, 1)).toBe('[]');
});

// ───────────────────────── E. 30명(브라우저 3 + 헤드리스 봇 27) — 실제 중계 서버 ─────────────────────────

test('E. 30명 판(브라우저 학생 3 + 봇 27) L1 30분: 오류 0·라운드 일치·비노출, 화면 6종 가독성, 30척 프레임, 첫 로드 그림 양', async ({ browser }) => {
  test.setTimeout(900_000);
  const re = await startRelayProcess();
  const we = await startStatic({ relayPort: re.port });
  const env: Env = { browser, base: we.base, clock: new FastClock(), errors: [], contexts: [] };
  const reports: ScreenReport[] = [];
  const out: Record<string, unknown> = {};
  try {
    const { t, code } = await openTeacher(env, { minutes: 30, label: 'teacherE' });
    const scr = await openScreen(t);
    // 학생 브라우저 3(1366×768, 1180×820, 1366×768) — 첫 로드 그림 양 측정
    const imgBytes = new Map<string, number>();
    const b1 = await openStudent(env, 'e1');
    const b2 = await openStudent(env, 'e2', { width: 1180, height: 820 });
    const b3 = await openStudent(env, 'e3');
    const imgs = (p: Page, key: string) =>
      p.on('response', async (r) => {
        if (r.request().resourceType() !== 'image') return;
        const len = Number(r.headers()['content-length'] ?? 0) || (await r.body().catch(() => Buffer.alloc(0))).length;
        imgBytes.set(key, (imgBytes.get(key) ?? 0) + len);
      });
    // 첫 로드(캐시 없음): 타이틀, 학생 입장 화면
    for (const [key, hash] of [['title', '#/'], ['entry', '#/play']] as const) {
      const fresh = await newContext(env);
      const p = await fresh.newPage();
      imgs(p, key);
      await p.goto(`./${hash}`);
      await p.waitForLoadState('networkidle');
      await p.waitForTimeout(500);
      await fresh.close();
    }
    out.titleImageBytes = imgBytes.get('title') ?? 0;
    out.entryImageBytes = imgBytes.get('entry') ?? 0;
    imgs(b1, 'game');
    const names = ['해오름무역', '바다상회', '늦은배무역'];
    for (const [i, b] of [b1, b2, b3].entries()) {
      await enter(b, code, i + 1, names[i]!);
      await found(b);
    }
    // 봇 27명(4~30번)
    const botsCtx = await newContext(env);
    const bots = await openBots(botsCtx, we);
    watchErrors(bots, 'bots', env.errors);
    const seats = Array.from({ length: 27 }, (_, k) => ({ seat: k + 4, name: COMPANY_NAMES[k + 3]! }));
    await bots.evaluate(([c, s]) => window.__bots!.start(c as string, s as { seat: number; name: string }[], 114), [code, seats] as const);
    const botStatus = () => bots.evaluate(() => window.__bots!.status());
    await expect
      .poll(async () => (await botStatus()).filter((x) => x.status === 'in' && x.founded).length, { timeout: 90_000 })
      .toBe(27)
      .catch(async (e) => {
        console.log(JSON.stringify((await botStatus()).slice(0, 3)));
        console.log(re.logs.slice(-8).join(' | '));
        console.log('ERR', JSON.stringify(env.errors.slice(0, 8)));
        console.log(await bots.evaluate(async () => {
          const u = new URL('./ws', location.href);
          u.protocol = 'ws:';
          return new Promise<string>((res) => {
            const ws = new WebSocket(u.href);
            ws.onopen = () => res(`open ${u.href}`);
            ws.onerror = () => res(`error ${u.href}`);
            setTimeout(() => res(`timeout ${u.href} rs=${ws.readyState}`), 5000);
          });
        }));
        throw e;
      });
    await expect(t.getByTestId('student-row')).toHaveCount(30);
    await expect(scr.getByTestId('screen-joined')).toHaveText('들어온 회사 30개', { timeout: 40_000 });
    await shot(t, 'E01-teacher-prep-30-1366.png');

    await t.getByTestId('btn-start-trade').click();
    await t.getByTestId('confirm-ok').click();
    await env.clock.fastForwardUntil(async () => (await b1.locator('[data-testid="event-panel"][data-event="L1-E6"]').count()) > 0, { label: 'E round 1', speed: 15 });
    out.gameImageBytesUntilRound1 = imgBytes.get('game') ?? 0;
    // 공용 화면을 해도로 → 30척 프레임 측정(실제 시간 3초, 빠른 시계 1배)
    await openTvMenu(t); // (작업 137) [TV 화면 ▾]
    await t.getByTestId('scene-select').selectOption('map');
    await t.keyboard.press('Escape'); // 메뉴 닫기(스크린숏에 펼친 메뉴가 남지 않게)
    await expect.poll(() => SCENE(scr)).toBe('map');
    await expect(scr.locator('.wm-ship, [data-pid]').first()).toBeVisible();
    const frames = async (p: Page) =>
      p.evaluate(
        () =>
          new Promise<{ fps: number; p95: number; n: number }>((res) => {
            const ts: number[] = [];
            const t0 = performance.now();
            const step = (x: number) => {
              ts.push(x);
              if (x - t0 < 3000) requestAnimationFrame(step);
              else {
                const d = ts.slice(1).map((v, i) => v - ts[i]!).sort((a, b) => a - b);
                res({ fps: Math.round((1000 * d.length) / (ts[ts.length - 1]! - ts[0]!)), p95: Math.round(d[Math.floor(d.length * 0.95)] ?? 0), n: d.length });
              }
            };
            requestAnimationFrame(step);
          }),
      );
    out.screenShips = await scr.locator('.wm-ship').count();
    out.screenFrames = await frames(scr);
    out.studentShips = await b1.locator('.wm-ship').count();
    out.studentFrames = await frames(b1);

    // ── 화면 6종(라운드 1): 학생 1366·1180, 교사 1366·1920, 공용 1920·1280 ──
    await dismissLight(b1);
    const check = async (p: Page, file: string, o: { min: number; exclude?: string[]; touch?: boolean }) => {
      await shot(p, file);
      const r: ScreenReport = { file, minFont: await minFont(p, o.exclude, o.min), emojis: await emojis(p) };
      if (o.touch) r.smallTargets = await smallTargets(p, o.exclude);
      reports.push(r);
      return r;
    };
    const stu1 = await check(b1, 'S1-student-1366x768.png', { min: 18, touch: true });
    const stu2 = await check(b2, 'S2-student-1180x820.png', { min: 18, touch: true });
    const te1 = await check(t, 'T1-teacher-1366x768.png', { min: 0 });
    await t.setViewportSize({ width: 1920, height: 1080 });
    const te2 = await check(t, 'T2-teacher-1920x1080.png', { min: 0 });
    await t.setViewportSize({ width: 1366, height: 768 });
    const scrEx = ['.scr-fs', '.world-map', '.t-present__back'];
    const sc1 = await check(scr, 'P1-screen-1920x1080.png', { min: 32, exclude: scrEx });
    await scr.setViewportSize({ width: 1280, height: 720 });
    const sc2 = await check(scr, 'P2-screen-1280x720.png', { min: 21.3, exclude: scrEx });
    await scr.setViewportSize({ width: 1920, height: 1080 });
    for (const r of [stu1, stu2, te1, te2, sc1, sc2]) expect(r.emojis, `${r.file} 이모지`).toEqual([]);
    // 학생 화면 본문 18px 이상(PRD 8.1). 꼬리표·쪽수·접기 단추·배 크기 표지 같은 보조 표지(16px)는 본문이 아니라 뺀다(가정 — result.md)
    const LABELS = /st-ship-chip|wm-fleet-more|link-small|vc__band|vc__kind|vc__quote-tag|ev-tut__kicker/;
    for (const r of [stu1, stu2]) expect(r.minFont.under.filter((u) => !LABELS.test(u)), `${r.file} 18px 미만 본문`).toEqual([]);
    for (const r of [stu1, stu2]) expect(r.minFont.px).toBeGreaterThanOrEqual(16);
    // 공용 화면은 화면 크기에 맞춰 늘고 줄어든다(같은 TV에서 같은 물리 크기). 32px 기준은 1920×1080 기준값이라 1280×720은 ×1.5로 본다(가정)
    expect(sc1.minFont.px, `${sc1.file} 가장 작은 글자 ${sc1.minFont.where}`).toBeGreaterThanOrEqual(32);
    expect(sc2.minFont.px * (1080 / 720), `${sc2.file} 가장 작은 글자(1080p 환산) ${sc2.minFont.where}`).toBeGreaterThanOrEqual(32);
    // 비노출: 학생·공용 화면에 다른 학생 출석번호·"사용 중인 방"·이용 안내 없음
    for (const p of [b1, b2, b3, scr]) {
      const text = await bodyText(p);
      expect(text).not.toContain('사용 중인 방');
      expect(text).not.toContain('개인적으로 운영하는 무료 서버');
      expect(await p.locator('[data-seat]').count()).toBe(0);
    }

    // ── 끝까지(빠른 시계) ──
    await openTvMenu(t);
    await t.getByTestId('scene-select').selectOption('auto');
    await t.keyboard.press('Escape');
    // (작업 162) 판은 저절로 끝나지 않는다 — 순서를 다 하면 교사 카드의 [마무리로]
    await env.clock.fastForwardUntil(async () => (await t.getByTestId('now-finish').count()) > 0, { label: 'E plan done', speed: 15, maxFastMs: 45 * 60_000 });
    await env.clock.setSpeed(1);
    await t.getByTestId('now-finish').click();
    await env.clock.fastForwardUntil(async () => (await b1.getByTestId('trade-over').count()) > 0, { label: 'E trade over', speed: 15, maxFastMs: 5 * 60_000 });
    await env.clock.setSpeed(1);
    await t.waitForTimeout(3000);
    const st = await botStatus();
    out.bots = { in: st.filter((x) => x.status === 'in').length, acts: st.reduce((a, x) => a + x.acts, 0), rounds: [...new Set(st.map((x) => x.resolvedRound))] };
    expect(st.filter((x) => x.status !== 'in')).toEqual([]);
    expect(st.filter((x) => x.seatLeak)).toEqual([]);
    expect(st.flatMap((x) => x.errors)).toEqual([]);
    expect(new Set(st.map((x) => x.resolvedRound)).size).toBe(1);
    const round = st[0]!.resolvedRound;
    expect(round).toBeGreaterThanOrEqual(3);
    await expect(t.getByTestId('student-row')).toHaveCount(30);
    await expect(t.getByTestId('wrapup-panel')).toBeVisible();
    out.health = { teacher: we.hits.get('/voyage/health') ?? 0 };
    out.relayLog = re.logs.filter((l) => !/"stats"/.test(l)).slice(-5);
    const logs = re.logs.join('\n');
    for (const n of [...names, ...seats.map((s) => s.name), code]) expect(logs).not.toContain(n);
    await bots.evaluate(() => window.__bots!.stop());
  } finally {
    writeFileSync(join(ROOT, 'tmp', '114-e2e-E.json'), JSON.stringify({ ...out, reports }, null, 2));
    await closeEnv(env);
    await we.close();
    await re.stop();
  }
  expect(env.errors).toEqual([]);
});
