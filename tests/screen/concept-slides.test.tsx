/**
 * 작업 152: 개념 카드 TV 슬라이드 — 장 목록(제목 → 본문 1~2문장 → 교과서), 짧은 형태, 저절로 넘김, ←/→, 대상 사건 판단.
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eventsById } from '../../src/data/events';
import { ConceptSlides, SLIDE_DEFAULT_MS, conceptSlides, displayTitle, isConceptSlideEvent, pagesText, slideIndexAt, type Slide } from '../../src/screen/scenes/ConceptSlides';
import { installFakeDom } from '../map/fake-dom';

const bodyCount = (s: Slide[]) => s.filter((x) => x.kind === 'body').length;
const books = (s: Slide[]) => s.filter((x): x is Extract<Slide, { kind: 'textbook' }> => x.kind === 'textbook');

describe('장 목록(conceptSlides)', () => {
  it('L1-E2 무역·수입·수출: 제목 + 본문 2장(정의 / 고려 예시) + 교과서 2장(96쪽) = 5장', () => {
    const s = conceptSlides(eventsById['L1-E2'], { short: false });
    expect(s).toHaveLength(5);
    expect(s[0]).toMatchObject({ kind: 'title', title: '무역·수입·수출', pages: [96] });
    expect(bodyCount(s)).toBe(2);
    expect(books(s)).toHaveLength(2);
    expect(books(s).map((b) => pagesText(b.pages))).toEqual(['교과서 96쪽', '교과서 96쪽']);
    expect(s.map((x) => x.kind)).toEqual(['title', 'body', 'body', 'textbook', 'textbook']);
  });
  it('L1-E4 무역이 없다면?: 제목 + 본문 2장(묻는 말 / ①②) + 교과서 2장(97쪽) = 5장', () => {
    const s = conceptSlides(eventsById['L1-E4'], { short: false });
    expect(s).toHaveLength(5);
    expect(s[0]).toMatchObject({ kind: 'title', title: '무역이 없다면?' });
    const bodies = s.filter((x): x is Extract<Slide, { kind: 'body' }> => x.kind === 'body');
    expect(bodies[1].lines).toEqual(['① 천연가스를 생산할 수 없다면', '② 비행기를 만드는 기술이 없다면']);
    expect(books(s).map((b) => pagesText(b.pages))).toEqual(['교과서 97쪽', '교과서 97쪽']);
  });
  it('L2-E2 부산 공장 개장: 제목 + 본문 2장 + 교과서 1장(101쪽) = 4장', () => {
    const s = conceptSlides(eventsById['L2-E2'], { short: false });
    expect(s).toHaveLength(4);
    expect(s[0]).toMatchObject({ kind: 'title', title: '부산 공장 개장', pages: [101] });
    expect(books(s)).toHaveLength(1);
    expect(pagesText(books(s)[0].pages)).toBe('교과서 101쪽');
  });
  it('본문 장은 한 장에 1~2문장', () => {
    for (const id of ['L1-E2', 'L1-E4', 'L2-E2']) {
      for (const short of [false, true]) {
        for (const x of conceptSlides(eventsById[id], { short })) if (x.kind === 'body') expect(x.lines.length, id).toBeGreaterThanOrEqual(1), expect(x.lines.length, id).toBeLessThanOrEqual(2);
      }
    }
  });
  it('짧은 형태는 교과서 장이 없다(L1-E2는 고려 예시도 뺌, L1-E4는 상황 1개)', () => {
    for (const id of ['L1-E2', 'L1-E4', 'L2-E2']) {
      const s = conceptSlides(eventsById[id], { short: true });
      expect(books(s), id).toHaveLength(0);
      expect(s[0].kind, id).toBe('title');
      expect(bodyCount(s), id).toBeGreaterThan(0);
    }
    const e2 = conceptSlides(eventsById['L1-E2'], { short: true });
    expect(JSON.stringify(e2)).not.toContain('고려');
    const e4 = conceptSlides(eventsById['L1-E4'], { short: true });
    expect(JSON.stringify(e4)).not.toContain('비행기');
  });
  it('제목의 개발 표기(L1 등)는 뺀다, 쪽 표기', () => {
    expect(displayTitle('L1-E2 무역·수입·수출')).toBe('무역·수입·수출');
    expect(displayTitle('L2 부산 공장 개장')).toBe('부산 공장 개장');
    expect(displayTitle('무역이 없다면?')).toBe('무역이 없다면?');
    expect(pagesText([98, 99])).toBe('교과서 98~99쪽');
    expect(pagesText([101, 104])).toBe('교과서 101, 104쪽');
  });
});

describe('대상 사건(isConceptSlideEvent)', () => {
  it('가운데 차단 개념 카드만(L1-E2·L1-E4·L2-E2, 짧은 형태 포함)', () => {
    for (const id of ['L1-E2', 'L1-E4', 'L2-E2']) {
      expect(isConceptSlideEvent(eventsById[id], false), id).toBe(true);
      expect(isConceptSlideEvent(eventsById[id], true), id).toBe(true);
    }
  });
  it('L2-E5 비차단 패널·표지·세관 게시판·결정·퀴즈는 아니다', () => {
    for (const id of ['L2-E5', 'L1-COVER', 'L2-E6', 'L1-E7', 'L1-E8', 'L1-E1']) expect(isConceptSlideEvent(eventsById[id], false), id).toBe(false);
  });
});

describe('저절로 넘김(slideIndexAt)', () => {
  it('장당 시간 = (closesAt − openedAt) / 장 수, 마지막 장에 머문다', () => {
    const o = 1_000_000;
    const c = o + 100_000; // 5장 → 장당 20초
    expect(slideIndexAt(5, o, c, o)).toBe(0);
    expect(slideIndexAt(5, o, c, o + 19_999)).toBe(0);
    expect(slideIndexAt(5, o, c, o + 20_000)).toBe(1);
    expect(slideIndexAt(5, o, c, o + 80_000)).toBe(4);
    expect(slideIndexAt(5, o, c, o + 500_000)).toBe(4);
    expect(slideIndexAt(5, o, c, o - 5_000)).toBe(0);
  });
  it('closesAt이 없거나 수동 진행이면 장당 20초', () => {
    const o = 0;
    expect(slideIndexAt(4, o, null, SLIDE_DEFAULT_MS * 2 + 1)).toBe(2);
    expect(slideIndexAt(4, o, 400_000, SLIDE_DEFAULT_MS + 1, true)).toBe(1);
  });
});

// ─── 렌더 ─────────────────────────────────────────────

type KeyFn = (e: { key: string }) => void;
let dom: ReturnType<typeof installFakeDom>;
const g = globalThis as Record<string, unknown>;
let prevWin: unknown;
let keyFns: KeyFn[] = [];
beforeEach(() => {
  dom = installFakeDom();
  prevWin = g.window;
  keyFns = [];
  g.window = {
    addEventListener: (t: string, f: KeyFn) => t === 'keydown' && keyFns.push(f),
    removeEventListener: (t: string, f: KeyFn) => (keyFns = keyFns.filter((x) => x !== f)),
  };
});
afterEach(() => {
  act(() => render(null, dom.root as unknown as Element));
  g.window = prevWin;
  dom.restore();
});
const byTest = (id: string) => dom.root.find((el) => el.getAttribute('data-testid') === id);
const press = (key: string) => act(() => keyFns.forEach((f) => f({ key })));

describe('ConceptSlides 렌더', () => {
  const def = eventsById['L1-E2'];
  const O = 5_000_000;
  const C = O + 100_000; // 5장 × 20초
  const show = (now: number) => act(() => render(<ConceptSlides def={def} short={false} openedAt={O} closesAt={C} now={now} />, dom.root as unknown as Element));
  const slideNo = () => Number(byTest('concept-slides')[0]!.getAttribute('data-slide'));

  it('저절로 넘어가지 않는다 — 시간이 아무리 지나도 처음 장(0)에 머묾, 점 표시와 k / n', () => {
    show(O);
    const box = byTest('concept-slides')[0]!;
    expect(box.getAttribute('data-total')).toBe('5');
    expect(slideNo()).toBe(0);
    expect(byTest('card-title')[0]!.textContent).toBe('무역·수입·수출');
    expect(byTest('slide-pages')[0]!.textContent).toBe('교과서 96쪽');
    expect(byTest('slide-dots')[0]!.textContent).toBe('●○○○○');
    expect(byTest('slide-num')[0]!.textContent).toBe('1 / 5');
    for (let t = 0; t <= 140_000; t += 20_000) {
      show(O + t);
      expect(slideNo()).toBe(0);
    }
  });

  it('본문 장: 머리 띠(개념 · 제목 · 교과서 연결 p.96) + 문장 — 눌러서 넘긴 뒤', () => {
    show(O);
    press('ArrowRight');
    expect(byTest('card-title')[0]!.textContent).toBe('무역·수입·수출');
    expect(byTest('card-pages')[0]!.textContent).toBe('교과서 연결 p.96');
    expect(byTest('slide-body')[0]!.textContent).toContain('무역이에요');
  });

  it('←/→로 한 장씩 넘기고(시간이 지나도 유지) 처음·마지막 장에서 멈춤', () => {
    show(O + 1_000);
    expect(slideNo()).toBe(0);
    expect(byTest('slide-prev')).toHaveLength(1); // [◀][▶] 버튼이 있다(눌림 동작은 e2e 화면 시험에서 본다)
    expect(byTest('slide-next')).toHaveLength(1);
    press('ArrowRight');
    expect(slideNo()).toBe(1);
    press('ArrowRight');
    expect(slideNo()).toBe(2);
    press('ArrowLeft');
    expect(slideNo()).toBe(1);
    show(O + 60_000); // 시간이 지나도 고른 장을 유지
    expect(slideNo()).toBe(1);
    press('ArrowRight');
    expect(slideNo()).toBe(2);
    for (let i = 0; i < 10; i++) press('ArrowRight');
    expect(slideNo()).toBe(4); // 마지막 장 너머로는 안 감
    for (let i = 0; i < 10; i++) press('ArrowLeft');
    expect(slideNo()).toBe(0); // 처음 장 아래로는 안 감
  });
});
