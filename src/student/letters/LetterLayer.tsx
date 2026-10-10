/**
 * 편지·갈매기 퀴즈 층(S14, PRD 6.7) — 작업 112. z-index 50(사건 카드 아래), **모달이 아닌 오른쪽 패널**이라 거래를 막지 않는다.
 *
 * - 라운드 시작에 새 슬롯이 도착하면(`class.letters.delivered`가 늘면) 갈매기 연출: `fx.gull(갈매기 요소, { slotIds })` —
 *   기본 구현은 갈매기 이미지(`letters/seagull-fly.png`, 없으면 SVG 실루엣)가 화면 위를 지나 편지함 쪽으로 내려가는 CSS 이동.
 *   HUD 편지함 아이콘(`LetterBadge`)에 숫자 배지.
 * - 편지 화면: 'customs' = 양피지 편지지(letters/letter-paper.png, border-image — 그림의 밀랍 봉인 조각 포함) + "발신: 관세사 도윤"(초상 작게),
 *   'gullNews' = 바다 소식 두루마리(letters/news-scroll.png) + (fake면) 가상 뉴스 띠. 지문·질문·선택지(3지선다 큰 버튼 또는 [O][X])·
 *   이 슬롯 보상 미리보기. 이미지가 없으면 border-image가 그려지지 않고 CSS 양피지 색 바탕만 남는다.
 * - 정답: "정답!" 도장(`fx.stamp(도장 요소, { kind: 'correct' })`) + 보상 안내 + 말풍선 칭찬. 오답: 보상 없음, 정답·해설·교과서 쪽수 +
 *   [알겠어요]로만 닫힘. 다시 열면 결과·해설만(재답 불가 — core가 막음). 기한이 지난 편지는 "답장 기한이 지났어요" + 해설 보기.
 * - 라운드 끝(출항) 순간 열려 있던 편지 화면은 학생이 닫을 때까지 그대로 둔다(패널은 학생만 닫음).
 * - 학습지 팝업(70) 안에서도 편지함을 볼 수 있게 `LetterPanel`을 내보낸다(WorksheetLayer가 씀).
 * slots.tsx가 학급 상태·내 회사·행동 함수를 넘긴다.
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { isBlocking, type Action, type Answer, type PublicClass } from '../../core';
import { eventsById } from '../../data/events';
import { banners } from '../../data/text';
import type { LetterQuestion } from '../../data/types';
import { Img } from '../../ui/common/Img';
import { img } from '../../ui/common/asset';
import { fx, reducedMotion } from '../../ui/common/fx';
import { toggleAllowed } from '../guard';
import type { MeView } from '../predict';
import type { StudentActResult } from '../store';
import { EnvelopeIcon } from './LetterBadge';
import {
  answerText,
  explainBody,
  letterBox,
  letterStatus,
  pagesText,
  praiseText,
  rewardDone,
  rewardPreview,
  senderText,
  slotTag,
  STATUS_TEXT,
  type LetterView,
} from './model';
import { closeLetters, setLetterUi, useLetterUi } from './ui';
import './letters.css';

export interface LetterLayerProps {
  classState: PublicClass;
  player: MeView;
  act: (action: Action) => StudentActResult;
}

/** 갈매기가 화면을 지나는 시간(ms) — 202가 fx.gull 본구현으로 바꿀 때 참고 */
export const GULL_MS = 1800;

export function LetterLayer({ classState, player, act }: LetterLayerProps) {
  const ui = useLetterUi();
  const gull = useGullArrival(classState);
  const tradeOver = classState.phase === 'wrapup' || classState.phase === 'ended';
  return (
    <>
      {gull && <GullFlight key={gull.key} slotIds={gull.slotIds} />}
      {ui.open && !tradeOver && (
        <div class={`lt-dock${eventPanelOpen(classState) ? ' lt-dock--left' : ''}`} style={{ zIndex: 50 }} data-layer="letter">
          <LetterPanel classState={classState} player={player} act={act} onClose={closeLetters} />
        </div>
      )}
    </>
  );
}

