/**
 * 작업 114 e2e 전용 "빨리 감기 시계" — 빌드에 들어가지 않는다(Playwright `addInitScript`로만 페이지에 넣는다).
 *
 * 왜: 실제 중계 서버(relay)를 거치는 판은 Playwright 가짜 시계(`context.clock`)를 쓰면 서버 시각 보정(ping/pong)·
 * 끊김 감지(staleAfter)가 어긋난다. 그래서 브라우저마다 같은 "빠른 시각" 함수를 깔고(교사·공용 화면·학생 모두 같은 함수),
 * 서버가 보낸 pong의 serverNow를 그 빠른 시각으로 바꿔(오프셋 0) 게임 시계 = 빠른 시각이 되게 한다.
 * 서버 자체는 실제 시각으로 돈다(방 수명·속도 제한 등은 실제 시간 — 판 길이에 비해 충분히 길다).
 *
 * - 빠른 시각 = 구간(segments) 함수: 실제 시각 real0부터 fast0 + (real − real0) × speed. 구간은 시험이 바꾼다(`setSpeed`).
 *   모든 페이지·문맥이 같은 구간 목록을 쓰므로(실제 시각이 같은 PC) 시각이 서로 맞는다.
 * - Date / Date.now / performance.now / setTimeout / setInterval(clear 포함)을 바꾼다. 타이머는 "빠른 시각 마감"으로
 *   기억했다가 속도가 바뀌면 다시 맞춘다(빨리 감는 중에도 1초 틱·시각 보정이 제때 돈다).
 * - WebSocket: 받은 `pong`의 serverNow를 빠른 시각으로 바꾼다(그 밖의 메시지는 그대로).
 */
import type { BrowserContext, Page } from '@playwright/test';

export interface Seg {
  real0: number;
  fast0: number;
  speed: number;
}

