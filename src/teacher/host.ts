/**
 * 교사 브라우저 호스트 만들기(작업 109): 전송 계층(104/105) + 세션(124) + 리듀서(103·123).
 * 시각은 모두 중계 서버 시각(`transport.serverNow()`, PRD 7.4).
 */
import { APP_VERSION } from '../config/deploy';
import { createHostSession, type HostSession } from '../sync/host-session';
import { createHostStore, type HostStore, type StorageLike } from '../sync/host-store';
import { createScreenPublisher } from '../sync/screen-bridge';
import { createHostTransport } from '../sync/select';
import type { HostTransport } from '../sync/adapter';
import { resultTableOf, teacherReducer, teacherViews, type TeacherGame } from './game';

/**
 * (작업 137) 공용 화면 창 연결 신호: 같은 브라우저의 공용 화면 창(`#/screen`)은 4초마다 hello를 보낸다(살아 있음 확인).
 * 마지막 hello가 이 시간 안이면 '연결됨'. 교사 탭의 실제 시각(Date.now)으로 잰다(서버 시각과 무관).
 */
export const SCREEN_ALIVE_MS = 10_000;
let lastScreenHello = 0;
export function markScreenHello(): void {
  lastScreenHello = Date.now();
}
/** 공용 화면 창이 지금 연결돼 있나(최근 hello) */
export function screenConnected(nowMs: number = Date.now()): boolean {
  return lastScreenHello > 0 && nowMs - lastScreenHello < SCREEN_ALIVE_MS;
}

export interface TeacherHost {
  session: HostSession<TeacherGame>;
  transport: HostTransport;
  store: HostStore;
  /** 서버 시각(ms) */
  now: () => number;
}

export function teacherStore(storage?: StorageLike | null): HostStore {
  return createHostStore(storage === undefined ? {} : { storage });
}

export function createTeacherHostFrom(transport: HostTransport, store: HostStore = teacherStore()): TeacherHost {
  const now = () => transport.serverNow();
  const session = createHostSession<TeacherGame>({
    transport,
    reducer: teacherReducer,
    views: teacherViews,
    store,
    appVersion: APP_VERSION,
    now,
    phaseOf: (g) => g.class.phase,
    resultTable: resultTableOf,
    screenFactory: (code) => createScreenPublisher(code, { now, onHello: markScreenHello }),
    extraBannedWords: () => [],
  });
  return { session, transport, store, now };
}

/** 현재 페이지 주소(`?sync=`)에 맞는 전송 계층으로 호스트를 만든다 */
export async function createTeacherHost(): Promise<TeacherHost> {
  const transport = await createHostTransport();
  return createTeacherHostFrom(transport);
}

/** 이 탭에서 연 판(새로 고침 때 자동 이어하기 표시) — sessionStorage(탭마다 따로, 새 탭에서는 시작 화면) */
export const ACTIVE_TAB_KEY = 'voyage.teacher.active';

export function markActiveTab(code: string | null): void {
  try {
    if (typeof sessionStorage === 'undefined') return;
    if (code) sessionStorage.setItem(ACTIVE_TAB_KEY, code);
    else sessionStorage.removeItem(ACTIVE_TAB_KEY);
  } catch {
    /* 무시 */
  }
}

export function activeTabCode(): string | null {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(ACTIVE_TAB_KEY) : null;
  } catch {
    return null;
  }
}

/** Blob URL 해제까지 기다리는 시간(ms) */
export const DOWNLOAD_REVOKE_MS = 60_000;

/** 파일 내려받기(Blob + a[download]) */
export function downloadText(fileName: string, text: string, mime: string): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 다운로드가 늦게 시작·저장돼도(느린 기기·동기화 폴더 등) 취소되지 않도록 Blob URL은 충분히 뒤에 해제한다.
  // 2초에 해제하면 저장이 그보다 늦을 때 브라우저가 다운로드를 '취소'로 끝냈다(작업 111에서 확인).
  setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_REVOKE_MS);
}
