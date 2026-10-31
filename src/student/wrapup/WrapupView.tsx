/**
 * 마무리 단계 학생 화면(작업 132 최소 형태 → 작업 174에서 마무리 전체로 넓힘).
 *
 * - 교사가 대시보드 마무리 목록에서 [시작]한 단계(`PublicPayload.wrapLive`, 교사 화면 전용 진행 표시를 공개 상태에 실은 것)에 맞춰
 *   학생 화면이 바뀐다. 단계별 화면은 `WRAP_SECTIONS` 한 곳에 모은다.
 *   - 'containers'(컨테이너 싣기, L4-E6 — 작업 174): `Containers.tsx` — 문장 8개 싣기 → 채점·해설 → 자기 평가 3문항 → [마치기].
 *   - 'awards'(결산·시상, L4-E7): 내 회사 결산 요약(지표 값 — 차시 한 판에서 사회적 책임·협력은 **판에서 실제로 값이 모두 같을 때만** 숨김,
 *     작업 174) + 공개된 상만(교사가 TV에서 한 장씩 공개 — `wrap.awardsShown`) + 내가 받은 상이 공개되면 "축하해요!" 카드 + 항해 완주 증서.
 *   - 'reflect'(되돌아보기, L4-E9): `Reflect.tsx` — 문항(차시 L1~L3·4차시 앞 시간 2문항, L4·단원 3문항)마다 한 줄 입력·[복사]·[다 썼어요].
 *   - 'magazine'(잡지 표지, L4-E8 — 작업 174): `MagazineCover.tsx` — 종이면 안내 + 내 기록 도우미, 게임이면 6칸 + 배경 + 미리보기.
 *   - 그 밖(아직 시작 전·정산·끝나고 쓰기): "무역 시간이 끝났어요" 안내.
 * - 응답은 사건 응답(`respondEvent`)으로 보낸다(교사가 그 항목을 시작할 때 코어 사건이 함께 발동 — teacher/game.ts `fireWrapEvent`).
 *   사고팔기 기록은 남기지 않는다(폭풍·보너스·개척 지표 영향 없음).
 */
import type { MetricId } from '../../data/awards';
import { metrics as METRICS } from '../../data/awards';
import { hasCertificate, metricValue, type Action, type ClassState, type PublicClass, type PublicState, type PublicWrap } from '../../core';
import { playerForPredict, type MeView } from '../predict';
import type { StudentActResult } from '../store';
import { Containers } from './Containers';
import { MagazineCover } from './MagazineCover';
import { hiddenSummaryMetrics, isLastVoyage, revealedAwards, wrapItemOf } from './model';
import { Reflect } from './Reflect';
import './wrapup.css';

/** 결산 요약에 보이는 지표(학생 자기 값 — PRD 6.14.2 "자기 지표 값은 언제나 보인다") */
const SUMMARY_METRICS: readonly MetricId[] = ['finalAsset', 'exports', 'dex', 'quiz', 'explore', 'csr', 'coop'];

export interface WrapupViewProps {
  cls: PublicClass;
  pub: PublicState | null;
  me: MeView;
  /** 교사가 [시작]한 마무리 단계 ID(없으면 null) */
  wrapLive: string | null;
  /** (작업 174) 공개 마무리 정보(상 공개 수·잡지 표지 방식 등). 옛 상태에는 없음 */
  wrap?: PublicWrap | null;
  /** (작업 174) 응답 보내기(없으면 보기 전용) */
  act?: (action: Action) => StudentActResult;
}

export type WrapSectionProps = Omit<WrapupViewProps, 'wrapLive'>;

export { hiddenSummaryMetrics, reflectQuestions, reflectQuestionsOf, revealedAwards, wrapItemOf } from './model';

function fmt(metric: MetricId, v: number): string {
  if (metric === 'leap') return `${Math.round(v * 100) / 100}`;
  return Math.round(v).toLocaleString('ko-KR');
}

