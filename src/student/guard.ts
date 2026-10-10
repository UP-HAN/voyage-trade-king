/**
 * 연속 클릭 가드(작업 107 [출항 준비]에서 시작 — 111 사건 응답 버튼도 같은 패턴).
 * 마지막으로 누른 뒤 guardMs가 지나야 다시 받는다(두 번 눌러 두 번 보내거나 바로 취소되는 것을 막음).
 */

/** [출항 준비]·[취소]가 바뀐 직후 이 시간 동안은 토글 버튼 클릭을 무시(두 번 눌러 취소되는 것 막기) */
export const READY_TOGGLE_GUARD_MS = 500;

/** 토글 버튼 가드(순수): 마지막 전환 뒤 guardMs가 지나야 true */
export function toggleAllowed(lastAt: number | null, now: number, guardMs = READY_TOGGLE_GUARD_MS): boolean {
  return lastAt === null || now - lastAt >= guardMs;
}
