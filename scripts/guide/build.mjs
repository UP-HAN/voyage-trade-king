// 작업 141 — 공략집 만들기: `npm run guide:build [-- 옵션]`
//
//   1) 빌드(npm run build + build:server)            --no-build 로 건너뜀(이미 최신일 때)
//   2) 실제 한 판을 돌리며 촬영(scripts/guide/capture.ts) --no-capture 로 건너뜀(tmp/guide/shots.json 다시 씀)
//   3) 빨간 상자·번호 그리기(scripts/guide/annotate.mjs) → print/guide/build/shots/*.jpg
//   4) 내용(print/guide/content.mjs) + 화면 이름 → HTML(print/guide/build/{teacher,student}.html)
//      검사: 쓰인 화면·표시가 촬영 기록에 있는지, 화면의 빨간 상자가 모두 설명됐는지(누락 0), 쪽 넘침·잘림
//   5) PDF(크로미움) → 임시 폴더 → 검사 통과 때만 print/dist/대항해무역왕_공략집_{선생님,학생}.pdf 교체(실패하면 기존 PDF 그대로)
//   6) 미리보기 PNG(.orch/tasks/141-play-guide/shots/, 폴더가 있을 때) + 다시 빌드(dist/print/guide-*.pdf, 시작 화면 [공략집] 링크)
//
// 주의: 이 폴더 경로(한글·공백)에서 fs.rmSync/cpSync는 쓰지 않는다(프로젝트 CLAUDE.md). 포트 8765는 쓰지 않는다.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { annotate, zoomCrop } from './annotate.mjs';
import { renderBook } from './render.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const shotsDir = process.env.GUIDE_OUT ?? path.join(root, 'tmp', 'guide');
const guideDir = path.join(root, 'print', 'guide');
const buildDir = path.join(guideDir, 'build');
const imgOut = path.join(buildDir, 'shots');
const dist = path.join(root, 'print', 'dist');
const tmp = path.join(root, 'print', '.guide-tmp');
const taskShots = path.join(root, '.orch', 'tasks', '141-play-guide', 'shots');
const OUT = { teacher: '대항해무역왕_공략집_선생님.pdf', student: '대항해무역왕_공략집_학생.pdf' };

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const run = (cmd, args, env = {}) => spawnSync([cmd, ...args].join(' '), { cwd: root, stdio: 'inherit', env: { ...process.env, ...env }, shell: true });
const fail = (m) => {
  console.error(`\n[guide] 실패: ${m}\n[guide] print/dist의 기존 공략집 PDF는 그대로 두었어요.`);
  process.exit(1);
};

