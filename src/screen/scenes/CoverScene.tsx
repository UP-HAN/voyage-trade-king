/**
 * 차시 표지·구간 표지(PRD 4.1.1·7.6, brief v0.3.1 3번): 차시 번호·제목·질문·교과서 쪽 + 표지 그림(없으면 키아트).
 * 단원 한 판 L2 표지는 "지금까지 상위 N개 회사"(N=0이면 생략, 회사 이름 + 깃발만).
 * 앞 차시 요약 카드(`SummaryScene`) — 차시 한 판 L2~L4로 시작하면 표지 뒤에 나온다(123 배치, 기본 카드 렌더).
 */
import { coverFor, summaryFor } from '../model';
import { ArtImg, CompanyTag } from '../parts';
import type { SceneProps } from './types';

export function CoverScene({ d }: SceneProps) {
  const ce = d.cls.currentEvent;
  const m = coverFor(d, ce?.id ?? '');
  return (
    <div class="scr-scene scr-cover" data-testid="scene-cover" data-variant={m.variant} data-lesson={m.lesson}>
      <div class="scr-cover__art">
        <ArtImg path={m.image ?? 'title/keyart.png'} fallback="title/keyart.png" alt={`${m.kicker} 표지 그림`} class="scr-cover__img" />
      </div>
      <div class="scr-cover__text">
        <p class="scr-cover__kicker" data-testid="cover-kicker">
          {m.kicker}
        </p>
        <h1 class="scr-cover__title">{m.title}</h1>
        {m.question && (
          <p class="scr-cover__q" data-testid="cover-question">
            {m.question}
          </p>
        )}
        {m.pages && <p class="scr-small">{m.pages}</p>}
        {m.topCompanies && m.topCompanies.length > 0 && (
          <div class="scr-cover__top" data-testid="cover-top">
            <p class="scr-cover__top-h">지금까지 상위 {m.topCompanies.length}개 회사</p>
            <ol>
              {m.topCompanies.map((e) => (
                <li key={e.pid}>
                  <CompanyTag name={e.company} color={e.flag.color} emblem={e.flag.emblem} size={44} />
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}

export function SummaryScene({ d }: SceneProps) {
  const cards = summaryFor(d);
  return (
    <div class="scr-scene scr-summary" data-testid="scene-summary">
      <p class="scr-kicker">앞 차시에서 배운 것</p>
      {cards.length === 0 && <p class="scr-lead">앞 차시 내용을 떠올려 봐요.</p>}
      {cards.map((c) => (
        <section class="scr-panel scr-summary__card" key={c.title}>
          <h2 class="scr-h2">{c.title}</h2>
          <ul class="scr-summary__lines">
            {c.lines.map((l) => (
              <li key={l.text}>
                {l.text} <small class="scr-pages">{l.pages}</small>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
