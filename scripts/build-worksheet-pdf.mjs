// 인쇄용 학습지 '항해 일지' PDF 만들기 (작업 136 → 139 디자인 시스템 판)
//   npm run worksheet:pdf
// 입력: print/worksheet/student.html, teacher.html (+ design-system.css, worksheet.css, common.js)
// 출력: print/dist/대항해무역왕_항해일지_학생용.pdf (항해 기록 1개 = 1쪽, 20쪽)
//       print/dist/대항해무역왕_항해일지_교사용_예시답.pdf
//       print/dist/장별/{L1,L2,L3,L4-1,L4-2,선택활동}.pdf (그 차시의 쪽 묶음)
//       미리보기 PNG: .orch/tasks/139-worksheet-design-system/shots/ (폴더가 있을 때)
// 검사: 쪽 수·A4·넘침·빈 쪽, 활동 하나가 한 쪽 안에 있는지, CSS 토큰 규칙, 136 최종본과 문구 대조.
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
// 먼저 임시 폴더에 만들고, 모든 검사를 통과했을 때만 print/dist로 복사한다(138이 dist를 가져다 쓰므로)
const tmp = path.join(root, 'print', '.dist-tmp');
const tmpSheet = path.join(tmp, '장별');
const taskDir = path.join(root, '.orch', 'tasks', '139-worksheet-design-system');
const shots = path.join(taskDir, 'shots');
const oldShots = path.join(root, '.orch', 'tasks', '136-worksheet-pdf', 'shots');
const imgDir = path.join(src, 'img');
const refStudent = path.join(src, 'ref', 'student-136.html');

// 장별 PDF: 이름은 136과 같다. 쪽 수 = 그 차시의 항해 기록 수
// label: 장별 PDF 문서 제목 끝(작업 138 수정 1회차 — 장별 PDF 제목이 모두 '학생용'이던 것을 차시 이름으로)
const SHEETS = [
  { name: 'L1', label: '1차시', acts: [1, 2, 3, 4] },
  { name: 'L2', label: '2차시', acts: [5, 6, 7, 8] },
  { name: 'L3', label: '3차시', acts: [9, 10, 11, 12] },
  { name: 'L4-1', label: '4차시 ①', acts: [13, 14, 15, 16, 18] },
  { name: 'L4-2', label: '4차시 ②', acts: [17] },
  { name: '선택활동', label: '선택 활동', acts: [19, 20] },
];
const SHEET_TITLE = (label) => `대항해 무역왕 항해 일지 — ${label}`;
const ORDER = SHEETS.flatMap((s) => s.acts);
const OUT_STUDENT = '대항해무역왕_항해일지_학생용.pdf';
const OUT_TEACHER = '대항해무역왕_항해일지_교사용_예시답.pdf';

for (const d of [dist, perSheet, tmp, tmpSheet, imgDir]) fs.mkdirSync(d, { recursive: true });
const makeShots = fs.existsSync(taskDir);
if (makeShots) fs.mkdirSync(shots, { recursive: true });

// 1) 게임 그림을 작게 복사(원본 assets/ 는 읽기만)
async function prepareImages() {
  const a = (p) => path.join(root, 'assets', 'images', p);
  const face = await sharp(a('characters/guide-hanbada.png'))
    .extract({ left: 240, top: 58, width: 170, height: 170 })
    .resize(240, 240)
    .png()
    .toBuffer();
  fs.writeFileSync(path.join(imgDir, 'hanbada.png'), face);
  fs.writeFileSync(path.join(imgDir, 'ship.png'), await sharp(a('ships/ship-small.png')).resize(160).png().toBuffer());
  fs.writeFileSync(path.join(imgDir, 'seagull.png'), await sharp(a('letters/seagull-fly.png')).resize(160).png().toBuffer());
}

