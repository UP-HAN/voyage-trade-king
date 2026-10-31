/**
 * 작업 178 — 시상식 차례 공개를 실제 교사 리듀서 상태(가짜 판 27명, 상별 1명)로: 도약상이 무역왕상 바로 앞, 공개 상태에는 공개한 상만.
 */
import { describe, expect, it } from 'vitest';
import { AWARD_ORDER } from '../../src/data/awards';
import { parseScreenData, pickScene } from '../../src/screen/model';
import { buildGame, scenePayload } from './fixtures';
import { wrapAwardList } from '../../src/teacher/game';

describe('시상식 차례(가짜 판)', () => {
  it('상을 한 장씩 공개하면 발표 순서가 AWARD_ORDER(도약상 → 무역왕상)이고, 공개 상태 awards는 공개한 만큼만', () => {
    const now = Date.now();
    const total = wrapAwardList(buildGame('awards', { now, awardsLive: 0 })).length;
    expect(total).toBeGreaterThan(3);
    const seen: string[] = [];
    for (let k = 1; k <= total; k++) {
      const p = scenePayload('awards', { now, awardsLive: k });
      const d = parseScreenData(p.publicState, p.classView)!;
      expect(pickScene(d, now)).toBe('awards');
      expect(d.pub.awards).toHaveLength(k);
      seen.push(d.pub.awards![k - 1]!.metric);
    }
    expect(seen).toEqual(AWARD_ORDER.filter((id) => seen.includes(id)));
    expect(seen.slice(-2)).toEqual(['leap', 'finalAsset']);
  });
});
