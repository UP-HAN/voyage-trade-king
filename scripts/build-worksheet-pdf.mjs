// 인쇄용 학습지 '항해 일지' PDF 만들기 (작업 136 → 139 디자인 시스템 판 → 140 항해 퀴즈·체크!·특별 항해)
//   npm run worksheet:pdf
// 입력: print/worksheet/student.html, teacher.html (+ design-system.css, worksheet.css, common.js)
// 출력: print/dist/대항해무역왕_항해일지_학생용.pdf (항해 기록 1개 = 1쪽, 20쪽)
//       print/dist/대항해무역왕_항해일지_교사용_예시답.pdf
//       print/dist/장별/{L1,L2,L3,L4-1,L4-2,선택활동}.pdf (그 차시의 쪽 묶음)
//       미리보기 PNG: .orch/tasks/140-worksheet-extra-questions/shots/ (폴더가 있을 때)
// 검사: 쪽 수·A4·넘침·빈 쪽, 활동 하나가 한 쪽 안에 있는지, CSS 토큰 규칙, 136 최종본과 문구 대조,
//       항해 퀴즈 문구 대조(ref/quiz-v1.2.json), 학생용 보이는 글자의 '선택' 0번, 메모 상자·.tag.opt 0개.
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
const taskDir = path.join(root, '.orch', 'tasks', '140-worksheet-extra-questions');
const shots = path.join(taskDir, 'shots');
const prevShots = path.join(root, '.orch', 'tasks', '139-worksheet-design-system', 'shots'); // 139 판(읽기만)
const imgDir = path.join(src, 'img');
const refStudent = path.join(src, 'ref', 'student-136.html');
const refQuiz = path.join(src, 'ref', 'quiz-v1.2.json');

// 136 대조에서 허용하는 문구 차이(작업 140, docs/worksheet.md v1.2 — 학생용 '선택' 낱말 금지). 이 목록 밖의 차이는 FAIL.
// act: 활동 번호, from: 136 글자, to: 새 판 글자(공백 무시). act가 null이면 활동 밖(머리띠)이라 대조 대상이 아니고 기록용이다.
const ALLOWED_DIFFS = [
  { act: '4', where: '④ 활동 제목', from: '흑연 선택', to: '흑연, 어디서 살까?' },
  { act: null, where: 'L4-1 차시 제목(머리띠 data-title, 대조 대상 아님)', from: '기업의 선택', to: '기업의 결정' },
];
// 항해 퀴즈가 들어가는 쪽(활동 번호)과 하위 문항 수
const QUIZ_PLAN = { 2: 3, 3: 2, 4: 2, 6: 3, 10: 3, 15: 3 };
const CIRCLED = ['', '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳'];

