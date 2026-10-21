/**
 * 사건 응답·사건 발동/마감의 개인 효과 (PRD 6.11, 6.12) — 작업 103.
 *
 * - `applyFiredEventToPlayer`: 사건이 발동했을 때(또는 늦게 온 학생에게 지난 사건을 적용할 때) 개인 효과 — 임무 시작,
 *   응답이 필요 없는 사건의 도감 카드, L4-E3 보도.
 * - `respondToEvent`: 학생 응답(결정·투표·미니게임 결과) 처리. 미니게임은 기기가 보낸 **답**으로 호스트가 채점한다.
 * - `closeEventForAll`: 투표 집계·학급 결정(L3-E3 기술 경쟁, L3-E4 자동화 항만, L4-E1 철강 관세).
 * 이 파일의 개인 함수는 넘겨받은 Player(복사본)를 직접 고친다.
 */
import { byeokrando, byeokrandoItems, type ByeokrandoItemId } from '../data/byeokrando';
import { checkQuiz } from '../data/checkQuiz';
import { CORRECT_CONTAINER_NOS } from '../data/containers';
import { eventsById } from '../data/events';
import { tariffs } from '../data/market';
import { scoringConstants } from '../data/awards';
import { afterExchange, isSuccess, produce, twoIslands } from '../data/twoIslands';
import type { GameEvent as EventDef } from '../data/types';
import { applyVNDecision, applyVNImprove, applyVNReport, parseVNDecision, type VNDecision } from './factoryVN';
import { isRightAnswer } from './letters';
import { activateMission, applyPersonalEffects, grantDex } from './progress';
import { clone, seatKey, spendable } from './state';
import type { ActiveEffect, Answer, ClassState, GameEvent, Json, Player } from './types';

/** L3-E3 생성형 인공지능 기술 경쟁 [게임 설정, PRD 6.12.4] */
export const TECH_RACE = {
  options: [0, 100, 200, 300] as const,
  topRatio: 0.3,
  minWinners: 3,
  /** 밀린 학생: 다음 2라운드 반도체 판매가 −10% */
  penaltyRounds: 2,
} as const;

/** L3-E4 부산 자동화 항만 투표 [게임 설정, PRD 6.12.5] */
export const AUTO_PORT = { cost: 50, limitMul: 1.5, port: 'BUS' as const } as const;

/** 투표 선택지(사건 ID별) */
export const VOTE_OPTIONS: Readonly<Record<string, readonly string[]>> = {
  'L3-E4': ['yes', 'no'],
  'L4-E1': ['tariff', 'noTariff'],
};

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** 사건 발동 때 개인 효과 */
export function applyFiredEventToPlayer(cs: ClassState, p: Player, def: EventDef, events: GameEvent[]): void {
  for (const e of def.effects) {
    if (e.type === 'mission') activateMission(p, e.ref);
    // 첫 입항 사건(L2-E5 싱가포르)의 개념 카드는 그 항구에 처음 들어갈 때(voyage.ts) 준다 — 학급 발동 때는 임무만
    if (e.type === 'dexCard' && !def.needsResponse && def.trigger.type !== 'firstArrival') grantDex(p, e.card, events);
  }
  if (def.id === 'L4-E3') applyVNReport(p, vnDecisionOf(p), events);
  void cs;
}

function vnDecisionOf(p: Player): VNDecision | null {
  return parseVNDecision(p.game.responses['L4-E2']);
}

/** 이 학생이 지금 응답할 수 있는 사건인가(오류 코드 또는 null) */
export function canRespond(cs: ClassState, p: Player, eventId: string): string | null {
  const def = eventsById[eventId];
  if (!def) return 'NO_EVENT';
  if (!cs.firedEvents.includes(eventId)) return 'NOT_FIRED';
  const live = cs.currentEvent?.id === eventId && !cs.currentEvent.closed;
  // 투표·마감이 있는 비공개 결정은 열려 있을 때만(늦은 표는 집계에 넣지 않음)
  if ((def.kind === 'vote' || eventId === 'L3-E3') && !live) return 'CLOSED';
  if (eventId !== 'L4-E3' && p.game.responses[eventId] !== undefined) return 'ANSWERED';
  return null;
}

