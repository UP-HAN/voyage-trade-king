/**
 * 학습지 기록 도우미(helper) 값 계산 — 순수 함수 (PRD 4.3.3·4.5·7.7, docs/worksheet.md 2.1) — 작업 112.
 *
 * - 표시 문구(한 줄)는 `src/data/worksheetHelpers.ts`(102)의 `helperText`가 만든다. 여기서는 그 입력(`HelperInputs`)을
 *   학생 회사 상태(결정·응답·거래 로그·지표)와 학급 상태(투표 결과)·공개 집계에서 **모은다**.
 * - helper 키 16개 전부를 다룬다(301 신규 키 7개 포함). 기록이 없으면 null → `helperText`가 "아직 기록이 없어요" 등.
 * - 학생 기기는 자기 상태(`state.me`)와 공개 상태만 가진다. 학급 집계가 필요한 키(세관 게시판 customsBoard,
 *   1970 투표 수 voteResult1970)는 `players`(호스트만 가진 모든 학생) 또는 공개 집계가 있을 때만 채운다.
 * - 입력 타입은 호스트(`ClassState`·`Player`)와 학생 기기(`PublicClass`·`PlayerView`) 둘 다 받도록 구조만 본다.
 * - "이번 판 학습지 번호"(`playWorksheetIds`)는 배치표(123)에 들어간 번호만이다(PRD 4.5, brief v0.3.1 2).
 */
import { exportTypeCards } from '../data/dex';
import { recipesById } from '../data/recipes';
import { worksheet, worksheetById } from '../data/worksheet';
import { helperText, type HelperInputs, type IslandAmounts } from '../data/worksheetHelpers';
import type { ExportTypeId, GoodId, HelperKey, LessonId, PortId, WorksheetId } from '../data/types';
import { parseVNDecision } from './factoryVN';
import type { AwardResult, ClassVote, Json, LogEntry, ScheduleState } from './types';

// ─── 입력 모양(구조만) ─────────────────────────────────────

/** 기록 도우미가 읽는 학생 회사 상태(호스트 Player·학생 PlayerView 공통) */
export interface HelperPlayer {
  pid?: string;
  game: {
    decisions: Record<string, string>;
    responses: Record<string, Json>;
    log: readonly LogEntry[];
    metrics: { visited: readonly string[] };
  };
}

/** 기록 도우미가 읽는 학급 상태(ClassState·PublicClass 공통) */
export interface HelperClass {
  votes: Record<string, ClassVote>;
}

/** 공개 집계(있으면) — 투표 수·시상 결과. 115~118이 학급 집계(customsBoard)를 더하면 그대로 읽는다 */
export interface HelperPublic {
  vote?: { id: string; counts: Record<string, number> } | null;
  awards?: readonly AwardResult[] | null;
  /** (선택) L2-E6 세관 게시판 학급 집계 — 작업 115가 공개 상태에 실으면 읽는다 */
  customsBoard?: HelperInputs['customsBoard'] | null;
}

export interface HelperSource {
  cls: HelperClass;
  player: HelperPlayer;
  pub?: HelperPublic | null;
  /** 호스트만: 학급 집계용 모든 학생 */
  players?: readonly HelperPlayer[];
}

type Inputs = { [K in HelperKey]: HelperInputs[K] | null };

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function island(v: unknown): IslandAmounts | null {
  if (!isObj(v)) return null;
  const rice = num(v.rice);
  const clothes = num(v.clothes);
  return rice === null || clothes === null ? null : { rice, clothes };
}

function pair(v: unknown): { A: IslandAmounts; B: IslandAmounts } | null {
  if (!isObj(v)) return null;
  const A = island(v.A);
  const B = island(v.B);
  return A && B ? { A, B } : null;
}

function responseOf(p: HelperPlayer, id: string): Record<string, unknown> | null {
  const r = p.game.responses[id];
  return isObj(r) ? r : null;
}

// ─── 키별 계산 ────────────────────────────────────────────

