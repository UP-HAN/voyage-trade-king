/** 육지 데이터 생성(작업 106): scripts/build-land.ts 로 다시 만들면 src/data/world-land.ts 와 같아야 한다 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildLand } from '../../scripts/build-land';
import { COAST_PATH, LAND_PATH } from '../../src/data/world-land';

const root = new URL('../../', import.meta.url);

describe('world-land.ts', () => {
  it('원본 GeoJSON 으로 다시 만들면 같은 경로가 나온다', () => {
    const geo = JSON.parse(readFileSync(new URL('scripts/data-src/ne_110m_land.geojson', root), 'utf8'));
    const built = buildLand(geo);
    expect(built.fill).toBe(LAND_PATH);
    expect(built.coast).toBe(COAST_PATH);
  });

  it('파일 머리에 출처·라이선스 주석이 있다', () => {
    const src = readFileSync(new URL('src/data/world-land.ts', root), 'utf8');
    const head = src.slice(0, 1200);
    expect(head).toContain('Natural Earth');
    expect(head).toContain('naturalearthdata.com');
    expect(head).toContain('퍼블릭 도메인');
  });

  it('해안선에는 지도 가장자리·경도 180° 자르기 선이 없다', () => {
    const segs = COAST_PATH.split('M').filter(Boolean);
    for (const seg of segs) {
      const pts = seg.split('L').map((s) => s.trim().split(' ').map(Number) as [number, number]);
      for (let i = 1; i < pts.length; i++) {
        const [ax, ay] = pts[i - 1]!;
        const [bx, by] = pts[i]!;
        for (const x of [0, 2000, 2700]) expect(ax === x && bx === x).toBe(false);
        for (const y of [0, 1350]) expect(ay === y && by === y).toBe(false);
      }
    }
  });
});
