/**
 * 학생 사건 층(작업 111, PRD 6.11·8.3 S12·S13, v0.3).
 *
 * `class.currentEvent`가 바뀌면 카드가 뜬다 — 교사가 [지금]/[발동]했든 배치표가 자동 발동했든 같다.
 * - 차단형 사건: 가운데 카드(아래 조작 막음). [확인]만 있는 카드는 확인하면 닫힌다(`respondEvent` 기록).
 *   응답이 필요한 사건(결정·확인 퀴즈·미니게임)은 응답 뒤 "선생님이 다음으로 넘어갈 때까지 기다려요" + [도감 보기].
 * - 비차단 사건(L1-E6 천연가스 뉴스·임무, L1-E7 흑연 결정): 오른쪽 패널. 거래를 막지 않는다.
 * - 짧은 형태(`currentEvent.short`): 카드 모델이 짧게 그린다(L1-E2 정의 카드 한 장, L1-E4 상황 카드 1장).
 * - 미니게임 사건: `src/minigames/MinigameLayer.tsx`(113)로 넘긴다.
 * - 따라잡기: 입장·재입장 때 `catchUpPlan`(요약 카드 1장 + 개인 응답 필수 사건), 교사 [이 학생만 사건 다시 보내기]
 *   (호스트가 보낸 `eventTriggered`)도 이 큐에 들어간다.
 * - L1-E6 첫 출항 튜토리얼(`Tutorial`).
 */
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Action, Answer, PublicClass } from '../../core';
import { checkQuizFor } from '../../data/checkQuiz';
import { eventsById } from '../../data/events';
import { MinigameLayer } from '../../minigames/MinigameLayer';
import { CheckQuizCard, DecisionCard, EventCard, decisionModel, eventCardModel, linkPages, splitSentences } from '../../ui/cards';
import { Dex } from '../Dex';
import { toggleAllowed } from '../guard';
import { LayerFrame } from '../layer';
import type { MeView } from '../predict';
import type { StudentState, StudentStore } from '../store';
import { optionFacts } from './facts';
import { catchUpPlan, hasDone, liveEvent, resultEvent, shapeOf, type CatchUpItem, type LiveEvent } from './logic';
import { Tutorial } from './Tutorial';
import './events.css';

export interface EventLayerProps {
  store: StudentStore;
  st: StudentState;
}

export function EventLayer({ store, st }: EventLayerProps) {
  const me = st.peer.me;
  const cls = st.peer.public?.class ?? null;
  if (!me || !cls) return null;
  return <EventLayerInner store={store} me={me} cls={cls} pid={st.peer.pid} code={st.peer.code} />;
}

const WAIT_TEXT = '선생님이 다음으로 넘어갈 때까지 기다려요';

function serverNow(store: StudentStore): number {
  try {
    return typeof store.serverNow === 'function' ? store.serverNow() : Date.now();
  } catch {
    return Date.now();
  }
}

function decisionChoice(me: MeView, id: string): { choice: string | null; noResponse: boolean } {
  const r = me.game.responses[id] as Record<string, unknown> | undefined;
  if (!r || typeof r !== 'object') return { choice: null, noResponse: false };
  return { choice: typeof r.choice === 'string' ? r.choice : null, noResponse: r.noResponse === true };
}

