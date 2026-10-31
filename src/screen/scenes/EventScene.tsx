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
import { AiGraph, ArticleCard, CheckQuizCard, CardQuoteBox, DecisionCard, EventCard, VoteCard, decisionModel, eventCardModel } from '../../ui/cards';
import { textbookArticles } from '../../data/text';
import { TECH_RACE } from '../../core';
import { Bar } from '../parts';
import { ConceptSlides, isConceptSlideEvent } from './ConceptSlides';
import { VNBars } from './SteelScene';
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
  if (def.kind === 'vote') {
    // (작업 172) 투표 공통 카드(공용 화면): 질문 + "투표한 회사 n/m". 마감 뒤 막대는 BarsScene
    card = (
      <VoteCard def={def} size="screen">
        {count}
      </VoteCard>
    );
  } else if (def.id === 'L4-E2') {
    // (작업 173) 베트남 기사(p.109, 밑줄 대상 표시) → 마감·결과 공개 뒤 학급 공장 결정 분포(이름 없음)
    card = revealed ? (
      <div class="scr-vn-wrap" data-testid="screen-vn-result">
        <p class="scr-kicker">{def.title}</p>
        <VNBars d={d} />
      </div>
    ) : (
      <ArticleCard article={textbookArticles.vietnamFactory} size="screen" showTargets testId="screen-article">
        {count}
      </ArticleCard>
    );
  } else if (def.kind === 'article' && def.options?.length && !revealed) {
    // (작업 172) 교과서 속 기사(L3-E1): 기사 원문 → 결과 공개 뒤 결정 분포 막대
    card = (
      <ArticleCard article={textbookArticles.mineralCoop} size="screen" showTargets testId="screen-article">
        {count}
      </ArticleCard>
    );
  } else if (def.kind === 'checkQuiz') {
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
  } else if ((def.kind === 'decision' || def.kind === 'article') && def.options?.length) {
    const m = decisionModel(def, { scope });
    const counts = d.pub.decision && d.pub.decision.id === def.id ? d.pub.decision.counts : null;
    const total = counts ? Object.values(counts).reduce((a, n) => a + n, 0) : 0;
    card = (
      <DecisionCard size="screen" model={revealed ? { ...m, options: [], ask: [], situation: m.situation.slice(0, 1) } : m}>
        {/* (작업 172) 기술 경쟁: 교과서 107쪽 그래프 + 결과 공개 뒤 기준선 */}
        {def.id === 'L3-E3' && !revealed && <AiGraph />}
        {count}
        {def.id === 'L3-E3' && revealed && counts && <TechCutoff counts={counts} />}
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
      <EventCard size="screen" model={def.id === 'L4-E3' ? { ...eventCardModel(def, { short: ce.short, scope }), quotes: [] } : eventCardModel(def, { short: ce.short, scope })}>
        {count}
        {/* (작업 173 검증 반영: 교과서 인용 상자는 빼고 막대 세 줄이 한 화면에 들어오게) 근로 환경 보도 동안 우리 반 공장 결정 분포(이름 없음) — 짧은 형태 결정 패널은 다음 라운드가 바로 이어져 결과 막대를 볼 틈이 없다 */}
        {def.id === 'L4-E3' && <VNBars d={d} />}
      </EventCard>
    );
  }

  return (
    <div class="scr-scene scr-event" data-testid="scene-event" data-event={ce.id} data-short={ce.short ? '1' : '0'} data-revealed={revealed ? '1' : '0'}>
      <div class="scr-event__card">{card}</div>
    </div>
  );
}

/**
 * (작업 172) L3-E3 기준선: 연구비 상위 30%(최소 3명, 0원 제외)가 AI 반도체 — 분포(이름 없음)에서 기준 연구비를 계산해 한 줄로.
 * core closeEventForAll 과 같은 규칙.
 */
export function techCutoff(counts: Record<string, number>): number | null {
  const n = Object.values(counts).reduce((a, x) => a + x, 0);
  const k = Math.max(TECH_RACE.minWinners, Math.ceil(n * TECH_RACE.topRatio));
  const vals: number[] = [];
  for (const [v, c] of Object.entries(counts)) for (let i = 0; i < c; i++) if (Number(v) > 0) vals.push(Number(v));
  vals.sort((a, b) => b - a);
  if (!vals.length) return null;
  return vals[Math.min(k, vals.length) - 1]!;
}

function TechCutoff({ counts }: { counts: Record<string, number> }) {
  const c = techCutoff(counts);
  return (
    <p class="scr-event__count" data-testid="tech-cutoff">
      {c === null ? '연구비를 쓴 회사가 없어요 — 다른 나라가 품질 좋은 반도체를 내놓았어요' : `기준선: 연구비 ${c}만 원 이상 → AI 반도체를 만들 수 있어요`}
    </p>
  );
}
