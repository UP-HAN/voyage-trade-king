/**
 * 컨테이너 싣기 OX + 자기 평가 (L4-E6, PRD 6.12.7, 교과서 p.111) — 작업 174.
 *
 * 1. 싣기: 교과서 문장 8개가 적힌 컨테이너를 눌러(또는 끌어) 트럭에 싣고 내린다. 옳은 문장만 실어야 한다.
 * 2. [다 실었어요] → 컨테이너마다 O/X·맞혔는지·해설·쪽(data/containers.ts).
 * 3. 자기 평가 3문항(교과서 문장 그대로, 별 1~3개) → [마치기] → 응답 `{ picks, self }`(호스트가 다시 채점 — activities.ts).
 * 보상 없음(정답 수는 지표에 넣지 않음). 알파벳 퍼즐은 교과서에서 직접(맨 아래 작은 글씨).
 * 그림(minigame/container-truck.png, container-1~6.png)이 없으면 CSS 상자(아트 스타일 3.2 컨테이너 6색)로 그린다.
 */
import { useRef, useState } from 'preact/hooks';
import type { Action } from '../../core';
import { helperText } from '../../data/worksheetHelpers';
import { containerSentences, containersGame, CORRECT_CONTAINER_NOS, selfEvaluation } from '../../data/containers';
import { worksheetById } from '../../data/worksheet';
import { img } from '../../ui/common/asset';
import type { MeView } from '../predict';
import type { StudentActResult } from '../store';
import './wrapup.css';

/** 아트 스타일 3.2 컨테이너 6색(그림이 없을 때) */
export const CONTAINER_COLORS = ['#B5523B', '#3B6E8F', '#6C8F4E', '#D9A441', '#7A5C8E', '#2E7D8C'] as const;

export interface ContainersProps {
  me: MeView;
  act: (action: Action) => StudentActResult;
  /** 이 판에 학습지 ⑯이 있으면 'W16'(다 한 뒤 안내) */
  worksheet?: 'W16' | null;
  /** 따라잡기 등에서 닫기 버튼(없으면 그리지 않음) */
  onClose?: () => void;
}

type Step = 'load' | 'graded' | 'self';

const pagesText = (pages: readonly number[]) => `교과서 ${pages.join('·')}쪽`;

/** 지난 응답(새로 고침 뒤 결과 다시 보기) */
function savedResult(me: MeView): { correct: number; total: number; wrongNos: number[]; picks: number[] | null } | null {
  const r = me.game.responses['L4-E6'] as Record<string, unknown> | undefined;
  if (!r || typeof r !== 'object' || typeof r.correct !== 'number') return null;
  const wrongNos = Array.isArray(r.wrongNos) ? (r.wrongNos as unknown[]).map(Number) : [];
  const picks = Array.isArray(r.picks) ? (r.picks as unknown[]).map(Number) : null;
  return { correct: r.correct, total: typeof r.total === 'number' ? r.total : 8, wrongNos, picks };
}

function Box({ no, text, compact }: { no: number; text: string; compact?: boolean }) {
  const [broken, setBroken] = useState(false);
  const color = CONTAINER_COLORS[(no - 1) % CONTAINER_COLORS.length];
  return (
    <span class={`wz-box${compact ? ' wz-box--compact' : ''}`} style={{ background: color }}>
      {!broken && <img class="wz-box__img" src={img(`minigame/container-${((no - 1) % 6) + 1}.png`)} alt="" decoding="async" draggable={false} onError={() => setBroken(true)} />}
      <span class="wz-box__no">{no}</span>
      <span class="wz-box__text">{text}</span>
    </span>
  );
}

function Truck() {
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <span class="wz-truck__css" aria-hidden="true">
        <span class="wz-truck__cab" />
        <span class="wz-truck__bed" />
        <span class="wz-truck__wheel wz-truck__wheel--1" />
        <span class="wz-truck__wheel wz-truck__wheel--2" />
        <span class="wz-truck__wheel wz-truck__wheel--3" />
      </span>
    );
  }
  return <img class="wz-truck__img" src={img(containersGame.image)} alt="" decoding="async" draggable={false} onError={() => setBroken(true)} />;
}