function byeokrandoResult(p: HelperPlayer): HelperInputs['byeokrandoResult'] | null {
  const r = responseOf(p, 'L1-E1');
  const correct = num(r?.correct);
  const total = num(r?.total);
  return correct === null || total === null ? null : { correct, total };
}

function twoIslandsResult(p: HelperPlayer): HelperInputs['twoIslandsResult'] | null {
  const r = responseOf(p, 'L1-E5');
  const stage1 = pair(r?.stage1);
  if (!stage1) return null;
  return { stage1, stage3: pair(r?.stage3) };
}

function graphiteChoice(p: HelperPlayer): HelperInputs['graphiteChoice'] | null {
  const c = p.game.decisions.graphiteChoice ?? (responseOf(p, 'L1-E7')?.choice as string | undefined);
  return c === 'SHA' || c === 'BUS' || c === 'none' ? { choice: c } : null;
}

/** 부산에 들여온(수입 판매) / 내보낸(수출 판매) 상자 수 — 거래 로그 합계 */
function boardFrom(players: readonly HelperPlayer[]): HelperInputs['customsBoard'] | null {
  const imports: Partial<Record<GoodId, number>> = {};
  const exports: Partial<Record<GoodId, number>> = {};
  let any = false;
  for (const p of players) {
    for (const e of p.game.log) {
      if (e.kind !== 'sell' || !e.good) continue;
      const q = e.qty ?? 0;
      if (e.stamp === 'import' && e.port === 'BUS') {
        imports[e.good] = (imports[e.good] ?? 0) + q;
        any = true;
      } else if (e.stamp === 'export') {
        exports[e.good] = (exports[e.good] ?? 0) + q;
        any = true;
      }
    }
  }
  return any ? { imports, exports } : null;
}

function customsBoard(src: HelperSource): HelperInputs['customsBoard'] | null {
  if (src.pub?.customsBoard) return src.pub.customsBoard;
  return src.players ? boardFrom(src.players) : null;
}

/** 첫 '수입 → 생산 → 수출' 기록: 첫 생산 상품 + 그 전 해외에서 산 재료 + 그 뒤 첫 수출 */
function importProduceExport(p: HelperPlayer): HelperInputs['importProduceExport'] | null {
  const log = p.game.log;
  for (let i = 0; i < log.length; i++) {
    const e = log[i];
    if (e.kind !== 'produce' || !e.good) continue;
    const product = e.good;
    const inputs = Object.keys(recipesById[product]?.inputs ?? {}) as GoodId[];
    let importGood: GoodId | null = null;
    let importPort: PortId | null = null;
    for (let j = i - 1; j >= 0; j--) {
      const b = log[j];
      if (b.kind === 'buy' && b.good && inputs.includes(b.good) && b.port && b.port !== 'BUS') {
        importGood = b.good;
        importPort = b.port;
        break;
      }
    }
    const sale = log.slice(i + 1).find((s) => s.kind === 'sell' && s.good === product && s.stamp === 'export' && s.port);
    if (importGood && importPort && sale?.port) return { record: { importGood, importPort, product, exportPort: sale.port } };
  }
  return null;
}

function exportTypes(p: HelperPlayer): HelperInputs['exportTypes'] | null {
  const done: Partial<Record<ExportTypeId, GoodId>> = {};
  for (const e of p.game.log) {
    if ((e.kind !== 'buy' && e.kind !== 'sell') || !e.good) continue;
    for (const card of exportTypeCards) if (!done[card.id] && card.goods.includes(e.good)) done[card.id] = e.good;
  }
  return Object.keys(done).length ? { done } : null;
}

/** 첫 [중계] 판매(싱가포르에서 산 상품을 다른 나라에 팜) */
function relayTrade(p: HelperPlayer): HelperInputs['relayTrade'] | null {
  const log = p.game.log;
  for (let i = 0; i < log.length; i++) {
    const e = log[i];
    if (e.kind !== 'sell' || e.stamp !== 'relay' || !e.good || !e.port) continue;
    const boughtAtSin = log.slice(0, i).some((b) => b.kind === 'buy' && b.good === e.good && b.port === 'SIN');
    if (boughtAtSin) return { record: { good: e.good, toPort: e.port } };
  }
  return null;
}

