/**
 * 되돌아보기 (L4-E9, PRD 6.14.4) — 작업 174. 작업 132의 문항 보기에 입력 칸을 더했다.
 *
 * - 문항(차시 L1~L3·4차시 앞 시간 = 2문항, 4차시 뒤 시간·두 시간 모두·단원 한 판 = 3문항) 아래 한 줄 입력 칸(각 60자).
 * - 칸 위 도우미 한 줄(`voyageSummary`: 가장 이익이 컸던 거래, 사고판 항구 수, 받은 상 — 공개된 상만).
 * - [복사]: 입력한 글을 한 번에 복사(클립보드가 막히면 글 상자를 펼쳐 선택해 둠). [다 썼어요]: 응답 `{ answers }`(다시 보낼 수 있음).
 * - 쓰지 않아도 진행은 막지 않는다. 쓰는 곳 안내(⑱ 있으면 ⑱, 없으면 공책)는 작업 132 문구 그대로.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { REFLECT_MAX, type Action, type PublicClass, type PublicState, type PublicWrap } from '../../core';
import { helperLine } from '../../core/worksheet-helpers';
import { worksheetById } from '../../data/worksheet';
import type { MeView } from '../predict';
import type { StudentActResult } from '../store';
import { reflectQuestionsOf, revealedAwards, wrapItemOf } from './model';

export interface ReflectProps {
  cls: PublicClass;
  pub: PublicState | null;
  me: MeView;
  wrap: PublicWrap | null;
  act: (action: Action) => StudentActResult;
}

function savedAnswers(me: MeView): string[] | null {
  const r = me.game.reflect as { answers?: unknown } | null | undefined;
  return r && typeof r === 'object' && Array.isArray(r.answers) ? r.answers.map((a) => String(a ?? '')) : null;
}

/** 복사할 글: "1. 문항\n답" 줄들 */
export function reflectCopyText(qs: readonly string[], answers: readonly string[]): string {
  return qs.map((q, i) => `${i + 1}. ${q}\n${(answers[i] ?? '').trim()}`).join('\n');
}

export function Reflect({ cls, pub, me, wrap, act }: ReflectProps) {
  const item = wrapItemOf(cls, 'reflect');
  const qs = reflectQuestionsOf(item);
  const hasW18 = !!item?.worksheetIds.includes('W18');
  const w18 = worksheetById.W18;
  const saved = savedAnswers(me);
  const [answers, setAnswers] = useState<string[]>(() => qs.map((_, i) => saved?.[i] ?? ''));
  const [sentText, setSentText] = useState<string | null>(saved ? JSON.stringify(saved.slice(0, qs.length)) : null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'select'>('idle');
  const boxRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (copyState === 'select') {
      boxRef.current?.focus();
      boxRef.current?.select();
    }
  }, [copyState]);

  let helper = '';
  try {
    helper = helperLine('voyageSummary', { cls: cls as never, player: me as never, pub: pub ? { ...pub, awards: revealedAwards(pub, wrap) } : null });
  } catch {
    helper = '';
  }
  const copyText = reflectCopyText(qs, answers);
  const dirty = sentText !== JSON.stringify(answers);

  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard');
      await navigator.clipboard.writeText(copyText);
      setCopyState('copied');
    } catch {
      setCopyState('select');
    }
  };
  const submit = () => {
    const r = act({ type: 'respondEvent', eventId: 'L4-E9', response: { answers } as never });
    if (r !== 'blocked') setSentText(JSON.stringify(answers));
  };

  return (
    <section class="st-wrap__sec" data-testid="wrap-reflect" data-questions={qs.length}>
      <h2 class="title-font">되돌아보기</h2>
      <p class="st-wrap__lead">항해를 되돌아보며 문항마다 한 줄씩 써요. 도감과 항해 기록장을 보면 쓰기 쉬워요.</p>
      {helper && (
        <p class="wz-helper" data-testid="wrap-reflect-helper">
          [내 기록: {helper}]
        </p>
      )}
      <ol class="st-wrap__qs wz-qs" data-testid="wrap-reflect-questions">
        {qs.map((q, i) => (
          <li key={i}>
            <label class="wz-q">
              <span class="wz-q__text">{q}</span>
              <input
                type="text"
                class="wz-input"
                data-testid="reflect-input"
                data-no={i + 1}
                maxLength={REFLECT_MAX}
                value={answers[i] ?? ''}
                placeholder="한 줄로 써요"
                onInput={(e) => {
                  const v = [...(e.currentTarget as HTMLInputElement).value].slice(0, REFLECT_MAX).join('');
                  setAnswers((a) => a.map((x, j) => (j === i ? v : x)));
                }}
              />
              <small class="wz-count">
                {[...(answers[i] ?? '')].length}/{REFLECT_MAX}
              </small>
            </label>
          </li>
        ))}
      </ol>
      <div class="wz-actions">
        <button type="button" class="btn btn--secondary" data-testid="reflect-copy" onClick={() => void copy()}>
          복사
        </button>
        <button type="button" class="btn btn--primary btn--large" data-testid="reflect-submit" disabled={!dirty && sentText !== null} onClick={submit}>
          {sentText !== null && !dirty ? '보냈어요' : '다 썼어요'}
        </button>
      </div>
      {copyState === 'copied' && (
        <p class="st-wrap__where" data-testid="reflect-copied" role="status">
          복사했어요. 학습지나 공책에 붙여 넣거나 보고 옮겨 써요.
        </p>
      )}
      {copyState === 'select' && (
        <div class="wz-copybox">
          <p class="st-wrap__where" role="status">
            복사가 막혀 있어요. 아래 글을 길게 눌러 모두 고른 뒤 복사해요.
          </p>
          <textarea ref={boxRef} class="wz-copybox__text" data-testid="reflect-copy-box" readOnly rows={qs.length * 2} value={copyText} />
        </div>
      )}
      {sentText !== null && !dirty && (
        <p class="st-wrap__where" data-testid="reflect-sent" role="status">
          선생님께 보냈어요. 고쳐 쓰면 다시 보낼 수 있어요.
        </p>
      )}
      <p class="st-wrap__where" data-testid="wrap-reflect-where">
        {hasW18
          ? `학습지 ${w18.label}(${w18.pagesLabel})에 한 줄씩 써요.`
          : `오늘은 공책이나 선생님이 정한 곳에 한 줄씩 써요. 학습지 ${w18.label}(되돌아보기)은 단원 마지막 시간에 세 문항을 모두 써요.`}
      </p>
    </section>
  );
}

export default Reflect;