export function Containers({ me, act, worksheet, onClose }: ContainersProps) {
  const saved = savedResult(me);
  const [loaded, setLoaded] = useState<number[]>(() => saved?.picks ?? []);
  const [step, setStep] = useState<Step>('load');
  const [self, setSelf] = useState<(number | null)[]>([null, null, null]);
  const [sent, setSent] = useState(false);
  const [drag, setDrag] = useState<{ no: number; x: number; y: number; dx: number; dy: number; moved: boolean } | null>(null);
  const truckRef = useRef<HTMLDivElement>(null);

  const toggle = (no: number) => setLoaded((l) => (l.includes(no) ? l.filter((x) => x !== no) : [...l, no].sort((a, b) => a - b)));
  const setLoad = (no: number, on: boolean) => setLoaded((l) => (on ? (l.includes(no) ? l : [...l, no].sort((a, b) => a - b)) : l.filter((x) => x !== no)));

  // 끌기: 손가락·마우스를 뗀 곳이 트럭 칸이면 싣고, 부두 칸이면 내린다. 거의 움직이지 않았으면 누르기(싣기/내리기 바꿈)
  const onDown = (no: number) => (e: PointerEvent) => {
    if (step !== 'load') return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setDrag({ no, x: e.clientX, y: e.clientY, dx: 0, dy: 0, moved: false });
  };
  const onMove = (e: PointerEvent) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    setDrag({ ...drag, dx, dy, moved: drag.moved || Math.hypot(dx, dy) > 12 });
  };
  const onUp = (e: PointerEvent) => {
    if (!drag) return;
    const d = drag;
    setDrag(null);
    if (!d.moved) return toggle(d.no);
    const r = truckRef.current?.getBoundingClientRect();
    const inTruck = !!r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    setLoad(d.no, inTruck);
  };
  const onKey = (no: number) => (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle(no);
    }
  };

  const finish = () => {
    if (self.some((s) => s === null)) return;
    const r = act({ type: 'respondEvent', eventId: 'L4-E6', response: { picks: loaded, self: self as number[] } as never });
    if (r !== 'blocked') setSent(true);
  };

  const ws = worksheet ? worksheetById[worksheet] : null;
  const note = <p class="wz-note" data-testid="containers-puzzle-note">{containersGame.puzzleNote}</p>;

  // 이미 마쳤으면(새로 고침·다시 들어옴) 결과 요약
  if (saved || sent) {
    const res = saved ?? (() => {
      const wrongNos = containerSentences.filter((s) => loaded.includes(s.no) !== s.correct).map((s) => s.no);
      return { correct: 8 - wrongNos.length, total: 8, wrongNos, picks: loaded };
    })();
    return (
      <section class="st-wrap__sec wz-sec" data-testid="wrap-containers" data-step="done">
        <h2 class="title-font">{containersGame.title}</h2>
        <p class="wz-done" data-testid="containers-done" role="status">
          다 했어요! 컨테이너 8개 중 <b>{res.correct}</b>개 맞혔어요.
        </p>
        {ws && (
          <p class="st-wrap__where" data-testid="containers-worksheet">
            학습지 {ws.label}({ws.pagesLabel})에 옮겨 써요 · [내 기록: {helperText('containerResult', res)}]
          </p>
        )}
        <p class="st-wrap__where">선생님이 공용 화면에 문장별 결과를 보여 줄 거예요.</p>
        {onClose && (
          <button type="button" class="btn btn--secondary" onClick={onClose}>
            닫기
          </button>
        )}
        {note}
      </section>
    );
  }

  if (step === 'load') {
    const yard = containerSentences.filter((s) => !loaded.includes(s.no));
    const onTruck = containerSentences.filter((s) => loaded.includes(s.no));
    const item = (s: (typeof containerSentences)[number], where: 'yard' | 'truck') => {
      const dragging = drag?.no === s.no;
      return (
        <li key={s.no}>
          <button
            type="button"
            class={`wz-item${dragging && drag?.moved ? ' wz-item--drag' : ''}`}
            data-testid="container"
            data-no={s.no}
            data-where={where}
            aria-pressed={where === 'truck'}
            aria-label={`${s.no}번 컨테이너: ${s.text} — ${where === 'truck' ? '트럭에 실었어요(누르면 내려요)' : '누르면 트럭에 실어요'}`}
            style={dragging && drag?.moved ? { transform: `translate(${drag.dx}px, ${drag.dy}px)` } : undefined}
            onPointerDown={onDown(s.no) as never}
            onPointerMove={onMove as never}
            onPointerUp={onUp as never}
            onPointerCancel={() => setDrag(null)}
            onKeyDown={onKey(s.no) as never}
          >
            <Box no={s.no} text={s.text} compact={where === 'truck'} />
          </button>
        </li>
      );
    };
    return (
      <section class="st-wrap__sec wz-sec" data-testid="wrap-containers" data-step="load">
        <h2 class="title-font">{containersGame.title}</h2>
        <p class="st-wrap__lead">
          {containersGame.instruction} 누르거나 끌어서 싣고, 다시 누르면 내려요. <small>({pagesText(containersGame.pages)})</small>
        </p>
        <div class="wz-truck" ref={truckRef} data-testid="containers-truck" data-count={loaded.length}>
          <Truck />
          <ul class="wz-truck__load" aria-label="트럭에 실은 컨테이너">
            {onTruck.map((s) => item(s, 'truck'))}
            {!onTruck.length && <li class="wz-truck__empty">여기에 실어요</li>}
          </ul>
        </div>
        <ul class="wz-yard" aria-label="부두의 컨테이너">
          {yard.map((s) => item(s, 'yard'))}
        </ul>
        <div class="wz-actions">
          <button type="button" class="btn btn--primary btn--large" data-testid="containers-submit" disabled={!loaded.length} onClick={() => setStep('graded')}>
            다 실었어요
          </button>
          {!loaded.length && <span class="st-wrap__where">컨테이너를 하나 이상 실어요</span>}
        </div>
        {note}
      </section>
    );
  }

  if (step === 'graded') {
    const correct = containerSentences.filter((s) => loaded.includes(s.no) === s.correct).length;
    return (
      <section class="st-wrap__sec wz-sec" data-testid="wrap-containers" data-step="graded">
        <h2 class="title-font">정답 확인</h2>
        <p class="wz-score" data-testid="containers-score">
          컨테이너 8개 중 <b>{correct}</b>개 맞혔어요. 옳은 문장은 {CORRECT_CONTAINER_NOS.length}개예요.
        </p>
        <ol class="wz-result">
          {containerSentences.map((s) => {
            const mine = loaded.includes(s.no);
            const right = mine === s.correct;
            return (
              <li key={s.no} class={`wz-res${right ? ' wz-res--right' : ' wz-res--wrong'}`} data-testid="container-result" data-no={s.no} data-right={right ? '1' : '0'}>
                <span class={`wz-ox ${s.correct ? 'wz-ox--o' : 'wz-ox--x'}`} aria-label={s.correct ? '옳은 문장' : '틀린 문장'}>
                  {s.correct ? 'O' : 'X'}
                </span>
                <span class="wz-res__body">
                  <span class="wz-res__text">
                    {s.no}. {s.text}
                  </span>
                  <span class="wz-res__mine">
                    {mine ? '트럭에 실었어요' : '싣지 않았어요'} · <b>{right ? '맞혔어요' : '다시 봐요'}</b>
                  </span>
                  <span class="wz-res__explain">
                    {s.explain} <small>({pagesText(s.pages)})</small>
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
        <div class="wz-actions">
          <button type="button" class="btn btn--secondary" data-testid="containers-back" onClick={() => setStep('load')}>
            다시 싣기
          </button>
          <button type="button" class="btn btn--primary btn--large" data-testid="containers-next" onClick={() => setStep('self')}>
            스스로 평가하기
          </button>
        </div>
        {note}
      </section>
    );
  }

  return (
    <section class="st-wrap__sec wz-sec" data-testid="wrap-containers" data-step="self">
      <h2 class="title-font">스스로 평가해요</h2>
      <p class="st-wrap__lead">공부한 내용을 되돌아보고, 문항마다 별을 1~3개 골라요. ({pagesText([111])})</p>
      <ol class="wz-self">
        {selfEvaluation.map((q, i) => (
          <li key={q.no} data-testid="self-eval" data-no={q.no}>
            <p class="wz-self__q">{q.text}</p>
            <div class="wz-stars" role="radiogroup" aria-label={`${q.no}번 문항 별 수`}>
              {[1, 2, 3].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={self[i] === n}
                  class={`wz-star${(self[i] ?? 0) >= n ? ' wz-star--on' : ''}`}
                  data-testid="self-star"
                  data-star={n}
                  aria-label={`별 ${n}개`}
                  onClick={() => setSelf((s) => s.map((v, j) => (j === i ? n : v)))}
                >
                  ★
                </button>
              ))}
            </div>
          </li>
        ))}
      </ol>
      <div class="wz-actions">
        <button type="button" class="btn btn--secondary" onClick={() => setStep('graded')}>
          정답 다시 보기
        </button>
        <button type="button" class="btn btn--primary btn--large" data-testid="containers-finish" disabled={self.some((s) => s === null)} onClick={finish}>
          마치기
        </button>
      </div>
      {note}
    </section>
  );
}

export default Containers;
