/**
 * 끼워 넣기 층 틀(작업 107 slots.tsx에서 옮김 — 111). 층 컴포넌트 파일(112·113)이 slots.tsx를 import하지 않고 쓸 수 있게 따로 둔다.
 * slots.tsx가 그대로 다시 내보낸다.
 */
import type { ComponentChildren } from 'preact';

export const LAYER_Z = {
  pause: 90,
  nameBlocked: 80,
  worksheet: 70,
  event: 60,
  minigame: 60,
  letter: 50,
} as const;

export type LayerName = keyof typeof LAYER_Z;

/** 우선순위 순서(높음 → 낮음) */
export const LAYER_ORDER: readonly LayerName[] = ['pause', 'nameBlocked', 'worksheet', 'event', 'minigame', 'letter'];

/** 층 틀: 화면 전체를 덮고 아래 조작을 막는다 */
export function LayerFrame({ name, children, dim = true }: { name: LayerName; children: ComponentChildren; dim?: boolean }) {
  return (
    <div class={`st-layer st-layer--${name}${dim ? ' st-layer--dim' : ''}`} style={{ zIndex: LAYER_Z[name] }} data-layer={name}>
      {children}
    </div>
  );
}
