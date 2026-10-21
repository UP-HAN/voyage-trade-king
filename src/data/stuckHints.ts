/**
 * (작업 160b, PRD 6.7.6 끝 문단) 막힌 학생에게 가는 갈매기 힌트 — 상수 [게임 설정]과 힌트 문구.
 *
 * - 임무가 열려 있는데 사고팔 수 있던 시간(힌트 시계)으로 `firstSec` 동안 그 단계에서 나아가지 못한 학생에게만
 *   호스트(core/stuckHints.ts)가 힌트 ID 를 보낸다. 학생 화면은 이 파일의 `stuckHintText(id)`로 문구를 만든다.
 * - 문구를 바꾸면 시장표(market.ts)·레시피(recipes.ts)와 다시 대조한다(tests/data/stuck-hints.test.ts 가 facts 로 검사).
 * - 1번째 힌트는 '어디를 볼지/어느 나라인지', 2번째 힌트에서 항구 이름·순서(정답을 통째로 주지 않음).
 * - 103쪽 이후 사실·'싱가포르'·'중계'·실존 기업명은 쓰지 않는다(2차시 앞 시간 판).
 */
import type { GoodId, PortId } from './types';

/**
 * 힌트 규칙 [게임 설정]. 교사가 시간을 바꾸면 firstSec·nextSec 한 줄만 고친다.
 * - firstSec: 상황이 바뀐 뒤(마지막 진척 뒤) 첫 힌트까지 힌트 시계 초
 * - nextSec: 그 상황의 다음 힌트까지 초
 * - perMission: 한 학생·한 임무에 보내는 힌트 수 상한
 * - maxStepMs: 틱 한 번에 더하는 최대 시간(교사 화면이 끊겼다 돌아와도 한 번에 크게 늘지 않게)
 */
export const stuckHintRules = {
  enabled: true,
  firstSec: 120,
  nextSec: 120,
  perMission: 5,
  maxStepMs: 2000,
  missions: ['M-IPE'] as readonly string[],
} as const;

export type StuckHintTag = 'gameRule' | 'fakeNews';

/** 문구가 기대는 사실(시험이 시장표·레시피와 대조) */
export type StuckHintFact =
  | { side: 'buy' | 'sell'; good: GoodId; ports: PortId[] }
  | { side: 'buyCountry'; good: GoodId; country: string }
  | { side: 'recipe'; recipe: GoodId; inputs: Partial<Record<GoodId, number>> }
  | { side: 'resell' };

export interface StuckHintText {
  text: string;
  tag: StuckHintTag;
  pages: number[];
  facts: StuckHintFact[];
}

/** 공장 레시피 상품(M-IPE 힌트가 다루는 것, 우선순위 순) */
export const IPE_HINT_RECIPES = ['oilp', 'steel', 'battery'] as const;
export type IpeHintRecipe = (typeof IPE_HINT_RECIPES)[number];

/** 배터리 재료(PARTS 힌트의 순서) */
export const BATTERY_PARTS = ['graphite', 'nickel', 'chem'] as const;
export type BatteryPart = (typeof BATTERY_PARTS)[number];

const RECIPE_INPUTS: Record<IpeHintRecipe, Partial<Record<GoodId, number>>> = {
  oilp: { crude: 1 },
  steel: { iron: 2 },
  battery: { graphite: 1, nickel: 1, chem: 1 },
};

const MAKE_HOW = '부산에서 [항구 들어가기] → [공장] → [만들기]를 눌러요.';
const IPE_POINT = '수입한 자원으로 상품을 만드는 것이 우리나라 무역의 특징이에요(101쪽).';

const MAKE: Record<IpeHintRecipe, { 1: string; 2: string; pages1: number[]; pages2: number[] }> = {
  oilp: {
    1: '끼룩! 배에 실린 원유는 부산 공장에서 쓰는 재료예요. 부산 항구의 [공장]을 찾아보세요.',
    2: `${MAKE_HOW} 원유 1상자로 석유 제품 1상자를 만들어요. ${IPE_POINT}`,
    pages1: [101],
    pages2: [101],
  },
  steel: {
    1: '끼룩! 배에 실린 철광석은 부산 공장에서 쓰는 재료예요. 부산 항구의 [공장]을 찾아보세요.',
    2: `${MAKE_HOW} 철광석 2상자로 철강 1상자를 만들어요. ${IPE_POINT}`,
    pages1: [101],
    pages2: [101],
  },
  battery: {
    1: '끼룩! 배에 실린 흑연·니켈·정밀 화학 원료로 부산 공장에서 배터리를 만들 수 있어요. 부산 항구의 [공장]을 찾아보세요.',
    2: `${MAKE_HOW} 흑연·니켈·정밀 화학 원료 1상자씩으로 배터리 1상자를 만들어요. ${IPE_POINT}`,
    pages1: [99],
    pages2: [99, 101],
  },
};

