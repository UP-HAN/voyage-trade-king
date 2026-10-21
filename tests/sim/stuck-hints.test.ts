/**
 * 작업 160b — 막힌 학생 갈매기 힌트를 화면 없이 Memory로: 실제 교사 호스트(무역 시계·배치표 훅 + 힌트 판정) + 실제 학생 저장소.
 * 2차시 앞 시간 25분 판, 학생 3명(1번 = 회사만 세우고 아무것도 안 함, 2·3번 = 봇). 무역 시간 12분만 진행(마무리까지 돌리지 않음).
 */
import { describe, expect, it } from 'vitest';
import type { HostSnapshot } from '../../src/core';
import { seatKey } from '../../src/sync/host-session';
import { botAction, makeSimWorld, rng, type SimStudent } from './sim-world';

describe('막힌 학생 갈매기 힌트(Memory, 2차시 앞 시간)', () => {
  it('아무것도 안 하는 학생은 2분·4분에 IPE-MAKE-1:oilp → IPE-MAKE-2:oilp, 기기 상태 = 호스트 상태, 중복 없음·상한', { timeout: 180_000 }, async () => {
    const w = makeSimWorld();
    const h = w.host();
    const code = await w.openGame(h, { playUnit: 'lesson', scope: ['L2'], tradeMinutes: 25, settings: { lessonPart: 'front' } });
    const students: SimStudent[] = [];
    for (const [seat, name] of [[1, '해오름무역'], [2, '바다상회'], [3, '별빛상회']] as const) {
      const s = w.student(seat, name);
      await s.store.join(code, seat, name);
      await w.advance(800);
      students.push(s);
    }
    const rand = rng(160);
    const step = async () => {
      for (const s of students) {
        const a = botAction(s, rand);
        if (!a) continue;
        // 1번 학생은 회사만 세운다(그 뒤로 아무것도 안 함 — 사건 응답·학습지도 안 함)
        if (s.seat === 1 && a.type !== 'foundCompany') continue;
        s.store.act(a);
      }
      await w.advance(1000, 250);
    };
    for (let i = 0; i < 5; i++) await step();
    expect(h.game().players[seatKey(1)]!.company.founded).toBe(true);
    h.teacher({ type: 'startTrade' });

    const hostHints = (g: HostSnapshot, seat: number) => (g.players[seatKey(seat)]!.game.gullHints ?? []).map((x) => x.id);
    /** 임무를 끝낸 순간의 힌트 수(끝낸 뒤 새 힌트가 없어야) */
    const atDone: Record<number, number> = {};
    /** 1번 학생 힌트를 처음 본 힌트 시계 초 */
    const firstSeen: Record<string, number> = {};
    for (let i = 0; i < 12 * 60; i++) {
      await step();
      const g = h.game();
      for (const s of students) {
        const p = g.players[seatKey(s.seat)]!;
        if (p.game.missions['M-IPE']?.status === 'done' && atDone[s.seat] === undefined) atDone[s.seat] = hostHints(g, s.seat).length;
      }
      for (const id of hostHints(g, 1)) firstSeen[id] ??= g.stuck!.clock.sec;
    }
    const g = h.game();
    expect(g.class.tradeEnded).toBe(false);
    expect(Object.keys(g.players[seatKey(1)]!.game.missions)).toEqual(['M-IPE']);

    // 1번 학생: 2분·4분(사고팔 수 있던 시간)에 차례로, 그 뒤 없음
    expect(hostHints(g, 1)).toEqual(['IPE-MAKE-1:oilp', 'IPE-MAKE-2:oilp']);
    const recs = g.players[seatKey(1)]!.game.gullHints!;
    expect(recs.map((r) => r.at)).toEqual([120, 240].map((x) => recs[0]!.at - 120 + x));
    expect(firstSeen['IPE-MAKE-2:oilp']! - firstSeen['IPE-MAKE-1:oilp']!).toBeGreaterThanOrEqual(120);
    // 기기 상태(학생 저장소 me) = 호스트 상태
    const me1 = students[0]!.store.getState().peer.me!;
    expect(me1.game.gullHints).toEqual(recs);

    // 모든 학생: 중복 없음·임무당 5개 이하, 기기 = 호스트
    const table: string[] = [];
    for (const s of students) {
      const ids = hostHints(g, s.seat);
      expect(new Set(ids).size, `seat ${s.seat}`).toBe(ids.length);
      expect(ids.length, `seat ${s.seat}`).toBeLessThanOrEqual(5);
      expect(s.store.getState().peer.me!.game.gullHints ?? [], `seat ${s.seat}`).toEqual(g.players[seatKey(s.seat)]!.game.gullHints ?? []);
      if (atDone[s.seat] !== undefined) expect(ids.length, `seat ${s.seat} 임무 끝낸 뒤 새 힌트 없음`).toBe(atDone[s.seat]);
      table.push(`${s.seat}번 ${g.players[seatKey(s.seat)]!.game.missions['M-IPE']?.status}: ${ids.join(', ') || '(없음)'}`);
    }
    // result.md 의 '학생별 받은 힌트 표'
    console.log(`[160b sim] 힌트 시계 ${g.stuck!.clock.sec}초\n${table.join('\n')}`);
    expect(w.serverErrors).toEqual([]);
    h.session.dispose();
  });
});