/** L3-E1 광물 협력 결정: 선택지 ID가 'no'·'none'·'skip'·'decline'이면 참여하지 않음 */
function mineralCoopChoice(p: HelperPlayer): HelperInputs['mineralCoopChoice'] | null {
  const r = responseOf(p, 'L3-E1');
  if (r && typeof r.joined === 'boolean') return { joined: r.joined };
  const c = p.game.decisions['L3-E1'] ?? (typeof r?.choice === 'string' ? r.choice : undefined);
  if (typeof c !== 'string' || r?.noResponse === true) return null;
  return { joined: !['no', 'none', 'skip', 'decline'].includes(c) };
}

/** L3-E2~E5 스마트폰 부품(응답 모양은 작업 116이 정함 — part·fromPort·qty가 있으면 읽는다) */
function smartphonePart(p: HelperPlayer): HelperInputs['smartphonePart'] | null {
  for (const id of ['L3-E5', 'L3-E2']) {
    const r = responseOf(p, id);
    if (r && typeof r.part === 'string') {
      return { part: r.part as GoodId, fromPort: typeof r.fromPort === 'string' ? (r.fromPort as PortId) : null, qty: num(r.qty) ?? 0 };
    }
  }
  return null;
}

function competitionRecord(src: HelperSource): HelperInputs['competitionRecord'] | null {
  const p = src.player;
  const tech = responseOf(p, 'L3-E3');
  const vote = responseOf(p, 'L3-E4');
  const research = num(tech?.invest);
  const v = vote?.vote === 'yes' || vote?.vote === 'no' ? (vote.vote as 'yes' | 'no') : null;
  if (research === null && v === null) return null;
  const res = src.cls.votes['L3-E4']?.result;
  return {
    research,
    gotAiChip: tech?.won === true || tech?.gotAiChip === true,
    portVote: v,
    classResult: res === 'yes' || res === 'no' ? res : null,
  };
}

function voteResult1970(src: HelperSource): HelperInputs['voteResult1970'] | null {
  const r = responseOf(src.player, 'L4-E1');
  const myVote = r?.vote === 'tariff' || r?.vote === 'noTariff' ? (r.vote as 'tariff' | 'noTariff') : null;
  let counts: { tariff: number; noTariff: number } | null = null;
  if (src.pub?.vote && src.pub.vote.id === 'L4-E1') {
    counts = { tariff: src.pub.vote.counts.tariff ?? 0, noTariff: src.pub.vote.counts.noTariff ?? 0 };
  } else if (src.players) {
    counts = { tariff: 0, noTariff: 0 };
    for (const q of src.players) {
      const x = responseOf(q, 'L4-E1')?.vote;
      if (x === 'tariff' || x === 'noTariff') counts[x] += 1;
    }
  }
  if (myVote === null && (!counts || counts.tariff + counts.noTariff === 0)) return null;
  return { myVote, counts: counts ?? { tariff: 0, noTariff: 0 } };
}

function factoryDecision(p: HelperPlayer): HelperInputs['factoryDecision'] | null {
  const d = parseVNDecision(p.game.responses['L4-E2']);
  if (!d) return null;
  return {
    built: d.build,
    wage: d.build ? (d.wage ?? null) : null,
    envFacility: d.build && d.env ? d.env === 'install' : null,
    ...(d.reason ? { reason: d.reason } : {}),
  };
}

function containerResult(p: HelperPlayer): HelperInputs['containerResult'] | null {
  const r = responseOf(p, 'L4-E6');
  const correct = num(r?.correct);
  const total = num(r?.total);
  if (correct === null || total === null) return null;
  const wrongNos = Array.isArray(r?.wrongNos) ? (r!.wrongNos as unknown[]).map(Number).filter((n) => Number.isInteger(n)) : [];
  return { correct, total, wrongNos };
}