function EventLayerInner({ store, me, cls, pid, code }: { store: StudentStore; me: MeView; cls: PublicClass; pid: string | null; code: string | null }) {
  const [queue, setQueue] = useState<CatchUpItem[]>([]);
  const [queueTotal, setQueueTotal] = useState(0);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  // 비차단 패널 접기: 'auto' = 해도에서는 펼치고 항구 화면(시장)에서는 접음(사기·팔기 버튼을 가리지 않게)
  const [foldPref, setFoldPref] = useState<'auto' | 'open' | 'folded'>('auto');
  const [inPort, setInPort] = useState(false);
  const [dexOpen, setDexOpen] = useState(false);
  const [picked, setPicked] = useState<Record<string, Answer>>({});
  const lastActAt = useRef<number | null>(null);
  const plannedFor = useRef<string | null>(null);
  const lastRev = useRef<number | null>(null);

  const phase = cls.phase;
  const tradeOver = phase === 'wrapup' || phase === 'ended';
  const founded = me.company.founded;
  const scope = cls.settings.scope;

  // ── 따라잡기 계획: 입장·재입장(이 기기에서 이 회사로 처음 그릴 때) 한 번 ──
  useEffect(() => {
    if (!founded || !pid || phase === 'prep' || tradeOver) return;
    const key = `${code ?? ''}:${pid}`;
    if (plannedFor.current === key) return;
    plannedFor.current = key;
    const plan = catchUpPlan(cls, me);
    if (plan.length) {
      setQueue((q) => [...q, ...plan]);
      setQueueTotal((n) => n + plan.length);
    }
  }, [founded, pid, code, phase, tradeOver]);

  // ── 교사 [이 학생만 사건 다시 보내기] → 호스트가 보낸 eventTriggered ──
  useEffect(() => {
    if (lastRev.current === me.rev) return;
    const first = lastRev.current === null;
    lastRev.current = me.rev;
    if (first) return;
    // 확인 퀴즈·표지처럼 따라잡기로 다시 할 수 없는 사건은 넣지 않는다
    const ids = (me.events ?? [])
      .filter((e) => e.type === 'eventTriggered')
      .map((e) => (e as { id: string }).id)
      .filter((id) => {
        const def = eventsById[id];
        const shape = def ? shapeOf(def) : 'none';
        return shape !== 'none' && shape !== 'quiz';
      });
    if (!ids.length) return;
    setQueue((q) => [...q, ...ids.filter((id) => !q.some((x) => x.mode !== 'summary' && x.id === id)).map((id) => ({ mode: 'resend' as const, id }))]);
    setQueueTotal((n) => n + ids.length);
    setDismissed((d) => {
      const n = new Set(d);
      ids.forEach((id) => n.delete(id));
      return n;
    });
  }, [me.rev]);

  /** 연속 클릭 가드(107 READY_TOGGLE_GUARD_MS 패턴) 뒤 행동 보내기 */
  const send = (action: Action): boolean => {
    const t = Date.now();
    if (!toggleAllowed(lastActAt.current, t)) return false;
    lastActAt.current = t;
    const r = store.act(action);
    return r === 'sent' || r === 'queued';
  };
  const respond = (id: string, response: Record<string, unknown>) => send({ type: 'respondEvent', eventId: id, response: response as never });
  const dismiss = (id: string) => setDismissed((d) => new Set(d).add(id));
  const popQueue = () => setQueue((q) => q.slice(1));

  // 서버 시각(1초마다) — 마감한 사건의 결과 표시 시간 판단
  const [now, setNow] = useState(() => serverNow(store));
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow(store)), 1000);
    return () => clearInterval(t);
  }, [store]);
  const live = liveEvent(cls);
  const result = live ? null : resultEvent(cls, now);
  // 새 사건이 뜨면 접기 설정을 처음으로
  useEffect(() => setFoldPref('auto'), [live?.id]);
  // 비차단 패널이 떠 있는 동안 지금 화면이 항구(시장)인지 본다
  const panelLive = !!live && !live.blocking;
  useEffect(() => {
    if (!panelLive) return;
    const look = () => setInPort(typeof document !== 'undefined' && typeof document.querySelector === 'function' && !!document.querySelector('[data-testid="port-screen"]'));
    look();
    const t = setInterval(look, 400);
    return () => clearInterval(t);
  }, [panelLive]);
  const folded = foldPref === 'folded' || (foldPref === 'auto' && inPort);
  const setFolded = (b: boolean) => setFoldPref(b ? 'folded' : 'open');

  if (!founded || tradeOver) return null;

  // ── 가운데(차단형) 카드 고르기: 지금 사건 → 따라잡기 큐 ──
  let modal: JSX.Element | null = null;
  let panel: JSX.Element | null = null;

  if (live) {
    if (live.shape === 'minigame') {
      if (!dismissed.has(live.id) && !hasDone(me, live.id)) {
        modal = (
          <LayerFrame name="minigame">
            <div class="ev-center">
              <MinigameLayer eventId={live.id} classState={cls} player={me} act={(a) => store.act(a)} onDone={() => dismiss(live.id)} />
            </div>
          </LayerFrame>
        );
      } else if (live.blocking && hasDone(me, live.id)) {
        modal = <Waiting title={live.def.title} onDex={() => setDexOpen(true)} />;
      }
    } else if (live.blocking) {
      modal = <LiveBlocking live={live} me={me} cls={cls} scope={scope} picked={picked} setPicked={setPicked} send={send} respond={respond} onDex={() => setDexOpen(true)} />;
    } else if (!dismissed.has(live.id)) {
      panel = <LivePanel live={live} me={me} cls={cls} scope={scope} folded={folded} setFolded={setFolded} respond={respond} dismiss={dismiss} />;
    }
  }

  // (수정 1회차) 마감한 확인 퀴즈·결정: 결과 표시 시간 동안 내 결과·해설·쪽수
  if (result && !dismissed.has(`result:${result.id}`)) {
    if (result.shape === 'quiz') {
      modal = (
        <LayerFrame name="event">
          <div class="ev-center ev-center--scroll">
            <CheckQuizCard id={result.id} title={result.def.title} questions={checkQuizFor(result.def.lesson)} results={me.game.checkQuiz} picked={picked} revealed pages={result.def.pages}>
              <p class="ev-result-note" data-testid="event-result">
                마감했어요. 결과를 확인해요.
              </p>
            </CheckQuizCard>
          </div>
        </LayerFrame>
      );
    } else {
      const { choice, noResponse } = decisionChoice(me, result.id);
      const card = (
        <DecisionCard model={decisionModel(result.def, { scope, facts: optionFacts(result.id, cls, me) })} chosen={choice} noResponse={noResponse} panel={!result.blocking}>
          <p class="ev-result-note" data-testid="event-result">
            마감했어요.{choice ? '' : ' 이번에는 고르지 않았어요.'}
          </p>
          <div class="vc__foot">
            <button type="button" class="btn btn--secondary" data-testid="event-result-close" onClick={() => dismiss(`result:${result.id}`)}>
              닫기
            </button>
          </div>
        </DecisionCard>
      );
      if (result.blocking) {
        modal = (
          <LayerFrame name="event">
            <div class="ev-center ev-center--scroll">{card}</div>
          </LayerFrame>
        );
      } else {
        panel = (
          <aside class="ev-panel" aria-label={result.def.title} data-testid="event-panel" data-event={result.id} data-result="1" style={{ zIndex: 55 }}>
            {card}
          </aside>
        );
      }
    }
  }

  if (!modal && queue.length) {
    const head = queue[0];
    const n = queueTotal - queue.length + 1;
    modal = (
      <CatchUp key={`${head.mode}:${head.mode === 'summary' ? head.ids.join(',') : head.id}`} item={head} index={n} total={queueTotal} me={me} cls={cls} scope={scope} respond={respond} store={store} onNext={popQueue} />
    );
  }

  return (
    <>
      <Tutorial me={me} cls={cls} pid={pid} code={code} />
      {panel}
      {modal}
      {dexOpen && <Dex collected={me.game.metrics.dex} comeback={Boolean(cls.settings.comeback)} onClose={() => setDexOpen(false)} />}
    </>
  );
}

