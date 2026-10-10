/**
 * 항구 화면 그림 부품(작업 108): 상품 아이콘(없으면 분류 색 + 첫 글자 원형), 인기 불꽃, '싸게 파는 까닭' 아이콘 4종.
 * 이모지를 쓰지 않는다(PRD 8.1-9). 모든 아이콘 옆에는 글자를 함께 둔다.
 */
import { useState } from 'preact/hooks';
import { goodsById } from '../../data/goods';
import type { CheapReason, GoodId } from '../../data/types';
import { img } from '../../ui/common/asset';

/** 상품 분류 색(아이콘이 없을 때 원형 바탕) — art-style 3.2 컨테이너 색 */
export const CATEGORY_COLOR: Record<string, string> = {
  천연자원: '#8E7849',
  원료: '#7A5C8E',
  농산물: '#6C8F4E',
  '공업 제품': '#B5523B',
  '첨단 제품': '#2E7D8C',
  '문화 서비스': '#D9A441',
  서비스: '#D9A441',
  '우리나라 상품': '#3B6E8F',
  '우리나라 문화 서비스': '#D9A441',
};

export function goodColor(good: GoodId): string {
  return CATEGORY_COLOR[goodsById[good].category] ?? '#6B5A3F';
}

/** 상품 그림(assets/images/goods/<id>.png). 없으면 분류 색 원 + 이름 첫 글자 */
export function GoodIcon({ good, size = 56 }: { good: GoodId; size?: number }) {
  const g = goodsById[good];
  const [failed, setFailed] = useState(false);
  if (failed) {
    const light = ['#D9A441'].includes(goodColor(good));
    return (
      <span
        class="pt-goodicon pt-goodicon--fallback"
        data-testid={`good-fallback-${good}`}
        role="img"
        aria-label={g.name}
        style={{ width: `${size}px`, height: `${size}px`, background: goodColor(good), color: light ? '#2B2318' : '#fff', fontSize: `${Math.round(size * 0.46)}px` }}
      >
        {[...g.name][0]}
      </span>
    );
  }
  return (
    <img
      class="pt-goodicon"
      src={img(g.image)}
      alt={g.name}
      width={size}
      height={size}
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

/** 인기(H) 불꽃 */
export function FlameIcon({ size = 22 }: { size?: number }) {
  return (
    <svg class="pt-flame" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 2c1 3.5-2.5 5-2.5 8.5 0 1 .4 1.9 1 2.5-.2-1.6.8-3 2-3.8.2 2.2 2.5 3 2.5 5.3a3 3 0 0 1-1.1 2.4C16.6 16.4 19 14 19 10.6 19 6.4 15.5 3.6 12 2z M5 13.5C5 18 8.1 22 12 22s7-3.2 7-7.3c0 0-1.4 4.3-5.8 4.3-2.8 0-4.7-2-4.7-4.6 0-1.1.4-2 .9-2.8C7.2 12.2 5 12.3 5 13.5z"
        fill="#C0623F"
        stroke="#7a3a22"
        stroke-width="0.8"
      />
    </svg>
  );
}

/** '이 나라가 싸게 파는 까닭'(p.99) 아이콘 */
export function ReasonIcon({ reason, size = 40 }: { reason: CheapReason; size?: number }) {
  const s = { fill: 'none', stroke: '#2B2318', 'stroke-width': 2, 'stroke-linecap': 'round' as const, 'stroke-linejoin': 'round' as const };
  return (
    <svg class="pt-reason-icon" width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="18" fill="#E4D3A8" stroke="#8D6C2C" stroke-width="2" />
      {reason === 'nature' && (
        <>
          <circle cx="27" cy="13" r="4" fill="#F2B66D" stroke="#8D6C2C" stroke-width="1.5" />
          <path d="M8 29c4-6 7-9 10-9s5 4 7 4 4-2 7-2M12 29V20M12 20c-3 0-4-3-4-3s3-1 4 1c1-2 4-1 4-1s-1 3-4 3" {...s} stroke="#4f7338" />
        </>
      )}
      {reason === 'resource' && (
        <>
          <path d="M9 29h22M12 29l4-9h8l4 9" {...s} />
          <path d="M16 20l2-6h4l2 6" {...s} fill="#8E7849" />
        </>
      )}
      {reason === 'capital' && (
        <>
          <ellipse cx="20" cy="26" rx="9" ry="3.5" {...s} fill="#DCAA48" />
          <ellipse cx="20" cy="21" rx="9" ry="3.5" {...s} fill="#DCAA48" />
          <ellipse cx="20" cy="16" rx="9" ry="3.5" {...s} fill="#DCAA48" />
        </>
      )}
      {reason === 'tech' && (
        <>
          <circle cx="20" cy="20" r="5" {...s} />
          <path d="M20 9v4M20 27v4M9 20h4M27 20h4M12.5 12.5l2.8 2.8M24.7 24.7l2.8 2.8M12.5 27.5l2.8-2.8M24.7 15.3l2.8-2.8" {...s} />
        </>
      )}
    </svg>
  );
}

/** 계약서(서비스) 작은 그림 */
export function ContractIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 3h9l4 4v14H6z" fill="#EFE2BF" stroke="#2B2318" stroke-width="1.6" stroke-linejoin="round" />
      <path d="M9 9h7M9 12h7M9 15h4" stroke="#2B2318" stroke-width="1.4" stroke-linecap="round" />
      <circle cx="16" cy="18" r="2.2" fill="#C0623F" />
    </svg>
  );
}
