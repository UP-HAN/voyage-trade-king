import { describe, expect, it } from 'vitest';
import { aggregate } from '../../src/core/aggregate';
import { hostReduce, predict } from '../../src/core/host';
import type { HostOutput, HostSnapshot, Player } from '../../src/core/types';
import type { NameValidator } from '../../src/core/company';
import { act, makeSession, pidOf, player, run, teach } from './helpers';

const acks = (outs: HostOutput[]) => outs.filter((o) => o.kind === 'ack');
const publicOf = (outs: HostOutput[]) => {
  const o = outs.find((x) => x.kind === 'public');
  return o && o.kind === 'public' ? o.data : null;
};

function tradingClass(n = 30): HostSnapshot {
  return teach(makeSession({ n, scope: ['L1'] }), { type: 'startRound' });
}

describe('호스트 리듀서 — 학생 30명', () => {
  it('학생 30명 행동 → 각자 ack, 개인 상태는 본인에게만', () => {
    let s = tradingClass();
    for (let seat = 1; seat <= 30; seat++) {
      const r = act(s, seat, { type: 'buy', good: seat % 2 ? 'chip' : 'car', qty: 1 }, seat * 10);
      const a = acks(r.outputs);
      expect(a).toHaveLength(1);
      expect(a[0]).toMatchObject({ to: 'seat', seat, seq: seat * 10, ok: true });
      const me = r.outputs.filter((o) => o.kind === 'me');
      expect(me.map((o) => (o as { seat: number }).seat)).toEqual([seat]);
      expect(JSON.stringify(me[0])).not.toContain('device-token');
      s = r.snapshot;
    }
    expect(Object.values(s.players).every((p) => p.game.cargo.length === 1)).toBe(true);
  });

  it('거절된 행동도 ack(ok: false, error)', () => {
    const s = tradingClass(2);
    const r = act(s, 1, { type: 'buy', good: 'chip', qty: 999 }, 7);
    expect(acks(r.outputs)[0]).toMatchObject({ seq: 7, ok: false, error: 'BUY_LIMIT' });
    expect(r.snapshot.players.s01).toBe(s.players.s01);
    expect(acks(act(s, 33, { type: 'setReady' }, 1).outputs)[0]).toMatchObject({ ok: false, error: 'NOT_SEATED' });
  });

  it('학생 A의 행동은 학생 B 상태를 바꾸지 않는다', () => {
    const s = tradingClass(5);
    const r = act(s, 1, { type: 'buy', good: 'chip', qty: 3 });
    for (let seat = 2; seat <= 5; seat++) expect(r.snapshot.players[`s0${seat}`]).toBe(s.players[`s0${seat}`]);
    expect(player(r.snapshot, 1).game.money).toBeLessThan(500);
  });

  it('공개 상태에 학생별 자금·출석번호·미응답 명단이 없다', () => {
    let s = tradingClass();
    s = act(s, 3, { type: 'buy', good: 'chip', qty: 2 }).snapshot;
    s = teach(s, { type: 'endRound' });
    s = teach(s, { type: 'fireEvent', id: 'L1-E1' });
    s = act(s, 4, { type: 'respondEvent', eventId: 'L1-E1', response: { answers: { silk: 'sold' } } }).snapshot;
    const pub = aggregate(s.class, s.players, { playUnit: 'lesson' });
    const json = JSON.stringify(pub);
    expect(json).not.toContain('"seat"');
    expect(json).not.toContain('"money"');
    expect(json).not.toContain('"deviceToken"');
    expect(json).not.toContain('"responses"');
    expect(pub.event).toEqual({ id: 'L1-E1', responded: 1, total: 30 });
    expect(pub.companies).toHaveLength(30);
    expect(pub.ships[0]).toEqual({ pid: pidOf(1), port: 'BUS', color: expect.any(String), emblem: expect.any(String) });
    expect(Object.keys(pub.ships[0]).sort()).toEqual(['color', 'emblem', 'pid', 'port']);
    expect(pub.leaderboard.exports).toHaveLength(30); // 수출 0 동점 → 모두 3위 안(경계 동점)
  });

  it('30명 판 aggregate() 전체(마무리·시상 포함)를 JSON으로 바꿔도 "seat"가 없다', () => {
    let s = tradingClass();
    for (let seat = 1; seat <= 30; seat++) s = act(s, seat, { type: 'buy', good: 'chip', qty: (seat % 5) + 1 }).snapshot;
    s = teach(s, { type: 'endTrade' });
    expect(s.class.phase).toBe('wrapup');
    const pub = aggregate(s.class, s.players, { playUnit: 'lesson' });
    expect(pub.awards).not.toBeNull();
    expect(JSON.stringify(pub)).not.toContain('"seat"');
    const out = run(s, { type: 'leave', seat: 1 }).outputs;
    expect(JSON.stringify(out.filter((o) => o.to === 'all'))).not.toContain('"seat"');
  });

  it('라운드가 끝나면 접속이 끊긴 학생 배도 항해한다', () => {
    let s = tradingClass(3);
    s = act(s, 2, { type: 'setDestination', port: 'YOK' }).snapshot;
    s = act(s, 2, { type: 'setReady' }).snapshot;
    s = run(s, { type: 'leave', seat: 2 }).snapshot;
    expect(player(s, 2).online).toBe(false);
    const r = run(s, { type: 'teacher', action: { type: 'endRound' } });
    expect(player(r.snapshot, 2).game.port).toBe('YOK');
    expect(player(r.snapshot, 1).game.port).toBe('BUS');
    expect(player(r.snapshot, 1).game.resolvedRound).toBe(1);
    const ev = r.outputs.find((o) => o.kind === 'events' && o.seat === 2);
    expect(ev && ev.kind === 'events' ? ev.events.map((e) => e.type) : []).toContain('arrived');
  });

  it('시간이 되면 틱이 라운드를 끝낸다(roundEndsAt)', () => {
    const s = teach(makeSession({ n: 2 }), { type: 'startRound', durationSec: 120 }, 0);
    expect(run(s, { type: 'tick' }, 119_999).snapshot.class.phase).toBe('round');
    const after = run(s, { type: 'tick' }, 120_000).snapshot;
    expect(after.class.phase).toBe('between');
    expect(player(after, 1).game.resolvedRound).toBe(1);
  });

  it('onTick 훅(작업 123 자리)이 불린다', () => {
    const s = makeSession({ n: 1 });
    let called = 0;
    const r = hostReduce(s, { type: 'tick' }, 5, { onTick: (snap) => (called++, { snapshot: snap }) });
    expect(called).toBe(1);
    expect(r.outputs).toEqual([]);
  });
});

