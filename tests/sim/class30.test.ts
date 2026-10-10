/**
 * 작업 114 — 30명 시뮬레이션(PRD 1.5·10.8·10.10): MemoryNetwork(relay-core) + 실제 교사 호스트(teacherReducer·teacherViews)
 * + 실제 학생 저장소 30개가 차시 한 판 L1 30분(자동 진행)을 무작위 행동으로 끝까지 한다.
 *
 * 확인: 오류 0, 모든 학생 resolvedRound 일치, 편지 슬롯 전부 배달, 공개 집계 일치(호스트 = 학생 기기),
 * 출석번호 비노출(공개 메시지·공용 화면 다리), 메시지 수·바이트·리듀서 처리 시간·스냅숏 크기 측정.
 * 측정값은 `tmp/114-sim-class30.json`에 남긴다(result.md 표의 근거).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JsonObject } from '@shared/protocol';
import { findSeatKeys } from '../../src/sync/app-messages';
import { teacherViews } from '../../src/teacher/game';
import { botAction, COMPANY_NAMES, makeSimWorld, ReduceTimer, rng, type SimStudent } from './sim-world';

const N = 30;
const MINUTES = 30;

afterEach(() => vi.restoreAllMocks());

/** 출석번호 비노출: 본인에게만 가는 admitted·seat.changed·state.me 밖의 메시지에 seat 키가 없어야 한다 */
export function seatLeaks(s: SimStudent): string[] {
  const out: string[] = [];
  for (const m of s.inbox) {
    if (m.t === 'admitted' || m.t === 'seat.changed') {
      if (m.seat !== s.seat && m.t === 'admitted') out.push(`admitted.seat=${String(m.seat)}`);
      continue;
    }
    if (m.t === 'state.me') {
      const d = (m.data ?? {}) as JsonObject;
      if (d.seat !== undefined && d.seat !== s.seat) out.push(`state.me.seat=${String(d.seat)}`);
      const { seat: _s, ...rest } = d;
      void _s;
      const keys = findSeatKeys(rest);
      if (keys.length) out.push(`state.me: ${keys.slice(0, 3).join(',')}`);
      continue;
    }
    const keys = findSeatKeys(m);
    if (keys.length) out.push(`${String(m.t)}: ${keys.slice(0, 3).join(',')}`);
  }
  return out;
}

