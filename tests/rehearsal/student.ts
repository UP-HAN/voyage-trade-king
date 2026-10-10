/**
 * 작업 135 리허설 — 실제 학생 화면(브라우저) 학생 한 명의 "두뇌". 화면 testid와 보이는 글자만 보고 사람처럼 다음 행동을 한다.
 * 앱 내부 상태를 읽지 않으므로 134(라운드 시작 UX) 같은 화면 변화에도 견딘다: 모르는 화면은 건너뛰고 탐지기가 판단한다.
 */
import type { Locator, Page } from '@playwright/test';
import { finishMinigame } from '../../e2e/support/voyage-ui';
import { isNormalCover, type CoverInfo } from './detector';

/** 학생 화면 한 번 훑기(한 번의 evaluate) */
export interface StudentProbe {
  url: string;
  entry: boolean;
  entryError: string | null;
  waitingApproval: boolean;
  founding: boolean;
  prepWait: boolean;
  inGame: boolean;
  paused: boolean;
  tradeOver: boolean;
  wrap: string;
  wrapAwards: boolean;
  wrapReflect: boolean;
  roomClosed: boolean;
  kicked: boolean;
  moved: boolean;
  minigame: string | null;
  card: string | null;
  cardConfirmEnabled: boolean;
  decision: boolean;
  quiz: boolean;
  worksheet: boolean;
  worksheetDuring: boolean;
  worksheetDone: boolean;
  catchup: boolean;
  eventWaiting: boolean;
  eventPanel: string | null;
  tutorial: boolean;
  lightPopup: boolean;
  letters: number;
  /** 편지 아이콘이 지금 눌릴 수 있음(층에 덮이지 않음·inert 아님) */
  lettersClickable: boolean;
  letterOpen: boolean;
  /** 화면을 덮은 맨 위 층(dim 층 data-layer: event·minigame·worksheet·pause·nameBlocked, 없으면 화면 가운데 창 'modal'), 없으면 null */
  topLayer: string | null;
  /** 사건 층에 마감 결과(event-result)가 떠 있음 */
  eventResult: boolean;
  /** (수정 1) 거래·출항 핵심 버튼이 '보이고 실제로 눌리는가'(가운데 점 elementFromPoint 맞힘) */
  enterPortClickable: boolean;
  setReadyClickable: boolean;
  portScreenClickable: boolean;
  /** 핵심 버튼이 보이는데 눌리지 않을 때 그 위의 맨 위 요소 설명 */
  blockedTop: string | null;
  portScreen: boolean;
  notTrading: boolean;
  enterPort: boolean;
  setReady: 'none' | 'enabled' | 'disabled';
  readyNote: boolean;
  bottomStatus: string;
  /** 라운드 전·사이 상태 카드(round-wait-card)의 남은 시간 줄 — 카드가 안 보이면 null */
  roundWaitLine: string | null;
  money: string | null;
  company: string | null;
  hostWait: boolean;
  text: string;
}

