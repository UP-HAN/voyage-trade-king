/**
 * (작업 176) 봇 성향 3종 — 학생 저장소 상태(public·me)만 본다(호스트 상태를 엿보지 않음).
 * - '한 가지 반복'(grind): 처음 고른 가장 이익인 길 하나만 끝까지(폭풍이 와도 바꾸지 않음).
 * - '다양한 거래'(diverse): 최근 3번과 다른 길·직전과 다른 상품, 아직 거래하지 않은 항구·상품을 조금 더 쳐 줌.
 * - '정상 임무'(mission): 1차시 천연가스(M-GAS)·2차시 수입→생산→수출(M-IPE)을 먼저 끝내고, 그 뒤는 기본 봇(botAction).
 * 두 거래 봇은 매초 행동 하나, 자유 항해 라운드당 항해 TRADER_SAILS번까지(같은 조건).
 */
import {
  AVATAR_IDS, canTrade, FLAG_COLOR_IDS, FLAG_EMBLEM_IDS, isPortClosed, portPrice, quote, tariffForLot, visibleGoods, voyageCostFor,
  type Action, type PublicPayload,
} from '../../src/core';
import { byeokrandoItems } from '../../src/data/byeokrando';
import { checkQuiz } from '../../src/data/checkQuiz';
import { eventsById } from '../../src/data/events';
import { goodsById } from '../../src/data/goods';
import type { GoodId, PortId } from '../../src/data/types';
import { classForPredict, playerForPredict, type MeView } from '../../src/student/predict';
import { botAction, type BotStudent } from './bot';

const TRADER_SAILS = 4;

export type TraderMode = 'grind' | 'diverse';
export interface TraderMemory {
  plan: { buyAt: PortId; good: GoodId; sellAt: PortId } | null;
  used: string[];
}
export const newTraderMemory = (): TraderMemory => ({ plan: null, used: [] });

/** 학습지·사건·회사 만들기(정해진 답 — 세 봇이 같은 조건이 되게). 할 일이 없으면 undefined */
function chores(s: BotStudent): Action | null | undefined {
  const st = s.store.getState();
  const me = st.peer.me;
  const pub = st.peer.public as PublicPayload | null;
  if (st.peer.status !== 'in' || !me || !pub) return null;
  if (st.peer.pendingCount > 0) return null;
  const cls = pub.class;
  if (!me.company.founded) return { type: 'foundCompany', color: FLAG_COLOR_IDS[0]!, emblem: FLAG_EMBLEM_IDS[0]!, avatar: AVATAR_IDS[0]! };
  if (cls.paused) return null;
  const wsCur = cls.worksheet.current;
  const wsDone = cls.worksheet.during ? (me.game.duringDone ?? []) : me.game.worksheetDone;
  if (wsCur && wsCur.some((w) => !wsDone.includes(w))) return { type: 'markWorksheetDone' };
  const ev = cls.currentEvent;
  if (ev && !ev.closed && me.game.responses[ev.id] === undefined) {
    const def = eventsById[ev.id];
    if (def?.needsResponse) {
      if (ev.id === 'L1-E1') return { type: 'respondEvent', eventId: ev.id, response: { answers: Object.fromEntries(byeokrandoItems.map((i) => [i.id, i.answer])) } };
      if (ev.id === 'L1-E5') return { type: 'respondEvent', eventId: ev.id, response: { example: true } };
      if (def.kind === 'checkQuiz') {
        const q = checkQuiz.find((x) => x.lesson === def.lesson && !me.game.checkQuiz[x.id]);
        return q ? { type: 'answerCheckQuiz', qid: q.id, answer: q.answer } : null;
      }
      if (def.options?.length) return { type: 'respondEvent', eventId: ev.id, response: { choice: def.options[0]!.id } };
    }
  }
  return undefined;
}

interface TradeCtx {
  me: MeView;
  c: ReturnType<typeof classForPredict>;
  p: ReturnType<typeof playerForPredict>;
  spend: number;
  free: boolean;
}

