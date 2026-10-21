/**
 * 사건·결정 카드에 쓸 내용 모델 — 순수 함수 (작업 111, PRD 8.3 S12·S13, 2장 정확성 원칙).
 *
 * 사건 데이터(`src/data/events.ts`)의 본문·교과서 인용·효과를 카드 칸(띠 / 제목 / 본문 3문장 / 상황 카드 /
 * "교과서 연결 p.000" / 효과 요약 / 단원 한 판 문구)으로 나눈다. 문장은 데이터에서만 가져온다(새로 지어내지 않음).
 * 학생 카드(18px)와 공용 화면 카드(32px 이상)가 같은 모델을 쓴다. L2~L4 사건(115~117)도 이 함수를 그대로 쓴다.
 */
import { conceptCards } from '../../data/dex';
import { goodsById } from '../../data/goods';
import { missionsById } from '../../data/missions';
import { coverTextFor, type LessonPart } from '../../data/lessonParts';
import { portsById } from '../../data/ports';
import { banners, pageLabel } from '../../data/text';
import type { GameEvent, LessonId } from '../../data/types';

/** 카드 띠 종류: 가상 뉴스 / 교과서 속 기사 / 개념 / (P1 돌발 사건 — 126이 채움, 기상도 틀) */
export type CardBand = 'news' | 'article' | 'concept' | 'incident';

export const BAND_TEXT: Readonly<Record<CardBand, string>> = {
  news: banners.fakeNews,
  article: banners.textbookArticle,
  concept: '개념',
  incident: banners.fakeNews,
};

export interface CardQuote {
  text: string;
  pages: readonly number[];
}

export interface CardSituation {
  title: string;
  quote: CardQuote | null;
}

export interface EventCardModel {
  id: string;
  band: CardBand;
  /** 띠 문구(가상 뉴스는 "가상 뉴스 — 교과서 내용을 바탕으로 만든 이야기예요") */
  bandText: string;
  /** 띠 옆 작은 꼬리표(결정·임무·상황 카드 등) */
  kindLabel: string | null;
  title: string;
  /** 본문(3문장 이내) */
  paragraphs: string[];
  /** 상황 카드(L1-E4 "무역이 없다면?") */
  situations: CardSituation[];
  /** "교과서 연결 p.000" 인용 상자 */
  quotes: CardQuote[];
  /** 효과 요약("부산 천연가스 값 ↑ (이번 차시)") */
  effects: string[];
  /** 단원 한 판일 때만 본문 뒤에 붙이는 문구(차시 한 판이면 null) */
  unitNote: string | null;
  /** 삽화(assets/images 기준, 없으면 양피지 무늬) */
  image: string | null;
  /** 안내 항해사 말(L1-E6: 첫 항해 안내) */
  guide: string | null;
  /** 사건 전체 쪽 */
  pages: readonly number[];
  short: boolean;
}

/** 문장 나누기(마침표·물음표·느낌표 뒤 공백). 괄호 안 마침표는 없다고 본다 */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 단원 한 판 문구를 붙이나(PRD 6.11.4 v0.3.3): 판 범위에 이 사건 구간의 **다음 구간**이 있을 때만.
 * 차시 한 판(범위 = 구간 하나)이면 늘 false.
 */
export function showUnitNote(def: Pick<GameEvent, 'lesson' | 'unitOnlyNote'>, scope: readonly LessonId[]): boolean {
  if (!def.unitOnlyNote) return false;
  const i = scope.indexOf(def.lesson);
  return i >= 0 && i < scope.length - 1;
}

/** 띠 정하기: 지어낸 이야기면 가상 뉴스, 교과서 기사면 교과서 속 기사, 그 밖은 개념 */
export function bandOf(def: Pick<GameEvent, 'fake' | 'kind'>, variant?: 'incident'): CardBand {
  if (variant === 'incident') return 'incident';
  if (def.fake) return 'news';
  if (def.kind === 'article') return 'article';
  return 'concept';
}

const KIND_LABEL: Partial<Record<GameEvent['kind'], string>> = {
  decision: '결정',
  mission: '임무',
  vote: '학급 투표',
  checkQuiz: '확인 퀴즈',
  minigame: '활동',
};

