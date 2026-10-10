/**
 * 마무리 단계 학생 화면(최소 형태, 작업 132 — 114 검증 반영). 마무리 전체(컨테이너 OX·잡지 표지·되돌아보기 입력)는 118이 이 틀을 넓힌다.
 *
 * - 교사가 대시보드 마무리 목록에서 [시작]을 누른 단계(`PublicPayload.wrapLive`, 교사 화면 전용 진행 표시를 공개 상태에 실은 것)에 맞춰
 *   학생 화면이 바뀐다. 단계별 화면은 `WRAP_SECTIONS` 한 곳에 모은다(118이 단계를 더할 때 여기에 추가).
 *   - 'awards'(결산·시상, L4-E7): 내 회사 결산 요약(지표 값 — 판에서 값이 모두 같은 지표는 숨김) + 학급 시상(회사 이름만).
 *   - 'reflect'(되돌아보기, L4-E9): 되돌아보기 문항(차시 한 판 L1~L3은 앞 2문항, L4·단원 한 판은 3문항 — PRD 6.14.4)과
 *     쓰는 곳 안내(학습지 ⑱이 이번 판에 있으면 ⑱, 없으면 공책 등).
 *   - 그 밖(아직 시작 전·정산·끝나고 쓰기): "무역 시간이 끝났어요" 안내.
 * - 학생 상태는 바꾸지 않는다(보기 전용). 답은 종이에 쓴다.
 */
import type { MetricId } from '../../data/awards';
import { metrics as METRICS } from '../../data/awards';
import { eventsById } from '../../data/events';
import { worksheetById } from '../../data/worksheet';
import { metricValue, type PublicClass, type PublicState, type WrapItem } from '../../core';
import { playerForPredict, type MeView } from '../predict';

/** 결산 요약에 보이는 지표(학생 자기 값 — PRD 6.14.2 "자기 지표 값은 언제나 보인다") */
const SUMMARY_METRICS: readonly MetricId[] = ['finalAsset', 'exports', 'dex', 'quiz', 'explore', 'csr', 'coop'];

export interface WrapupViewProps {
  cls: PublicClass;
  pub: PublicState | null;
  me: MeView;
  /** 교사가 [시작]한 마무리 단계 ID(없으면 null) */
  wrapLive: string | null;
}

/** 되돌아보기 문항(앞 n개) */
export function reflectQuestions(n: number): string[] {
  const all = eventsById['L4-E9']?.reflectQuestions ?? [];
  return all.slice(0, Math.max(0, Math.min(all.length, n)));
}

function fmt(metric: MetricId, v: number): string {
  if (metric === 'leap') return `${Math.round(v * 100) / 100}`;
  return Math.round(v).toLocaleString('ko-KR');
}

function AwardsSection({ cls, pub, me }: Omit<WrapupViewProps, 'wrapLive'>) {
  const player = playerForPredict(me);
  const item = (cls.schedule.wrapup ?? []).find((w) => w.id === 'awards');
  // 차시 한 판: 판에서 값이 모두 같을 수 있는 지표(사회적 책임·협력)는 숨김(PRD 4.1.1 hideFlatMetrics)
  const hideFlat = item?.hideFlatMetrics === true;
  const rows = SUMMARY_METRICS.map((id) => METRICS.find((m) => m.id === id)!).filter((m) => m && !(hideFlat && m.mayBeFlat));
  const awards = (pub?.awards ?? []).filter((a) => a.winners.length > 0);
  const mine = awards.filter((a) => a.winners.some((w) => w.pid === me.pid)).map((a) => a.award);
  return (
    <section class="st-wrap__sec" data-testid="wrap-awards">
      <h2 class="title-font">결산·시상</h2>
      <p class="st-wrap__lead">
        <b>{me.company.name}</b>의 항해 결산이에요. 공용 화면에서 시상식을 함께 봐요.
      </p>
      <ul class="st-wrap__metrics" data-testid="wrap-metrics">
        {rows.map((m) => (
          <li key={m.id} data-metric={m.id}>
            <span>{m.name}</span> <b>{fmt(m.id, metricValue(player, m.id))}</b> {m.unit}
          </li>
        ))}
      </ul>
      {mine.length > 0 && (
        <p class="st-wrap__mine" data-testid="wrap-my-awards">
          축하해요! 우리 회사가 받은 상: {mine.join(', ')}
        </p>
      )}
      {awards.length > 0 && (
        <ul class="st-wrap__awards" data-testid="wrap-award-list">
          {awards.map((a) => (
            <li key={a.metric}>
              <b>{a.award}</b> {a.winners.map((w) => w.company ?? '이름 짓는 중').join(', ')}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ReflectSection({ cls }: { cls: PublicClass }) {
  const item = (cls.schedule.wrapup ?? []).find((w): w is WrapItem => w.id === 'reflect');
  const qs = reflectQuestions(item?.questions ?? 3);
  const hasW18 = !!item?.worksheetIds.includes('W18');
  const w18 = worksheetById.W18;
  return (
    <section class="st-wrap__sec" data-testid="wrap-reflect" data-questions={qs.length}>
      <h2 class="title-font">되돌아보기</h2>
      <p class="st-wrap__lead">항해를 되돌아보며 문항마다 한 줄씩 써요. 도감과 항해 기록장을 보면 쓰기 쉬워요.</p>
      <ol class="st-wrap__qs" data-testid="wrap-reflect-questions">
        {qs.map((q, i) => (
          <li key={i}>{q}</li>
        ))}
      </ol>
      <p class="st-wrap__where" data-testid="wrap-reflect-where">
        {hasW18
          ? `학습지 ${w18.label}(${w18.pagesLabel})에 한 줄씩 써요.`
          : `오늘은 공책이나 선생님이 정한 곳에 한 줄씩 써요. 학습지 ${w18.label}(되돌아보기)은 단원 마지막 시간에 세 문항을 모두 써요.`}
      </p>
    </section>
  );
}

/** 마무리 단계별 학생 화면(118이 단계를 더할 자리) */
export const WRAP_SECTIONS: Readonly<Record<string, (p: Omit<WrapupViewProps, 'wrapLive'>) => preact.JSX.Element>> = {
  awards: (p) => <AwardsSection {...p} />,
  reflect: (p) => <ReflectSection cls={p.cls} />,
};

export function WrapupView({ cls, pub, me, wrapLive }: WrapupViewProps) {
  const section = wrapLive ? WRAP_SECTIONS[wrapLive] : undefined;
  return (
    <section class={`st-over${section ? ' st-wrap' : ''}`} data-testid="trade-over" data-wrap={wrapLive ?? ''}>
      {section ? (
        section({ cls, pub, me })
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
