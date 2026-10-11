// 작업 141 공략집 — 촬영한 화면(PNG)에 빨간 상자·번호 동그라미를 그려 넣는다(sharp + SVG 합성).
//
// 표시 종류
//  - press: 눌러야 할 것. 빨간 실선 3px(CSS px 기준, 화면 배율만큼 굵게), 둥근 모서리, 요소 둘레 여백 5px. 번호 ①②….
//  - look : 보면 되는 곳(누르지 않음). 파란 점선 3px, 글자 동그라미 Ⓐ Ⓑ….
// 상자는 요소 바깥 둘레에만 선을 그리므로 버튼 글자를 가리지 않는다. 동그라미는 상자 바깥 모서리(대각선) 중
// 화면 안에 들어오고 다른 상자·동그라미와 겹치지 않는 자리에 둔다(없으면 상자 바깥 왼쪽 위).
import sharp from 'sharp';

export const PRESS = '#e00000';
export const LOOK = '#1565c0';
// 기준 크기(1366px 너비 화면 기준 CSS px). 더 넓은 화면(TV 1920)은 너비 비율만큼 키워 인쇄했을 때 같은 크기로 보이게 한다.
let PAD = 5; // 요소 둘레 여백
let STROKE = 3; // 선 굵기
let R = 13; // 동그라미 반지름
let FONT = 17;
function sizeFor(vw) {
  const k = Math.max(1, vw / 1366);
  PAD = 5 * k;
  STROKE = 3 * k;
  R = 13 * k;
  FONT = 17 * k;
}

const inter = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** 그림의 한 칸이 얼마나 '복잡한지'(밝기 표준편차) — 동그라미를 빈 곳에 두려고 쓴다. img: { data, width, height, channels, scale } */
function busy(img, x, y, w, h, skip = null) {
  if (!img) return 0;
  const { data, width, height, channels, scale } = img;
  const x0 = Math.max(0, Math.floor(x * scale));
  const y0 = Math.max(0, Math.floor(y * scale));
  const x1 = Math.min(width, Math.ceil((x + w) * scale));
  const y1 = Math.min(height, Math.ceil((y + h) * scale));
  let n = 0;
  let sum = 0;
  let sq = 0;
  const step = Math.max(1, Math.round(scale));
  for (let yy = y0; yy < y1; yy += step) {
    for (let xx = x0; xx < x1; xx += step) {
      if (skip && xx >= skip.x * scale && xx <= (skip.x + skip.w) * scale && yy >= skip.y * scale && yy <= (skip.y + skip.h) * scale) continue;
      const i = (yy * width + xx) * channels;
      const v = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      sum += v;
      sq += v * v;
      n++;
    }
  }
  if (!n) return 0;
  const m = sum / n;
  return Math.sqrt(Math.max(0, sq / n - m * m));
}

/** 상자(여백 포함)와 동그라미 자리 계산 — CSS px 좌표. 화면 밖으로 나가는 상자는 화면 안쪽으로 자른다.
 *  동그라미는 상자 바깥 둘레 후보 자리 중 다른 상자·동그라미와 겹치지 않고, 그 자리 그림이 가장 단순한(글자·그림이 적은) 곳에 둔다. */
