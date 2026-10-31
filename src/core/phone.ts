/**
 * (작업 172) 3차시 학급 스마트폰 프로젝트·경제 게이지·광물 협력 니켈 할인 — 규칙 엔진(PRD 6.12.3, 4.4 L3, p.106~107).
 *
 * - 학급 쪽(`ClassState.phone`): 부품별 필요·모인 수량. 공개 상태에 실리므로 출석번호·개인 자금을 넣지 않는다.
 * - 학생 쪽(`PlayerGame.phone`): 맡은 부품(부품 팀)·넣은 부품·받은 협력.
 * - 시작: L3-E2가 발동하면 호스트가 그때 들어온 학생을 출석번호 순으로 6종에 돌아가며 배정(`startPhoneProject`).
 *   늦게 온 학생은 인원이 가장 적은 팀에(`joinPhoneProject`) — 필요 수량은 늘리지 않는다.
 * - 부품 넣기: 학생 행동 `depositPart`(규칙 `depositPart`, 학생 기기 미리 계산과 같음) → 호스트가 학급 수량을 더하고(`afterDeposit`)
 *   모든 부품이 모이면 그 순간 모두 협력 +20·자금 +50만 원(한 번만).
 * - 이 파일의 개인 함수는 넘겨받은 Player(복사본)를 직접 고친다.
 */
import { goodsById } from '../data/goods';
import { econGaugeOf, lessonPartRulesOf } from '../data/lessonParts';
import { PHONE_PARTS, phoneRules, econGaugeStep } from '../data/phone';
import type { GoodId, PortId } from '../data/types';
import { clone, seatKey } from './state';
import type { ClassState, GameEvent, HostSnapshot, PhoneProject, Player, PublicPhone } from './types';

export const PHONE_EVENT_START = 'L3-E2';
export const PHONE_EVENT_RESULT = 'L3-E5';
export const PHONE_MISSION = 'M-PHONE';

const isPart = (g: unknown): g is GoodId => typeof g === 'string' && (PHONE_PARTS as readonly string[]).includes(g);

/** 이 판의 3차시 라운드 수(배치표에서, 빠지거나 건너뛴 라운드 제외) */
function stageRounds(cs: ClassState): number {
  return cs.schedule.items.filter((it) => it.kind === 'round' && it.stage === 'L3' && it.form !== 'dropped' && it.status !== 'skipped').length;
}

/** 필요 수량 절반인가: 짧은 형태로 발동했거나 3차시 라운드가 2개뿐 */
export function phoneHalf(cs: ClassState): boolean {
  if (cs.shortEvents.includes(PHONE_EVENT_START) || cs.shortEvents.includes(PHONE_EVENT_RESULT)) return true;
  const k = stageRounds(cs);
  return k > 0 && k <= 2;
}

/** 팀 인원 → 필요 수량(배터리는 한 번 더 절반 — `phoneRules.halfParts`) */
export function phoneNeed(members: number, half: boolean, good?: GoodId): number {
  const n = Math.max(phoneRules.minMembers, members) * phoneRules.perMember;
  const base = half ? Math.ceil(n * phoneRules.shortRatio) : n;
  return good && phoneRules.halfParts.includes(good) ? Math.max(1, Math.ceil(base * phoneRules.shortRatio)) : base;
}

/** 이 학생이 이 부품을 더 넣을 수 있는 수(한 부품에 `perStudentPart` 상자까지) */
export function studentPartLeft(p: Pick<Player, 'game'>, good: GoodId): number {
  return Math.max(0, phoneRules.perStudentPart - (p.game.phone?.deposited[good] ?? 0));
}

/** 출석번호 순서대로 부품 배정(1번째 반도체, 2번째 배터리 …, 7번째 반도체) */
export function teamFor(index: number): GoodId {
  return PHONE_PARTS[index % PHONE_PARTS.length]!;
}

