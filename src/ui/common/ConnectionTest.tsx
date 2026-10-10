/**
 * [연결 테스트] — 학교 망에서 중계 서버에 붙을 수 있는지 단계별로 확인한다(PRD 10.9, brief 105 C·v0.3.1·v0.3.2).
 *
 * ① 페이지 주소 확인(중계 주소 표시) ② `/health` 가져오기(성공/실패·ms만 — **방 수는 보여 주지 않음**, 학생 기기에서도 열림)
 * ③ WebSocket 연결 ④ 서버 시각 차이 ⑤ 왕복 지연 5번 평균 ⑥ 서버 공지.
 * 결과: "연결 좋아요" / "느려요(1초 이상)" / "연결 안 돼요 — 학교 정보 담당 선생님께 … 허용을 요청하세요".
 * `?sync=local`이면 "로컬 모드(서버 없이)"만 보여 준다. 학생 입장·교사·타이틀 화면이 import해서 배치한다(107·109).
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { PROTOCOL_VERSION } from '@shared/protocol';
import { relayUrl as resolveRelayUrl, syncMode, type SyncMode } from '../../config/deploy';
import { defaultSocketFactory, relayHttpUrl, type WebSocketFactory, type WebSocketLike } from '../../sync/relay';

export type StepKey = 'page' | 'health' | 'ws' | 'clock' | 'rtt' | 'notice';
export type StepState = 'wait' | 'run' | 'ok' | 'fail' | 'skip';

export interface StepResult {
  key: StepKey;
  label: string;
  state: StepState;
  /** 걸린 시간 또는 측정값(ms) */
  ms?: number;
  detail?: string;
}

export type Verdict = 'local' | 'good' | 'slow' | 'fail';

export interface ConnectionReport {
  verdict: Verdict;
  message: string;
  steps: StepResult[];
  relayUrl?: string;
}

export interface RunOptions {
  /** 페이지 주소(기본 location.href) */
  href?: string;
  mode?: SyncMode;
  /** 중계 주소를 직접 줌(기본: config/deploy의 relayUrl) */
  relayUrl?: string;
  fetchImpl?: typeof fetch;
  createSocket?: WebSocketFactory;
  now?: () => number;
  /** 단계마다 시간 제한(ms, 기본 6000) */
  stepTimeoutMs?: number;
  /** 진행 중 화면 갱신 */
  onProgress?: (steps: StepResult[]) => void;
}

/** 느림 기준: 왕복 평균 1초 이상 */
export const SLOW_RTT_MS = 1000;

const LABELS: Record<StepKey, string> = {
  page: '① 페이지 주소 확인',
  health: '② 서버 상태(/health) 가져오기',
  ws: '③ WebSocket 연결',
  clock: '④ 서버 시각 차이',
  rtt: '⑤ 왕복 지연(5번 평균)',
  notice: '⑥ 서버 공지',
};
const ORDER: StepKey[] = ['page', 'health', 'ws', 'clock', 'rtt', 'notice'];

export const LOCAL_MODE_MESSAGE = '로컬 모드(서버 없이)';
export const GOOD_MESSAGE = '연결 좋아요';
export const SLOW_MESSAGE = '느려요(1초 이상). 수업은 할 수 있지만 화면이 늦게 바뀔 수 있어요.';

/** 실패 문구(도메인은 현재 주소에서 자동) */
export function failMessage(href: string): string {
  let host = 'lab.ches.es.kr';
  try {
    host = new URL(href).host || host;
  } catch {
    /* 기본값 */
  }
  return `연결 안 돼요 — 학교 정보 담당 선생님께 https://${host}(HTTPS·WebSocket 443) 허용을 요청하세요`;
}

