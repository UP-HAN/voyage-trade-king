// 작업 135 — 가상 학생 25명 리허설: `npm run rehearsal [-- 옵션]`
//
//   npm run rehearsal                         로컬에서 시나리오 a~e(빌드 → /voyage/ 정적 서버 + 로컬 중계 서버)
//   npm run rehearsal -- --scenario a         시나리오 하나(쉼표로 여러 개: --scenario a,e)
//   npm run rehearsal -- --target https://lab.ches.es.kr/voyage/ --scenario a
//                                             운영 서버 점검(방 1개·시나리오 a만·끝나면 방 닫기). 교사 승인 범위에서만 쓴다.
//   --speed 8        빨리 감기 배속(기본 8)      --realtime   실제 시간(배속 1)
//   --break a,b      고장 플래그(탐지기 확인용, tests/rehearsal/scenarios.ts BREAKS)
//   --no-build       빌드 건너뛰기(이미 dist/·server/dist/가 최신일 때)
//   --strict         막힘이 하나라도 있으면 종료 코드 2
//
// 결과: tmp/rehearsal/<시각>/report.md, summary.json, shots/
// fs.rmSync·fs.cpSync는 쓰지 않는다(이 폴더 경로에서 Node 24가 죽음 — CLAUDE.md).
import { spawnSync, execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(name);
  if (i >= 0) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith(`${name}=`));
  return eq ? eq.slice(name.length + 1) : undefined;
};
const flag = (name) => argv.includes(name);

const ALL = ['a', 'b', 'c', 'd', 'e'];
const scenarios = (opt('--scenario') ?? ALL.join(',')).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const bad = scenarios.filter((s) => !ALL.includes(s));
if (bad.length) {
  console.error(`알 수 없는 시나리오: ${bad.join(', ')} (a~e)`);
  process.exit(2);
}
const target = opt('--target') ?? '';
if (target) {
  if (!/^https?:\/\//.test(target)) {
    console.error('--target 은 http(s):// 주소여야 해요(예: https://lab.ches.es.kr/voyage/)');
    process.exit(2);
  }
  if (scenarios.some((s) => s !== 'a')) {
    console.error('운영 대상(--target)은 시나리오 a(방 1개·짧은 판)만 돌려요: --scenario a');
    process.exit(2);
  }
  console.log(`[rehearsal] 운영 대상 점검: ${target} — 방 1개, 차시 L1 10분(빨리 감기), 끝나면 방을 닫아요. 서버 재시작은 하지 않아요.`);
}
const speed = flag('--realtime') ? 1 : Math.max(1, Number(opt('--speed') ?? 8) || 8);
const breaks = opt('--break') ?? '';
const seed = opt('--seed') ?? '135';

const stamp = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const out = opt('--out') ? resolve(ROOT, opt('--out')) : join(ROOT, 'tmp', 'rehearsal', stamp);
mkdirSync(out, { recursive: true });

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
// 인자는 모두 고정 낱말(공백 없음)이라 한 줄 명령으로 셸에 넘긴다(Windows의 npm.cmd·npx.cmd는 셸이 필요)
const run = (cmd, args, env = {}) => spawnSync([cmd, ...args].join(' '), { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env }, shell: true });

if (!target && !flag('--no-build')) {
  console.log('[rehearsal] 빌드: npm run build && npm run build:server');
  if (run(npm, ['run', 'build']).status !== 0) process.exit(1);
  if (run(npm, ['run', 'build:server']).status !== 0) process.exit(1);
} else if (!target && (!existsSync(join(ROOT, 'dist', 'index.html')) || !existsSync(join(ROOT, 'server', 'dist', 'index.js')))) {
  console.error('dist/ 또는 server/dist/가 없어요 — --no-build 없이 돌리세요.');
  process.exit(1);
}

/** 브라우저(헤드리스) 프로세스 수 — 실행 뒤 정리 확인 */
function browserProcs() {
  try {
    if (process.platform === 'win32') {
      const csv = execFileSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8' });
      const names = csv.split(/\r?\n/).map((l) => (l.split('","')[0] ?? '').replace(/^"/, '').toLowerCase());
      return { 'chrome-headless-shell.exe': names.filter((n) => n === 'chrome-headless-shell.exe').length, 'chrome.exe': names.filter((n) => n === 'chrome.exe').length };
    }
    const ps = execFileSync('ps', ['-A', '-o', 'comm='], { encoding: 'utf8' }).split('\n');
    return { 'chrome-headless-shell': ps.filter((n) => /headless_shell|chrome-headless-shell/.test(n)).length };
  } catch {
    return {};
  }
}
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const before = browserProcs();
const t0 = Date.now();
console.log(`[rehearsal] 시나리오 ${scenarios.join(',')} · 대상 ${target || '로컬'} · 배속 ${speed} · 보고서 ${out}`);
const res = run(npx, ['playwright', 'test', '-c', 'tests/rehearsal/playwright.config.ts'], {
  REHEARSAL_OUT: out,
  REHEARSAL_SCENARIOS: scenarios.join(','),
  REHEARSAL_TARGET: target,
  REHEARSAL_SPEED: String(speed),
  REHEARSAL_BREAKS: breaks,
  REHEARSAL_SEED: seed,
});
// 정리 확인: 중계 서버 자식 프로세스·헤드리스 브라우저
await new Promise((r) => setTimeout(r, 3000));
const after = browserProcs();
let pids = [];
try {
  pids = JSON.parse(readFileSync(join(out, 'pids.json'), 'utf8'));
} catch {
  /* 없음 */
}
const cleanup = {
  relayPids: pids,
  relayAlive: pids.filter(alive),
  browserBefore: before,
  browserAfter: after,
  headlessLeft: Math.max(0, (after['chrome-headless-shell.exe'] ?? after['chrome-headless-shell'] ?? 0) - (before['chrome-headless-shell.exe'] ?? before['chrome-headless-shell'] ?? 0)),
  playwrightExit: res.status,
  minutes: Math.round((Date.now() - t0) / 6000) / 10,
};
const sumPath = join(out, 'summary.json');
if (!existsSync(sumPath)) {
  console.error(`[rehearsal] 보고서를 만들지 못했어요(Playwright 종료 코드 ${res.status}). ${out}`);
  writeFileSync(join(out, 'cleanup.json'), JSON.stringify(cleanup, null, 2));
  process.exit(1);
}
const summary = JSON.parse(readFileSync(sumPath, 'utf8'));
summary.cleanup = cleanup;
writeFileSync(sumPath, JSON.stringify(summary, null, 2));
appendFileSync(join(out, 'report.md'), `\n## 정리 확인(실행 뒤)\n\n- 중계 서버 프로세스: ${pids.length}개 띄움 → 남은 것 ${cleanup.relayAlive.length}개\n- 헤드리스 브라우저: 실행 전 ${JSON.stringify(before)} → 뒤 ${JSON.stringify(after)} (늘어난 것 ${cleanup.headlessLeft})\n- 걸린 시간 ${cleanup.minutes}분\n`);
const first = readFileSync(join(out, 'report.md'), 'utf8').split('\n').find((l) => l.startsWith('**막힘'));
console.log(`\n[rehearsal] ${first ?? ''}`);
console.log(`[rehearsal] 보고서: ${join(out, 'report.md')}`);
console.log(`[rehearsal] 정리: 중계 서버 남은 것 ${cleanup.relayAlive.length}, 헤드리스 브라우저 늘어난 것 ${cleanup.headlessLeft}`);
process.exit(flag('--strict') && summary.blockers > 0 ? 2 : 0);
