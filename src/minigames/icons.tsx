/** 미니게임 아이콘(SVG — 이모지 금지, PRD 8.1). 색은 글자색(currentColor)과 고정 잉크·놋쇠 색을 쓴다 */

/** 쌀(볏단 + 쌀자루) */
export function RiceIcon({ size = 28 }: { size?: number }) {
  return (
    <svg class="mg-icon mg-icon--rice" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path d="M8 13c0-2 2-3 3-4h10c1 1 3 2 3 4l1 13c0 2-2 3-4 3H11c-2 0-4-1-4-3z" fill="#EFE2BF" stroke="#2B2318" stroke-width="1.6" stroke-linejoin="round" />
      <path d="M11 9c1-2 9-2 10 0" fill="none" stroke="#2B2318" stroke-width="1.6" />
      <path d="M12 7.5c2 1 6 1 8 0" fill="none" stroke="#8D6C2C" stroke-width="2" stroke-linecap="round" />
      <g fill="#DCAA48" stroke="#8D6C2C" stroke-width="0.8">
        <ellipse cx="13" cy="19" rx="1.4" ry="2.2" transform="rotate(-25 13 19)" />
        <ellipse cx="16" cy="17.5" rx="1.4" ry="2.2" />
        <ellipse cx="19" cy="19" rx="1.4" ry="2.2" transform="rotate(25 19 19)" />
        <ellipse cx="14.5" cy="23" rx="1.4" ry="2.2" transform="rotate(-15 14.5 23)" />
        <ellipse cx="17.5" cy="23" rx="1.4" ry="2.2" transform="rotate(15 17.5 23)" />
      </g>
    </svg>
  );
}

/** 옷(저고리) */
export function ClothesIcon({ size = 28 }: { size?: number }) {
  return (
    <svg class="mg-icon mg-icon--clothes" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path
        d="M11 5l5 3 5-3 8 5-3 6-3-1.5V28H9V14.5L6 16l-3-6z"
        fill="#3B6E8F"
        stroke="#2B2318"
        stroke-width="1.6"
        stroke-linejoin="round"
      />
      <path d="M11 5l5 9 5-9" fill="none" stroke="#EFE2BF" stroke-width="1.8" stroke-linejoin="round" />
      <path d="M16 14l4 4" stroke="#C0623F" stroke-width="2" stroke-linecap="round" />
    </svg>
  );
}

/** 맞음(✓) / 아직(✗) 표시 — 글자와 함께 쓴다 */
export function CheckMark({ ok, size = 22 }: { ok: boolean; size?: number }) {
  return ok ? (
    <svg class="mg-icon mg-icon--ok" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="11" fill="#3c6a28" />
      <path d="M6.5 12.5l3.5 3.5 7.5-8" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  ) : (
    <svg class="mg-icon mg-icon--no" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="11" fill="#C0623F" />
      <path d="M8 8l8 8M16 8l-8 8" stroke="#fff" stroke-width="2.6" stroke-linecap="round" />
    </svg>
  );
}
