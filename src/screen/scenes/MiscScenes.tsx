/**
 * 작은 장면들(작업 110): 일시정지("선생님을 보세요", 기본 페이드 — 모션은 203), 검은 화면, 항해 규칙 카드(준비 단계 P0 틀),
 * 시상(기본 목록 — 시상식 차례 공개·애니메이션은 118·203), 판 끝, 호스트 기다림.
 */
import { AWARD_ORDER, metrics } from '../../data/awards';
import { afterWorksheets, awardsWithWinners, rulesFor } from '../model';
import { ArtImg, CompanyTag } from '../parts';
import type { SceneProps } from './types';
import { AfterWorksheetList } from './WorksheetScene';

export function PauseScene(_p: SceneProps) {
  return (
    <div class="scr-scene scr-pause" data-testid="scene-pause">
      <ArtImg path="characters/guide-hanbada.png" alt="" class="scr-pause__guide" />
      <p class="scr-pause__text">선생님을 보세요</p>
    </div>
  );
}

export function BlackScene(_p: SceneProps) {
  return <div class="scr-scene scr-black" data-testid="scene-black" aria-label="검은 화면" />;
}

export function RulesScene({ d }: SceneProps) {
  const rules = rulesFor(d);
  return (
    <div class="scr-scene scr-rules" data-testid="scene-rules">
      <p class="scr-kicker">항해 규칙</p>
      <ol class="scr-rules__grid">
        {rules.map((r) => (
          <li key={r.id} class="scr-panel scr-rules__card" data-testid="rule-card">
            {/* 그림 자리(4칸) — 그림이 생기면 이 칸에 넣는다 */}
            <span class="scr-rules__art" aria-hidden="true">
              {r.no}
            </span>
            <span class="scr-rules__text">{r.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

const awardName = (id: string) => metrics.find((m) => m.id === id)?.award ?? id;

export function AwardsScene({ d }: SceneProps) {
  // 수상 회사가 없는 상(값이 0뿐인 지표 등)은 그리지 않는다
  const awards = awardsWithWinners(d).sort((a, b) => AWARD_ORDER.indexOf(a.metric) - AWARD_ORDER.indexOf(b.metric));
  const after = afterWorksheets(d);
  return (
    <div class="scr-scene scr-awards" data-testid="scene-awards">
      <p class="scr-kicker">결산 · 시상</p>
      <ul class="scr-awards__grid">
        {awards.map((a) => (
          <li key={a.metric} class="scr-panel scr-awards__card" data-testid="award-card" data-metric={a.metric}>
            <h2 class="scr-awards__name">{a.award || awardName(a.metric)}</h2>
            <ul class="scr-awards__winners">
              {a.winners.map((w) => (
                <li key={w.pid}>
                  <CompanyTag name={w.company} color={w.flag.color} emblem={w.flag.emblem} size={40} />
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {d.pub.certificates > 0 && (
        <p class="scr-awards__cert" data-testid="awards-cert">
          항해 완주 증서 <b>{d.pub.certificates}</b>개 회사
        </p>
      )}
      <AfterWorksheetList rows={after} d={d} />
    </div>
  );
}

export function EndedScene({ d }: SceneProps) {
  return (
    <div class="scr-scene scr-ended" data-testid="scene-ended">
      <ArtImg path="ships/ship-large.png" alt="" class="scr-ended__ship" />
      <p class="scr-h1">항해가 끝났어요</p>
      <p class="scr-lead">함께 항해해 줘서 고마워요.</p>
      <AfterWorksheetList rows={afterWorksheets(d)} d={d} />
    </div>
  );
}
