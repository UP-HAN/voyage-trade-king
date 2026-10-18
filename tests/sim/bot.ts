/**
 * 작업 114 시뮬레이션 봇(화면 없는 학생): 학생 저장소 상태(public·me)만 보고 무작위로 행동 하나를 고른다.
 * Memory 시뮬레이션(tests/sim)과 실제 중계 서버 e2e의 헤드리스 봇(e2e/support/bot-harness.ts)이 같이 쓴다 — node 전용 코드 없음.
 */
import { AVATAR_IDS, FLAG_COLOR_IDS, FLAG_EMBLEM_IDS, marketView, type Action, type PublicPayload } from '../../src/core';
import { mailbox } from '../../src/core/letters';
import { byeokrandoItems } from '../../src/data/byeokrando';
import { checkQuiz } from '../../src/data/checkQuiz';
import { eventsById } from '../../src/data/events';
import { factoryCards } from '../../src/student/port/factory';
import { classForPredict, playerForPredict } from '../../src/student/predict';
import type { StudentStore } from '../../src/student/store';

/** 봇이 보는 학생(저장소 + 오류 기록) */
export interface BotStudent {
  store: StudentStore;
}

export const COMPANY_NAMES = [
  '해오름무역', '별빛상회', '파도무역', '바다상사', '은하해운', '푸른돛무역', '고래상회', '등대무역', '갈매기상사', '물결해운',
  '산호무역', '진주상회', '햇볕해운', '노을무역', '바람상사', '구름해운', '새벽무역', '달빛상회', '모래상사', '항구무역',
  '나침반해운', '닻별무역', '돌고래상회', '수평선무역', '섬마을상사', '파랑새해운', '은빛무역', '무지개상회', '조개해운', '해마무역',
  '별똥별무역', '초록섬상사', '하늘해운', '바위섬무역', '연꽃상회', '해바라기무역', '참새해운', '소나무상사', '들꽃무역', '강물해운',
];

// ───────────────────────── 봇 ─────────────────────────

/** 결정적 난수 */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SIDES = [...new Set(byeokrandoItems.map((i) => i.answer))];
const FLAG_COLORS = FLAG_COLOR_IDS;
const EMBLEMS = FLAG_EMBLEM_IDS;
const AVATARS = AVATAR_IDS;

/**
 * 학생 한 명이 지금 할 만한 행동 하나를 고른다(없으면 null). 저장소 상태(public·me)만 본다.
 * active: 0~1, 낮을수록 덜 움직인다(무작위성).
 */
export function botAction(s: BotStudent, rand: () => number): Action | null {
  const st = s.store.getState();
  const me = st.peer.me;
  const pub = st.peer.public as PublicPayload | null;
  if (st.peer.status !== 'in' || !me || !pub) return null;
  if (st.peer.pendingCount > 0) return null;
  const cls = pub.class;
  if (!me.company.founded) {
    return {
      type: 'foundCompany',
      color: FLAG_COLORS[Math.floor(rand() * FLAG_COLORS.length)]!,
      emblem: EMBLEMS[Math.floor(rand() * EMBLEMS.length)]!,
      avatar: AVATARS[Math.floor(rand() * AVATARS.length)]!,
    };
  }
  if (cls.paused) return null;
  // 학습지 팝업: 다 썼어요
  const wsCur = cls.worksheet.current;
  // (작업 132) '지금 쓰기' ★ 칸 팝업은 ★ 완료(duringDone)로 본다
  const wsDone = cls.worksheet.during ? (me.game.duringDone ?? []) : me.game.worksheetDone;
  if (wsCur && wsCur.some((w) => !wsDone.includes(w)) && rand() < 0.5) return { type: 'markWorksheetDone' };
  // 지금 사건 응답
  const ev = cls.currentEvent;
  if (ev && !ev.closed && me.game.responses[ev.id] === undefined) {
    const def = eventsById[ev.id];
    if (def?.needsResponse && rand() < 0.6) {
      if (ev.id === 'L1-E1') {
        const answers: Record<string, string> = {};
        for (const it of byeokrandoItems) answers[it.id] = rand() < 0.8 ? it.answer : it.answer === SIDES[0] ? SIDES[1] : SIDES[0];
        return { type: 'respondEvent', eventId: ev.id, response: { answers } };
      }
      if (ev.id === 'L1-E5') return { type: 'respondEvent', eventId: ev.id, response: { example: true } };
      if (def.kind === 'checkQuiz') {
        const q = checkQuiz.find((x) => x.lesson === def.lesson && !me.game.checkQuiz[x.id]);
        if (q) return { type: 'answerCheckQuiz', qid: q.id, answer: rand() < 0.7 ? q.answer : typeof q.answer === 'number' ? (q.answer + 1) % Math.max(2, q.choices?.length ?? 3) : q.answer === 'O' ? 'X' : 'O' };
        return null;
      }
      if (def.options?.length) return { type: 'respondEvent', eventId: ev.id, response: { choice: def.options[Math.floor(rand() * def.options.length)]!.id } };
    }
  }
  // 편지: 도착했고 답하지 않은 것
  try {
    const box = mailbox(classForPredict(cls), playerForPredict(me));
    const open = box.find((l) => !l.expired && l.result === null && l.question);
    if (open && rand() < 0.4) {
      const q = open.question!;
      const right = rand() < 0.7;
      const answer = right ? q.answer : typeof q.answer === 'number' ? (q.answer + 1) % Math.max(2, q.choices?.length ?? 3) : q.answer === 'O' ? 'X' : 'O';
      return { type: 'answerLetter', slotId: open.slot.slotId, answer };
    }
  } catch {
    /* 편지함 계산 실패는 무시(공개 상태가 아직 덜 왔을 때) */
  }
  if (cls.phase !== 'round') return null;
  // 라운드: 사고팔기 → 목적지 → 출항 준비
  if (me.game.ready) return null;
  if (rand() < 0.5) return null;
  const c = classForPredict(cls);
  const p = playerForPredict(me);
  const view = marketView(c, p, me.game.port);
  // (작업 115) 2차시~: 부산에서 재료가 있으면 공장에서 만든다
  if (cls.features.includes('factory') && me.game.port === 'BUS' && rand() < 0.6) {
    const can = factoryCards(c, p).find((f) => f.max > 0);
    if (can) return { type: 'produce', recipe: can.id, qty: Math.max(1, Math.min(can.max, 1 + Math.floor(rand() * can.max))) };
  }
  const r = rand();
  if (r < 0.35 && me.game.cargo.length) {
    const lot = me.game.cargo[Math.floor(rand() * me.game.cargo.length)]!;
    const q = view.find((x) => x.good === lot.good);
    if (q && q.sell !== null && !q.cannotSell) return { type: 'sell', good: lot.good, qty: Math.max(1, Math.min(lot.qty, 1 + Math.floor(rand() * lot.qty))) };
  }
  if (r < 0.7) {
    const buyable = view.filter((q) => q.buy !== null && q.buyLeft > 0 && q.buy <= me.game.money);
    if (buyable.length) {
      const q = buyable[Math.floor(rand() * buyable.length)]!;
      const maxQty = Math.min(q.buyLeft, Math.floor(me.game.money / (q.buy as number)), 5);
      if (maxQty >= 1) return { type: 'buy', good: q.good, qty: 1 + Math.floor(rand() * maxQty) };
    }
  }
  if (!me.game.dest || rand() < 0.2) {
    const ports = cls.openPorts.filter((x) => x !== me.game.port);
    if (ports.length) return { type: 'setDestination', port: ports[Math.floor(rand() * ports.length)]! };
  }
  return { type: 'setReady' };
}
