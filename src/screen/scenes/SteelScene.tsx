/**
 * (작업 173) 4차시 공용 화면 장면.
 *
 * - `steel`: 1970년대 철강(L4-E1) 투표 뒤 단계 — 결과(막대 2개 + 결과 한 줄) → 회상 1~3단계(세피아 카드) → 실제 사례 카드(p.108).
 *   단계는 학급 하나(`currentEvent.step`)로, 학생 화면과 같은 카드를 공용 화면 크기로 그린다. 누가 어디에 투표했는지는 없다.
 * - `vnBars`(EventScene 안에서 씀): 호찌민 공장 결정(L4-E2) 학급 분포 막대 — 수만, 회사 이름 없음.
 */
import { eventsById } from '../../data/events';
import { STEEL_EVENT, steelStepAt } from '../../data/steel1970';
import { SteelCard } from '../../ui/cards';
import type { ScreenData } from '../model';
import { Bar } from '../parts';
import type { SceneProps } from './types';

/** 장면 고르기: L4-E1이 열려 있고 투표 뒤 단계면 'steel' */
export function steelPicker(d: ScreenData): string | null {
  const ce = d.cls.currentEvent;
  if (!ce || ce.closed || ce.id !== STEEL_EVENT || (ce.step ?? 0) < 1) return null;
  return 'steel';
}

export function SteelScene({ d }: SceneProps) {
  const ce = d.cls.currentEvent;
  if (!ce || ce.id !== STEEL_EVENT) return <div class="scr-scene scr-event" data-testid="scene-steel" />;
  const step = steelStepAt(ce.short, ce.step);
  const vote = d.pub.vote && d.pub.vote.id === STEEL_EVENT ? d.pub.vote : null;
  const result = d.cls.votes[STEEL_EVENT]?.result ?? vote?.result ?? null;
  const def = eventsById[STEEL_EVENT]!;
  const counts = vote?.counts ?? {};
  const total = Object.values(counts).reduce((a, n) => a + n, 0);
  return (
    <div class="scr-scene scr-event scr-steel" data-testid="scene-steel" data-step={step} data-result={result ?? ''}>
      <div class="scr-event__card">
        <SteelCard step={step} result={result} size="screen">
          {step === 'result' && (
            <div class="scr-event__bars" data-testid="steel-bars">
              {(def.options ?? []).map((o) => (
                <Bar key={o.id} label={o.label} value={counts[o.id] ?? 0} max={Math.max(1, total)} suffix="개 회사" />
              ))}
            </div>
          )}
        </SteelCard>
      </div>
    </div>
  );
}

/**
 * 호찌민 공장 결정 분포(이름 없음). (검증 반영) 세 묶음(공장·임금·환경 설비)을 한 줄씩 — 줄마다 두 칸으로 나뉜 막대와
 * "지었어요 2 · 짓지 않았어요 1"처럼 이름과 수를 한 칸에 붙여, 숫자가 다른 줄 이름에 붙어 읽히지 않게 한다(TV 1080 안에 들어가게 3줄).
 */
export function VNBars({ d }: { d: Pick<ScreenData, 'pub'> }) {
  const v = d.pub.vnFactory;
  if (!v) return null;
  const rows = [
    { id: 'build', label: '공장', a: ['지었어요', v.built], b: ['짓지 않았어요', v.notBuilt] },
    { id: 'wage', label: '임금', a: ['정당한 임금', v.fair], b: ['낮은 임금', v.low] },
    { id: 'env', label: '환경 설비', a: ['설치', v.install], b: ['설치 안 함', v.skip] },
  ] as const;
  return (
    <section class="scr-panel scr-vn" data-testid="vn-bars">
      <h2 class="scr-vn__h">우리 반 공장 결정 · 교과서 109쪽</h2>
      {rows.map((r) => {
        const [al, an] = r.a;
        const [bl, bn] = r.b;
        const tot = an + bn;
        const pa = tot > 0 ? (an / tot) * 100 : 0;
        return (
          <div key={r.id} class="scr-vn__row" data-testid={`vn-row-${r.id}`} data-a={an} data-b={bn}>
            <span class="scr-vn__label">{r.label}</span>
            <span class="scr-vn__track" aria-hidden="true">
              <span class="scr-vn__a" style={{ width: `${pa}%` }} />
              <span class="scr-vn__b" style={{ width: `${tot > 0 ? 100 - pa : 0}%` }} />
            </span>
            <span class="scr-vn__val">
              {al} <b>{an}</b> · {bl} <b>{bn}</b>
              <small> 개 회사</small>
            </span>
          </div>
        );
      })}
      <p class="scr-vn__lead">기업이 얻는 이익만큼 근로자의 정당한 임금과 환경도 함께 생각해요.</p>
    </section>
  );
}
