/**
 * 공용 화면 다리 (작업 124, PRD 7.4·7.6).
 *
 * 같은 브라우저의 공용 화면 창(`#/screen`)이 호스트 탭과 `BroadcastChannel('voyage-screen-<code>')`로 공개 상태를 받는다
 * (네트워크를 쓰지 않음). 화면이 늦게 열려도 `hello`를 보내 최신 상태를 1번 받는다.
 *
 * **공개 상태 외 정보(학생 자금·명단·출석번호·재접속 요청·교사 설정)는 보내지 않는다.** 보내기 전에 `seat`·`seats` 키를
 * 검사해 지운다(`assertNoSeatInPublic`).
 */
import type { JsonObject } from '@shared/protocol';
import { assertNoSeatInPublic, stripSeatKeys } from './app-messages';

export const SCREEN_CHANNEL_PREFIX = 'voyage-screen-';

export interface ScreenChannelLike {
  postMessage(data: unknown): void;
  close(): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
}
export type ScreenChannelFactory = (name: string) => ScreenChannelLike;

const defaultFactory: ScreenChannelFactory = (name) => new BroadcastChannel(name) as unknown as ScreenChannelLike;

/** 다리로 오가는 메시지 */
export type ScreenMsg =
  | { t: 'hello' }
  /** hostNow: 보낸 순간의 호스트(중계 서버) 시각 ms — 공용 화면이 자기 기기 시계와의 차이를 보정한다(작업 111) */
  | { t: 'state'; src: string; version: number; publicState: JsonObject; classView: JsonObject | null; hostNow?: number }
  | { t: 'code.changed'; newCode: string }
  | { t: 'closed' };

export interface ScreenUpdate {
  version: number;
  publicState: JsonObject;
  classView: JsonObject | null;
  /** 보낸 순간의 호스트 시각(ms, 있으면) */
  hostNow?: number;
}

export interface ScreenPublisher {
  /** 공개 상태(+ 학급 공개 보기)를 화면에 보냄 */
  publishToScreen(publicState: JsonObject, classView?: JsonObject | null): void;
  /** 방 코드가 바뀜(서버 재시작 뒤 새 코드) — 화면은 새 채널로 옮겨 감 */
  codeChanged(newCode: string): void;
  /** 판 끝·방 닫힘 */
  closed(): void;
  dispose(): void;
}

export interface ScreenBridgeOptions {
  channelFactory?: ScreenChannelFactory;
  /** 출석번호 키가 있으면 예외(테스트) */
  strict?: boolean;
  /** (호스트 쪽) 호스트 기준 시각(중계 서버 시각). 있으면 상태 메시지마다 보낸 순간의 시각 `hostNow`를 싣는다(작업 111) */
  now?: () => number;
  /** (작업 137, 호스트 쪽) 공용 화면 창이 hello(처음 + 4초마다 살아 있음 신호)를 보낼 때 — 교사 카드 "TV 화면 창이 열려 있지 않아요" 판단 */
  onHello?: () => void;
}

function clean(obj: JsonObject | null | undefined, strict: boolean): JsonObject | null {
  if (!obj) return null;
  return assertNoSeatInPublic(obj, strict) ? obj : stripSeatKeys(obj);
}

/** 호스트 탭 쪽 */
export function createScreenPublisher(code: string, o: ScreenBridgeOptions = {}): ScreenPublisher {
  const factory = o.channelFactory ?? defaultFactory;
  const strict = o.strict ?? false;
  let ch: ScreenChannelLike | null = null;
  try {
    ch = factory(SCREEN_CHANNEL_PREFIX + code);
  } catch {
    ch = null;
  }
  let last: ScreenMsg | null = null;
  let version = 0;
  // 호스트 탭을 새로 고치면 version이 다시 1부터 — 화면이 구분할 수 있게 보낸 쪽 표시를 붙인다
  const src = Math.random().toString(36).slice(2, 10);
  const post = (m0: ScreenMsg) => {
    // 상태 메시지는 보낼 때마다(hello에 다시 보낼 때도) 지금 호스트 시각을 새로 싣는다
    const m: ScreenMsg = m0.t === 'state' && o.now ? { ...m0, hostNow: o.now() } : m0;
    try {
      ch?.postMessage(m);
    } catch {
      /* 무시 */
    }
  };
  if (ch) {
    ch.onmessage = (ev) => {
      const m = ev.data as { t?: string } | null;
      if (m && m.t === 'hello') {
        try {
          o.onHello?.();
        } catch {
          /* 무시 */
        }
        if (last) post(last);
      }
    };
  }
  return {
    publishToScreen(publicState, classView = null) {
      const msg: ScreenMsg = {
        t: 'state',
        src,
        version: ++version,
        publicState: clean(publicState, strict) ?? {},
        classView: clean(classView, strict),
      };
      last = msg;
      post(msg);
    },
    codeChanged(newCode) {
      last = { t: 'code.changed', newCode };
      post(last);
    },
    closed() {
      last = { t: 'closed' };
      post(last);
    },
    dispose() {
      if (ch) {
        ch.onmessage = null;
        ch.close();
      }
      ch = null;
    },
  };
}

export type ScreenEvent =
  | ({ type: 'state' } & ScreenUpdate)
  /** 이미 받은 상태를 다시 받음(hello 응답) — 호스트 시각만 새로(작업 111) */
  | { type: 'clock'; hostNow: number }
  | { type: 'code.changed'; newCode: string }
  | { type: 'closed' };

/**
 * 공용 화면 쪽: 구독하고 바로 `hello`를 보내 최신 상태 1번을 받는다.
 * `code.changed`를 받으면 새 코드 채널로 저절로 옮겨 간다(콜백에도 알림). 해제 함수를 돌려준다.
 */
export function subscribeScreen(code: string, cb: (e: ScreenEvent) => void, o: ScreenBridgeOptions = {}): () => void {
  const factory = o.channelFactory ?? defaultFactory;
  let ch: ScreenChannelLike | null = null;
  let lastVersion = 0;
  let lastSrc = '';
  const open = (c: string) => {
    ch?.close();
    try {
      ch = factory(SCREEN_CHANNEL_PREFIX + c);
    } catch {
      ch = null;
      return;
    }
    lastVersion = 0;
    ch.onmessage = (ev) => {
      const m = ev.data as ScreenMsg | null;
      if (!m || typeof m !== 'object') return;
      if (m.t === 'state') {
        if (m.src === lastSrc && m.version <= lastVersion) {
          if (typeof m.hostNow === 'number') cb({ type: 'clock', hostNow: m.hostNow });
          return;
        }
        lastSrc = m.src;
        lastVersion = m.version;
        cb({ type: 'state', version: m.version, publicState: m.publicState, classView: m.classView, ...(typeof m.hostNow === 'number' ? { hostNow: m.hostNow } : {}) });
      } else if (m.t === 'code.changed') {
        cb({ type: 'code.changed', newCode: m.newCode });
        open(m.newCode);
      } else if (m.t === 'closed') cb({ type: 'closed' });
    };
    ch.postMessage({ t: 'hello' } satisfies ScreenMsg);
  };
  open(code);
  return () => {
    if (ch) {
      ch.onmessage = null;
      ch.close();
    }
    ch = null;
  };
}
