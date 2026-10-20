/**
 * 작업 135 리허설 — 가벼운 학생 봇 페이지(브라우저 안에서 돈다, 빌드에 들어가지 않는다).
 *
 * `tests/rehearsal/bots.ts`가 Vite로 한 덩어리로 묶어 앱과 **같은 주소**(`<base>__rehearsal-bots.html`)로 끼워 넣는다(page.route —
 * 로컬·운영 대상 모두 같은 방식). 봇 한 명 = 실제 학생 코드(createStudentStore + RelayPeer = 실제 중계 서버 WebSocket 하나).
 *
 * 114의 봇(tests/sim/bot.ts의 botAction)을 쓰되 리허설용 성격을 더했다:
 * - 성격(profile): good(성실) / slow(사건·학습지에 늦게, 절반은 안 함) / idle(사건·학습지·편지 거의 안 함, 거래만 가끔)
 * - 회사 이름: 첫 이름이 거절되면(NAME_TAKEN·BAD_NAME·NAME_FORMAT) 제안 이름 → 다음 후보 이름으로 다시 짓기
 * - 끊김·복귀: drop(seat) = 연결과 저장소를 버림(같은 기기 기록은 남김) → back(seat) = 같은 기기로 자동 재입장(새로 고침과 같음)
 *   back(seat, { newDevice: true }) = 다른 기기(같은 번호·이름) → 교사 허락 대기, back(seat, { code }) = 다른 코드(테스트용 고장)
 * - 기록: 거절 코드별 수(입장·행동 되돌림), 상태 변화 시각(빠른 시계), 행동 수, '할 수 있는 행동 없음' 시간
 */
import { botAction, rng } from '../sim/bot';
import { isBlocking, marketView, type PublicPayload } from '../../src/core';
import { eventsById } from '../../src/data/events';
import { mailbox } from '../../src/core/letters';
import { classForPredict, playerForPredict } from '../../src/student/predict';
import { createStudentStore, type StudentStore } from '../../src/student/store';
import { createPeerStore } from '../../src/sync/peer-store';
import { createRelayPeer } from '../../src/sync/relay';
import { defaultRelayUrl } from '../../src/config/deploy';

class Mem {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  get length() {
    return this.m.size;
  }
}

export type BotProfile = 'good' | 'slow' | 'idle';

export interface BotSpec {
  seat: number;
  /** 첫 이름과 거절됐을 때 쓸 다음 후보들 */
  names: string[];
  profile: BotProfile;
}

interface Bot {
  spec: BotSpec;
  store: StudentStore | null;
  storage: Mem;
  device: number;
  nameIdx: number;
  name: string;
  acts: number;
  joinTries: number;
  rejects: Record<string, number>;
  rollbacks: Record<string, number>;
  errors: string[];
  statusLog: { at: number; status: string; code: string | null }[];
  lastStatus: string;
  /** 라운드 중 할 수 있는 행동이 없던 시작 시각(빠른 시계) */
  noActionSince: number | null;
  noActionMaxMs: number;
  /** 떨어진 시각(drop) — 복귀 판정용 */
  droppedAt: number | null;
  backAt: number | null;
  inAfterBackAt: number | null;
  /** 응답을 미룬 사건(slow) */
  delayUntil: Record<string, number>;
  /** 학습지 팝업별 뜬 시각·끝낸 시각(빠른 시계) */
  wsLog: Record<string, { shown: number; done: number | null; during: boolean; closed?: number }>;
  /** 끊기기 직전·돌아온 직후 상태(잃은 것이 없는지 비교) */
  preDrop: Snap | null;
  postBack: Snap | null;
  lost: string[];
  unsub: (() => void) | null;
}

export interface Snap {
  money: number;
  loan: number;
  ship: string;
  port: string;
  cargo: string;
  missions: Record<string, { status: string; steps: boolean[] }>;
  worksheetDone: string[];
  duringDone: string[];
  responses: string[];
  lettersAnswered: string[];
  recipes: string[];
  checkQuiz: string[];
}