export function layoutMarks(marks, vw, vh, img = null, obstacles = []) {
  sizeFor(vw);
  const boxes = marks.map((m) => {
    const x0 = Math.max(STROKE / 2, m.x - PAD);
    const y0 = Math.max(STROKE / 2, m.y - PAD);
    const x1 = Math.min(vw - STROKE / 2, m.x + m.w + PAD);
    const y1 = Math.min(vh - STROKE / 2, m.y + m.h + PAD);
    return { ...m, bx: x0, by: y0, bw: x1 - x0, bh: y1 - y0 };
  });
  const taken = boxes.map((b) => ({ x: b.bx - 2, y: b.by - 2, w: b.bw + 4, h: b.bh + 4 }));
  // 큰 상자가 작은 상자를 품는 경우(파란 점선 안의 빨간 상자) 큰 상자 자체는 장애물로 보지 않고 테두리 선만 피한다
  const edges = boxes.map((b) => [
    { x: b.bx - 3, y: b.by - 3, w: b.bw + 6, h: 6 },
    { x: b.bx - 3, y: b.by + b.bh - 3, w: b.bw + 6, h: 6 },
    { x: b.bx - 3, y: b.by - 3, w: 6, h: b.bh + 6 },
    { x: b.bx + b.bw - 3, y: b.by - 3, w: 6, h: b.bh + 6 },
  ]);
  const placed = [];
  boxes.forEach((b, bi) => {
    const cands = [];
    // 상자 모서리 위(버튼 모서리는 대개 비어 있다)
    cands.push([b.bx, b.by, 0], [b.bx + b.bw, b.by, 0.5], [b.bx, b.by + b.bh, 1], [b.bx + b.bw, b.by + b.bh, 1.5]);
    for (const extra of [0, 8]) {
      const d = R + 3 + extra;
      const e = 2.5 + extra * 2; // 바깥 자리는 기본 벌점 + 멀어질수록 벌점(어느 상자 번호인지 헷갈리지 않게)
      cands.push(
        [b.bx - d + 4, b.by - d + 4, 0 + e], // 왼쪽 위
        [b.bx + b.bw + d - 4, b.by - d + 4, 1 + e], // 오른쪽 위
        [b.bx - d - 1, b.by + b.bh / 2, 2 + e], // 왼쪽 가운데
        [b.bx + b.bw + d + 1, b.by + b.bh / 2, 3 + e], // 오른쪽 가운데
        [b.bx - d + 4, b.by + b.bh + d - 4, 4 + e], // 왼쪽 아래
        [b.bx + b.bw + d - 4, b.by + b.bh + d - 4, 5 + e], // 오른쪽 아래
        [b.bx + Math.min(b.bw / 2, 40), b.by - d, 2 + e], // 위(왼쪽 가까이)
        [b.bx + Math.min(b.bw / 2, 40), b.by + b.bh + d, 4 + e], // 아래(왼쪽 가까이)
      );
    }
    // 요소 둘레 안쪽(상자 자신)과 겹치는 장애물은 자기 요소이므로 뺀다
    const obs = obstacles
      .map(([x, y, w, h]) => ({ x, y, w, h }))
      .filter((o) => !(o.x >= b.bx - 1 && o.y >= b.by - 1 && o.x + o.w <= b.bx + b.bw + 1 && o.y + o.h <= b.by + b.bh + 1))
      .filter((o) => !(o.x <= b.x + 1 && o.y <= b.y + 1 && o.x + o.w >= b.x + b.w - 1 && o.y + o.h >= b.y + b.h - 1)); // 상자를 품는 큰 요소(라벨 등)
    let best = null;
    for (const [cx0, cy0, k] of cands) {
      // 모서리 자리는 화면 밖으로 나가면 안쪽으로 밀어 넣는다
      const cx = k <= 1.5 ? Math.min(Math.max(cx0, R + 1), vw - R - 1) : cx0;
      const cy = k <= 1.5 ? Math.min(Math.max(cy0, R + 1), vh - R - 1) : cy0;
      const c = { x: cx - R, y: cy - R, w: 2 * R, h: 2 * R };
      if (c.x < 1 || c.y < 1 || c.x + c.w > vw - 1 || c.y + c.h > vh - 1) continue;
      const hitBox = taken.some((t, ti) => {
        if (ti === bi || !inter(c, t)) return false;
        const o = boxes[ti];
        // 이 동그라미의 상자를 품는 큰 상자 안쪽이면 테두리만 피하면 된다
        const contains = o.bx <= b.bx && o.by <= b.by && o.bx + o.bw >= b.bx + b.bw && o.by + o.bh >= b.by + b.bh && ti !== bi;
        if (contains) return edges[ti].some((e) => inter(c, e));
        return true;
      });
      if (hitBox || placed.some((p) => inter(c, p))) continue;
      const dist = Math.hypot(cx - (b.bx + b.bw / 2), cy - (b.by + b.bh / 2));
      const covers = obs.reduce((n, o) => n + (inter(c, o) ? 1 : 0), 0);
      const score = busy(img, c.x, c.y, c.w, c.h, { x: b.bx, y: b.by, w: b.bw, h: b.bh }) + k * 0.8 + covers * 60;
      void dist;
      if (!best || score < best.score) best = { cx, cy, score, c };
    }
    if (!best) {
      // 자리가 없으면 상자 안쪽 왼쪽 위(작게라도 보이게)
      const cx = Math.min(Math.max(b.bx + R + 2, R + 1), vw - R - 1);
      const cy = Math.min(Math.max(b.by + R + 2, R + 1), vh - R - 1);
      best = { cx, cy, c: { x: cx - R, y: cy - R, w: 2 * R, h: 2 * R } };
    }
    placed.push(best.c);
    b.cx = best.cx;
    b.cy = best.cy;
  });
  return boxes;
}

/** 표시 글자: press → 1,2,3 / look → A,B,C */
export const markGlyph = (m) => (m.kind === 'look' ? String.fromCharCode(64 + m.n) : String(m.n));

