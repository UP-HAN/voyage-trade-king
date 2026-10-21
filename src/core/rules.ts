/**
 * 학생 행동 규칙 (PRD 5.1, 6.1, 6.4~6.9) — 작업 103.
 *
 * `applyAction(classState, player, action, ctx?) → { player, events, error? }` — 순수 함수.
 * 호스트 리듀서와 학생 기기의 미리 계산(`predict`)이 같은 함수를 쓴다. 넘겨받은 player 는 고치지 않는다.
 * 오류면 원래 player 를 그대로 돌려주고 `error`에 코드(영문 대문자)를 담는다.
 */
import { goodsById } from '../data/goods';
import { recipesById } from '../data/recipes';
import { serviceRules } from '../data/goods';
import { emergencyLoan, shipsById } from '../data/ships';
import { worksheetById } from '../data/worksheet';
import type { GoodId, PortId, WorksheetId } from '../data/types';
import { answerCheckQuiz, respondToEvent } from './activities';
import { AVATAR_IDS, basicNameValidator, FLAG_COLOR_IDS, FLAG_EMBLEM_IDS, type NameValidator } from './company';
import { applyLetterAnswer } from './letters';
import { isPortClosed, quote, tariffForLot, voyageCostFor } from './market';
import { grantDex, isForeignRaw, onBuy, onProduce, onSell } from './progress';
import { canTrade, clone, fareDueOf, isFreeVoyage, isTrading, LESSON_ORDER, sailsThisRoundOf, spendable } from './state';
import { arrive } from './voyage';
import type { Action, ActionResult, CargoLot, ClassState, GameEvent, Player, StampKind } from './types';

/** 호스트가 넣어 주는 추가 정보(학생 기기의 미리 계산에서는 없어도 됨) */
export interface ActionContext {
  /** 회사 이름 검사(작업 124 `validateCompanyName` 주입). 없으면 기본 검사 */
  validateName?: NameValidator;
  /** 다른 회사가 쓰는 이름 비교 키(호스트만 앎) */
  takenKeys?: readonly string[];
}

// (작업 153 추가, 교사 결정 2026-10-21) 자유 항해 라운드당 항해 상한(옛 FREE_SAILS_PER_ROUND = 3)은 없앴다 — 횟수 제한 없음.
// sailsThisRound 는 '이번 라운드 항해 n번' 표시용으로만 센다.

// (작업 151) 자유 항해 도우미는 순환 import 를 피하려고 state.ts 에 두고 여기서 다시 내보낸다
export { fareDueOf, isFreeVoyage, sailsThisRoundOf, spendable };

const fail = (player: Player, error: string): ActionResult => ({ player, events: [], error });

const isPosInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0;

/** 배에 실은 상자 수(서비스 계약 제외) */
export function cargoUsed(p: Player): number {
  return p.game.cargo.reduce((s, l) => s + l.qty, 0);
}

export function cargoCapacity(p: Player): number {
  return shipsById[p.game.ship].capacity;
}

/** 묶음 넣기(같은 상품·값·출처면 합침) */
function addLot(list: CargoLot[], lot: CargoLot): void {
  const same = list.find(
    (l) => l.good === lot.good && l.unitCost === lot.unitCost && l.origin === lot.origin && l.source === lot.source && l.boughtAt === lot.boughtAt,
  );
  if (same) same.qty += lot.qty;
  else list.push(lot);
}

/** 이 라운드 서비스 계약 수 칸(라운드가 바뀌었으면 새로) */
function roundContracts(cs: ClassState, p: Player) {
  if (p.game.roundContracts.round !== cs.round) p.game.roundContracts = { round: cs.round, buy: {}, sell: {} };
  return p.game.roundContracts;
}

/** 도장 분류(PRD 6.5.3) */
export function stampFor(origin: CargoLot['origin'], source: CargoLot['source'], port: PortId): StampKind {
  if (origin === 'korea') return port === 'BUS' ? 'domestic' : 'export';
  void source;
  return port === 'BUS' ? 'import' : 'relay';
}