const EXPORT_NAME: Record<IpeHintRecipe, string> = { oilp: '석유 제품을', steel: '철강을', battery: '배터리를' };

/** 수출 2번째 힌트(가상 뉴스): 부산에서 가까운 인기(H) 항구 하나 */
const EXPORT_NEWS: Record<IpeHintRecipe, { text: string; port: PortId; pages: number[] }> = {
  oilp: {
    text: '갈매기가 들은 소식: 베트남 호찌민에 오토바이가 많아 석유 제품이 모자란대요. 그래서 석유 제품 값이 올랐어요. (게임에서는 호찌민이 석유 제품을 비싸게 사요.)',
    port: 'HCM',
    pages: [100],
  },
  steel: {
    text: '갈매기가 들은 소식: 일본 요코하마에서 새 건물을 많이 짓느라 철강이 모자란대요. 그래서 철강 값이 올랐어요. (게임에서는 요코하마가 철강을 비싸게 사요.)',
    port: 'YOK',
    pages: [101],
  },
  battery: {
    text: '갈매기가 들은 소식: 중국 상하이에 전기차가 많아져 배터리가 모자란대요. 그래서 배터리 값이 올랐어요. (게임에서는 상하이가 배터리를 비싸게 사요.)',
    port: 'SHA',
    pages: [99],
  },
};

const PART_NAME: Record<BatteryPart, string> = { graphite: '흑연', nickel: '니켈', chem: '정밀 화학 원료' };
const PART_WHERE: Record<BatteryPart, { text: string; ports: PortId[] }> = {
  // 흑연: 상하이 특산(S) + 부산 국내산(domesticBuy)
  graphite: { text: '흑연은 상하이(중국)나 부산에서 살 수 있어요.', ports: ['SHA', 'BUS'] },
  nickel: { text: '니켈은 자카르타(인도네시아)에서 싸게 살 수 있어요.', ports: ['JKT'] },
  chem: { text: '정밀 화학 원료는 요코하마(일본)에서 싸게 살 수 있어요.', ports: ['YOK'] },
};
/**
 * (작업 161 되팔기에 기댐) 161을 되돌리면 이 문장을 '' 로 바꾸고 facts 의 resell 도 뺀다(PARTS 아래 한 곳).
 */
const RESELL_LINE = '배에 빈칸이 없으면 산 항구에서 되팔아 칸을 비울 수 있어요.';

const isRecipe = (v: string): v is IpeHintRecipe => (IPE_HINT_RECIPES as readonly string[]).includes(v);
const isPart = (v: string): v is BatteryPart => (BATTERY_PARTS as readonly string[]).includes(v);

/** 'IPE-PARTS-1:nickel+chem' 의 없는 재료(정해진 순서, 중복·틀린 값이면 null) */
function parseParts(arg: string): BatteryPart[] | null {
  const list = arg.split('+');
  if (!list.length || !list.every(isPart)) return null;
  if (new Set(list).size !== list.length || list.length >= BATTERY_PARTS.length) return null;
  const ordered = BATTERY_PARTS.filter((p) => list.includes(p));
  if (ordered.join('+') !== arg) return null;
  return ordered;
}