describe('30명 시뮬레이션 — 차시 한 판 L1 30분(자동 진행)', () => {
  it('오류 0 · resolvedRound 일치 · 편지 전부 배달 · 공개 집계 일치 · 출석번호 비노출 + 측정', { timeout: 600_000 }, async () => {
    const consoleErrors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void consoleErrors.push(a.map(String).join(' ')));
    const w = makeSimWorld();
    const h = w.host();
    const code = await w.openGame(h, { playUnit: 'lesson', scope: ['L1'], tradeMinutes: MINUTES });
    expect(code).toMatch(/^\d{6}$/);

    // ── 입장(쉬는 시간처럼 1~2초 간격으로) ──
    const students: SimStudent[] = [];
    for (let i = 1; i <= N; i++) {
      const s = w.student(i, COMPANY_NAMES[i - 1]!);
      students.push(s);
      void s.store.join(code, i, s.name);
      await w.advance(300);
    }
    await w.advance(3000);
    for (const s of students) expect(`${s.seat}:${s.store.getState().peer.status}:${s.store.getState().peer.errorCode ?? ""}`).toBe(`${s.seat}:in:`);
    expect(h.session.getView().seats).toHaveLength(N);

    const rand = rng(114);
    const stepBots = () => {
      for (const s of students) {
        if (rand() < 0.35) {
          const a = botAction(s, rand);
          if (a) {
            const r = s.store.act(a);
            if (r !== 'sent' && r !== 'queued') s.errors.push(String(r));
          }
        }
      }
    };
    // 준비 단계: 회사 설립
    for (let k = 0; k < 40 && !Object.values(h.game().players).every((p) => p.company.founded); k++) {
      stepBots();
      await w.advance(1000, 250);
    }
    expect(Object.values(h.game().players).every((p) => p.company.founded)).toBe(true);

    // ── 무역 시작 → 끝까지 ──
    const t0 = Math.floor(w.now() / 1000);
    h.teacher({ type: 'startTrade' });
    let guard = 0;
    while (h.game().class.phase !== 'wrapup' && guard++ < (MINUTES + 6) * 60) {
      stepBots();
      await w.advance(1000, 250);
    }
    const tEnd = Math.floor(w.now() / 1000);
    expect(h.game().class.phase).toBe('wrapup');
    expect(h.game().class.tradeEnded).toBe(true);
    // 마무리: 결과 공개까지 기다림
    await w.advance(5000, 250);

    const g = h.game();
    const cs = g.class;
    // 1) 모든 학생 resolvedRound 일치(호스트 = 학생 기기)
    const rounds = Object.values(g.players).map((p) => p.game.resolvedRound);
    expect(new Set(rounds).size).toBe(1);
    expect(rounds[0]).toBe(cs.round);
    for (const s of students) expect(s.store.getState().peer.me?.game.resolvedRound, `${s.seat}번 기기`).toBe(cs.round);
    // 2) 편지 슬롯 전부 배달(건너뛴 것 제외)
    const slots = cs.schedule.items.filter((it) => it.kind === 'letter').map((it) => it.refId);
    expect(slots.length).toBeGreaterThan(0);
    for (const id of slots) expect(cs.letters.delivered, `편지 ${id}`).toContain(id);
    // 학생 기기도 같은 배달 목록
    for (const s of students) expect((s.store.getState().peer.public as { class: { letters: { delivered: string[] } } }).class.letters.delivered).toEqual(cs.letters.delivered);
    // 3) 공개 집계 일치
    const pubHost = teacherViews.public(g);
    for (const s of students) expect(s.store.getState().peer.public, `${s.seat}번 공개 상태`).toEqual(pubHost);
    const pubState = pubHost.public as { joinedCount: number; worksheetDone: Record<string, number> };
    expect(pubState.joinedCount).toBe(N);
    const wsCount: Record<string, number> = {};
    for (const p of Object.values(g.players)) for (const id of p.game.worksheetDone) wsCount[id] = (wsCount[id] ?? 0) + 1;
    expect(pubState.worksheetDone).toEqual(wsCount);
    // 4) 출석번호 비노출(공개 메시지 + 공용 화면 다리)
    for (const s of students) expect(seatLeaks(s), `${s.seat}번 받은 메시지`).toEqual([]);
    expect(h.screenMsgs.length).toBeGreaterThan(0);
    for (const m of h.screenMsgs) expect(findSeatKeys(m)).toEqual([]);
    // 5) 오류 0(세션·리듀서 예외·콘솔 오류·저장소 거절)
    expect(consoleErrors).toEqual([]);
    for (const s of students) expect(s.errors, `${s.seat}번 act 결과`).toEqual([]);
    // 사건·학습지 진행 확인(1등급 빠짐 없음)
    const tier1 = cs.schedule.items.filter((it) => it.kind === 'event' && it.tier === 1);
    for (const it of tier1) expect(it.status, it.id).not.toBe('pending');
    const rolls = students.reduce((a, s) => a + s.store.getState().toasts.length, 0);

    // ── 측정 ──
    const r = w.meter.rates(t0, tEnd);
    const snapBytes = Buffer.byteLength(JSON.stringify(g), 'utf8');
    const pubBytes = Buffer.byteLength(JSON.stringify(pubHost), 'utf8');
    const meBytes = Math.max(...Object.keys(g.players).map((k) => Buffer.byteLength(JSON.stringify(teacherViews.me(g, Number(k.slice(1)))), 'utf8')));
    const red = ReduceTimer.stats(w.reduceTimer.samples);
    const byType = Object.fromEntries(Object.entries(w.reduceTimer.byType).map(([k, v]) => [k, ReduceTimer.stats(v)]));
    const report = {
      students: N,
      tradeMinutes: MINUTES,
      tradeSec: tEnd - t0,
      rounds: cs.round,
      letters: slots.length,
      totals: w.meter.total,
      perSec: r,
      reducer: red,
      reducerByType: byType,
      snapshotKB: +(snapBytes / 1024).toFixed(1),
      publicKB: +(pubBytes / 1024).toFixed(1),
      meMaxKB: +(meBytes / 1024).toFixed(1),
      relayStats: w.net.stats(),
      toastsAtEnd: rolls,
    };
    mkdirSync('tmp', { recursive: true });
    writeFileSync(join('tmp', '114-sim-class30.json'), JSON.stringify(report, null, 2));
    // 서버 상한 안(PRD 10.10 연결당 초당 20개·순간 40개, 호스트 연결은 105에서 120·240) — 서버 오류 메시지 0
    expect(w.serverErrors).toEqual([]);
    expect(r.studentOut.maxN).toBeLessThanOrEqual(40);
    // 호스트 클라이언트 토큰통(초당 18·순간 36) + 1초 칸 경계에서 나올 수 있는 이론 최대 약 54(서버 상한 120·240 안).
    // (작업 132: v0.3.4 배치로 라운드 시작 시각이 바뀌어 42 관측 — 학생 연결 40 기준은 그대로)
    expect(r.hostOut.maxN).toBeLessThanOrEqual(54);
    expect(red.p95).toBeLessThan(50);
    expect(snapBytes).toBeLessThan(1024 * 1024);
    h.session.dispose();
  });
});