function AwardsSection({ cls, pub, me, wrap }: WrapSectionProps) {
  const player = playerForPredict(me);
  const item = wrapItemOf(cls, 'awards');
  const hidden = hiddenSummaryMetrics(item, pub);
  const rows = SUMMARY_METRICS.map((id) => METRICS.find((m) => m.id === id)!).filter((m) => m && !hidden.has(m.id));
  const shown = revealedAwards(pub, wrap);
  const mine = shown.filter((a) => a.winners.some((w) => w.pid === me.pid)).map((a) => a.award);
  const total = wrap ? wrap.awardsTotal : shown.length;
  const allShown = shown.length >= total;
  const lastVoyage = isLastVoyage(cls.settings);
  let cert = false;
  try {
    cert = hasCertificate(cls as unknown as ClassState, player);
  } catch {
    cert = false;
  }
  return (
    <section class="st-wrap__sec" data-testid="wrap-awards">
      <h2 class="title-font">결산·시상</h2>
      <p class="st-wrap__lead">
        <b>{me.company.name}</b>의 항해 결산이에요. 공용 화면에서 시상식을 함께 봐요.
      </p>
      {lastVoyage && (
        <p class="st-wrap__strong" data-testid="wrap-half-cargo">
          마지막 항해가 끝났어요. 배에 남은 화물은 산 값의 절반으로 계산해 최종 자산을 정해요.
        </p>
      )}
      <ul class="st-wrap__metrics" data-testid="wrap-metrics">
        {rows.map((m) => (
          <li key={m.id} data-metric={m.id}>
            <span>{m.name}</span> <b>{fmt(m.id, metricValue(player, m.id))}</b> {m.unit}
          </li>
        ))}
      </ul>
      {mine.length > 0 && (
        <div class="st-wrap__mine wz-cheer" data-testid="wrap-my-awards" role="status">
          <span class="wz-cheer__kicker">축하해요!</span>
          <b class="title-font">{mine.join(', ')}</b>
        </div>
      )}
      {cert && (
        <p class="st-wrap__cert" data-testid="wrap-certificate">
          항해 완주 증서: 꼭 해야 할 임무를 모두 마쳤어요.
        </p>
      )}
      {shown.length > 0 && (
        <ul class="st-wrap__awards" data-testid="wrap-award-list">
          {shown.map((a) => (
            <li key={a.metric} data-metric={a.metric}>
              <b>{a.award}</b> {a.winners.map((w) => w.company ?? '이름 짓는 중').join(', ')}
            </li>
          ))}
        </ul>
      )}
      {!allShown && (
        <p class="st-wrap__where" data-testid="wrap-awards-wait">
          {shown.length ? '다음 상을 기다려요.' : '곧 시상식이 시작돼요. 공용 화면을 봐요.'}
        </p>
      )}
    </section>
  );
}

function wrapAct(p: WrapSectionProps): (action: Action) => StudentActResult {
  return p.act ?? (() => 'blocked');
}

/** 마무리 단계별 학생 화면 */
export const WRAP_SECTIONS: Readonly<Record<string, (p: WrapSectionProps) => preact.JSX.Element>> = {
  containers: (p) => <Containers me={p.me} act={wrapAct(p)} worksheet={wrapItemOf(p.cls, 'containers')?.worksheetIds.includes('W16') ? 'W16' : null} />,
  awards: (p) => <AwardsSection {...p} />,
  reflect: (p) => <Reflect cls={p.cls} pub={p.pub} me={p.me} wrap={p.wrap ?? null} act={wrapAct(p)} />,
  magazine: (p) => <MagazineCover cls={p.cls} pub={p.pub} me={p.me} wrap={p.wrap ?? null} act={wrapAct(p)} />,
};

export function WrapupView({ cls, pub, me, wrapLive, wrap, act }: WrapupViewProps) {
  const section = wrapLive ? WRAP_SECTIONS[wrapLive] : undefined;
  return (
    <section class={`st-over${section ? ' st-wrap' : ''}`} data-testid="trade-over" data-wrap={wrapLive ?? ''}>
      {section ? (
        section({ cls, pub, me, wrap, act })
      ) : (
        <>
          <h1 class="title-font">무역 시간이 끝났어요</h1>
          <p>선생님 화면을 보세요. 곧 마무리 활동을 해요.</p>
        </>
      )}
    </section>
  );
}

export default WrapupView;