describe('predict = 호스트 결과', () => {
  it('같은 행동 순서를 학생 기기(predict)와 호스트가 처리하면 같은 상태', () => {
    let s = tradingClass(2);
    let local: Player = player(s, 1);
    const actions = [
      { type: 'buy', good: 'chip', qty: 3 },
      { type: 'buy', good: 'kcon', qty: 2 },
      { type: 'buy', good: 'graphite', qty: 1 },
      { type: 'setDestination', port: 'SHA' },
      { type: 'setReady' },
      { type: 'cancelReady' },
      { type: 'setReady' },
      { type: 'buy', good: 'chip', qty: 999 },
    ] as const;
    let seq = 0;
    for (const a of actions) {
      const pr = predict(local, s.class, a);
      const r = act(s, 1, a, ++seq);
      s = r.snapshot;
      expect(pr.player).toEqual(player(s, 1));
      const ack = acks(r.outputs)[0];
      expect(ack.kind === 'ack' && ack.ok).toBe(!pr.error);
      if (ack.kind === 'ack') expect(ack.events).toEqual(pr.events);
      local = pr.player;
    }
  });
});

describe('순수 함수', () => {
  it('같은 입력 → 같은 출력(스냅숏·출력 모두), 입력 스냅숏은 바뀌지 않음', () => {
    const s = tradingClass(10);
    const frozen = JSON.stringify(s);
    const inputs = [
      { type: 'act', seat: 4, seq: 1, action: { type: 'buy', good: 'car', qty: 2 } },
      { type: 'teacher', action: { type: 'endRound' } },
      { type: 'join', seat: 11, pid: 'zz11aa', deviceToken: 'tok-eleven', companyName: '새회사', nameKey: '새회사' },
    ] as const;
    for (const input of inputs) {
      const a = hostReduce(s, input, 4242);
      const b = hostReduce(s, input, 4242);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
    expect(JSON.stringify(s)).toBe(frozen);
  });
});

describe('회사 이름(v0.3.1)', () => {
  it('막힌 이름은 공개 상태에 null, 학생은 새 이름을 정할 수 있다', () => {
    let s = makeSession({ n: 3 });
    s = teach(s, { type: 'startRound' });
    const r = run(s, { type: 'teacher', action: { type: 'blockCompanyName', seat: 2 } });
    s = r.snapshot;
    const pub = publicOf(r.outputs)!;
    expect(pub.public.companies.find((c) => c.pid === pidOf(2))?.name).toBeNull();
    expect(pub.public.ships.length).toBe(3);
    expect(JSON.stringify(pub)).not.toContain('bannedNameKeys');
    expect(r.outputs.some((o) => o.kind === 'me' && o.seat === 2 && o.data.company.nameStatus === 'blocked')).toBe(true);
    // 같은 이름은 다시 못 씀, 새 이름은 됨(무역 중이어도 막힌 뒤에는 가능)
    expect(acks(act(s, 2, { type: 'setCompanyName', name: '해오름2' }).outputs)[0]).toMatchObject({ ok: false, error: 'BAD_NAME' });
    expect(acks(act(s, 2, { type: 'setCompanyName', name: '해오름1' }).outputs)[0]).toMatchObject({ ok: false, error: 'NAME_TAKEN' });
    const ok = act(s, 2, { type: 'setCompanyName', name: '바다 상회' }).snapshot;
    expect(player(ok, 2).company).toMatchObject({ name: '바다 상회', nameKey: '바다상회', nameStatus: 'ok' });
    expect(aggregate(ok.class, ok.players).companies.find((c) => c.pid === pidOf(2))?.name).toBe('바다 상회');
    // 막히지 않은 학생은 무역 중에 이름을 바꿀 수 없다
    expect(acks(act(s, 1, { type: 'setCompanyName', name: '다른이름' }).outputs)[0]).toMatchObject({ ok: false, error: 'NAME_LOCKED' });
  });

  it('renameCompany 뒤 공개 상태 회사 이름이 바뀐다', () => {
    const s = makeSession({ n: 2 });
    const r = run(s, { type: 'teacher', action: { type: 'renameCompany', seat: 1, name: '푸른 해운' } });
    expect(publicOf(r.outputs)!.public.companies.find((c) => c.pid === pidOf(1))?.name).toBe('푸른 해운');
    // 중복은 막는다
    const dup = run(r.snapshot, { type: 'teacher', action: { type: 'renameCompany', seat: 2, name: '푸른해운' } });
    expect(dup.outputs).toContainEqual(expect.objectContaining({ to: 'teacher', code: 'NAME_TAKEN' }));
    expect(player(dup.snapshot, 2).company.name).toBe('해오름2');
  });

  it('주입한 이름 검사 함수를 쓴다(금칙어는 교사 바꾸기에서 경고만)', () => {
    const validator: NameValidator = (raw, o) =>
      raw.includes('나쁜') ? { ok: false, error: 'BAD_NAME' } : { ok: true, name: raw.trim(), key: raw.replace(/\s/g, ''), realNameHint: raw === '김민수' && !o.takenKeys.includes('김민수') };
    let s = makeSession({ n: 1 });
    const bad = hostReduce(s, { type: 'act', seat: 1, seq: 1, action: { type: 'setCompanyName', name: '나쁜회사' } }, 0, { validateName: validator });
    expect(acks(bad.outputs)[0]).toMatchObject({ ok: false, error: 'BAD_NAME' });
    const real = hostReduce(s, { type: 'act', seat: 1, seq: 2, action: { type: 'setCompanyName', name: '김민수' } }, 0, { validateName: validator });
    expect(player(real.snapshot, 1).company.nameStatus).toBe('checkRealName');
    const t = hostReduce(s, { type: 'teacher', action: { type: 'renameCompany', seat: 1, name: '나쁜회사' } }, 0, { validateName: validator });
    expect(t.outputs).toContainEqual(expect.objectContaining({ code: 'BAD_NAME_WARNING' }));
    expect(player(t.snapshot, 1).company.name).toBe('나쁜회사');
    s = t.snapshot;
  });

  it('이름 확인 후 공개(nameReview): 확인 전에는 null, approveCompanyName 뒤 공개', () => {
    let s = makeSession({ n: 0 });
    s = teach(s, { type: 'updateSettings', settings: { nameReview: true } });
    s = run(s, { type: 'join', seat: 1, pid: 'rv0001', deviceToken: 'tok-review', companyName: '확인무역', nameKey: '확인무역' }).snapshot;
    expect(player(s, 1).company.nameStatus).toBe('review');
    expect(aggregate(s.class, s.players).companies[0].name).toBeNull();
    s = teach(s, { type: 'approveCompanyName', seat: 1 });
    expect(aggregate(s.class, s.players).companies[0].name).toBe('확인무역');
  });

  it('reassignSeat 뒤 회사 상태는 그대로', () => {
    let s = tradingClass(3);
    s = act(s, 3, { type: 'buy', good: 'car', qty: 2 }).snapshot;
    const before = player(s, 3);
    const r = run(s, { type: 'teacher', action: { type: 'reassignSeat', from: 3, to: 17 } });
    s = r.snapshot;
    expect(s.players.s03).toBeUndefined();
    const after = player(s, 17);
    expect(after.seat).toBe(17);
    expect(after.pid).toBe(before.pid);
    expect(after.company).toEqual(before.company);
    expect(after.game).toEqual(before.game);
    expect(after.deviceToken).toBe(before.deviceToken);
    // 공개 상태는 pid 로만 가리키므로 바뀌지 않는다
    expect(publicOf(r.outputs)).toBeNull();
    // 이미 있는 번호로는 못 옮김
    expect(run(s, { type: 'teacher', action: { type: 'reassignSeat', from: 17, to: 1 } }).outputs).toContainEqual(expect.objectContaining({ code: 'SEAT_TAKEN' }));
  });

  it('입장 마감·내보내기', () => {
    let s = makeSession({ n: 3 });
    s = teach(s, { type: 'lockJoin' });
    expect(s.meta.locked).toBe(true);
    s = teach(s, { type: 'kick', seat: 2 });
    expect(s.players.s02).toBeUndefined();
    expect(Object.keys(s.players)).toHaveLength(2);
  });
});

describe('세션(124) 모양 연결', () => {
  it('기기 토큰 없는 join, presence, hostGap 훅, 세션 출력 어댑터', async () => {
    const { createSessionReducer } = await import('../../src/core/host');
    let s = makeSession({ n: 0 });
    const reducer = createSessionReducer({ onHostGap: (snap, gap) => ({ snapshot: { ...snap, savedAt: gap } }) });
    let r = reducer(s, { type: 'join', seat: 4, pid: 'ab12cd', companyName: '새벽해운', nameKey: '새벽해운', nameStatus: 'ok' }, 10);
    s = r.snapshot;
    expect(player(s, 4).deviceToken).toBe('');
    expect(r.outputs.map((o) => o.type).sort()).toEqual(['me', 'public']);
    expect(JSON.stringify(r.outputs.find((o) => o.type === 'public'))).not.toContain('"seat"');
    r = reducer(s, { type: 'presence', seat: 4, online: false }, 11);
    expect(player(r.snapshot, 4).online).toBe(false);
    s = teach(r.snapshot, { type: 'startRound' });
    r = reducer(s, { type: 'act', seat: 4, seq: 3, action: { type: 'buy', good: 'chip', qty: 1 } }, 12);
    expect(r.outputs.find((o) => o.type === 'ack')).toEqual({ type: 'ack', seat: 4, seq: 3, ok: true });
    const me = r.outputs.find((o) => o.type === 'me');
    expect(me && me.type === 'me' ? (me.data as { events: unknown[] }).events.length : 0).toBeGreaterThan(0);
    r = reducer(s, { type: 'teacher', action: { type: 'skipEvent', id: 'L1-E2' } }, 13);
    expect(r.outputs).toContainEqual({ type: 'teacher', data: { notice: 'NEEDS_CONFIRM', message: 'REQUIRED_EVENT', action: { type: 'skipEvent', id: 'L1-E2' } } });
    expect(reducer(s, { type: 'hostGap', gapMs: 9000 }, 14).snapshot.savedAt).toBe(14);
  });
});