/** 프로젝트가 열려 있나(시작했고 아직 다 모이지 않음) */
export function phoneOpen(cs: Pick<ClassState, 'phone'>): boolean {
  return !!cs.phone && cs.phone.completedRound === null;
}

/** 다 모였나 */
export function phoneComplete(p: PhoneProject | null | undefined): boolean {
  if (!p) return false;
  const parts = Object.values(p.parts);
  return parts.length > 0 && parts.every((x) => !!x && x.have >= x.need);
}

/** 아직 덜 모인 부품 */
export function missingParts(p: PhoneProject | null | undefined): GoodId[] {
  if (!p) return [...PHONE_PARTS];
  return PHONE_PARTS.filter((g) => {
    const x = p.parts[g];
    return !x || x.have < x.need;
  });
}

/** 학생 화면·⑩ 도우미가 읽는 응답 거울(L3-E2: { part, fromPort, qty }) */
function mirror(p: Player): void {
  const ph = p.game.phone;
  if (!ph) return;
  p.game.responses[PHONE_EVENT_START] = { part: ph.team, fromPort: ph.fromPort, qty: ph.deposited[ph.team] ?? 0 };
}

/** 부품 팀 하나 배정(학생 기록 + 응답 거울) */
function assign(p: Player, team: GoodId): void {
  p.game.phone = { team, deposited: {}, coop: 0, fromPort: null };
  mirror(p);
  // 이미 우리 팀 부품을 갖고 있으면 임무 1단계
  phoneOnGet(p, team, []);
}

/**
 * L3-E2 발동: 지금 들어온 학생을 출석번호 순으로 배정하고 필요 수량을 정한다(이미 시작했으면 그대로).
 */
export function startPhoneProject(snap: HostSnapshot): HostSnapshot {
  const cs = snap.class;
  if (cs.phone) return snap;
  const list = Object.values(snap.players).sort((a, b) => a.seat - b.seat);
  const half = phoneHalf(cs);
  const members: Partial<Record<GoodId, number>> = {};
  const players = { ...snap.players };
  list.forEach((p, i) => {
    const team = teamFor(i);
    members[team] = (members[team] ?? 0) + 1;
    const np = clone(p);
    assign(np, team);
    np.rev = p.rev + 1;
    players[seatKey(p.seat)] = np;
  });
  const parts: PhoneProject['parts'] = {};
  for (const g of PHONE_PARTS) parts[g] = { need: phoneNeed(members[g] ?? 0, half, g), have: 0 };
  const phone: PhoneProject = { parts, startedRound: cs.round, half, completedRound: null };
  return { ...snap, class: { ...cs, phone }, players };
}

/** 늦게 온 학생: 인원이 가장 적은 팀에(같으면 부품 순서). 필요 수량은 그대로. 넘겨받은 새 학생을 고친다 */
export function joinPhoneProject(cs: ClassState, players: Record<string, Player>, np: Player): void {
  if (!cs.phone || np.game.phone) return;
  const count: Record<string, number> = {};
  for (const g of PHONE_PARTS) count[g] = 0;
  for (const p of Object.values(players)) if (p.game.phone && p.seat !== np.seat) count[p.game.phone.team] = (count[p.game.phone.team] ?? 0) + 1;
  let best = PHONE_PARTS[0]!;
  for (const g of PHONE_PARTS) if (count[g]! < count[best]!) best = g;
  assign(np, best);
}

/** 이 학생 화물·계약에 있는 그 부품 수 */
export function heldQty(p: Player, good: GoodId): number {
  const list = goodsById[good]?.form === 'service' ? p.game.contracts : p.game.cargo;
  return list.filter((l) => l.good === good).reduce((s, l) => s + l.qty, 0);
}