function currentHref(): string {
  return typeof location !== 'undefined' ? location.href : 'http://localhost/';
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** 소켓 하나로 받은 메시지를 기다리는 작은 도우미 */
class Probe {
  private readonly queue: Record<string, unknown>[] = [];
  private waiter: (() => void) | null = null;
  closed = false;
  constructor(readonly ws: WebSocketLike) {
    ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)) as Record<string, unknown>;
        this.queue.push(m);
        this.waiter?.();
      } catch {
        /* 무시 */
      }
    };
    ws.onclose = () => {
      this.closed = true;
      this.waiter?.();
    };
  }
  async next(pred: (m: Record<string, unknown>) => boolean, ms: number): Promise<Record<string, unknown>> {
    const end = Date.now() + ms;
    for (;;) {
      const i = this.queue.findIndex(pred);
      if (i >= 0) return this.queue.splice(i, 1)[0] as Record<string, unknown>;
      if (this.closed) throw new Error('closed');
      const left = end - Date.now();
      if (left <= 0) throw new Error('timeout');
      await new Promise<void>((r) => {
        const t = setTimeout(r, left);
        this.waiter = () => {
          clearTimeout(t);
          r();
        };
      });
      this.waiter = null;
    }
  }
}

/** 연결 테스트 실행(화면 없이 — 테스트에서 직접 부른다) */
export async function runConnectionTest(o: RunOptions = {}): Promise<ConnectionReport> {
  const href = o.href ?? currentHref();
  const mode = o.mode ?? syncMode(href);
  const now = o.now ?? (() => Date.now());
  const stepMs = o.stepTimeoutMs ?? 6000;
  const steps: StepResult[] = ORDER.map((key) => ({ key, label: LABELS[key], state: 'wait' }));
  const step = (k: StepKey) => steps.find((s) => s.key === k) as StepResult;
  const set = (k: StepKey, patch: Partial<StepResult>) => {
    Object.assign(step(k), patch);
    o.onProgress?.(steps.map((s) => ({ ...s })));
  };

  if (mode === 'local' || mode === 'memory') {
    return { verdict: 'local', message: LOCAL_MODE_MESSAGE, steps: [] };
  }

  // ① 페이지 주소 → 중계 주소
  set('page', { state: 'run' });
  let url: string;
  try {
    url = o.relayUrl ?? (await resolveRelayUrl(href, o.fetchImpl));
    set('page', { state: 'ok', detail: url });
  } catch {
    set('page', { state: 'fail', detail: '중계 주소를 정하지 못했어요' });
    for (const k of ORDER.slice(1)) set(k, { state: 'skip' });
    return { verdict: 'fail', message: failMessage(href), steps };
  }

  // ② /health (방 수는 쓰지 않는다)
  set('health', { state: 'run' });
  const fetchImpl = o.fetchImpl ?? (typeof fetch === 'function' ? fetch : undefined);
  {
    const t0 = now();
    try {
      if (!fetchImpl) throw new Error('no fetch');
      const res = await withTimeout(fetchImpl(relayHttpUrl(url, 'health'), { cache: 'no-store' }), stepMs);
      const body = (await withTimeout(res.json() as Promise<{ ok?: unknown }>, stepMs)) ?? {};
      if (!res.ok || body.ok !== true) throw new Error('not ok');
      set('health', { state: 'ok', ms: now() - t0 });
    } catch {
      set('health', { state: 'fail', ms: now() - t0, detail: '응답이 없어요' });
    }
  }

  // ③ WebSocket
  set('ws', { state: 'run' });
  const createSocket = o.createSocket ?? defaultSocketFactory;
  let probe: Probe | null = null;
  {
    const t0 = now();
    try {
      const ws = createSocket(url);
      probe = new Probe(ws);
      await withTimeout(
        new Promise<void>((resolve, reject) => {
          ws.onopen = () => resolve();
          ws.onerror = () => reject(new Error('error'));
          const prevClose = ws.onclose;
          ws.onclose = (ev) => {
            prevClose?.(ev);
            reject(new Error('closed'));
          };
        }),
        stepMs,
      );
      set('ws', { state: 'ok', ms: now() - t0 });
    } catch {
      set('ws', { state: 'fail', ms: now() - t0, detail: '연결되지 않아요' });
      try {
        probe?.ws.close();
      } catch {
        /* 무시 */
      }
      for (const k of ['clock', 'rtt', 'notice'] as StepKey[]) set(k, { state: 'skip' });
      return { verdict: 'fail', message: failMessage(href), steps, relayUrl: url };
    }
  }

  const ping = async (): Promise<{ rtt: number; offset: number }> => {
    const at = now();
    probe!.ws.send(JSON.stringify({ v: PROTOCOL_VERSION, t: 'ping', at }));
    const m = await probe!.next((x) => x.t === 'pong' && x.at === at, stepMs);
    const t = now();
    const rtt = t - at;
    return { rtt, offset: Number(m.serverNow) + rtt / 2 - t };
  };

  let failed = false;
  // ④ 서버 시각 차이: ping 3번, 왕복 최소값
  set('clock', { state: 'run' });
  try {
    let best = { rtt: Infinity, offset: 0 };
    for (let i = 0; i < 3; i++) {
      const r = await ping();
      if (r.rtt < best.rtt) best = r;
    }
    const off = Math.round(best.offset);
    set('clock', { state: 'ok', ms: off, detail: `${off >= 0 ? '+' : ''}${off}ms` });
  } catch {
    failed = true;
    set('clock', { state: 'fail', detail: '서버 시각을 받지 못했어요' });
  }

  // ⑤ 왕복 지연 5번 평균
  let avg = Infinity;
  if (!failed) {
    set('rtt', { state: 'run' });
    try {
      let sum = 0;
      for (let i = 0; i < 5; i++) sum += (await ping()).rtt;
      avg = Math.round(sum / 5);
      set('rtt', { state: avg >= SLOW_RTT_MS ? 'fail' : 'ok', ms: avg });
    } catch {
      failed = true;
      set('rtt', { state: 'fail', detail: '응답이 없어요' });
    }
  } else set('rtt', { state: 'skip' });

  // ⑥ 서버 공지(연결 직후 서버가 보내는 server.notice)
  set('notice', { state: 'run' });
  try {
    const m = await probe.next((x) => x.t === 'server.notice', 1500);
    const text = typeof m.text === 'string' && m.level ? m.text : '';
    set('notice', { state: 'ok', detail: text || '공지 없음' });
  } catch {
    set('notice', { state: 'ok', detail: '공지 없음' });
  }

  try {
    probe.ws.close(1000, 'test done');
  } catch {
    /* 무시 */
  }

  if (failed) return { verdict: 'fail', message: failMessage(href), steps, relayUrl: url };
  if (avg >= SLOW_RTT_MS) return { verdict: 'slow', message: SLOW_MESSAGE, steps, relayUrl: url };
  return { verdict: 'good', message: GOOD_MESSAGE, steps, relayUrl: url };
}

