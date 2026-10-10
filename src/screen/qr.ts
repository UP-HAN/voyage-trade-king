/**
 * 아주 작은 QR 코드 만들기(작업 110 — 공용 화면 방 코드 장면). 새 라이브러리 없이 직접 구현했다.
 *
 * - 바이트 모드, 오류 정정 M(15%), 버전 1~10(바이트 최대 213자) — 짧은 주소(`lab.ches.es.kr/voyage/`)용.
 * - 표준(ISO/IEC 18004) 절차: 데이터 비트 → 리드-솔로몬 오류 정정 → 블록 섞기 → 기능 패턴 → 지그재그 배치 → 마스크 8종 중 벌점이 가장 낮은 것.
 * - 결과는 `boolean[][]`(행 우선, true = 검은 칸). 화면은 `QrCode` 컴포넌트가 SVG로 그린다.
 */

/** 버전별 오류 정정 M 블록당 정정 코드 수 / 블록 수 (인덱스 = 버전) */
const ECC_PER_BLOCK_M = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26] as const;
const BLOCKS_M = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5] as const;
/** 형식 정보의 오류 정정 단계 비트(M = 0) */
const FORMAT_BITS_M = 0;
export const QR_MAX_VERSION = 10;

/** GF(2^8) 곱(원시 다항식 0x11D) */
export function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

/** 리드-솔로몬 생성 다항식(차수 degree, 최고차 계수 1은 뺌) */
export function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMul(result[j] as number, root);
      if (j + 1 < result.length) result[j] = (result[j] as number) ^ (result[j + 1] as number);
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

/** 데이터 코드워드 → 오류 정정 코드워드 */
export function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coef, i) => {
      result[i] = (result[i] as number) ^ gfMul(coef, factor);
    });
  }
  return result;
}

/** 버전의 데이터+정정 모듈 수(기능 패턴 제외) */
function rawDataModules(ver: number): number {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

export function dataCodewords(ver: number): number {
  return Math.floor(rawDataModules(ver) / 8) - (ECC_PER_BLOCK_M[ver] as number) * (BLOCKS_M[ver] as number);
}

function alignmentPositions(ver: number): number[] {
  if (ver === 1) return [];
  const size = ver * 4 + 17;
  const numAlign = Math.floor(ver / 7) + 2;
  const step = Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

/** UTF-8 바이트 */
function utf8(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

/** 바이트 → 데이터 코드워드(모드·길이·끝 표시·채움 포함) */
export function encodeData(bytes: readonly number[], ver: number): number[] {
  const bits: number[] = [];
  const push = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, ver <= 9 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  const cap = dataCodewords(ver) * 8;
  push(0, Math.min(4, cap - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) push(pad, 8);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | (bits[i + j] as number);
    out.push(v);
  }
  return out;
}

/** 블록으로 나눠 정정 코드를 붙이고 섞는다 */
export function addEccAndInterleave(data: readonly number[], ver: number): number[] {
  const numBlocks = BLOCKS_M[ver] as number;
  const eccLen = ECC_PER_BLOCK_M[ver] as number;
  const rawCodewords = Math.floor(rawDataModules(ver) / 8);
  const numShort = numBlocks - (rawCodewords % numBlocks);
  const shortLen = Math.floor(rawCodewords / numBlocks);
  const divisor = rsDivisor(eccLen);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < numShort ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, divisor);
    if (i < numShort) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const result: number[] = [];
  for (let i = 0; i < (blocks[0] as number[]).length; i++) {
    blocks.forEach((blk, j) => {
      if (i !== shortLen - eccLen || j >= numShort) result.push(blk[i] as number);
    });
  }
  return result;
}

/** 형식 정보 15비트(오류 정정 M + 마스크) */
export function formatBits(mask: number, eccBits = FORMAT_BITS_M): number {
  const data = (eccBits << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

/** 버전 정보 18비트(버전 7 이상) */
export function versionBits(ver: number): number {
  let rem = ver;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (ver << 12) | rem;
}

const bit = (x: number, i: number) => ((x >>> i) & 1) !== 0;

function maskBit(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

class Grid {
  readonly size: number;
  readonly m: boolean[][];
  readonly fn: boolean[][];
  constructor(readonly ver: number) {
    this.size = ver * 4 + 17;
    this.m = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.fn = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
  }
  setFn(x: number, y: number, dark: boolean) {
    (this.m[y] as boolean[])[x] = dark;
    (this.fn[y] as boolean[])[x] = true;
  }
  drawFunctionPatterns() {
    const s = this.size;
    for (let i = 0; i < s; i++) {
      this.setFn(6, i, i % 2 === 0);
      this.setFn(i, 6, i % 2 === 0);
    }
    this.finder(3, 3);
    this.finder(s - 4, 3);
    this.finder(3, s - 4);
    const pos = alignmentPositions(this.ver);
    const n = pos.length;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
        this.alignment(pos[i] as number, pos[j] as number);
      }
    }
    this.drawFormat(0);
    this.drawVersion();
  }
  finder(x: number, y: number) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size) this.setFn(xx, yy, dist !== 2 && dist !== 4);
      }
    }
  }
  alignment(x: number, y: number) {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) this.setFn(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  drawFormat(mask: number) {
    const b = formatBits(mask);
    const s = this.size;
    for (let i = 0; i <= 5; i++) this.setFn(8, i, bit(b, i));
    this.setFn(8, 7, bit(b, 6));
    this.setFn(8, 8, bit(b, 7));
    this.setFn(7, 8, bit(b, 8));
    for (let i = 9; i < 15; i++) this.setFn(14 - i, 8, bit(b, i));
    for (let i = 0; i < 8; i++) this.setFn(s - 1 - i, 8, bit(b, i));
    for (let i = 8; i < 15; i++) this.setFn(8, s - 15 + i, bit(b, i));
    this.setFn(8, s - 8, true);
  }
  drawVersion() {
    if (this.ver < 7) return;
    const b = versionBits(this.ver);
    for (let i = 0; i < 18; i++) {
      const v = bit(b, i);
      const a = this.size - 11 + (i % 3);
      const c = Math.floor(i / 3);
      this.setFn(a, c, v);
      this.setFn(c, a, v);
    }
  }
  drawCodewords(data: readonly number[]) {
    const s = this.size;
    let i = 0;
    for (let right = s - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < s; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? s - 1 - vert : vert;
          if (!(this.fn[y] as boolean[])[x] && i < data.length * 8) {
            (this.m[y] as boolean[])[x] = bit(data[i >>> 3] as number, 7 - (i & 7));
            i++;
          }
        }
      }
    }
  }
  applyMask(mask: number) {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (!(this.fn[y] as boolean[])[x] && maskBit(mask, x, y)) (this.m[y] as boolean[])[x] = !(this.m[y] as boolean[])[x];
      }
    }
  }
}

