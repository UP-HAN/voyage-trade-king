/**
 * 작업 112: 학습지 기록 도우미(helper 키 16개, 301 신규 7개 포함) 계산, 이번 판 학습지 번호(배치표 기준),
 * 판 단위 꼬리표, 그리고 실제 호스트 리듀서 + 무역 시계 훅으로 돌린 판에서 뜨는 팝업 번호(차시 한 판 L1·L2, 묶음·끝나고 쓰기).
 */
import { describe, expect, it } from 'vitest';
import { createTradeHooks, hostReduce, seatKey, startSession, type HostSnapshot, type Json, type LogEntry, type TeacherAction } from '../src/core';
import {
  afterWorksheetIds,
  helperInputs,
  helperLine,
  playScopeTag,
  playUnitTag,
  playUnitTitle,
  playWorksheetIds,
  worksheetHelperRows,
  type HelperPlayer,
} from '../src/core/worksheet-helpers';
import { worksheet, worksheetById } from '../src/data/worksheet';
import { helperDefs, NEW_HELPER_KEYS } from '../src/data/worksheetHelpers';
import type { HelperKey, LessonId, WorksheetId } from '../src/data/types';

const ALL_KEYS = Object.keys(helperDefs) as HelperKey[];

function blank(): HelperPlayer {
  return { pid: 'p1', game: { decisions: {}, responses: {}, log: [], metrics: { visited: ['BUS'] } } };
}

const L = (e: Partial<LogEntry> & Pick<LogEntry, 'kind'>): LogEntry => ({ round: 1, stage: 'L2', ...e });

/** helper 키 16개 모두에 기록이 있는 학생 */
function full(): HelperPlayer {
  const responses: Record<string, Json> = {
    'L1-E1': { correct: 7, total: 9 },
    'L1-E5': { success: true, stage1: { A: { rice: 20, clothes: 40 }, B: { rice: 30, clothes: 10 } }, stage3: { A: { rice: 32, clothes: 66 }, B: { rice: 30, clothes: 30 } } },
    'L1-E7': { choice: 'SHA' },
    'L3-E1': { choice: 'join' },
    'L3-E2': { part: 'nickel', fromPort: 'JKT', qty: 3 },
    'L3-E3': { invest: 200, won: true },
    'L3-E4': { vote: 'yes' },
    'L4-E1': { vote: 'tariff' },
    'L4-E2': { build: true, wage: 'fair', env: 'install', reason: '근로자를 위해' },
    'L4-E6': { correct: 7, total: 8, wrongNos: [3] },
    'optional:expo': { good: 'battery', stamps: 5 },
  };
  const log: LogEntry[] = [
    L({ kind: 'buy', good: 'crude', qty: 2, port: 'DAM', amount: 60 }),
    L({ kind: 'produce', good: 'oilp', qty: 2, port: 'BUS', amount: 20 }),
    L({ kind: 'sell', good: 'oilp', qty: 2, port: 'BKK', amount: 240, stamp: 'export' }),
    L({ kind: 'buy', good: 'rice', qty: 1, port: 'BKK', amount: 10 }),
    L({ kind: 'buy', good: 'robot', qty: 1, port: 'YOK', amount: 100 }),
    L({ kind: 'buy', good: 'clothes', qty: 2, port: 'SIN', amount: 40 }),
    L({ kind: 'sell', good: 'clothes', qty: 2, port: 'JKT', amount: 90, stamp: 'relay' }),
    L({ kind: 'sell', good: 'gas', qty: 1, port: 'BUS', amount: 50, stamp: 'import' }),
  ];
  return { pid: 'p1', game: { decisions: { graphiteChoice: 'SHA' }, responses, log, metrics: { visited: ['BUS', 'DAM', 'BKK', 'SIN', 'JKT'] } } };
}

