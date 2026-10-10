import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkQuiz, checkQuizFor } from '../../src/data/checkQuiz';
import { CORRECT_CONTAINER_NOS, containerSentences, selfEvaluation } from '../../src/data/containers';
import { commonLetters, letterBank, letters, stageLetters } from '../../src/data/letters';
import { slotsByDifficulty } from '../../src/data/letterSchedule';
import { letterCountRule } from '../../src/data/schedule';
import { textbookArticles } from '../../src/data/text';
import type { Difficulty, LessonId } from '../../src/data/types';

const TEXTBOOK = readFileSync(join(process.cwd(), 'docs', 'source', 'textbook-text.md'), 'utf8');
/** 교과서 추출본의 줄바꿈·공백을 없앤 비교용 문자열 */
const squash = (s: string) => s.replace(/[\s‘’'"]/g, '');
const TB = squash(TEXTBOOK);

describe('편지 문제 은행(PRD 6.7.4, v0.3.1)', () => {
  const maxSlots = slotsByDifficulty(letterCountRule.max);

  it('구간별 최소 문항 수: L1·L2·L3 8 이상, L4 6 이상', () => {
    expect(stageLetters('L1').length).toBeGreaterThanOrEqual(8);
    expect(stageLetters('L2').length).toBeGreaterThanOrEqual(8);
    expect(stageLetters('L3').length).toBeGreaterThanOrEqual(8);
    expect(stageLetters('L4').length).toBeGreaterThanOrEqual(6);
  });

  it('L1 고유 문항: 난이도별 5 이상, 합계 10 이상', () => {
    expect(stageLetters('L1', 'easy').length).toBeGreaterThanOrEqual(5);
    expect(stageLetters('L1', 'normal').length).toBeGreaterThanOrEqual(5);
    expect(stageLetters('L1').length).toBeGreaterThanOrEqual(10);
  });

  it('common 문항 6 이상(쉬움·보통 각 3 이상), 모두 쪽수·해설', () => {
    expect(commonLetters().length).toBeGreaterThanOrEqual(6);
    expect(commonLetters('easy').length).toBeGreaterThanOrEqual(3);
    expect(commonLetters('normal').length).toBeGreaterThanOrEqual(3);
    for (const q of commonLetters()) {
      expect(q.lesson).toBe('common');
      expect(q.pages.length).toBeGreaterThan(0);
      expect(q.explain.length).toBeGreaterThan(10);
    }
  });

  it('구간별 "고유 + common" 난이도별 개수(단독 판 최대 10통 = 난이도별 5)', () => {
    const report: Record<string, Record<string, string>> = {};
    for (const l of ['L1', 'L2', 'L3', 'L4'] as LessonId[]) {
      report[l] = {};
      for (const d of ['easy', 'normal'] as Difficulty[]) {
        const own = stageLetters(l, d).length;
        const bank = letterBank(l, d).length;
        report[l][d] = `${own} + ${bank - own} = ${bank} (필요 ${maxSlots[d]})`;
        expect(bank, `${l} ${d}`).toBeGreaterThanOrEqual(maxSlots[d]);
      }
    }
    console.table(report);
  });

  it('모든 문항: 해설·쪽수, 보기·정답 형식, 관세사 오해 문구 없음', () => {
    for (const q of letters) {
      expect(q.explain.length, q.id).toBeGreaterThan(10);
      expect(q.pages.length, q.id).toBeGreaterThan(0);
      if (q.type === 'choice3') {
        expect(q.choices, q.id).toHaveLength(3);
        expect([0, 1, 2], q.id).toContain(q.answer);
      } else expect(['O', 'X'], q.id).toContain(q.answer);
      if (q.format === 'gullNews') expect(q.passage, q.id).toBeTruthy();
      expect(JSON.stringify(q)).not.toMatch(/관세를 깎/);
    }
    expect(letters.some((q) => q.format === 'customs')).toBe(true);
    expect(letters.some((q) => q.format === 'gullNews')).toBe(true);
  });

  it('교과서 기사를 인용한 지문은 교과서 원문에 그대로 있다', () => {
    for (const q of letters.filter((x) => x.source)) {
      expect(TB, q.id).toContain(squash(q.passage!.replace(/\.$/, '')));
    }
  });
});

describe('확인 퀴즈(PRD 6.7.5)', () => {
  it('구간마다 지정 2 + 예비 2', () => {
    for (const l of ['L1', 'L2', 'L3', 'L4'] as LessonId[]) {
      expect(checkQuizFor(l, true)).toHaveLength(2);
      expect(checkQuizFor(l, false).length).toBeGreaterThanOrEqual(2);
    }
    for (const q of checkQuiz) expect(q.pages.length).toBeGreaterThan(0);
  });
  it('편지 은행과 ID가 겹치지 않는다', () => {
    const ids = new Set(letters.map((q) => q.id));
    for (const q of checkQuiz) expect(ids.has(q.id)).toBe(false);
  });
});

describe('컨테이너 OX(p.111)', () => {
  it('8문장이 교과서 원문과 같고 옳은 문장은 1·5·7·8', () => {
    expect(containerSentences).toHaveLength(8);
    for (const s of containerSentences) expect(TB, `${s.no}`).toContain(squash(s.text));
    expect(CORRECT_CONTAINER_NOS).toEqual([1, 5, 7, 8]);
  });
  it('자기 평가 3문항이 교과서 원문과 같다', () => {
    expect(selfEvaluation).toHaveLength(3);
    for (const s of selfEvaluation) expect(TB).toContain(squash(s.text));
  });
});

describe('교과서 속 기사 원문(p.106, p.109)', () => {
  it('기사 본문이 교과서 텍스트와 같다', () => {
    for (const a of Object.values(textbookArticles)) {
      expect(TB, a.id).toContain(squash(a.body));
      for (const t of a.underlineTargets) expect(squash(a.body)).toContain(squash(t.sentence));
    }
    expect(textbookArticles.mineralCoop).toMatchObject({ source: '『전자 신문』', date: '2023. 11. 28.' });
    expect(textbookArticles.vietnamFactory).toMatchObject({ source: '『한국 무역 신문』', date: '2022. 12. 11.' });
  });
});