export async function probeStudent(p: Page): Promise<StudentProbe | null> {
  try {
    return await p.evaluate(() => {
      const q = (s: string) => document.querySelector(s) as HTMLElement | null;
      const vis = (el: Element | null) => {
        if (!el) return false;
        const h = el as HTMLElement;
        const r = h.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        const cs = getComputedStyle(h);
        if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false;
        if (h.closest('[inert]')) return false;
        return true;
      };
      const v = (id: string) => vis(q(`[data-testid="${id}"]`));
      const card = [...document.querySelectorAll('[data-testid="event-card"],[data-testid="decision-card"],[data-testid="quiz-card"]')].find(vis) as HTMLElement | undefined;
      const conf = [...document.querySelectorAll('[data-testid="card-confirm"]')].find(vis) as HTMLButtonElement | undefined;
      const mg = q('[data-testid="minigame"]');
      const ws = q('[data-testid="worksheet-popup"]');
      const sr = q('[data-testid="set-ready"]') as HTMLButtonElement | null;
      const to = q('[data-testid="trade-over"]');
      const panel = q('[data-testid="event-panel"]');
      const lt = q('[data-testid="hud-letters"]');
      // 화면을 덮은 dim 층 가운데 z가 가장 높은 것
      let topLayer: string | null = null;
      let topZ = -1;
      for (const el of document.querySelectorAll('.st-layer--dim[data-layer]')) {
        if (!vis(el)) continue;
        const z = Number(getComputedStyle(el).zIndex) || 0;
        if (z > topZ) {
          topZ = z;
          topLayer = el.getAttribute('data-layer');
        }
      }
      // 화면 가운데 창(aria-modal — 라운드 밖 항구 카드 등)은 dim 층이 없을 때 맨 위
      if (!topLayer && [...document.querySelectorAll('.st-modal[aria-modal="true"]')].some(vis)) topLayer = 'modal';
      const desc = (e: Element) => {
        const c = (e as HTMLElement).className;
        const cls = typeof c === 'string' && c ? ` class="${c.slice(0, 50)}"` : '';
        const tid = e.getAttribute('data-testid') ? ` data-testid="${e.getAttribute('data-testid')}"` : '';
        const lay = e.getAttribute('data-layer') ? ` data-layer="${e.getAttribute('data-layer')}"` : '';
        const id = e.id ? ` id="${e.id}"` : '';
        return `<${e.tagName.toLowerCase()}${id}${cls}${tid}${lay}>`;
      };
      let blockedTop: string | null = null;
      /** 보이고, 가운데 점의 맨 위 요소가 자기(또는 자손)인가. 가운데가 화면 밖이면 보이는 것으로 충분(스크롤) */
      const hit = (el: Element | null) => {
        if (!el || !vis(el)) return false;
        const r = el.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return true;
        const top = document.elementFromPoint(x, y);
        const ok = Boolean(top && (top === el || el.contains(top)));
        if (!ok && !blockedTop) blockedTop = top ? `${desc(top)}${top.parentElement ? ` < ${desc(top.parentElement)}` : ''}` : '(없음 — pointer-events:none?)';
        return ok;
      };
      const ltClickable = hit(lt);
      const srEl = vis(sr) && !sr!.disabled ? sr : null;
      const enterPortClickable = hit(q('[data-testid="enter-port"]'));
      const setReadyClickable = hit(srEl);
      const portScreenClickable = v('port-screen') && hit(q('[data-testid="port-back"]') ?? q('[data-testid="port-screen"]'));
      return {
        url: location.href,
        entry: v('student-entry'),
        entryError: q('[data-testid="entry-error"]')?.getAttribute('data-code') ?? (v('entry-error') ? 'shown' : null),
        waitingApproval: v('entry-waiting-approval'),
        founding: v('found-company'),
        prepWait: v('prep-wait'),
        inGame: v('student-game') || v('hud'),
        paused: v('pause-overlay'),
        tradeOver: vis(to),
        wrap: to?.getAttribute('data-wrap') ?? '',
        wrapAwards: v('wrap-awards'),
        wrapReflect: v('wrap-reflect'),
        roomClosed: v('student-room-closed'),
        kicked: v('student-kicked'),
        moved: v('student-moved'),
        minigame: vis(mg) ? mg!.getAttribute('data-event') ?? '?' : null,
        card: card ? card.getAttribute('data-event') ?? card.getAttribute('data-testid') : null,
        cardConfirmEnabled: Boolean(conf && !conf.disabled),
        decision: Boolean([...document.querySelectorAll('[data-testid^="decision-opt-"]')].find((e) => vis(e) && !(e as HTMLButtonElement).disabled && e.tagName === 'BUTTON')),
        quiz: Boolean([...document.querySelectorAll('[data-testid="quiz-q"]')].find((e) => vis(e) && !e.getAttribute('data-result'))),
        worksheet: vis(ws),
        worksheetDuring: ws?.getAttribute('data-during') === '1',
        worksheetDone: v('worksheet-done'),
        catchup: v('catchup'),
        eventWaiting: v('event-waiting'),
        eventPanel: vis(panel) ? panel!.getAttribute('data-event') : null,
        tutorial: v('tutorial'),
        lightPopup: v('port-card-ok') || v('concept-ok') || v('event-result-close'),
        letters: Number(lt?.getAttribute('data-count') ?? 0) || 0,
        lettersClickable: ltClickable,
        topLayer,
        eventResult: v('event-result'),
        enterPortClickable,
        setReadyClickable,
        portScreenClickable,
        blockedTop,
        letterOpen: v('letter-panel') || v('letter-read') || v('letter-sheet'),
        portScreen: v('port-screen'),
        notTrading: v('not-trading'),
        enterPort: v('enter-port'),
        setReady: !vis(sr) ? 'none' : sr!.disabled ? 'disabled' : 'enabled',
        readyNote: v('ready-note'),
        bottomStatus: (q('[data-testid="bottom-status"]')?.innerText ?? '').trim().slice(0, 80),
        roundWaitLine: vis(q('[data-testid="round-wait-card"]')) ? (q('[data-testid="round-wait-line"]')?.innerText ?? '').trim().slice(0, 80) : null,
        money: q('[data-testid="hud-money"]')?.innerText ?? null,
        company: q('[data-testid="hud-company"]')?.innerText ?? null,
        hostWait: v('band-hostWait'),
        text: document.body.innerText.slice(0, 4000),
      };
    });
  } catch {
    return null;
  }
}