describe('기록 도우미: helper 키 16개', () => {
  it('키는 16개이고 301 신규 키 7개를 포함한다', () => {
    expect(ALL_KEYS).toHaveLength(16);
    expect([...NEW_HELPER_KEYS].sort()).toEqual(
      ['competitionRecord', 'customsBoard', 'expoEntry', 'magazineDraft', 'mineralCoopChoice', 'relayTrade', 'voyageSummary'].sort(),
    );
  });

  it('기록이 없으면 모두 emptyText', () => {
    const src = { cls: { votes: {} }, player: blank() };
    const inputs = helperInputs(src);
    for (const k of ALL_KEYS) {
      expect(inputs[k], k).toBeNull();
      expect(helperLine(k, src, inputs), k).toBe(helperDefs[k].emptyText);
    }
  });

  it('기록이 있으면 16개 모두 채워진다(학급 집계는 호스트 players·공개 집계로)', () => {
    const p = full();
    const src = {
      cls: { votes: { 'L3-E4': { revealed: true, result: 'yes' } } },
      player: p,
      players: [p, full()],
      pub: { vote: { id: 'L4-E1', counts: { tariff: 18, noTariff: 9 } }, awards: [{ metric: 'exports' as const, award: '수출상', winners: [{ pid: 'p1', company: '해오름', flag: { color: 'red', emblem: 'anchor' }, value: 1, rank: 1 }] }] },
    };
    const inputs = helperInputs(src);
    for (const k of ALL_KEYS) expect(inputs[k], k).not.toBeNull();
    const line = (k: HelperKey) => helperLine(k, src, inputs);
    expect(line('byeokrandoResult')).toBe('벽란도 상인 카드 9장 중 7장 맞혔어요');
    expect(line('twoIslandsResult')).toContain('바꾼 뒤 ㉮ 쌀 32·옷 66 / ㉯ 쌀 30·옷 30');
    expect(line('graphiteChoice')).toBe('내 흑연 선택: 상하이에서 샀어요');
    // (작업 115 수정 1회차) 공장에서 쓴 원유도 '부산에 들여온 상품'
    expect(line('customsBoard')).toBe('우리 반이 부산에 많이 들여온 상품: 원유, 천연가스 / 많이 내보낸 상품: 석유 제품');
    expect(line('importProduceExport')).toBe('원유 수입(담맘) → 석유 제품 생산 → 방콕에 수출');
    expect(line('exportTypes')).toContain('농산물: 쌀 ✓');
    expect(line('exportTypes')).toContain('기술: 로봇 ✓');
    expect(line('relayTrade')).toContain('싱가포르에서 산');
    expect(line('relayTrade')).toContain('[중계]');
    expect(line('mineralCoopChoice')).toBe('광물 협력: 참여했어요');
    expect(line('smartphonePart')).toContain('(자카르타에서 가져옴) · 넣은 수량 3');
    expect(line('competitionRecord')).toBe('기술 연구비: 200만 원(AI 반도체 얻음) · 항만 투표: 찬성(우리 반 결과: 찬성)');
    expect(line('voteResult1970')).toBe('내 투표: 관세를 매겨요 · 우리 반 결과: 매김 18 / 안 매김 9');
    expect(line('factoryDecision')).toBe('공장: 지었어요 · 임금: 정당한 임금 · 환경 설비: 설치 · 까닭: 근로자를 위해');
    expect(line('containerResult')).toBe('컨테이너 OX 8개 중 7개 맞혔어요 · 틀린 문장: 3번');
    expect(line('magazineDraft')).toBe('대표 상품 제안: 석유 제품 · 주요 수출국 제안: 타이');
    expect(line('voyageSummary')).toContain('방문 항구 5곳');
    expect(line('voyageSummary')).toContain('받은 상: 수출상');
    expect(line('expoEntry')).toBe('출품: 배터리 · 받은 관심 도장 5개');
  });

  it('흑연 결정 키는 decisions.graphiteChoice 하나(111) — 부산·안 삼', () => {
    const p = blank();
    p.game.decisions.graphiteChoice = 'BUS';
    expect(helperLine('graphiteChoice', { cls: { votes: {} }, player: p })).toBe('내 흑연 선택: 부산(국내산)에서 샀어요');
    p.game.decisions.graphiteChoice = 'none';
    expect(helperLine('graphiteChoice', { cls: { votes: {} }, player: p })).toBe('내 흑연 선택: 사지 않았어요');
  });

  it('학습지 번호별 도우미 줄: helper 없는 ②⑫⑮⑲는 null', () => {
    const rows = worksheetHelperRows(worksheet.map((w) => w.id), { cls: { votes: {} }, player: blank() });
    const none = rows.filter((r) => r.helper === null).map((r) => r.id);
    expect(none).toEqual(['W02', 'W12', 'W15', 'W19']);
    for (const r of rows) if (r.helper) expect(r.text).toBe(helperDefs[r.helper].emptyText);
  });
});

