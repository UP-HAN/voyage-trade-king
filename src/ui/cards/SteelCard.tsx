/**
 * (작업 173) 1970년대 철강 회상 카드(L4-E1) — 학생 화면과 공용 화면이 같은 카드를 쓴다(`size`).
 *
 * - 'result': 우리 반 투표 결과 한 줄(+ 공용 화면은 막대를 따로 그린다).
 * - 's1'~'s3': 세피아 회상 틀 + 그 단계 문장(학급 결과대로 — 실제와 달라도 그대로).
 * - 'real': 실제 사례 카드(교과서 108쪽 요지) + 관세 용어 풀이.
 * 그림(scenes/busan-1970s.png)이 없으면 세피아 무늬 틀만 보인다.
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { STEEL_FLASHBACK, STEEL_IMAGE, STEEL_REAL, steelResultLine, type SteelStep } from '../../data/steel1970';
import { img } from '../common/asset';
import { linkPages } from './model';
import { CardBandLine, CardFrame, type CardSize } from './parts';

export interface SteelCardProps {
  step: SteelStep;
  /** 학급 투표 결과('tariff' | 'noTariff' | null) */
  result: string | null | undefined;
  size?: CardSize;
  /** 내 표(학생만) */
  myVote?: string | null;
  children?: ComponentChildren;
}

function SepiaArt({ alt }: { alt: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), []);
  return (
    <div class="vc__art vc__art--sepia" data-testid="steel-art">
      {!failed && <img class="vc__art-img" src={img(STEEL_IMAGE)} alt={alt} decoding="async" onError={() => setFailed(true)} />}
    </div>
  );
}

export function SteelCard({ step, result, size = 'student', myVote, children }: SteelCardProps) {
  const res = result === 'tariff' || result === 'noTariff' ? result : 'noTariff';
  const stageNo = step === 's1' ? 0 : step === 's2' ? 1 : step === 's3' ? 2 : -1;
  const stages = STEEL_FLASHBACK[res];
  const myLabel = myVote === 'tariff' ? '관세를 매겨요' : myVote === 'noTariff' ? '매기지 않아요' : null;
  if (step === 'real') {
    const same = result === 'tariff';
    return (
      <CardFrame size={size} band="concept" testId="steel-real" id="L4-E1-real" extraClass="vc--steel vc--steel-real">
        <CardBandLine band="concept" text="교과서 속 실제 이야기" kind={STEEL_REAL.kicker} pages={STEEL_REAL.pages} />
        <div class="vc__text">
          <h2 class="vc__title" data-testid="card-title">
            {STEEL_REAL.title}
          </h2>
          <div class="vc__body" data-testid="steel-real-body">
            {STEEL_REAL.lines.map((l, i) => (
              <p key={i} class="vc__p">
                {l}
              </p>
            ))}
            <p class="vc__p vc__steel-why">{STEEL_REAL.why}</p>
          </div>
          <p class="vc__steel-term" data-testid="steel-term">
            {STEEL_REAL.term} ({linkPages(STEEL_REAL.pages)})
          </p>
          {result && (
            <p class="vc__steel-compare" data-testid="steel-compare" data-same={same ? '1' : '0'}>
              {same ? STEEL_REAL.same : STEEL_REAL.differ}
            </p>
          )}
          {children}
        </div>
      </CardFrame>
    );
  }
  return (
    <CardFrame size={size} band="concept" testId="steel-card" id={`L4-E1-${step}`} extraClass="vc--steel">
      <CardBandLine band="concept" text="시간 여행: 1970년대 부산" kind={stageNo >= 0 ? `회상 ${stageNo + 1}/3` : '우리 반 결과'} pages={[108]} />
      <SepiaArt alt="1970년대 부산 항구 그림" />
      <div class="vc__text">
        {step === 'result' || step === 'vote' ? (
          <>
            <h2 class="vc__title" data-testid="card-title">
              우리 반 투표 결과
            </h2>
            <p class="vc__vote-result" data-testid="steel-result" data-result={result ?? ''}>
              {steelResultLine(result) ?? '투표를 모으고 있어요.'}
            </p>
            {size === 'student' && myLabel && <p class="vc__chosen">내 표: {myLabel}</p>}
            <p class="vc__p">우리 반이 정한 대로 그 뒤 이야기를 따라가 봐요.</p>
          </>
        ) : (
          <>
            <h2 class="vc__title" data-testid="card-title">
              {res === 'tariff' ? '관세를 매긴 부산' : '관세를 매기지 않은 부산'} — {stages[stageNo]!.tag}
            </h2>
            <ol class="vc__steel-steps" data-testid="steel-steps">
              {stages.map((s, i) => (
                <li key={i} class={`vc__steel-step is-${s.mood}${i === stageNo ? ' is-now' : ''}${i > stageNo ? ' is-later' : ''}`} data-testid={`steel-step-${i + 1}`}>
                  <b>{s.tag}</b> {i <= stageNo ? s.line : '…'}
                </li>
              ))}
            </ol>
          </>
        )}
        {children}
      </div>
    </CardFrame>
  );
}
