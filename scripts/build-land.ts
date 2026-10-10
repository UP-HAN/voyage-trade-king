/**
 * 육지 레이어 생성기 (PRD 6.3.1, 작업 106).
 *
 * 사용법: node scripts/run-ts.mjs scripts/build-land.ts [입력.geojson] [출력.ts]
 *   - 입력 기본값: scripts/data-src/ne_110m_land.geojson
 *     (Natural Earth 1:110m Land, 퍼블릭 도메인 — 공식 GitHub nvkelso/natural-earth-vector 의 geojson/ne_110m_land.geojson)
 *   - 출력 기본값: src/data/world-land.ts
 *
 * 처리 순서
 *   1. 고리(ring)마다 경도 −20° 선으로 나눈다. −20° 보다 서쪽 부분은 +360° 옮긴다(아메리카 서해안이 오른쪽 끝에 오도록).
 *   2. 지도 범위(경도 −20°~250°E, 위도 70°N~65°S) 밖을 잘라 낸다(Sutherland–Hodgman, 반평면 4개).
 *   3. 투영: x = (lonE + 20) × 10, y = (70 − lat) × 10.
 *   4. Douglas–Peucker 단순화(허용 오차 SIMPLIFY_TOLERANCE 단위 = 0.06°). 아주 작은 고리는 버린다.
 *   5. 채움용 path(닫힌 다각형)와 해안선용 path(지도 가장자리·경도 180° 자르기 선을 뺀 열린 선)를 따로 만든다.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MAP_W = 2700;
const MAP_H = 1350;
const LON_MIN = -20;
const LON_MAX = 250;
const LAT_MAX = 70;
const LAT_MIN = -65;
/** 단순화 허용 오차(지도 단위, 10단위 = 1°) */
export const SIMPLIFY_TOLERANCE = 0.6;
/** 이보다 넓이가 작은 고리(지도 단위²)는 버린다 — 1366px 화면에서 점 하나도 안 되는 섬 */
export const MIN_RING_AREA = 4;

type Pt = [number, number];

interface Geometry {
  type: string;
  coordinates: unknown;
}

function ringsOf(geom: Geometry): Pt[][] {
  if (geom.type === 'Polygon') return geom.coordinates as Pt[][];
  if (geom.type === 'MultiPolygon') return (geom.coordinates as Pt[][][]).flat();
  return [];
}

/** 반평면 자르기: inside(p) 가 참인 쪽만 남긴다. cross(a,b) 는 경계와의 교점 */
function clipRing(ring: Pt[], inside: (p: Pt) => boolean, cross: (a: Pt, b: Pt) => Pt): Pt[] {
  const out: Pt[] = [];
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const cur = ring[i]!;
    const prev = ring[(i + n - 1) % n]!;
    const cin = inside(cur);
    const pin = inside(prev);
    if (cin) {
      if (!pin) out.push(cross(prev, cur));
      out.push(cur);
    } else if (pin) {
      out.push(cross(prev, cur));
    }
  }
  return out;
}

const atLon = (lon: number) => (a: Pt, b: Pt): Pt => {
  const t = (lon - a[0]) / (b[0] - a[0]);
  return [lon, a[1] + (b[1] - a[1]) * t];
};
const atLat = (lat: number) => (a: Pt, b: Pt): Pt => {
  const t = (lat - a[1]) / (b[1] - a[1]);
  return [a[0] + (b[0] - a[0]) * t, lat];
};

function clipToMap(ring: Pt[]): Pt[] {
  let r = ring;
  r = clipRing(r, (p) => p[0] >= LON_MIN, atLon(LON_MIN));
  if (r.length) r = clipRing(r, (p) => p[0] <= LON_MAX, atLon(LON_MAX));
  if (r.length) r = clipRing(r, (p) => p[1] <= LAT_MAX, atLat(LAT_MAX));
  if (r.length) r = clipRing(r, (p) => p[1] >= LAT_MIN, atLat(LAT_MIN));
  return r;
}

/** 원본 고리(경도 −180~180)를 지도 경도(−20~340)의 고리 1~2개로 */
function splitAtMinus20(ring: Pt[]): Pt[][] {
  // GeoJSON 고리는 첫 점 = 끝 점. 자르기용으로 끝 점을 뺀다
  const open = ring.length > 1 && ring[0]![0] === ring[ring.length - 1]![0] && ring[0]![1] === ring[ring.length - 1]![1]
    ? ring.slice(0, -1)
    : ring.slice();
  const east = clipRing(open, (p) => p[0] >= LON_MIN, atLon(LON_MIN));
  const west = clipRing(open, (p) => p[0] < LON_MIN, atLon(LON_MIN)).map(([lon, lat]): Pt => [lon + 360, lat]);
  return [east, west].filter((r) => r.length >= 3);
}

function project([lon, lat]: Pt): Pt {
  return [(lon + 20) * 10, (70 - lat) * 10];
}

function perpDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function douglasPeucker(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = perpDist(pts[i]!, pts[s]!, pts[e]!);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx >= 0 && maxD > tol) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** 닫힌 고리 단순화: 가장 먼 두 점을 고정점으로 두 반쪽을 따로 단순화 */
function simplifyRing(ring: Pt[], tol: number): Pt[] {
  if (ring.length < 4) return ring;
  let far = 0;
  let farD = -1;
  for (let i = 1; i < ring.length; i++) {
    const d = Math.hypot(ring[i]![0] - ring[0]![0], ring[i]![1] - ring[0]![1]);
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  const a = douglasPeucker(ring.slice(0, far + 1), tol);
  const b = douglasPeucker([...ring.slice(far), ring[0]!], tol);
  return [...a, ...b.slice(1, -1)];
}

function area(ring: Pt[]): number {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!;
    const q = ring[(i + 1) % ring.length]!;
    s += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(s) / 2;
}

const fmt = (v: number) => {
  const r = Math.round(v * 10) / 10;
  return Object.is(r, -0) ? '0' : String(r);
};

/** 지도 가장자리·경도 180°(x=2000) 자르기 선 위의 선분인가 — 해안선이 아니다 */
function isCutEdge(a: Pt, b: Pt): boolean {
  const eps = 0.05;
  const sameX = (v: number) => Math.abs(a[0] - v) < eps && Math.abs(b[0] - v) < eps;
  const sameY = (v: number) => Math.abs(a[1] - v) < eps && Math.abs(b[1] - v) < eps;
  return sameX(0) || sameX(MAP_W) || sameX(2000) || sameY(0) || sameY(MAP_H);
}

export interface LandBuild {
  fill: string;
  coast: string;
  rings: number;
  points: number;
  sourcePoints: number;
}

export function buildLand(geojson: { features: { geometry: Geometry }[] }): LandBuild {
  const fillParts: string[] = [];
  const coastParts: string[] = [];
  let rings = 0;
  let points = 0;
  let sourcePoints = 0;
  for (const f of geojson.features) {
    for (const ring of ringsOf(f.geometry)) {
      sourcePoints += ring.length;
      for (const part of splitAtMinus20(ring)) {
        const clipped = clipToMap(part);
        if (clipped.length < 3) continue;
        const projected = clipped.map(project);
        // 연속 중복 점 제거
        const dedup = projected.filter((p, i) => {
          const q = projected[(i + projected.length - 1) % projected.length]!;
          return Math.abs(p[0] - q[0]) > 1e-6 || Math.abs(p[1] - q[1]) > 1e-6;
        });
        const simple = simplifyRing(dedup, SIMPLIFY_TOLERANCE);
        if (simple.length < 3 || area(simple) < MIN_RING_AREA) continue;
        rings++;
        points += simple.length;
        fillParts.push(`M${simple.map((p) => `${fmt(p[0])} ${fmt(p[1])}`).join('L')}Z`);
        // 해안선: 자르기 선을 뺀 연속 구간들
        const n = simple.length;
        // 시작점을 자르기 선분 바로 뒤로 돌려 구간이 고리 끝에서 끊기지 않게 한다
        let start = 0;
        for (let i = 0; i < n; i++) {
          if (isCutEdge(simple[(i + n - 1) % n]!, simple[i]!)) {
            start = i;
            break;
          }
        }
        let run: Pt[] = [simple[start]!];
        const flush = () => {
          if (run.length >= 2) coastParts.push(`M${run.map((p) => `${fmt(p[0])} ${fmt(p[1])}`).join('L')}`);
        };
        for (let k = 1; k <= n; k++) {
          const a = simple[(start + k - 1) % n]!;
          const b = simple[(start + k) % n]!;
          if (isCutEdge(a, b)) {
            flush();
            run = [b];
          } else run.push(b);
        }
        flush();
      }
    }
  }
  return { fill: fillParts.join(''), coast: coastParts.join(''), rings, points, sourcePoints };
}

export default function main(args: string[]): number {
  const input = resolve(process.cwd(), args[0] ?? 'scripts/data-src/ne_110m_land.geojson');
  const output = resolve(process.cwd(), args[1] ?? 'src/data/world-land.ts');
  const geojson = JSON.parse(readFileSync(input, 'utf8'));
  const land = buildLand(geojson);
  const body = `/**
 * 세계 육지 SVG 경로 — 자동 생성 파일. 직접 고치지 말고 \`node scripts/run-ts.mjs scripts/build-land.ts\` 로 다시 만든다.
 *
 * 출처: Natural Earth 1:110m Physical Vectors — Land (ne_110m_land)
 *       https://www.naturalearthdata.com/ (GitHub nvkelso/natural-earth-vector, geojson/ne_110m_land.geojson)
 * 라이선스: 퍼블릭 도메인(Public Domain). "Made with Natural Earth."
 *           https://www.naturalearthdata.com/about/terms-of-use/
 *
 * 투영(PRD 6.3.1): 정거원통도법, viewBox 0 0 ${MAP_W} ${MAP_H}, x = (lonE + 20) × 10, y = (70 − lat) × 10,
 *   lonE = lon < −20 ? lon + 360 : lon. 범위 경도 −20°~250°E, 위도 70°N~65°S 밖은 잘라 냈다.
 * 단순화: Douglas–Peucker 허용 오차 ${SIMPLIFY_TOLERANCE}단위(${SIMPLIFY_TOLERANCE / 10}°), 넓이 ${MIN_RING_AREA}단위² 미만 고리 제외.
 * 원본 점 ${land.sourcePoints}개 → 고리 ${land.rings}개, 점 ${land.points}개.
 */

/** 육지 채움용 닫힌 다각형(M…L…Z, 절대 좌표). fill-rule: evenodd */
export const LAND_PATH =
  '${land.fill}';

/** 해안선(열린 선). 지도 가장자리·경도 180° 자르기 선은 뺐다 */
export const COAST_PATH =
  '${land.coast}';
`;
  writeFileSync(output, body, 'utf8');
  console.log(`world-land: 고리 ${land.rings}개, 점 ${land.points}개(원본 ${land.sourcePoints}), ${(body.length / 1024).toFixed(1)}KB → ${output}`);
  return 0;
}
