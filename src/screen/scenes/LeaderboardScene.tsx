/**
 * 순위판 장면(PRD 6.14.2·7.6, brief v0.3.1 1번): 지표 탭을 10초마다 돌리고 **상위 N개 회사만**(N = `leaderboardTopN`).
 * 표시는 순위 + 깃발 + 회사 이름뿐(출석번호·실명·지표 값 없음, 하위 순위·전체 명단 없음). N=0이면 "순위는 시상식에서 공개해요".
 * 순위가 없는 탭(도약 "곧 공개", 모든 회사 값이 같은 지표)은 순환에서 뺀다. 순위판 재정렬 애니메이션은 203.
 */
import { currentLeaderTab, leaderTabs } from '../model';
import { CompanyTag } from '../parts';
import type { SceneProps } from './types';

export function LeaderboardScene({ d, now }: SceneProps) {
  const topN = d.cls.settings.leaderboardTopN;
  if (topN <= 0) {
    return (
      <div class="scr-scene scr-board" data-testid="scene-leaderboard" data-topn="0">
        <p class="scr-kicker">순위판</p>
        <p class="scr-h1" data-testid="board-hidden">
          순위는 시상식에서 공개해요
        </p>
      </div>
    );
  }
  const all = leaderTabs(d);
  const tabs = all.filter((t) => t.state === 'ok');
  const idx = currentLeaderTab(tabs, now);
  const tab = idx >= 0 ? tabs[idx] : undefined;
  const shownN = Math.min(topN, d.pub.joinedCount);
  return (
    <div class="scr-scene scr-board" data-testid="scene-leaderboard" data-topn={topN} data-tab={tab?.id ?? ''}>
      <ul class="scr-board__tabs" aria-label="지표">
        {all
          .filter((t) => t.state !== 'flat')
          .map((t) => (
            <li key={t.id} class={t === tab ? 'is-on' : t.state === 'soon' ? 'is-soon' : ''} aria-current={t === tab ? 'true' : undefined}>
              {t.name}
              {t.state === 'soon' && ' · 곧 공개'}
            </li>
          ))}
      </ul>
      {!tab ? (
        <>
          <h1 class="scr-h1 scr-board__title">순위판</h1>
          <p class="scr-lead" data-testid="board-empty">
            아직 순위를 매길 기록이 없어요. 거래를 하면 순위가 생겨요.
          </p>
        </>
      ) : (
        <>
          <h1 class="scr-h1 scr-board__title">
            {tab.name} <small data-testid="board-topn">상위 {shownN}개 회사</small>
          </h1>
          <ol class="scr-board__list" data-testid="board-list">
            {tab.entries.map((e) => (
              <li key={e.pid} class="scr-board__row" data-testid="board-row">
                <span class="scr-board__rank">{e.rank}위</span>
                <CompanyTag name={e.company} color={e.flag.color} emblem={e.flag.emblem} size={72} />
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