/** 긴급 대출 조건(PRD 6.8): 화물·계약이 없고, 가진 돈으로 열린 어느 항구에도 갈 수 없음 */
export function canTakeLoan(cs: ClassState, p: Player): boolean {
  if (p.game.cargo.length || p.game.contracts.length) return false;
  if (p.game.effects.tailwind > 0) return false;
  const costs = cs.openPorts.filter((x) => x !== p.game.port).map((to) => voyageCostFor(cs, p, p.game.port, to));
  const cheapest = costs.length ? Math.min(...costs) : 0;
  return p.game.money <= 0 || p.game.money < cheapest;
}

export function takeLoan(cs: ClassState, p: Player, events: GameEvent[]): void {
  p.game.money += emergencyLoan.amount;
  p.game.loan += emergencyLoan.amount;
  events.push({ type: 'loan', amount: emergencyLoan.amount });
  p.game.log.push({ round: cs.round, stage: cs.stage, kind: 'loan', amount: emergencyLoan.amount });
}

function buy(cs: ClassState, p: Player, good: GoodId, qty: number, events: GameEvent[]): string | null {
  if (!canTrade(cs)) return 'NOT_TRADING';
  if (!isPosInt(qty)) return 'BAD_QTY';
  const port = p.game.port;
  const q = quote(cs, p, port, good);
  if (!q.visible) return 'NOT_SOLD_HERE';
  if (q.buy === null) return 'CANNOT_BUY';
  if (qty > q.buyLeft) return 'BUY_LIMIT';
  const service = goodsById[good].form === 'service';
  if (service) {
    const rc = roundContracts(cs, p);
    if ((rc.buy[good] ?? 0) + qty > serviceRules.maxContractsPerRound) return 'CONTRACT_LIMIT';
  } else if (cargoUsed(p) + qty > cargoCapacity(p)) return 'NO_SPACE';
  const cost = q.buy * qty;
  if (cost > spendable(cs, p)) return 'NO_MONEY';

  const korea = q.tag === 'domestic' || (q.tag === 'S' && port === 'BUS');
  const lot: CargoLot = {
    good,
    qty,
    unitCost: q.buy,
    origin: korea ? 'korea' : 'foreign',
    source: q.tag === 'R' ? 'relay' : q.tag === 'domestic' ? 'domestic' : 'specialty',
    boughtAt: port,
  };
  p.game.money -= cost;
  addLot(service ? p.game.contracts : p.game.cargo, lot);
  p.game.visit.bought[good] = (p.game.visit.bought[good] ?? 0) + qty;
  if (service) {
    const rc = roundContracts(cs, p);
    rc.buy[good] = (rc.buy[good] ?? 0) + qty;
    grantDex(p, 'goods-services', events);
  }
  events.push({ type: 'bought', good, qty, amount: cost });
  grantDex(p, `good:${good}`, events);
  onBuy(p, good, port, events);
  p.game.log.push({ round: cs.round, stage: cs.stage, kind: 'buy', good, qty, port, amount: cost });
  return null;
}

