/**
 * `npm run check:data` — 게임 데이터 검사 (작업 102).
 *
 * 검사 항목
 *  1. 교과서 쪽수: 모든 `pages`가 94~117 정수. 교과서 문장을 가진 객체(text·explain·note·features·개념 카드 등)에
 *     pages 가 있어야 한다(`gameRule: true` 객체는 예외).
 *  2. ID 중복(상품·항구·사건·편지·확인 퀴즈·학습지·도감·임무).
 *  3. 참조 무결성: 사건 큐 ↔ events/worksheet, worksheetAfter ↔ worksheet.afterEvent, 시장표 상품 ↔ goods,
 *     특산 항구 ↔ 시장표 S/R, 편지·사건 dexCard ↔ 도감, 임무, 시작 조건 summaryCardIds ↔ 요약 카드, 마무리 구성표 사건 등.
 *  4. 학습지 W01~W20 연속, PRD 4.5 표와 같은 구간·쪽.
 *  5. 편지 은행: 구간별 최소 문항 수, L1 난이도별 5·합계 10(고유 문항), common 6(쉬움·보통 각 3),
 *     구간 단독 판 최대 슬롯(10통 → 난이도별 5) 충분성 — L1 부족은 오류, L2~L4 부족은 경고.
 *  6. 뉴스형 지문(gullNews)이 지어낸 것이 아니면 교과서 쪽수가 있어야 한다.
 *  7. 사건 v0.3 배치 필드, L1 사건에 TODO 금지(L2~L4 TODO 는 경고).
 *  8. 실존 기업명·상표, 관세사를 '관세를 깎아 주는 사람'으로 묘사한 문구 금지.
 *  9. src/data/*.ts 가 모두 이 검사에 등록되었는지(이름 필터 `name-filter.ts`는 작업 124 소유 — 쪽수 검사 대상에서 뺀다).
 * 실패(오류 1개 이상)면 종료 코드 1, 경고만 있으면 0.
 * 기본 내보내기의 반환값이 종료 코드가 된다(scripts/run-ts.mjs).
 */
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as awardsMod from '../src/data/awards';
import * as byeokrandoMod from '../src/data/byeokrando';
import * as checkQuizMod from '../src/data/checkQuiz';
import * as containersMod from '../src/data/containers';
import * as dexMod from '../src/data/dex';
import * as eventsMod from '../src/data/events';
import * as goodsMod from '../src/data/goods';
import * as lessonsMod from '../src/data/lessons';
import * as lessonPartsMod from '../src/data/lessonParts';
import * as letterScheduleMod from '../src/data/letterSchedule';
import * as lettersMod from '../src/data/letters';
import * as marketMod from '../src/data/market';
import * as missionsMod from '../src/data/missions';
import * as portsMod from '../src/data/ports';
import * as recipesMod from '../src/data/recipes';
import * as routesMod from '../src/data/routes';
import * as scheduleMod from '../src/data/schedule';
import * as shipsMod from '../src/data/ships';
import * as stuckHintsMod from '../src/data/stuckHints';
import * as termsMod from '../src/data/terms';
import * as textMod from '../src/data/text';
import * as twoIslandsMod from '../src/data/twoIslands';
import * as worksheetMod from '../src/data/worksheet';
import * as worksheetHelpersMod from '../src/data/worksheetHelpers';
import type { Difficulty, LessonId } from '../src/data/types';

/** 검사 대상 데이터 모듈(파일 이름 → 모듈) */
const MODULES: Record<string, Record<string, unknown>> = {
  'awards.ts': awardsMod,
  'byeokrando.ts': byeokrandoMod,
  'checkQuiz.ts': checkQuizMod,
  'containers.ts': containersMod,
  'dex.ts': dexMod,
  'events.ts': eventsMod,
  'goods.ts': goodsMod,
  'lessons.ts': lessonsMod,
  'lessonParts.ts': lessonPartsMod,
  'letterSchedule.ts': letterScheduleMod,
  'letters.ts': lettersMod,
  'market.ts': marketMod,
  'missions.ts': missionsMod,
  'ports.ts': portsMod,
  'recipes.ts': recipesMod,
  'routes.ts': routesMod,
  'schedule.ts': scheduleMod,
  'ships.ts': shipsMod,
  // (작업 160b) 막힌 학생 갈매기 힌트 문구(stuckHintCatalog 로 쪽수·금지어 검사)
  'stuckHints.ts': stuckHintsMod,
  'terms.ts': termsMod,
  'text.ts': textMod,
  'twoIslands.ts': twoIslandsMod,
  'worksheet.ts': worksheetMod,
  'worksheetHelpers.ts': worksheetHelpersMod,
};