/** 학생 응답 처리. 오류면 문자열 */
export function respondToEvent(cs: ClassState, p: Player, eventId: string, response: Json, events: GameEvent[]): string | null {
  const err = canRespond(cs, p, eventId);
  if (err) return err;
  const def = eventsById[eventId];
  const r = isObj(response) ? response : {};
  const short = cs.shortEvents.includes(eventId);

  switch (eventId) {
    case 'L1-E1': {
      // 벽란도: 답(물건 → 바구니)으로 채점, 첫 제출만 보상
      const answers = isObj(r.answers) ? r.answers : null;
      if (!answers) return 'BAD_RESPONSE';
      const set: readonly ByeokrandoItemId[] = short
        ? [...byeokrando.shortSet.sold, ...byeokrando.shortSet.bought]
        : byeokrandoItems.map((i) => i.id);
      const correct = set.filter((id) => answers[id] === byeokrandoItems.find((i) => i.id === id)?.answer).length;
      const per = short ? byeokrando.shortSet.bonusPerCorrect : byeokrando.bonusPerCorrect;
      const max = short ? byeokrando.shortSet.bonusMax : byeokrando.bonusMax;
      const bonus = Math.min(correct * per, max);
      p.game.money += bonus;
      if (bonus) events.push({ type: 'money', amount: bonus, reason: 'byeokrando' });
      grantDex(p, 'byeokrando', events);
      p.game.responses[eventId] = { correct, total: set.length };
      return null;
    }
    case 'L1-E5': {
      // 두 섬: 2단계 배분 + 교환 단위로 성공 판정. [예시 따라 하기]면 example: true (보상 동일)
      const base = { A: produce('A', twoIslands.defaultRiceDays.A), B: produce('B', twoIslands.defaultRiceDays.B) };
      let rice: { A: number; B: number } = { ...twoIslands.example.riceDays };
      let units: number = twoIslands.example.units;
      if (r.example !== true) {
        const rd = isObj(r.riceDays) ? r.riceDays : null;
        const a = Number(rd?.A);
        const b = Number(rd?.B);
        units = Number(r.units);
        const okDays = (n: number) => Number.isInteger(n) && n >= 0 && n <= twoIslands.days;
        if (!okDays(a) || !okDays(b) || !Number.isInteger(units)) return 'BAD_RESPONSE';
        rice = { A: a, B: b };
      }
      // 3단계는 '바꾸기'이므로 교환을 1단위 이상 해야 한다(바꾸지 않고 1단계와 같으면 성공으로 보지 않음 — result.md 가정)
      const result = units >= 1 ? afterExchange(produce('A', rice.A), produce('B', rice.B), units) : null;
      if (!result || !isSuccess(result, base)) return 'TRY_AGAIN';
      applyPersonalEffects(p, def.effects, events, 'twoIslands');
      p.game.responses[eventId] = {
        success: true,
        example: r.example === true,
        stage1: { A: { ...base.A }, B: { ...base.B } },
        stage3: { A: { ...result.A }, B: { ...result.B } },
      };
      return null;
    }
    case 'L1-E7': {
      const choice = String(r.choice ?? '');
      if (!def.options?.some((o) => o.id === choice)) return 'BAD_RESPONSE';
      // 결정 기록 키는 데이터(effect ref)·학습지 ④ 도우미 키와 같은 `graphiteChoice` 하나(작업 111 수정 1회차에서 정리)
      p.game.decisions.graphiteChoice = choice;
      grantDex(p, 'graphite', events);
      p.game.responses[eventId] = { choice };
      return null;
    }
    case 'L3-E3': {
      const invest = Number(r.invest);
      if (!(TECH_RACE.options as readonly number[]).includes(invest)) return 'BAD_RESPONSE';
      if (spendable(cs, p) < invest) return 'NO_MONEY';
      p.game.money -= invest;
      if (invest) events.push({ type: 'money', amount: -invest, reason: 'techRace' });
      p.game.responses[eventId] = { invest };
      return null;
    }
    case 'L4-E2': {
      const d = parseVNDecision(r);
      if (!d) return 'BAD_RESPONSE';
      applyVNDecision(p, d, events);
      grantDex(p, 'overseas-production', events);
      p.game.responses[eventId] = clone(d) as unknown as Json;
      return null;
    }
    case 'L4-E3': {
      const which = r.improve;
      if (which !== 'wage' && which !== 'env') return 'BAD_RESPONSE';
      const prev = isObj(p.game.responses[eventId]) ? (p.game.responses[eventId] as Record<string, unknown>) : {};
      const done = Array.isArray(prev.improved) ? (prev.improved as string[]) : [];
      const e2 = applyVNImprove(p, vnDecisionOf(p), which, done, events, spendable(cs, p));
      if (e2) return e2;
      p.game.responses[eventId] = { improved: [...done, which] };
      return null;
    }
    case 'L4-E6': {
      // 컨테이너 OX: 트럭에 실은 문장 번호
      const picks = Array.isArray(r.picks) ? (r.picks as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 8) : null;
      if (!picks) return 'BAD_RESPONSE';
      const set = new Set(picks);
      let correct = 0;
      const wrongNos: number[] = [];
      for (let n = 1; n <= 8; n++) {
        const ok = set.has(n) === CORRECT_CONTAINER_NOS.includes(n);
        if (ok) correct += 1;
        else wrongNos.push(n);
      }
      p.game.responses[eventId] = { correct, total: 8, wrongNos };
      return null;
    }
    case 'L4-E8': {
      // 잡지 표지: 6칸. 4번(목표)·5번(노력)을 쓰면 사회적 책임 +10
      const fields = Array.isArray(r.fields) ? (r.fields as unknown[]).map((f) => String(f ?? '').slice(0, 40)) : null;
      if (!fields || fields.length !== 6) return 'BAD_RESPONSE';
      if (fields[3].trim() && fields[4].trim()) {
        p.game.metrics.csr += scoringConstants.csrMagazineBonus;
        events.push({ type: 'csr', amount: scoringConstants.csrMagazineBonus, reason: 'magazine' });
      }
      p.game.cover = { fields };
      p.game.responses[eventId] = true;
      return null;
    }
    case 'L4-E9': {
      p.game.reflect = clone(response);
      p.game.responses[eventId] = true;
      return null;
    }
    default: {
      if (VOTE_OPTIONS[eventId]) {
        const vote = String(r.vote ?? '');
        if (!VOTE_OPTIONS[eventId].includes(vote)) return 'BAD_RESPONSE';
        p.game.responses[eventId] = { vote };
        return null;
      }
      if (def.options?.length) {
        const choice = String(r.choice ?? '');
        if (!def.options.some((o) => o.id === choice)) return 'BAD_RESPONSE';
        p.game.decisions[eventId] = choice;
        p.game.responses[eventId] = { choice };
      } else {
        p.game.responses[eventId] = clone(response);
      }
      // 응답이 필요한 사건의 도감 카드는 응답했을 때 준다
      for (const e of def.effects) if (e.type === 'dexCard') grantDex(p, e.card, events);
      return null;
    }
  }
}

