import { describe, expect, it } from 'vitest';
import { assertNoSeatInPublic, decodeRejectReason, encodeRejectReason, findSeatKeys, SeatInPublicError } from '../../src/sync/app-messages';
import {
  buildResultFiles,
  compactLogs,
  createHostStore,
  EXPIRE_MS,
  HOST_MAX_BYTES,
  type StoredHost,
} from '../../src/sync/host-store';
import { createPeerStore } from '../../src/sync/peer-store';
import { createScreenPublisher, subscribeScreen, type ScreenChannelLike, type ScreenEvent } from '../../src/sync/screen-bridge';
import { createThrottle, ManualTimers, TokenBucket } from '../../src/sync/throttle';
import { joinMany, makeWorld, MemStorage, newToyGame } from './session-helpers';

function record(code: string, savedAt: number, extra: Partial<StoredHost> = {}): StoredHost {
  return {
    v: 3,
    kind: 'voyage-host',
    code,
    hostToken: 'tok',
    savedAt,
    endedAt: null,
    session: { locked: false, seats: {}, kickedTokens: [], bannedNameKeys: [], joinProblems: [], badNameRejects: 0, publicVersion: 0, startedAt: 0 },
    game: {},
    ...extra,
  };
}

describe('host-store', () => {
  it('2MB를 넘으면 compact(학생 log 앞부분 자르기) 뒤 저장', () => {
    const storage = new MemStorage();
    let t = 1000;
    const store = createHostStore({ storage, now: () => t });
    const line = 'x'.repeat(200);
    const players: Record<string, { money: number; log: string[] }> = {};
    for (let i = 1; i <= 30; i++) players[`s${String(i).padStart(2, '0')}`] = { money: i, log: Array.from({ length: 600 }, () => line) };
    const big = record('482137', t, { game: { players } });
    expect(JSON.stringify(big).length).toBeGreaterThan(HOST_MAX_BYTES);
    const r = store.save(big);
    expect(r.ok).toBe(true);
    expect(r.compacted).toBeGreaterThan(0);
    expect(r.bytes).toBeLessThanOrEqual(HOST_MAX_BYTES);
    const back = store.load('482137') as StoredHost;
    const p = (back.game as typeof big.game & { players: typeof players }).players;
    expect(p.s01!.log.length).toBeLessThan(600);
    expect(p.s01!.money).toBe(1);
    expect(store.lastCode()).toBe('482137');
    // 줄일 것이 없으면 그대로
    const small = record('1', 0);
    expect(compactLogs(small)).toBe(small);
  });

  it('판이 끝나면 24시간 뒤 삭제(가짜 시계), 끝나지 않은 기록도 마지막 저장 24시간 뒤 삭제', () => {
    const storage = new MemStorage();
    let t = 1_000_000;
    const store = createHostStore({ storage, now: () => t });
    store.save(record('111111', t, { endedAt: t }));
    store.save(record('222222', t));
    storage.setItem('voyage.other', 'keep');
    t += EXPIRE_MS - 1;
    expect(store.purgeExpired()).toEqual([]);
    store.save(record('222222', t)); // 계속 진행 중인 판은 저장될 때마다 갱신
    t += 1;
    expect(store.purgeExpired()).toEqual(['111111']);
    expect(store.load('111111')).toBeNull();
    t += EXPIRE_MS;
    expect(store.purgeExpired()).toEqual(['222222']);
    expect(storage.getItem('voyage.other')).toBe('keep');
    expect(storage.getItem('voyage.host.last')).toBeNull();
  });

  it('호스트 세션: 판 끝(phase ended) → host.ending, 24시간 뒤 다음 열기에서 삭제', async () => {
    const w = makeWorld();
    const h = w.host();
    const r = await h.session.open({ game: newToyGame() });
    if (!r.ok) throw new Error(r.error);
    const [a] = await joinMany(w, r.code, 1);
    h.session.dispatchTeacher({ type: 'setPhase', phase: 'ended' });
    await w.advance(1500);
    expect(h.session.getView().ended).toBe(true);
    expect(a!.session.getState().ended).toBe(true);
    expect(a!.store.load()?.endedAt).not.toBeNull();
    expect(h.store.load(r.code)?.endedAt).not.toBeNull();
    h.session.dispose();
    await w.advance(EXPIRE_MS, 60_000);
    const h2 = w.host({ storage: h.storage });
    expect(await h2.session.resume()).toMatchObject({ ok: false, error: 'NO_SAVE' });
    expect(h.storage.length).toBe(0);
    // 학생 기기도 24시간 뒤 지움(기기 토큰 포함)
    const again = w.student({ storage: a!.storage });
    expect(again.session.autoRejoin()).toBe(false);
    expect(a!.storage.length).toBe(1); // 새로 만든 기기 토큰만
  });

  it('결과 CSV: UTF-8 BOM, 열 순서 = 출석번호·회사 이름·판 단위·차시(범위)·지표들·상, 실명 열 없음', async () => {
    const files = buildResultFiles(
      {
        playUnit: '차시마다 한 판',
        scope: 'L1',
        metrics: [
          { key: 'asset', label: '최종 자산' },
          { key: 'exports', label: '수출액' },
        ],
        rows: [
          { seat: 12, values: { asset: 900, exports: 30 }, awards: [] },
          { seat: 3, values: { asset: 1200, exports: 50 }, awards: ['무역왕상', '수출 역군상'] },
        ],
      },
      (seat) => (seat === 3 ? '해오름, "무역"' : '=바다'),
      { className: '6학년 1반', date: '2026-10-09' },
    );
    expect(files.csv.charCodeAt(0)).toBe(0xfeff);
    const lines = files.csv.slice(1).split('\r\n');
    expect(lines[0]).toBe('출석번호,회사 이름,판 단위,차시(범위),최종 자산,수출액,상');
    expect(lines[1]).toBe('3,"해오름, ""무역""",차시마다 한 판,L1,1200,50,무역왕상 / 수출 역군상');
    expect(lines[2]).toBe("12,'=바다,차시마다 한 판,L1,900,30,");
    expect(files.fileBase).toBe('대항해무역왕-6학년1반-2026-10-09');
    expect(JSON.parse(files.json).rows[0]).toMatchObject({ seat: 3, companyName: '해오름, "무역"' });
  });

  it('호스트 세션 exportResult는 세션 장부의 회사 이름을 씀', async () => {
    const w = makeWorld();
    const h = w.host();
    const r = await h.session.open({ game: newToyGame() });
    if (!r.ok) throw new Error(r.error);
    const [a] = await joinMany(w, r.code, 2);
    a!.session.act({ type: 'buy', n: 10 });
    await w.advance(300);
    const files = h.session.exportResult({ className: '6-2' });
    const lines = files!.csv.slice(1).trim().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe(`1,${h.session.getView().seats[0]!.companyName},차시마다 한 판,L1,90,1,무역왕상`);
    h.session.dispose();
  });
});