function svgFor(boxes, vw, vh, scale) {
  const s = (v) => (v * scale).toFixed(1);
  const parts = [];
  for (const b of boxes) {
    const col = b.kind === 'look' ? LOOK : PRESS;
    const dash = b.kind === 'look' ? ` stroke-dasharray="${s(STROKE * 2.7)} ${s(STROKE * 1.7)}"` : '';
    // 흰 테두리(어두운 배경에서도 보이게) + 색 선
    parts.push(`<rect x="${s(b.bx)}" y="${s(b.by)}" width="${s(b.bw)}" height="${s(b.bh)}" rx="${s(R * 0.6)}" fill="none" stroke="#ffffff" stroke-opacity="0.85" stroke-width="${s(STROKE + 2)}"/>`);
    parts.push(`<rect x="${s(b.bx)}" y="${s(b.by)}" width="${s(b.bw)}" height="${s(b.bh)}" rx="${s(R * 0.6)}" fill="none" stroke="${col}" stroke-width="${s(STROKE)}"${dash}/>`);
  }
  for (const b of boxes) {
    const col = b.kind === 'look' ? LOOK : PRESS;
    parts.push(`<circle cx="${s(b.cx)}" cy="${s(b.cy)}" r="${s(R)}" fill="${col}" stroke="#ffffff" stroke-width="${s(STROKE * 0.7)}"/>`);
    parts.push(
      `<text x="${s(b.cx)}" y="${s(b.cy + FONT * 0.35)}" text-anchor="middle" font-family="Arial, 'Noto Sans KR', sans-serif" font-weight="700" font-size="${s(FONT)}" fill="#ffffff">${markGlyph(b)}</text>`,
    );
  }
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(vw * scale)}" height="${Math.round(vh * scale)}">${parts.join('')}</svg>`);
}

/**
 * shot: { file, vw, vh, marks: [{ n, kind, x, y, w, h }] } (CSS px). out: 결과 파일(.jpg/.png)
 * 반환: 그린 상자·동그라미 자리(CSS px) — 검사·보고용
 */
export async function annotate(inFile, outFile, shot) {
  const { data, info } = await sharp(inFile).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const scale = info.width / shot.vw;
  const boxes = layoutMarks(shot.marks, shot.vw, shot.vh, { data, width: info.width, height: info.height, channels: info.channels, scale }, shot.obstacles ?? []);
  const svg = svgFor(boxes, shot.vw, shot.vh, scale);
  let pipe = sharp(inFile).composite([{ input: svg, left: 0, top: 0 }]);
  pipe = outFile.endsWith('.jpg') ? pipe.jpeg({ quality: 88, mozjpeg: true }) : pipe.png();
  await pipe.toFile(outFile);
  return boxes;
}

/**
 * 확대 그림(작업 141): 표시(상자·동그라미)가 화면의 작은 부분에 몰려 있으면 그 부분을 잘라 크게 보여 준다.
 * 공략집 쪽에서 큰 화면은 너비 mainW(mm), 확대 칸은 높이 dispH(mm)·너비 mainW 이하로 놓인다.
 * 확대 배율이 minZoom보다 작으면(=표시가 화면 대부분에 퍼짐) null. 배율은 최대 maxZoom.
 */
export async function zoomCrop(annotatedFile, outFile, shot, boxes, o = {}) {
  const { mainW = 186, dispH = 48, minZoom = 1.5, maxZoom = 3 } = o;
  if (!boxes.length) return null;
  const k = Math.max(1, shot.vw / 1366);
  const pad = 22 * k;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.bx, b.cx - R);
    y0 = Math.min(y0, b.by, b.cy - R);
    x1 = Math.max(x1, b.bx + b.bw, b.cx + R);
    y1 = Math.max(y1, b.by + b.bh, b.cy + R);
  }
  const uw = x1 - x0 + 2 * pad;
  const uh = y1 - y0 + 2 * pad;
  const mmPerPx = mainW / shot.vw; // 큰 화면의 1px = ? mm
  const maxRatio = mainW / dispH;
  // 높이 h(px)가 dispH(mm)로 보이므로 배율 = dispH / (h * mmPerPx)
  let h = Math.max(uh, uw / maxRatio, dispH / (maxZoom * mmPerPx));
  const zoom = dispH / (h * mmPerPx);
  if (zoom < minZoom || h > shot.vh) return null;
  let w = Math.min(Math.max(uw, h * 3.2), h * maxRatio, shot.vw);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const left = Math.min(Math.max(0, cx - w / 2), shot.vw - w);
  const top = Math.min(Math.max(0, cy - h / 2), shot.vh - h);
  const meta = await sharp(annotatedFile).metadata();
  const sc = meta.width / shot.vw;
  const L = Math.max(0, Math.round(left * sc));
  const T = Math.max(0, Math.round(top * sc));
  const W = Math.max(1, Math.min(meta.width - L, Math.round(w * sc)));
  const H = Math.max(1, Math.min(meta.height - T, Math.round(h * sc)));
  await sharp(annotatedFile)
    .extract({ left: L, top: T, width: W, height: H })
    .jpeg({ quality: 90, mozjpeg: true })
    .toFile(outFile);
  return { x: left, y: top, w, h, zoom };
}
