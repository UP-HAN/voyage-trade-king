/**
 * 미니게임 층(작업 111이 연결, 작업 113이 채움: 벽란도 시장 L1-E1, 두 섬 이야기 L1-E5).
 *
 * 학생 사건 층(`src/student/events/EventLayer.tsx`)이 지금 열린 미니게임 사건이나 따라잡기 큐의 미니게임 사건을 이 컴포넌트로 넘긴다.
 * 이 컴포넌트는 `LayerFrame name="minigame"` 안에 그려진다(사건 층이 감쌈 — 일시정지 층이 위에 덮음).
 * - props: `eventId`(L1-E1 / L1-E5 …), `classState`(공개 학급 상태 — 짧은 형태는 `currentEvent.short` 또는 `shortEvents`),
 *   `player`(내 회사), `act`(행동 보내기 — 결과는 `{ type: 'respondEvent', eventId, response }`), `onDone`(화면 닫기)
 * - 결과는 학생이 정답 공개·정의 카드·결과 그래프까지 본 뒤 [마치기]에서 보낸다(`shared.tsx` 참고).
 *   사건이 마감되기 전에 마치지 못한 학생은 기록이 없으므로(111 마감 규칙: 미니게임은 기본값을 넣지 않음) 다시 들어올 때 따라잡기로 다시 받는다.
 * - 아직 만들지 않은 미니게임(L4-E6 컨테이너 싣기 등)은 "준비 중" 자리표시와 [닫기].
 */
import type { Action, PublicClass } from '../core';
import { eventsById } from '../data/events';
import type { MeView } from '../student/predict';
import type { StudentActResult } from '../student/store';
import { Byeokrando } from './Byeokrando';
import { TwoIslands } from './TwoIslands';
import type { MinigameGameProps } from './types';
import './minigames.css';

export interface MinigameLayerProps {
  eventId: string;
  classState: PublicClass;
  player: MeView;
  act: (action: Action) => StudentActResult;
  onDone: () => void;
  /** 따라잡기로 연 것인가(늦게 들어온 학생) */
  catchUp?: boolean;
}

/** 이 사건을 짧은 형태로 하나(지금 열린 사건이면 currentEvent.short, 지난 사건이면 발동 기록 shortEvents) */
export function isShortForm(cls: PublicClass, eventId: string): boolean {
  const ce = cls.currentEvent;
  if (ce && ce.id === eventId) return ce.short === true;
  return Array.isArray(cls.shortEvents) && cls.shortEvents.includes(eventId);
}

/** 사건이 이미 마감됐나(지금 열린 사건이 아니면 지난 사건) */
export function isClosedFor(cls: PublicClass, eventId: string): boolean {
  const ce = cls.currentEvent;
  return !ce || ce.id !== eventId || ce.closed === true;
}

export function MinigameLayer({ eventId, classState, player, act, onDone, catchUp }: MinigameLayerProps) {
  const props: MinigameGameProps = {
    eventId,
    short: isShortForm(classState, eventId),
    catchUp: !!catchUp,
    closed: isClosedFor(classState, eventId),
    player,
    act,
    onDone,
    alreadyDone: player.game.responses[eventId] !== undefined,
  };
  if (eventId === 'L1-E1') return <Byeokrando key={eventId} {...props} />;
  if (eventId === 'L1-E5') return <TwoIslands key={eventId} {...props} />;
  const def = eventsById[eventId];
  return (
    <div class="st-placeholder" role="dialog" aria-label={`${def?.title ?? '미니게임'} 준비 중`} data-testid="minigame-placeholder" data-event={eventId}>
      <p class="st-placeholder__kicker">{catchUp ? '놓친 활동' : '활동'}</p>
      <p class="st-placeholder__title title-font">{def?.title ?? '미니게임'}</p>
      <p>미니게임 준비 중이에요. 선생님 화면을 봐요.</p>
      <button type="button" class="btn btn--secondary" data-testid="minigame-close" onClick={onDone}>
        닫기
      </button>
    </div>
  );
}

export default MinigameLayer;
