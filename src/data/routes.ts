/**
 * 항로: 경유점(waypoint) 그래프 + 최단 경로 (PRD 6.3.1, 6.8) — [게임 설정].
 *
 * 설계
 * - 노드 = 항구 12곳 + 바다 위 경유점(해협·곶·대양 한가운데). 간선은 육지를 가로지르지 않게 이었다.
 *   실제 육지 겹침 검사와 미세 조정은 작업 106(Natural Earth 육지 데이터)이 했다(검사: tests/map/routes-land.test.ts).
 *   106에서 경유점 20개 위치를 옮기고 hormuzS 하나를 더했다(110m 해안선의 호르무즈 해협이 좁아서).
 *   수에즈 운하(suez ↔ portSaid) 선분은 실제 운하라 육지를 지나는 것이 맞다(검사에서 뺌).
 * - 유럽 항로는 **수에즈 운하·홍해**를 지난다(희망봉이 아님). 까닭:
 *   ① 오늘날 아시아~유럽 정기 항로가 실제로 쓰는 길이고, ② 돌발 사건 'canal'(로테르담 항로 혼잡, PRD 6.15.4)이
 *   가리킬 '유럽으로 가는 길목'이 분명하며(`EUROPE_GATEWAY`), ③ 희망봉으로 돌면 지도에서 아프리카를 크게 돌아
 *   로테르담이 지나치게 멀어진다(거리 단계 12 이상).
 * - 파나마 운하는 쓰지 않는다(대서양~태평양을 잇는 항로가 필요한 항구 조합이 없음 — 로스앤젤레스는 태평양으로 간다).
 * - 태평양 횡단은 일본 동쪽에서 북태평양(대권 항로처럼 위로 휜 길)을 지나 로스앤젤레스로 간다.
 *
 * 거리 단계(PRD 6.8): 운항비 = 거리 단계 × 10만 원 × 배의 운항비 배수.
 *   거리 단계 = ceil(항로 길이(도) × ROUTE_LENGTH_FACTOR ÷ DEGREES_PER_STEP), 최소 1.
 *   항로 길이 = 경유점 사이 직선 길이(경도·위도 평면, 도 단위)의 합 × 간선 가중치.
 *   PRD 6.8 기대값(부산 출발)에 맞추려고 ROUTE_LENGTH_FACTOR 를 1.5 로, 큰 바다(태평양·필리핀해) 횡단 간선의
 *   가중치를 1.1 로 두었다. 결과 표는 tests/data/routes.test.ts 와 작업 102 result.md 에 있다.
 */
import { portsById, toLonE } from './ports';
import type { PortId, RouteEdge, Waypoint } from './types';

/** PRD 6.8: 항로 길이(도)를 이 값으로 나눠 올림 */
export const DEGREES_PER_STEP = 30;
/** [게임 설정] 거리 계수 — PRD 6.8 기대 거리 단계에 맞춘 값 */
export const ROUTE_LENGTH_FACTOR = 1.5;
/** [게임 설정] 큰 바다를 가로지르는 간선 가중치 */
export const OCEAN_EDGE_WEIGHT = 1.1;
/** 운항비(만 원) = 거리 단계 × 이 값 × 배의 운항비 배수 */
export const VOYAGE_COST_PER_STEP = 10;

