/** 학생 화면 작은 SVG 아이콘(이모지 대신, PRD 8.1-9). 모두 장식(aria-hidden) — 옆에 글자를 함께 둔다. */

export function BookIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
      <path d="M3 5Q8 3 13 6Q18 3 23 5V21Q18 19 13 22Q8 19 3 21Z" fill="#EFE2BF" stroke="#2B2318" stroke-width="1.6" stroke-linejoin="round" />
      <path d="M13 6V22" stroke="#2B2318" stroke-width="1.4" />
    </svg>
  );
}

export function GearIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
      <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <circle cx="13" cy="13" r="4" />
        <path d="M13 2.5V6M13 20V23.5M2.5 13H6M20 13H23.5M5.6 5.6L8 8M18 18L20.4 20.4M5.6 20.4L8 18M18 8L20.4 5.6" />
      </g>
    </svg>
  );
}

export function BellDotIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
      <path d="M7 17V11Q7 6 13 6Q19 6 19 11V17L21 19H5Z" fill="#EFE2BF" stroke="#2B2318" stroke-width="1.5" stroke-linejoin="round" />
      <circle cx="13" cy="21.5" r="1.8" fill="#2B2318" />
      <circle cx="20" cy="6" r="4" fill="#C0623F" stroke="#EFE2BF" stroke-width="1.2" />
    </svg>
  );
}

export function CoinIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="#DCAA48" stroke="#8D6C2C" stroke-width="1.6" />
      <circle cx="12" cy="12" r="6.5" fill="none" stroke="#8D6C2C" stroke-width="1.2" />
    </svg>
  );
}

export function CrateIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="5" width="18" height="15" rx="1.5" fill="#B98A4E" stroke="#2B2318" stroke-width="1.5" />
      <path d="M3 10H21M3 15H21M9 5V20M15 5V20" stroke="#5A4329" stroke-width="1.1" />
    </svg>
  );
}

export function ClockIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9.5" fill="#EFE2BF" stroke="#2B2318" stroke-width="1.6" />
      <path d="M12 6.5V12L15.5 14" fill="none" stroke="#2B2318" stroke-width="1.8" stroke-linecap="round" />
    </svg>
  );
}

/** 항해 규칙 카드 그림 4칸(PRD 6.16.3) */
export function RuleArt({ no }: { no: number }) {
  const stroke = { stroke: '#2B2318', 'stroke-width': 1.6, 'stroke-linejoin': 'round' as const, 'stroke-linecap': 'round' as const };
  if (no === 1)
    return (
      <svg width="72" height="56" viewBox="0 0 72 56" aria-hidden="true">
        <rect x="8" y="30" width="20" height="20" rx="2" fill="#D9A441" {...stroke} />
        <rect x="44" y="30" width="20" height="20" rx="2" fill="#D9A441" {...stroke} />
        <path d="M36 6V26M18 14H54M18 14L10 28H26ZM54 14L46 28H62Z" fill="none" {...stroke} />
      </svg>
    );
  if (no === 2)
    return (
      <svg width="72" height="56" viewBox="0 0 72 56" aria-hidden="true">
        <rect x="14" y="10" width="30" height="40" rx="3" fill="#EFE2BF" {...stroke} />
        <path d="M22 20H36M22 28H36M22 36H32" fill="none" {...stroke} />
        <path d="M46 44L60 30M60 30V40M60 30H50" fill="none" stroke="#6C8F4E" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    );
  if (no === 3)
    return (
      <svg width="72" height="56" viewBox="0 0 72 56" aria-hidden="true">
        <path d="M8 36H64L56 48H16Z" fill="#5A4329" {...stroke} />
        <rect x="18" y="22" width="12" height="14" fill="#B5523B" {...stroke} />
        <rect x="32" y="16" width="12" height="20" fill="#3B6E8F" {...stroke} />
        <rect x="46" y="24" width="10" height="12" fill="#6C8F4E" {...stroke} />
        <path d="M4 52Q10 48 16 52T28 52T40 52T52 52T64 52" fill="none" stroke="#1F4E6B" stroke-width="2" />
      </svg>
    );
  return (
    <svg width="72" height="56" viewBox="0 0 72 56" aria-hidden="true">
      <circle cx="36" cy="32" r="14" fill="#DCAA48" {...stroke} />
      <path d="M36 24L38.5 30H44.5L39.6 33.6L41.5 39.5L36 35.8L30.5 39.5L32.4 33.6L27.5 30H33.5Z" fill="#EFE2BF" stroke="#8D6C2C" stroke-width="1" />
      <path d="M28 6L34 18M44 6L38 18" fill="none" stroke="#B5523B" stroke-width="4" stroke-linecap="round" />
    </svg>
  );
}