describe('판 단위 꼬리표', () => {
  it('차시 한 판 · L2 / 단원 한 판 · L3 구간', () => {
    expect(playUnitTag('lesson', 'L2')).toBe('2차시');
    expect(playUnitTag('unit', 'L3')).toBe('단원 한 판 · 3차시');
    expect(playScopeTag('lesson', ['L2'])).toBe('2차시');
    expect(playScopeTag('unit', ['L1', 'L2', 'L3', 'L4'])).toBe('단원 한 판 · 1~4차시');
    expect(playUnitTitle('lesson', ['L2'])).toBe('2차시');
    expect(playUnitTitle('unit', ['L1', 'L2', 'L3', 'L4'])).toBe('단원 한 판');
  });
});

// ─── 실제 판 돌리기(호스트 리듀서 + 무역 시계 훅) ───

const T0 = Date.UTC(2026, 9, 14, 0, 50, 0);

function newPlay(o: { playUnit: 'lesson' | 'unit'; scope: LessonId[]; minutes: number; n?: number; worksheetWaitSec?: 0 | 15 | 30 }) {
  const hooks = createTradeHooks();
  let now = T0;
  let snap: HostSnapshot = startSession({
    code: '123456',
    playUnit: o.playUnit,
    scope: o.scope,
    seed: 9,
    now,
    settings: { tradeMinutes: o.minutes, progressMode: 'auto', worksheetWaitSec: o.worksheetWaitSec ?? 15 },
  });
  const step = (input: Parameters<typeof hostReduce>[1]) => {
    snap = hostReduce(snap, input, now, hooks).snapshot;
  };
  for (let s = 1; s <= (o.n ?? 2); s++) step({ type: 'join', seat: s, pid: `pp${s}`, companyName: `회사${s}`, nameKey: `회사${s}` });
  const teacher = (action: TeacherAction) => step({ type: 'teacher', action });
  teacher({ type: 'startTrade' });
  const seen: WorksheetId[][] = [];
  let last = '';
  const tick = (sec: number, onTick?: () => void) => {
    for (let i = 0; i < sec; i++) {
      now += 1000;
      step({ type: 'tick' });
      const cur = snap.class.worksheet.current;
      const key = cur ? cur.join(',') : '';
      if (key && key !== last) seen.push([...cur!]);
      last = key;
      onTick?.();
    }
  };
  return {
    get snap() {
      return snap;
    },
    get now() {
      return now;
    },
    seen,
    tick,
    teacher,
    act: (seat: number, action: Parameters<typeof hostReduce>[1] extends infer X ? (X extends { type: 'act'; action: infer A } ? A : never) : never) =>
      step({ type: 'act', seat, seq: Math.floor(Math.random() * 1e6), action }),
    player: (seat: number) => snap.players[seatKey(seat)],
  };
}

describe('이번 판 학습지 번호(배치표 기준) — 차시 한 판이면 그 차시 번호만', () => {
  it('차시 한 판 L1 40분: ①②③④ 중간마다', () => {
    const g = newPlay({ playUnit: 'lesson', scope: ['L1'], minutes: 40 });
    expect(playWorksheetIds(g.snap.class.schedule)).toEqual(['W01', 'W02', 'W03', 'W04']);
    expect(g.snap.class.schedule.stageModes).toEqual({ L1: 'each' });
  });
  it('차시 한 판 L2 25분: ⑤⑥⑦⑧만(①~④·⑨~⑱ 없음)', () => {
    const g = newPlay({ playUnit: 'lesson', scope: ['L2'], minutes: 25 });
    expect(playWorksheetIds(g.snap.class.schedule)).toEqual(['W05', 'W06', 'W07', 'W08']);
  });
  it('차시 한 판 L1 10분(v0.3.8 작업 153: 라운드 2개 미만 → 차시 끝에 모아서): 끝나고 쓸 번호 없음, ⑱ 축약판 없음', () => {
    const g = newPlay({ playUnit: 'lesson', scope: ['L1'], minutes: 10 });
    expect(g.snap.class.schedule.stageModes).toEqual({ L1: 'stageEnd' });
    expect(afterWorksheetIds(g.snap.class.schedule)).toEqual([]);
    expect(playWorksheetIds(g.snap.class.schedule)).not.toContain('W18');
  });
  it('단원 한 판 25분: ①~⑱(⑯⑰⑱은 마무리), ⑲⑳ 없음', () => {
    const g = newPlay({ playUnit: 'unit', scope: ['L1', 'L2', 'L3', 'L4'], minutes: 25 });
    const ids = playWorksheetIds(g.snap.class.schedule);
    expect(ids).toEqual(worksheet.filter((w) => w.no <= 18).map((w) => w.id));
  });
});

