/**
 * 학생 기기 미리 계산 어댑터 (PRD 7.4 — 낙관적 표시).
 *
 * 103의 `predict(player, classState, action)`는 `ClassState`(교사 전용 필드 포함)를 받지만,
 * 학생 기기는 방 전체에 오는 공개 상태 `{ class: PublicClass, public: PublicState }`와 내 개인 상태(`PlayerView`)만 가진다.
 * 여기서 둘을 `predict` 입력 모양으로 맞춘다.
 *
 * - 교사 전용 필드(`bannedNameKeys`, `settings.extraBannedWords`)는 빈 값으로 채운다.
 *   이 값에 기대는 행동(회사 이름 바꾸기)은 공개 정보만으로 정확히 계산할 수 없으므로 **미리 계산하지 않는다**(호스트 응답을 기다림).
 * - `predict`가 오류를 돌려주면 미리 보이지 않는다(예외 → peer-session이 그 행동을 건너뜀). 판정은 호스트가 한다.
 * - 학생 기기에서 항해 처리(`resolveRounds`)는 하지 않는다 — 호스트가 한다.
 */
import { predict } from '../core';
import type { Action, ClassState, GameEvent, Player, PlayerView, PublicClass, PublicPayload } from '../core';

/** 학생이 받는 내 개인 상태(`state.me`): PlayerView + (있으면) 호스트가 실어 보낸 연출 이벤트 */
export type MeView = PlayerView & { events?: GameEvent[] };

/**
 * 공개 정보만으로 계산할 수 없어 미리 보여 주지 않는 행동.
 * (작업 151) 자유 항해 `sailTo`도 호스트 확정을 기다린다(그동안 '보내는 중') — 도착 사건(첫 입항 카드·싱가포르 개념 카드)을
 * 호스트 결과(ack 이벤트)로 받아야 사건 층이 한 번만 정확히 띄운다(brief 위험 표: 학생 예측과 호스트 결과 어긋남)
 */
export const HOST_ONLY_ACTIONS: ReadonlySet<Action['type']> = new Set<Action['type']>(['setCompanyName', 'sailTo']);

export class NoPredictError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/** PublicClass → predict용 ClassState(교사 전용 필드는 빈 값) */
export function classForPredict(pub: PublicClass): ClassState {
  return {
    ...pub,
    bannedNameKeys: [],
    settings: { ...pub.settings, extraBannedWords: [] },
  };
}

/** PlayerView → predict용 Player(기기 토큰은 학생 기기에 없으므로 빈 값) */
export function playerForPredict(me: MeView): Player {
  const { events: _e, ...rest } = me;
  void _e;
  return { ...rest, deviceToken: '' } as Player;
}

/** 미리 계산 결과(오류면 code) — 화면이 버튼을 막거나 이유를 보여 줄 때도 쓴다 */
export function tryPredict(
  me: MeView | null,
  pub: PublicPayload | null,
  action: Action,
): { ok: true; me: MeView; events: GameEvent[] } | { ok: false; code: string } {
  if (!me) return { ok: false, code: 'NO_ME' };
  if (!pub || !pub.class) return { ok: false, code: 'NO_PUBLIC' };
  if (HOST_ONLY_ACTIONS.has(action.type)) return { ok: false, code: 'HOST_ONLY' };
  const r = predict(playerForPredict(me), classForPredict(pub.class), action);
  if (r.error) return { ok: false, code: r.error };
  const { deviceToken: _t, ...view } = r.player;
  void _t;
  return { ok: true, me: view, events: r.events };
}

/** peer-session에 주입하는 predict: 계산할 수 없으면 예외(그 행동은 미리 보이지 않고 호스트 결과를 기다림) */
export function studentPredict(me: MeView, pub: PublicPayload | null, action: Action): MeView {
  const r = tryPredict(me, pub, action);
  if (!r.ok) throw new NoPredictError(r.code);
  return r.me;
}
