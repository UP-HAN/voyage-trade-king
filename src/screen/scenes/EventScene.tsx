/**
 * 사건 카드 장면(PRD 7.6 "학생 화면과 같은 카드") — 작업 111이 110의 기본 카드를 바꿨다.
 *
 * 학생 화면과 같은 카드 컴포넌트(`src/ui/cards`)를 공용 화면 크기(`size='screen'`, 본문 32px 이상)로 그린다.
 * - 응답이 필요한 사건: "응답한 회사 18/27"(수만, 누가 안 했는지는 없음).
 * - 결정 사건(L1-E7): 선택지 → 교사 [결과 공개] 뒤 선택 분포 막대(이름 없음) + 교과서 카드(p.99).
 * - 확인 퀴즈(L1-E8): 문제 → 교사 [결과 공개]·[마감] 뒤 문항별 정답률 막대 + 해설 + 쪽수.
 * - 단원 한 판이면(판 범위에 다음 구간이 있으면) 사건의 `unitOnlyNote`를 붙인다. 차시 한 판에서는 숨긴다.
 * - (작업 152) 가운데 차단 카드로 뜨는 개념 사건(L1-E2·L1-E4·L2-E2)은 카드 대신 PPT 슬라이드(`ConceptSlides`)로 저절로 넘긴다.
 */
import { checkQuizFor } from '../../data/checkQuiz';
import { eventsById } from '../../data/events';
import { CheckQuizCard, CardQuoteBox, DecisionCard, EventCard, decisionModel, eventCardModel } from '../../ui/cards';
import { Bar } from '../parts';
import { ConceptSlides, isConceptSlideEvent } from './ConceptSlides';
import type { SceneProps } from './types';

export function EventScene({ d, now }: SceneProps) {
  const ce = d.cls.currentEvent;
  const def = ce ? eventsById[ce.id] : undefined;
  if (!ce || !def) {
    return (
      <div class="scr-scene scr-event" data-testid="scene-event">
        <p class="scr-lead">곧 다음 이야기가 나와요.</p>
      </div>
    );
  }
  const ev = d.pub.event && d.pub.event.id === ce.id ? d.pub.event : null;
  const revealed = ce.revealed === true;
  const scope = d.scope;
  const count = ev && (
    <p class="scr-event__count" data-testid="event-count">
      {def.kind === 'vote' ? '투표한 회사' : '응답한 회사'} <b>{ev.responded}</b>/{ev.total}
    </p>
  );

  let card;
  if (isConceptSlideEvent(def, ce.short)) {
    return (
      <div class="scr-scene scr-event scr-event--slides" data-testid="scene-event" data-event={ce.id} data-short={ce.short ? '1' : '0'} data-revealed={revealed ? '1' : '0'}>
        <ConceptSlides def={def} short={ce.short} openedAt={ce.openedAt} closesAt={ce.closesAt} now={now} manual={d.cls.settings?.progressMode === 'manual'}>
          {count}
        </ConceptSlides>
      </div>
    );
  }
  if (def.kind === 'checkQuiz') {
    card = (
      <CheckQuizCard
        size="screen"
        id={def.id}
        title={def.title}
        questions={checkQuizFor(def.lesson)}
        revealed={revealed}
        rates={revealed ? d.pub.checkQuiz : undefined}
        pages={def.pages}
      >
        {count}
      </CheckQuizCard>
    );
  } else if (def.kind === 'decision' && def.options?.length) {
    const m = decisionModel(def, { scope });
    const counts = d.pub.decision && d.pub.decision.id === def.id ? d.pub.decision.counts : null;
    const total = counts ? Object.values(counts).reduce((a, n) => a + n, 0) : 0;
    card = (
      <DecisionCard size="screen" model={revealed ? { ...m, options: [], ask: [], situation: m.situation.slice(0, 1) } : m}>
        {count}
        {revealed && counts && (
          <div class="scr-event__bars" data-testid="decision-bars">
            {m.options.map((o) => (
              <Bar key={o.id} label={o.label} value={counts[o.id] ?? 0} max={Math.max(1, total)} suffix="개 회사" />
            ))}
          </div>
        )}
        {revealed && m.reveal && (
          <section class="vc__reveal" data-testid="decision-reveal">
            <h3 class="vc__reveal-title">{m.reveal.title}</h3>
            {m.reveal.text && <p class="vc__p">{m.reveal.text}</p>}
            {m.reveal.quote && <CardQuoteBox quote={m.reveal.quote} />}
          </section>
        )}
      </DecisionCard>
    );
  } else {
    card = (
      <EventCard size="screen" model={eventCardModel(def, { short: ce.short, scope })}>
        {count}
      </EventCard>
    );
  }

  return (
    <div class="scr-scene scr-event" data-testid="scene-event" data-event={ce.id} data-short={ce.short ? '1' : '0'} data-revealed={revealed ? '1' : '0'}>
      <div class="scr-event__card">{card}</div>
    </div>
  );
}