// ─── 기다리기 ─────────────────────────────────────────────

function Waiting({ title, onDex, children }: { title: string; onDex: () => void; children?: ComponentChildren }) {
  return (
    <LayerFrame name="event">
      <div class="ev-center">
        <section class="ev-wait" role="status" data-testid="event-waiting">
          <p class="ev-wait__kicker">{title}</p>
          {children}
          <p class="ev-wait__text title-font">{WAIT_TEXT}</p>
          <button type="button" class="btn btn--secondary" data-testid="event-dex" onClick={onDex}>
            도감 보기
          </button>
        </section>
      </div>
    </LayerFrame>
  );
}

// ─── 지금 사건(차단형) ────────────────────────────────────

function LiveBlocking({
  live,
  me,
  cls,
  scope,
  picked,
  setPicked,
  send,
  respond,
  onDex,
}: {
  live: LiveEvent;
  me: MeView;
  cls: PublicClass;
  scope: readonly ('L1' | 'L2' | 'L3' | 'L4')[];
  picked: Record<string, Answer>;
  setPicked: (f: (p: Record<string, Answer>) => Record<string, Answer>) => void;
  send: (a: Action) => boolean;
  respond: (id: string, r: Record<string, unknown>) => boolean;
  onDex: () => void;
}) {
  const { def } = live;
  if (live.shape === 'quiz') {
    const qs = checkQuizFor(def.lesson);
    const done = hasDone(me, live.id);
    return (
      <LayerFrame name="event">
        <div class="ev-center ev-center--scroll">
          <CheckQuizCard
            id={live.id}
            title={def.title}
            questions={qs}
            results={me.game.checkQuiz}
            picked={picked}
            revealed={live.revealed}
            pages={def.pages}
            onAnswer={(qid, answer) => {
              if (send({ type: 'answerCheckQuiz', qid, answer })) setPicked((p) => ({ ...p, [qid]: answer }));
            }}
          >
            {done && (
              <div class="ev-inline-wait" data-testid="event-waiting">
                <span>{WAIT_TEXT}</span>
                <button type="button" class="btn btn--secondary" data-testid="event-dex" onClick={onDex}>
                  도감 보기
                </button>
              </div>
            )}
          </CheckQuizCard>
        </div>
      </LayerFrame>
    );
  }
  if (live.shape === 'decision') {
    const { choice, noResponse } = decisionChoice(me, live.id);
    return (
      <LayerFrame name="event">
        <div class="ev-center ev-center--scroll">
          <DecisionCard
            model={decisionModel(def, { scope, facts: optionFacts(live.id, cls, me) })}
            chosen={choice}
            noResponse={noResponse}
            onDecide={(c, reason) => respond(live.id, { choice: c, ...(reason ? { reason } : {}) })}
          >
            {choice && (
              <div class="ev-inline-wait" data-testid="event-waiting">
                <span>{WAIT_TEXT}</span>
                <button type="button" class="btn btn--secondary" data-testid="event-dex" onClick={onDex}>
                  도감 보기
                </button>
              </div>
            )}
          </DecisionCard>
        </div>
      </LayerFrame>
    );
  }
  // 카드: 확인하면 닫힘. 응답이 필요한 카드(드묾)면 응답 뒤 기다리기
  const done = hasDone(me, live.id);
  if (done && !def.needsResponse) return null;
  if (done) return <Waiting title={def.title} onDex={onDex} />;
  return (
    <LayerFrame name="event">
      <div class="ev-center ev-center--scroll">
        <EventCard model={eventCardModel(def, { short: live.short, scope })} onConfirm={() => respond(live.id, { seen: true })} />
      </div>
    </LayerFrame>
  );
}