// 장별 PDF: 이름은 136과 같다. 쪽 수 = 그 차시의 항해 기록 수
// label: 장별 PDF 문서 제목 끝(작업 138 수정 1회차 — 장별 PDF 제목이 모두 '학생용'이던 것을 차시 이름으로)
const SHEETS = [
  { name: 'L1', label: '1차시', acts: [1, 2, 3, 4] },
  { name: 'L2', label: '2차시', acts: [5, 6, 7, 8] },
  { name: 'L3', label: '3차시', acts: [9, 10, 11, 12] },
  { name: 'L4-1', label: '4차시 ①', acts: [13, 14, 15, 16, 18] },
  { name: 'L4-2', label: '4차시 ②', acts: [17] },
  { name: '선택활동', label: '특별 항해', acts: [19, 20] }, // 파일 이름은 그대로, 문서 제목은 '특별 항해'(작업 140)
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
      // (작업 140) 새 판의 항해 퀴즈(.q.quiz)는 136에 없는 블록이라 빼고 따로 대조(ref/quiz-v1.2.json).
      //  문항 번호는 양쪽에서 뺀다(②·⑮에 번호를 붙였기 때문): 136 '.n', 새 판 '.q-no'
      c.querySelectorAll(mode === 'old' ? '.tt small, .n' : '.act-kicker, .say, .cover-wrap, .q.quiz, .q-no').forEach((e) => e.remove());
      // 136 ⑳은 번호를 <b>1.</b>로 썼다(.n이 아님) — 같은 번호 글자로 보고 뺀다
      if (mode === 'old') c.querySelectorAll('b').forEach((e) => { if (/^\s*\d+\.\s*$/.test(e.textContent)) e.remove(); });
      // 꼬리표 개수: 새 판 체크!(①⑧⑩⑯)·특별 항해(⑲⑳) = 136 '선택'(opt)
      const tags = { rec: 0, now: 0, opt: 0 };
      const sel = mode === 'old'
        ? { rec: '.rec-tag', now: '.now', opt: '.opt, .opt-w' }
        : { rec: '.tag.rec', now: '.tag.now', opt: '.tag.check, .tag.special' };
      for (const k of Object.keys(sel)) c.querySelectorAll(sel[k]).forEach((e) => { tags[k]++; e.remove(); });
      const hints = [...c.querySelectorAll('[data-h]')].map((e) => e.dataset.h);
      const kinds = mode === 'old' ? '' : [...sec.querySelectorAll('.tag.check, .tag.special')].map((e) => (e.matches('.check') ? 'check' : 'special')).join('');
      acts[no] = { text: norm(c.textContent), tags, hints, kinds };
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
const norm = (s) => s.replace(/[\s •→↓]/g, '');
function compareText(oldT, newT) {
  const lines = [];
  let ok = true;
  const nums = [...new Set([...Object.keys(oldT.acts), ...Object.keys(newT.acts)])].sort((a, b) => a - b);
  for (const n of nums) {
    const o = oldT.acts[n]; const w = newT.acts[n];
    if (!o || !w) { ok = false; lines.push(`  ${n}: ${!o ? '136에 없음' : '새 판에 없음'}`); continue; }
    let wt = w.text;
    const allowed = ALLOWED_DIFFS.filter((d) => d.act === n && wt.includes(norm(d.to)));
    for (const d of allowed) wt = wt.replace(norm(d.to), norm(d.from));
    const same = o.text === wt;
    const tagSame = JSON.stringify(o.tags) === JSON.stringify(w.tags);
    const hintSame = JSON.stringify(o.hints) === JSON.stringify(w.hints);
    if (!same || !tagSame || !hintSame) ok = false;
    let diff = '';
    if (!same) {
      let i = 0; while (i < o.text.length && o.text[i] === wt[i]) i++;
      diff = ` 글자 다름 @${i}: 136「${o.text.slice(Math.max(0, i - 10), i + 20)}」 새「${wt.slice(Math.max(0, i - 10), i + 20)}」`;
    }
    const optName = w.kinds ? `${w.kinds.includes('check') ? '체크!' : '특별 항해'}${w.tags.opt}(=136 선택${o.tags.opt})` : `opt${w.tags.opt}`;
    const allow = allowed.map((d) => ` · 허용 차이: ${d.where}「${d.from}」→「${d.to}」`).join('');
    lines.push(`  ${same && tagSame && hintSame ? '같음' : '다름'} ${String(n).padStart(2)}: 글자 ${o.text.length}자${same ? '' : `/${wt.length}자`}, 꼬리표 rec${w.tags.rec}·now${w.tags.now}·${optName}${tagSame ? '' : `(136: ${JSON.stringify(o.tags)})`}, 초성 ${w.hints.join('/') || '-'}${hintSame ? '' : '(다름)'}${allow}${diff}`);
  }
  const saySame = oldT.says.length === newT.says.length && oldT.says.every((s) => newT.says.includes(s));
  if (!saySame) ok = false;
  lines.push(`  ${saySame ? '같음' : '다름'} 한바다의 한마디 ${newT.says.length}개`);
  const coverSame = JSON.stringify(oldT.covers) === JSON.stringify(newT.covers);
  if (!coverSame) ok = false;
  lines.push(`  ${coverSame ? '같음' : '다름'} ⑰ 표지 밑그림 칸 안내·예시 문구·끝인사${coverSame ? '' : ` 136「${oldT.covers}」 새「${newT.covers}」`}`);
  return { ok, lines };
}

// 6) 항해 퀴즈 뽑기와 '선택' 낱말·메모 상자·꼬리표 검사(작업 140)
async function extractQuiz(page) {
  return page.evaluate(() => {
    const strip = (el, sel) => { const c = el.cloneNode(true); c.querySelectorAll(sel).forEach((e) => e.remove()); return c.textContent; };
    const blocks = [...document.querySelectorAll('.q.quiz')].map((q) => ({
      id: q.dataset.id,
      act: Number(q.closest('.act')?.dataset.no),
      question: strip(q.querySelector('.q-text'), '.q-no, .tag, .hint'),
      items: [...q.querySelectorAll('.quiz-item')].map((it) => {
        const d = { mark: it.querySelector('.qi-mark').textContent, type: it.dataset.type, text: it.querySelector('.qi-text').textContent };
        const opts = it.querySelectorAll(':scope > .choices > span');
        if (opts.length) d.options = [...opts].map((o) => o.textContent);
        if (d.type === 'match') {
          d.left = [...it.querySelectorAll('.m-col.l > span')].map((e) => e.textContent);
          d.right = [...it.querySelectorAll('.m-col.r > span')].map((e) => e.textContent);
        }
        return d;
      }),
      // 쓰는 답 칸(상자·한 줄 쓰기·빈칸·표 쓰는 칸)이 퀴즈 안에 있으면 안 된다
      writing: q.querySelectorAll('.a-box, .a-line, .bl, td.w').length,
      // 정답 노출 방지: 퀴즈 문항 안 굵게·강조 금지
      bold: q.querySelectorAll('.quiz-list b, .quiz-list strong, .quiz-list em, .quiz-list u').length,
    }));
    const pages = [...document.querySelectorAll('.page')];
    const sentaku = pages.flatMap((p, i) => {
      const t = p.innerText; const out = [];
      let k = t.indexOf('선택');
      while (k >= 0) { out.push(`${i + 1}쪽「${t.slice(Math.max(0, k - 8), k + 8).replace(/\s+/g, ' ')}」`); k = t.indexOf('선택', k + 1); }
      return out;
    });
    const quizPerAct = {};
    pages.forEach((p) => { const n = p.querySelector('.act')?.dataset.no; quizPerAct[n] = p.querySelectorAll('.q.quiz').length; });
    return {
      blocks, sentaku, quizPerAct,
      memo: document.querySelectorAll('.q.memo').length,
      opt: document.querySelectorAll('.tag.opt').length,
      checks: [...document.querySelectorAll('.tag.check')].map((e) => `${e.closest('.act').dataset.no}-${e.closest('.q').querySelector('.q-no').textContent}`),
      specials: [...document.querySelectorAll('.tag.special')].map((e) => e.closest('.act').dataset.no),
      specialMast: pages.filter((p) => p.dataset.sheet === '선택활동').map((p) => `${p.querySelector('.mast .pill').textContent}|${p.querySelector('.foot b').textContent}`),
      steps: pages.map((p) => p.dataset.quiz ?? ''),
      trims: pages.map((p) => (p.dataset.trim ? `${p.querySelector('.act').dataset.no}: ${p.dataset.trim}` : '')).filter(Boolean),
    };
  });
}
function compareQuiz(q) {
  const lines = [];
  let ok = true;
  const ref = JSON.parse(fs.readFileSync(refQuiz, 'utf8'));
  const pick = (b) => JSON.stringify({
    q: norm(b.question),
    items: b.items.map((it) => ({ mark: norm(it.mark), type: it.type, text: norm(it.text), options: (it.options || []).map(norm), left: (it.left || []).map(norm), right: (it.right || []).map(norm) })),
  });
  for (const r of ref.blocks) {
    const w = q.blocks.find((b) => b.id === r.id);
    const same = !!w && pick(w) === pick(r);
    if (!same) ok = false;
    const detail = same || !w ? '' : `\n       기준 ${pick(r)}\n       학생 ${pick(w)}`;
    lines.push(`  ${same ? '같음' : '다름'} ${r.id}: 하위 문항 ${w ? w.items.length : 0}개 (${(w ? w.items : []).map((it) => it.type).join('·')})${w ? '' : ' — 학생용에 없음'}${detail}`);
  }
  const extra = q.blocks.filter((b) => !ref.blocks.some((r) => r.id === b.id));
  if (extra.length) { ok = false; lines.push(`  다름 기준에 없는 블록: ${extra.map((b) => b.id).join(', ')}`); }
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
  const text = student ? await extractText(page, 'new') : null;
  const quiz = student ? await extractQuiz(page) : null;
  // 꼬리표 5종 흑백 확대용(학생용 첫 번째 것, 화면 매체로 찍는다)
  const tagShots = [];

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
    if (student) {
      for (const sel of ['.tag.quiz', '.tag.check', '.tag.special', '.tag.rec', '.tag.now']) {
        const f = path.join(shots, `_tag-${sel.split('.').pop()}.png`);
        fs.writeFileSync(f, await page.locator(sel).first().screenshot());
        tagShots.push(f);
      }
    }
    const els = await page.locator('.page').all();
    for (let i = 0; i < els.length; i++) {
      const name = student ? `${sheetsOf[i]}-${String(order[i]).padStart(2, '0')}` : String(i + 1);
      const f = path.join(shots, `${shotPrefix}-${String(i + 1).padStart(2, '0')}-${name}.png`);
      fs.writeFileSync(f, await els[i].screenshot());
      pngs.push(f);
    }
  }
  await ctx.close();
  return { problems, count, per, pngs, order, free, text, quiz, tagShots, minPad, rowTables };
}

