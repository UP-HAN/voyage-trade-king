/**
 * 화면 끼워 넣기 지점 (작업 107 → 111·112·113이 채움).
 *
 * 학생 기본 화면(해도·항구·준비 단계) 위에 겹치는 층을 한곳에서 정한다. 위에 있는 층일수록 먼저 조작을 가로챈다.
 *
 *   우선순위(높음 → 낮음)              z-index  담당
 *   1. 일시정지 "선생님을 보세요"(S25)    90       107 (PauseOverlay)
 *   2. 막힌 이름 다시 짓기              80       107 (NameBlockedModal) — 일시정지보다 아래, 학습지 팝업보다 위(v0.3.1)
 *   3. 학습지 "잠깐!" 팝업(S22)          70       112 → WorksheetLayer
 *   4. 사건·결정 카드(S12·S13)           60       111 → EventLayer (src/student/events/)
 *      미니게임(벽란도·두 섬 등)          60       113 → src/minigames/MinigameLayer.tsx (EventLayer가 넘김)
 *      (비차단 사건 오른쪽 패널·첫 항해 튜토리얼은 55 — 아래 화면을 막지 않음)
 *   5. 편지 패널(S14)                  50       112 → LetterLayer
 *   6. 기본 화면(해도·항구·HUD)          0        107
 *
 * 사용법(이후 작업):
 * - 이 파일의 빈 컴포넌트(`EventLayer` 등)를 실제 구현으로 바꾸거나, 각자 파일에서 만든 컴포넌트를 여기서 import해 돌려준다.
 *   층 컴포넌트는 `LayerProps`를 받는다: `store`(행동 `store.act(action)`, 토스트 `store.toast()`), `st`(학생 상태 —
 *   `st.peer.me` 내 회사, `st.peer.public.class` 학급 상태(phase·currentEvent·worksheet…), `st.peer.public.public` 학급 공개 집계).
 * - 보여 줄 것이 없으면 `null`을 돌려준다(층이 비면 아래 화면을 그대로 누를 수 있음).
 * - 화면 전체를 덮는 층은 `<LayerFrame>`으로 감싸면 z-index·배경·조작 가로채기가 맞춰진다.
 * - 편지함 아이콘(HUD 오른쪽)은 `LetterHudSlot`(112)이 채운다. 지금은 자리만 차지한다.
 * - 연출은 `src/ui/common/fx.ts` 훅(cardIn·popupIn·gull 등)으로만 부른다.
 */
import type { FunctionComponent } from 'preact';
import { EventLayer as EventLayerImpl } from './events/EventLayer';
import { LetterBadge } from './letters/LetterBadge';
import { LetterLayer as LetterLayerImpl } from './letters/LetterLayer';
import { NameBlockedModal, PauseOverlay } from './overlays';
import type { StudentState, StudentStore } from './store';
import { WorksheetLayer as WorksheetLayerImpl } from './worksheet/WorksheetLayer';
import { LayerFrame, type LayerName } from './layer';

export { LAYER_ORDER, LAYER_Z, LayerFrame, type LayerName } from './layer';

export interface LayerProps {
  store: StudentStore;
  st: StudentState;
}

/**
 * 112: 학습지 "잠깐!" 팝업 — 실제 화면은 `src/student/worksheet/WorksheetLayer.tsx`(props: classState, player, act).
 * 112는 그 파일만 바꾸면 된다(이 연결은 111이 고정).
 */
export const WorksheetLayer: FunctionComponent<LayerProps> = ({ store, st }) => {
  const cls = st.peer.public?.class;
  const me = st.peer.me;
  if (!cls || !me || !me.company.founded) return null;
  return <WorksheetLayerImpl classState={cls} player={me} act={(a) => store.act(a)} />;
};
/** 111: 사건·결정 카드(+ 따라잡기 + 첫 항해 튜토리얼). 미니게임 사건은 이 층이 `src/minigames/MinigameLayer.tsx`(113)로 넘긴다 */
export const EventLayer: FunctionComponent<LayerProps> = EventLayerImpl;
/**
 * 113: 미니게임 — 사건 층(EventLayer)이 지금 열린 미니게임 사건·따라잡기 미니게임을 `src/minigames/MinigameLayer.tsx`로 넘긴다.
 * 그래서 이 자리는 비워 둔다(113은 src/minigames/MinigameLayer.tsx만 바꾸면 된다).
 */
export const MinigameLayer: FunctionComponent<LayerProps> = () => null;
/** 112: 편지 패널 — 실제 화면은 `src/student/letters/LetterLayer.tsx`(props: classState, player, act) */
export const LetterLayer: FunctionComponent<LayerProps> = ({ store, st }) => {
  const cls = st.peer.public?.class;
  const me = st.peer.me;
  if (!cls || !me) return null;
  return <LetterLayerImpl classState={cls} player={me} act={(a) => store.act(a)} />;
};
/** 112: HUD 편지함 아이콘 자리 — 실제 화면은 `src/student/letters/LetterBadge.tsx`(48px 칸) */
export const LetterHudSlot: FunctionComponent<LayerProps> = ({ st }) => <LetterBadge classState={st.peer.public?.class ?? null} player={st.peer.me} />;

/** 지금 보여야 할 가장 높은 층 이름(없으면 null) — 테스트·화면 판단용 */
export function topLayer(st: StudentState): LayerName | null {
  const pub = st.peer.public?.class;
  if (pub?.paused) return 'pause';
  if (st.peer.nameStatus === 'blocked') return 'nameBlocked';
  return null;
}

/** 기본 화면 위에 층들을 우선순위대로 그린다 */
export function SlotLayers({ store, st }: LayerProps) {
  const paused = Boolean(st.peer.public?.class?.paused);
  const blocked = st.peer.nameStatus === 'blocked';
  return (
    <>
      <LetterLayer store={store} st={st} />
      <EventLayer store={store} st={st} />
      <MinigameLayer store={store} st={st} />
      <WorksheetLayer store={store} st={st} />
      {blocked && (
        <LayerFrame name="nameBlocked">
          <NameBlockedModal store={store} />
        </LayerFrame>
      )}
      {paused && (
        <LayerFrame name="pause">
          <PauseOverlay />
        </LayerFrame>
      )}
    </>
  );
}