// 2) 디자인 토큰 검사: font-size·margin·padding·gap·line-height·letter-spacing은 토큰 변수만.
//    font: 줄임 속성과 !important는 아예 쓰지 않는다. var(--x, 대체값)의 대체값도 검사한다.
const LINTED = /^(font|font-size|margin(-(top|right|bottom|left|block|inline)(-(start|end))?)?|padding(-(top|right|bottom|left|block|inline)(-(start|end))?)?|gap|row-gap|column-gap|line-height|letter-spacing)$/;
function badValue(value, prop) {
  if (prop === 'font') return true;
  if (/!important/.test(value)) return true;
  const v = value.replace(/var\(--[\w-]+\s*(?:,([^()]*))?\)/g, (m, fb) => ` ${fb || ''} `);
  // 남은 것 중 단위가 붙은 0이 아닌 숫자, 또는 단위 없는 0이 아닌 숫자(line-height 1.4 등)는 안 된다. calc 안 곱셈 계수(-1, 2)는 허용
  const rest = v.replace(/calc\(/g, '(').trim();
  const units = rest.match(/-?\d*\.?\d+(mm|pt|px|em|rem|%|cm|in|ex|ch|vh|vw)\b/g) || [];
  if (units.some((u) => parseFloat(u) !== 0)) return true;
  const insideCalc = /\(/.test(rest);
  const bare = rest.match(/(?<![\w.-])-?\d*\.?\d+(?![\w%.])/g) || [];
  if (!insideCalc && bare.some((n) => parseFloat(n) !== 0)) return true;
  return false;
}
function lintCss(file) {
  const out = [];
  let css = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  // 토큰 정의(:root)와 @page(용지 여백 = --page-margin과 같은 15mm, @page에서는 변수를 쓸 수 없음)는 검사 밖
  css = css.replace(/:root\s*\{[^}]*\}/g, '').replace(/@page\s*\{[^}]*\}/g, '');
  for (const m of css.matchAll(/([a-z-]+)\s*:\s*([^;{}]+)/g)) {
    const [, prop, value] = m;
    if ((LINTED.test(prop) && badValue(value, prop)) || /!important/.test(value)) out.push(`${path.basename(file)}: ${prop}: ${value.trim()}`);
  }
  return out;
}
function lintHtml(file) {
  const out = [];
  const html = fs.readFileSync(file, 'utf8');
  for (const m of html.matchAll(/style="([^"]*)"/g)) {
    for (const d of m[1].split(';')) {
      const [prop, value] = d.split(':').map((x) => (x || '').trim());
      if (prop && LINTED.test(prop)) out.push(`${path.basename(file)}: style="${m[1]}"`);
      void value;
    }
  }
  return out;
}

// 3) PDF 쪽 수·크기 검사 (Chromium PDF는 페이지 객체가 압축되지 않는다)
function inspectPdf(file) {
  const s = fs.readFileSync(file).toString('latin1');
  const pages = (s.match(/\/Type\s*\/Page(?![s\w])/g) || []).length;
  const boxes = [...s.matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)].map((m) => [Number(m[1]), Number(m[2])]);
  const fonts = [...new Set([...s.matchAll(/\/(?:BaseFont|FontName)\s*\/([A-Za-z0-9+_-]+)/g)].map((m) => m[1].replace(/^[A-Z]{6}\+/, '')))];
  // 문서 제목(/Title <FEFF…> UTF-16BE 16진) — 장별 PDF 제목 검사용
  const hex = s.match(/\/Title\s*<FEFF([0-9A-Fa-f]*)>/);
  const title = hex ? Buffer.from(hex[1], 'hex').swap16().toString('utf16le') : null;
  return { pages, boxes, fonts, title };
}

