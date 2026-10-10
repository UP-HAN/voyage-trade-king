/**
 * 배포 설정 (PRD 10.1 경로, 10.9 배포 구조).
 * 앱은 상대 경로(base: './')로 빌드되므로 어느 하위 경로에 올려도 동작해야 한다.
 * 중계 주소 우선순위: ① URL `?relay=` ② 같은 폴더의 `config.json` ③ 페이지 위치 기준 `./ws`.
 */

export type SyncMode = 'memory' | 'local' | 'relay';

const SYNC_MODES: readonly SyncMode[] = ['memory', 'local', 'relay'];

/** package.json 버전 */
export const APP_PKG_VERSION: string = __APP_VERSION__;
/** 빌드 시각(ISO 8601). 개발 서버에서는 서버 시작 시각 */
export const APP_BUILD_TIME: string = __BUILD_TIME__;
/** 배포 후 버전 불일치 안내용 표시 문자열. 예: `0.1.0+20261009T001300Z` */
export const APP_VERSION: string = `${APP_PKG_VERSION}+${APP_BUILD_TIME.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}`;

/** 런타임 설정 파일(`config.json`, 선택) 형식 */
export interface RuntimeConfig {
  relayUrl?: string;
}

function currentHref(): string {
  return typeof location !== 'undefined' ? location.href : 'http://localhost/';
}

/**
 * URL 의 질의 값을 읽는다. `?a=1#/play` 처럼 해시 앞의 질의를 먼저 보고,
 * 없으면 `#/play?a=1` 처럼 해시 안의 질의도 본다.
 */
export function readQueryParam(href: string, name: string): string | null {
  const url = new URL(href);
  const fromSearch = url.searchParams.get(name);
  if (fromSearch !== null && fromSearch !== '') return fromSearch;
  const q = url.hash.indexOf('?');
  if (q >= 0) {
    const fromHash = new URLSearchParams(url.hash.slice(q + 1)).get(name);
    if (fromHash !== null && fromHash !== '') return fromHash;
  }
  return null;
}

/** 페이지 주소에서 질의·해시를 뗀 "현재 폴더 기준" 주소 */
function pageBase(href: string): URL {
  const url = new URL(href);
  url.hash = '';
  url.search = '';
  return url;
}

/**
 * 중계 주소 문자열을 ws:/wss: 절대 주소로 정리한다. http(s)는 ws(s)로 바꾸고,
 * 상대 주소는 페이지 위치 기준으로 푼다. 쓸 수 없는 값이면 null.
 */