/** 지금 학생이 '할 일'이 화면에 떠 있는가(활동·카드·팝업·편지·따라잡기) */
export function hasTask(pr: StudentProbe): boolean {
  // 편지는 아이콘이 실제로 눌릴 때만 할 일(수정 1)
  return Boolean(pr.minigame || pr.cardConfirmEnabled || pr.decision || pr.quiz || (pr.worksheet && pr.worksheetDone) || pr.catchup || pr.founding || (pr.letters > 0 && pr.lettersClickable));
}

/** 라운드 중 거래·출항에 쓸 수 있는 조작이 '보이고 실제로 눌리는가'(수정 1: 투명 층·남은 층·pointer-events:none이 덮으면 아님). readyNote = 이미 출항 준비함 */
export function canTrade(pr: StudentProbe): boolean {
  return pr.enterPortClickable || pr.setReadyClickable || pr.readyNote || pr.portScreenClickable;
}

export interface BrainOpts {
  label: string;
  /** 0~1: 높을수록 빨리·성실하게 */
  diligence: number;
  rand: () => number;
  /** 이번 판 열린 항구(오케스트레이터가 공개 상태에서 넣어 줌) */
  ports: () => string[];
  phase: () => string | null;
  log: (s: string) => void;
  /** 게임 시계(빠른 시계 ms) — 학생이 할 일을 미루는 시간(later)을 게임 시간으로 잰다. 없으면 실제 시간 */
  now?: () => number;
  /** (수정 1) 핵심 버튼(거래·출항·학습지 다 썼어요)이 정상 층이 아닌 것에 가려 눌리지 않음 — 즉시 [문제]로 올림 */
  blockedClick?: (id: string, top: string, shots: string[]) => void;
  /** 스크린숏(정상 층이 아닌 것에 가렸을 때 첨부) */
  shot?: (name: string) => Promise<string[]>;
}

export interface BrainMem {
  seen: Set<string>;
  delayUntil: Map<string, number>;
  readyRound: number;
  fails: Map<string, number>;
  failWhy: Map<string, string>;
  failAt: Map<string, number[]>;
  /** (보완 1) 정상 층(사건·학습지 등)에 가려 층을 먼저 처리한 횟수 — 키 "버튼@층" */
  layerFirst: Map<string, number>;
  /** (보완 1) 정상 층이 아닌 것에 가렸을 때 맨 위 요소·스크린숏 */
  coverTop: Map<string, string>;
  coverShots: Map<string, string[]>;
}

export function newBrainMem(): BrainMem {
  return { seen: new Set(), delayUntil: new Map(), readyRound: 0, fails: new Map(), failWhy: new Map(), failAt: new Map(), layerFirst: new Map(), coverTop: new Map(), coverShots: new Map() };
}