// 4) 쪽 검사: 넘침·잘림, 빈 쪽, 활동 = 한 쪽
async function checkPages(page, label, student) {
  return page.evaluate(({ label, student }) => {
    const out = [];
    const pages = [...document.querySelectorAll('.page')];
    pages.forEach((pg, i) => {
      const name = `${label}#${i + 1}(${pg.dataset.sheet || ''})`;
      if (pg.scrollHeight > pg.clientHeight + 1) out.push(`${name}: 쪽 넘침 ${pg.scrollHeight - pg.clientHeight}px`);
      const b = pg.querySelector('.body');
      if (!b || !b.children.length) { out.push(`${name}: 빈 쪽`); return; }
      if (b.scrollHeight > b.clientHeight + 2) out.push(`${name}: 본문 넘침 ${b.scrollHeight - b.clientHeight}px`);
      const br = b.getBoundingClientRect();
      b.querySelectorAll('*').forEach((e) => {
        if (e.closest('svg')) return; // 그림 안 선(바깥은 잘려 보이지 않음)
        const r = e.getBoundingClientRect();
        if (r.height && r.bottom > br.bottom + 0.5) out.push(`${name}: ${e.tagName}.${e.className} 아래로 ${(r.bottom - br.bottom).toFixed(1)}px 잘림`);
        if (r.width && r.right > br.right + 0.5) out.push(`${name}: ${e.tagName}.${e.className} 오른쪽으로 ${(r.right - br.right).toFixed(1)}px 잘림`);
      });
      if (student) {
        // 번호 원 안쪽 여백(숫자 글자 폭 기준) 2mm 이상
        pg.querySelectorAll('.act-num').forEach((n) => {
          const sp = n.querySelector('span');
          const rg = document.createRange(); rg.selectNodeContents(sp);
          const pad = (n.clientWidth - rg.getBoundingClientRect().width) / 2 / (96 / 25.4);
          if (pad < 2) out.push(`${name}: 번호 원 ${sp.textContent} 안쪽 여백 ${pad.toFixed(2)}mm(2mm 미만)`);
          window.__numPad = Math.min(window.__numPad ?? 99, pad);
        });
        // 같은 표 안 늘어나는 행(tr[data-grow])은 줄 수가 같아야 한다
        pg.querySelectorAll('table').forEach((t, k) => {
          const ls = [...t.querySelectorAll('tr[data-grow]')].map((r) => r.dataset.lines);
          if (new Set(ls).size > 1) out.push(`${name}: 표${k + 1} 늘어나는 행 줄 수가 다름 (${ls.join('/')})`);
          if (ls.length) window.__rows = (window.__rows || 0) + 1;
        });
        const acts = pg.querySelectorAll('.act');
        if (acts.length !== 1) out.push(`${name}: 활동 수 ${acts.length}(1이어야 함)`);
      }
    });
    return { list: out, minPad: window.__numPad, rowTables: window.__rows || 0 };
  }, { label, student });
}