describe('peer-store', () => {
  it('기기 토큰은 한 번 만들어 보관(128비트), 방 정보 지우기는 토큰을 남김', () => {
    const storage = new MemStorage();
    const s = createPeerStore({ storage, now: () => 0 });
    const t = s.deviceToken();
    expect(t).toMatch(/^[0-9a-f]{32}$/);
    expect(createPeerStore({ storage }).deviceToken()).toBe(t);
    s.save({ code: '482137', seat: 7, companyName: '해오름' });
    s.clearRoom();
    expect(s.load()).toBeNull();
    expect(s.deviceToken()).toBe(t);
  });
});

describe('screen-bridge', () => {
  function hub() {
    const chans = new Map<string, Set<ScreenChannelLike>>();
    const factory = (name: string): ScreenChannelLike => {
      const set = chans.get(name) ?? new Set();
      chans.set(name, set);
      const ch: ScreenChannelLike = {
        onmessage: null,
        postMessage(data) {
          for (const other of set) if (other !== ch) other.onmessage?.({ data: structuredClone(data) });
        },
        close() {
          set.delete(ch);
        },
      };
      set.add(ch);
      return ch;
    };
    return { factory, chans };
  }

  it('늦게 열린 화면도 최신 상태 1번, 출석번호 키는 지움, 코드가 바뀌면 새 채널로', () => {
    const { factory } = hub();
    const pub = createScreenPublisher('482137', { channelFactory: factory });
    const errOrig = console.error;
    console.error = () => undefined;
    pub.publishToScreen({ joined: 2, companies: [{ pid: 'a1', name: '해오름', seat: 3 }] }, { phase: 'round' });
    console.error = errOrig;
    const got: ScreenEvent[] = [];
    const unsub = subscribeScreen('482137', (e) => got.push(e), { channelFactory: factory });
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ type: 'state', publicState: { joined: 2 }, classView: { phase: 'round' } });
    expect(findSeatKeys(got)).toEqual([]);

    pub.codeChanged('654321');
    expect(got.at(-1)).toEqual({ type: 'code.changed', newCode: '654321' });
    const pub2 = createScreenPublisher('654321', { channelFactory: factory });
    pub2.publishToScreen({ joined: 3 });
    expect(got.at(-1)).toMatchObject({ type: 'state', publicState: { joined: 3 } });
    unsub();
    expect(() => createScreenPublisher('1', { channelFactory: factory, strict: true }).publishToScreen({ seat: 1 })).toThrow(
      SeatInPublicError,
    );
  });

  it('호스트 세션 → 공용 화면 메시지 전체에 출석번호 없음(30명 판)', async () => {
    const w = makeWorld();
    const { factory } = hub();
    const h = w.host({ screenFactory: (c) => createScreenPublisher(c, { channelFactory: factory, strict: true }) });
    const r = await h.session.open({ game: newToyGame() });
    if (!r.ok) throw new Error(r.error);
    const seen: ScreenEvent[] = [];
    subscribeScreen(r.code, (e) => seen.push(e), { channelFactory: factory });
    const students = await joinMany(w, r.code, 30);
    for (const s of students) s.session.act({ type: 'buy', n: 2 });
    await w.advance(3000);
    expect(seen.length).toBeGreaterThan(1);
    expect(findSeatKeys(seen)).toEqual([]);
    const last = seen.at(-1) as Extract<ScreenEvent, { type: 'state' }>;
    expect(last.publicState).toMatchObject({ joined: 30, total: 30 * 98 });
    expect(JSON.stringify(seen)).not.toContain('비밀-');
    h.session.dispose();
  });
});