/** [수출] 도장 판매액 합계(상품별·항구별) */
function magazineDraft(p: HelperPlayer): HelperInputs['magazineDraft'] | null {
  const exportsByGood: Partial<Record<GoodId, number>> = {};
  const exportsByPort: Partial<Record<PortId, number>> = {};
  let any = false;
  for (const e of p.game.log) {
    if (e.kind !== 'sell' || e.stamp !== 'export' || !e.good || !e.port) continue;
    const a = e.amount ?? 0;
    exportsByGood[e.good] = (exportsByGood[e.good] ?? 0) + a;
    exportsByPort[e.port] = (exportsByPort[e.port] ?? 0) + a;
    any = true;
  }
  return any ? { exportsByGood, exportsByPort } : null;
}

function voyageSummary(src: HelperSource): HelperInputs['voyageSummary'] | null {
  const p = src.player;
  let bestTrade: HelperInputs['voyageSummary']['bestTrade'] = null;
  // 판매 로그에는 이익이 없어서(rules.ts) 그 전까지 산 값의 평균 단가로 이익을 어림한다(로그에 profit이 있으면 그 값)
  const bought: Partial<Record<GoodId, { qty: number; cost: number }>> = {};
  for (const e of p.game.log) {
    if (!e.good) continue;
    if (e.kind === 'buy') {
      const b = (bought[e.good] ??= { qty: 0, cost: 0 });
      b.qty += e.qty ?? 0;
      b.cost += e.amount ?? 0;
      continue;
    }
    if (e.kind !== 'sell' || !e.port) continue;
    let profit: number | null = typeof e.profit === 'number' ? e.profit : null;
    const b = bought[e.good];
    if (profit === null && b && b.qty > 0) profit = Math.round((e.amount ?? 0) - (b.cost / b.qty) * (e.qty ?? 0));
    if (profit === null) continue;
    if (!bestTrade || profit > bestTrade.profit) bestTrade = { good: e.good, port: e.port, profit };
  }
  const visitedPorts = p.game.metrics.visited.length;
  const awards = (src.pub?.awards ?? []).filter((a) => p.pid && a.winners.some((w) => w.pid === p.pid)).map((a) => a.award);
  const traded = p.game.log.some((e) => e.kind === 'buy' || e.kind === 'sell' || e.kind === 'voyage');
  if (!traded && !awards.length) return null;
  return { bestTrade, visitedPorts, awards };
}

/** 선택 활동 박람회(P2) — 응답 모양이 정해지면 읽는다 */
function expoEntry(p: HelperPlayer): HelperInputs['expoEntry'] | null {
  const r = responseOf(p, 'optional:expo') ?? responseOf(p, 'expo');
  if (!r || typeof r.good !== 'string') return null;
  return { good: r.good as GoodId, stamps: num(r.stamps) ?? 0 };
}

// ─── 공개 함수 ────────────────────────────────────────────

/** helper 키 16개의 입력(기록이 없으면 null) */
export function helperInputs(src: HelperSource): Inputs {
  const p = src.player;
  return {
    byeokrandoResult: byeokrandoResult(p),
    twoIslandsResult: twoIslandsResult(p),
    graphiteChoice: graphiteChoice(p),
    customsBoard: customsBoard(src),
    importProduceExport: importProduceExport(p),
    exportTypes: exportTypes(p),
    relayTrade: relayTrade(p),
    mineralCoopChoice: mineralCoopChoice(p),
    smartphonePart: smartphonePart(p),
    competitionRecord: competitionRecord(src),
    voteResult1970: voteResult1970(src),
    factoryDecision: factoryDecision(p),
    containerResult: containerResult(p),
    magazineDraft: magazineDraft(p),
    voyageSummary: voyageSummary(src),
    expoEntry: expoEntry(p),
  };
}

/** 한 키의 도우미 한 줄 */
export function helperLine(key: HelperKey, src: HelperSource, inputs: Inputs = helperInputs(src)): string {
  return helperText(key, inputs[key] as never);
}

export interface WorksheetHelperRow {
  id: WorksheetId;
  helper: HelperKey | null;
  /** 도우미 한 줄(helper 없으면 null) */
  text: string | null;
  /** 기록이 있는가(없으면 emptyText) */
  hasRecord: boolean;
}