/** 효과 요약 문구(학생·공용 화면 공통) */
export function effectLines(def: Pick<GameEvent, 'effects' | 'needsResponse'>, stagePlay: 'lesson' | 'unit' = 'lesson'): string[] {
  const out: string[] = [];
  const span = stagePlay === 'lesson' ? '이번 차시' : '이번 구간';
  for (const e of def.effects) {
    if (e.type === 'priceTag') {
      const port = portsById[e.port]?.name ?? e.port;
      const good = goodsById[e.good]?.name ?? e.good;
      const arrow = e.tag === 'H' ? '↑' : e.tag === 'S' ? '↓' : '';
      out.push(`${port} ${good} 값 ${arrow} (${span})`.replace('  ', ' '));
    } else if (e.type === 'mission') {
      const m = missionsById[e.ref];
      if (m) out.push(`임무: ${m.title}`);
    } else if (e.type === 'dexCard') {
      const c = conceptCards.find((x) => x.id === e.card);
      if (c) out.push(`도감 카드: ${c.title}`);
    } else if (e.type === 'money') {
      out.push(`${e.amount > 0 ? '+' : ''}${e.amount}만 원`);
    }
  }
  return out;
}

const SITUATION_MARK = /[①②③④⑤]/;

/** "… ① 천연가스를 생산할 수 없다면 ② 비행기를 …" → 앞 문장 + 상황 제목들 */
function splitSituations(body: string): { lead: string; items: string[] } | null {
  if (!SITUATION_MARK.test(body)) return null;
  const [lead, ...rest] = body.split(SITUATION_MARK);
  return { lead: lead.trim(), items: rest.map((s) => s.trim()).filter(Boolean) };
}

export interface CardModelOptions {
  /** 짧은 형태로 발동했는가(`currentEvent.short`) */
  short?: boolean;
  /** 판 범위(단원 한 판 문구 판단) */
  scope?: readonly LessonId[];
  variant?: 'incident';
  /** (작업 154) 판 설정(차시 한 판 2차시 나눠 고르기 — 표지 제목·글 덮어쓰기). 없으면 데이터 그대로 */
  settings?: { playUnit: string; scope: readonly LessonId[]; lessonPart?: LessonPart | null } | null;
}

/** 사건 → 카드 모델 */
export function eventCardModel(def: GameEvent, opts: CardModelOptions = {}): EventCardModel {
  const short = Boolean(opts.short && def.shortForm);
  const scope = opts.scope ?? [def.lesson];
  const band = bandOf(def, opts.variant);
  const cover = coverTextFor(def, opts.settings);
  const body = cover.body && cover.body !== 'TODO' ? cover.body : '';
  const quotesAll: CardQuote[] = def.textbook.map((t) => ({ text: t.note, pages: t.pages }));
  let paragraphs = splitSentences(body);
  let situations: CardSituation[] = [];
  let quotes = quotesAll;
  let guide: string | null = null;

  const sit = splitSituations(body);
  if (sit) {
    // 상황 카드: 상황마다 같은 순서의 교과서 인용을 붙인다(L1-E4 p.97). 짧은 형태는 1장
    situations = sit.items.map((title, i) => ({ title, quote: quotesAll[i] ?? null }));
    if (short) situations = situations.slice(0, 1);
    paragraphs = sit.lead ? [sit.lead] : [];
    quotes = [];
  } else if (short && def.id === 'L1-E2') {
    // 짧은 형태(PRD 4.3.2): 정의 카드 한 장 — 예시 문장("고려 입장에서 …")은 뺀다
    paragraphs = paragraphs.filter((s) => !s.includes('고려'));
  }
  // 안내 항해사 문장은 본문이 아니라 말풍선으로
  const guideIdx = paragraphs.findIndex((s) => s.includes('안내 항해사'));
  if (guideIdx >= 0) {
    guide = paragraphs[guideIdx];
    paragraphs = paragraphs.filter((_, i) => i !== guideIdx);
  }
  paragraphs = paragraphs.slice(0, 3);

  return {
    id: def.id,
    band,
    bandText: BAND_TEXT[band],
    kindLabel: sit ? '상황 카드' : (KIND_LABEL[def.kind] ?? null),
    title: cover.title,
    paragraphs,
    situations,
    quotes,
    effects: effectLines(def, scope.length > 1 ? 'unit' : 'lesson'),
    unitNote: showUnitNote(def, scope) ? (def.unitOnlyNote ?? null) : null,
    image: def.image ?? null,
    guide,
    pages: def.pages,
    short,
  };
}