describe('도우미', () => {
  it('assertNoSeatInPublic: 엄격 모드는 예외, 경로만 담음', () => {
    expect(assertNoSeatInPublic({ a: [{ pid: 'x' }] }, true)).toBe(true);
    try {
      assertNoSeatInPublic({ list: [{ seat: 7 }] }, true);
      throw new Error('no throw');
    } catch (e) {
      expect(e).toBeInstanceOf(SeatInPublicError);
      expect((e as SeatInPublicError).paths).toEqual(['list[0].seat']);
      expect(String(e)).not.toContain('7 ');
    }
  });
  it('거절 사유 + 제안 이름 인코딩', () => {
    const r = encodeRejectReason('NAME_TAKEN', ['해오름 무역2', '해오름 무역3']);
    expect(r).toBe('NAME_TAKEN:해오름 무역2,해오름 무역3');
    expect(r.length).toBeLessThanOrEqual(64);
    expect(decodeRejectReason(r)).toEqual({ reason: 'NAME_TAKEN', suggestions: ['해오름 무역2', '해오름 무역3'] });
    expect(decodeRejectReason('SEAT_TAKEN')).toEqual({ reason: 'SEAT_TAKEN', suggestions: [] });
  });
  it('throttle: 1초에 1번, 뒤쪽 실행은 타이머로', () => {
    let t = 0;
    const timers = new ManualTimers(() => t);
    const runs: number[] = [];
    const th = createThrottle(() => runs.push(t), { intervalMs: 1000, now: () => t, timers });
    th.request();
    th.request();
    t = 500;
    th.request();
    timers.runDue();
    t = 1000;
    timers.runDue();
    expect(runs).toEqual([0, 1000]);
    t = 1500;
    th.request();
    th.flush();
    expect(runs).toEqual([0, 1000, 1500]);
  });
  it('TokenBucket: 순간 상한 뒤에는 초당 rate개', () => {
    let t = 0;
    const b = new TokenBucket(18, 36, () => t);
    let n = 0;
    while (b.take()) n++;
    expect(n).toBe(36);
    expect(b.waitMs()).toBe(56);
    t = 1000;
    n = 0;
    while (b.take()) n++;
    expect(n).toBe(18);
  });
});