/** 비차단 사건 오른쪽 패널(111, z 55)이 떠 있는가 — 그때는 편지 패널을 왼쪽에 둬서 겹치지 않게 한다 */
export function eventPanelOpen(cls: PublicClass): boolean {
  const ce = cls.currentEvent;
  if (!ce || ce.closed) return false;
  const def = eventsById[ce.id];
  return !!def && !isBlocking(def, ce.short);
}

/** 새로 도착한 슬롯(처음 그릴 때 이미 와 있던 편지는 연출하지 않음) */
function useGullArrival(cls: PublicClass): { key: number; slotIds: string[] } | null {
  const seen = useRef<string[] | null>(null);
  const [gull, setGull] = useState<{ key: number; slotIds: string[] } | null>(null);
  const delivered = cls.letters.delivered;
  const sig = delivered.join(',');
  useEffect(() => {
    if (seen.current === null) {
      seen.current = [...delivered];
      return;
    }
    const fresh = delivered.filter((id) => !seen.current!.includes(id) && !cls.letters.skipped.includes(id));
    seen.current = [...delivered];
    if (!fresh.length) return;
    setGull({ key: Date.now(), slotIds: fresh });
    const t = setTimeout(() => setGull(null), GULL_MS + 400);
    return () => clearTimeout(t);
  }, [sig]);
  return gull;
}

function GullSilhouette() {
  return (
    <svg class="lt-gull__img" viewBox="0 0 64 40" aria-hidden="true">
      <path d="M2 18Q16 4 30 18Q33 21 34 18Q48 4 62 18Q46 12 34 24Q32 27 30 24Q18 12 2 18Z" fill="#EFE2BF" stroke="#2B2318" stroke-width="2" stroke-linejoin="round" />
      <path d="M30 24L32 30L34 24" fill="#C0623F" stroke="#2B2318" stroke-width="1.2" />
    </svg>
  );
}

/** 갈매기 도착 연출(기본: CSS 이동 한 번). fx.gull 훅을 함께 부른다 */
function GullFlight({ slotIds }: { slotIds: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    void fx.gull(ref.current, { slotIds });
  }, []);
  return (
    <div
      ref={ref}
      class={`lt-gull${reducedMotion() ? ' is-reduced' : ''}`}
      style={{ animationDuration: `${GULL_MS}ms` }}
      data-testid="gull"
      data-slots={slotIds.join(',')}
      role="status"
      aria-label="갈매기가 편지를 가져왔어요"
    >
      {failed ? <GullSilhouette /> : <img class="lt-gull__img" src={img('letters/seagull-fly.png')} alt="" onError={() => setFailed(true)} />}
      <span class="lt-gull__mail">
        <EnvelopeIcon size={22} />
      </span>
    </div>
  );
}

export interface LetterPanelProps extends LetterLayerProps {
  onClose: () => void;
}

/** 오른쪽 편지 패널(편지함 목록 / 편지 한 통) */
export function LetterPanel({ classState, player, act, onClose }: LetterPanelProps) {
  const ui = useLetterUi();
  const views = letterBox(classState, player);
  const open = ui.slotId ? views.find((v) => v.slot.slotId === ui.slotId) ?? null : null;
  // 이 화면에서 방금 틀린 편지는 [알겠어요]를 눌러야 닫힘(PRD 6.7.3)
  const [mustAck, setMustAck] = useState<string | null>(null);
  const showForecastTab = (classState.incidents?.forecasts?.length ?? 0) > 0;
  const back = () => setLetterUi({ slotId: null });
  // 호스트가 답을 거절(되돌림)하면 결과가 사라지므로 잠그지 않는다
  const locked = mustAck !== null && views.some((v) => v.slot.slotId === mustAck && v.result === 'wrong');
  return (
    <aside class="lt-panel" role="complementary" aria-label="편지함" data-testid="letter-panel">
      <header class="lt-panel__head">
        <div class="lt-tabs" role="tablist">
          <button type="button" role="tab" class="lt-tab" aria-selected={ui.tab === 'letters'} onClick={() => setLetterUi({ tab: 'letters' })}>
            편지함
          </button>
          {/* 바다 소식(돌발 사건 예보) 탭 자리 — 작업 126이 채운다. 예보가 없으면 숨긴다 */}
          {showForecastTab && (
            <button type="button" role="tab" class="lt-tab" data-testid="tab-forecast" aria-selected={ui.tab === 'forecast'} onClick={() => setLetterUi({ tab: 'forecast', slotId: null })}>
              바다 소식
            </button>
          )}
        </div>
        {!locked && (
          <button type="button" class="lt-close" data-testid="letter-close" aria-label="편지함 닫기" onClick={onClose}>
            닫기
          </button>
        )}
      </header>
      {ui.tab === 'forecast' && showForecastTab ? (
        <p class="lt-empty">바다 소식(예보)은 곧 이곳에 와요.</p>
      ) : open ? (
        <LetterRead
          view={open}
          act={act}
          mustAck={mustAck === open.slot.slotId}
          onWrong={() => setMustAck(open.slot.slotId)}
          onAck={() => {
            setMustAck(null);
            back();
          }}
          onBack={locked ? null : back}
        />
      ) : (
        <LetterList views={views} />
      )}
    </aside>
  );
}