/** 바다 위 경유점. lon 은 지도용 동경 값(서경은 +360)으로 적는다 */
export const waypoints: readonly Waypoint[] = [
  // 동아시아
  { id: 'koreaStrait', name: '대한 해협', lon: 128.6, lat: 33.0, chokepoint: true },
  { id: 'eastChinaSea', name: '동중국해', lon: 125.0, lat: 30.0 },
  { id: 'japanSouth', name: '규슈 남쪽 바다', lon: 130.8, lat: 30.2 },
  { id: 'kiiChannel', name: '일본 남쪽 바다', lon: 136.5, lat: 33.2 },
  { id: 'boso', name: '일본 동쪽 바다', lon: 141.0, lat: 34.6 },
  // 태평양 횡단
  { id: 'pacificW', name: '북태평양 서쪽', lon: 150.0, lat: 40.0 },
  { id: 'pacificC', name: '북태평양 가운데', lon: 167.0, lat: 46.0 },
  { id: 'pacificN', name: '북태평양 북쪽', lon: 185.0, lat: 50.0 },
  { id: 'pacificE', name: '북태평양 동쪽', lon: 208.0, lat: 48.5 },
  { id: 'calCoast', name: '캘리포니아 앞바다', lon: 229.0, lat: 38.2 },
  // 남중국해·동남아
  { id: 'taiwanStrait', name: '타이완 해협', lon: 119.8, lat: 24.0, chokepoint: true },
  { id: 'luzonStrait', name: '루손 해협', lon: 121.0, lat: 20.5, chokepoint: true },
  { id: 'scsNorth', name: '남중국해 북쪽', lon: 115.0, lat: 17.0 },
  { id: 'scsSouth', name: '남중국해 남쪽', lon: 109.0, lat: 6.5 },
  { id: 'vnSouth', name: '베트남 남쪽 바다', lon: 105.6, lat: 7.0 },
  { id: 'gulfThailand', name: '타이만', lon: 101.5, lat: 9.5 },
  { id: 'singaporeStrait', name: '싱가포르 해협', lon: 104.6, lat: 1.3, chokepoint: true },
  { id: 'karimata', name: '카리마타 해협', lon: 107.5, lat: -2.0, chokepoint: true },
  { id: 'javaSea', name: '자와해', lon: 110.0, lat: -4.6 },
  // 필리핀 동쪽 → 오스트레일리아
  { id: 'philippineSea', name: '필리핀해', lon: 127.5, lat: 18.0 },
  { id: 'samar', name: '민다나오 남동쪽 바다', lon: 127.5, lat: 3.8 },
  { id: 'celebesSea', name: '술라웨시해', lon: 119.8, lat: 1.6 },
  { id: 'makassar', name: '마카사르 해협', lon: 118.5, lat: -2.5, chokepoint: true },
  { id: 'lombok', name: '롬복 해협', lon: 116.2, lat: -8.3, chokepoint: true },
  { id: 'timorSea', name: '인도양 동쪽', lon: 114.5, lat: -15.5 },
  // 인도양
  { id: 'malacca', name: '말라카 해협', lon: 100.71, lat: 2.58, chokepoint: true },
  { id: 'malaccaN', name: '말라카 해협 북쪽', lon: 96.5, lat: 6.2 },
  { id: 'dondra', name: '스리랑카 남쪽 바다', lon: 80.5, lat: 5.2 },
  { id: 'malabar', name: '인도 서해안 앞바다', lon: 74.0, lat: 9.5 },
  { id: 'arabianSea', name: '아라비아해', lon: 62.0, lat: 17.0 },
  { id: 'hormuzS', name: '호르무즈 해협 남쪽', lon: 57.65, lat: 25.3 },
  { id: 'gulfOman', name: '오만만', lon: 60.0, lat: 23.4 },
  { id: 'hormuz', name: '호르무즈 해협', lon: 56.8, lat: 26.65, chokepoint: true },
  { id: 'gulfMid', name: '페르시아만', lon: 52.5, lat: 25.9 },
  // 홍해·수에즈·지중해
  { id: 'aden', name: '아덴만', lon: 49.0, lat: 13.0 },
  { id: 'babElMandeb', name: '바브엘만데브 해협', lon: 43.5, lat: 12.36, chokepoint: true },
  { id: 'redSea', name: '홍해', lon: 38.0, lat: 20.5 },
  { id: 'suez', name: '수에즈 운하', lon: 32.8, lat: 28.8, chokepoint: true },
  { id: 'portSaid', name: '수에즈 운하 북쪽 입구', lon: 32.3, lat: 31.6 },
  { id: 'medE', name: '지중해 동쪽', lon: 25.0, lat: 33.2 },
  { id: 'sicily', name: '시칠리아 해협', lon: 11.8, lat: 37.7, chokepoint: true },
  { id: 'medW', name: '지중해 서쪽', lon: 3.2, lat: 37.2 },
  { id: 'gibraltar', name: '지브롤터 해협', lon: -5.6, lat: 35.85, chokepoint: true },
  // 대서양 동쪽 → 북해
  { id: 'stVincent', name: '이베리아반도 남서쪽 바다', lon: -9.8, lat: 36.5 },
  { id: 'finisterre', name: '이베리아반도 북서쪽 바다', lon: -9.8, lat: 43.0 },
  { id: 'ushant', name: '비스케이만 북쪽', lon: -5.3, lat: 48.5 },
  { id: 'dover', name: '도버 해협', lon: 1.5, lat: 51.0, chokepoint: true },
];

