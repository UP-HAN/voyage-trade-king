/** 해시 → 라우트 경로. `#/play?x=1` → `/play`, 빈 해시·`#/` → `/` */
export function routeFromHash(hash: string): string {
  const path = hash.replace(/^#/, '').split('?')[0] ?? '';
  if (!path || path === '/') return '/';
  const normalized = (path.startsWith('/') ? path : `/${path}`).replace(/\/+$/, '');
  return normalized || '/';
}

/** (작업 169) 교사 시범 화면 경로 — 수업 방과 따로 도는 연습 판(src/demo/) */
export const DEMO_ROUTE = '/demo';

/** 이 주소가 교사 시범 화면인가(기기 저장소에 수업 기록을 남기지 않을 때 씀) */
export function isDemoHref(href: string): boolean {
  try {
    return routeFromHash(new URL(href).hash) === DEMO_ROUTE;
  } catch {
    return false;
  }
}