/** 등록하지 않아도 되는 파일: 타입 정의, 그리고 다른 작업 소유 파일 */
const NOT_CHECKED = new Set([
  'types.ts',
  // 작업 124 소유(회사 이름 금칙어 목록) — 교과서 문장이 아니므로 쪽수 검사 대상이 아니다. 없어도 된다.
  'name-filter.ts',
  // 작업 106 소유(Natural Earth 육지 경로) — 쪽수 검사 대상이 아니다.
  'world-land.ts',
]);

export const PAGE_MIN = 94;
export const PAGE_MAX = 117;

/** 실존 기업명·상표(일부) — 데이터 문구에 나오면 오류 */
const BANNED_WORDS = [
  '삼성', '현대', 'LG', 'SK', '포스코', '한화', '롯데', '기아', '카카오', '네이버', '쿠팡',
  '넷플릭스', 'Netflix', '유튜브', 'YouTube', '디즈니', '애플', 'Apple', '구글', 'Google', '테슬라', 'Tesla',
  '부산 ?은행', '아마존', 'Amazon', '도요타', '소니', '화웨이', '샤오미', '마이크로소프트', '엔비디아', '인텔(?!리전트)', 'TSMC',
];
/** 관세사 오해 문구 */
const BANNED_PHRASES = ['관세를 깎아', '관세를 줄여 주', '관세를 면제해 주', '세관 공무원인 관세사'];

export interface CheckReport {
  errors: string[];
  warnings: string[];
  info: string[];
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** 교과서 문장을 담는 키 — 이 키가 있는 객체는 pages 가 필요 */
const TEXT_KEYS = new Set(['text', 'explain', 'note']);
/** 교과서 문장이 아닌 설명 객체(쪽수 요구 제외) */
const SKIP_KEYS = new Set(['shortForm', 'minutes', 'trigger', 'goal', 'options', 'reclassify', 'shortSet', 'marketTagLabels']);

function pageListOk(v: unknown): v is readonly number[] {
  return Array.isArray(v) && v.every((p) => Number.isInteger(p) && p >= PAGE_MIN && p <= PAGE_MAX);
}

/** '94~99' 같은 쪽 범위 문자열 */
function pageLabelOk(v: string): boolean {
  const m = /^(\d+)(?:~(\d+))?$/.exec(v);
  if (!m) return false;
  const a = Number(m[1]);
  const b = m[2] ? Number(m[2]) : a;
  return a >= PAGE_MIN && b <= PAGE_MAX && a <= b;
}

function walk(value: unknown, path: string, visit: (o: Obj, path: string) => void, seen = new Set<unknown>()): void {
  if (typeof value !== 'object' || value === null || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((v, i) => walk(v, `${path}[${i}]`, visit, seen));
    return;
  }
  visit(value as Obj, path);
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === 'function') continue;
    walk(v, `${path}.${k}`, visit, seen);
  }
}

function collectStrings(value: unknown, path: string, out: { path: string; text: string }[], seen = new Set<unknown>()): void {
  if (typeof value === 'string') {
    out.push({ path, text: value });
    return;
  }
  if (typeof value !== 'object' || value === null || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) value.forEach((v, i) => collectStrings(v, `${path}[${i}]`, out, seen));
  else for (const [k, v] of Object.entries(value)) collectStrings(v, `${path}.${k}`, out, seen);
}

function dupes(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const d = new Set<string>();
  for (const id of ids) (seen.has(id) ? d : seen).add(id);
  return [...d];
}

function dataDir(): string {
  try {
    return join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data');
  } catch {
    return join(process.cwd(), 'src', 'data');
  }
}

