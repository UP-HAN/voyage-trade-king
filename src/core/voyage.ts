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

function arrive(cs: ClassState, p: Player, port: PortId, round: number, events: GameEvent[]): void {
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
  for (const def of Object.values(eventsById)) {
    if (def.trigger.type !== 'firstArrival' || def.trigger.port !== port) continue;
    if (LESSON_ORDER[def.lesson] > LESSON_ORDER[cs.stage] || !cs.settings.scope.includes(def.lesson)) continue;
    if (p.game.responses[def.id] !== undefined) continue;
    events.push({ type: 'eventTriggered', id: def.id });
    applyFiredEventToPlayer(cs, p, def, events);
    for (const e of def.effects) if (e.type === 'dexCard') grantDex(p, e.card, events);
    p.game.responses[def.id] = true;
  }
}

/** 놓친 라운드까지 모두 처리(순수·멱등) */
export function resolveRounds(cs: ClassState, player: Player): { player: Player; events: GameEvent[] } {
  const upTo = completedRound(cs);
  if (player.game.resolvedRound >= upTo) return { player, events: [] };
  const p = clone(player);
  const events: GameEvent[] = [];
  for (let r = p.game.resolvedRound + 1; r <= upTo; r++) {
    const g = p.game;
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
  // 자금 0·화물 0 → 긴급 대출(탈락 없음, PRD 6.8)
  if (canTakeLoan(cs, p)) takeLoan(cs, p, events);
  p.rev = player.rev + 1;
  return { player: p, events };
}