// ─── 지금 사건(비차단 — 오른쪽 패널) ───────────────────────

function LivePanel({
  live,
  me,
  cls,
  scope,
  folded,
  setFolded,
  respond,
  dismiss,
}: {
  live: LiveEvent;
  me: MeView;
  cls: PublicClass;
  scope: readonly ('L1' | 'L2' | 'L3' | 'L4')[];
  folded: boolean;
  setFolded: (b: boolean) => void;
  respond: (id: string, r: Record<string, unknown>) => boolean;
  dismiss: (id: string) => void;
}) {
  const { def } = live;
  const done = hasDone(me, live.id);
  if (live.shape === 'card' && done) return null;
  if (folded) {
    return (
      <div class="ev-panel ev-panel--folded" data-testid="event-panel-folded" data-event={live.id} style={{ zIndex: 55 }}>
        <button type="button" class="btn btn--secondary ev-panel__unfold" data-testid="event-panel-unfold" onClick={() => setFolded(false)}>
          {def.title} 펼치기
        </button>
      </div>
    );
  }
  const fold = (
    <button type="button" class="link-small ev-panel__fold" data-testid="event-panel-fold" onClick={() => setFolded(true)}>
      접기
    </button>
  );
  if (live.shape === 'decision') {
    const { choice, noResponse } = decisionChoice(me, live.id);
    return (
      <aside class="ev-panel" aria-label={def.title} data-testid="event-panel" data-event={live.id} style={{ zIndex: 55 }}>
        {fold}
        <DecisionCard
          panel
          model={decisionModel(def, { scope, facts: optionFacts(live.id, cls, me) })}
          chosen={choice}
          noResponse={noResponse}
          onDecide={(c, reason) => respond(live.id, { choice: c, ...(reason ? { reason } : {}) })}
        >
          {choice && (
            <>
              <p class="ev-panel__note">결정은 기록만 해요. 흑연은 시장에서 직접 사요.</p>
              <div class="vc__foot">
                <button type="button" class="btn btn--secondary" data-testid="event-panel-close" onClick={() => dismiss(live.id)}>
                  닫기
                </button>
              </div>
            </>
          )}
        </DecisionCard>
      </aside>
    );
  }
  return (
    <aside class="ev-panel" aria-label={def.title} data-testid="event-panel" data-event={live.id} style={{ zIndex: 55 }}>
      {fold}
      <EventCard panel model={eventCardModel(def, { short: live.short, scope })} onConfirm={() => respond(live.id, { seen: true })} />
    </aside>
  );
}

// ─── 따라잡기 ─────────────────────────────────────────────

