/**
 * (작업 169) 교사 화면의 [시범 화면 열기] — 수업과 따로 도는 연습 판(#/demo)을 새 창으로 연다.
 * 시범 판 코드(world.ts)는 끌어오지 않는다(교사 화면 묶음을 키우지 않게 — 경로만 연다).
 */
import { DEMO_ROUTE } from '../route';

export const DEMO_WINDOW_NAME = 'voyage-demo';
export const DEMO_HINT = '수업과 따로 도는 연습 화면이에요. 멈춤이 떠도 이 화면은 안 멈춰요.';

/** 시범 화면 주소(지금 페이지 경로 기준, 질의는 떼어 냄 — `?sync=` 등이 시범 판에 영향 없게) */
export function demoHref(loc: Pick<Location, 'pathname'> = location): string {
  return `${loc.pathname}#${DEMO_ROUTE}`;
}

export function openDemoWindow(): void {
  if (typeof window === 'undefined') return;
  window.open(demoHref(), DEMO_WINDOW_NAME);
}

/** variant 'menu': 교사 대시보드 [TV 화면 ▾] 목록 안(공용 화면 창 열기 아래), 'block': 시작 화면 */
export function DemoOpenButton({ variant = 'block', onOpened }: { variant?: 'block' | 'menu'; onOpened?: () => void }) {
  const open = () => {
    openDemoWindow();
    onOpened?.();
  };
  if (variant === 'menu') {
    return (
      <>
        <button type="button" class="btn btn--secondary t-btn-sm" data-testid="btn-open-demo" onClick={open}>
          시범 화면 열기
        </button>
        <p class="t-small" data-testid="demo-open-hint">
          {DEMO_HINT}
        </p>
      </>
    );
  }
  return (
    <div class="t-demo-open" data-testid="demo-open">
      <button type="button" class="btn btn--secondary" data-testid="btn-open-demo" onClick={open}>
        시범 화면 열기
      </button>
      <span class="t-demo-open__hint" data-testid="demo-open-hint">
        {DEMO_HINT}
      </span>
    </div>
  );
}
