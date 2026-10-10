/**
 * 해시 라우터 (PRD 10.1 라우팅): #/ 타이틀, #/play 학생, #/teacher 교사, #/screen 공용 화면.
 * 해시 라우팅이므로 하위 경로(/voyage/ 등)에서 새로 고침해도 404가 나지 않는다.
 * 각 화면 폴더는 라우트 진입점 하나(index.tsx)의 기본 내보내기를 lazy import 한다(PRD 12장 5).
 */
import { render, type ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import Title from './title';
import { routeFromHash } from './route';
import './styles/base.css';

type Loader = () => Promise<{ default: ComponentType }>;

const ROUTES: Record<string, Loader> = {
  '/play': () => import('./student/index'),
  '/teacher': () => import('./teacher/index'),
  '/screen': () => import('./screen/index'),
};

function useHashRoute(): string {
  const [route, setRoute] = useState(() => routeFromHash(location.hash));
  useEffect(() => {
    const onChange = () => setRoute(routeFromHash(location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

function LazyRoute({ load }: { load: Loader }) {
  const [Comp, setComp] = useState<ComponentType | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    setComp(null);
    setError(false);
    load().then(
      (m) => alive && setComp(() => m.default),
      () => alive && setError(true),
    );
    return () => {
      alive = false;
    };
  }, [load]);
  if (error) {
    return (
      <main class="placeholder">
        <p>화면을 불러오지 못했어요. 새로 고침해 주세요.</p>
      </main>
    );
  }
  if (!Comp) return <p class="route-loading">불러오는 중…</p>;
  return <Comp />;
}

function App() {
  const route = useHashRoute();
  const loader = ROUTES[route];
  if (!loader) return <Title />;
  return <LazyRoute key={route} load={loader} />;
}

const root = document.getElementById('app');
if (root) render(<App />, root);