export interface BotStatus {
  seat: number;
  wsLog: Record<string, { shown: number; done: number | null; during: boolean; closed?: number }>;
  preDrop: Snap | null;
  postBack: Snap | null;
  lost: string[];
  loan: number | null;
  startMoney: number | null;
  ship: string | null;
  missions: Record<string, { status: string; steps: boolean[] }>;
  cargo: string;
  name: string;
  profile: BotProfile;
  status: string;
  err: string | null;
  founded: boolean;
  money: number | null;
  responses: string[];
  worksheetDone: string[];
  duringDone: string[];
  resolvedRound: number | null;
  ready: boolean;
  acts: number;
  joinTries: number;
  rejects: Record<string, number>;
  rollbacks: Record<string, number>;
  errors: string[];
  letters: number;
  lettersAnswered: number;
  noActionMaxMs: number;
  droppedAt: number | null;
  backAt: number | null;
  inAfterBackAt: number | null;
  versionMismatch: boolean;
  statusLog: { at: number; status: string; code: string | null }[];
}

/** 공개 상태 요약(오케스트레이터·탐지기가 씀) */
export interface PubSummary {
  serverNow: number;
  fastNow: number;
  phase: string;
  round: number;
  paused: boolean;
  tradeEnded: boolean;
  startedAt: number | null;
  endsAt: number | null;
  pausedTotalSec: number;
  pausedAt: number | null;
  durationSec: number;
  roundEndsAt: number | null;
  mode: string;
  waiting: string | null;
  timeUp: boolean;
  /** blocking = 화면 가운데를 막는 사건(차단형) — 학생 화면 사건 층이 정상인지 대조용 */
  event: { id: string; closed: boolean; blocking: boolean } | null;
  worksheet: { current: string[]; during: boolean };
  nextRoundAt: number | null;
  wrapLive: string | null;
  openPorts: string[];
  joined: number;
}

declare global {
  interface Window {
    __rb?: {
      init(o: { code: string; seed: number; appVersion: string; tickMs: number }): void;
      add(spec: BotSpec): void;
      drop(seat: number): void;
      back(seat: number, o?: { newDevice?: boolean; code?: string }): void;
      status(): BotStatus[];
      pub(): PubSummary | null;
      stop(): void;
    };
  }
}

const bots = new Map<number, Bot>();
let cfg = { code: '', seed: 135, appVersion: '', tickMs: 2000 };
let rand = rng(135);
let loop: ReturnType<typeof setInterval> | null = null;
const inc = (o: Record<string, number>, k: string) => (o[k] = (o[k] ?? 0) + 1);

function makeStore(b: Bot): StudentStore {
  const transport = createRelayPeer(defaultRelayUrl(location.href));
  let n = 0;
  const dev = b.device;
  const store = createStudentStore({
    transport,
    href: location.href,
    peerStore: createPeerStore({ storage: b.storage, randomToken: () => `rb${b.spec.seat}d${dev}x${String(++n)}abcdefghijklmnopqrstuvwxyz0123`.slice(0, 32) }),
    deviceToken: null,
    appVersion: cfg.appVersion || undefined,
    rejoinDelayMs: () => 300 + Math.floor(rand() * 1200),
  });
  b.unsub?.();
  const offSub = store.subscribe((st) => {
    const s = st.peer.status;
    const code = st.peer.errorCode ?? null;
    if (s !== b.lastStatus) {
      b.lastStatus = s;
      if (b.statusLog.length < 60) b.statusLog.push({ at: Date.now(), status: s, code });
      if (s === 'in' && b.backAt !== null && b.inAfterBackAt === null) b.inAfterBackAt = Date.now();
    }
  });
  const offEv = store.session.onEvent((e) => {
    if (e.type === 'rollback') inc(b.rollbacks, e.error ?? 'ROLLBACK');
    else if (e.type === 'queueFull') inc(b.rollbacks, 'QUEUE_FULL');
    else if (e.type === 'nameResult' && !e.ok) inc(b.rejects, e.error ?? 'NAME');
  });
  b.unsub = () => {
    offSub();
    offEv();
  };
  return store;
}

