/**
 * (작업 172) L3-E3 '전 세계 생성형 인공지능 시장 전망' 막대 그래프(p.107, 출처 표기). 학생 카드·공용 화면이 같이 쓴다.
 * 값은 교과서 그래프의 억 달러(37 → 194 → 363) — `src/data/phone.ts` AI_MARKET_GRAPH.
 */
import { AI_MARKET_GRAPH } from '../../data/phone';
import { linkPages } from './model';

export function AiGraph({ small = false }: { small?: boolean }) {
  const max = Math.max(...AI_MARKET_GRAPH.points.map((p) => p.value));
  return (
    <figure class={`vc-graph${small ? ' vc-graph--small' : ''}`} data-testid="ai-graph" aria-label="전 세계 생성형 인공지능 시장 전망">
      <figcaption class="vc-graph__cap">전 세계 생성형 인공지능 시장 전망</figcaption>
      <div class="vc-graph__bars">
        {AI_MARKET_GRAPH.points.map((p) => (
          <div key={p.year} class="vc-graph__col">
            <span class="vc-graph__val">{p.label}</span>
            <span class="vc-graph__bar" style={{ height: `${Math.round((p.value / max) * 100)}%` }} />
            <span class="vc-graph__year">{p.year}년</span>
          </div>
        ))}
      </div>
      <p class="vc-graph__src">
        출처: {AI_MARKET_GRAPH.source} · {linkPages(AI_MARKET_GRAPH.pages)}
      </p>
    </figure>
  );
}
