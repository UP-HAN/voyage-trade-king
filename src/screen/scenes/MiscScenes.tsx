/**
 * 작은 장면들(작업 110): 일시정지("선생님을 보세요", 기본 페이드 — 모션은 203), 검은 화면, 항해 규칙 카드(준비 단계 P0 틀),
 * 시상(기본 목록 — 시상식 차례 공개·애니메이션은 118·203), 판 끝, 호스트 기다림.
 */
import { AWARD_ORDER, metrics } from '../../data/awards';
import { fairTradeOn } from '../../core';
import { fairTradeText } from '../../data/fairTrade';
import { afterWorksheets, awardsWithWinners, rulesFor } from '../model';
import { ArtImg, CompanyTag } from '../parts';
import type { SceneProps } from './types';
import { isLastVoyage } from '../../student/wrapup/model';
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
      {/* (작업 176) 같은 거래 반복 폭풍·다양한 무역 보너스가 켜진 판이면 한 줄 */}
      {fairTradeOn(d.cls.settings) && (
        <p class="scr-rules__fair" data-testid="rule-fair">
          {fairTradeText.ruleLine}
        </p>
      )}
    </div>
  );
}

const awardName = (id: string) => metrics.find((m) => m.id === id)?.award ?? id;

export function AwardsScene({ d }: SceneProps) {
  // 수상 회사가 없는 상(값이 0뿐인 지표 등)은 그리지 않는다
  const all = awardsWithWinners(d).sort((a, b) => AWARD_ORDER.indexOf(a.metric) - AWARD_ORDER.indexOf(b.metric));
  // (작업 174) 시상식 차례 공개: 교사가 [다음 상]으로 한 장씩(도약상이 무역왕상 바로 앞 — AWARD_ORDER). 다 공개하면 전체 목록 + 완주 증서 수
  // (작업 178) 공개 상태에는 이미 공개한 상만 온다 — 전체 수는 wrap.awardsTotal
  const shown = d.wrap ? Math.min(all.length, Math.max(0, d.wrap.awardsShown)) : all.length;
  const total = d.wrap ? d.wrap.awardsTotal : all.length;
  // 진행 중 시상식은 마지막 상까지 한 장씩, 교사가 [상 전체 목록 보기]를 누르면(awardsList) 전체 목록
  const revealing = d.wrapLive === 'awards' && !!d.wrap && !d.wrap.awardsList && total > 0;
  if (revealing) return <AwardRevealScene d={d} all={all} shown={shown} total={total} />;
  const awards = all.slice(0, shown);
  const after = afterWorksheets(d);
  return (
    <div class="scr-scene scr-awards" data-testid="scene-awards" data-mode="list">
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

/** (작업 174) 시상식 한 장씩: 처음(0)은 결산 안내, 그다음은 방금 공개한 상 하나를 크게 */
function AwardRevealScene({ d, all, shown, total }: { d: SceneProps['d']; all: ReturnType<typeof awardsWithWinners>; shown: number; total: number }) {
  if (shown === 0) {
    const last = isLastVoyage(d.cls.settings);
    return (
      <div class="scr-scene scr-awards scr-awards--intro" data-testid="scene-awards" data-mode="intro" data-shown={0} data-total={total}>
        <p class="scr-kicker">결산 · 시상식</p>
        <h1 class="scr-h1">항해가 끝났어요</h1>
        <div class="scr-panel scr-awards__intro">
          {last && <p class="scr-awards__strong">마지막 항해예요. 배에 남은 화물은 산 값의 절반으로 계산해 최종 자산을 정해요.</p>}
          <p>상은 최종 자산 하나로만 주지 않아요. 여러 기록을 보고 서로 다른 친구에게 상을 줘요.</p>
          <p>
            오늘 상은 모두 <b>{total}</b>가지예요. 한 가지씩 공개해요!
          </p>
        </div>
      </div>
    );
  }
  const a = all[shown - 1];
  return (
    <div class="scr-scene scr-awards scr-awards--one" data-testid="scene-awards" data-mode="one" data-shown={shown} data-total={total} data-metric={a.metric}>
      <p class="scr-kicker">
        시상식 · {shown}/{total}
      </p>
      <div class="scr-panel scr-awards__big" data-testid="award-card" data-metric={a.metric}>
        <h2 class="scr-awards__bigname">{a.award || awardName(a.metric)}</h2>
        <p class="scr-awards__why">{metrics.find((m) => m.id === a.metric)?.name ?? ''} 기록으로 받는 상</p>
        <ul class="scr-awards__bigwinners">
          {a.winners.map((w) => (
            <li key={w.pid}>
              <CompanyTag name={w.company} color={w.flag.color} emblem={w.flag.emblem} size={72} />
            </li>
          ))}
        </ul>
      </div>
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
