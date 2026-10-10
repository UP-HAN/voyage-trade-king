/**
 * 작업 112: 항해 기록장(S26) — 제목(판 단위·차시·날짜), 이번 판 번호만, 단원 한 판 구간 묶음, 기기 저장 24시간,
 * 다른 판(다른 날) 기록과 섞지 않기, 판이 끝난 뒤 다시 열기(새로 고침 = 저장소에서 다시 읽기).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyAction, playerView, publicClass, seatKey, type HostSnapshot } from '../src/core';
import type { WorksheetId } from '../src/data/types';
import { buildLogbookEntry, groupRows, logbookTitle } from '../src/student/logbook/model';
import { findLogbook, isExpired, loadLogbooks, LOGBOOK_KEEP_MS, saveLogbook } from '../src/student/logbook/storage';
import { makeSession } from './core/helpers';
import { MemStorage } from './sync/session-helpers';

const DAY = Date.UTC(2026, 9, 14, 1, 0, 0); // 10월 14일

function withSchedule(s: HostSnapshot, ids: WorksheetId[], after: WorksheetId[] = []): HostSnapshot {
  return {
    ...s,
    class: {
      ...s.class,
      clock: { ...s.class.clock, startedAt: DAY },
      schedule: {
        ...s.class.schedule,
        items: ids.map((w, i) => ({ id: `ws:${w}`, kind: 'worksheet' as const, refId: w, refIds: [w], stage: (['L1', 'L2', 'L3', 'L4'] as const)[Math.floor((Number(w.slice(1)) - 1) / 4)] ?? 'L4', at: i * 100, durSec: 120, form: 'full' as const, status: 'pending' as const })),
        wrapup: after.length ? [{ id: 'afterWorksheet' as const, label: '끝나고 쓰기', minutes: 0, worksheetIds: after }] : [],
      },
    },
  };
}

function lesson(scope: 'L1' | 'L2', seed = 1): HostSnapshot {
  const s = makeSession({ n: 1, scope: [scope], seed });
  return s;
}

describe('항해 기록장 모델', () => {
  it('제목 "항해 기록장 — 차시 한 판 L2 · 10월 14일", 이번 판 번호(⑤~⑧)만', () => {
    const s = withSchedule(lesson('L2'), ['W05', 'W06', 'W07', 'W08']);
    const e = buildLogbookEntry({ cls: publicClass(s.class), me: playerView(s.players[seatKey(1)]), code: '482137', now: DAY + 60_000 });
    expect(logbookTitle(e)).toBe('항해 기록장 — 차시 한 판 L2 · 10월 14일');
    expect(logbookTitle(e, '6-3')).toBe('항해 기록장 — 6-3 · 차시 한 판 L2 · 10월 14일');
    expect(e.rows.map((r) => r.id)).toEqual(['W05', 'W06', 'W07', 'W08']);
    expect(e.rows.map((r) => r.helper)).toEqual(['customsBoard', 'importProduceExport', 'exportTypes', 'relayTrade']);
    expect(e.endedAt).toBeNull();
  });

  it('도우미 값이 기록에 반영되고(흑연 선택), 다 쓴 번호 표시', () => {
    let s = withSchedule(lesson('L1'), ['W01', 'W02', 'W03', 'W04']);
    const p = JSON.parse(JSON.stringify(s.players[seatKey(1)])) as HostSnapshot['players'][string];
    p.game.decisions.graphiteChoice = 'SHA';
    p.game.worksheetDone = ['W04'];
    s = { ...s, players: { ...s.players, [seatKey(1)]: p } };
    const e = buildLogbookEntry({ cls: publicClass(s.class), me: playerView(p), now: DAY });
    const w4 = e.rows.find((r) => r.id === 'W04')!;
    expect(w4.text).toBe('내 흑연 선택: 상하이에서 샀어요');
    expect(w4.hasRecord).toBe(true);
    expect(w4.done).toBe(true);
    expect(e.rows.find((r) => r.id === 'W02')!.text).toBeNull(); // helper 없음
  });

  it('단원 한 판이면 구간별로 묶는다', () => {
    let s = makeSession({ n: 1, playUnit: 'unit', scope: ['L1', 'L2', 'L3', 'L4'] });
    s = withSchedule(s, ['W01', 'W02', 'W05', 'W09'], ['W03']);
    const e = buildLogbookEntry({ cls: publicClass(s.class), me: playerView(s.players[seatKey(1)]), now: DAY });
    expect(logbookTitle(e)).toBe('항해 기록장 — 단원 한 판 · 10월 14일');
    expect(groupRows(e).map((g) => [g.stage, g.rows.map((r) => r.id)])).toEqual([
      ['L1', ['W01', 'W02', 'W03']],
      ['L2', ['W05']],
      ['L3', ['W09']],
    ]);
  });
});

describe('항해 기록장 기기 저장', () => {
  function entry(scope: 'L1' | 'L2', seed: number, ended = false, now = DAY) {
    let s = withSchedule(lesson(scope, seed), scope === 'L1' ? ['W01'] : ['W05']);
    if (ended) s = { ...s, class: { ...s.class, phase: 'wrapup', tradeEnded: true } };
    const r = applyAction(s.class, s.players[seatKey(1)], { type: 'foundCompany', color: 'red', emblem: 'anchor', avatar: 'a1' });
    const p = r.error ? s.players[seatKey(1)] : r.player;
    return buildLogbookEntry({ cls: publicClass(s.class), me: playerView(p), code: '482137', now });
  }

  it('판이 끝난 뒤에도 24시간 동안 다시 읽힌다(새로 고침 = 저장소에서 다시 읽기), 지나면 지운다', () => {
    const st = new MemStorage();
    const e = entry('L1', 1, true, DAY);
    expect(e.endedAt).toBe(DAY);
    saveLogbook(st, e, DAY);
    expect(findLogbook(st, e.key, DAY + 23 * 3600_000)?.rows.map((r) => r.id)).toEqual(['W01']);
    expect(loadLogbooks(st, DAY + LOGBOOK_KEEP_MS)).toEqual([]);
    expect(st.getItem('voyage.logbook')).toBeNull();
  });

  it('다른 날 판과 섞지 않는다: 새 판에 들어가면 이전 판은 목록에 따로 남고(끝난 것으로) 24시간 뒤 삭제', () => {
    const st = new MemStorage();
    const day1 = entry('L1', 1, false, DAY);
    saveLogbook(st, day1, DAY);
    const nextDay = DAY + 20 * 3600_000;
    const day2 = entry('L2', 2, false, nextDay);
    saveLogbook(st, day2, nextDay);
    const list = loadLogbooks(st, nextDay);
    expect(list.map((e) => e.key)).toEqual([day2.key, day1.key]); // 최근 판 먼저, 따로
    expect(list.find((e) => e.key === day1.key)!.endedAt).toBe(nextDay);
    expect(list.find((e) => e.key === day1.key)!.rows.map((r) => r.id)).toEqual(['W01']);
    expect(list.find((e) => e.key === day2.key)!.rows.map((r) => r.id)).toEqual(['W05']);
    // 첫 판은 마지막 저장(DAY) 뒤 24시간에 지워진다
    expect(loadLogbooks(st, DAY + LOGBOOK_KEEP_MS).map((e) => e.key)).toEqual([day2.key]);
  });

  it('만료 규칙: 끝난 뒤 24시간 또는 마지막 저장 뒤 24시간', () => {
    expect(isExpired({ endedAt: null, savedAt: 0 }, LOGBOOK_KEEP_MS - 1)).toBe(false);
    expect(isExpired({ endedAt: null, savedAt: 0 }, LOGBOOK_KEEP_MS)).toBe(true);
    expect(isExpired({ endedAt: 10, savedAt: 20 }, 10 + LOGBOOK_KEEP_MS)).toBe(true);
  });
});

describe('(작업 132) 지금 쓰기 표시·단면 인쇄', () => {
  it('지금 쓰기 ★ 칸을 이 기기에서 다 쓴 번호만 "★ 2번 칸은 이미 썼어요"', () => {
    let s = withSchedule(lesson('L1'), ['W01', 'W02', 'W03', 'W04']);
    const p = JSON.parse(JSON.stringify(s.players[seatKey(1)])) as HostSnapshot['players'][string];
    p.game.duringDone = ['W03'];
    s = { ...s, players: { ...s.players, [seatKey(1)]: p } };
    const e = buildLogbookEntry({ cls: publicClass(s.class), me: playerView(p), now: DAY });
    expect(e.rows.find((r) => r.id === 'W03')).toMatchObject({ duringDone: true, duringPart: '2', done: false });
    expect(e.rows.filter((r) => r.duringDone).map((r) => r.id)).toEqual(['W03']);
  });

  it('인쇄 CSS: A4 단면, 쪽마다 머리띠(thead 되풀이), 번호 한 줄은 자르지 않음, 양면·홀짝 규칙 없음', () => {
    const css = readFileSync(join(process.cwd(), 'src/student/logbook/logbook.css'), 'utf8');
    const print = css.slice(css.indexOf('@media print'));
    expect(print).toMatch(/size:\s*A4/);
    expect(print).toMatch(/\.lb-band\s*\{\s*display:\s*table-header-group/);
    expect(print).toMatch(/\.lb-row\s*\{\s*break-inside:\s*avoid/);
    expect(css).not.toMatch(/@page\s*:(left|right)|duplex/);
    const tsx = readFileSync(join(process.cwd(), 'src/student/logbook/Logbook.tsx'), 'utf8');
    expect(tsx).toContain('<thead class="lb-band">');
  });
});
