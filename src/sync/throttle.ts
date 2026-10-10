/**
 * 묶음 전송·저장 도우미 (작업 124).
 *
 * - `Timers`: setTimeout/clearTimeout 주입 모양. 실제 브라우저는 `realTimers`, 테스트는 `ManualTimers`(가상 시계).
 * - `createThrottle(run, {intervalMs, now, timers})`: 요청이 몰려도 `intervalMs`에 최대 1번만 `run`을 부른다.
 *   앞쪽 가장자리(leading edge)에서 바로 한 번, 그 뒤 요청은 간격이 지난 때에 한 번으로 묶는다.
 *   `timers`가 없으면(null) `poll()`을 직접 불러야 한다(세션의 1초 틱이 부름).
 */

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** 브라우저·Node 기본 타이머 */
export const realTimers: Timers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof globalThis.setTimeout>),
};

/**
 * 가상 시계 타이머(테스트·시뮬레이션). `now()`는 바깥 시계(예: MemoryNetwork.now)를 쓰고,
 * `runDue()`가 시각이 된 콜백을 시각 순서대로 실행한다.
 */
export class ManualTimers implements Timers {
  private seq = 0;
  private readonly list = new Map<number, { at: number; fn: () => void; order: number }>();
  constructor(private readonly now: () => number) {}

  setTimeout(fn: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.list.set(id, { at: this.now() + Math.max(0, ms), fn, order: id });
    return id;
  }
  clearTimeout(handle: unknown): void {
    this.list.delete(handle as number);
  }
  /** 대기 중인 타이머 수 */
  get size(): number {
    return this.list.size;
  }
  /** 시각이 된 타이머를 모두 실행(실행 중 새로 생겨 시각이 된 것도). 실행한 수를 돌려준다 */
  runDue(): number {
    let n = 0;
    for (let guard = 0; guard < 100_000; guard++) {
      const now = this.now();
      let pick: [number, { at: number; fn: () => void; order: number }] | null = null;
      for (const e of this.list) {
        if (e[1].at > now) continue;
        if (!pick || e[1].at < pick[1].at || (e[1].at === pick[1].at && e[1].order < pick[1].order)) pick = e;
      }
      if (!pick) break;
      this.list.delete(pick[0]);
      n++;
      pick[1].fn();
    }
    return n;
  }
}

export interface ThrottleOptions {
  /** 최소 간격(ms) */
  intervalMs: number;
  now: () => number;
  /** 없으면 poll()로만 뒤쪽 실행 */
  timers?: Timers | null;
}

export interface Throttle {
  /** 실행 요청(간격이 지났으면 바로 실행) */
  request(): void;
  /** 대기 중이고 간격이 지났으면 실행. 실행했으면 true */
  poll(): boolean;
  /** 대기 중이면 간격과 상관없이 바로 실행(종료·페이지 숨김 때 저장용) */
  flush(): void;
  /** 대기·타이머 취소 */
  cancel(): void;
  readonly pending: boolean;
  /** 마지막 실행 시각(없으면 -Infinity) */
  readonly lastRunAt: number;
}

export function createThrottle(run: () => void, o: ThrottleOptions): Throttle {
  let pending = false;
  let last = Number.NEGATIVE_INFINITY;
  let timer: unknown = null;
  const timers = o.timers ?? null;

  const clear = () => {
    if (timer !== null && timers) timers.clearTimeout(timer);
    timer = null;
  };
  const exec = () => {
    clear();
    pending = false;
    last = o.now();
    run();
  };
  const arm = () => {
    if (!timers || timer !== null) return;
    const wait = Math.max(0, last + o.intervalMs - o.now());
    timer = timers.setTimeout(() => {
      timer = null;
      if (!api.poll() && pending) arm();
    }, wait);
  };

  const api: Throttle = {
    request() {
      pending = true;
      if (o.now() - last >= o.intervalMs) exec();
      else arm();
    },
    poll() {
      if (!pending || o.now() - last < o.intervalMs) return false;
      exec();
      return true;
    },
    flush() {
      if (pending) exec();
    },
    cancel() {
      clear();
      pending = false;
    },
    get pending() {
      return pending;
    },
    get lastRunAt() {
      return last;
    },
  };
  return api;
}

/**
 * 토큰 통(초당 `rate`개, 최대 `burst`개). 중계 서버는 연결당 메시지 초당 20개(순간 40개)를 넘으면 버리므로
 * 호스트는 이보다 조금 낮게 맞춰 보낸다(host-session의 보낼 함).
 */
export class TokenBucket {
  private tokens: number;
  private at: number;
  constructor(
    private readonly rate: number,
    private readonly burst: number,
    private readonly now: () => number,
  ) {
    this.tokens = burst;
    this.at = now();
  }
  private refill() {
    const t = this.now();
    if (t > this.at) {
      this.tokens = Math.min(this.burst, this.tokens + ((t - this.at) / 1000) * this.rate);
      this.at = t;
    }
  }
  /** 1개 꺼냄(없으면 false) */
  take(): boolean {
    this.refill();
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
  /** 다음 1개까지 기다릴 시간(ms) */
  waitMs(): number {
    this.refill();
    return this.tokens >= 1 ? 0 : Math.ceil(((1 - this.tokens) / this.rate) * 1000);
  }
}