async function joinWithNames(b: Bot, code: string) {
  const store = b.store!;
  for (let tries = 0; tries < 6; tries++) {
    b.joinTries++;
    const r = await store.join(code, b.spec.seat, b.name);
    // 결과가 올 때까지(빠른 시계 기준) 기다린다
    for (let i = 0; i < 40; i++) {
      const s = store.getState().peer.status;
      if (s !== 'joining') break;
      await new Promise((res) => setTimeout(res, 250));
    }
    const st = store.getState().peer;
    if (st.status === 'in' || st.status === 'waitingApproval' || st.status === 'hostOffline') return;
    const code0 = r === 'LOCAL_CHECK' ? `${st.errorCode ?? 'LOCAL'}(기기 검사)` : st.errorCode ?? String(r);
    inc(b.rejects, code0);
    if (!/NAME|BAD_NAME/.test(code0)) {
      // 이름 문제가 아니면(방 없음 등) 잠깐 뒤 같은 이름으로
      await new Promise((res) => setTimeout(res, 3000));
      continue;
    }
    // 이름 다시 짓기: 제안 이름 → 다음 후보
    const sug = st.suggestions[0];
    if (sug && rand() < 0.5) b.name = sug;
    else {
      b.nameIdx = Math.min(b.nameIdx + 1, b.spec.names.length - 1);
      b.name = b.spec.names[b.nameIdx] ?? `${b.name}${b.spec.seat}`;
    }
  }
}

function canActInRound(b: Bot): boolean {
  const st = b.store?.getState();
  const me = st?.peer.me;
  const pub = st?.peer.public as PublicPayload | null | undefined;
  if (!me || !pub) return true;
  const cls = pub.class;
  if (me.game.ready) return true; // 출항 준비를 마쳤으면 '기다림'이 정상
  if (cls.openPorts.filter((p) => p !== me.game.port).length > 0) return true;
  try {
    const view = marketView(classForPredict(cls), playerForPredict(me), me.game.port);
    if (view.some((q) => q.buy !== null && q.buyLeft > 0 && q.buy <= me.game.money)) return true;
    if (me.game.cargo.some((lot) => view.some((q) => q.good === lot.good && q.sell !== null && !q.cannotSell))) return true;
  } catch {
    return true;
  }
  return false;
}

function snapOf(b: Bot): Snap | null {
  const me = b.store?.getState().peer.me;
  if (!me) return null;
  const g = me.game;
  return {
    money: g.money,
    loan: g.loan,
    ship: String(g.ship),
    port: String(g.port),
    cargo: JSON.stringify(g.cargo),
    missions: JSON.parse(JSON.stringify(g.missions ?? {})),
    worksheetDone: [...g.worksheetDone],
    duringDone: [...(g.duringDone ?? [])],
    responses: Object.keys(g.responses ?? {}),
    lettersAnswered: [...(g.letters?.answered ?? [])],
    recipes: [...(g.unlockedRecipes ?? [])],
    checkQuiz: Object.keys(g.checkQuiz ?? {}),
  };
}

/** 돌아온 뒤 잃은 것(있어야 하는데 없는 것) 목록 */
function lostOf(a: Snap, z: Snap): string[] {
  const out: string[] = [];
  const miss = (what: string, x: string[], y: string[]) => {
    const m = x.filter((i) => !y.includes(i));
    if (m.length) out.push(`${what} 사라짐: ${m.join(',')}`);
  };
  miss('학습지 완료', a.worksheetDone, z.worksheetDone);
  miss('지금 쓰기 완료', a.duringDone, z.duringDone);
  miss('사건 응답', a.responses, z.responses);
  miss('편지 답', a.lettersAnswered, z.lettersAnswered);
  miss('열린 제조법', a.recipes, z.recipes);
  miss('확인 퀴즈 답', a.checkQuiz, z.checkQuiz);
  for (const [id, m] of Object.entries(a.missions)) {
    const n = z.missions[id];
    if (!n) out.push(`임무 ${id} 사라짐`);
    else {
      if (m.status === 'done' && n.status !== 'done') out.push(`임무 ${id} 완료 취소됨`);
      m.steps.forEach((v, i) => { if (v && !n.steps[i]) out.push(`임무 ${id} ${i + 1}단계 체크 사라짐`); });
    }
  }
  if (a.ship !== z.ship) out.push(`배 바뀜: ${a.ship} → ${z.ship}`);
  return out;
}

