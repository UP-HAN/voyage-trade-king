/**
 * (작업 160b, PRD 6.7.6 끝 문단) 막힌 학생에게 가는 갈매기 힌트 — 호스트 판정(순수 함수, Date·Math.random 없음).
 *
 * - 힌트 시계(학급 하나, `snapshot.stuck.clock`): 사고팔 수 있는 때(`canTrade` + 무역 시작 뒤 + 무역 끝 전)만 센다.
 *   [잠깐 멈춤]·차단형 사건·학습지 팝업·무역 시작 전·교사 화면 끊김(틱 사이 최대 `maxStepMs`)은 빠진다.
 *   무역 시계(`class.clock`)와 따로 센다(무역 시계의 뜻이 바뀌어도 영향 없음).
 * - 학생 × 임무마다 상황 키(`situationOf`) — 키가 바뀌면(= 진척) 그때부터 다시 센다.
 * - 같은 힌트 ID 는 한 학생에게 두 번 가지 않는다. 상황당 표의 힌트 수(≤ 2), 임무당 `perMission`, 한 틱에 학생당 1개.
 * - 감시 상태는 호스트 전용(`HostSnapshot.stuck`) — 공개 상태에 실리지 않아 매초 공개 출력이 생기지 않는다.
 *   힌트를 보낸 학생만 새 Player(rev + 1) → 그 학생에게만 'me'·'events'.
 */
import { recipesById } from '../data/recipes';
import { BATTERY_PARTS, IPE_HINT_RECIPES, stuckHintRules, stuckHintText } from '../data/stuckHints';
import type { GoodId } from '../data/types';
import { canTrade, clone, LESSON_ORDER } from './state';
import type { ClassState, GameEvent, HostSnapshot, Player, StuckState, StuckWatch } from './types';

export interface StuckSituation {
  key: string;
  /** 이 상황에서 보낼 힌트 ID(차례) */
  hints: string[];
}

/** 배에 실린 상품 상자 수(출처 무관) */
function cargoCount(p: Player): Partial<Record<GoodId, number>> {
  const out: Partial<Record<GoodId, number>> = {};
  for (const l of p.game.cargo) out[l.good] = (out[l.good] ?? 0) + l.qty;
  return out;
}

/** 지금 열린(이 구간까지 공개되고 조건 없는) 힌트 레시피 */
function openRecipes(cs: ClassState): GoodId[] {
  return IPE_HINT_RECIPES.filter((id) => {
    const r = recipesById[id];
    return !!r && !r.requires && LESSON_ORDER[r.unlockLesson] <= LESSON_ORDER[cs.stage];
  });
}

/**
 * 학생의 지금 상황(상황 키 + 보낼 힌트). 감시하지 않을 때(임무 없음·끝남·공장 없음·모르는 임무) null.
 * 위에서부터 첫 번째로 맞는 것(160b brief ②): make → parts → buy / export → again.
 */
export function situationOf(cs: ClassState, p: Player, missionId: string): StuckSituation | null {
  if (missionId !== 'M-IPE') return null;
  if (!cs.features.includes('factory')) return null;
  const m = p.game.missions[missionId];
  if (!m || m.status !== 'active') return null;
  const cargo = cargoCount(p);
  if (!m.steps[1]) {
    for (const id of openRecipes(cs)) {
      const inputs = recipesById[id]!.inputs;
      const ok = Object.entries(inputs).every(([g, n]) => (cargo[g as GoodId] ?? 0) >= (n ?? 0));
      if (ok) return { key: `make:${id}`, hints: [`IPE-MAKE-1:${id}`, `IPE-MAKE-2:${id}`] };
    }
    if (openRecipes(cs).includes('battery')) {
      const have = BATTERY_PARTS.filter((g) => (cargo[g] ?? 0) > 0);
      if (have.length > 0 && have.length < BATTERY_PARTS.length) {
        const missing = BATTERY_PARTS.filter((g) => !have.includes(g)).join('+');
        return { key: `parts:${missing}`, hints: [`IPE-PARTS-1:${missing}`] };
      }
    }
    return { key: 'buy', hints: ['IPE-BUY-1', 'IPE-BUY-2'] };
  }
  if (!m.steps[2]) {
    const lot = p.game.cargo.find((l) => l.source === 'factory' && l.qty > 0 && (IPE_HINT_RECIPES as readonly string[]).includes(l.good));
    if (lot) return { key: `export:${lot.good}`, hints: [`IPE-EXPORT-1:${lot.good}`, `IPE-EXPORT-2:${lot.good}`] };
    return { key: 'again', hints: ['IPE-AGAIN-1'] };
  }
  return null;
}

