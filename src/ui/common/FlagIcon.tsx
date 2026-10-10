/**
 * 회사 깃발(색 + 문양) 아이콘 — 공통 컴포넌트(작업 107 추가). 학생 HUD·회사 설립·공용 화면 순위판 등에서 쓴다.
 * 색은 깃발 색 ID('red' 등, src/core/company.ts FLAG_COLORS) 또는 '#RRGGBB'. 문양 모양은 해도 배 깃발과 같다(ShipIcon).
 * 색만으로 구분하지 않도록(PRD 8.1-5) 문양을 늘 함께 그린다.
 */
import { FLAG_COLORS } from '../../core/company';
import { emblemPath } from '../map/ShipIcon';

/** 깃발 색 ID → HEX(이미 HEX면 그대로, 모르면 잉크 흐림) */
export function flagHex(color: string): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;
  return FLAG_COLORS.find((c) => c.id === color)?.hex ?? '#6B5A3F';
}

export interface FlagIconProps {
  color: string;
  emblem: string;
  /** 너비(px). 높이는 3/4 */
  size?: number;
  /** 화면 읽기용 이름(없으면 장식으로 숨김) */
  label?: string;
}

export function FlagIcon({ color, emblem, size = 40, label }: FlagIconProps) {
  const d = emblemPath(emblem);
  const h = Math.round(size * 0.75);
  return (
    <svg
      class="flag-icon"
      width={size}
      height={h}
      viewBox="0 0 40 30"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : 'true'}
    >
      <path d="M2 2H36L33 15L36 28H2Z" fill={flagHex(color)} stroke="#2B2318" stroke-width="1.6" stroke-linejoin="round" />
      {d && (
        <g transform="translate(9 5) scale(2)">
          <path d={d} fill="none" stroke="#EFE2BF" stroke-width="0.9" stroke-linecap="round" stroke-linejoin="round" />
        </g>
      )}
    </svg>
  );
}

export default FlagIcon;