function sell(cs: ClassState, p: Player, good: GoodId, qty: number, events: GameEvent[]): string | null {
  if (!canTrade(cs)) return 'NOT_TRADING';
  if (!isPosInt(qty)) return 'BAD_QTY';
  const port = p.game.port;
  const q = quote(cs, p, port, good);
  if (!q.visible) return 'NOT_SOLD_HERE';
  if (q.sell === null || q.overLimitSell === null) return 'CANNOT_SELL';
  const service = goodsById[good].form === 'service';
  const list = service ? p.game.contracts : p.game.cargo;
  // 산 항구에서는 되팔 수 없다(서비스 규칙 PRD 6.4.2, 물자도 같은 항구 되팔기 금지 — result.md 가정).
  // 공장 생산품은 산 것이 아니므로 부산 국내 판매 가능
  const lots = list.filter((l) => l.good === good && (l.boughtAt !== port || l.source === 'factory'));
  const have = lots.reduce((s, l) => s + l.qty, 0);
  if (have < qty) return list.some((l) => l.good === good) ? 'SAME_PORT' : 'NO_CARGO';
  if (service) {
    const rc = roundContracts(cs, p);
    if ((rc.sell[good] ?? 0) + qty > serviceRules.maxContractsPerRound) return 'CONTRACT_LIMIT';
  }

  let fullLeft = q.sellFullLeft;
  let left = qty;
  let totalAmount = 0;
  let totalCost = 0;
  let totalTariff = 0;
  let overQty = 0;
  let tariffRateShown = 0;
  const byStamp = new Map<StampKind, { qty: number; amount: number }>();
  for (const lot of lots) {
    if (left === 0) break;
    const take = Math.min(left, lot.qty);
    const full = Math.min(take, fullLeft);
    const over = take - full;
    const amount = full * q.sell + over * q.overLimitSell;
    const rate = tariffForLot(cs, port, good, lot.origin);
    const tariff = Math.round(amount * rate);
    const stamp = stampFor(lot.origin, lot.source, port);
    const st = byStamp.get(stamp) ?? { qty: 0, amount: 0 };
    st.qty += take;
    st.amount += amount;
    byStamp.set(stamp, st);
    if (rate > 0) tariffRateShown = rate;
    totalAmount += amount;
    totalCost += lot.unitCost * take;
    totalTariff += tariff;
    overQty += over;
    fullLeft -= full;
    left -= take;
    lot.qty -= take;
    onSell(p, { good, port, stamp, origin: lot.origin, source: lot.source, boughtAt: lot.boughtAt }, events);
  }
  if (service) p.game.contracts = p.game.contracts.filter((l) => l.qty > 0);
  else p.game.cargo = p.game.cargo.filter((l) => l.qty > 0);

  p.game.money += totalAmount - totalTariff;
  p.game.visit.sold[good] = (p.game.visit.sold[good] ?? 0) + qty;
  if (service) {
    const rc = roundContracts(cs, p);
    rc.sell[good] = (rc.sell[good] ?? 0) + qty;
    grantDex(p, 'goods-services', events);
  }
  const m = p.game.metrics;
  for (const [kind, st] of byStamp) {
    if (kind === 'export') m.exports += st.amount;
    if (kind === 'import') m.imports += st.amount;
    if (kind === 'relay') m.resale += st.amount;
    if (kind === 'domestic') m.domestic += st.amount;
    events.push({ type: 'stamp', kind, good, qty: st.qty, amount: st.amount });
    p.game.log.push({ round: cs.round, stage: cs.stage, kind: 'sell', good, qty: st.qty, port, amount: st.amount, stamp: kind });
  }
  if (overQty) events.push({ type: 'overLimit', good, qty: overQty });
  if (totalTariff) {
    m.tariffs += totalTariff;
    events.push({ type: 'tariff', rate: tariffRateShown, amount: totalTariff });
    grantDex(p, 'tariff', events);
  }
  const profit = Math.round(totalAmount - totalCost - totalTariff);
  events.push({ type: 'profit', amount: profit });
  const last = p.game.log[p.game.log.length - 1];
  if (last && last.kind === 'sell') last.profit = profit;
  return null;
}

function produce(cs: ClassState, p: Player, recipeId: GoodId, qty: number, events: GameEvent[]): string | null {
  if (!canTrade(cs)) return 'NOT_TRADING';
  if (!isPosInt(qty)) return 'BAD_QTY';
  if (!cs.features.includes('factory')) return 'NO_FACTORY';
  if (p.game.port !== 'BUS') return 'NOT_AT_BUSAN';
  const r = recipesById[recipeId];
  if (!r) return 'NO_RECIPE';
  if (LESSON_ORDER[r.unlockLesson] > LESSON_ORDER[cs.stage]) return 'LOCKED_RECIPE';
  if (r.requires === 'techRaceWinner' && !p.game.unlockedRecipes.includes(recipeId)) return 'LOCKED_RECIPE';
  const fee = r.fee * qty;
  if (fee > spendable(cs, p)) return 'NO_MONEY';
  for (const [g, n] of Object.entries(r.inputs) as [GoodId, number][]) {
    const have = p.game.cargo.filter((l) => l.good === g).reduce((s, l) => s + l.qty, 0);
    if (have < n * qty) return 'NO_INPUT';
  }
  let inputCost = 0;
  let usedForeignRaw = false;
  for (const [g, n] of Object.entries(r.inputs) as [GoodId, number][]) {
    let need = n * qty;
    for (const lot of p.game.cargo) {
      if (lot.good !== g || need === 0) continue;
      const take = Math.min(need, lot.qty);
      inputCost += take * lot.unitCost;
      if (isForeignRaw(g, lot.origin)) usedForeignRaw = true;
      lot.qty -= take;
      need -= take;
    }
  }
  p.game.cargo = p.game.cargo.filter((l) => l.qty > 0);
  p.game.money -= fee;
  addLot(p.game.cargo, {
    good: recipeId,
    qty,
    unitCost: Math.round((inputCost + fee) / qty),
    origin: 'korea',
    source: 'factory',
    boughtAt: 'BUS',
  });
  events.push({ type: 'produced', good: recipeId, qty, fee });
  if (!p.game.producedOnce) {
    p.game.producedOnce = true;
    events.push({ type: 'factoryCycleCard' });
  }
  grantDex(p, `good:${recipeId}`, events);
  onProduce(p, usedForeignRaw, events);
  p.game.log.push({ round: cs.round, stage: cs.stage, kind: 'produce', good: recipeId, qty, port: 'BUS', amount: fee });
  return null;
}