/** 마스크 벌점(규칙 1~4) */
export function penalty(m: readonly (readonly boolean[])[]): number {
  const s = m.length;
  let score = 0;
  const at = (x: number, y: number) => (m[y] as readonly boolean[])[x] as boolean;
  const lines: boolean[][] = [];
  for (let y = 0; y < s; y++) lines.push([...(m[y] as boolean[])]);
  for (let x = 0; x < s; x++) lines.push(Array.from({ length: s }, (_, y) => at(x, y)));
  const P1 = [true, false, true, true, true, false, true, false, false, false, false];
  const P2 = [...P1].reverse();
  for (const line of lines) {
    let run = 1;
    for (let i = 1; i <= s; i++) {
      if (i < s && line[i] === line[i - 1]) run++;
      else {
        if (run >= 5) score += 3 + (run - 5);
        run = 1;
      }
    }
    for (let i = 0; i + 11 <= s; i++) {
      let a = true;
      let b = true;
      for (let k = 0; k < 11; k++) {
        if (line[i + k] !== P1[k]) a = false;
        if (line[i + k] !== P2[k]) b = false;
      }
      if (a) score += 40;
      if (b) score += 40;
    }
  }
  for (let y = 0; y + 1 < s; y++) {
    for (let x = 0; x + 1 < s; x++) {
      const c = at(x, y);
      if (c === at(x + 1, y) && c === at(x, y + 1) && c === at(x + 1, y + 1)) score += 3;
    }
  }
  let dark = 0;
  for (const row of m) for (const c of row) if (c) dark++;
  const total = s * s;
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  return score + Math.max(0, k) * 10;
}

export interface QrMatrix {
  version: number;
  mask: number;
  size: number;
  modules: boolean[][];
}

/** 글자 → QR 행렬. 너무 길면 null */
export function makeQr(text: string, forceMask?: number): QrMatrix | null {
  const bytes = utf8(text);
  let ver = 1;
  for (; ver <= QR_MAX_VERSION; ver++) {
    const lenBits = ver <= 9 ? 8 : 16;
    if (4 + lenBits + bytes.length * 8 <= dataCodewords(ver) * 8) break;
  }
  if (ver > QR_MAX_VERSION) return null;
  const codewords = addEccAndInterleave(encodeData(bytes, ver), ver);
  let best: Grid | null = null;
  let bestMask = 0;
  let bestScore = Infinity;
  const masks = forceMask !== undefined ? [forceMask] : [0, 1, 2, 3, 4, 5, 6, 7];
  for (const mask of masks) {
    const g = new Grid(ver);
    g.drawFunctionPatterns();
    g.drawCodewords(codewords);
    g.applyMask(mask);
    g.drawFormat(mask);
    const sc = penalty(g.m);
    if (sc < bestScore) {
      best = g;
      bestScore = sc;
      bestMask = mask;
    }
  }
  const g = best as Grid;
  return { version: ver, mask: bestMask, size: g.size, modules: g.m };
}