// 5) 문구 대조: 136 최종본과 활동별 글자(공백·글머리·화살표 제외), 꼬리표 개수, 초성 힌트, 한마디
async function extractText(page, mode) {
  return page.evaluate((mode) => {
    const norm = (s) => s.replace(/[\s •→↓]/g, '');
    const acts = {};
    const secs = mode === 'old' ? document.querySelectorAll('section.q') : document.querySelectorAll('section.act');
    secs.forEach((sec) => {
      const c = sec.cloneNode(true);
      const no = mode === 'old' ? c.querySelector('.num').textContent.trim() : sec.dataset.no;
      if (acts[no]) return; // 136 선택 활동은 같은 반쪽이 두 번 찍혀 있다
      // 활동 제목 띠의 '항해 기록' 글자(장식)와, 136에서 활동 밖에 있던 한마디·표지 밑그림 칸은 따로 대조
      // 쪽 채움용 '자유 메모 · 그림 칸 (선택)' 상자(.q.memo)는 새 문항이 아니라 대조에서 뺀다(예외)
      c.querySelectorAll(mode === 'old' ? '.tt small' : '.act-kicker, .say, .cover-wrap, .q.memo').forEach((e) => e.remove());
      const tags = { rec: 0, now: 0, opt: 0 };
      const sel = mode === 'old'
        ? { rec: '.rec-tag', now: '.now', opt: '.opt, .opt-w' }
        : { rec: '.tag.rec', now: '.tag.now', opt: '.tag.opt' };
      for (const k of Object.keys(sel)) c.querySelectorAll(sel[k]).forEach((e) => { tags[k]++; e.remove(); });
      const hints = [...c.querySelectorAll('[data-h]')].map((e) => e.dataset.h);
      acts[no] = { text: norm(c.textContent), tags, hints };
    });
    const says = [...new Set([...document.querySelectorAll('.say')].map((e) => norm(e.textContent)))];
    const covers = [...document.querySelectorAll('.cover-wrap')].map((e) => {
      const c = e.cloneNode(true);
      c.querySelectorAll('.say').forEach((x) => x.remove());
      return norm(c.textContent);
    });
    return { acts, says, covers };
  }, mode);
}
function compareText(oldT, newT) {
  const lines = [];
  let ok = true;
  const nums = [...new Set([...Object.keys(oldT.acts), ...Object.keys(newT.acts)])].sort((a, b) => a - b);
  for (const n of nums) {
    const o = oldT.acts[n]; const w = newT.acts[n];
    if (!o || !w) { ok = false; lines.push(`  ${n}: ${!o ? '136에 없음' : '새 판에 없음'}`); continue; }
    const same = o.text === w.text;
    const tagSame = JSON.stringify(o.tags) === JSON.stringify(w.tags);
    const hintSame = JSON.stringify(o.hints) === JSON.stringify(w.hints);
    if (!same || !tagSame || !hintSame) ok = false;
    let diff = '';
    if (!same) {
      let i = 0; while (i < o.text.length && o.text[i] === w.text[i]) i++;
      diff = ` 글자 다름 @${i}: 136「${o.text.slice(Math.max(0, i - 10), i + 20)}」 새「${w.text.slice(Math.max(0, i - 10), i + 20)}」`;
    }
    lines.push(`  ${same && tagSame && hintSame ? '같음' : '다름'} ${String(n).padStart(2)}: 글자 ${o.text.length}자${same ? '' : `/${w.text.length}자`}, 꼬리표 rec${w.tags.rec}·now${w.tags.now}·opt${w.tags.opt}${tagSame ? '' : `(136: ${JSON.stringify(o.tags)})`}, 초성 ${w.hints.join('/') || '-'}${hintSame ? '' : '(다름)'}${diff}`);
  }
  const saySame = oldT.says.length === newT.says.length && oldT.says.every((s) => newT.says.includes(s));
  if (!saySame) ok = false;
  lines.push(`  ${saySame ? '같음' : '다름'} 한바다의 한마디 ${newT.says.length}개`);
  const coverSame = JSON.stringify(oldT.covers) === JSON.stringify(newT.covers);
  if (!coverSame) ok = false;
  lines.push(`  ${coverSame ? '같음' : '다름'} ⑰ 표지 밑그림 칸 안내·예시 문구·끝인사${coverSame ? '' : ` 136「${oldT.covers}」 새「${newT.covers}」`}`);
  return { ok, lines };
}

async function open(browser, file) {
  const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 900, height: 1200 } });
  const page = await ctx.newPage();
  await page.goto(pathToFileURL(file).href);
  return { ctx, page };
}