/** 페이지에 들어가는 스크립트(직렬화되므로 바깥 변수를 쓰지 않는다) */
function fastClockInit() {
  const w = window as unknown as Record<string, unknown>;
  if (w.__fcInstalled) return;
  w.__fcInstalled = true;
  const RealDate = Date;
  const realNow = RealDate.now.bind(RealDate);
  const rSetTimeout = window.setTimeout.bind(window);
  const rClearTimeout = window.clearTimeout.bind(window);
  const segs = (): Seg[] => (w.__FC_SEGS as Seg[] | undefined) ?? [{ real0: 0, fast0: 0, speed: 1 }];
  const fastAt = (real: number): number => {
    const ss = segs();
    let s = ss[0]!;
    for (const x of ss) if (x.real0 <= real) s = x;
    if (real < s.real0) return real; // 첫 구간 전(있을 수 없음)
    return s.fast0 + (real - s.real0) * s.speed;
  };
  const realAt = (fast: number): number => {
    const ss = segs();
    for (let i = 0; i < ss.length; i++) {
      const s = ss[i]!;
      const next = ss[i + 1];
      if (!next || fast < next.fast0) return s.real0 + (fast - s.fast0) / Math.max(1e-6, s.speed);
    }
    return fast;
  };
  const fastNow = () => fastAt(realNow());

  // ── Date ──
  class FastDate extends RealDate {
    constructor(...a: unknown[]) {
      if (a.length === 0) super(fastNow());
      else super(...(a as [number]));
    }
    static override now() {
      return fastNow();
    }
  }
  (window as unknown as { Date: DateConstructor }).Date = FastDate as unknown as DateConstructor;

  // ── performance.now ──
  const perfReal = performance.now.bind(performance);
  const perfBase = perfReal();
  const fastBase = fastNow();
  performance.now = () => perfBase + (fastNow() - fastBase);
  // requestAnimationFrame의 시각 인자도 같은 빠른 시각으로(애니메이션이 performance.now()와 비교한다)
  const rRaf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb: FrameRequestCallback) => rRaf(() => cb(performance.now()));

  // ── 타이머(빠른 시각 마감) ──
  interface T {
    fn: (...a: unknown[]) => void;
    args: unknown[];
    due: number;
    every: number | null;
    real: number | null;
  }
  const timers = new Map<number, T>();
  let seq = 1_000_000;
  const arm = (id: number) => {
    const t = timers.get(id);
    if (!t) return;
    if (t.real !== null) rClearTimeout(t.real);
    const delay = Math.max(0, realAt(t.due) - realNow());
    t.real = rSetTimeout(() => fire(id), Math.min(delay, 2_147_000_000)) as unknown as number;
  };
  const fire = (id: number) => {
    const t = timers.get(id);
    if (!t) return;
    t.real = null;
    // 아직 마감 전이면(속도가 느려짐) 다시 맞춘다
    if (fastNow() < t.due - 0.5) return arm(id);
    if (t.every !== null) {
      t.due = Math.max(t.due + t.every, fastNow());
      arm(id);
    } else timers.delete(id);
    try {
      t.fn(...t.args);
    } catch (e) {
      rSetTimeout(() => {
        throw e;
      }, 0);
    }
  };
  const add = (fn: unknown, ms: unknown, args: unknown[], repeat: boolean): number => {
    const id = ++seq;
    const d = Math.max(0, Number(ms) || 0);
    const f = typeof fn === 'function' ? (fn as (...a: unknown[]) => void) : () => (0, eval)(String(fn));
    timers.set(id, { fn: f, args, due: fastNow() + d, every: repeat ? Math.max(1, d) : null, real: null });
    arm(id);
    return id;
  };
  const clear = (id: unknown) => {
    const t = timers.get(Number(id));
    if (!t) return;
    if (t.real !== null) rClearTimeout(t.real);
    timers.delete(Number(id));
  };
  (window as unknown as Record<string, unknown>).setTimeout = (fn: unknown, ms?: unknown, ...a: unknown[]) => add(fn, ms, a, false);
  (window as unknown as Record<string, unknown>).setInterval = (fn: unknown, ms?: unknown, ...a: unknown[]) => add(fn, ms, a, true);
  (window as unknown as Record<string, unknown>).clearTimeout = clear;
  (window as unknown as Record<string, unknown>).clearInterval = clear;

  // 속도가 바뀌면(시험이 부름) 모든 타이머를 다시 맞춘다
  w.__fcSet = (ss: Seg[]) => {
    w.__FC_SEGS = ss;
    for (const id of timers.keys()) arm(id);
    // 새 구간 시작 시각(real0)에도 한 번 더(그 전까지는 옛 속도)
    const last = ss[ss.length - 1];
    if (last && last.real0 > realNow()) rSetTimeout(() => {
      for (const id of timers.keys()) arm(id);
    }, last.real0 - realNow() + 5);
  };
  w.__fcNow = fastNow;

  // ── WebSocket: pong.serverNow → 빠른 시각 ──
  const RealWS = window.WebSocket;
  class FastWS extends RealWS {
    override set onmessage(fn: ((ev: MessageEvent) => void) | null) {
      if (!fn) {
        super.onmessage = null;
        return;
      }
      super.onmessage = (ev: MessageEvent) => {
        if (typeof ev.data === 'string' && ev.data.includes('"pong"')) {
          try {
            const m = JSON.parse(ev.data) as { t?: string; serverNow?: number; at?: number };
            if (m.t === 'pong') {
              m.serverNow = fastNow();
              fn.call(this, { data: JSON.stringify(m) } as MessageEvent);
              return;
            }
          } catch {
            /* 그대로 */
          }
        }
        fn.call(this, ev);
      };
    }
    override get onmessage() {
      return super.onmessage;
    }
  }
  (window as unknown as { WebSocket: typeof WebSocket }).WebSocket = FastWS as unknown as typeof WebSocket;
}