export function normalizeRelayUrl(value: string, href: string): string | null {
  try {
    const url = new URL(value.trim(), pageBase(href));
    if (url.protocol === 'http:') url.protocol = 'ws:';
    else if (url.protocol === 'https:') url.protocol = 'wss:';
    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') return null;
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

/**
 * 기본 중계 주소: 현재 페이지 위치(질의·해시 제외)의 `./ws` 를 ws:/wss: 로 바꾼 주소.
 * 예) `https://lab.ches.es.kr/voyage/#/play` → `wss://lab.ches.es.kr/voyage/ws`
 */
export function defaultRelayUrl(href: string): string {
  const url = new URL('./ws', pageBase(href));
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
}

/** 우선순위 ① `?relay=` ② config.json 의 relayUrl ③ 기본값 — 순수 함수(테스트용) */
export function resolveRelayUrl(href: string, config?: RuntimeConfig | null): string {
  const fromQuery = readQueryParam(href, 'relay');
  if (fromQuery) {
    const n = normalizeRelayUrl(fromQuery, href);
    if (n) return n;
  }
  if (config && typeof config.relayUrl === 'string' && config.relayUrl) {
    const n = normalizeRelayUrl(config.relayUrl, href);
    if (n) return n;
  }
  return defaultRelayUrl(href);
}

/**
 * 같은 폴더의 `config.json` 을 읽는다(선택 파일). 없거나 형식이 틀리면 null.
 */
export async function loadRuntimeConfig(
  href: string = currentHref(),
  fetchImpl: typeof fetch | undefined = typeof fetch === 'function' ? fetch : undefined,
  timeoutMs = 3000,
): Promise<RuntimeConfig | null> {
  if (!fetchImpl) return null;
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(new URL('config.json', pageBase(href)).href, {
      cache: 'no-store',
      signal: ctrl?.signal,
    });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (!data || typeof data !== 'object') return null;
    const relay = (data as { relayUrl?: unknown }).relayUrl;
    return typeof relay === 'string' ? { relayUrl: relay } : {};
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 중계 서버 WebSocket 주소(① `?relay=` ② `config.json` ③ `./ws`) */
export async function relayUrl(
  href: string = currentHref(),
  fetchImpl?: typeof fetch,
): Promise<string> {
  // ?relay= 가 있으면 config.json 을 읽을 필요가 없다.
  const fromQuery = readQueryParam(href, 'relay');
  const normalized = fromQuery ? normalizeRelayUrl(fromQuery, href) : null;
  if (normalized) return normalized;
  const config = await loadRuntimeConfig(href, fetchImpl ?? (typeof fetch === 'function' ? fetch : undefined));
  return resolveRelayUrl(href, config);
}

/** 동기화 방식: URL `?sync=memory|local|relay` 우선, 없으면 개발 서버는 local, 빌드는 relay */
export function syncMode(href: string = currentHref(), isDev: boolean = import.meta.env.DEV): SyncMode {
  const q = readQueryParam(href, 'sync');
  if (q && (SYNC_MODES as readonly string[]).includes(q)) return q as SyncMode;
  return isDev ? 'local' : 'relay';
}

// ───────────────── 공개 운영 정보(작업 131, PRD 10.12·10.12.1) ─────────────────
// `config.json`(선택, 비밀값 아님)의 `serverInfo`·`serviceNotice`를 읽는다.
// 값은 **글자로만** 화면에 낸다(HTML로 해석하지 않음). 형식이 틀리거나 길이를 넘으면 그 값만 버리고 콘솔에 경고한다.

/** 운영자 연락처(PRD 10.12 "운영자 연락처 표시" — 기본 비어 있음) */
export interface ServerInfo {
  /** 운영자 이름(30자 이내). 예: "○○초 홍길동 선생님" */
  operator?: string;
  /** 연락처(80자 이내). `https://`·`mailto:`로 시작하면 링크, 그 밖은 글자 */
  contact?: string;
  /** 공개 저장소 주소(200자 이내, `https://`일 때만 링크) */
  repoUrl?: string;
}

/** 자기 서버에 설치한 교사를 위한 이용 안내 덮어쓰기 */
export interface ServiceNoticeOverride {
  /** 하단 한 줄(200자 이내) */
  short?: string;
  /** [이용 안내] 창 항목(각 200자 이내, 최대 12개) */
  items?: string[];
}

/** `config.json` 화면 표시 설정(작업 131) */
export interface DisplayConfig {
  /**
   * 타이틀의 "사용 중인 방 n/50"을 보일지. **기본 숨김**(v0.3.4, PRD 7.5.1 — 학생도 거치는 화면) — `true`일 때만 타이틀에 보인다
   * (교사 시작 화면·판 설정 표시는 이 값과 관계없음).
   */
  titleRoomCount?: boolean;
}

export const SERVER_INFO_LIMITS = { operator: 30, contact: 80, repoUrl: 200 } as const;
export const SERVICE_NOTICE_LIMITS = { short: 200, item: 200, items: 12 } as const;

function warnConfig(msg: string): void {
  if (typeof console !== 'undefined') console.warn(`[config.json] ${msg}`);
}

/** 앞뒤 공백을 뗀 문자열(1자 이상, max자 이하)만 받는다. 없으면 undefined, 틀리면 경고 후 undefined */
function pickText(obj: Record<string, unknown>, key: string, max: number, where: string): string | undefined {
  if (!(key in obj) || obj[key] === undefined || obj[key] === null) return undefined;
  const v = obj[key];
  if (typeof v !== 'string') {
    warnConfig(`${where}.${key} 는 문자열이어야 해요 — 무시합니다.`);
    return undefined;
  }
  const t = v.trim();
  if (!t) return undefined;
  if (t.length > max) {
    warnConfig(`${where}.${key} 가 ${max}자를 넘어요 — 무시합니다.`);
    return undefined;
  }
  return t;
}

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** `https://`·`mailto:`로 시작하는 값만 링크로 쓴다(그 밖은 글자로만) */
export function isSafeLink(value: string | undefined | null): boolean {
  if (!value) return false;
  if (!/^(https:\/\/|mailto:)/i.test(value)) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'mailto:';
  } catch {
    return false;
  }
}

/** `config.json` 내용 → 운영자 정보(순수 함수). 쓸 값이 하나도 없으면 null */
export function parseServerInfo(raw: unknown): ServerInfo | null {
  const root = asObject(raw);
  if (!root || root.serverInfo === undefined || root.serverInfo === null) return null;
  const si = asObject(root.serverInfo);
  if (!si) {
    warnConfig('serverInfo 는 객체여야 해요 — 무시합니다.');
    return null;
  }
  const out: ServerInfo = {};
  const operator = pickText(si, 'operator', SERVER_INFO_LIMITS.operator, 'serverInfo');
  const contact = pickText(si, 'contact', SERVER_INFO_LIMITS.contact, 'serverInfo');
  const repoUrl = pickText(si, 'repoUrl', SERVER_INFO_LIMITS.repoUrl, 'serverInfo');
  if (operator) out.operator = operator;
  if (contact) out.contact = contact;
  if (repoUrl) out.repoUrl = repoUrl;
  return out.operator || out.contact || out.repoUrl ? out : null;
}

/** `config.json` 내용 → 이용 안내 덮어쓰기(순수 함수). 쓸 값이 없으면 null */
export function parseServiceNoticeOverride(raw: unknown): ServiceNoticeOverride | null {
  const root = asObject(raw);
  if (!root || root.serviceNotice === undefined || root.serviceNotice === null) return null;
  const sn = asObject(root.serviceNotice);
  if (!sn) {
    warnConfig('serviceNotice 는 객체여야 해요 — 무시합니다.');
    return null;
  }
  const out: ServiceNoticeOverride = {};
  const short = pickText(sn, 'short', SERVICE_NOTICE_LIMITS.short, 'serviceNotice');
  if (short) out.short = short;
  if (sn.items !== undefined && sn.items !== null) {
    const items = sn.items;
    if (!Array.isArray(items) || items.length === 0 || items.length > SERVICE_NOTICE_LIMITS.items) {
      warnConfig(`serviceNotice.items 는 1~${SERVICE_NOTICE_LIMITS.items}개의 문자열 배열이어야 해요 — 무시합니다.`);
    } else if (
      !items.every((s) => typeof s === 'string' && s.trim() !== '' && s.trim().length <= SERVICE_NOTICE_LIMITS.item)
    ) {
      warnConfig(`serviceNotice.items 의 각 항목은 1~${SERVICE_NOTICE_LIMITS.item}자 문자열이어야 해요 — 무시합니다.`);
    } else {
      out.items = (items as string[]).map((s) => s.trim());
    }
  }
  return out.short || out.items ? out : null;
}

/** `config.json` 내용 → 화면 표시 설정(순수 함수) */
export function parseDisplayConfig(raw: unknown): DisplayConfig {
  const root = asObject(raw);
  const d = root ? root.display : undefined;
  if (d === undefined || d === null) return {};
  const obj = asObject(d);
  if (!obj) {
    warnConfig('display 는 객체여야 해요 — 무시합니다.');
    return {};
  }
  const out: DisplayConfig = {};
  if ('titleRoomCount' in obj) {
    if (typeof obj.titleRoomCount === 'boolean') out.titleRoomCount = obj.titleRoomCount;
    else warnConfig('display.titleRoomCount 는 true/false 여야 해요 — 무시합니다.');
  }
  return out;
}

let rawConfigCache: Promise<unknown | null> | null = null;

/**
 * 같은 폴더의 `config.json` 원문(JSON)을 한 번만 읽어 둔다(페이지 수명 동안 캐시). 없거나 형식이 틀리면 null.
 * 작업 131의 표시 설정용(중계 주소는 위 `loadRuntimeConfig`가 그대로 읽는다).
 */
export function loadConfigJson(
  href: string = currentHref(),
  fetchImpl: typeof fetch | undefined = typeof fetch === 'function' ? fetch : undefined,
  timeoutMs = 3000,
): Promise<unknown | null> {
  if (rawConfigCache) return rawConfigCache;
  rawConfigCache = (async () => {
    if (!fetchImpl) return null;
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    try {
      const res = await fetchImpl(new URL('config.json', pageBase(href)).href, { cache: 'no-store', signal: ctrl?.signal });
      if (!res.ok) return null;
      const data: unknown = await res.json();
      return data && typeof data === 'object' ? data : null;
    } catch {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  })();
  return rawConfigCache;
}

/** (테스트용) `loadConfigJson` 캐시 비우기 */
export function resetConfigJsonCache(): void {
  rawConfigCache = null;
}

/** 운영자 정보(`config.json`의 `serverInfo`) — 없으면 null */
export async function serverInfo(): Promise<ServerInfo | null> {
  return parseServerInfo(await loadConfigJson());
}

/** 이용 안내 덮어쓰기(`config.json`의 `serviceNotice`) — 없으면 null */
export async function serviceNoticeOverride(): Promise<ServiceNoticeOverride | null> {
  return parseServiceNoticeOverride(await loadConfigJson());
}

/** 화면 표시 설정(`config.json`의 `display`) — 없으면 {} */
export async function displayConfig(): Promise<DisplayConfig> {
  return parseDisplayConfig(await loadConfigJson());
}
