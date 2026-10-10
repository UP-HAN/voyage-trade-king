/**
 * 학생 사건 층 판단 — 순수 함수 (작업 111, PRD 6.11·8.3 S12·S13).
 *
 * - 지금 떠 있는 사건(`class.currentEvent`)을 어떤 모양으로 보일지(카드 / 결정 / 확인 퀴즈 / 미니게임 / 없음)와
 *   차단형(가운데 카드, 아래 조작 막음)인지 비차단형(오른쪽 패널, 거래 가능)인지 정한다. 발동 경로(교사 [발동]·배치표 자동)는 상관없다.
 * - 늦게 들어온 학생의 따라잡기 계획: core `catchUpQueue`(개인 응답 필수 사건, 회사 설립 L1-E3 제외 — v0.3 준비 단계 107)
 *   + 놓친 공용 화면 중심 사건 요약 카드 1장.
 * - L1-E6 첫 출항 튜토리얼 단계.
 */
import { catchUpQueue, isBlocking, respondedTo, resultShowing, type PublicClass } from '../../core';
import { checkQuizFor } from '../../data/checkQuiz';
import { eventsById } from '../../data/events';
import type { GameEvent as EventDef } from '../../data/types';
import { classForPredict, playerForPredict, type MeView } from '../predict';

export type EventShape = 'card' | 'decision' | 'quiz' | 'minigame' | 'none';

/** 사건 정의 → 화면 모양 */
export function shapeOf(def: EventDef): EventShape {
  if (def.isCover || def.tier === 'prep' || def.tier === 'wrap') return 'none';
  if (def.kind === 'minigame') return 'minigame';
  if (def.kind === 'checkQuiz') return 'quiz';
  if ((def.kind === 'decision' || def.kind === 'vote') && def.options?.length) return 'decision';
  if (def.kind === 'worksheet') return 'none';
  return 'card';
}

export interface LiveEvent {
  id: string;
  def: EventDef;
  shape: EventShape;
  short: boolean;
  /** 차단형(가운데 카드) — false면 오른쪽 패널(L1-E6·L1-E7, 거래를 막지 않음) */
  blocking: boolean;
  revealed: boolean;
}

/** 지금 열린 사건(없거나 표지·준비 사건이면 null) */
export function liveEvent(cls: PublicClass | null | undefined): LiveEvent | null {
  const ce = cls?.currentEvent;
  if (!ce || ce.closed) return null;
  const def = eventsById[ce.id];
  if (!def) return null;
  const shape = shapeOf(def);
  if (shape === 'none') return null;
  return { id: ce.id, def, shape, short: ce.short, blocking: isBlocking(def, ce.short), revealed: ce.revealed === true };
}

/**
 * (수정 1회차) 마감한 확인 퀴즈·결정의 결과를 보여 주는 중이면 그 사건(core `resultShowing`, 20초 — 교사 [다음]으로 일찍 끝남).
 * 학생은 이 동안 내 결과·해설·쪽수를 본다.
 */
export function resultEvent(cls: PublicClass | null | undefined, now: number): LiveEvent | null {
  const ce = cls?.currentEvent;
  if (!cls || !ce || !resultShowing(cls, now)) return null;
  const def = eventsById[ce.id];
  if (!def) return null;
  const shape = shapeOf(def);
  if (shape !== 'quiz' && shape !== 'decision') return null;
  return { id: ce.id, def, shape, short: ce.short, blocking: isBlocking(def, ce.short), revealed: true };
}

/** 이 학생이 사건을 이미 했나(응답·확인 기록). 확인 퀴즈는 지정 문항을 모두 답했을 때 */
export function hasDone(me: MeView, id: string): boolean {
  const def = eventsById[id];
  if (!def) return false;
  if (def.kind === 'checkQuiz') {
    const qs = checkQuizFor(def.lesson);
    return qs.length > 0 && qs.every((q) => me.game.checkQuiz[q.id] !== undefined);
  }
  return me.game.responses[id] !== undefined;
}

/** 응답 필요 사건에 실제로 응답했나('응답 없음' 기본값 제외) — 교사 표·응답 수와 같은 규칙 */
export function hasResponded(me: MeView, id: string): boolean {
  return respondedTo(id, playerForPredict(me));
}