/** 결정 사건의 기본 선택지(마감 때 응답 없는 학생): 선택지 ID 'none'(사지 않기·하지 않기). 없으면 null */
export function defaultOptionId(def: EventDef): string | null {
  return def.options?.some((o) => o.id === 'none') ? 'none' : null;
}

/** '응답 없음'(마감 때 기본값으로 채운 기록)인가 */
export function isNoResponse(r: Json | undefined): boolean {
  return isObj(r) && r.noResponse === true;
}

/** 확인 퀴즈 답(PRD 6.7.5): 지금 열린 확인 퀴즈 사건의 구간 문항만, 문항당 1회 */
export function answerCheckQuiz(cs: ClassState, p: Player, qid: string, answer: Answer, events: GameEvent[]): string | null {
  const ev = cs.currentEvent;
  const def = ev ? eventsById[ev.id] : undefined;
  if (!ev || ev.closed || !def || def.kind !== 'checkQuiz') return 'CLOSED';
  const q = checkQuiz.find((x) => x.id === qid);
  if (!q || q.lesson !== def.lesson) return 'NO_QUESTION';
  if (p.game.checkQuiz[qid]) return 'ANSWERED';
  const right = isRightAnswer(q, answer);
  p.game.checkQuiz[qid] = right ? 'right' : 'wrong';
  if (right) p.game.metrics.quizRight += 1;
  events.push({ type: 'checkQuizResult', qid, right });
  return null;
}

// ─── 학급 마감 처리 ─────────────────────────────────────────

/** 투표 집계(표 수) */
export function voteCounts(players: Iterable<Player>, eventId: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const o of VOTE_OPTIONS[eventId] ?? []) counts[o] = 0;
  for (const p of players) {
    const r = p.game.responses[eventId];
    if (isObj(r) && typeof r.vote === 'string') counts[r.vote] = (counts[r.vote] ?? 0) + 1;
  }
  return counts;
}

/**
 * 투표 결과: 첫 선택지(찬성·매김)가 둘째보다 많아야 채택(과반, 동점은 채택 안 함).
 * 결과는 학급 투표 그대로 적용한다(교사 동의, PRD 6.12.6).
 */
export function voteResult(counts: Record<string, number>, eventId: string): string | null {
  const opts = VOTE_OPTIONS[eventId];
  if (!opts) return null;
  const [yes, no] = opts;
  return (counts[yes] ?? 0) > (counts[no] ?? 0) ? yes : no;
}