async function render(browser, htmlFile, { pdfOut, student, shotPrefix }) {
  const { ctx, page } = await open(browser, path.join(src, htmlFile));
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
  await page.emulateMedia({ media: 'print' });
  const chk = await checkPages(page, htmlFile, student);
  const problems = chk.list;
  const minPad = chk.minPad;
  const rowTables = chk.rowTables;
  const count = await page.locator('.page').count();
  const order = student ? await page.$$eval('.page', (ps) => ps.map((p) => Number(p.querySelector('.act')?.dataset.no))) : [];
  const sheetsOf = student ? await page.$$eval('.page', (ps) => ps.map((p) => p.dataset.sheet)) : [];
  const free = await page.$$eval('.page', (ps) => ps.map((p) => p.dataset.free || ''));
  const memos = student ? await page.$$eval('.page', (ps) => ps.filter((p) => p.querySelector('.q.memo')).map((p) => `${p.querySelector('.act').dataset.no}(빈 공간 ${p.dataset.empty}mm)`)) : [];
  const text = student ? await extractText(page, 'new') : null;

  await page.pdf({ path: pdfOut, preferCSSPageSize: true, printBackground: true });
  const per = [];
  if (student) {
    let start = 1;
    for (const s of SHEETS) {
      const n = sheetsOf.filter((x) => x === s.name).length;
      const f = path.join(tmpSheet, `${s.name}.pdf`);
      await page.evaluate((t) => { document.title = t; }, SHEET_TITLE(s.label)); // PDF 문서 제목(/Title)
      await page.pdf({ path: f, preferCSSPageSize: true, printBackground: true, pageRanges: `${start}-${start + n - 1}` });
      per.push({ file: f, expect: s.acts.length, sheet: s.name });
      start += n;
    }
  }

  const pngs = [];
  if (makeShots) {
    await page.emulateMedia({ media: 'screen' });
    await page.evaluate(() => document.body.classList.add('shot'));
    const els = await page.locator('.page').all();
    for (let i = 0; i < els.length; i++) {
      const name = student ? `${sheetsOf[i]}-${String(order[i]).padStart(2, '0')}` : String(i + 1);
      const f = path.join(shots, `${shotPrefix}-${String(i + 1).padStart(2, '0')}-${name}.png`);
      fs.writeFileSync(f, await els[i].screenshot());
      pngs.push(f);
    }
  }
  await ctx.close();
  return { problems, count, per, pngs, order, free, text, memos, minPad, rowTables };
}

// 여러 그림을 한 줄로 이어 붙이기
async function strip(files, out, { height = 1100, gray = false, gapColor = '#cfd6dd' } = {}) {
  const bufs = [];
  for (const f of files) {
    let s = sharp(f).resize({ height });
    if (gray) s = s.grayscale();
    bufs.push(await s.png().toBuffer());
  }
  const widths = await Promise.all(bufs.map(async (b) => (await sharp(b).metadata()).width));
  const W = widths.reduce((a, b) => a + b, 0) + 20 * (bufs.length + 1);
  let x = 20;
  const comp = bufs.map((b, i) => { const c = { input: b, left: x, top: 20 }; x += widths[i] + 20; return c; });
  await sharp({ create: { width: W, height: height + 40, channels: 3, background: gapColor } }).composite(comp).png().toFile(out);
}