/** 우리 팀 부품을 사거나 만들었을 때 임무 1단계(rules.ts buy·produce 가 부른다) */
export function phoneOnGet(p: Player, good: GoodId, events: GameEvent[]): void {
  const ph = p.game.phone;
  const m = p.game.missions[PHONE_MISSION];
  if (!ph || ph.team !== good || !m || m.status !== 'active' || m.steps[0]) return;
  if (heldQty(p, good) <= 0) return;
  m.steps[0] = true;
  events.push({ type: 'missionStep', id: PHONE_MISSION, step: 0 });
}

/** 넣은 부품 1상자당 보상(만 원) */
export function partReward(good: GoodId): number {
  return Math.round((goodsById[good]?.V ?? 0) * phoneRules.rewardMul);
}

/** 이 학생이 지금 그 부품을 더 넣을 수 있는 최대 수(넣을 수 없으면 0) */
export function depositMax(cs: Pick<ClassState, 'phone'>, p: Player, good: GoodId): number {
  const x = cs.phone?.parts[good];
  if (!x || !phoneOpen(cs)) return 0;
  return Math.max(0, Math.min(heldQty(p, good), x.need - x.have, studentPartLeft(p, good)));
}

/**
 * 부품 넣기(학생 한 명 — 순수 규칙, 학생 기기 미리 계산과 같음). 오류면 코드.
 * 판매가 아니다: 도장·수출액·관세·같은 거래 반복 셈 없음. 보상 = V × 1.2/상자, 협력 자기 팀 +2/상자·다른 팀 +5/상자(합계 최대 +20).
 * 남은 필요 수량(또는 한 학생 한 부품 2상자 한도)보다 많이 넣으면 그만큼만 넣는다.
 */
export function depositPart(cs: ClassState, p: Player, good: GoodId, qty: number, events: GameEvent[]): string | null {
  if (!cs.phone) return 'NO_PROJECT';
  if (!phoneOpen(cs)) return 'PHONE_DONE';
  if (!isPart(good)) return 'NOT_A_PART';
  if (!Number.isInteger(qty) || qty <= 0) return 'BAD_QTY';
  if (p.game.port !== phoneRules.port) return 'NOT_AT_BUSAN';
  const x = cs.phone.parts[good];
  if (!x) return 'NOT_A_PART';
  if (x.have >= x.need) return 'PART_FULL';
  if (heldQty(p, good) <= 0) return 'NO_CARGO';
  if (studentPartLeft(p, good) <= 0) return 'PART_CAP';
  const take = Math.min(qty, heldQty(p, good), x.need - x.have, studentPartLeft(p, good));
  const service = goodsById[good]?.form === 'service';
  const list = service ? p.game.contracts : p.game.cargo;
  let left = take;
  let from: PortId | null = null;
  for (const lot of list) {
    if (lot.good !== good || left === 0) continue;
    const n = Math.min(left, lot.qty);
    if (from === null) from = lot.source === 'factory' ? 'BUS' : lot.boughtAt;
    lot.qty -= n;
    left -= n;
  }
  if (service) p.game.contracts = p.game.contracts.filter((l) => l.qty > 0);
  else p.game.cargo = p.game.cargo.filter((l) => l.qty > 0);
  if (!p.game.phone) p.game.phone = { team: good, deposited: {}, coop: 0, fromPort: null };
  const ph = p.game.phone;
  const own = ph.team === good;
  const amount = partReward(good) * take;
  const coopWant = (own ? phoneRules.coopOwn : phoneRules.coopOther) * take;
  const coop = Math.max(0, Math.min(coopWant, phoneRules.coopMax - ph.coop));
  ph.deposited[good] = (ph.deposited[good] ?? 0) + take;
  ph.coop += coop;
  if (own && ph.fromPort === null) ph.fromPort = from;
  p.game.money += amount;
  p.game.metrics.coop += coop;
  events.push({ type: 'partDeposited', good, qty: take, amount, coop });
  if (amount) events.push({ type: 'money', amount, reason: 'phonePart' });
  p.game.log.push({ round: cs.round, stage: cs.stage, kind: 'deposit', good, qty: take, port: phoneRules.port, amount, ref: 'phonePart' });
  // 임무: 우리 팀 부품을 넣으면 두 단계 모두
  const m = p.game.missions[PHONE_MISSION];
  if (own && m && m.status === 'active') {
    m.steps.forEach((s, i) => {
      if (!s) events.push({ type: 'missionStep', id: PHONE_MISSION, step: i });
    });
    m.steps = m.steps.map(() => true);
    m.status = 'done';
    events.push({ type: 'missionDone', id: PHONE_MISSION });
  }
  mirror(p);
  return null;
}

