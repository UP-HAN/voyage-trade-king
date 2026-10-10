/**
 * 항로 육지 겹침 검사(작업 106, PRD 6.3.1) + 거리 단계(PRD 6.8) 재확인 + 항구 좌표 검증.
 * - 모든 항구 쌍의 최단 경로를 (1) 경유점 꺾은선 (2) 화면에 그리는 둥근 곡선 두 가지로 2단위(0.2°) 간격 샘플링해
 *   육지(Natural Earth 110m, src/data/world-land.ts) 안에 들어가는 점이 없는지 본다.
 * - 항구 좌표 둘레 반경 15단위는 뺀다(항구는 해안에 있음). 경로가 지나가는 중간 항구도 같다.
 * - 수에즈 운하(suez ↔ portSaid)는 실제 운하라 육지를 지나는 것이 맞으므로 그 선분 둘레 3단위는 뺀다.
 */
import { describe, expect, it } from 'vitest';
import { LAND_PATH } from '../../src/data/world-land';
import { PORT_IDS, ports } from '../../src/data/ports';
import { distanceSteps, EXPECTED_STEPS_FROM_BUSAN, routeEdges, shortestPath, waypoints } from '../../src/data/routes';
import {
  distanceToCoast,
  indexPolygons,
  nodeXY,
  parsePolygons,
  pointInLand,
  routeNodesXY,
  routePoints,
  samplePolyline,
  type XY,
} from '../../src/ui/map/geometry';

const PORT_RADIUS = 15;
const STEP = 2;
const CANAL_EDGES: readonly [string, string][] = [['suez', 'portSaid']];
const CANAL_HALF_WIDTH = 3;

const land = indexPolygons(parsePolygons(LAND_PATH));
const portXY = PORT_IDS.map((id) => nodeXY(id));
const canalSegs = CANAL_EDGES.map(([a, b]) => [nodeXY(a), nodeXY(b)] as const);

function distToSeg(p: XY, a: XY, b: XY): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function exempt(p: XY): boolean {
  if (portXY.some((q) => Math.hypot(p.x - q.x, p.y - q.y) <= PORT_RADIUS)) return true;
  return canalSegs.some(([a, b]) => distToSeg(p, a, b) <= CANAL_HALF_WIDTH);
}

function landHits(points: readonly XY[]): XY[] {
  return samplePolyline(points, STEP).filter((p) => !exempt(p) && pointInLand(land, p));
}

const fmt = (pts: XY[]) => pts.slice(0, 3).map((p) => `(${p.x.toFixed(0)},${p.y.toFixed(0)})`).join(' ');

describe('육지 데이터', () => {
  it('육지 다각형이 있고 지도 범위 안이다', () => {
    expect(land.polys.length).toBeGreaterThan(30);
    for (const b of land.boxes) {
      expect(b.minX).toBeGreaterThanOrEqual(0);
      expect(b.maxX).toBeLessThanOrEqual(2700);
      expect(b.minY).toBeGreaterThanOrEqual(0);
      expect(b.maxY).toBeLessThanOrEqual(1350);
    }
  });

  it('알려진 육지·바다 점이 맞게 판정된다(투영·경도 이동 확인)', () => {
    const at = (lon: number, lat: number) => pointInLand(land, nodeXYLonLat(lon, lat));
    // 육지: 서울, 베이징, 델리, 리야드, 파리, 나이로비, 앨리스스프링스, 솔트레이크시티(서경 → +360), 도쿄 북쪽 내륙
    expect(at(127.0, 37.5)).toBe(true);
    expect(at(116.4, 39.9)).toBe(true);
    expect(at(77.2, 28.6)).toBe(true);
    expect(at(46.7, 24.7)).toBe(true);
    expect(at(2.35, 48.85)).toBe(true);
    expect(at(36.8, -1.3)).toBe(true);
    expect(at(133.9, -23.7)).toBe(true);
    expect(at(-112.0, 40.8)).toBe(true);
    expect(at(139.5, 36.5)).toBe(true);
    // 바다: 동해, 남중국해, 벵골만, 아라비아해, 지중해, 북태평양, 인도양 남부, 태즈먼해
    expect(at(134.0, 40.0)).toBe(false);
    expect(at(113.0, 14.0)).toBe(false);
    expect(at(88.0, 15.0)).toBe(false);
    expect(at(64.0, 15.0)).toBe(false);
    expect(at(18.0, 35.0)).toBe(false);
    expect(at(-160.0, 40.0)).toBe(false);
    expect(at(80.0, -30.0)).toBe(false);
    expect(at(160.0, -38.0)).toBe(false);
  });
});

