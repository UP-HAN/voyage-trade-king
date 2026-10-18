/**
 * 작업 135 리허설 — Playwright 진입점. `npm run rehearsal`(scripts/rehearsal.mjs)이 환경 변수로 시나리오·대상·속도를 넘긴다.
 * 탐지한 문제로는 시험이 실패하지 않는다(보고서에 모은다). 도구 자체가 멈추면 그 시나리오만 '중단'으로 적고 다음으로 간다.
 *
 * REHEARSAL_OUT       보고서 폴더(tmp/rehearsal/<시각>)
 * REHEARSAL_SCENARIOS a,b,c,d,e,f
 * REHEARSAL_TARGET    비우면 로컬(빌드본 /voyage/ + 로컬 중계 서버), 주소면 운영 점검(방 1개·시나리오 a만)
 * REHEARSAL_SPEED     빨리 감기 배속(기본 8, 1이면 실제 시간)
 * REHEARSAL_BREAKS    고장 플래그(쉼표) — 탐지기 확인용
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from '@playwright/test';
import { ROOT } from '../../e2e/support/voyage-servers';
import { writeReport, type ScenarioResult } from './report';
import { runScenario } from './runner';
import { snapshotDir } from './static';
import { BREAKS, SCENARIOS, type BreakId } from './scenarios';

const OUT = process.env.REHEARSAL_OUT ?? join(ROOT, 'tmp', 'rehearsal', `run-${Date.now()}`);
const TARGET = process.env.REHEARSAL_TARGET?.trim() || null;
const SPEED = Math.max(1, Number(process.env.REHEARSAL_SPEED ?? 8) || 8);
const IDS = (process.env.REHEARSAL_SCENARIOS ?? 'a,b,c,d,e,f').split(',').map((s) => s.trim()).filter(Boolean);
const BRK = (process.env.REHEARSAL_BREAKS ?? '').split(',').map((s) => s.trim()).filter((s): s is BreakId => s in BREAKS);
const SEED = Number(process.env.REHEARSAL_SEED ?? 135) || 135;

test.describe.configure({ mode: 'serial' });
// 창 여러 개가 동시에 움직이므로 뒤에 있는 창의 타이머를 늦추지 않게 한다(교실에서는 기기마다 앞 창)
test.use({ actionTimeout: 15_000, launchOptions: { args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] } });

const results: ScenarioResult[] = [];
const health = { maxPeers: 0, maxConns: 0, maxMemMB: 0 };
const pids: number[] = [];
const startedAt = new Date().toISOString();
// 로컬: 빌드본을 한 번 복사해 그 사본을 준다(다른 작업이 도중에 dist/를 다시 빌드해도 흔들리지 않게). 끝나면 지운다.
const SITE = TARGET ? undefined : join(OUT, 'site');

test.beforeAll(() => {
  if (!SITE) return;
  const n = snapshotDir(join(ROOT, 'dist'), SITE);
  console.log(`[rehearsal] 빌드본 사본 ${n}개 파일 → ${SITE}`);
});

for (const sc of SCENARIOS.filter((s) => IDS.includes(s.id))) {
  test(`리허설 ${sc.id}. ${sc.title}`, async ({ browser }) => {
    if (TARGET && sc.id !== 'a') test.skip(true, '운영 대상은 시나리오 a(방 1개·짧은 판)만');
    test.setTimeout(((sc.minutes + 15) * 60_000) / SPEED + 12 * 60_000);
    mkdirSync(OUT, { recursive: true });
    const r = await runScenario(browser, sc, { outDir: OUT, target: TARGET, speed: SPEED, breaks: BRK, seed: SEED, health, pids, ...(SITE ? { siteDir: SITE } : {}) });
    results.push(r);
    console.log(`[rehearsal] ${sc.id}: ${r.finished ? '끝까지' : '중단'} · 막힘 ${r.problems.filter((p) => p.severity === '막힘').length} · 문제 ${r.problems.filter((p) => p.severity === '문제' || p.severity === '혼란').length} · ${Math.round(r.realSec)}초`);
  });
}

test.afterAll(async () => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'pids.json'), JSON.stringify(pids));
  writeReport(OUT, { startedAt, target: TARGET ?? 'local', scenarios: IDS, results, health });
  if (SITE) await rm(SITE, { recursive: true, force: true }).catch(() => undefined);
});