async function main() {
  // 1) 빌드
  if (!flag('--no-build')) {
    console.log('[guide] 빌드: npm run build && npm run build:server');
    if (run(npm, ['run', 'build']).status !== 0) fail('npm run build');
    if (run(npm, ['run', 'build:server']).status !== 0) fail('npm run build:server');
  }
  // 2) 촬영
  if (!flag('--no-capture')) {
    console.log(`[guide] 촬영: 실제 한 판(차시 L1 10분) → ${path.relative(root, shotsDir)}`);
    const r = run(npx, ['playwright', 'test', '-c', 'scripts/guide/playwright.config.ts', 'capture'], { GUIDE_OUT: shotsDir });
    if (r.status !== 0) fail('촬영(scripts/guide/capture.ts)');
  }
  const rec = JSON.parse(fs.readFileSync(path.join(shotsDir, 'shots.json'), 'utf8'));
  const warnings = fs.existsSync(path.join(shotsDir, 'warnings.json')) ? JSON.parse(fs.readFileSync(path.join(shotsDir, 'warnings.json'), 'utf8')) : { warnings: [] };

  // 3) 상자 그리기
  fs.mkdirSync(imgOut, { recursive: true });
  for (const f of fs.readdirSync(imgOut)) await fs.promises.rm(path.join(imgOut, f), { force: true });
  const shots = new Map();
  const drawn = [];
  for (const s of rec.shots) {
    const out = `${s.id}.jpg`;
    const boxes = await annotate(path.join(shotsDir, s.file), path.join(imgOut, out), s);
    const z = await zoomCrop(path.join(imgOut, out), path.join(imgOut, `${s.id}-zoom.jpg`), s, boxes, { dispH: 42 });
    shots.set(s.id, { ...s, out, zoom: z ? `${s.id}-zoom.jpg` : null, zoomFactor: z ? Math.round(z.zoom * 10) / 10 : null });
    drawn.push({ id: s.id, boxes: boxes.map((b) => ({ n: b.n, kind: b.kind, label: b.text ?? b.label.split('\n')[0], el: [b.x, b.y, b.w, b.h].map((v) => Math.round(v * 10) / 10), box: [b.bx, b.by, b.bw, b.bh].map((v) => Math.round(v * 10) / 10) })) });
  }
  fs.writeFileSync(path.join(buildDir, 'marks.json'), JSON.stringify(drawn, null, 2));

  // 4) HTML
  const content = await import(pathToFileURL(path.join(guideDir, 'content.mjs')).href + `?t=${Date.now()}`);
  const books = { teacher: content.TEACHER, student: content.STUDENT };
  const report = [];
  let bad = false;
  const htmlFiles = {};
  const usedShots = new Set();
  for (const [key, b] of Object.entries(books)) {
    let r;
    try {
      r = renderBook(b, shots, { imgDir: 'shots', css: '../guide.css', shipImg: '../../worksheet/img/ship.png' });
    } catch (e) {
      fail(`${key}: ${e.message}`);
    }
    for (const sec of b.sections) for (const st of sec.steps) [st.shot, ...(st.sub ?? [])].forEach((x) => usedShots.add(x));
    const f = path.join(buildDir, `${key}.html`);
    fs.writeFileSync(f, r.html);
    htmlFiles[key] = f;
    report.push(`${r.missing.length ? 'FAIL' : 'OK  '} ${key}: ${r.pages}쪽, 표시(빨간 상자·파란 점선) 설명 누락 ${r.missing.length}`);
    for (const m of r.missing) report.push(`     ${m}`);
    if (r.missing.length) bad = true;
  }
  const unused = rec.shots.map((s) => s.id).filter((id) => !usedShots.has(id));
  report.push(`참고: 찍었지만 공략집에 안 쓴 화면 ${unused.length}개${unused.length ? ` (${unused.join(', ')})` : ''}`);

  // 5) PDF + 쪽 검사
  fs.mkdirSync(tmp, { recursive: true });
  const browser = await chromium.launch();
  const previews = {};
  for (const [key, f] of Object.entries(htmlFiles)) {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(pathToFileURL(f).href);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 30_000 }).catch(() => undefined);
    await page.emulateMedia({ media: 'print' });
    const problems = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('.page').forEach((pg, i) => {
        const name = `${i + 1}쪽(${pg.dataset.step || pg.querySelector('h2,h1')?.textContent?.slice(0, 20) || ''})`;
        const pr = pg.getBoundingClientRect();
        const foot = pg.querySelector('.foot')?.getBoundingClientRect();
        const limit = foot ? foot.top : pr.bottom;
        pg.querySelectorAll('img').forEach((im) => { if (!im.complete || !im.naturalWidth) out.push(`${name}: 그림을 못 읽음 ${im.getAttribute('src')}`); });
        pg.querySelectorAll('.head, .lead, .body, .body *, .toc *, .prose *, .cover > *').forEach((e) => {
          if (e.closest('.foot')) return;
          const r = e.getBoundingClientRect();
          if (!r.height || !r.width) return;
          if (r.bottom > limit + 0.5 && !e.classList.contains('ship')) out.push(`${name}: ${e.tagName}.${e.className} 아래로 ${(r.bottom - limit).toFixed(1)}px 넘침`);
          if (r.right > pr.right - 1) out.push(`${name}: ${e.tagName}.${e.className} 오른쪽으로 넘침`);
        });
        // 설명 칸 글자가 칸 밖으로(가로 넘침) 나가는지
        pg.querySelectorAll('.text, .tip, .note').forEach((e) => { if (e.scrollWidth > e.clientWidth + 1) out.push(`${name}: ${e.className} 가로 넘침`); });
      });
      return [...new Set(out)];
    });
    for (const p of problems) report.push(`FAIL 쪽 검사 ${key} ${p}`);
    if (problems.length) bad = true;
    await page.pdf({ path: path.join(tmp, OUT[key]), preferCSSPageSize: true, printBackground: true });
    // 미리보기(화면 매체)
    previews[key] = [];
    if (fs.existsSync(path.dirname(taskShots))) {
      fs.mkdirSync(taskShots, { recursive: true });
      await page.emulateMedia({ media: 'screen' });
      const els = await page.locator('.page').all();
      for (let i = 0; i < els.length; i++) {
        const out = path.join(taskShots, `${key}-${String(i + 1).padStart(2, '0')}.png`);
        fs.writeFileSync(out, await els[i].screenshot());
        previews[key].push(out);
      }
    }
    await ctx.close();
  }
  await browser.close();

  for (const [key, f] of Object.entries(OUT)) {
    const buf = fs.readFileSync(path.join(tmp, f));
    const pages = (buf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) || []).length;
    report.push(`OK   ${f}: ${pages}쪽, ${(buf.length / 1e6).toFixed(2)} MB`);
  }
  report.push(`촬영 주소: ${warnings.host ?? '?'}${warnings.pretty ? '' : ' (80번 포트를 못 써서 화면 주소가 실제와 다름)'}`);
  for (const w of warnings.warnings ?? []) report.push(`주의(촬영): ${w}`);
  console.log(report.join('\n'));
  fs.writeFileSync(path.join(buildDir, 'report.txt'), report.join('\n'));
  if (bad) fail('검사 실패(위 FAIL 줄). 결과물은 print/.guide-tmp 와 print/guide/build 에 있어요');

  fs.mkdirSync(dist, { recursive: true });
  for (const f of Object.values(OUT)) fs.copyFileSync(path.join(tmp, f), path.join(dist, f));
  await fs.promises.rm(tmp, { recursive: true, force: true });
  console.log(`[guide] 출력: ${Object.values(OUT).map((f) => path.join('print', 'dist', f)).join(', ')}`);

  // 6) 다시 빌드(공략집을 dist/print 에 넣고 시작 화면 링크 목록 갱신)
  if (!flag('--no-build')) {
    if (run(npm, ['run', 'build']).status !== 0) fail('마지막 npm run build');
  }
}

main().catch((e) => fail(e.stack || String(e)));