function CatchUp({
  item,
  index,
  total,
  me,
  cls,
  scope,
  respond,
  store,
  onNext,
}: {
  item: CatchUpItem;
  index: number;
  total: number;
  me: MeView;
  cls: PublicClass;
  scope: readonly ('L1' | 'L2' | 'L3' | 'L4')[];
  respond: (id: string, r: Record<string, unknown>) => boolean;
  store: StudentStore;
  onNext: () => void;
}) {
  const kicker = (
    <p class="ev-catchup__kicker" data-testid="catchup-kicker">
      놓친 활동 따라잡기 {index}/{total}
    </p>
  );
  if (item.mode === 'summary') {
    return (
      <LayerFrame name="event">
        <div class="ev-center ev-center--scroll">
          <section class="ev-catchup" data-testid="catchup" data-mode="summary" data-ids={item.ids.join(',')}>
            {kicker}
            <SummaryCard ids={item.ids} />
            <div class="vc__foot">
              <button
                type="button"
                class="btn btn--primary"
                data-testid="catchup-ok"
                onClick={() => {
                  for (const id of item.ids) if (me.game.responses[id] === undefined) store.act({ type: 'respondEvent', eventId: id, response: { seen: true, catchUp: true } });
                  onNext();
                }}
              >
                확인
              </button>
            </div>
          </section>
        </div>
      </LayerFrame>
    );
  }
  const id = item.id;
  const def = eventsById[id];
  if (!def) return null;
  const shape = shapeOf(def);
  if (shape === 'minigame') {
    return (
      <LayerFrame name="minigame">
        <div class="ev-center">
          <section class="ev-catchup" data-testid="catchup" data-mode={item.mode} data-event={id}>
            {kicker}
            <MinigameLayer eventId={id} classState={cls} player={me} act={(a) => store.act(a)} onDone={onNext} catchUp />
          </section>
        </div>
      </LayerFrame>
    );
  }
  if (shape === 'decision') {
    const { choice, noResponse } = decisionChoice(me, id);
    return (
      <LayerFrame name="event">
        <div class="ev-center ev-center--scroll">
          <section class="ev-catchup" data-testid="catchup" data-mode={item.mode} data-event={id}>
            {kicker}
            <DecisionCard
              model={decisionModel(def, { scope, facts: optionFacts(id, cls, me) })}
              chosen={choice}
              noResponse={noResponse}
              onDecide={(c, reason) => respond(id, { choice: c, ...(reason ? { reason } : {}) })}
            >
              {choice && (
                <div class="vc__foot">
                  <button type="button" class="btn btn--primary" data-testid="catchup-next" onClick={onNext}>
                    {index < total ? '다음' : '닫기'}
                  </button>
                </div>
              )}
            </DecisionCard>
          </section>
        </div>
      </LayerFrame>
    );
  }
  // 확인 퀴즈·표지는 큐에 넣지 않는다(열려 있을 때만 답할 수 있음)
  if (shape === 'quiz' || shape === 'none') return null;
  const done = me.game.responses[id] !== undefined;
  return (
    <LayerFrame name="event">
      <div class="ev-center ev-center--scroll">
        <section class="ev-catchup" data-testid="catchup" data-mode={item.mode} data-event={id}>
          {kicker}
          <EventCard
            model={eventCardModel(def, { short: cls.shortEvents.includes(id), scope })}
            onConfirm={() => {
              if (!done) respond(id, { seen: true, catchUp: true });
              onNext();
            }}
          />
        </section>
      </div>
    </LayerFrame>
  );
}

/** 놓친 공용 화면 중심 사건 요약 카드 1장(PRD 6.11.2) */
function SummaryCard({ ids }: { ids: readonly string[] }) {
  const rows = useMemo(
    () =>
      ids
        .map((id) => eventsById[id])
        .filter(Boolean)
        .map((def) => ({ id: def.id, title: def.title, line: splitSentences(def.body && def.body !== 'TODO' ? def.body.replace(/[①②③].*$/, '') : '')[0] ?? '', pages: def.pages, fake: def.fake })),
    [ids.join(',')],
  );
  return (
    <article class="vc vc--student" data-testid="summary-card">
      <div class="vc__band vc__band--concept" data-testid="card-band" data-band="concept">
        <span class="vc__band-text">놓친 이야기 요약</span>
      </div>
      <h2 class="vc__title">그동안 이런 일이 있었어요</h2>
      <ul class="ev-summary">
        {rows.map((r) => (
          <li key={r.id} data-testid="summary-row" data-event={r.id}>
            <b>{r.title}</b>
            {r.fake && <span class="ev-summary__fake"> [가상 뉴스]</span>}
            {r.line && <span> — {r.line}</span>}
            {r.pages.length > 0 && <span class="ev-summary__pages"> {linkPages(r.pages)}</span>}
          </li>
        ))}
      </ul>
    </article>
  );
}
