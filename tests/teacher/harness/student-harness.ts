/**
 * 학생 테스트 하네스(작업 109 e2e 전용) — `tests/teacher/harness/student.html?sync=local&as=s01`.
 * 107 학생 화면 대신 124 peer-session으로 입장·행동만 한다. 화면은 상태 글자뿐.
 * e2e는 `window.__h`로 조작한다.
 */
import { APP_VERSION, readQueryParam } from '../../../src/config/deploy';
import { tradeClock, type ClassState } from '../../../src/core';
import { localDeviceToken } from '../../../src/sync/local';
import { createPeerSession } from '../../../src/sync/peer-session';
import { createPeerStore, peerStorageForHref } from '../../../src/sync/peer-store';
import { createPeerTransport } from '../../../src/sync/select';

type Pub = { class?: ClassState } & Record<string, unknown>;

async function main() {
  const href = location.href;
  const transport = await createPeerTransport();
  const as = readQueryParam(href, 'as');
  const ps = createPeerSession<Record<string, unknown>, Pub, unknown>({
    transport,
    predict: (me) => me,
    store: createPeerStore({ storage: peerStorageForHref(href) }),
    appVersion: APP_VERSION,
    deviceToken: localDeviceToken(as),
  });
  const $ = (id: string) => document.getElementById(id) as HTMLElement;
  const draw = () => {
    const s = ps.getState();
    $('status').textContent = s.status;
    $('status').dataset.status = s.status;
    $('error').textContent = s.errorCode ? `${s.errorCode}: ${s.error ?? ''}` : '';
    $('error').dataset.code = s.errorCode ?? '';
    $('company').textContent = s.companyName ?? '';
    $('seat').textContent = s.seat === null ? '' : String(s.seat);
    const c = s.public?.class;
    $('paused').hidden = !c?.paused;
    $('remaining').textContent = c ? String(Math.round(tradeClock.remaining(c.clock, transport.serverNow()))) : '';
  };
  ps.subscribe(draw);
  setInterval(draw, 500);
  (window as unknown as { __h: unknown }).__h = {
    join: (code: string, seat: number, name: string) => ps.join(code, seat, name),
    state: () => {
      const s = ps.getState();
      return { ...s, me: s.me ? { company: (s.me as { company?: unknown }).company } : null };
    },
    publicState: () => ps.getState().public,
    act: (a: unknown) => ps.act(a),
    requestRejoin: () => ps.requestRejoin(),
    setName: (n: string) => ps.setCompanyName(n),
    autoRejoin: () => ps.autoRejoin(),
  };
  if (readQueryParam(href, 'auto') === '1') ps.autoRejoin();
}

void main();