/** 누르려는 요소의 가운데를 맨 위에서 덮은 요소(없으면 null). 화면 밖·크기 0이면 null(클릭이 스크롤로 해결) */
export async function coverOf(loc: Locator): Promise<CoverInfo | null> {
  return loc
    .evaluate(
      (el) => {
        const desc = (e: Element) => {
          const c = (e as HTMLElement).className;
          const cls = typeof c === 'string' && c ? ` class="${c.slice(0, 60)}"` : '';
          const tid = e.getAttribute('data-testid') ? ` data-testid="${e.getAttribute('data-testid')}"` : '';
          const lay = e.getAttribute('data-layer') ? ` data-layer="${e.getAttribute('data-layer')}"` : '';
          const txt = ((e as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 30);
          return `<${e.tagName.toLowerCase()}${cls}${tid}${lay}>${txt ? `「${txt}」` : ''}`;
        };
        const inert = Boolean(el.closest('[inert]'));
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return null;
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return null;
        const top = document.elementFromPoint(x, y);
        // 맨 위가 자기 자신·자손이거나 자기 조상(창 안에서 스크롤해야 보이는 버튼 등 — 클릭이 스크롤로 해결)이면 가림 아님
        if (!top || top === el || el.contains(top) || top.contains(el)) return inert ? { layer: null, inert, top: desc(el), chain: '(inert)' } : null;
        const chain: string[] = [];
        for (let a: Element | null = top; a && a !== document.body && chain.length < 6; a = a.parentElement) chain.push(desc(a));
        const layerEl = top.closest('[data-layer]');
        const panel = top.closest('[data-testid="event-panel"]');
        const modal = top.closest('.st-modal[aria-modal="true"]');
        return { layer: layerEl?.getAttribute('data-layer') ?? (panel ? 'event-panel' : modal ? 'modal' : null), inert, top: desc(top), chain: chain.join(' < ') };
      },
      undefined,
      { timeout: 1500 },
    )
    .catch(() => null);
}

/** 수업 진행에 꼭 필요한 버튼(가려서 안 눌리면 앱 문제) */
const CORE_BUTTONS = /^(enter-port|set-ready|pick-confirm|worksheet-done|항구 )/;

/** 정상 층에 가려 눌리지 않음 — 학생처럼 층을 먼저 처리한다(실패 아님) */
class LayerFirst extends Error {
  constructor(readonly cover: CoverInfo) {
    super('layer-first');
  }
}
/** 정상 층이 아닌 것에 가려 눌리지 않음(도구 문제 또는 앱 문제 — 맨 위 요소 첨부) */
class BadCover extends Error {
  constructor(
    readonly cover: CoverInfo,
    msg: string,
  ) {
    super(msg);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 화면 상태를 보고 한 가지 행동을 한다(했으면 그 이름). 실패는 삼킨다(탐지기가 화면 상태로 판단) */
export async function studentStep(p: Page, pr: StudentProbe, o: BrainOpts, mem: BrainMem): Promise<string | null> {
  let doing = '';
  /** 누르기 전에 가림을 보고, 정상 층이면 LayerFirst(층 먼저), 아니면 누른다. 누르다 가림으로 실패하면 다시 보고 가른다 */
  const clickLoc = async (id: string, loc: Locator) => {
    doing = id;
    const cv = await coverOf(loc);
    if (cv && isNormalCover(cv)) throw new LayerFirst(cv);
    try {
      await loc.click({ timeout: 3000 });
    } catch (e) {
      const m = String(e);
      if (/intercepts pointer events/.test(m)) {
        const cv2 = await coverOf(loc);
        if (cv2 && isNormalCover(cv2)) throw new LayerFirst(cv2);
        if (cv2) throw new BadCover(cv2, m);
        // 다시 봤을 때 이미 사라졌으면 Playwright 메시지로 가른다(층이 잠깐 떴다 사라진 경우)
        const ml = /data-layer="(\w+)"/.exec(m)?.[1] ?? (/st-modal/.test(m) ? 'modal' : null);
        const fromMsg = { layer: ml, inert: false, top: '(Playwright 메시지)', chain: m.slice(0, 200) };
        if (ml && isNormalCover(fromMsg)) throw new LayerFirst(fromMsg);
      }
      throw e;
    }
  };
  const click = (id: string) => clickLoc(id, p.getByTestId(id).first());
  const later = (key: string, ms: number) => {
    // 덜 성실한 학생은 할 일을 조금 미룬다(게임 시계 ms — 빠른 시계면 실제 시간으로는 1/배속)
    const now = (o.now ?? Date.now)();
    if (!mem.delayUntil.has(key)) mem.delayUntil.set(key, now + ms * (1 - o.diligence) * (0.5 + o.rand()));
    return now < mem.delayUntil.get(key)!;
  };
  try {
    if (pr.founding) {
      await click('found-submit');
      return 'found';
    }
    if (pr.paused || pr.roomClosed || pr.kicked || pr.moved || pr.entry || pr.waitingApproval) return null;
    if (pr.tutorial) {
      await p.getByTestId('tutorial-skip').click({ timeout: 2000 }).catch(() => p.getByTestId('tutorial-close').click({ timeout: 2000 }));
      return 'tutorial-skip';
    }
    // 학습지 층(z 70)은 사건·따라잡기 층(z 60) 위 — 학습지부터(실제 학생도 위에 뜬 것부터 한다)
    if (pr.worksheet) {
      mem.seen.add(`ws:${pr.worksheetDuring ? 'during' : 'popup'}`);
      if (pr.worksheetDone && !later(`ws${pr.text.slice(0, 30)}`, 25_000)) {
        await click('worksheet-done');
        return 'worksheet-done';
      }
      return null;
    }
    if (pr.catchup) {
      for (const id of ['catchup-ok', 'catchup-next']) {
        if (await p.getByTestId(id).isVisible().catch(() => false)) {
          await click(id);
          return id;
        }
      }
      if (pr.minigame) {
        await finishMinigame(p);
        return `catchup-minigame ${pr.minigame}`;
      }
      if (pr.cardConfirmEnabled) {
        await clickLoc('catchup-card', p.locator('[data-testid="catchup"] [data-testid="card-confirm"]').first());
        return 'catchup-card';
      }
    }
    if (pr.minigame) {
      if (later(`mg${pr.minigame}`, 30_000)) return null;
      if (pr.minigame === 'L1-E1' || pr.minigame === 'L1-E5') await finishMinigame(p);
      else if (await p.getByTestId('minigame-finish').isVisible().catch(() => false)) await click('minigame-finish');
      else await p.getByTestId('minigame-close').click({ timeout: 2000 });
      return `minigame ${pr.minigame}`;
    }
    if (pr.decision) {
      if (later(`dec${pr.card ?? pr.eventPanel}`, 25_000)) return null;
      const opts = p.locator('button[data-testid^="decision-opt-"]:visible');
      const n = await opts.count();
      if (n > 0) {
        await clickLoc('decision-opt', opts.nth(Math.floor(o.rand() * n)));
        await click('decision-submit');
        return 'decision';
      }
    }
    if (pr.quiz) {
      const btns = p.locator('[data-testid="quiz-q"]:not([data-result="right"]):not([data-result="wrong"]) button:visible');
      const n = await btns.count();
      if (n > 0) {
        await clickLoc('quiz-answer', btns.nth(Math.floor(o.rand() * Math.min(n, 3))));
        return 'quiz';
      }
    }
    if (pr.cardConfirmEnabled) {
      if (later(`card${pr.card}`, 15_000)) return null;
      await clickLoc('card-confirm', p.locator('[data-testid="card-confirm"]:visible').first());
      return `card ${pr.card ?? ''}`;
    }
    // 화면을 덮은 층이 있는데 위에서 할 일을 못 찾았으면: 층 안의 [닫기]만 누르고, 없으면 기다린다(층 아래 버튼은 누르지 않는다)
    if (pr.topLayer === 'modal') {
      // 화면 가운데 창: 창 안의 확인 버튼 또는 [닫기]
      const ok = p.locator('.st-modal[aria-modal="true"] [data-testid="port-card-ok"]:visible, .st-modal[aria-modal="true"] .st-modal__head [aria-label="닫기"]:visible').first();
      if (await ok.isVisible().catch(() => false)) {
        await clickLoc('modal-close', ok);
        return 'modal-close';
      }
      return null;
    }
    if (pr.topLayer) {
      const close = p.locator(`[data-layer="${pr.topLayer}"] [data-testid="event-result-close"]:visible`).first();
      if (await close.isVisible().catch(() => false)) {
        await clickLoc('event-result-close', close);
        return 'layer-close';
      }
      return null;
    }
    // 가벼운 창: 세 번 넘게 안 눌리면(가려짐 등) 더 매달리지 않고 다른 할 일로 넘어간다 — 실패 수는 runner가 보고서에 남긴다
    // 최근(실제 30초) 세 번 넘게 안 눌린 창은 잠시 건너뛴다
    const recentFails = (id: string) => (mem.failAt.get(id) ?? []).filter((x) => Date.now() - x < 30_000).length;
    const light = ['port-card-ok', 'concept-ok', 'event-result-close'].filter((id) => recentFails(id) < 3);
    if (pr.lightPopup && light.length) {
      let did = false;
      for (const id of light)
        if (await p.getByTestId(id).isVisible().catch(() => false)) {
          await click(id);
          did = true;
        }
      if (did) return 'dismiss';
    }
    if (pr.letters > 0 && !pr.tradeOver && pr.lettersClickable) {
      mem.seen.add('letter');
      if (later(`letter${pr.letters}`, 30_000)) return null;
      await click('hud-letters');
      await sleep(300);
      const item = p.locator('[data-testid="letter-item"]').first();
      if (await item.isVisible().catch(() => false)) await clickLoc('letter-item', item);
      const choices = p.getByTestId('letter-choice');
      const n = await choices.count();
      if (n > 0) await clickLoc('letter-choice', choices.nth(Math.floor(o.rand() * n)));
      for (const id of ['letter-ack', 'letter-close']) if (await p.getByTestId(id).isVisible().catch(() => false)) await click(id).catch(() => undefined);
      return 'letter';
    }
    if (pr.tradeOver) {
      if (pr.wrapAwards) mem.seen.add('wrap-awards');
      if (pr.wrapReflect) mem.seen.add('wrap-reflect');
      mem.seen.add('trade-over');
      return null;
    }
    // 라운드: 사고팔기 → 목적지 → 출항 준비(라운드마다 한 번)
    if (o.phase() === 'round' && !pr.readyNote && pr.inGame) {
      if (later(`round${o.phase()}${pr.bottomStatus}`, 20_000)) return null;
      if (o.rand() < 0.5 && pr.enterPort && !pr.portScreen) {
        await click('enter-port');
        await sleep(400);
        const buy = p.locator('[data-testid^="buy-card-"] button[data-testid^="buy-"]:not([data-testid$="-plus"]):not([data-testid$="-minus"]):enabled');
        if ((await buy.count()) > 0) await buy.first().click({ timeout: 2000 }).catch(() => undefined);
        await p.getByTestId('port-back').click({ timeout: 2000 }).catch(() => undefined);
        return 'trade';
      }
      if (pr.portScreen) await p.getByTestId('port-back').click({ timeout: 2000 }).catch(() => undefined);
      const ports = o.ports();
      if (ports.length) {
        // 화면 안(아래 막대 위)에 보이는 항구만 누른다 — 사람은 화면 밖 항구를 누르지 않고 지도를 옮기거나 다른 항구를 고른다
        const vp = p.viewportSize();
        const inView = async (x: string) => {
          const b = await p.locator(`.wm-port[data-port="${x}"] .wm-port-hit`).boundingBox().catch(() => null);
          return Boolean(b && vp && b.x >= 0 && b.y >= 0 && b.x + b.width <= vp.width && b.y + b.height / 2 <= vp.height - 100);
        };
        let port = ports[Math.floor(o.rand() * ports.length)]!;
        if (!(await inView(port))) {
          await p.getByRole('button', { name: '전체 보기' }).click({ timeout: 2000 }).catch(() => undefined);
          await sleep(500);
          const seen: string[] = [];
          for (const x of ports) if (await inView(x)) seen.push(x);
          if (!seen.length) {
            mem.layerFirst.set('항구@화면 밖', (mem.layerFirst.get('항구@화면 밖') ?? 0) + 1);
            port = '';
          } else if (!seen.includes(port)) {
            mem.layerFirst.set(`항구 ${port}@화면 밖`, (mem.layerFirst.get(`항구 ${port}@화면 밖`) ?? 0) + 1);
            port = seen[Math.floor(o.rand() * seen.length)]!;
          }
        }
        if (port) {
          const hit = p.locator(`.wm-port[data-port="${port}"] .wm-port-hit`);
          doing = `항구 ${port}`;
          // 다른 회사 배 표지가 항구 위에 겹쳐 있으면 사람은 항구 둘레를 누른다 — 도구는 강제 클릭
          await hit.click({ timeout: 3000, force: true });
          const ok = await p.getByTestId('pick-panel').getAttribute('data-kind', { timeout: 2000 }).catch(() => null);
          if (ok === 'ok') await click('pick-confirm');
          else await p.keyboard.press('Escape').catch(() => undefined);
        }
      }
      if (await p.getByTestId('set-ready').isEnabled({ timeout: 1000 }).catch(() => false)) {
        await click('set-ready');
        return 'set-ready';
      }
      return 'dest';
    }
  } catch (e) {
    if (e instanceof LayerFirst) {
      // 정상 흐름: 층(사건·학습지·편지 등)이 위에 있다 — 층에 답할 일이 있으면 다음 훑기에서 하고, 없으면 기다린다
      const k = `${doing}@${e.cover.layer ?? 'inert'}`;
      const n = (mem.layerFirst.get(k) ?? 0) + 1;
      mem.layerFirst.set(k, n);
      if (n === 1) o.log(`${o.label} [${doing}] 앞에 ${e.cover.layer ?? 'inert'} 층 — 층 먼저(정상 흐름)`);
      if (e.cover.layer === 'letter') await p.getByTestId('letter-close').first().click({ timeout: 2000 }).catch(() => undefined);
      // 화면 가운데 창(항구 카드 등 aria-modal): 학생은 창을 닫고 하던 일을 한다
      if (e.cover.layer === 'modal') await p.locator('.st-modal[aria-modal="true"] .st-modal__head [aria-label="닫기"]').first().click({ timeout: 2000 }).catch(() => undefined);
      return 'layer-first';
    }
    if (e instanceof BadCover) {
      mem.coverTop.set(doing, `${e.cover.top} — 조상: ${e.cover.chain}`);
      if (!mem.coverShots.has(doing) && o.shot) mem.coverShots.set(doing, await o.shot(`cover-${doing}`));
      if (CORE_BUTTONS.test(doing)) o.blockedClick?.(doing, `${e.cover.top} — 조상: ${e.cover.chain}`, mem.coverShots.get(doing) ?? []);
    }
    const msg = String(e);
    const cover = /<[^\n]{0,200}intercepts pointer events/.exec(msg)?.[0];
    const why = e instanceof BadCover ? ` — 가림(맨 위 요소): ${e.cover.top}` : cover ? ` — 가림: ${cover.slice(0, 180)}` : (/not visible|not stable|outside of the viewport|not enabled/.exec(msg)?.[0] ?? '');
    o.log(`${o.label} 조작 실패(${doing || '?'}): ${msg.split('\n')[0]!.slice(0, 100)}${why ? ` ${why}` : ''}`);
    mem.fails.set(doing, (mem.fails.get(doing) ?? 0) + 1);
    mem.failAt.set(doing, [...(mem.failAt.get(doing) ?? []).slice(-5), Date.now()]);
    mem.failWhy.set(doing, `${msg.split('\n')[0]!.slice(0, 100)}${why}`);
  }
  return null;
}
