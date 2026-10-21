/**
 * 라운드 처리·항해 (PRD 4.3.7, 6.8, 7.3) — 작업 103.
 *
 * `resolveRounds(classState, player)`: `player.game.resolvedRound`보다 뒤에 끝난 라운드를 차례로 처리한다.
 * - 목적지가 있고 [출항 준비]면 운항비를 내고 이동(순풍이면 0원), 아니면 머무름.
 * - 입항하면 그 항구의 입항 한도를 새로 시작, 방문 기록(개척), 첫 입항이면 항구 카드·도감.
 * - 막힌 항구(효과 portClosed — 작업 125)는 갈 수 없어 머무름.
 * - 멱등: 같은 상태로 두 번 불러도 결과가 같다(이미 처리한 라운드는 건너뜀).
 * 호스트가 라운드가 끝날 때 접속 여부와 상관없이 **모든 학생**에게 부른다.
 */
import { eventsById } from '../data/events';
import { lessonPartRulesOf } from '../data/lessonParts';
import { portsById } from '../data/ports';
import type { PortId } from '../data/types';
import { applyFiredEventToPlayer } from './activities';
import { isPortClosed, voyageCostFor } from './market';
import { grantDex } from './progress';
import { canTakeLoan, takeLoan } from './rules';
import { clone, completedRound, LESSON_ORDER } from './state';
import type { ClassState, GameEvent, Player } from './types';

/** 항구 카드를 이만큼 보면 '나라마다 다른 까닭' 카드(dex.ts unlock 문구) */
const TRADE_REASONS_PORTS = 3;

/** 입항 처리(라운드 항해·자유 항해 `sailTo` 공용, 작업 151에서 내보냄) */
export function arrive(cs: ClassState, p: Player, port: PortId, round: number, events: GameEvent[]): void {
  const first = !p.game.metrics.visited.includes(port);
  p.game.port = port;
  p.game.visit = { arrival: p.game.visit.arrival + 1, sold: {}, bought: {} };
  events.push({ type: 'arrived', port, round, first });
  if (!first) return;
  p.game.metrics.visited.push(port);
  events.push({ type: 'portCard', port });
  grantDex(p, `port:${port}`, events);
  if (portsById[port].isWorldPort) grantDex(p, 'world-ports', events);
  if (p.game.metrics.visited.filter((x) => x !== 'BUS').length >= TRADE_REASONS_PORTS) grantDex(p, 'trade-reasons', events);
  // 첫 입항 사건(L2-E5 싱가포르 등): 그 구간이 열렸고 범위 안이면
  const drop = lessonPartRulesOf(cs.settings)?.dropEvents;
  for (const def of Object.values(eventsById)) {
    if (def.trigger.type !== 'firstArrival' || def.trigger.port !== port) continue;
    if (LESSON_ORDER[def.lesson] > LESSON_ORDER[cs.stage] || !cs.settings.scope.includes(def.lesson)) continue;
    if (p.game.responses[def.id] !== undefined) continue;
    // (작업 154) 2차시 앞 시간 판은 싱가포르의 비밀(L2-E5)을 띄우지 않고 효과(도감 relay·임무 M-RELAY)도 주지 않는다
    if (drop?.includes(def.id)) continue;
    events.push({ type: 'eventTriggered', id: def.id });
    applyFiredEventToPlayer(cs, p, def, events);
    for (const e of def.effects) if (e.type === 'dexCard') grantDex(p, e.card, events);
    p.game.responses[def.id] = true;
  }
}

/**
 * (작업 151) 자유 항해 운항비 정산: money −= fareDue. 모자라면 모자란 만큼 대출로(긴급 대출과 같은 처리, PRD 6.8).
 * 사건 fareSettled(0원이어도), fareDue·sailsThisRound 를 0으로.
 */
function settleFare(cs: ClassState, p: Player, round: number, events: GameEvent[]): void {
  const g = p.game;
  const amount = Math.max(0, g.fareDue ?? 0);
  g.money -= amount;
  if (g.money < 0) {
    const short = -g.money;
    g.loan += short;
    g.money = 0;
    events.push({ type: 'loan', amount: short });
    g.log.push({ round, stage: cs.stage, kind: 'loan', amount: short, ref: 'fare' });
  }
  events.push({ type: 'fareSettled', amount, round });
  g.fareDue = 0;
  g.sailsThisRound = 0;
}

/** 놓친 라운드까지 모두 처리(순수·멱등) */
export function resolveRounds(cs: ClassState, player: Player): { player: Player; events: GameEvent[] } {
  const upTo = completedRound(cs);
  // (작업 153 추가) 자유 항해는 라운드 사이에도 항해하므로, 무역이 끝날 때 남은 낼 운항비를 한 번 더 정산한다
  const settleAtEnd = cs.settings?.voyageMode === 'free' && cs.tradeEnded && (player.game.fareDue ?? 0) > 0;
  if (player.game.resolvedRound >= upTo && !settleAtEnd) return { player, events: [] };
  const p = clone(player);
  const events: GameEvent[] = [];
  const freeMode = cs.settings?.voyageMode === 'free';
  for (let r = p.game.resolvedRound + 1; r <= upTo; r++) {
    const g = p.game;
    if (freeMode) {
      // (작업 151, PRD 4.3.7.1) 자유 항해: 배는 이미 라운드 중에 옮겼다 → 라운드 끝에 낼 운항비를 한꺼번에 정산
      settleFare(cs, p, r, events);
      g.dest = null;
      g.ready = false;
      g.resolvedRound = r;
      continue;
    }
    const dest = g.dest;
    if (!dest) {
      events.push({ type: 'stayed', port: g.port, round: r, reason: 'noDestination' });
    } else if (!g.ready) {
      events.push({ type: 'stayed', port: g.port, round: r, reason: 'notReady' });
    } else if (isPortClosed(cs, dest) || !cs.openPorts.includes(dest)) {
      events.push({ type: 'stayed', port: g.port, round: r, reason: 'portClosed' });
    } else {
      const free = g.effects.tailwind > 0;
      const cost = free ? 0 : voyageCostFor(cs, p, g.port, dest);
      if (cost > g.money) {
        events.push({ type: 'stayed', port: g.port, round: r, reason: 'noMoney' });
      } else {
        const from = g.port;
        g.money -= cost;
        if (free) g.effects.tailwind -= 1;
        events.push({ type: 'departed', from, to: dest, cost, free, round: r });
        g.log.push({ round: r, stage: cs.stage, kind: 'voyage', port: from, to: dest, amount: cost });
        arrive(cs, p, dest, r, events);
      }
    }
    // 출항(또는 머무름) 뒤 목적지·준비는 새 라운드에서 다시 고른다
    g.dest = null;
    g.ready = false;
    g.resolvedRound = r;
  }
  if (freeMode && cs.tradeEnded && (p.game.fareDue ?? 0) > 0) settleFare(cs, p, upTo, events);
  // 자금 0·화물 0 → 긴급 대출(탈락 없음, PRD 6.8)
  if (canTakeLoan(cs, p)) takeLoan(cs, p, events);
  p.rev = player.rev + 1;
  return { player: p, events };
}