/** 시험 전체가 같이 쓰는 시계 상태(노드 쪽) */
export class FastClock {
  segs: Seg[];
  readonly contexts = new Set<BrowserContext>();
  /** 응답하지 않은 페이지(진단용) */
  readonly stuck: Page[] = [];
  constructor() {
    const now = Date.now();
    this.segs = [{ real0: now - 1000, fast0: now - 1000, speed: 1 }];
  }
  fastAt(real: number): number {
    let s = this.segs[0]!;
    for (const x of this.segs) if (x.real0 <= real) s = x;
    return s.fast0 + (real - s.real0) * s.speed;
  }
  now(): number {
    return this.fastAt(Date.now());
  }
  get speed(): number {
    return this.segs[this.segs.length - 1]!.speed;
  }
  /** 문맥에 시계를 깐다(이 문맥의 모든 새 페이지) */
  async attach(ctx: BrowserContext): Promise<void> {
    this.contexts.add(ctx);
    ctx.on('close', () => this.contexts.delete(ctx));
    await ctx.addInitScript(`window.__FC_SEGS = ${JSON.stringify(this.segs)};`);
    await ctx.addInitScript(fastClockInit);
  }
  /** 속도 바꾸기: 200ms 뒤부터 새 속도(그 전에 모든 페이지에 알림) */
  async setSpeed(speed: number): Promise<void> {
    if (speed === this.speed) return;
    const lg = (m: string) => process.env.FC_LOG === '2' && console.log(`   [setSpeed ${speed}] ${m}`);
    lg('start');
    const real0 = Date.now() + 200;
    const seg = { real0, fast0: this.fastAt(real0), speed };
    this.segs = [...this.segs.filter((s) => s.real0 < real0), seg];
    const json = JSON.stringify(this.segs);
    await Promise.all(
      [...this.contexts].map(async (ctx) => {
        const ai = await Promise.race([
          ctx.addInitScript(`window.__FC_SEGS = ${json};`).then(
            () => 'ok',
            () => 'closed',
          ),
          new Promise<string>((res) => setTimeout(() => res('timeout'), 10_000)),
        ]);
        if (ai === 'timeout') throw new Error(`addInitScript 응답 없음: ${ctx.pages().map((p) => p.url()).join(', ')}`);
        lg(`init ok ${ctx.pages().length} pages`);
        await Promise.all(
          ctx.pages().map(async (p) => {
            const r = await Promise.race([
              p.evaluate((ss) => (window as unknown as { __fcSet?: (s: Seg[]) => void }).__fcSet?.(ss), this.segs).then(() => 'ok').catch(() => 'closed'),
              new Promise<string>((res) => setTimeout(() => res('timeout'), 10_000)),
            ]);
            if (r === 'timeout') {
              this.stuck.push(p);
              throw new Error(`페이지가 응답하지 않음(빨리 감기 시계 설정): ${p.url()}`);
            }
          }),
        );
      }),
    );
  }
  /** 조건이 맞을 때까지 빨리 감는다(맞으면 원래 속도로). 반환: 걸린 빠른 시각(ms) */
  async fastForwardUntil(check: () => Promise<boolean>, o: { speed?: number; maxFastMs?: number; label?: string; pollMs?: number } = {}): Promise<number> {
    const start = this.now();
    const prev = this.speed;
    if (process.env.FC_LOG) console.log(`[fast-clock ${new Date().toISOString().slice(11, 19)}] → ${o.label ?? ''}`);
    const guarded = () =>
      Promise.race([
        check(),
        new Promise<boolean>((_, rej) => setTimeout(() => rej(new Error(`빨리 감기 확인이 응답하지 않음(페이지 멈춤?): ${o.label ?? ''}`)), 15_000)),
      ]);
    if (await guarded()) return 0;
    await this.setSpeed(o.speed ?? 20);
    try {
      for (let n = 0; ; n++) {
        const c0 = Date.now();
        const ok = await guarded();
        if (process.env.FC_LOG === '2' && n % 10 === 0) console.log(`   … ${o.label} n=${n} check ${Date.now() - c0}ms fast+${Math.round((this.now() - start) / 1000)}s cpu=${(process.cpuUsage().user / 1e6).toFixed(1)}`);
        if (ok) return this.now() - start;
        if (this.now() - start > (o.maxFastMs ?? 30 * 60_000)) throw new Error(`빨리 감기 시간 초과: ${o.label ?? ''}`);
        await new Promise((r) => setTimeout(r, o.pollMs ?? 120));
      }
    } finally {
      await this.setSpeed(prev);
    }
  }
}

/** 페이지의 빠른 시각 */
export function pageNow(p: Page): Promise<number> {
  return p.evaluate(() => Date.now());
}
