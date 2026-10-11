// 작업 141 공략집 — 내용(print/guide/content.mjs) + 촬영 기록(shots.json) → HTML 쪽들.
//
// 글 안의 표시
//   {1}      → 1번 빨간 상자 버튼 이름(화면에서 읽은 그대로) 굵게: [무역 시작]
//   {1:을}   → 이름 뒤에 알맞은 조사(을/를, 이/가, 은/는, 와/과, 으로/로)
//   {A}      → A번 파란 점선(보는 곳)의 글자
//   {#1}     → 번호 동그라미 ① 글자만
// 버튼 이름 끝의 ▶·▾ 같은 꾸밈 기호는 뺀다(화면에서 이름 뒤에 붙은 화살표).

const CIRCLED = '⓪①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
export const circled = (n) => CIRCLED[n] ?? `(${n})`;
export const lettered = (n) => String.fromCharCode(0x24b6 + n - 1); // Ⓐ

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 화면 이름 → 공략집 표기(꾸밈 기호·여러 줄 정리) */
export function cleanLabel(s) {
  return String(s ?? '')
    .split(/\n/)[0]
    .replace(/[▶▸►▾▼▴▲›»]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 받침 있는지(마지막 한글 글자 기준, 숫자는 읽는 소리로) */
function lastSound(word) {
  const w = word.replace(/[\s)\]'"’”.,!?…·\-]+$/g, '');
  const ch = w.at(-1) ?? '';
  const code = ch.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) {
    const jong = (code - 0xac00) % 28;
    return { has: jong !== 0, rieul: jong === 8 };
  }
  // 숫자: 0영 1일 2이 3삼 4사 5오 6육 7칠 8팔 9구
  const num = { 0: [true, false], 1: [true, true], 2: [false, false], 3: [true, false], 4: [false, false], 5: [false, false], 6: [true, false], 7: [true, true], 8: [true, true], 9: [false, false] };
  if (ch in num) return { has: num[ch][0], rieul: num[ch][1] };
  return { has: false, rieul: false };
}

export function josa(word, j) {
  if (!j) return '';
  const { has, rieul } = lastSound(word);
  switch (j) {
    case '을': case '를': return has ? '을' : '를';
    case '이': case '가': return has ? '이' : '가';
    case '은': case '는': return has ? '은' : '는';
    case '과': case '와': return has ? '과' : '와';
    case '으로': case '로': return has && !rieul ? '으로' : '로';
    case '이에요': case '예요': return has ? '이에요' : '예요';
    default: return j;
  }
}

/** 글 속 표시 바꾸기. used: 쓴 표시 기록(Set) */
export function fill(text, shotMarks, used, where) {
  return esc(text).replace(/\{(#)?([0-9]+|[A-Z])(?::([^}]+))?\}/g, (all, onlyNo, key, j) => {
    const look = /[A-Z]/.test(key);
    const n = look ? key.charCodeAt(0) - 64 : Number(key);
    const m = shotMarks.find((x) => x.n === n && (x.kind === 'look') === look);
    if (!m) throw new Error(`${where}: 표시 ${key}가 촬영 기록에 없어요`);
    used?.add(`${m.kind}:${n}`);
    if (onlyNo) return look ? lettered(n) : circled(n);
    const real = cleanLabel(m.label);
    const name = m.text ?? real;
    if (!name) throw new Error(`${where}: 표시 ${key}의 화면 이름이 비었어요(text를 주세요)`);
    // 버튼 이름 그대로면 [이름], 버튼이 아니거나 화면 글자와 다른 설명 이름이면 ‘이름’
    const asButton = m.kind === 'press' && m.btn !== false && (!m.text || real.startsWith(m.text));
    const shown = asButton ? `[${esc(name)}]` : `‘${esc(name)}’`;
    return `<b class="btn ${m.kind}${name.length <= 12 ? ' nw' : ''}">${shown}</b>${josa(name, j ? j.replace(/^/, '') : '')}`;
  });
}

/** 간단한 굵게: **글** */
const bold = (h) => h.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

function imgTag(shot, caption, dir) {
  return `<figure><img src="${dir}/${shot.out}" alt="${esc(shot.id)}">${caption ? `<figcaption>${bold(esc(caption))}</figcaption>` : ''}</figure>`;
}

/**
 * book: { id, title, kicker, subtitle, who, sections:[{ title, steps:[step] }], pre:[page], post:[page] }
 * step: { id, title, lead?, shot, sub?: [shotId…], caption?, subCaptions?, layout?: 'single'|'pair', items:[{ m?:n|'A', text }], note?, tips?:[{q,a}] }
 * shots: Map id → { out, marks:[{n,kind,label,text?}] }
 * 반환: { html, checks:{ missing:[], unused:[] }, toc }
 */
export function renderBook(book0, shots, o) {
  // optional 단계는 그 화면이 촬영 기록에 있을 때만(앱 동작에 따라 생기거나 안 생기는 화면)
  const book = { ...book0, sections: book0.sections.map((sec) => ({ ...sec, steps: sec.steps.filter((st) => !st.optional || shots.has(st.shot)) })) };
  const pages = [];
  const missing = [];
  const lookMissing = [];
  const toc = [];
  let no = 0;
  const foot = (label) => `<div class="foot"><span>${esc(book.title)} · ${esc(book.who)}</span><span>${esc(label)}</span></div>`;
  const getShot = (id, where) => {
    const s = shots.get(id);
    if (!s) throw new Error(`${where}: 촬영 기록에 화면 '${id}'가 없어요`);
    return s;
  };

  // 차례 먼저 계산(쪽 번호: 표지 1, 차례 2, 앞글 n, 그다음 단계)
  const preCount = (book.pre ?? []).length;
  let pageNo = 2 + preCount;
  for (const sec of book.sections) {
    const list = [];
    for (const st of sec.steps) {
      pageNo++;
      no++;
      list.push({ no, title: st.title, page: pageNo });
    }
    toc.push({ title: sec.title, list });
  }
  no = 0;

  // 표지
  pages.push(`<section class="page cover">
    <div class="kicker">${esc(book.kicker)}</div>
    <h1>${esc(book.title)}<br>${esc(book.subtitle)}</h1>
    <p class="sub">${bold(esc(book.intro))}</p>
    <div class="legend"><span><span class="box"></span>${esc(book.legendPress)}</span><span><span class="box look"></span>${esc(book.legendLook)}</span></div>
    <p class="meta">${esc(book.meta)}</p>
    ${o.shipImg ? `<img class="ship" src="${o.shipImg}" alt="">` : ''}
    ${foot('1')}
  </section>`);
  // 차례
  pages.push(`<section class="page"><div class="head"><span class="no">차례</span><h2>이 순서대로 따라 하세요</h2></div>
    <div class="toc">${toc
      .map(
        (g) => `<div class="grp"><h3>${esc(g.title)}</h3><ol>${g.list
          .map((x) => `<li><span class="n">${x.no}</span><span>${esc(x.title)}</span><span class="dots"></span><span class="p">${x.page}쪽</span></li>`)
          .join('')}</ol></div>`,
      )
      .join('')}</div>${foot('2')}</section>`);
  // 앞글(준비물 등)
  (book.pre ?? []).forEach((p, i) => pages.push(prosePage(p, foot(String(3 + i)))));

  pageNo = 2 + preCount;
  for (const sec of book.sections) {
    for (const st of sec.steps) {
      pageNo++;
      no++;
      const where = `${book.id}/${st.id}`;
      const main = getShot(st.shot, where);
      const subs = (st.sub ?? []).map((id) => getShot(id, where));
      const used = new Set();
      const all = [main, ...subs];
      // 표시는 큰 화면(main) 기준. 작은 화면의 표시는 sub 번호로 따로 쓰지 않는다(필요하면 단계를 나눈다)
      const marks = main.marks;
      const hasMark = (it) => {
        if (it.m == null) return true;
        const look = typeof it.m === 'string';
        return marks.some((x) => x.n === (look ? it.m.charCodeAt(0) - 64 : it.m) && (x.kind === 'look') === look);
      };
      const items = (st.items ?? [])
        .filter((it) => !it.ifMark || hasMark(it))
        .map((it, k) => {
          const look = typeof it.m === 'string';
          const m = it.m == null ? null : marks.find((x) => x.n === (look ? it.m.charCodeAt(0) - 64 : it.m) && (x.kind === 'look') === look);
          if (it.m != null && !m) throw new Error(`${where}: 항목 ${k + 1}의 표시 ${it.m}가 촬영 기록에 없어요`);
          if (m) used.add(`${m.kind}:${m.n}`);
          const g = m ? `<span class="g">${m.kind === 'look' ? String.fromCharCode(64 + m.n) : m.n}</span>` : '';
          return `<li class="${m ? m.kind : 'plain'}">${g}${bold(fill(it.text, marks, used, where))}</li>`;
        })
        .join('');
      const tips = (st.tips ?? [])
        .map((t) => `<p><b class="q">${bold(fill(t.q, marks, used, where))}</b> ${bold(fill(t.a, marks, used, where))}</p>`)
        .join('');
      const note = st.note ? `<p class="note">${bold(fill(st.note, marks, used, where))}</p>` : '';
      // 누락 검사: 화면의 빨간 상자는 모두 설명돼야 한다
      for (const m of marks) {
        if (used.has(`${m.kind}:${m.n}`)) continue;
        if (m.kind === 'press') missing.push(`${where}: ${m.n}번 빨간 상자(${cleanLabel(m.label)}) 설명 없음`);
        else lookMissing.push(`${where}: ${String.fromCharCode(64 + m.n)} 파란 점선(${m.text ?? cleanLabel(m.label)}) 설명 없음`);
      }
      const layout = st.layout ?? (subs.length && st.pair ? 'pair' : 'single');
      const figMain = imgTag(main, st.caption, o.imgDir);
      const figSubs = subs.map((s, i) => imgTag(s, st.subCaptions?.[i], o.imgDir)).join('');
      const side = layout !== 'pair' && subs.length ? `<div class="side-shots">${figSubs}</div>` : '';
      const text = `<div class="text"><ol class="marks">${items}</ol>${note}${tips ? `<div class="tip"><h4>${esc(book.tipTitle)}</h4>${tips}</div>` : ''}${side}</div>`;
      const zoom = !subs.length && main.zoom && st.zoom !== false
        ? `<figure class="zoom"><img src="${o.imgDir}/${main.zoom}" alt="확대"><figcaption>확대(약 ${main.zoomFactor}배) — 표시한 부분만 크게</figcaption></figure>`
        : '';
      const shotsHtml = layout === 'pair' ? `<div class="shots">${figMain}${figSubs}</div>` : `<div class="shots">${figMain}${subs.length ? '' : zoom}</div>`;
      pages.push(`<section class="page" data-step="${esc(st.id)}">
        <div class="head"><span class="no">${no}</span><h2>${esc(st.title)}</h2><span class="sec">${esc(sec.title)}</span>${st.who ? `<span class="who">${esc(st.who)}</span>` : ''}</div>
        ${st.lead ? `<p class="lead">${bold(fill(st.lead, marks, used, where))}</p>` : ''}
        <div class="body ${layout}">${shotsHtml}${text}</div>
        ${foot(`${pageNo}`)}
      </section>`);
      void all;
    }
  }
  (book.post ?? []).forEach((p, i) => pages.push(prosePage(p, foot(String(pageNo + 1 + i)))));

  const html = `<!doctype html><html lang="ko" data-book="${book.id}"><head><meta charset="utf-8"><title>${esc(book.title)} ${esc(book.subtitle)}</title>
<link rel="stylesheet" href="${o.css}"></head><body>${pages.join('\n')}</body></html>`;
  return { html, missing: [...missing, ...lookMissing], toc, pages: pages.length };
}

function prosePage(p, foot) {
  const secs = p.blocks
    .map((b) => `<section><h3>${esc(b.title)}</h3>${(b.lines ?? []).map((l) => `<p>${bold(esc(l))}</p>`).join('')}${b.list ? `<ul>${b.list.map((l) => `<li>${bold(esc(l))}</li>`).join('')}</ul>` : ''}</section>`)
    .join('');
  return `<section class="page"><div class="head"><span class="no">${esc(p.no ?? '')}</span><h2>${esc(p.title)}</h2></div>${p.lead ? `<p class="lead">${bold(esc(p.lead))}</p>` : ''}<div class="prose">${secs}</div>${foot}</section>`;
}