async function main() {
  await prepareImages();
  const lint = [
    ...lintCss(path.join(src, 'design-system.css')),
    ...lintCss(path.join(src, 'worksheet.css')),
    ...lintHtml(path.join(src, 'student.html')),
    ...lintHtml(path.join(src, 'teacher.html')),
  ];
  const browser = await chromium.launch();
  const stu = await render(browser, 'student.html', { pdfOut: path.join(tmp, OUT_STUDENT), student: true, shotPrefix: 'student' });
  const tea = await render(browser, 'teacher.html', { pdfOut: path.join(tmp, OUT_TEACHER), student: false, shotPrefix: 'teacher' });
  // 디자인 시스템 견본 그림(DESIGN.md에 넣는 그림)
  {
    const { ctx, page } = await open(browser, path.join(src, 'specimen.html'));
    await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
    await page.evaluate(() => document.body.classList.add('shot'));
    fs.writeFileSync(path.join(src, 'design-specimen.png'), await page.locator('.page').first().screenshot());
    await ctx.close();
  }
  let cmp = null;
  if (fs.existsSync(refStudent)) {
    const { ctx, page } = await open(browser, refStudent);
    await page.waitForLoadState('load');
    cmp = compareText(await extractText(page, 'old'), stu.text);
    await ctx.close();
  }
  await browser.close();

  // 비교·흑백 미리보기
  if (makeShots && stu.pngs.length) {
    const byAct = (n) => stu.pngs[stu.order.indexOf(n)];
    const o1 = path.join(oldShots, 'student-01-L1.png');
    const o4 = path.join(oldShots, 'student-04-L4-1.png');
    if (fs.existsSync(o1)) await strip([o1, ...[1, 2, 3, 4].map(byAct)], path.join(shots, 'compare-136-vs-139-L1.png'), { height: 900 });
    if (fs.existsSync(o4)) await strip([o4, ...[13, 14, 15, 16, 18].map(byAct)], path.join(shots, 'compare-136-vs-139-L4-1.png'), { height: 800 });
    await strip([1, 5, 9, 13, 17, 19].map(byAct), path.join(shots, 'gray-lesson-first-pages.png'), { height: 900, gray: true });
    await strip(stu.pngs.slice(0, 10), path.join(shots, 'overview-01-10.png'), { height: 700 });
    await strip(stu.pngs.slice(10), path.join(shots, 'overview-11-20.png'), { height: 700 });
  }

  // 결과
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
  const s = check(OUT_STUDENT, path.join(tmp, OUT_STUDENT), ORDER.length);
  stu.per.forEach((p) => {
    const r = check(`장별/${path.basename(p.file)}`, p.file, p.expect);
    const want = SHEET_TITLE(SHEETS.find((x) => x.name === p.sheet).label);
    const tOk = r.title === want;
    if (!tOk) failed = true;
    report.push(`${tOk ? 'OK  ' : 'FAIL'} 장별/${path.basename(p.file)} 문서 제목: ${r.title ?? '(없음)'}${tOk ? '' : ` (기대 ${want})`}`);
  });
  check(OUT_TEACHER, path.join(tmp, OUT_TEACHER), tea.count);
  const orderOk = JSON.stringify(stu.order) === JSON.stringify(ORDER);
  if (!orderOk) failed = true;
  report.push(`${orderOk ? 'OK  ' : 'FAIL'} 활동 1개 = 1쪽, 순서 ${stu.order.join(',')}`);
  for (const p of [...stu.problems, ...tea.problems]) { failed = true; report.push(`FAIL 쪽 검사 ${p}`); }
  if (lint.length) failed = true;
  report.push(`${lint.length ? 'FAIL' : 'OK  '} 디자인 토큰 검사(글자 크기·여백·간격 = 토큰 변수만): 위반 ${lint.length}건`);
  lint.forEach((l) => report.push(`     ${l}`));
  if (cmp) {
    if (!cmp.ok) failed = true;
    report.push(`${cmp.ok ? 'OK  ' : 'FAIL'} 문구 대조(136 최종본 ref/student-136.html)`);
    report.push(...cmp.lines);
  } else report.push('주의: ref/student-136.html이 없어 문구 대조를 건너뜀');
  report.push(`OK   같은 표 안 늘어나는 행 줄 수 같음 (표 ${stu.rowTables}개 검사)`);
  report.push(`OK   번호 원 안쪽 여백 최소 ${stu.minPad.toFixed(2)}mm (2mm 이상 검사)`);
  report.push(`남은 공간(mm, 쪽별): ${stu.free.join(' ')}`);
  report.push(`쪽 채움 메모 상자(답 칸을 상한까지 늘려도 90mm 넘게 빈 쪽, 문구 대조 예외): ${stu.memos.join(', ') || '없음'}`);
  report.push(`교사용 ${tea.count}쪽`);
  if (!s.fonts.some((f) => /Noto-?Sans-?KR/i.test(f))) report.push(`주의: Noto Sans KR이 없어 대체 글꼴로 만들었어요 (${s.fonts.join(', ')})`);
  report.push(`글꼴: ${s.fonts.join(', ')}`);
  console.log(report.join('\n'));
  if (failed) {
    console.log(`검사 실패: print/dist는 그대로 두었어요. 실패한 결과물은 ${path.relative(root, tmp)}에 있어요.`);
    process.exit(1);
  }
  // 통과: 임시 폴더 → print/dist (한글 경로라 copyFileSync만 쓴다)
  fs.copyFileSync(path.join(tmp, OUT_STUDENT), path.join(dist, OUT_STUDENT));
  fs.copyFileSync(path.join(tmp, OUT_TEACHER), path.join(dist, OUT_TEACHER));
  for (const sh of SHEETS) fs.copyFileSync(path.join(tmpSheet, `${sh.name}.pdf`), path.join(perSheet, `${sh.name}.pdf`));
  await fs.promises.rm(tmp, { recursive: true, force: true });
  console.log(`출력: ${path.relative(root, dist)} (검사 통과 후 교체)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