/** 힌트 ID → 문구·꼬리표·쪽·대조할 사실. 모르는 ID 면 null */
export function stuckHintText(id: string): StuckHintText | null {
  const [head, arg = ''] = id.split(':') as [string, string?];
  switch (head) {
    case 'IPE-MAKE-1':
    case 'IPE-MAKE-2': {
      if (!isRecipe(arg)) return null;
      const m = MAKE[arg];
      const second = head === 'IPE-MAKE-2';
      return {
        text: second ? m[2] : m[1],
        tag: 'gameRule',
        pages: second ? m.pages2 : m.pages1,
        facts: [{ side: 'recipe', recipe: arg, inputs: RECIPE_INPUTS[arg] }],
      };
    }
    case 'IPE-BUY-1':
      if (arg) return null;
      return {
        text: '끼룩! 갈매기가 들은 소식이에요. 사우디아라비아 항구에는 원유가, 오스트레일리아 항구에는 철광석이 많대요. 지도에서 그 나라 항구를 찾아 공장 재료를 싸게 사 오세요.',
        tag: 'gameRule',
        pages: [94, 100],
        facts: [
          { side: 'buyCountry', good: 'crude', country: '사우디아라비아' },
          { side: 'buyCountry', good: 'iron', country: '오스트레일리아' },
        ],
      };
    case 'IPE-BUY-2':
      if (arg) return null;
      return {
        text: '원유는 담맘(사우디아라비아), 철광석은 포트헤들랜드(오스트레일리아)에서 싸게 살 수 있어요. 사서 부산 공장으로 가져오면 원유 1상자로 석유 제품 1상자, 철광석 2상자로 철강 1상자를 만들어요.',
        tag: 'gameRule',
        pages: [100, 101],
        facts: [
          { side: 'buy', good: 'crude', ports: ['DAM'] },
          { side: 'buy', good: 'iron', ports: ['PHE'] },
          { side: 'recipe', recipe: 'oilp', inputs: RECIPE_INPUTS.oilp },
          { side: 'recipe', recipe: 'steel', inputs: RECIPE_INPUTS.steel },
        ],
      };
    case 'IPE-PARTS-1': {
      const missing = parseParts(arg);
      if (!missing) return null;
      const where = missing.map((m) => PART_WHERE[m].text).join(' ');
      const text = `배터리는 흑연·니켈·정밀 화학 원료가 1상자씩 모두 있어야 만들어요. 아직 없는 재료: ${missing.map((m) => PART_NAME[m]).join('·')}. ${where}${RESELL_LINE ? ` ${RESELL_LINE}` : ''}`;
      return {
        text,
        tag: 'gameRule',
        pages: [99],
        facts: [
          { side: 'recipe', recipe: 'battery', inputs: RECIPE_INPUTS.battery },
          ...missing.map((m): StuckHintFact => ({ side: 'buy', good: m, ports: [...PART_WHERE[m].ports] })),
          ...(RESELL_LINE ? [{ side: 'resell' } as StuckHintFact] : []),
        ],
      };
    }
    case 'IPE-EXPORT-1':
      if (!isRecipe(arg)) return null;
      return {
        text: `끼룩! 만든 ${EXPORT_NAME[arg]} 다른 나라 항구에 팔면 [수출] 도장을 받아요. 부산에서 팔면 [국내 판매]라서 임무 칸이 채워지지 않아요.`,
        tag: 'gameRule',
        pages: [101],
        facts: [],
      };
    case 'IPE-EXPORT-2': {
      if (!isRecipe(arg)) return null;
      const n = EXPORT_NEWS[arg];
      return { text: n.text, tag: 'fakeNews', pages: [...n.pages], facts: [{ side: 'sell', good: arg, ports: [n.port] }] };
    }
    case 'IPE-AGAIN-1':
      if (arg) return null;
      return {
        text: '부산에서 판 상품은 [국내 판매]예요. 공장에서 한 번 더 만들어 이번에는 다른 나라 항구에 팔아 보세요. 그러면 [수출] 도장을 받아요. 재료가 없으면 원유나 철광석을 다시 사 와요.',
        tag: 'gameRule',
        pages: [101],
        facts: [],
      };
    default:
      return null;
  }
}

/** (작업 160b) core `situationOf`가 낼 수 있는 힌트 ID 전부(레시피 3 × 2, 수출 3 × 2, BUY 2, AGAIN 1, PARTS 없는 재료 조합 6) */
export function allStuckHintIds(): string[] {
  const ids: string[] = [];
  for (const r of IPE_HINT_RECIPES) ids.push(`IPE-MAKE-1:${r}`, `IPE-MAKE-2:${r}`);
  for (const r of IPE_HINT_RECIPES) ids.push(`IPE-EXPORT-1:${r}`, `IPE-EXPORT-2:${r}`);
  ids.push('IPE-BUY-1', 'IPE-BUY-2', 'IPE-AGAIN-1');
  for (let mask = 1; mask < (1 << BATTERY_PARTS.length) - 1; mask++) {
    ids.push(`IPE-PARTS-1:${BATTERY_PARTS.filter((_, i) => mask & (1 << i)).join('+')}`);
  }
  return ids;
}

/** 힌트 문구 전부(check:data 가 쪽수·금지어를 검사하는 목록) */
export const stuckHintCatalog: Readonly<Record<string, StuckHintText>> = Object.fromEntries(
  allStuckHintIds().map((id) => [id, stuckHintText(id)!]),
);