function tick() {
  for (const b of bots.values()) {
    const store = b.store;
    if (!store) continue;
    const st = store.getState();
    const pub = st.peer.public as PublicPayload | null;
    // 학습지 팝업 기록·돌아온 직후 상태
    if (st.peer.status === 'in' && pub && st.peer.me) {
      const dur = Boolean(pub.class.worksheet.during);
      const doneList = dur ? (st.peer.me.game.duringDone ?? []) : st.peer.me.game.worksheetDone;
      for (const w of pub.class.worksheet.current ?? []) {
        const k = `${w}${dur ? '★' : ''}`;
        const e = (b.wsLog[k] ??= { shown: Date.now(), done: null, during: dur });
        if (e.done === null && doneList.includes(w)) e.done = Date.now();
      }
      const curKeys = new Set((pub.class.worksheet.current ?? []).map((w) => `${w}${dur ? '★' : ''}`));
      for (const [k, e] of Object.entries(b.wsLog)) if (e.closed === undefined && !curKeys.has(k)) e.closed = Date.now();
      if (b.backAt !== null && !b.postBack && st.peer.me.company.founded) {
        b.postBack = snapOf(b);
        if (b.preDrop && b.postBack) b.lost = lostOf(b.preDrop, b.postBack);
      }
    }
    // 라운드 중 행동 가능 여부(탐지기)
    if (st.peer.status === 'in' && pub && pub.class.phase === 'round' && !pub.class.paused) {
      if (canActInRound(b)) b.noActionSince = null;
      else {
        b.noActionSince ??= Date.now();
        b.noActionMaxMs = Math.max(b.noActionMaxMs, Date.now() - b.noActionSince);
      }
    } else b.noActionSince = null;
    if (rand() >= 0.5) continue;
    try {
      const a = botAction({ store }, rand);
      if (!a) continue;
      // 성격: 사건·학습지·퀴즈·편지 응답을 미루거나 안 함
      const isTask = a.type === 'respondEvent' || a.type === 'markWorksheetDone' || a.type === 'answerCheckQuiz' || a.type === 'answerLetter';
      if (isTask && b.spec.profile === 'idle' && rand() < 0.92) continue;
      if (a.type === 'markWorksheetDone' && b.spec.profile === 'good') {
        // 초6이 학습지를 쓰는 시간: 게임 시계로 50~140초(느린 아이는 아래 slow가 더 길게)
        b.delayUntil.ws ??= Date.now() + 50_000 + rand() * 90_000;
        if (Date.now() < b.delayUntil.ws) continue;
        delete b.delayUntil.ws;
      }
      if (isTask && b.spec.profile === 'slow') {
        const key = a.type === 'respondEvent' ? a.eventId : a.type;
        if (rand() < 0.5 && b.delayUntil[key] === undefined) b.delayUntil[key] = Number.POSITIVE_INFINITY; // 안 함
        b.delayUntil[key] ??= Date.now() + (a.type === 'markWorksheetDone' ? 90_000 + rand() * 120_000 : 20_000 + rand() * 30_000);
        if (Date.now() < b.delayUntil[key]!) continue;
      }
      const r = store.act(a);
      b.acts++;
      if (r !== 'sent' && r !== 'queued') inc(b.rollbacks, `ACT_${String(r)}`);
    } catch (e) {
      if (b.errors.length < 5) b.errors.push(String(e));
    }
  }
}

