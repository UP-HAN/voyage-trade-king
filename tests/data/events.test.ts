import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COVER_EVENT_IDS, events, eventsById } from '../../src/data/events';
import { lessons } from '../../src/data/lessons';
import { missions } from '../../src/data/missions';
import type { EventTier } from '../../src/data/types';

const PRD = readFileSync(join(process.cwd(), 'docs', 'PRD.md'), 'utf8');

/** PRD 4.3.2 활동 등급표 행 파싱(ID 하나짜리 행만) */
function parseTierTable() {
  const start = PRD.indexOf('#### 4.3.2');
  const end = PRD.indexOf('#### 4.3.3');
  const rows = PRD.slice(start, end).split('\n').filter((l) => /^\| [^|]+ \| L\d-E\d \|/.test(l));
  return rows.map((line) => {
    const c = line.split('|').slice(1, -1).map((s) => s.trim());
    const [, id, , tierCol, formCol, fullCol, shortCol, prioCol] = c;
    const tier: EventTier | null = tierCol.startsWith('준비') ? 'prep' : tierCol.startsWith('마무리') ? 'wrap' : /^\d/.test(tierCol) ? (Number(tierCol[0]) as 1 | 2 | 3) : null;
    const blocking = formCol.startsWith('차단') ? true : formCol.startsWith('비차단') ? false : null;
    const full = /^\d+(\.\d+)?$/.test(fullCol) ? Number(fullCol) : fullCol === '—' ? 0 : null;
    const shortM = /^(\d+(?:\.\d+)?) —/.exec(shortCol);
    const short = shortM ? Number(shortM[1]) : shortCol === '—' ? 'none' : null;
    const priority = /^\d+$/.test(prioCol) ? Number(prioCol) : undefined;
    return { id, tier, blocking, full, short, priority, line };
  });
}

describe('사건 v0.3 배치 필드', () => {
  it('모든 사건에 tier·blocking·minutes·shortForm·needsRounds·anchor 가 있다', () => {
    for (const e of events) {
      expect(e.tier, e.id).toBeDefined();
      expect(typeof e.blocking, e.id).toBe('boolean');
      expect(typeof e.minutes.full, e.id).toBe('number');
      expect(e.shortForm === null || typeof e.shortForm.note === 'string', e.id).toBe(true);
      expect(typeof e.needsRounds, e.id).toBe('number');
      expect(e.anchor, e.id).toMatch(/^(round:\d+|stageEnd|afterPrev)$/);
      if (e.tier === 2) expect(typeof e.priority, e.id).toBe('number');
    }
  });

  it('PRD 4.3.2 활동 등급표와 같다(파싱한 모든 행, 8행 이상)', () => {
    const rows = parseTierTable();
    let compared = 0;
    for (const r of rows) {
      const e = eventsById[r.id];
      expect(e, `${r.id} 가 events 에 있어야 함`).toBeDefined();
      if (r.tier !== null) expect(e.tier, r.line).toBe(r.tier);
      if (r.blocking !== null) expect(e.blocking, r.line).toBe(r.blocking);
      if (r.full !== null) expect(e.minutes.full, r.line).toBe(r.full);
      if (typeof r.short === 'number') expect(e.minutes.short, r.line).toBe(r.short);
      if (r.short === 'none') expect(e.minutes.short === null || e.minutes.short === 0, r.line).toBe(true);
      if (r.priority !== undefined) expect(e.priority, r.line).toBe(r.priority);
      compared++;
    }
    console.log(`4.3.2 표 대조: ${compared}행`);
    expect(compared).toBeGreaterThanOrEqual(8);
  });

  it('구간 표지는 tier 1, 0.3분', () => {
    for (const id of Object.values(COVER_EVENT_IDS)) {
      expect(eventsById[id]).toMatchObject({ tier: 1, minutes: { full: 0.3, short: 0.3 }, isCover: true });
    }
  });

  it('준비·마무리 등급, L4-E5 제외', () => {
    expect(eventsById['L1-E0'].tier).toBe('prep');
    expect(eventsById['L1-E3'].tier).toBe('prep');
    for (const id of ['L4-E6', 'L4-E7', 'L4-E8', 'L4-E9']) expect(eventsById[id].tier).toBe('wrap');
    expect(eventsById['L4-E5']).toBeUndefined();
    for (const l of lessons) expect(l.eventQueue).not.toContain('L4-E5');
  });

  it('L1 사건은 TODO 없이 모든 필드가 채워져 있다', () => {
    const l1 = events.filter((e) => e.lesson === 'L1');
    expect(l1.map((e) => e.id).sort()).toEqual(['L1-COVER', 'L1-E0', 'L1-E1', 'L1-E2', 'L1-E3', 'L1-E4', 'L1-E5', 'L1-E6', 'L1-E7', 'L1-E8'].sort());
    for (const e of l1) {
      expect(JSON.stringify(e), e.id).not.toMatch(/TODO/);
      expect(e.title.length, e.id).toBeGreaterThan(0);
      expect(e.body.length, e.id).toBeGreaterThan(10);
      if (!e.gameRule) expect(e.pages.length, e.id).toBeGreaterThan(0);
    }
    expect(eventsById['L1-E6'].fake).toBe(true);
    expect(eventsById['L1-E6'].goal).toEqual({ type: 'sell', good: 'gas', port: 'BUS', qty: 1 });
  });

  it('L1-E7 문구는 판 단위와 무관하게 맞다(다음 구간 예고는 unitOnlyNote 로만)', () => {
    const e = eventsById['L1-E7'];
    expect(e.body).not.toMatch(/다음 구간/);
    for (const o of e.options ?? []) expect(o.after ?? '').not.toMatch(/다음 구간/);
    expect(e.unitOnlyNote).toMatch(/다음 구간/);
  });

  it('임무는 구간이 바뀌어도 이어진다', () => {
    for (const m of missions) expect(m.persistsAcrossStages).toBe(true);
  });
});
