/**
 * 무역 도장 (PRD 6.5.3, 6.6, art-style 3.1) — 작업 108.
 * [수출] 파랑 · [수입] 초록 · [중계] 노랑 · [국내 판매] 회색 · [관세 10%] 빨강.
 * 글자는 코드 텍스트, 고무·밀랍 도장 느낌은 CSS로만(이미지 없음). 색만으로 전달하지 않게 글자 + 아이콘을 함께 둔다(PRD 8.1-5).
 *
 * 모션(작업 202)용 연결점:
 * - 루트 `<span class="stamp stamp--{kind}" data-stamp="{kind}">` — 기본은 `.stamp--in`일 때 0.2초 페이드(CSS)만.
 * - `fx.stamp(element, { kind })`는 부르는 쪽(항구 화면)이 도장을 그린 뒤 부른다.
 */
import type { StampKind } from '../../core/types';
import './trade-ui.css';

export type StampVariant = StampKind | 'tariff';

export const STAMP_TEXT: Record<StampKind, string> = {
  export: '수출',
  import: '수입',
  relay: '중계',
  domestic: '국내 판매',
};

export interface StampProps {
  kind: StampVariant;
  /** 관세율(0.1 → "관세 10%") */
  rate?: number;
  size?: 'small' | 'medium' | 'large';
  /** 찍히는 순간 페이드(기본 0.2초) */
  animate?: boolean;
  class?: string;
  testId?: string;
}

export function stampLabel(kind: StampVariant, rate = 0.1): string {
  return kind === 'tariff' ? `관세 ${Math.round(rate * 100)}%` : STAMP_TEXT[kind];
}

function StampGlyph({ kind }: { kind: StampVariant }) {
  const common = { fill: 'none', stroke: 'currentColor', 'stroke-width': 2.2, 'stroke-linecap': 'round' as const, 'stroke-linejoin': 'round' as const };
  switch (kind) {
    case 'export': // 상자에서 바깥으로 나가는 화살표
      return (
        <svg class="stamp__glyph" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 10v9h11v-9z" {...common} />
          <path d="M11 14L20 5M14 5h6v6" {...common} />
        </svg>
      );
    case 'import': // 바깥에서 상자로 들어오는 화살표
      return (
        <svg class="stamp__glyph" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 10v9h11v-9z" {...common} />
          <path d="M20 4L10 14M10 8v6h6" {...common} />
        </svg>
      );
    case 'relay': // 들어왔다 다시 나가는 두 화살표
      return (
        <svg class="stamp__glyph" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 8h15M14 4l4 4-4 4" {...common} />
          <path d="M21 16H6M10 12l-4 4 4 4" {...common} />
        </svg>
      );
    case 'domestic': // 집(우리나라 안)
      return (
        <svg class="stamp__glyph" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 11l9-7 9 7M6 9.5V20h12V9.5M10 20v-5h4v5" {...common} />
        </svg>
      );
    case 'tariff': // 동전 + 퍼센트
      return (
        <svg class="stamp__glyph" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" {...common} />
          <path d="M8.5 15.5l7-7" {...common} />
          <circle cx="9" cy="9" r="1.4" fill="currentColor" />
          <circle cx="15" cy="15" r="1.4" fill="currentColor" />
        </svg>
      );
  }
}

/** 무역 도장 한 개 */
export function Stamp({ kind, rate, size = 'medium', animate, class: className, testId }: StampProps) {
  const label = stampLabel(kind, rate);
  return (
    <span
      class={`stamp stamp--${kind} stamp--${size}${animate ? ' stamp--in' : ''}${className ? ` ${className}` : ''}`}
      data-stamp={kind}
      data-testid={testId ?? `stamp-${kind}`}
      role="img"
      aria-label={kind === 'tariff' ? `${label} 도장` : `${label} 도장`}
    >
      <StampGlyph kind={kind} />
      <span class="stamp__text">{label}</span>
    </span>
  );
}

export default Stamp;