// ───────────────────────────── 화면 ─────────────────────────────

const COLORS: Record<StepState, string> = {
  wait: '#9C8B6B',
  run: '#DCAA48',
  ok: '#3C8D40',
  fail: '#C0623F',
  skip: '#9C8B6B',
};
const STATE_TEXT: Record<StepState, string> = { wait: '대기', run: '확인 중', ok: '성공', fail: '실패', skip: '건너뜀' };
const VERDICT_BG: Record<Verdict, string> = { local: '#1F4E6B', good: '#3C8D40', slow: '#C77A1A', fail: '#B23A2A' };

export interface ConnectionTestProps {
  /** 바로 시작(기본 true) */
  autoStart?: boolean;
  /** 실행 선택지(테스트·화면 배치에서 주입) */
  options?: RunOptions;
}

export function ConnectionTest({ autoStart = true, options }: ConnectionTestProps) {
  const href = options?.href ?? currentHref();
  const mode = options?.mode ?? syncMode(href);
  const [steps, setSteps] = useState<StepResult[]>(() => ORDER.map((key) => ({ key, label: LABELS[key], state: 'wait' })));
  const [report, setReport] = useState<ConnectionReport | null>(null);
  const [running, setRunning] = useState(false);
  const alive = useRef(true);

  const start = () => {
    if (running) return;
    setRunning(true);
    setReport(null);
    setSteps(ORDER.map((key) => ({ key, label: LABELS[key], state: 'wait' })));
    runConnectionTest({ ...options, href, mode, onProgress: (s) => alive.current && setSteps(s) })
      .then((r) => {
        if (!alive.current) return;
        setReport(r);
        if (r.steps.length) setSteps(r.steps);
      })
      .finally(() => alive.current && setRunning(false));
  };

  useEffect(() => {
    alive.current = true;
    if (autoStart && mode === 'relay') start();
    return () => {
      alive.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const box = {
    background: 'var(--parchment-light, #EFE2BF)',
    color: 'var(--ink, #2B2318)',
    border: '2px solid var(--brass-dark, #8D6C2C)',
    borderRadius: 'var(--radius, 10px)',
    padding: '16px 20px',
    maxWidth: '720px',
    fontSize: '18px',
    lineHeight: 1.5,
  };

  if (mode !== 'relay') {
    return (
      <section class="conn-test" data-testid="connection-test" data-verdict="local" style={box}>
        <h2 class="title-font" style={{ margin: '0 0 8px', fontSize: '24px' }}>
          연결 테스트
        </h2>
        <p data-testid="connection-test-verdict" style={{ margin: 0, fontSize: '20px' }}>
          {LOCAL_MODE_MESSAGE}
        </p>
      </section>
    );
  }

  return (
    <section class="conn-test" data-testid="connection-test" data-verdict={report?.verdict ?? 'running'} style={box}>
      <h2 class="title-font" style={{ margin: '0 0 12px', fontSize: '24px' }}>
        연결 테스트
      </h2>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {steps.map((s) => (
          <li
            key={s.key}
            data-step={s.key}
            data-state={s.state}
            style={{ display: 'flex', alignItems: 'baseline', gap: '10px', padding: '6px 0', borderBottom: '1px solid #D6C497' }}
          >
            <span
              aria-hidden="true"
              style={{
                display: 'inline-block',
                width: '14px',
                height: '14px',
                borderRadius: '50%',
                background: COLORS[s.state],
                flex: '0 0 auto',
                transform: 'translateY(1px)',
              }}
            />
            <span style={{ flex: '0 0 auto', minWidth: '15em' }}>{s.label}</span>
            <span style={{ color: COLORS[s.state], fontWeight: 700, minWidth: '4em' }}>{STATE_TEXT[s.state]}</span>
            {s.ms !== undefined && s.key !== 'clock' && <span style={{ minWidth: '5em' }}>{s.ms}ms</span>}
            {s.detail && <span style={{ color: 'var(--ink-soft, #6B5A3F)', wordBreak: 'break-all', fontSize: '16px' }}>{s.detail}</span>}
          </li>
        ))}
      </ol>
      {report && (
        <p
          data-testid="connection-test-verdict"
          role={report.verdict === 'fail' ? 'alert' : 'status'}
          style={{
            margin: '14px 0 0',
            padding: '12px 14px',
            borderRadius: '8px',
            background: VERDICT_BG[report.verdict],
            color: '#FFFFFF',
            fontSize: '20px',
          }}
        >
          {report.message}
        </p>
      )}
      <p style={{ margin: '14px 0 0' }}>
        <button
          type="button"
          class="btn"
          disabled={running}
          onClick={start}
          style={{ minHeight: '48px', minWidth: '48px', fontSize: '18px', padding: '0 18px' }}
        >
          {running ? '확인하는 중…' : '다시 검사'}
        </button>
      </p>
    </section>
  );
}

export default ConnectionTest;
