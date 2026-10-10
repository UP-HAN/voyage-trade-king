import { describe, expect, it } from 'vitest';
import { PORT_IDS, ports } from '../../src/data/ports';
import { distanceSteps, EXPECTED_STEPS_FROM_BUSAN, nodePosition, routeEdges, shortestPath, voyageCost, waypoints } from '../../src/data/routes';

describe('routes — 거리 단계(PRD 6.8)', () => {
  it('부산 출발 거리 단계가 PRD 6.8 기대 범위 안에 있다', () => {
    const rows: Record<string, { steps: number; expected: string; length: number }> = {};
    for (const [port, range] of Object.entries(EXPECTED_STEPS_FROM_BUSAN)) {
      const p = port as keyof typeof EXPECTED_STEPS_FROM_BUSAN;
      const steps = distanceSteps('BUS', p);
      rows[port] = { steps, expected: `${range![0]}~${range![1]}`, length: Math.round(shortestPath('BUS', p).length * 10) / 10 };
      expect(steps, `BUS→${port}`).toBeGreaterThanOrEqual(range![0]);
      expect(steps, `BUS→${port}`).toBeLessThanOrEqual(range![1]);
    }
    console.table(rows);
  });

  it('모든 항구 쌍이 이어져 있고, 거리 단계는 대칭이며 1 이상이다', () => {
    for (const a of PORT_IDS) {
      for (const b of PORT_IDS) {
        const s = distanceSteps(a, b);
        if (a === b) expect(s).toBe(0);
        else {
          expect(s).toBeGreaterThanOrEqual(1);
          expect(s).toBe(distanceSteps(b, a));
        }
      }
    }
  });

  it('유럽 항로는 수에즈 운하를 지나고, 태평양 항로는 파나마를 쓰지 않는다', () => {
    expect(shortestPath('BUS', 'ROT').nodes).toContain('suez');
    expect(shortestPath('SIN', 'ROT').nodes).toContain('suez');
    expect(shortestPath('BUS', 'LAX').nodes.some((n) => n.startsWith('pacific'))).toBe(true);
    expect(waypoints.some((w) => /panama/i.test(w.id))).toBe(false);
  });

  it('간선은 존재하는 노드만 잇고, 항구마다 간선이 있다', () => {
    for (const e of routeEdges) {
      expect(() => nodePosition(e.a)).not.toThrow();
      expect(() => nodePosition(e.b)).not.toThrow();
    }
    for (const p of ports) expect(routeEdges.some((e) => e.a === p.id || e.b === p.id), p.id).toBe(true);
  });

  it('운항비 = 거리 단계 × 10 × 배 배수', () => {
    expect(voyageCost('BUS', 'SHA', 1)).toBe(10);
    expect(voyageCost('BUS', 'PHE', 1.5)).toBe(distanceSteps('BUS', 'PHE') * 15);
  });
});
