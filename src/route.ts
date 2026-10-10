/** 해시 → 라우트 경로. `#/play?x=1` → `/play`, 빈 해시·`#/` → `/` */
export function routeFromHash(hash: string): string {
  const path = hash.replace(/^#/, '').split('?')[0] ?? '';
  if (!path || path === '/') return '/';
  const normalized = (path.startsWith('/') ? path : `/${path}`).replace(/\/+$/, '');
  return normalized || '/';
}