export interface CloseResult {
  class: ClassState;
  players: Record<string, Player>;
  /** 좌석 키 → 연출 이벤트 */
  events: Record<string, GameEvent[]>;
}

/**
 * 사건 마감 때 학급 처리. players 는 원본(바뀐 학생만 새 객체로 돌려줌).
 */
export function closeEventForAll(cs: ClassState, players: Record<string, Player>, eventId: string): CloseResult {
  let cls = cs;
  const out: Record<string, Player> = { ...players };
  const evs: Record<string, GameEvent[]> = {};
  const list = Object.values(players);
  const push = (key: string, e: GameEvent) => (evs[key] ??= []).push(e);

  if (VOTE_OPTIONS[eventId]) {
    const counts = voteCounts(list, eventId);
    const result = voteResult(counts, eventId);
    cls = { ...cls, votes: { ...cls.votes, [eventId]: { revealed: true, result } } };
    if (eventId === 'L3-E4' && result === 'yes') {
      // 모두 50만 원씩(모자라면 가진 만큼) → 부산 한도 +50%
      for (const p of list) {
        const key = seatKey(p.seat);
        const pay = Math.min(AUTO_PORT.cost, Math.max(0, p.game.money));
        const np = clone(p);
        np.game.money -= pay;
        np.rev += 1;
        out[key] = np;
        if (pay) push(key, { type: 'money', amount: -pay, reason: 'autoPort' });
      }
      const eff: ActiveEffect = { id: 'autoPort', source: eventId, effect: { type: 'limitMul', port: AUTO_PORT.port, mul: AUTO_PORT.limitMul }, until: null };
      cls = { ...cls, activeEffects: [...cls.activeEffects.filter((e) => e.id !== eff.id), eff] };
    }
    if (eventId === 'L4-E1' && result === 'tariff') {
      const o = tariffs.eventOverrides.steel1970Busan;
      const eff: ActiveEffect = { id: 'steel1970', source: eventId, effect: { type: 'tariff', port: o.port, good: o.good, rate: o.rate }, until: null };
      cls = { ...cls, activeEffects: [...cls.activeEffects.filter((e) => e.id !== eff.id), eff] };
    }
  }

  // (작업 111) 개인 결정 마감: 응답하지 않은 학생은 '응답 없음'으로 기록하고 기본 선택지('사지 않기' 등 id 'none')를 넣는다.
  // 늦게 들어온 학생(마감 뒤 입장)은 기록이 없으므로 따라잡기로 직접 고른다.
  const def = eventsById[eventId];
  const fallback = def && def.kind === 'decision' && !VOTE_OPTIONS[eventId] ? defaultOptionId(def) : null;
  if (def && fallback) {
    const refs = def.effects.filter((e): e is Extract<typeof e, { type: 'decision' }> => e.type === 'decision').map((e) => e.ref);
    for (const p of list) {
      if (p.game.responses[eventId] !== undefined) continue;
      const key = seatKey(p.seat);
      const np = clone(out[key] ?? p);
      np.game.responses[eventId] = { choice: fallback, noResponse: true };
      for (const ref of refs) np.game.decisions[ref] = fallback;
      np.rev += 1;
      out[key] = np;
    }
  }

  if (eventId === 'L3-E3') {
    // 연구비 상위 30%(동점 포함, 최소 3명, 0원 제외) → AI 반도체 레시피. 나머지 → 다음 2라운드 반도체 −10%
    const invests = list.map((p) => {
      const r = p.game.responses[eventId];
      return { p, v: isObj(r) && typeof r.invest === 'number' ? r.invest : 0 };
    });
    const k = Math.max(TECH_RACE.minWinners, Math.ceil(list.length * TECH_RACE.topRatio));
    const positive = invests.filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
    const cutoff = positive.length ? positive[Math.min(k, positive.length) - 1].v : Infinity;
    for (const { p, v } of invests) {
      const key = seatKey(p.seat);
      const np = clone(p);
      if (v > 0 && v >= cutoff) {
        if (!np.game.unlockedRecipes.includes('aichip')) np.game.unlockedRecipes.push('aichip');
        push(key, { type: 'recipeUnlocked', recipe: 'aichip' });
      } else {
        np.game.effects.chipPenaltyUntilRound = cls.round + TECH_RACE.penaltyRounds;
      }
      np.rev += 1;
      out[key] = np;
    }
  }
  return { class: cls, players: out, events: evs };
}
