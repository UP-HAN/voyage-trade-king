/**
 * 작업 135 리허설 — 실제 학생 화면(브라우저) 학생 한 명의 "두뇌". 화면 testid와 보이는 글자만 보고 사람처럼 다음 행동을 한다.
 * 앱 내부 상태를 읽지 않으므로 134(라운드 시작 UX) 같은 화면 변화에도 견딘다: 모르는 화면은 건너뛰고 탐지기가 판단한다.
 */
import type { Page } from '@playwright/test';
import { finishMinigame } from '../../e2e/support/voyage-ui';

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
  letterOpen: boolean;
  portScreen: boolean;
  notTrading: boolean;
  enterPort: boolean;
  setReady: 'none' | 'enabled' | 'disabled';
  readyNote: boolean;
  bottomStatus: string;
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
        letterOpen: v('letter-panel') || v('letter-read') || v('letter-sheet'),
        portScreen: v('port-screen'),
        notTrading: v('not-trading'),
        enterPort: v('enter-port'),
        setReady: !vis(sr) ? 'none' : sr!.disabled ? 'disabled' : 'enabled',
        readyNote: v('ready-note'),
        bottomStatus: (q('[data-testid="bottom-status"]')?.innerText ?? '').trim().slice(0, 80),
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
  return Boolean(pr.minigame || pr.cardConfirmEnabled || pr.decision || pr.quiz || (pr.worksheet && pr.worksheetDone) || pr.catchup || pr.founding || pr.letters > 0);
}

/** 라운드 중 거래·출항에 쓸 수 있는 조작이 보이는가 */
export function canTrade(pr: StudentProbe): boolean {
  return pr.enterPort || pr.setReady === 'enabled' || pr.readyNote || pr.portScreen;
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
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 화면 상태를 보고 한 가지 행동을 한다(했으면 그 이름). 실패는 삼킨다(탐지기가 화면 상태로 판단) */
export async function studentStep(p: Page, pr: StudentProbe, o: BrainOpts, mem: { seen: Set<string>; delayUntil: Map<string, number>; readyRound: number; fails: Map<string, number>; failWhy: Map<string, string>; failAt: Map<string, number[]> }): Promise<string | null> {
  let doing = '';
  const click = async (id: string) => {
    doing = id;
    await p.getByTestId(id).first().click({ timeout: 3000 });
  };
  const later = (key: string, ms: number) => {
    // 덜 성실한 학생은 할 일을 조금 미룬다(빠른 시계 ms)
    const now = Date.now();
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
        await p.locator('[data-testid="catchup"] [data-testid="card-confirm"]').first().click({ timeout: 3000 });
        return 'catchup-card';
      }
    }
    if (pr.worksheet) {
      mem.seen.add(`ws:${pr.worksheetDuring ? 'during' : 'popup'}`);
      if (pr.worksheetDone && !later(`ws${pr.text.slice(0, 30)}`, 25_000)) {
        await click('worksheet-done');
        return 'worksheet-done';
      }
      return null;
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
        await opts.nth(Math.floor(o.rand() * n)).click({ timeout: 3000 });
        await p.getByTestId('decision-submit').first().click({ timeout: 3000 });
        return 'decision';
      }
    }
    if (pr.quiz) {
      const btns = p.locator('[data-testid="quiz-q"]:not([data-result="right"]):not([data-result="wrong"]) button:visible');
      const n = await btns.count();
      if (n > 0) {
        await btns.nth(Math.floor(o.rand() * Math.min(n, 3))).click({ timeout: 3000 });
        return 'quiz';
      }
    }
    if (pr.cardConfirmEnabled) {
      if (later(`card${pr.card}`, 15_000)) return null;
      await p.locator('[data-testid="card-confirm"]:visible').first().click({ timeout: 3000 });
      return `card ${pr.card ?? ''}`;
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
    if (pr.letters > 0 && !pr.tradeOver) {
      mem.seen.add('letter');
      if (later(`letter${pr.letters}`, 30_000)) return null;
      await click('hud-letters');
      await sleep(300);
      const item = p.locator('[data-testid="letter-item"]').first();
      if (await item.isVisible().catch(() => false)) await item.click({ timeout: 3000 });
      const choices = p.getByTestId('letter-choice');
      const n = await choices.count();
      if (n > 0) await choices.nth(Math.floor(o.rand() * n)).click({ timeout: 3000 });
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
        const port = ports[Math.floor(o.rand() * ports.length)]!;
        const hit = p.locator(`.wm-port[data-port="${port}"] .wm-port-hit`);
        const box = await hit.boundingBox().catch(() => null);
        const vp = p.viewportSize();
        if (!box || !vp || box.y + box.height / 2 > vp.height - 100 || box.x < 0 || box.x > vp.width) await p.getByRole('button', { name: '전체 보기' }).click({ timeout: 2000 }).catch(() => undefined);
        doing = `항구 ${port}`;
        // 다른 회사 배 표지가 항구 위에 겹쳐 있으면 사람은 항구 둘레를 누른다 — 도구는 강제 클릭
        await hit.click({ timeout: 3000, force: true });
        const ok = await p.getByTestId('pick-panel').getAttribute('data-kind', { timeout: 2000 }).catch(() => null);
        if (ok === 'ok') await click('pick-confirm');
        else await p.keyboard.press('Escape').catch(() => undefined);
      }
      if (await p.getByTestId('set-ready').isEnabled({ timeout: 1000 }).catch(() => false)) {
        await click('set-ready');
        return 'set-ready';
      }
      return 'dest';
    }
  } catch (e) {
    const msg = String(e);
    const cover = /<[^\n]{0,200}intercepts pointer events/.exec(msg)?.[0];
    const why = cover ? ` — 가림: ${cover.slice(0, 180)}` : (/not visible|not stable|outside of the viewport|not enabled/.exec(msg)?.[0] ?? '');
    o.log(`${o.label} 조작 실패(${doing || '?'}): ${msg.split('\n')[0]!.slice(0, 100)}${why ? ` ${why}` : ''}`);
    mem.fails.set(doing, (mem.fails.get(doing) ?? 0) + 1);
    mem.failAt.set(doing, [...(mem.failAt.get(doing) ?? []).slice(-5), Date.now()]);
    mem.failWhy.set(doing, `${msg.split('\n')[0]!.slice(0, 100)}${why}`);
  }
  return null;
}
