/**
 * 1차시 미니게임 판단 — 순수 함수 (작업 113, PRD 6.12.1·6.12.2, v0.3 짧은 형태 4.3.2).
 *
 * - 벽란도 시장(L1-E1): 카드 묶음(전체 9장 / 짧은 형태 5장), 채점, 보너스(맞힌 수 × 20만 원, 짧은 형태 × 36만 원, 최대 180만 원),
 *   틀린 카드 이유(p.95), 재분류 질문(p.96 — 비단 = 수입, 인삼 = 수출).
 * - 두 섬 이야기(L1-E5): 배분(쌀에 쓰는 날) + 교환 단위로 두 섬 결과·섬별 ✓/✗·성공 판정.
 *   기준은 core(`respondToEvent`)와 같은 **1단계 기본 배분(5일:5일)** 이고, 교환을 1단위 이상 해야 성공이다(103 규칙).
 * - 진행 저장(새로 고침해도 단계 유지): 기기 localStorage. 실패해도 화면은 그대로 동작한다.
 *
 * 채점·보상의 최종 판단은 호스트(core `respondToEvent`)가 한다. 이 파일은 학생 화면이 미리 보여 줄 값을 같은 규칙으로 계산한다.
 */
import { byeokrando, byeokrandoItems, type ByeokrandoItem, type ByeokrandoItemId, type ByeokrandoSide } from '../data/byeokrando';
import { afterExchange, isSuccess, produce, twoIslands, type IslandId, type IslandStock } from '../data/twoIslands';

// ─────────────────────────── 공통 ───────────────────────────

export const MINIGAME_IDS = ['L1-E1', 'L1-E5'] as const;
export type MinigameId = (typeof MINIGAME_IDS)[number];

export function isMinigameId(id: string): id is MinigameId {
  return (MINIGAME_IDS as readonly string[]).includes(id);
}

/** 받침이 있으면 true(은/는, 이/가 고르기) */
export function hasBatchim(word: string): boolean {
  const c = word.charCodeAt(word.length - 1);
  if (c < 0xac00 || c > 0xd7a3) return false;
  return (c - 0xac00) % 28 !== 0;
}

export const eunNeun = (w: string) => `${w}${hasBatchim(w) ? '은' : '는'}`;

/** 100만 원 단위 표시: 140 → "140만 원" */
export const manwon = (n: number) => `${n.toLocaleString('ko-KR')}만 원`;

// ─────────────────────────── 벽란도 시장 ───────────────────────────

export type Placement = Partial<Record<ByeokrandoItemId, ByeokrandoSide>>;

const itemById: Readonly<Record<ByeokrandoItemId, ByeokrandoItem>> = Object.fromEntries(byeokrandoItems.map((i) => [i.id, i])) as Record<
  ByeokrandoItemId,
  ByeokrandoItem
>;

export function byeokrandoItem(id: ByeokrandoItemId): ByeokrandoItem {
  return itemById[id];
}

/** 이번에 나눌 카드(짧은 형태: 판 3 · 사 간 2 = 5장). 화면에 섞어 놓을 순서도 정한다(판·사 간이 번갈아 나오게) */
export function byeokrandoCards(short: boolean): ByeokrandoItem[] {
  const ids: readonly ByeokrandoItemId[] = short ? [...byeokrando.shortSet.sold, ...byeokrando.shortSet.bought] : byeokrandoItems.map((i) => i.id);
  const sold = ids.filter((id) => itemById[id].answer === 'sold');
  const bought = ids.filter((id) => itemById[id].answer === 'bought');
  const out: ByeokrandoItem[] = [];
  for (let i = 0; i < Math.max(sold.length, bought.length); i++) {
    if (bought[i]) out.push(itemById[bought[i]]);
    if (sold[i]) out.push(itemById[sold[i]]);
  }
  return out;
}

export interface ByeokrandoGrade {
  correct: number;
  total: number;
  /** 틀렸거나 넣지 않은 카드 */
  wrong: ByeokrandoItemId[];
}

/** 채점(core `respondToEvent` L1-E1과 같은 규칙) */
export function gradeByeokrando(place: Placement, short: boolean): ByeokrandoGrade {
  const cards = byeokrandoCards(short);
  const wrong = cards.filter((c) => place[c.id] !== c.answer).map((c) => c.id);
  return { correct: cards.length - wrong.length, total: cards.length, wrong };
}

/** 보너스(만 원): 맞힌 수 × 20(짧은 형태 36), 최대 180 [게임 설정] */
export function byeokrandoBonus(correct: number, short: boolean): number {
  const per = short ? byeokrando.shortSet.bonusPerCorrect : byeokrando.bonusPerCorrect;
  const max = short ? byeokrando.shortSet.bonusMax : byeokrando.bonusMax;
  return Math.min(Math.max(0, correct) * per, max);
}

export function byeokrandoBonusRule(short: boolean): { per: number; max: number } {
  return short
    ? { per: byeokrando.shortSet.bonusPerCorrect, max: byeokrando.shortSet.bonusMax }
    : { per: byeokrando.bonusPerCorrect, max: byeokrando.bonusMax };
}

/** 정답 이유(p.95 교과서 문장을 바탕으로) */
export function byeokrandoReason(id: ByeokrandoItemId): string {
  const it = itemById[id];
  return it.answer === 'sold'
    ? `${eunNeun(it.name)} 다른 나라 상인이 가져와서 판 물건이에요.`
    : `${eunNeun(it.name)} 다른 나라 상인이 고려에서 사 간 물건이에요.`;
}

/** 모든 카드를 넣었나 */
export function allPlaced(place: Placement, short: boolean): boolean {
  return byeokrandoCards(short).every((c) => place[c.id] === 'sold' || place[c.id] === 'bought');
}