/**
 * 호스트: 부품 넣기가 성공한 뒤 학급 수량을 더하고, 다 모였으면 완성 보상(한 번만).
 * `seatEvents`에 좌석별 연출 이벤트(phoneComplete)를 더한다.
 */
export function afterDeposit(snap: HostSnapshot, good: GoodId, qty: number, seatEvents: Record<string, GameEvent[]>): HostSnapshot {
  const cs = snap.class;
  const ph = cs.phone;
  const x = ph?.parts[good];
  if (!ph || !x || qty <= 0) return snap;
  const phone: PhoneProject = { ...ph, parts: { ...ph.parts, [good]: { ...x, have: Math.min(x.need, x.have + qty) } } };
  let next: HostSnapshot = { ...snap, class: { ...cs, phone } };
  if (phone.completedRound === null && phoneComplete(phone)) {
    next = { ...next, class: { ...next.class, phone: { ...phone, completedRound: cs.round } } };
    const players = { ...next.players };
    for (const [key, p] of Object.entries(players)) {
      const np = clone(p);
      np.game.money += phoneRules.completeMoney;
      np.game.metrics.coop += phoneRules.completeCoop;
      np.rev = p.rev + 1;
      players[key] = np;
      (seatEvents[key] ??= []).push(
        { type: 'phoneComplete', money: phoneRules.completeMoney, coop: phoneRules.completeCoop },
        { type: 'money', amount: phoneRules.completeMoney, reason: 'phoneComplete' },
      );
    }
    next = { ...next, players };
  }
  return next;
}

/** 공개 상태: 부품별 진행 + 부품 팀 회사 이름(출석번호 없음) */
export function publicPhone(cs: ClassState, list: readonly Player[], nameOf: (p: Player) => string | null): PublicPhone | undefined {
  const ph = cs.phone;
  if (!ph) return undefined;
  const parts = PHONE_PARTS.map((good) => {
    const x = ph.parts[good] ?? { need: 0, have: 0 };
    const team = list.filter((p) => p.game.phone?.team === good).map((p) => nameOf(p) ?? '이름 짓는 중');
    return { good, need: x.need, have: x.have, team };
  });
  return { parts, complete: ph.completedRound !== null || phoneComplete(ph) };
}

/** 3차시 [수출] 판매액(로그에서 — 단원 한 판이면 3차시 구간 것만) */
export function stageExports(p: Pick<Player, 'game'>): number {
  return p.game.log.reduce((s, e) => s + (e.kind === 'sell' && e.stamp === 'export' && e.stage === 'L3' ? (e.amount ?? 0) : 0), 0);
}

/**
 * 경제 게이지(p.107): 3차시 학급 [수출] 판매액 합계 ÷ 회사 수. 범위에 3차시가 있고 게이지가 있는 판(앞 시간 판 제외)만, 아니면 undefined.
 */
export function econGauge(cs: ClassState, list: readonly Player[]): { avg: number; step: number } | undefined {
  if (!cs.settings.scope.includes('L3') || (cs.stage !== 'L3' && cs.stage !== 'L4')) return undefined;
  if (econGaugeOf(lessonPartRulesOf(cs.settings)) === 'none') return undefined;
  if (!list.length) return { avg: 0, step: 0 };
  const total = list.reduce((s, p) => s + stageExports(p), 0);
  const avg = Math.round((total / list.length) * 10) / 10;
  return { avg, step: econGaugeStep(avg) };
}