/** 쪽 표시 "교과서 연결 p.96" / "p.98~99" */
export function linkPages(pages: readonly number[]): string {
  if (!pages.length) return '';
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const contiguous = sorted.every((p, i) => i === 0 || p === sorted[i - 1] + 1);
  const label = sorted.length > 1 && contiguous ? `${sorted[0]}~${sorted[sorted.length - 1]}` : sorted.join(', ');
  return `교과서 연결 p.${label}`;
}

export { pageLabel };

// ─── 결정 카드 ───────────────────────────────────────────

export interface DecisionOptionView {
  id: string;
  label: string;
  /** 좋은 점 / 걱정되는 점 / 비용 */
  good: string;
  worry: string;
  cost: string;
  /** 고른 뒤 보여 줄 말(데이터 `after`) */
  after: string | null;
}

export interface DecisionModel {
  id: string;
  band: CardBand;
  bandText: string;
  title: string;
  /** 상황(본문 앞 문장들) */
  situation: string[];
  /** 묻는 말("어디서 살지 골라 보세요. 사지 않아도 돼요.") */
  ask: string[];
  options: DecisionOptionView[];
  /** 고른 뒤 공개하는 교과서 카드(L1-E7: p.99 흑연) */
  reveal: { title: string; text: string; quote: CardQuote | null } | null;
  unitNote: string | null;
  pages: readonly number[];
}

/** 선택지별 좋은 점·걱정되는 점·비용(화면 문구). 값은 시장 시세에서 계산해 넘긴다 */
export type OptionFacts = Record<string, { good: string; worry: string; cost: string }>;

/**
 * 결정 사건 → 결정 카드 모델. 본문 문장을 상황(앞)·묻는 말("골라 보세요"·"않아도 돼요")·공개 사실(마지막 교과서 문장)로 나눈다.
 * `facts`가 없으면 좋은 점·걱정되는 점·비용 칸은 비운다.
 */
export function decisionModel(def: GameEvent, opts: { scope?: readonly LessonId[]; facts?: OptionFacts } = {}): DecisionModel {
  const sentences = splitSentences(def.body && def.body !== 'TODO' ? def.body : '');
  const isAsk = (s: string) => /골라|고르|정해|않아도/.test(s);
  const askStart = sentences.findIndex(isAsk);
  const situation = askStart >= 0 ? sentences.slice(0, askStart) : sentences.slice(0, 2);
  const rest = askStart >= 0 ? sentences.slice(askStart) : sentences.slice(2);
  const ask = rest.filter(isAsk);
  const facts = rest.filter((s) => !isAsk(s));
  const dex = def.effects.find((e) => e.type === 'dexCard');
  const dexCard = dex && dex.type === 'dexCard' ? conceptCards.find((c) => c.id === dex.card) : undefined;
  // 공개 카드의 교과서 인용: 공개 사실 문장과 가장 많이 겹치는(첫 번째) 인용
  const quote = def.textbook[0] ? { text: def.textbook[0].note, pages: def.textbook[0].pages } : null;
  const band = bandOf(def);
  return {
    id: def.id,
    band,
    bandText: BAND_TEXT[band],
    title: def.title,
    situation,
    ask,
    options: (def.options ?? []).map((o) => ({
      id: o.id,
      label: o.label,
      good: opts.facts?.[o.id]?.good ?? '',
      worry: opts.facts?.[o.id]?.worry ?? '',
      cost: opts.facts?.[o.id]?.cost ?? '',
      after: o.after ?? null,
    })),
    reveal: facts.length || dexCard ? { title: dexCard?.title ?? def.title, text: facts.join(' '), quote } : null,
    unitNote: showUnitNote(def, opts.scope ?? [def.lesson]) ? (def.unitOnlyNote ?? null) : null,
    pages: def.pages,
  };
}

/** 까닭 쓰기 최대 글자 수(PRD 8.3 S13) */
export const REASON_MAX = 40;