function setDestination(cs: ClassState, p: Player, port: PortId | null, events: GameEvent[]): string | null {
  if (!isTrading(cs)) return 'NOT_TRADING';
  if (port === null) {
    p.game.dest = null;
    p.game.ready = false;
    return null;
  }
  if (port === p.game.port) return 'SAME_PORT';
  if (!cs.openPorts.includes(port)) return 'PORT_NOT_OPEN';
  if (isPortClosed(cs, port)) return 'PORT_CLOSED';
  const free = p.game.effects.tailwind > 0;
  const cost = voyageCostFor(cs, p, p.game.port, port);
  if (!free && cost > spendable(cs, p)) return 'NO_MONEY';
  p.game.dest = port;
  events.push({ type: 'voyagePreview', to: port, cost: free ? 0 : cost, free });
  return null;
}

/**
 * (작업 151, PRD 4.3.7.1) 자유 항해: 라운드 중 바로 그 항구로 출발·도착. 운항비는 낼 운항비(fareDue)에 쌓고 라운드 끝에 정산.
 * (작업 159) 돈이 운항비보다 적어도 막지 않는다(후불).
 * 도착 처리는 라운드 항해와 같은 `arrive`(입항 한도 새로 시작·첫 입항 카드·도감·싱가포르 사건).
 */
function sailTo(cs: ClassState, p: Player, port: PortId, events: GameEvent[]): string | null {
  if (!isFreeVoyage(cs)) return 'NOT_FREE_VOYAGE';
  if (!canTrade(cs)) return 'NOT_TRADING';
  if (typeof port !== 'string') return 'BAD_PORT';
  if (port === p.game.port) return 'SAME_PORT';
  if (!cs.openPorts.includes(port)) return 'PORT_LOCKED';
  if (isPortClosed(cs, port)) return 'PORT_CLOSED';
  const free = p.game.effects.tailwind > 0;
  const cost = free ? 0 : voyageCostFor(cs, p, p.game.port, port);
  // (작업 159, 교사 요청) 쓸 수 있는 돈이 운항비보다 적어도 출발한다 — 운항비는 쌓였다가 라운드 끝·무역 끝에 정산, 모자라면 대출(voyage.ts settleFare)
  const from = p.game.port;
  if (free) p.game.effects.tailwind -= 1;
  p.game.fareDue = fareDueOf(p) + cost;
  p.game.sailsThisRound = sailsThisRoundOf(p) + 1;
  p.game.dest = null;
  p.game.ready = false;
  events.push({ type: 'departed', from, to: port, cost, free, round: cs.round });
  p.game.log.push({ round: cs.round, stage: cs.stage, kind: 'voyage', port: from, to: port, amount: cost });
  arrive(cs, p, port, cs.round, events);
  return null;
}

