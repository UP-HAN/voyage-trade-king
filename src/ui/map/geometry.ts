/**
 * 세계 해도 기하 계산(순수 함수) — 작업 106.
 * - 좌표계: PRD 6.3.1, viewBox 0 0 2700 1350 (1° = 10단위).
 * - 항로 좌표: routes.ts 의 경유점 그래프 최단 경로를 지도 좌표로 바꾸고 모서리를 둥글린 곡선으로 매끈하게.
 *   `routePoints()` 결과는 fx.sail(연출, 작업 201)에 그대로 넘길 수 있는 좌표 배열이다.
 */
import { nodePosition, shortestPath, waypoints } from '../../data/routes';
import type { PortId } from '../../data/types';

const chokepointIds = new Set(waypoints.filter((w) => w.chokepoint).map((w) => w.id));

export const MAP_W = 2700;
export const MAP_H = 1350;

export type XY = { x: number; y: number };

/** 지도용 동경(서경 +360 끝난 값) → 지도 좌표 */
export function lonLatToXY(lonE: number, lat: number): XY {
  return { x: (lonE + 20) * 10, y: (70 - lat) * 10 };
}

/** 항로 노드(항구·경유점) 지도 좌표 */
export function nodeXY(id: string): XY {
  const p = nodePosition(id);
  return lonLatToXY(p.lon, p.lat);
}

/** 'M x y L x y … Z' 형식(절대 좌표)의 path 를 다각형(점 배열) 목록으로 */
export function parsePolygons(d: string): XY[][] {
  const polys: XY[][] = [];
  for (const chunk of d.split('M')) {
    const body = chunk.replace(/Z/g, '').trim();
    if (!body) continue;
    const pts = body.split('L').map((pair) => {
      const [x, y] = pair.trim().split(/\s+/).map(Number);
      return { x: x!, y: y! };
    });
    if (pts.length >= 3) polys.push(pts);
  }
  return polys;
}

export interface PolyIndex {
  polys: XY[][];
  boxes: { minX: number; minY: number; maxX: number; maxY: number }[];
}

export function indexPolygons(polys: XY[][]): PolyIndex {
  return {
    polys,
    boxes: polys.map((p) => {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const q of p) {
        if (q.x < minX) minX = q.x;
        if (q.y < minY) minY = q.y;
        if (q.x > maxX) maxX = q.x;
        if (q.y > maxY) maxY = q.y;
      }
      return { minX, minY, maxX, maxY };
    }),
  };
}

/** 점이 육지 안인가(evenodd, 모든 고리 통틀어) */
export function pointInLand(idx: PolyIndex, pt: XY): boolean {
  let inside = false;
  for (let k = 0; k < idx.polys.length; k++) {
    const b = idx.boxes[k]!;
    if (pt.x < b.minX || pt.x > b.maxX || pt.y < b.minY || pt.y > b.maxY) continue;
    const poly = idx.polys[k]!;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i]!;
      const c = poly[j]!;
      if (a.y > pt.y !== c.y > pt.y && pt.x < ((c.x - a.x) * (pt.y - a.y)) / (c.y - a.y) + a.x) inside = !inside;
    }
  }
  return inside;
}

/** 점에서 가장 가까운 해안선까지 거리(지도 단위) */
export function distanceToCoast(idx: PolyIndex, pt: XY): number {
  let best = Infinity;
  for (const poly of idx.polys) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[j]!;
      const b = poly[i]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const l2 = dx * dx + dy * dy;
      const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / l2));
      const d = Math.hypot(pt.x - (a.x + t * dx), pt.y - (a.y + t * dy));
      if (d < best) best = d;
    }
  }
  return best;
}

/** 항로 모서리 둥글림 반경(지도 단위): 넓은 바다 / 해협(chokepoint) */
export const CORNER_RADIUS = 18;
export const CHOKEPOINT_CORNER_RADIUS = 3;

/**
 * 꺾은선 모서리를 둥글게(모서리마다 2차 베지어). 곡선은 늘 모서리 삼각형 안에 머물러
 * Catmull-Rom 처럼 바깥으로 부풀지 않으므로, 육지를 피해 놓은 경유점 선분을 벗어나지 않는다.
 * @param radius 모서리에서 잘라 내는 최대 길이(지도 단위). 선분 길이의 45%를 넘지 않는다.
 *               배열이면 점마다 따로 준다(해협처럼 좁은 곳은 작게).
 * @param segments 모서리 곡선 하나를 나누는 개수
 */
export function smoothPolyline(points: readonly XY[], radius: number | readonly number[] = CORNER_RADIUS, segments = 8): XY[] {
  if (points.length < 3) return points.slice();
  const out: XY[] = [points[0]!];
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const c = points[i + 1]!;
    const lab = Math.hypot(a.x - b.x, a.y - b.y);
    const lbc = Math.hypot(c.x - b.x, c.y - b.y);
    const rad = typeof radius === 'number' ? radius : (radius[i] ?? CORNER_RADIUS);
    const r = Math.min(rad, lab * 0.45, lbc * 0.45);
    if (r <= 0.01) {
      out.push(b);
      continue;
    }
    const p1 = { x: b.x + ((a.x - b.x) * r) / lab, y: b.y + ((a.y - b.y) * r) / lab };
    const p2 = { x: b.x + ((c.x - b.x) * r) / lbc, y: b.y + ((c.y - b.y) * r) / lbc };
    out.push(p1);
    for (let s = 1; s <= segments; s++) {
      const t = s / segments;
      const u = 1 - t;
      out.push({ x: u * u * p1.x + 2 * u * t * b.x + t * t * p2.x, y: u * u * p1.y + 2 * u * t * b.y + t * t * p2.y });
    }
  }
  out.push(points[points.length - 1]!);
  return out;
}

/** 최단 경로의 꺾은선 좌표(노드 순서) */
export function routeNodesXY(from: PortId, to: PortId): XY[] {
  return shortestPath(from, to).nodes.map(nodeXY);
}

/** 화면에 그리는 항로 곡선 좌표 — fx.sail(연출) 훅에 넘기는 값 */
export function routePoints(from: PortId, to: PortId): XY[] {
  if (from === to) return [nodeXY(from)];
  const nodes = shortestPath(from, to).nodes;
  const radii = nodes.map((id) => (chokepointIds.has(id) ? CHOKEPOINT_CORNER_RADIUS : CORNER_RADIUS));
  return smoothPolyline(nodes.map(nodeXY), radii);
}

/** 좌표 배열 → SVG path d */
export function toPathD(points: readonly XY[]): string {
  return points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('');
}

/** 선분을 `step` 단위 간격으로 샘플링(끝점 포함) */
export function samplePolyline(points: readonly XY[], step: number): XY[] {
  const out: XY[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let s = 0; s < n; s++) out.push({ x: a.x + ((b.x - a.x) * s) / n, y: a.y + ((b.y - a.y) * s) / n });
  }
  if (points.length) out.push(points[points.length - 1]!);
  return out;
}