export type TradeWord = 'import' | 'export';
export const TRADE_WORD_LABEL: Readonly<Record<TradeWord, string>> = { import: '수입', export: '수출' };

export interface ReclassQuestion {
  item: ByeokrandoItemId;
  question: string;
  answer: TradeWord;
  explain: string;
}

/** 재분류 질문(전체 형태만): "고려 입장에서 비단은? (수입/수출)", "인삼은?" — p.96 */
export function reclassQuestions(short: boolean): ReclassQuestion[] {
  if (short && byeokrando.shortSet.reclassify === false) return [];
  return byeokrando.reclassify.items.map((q, i) => {
    const name = itemById[q.item].name;
    return {
      item: q.item,
      question: i === 0 ? `고려 입장에서 ${eunNeun(name)}?` : `${eunNeun(name)}?`,
      answer: q.answer,
      explain:
        q.answer === 'import'
          ? `${eunNeun(name)} 다른 나라 상인이 가져와 판 물건이라 고려가 사 온 것이에요. ${q.explain}`
          : `${eunNeun(name)} 다른 나라 상인이 사 간 물건이라 고려가 판 것이에요. ${q.explain}`,
    };
  });
}

// ─────────────────────────── 두 섬 이야기 ───────────────────────────

export type RiceDays = Record<IslandId, number>;
export type IslandPair = Record<IslandId, IslandStock>;

export const ISLANDS: readonly IslandId[] = ['A', 'B'];

/** 1단계 기본(5일:5일) 생산량 = 성공 기준(core와 같음) */
export function baseStocks(): IslandPair {
  return { A: produce('A', twoIslands.defaultRiceDays.A), B: produce('B', twoIslands.defaultRiceDays.B) };
}

export function clampDays(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(twoIslands.days, Math.round(n)));
}

export function produceBoth(rd: RiceDays): IslandPair {
  return { A: produce('A', clampDays(rd.A)), B: produce('B', clampDays(rd.B)) };
}

/** 이 배분에서 할 수 있는 최대 교환 단위(㉮의 옷 ÷ 3, ㉯의 쌀 ÷ 2 중 작은 것) */
export function maxUnits(rd: RiceDays): number {
  const p = produceBoth(rd);
  return Math.max(0, Math.min(Math.floor(p.A.clothes / twoIslands.exchange.clothes), Math.floor(p.B.rice / twoIslands.exchange.rice)));
}

export interface IslandJudge {
  /** 교환 뒤 두 섬이 가진 양(교환 0이면 생산량 그대로) */
  after: IslandPair;
  /** 섬별: 교환을 1단위 이상 했고 쌀·옷 모두 1단계(기본) 이상 */
  ok: Record<IslandId, boolean>;
  /** 섬별 모자란 양(0이면 충분) */
  short: Record<IslandId, IslandStock>;
  units: number;
  /** 교환을 1단위 이상 했나 */
  traded: boolean;
  /** 교환 1단위 이상 + 두 섬 모두 ok */
  success: boolean;
}

/** 두 섬 판단(core `respondToEvent` L1-E5와 같은 규칙) */
export function judgeTwoIslands(rd: RiceDays, unitsIn: number): IslandJudge {
  const base = baseStocks();
  const prod = produceBoth(rd);
  const units = Math.max(0, Math.min(maxUnits(rd), Math.floor(unitsIn) || 0));
  const after = afterExchange(prod.A, prod.B, units) ?? prod;
  const ok = {} as Record<IslandId, boolean>;
  const lack = {} as Record<IslandId, IslandStock>;
  for (const k of ISLANDS) {
    // 교환 0이면 섬별로도 ✓를 주지 않는다(바꿔야 성공 — 103 규칙과 같은 기준, p.98~99)
    ok[k] = units >= 1 && after[k].rice >= base[k].rice && after[k].clothes >= base[k].clothes;
    lack[k] = { rice: Math.max(0, base[k].rice - after[k].rice), clothes: Math.max(0, base[k].clothes - after[k].clothes) };
  }
  const success = units >= 1 && isSuccess(after, base);
  return { after, ok, short: lack, units, traded: units >= 1, success };
}

/** 두 섬 합계(쌀·옷) */
export function totals(p: IslandPair): IslandStock {
  return { rice: p.A.rice + p.B.rice, clothes: p.A.clothes + p.B.clothes };
}

/** [예시 따라 하기] 값(PRD 검산 예: ㉮ 쌀 2일·옷 8일, ㉯ 쌀 10일, 옷 30과 쌀 20을 바꾸기) */
export function exampleSetup(): { riceDays: RiceDays; units: number } {
  return { riceDays: { ...twoIslands.example.riceDays }, units: twoIslands.example.units };
}

/** [예시 따라 하기]를 보여 줄까: 짧은 형태·따라잡기·마감 뒤에는 처음부터, 아니면 시작 뒤 3분(helpAfterSec) */
export function showExample(o: { short: boolean; catchUp: boolean; closed: boolean; startedAt: number; now: number }): boolean {
  if (o.short || o.catchUp || o.closed) return true;
  return o.now - o.startedAt >= twoIslands.helpAfterSec * 1000;
}

// ─────────────────────────── 진행 저장 ───────────────────────────

export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function saveKey(pid: string, eventId: string): string {
  return `voyage.minigame.${pid}.${eventId}`;
}

export function loadProgress<T extends { v: number }>(key: string, v: number, storage: StorageLike | null = defaultStorage()): T | null {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return null;
    const o = JSON.parse(raw) as T;
    return o && typeof o === 'object' && o.v === v ? o : null;
  } catch {
    return null;
  }
}

export function saveProgress(key: string, value: unknown, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(key, JSON.stringify(value));
  } catch {
    /* 저장 못 해도 진행은 된다 */
  }
}