/** 학생 행동 하나 처리(순수) */
export function applyAction(cs: ClassState, player: Player, action: Action, ctx: ActionContext = {}): ActionResult {
  const p = clone(player);
  const events: GameEvent[] = [];
  let error: string | null = null;
  if (cs.phase === 'ended') return fail(player, 'ENDED');
  switch (action?.type) {
    case 'buy':
      error = buy(cs, p, action.good, action.qty, events);
      break;
    case 'sell':
      error = sell(cs, p, action.good, action.qty, events);
      break;
    case 'setDestination':
      error = setDestination(cs, p, action.port, events);
      break;
    case 'sailTo':
      error = sailTo(cs, p, action.port, events);
      break;
    case 'setReady':
      if (!isTrading(cs)) error = 'NOT_TRADING';
      else p.game.ready = true;
      break;
    case 'cancelReady':
      if (!isTrading(cs)) error = 'NOT_TRADING';
      else p.game.ready = false;
      break;
    case 'produce':
      error = produce(cs, p, action.recipe, action.qty, events);
      break;
    case 'foundCompany': {
      if (!FLAG_COLOR_IDS.includes(action.color) || !FLAG_EMBLEM_IDS.includes(action.emblem) || !AVATAR_IDS.includes(action.avatar)) {
        error = 'BAD_FLAG';
        break;
      }
      p.company.color = action.color;
      p.company.emblem = action.emblem;
      p.company.avatar = action.avatar;
      if (!p.company.founded) events.push({ type: 'companyFounded' });
      p.company.founded = true;
      p.game.responses['L1-E3'] = true;
      break;
    }
    case 'setCompanyName': {
      // 학생 스스로는 준비 단계에서만, 또는 교사가 이름을 막은 뒤(PRD 6.1.1)
      if (cs.phase !== 'prep' && p.company.nameStatus !== 'blocked') {
        error = 'NAME_LOCKED';
        break;
      }
      const validate = ctx.validateName ?? basicNameValidator;
      const res = validate(String(action.name ?? ''), {
        takenKeys: ctx.takenKeys ?? [],
        bannedKeys: cs.bannedNameKeys,
        extraWords: cs.settings.extraBannedWords,
      });
      if (!res.ok) {
        error = res.error;
        break;
      }
      p.company.name = res.name;
      p.company.nameKey = res.key;
      p.company.nameStatus = cs.settings.nameReview ? 'review' : res.realNameHint ? 'checkRealName' : 'ok';
      events.push({ type: 'nameChanged', name: res.name, status: p.company.nameStatus });
      break;
    }
    case 'answerLetter':
      error = applyLetterAnswer(cs, p, action.slotId, action.answer, events);
      break;
    case 'answerCheckQuiz':
      error = answerCheckQuiz(cs, p, action.qid, action.answer, events);
      break;
    case 'respondEvent':
      error = respondToEvent(cs, p, action.eventId, action.response, events);
      break;
    case 'markWorksheetDone': {
      const ids = (action.ids ?? cs.worksheet.current ?? []).filter((id): id is WorksheetId => id in worksheetById);
      if (!ids.length) {
        error = 'NO_WORKSHEET';
        break;
      }
      // (작업 132) '지금 쓰기' ★ 칸 완료는 번호 완료와 따로 센다(PRD 4.3.3.1 규칙 7) — ③★을 썼다고 ③이 끝난 것이 아니다
      // ids 없이 누르면 지금 떠 있는 팝업 종류를 따른다(지금 쓰기 팝업이면 ★ 칸 완료)
      if (action.during ?? (!action.ids && cs.worksheet.during === true)) {
        const done = p.game.duringDone ?? [];
        const addedD = ids.filter((id) => worksheetById[id].during && !done.includes(id));
        if (!addedD.length) {
          error = 'ANSWERED';
          break;
        }
        p.game.duringDone = [...done, ...addedD];
        events.push({ type: 'worksheetDone', ids: addedD, during: true });
        break;
      }
      const added = ids.filter((id) => !p.game.worksheetDone.includes(id));
      if (!added.length) {
        error = 'ANSWERED';
        break;
      }
      p.game.worksheetDone.push(...added);
      events.push({ type: 'worksheetDone', ids: added });
      break;
    }
    case 'requestLoan':
      if (!canTakeLoan(cs, p)) error = 'LOAN_NOT_NEEDED';
      else takeLoan(cs, p, events);
      break;
    default:
      error = 'BAD_ACTION';
  }
  if (error) return fail(player, error);
  p.rev = player.rev + 1;
  return { player: p, events };
}

/** 학생 기기의 미리 계산(= applyAction). 호스트 확인(ack)이 오면 확정한다 */
export function predict(player: Player, classState: ClassState, action: Action, ctx: ActionContext = {}): ActionResult {
  return applyAction(classState, player, action, ctx);
}