function tradeCtx(s: BotStudent): TradeCtx | null {
  const st = s.store.getState();
  const me = st.peer.me;
  const pub = st.peer.public as PublicPayload | null;
  if (st.peer.status !== 'in' || !me || !pub || st.peer.pendingCount > 0) return null;
  const c = classForPredict(pub.class);
  if (!canTrade(c)) return null;
  const free = pub.class.settings.voyageMode === 'free';
  if (!free && me.game.ready) return null;
  return { me, c, p: playerForPredict(me), spend: me.game.money - (me.game.fareDue ?? 0), free };
}

const cargoOf = (t: TradeCtx, g: GoodId, port: PortId) =>
  t.me.game.cargo.filter((x) => x.good === g && (x.boughtAt !== port || x.source === 'factory')).reduce((n, x) => n + x.qty, 0);

/** 이 항구에서 팔 수 있는 화물(시세가 있으면) */
function sellHere(t: TradeCtx, only?: GoodId): Action | null {
  const port = t.me.game.port;
  for (const l of t.me.game.cargo) {
    if (only && l.good !== only) continue;
    const have = cargoOf(t, l.good, port);
    if (have <= 0) continue;
    const q = quote(t.c, t.p, port, l.good);
    if (!q.visible || q.sell === null) continue;
    return { type: 'sell', good: l.good, qty: have };
  }
  return null;
}

function sailOrNull(t: TradeCtx, to: PortId): Action | null {
  if (t.me.game.port === to) return null;
  if (isPortClosed(t.c, to) || !t.c.openPorts.includes(to)) return null;
  if (!t.free) return t.me.game.dest === to ? { type: 'setReady' } : { type: 'setDestination', port: to };
  if ((t.me.game.sailsThisRound ?? 0) >= TRADER_SAILS) return null;
  return { type: 'sailTo', port: to };
}

type Cand = { buyAt: PortId; good: GoodId; sellAt: PortId; profit: number };

/** 길 후보(이익 어림 큰 순): (판 값 − 관세 − 산 값) × 상자 − 운항비 */
function routeCandidates(t: TradeCtx, from: PortId, fullHold = false): Cand[] {
  const out: Cand[] = [];
  const goods = visibleGoods(t.c).filter((g) => goodsById[g]?.form !== 'service');
  for (const good of goods) {
    for (const buyAt of t.c.openPorts) {
      const b = portPrice(t.c, buyAt, good);
      if (!b.visible || b.buy === null) continue;
      // fullHold: 돈과 상관없이 배를 가득 채운다고 보고 고른다('가장 이익인 길')
      const qty = fullHold ? 20 : Math.max(0, Math.min(20, Math.floor(Math.max(0, t.spend) / b.buy)));
      if (qty <= 0) continue;
      for (const sellAt of t.c.openPorts) {
        if (sellAt === buyAt) continue;
        const sp = portPrice(t.c, sellAt, good);
        if (!sp.visible || sp.sell === null) continue;
        const origin = b.tag === 'domestic' || (b.tag === 'S' && buyAt === 'BUS') ? 'korea' : 'foreign';
        const rate = tariffForLot(t.c, sellAt, good, origin);
        const travel = voyageCostFor(t.c, t.p, buyAt, sellAt) + (from === buyAt ? 0 : voyageCostFor(t.c, t.p, from, buyAt));
        const profit = (sp.sell * (1 - rate) - b.buy) * qty - travel;
        if (profit > 0) out.push({ buyAt, good, sellAt, profit });
      }
    }
  }
  return out.sort((a, b) => b.profit - a.profit);
}

