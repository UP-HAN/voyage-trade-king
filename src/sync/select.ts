/**
 * 어댑터 고르기 (PRD 10.4). `syncMode()`(src/config/deploy.ts): URL `?sync=memory|local|relay` 우선,
 * 없으면 개발 서버는 local, 빌드는 relay.
 *
 * - memory: 이 페이지 안의 MemoryNetwork 하나(같은 페이지에서 호스트·학생을 함께 만들 때만 의미 있음).
 * - local: BroadcastChannel 탭 연결. `?lag=50`이면 한 방향 50ms 지연 흉내, `?as=s07`은 학생 탭 이름.
 * - relay: `./relay`(작업 105)를 동적 import. 아직 없으면 local로 대신하고 콘솔 경고.
 *
 * 작업 105의 `src/sync/relay.ts`는 아래 `RelayModule` 모양으로 내보낸다.
 */
import { readQueryParam, relayUrl, syncMode, type SyncMode } from '../config/deploy';
import type { HostTransport, PeerTransport } from './adapter';
import { createLocalHost, createLocalPeer, type LocalOptions } from './local';
import { MemoryNetwork } from './memory';

/** 작업 105의 `./relay` 모듈이 내보낼 것 */
export interface RelayModule {
  createRelayHost(url: string): HostTransport | Promise<HostTransport>;
  createRelayPeer(url: string): PeerTransport | Promise<PeerTransport>;
}

type RelayLoader = () => Promise<RelayModule>;

// 파일이 없으면 빈 객체 — 빌드·타입 검사가 깨지지 않고, 105가 파일을 만들면 자동으로 묶인다.
const relayModules = import.meta.glob<RelayModule>('./relay.ts');

function currentHref(): string {
  return typeof location !== 'undefined' ? location.href : 'http://localhost/';
}

let memoryNet: MemoryNetwork | null = null;
/** 이 페이지의 MemoryNetwork(memory 모드) */
export function pageMemoryNetwork(): MemoryNetwork {
  memoryNet ??= new MemoryNetwork();
  return memoryNet;
}

/** URL에서 local 어댑터 선택지 읽기 */
export function localOptionsFromHref(href: string): LocalOptions {
  const lag = Number(readQueryParam(href, 'lag'));
  return {
    ...(Number.isFinite(lag) && lag > 0 ? { latencyMs: lag } : {}),
    as: readQueryParam(href, 'as'),
  };
}

/** relay 모듈 불러오기(없으면 null). 테스트에서 loader를 바꿔 끼울 수 있다 */
export async function loadRelayModule(loader: RelayLoader | undefined = relayModules['./relay.ts']): Promise<RelayModule | null> {
  if (!loader) return null;
  try {
    return await loader();
  } catch (e) {
    console.warn('[sync] relay 어댑터를 불러오지 못했어요', e);
    return null;
  }
}

export interface SelectOptions {
  href?: string;
  mode?: SyncMode;
  /** 테스트용: relay 모듈 불러오기 */
  relayLoader?: RelayLoader;
  /** 테스트용: local 옵션 덧붙이기 */
  local?: LocalOptions;
}

async function resolveMode(o: SelectOptions): Promise<{ mode: SyncMode; relay: RelayModule | null; href: string }> {
  const href = o.href ?? currentHref();
  const mode = o.mode ?? syncMode(href);
  if (mode !== 'relay') return { mode, relay: null, href };
  const relay = await loadRelayModule(o.relayLoader ?? relayModules['./relay.ts']);
  if (!relay) {
    console.warn('[sync] relay 어댑터(작업 105)가 아직 없어요. local(탭 연결)로 대신해요.');
    return { mode: 'local', relay: null, href };
  }
  return { mode, relay, href };
}

export async function createHostTransport(o: SelectOptions = {}): Promise<HostTransport> {
  const { mode, relay, href } = await resolveMode(o);
  if (mode === 'memory') return pageMemoryNetwork().createHost();
  if (mode === 'relay' && relay) return relay.createRelayHost(await relayUrl(href));
  return createLocalHost({ ...localOptionsFromHref(href), ...o.local });
}

export async function createPeerTransport(o: SelectOptions = {}): Promise<PeerTransport> {
  const { mode, relay, href } = await resolveMode(o);
  if (mode === 'memory') return pageMemoryNetwork().createPeer();
  if (mode === 'relay' && relay) return relay.createRelayPeer(await relayUrl(href));
  return createLocalPeer({ ...localOptionsFromHref(href), ...o.local });
}
