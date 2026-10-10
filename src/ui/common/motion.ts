/** `prefers-reduced-motion: reduce` 인지 판별한다(PRD 8.1-8). 브라우저가 아니면 false. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