function LetterList({ views }: { views: LetterView[] }) {
  if (!views.length) {
    return (
      <p class="lt-empty" data-testid="letter-empty">
        아직 도착한 편지가 없어요. 라운드가 시작되면 갈매기가 편지를 가져와요.
      </p>
    );
  }
  return (
    <ul class="lt-list" data-testid="letter-list">
      {[...views].reverse().map((v) => {
        const st = letterStatus(v);
        return (
          <li key={v.slot.slotId}>
            <button
              type="button"
              class={`lt-item lt-item--${st}`}
              data-testid="letter-item"
              data-slot={v.slot.slotId}
              data-status={st}
              onClick={() => setLetterUi({ slotId: v.slot.slotId })}
            >
              <EnvelopeIcon size={30} />
              <span class="lt-item__body">
                <b>{v.question ? senderText(v.question) : '편지'}</b>
                <small>
                  {slotTag(v)} · {STATUS_TEXT[st]}
                </small>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function LetterRead({
  view,
  act,
  mustAck,
  onWrong,
  onAck,
  onBack,
}: {
  view: LetterView;
  act: (a: Action) => StudentActResult;
  mustAck: boolean;
  onWrong: () => void;
  onAck: () => void;
  onBack: (() => void) | null;
}) {
  const q = view.question;
  const lastAt = useRef<number | null>(null);
  const stampRef = useRef<HTMLSpanElement>(null);
  const [showExplain, setShowExplain] = useState(false);
  const result = view.result;
  useEffect(() => {
    if (result === 'right' && stampRef.current) void fx.stamp(stampRef.current, { kind: 'correct' });
  }, [result]);
  if (!q) {
    return (
      <div class="lt-read">
        <p class="lt-empty">이 편지를 읽지 못했어요. 선생님께 말해요.</p>
        {onBack && (
          <button type="button" class="btn btn--secondary" onClick={onBack}>
            편지함으로
          </button>
        )}
      </div>
    );
  }
  const answer = (a: Answer) => {
    const t = Date.now();
    if (!toggleAllowed(lastAt.current, t)) return;
    lastAt.current = t;
    const r = act({ type: 'answerLetter', slotId: view.slot.slotId, answer: a });
    if (r === 'blocked' || r === 'notIn') return;
    // 미리 계산(predict)으로 결과가 바로 보인다. 오답이면 [알겠어요]를 눌러야 닫힘
    const right = q.answer === a;
    if (!right) onWrong();
  };
  const canAnswer = !result && !view.expired;
  return (
    <div class="lt-read" data-testid="letter-read" data-slot={view.slot.slotId} data-question={q.id} data-format={q.format} data-result={result ?? (view.expired ? 'expired' : 'open')}>
      <LetterSheet q={q} tag={slotTag(view)}>
        {canAnswer ? (
          <>
            <div class={`lt-choices${q.type === 'ox' ? ' lt-choices--ox' : ''}`} role="group" aria-label="답 고르기">
              {q.type === 'ox'
                ? (['O', 'X'] as const).map((x) => (
                    <button key={x} type="button" class="btn lt-choice lt-choice--ox" data-testid="letter-choice" data-answer={x} onClick={() => answer(x)}>
                      {x}
                    </button>
                  ))
                : (q.choices ?? []).map((c, i) => (
                    <button key={i} type="button" class="btn lt-choice" data-testid="letter-choice" data-answer={i} onClick={() => answer(i)}>
                      <span class="lt-choice__no">{'①②③'[i]}</span> {c}
                    </button>
                  ))}
            </div>
            <p class="lt-reward" data-testid="letter-reward">
              {rewardPreview(view.slot.reward)}
            </p>
          </>
        ) : result === 'right' ? (
          <div class="lt-result lt-result--right" data-testid="letter-right">
            <span ref={stampRef} class="lt-stamp" role="img" aria-label="정답 도장">
              정답!
            </span>
            <p class="lt-result__reward" data-testid="letter-reward-done">
              {rewardDone(view.slot.reward)}
            </p>
            <p class="lt-bubble" data-testid="letter-praise">
              <b>{praiseText(q).who}</b> {praiseText(q).text}
            </p>
            <Explain q={q} />
          </div>
        ) : result === 'wrong' ? (
          <div class="lt-result lt-result--wrong" data-testid="letter-wrong">
            <p class="lt-result__title">아쉬워요. 해설을 읽어 봐요.</p>
            <p class="lt-answer">
              정답: <b>{answerText(q)}</b>
            </p>
            <Explain q={q} />
            {mustAck && (
              <button type="button" class="btn btn--primary lt-ack" data-testid="letter-ack" onClick={onAck}>
                알겠어요
              </button>
            )}
          </div>
        ) : (
          <div class="lt-result lt-result--expired" data-testid="letter-expired">
            <p class="lt-result__title">답장 기한이 지났어요</p>
            {showExplain ? (
              <>
                <p class="lt-answer">
                  정답: <b>{answerText(q)}</b>
                </p>
                <Explain q={q} />
              </>
            ) : (
              <button type="button" class="btn btn--secondary" data-testid="letter-show-explain" onClick={() => setShowExplain(true)}>
                해설 보기
              </button>
            )}
          </div>
        )}
      </LetterSheet>
      {onBack && !mustAck && (
        <button type="button" class="btn btn--secondary lt-back" data-testid="letter-back" onClick={onBack}>
          편지함으로
        </button>
      )}
    </div>
  );
}

function Explain({ q }: { q: LetterQuestion }) {
  return (
    <div class="lt-explain" data-testid="letter-explain">
      <p>{explainBody(q.explain)}</p>
      <p class="lt-pages" data-testid="letter-pages">
        {pagesText(q.pages)}
      </p>
    </div>
  );
}

/** 편지지(관세사) 또는 두루마리(갈매기 바다 소식) 위에 글자를 얹는다 */
function LetterSheet({ q, tag, children }: { q: LetterQuestion; tag: string; children: ComponentChildren }) {
  const customs = q.format === 'customs';
  const art = customs ? 'letters/letter-paper.png' : 'letters/news-scroll.png';
  return (
    <article class={`lt-sheet ${customs ? 'lt-sheet--paper' : 'lt-sheet--scroll'}`} style={{ borderImageSource: `url("${img(art)}")` }} data-testid="letter-sheet">
      <div class="lt-sheet__head">
        {customs ? (
          <span class="lt-from">
            <Img path="characters/customs-doyun.png" alt="관세사 도윤" fallbackLabel="도윤" class="lt-from__face" width={44} height={44} />
            <b data-testid="letter-from">{senderText(q)}</b>
          </span>
        ) : (
          <span class="lt-from lt-from--gull">
            <Img path="letters/seagull-land.png" alt="갈매기" fallbackLabel="갈매기" class="lt-from__face" width={44} height={44} />
            <b data-testid="letter-from">{senderText(q)}</b>
          </span>
        )}
        <span class="lt-tag" data-testid="letter-tag">
          {tag}
        </span>
      </div>
      {q.fake && (
        <p class="lt-fake" data-testid="letter-fake">
          {banners.fakeNews}
        </p>
      )}
      {q.passage && <p class="lt-passage">{q.passage}</p>}
      <p class="lt-question" data-testid="letter-question">
        {q.prompt}
      </p>
      {children}
    </article>
  );
}

export default LetterLayer;