const W = OCEAN_EDGE_WEIGHT;

/** 간선(양방향). 항구 ID 와 경유점 ID 를 함께 쓴다 */
export const routeEdges: readonly RouteEdge[] = [
  // 부산·상하이·요코하마
  { a: 'BUS', b: 'koreaStrait' },
  { a: 'koreaStrait', b: 'eastChinaSea' },
  { a: 'eastChinaSea', b: 'SHA' },
  { a: 'koreaStrait', b: 'japanSouth' },
  { a: 'japanSouth', b: 'kiiChannel' },
  { a: 'kiiChannel', b: 'YOK' },
  { a: 'YOK', b: 'boso' },
  { a: 'kiiChannel', b: 'boso' },
  // 태평양 횡단
  { a: 'boso', b: 'pacificW', weight: W },
  { a: 'pacificW', b: 'pacificC', weight: W },
  { a: 'pacificC', b: 'pacificN', weight: W },
  { a: 'pacificN', b: 'pacificE', weight: W },
  { a: 'pacificE', b: 'calCoast', weight: W },
  { a: 'calCoast', b: 'LAX' },
  // 남중국해
  { a: 'eastChinaSea', b: 'taiwanStrait' },
  { a: 'taiwanStrait', b: 'scsNorth' },
  { a: 'eastChinaSea', b: 'luzonStrait' },
  { a: 'luzonStrait', b: 'scsNorth' },
  { a: 'scsNorth', b: 'scsSouth' },
  { a: 'scsSouth', b: 'vnSouth' },
  { a: 'vnSouth', b: 'HCM' },
  { a: 'vnSouth', b: 'gulfThailand' },
  { a: 'gulfThailand', b: 'BKK' },
  { a: 'scsSouth', b: 'singaporeStrait' },
  { a: 'singaporeStrait', b: 'SIN' },
  { a: 'singaporeStrait', b: 'karimata' },
  { a: 'karimata', b: 'javaSea' },
  { a: 'javaSea', b: 'JKT' },
  // 필리핀 동쪽 → 오스트레일리아
  { a: 'eastChinaSea', b: 'philippineSea', weight: W },
  { a: 'philippineSea', b: 'samar', weight: W },
  { a: 'samar', b: 'celebesSea' },
  { a: 'celebesSea', b: 'makassar' },
  { a: 'makassar', b: 'lombok' },
  { a: 'javaSea', b: 'lombok' },
  { a: 'lombok', b: 'timorSea' },
  { a: 'timorSea', b: 'PHE' },
  // 인도양
  { a: 'SIN', b: 'malacca' },
  { a: 'malacca', b: 'malaccaN' },
  { a: 'malaccaN', b: 'dondra' },
  { a: 'dondra', b: 'malabar' },
  { a: 'malabar', b: 'MUM' },
  { a: 'dondra', b: 'arabianSea' },
  { a: 'MUM', b: 'arabianSea' },
  { a: 'arabianSea', b: 'gulfOman' },
  { a: 'gulfOman', b: 'hormuzS' },
  { a: 'hormuzS', b: 'hormuz' },
  { a: 'hormuz', b: 'gulfMid' },
  { a: 'gulfMid', b: 'DAM' },
  { a: 'arabianSea', b: 'aden' },
  { a: 'dondra', b: 'aden' },
  // 홍해·수에즈·지중해·대서양
  { a: 'aden', b: 'babElMandeb' },
  { a: 'babElMandeb', b: 'redSea' },
  { a: 'redSea', b: 'suez' },
  { a: 'suez', b: 'portSaid' },
  { a: 'portSaid', b: 'medE' },
  { a: 'medE', b: 'sicily' },
  { a: 'sicily', b: 'medW' },
  { a: 'medW', b: 'gibraltar' },
  { a: 'gibraltar', b: 'stVincent' },
  { a: 'stVincent', b: 'finisterre' },
  { a: 'finisterre', b: 'ushant' },
  { a: 'ushant', b: 'dover' },
  { a: 'dover', b: 'ROT' },
];