/** 힌트 시계가 도는 때 */
export function stuckClockRuns(cs: ClassState): boolean {
  return canTrade(cs) && cs.clock.startedAt !== null && !cs.tradeEnded;
}

const EMPTY: StuckState = { clock: { sec: 0, lastAt: null }, watch: {} };

/**
 * 시계 틱마다(host.ts `case 'tick'`, 무역 훅 다음). 바뀐 것이 없으면 **같은 스냅숏 객체**를 돌려준다.
 */
export function stepStuckHints(snap: HostSnapshot, now: number): { snapshot: HostSnapshot; events: Record<string, GameEvent[]> } {
  const events: Record<string, GameEvent[]> = {};
  if (!stuckHintRules.enabled) return { snapshot: snap, events };
  const cs = snap.class;
  const prev = snap.stuck ?? EMPTY;
  const runs = stuckClockRuns(cs);
  if (!runs) {
    // 멈춤: 다음에 다시 돌 때 그동안의 시간을 더하지 않게 lastAt 만 지운다
    if (prev.clock.lastAt === null) return { snapshot: snap, events };
    return { snapshot: { ...snap, stuck: { ...prev, clock: { sec: prev.clock.sec, lastAt: null } } }, events };
  }
  const step = prev.clock.lastAt === null ? 0 : Math.min(Math.max(0, now - prev.clock.lastAt), stuckHintRules.maxStepMs) / 1000;
  const sec = prev.clock.sec + step;

  let watch = prev.watch;
  let watchChanged = false;
  let players = snap.players;
  const setWatch = (seatK: string, mid: string, w: StuckWatch | null) => {
    const cur = watch[seatK]?.[mid];
    if (w === null && cur === undefined) return;
    if (w !== null && cur && cur.key === w.key && cur.since === w.since && cur.lastHintAt === w.lastHintAt && cur.sent === w.sent) return;
    if (!watchChanged) {
      watch = { ...watch };
      watchChanged = true;
    }
    const per = { ...(watch[seatK] ?? {}) };
    if (w === null) delete per[mid];
    else per[mid] = w;
    if (Object.keys(per).length) watch[seatK] = per;
    else delete watch[seatK];
  };

  // 좌석 번호 순(결정성)
  const keys = Object.keys(snap.players).sort((a, b) => snap.players[a]!.seat - snap.players[b]!.seat);
  for (const k of keys) {
    const p = snap.players[k]!;
    // 오프라인 학생은 건너뛴다(감시 상태도 그대로 — 돌아오면 그 틱에 받을 수 있음)
    if (!p.online) continue;
    let sentThisTick = false;
    for (const mid of stuckHintRules.missions) {
      const sit = p.company.founded ? situationOf(cs, p, mid) : null;
      if (!sit) {
        setWatch(k, mid, null);
        continue;
      }
      const cur = watch[k]?.[mid];
      let w: StuckWatch = cur && cur.key === sit.key ? cur : { key: sit.key, since: sec, lastHintAt: null, sent: 0 };
      if (!sentThisTick) {
        const got = new Set((p.game.gullHints ?? []).map((h) => h.id));
        const forMission = (p.game.gullHints ?? []).filter((h) => h.mission === mid).length;
        const next = sit.hints.find((id) => !got.has(id) && stuckHintText(id) !== null);
        const due = w.sent === 0 ? sec - w.since >= stuckHintRules.firstSec : sec - (w.lastHintAt ?? w.since) >= stuckHintRules.nextSec;
        if (next && due && forMission < stuckHintRules.perMission) {
          const np = clone(p);
          np.game.gullHints = [...(np.game.gullHints ?? []), { id: next, mission: mid, at: sec }];
          np.rev = p.rev + 1;
          if (players === snap.players) players = { ...players };
          players[k] = np;
          (events[k] ??= []).push({ type: 'gullHint', id: next, mission: mid });
          w = { ...w, sent: w.sent + 1, lastHintAt: sec };
          sentThisTick = true;
        }
      }
      setWatch(k, mid, w);
    }
  }

  const stuck: StuckState = { clock: { sec, lastAt: now }, watch };
  return { snapshot: { ...snap, stuck, ...(players !== snap.players ? { players } : {}) }, events };
}
