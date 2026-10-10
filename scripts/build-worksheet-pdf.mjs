// 인쇄용 학습지 '항해 일지' PDF 만들기 (작업 136)
//   npm run worksheet:pdf
// 입력: print/worksheet/student.html, teacher.html (+ worksheet.css, common.js)
// 출력: print/dist/대항해무역왕_항해일지_학생용.pdf (6쪽), ..._교사용_예시답.pdf, print/dist/장별/*.pdf
//       미리보기 PNG: .orch/tasks/136-worksheet-pdf/shots/ (폴더가 있을 때)
// 주의: 이 폴더 경로(한글·공백)에서 fs.rmSync/cpSync는 쓰지 않는다(프로젝트 CLAUDE.md).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'print', 'worksheet');
const dist = path.join(root, 'print', 'dist');
const perSheet = path.join(dist, '장별');
const taskDir = path.join(root, '.orch', 'tasks', '136-worksheet-pdf');
const shots = path.join(taskDir, 'shots');
const imgDir = path.join(src, 'img');

const STUDENT_SHEETS = ['L1', 'L2', 'L3', 'L4-1', 'L4-2', '선택활동'];
const OUT_STUDENT = '대항해무역왕_항해일지_학생용.pdf';
const OUT_TEACHER = '대항해무역왕_항해일지_교사용_예시답.pdf';

for (const d of [dist, perSheet, imgDir]) fs.mkdirSync(d, { recursive: true });
const makeShots = fs.existsSync(taskDir);
if (makeShots) fs.mkdirSync(shots, { recursive: true });

// 1) 게임 그림을 작게 복사(원본 assets/ 는 읽기만)
async function prepareImages() {
  const a = (p) => path.join(root, 'assets', 'images', p);
  // 안내 항해사 한바다: 얼굴 부분만 동그랗게
  const face = await sharp(a('characters/guide-hanbada.png'))
    .extract({ left: 240, top: 58, width: 170, height: 170 })
    .resize(240, 240)
    .png()
    .toBuffer();
  fs.writeFileSync(path.join(imgDir, 'hanbada.png'), face);
  fs.writeFileSync(path.join(imgDir, 'ship.png'), await sharp(a('ships/ship-small.png')).resize(160).png().toBuffer());
  fs.writeFileSync(path.join(imgDir, 'seagull.png'), await sharp(a('letters/seagull-fly.png')).resize(160).png().toBuffer());
}

// PDF 쪽 수·크기 검사 (Chromium PDF는 페이지 객체가 압축되지 않는다)
function inspectPdf(file) {
  const s = fs.readFileSync(file).toString('latin1');
  const pages = (s.match(/\/Type\s*\/Page(?![s\w])/g) || []).length;
  const boxes = [...s.matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)].map((m) => [Number(m[1]), Number(m[2])]);
  const fonts = [...new Set([...s.matchAll(/\/(?:BaseFont|FontName)\s*\/([A-Za-z0-9+_-]+)/g)].map((m) => m[1].replace(/^[A-Z]{6}\+/, '')))];
  return { pages, boxes, fonts };
}

async function checkPage(page, label) {
  // 각 쪽의 .body(또는 반쪽)에 넘침이 없는지
  return page.evaluate((label) => {
    const out = [];
    document.querySelectorAll('.page').forEach((pg, i) => {
      const name = pg.dataset.sheet || `${label}-${i + 1}`;
      if (pg.scrollHeight > pg.clientHeight + 1) out.push(`${name}: 쪽 넘침 ${pg.scrollHeight - pg.clientHeight}px`);
      pg.querySelectorAll('.body').forEach((b, j) => {
        // scrollHeight는 소수점 반올림으로 1~2px 흔들려서, 실제 요소 경계도 함께 본다
        if (b.scrollHeight > b.clientHeight + 2) out.push(`${name}#${j + 1}: 본문 넘침 ${b.scrollHeight - b.clientHeight}px`);
        const bottom = b.getBoundingClientRect().bottom;
        const right = b.getBoundingClientRect().right;
        b.querySelectorAll('*').forEach((e) => {
          const r = e.getBoundingClientRect();
          if (r.height && r.bottom > bottom + 0.5) out.push(`${name}#${j + 1}: ${e.tagName}.${e.className} 아래로 ${(r.bottom - bottom).toFixed(1)}px 잘림`);
          if (r.width && r.right > right + 0.5) out.push(`${name}#${j + 1}: ${e.tagName}.${e.className} 오른쪽으로 ${(r.right - right).toFixed(1)}px 잘림`);
        });
      });
    });
    return out;
  }, label);
}