function nodeXYLonLat(lon: number, lat: number): XY {
  const lonE = lon < -20 ? lon + 360 : lon;
  return { x: (lonE + 20) * 10, y: (70 - lat) * 10 };
}

describe('항로 육지 겹침(PRD 6.3.1)', () => {
  it('경유점은 모두 바다 위다', () => {
    const bad = waypoints.filter((w) => pointInLand(land, nodeXY(w.id))).map((w) => w.id);
    expect(bad).toEqual([]);
  });

  it('간선마다 꺾은선이 육지를 지나지 않는다(운하 제외)', () => {
    const bad: string[] = [];
    for (const e of routeEdges) {
      const hits = landHits([nodeXY(e.a), nodeXY(e.b)]);
      if (hits.length) bad.push(`${e.a}–${e.b}: ${hits.length}점 ${fmt(hits)}`);
    }
    expect(bad).toEqual([]);
  });

  it('모든 항구 쌍의 최단 경로(꺾은선·화면 곡선)가 육지를 지나지 않는다', () => {
    const bad: string[] = [];
    let pairs = 0;
    for (const a of PORT_IDS) {
      for (const b of PORT_IDS) {
        if (a >= b) continue;
        pairs++;
        const straight = landHits(routeNodesXY(a, b));
        const curve = landHits(routePoints(a, b));
        if (straight.length) bad.push(`${a}→${b} 꺾은선 ${straight.length}점 ${fmt(straight)}`);
        if (curve.length) bad.push(`${a}→${b} 곡선 ${curve.length}점 ${fmt(curve)}`);
      }
    }
    expect(pairs).toBe(66);
    expect(bad).toEqual([]);
  });

  it('화면 곡선은 출발·도착 항구 좌표에서 시작·끝난다', () => {
    const pts = routePoints('BUS', 'ROT');
    expect(pts[0]).toEqual(nodeXY('BUS'));
    expect(pts[pts.length - 1]).toEqual(nodeXY('ROT'));
    expect(pts.length).toBeGreaterThan(shortestPath('BUS', 'ROT').nodes.length);
  });
});

describe('거리 단계(PRD 6.8) — 경유점 조정 뒤 재확인', () => {
  it('부산 출발 거리 단계가 기대 범위 안이다', () => {
    const rows: Record<string, string> = {};
    for (const [port, range] of Object.entries(EXPECTED_STEPS_FROM_BUSAN)) {
      const id = port as (typeof PORT_IDS)[number];
      const s = distanceSteps('BUS', id);
      rows[port] = `${s}단계 (${shortestPath('BUS', id).length.toFixed(1)}°, 기대 ${range![0]}~${range![1]})`;
      expect(s, `BUS→${port}`).toBeGreaterThanOrEqual(range![0]);
      expect(s, `BUS→${port}`).toBeLessThanOrEqual(range![1]);
    }
    console.table(rows);
  });
});

describe('항구 좌표(PRD 6.3.2)', () => {
  it('항구 표식은 바다 쪽(또는 해안선 위)이고 해안에서 2° 안이다', () => {
    for (const p of ports) {
      const xy = { x: p.x, y: p.y };
      const inLand = pointInLand(land, xy);
      const d = distanceToCoast(land, xy);
      // 육지 안이라도 해안선에서 3단위 이내면 '해안선 위'로 본다
      expect(!inLand || d <= 3, `${p.id} 육지 안쪽 ${d.toFixed(1)}단위`).toBe(true);
      expect(d, `${p.id} 해안에서 너무 멂`).toBeLessThanOrEqual(20);
    }
  });

  it('항구 x·y 는 lon·lat 투영값과 ±10 이내다', () => {
    for (const p of ports) {
      const q = nodeXYLonLat(p.lon, p.lat);
      expect(Math.abs(q.x - p.x), p.id).toBeLessThanOrEqual(10);
      expect(Math.abs(q.y - p.y), p.id).toBeLessThanOrEqual(10);
    }
  });
});