/** 학습지 번호별 도우미 줄 */
export function worksheetHelperRows(ids: readonly WorksheetId[], src: HelperSource): WorksheetHelperRow[] {
  const inputs = helperInputs(src);
  return ids
    .filter((id) => worksheetById[id])
    .map((id) => {
      const key = worksheetById[id].helper;
      if (!key) return { id, helper: null, text: null, hasRecord: false };
      return { id, helper: key, text: helperText(key, inputs[key] as never), hasRecord: inputs[key] !== null };
    });
}

/** 'W03' → 3 (번호 순 정렬용) */
export function worksheetNoOf(id: WorksheetId): number {
  return worksheetById[id]?.no ?? 99;
}

/**
 * 이번 판의 학습지 번호(배치표의 학습지 항목 + 마무리 항목의 번호, 번호 순).
 * 차시 한 판이면 그 차시 번호만 들어 있다(배치표 123이 범위 밖 번호를 넣지 않음).
 */
export function playWorksheetIds(schedule: Pick<ScheduleState, 'items' | 'wrapup'>): WorksheetId[] {
  const set = new Set<WorksheetId>();
  for (const it of schedule.items) {
    if (it.kind !== 'worksheet') continue;
    for (const w of (it.refIds?.length ? it.refIds : [it.refId]) as WorksheetId[]) if (worksheetById[w]) set.add(w);
  }
  for (const s of schedule.wrapup ?? []) for (const w of s.worksheetIds) if (worksheetById[w]) set.add(w);
  return [...set].sort((a, b) => worksheetNoOf(a) - worksheetNoOf(b));
}

/** 마무리 '끝나고 쓰기' 번호 */
export function afterWorksheetIds(schedule: Pick<ScheduleState, 'wrapup'>): WorksheetId[] {
  return [...((schedule.wrapup ?? []).find((w) => w.id === 'afterWorksheet')?.worksheetIds ?? [])];
}

/** 판 단위 꼬리표: "차시 한 판 · L2" / "단원 한 판 · L3 구간" */
export function playUnitTag(playUnit: string, stage: LessonId | string): string {
  if (playUnit === 'lesson') return `차시 한 판 · ${stage}`;
  if (playUnit === 'unit') return `단원 한 판 · ${stage} 구간`;
  return `연속 구간 한 판 · ${stage} 구간`;
}

/** 판 단위 + 범위 꼬리표('끝나고 쓰기' 목록): "차시 한 판 · L2" / "단원 한 판 · L1~L4" */
export function playScopeTag(playUnit: string, scope: readonly string[]): string {
  const range = scope.length > 1 ? `${scope[0]}~${scope[scope.length - 1]}` : (scope[0] ?? '');
  if (playUnit === 'lesson') return `차시 한 판 · ${scope[0] ?? ''}`;
  if (playUnit === 'unit') return `단원 한 판 · ${range}`;
  return `연속 구간 한 판 · ${range}`;
}

/** 판 단위 이름(기록장 제목): "차시 한 판 L2" / "단원 한 판" / "연속 구간 한 판 L1~L2" */
export function playUnitTitle(playUnit: string, scope: readonly string[]): string {
  if (playUnit === 'lesson') return `차시 한 판 ${scope[0] ?? ''}`.trim();
  if (playUnit === 'unit') return '단원 한 판';
  return `연속 구간 한 판 ${scope.length > 1 ? `${scope[0]}~${scope[scope.length - 1]}` : scope[0] ?? ''}`.trim();
}

/** 묶음이면 그 구간, 아니면 번호의 구간 */
export function worksheetStage(ids: readonly WorksheetId[], fallback: LessonId): LessonId {
  const l = ids.map((id) => worksheetById[id]?.lesson).find((x): x is LessonId => !!x && x !== 'optional');
  return l ?? fallback;
}

/** 모든 학습지 번호(①~⑳, 번호 순) */
export const ALL_WORKSHEET_IDS: readonly WorksheetId[] = worksheet.map((w) => w.id);