window.__rb = {
  init(o) {
    cfg = { ...cfg, ...o };
    rand = rng(o.seed);
    if (loop) clearInterval(loop);
    loop = setInterval(tick, cfg.tickMs);
  },
  add(spec) {
    const b: Bot = {
      spec,
      store: null,
      storage: new Mem(),
      device: 1,
      nameIdx: 0,
      name: spec.names[0]!,
      acts: 0,
      joinTries: 0,
      rejects: {},
      rollbacks: {},
      errors: [],
      statusLog: [],
      lastStatus: '',
      noActionSince: null,
      noActionMaxMs: 0,
      droppedAt: null,
      backAt: null,
      inAfterBackAt: null,
      delayUntil: {},
      wsLog: {},
      preDrop: null,
      postBack: null,
      lost: [],
      unsub: null,
    };
    bots.set(spec.seat, b);
    b.store = makeStore(b);
    void joinWithNames(b, cfg.code);
  },
  drop(seat) {
    const b = bots.get(seat);
    if (!b?.store) return;
    b.preDrop = snapOf(b);
    b.postBack = null;
    b.lost = [];
    b.unsub?.();
    b.unsub = null;
    b.store.dispose();
    b.store = null;
    b.droppedAt = Date.now();
    b.backAt = null;
    b.inAfterBackAt = null;
    b.lastStatus = 'dropped';
    b.statusLog.push({ at: Date.now(), status: 'dropped', code: null });
  },
  back(seat, o = {}) {
    const b = bots.get(seat);
    if (!b || b.store) return;
    b.backAt = Date.now();
    if (o.newDevice) {
      b.storage = new Mem();
      b.device++;
    }
    b.store = makeStore(b);
    if (o.newDevice || o.code) void joinWithNames(b, o.code ?? cfg.code);
    else if (!b.store.autoRejoin()) void joinWithNames(b, cfg.code);
  },
  status() {
    return [...bots.values()].map((b) => {
      const st = b.store?.getState();
      const me = st?.peer.me ?? null;
      let letters = 0;
      try {
        const pub = st?.peer.public as PublicPayload | null | undefined;
        if (me && pub) letters = mailbox(classForPredict(pub.class), playerForPredict(me)).length;
      } catch {
        /* 공개 상태가 덜 옴 */
      }
      return {
        seat: b.spec.seat,
        name: b.name,
        profile: b.spec.profile,
        status: st?.peer.status ?? 'dropped',
        err: st?.peer.errorCode ?? null,
        founded: Boolean(me?.company.founded),
        money: me ? me.game.money : null,
        responses: me ? Object.keys(me.game.responses) : [],
        worksheetDone: me ? [...me.game.worksheetDone] : [],
        duringDone: me ? [...(me.game.duringDone ?? [])] : [],
        resolvedRound: me?.game.resolvedRound ?? null,
        ready: Boolean(me?.game.ready),
        acts: b.acts,
        joinTries: b.joinTries,
        rejects: b.rejects,
        rollbacks: b.rollbacks,
        errors: b.errors,
        letters,
        lettersAnswered: me ? Object.keys(me.game.letters?.slots ?? {}).length : 0,
        noActionMaxMs: b.noActionMaxMs,
        droppedAt: b.droppedAt,
        backAt: b.backAt,
        inAfterBackAt: b.inAfterBackAt,
        versionMismatch: Boolean(st?.peer.versionMismatch),
        statusLog: b.statusLog,
        wsLog: b.wsLog,
        preDrop: b.preDrop,
        postBack: b.postBack,
        lost: b.lost,
        loan: me ? me.game.loan : null,
        startMoney: me ? me.game.startMoney : null,
        ship: me ? String(me.game.ship) : null,
        missions: me ? JSON.parse(JSON.stringify(me.game.missions ?? {})) : {},
        cargo: me ? JSON.stringify(me.game.cargo) : '',
      };
    });
  },
  pub() {
    for (const b of bots.values()) {
      const st = b.store?.getState();
      const pub = st?.peer.public as PublicPayload | null | undefined;
      if (!b.store || !st || st.peer.status !== 'in' || !pub) continue;
      const c = pub.class;
      const next = c.schedule.items.filter((it) => it.kind === 'round' && it.status === 'pending').sort((x, y) => x.at - y.at)[0];
      return {
        serverNow: b.store.serverNow(),
        fastNow: Date.now(),
        phase: c.phase,
        round: c.round,
        paused: c.paused,
        tradeEnded: c.tradeEnded,
        startedAt: c.clock.startedAt,
        endsAt: c.clock.endsAt,
        pausedTotalSec: c.clock.pausedTotalSec,
        pausedAt: c.clock.pausedAt,
        durationSec: c.clock.durationSec,
        roundEndsAt: c.roundEndsAt,
        mode: c.schedule.mode,
        waiting: c.schedule.waiting ?? null,
        timeUp: Boolean(c.schedule.timeUp),
        event: c.currentEvent ? { id: c.currentEvent.id, closed: Boolean(c.currentEvent.closed), blocking: eventsById[c.currentEvent.id] ? isBlocking(eventsById[c.currentEvent.id]!, Boolean(c.currentEvent.short)) : false } : null,
        worksheet: { current: [...(c.worksheet.current ?? [])], during: Boolean(c.worksheet.during) },
        nextRoundAt: next ? next.at : null,
        wrapLive: pub.wrapLive ?? null,
        openPorts: [...c.openPorts],
        joined: pub.public.companies.length,
      };
    }
    return null;
  },
  stop() {
    if (loop) clearInterval(loop);
    loop = null;
    for (const b of bots.values()) {
      b.unsub?.();
      b.store?.dispose();
      b.store = null;
    }
  },
};
document.getElementById('out')!.textContent = 'bots ready';