export function runChecks(): CheckReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const info: string[] = [];
  const err = (m: string) => errors.push(m);
  const warn = (m: string) => warnings.push(m);

  const { goods, GOOD_IDS } = goodsMod;
  const { ports, PORT_IDS } = portsMod;
  const { events, eventsById, worksheetsAfter } = eventsMod;
  const { letters } = lettersMod;
  const { checkQuiz } = checkQuizMod;
  const { worksheet, PRD_WORKSHEET_TABLE } = worksheetMod;
  const { lessons } = lessonsMod;
  const { conceptCards, exportTypeCards, classroomItemCards, ruleCards, summaryCards, ALL_DEX_CARD_IDS } = dexMod;
  const { missions } = missionsMod;
  const { marketTable } = marketMod;
  const goodSet = new Set<string>(GOOD_IDS);
  const portSet = new Set<string>(PORT_IDS);
  const eventSet = new Set(events.map((e) => e.id));
  const wsSet = new Set<string>(worksheet.map((w) => w.id));
  const dexSet = new Set(ALL_DEX_CARD_IDS);
  const missionSet = new Set(missions.map((m) => m.id));
  const summarySet = new Set(summaryCards.map((s) => s.id));

  // ── 9. 등록되지 않은 데이터 파일 ──
  try {
    const files = readdirSync(dataDir()).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    for (const f of files) {
      if (NOT_CHECKED.has(f)) {
        if (f === 'name-filter.ts') info.push('name-filter.ts: 작업 124 소유 — 쪽수 검사에서 제외');
        continue;
      }
      if (!MODULES[f]) warn(`src/data/${f}: check:data 에 등록되지 않은 데이터 파일(MODULES 에 추가 필요)`);
    }
  } catch (e) {
    warn(`src/data 폴더를 읽지 못해 파일 등록 검사를 건너뜀: ${String(e)}`);
  }

  // ── 1. 쪽수 ──
  for (const [file, mod] of Object.entries(MODULES)) {
    walk(mod, file, (o, path) => {
      if ('pages' in o) {
        const p = o.pages;
        if (typeof p === 'string') {
          if (!pageLabelOk(p)) err(`${path}.pages: 쪽 범위 문자열이 94~117 형식이 아님 (${p})`);
        } else if (!pageListOk(p)) {
          err(`${path}.pages: 94~117 정수 배열이어야 함 (${JSON.stringify(p)})`);
        }
      }
      if ('questionPages' in o && !pageListOk(o.questionPages)) err(`${path}.questionPages: 94~117 정수 배열이어야 함`);
      const segs = path.split('.').map((seg) => seg.replace(/\[\d+\]$/, ''));
      if (segs.some((seg) => SKIP_KEYS.has(seg))) return;
      if (o.gameRule === true) return;
      const hasText = [...TEXT_KEYS].some((k) => typeof o[k] === 'string' && (o[k] as string).length > 0);
      if (hasText && !('pages' in o)) err(`${path}: 교과서 문장(text/explain/note)이 있는데 pages 가 없음`);
      if (hasText && Array.isArray(o.pages) && o.pages.length === 0) err(`${path}: pages 가 비어 있음`);
    });
  }
  // features / textbook 은 항목마다 pages 필수(위 규칙으로 검사됨). 상품·항구·편지·개념 카드는 pages 비어 있으면 오류
  for (const g of goods) if ((g.pages ?? []).length === 0 || (g.desc?.pages ?? []).length === 0) err(`goods ${g.id}: pages 비어 있음`);
  for (const p of ports) for (const f of p.features) if ((f.pages ?? []).length === 0) err(`ports ${p.id}: feature pages 비어 있음`);
  for (const c of conceptCards) if ((c.pages ?? []).length === 0) err(`dex ${c.id}: pages 비어 있음`);
  // 용어 풀이(작업 108, PRD 8.1-4): 모든 풀이는 교과서 문장 + 쪽수
  for (const t of termsMod.terms) if ((t.pages ?? []).length === 0 || !t.text) err(`terms ${t.id}: 풀이 문장·pages 필요`);
  for (const e of events) {
    if (!e.gameRule && (e.pages ?? []).length === 0) err(`events ${e.id}: pages 비어 있음(교과서 근거 없는 사건이면 gameRule: true)`);
    for (const t of e.textbook ?? []) if ((t.pages ?? []).length === 0) err(`events ${e.id}: textbook 인용에 pages 없음`);
  }

  // ── 2. ID 중복 ──
  const idGroups: Record<string, string[]> = {
    goods: goods.map((g) => g.id),
    ports: ports.map((p) => p.id),
    events: events.map((e) => e.id),
    'letters+checkQuiz': [...letters.map((q) => q.id), ...checkQuiz.map((q) => q.id)],
    worksheet: worksheet.map((w) => w.id),
    dex: [...ALL_DEX_CARD_IDS, ...ruleCards.map((r) => r.id), ...summaryCards.map((s) => s.id)],
    missions: missions.map((m) => m.id),
    terms: termsMod.terms.map((t) => t.id),
    recipes: recipesMod.recipes.map((r) => r.id),
    ships: shipsMod.ships.map((s) => s.id),
    waypoints: [...routesMod.waypoints.map((w) => w.id), ...PORT_IDS],
  };
  for (const [g, ids] of Object.entries(idGroups)) for (const d of dupes(ids)) err(`ID 중복(${g}): ${d}`);
  if (goods.length !== 21) err(`상품 수 ${goods.length} (21이어야 함)`);
  if (ports.length !== 12) err(`항구 수 ${ports.length} (12여야 함)`);

  // ── 3. 참조 무결성 ──
  for (const l of lessons) {
    for (const id of l.eventQueue) {
      if (!eventSet.has(id) && !wsSet.has(id)) err(`lessons ${l.id}.eventQueue: 없는 ID ${id}`);
      const e = eventsById[id];
      if (e && e.lesson !== l.id) err(`lessons ${l.id}.eventQueue: ${id} 는 ${e.lesson} 사건`);
      if (e && (e.tier === 'prep' || e.tier === 'wrap')) err(`lessons ${l.id}.eventQueue: 준비·마무리 사건 ${id} 는 schedule 큐에 둔다`);
    }
    for (const p of l.portsOpened) if (!portSet.has(p)) err(`lessons ${l.id}: 없는 항구 ${p}`);
  }
  for (const id of [...scheduleMod.prepQueue, ...scheduleMod.wrapQueue]) {
    if (!eventSet.has(id) && !wsSet.has(id)) err(`schedule 준비/마무리 큐: 없는 ID ${id}`);
  }
  // 모든 사건이 어딘가의 큐에 있는가
  const queued = new Set([...lessons.flatMap((l) => l.eventQueue), ...scheduleMod.prepQueue, ...scheduleMod.wrapQueue]);
  for (const e of events) if (!queued.has(e.id)) err(`events ${e.id}: 어느 큐에도 없음`);
  for (const w of worksheet) if (w.lesson !== 'optional' && !queued.has(w.id)) err(`worksheet ${w.id}: 어느 큐에도 없음`);

  for (const e of events) {
    for (const w of worksheetsAfter(e)) {
      const ws = worksheetMod.worksheetById[w as keyof typeof worksheetMod.worksheetById];
      if (!ws) err(`events ${e.id}.worksheetAfter: 없는 학습지 ${w}`);
      else if (ws.afterEvent !== e.id && ws.afterEvent !== 'stageLastRound') err(`events ${e.id}.worksheetAfter ${w}: 학습지 afterEvent(${ws.afterEvent})와 맞지 않음`);
    }
    for (const fx of e.effects) {
      if (fx.type === 'dexCard' && !dexSet.has(fx.card)) err(`events ${e.id}: 없는 도감 카드 ${fx.card}`);
      if (fx.type === 'mission' && !missionSet.has(fx.ref)) err(`events ${e.id}: 없는 임무 ${fx.ref}`);
      if (fx.type === 'priceTag' && (!portSet.has(fx.port) || !goodSet.has(fx.good))) err(`events ${e.id}: priceTag 참조 오류`);
      if (fx.type === 'unlock') for (const p of fx.ports ?? []) if (!portSet.has(p)) err(`events ${e.id}: 없는 항구 ${p}`);
    }
    if (e.goal?.type === 'sell' && (!portSet.has(e.goal.port) || !goodSet.has(e.goal.good))) err(`events ${e.id}: goal 참조 오류`);
  }
  for (const w of worksheet) {
    const a = w.afterEvent;
    if (a === 'stageLastRound' || a.startsWith('optional:')) continue;
    const e = eventsById[a];
    if (!e) err(`worksheet ${w.id}.afterEvent: 없는 사건 ${a}`);
    else if (!worksheetsAfter(e).includes(w.id)) err(`worksheet ${w.id}.afterEvent ${a}: 그 사건의 worksheetAfter 에 ${w.id} 가 없음`);
    else if (w.lesson !== 'optional' && e.lesson !== w.lesson) err(`worksheet ${w.id}: 구간(${w.lesson})과 사건 구간(${e.lesson})이 다름`);
  }
  for (const m of missions) if (!eventSet.has(m.eventId)) err(`missions ${m.id}: 없는 사건 ${m.eventId}`);
  for (const m of missions) for (const fx of m.reward) if (fx.type === 'dexCard' && !dexSet.has(fx.card)) err(`missions ${m.id}: 없는 도감 카드 ${fx.card}`);

  // 시장표
  if (marketTable.length !== 12) err(`시장표 항구 수 ${marketTable.length}`);
  for (const row of marketTable) {
    if (!portSet.has(row.port)) err(`market: 없는 항구 ${row.port}`);
    const all = [...row.S, ...row.R, ...row.H, ...row.N, ...row.domesticBuy, ...row.stageHot.map((s) => s.good)];
    for (const g of all) if (!goodSet.has(g)) err(`market ${row.port}: 없는 상품 ${g}`);
    const sellTags = [...row.S, ...row.R, ...row.H, ...row.N];
    for (const d of dupes(sellTags)) err(`market ${row.port}: ${d} 가 여러 태그에 있음`);
  }
  for (const g of goods) {
    for (const p of g.specialtyPorts) {
      const row = marketMod.marketByPort[p];
      if (!row || !row.S.includes(g.id)) err(`goods ${g.id}: 특산 항구 ${p} 의 시장표 S 에 없음`);
    }
    const sPorts = marketTable.filter((r) => r.S.includes(g.id)).map((r) => r.port);
    for (const p of sPorts) if (!g.specialtyPorts.includes(p)) err(`market ${p}: S 에 ${g.id} 가 있는데 goods.specialtyPorts 에 없음`);
    if (g.factoryOnly && sPorts.length) err(`goods ${g.id}: 공장 생산품인데 특산 항구가 있음`);
  }
  for (const r of recipesMod.recipes) {
    if (!goodSet.has(r.id)) err(`recipes: 없는 상품 ${r.id}`);
    if (goodsMod.goodsById[r.id]?.V !== r.outputV) err(`recipes ${r.id}: outputV 와 goods V 가 다름`);
    for (const g of Object.keys(r.inputs)) if (!goodSet.has(g)) err(`recipes ${r.id}: 없는 재료 ${g}`);
  }

  // 도감·편지·확인 퀴즈
  for (const q of letters) if (!dexSet.has(q.dexCard)) err(`letters ${q.id}: 없는 도감 카드 ${q.dexCard}`);
  for (const t of exportTypeCards) for (const g of t.goods) if (!goodSet.has(g)) err(`dex ${t.id}: 없는 상품 ${g}`);
  for (const c of classroomItemCards) {
    if (c.relatedGood && !goodSet.has(c.relatedGood)) err(`dex ${c.id}: 없는 상품`);
    if (c.relatedPort && !portSet.has(c.relatedPort)) err(`dex ${c.id}: 없는 항구`);
  }

  // schedule
  const lessonIds = new Set(lessons.map((l) => l.id));
  for (const s of scheduleMod.stageStart) {
    if (!lessonIds.has(s.lesson)) err(`schedule.stageStart: 없는 구간 ${s.lesson}`);
    for (const p of s.ports) if (!portSet.has(p)) err(`schedule.stageStart ${s.lesson}: 없는 항구 ${p}`);
    for (const c of s.summaryCardIds) if (!summarySet.has(c)) err(`schedule.stageStart ${s.lesson}: 없는 요약 카드 ${c}`);
  }
  if (scheduleMod.lessonCards.length !== 4) err('schedule.lessonCards: 4장이어야 함');
  for (const c of scheduleMod.lessonCards) if (!lessonIds.has(c.id)) err(`schedule.lessonCards: 없는 구간 ${c.id}`);
  const wrapSteps = [...Object.values(scheduleMod.wrapupByUnit.lesson).flat(), ...scheduleMod.wrapupByUnit.unit];
  for (const s of wrapSteps) if (s.eventId && !eventSet.has(s.eventId)) err(`schedule.wrapupByUnit: 없는 사건 ${s.eventId}`);
  for (const r of letterScheduleMod.rewardPattern) if (!(r in letterScheduleMod.letterRewards)) err(`letterSchedule: 정의 없는 보상 ${r}`);

  // ── 4. 학습지 ──
  worksheet.forEach((w, i) => {
    const expectId = `W${String(i + 1).padStart(2, '0')}`;
    if (w.id !== expectId || w.no !== i + 1) err(`worksheet[${i}]: ${expectId}(no ${i + 1})이어야 함 (${w.id}, no ${w.no})`);
    const prd = PRD_WORKSHEET_TABLE[i];
    if (!prd || prd.id !== w.id || prd.lesson !== w.lesson || JSON.stringify(prd.pages) !== JSON.stringify(w.pages)) {
      err(`worksheet ${w.id}: PRD 4.5 표(구간·쪽)와 다름`);
    }
    if (!w.prompt.trim()) err(`worksheet ${w.id}: prompt 비어 있음`);
    if (!(w.minutes > 0)) err(`worksheet ${w.id}: minutes 없음`);
  });
  if (worksheet.length !== 20) err(`worksheet 수 ${worksheet.length} (20이어야 함)`);

  // ── 5. 편지 은행 ──
  const minByLesson: Record<LessonId, number> = { L1: 8, L2: 8, L3: 8, L4: 6 };
  const diffs: Difficulty[] = ['easy', 'normal'];
  const maxSlots = letterScheduleMod.slotsByDifficulty(scheduleMod.letterCountRule.max);
  const common = letters.filter((q) => q.common);
  const commonBy = { easy: common.filter((q) => q.difficulty === 'easy').length, normal: common.filter((q) => q.difficulty === 'normal').length };
  if (common.length < 6 || commonBy.easy < 3 || commonBy.normal < 3) {
    err(`letters common: 6문항 이상(쉬움·보통 각 3 이상)이어야 함 (쉬움 ${commonBy.easy}, 보통 ${commonBy.normal})`);
  }
  for (const q of common) if (q.lesson !== 'common') err(`letters ${q.id}: common 문항의 lesson 은 'common'`);
  const table: string[] = [];
  for (const l of ['L1', 'L2', 'L3', 'L4'] as LessonId[]) {
    const own = letters.filter((q) => q.lesson === l);
    if (own.length < minByLesson[l]) err(`letters ${l}: ${own.length}문항 (최소 ${minByLesson[l]})`);
    const row: string[] = [];
    for (const d of diffs) {
      const ownN = own.filter((q) => q.difficulty === d).length;
      const total = ownN + commonBy[d];
      row.push(`${d} 고유 ${ownN} + common ${commonBy[d]} = ${total} (필요 ${maxSlots[d]})`);
      if (l === 'L1') {
        if (ownN < maxSlots[d]) err(`letters L1 ${d}: 구간 고유 ${ownN}문항 (단독 판 최대 슬롯 ${maxSlots[d]} 이상 필요)`);
      } else if (total < maxSlots[d]) {
        warn(`letters ${l} ${d}: 고유 + common = ${total}문항 < 단독 판 최대 슬롯 ${maxSlots[d]} (작업 115~117에서 보강)`);
      }
    }
    if (l === 'L1' && own.length < 10) err(`letters L1: 구간 고유 ${own.length}문항 (10 이상 필요)`);
    table.push(`${l}: ${row.join(' | ')}`);
  }
  info.push('편지 은행(구간 단독 판 충분성):', ...table.map((t) => `  ${t}`));

  for (const q of [...letters, ...checkQuiz]) {
    if (!q.explain?.trim()) err(`${q.id}: explain 없음`);
    if ((q.pages ?? []).length === 0) err(`${q.id}: pages 없음`);
    if (q.type === 'choice3') {
      if (!q.choices || q.choices.length !== 3) err(`${q.id}: choice3 는 보기 3개`);
      if (typeof q.answer !== 'number' || q.answer < 0 || q.answer > 2) err(`${q.id}: choice3 정답 번호(0~2) 오류`);
      if (q.choices && new Set(q.choices).size !== q.choices.length) err(`${q.id}: 같은 보기가 있음`);
    } else if (q.answer !== 'O' && q.answer !== 'X') err(`${q.id}: ox 정답은 'O' | 'X'`);
  }
  for (const l of ['L1', 'L2', 'L3', 'L4'] as LessonId[]) {
    const prim = checkQuiz.filter((q) => q.lesson === l && q.primary).length;
    const spare = checkQuiz.filter((q) => q.lesson === l && !q.primary).length;
    if (prim !== 2 || spare < 2) err(`checkQuiz ${l}: 지정 2문항 + 예비 2문항 이상이어야 함 (${prim}+${spare})`);
  }

  // ── 6. 뉴스형 지문 ──
  for (const q of letters) {
    if (q.format === 'gullNews') {
      if (!q.passage?.trim()) err(`letters ${q.id}: gullNews 에 passage(지문) 없음`);
      if (!q.fake && (q.pages ?? []).length === 0) err(`letters ${q.id}: 지어낸 지문이 아닌데 교과서 쪽수 없음`);
    }
  }

  // ── 7. 사건 v0.3 필드·TODO ──
  const TIERS = new Set<unknown>([1, 2, 3, 'prep', 'wrap']);
  for (const e of events) {
    if (!TIERS.has(e.tier)) err(`events ${e.id}: tier 오류 (${String(e.tier)})`);
    if (e.tier === 2 && typeof e.priority !== 'number') err(`events ${e.id}: 2등급인데 priority 없음`);
    if (typeof e.blocking !== 'boolean') err(`events ${e.id}: blocking 없음`);
    if (!e.minutes || typeof e.minutes.full !== 'number') err(`events ${e.id}: minutes 없음`);
    if (e.shortForm === undefined) err(`events ${e.id}: shortForm 없음(없으면 null)`);
    if (typeof e.needsRounds !== 'number') err(`events ${e.id}: needsRounds 없음`);
    if (!/^(round:\d+|stageEnd|afterPrev)$/.test(e.anchor)) err(`events ${e.id}: anchor 오류 (${e.anchor})`);
    if (e.shortForm && e.minutes.short === null) err(`events ${e.id}: 짧은 형태가 있는데 minutes.short 가 null`);
    const strings: { path: string; text: string }[] = [];
    collectStrings(e, e.id, strings);
    const todo = strings.filter((s) => /\bTODO\b/.test(s.text));
    if (todo.length) {
      if (e.lesson === 'L1') err(`events ${e.id}: L1 사건에 TODO (${todo.map((t) => t.path).join(', ')})`);
      else warn(`events ${e.id}: TODO (${todo.map((t) => t.path.replace(`${e.id}.`, '')).join(', ')})`);
    }
  }
  for (const l of ['L1', 'L2', 'L3', 'L4'] as LessonId[]) {
    if (!events.some((e) => e.lesson === l && e.isCover)) err(`events: ${l} 구간 표지 사건 없음`);
  }
  if (eventsById['L4-E5']) err('events: L4-E5(마지막 항해)는 사건이 아니라 L4 마지막 라운드 — 빼야 함');

  // TODO(사건 밖)
  for (const [file, mod] of Object.entries(MODULES)) {
    if (file === 'events.ts') continue;
    const strings: { path: string; text: string }[] = [];
    collectStrings(mod, file, strings);
    for (const s of strings) if (/\bTODO\b/.test(s.text)) warn(`${s.path}: TODO`);
  }

  // ── 8. 금지어 ──
  for (const [file, mod] of Object.entries(MODULES)) {
    const strings: { path: string; text: string }[] = [];
    collectStrings(mod, file, strings);
    for (const s of strings) {
      for (const w of BANNED_WORDS) {
        const re = /^[A-Za-z]+$/.test(w) ? new RegExp(`\\b${w}\\b`) : new RegExp(w);
        if (re.test(s.text)) err(`${s.path}: 실존 기업명·상표 '${w.replace(/\(.*\)$/, '')}'`);
      }
      for (const p of BANNED_PHRASES) if (s.text.includes(p)) err(`${s.path}: 관세사 오해 문구 '${p}'`);
    }
  }

  // ── 거리 단계 참고 ──
  const expect = routesMod.EXPECTED_STEPS_FROM_BUSAN;
  for (const p of PORT_IDS) {
    if (p === 'BUS') continue;
    const steps = routesMod.distanceSteps('BUS', p);
    const range = expect[p];
    if (range && (steps < range[0] || steps > range[1])) err(`routes BUS→${p}: 거리 단계 ${steps} (기대 ${range[0]}~${range[1]})`);
  }

  return { errors, warnings, info };
}

export default function checkData(_args: string[]): number {
  const { errors, warnings, info } = runChecks();
  for (const line of info) console.log(`[check:data] ${line}`);
  for (const w of warnings) console.warn(`[check:data] 경고: ${w}`);
  for (const e of errors) console.error(`[check:data] 오류: ${e}`);
  console.log(`[check:data] 결과: 오류 ${errors.length}, 경고 ${warnings.length}`);
  return errors.length > 0 ? 1 : 0;
}