export type CatchUpItem = { mode: 'replay'; id: string } | { mode: 'summary'; ids: string[] } | { mode: 'resend'; id: string };

/**
 * 입장·재입장 때 따라잡기 계획(PRD 6.11.2): 놓친 공용 화면 중심 사건 요약 카드 1장(있으면 맨 앞) → 개인 응답 필수 사건(발동 순).
 * 회사 설립(L1-E3)은 준비 단계 화면(107)이 먼저 열므로 넣지 않는다. 지금 떠 있는 사건은 넣지 않는다(그대로 보임).
 */
export function catchUpPlan(cls: PublicClass, me: MeView): CatchUpItem[] {
  const ce = cls.currentEvent;
  const liveId = ce && !ce.closed ? ce.id : null;
  const replay = catchUpQueue(classForPredict(cls), playerForPredict(me)).filter((id) => id !== 'L1-E3' && id !== liveId);
  const summary = cls.firedEvents.filter((id) => {
    const def = eventsById[id];
    if (!def || id === liveId || replay.includes(id)) return false;
    if (def.catchUp === 'none' || shapeOf(def) === 'none') return false;
    // 개인 응답이 필요한 사건은 replay 쪽(마감이 지나 응답할 수 없는 것은 뺀다)
    if (def.needsResponse) return false;
    return me.game.responses[id] === undefined;
  });
  const out: CatchUpItem[] = [];
  if (summary.length) out.push({ mode: 'summary', ids: summary });
  for (const id of replay) out.push({ mode: 'replay', id });
  return out;
}

// ─── 첫 출항 튜토리얼(L1-E6) ─────────────────────────────────

export type TutorialStep = 'pickDest' | 'ready' | 'arrive' | 'enterPort' | 'buyGas' | 'done';

export const TUTORIAL_TEXT: Readonly<Record<Exclude<TutorialStep, 'done'>, string>> = {
  pickDest: '① 지도에서 포트헤들랜드를 눌러 목적지로 정해요.',
  ready: '② [출항 준비]를 눌러요. 라운드가 끝나면 배가 떠나요.',
  arrive: '라운드가 끝나면 포트헤들랜드에 도착해요. 조금만 기다려요.',
  enterPort: '③ 도착했어요! [항구 들어가기]를 눌러요.',
  buyGas: '④ 천연가스를 사요. 그다음 부산으로 가서 팔면 [수입] 도장을 받아요.',
};

export const TUTORIAL_PORT = 'PHE';

/** 튜토리얼 지금 단계(학생 상태 + 지금 화면이 항구인지) */
export function tutorialStep(me: MeView, inPort: boolean): TutorialStep {
  const g = me.game;
  if (g.cargo.some((c) => c.good === 'gas') || g.missions['M-GAS']?.status === 'done' || g.missions['M-GAS']?.steps[0]) return 'done';
  if (g.port === TUTORIAL_PORT) return inPort ? 'buyGas' : 'enterPort';
  if (g.dest !== TUTORIAL_PORT) return 'pickDest';
  if (!g.ready) return 'ready';
  return 'arrive';
}

/** 튜토리얼을 시작할 수 있나(PRD v0.3: 판 범위에 L1이 있을 때만, 그 구간 첫 라운드에) */
export function tutorialCanStart(cls: PublicClass, me: MeView): boolean {
  if (!cls.settings.scope.includes('L1')) return false;
  if (!cls.firedEvents.includes('L1-E6')) return false;
  if (cls.stage !== 'L1' || cls.phase !== 'round') return false;
  if (cls.stageFirstRound === null || cls.round !== cls.stageFirstRound) return false;
  return tutorialStep(me, false) !== 'done';
}

/** 튜토리얼 손가락이 가리킬 화면 요소(CSS 선택자) */
export function tutorialTarget(step: TutorialStep): string | null {
  switch (step) {
    case 'pickDest':
      return `.wm-port[data-port="${TUTORIAL_PORT}"] .wm-port-hit`;
    case 'ready':
      return '[data-testid="set-ready"]';
    case 'enterPort':
      return '[data-testid="enter-port"]';
    case 'buyGas':
      return '[data-testid="buy-card-gas"]';
    default:
      return null;
  }
}