/** 유럽으로 가는 길목 경유점(돌발 사건 'canal'이 가리킴) */
export const EUROPE_GATEWAY = 'suez';

// ─── 그래프 계산(순수 함수) ─────────────────────────────────

interface NodePos {
  lon: number;
  lat: number;
}

const nodePos: ReadonlyMap<string, NodePos> = new Map<string, NodePos>([
  ...Object.values(portsById).map((p) => [p.id, { lon: toLonE(p.lon), lat: p.lat }] as const),
  ...waypoints.map((w) => [w.id, { lon: w.lon, lat: w.lat }] as const),
]);

/** 노드(항구 또는 경유점)의 지도용 좌표(동경 값) */
export function nodePosition(id: string): NodePos {
  const p = nodePos.get(id);
  if (!p) throw new Error(`unknown route node: ${id}`);
  return p;
}

function edgeLength(e: RouteEdge): number {
  const a = nodePosition(e.a);
  const b = nodePosition(e.b);
  return Math.hypot(a.lon - b.lon, a.lat - b.lat) * (e.weight ?? 1);
}

const adjacency: ReadonlyMap<string, readonly { to: string; len: number }[]> = (() => {
  const m = new Map<string, { to: string; len: number }[]>();
  for (const e of routeEdges) {
    const len = edgeLength(e);
    if (!m.has(e.a)) m.set(e.a, []);
    if (!m.has(e.b)) m.set(e.b, []);
    m.get(e.a)!.push({ to: e.b, len });
    m.get(e.b)!.push({ to: e.a, len });
  }
  return m;
})();

export interface RoutePath {
  /** 지나는 노드 ID(출발·도착 항구 포함) */
  nodes: string[];
  /** 가중치를 적용한 항로 길이(도) */
  length: number;
}

const pathCache = new Map<string, RoutePath>();

/** 두 항구 사이 최단 항로(다익스트라). 같은 항구면 길이 0 */
export function shortestPath(from: PortId, to: PortId): RoutePath {
  const key = `${from}>${to}`;
  const cached = pathCache.get(key);
  if (cached) return cached;
  const dist = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, string>();
  const done = new Set<string>();
  while (true) {
    let u: string | null = null;
    for (const [k, d] of dist) if (!done.has(k) && (u === null || d < dist.get(u)!)) u = k;
    if (u === null) throw new Error(`no route: ${from} → ${to}`);
    if (u === to) break;
    done.add(u);
    for (const { to: v, len } of adjacency.get(u) ?? []) {
      const nd = dist.get(u)! + len;
      if (!dist.has(v) || nd < dist.get(v)!) {
        dist.set(v, nd);
        prev.set(v, u);
      }
    }
  }
  const nodes = [to as string];
  while (nodes[0] !== from) nodes.unshift(prev.get(nodes[0])!);
  const result: RoutePath = { nodes, length: dist.get(to)! };
  pathCache.set(key, result);
  return result;
}

/** 거리 단계(PRD 6.8). 같은 항구면 0 */
export function distanceSteps(from: PortId, to: PortId): number {
  if (from === to) return 0;
  const { length } = shortestPath(from, to);
  return Math.max(1, Math.ceil((length * ROUTE_LENGTH_FACTOR) / DEGREES_PER_STEP));
}

/** 운항비(만 원) = 거리 단계 × 10 × 배 운항비 배수 */
export function voyageCost(from: PortId, to: PortId, shipCostMultiplier: number): number {
  return distanceSteps(from, to) * VOYAGE_COST_PER_STEP * shipCostMultiplier;
}

/** PRD 6.8 기대 거리 단계(부산 출발) — 테스트·check:data 비교용 */
export const EXPECTED_STEPS_FROM_BUSAN: Readonly<Partial<Record<PortId, readonly [number, number]>>> = {
  SHA: [1, 1], YOK: [1, 1], HCM: [3, 3], BKK: [3, 3], SIN: [3, 4], JKT: [3, 4],
  PHE: [4, 4], MUM: [5, 6], DAM: [6, 7], ROT: [9, 10], LAX: [7, 8],
};
