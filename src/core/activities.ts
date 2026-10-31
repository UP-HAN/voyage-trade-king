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
import { magazineFields } from '../data/magazine';
import { econGaugeOf, lessonPartRulesOf } from '../data/lessonParts';
import { MINERAL_COOP } from '../data/phone';
import { tariffs } from '../data/market';
import { scoringConstants } from '../data/awards';
import { afterExchange, isSuccess, produce, twoIslands } from '../data/twoIslands';
import type { GameEvent as EventDef } from '../data/types';
import { applyVNDecision, applyVNImprove, applyVNReport, parseVNDecision, vnUpfrontCost, type VNDecision } from './factoryVN';
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

/** (작업 174) 다시 보낼 수 있는 응답(L4-E3 고치기는 따로 — 여러 번) */
const RESUBMIT_EVENTS: ReadonlySet<string> = new Set(['L4-E3', 'L4-E8', 'L4-E9']);

/** (작업 174) 잡지 표지 6칸 글자 수(p.112~113, PRD 6.14.3): 대표 상품 / 특징 30 / 주요 수출국 / 목표 40 / 노력 40 / 자랑 30 */
export const COVER_FIELD_MAX: readonly number[] = magazineFields.map((f) => f.max);
/** (작업 174) 잡지 표지 배경 수(cover/bg-1~3) */
export const COVER_BG_COUNT = 3;
/** (작업 174) 되돌아보기 한 칸 글자 수 */
export const REFLECT_MAX = 60;

/** 글자 수(코드 포인트) 기준으로 자르기 — 한글·이모지가 반쪽으로 잘리지 않게 */
export function clipText(s: unknown, max: number): string {
  return [...String(s ?? '').replace(/\s+/g, ' ')].slice(0, max).join('');
}

