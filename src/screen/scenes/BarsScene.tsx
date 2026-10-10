/**
 * 투표·응답 막대 장면(PRD 7.6, brief 3번): 질문, 실시간 응답 수, 교사가 [결과 공개]하기 전에는 수만, 공개 후 막대(이름 없음).
 * 벽란도 맞힌 수 분포·두 섬 성공 수·확인 퀴즈 정답률도 같은 막대로 그린다.
 * 학급 활동 장면(115~118: 세관 게시판·스마트폰 부품·경제 게이지·OX 정답률)은 `BarsView`에 `BarsModel`을 넘겨 다시 쓸 수 있다.
 */
import { barsFor, type BarsModel } from '../model';
import { Bar } from '../parts';
import type { SceneProps } from './types';

export function BarsView({ m }: { m: BarsModel }) {
  return (
    <div class="scr-scene scr-bars" data-testid="scene-bars" data-event={m.eventId} data-count-only={m.countOnly ? '1' : '0'}>
      <p class="scr-kicker">{m.title}</p>
      <h1 class="scr-h1">{m.question}</h1>
      <p class="scr-bars__count" data-testid="bars-count">
        응답한 회사 <b>{m.responded}</b>/{m.total}
      </p>
      {m.countOnly ? (
        <p class="scr-lead" data-testid="bars-wait">
          선생님이 결과를 공개하면 막대가 나와요.
        </p>
      ) : (
        <div class="scr-panel scr-bars__list">
          {m.rows.map((r) => (
            <Bar key={r.label} label={r.label} value={r.value} max={m.max} suffix={m.suffix} />
          ))}
        </div>
      )}
    </div>
  );
}

export function BarsScene({ d }: SceneProps) {
  const ce = d.cls.currentEvent;
  const id = ce?.id ?? d.pub.vote?.id ?? '';
  const m = barsFor(d, id);
  if (!m) {
    return (
      <div class="scr-scene scr-bars" data-testid="scene-bars">
        <p class="scr-lead">결과를 모으고 있어요.</p>
      </div>
    );
  }
  return <BarsView m={m} />;
}
