/**
 * 앱 버전 띠(작업 108 추가 수정): 학생 저장소 기본 앱 버전은 교사 호스트와 같은 `APP_VERSION`(src/config/deploy.ts).
 * 같은 빌드의 교사·학생이면 version.mismatch 가 오지 않아 "새 버전이 나왔어요" 띠가 뜨지 않는다.
 */
import { describe, expect, it } from 'vitest';
import { APP_VERSION } from '../../src/config/deploy';
import { statusBands } from '../../src/student/GameScreen';
import { makeStudentWorld, newGame } from './helpers';

async function joinWith(hostVersion: string) {
  const w = makeStudentWorld();
  const h = w.host({ appVersion: hostVersion });
  const r = await h.session.open({ game: newGame(w.now()) });
  if (!r.ok) throw new Error(r.error);
  await w.advance(200);
  const s = w.student({ appVersion: null });
  await s.store.join(r.code, 5, '바다상회');
  await w.advance(1000);
  return { w, h, s };
}

describe('앱 버전 띠', () => {
  it('교사가 APP_VERSION(같은 빌드)이면 학생 기본값과 같아 띠가 뜨지 않는다', async () => {
    expect(APP_VERSION).toMatch(/\+/);
    const { w, h, s } = await joinWith(APP_VERSION);
    const st = s.store.getState();
    expect(st.peer.status).toBe('in');
    expect(st.peer.versionMismatch).toBe(false);
    expect(statusBands(st, w.now())).not.toContain('version');
    h.session.dispose();
  });

  it('교사 버전이 다르면(다른 빌드) 띠가 뜬다', async () => {
    const { w, h, s } = await joinWith(`${APP_VERSION}-other`);
    const st = s.store.getState();
    expect(st.peer.versionMismatch).toBe(true);
    expect(statusBands(st, w.now())).toContain('version');
    h.session.dispose();
  });
});