/** 사건 발동 때 개인 효과 */
export function applyFiredEventToPlayer(cs: ClassState, p: Player, def: EventDef, events: GameEvent[]): void {
  for (const e of def.effects) {
    if (e.type === 'mission') activateMission(p, e.ref);
    // 첫 입항 사건(L2-E5 싱가포르)의 개념 카드는 그 항구에 처음 들어갈 때(voyage.ts) 준다 — 학급 발동 때는 임무만
    if (e.type === 'dexCard' && !def.needsResponse && def.trigger.type !== 'firstArrival') grantDex(p, e.card, events);
  }
  if (def.id === 'L4-E3') applyVNReport(p, vnDecisionOf(p), events);
  // (작업 172) 경제 게이지(L3-E5 안)가 있는 판만 '수출이 늘어나면' 카드(3차시 앞 시간 판은 게이지가 없다)
  if (def.id === 'L3-E5' && econGaugeOf(lessonPartRulesOf(cs.settings)) !== 'none') grantDex(p, 'export-growth', events);
  // (작업 172) 경쟁 세 가지 카드(L3-E6)는 카드만(차시 판)이든 확인 퀴즈(단원 한 판)든 '시설 건설 경쟁' 카드를 준다
  if (def.id === 'L3-E6') grantDex(p, 'competition-facility', events);
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
  // (작업 173) 단계 활동(L4-E1)은 투표 단계(0)에서만 표를 받는다 — 결과를 보인 뒤에는 늦은 표를 넣지 않는다
  if (live && (cs.currentEvent?.step ?? 0) >= 1) return 'CLOSED';
  // (작업 174) 잡지 표지(L4-E8)·되돌아보기(L4-E9)는 고쳐 쓴 글을 다시 보낼 수 있다(사회적 책임 +10은 한 번만)
  if (!RESUBMIT_EVENTS.has(eventId) && p.game.responses[eventId] !== undefined) return 'ANSWERED';
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
    case 'L3-E1': {
      // (작업 172) 광물 협력: 함께하면 −50만 원(쓸 수 있는 돈이 모자라면 가진 만큼), 협력 +10, 남은 판 동안 자카르타 니켈 사는 값 20% 싸게
      const choice = String(r.choice ?? '');
      if (!def.options?.some((o) => o.id === choice)) return 'BAD_RESPONSE';
      if (choice === 'join') {
        const pay = Math.min(MINERAL_COOP.cost, Math.max(0, spendable(cs, p)));
        p.game.money -= pay;
        if (pay) events.push({ type: 'money', amount: -pay, reason: 'mineralCoop' });
        p.game.metrics.coop += MINERAL_COOP.coop;
        p.game.effects.nickelDiscount = true;
      }
      p.game.decisions[eventId] = choice;
      p.game.responses[eventId] = { choice };
      grantDex(p, 'interdependence', events);
      return null;
    }
    case 'L3-E3': {
      // (작업 172) 결정 카드(선택지 '0'·'100'·'200'·'300')로 보낸 choice 도 받는다. 응답 계약은 { invest } 그대로(+ 화면용 choice)
      const invest = Number(r.invest ?? r.choice);
      if (!(TECH_RACE.options as readonly number[]).includes(invest)) return 'BAD_RESPONSE';
      if (spendable(cs, p) < invest) return 'NO_MONEY';
      p.game.money -= invest;
      if (invest) events.push({ type: 'money', amount: -invest, reason: 'techRace' });
      p.game.responses[eventId] = { invest, choice: String(invest) };
      grantDex(p, 'competition-tech', events);
      return null;
    }
    case 'L4-E2': {
      const d = parseVNDecision(r);
      if (!d) return 'BAD_RESPONSE';
      // (작업 173) 짓는 비용(건설비 + 설비 설치비)은 쓸 수 있는 돈(자유 항해 = 자금 − 낼 운항비) 안에서만 — 모자라면 다시 고른다
      if (vnUpfrontCost(d) > spendable(cs, p)) return 'NO_MONEY';
      applyVNDecision(p, d, events);
      grantDex(p, 'overseas-production', events);
      // (작업 173 검증 반영) 근로 환경 보도(L4-E3)가 이미 나온 뒤 따라잡기로 정한 학생도 같은 규칙 — 낮은 임금·미설치면 그 자리에서 보도를 적용
      if (cs.firedEvents.includes('L4-E3')) applyVNReport(p, d, events);
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
      // 컨테이너 OX: 트럭에 실은 문장 번호. (작업 174) 자기 평가 별 3개(각 1~3, p.111)도 함께 — 없으면 기록하지 않고, 있으면 범위를 지켜야 한다
      const picks = Array.isArray(r.picks) ? (r.picks as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 8) : null;
      if (!picks) return 'BAD_RESPONSE';
      let self: number[] | null = null;
      if (r.self !== undefined) {
        const raw = Array.isArray(r.self) ? (r.self as unknown[]).map(Number) : null;
        if (!raw || raw.length !== 3 || !raw.every((n) => Number.isInteger(n) && n >= 1 && n <= 3)) return 'BAD_RESPONSE';
        self = raw;
      }
      const set = new Set(picks);
      let correct = 0;
      const wrongNos: number[] = [];
      for (let n = 1; n <= 8; n++) {
        const ok = set.has(n) === CORRECT_CONTAINER_NOS.includes(n);
        if (ok) correct += 1;
        else wrongNos.push(n);
      }
      p.game.responses[eventId] = { correct, total: 8, wrongNos, picks: [...set].sort((a, b) => a - b), ...(self ? { self } : {}) };
      return null;
    }
    case 'L4-E8': {
      // 잡지 표지: 6칸(칸마다 글자 수 자름) + (작업 174) 배경 번호 1~3. 4번(목표)·5번(노력)을 쓰면 사회적 책임 +10(한 판에 한 번)
      const fields = Array.isArray(r.fields) ? (r.fields as unknown[]).map((f, i) => clipText(f, COVER_FIELD_MAX[i] ?? 40).trim()) : null;
      if (!fields || fields.length !== 6) return 'BAD_RESPONSE';
      const bgN = Number(r.bg ?? 1);
      const bg = Number.isInteger(bgN) && bgN >= 1 && bgN <= COVER_BG_COUNT ? bgN : 1;
      const prev = isObj(p.game.cover) ? p.game.cover : null;
      const bonusGiven = prev?.csrBonus === true;
      const bonus = !bonusGiven && !!fields[3] && !!fields[4];
      if (bonus) {
        p.game.metrics.csr += scoringConstants.csrMagazineBonus;
        events.push({ type: 'csr', amount: scoringConstants.csrMagazineBonus, reason: 'magazine' });
      }
      p.game.cover = { fields, bg, ...(bonusGiven || bonus ? { csrBonus: true } : {}) };
      p.game.responses[eventId] = true;
      return null;
    }
    case 'L4-E9': {
      // (작업 174) 되돌아보기: 문항마다 한 줄(60자). 빈 칸도 받는다(쓰지 않아도 진행은 막지 않음)
      const answers = Array.isArray(r.answers) ? (r.answers as unknown[]).slice(0, 3).map((a) => clipText(a, REFLECT_MAX).trim()) : null;
      if (!answers) return 'BAD_RESPONSE';
      p.game.reflect = { answers };
      p.game.responses[eventId] = true;
      return null;
    }
    default: {
      if (VOTE_OPTIONS[eventId]) {
        // (작업 172) 투표 공통 카드는 { vote }를 보낸다(옛 결정 카드 모양 { choice }도 받는다)
        const vote = String(r.vote ?? r.choice ?? '');
        if (!VOTE_OPTIONS[eventId].includes(vote)) return 'BAD_RESPONSE';
        p.game.responses[eventId] = { vote };
        for (const e of def.effects) if (e.type === 'dexCard') grantDex(p, e.card, events);
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
  // (작업 172) 짧은 형태(3차시 경쟁 세 가지 '카드만')는 문항을 내지 않는다
  if (ev.short && def.shortForm) return 'CLOSED';
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
      // (작업 172) 쓸 수 있는 돈(자유 항해 = 자금 − 낼 운항비) 기준, 모자라면 가진 만큼(음수 금지)
      for (const p of list) {
        const key = seatKey(p.seat);
        const pay = Math.min(AUTO_PORT.cost, Math.max(0, spendable(cs, p)));
        const np = clone(p);
        np.game.money -= pay;
        np.rev += 1;
        out[key] = np;
        if (pay) push(key, { type: 'money', amount: -pay, reason: 'autoPort' });
      }
      const eff: ActiveEffect = { id: 'autoPort', source: eventId, effect: { type: 'limitMul', port: AUTO_PORT.port, mul: AUTO_PORT.limitMul }, until: null };
      cls = { ...cls, activeEffects: [...cls.activeEffects.filter((e) => e.id !== eff.id), eff] };
    }
    if (eventId === 'L4-E1') {
      // (작업 173) 실제 사례 카드의 개념(1970년대 철강·수입의 좋은 점과 문제점)은 투표하지 않은 학생도 받는다
      for (const p of list) {
        const key = seatKey(p.seat);
        const np = clone(out[key] ?? p);
        const evs: GameEvent[] = [];
        grantDex(np, 'steel-1970', evs);
        grantDex(np, 'import-pros-cons', evs);
        if (!evs.length) continue;
        np.rev += 1;
        out[key] = np;
        for (const e of evs) push(key, e);
      }
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
  // (작업 172) 기사 + 결정(L3-E1 광물 협력)도 같은 규칙
  const fallback = def && (def.kind === 'decision' || def.kind === 'article') && !VOTE_OPTIONS[eventId] ? defaultOptionId(def) : null;
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
      const np = clone(out[key] ?? p);
      const won = v > 0 && v >= cutoff;
      if (won) {
        if (!np.game.unlockedRecipes.includes('aichip')) np.game.unlockedRecipes.push('aichip');
        push(key, { type: 'recipeUnlocked', recipe: 'aichip' });
      } else {
        np.game.effects.chipPenaltyUntilRound = cls.round + TECH_RACE.penaltyRounds;
      }
      // (작업 172) ⑪ 도우미(gotAiChip)가 읽게 결과를 응답에 남긴다. 응답하지 않은 학생은 '응답 없음'(0원)
      const prev = np.game.responses[eventId];
      np.game.responses[eventId] = isObj(prev) ? { ...prev, won } : { invest: 0, choice: '0', won: false, noResponse: true };
      np.rev += 1;
      out[key] = np;
    }
  }
  return { class: cls, players: out, events: evs };
}