describe('판을 돌렸을 때 뜨는 팝업', () => {
  it('차시 한 판 L2 25분: 팝업은 ⑤~⑧만 뜬다', () => {
    const g = newPlay({ playUnit: 'lesson', scope: ['L2'], minutes: 25 });
    g.tick(25 * 60 + 200);
    const flat = g.seen.flat();
    expect(flat.length).toBeGreaterThan(0);
    for (const id of flat) expect(['W05', 'W06', 'W07', 'W08']).toContain(id);
    expect([...new Set(flat)].sort()).toEqual(['W05', 'W06', 'W07', 'W08']);
    expect(g.snap.class.tradeEnded).toBe(true);
  });

  it('차시 한 판 L1 30분(v0.3.8 작업 153): ① → ② → ③ → ④ 한 장씩, ★ 없음, 번호마다 [다 썼어요]', () => {
    const g = newPlay({ playUnit: 'lesson', scope: ['L1'], minutes: 30, worksheetWaitSec: 0 });
    let during = false;
    const marked = new Set<string>();
    g.tick(30 * 60 + 200, () => {
      const c = g.snap.class.worksheet;
      if (c.during) during = true;
      const id = c.current?.[0];
      if (id && !marked.has(id)) {
        marked.add(id);
        g.act(1, { type: 'markWorksheetDone' });
      }
    });
    expect(g.seen).toEqual([['W01'], ['W02'], ['W03'], ['W04']]);
    expect(during).toBe(false);
    expect(g.player(1).game.worksheetDone.sort()).toEqual(['W01', 'W02', 'W03', 'W04']);
    expect(g.player(1).game.duringDone ?? []).toEqual([]);
    expect(g.player(2).game.worksheetDone).toEqual([]);
  });

  it('차시 한 판 L1 25분(v0.3.8 작업 153 — 옛 끝나고 + ③★): 팝업 ①②③④가 번호 순으로 하나씩, 끝나고 쓰기 없음', () => {
    const g = newPlay({ playUnit: 'lesson', scope: ['L1'], minutes: 25, worksheetWaitSec: 0 });
    g.tick(25 * 60 + 200);
    expect(g.seen).toEqual([['W01'], ['W02'], ['W03'], ['W04']]);
    expect(afterWorksheetIds(g.snap.class.schedule)).toEqual([]);
    expect(playWorksheetIds(g.snap.class.schedule)).toContain('W03');
  });

  it('라운드 중 [지금 띄우기]는 예약 → 라운드가 끝나는 순간 뜬다', () => {
    const g = newPlay({ playUnit: 'lesson', scope: ['L1'], minutes: 40 });
    g.tick(340); // 라운드 1(320초~) 중
    expect(g.snap.class.phase).toBe('round');
    g.teacher({ type: 'openWorksheet', ids: ['W02'] });
    expect(g.snap.class.worksheet.current).toBeNull();
    expect(g.snap.class.worksheet.pending).toEqual([['W02']]);
    let openedAt: number | null = null;
    g.tick(200, () => {
      if (openedAt === null && g.snap.class.worksheet.current?.[0] === 'W02') openedAt = g.now;
    });
    expect(openedAt).not.toBeNull();
    // 라운드 1 끝(320 + 167초) 무렵
    expect(Math.round(((openedAt as unknown as number) - T0) / 1000)).toBeGreaterThanOrEqual(487);
  });

  it("'학습지 팝업 끄기'(남은 학습지 건너뛰기 + 설정 off): 팝업이 뜨지 않고 큐에 '건너뜀'으로 남는다", () => {
    const g = newPlay({ playUnit: 'lesson', scope: ['L1'], minutes: 40 });
    g.tick(5);
    for (const it of g.snap.class.schedule.items) if (it.kind === 'worksheet' && it.status === 'pending') g.teacher({ type: 'skipItem', id: it.id });
    g.teacher({ type: 'updateSettings', settings: { worksheetMode: 'off' } });
    const ws = g.snap.class.schedule.items.filter((it) => it.kind === 'worksheet');
    expect(ws.map((it) => it.status)).toEqual(['skipped', 'skipped', 'skipped', 'skipped']);
    g.tick(40 * 60 + 200);
    expect(g.seen).toEqual([]);
    expect(afterWorksheetIds(g.snap.class.schedule)).toEqual([]);
  });

  it('데이터 대응: 팝업 번호·문구·쪽수가 worksheet.ts(= PRD 4.5)와 같다 — 원문자 ①~⑳', () => {
    expect(worksheet.map((w) => w.label).join('')).toBe('①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳');
    expect(worksheetById.W03.pagesLabel).toBe('교과서 98~99쪽');
  });
});
