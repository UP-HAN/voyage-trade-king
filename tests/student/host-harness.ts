/**
 * 테스트용 최소 호스트(교사 화면 109와 독립) — 작업 107 e2e.
 *
 * Playwright가 이 파일을 한 덩어리로 묶어(`e2e/student-shell.spec.ts`의 buildHarness) 미리보기 서버와 같은 주소의
 * `__harness.html`로 끼워 넣는다(page.route). 실제 앱 코드(src/core·src/sync)를 그대로 쓴다.
 *
 * - `?role=server`: LocalAdapter의 '서버 탭' 역할만 한다(방 없음). 호스트 탭을 닫아도 방이 남아
 *   학생에게 "선생님 화면을 기다리고 있어요"(호스트 부재)가 보이게 하려고 따로 둔다.
 * - `?role=host`: 호스트 세션 + 103 리듀서(+123 무역 시계 훅, 124 회사 이름 검사). `&resume=1`이면 저장된 판으로 복귀.
 * 조작은 `window.__host`(evaluate)로 한다.
 */
import type { JsonObject } from '@shared/protocol';
import {
  createSessionReducer,
  createTradeHooks,
  playerView,
  publicPayload,
  seatKey,
  startSession,
  type HostSnapshot,
  type NameValidator,
  type TeacherAction,
} from '../../src/core';
import { validateCompanyName } from '../../src/sync/company-name';
import { createHostSession, type HostSession, type SessionReducer } from '../../src/sync/host-session';
import { createHostStore } from '../../src/sync/host-store';
import { createLocalHost } from '../../src/sync/local';

declare global {
  interface Window {
    __host?: HarnessApi;
    __server?: { setNotice(n: { level: 'info' | 'warn' | 'maintenance'; text: string } | null): boolean };
    __ready?: boolean;
  }
}

export interface HarnessApi {
  code(): string | null;
  view(): unknown;
  teacher(action: TeacherAction): void;
  approveRejoin(seat: number): boolean;
  denyRejoin(seat: number): boolean;
  blockName(seat: number): boolean;
  renameCompany(seat: number, name: string): unknown;
  player(seat: number): unknown;
  phase(): string | null;
  /** 저장을 바로(탭을 닫기 전에 — 실제 교사 화면은 1초 묶음 저장) */
  flush(): void;
}

const out = document.getElementById('out')!;
const log = (s: string) => {
  out.textContent = s;
};

async function main() {
  const q = new URLSearchParams(location.search);
  const role = q.get('role') ?? 'host';
  if (role === 'server') {
    const t = await createLocalHost();
    window.__server = { setNotice: (n) => t.setNotice(n) };
    window.__ready = true;
    log('server');
    return;
  }
  const transport = await createLocalHost();
  const store = createHostStore();
  const hooks = createTradeHooks({ validateName: validateCompanyName as unknown as NameValidator });
  const session: HostSession<HostSnapshot> = createHostSession<HostSnapshot>({
    transport,
    reducer: createSessionReducer(hooks) as unknown as SessionReducer<HostSnapshot>,
    views: {
      public: (g) => publicPayload(g) as unknown as JsonObject,
      me: (g, seat) => {
        const p = g.players[seatKey(seat)];
        return p ? (playerView(p) as unknown as JsonObject) : null;
      },
    },
    store,
    appVersion: q.get('ver') ?? __APP_VERSION__,
  });
  if (q.get('resume') === '1') {
    const r = await session.resume();
    log(r.ok ? `resumed ${session.getView().code}` : `resume failed`);
  } else {
    const comeback = q.get('comeback') !== '0';
    const game = startSession({
      code: '000000',
      playUnit: 'lesson',
      scope: ['L1'],
      seed: 7,
      now: Date.now(),
      settings: { progressMode: 'manual', comeback, roundSec: Number(q.get('roundSec') ?? 180) },
    });
    const r = await session.open({ game });
    log(r.ok ? `open ${r.code}` : `open failed ${r.error}`);
  }
  window.__host = {
    code: () => session.getView().code,
    view: () => {
      const v = session.getView();
      return { status: v.status, code: v.code, seats: v.seats, rejoinRequests: v.rejoinRequests, joinProblems: v.joinProblems };
    },
    teacher: (a) => session.dispatchTeacher(a as unknown as { type: string }),
    approveRejoin: (s) => session.approveRejoin(s),
    denyRejoin: (s) => session.denyRejoin(s),
    blockName: (s) => session.blockCompanyName(s),
    renameCompany: (s, n) => session.renameCompany(s, n),
    player: (s) => session.getView().game?.players[seatKey(s)] ?? null,
    phase: () => session.getView().game?.class.phase ?? null,
    flush: () => session.flushSave(),
  };
  window.__ready = true;
}

main().catch((e) => log(`error ${String(e)}`));