/** '한 가지 반복'·'다양한 거래' 봇 행동 하나 */
export function traderAction(s: BotStudent, mem: TraderMemory, mode: TraderMode): Action | null {
  const ch = chores(s);
  if (ch !== undefined) return ch;
  const t = tradeCtx(s);
  if (!t) return null;
  const port = t.me.game.port;
  const plan = mem.plan;
  // ① 실은 화물: 계획한 판매 항구면 판다. 계획 밖 화물(처음 화물 등)은 팔 수 있는 곳에서 판다
  if (t.me.game.cargo.length) {
    const planned = plan && t.me.game.cargo.some((l) => l.good === plan.good) ? plan : null;
    if (planned) {
      if (planned.sellAt !== port) return sailOrNull(t, planned.sellAt);
      const a = sellHere(t, planned.good);
      if (a) {
        mem.used.push(`${planned.buyAt}>${planned.good}>${planned.sellAt}`);
        if (mode === 'diverse') mem.plan = null;
        return a;
      }
      return null;
    }
    const a = sellHere(t);
    if (a) return a;
    const l = t.me.game.cargo[0]!;
    const to = t.c.openPorts.find((x) => x !== port && (x !== l.boughtAt || l.source === 'factory') && portPrice(t.c, x, l.good).sell !== null);
    return to ? sailOrNull(t, to) : null;
  }
  // ② 빈 배: 계획 정하기
  if (!mem.plan) {
    const cands = routeCandidates(t, port, mode === 'grind');
    if (mode === 'grind') mem.plan = cands[0] ?? null;
    else {
      const recent = mem.used.slice(-3);
      const lastGood = mem.used.length ? mem.used[mem.used.length - 1]!.split('>')[1] : null;
      const ft = t.me.game.fairTrade;
      const score = (r: Cand) => r.profit + (ft && r.sellAt !== 'BUS' && !ft.ports.includes(r.sellAt) ? 15 : 0) + (ft && !ft.goods.includes(r.good) ? 15 : 0);
      const ok = cands.filter((r) => !recent.includes(`${r.buyAt}>${r.good}>${r.sellAt}`) && r.good !== lastGood).sort((a, b) => score(b) - score(a));
      mem.plan = ok[0] ?? cands[0] ?? null;
    }
    if (!mem.plan) return null;
  }
  const pl = mem.plan;
  if (port !== pl.buyAt) return sailOrNull(t, pl.buyAt);
  const q = quote(t.c, t.p, port, pl.good);
  const room = 20 - t.me.game.cargo.reduce((n, l) => n + l.qty, 0);
  const qty = q.buy === null ? 0 : Math.min(q.buyLeft, room, Math.floor(Math.max(0, t.spend) / q.buy));
  if (qty <= 0) {
    if (mode === 'diverse') mem.plan = null;
    return null;
  }
  return { type: 'buy', good: pl.good, qty };
}

/**
 * '정상 임무' 봇: 1차시 천연가스(포트헤들랜드 → 부산), 2차시 수입→생산→수출(원유 → 부산 공장 석유 제품 → 호찌민)을
 * 먼저 하고, 임무가 없거나 끝나면 기본 봇(botAction)과 같다.
 */
export function missionAction(s: BotStudent, rand: () => number): Action | null {
  const ch = chores(s);
  if (ch !== undefined) return ch;
  const t = tradeCtx(s);
  if (!t) return botAction(s, rand);
  const ms = t.me.game.missions;
  const port = t.me.game.port;
  const has = (g: GoodId) => t.me.game.cargo.filter((l) => l.good === g).reduce((n, l) => n + l.qty, 0);
  if (ms['M-GAS']?.status === 'active') {
    if (has('gas') > 0) return port === 'BUS' ? { type: 'sell', good: 'gas', qty: has('gas') } : sailOrNull(t, 'BUS');
    if (port !== 'PHE') return sailOrNull(t, 'PHE');
    const q = quote(t.c, t.p, 'PHE', 'gas');
    return q.buy !== null && q.buy * 3 <= t.spend ? { type: 'buy', good: 'gas', qty: 3 } : botAction(s, rand);
  }
  if (ms['M-IPE']?.status === 'active') {
    if (has('oilp') > 0) return port === 'HCM' ? { type: 'sell', good: 'oilp', qty: has('oilp') } : sailOrNull(t, 'HCM');
    if (has('crude') > 0) {
      if (port !== 'BUS') return sailOrNull(t, 'BUS');
      if (!t.c.features.includes('factory')) return null;
      return { type: 'produce', recipe: 'oilp', qty: has('crude') };
    }
    if (port !== 'DAM') return sailOrNull(t, 'DAM');
    const q = quote(t.c, t.p, 'DAM', 'crude');
    return q.buy !== null && q.buy * 3 <= t.spend ? { type: 'buy', good: 'crude', qty: 3 } : botAction(s, rand);
  }
  return botAction(s, rand);
}