async function render(browser, htmlFile, { pdfOut, sheets, shotPrefix }) {
  const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 900, height: 1200 } });
  const page = await ctx.newPage();
  await page.goto(pathToFileURL(path.join(src, htmlFile)).href);
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
  await page.evaluate(() => document.fonts.ready);

  // 넘침 검사는 인쇄 모드에서
  await page.emulateMedia({ media: 'print' });
  const problems = await checkPage(page, htmlFile);
  const count = await page.locator('.page').count();

  await page.pdf({ path: pdfOut, preferCSSPageSize: true, printBackground: true });
  const per = [];
  if (sheets) {
    for (let i = 0; i < sheets.length; i++) {
      const f = path.join(perSheet, `${sheets[i]}.pdf`);
      await page.pdf({ path: f, preferCSSPageSize: true, printBackground: true, pageRanges: String(i + 1) });
      per.push(f);
    }
  }

  // 미리보기 PNG (화면 모드: 쪽마다 A4 크기 = 15mm 여백 포함)
  const pngs = [];
  if (makeShots) {
    await page.emulateMedia({ media: 'screen' });
    await page.evaluate(() => document.body.classList.add('shot'));
    const els = await page.locator('.page').all();
    for (let i = 0; i < els.length; i++) {
      const name = sheets ? sheets[i] : String(i + 1);
      const f = path.join(shots, `${shotPrefix}-${String(i + 1).padStart(2, '0')}-${name}.png`);
      fs.writeFileSync(f, await els[i].screenshot());
      pngs.push(f);
    }
  }
  await ctx.close();
  return { problems, count, per, pngs };
}

async function main() {
  await prepareImages();
  const browser = await chromium.launch();
  const stu = await render(browser, 'student.html', {
    pdfOut: path.join(dist, OUT_STUDENT),
    sheets: STUDENT_SHEETS,
    shotPrefix: 'student',
  });
  const tea = await render(browser, 'teacher.html', {
    pdfOut: path.join(dist, OUT_TEACHER),
    shotPrefix: 'teacher',
  });
  await browser.close();

  // 흑백 미리보기·참고 그림 비교
  if (makeShots && stu.pngs.length) {
    for (const i of [0, 3]) {
      const f = stu.pngs[i];
      await sharp(f).grayscale().toFile(f.replace(/\.png$/, '-gray.png').replace(/student-/, 'gray-student-'));
    }
    const ref = path.join(taskDir, 'ref', 'old-p01.png');
    if (fs.existsSync(ref)) {
      const H = 1300;
      const a = await sharp(ref).resize({ height: H }).png().toBuffer();
      const b = await sharp(stu.pngs[0]).resize({ height: H }).png().toBuffer();
      const wa = (await sharp(a).metadata()).width;
      const wb = (await sharp(b).metadata()).width;
      await sharp({ create: { width: wa + wb + 60, height: H + 40, channels: 3, background: '#cfd6dd' } })
        .composite([{ input: a, left: 20, top: 20 }, { input: b, left: wa + 40, top: 20 }])
        .png()
        .toFile(path.join(shots, 'compare-ref-old-vs-new-L1.png'));
    }
  }

  // 검사 결과
  const report = [];
  let failed = false;
  const check = (label, file, expectPages) => {
    const r = inspectPdf(file);
    const a4 = r.boxes.every(([w, h]) => Math.abs(w - 595.92) < 1.5 && Math.abs(h - 842.88) < 1.5);
    const ok = (expectPages == null || r.pages === expectPages) && a4 && r.boxes.length === r.pages;
    if (!ok) failed = true;
    report.push(`${ok ? 'OK  ' : 'FAIL'} ${label}: ${r.pages}쪽${expectPages != null ? `(기대 ${expectPages})` : ''}, A4=${a4}`);
    return r;
  };
  const s = check(OUT_STUDENT, path.join(dist, OUT_STUDENT), STUDENT_SHEETS.length);
  stu.per.forEach((f) => check(`장별/${path.basename(f)}`, f, 1));
  check(OUT_TEACHER, path.join(dist, OUT_TEACHER), tea.count);
  if (stu.count !== STUDENT_SHEETS.length) { failed = true; report.push(`FAIL 학생용 .page 수 ${stu.count}`); }
  for (const p of [...stu.problems, ...tea.problems]) { failed = true; report.push(`FAIL 넘침 ${p}`); }
  if (!s.fonts.some((f) => /Noto-?Sans-?KR/i.test(f))) report.push(`주의: Noto Sans KR이 없어 대체 글꼴로 만들었어요 (${s.fonts.join(', ')})`);
  report.push(`글꼴: ${s.fonts.join(', ')}`);
  console.log(report.join('\n'));
  console.log(`출력: ${path.relative(root, dist)}`);
  if (failed) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
