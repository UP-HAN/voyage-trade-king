/**
 * 확인 퀴즈 카드(작업 111, PRD 6.7.5): 3지선다 / OX. 공용 화면에 문제, 학생 기기에서 답을 고른다.
 * 결과 공개(`revealed`) 뒤에는 학생 카드에 내 결과·해설·쪽수, 공용 화면 카드에 정답률 막대·해설·쪽수.
 * 공용 화면에는 누가 틀렸는지 보이지 않는다(정답률만).
 */
import type { ComponentChildren } from 'preact';
import type { Answer } from '../../core';
import type { CheckQuizQuestion } from '../../data/types';
import { linkPages } from './model';
import { CardBandLine, CardFrame, type CardSize } from './parts';

export interface CheckQuizCardProps {
  id: string;
  title: string;
  questions: readonly CheckQuizQuestion[];
  size?: CardSize;
  /** 내 결과(문항 ID → right/wrong). 있으면 그 문항은 이미 답함 */
  results?: Readonly<Record<string, 'right' | 'wrong'>>;
  /** 내가 고른 답(이 기기에서 고른 것 — 보이기용) */
  picked?: Readonly<Record<string, Answer>>;
  onAnswer?: (qid: string, answer: Answer) => void;
  /** 결과 공개(해설·정답률) */
  revealed?: boolean;
  /** 공용 화면: 문항별 정답률 */
  rates?: Readonly<Record<string, { right: number; total: number }>>;
  pages?: readonly number[];
  children?: ComponentChildren;
  testId?: string;
}

/** 해설 끝의 "(교과서 96쪽)"은 뺀다 — 쪽수는 옆 "교과서 연결 p.96" 하나로(수정 1회차) */
export function explainText(explain: string): string {
  return explain.replace(/\s*\(교과서 [\d~,\s]+쪽\)\s*$/, '');
}

export function answerLabel(q: CheckQuizQuestion, a: Answer): string {
  if (q.type === 'ox') return String(a);
  return q.choices?.[Number(a)] ?? String(a);
}

function choicesOf(q: CheckQuizQuestion): { value: Answer; label: string }[] {
  if (q.type === 'ox') {
    return [
      { value: 'O', label: 'O' },
      { value: 'X', label: 'X' },
    ];
  }
  return (q.choices ?? []).map((c, i) => ({ value: i, label: c }));
}

export function CheckQuizCard({ id, title, questions, size = 'student', results = {}, picked = {}, onAnswer, revealed, rates, pages = [], children, testId = 'quiz-card' }: CheckQuizCardProps) {
  return (
    <CardFrame size={size} band="concept" testId={testId} id={id} extraClass="vc--quiz">
      <CardBandLine band="concept" text="개념" kind="확인 퀴즈" pages={pages} />
      <div class="vc__text">
        <h2 class="vc__title" data-testid="card-title">
          {title}
        </h2>
        <ol class="vc__quiz">
          {questions.map((q, i) => {
            const mine = results[q.id];
            const rate = rates?.[q.id];
            const pct = rate && rate.total > 0 ? Math.round((rate.right / rate.total) * 100) : 0;
            return (
              <li key={q.id} class="vc__q" data-testid="quiz-q" data-qid={q.id} data-result={mine ?? ''}>
                <p class="vc__q-prompt">
                  <span class="vc__q-no">문제 {i + 1}</span> {q.prompt}
                </p>
                <div class={`vc__q-choices vc__q-choices--${q.type}`} role={onAnswer && !mine ? 'group' : undefined} aria-label={`문제 ${i + 1} 답 고르기`}>
                  {choicesOf(q).map((c) => {
                    const chosen = picked[q.id] === c.value;
                    const correct = revealed && q.answer === c.value;
                    const cls = `vc__q-choice${chosen ? ' is-picked' : ''}${correct ? ' is-correct' : ''}`;
                    return onAnswer && !mine ? (
                      <button key={String(c.value)} type="button" class={cls} data-testid={`quiz-${q.id}-${c.value}`} onClick={() => onAnswer(q.id, c.value)}>
                        {c.label}
                      </button>
                    ) : (
                      <span key={String(c.value)} class={cls}>
                        {c.label}
                      </span>
                    );
                  })}
                </div>
                {mine && !revealed && size === 'student' && (
                  <p class="vc__q-sent" data-testid="quiz-sent">
                    답을 보냈어요. 선생님이 결과를 공개하면 해설이 나와요.
                  </p>
                )}
                {revealed && rates && (
                  <div class="vc__q-rate" data-testid="quiz-rate">
                    <span class="vc__q-rate-bar" style={{ width: `${pct}%` }} />
                    <span class="vc__q-rate-num">정답률 {pct}%</span>
                  </div>
                )}
                {revealed && (
                  <p class="vc__q-explain" data-testid="quiz-explain">
                    {size === 'student' && mine && <b class={`vc__q-mark vc__q-mark--${mine}`}>{mine === 'right' ? '맞았어요' : '다시 생각해 봐요'}</b>} {explainText(q.explain)}{' '}
                    <span class="vc__q-pages" data-testid="quiz-pages">
                      {linkPages(q.pages)}
                    </span>
                  </p>
                )}
              </li>
            );
          })}
        </ol>
        {children}
      </div>
    </CardFrame>
  );
}