// 여러 그림을 위아래로 쌓기(왼쪽 정렬)
async function stack(files, out, gapColor = '#cfd6dd') {
  const metas = await Promise.all(files.map((f) => sharp(f).metadata()));
  const W = Math.max(...metas.map((m) => m.width));
  let y = 0;
  const comp = files.map((f, i) => { const c = { input: f, left: 0, top: y }; y += metas[i].height; return c; });
  await sharp({ create: { width: W, height: y, channels: 3, background: gapColor } }).composite(comp).png().toFile(out);
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
    // 139 판(메모 상자)과 140 판(항해 퀴즈)을 위아래로: ②③④⑥⑩⑮
    const qActs = Object.keys(QUIZ_PLAN).map(Number);
    const prevList = fs.existsSync(prevShots) ? fs.readdirSync(prevShots) : [];
    const prev = qActs.map((n) => prevList.find((f) => f.startsWith('student-') && f.endsWith(`-${String(n).padStart(2, '0')}.png`))).map((f) => (f ? path.join(prevShots, f) : null));
    if (prev.every(Boolean)) {
      const top = path.join(shots, '_row-139.png'); const bot = path.join(shots, '_row-140.png');
      await strip(prev, top, { height: 760 });
      await strip(qActs.map(byAct), bot, { height: 760 });
      await stack([top, bot], path.join(shots, 'compare-139-vs-140-quiz-pages.png'));
      await fs.promises.rm(top, { force: true }); await fs.promises.rm(bot, { force: true });
    }
    if (stu.tagShots.length) {
      await strip(stu.tagShots, path.join(shots, 'gray-tags-zoom.png'), { height: 160, gray: true, gapColor: '#ffffff' });
      for (const f of stu.tagShots) await fs.promises.rm(f, { force: true });
    }
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
  report.push(`     허용된 문구 차이(상수 ALLOWED_DIFFS): ${ALLOWED_DIFFS.map((d) => `${d.where}「${d.from}」→「${d.to}」`).join(' / ')}`);
  // 항해 퀴즈(작업 140)
  const q = stu.quiz;
  const qc = compareQuiz(q);
  if (!qc.ok) failed = true;
  report.push(`${qc.ok ? 'OK  ' : 'FAIL'} 항해 퀴즈 문구 대조(ref/quiz-v1.2.json = docs/worksheet.md v1.2 4장)`);
  report.push(...qc.lines);
  const placeBad = Object.entries(q.quizPerAct).filter(([n, c]) => c !== (QUIZ_PLAN[n] ? 1 : 0));
  const countBad = q.blocks.filter((b) => b.items.length < 2 || b.items.length > 3 || b.items.length !== QUIZ_PLAN[b.act]);
  const qOk = !placeBad.length && !countBad.length && q.blocks.length === 6;
  if (!qOk) failed = true;
  report.push(`${qOk ? 'OK  ' : 'FAIL'} 항해 퀴즈: ${q.blocks.map((b) => `${CIRCLED[b.act]}${b.items.length}`).join(' ')} (②③④⑥⑩⑮에 1개씩, 다른 쪽 0개, 하위 문항 2~3개)${placeBad.length ? ` 위치 다름 ${JSON.stringify(placeBad)}` : ''}`);
  const wBad = q.blocks.filter((b) => b.writing || b.bold);
  if (wBad.length) failed = true;
  report.push(`${wBad.length ? 'FAIL' : 'OK  '} 퀴즈 안 쓰는 답 칸·굵은 글자 0개${wBad.length ? ` (${wBad.map((b) => b.id).join(', ')})` : ''}`);
  if (q.memo) failed = true;
  report.push(`${q.memo ? 'FAIL' : 'OK  '} 메모 상자: ${q.memo ? `${q.memo}개` : '없음'}`);
  if (q.opt) failed = true;
  report.push(`${q.opt ? 'FAIL' : 'OK  '} .tag.opt: ${q.opt}개`);
  if (q.sentaku.length) failed = true;
  report.push(`${q.sentaku.length ? 'FAIL' : 'OK  '} 선택 낱말: ${q.sentaku.length}${q.sentaku.length ? ` — ${q.sentaku.join(', ')}` : ' (학생용 모든 쪽의 보이는 글자: 머리띠·꼬리말·꼬리표 포함)'}`);
  const chkOk = JSON.stringify(q.checks) === JSON.stringify(['1-3.', '8-3.', '10-3.', '16-3.'])
    && JSON.stringify(q.specials) === JSON.stringify(['19', '20'])
    && q.specialMast.length === 2 && q.specialMast.every((m) => /^특별 항해\|특별 항해 · \d \/ 2$/.test(m));
  if (!chkOk) failed = true;
  report.push(`${chkOk ? 'OK  ' : 'FAIL'} 꼬리표: 체크! ${q.checks.join(' ')} / 특별 항해 제목 ⑲⑳ ${q.specials.join(',')} / ⑲⑳ 머리띠|꼬리말 ${q.specialMast.join(', ')}`);
  report.push(`OK   같은 표 안 늘어나는 행 줄 수 같음 (표 ${stu.rowTables}개 검사)`);
  report.push(`OK   번호 원 안쪽 여백 최소 ${stu.minPad.toFixed(2)}mm (2mm 이상 검사)`);
  report.push(`남은 공간(mm, 쪽별): ${stu.free.join(' ')}`);
  report.push(`퀴즈 줄 높이 단계(쪽별, 0=10mm·4mm 1=12mm·4mm 2=12mm·8mm 3=16mm·8mm, -=퀴즈 없음): ${q.steps.map((x) => x || '-').join(' ')}`);
  report.push(`넘침 때문에 줄인 답 칸 줄 수: ${q.trims.join(', ') || '없음'}`);
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
