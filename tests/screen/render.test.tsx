/**
 * 작업 110 공용 화면 렌더(가짜 DOM + 가짜 BroadcastChannel): 호스트 쪽 `createScreenPublisher`(124)가 보낸 공개 상태를
 * `ScreenApp`이 받아 장면을 그린다. 모든 장면 DOM 글자·속성에 출석번호(`seat`, "7번" 꼴)·학생 자금·방 수가 없는지,
 * 막힌 이름이 "이름 짓는 중"인지, 순위판이 N(0/3/4/5)만큼만 그리는지 본다.
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seatKey } from '../../src/core';
import ScreenApp from '../../src/screen/index';
import { leaderTabs, parseScreenData } from '../../src/screen/model';
import { createScreenPublisher } from '../../src/sync/screen-bridge';
import { installFakeDom } from '../map/fake-dom';
import { buildGame, FIXTURE_NAMES, payloadOf, type FixtureOptions, type FixtureScene } from './fixtures';

/** 같은 이름의 다른 채널 객체에 동기로 전달하는 가짜 BroadcastChannel */
class FakeBC {
  static all = new Set<FakeBC>();
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  constructor(public name: string) {
    FakeBC.all.add(this);
  }
  postMessage(data: unknown) {
    const copy = JSON.parse(JSON.stringify(data)) as unknown;
    for (const c of [...FakeBC.all]) if (c !== this && c.name === this.name) c.onmessage?.({ data: copy });
  }
  close() {
    FakeBC.all.delete(this);
  }
}

let dom: ReturnType<typeof installFakeDom>;
const g = globalThis as Record<string, unknown>;
let prevBC: unknown;
const CODE = '482137';
/** 순위판 첫 탭(수출액)이 보이는 시각 */
let NOW = 0;

beforeEach(() => {
  dom = installFakeDom();
  prevBC = g.BroadcastChannel;
  g.BroadcastChannel = FakeBC;
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
  NOW = 840 * 10_000 * 1000; // 탭 수(5~8)의 공배수 × 10초 → 첫 탭
  vi.setSystemTime(NOW);
});
afterEach(() => {
  act(() => render(null, dom.root as unknown as Element));
  FakeBC.all.clear();
  g.BroadcastChannel = prevBC;
  vi.useRealTimers();
  dom.restore();
});

const byTest = (id: string) => dom.root.find((el) => el.getAttribute('data-testid') === id);
/** DOM 전체 글자 + 모든 속성 값 */
function dump(): string {
  const parts: string[] = [dom.root.textContent];
  for (const el of dom.root.all()) for (const [k, v] of el.attributes) parts.push(`${k}=${v}`);
  return parts.join('\n');
}

function show(scene: FixtureScene, o: FixtureOptions = {}, embedded = false) {
  const game = buildGame(scene, { now: Date.now(), ...o });
  const pub = createScreenPublisher(CODE, { strict: true });
  act(() => {
    render(<ScreenApp code={CODE} embedded={embedded} />, dom.root as unknown as Element);
  });
  act(() => {
    const p = payloadOf(game);
    pub.publishToScreen(p.publicState as never, p.classView as never);
  });
  return { game, pub };
}

/** 금지 정보: 출석번호 꼴·학생별 자금·방 수 */
function expectNoPrivate(game: ReturnType<typeof buildGame>) {
  const text = dump();
  expect(text).not.toMatch(/\d+\s*번(?!째)/);
  expect(text).not.toMatch(/seat/i);
  expect(text).not.toContain('출석');
  expect(text).not.toMatch(/사용 중인 방|\d+\s*\/\s*50\b/);
  for (const p of Object.values(game.players)) {
    expect(text).not.toContain(`${p.game.money}만`);
    expect(text).not.toContain(`자금 ${p.game.money}`);
  }
  expect(text).not.toMatch(/미접속|미응답|재접속/);
}

describe('호스트 탭 없음', () => {
  it('제목 "공용 화면" + 잠시 뒤 "선생님 대시보드 창을 열어 주세요"', () => {
    act(() => {
      render(<ScreenApp code={CODE} />, dom.root as unknown as Element);
    });
    expect(byTest('scene-wait')).toHaveLength(1);
    expect(dom.root.textContent).toContain('공용 화면');
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(byTest('wait-text')[0]!.textContent).toBe('선생님 대시보드 창을 열어 주세요');
  });
});

describe('장면 렌더 + 금지 정보 없음', () => {
  it.each([
    ['prep', 'code'],
    ['cover', 'cover'],
    ['summary', 'summary'],
    ['event', 'event'],
    // (작업 113) 'vote'·'bars' 자료는 벽란도(L1-E1) — 마친 학생이 있으면 미니게임 결과 장면
    ['vote', 'minigameResult'],
    ['bars', 'minigameResult'],
    // (수정 1회차) 미니게임이 아닌 결과 막대(L3-E4 투표 공개) — 일반 막대 장면
    ['barsVote', 'bars'],
    ['map', 'map'],
    ['between', 'leaderboard'],
    ['worksheet', 'worksheet'],
    ['worksheetBundle', 'worksheet'],
    ['pause', 'pause'],
    ['awards', 'awards'],
    ['unitL2Cover', 'cover'],
  ] as const)('%s → 장면 %s', (scene, want) => {
    const { game } = show(scene, { blockSeats: [18] });
    const root = byTest('route-screen')[0]!;
    expect(root.getAttribute('data-scene')).toBe(want);
    expect(byTest(`scene-${want}`)).toHaveLength(1);
    expectNoPrivate(game);
  });

  it('검은 화면·교사 선택 장면도', () => {
    for (const c of ['black', 'code', 'map', 'leaderboard'] as const) {
      const { game } = show('map', { choice: c });
      expect(byTest('route-screen')[0]!.getAttribute('data-scene')).toBe(c);
      expectNoPrivate(game);
      act(() => render(null, dom.root as unknown as Element));
      FakeBC.all.clear();
    }
  });
});

describe('방 코드 장면', () => {
  it('6자리 3+3, 주소·QR, "들어온 회사 27개", 막힌 이름은 "이름 짓는 중"', () => {
    show('prep', { blockSeats: [5] });
    expect(byTest('screen-room-code')[0]!.textContent).toBe('482 137');
    expect(byTest('screen-room-code')[0]!.getAttribute('data-code')).toBe(CODE);
    expect(byTest('screen-joined')[0]!.textContent).toBe('들어온 회사 27개');
    expect(byTest('screen-qr')).toHaveLength(1);
    const names = byTest('screen-company').map((el) => el.textContent);
    expect(names).toHaveLength(24);
    expect(names).toContain('이름 짓는 중');
    expect(names).not.toContain(FIXTURE_NAMES[4]);
    expect(byTest('screen-clock')[0]!.textContent).toBe('곧 무역이 시작돼요');
  });

  it('방 코드가 바뀌면 빨간 띠 + 새 코드를 10초간 크게', () => {
    const { pub } = show('map');
    act(() => pub.codeChanged('905113'));
    expect(byTest('code-changed')).toHaveLength(1);
    expect(byTest('screen-room-code')[0]!.textContent).toBe('905 113');
    act(() => {
      vi.advanceTimersByTime(11_000);
    });
    expect(byTest('code-changed')).toHaveLength(0);
  });
});

describe('순위판 상위 N', () => {
  it.each([0, 3, 4, 5] as const)('N=%i', (n) => {
    const { game } = show('between', { topN: n, choice: 'leaderboard', blockSeats: [18] });
    const rows = byTest('board-row');
    if (n === 0) {
      expect(rows).toHaveLength(0);
      expect(byTest('board-hidden')[0]!.textContent).toBe('순위는 시상식에서 공개해요');
      return;
    }
    expect(byTest('scene-leaderboard')[0]!.getAttribute('data-tab')).toBe('exports');
    expect(rows).toHaveLength(n);
    // 표시 = 순위 + 깃발 + 회사 이름뿐(지표 값 없음). 1위(18번 회사)는 이름이 막혀 "이름 짓는 중"
    expect(rows[0]!.textContent).toBe('1위이름 짓는 중');
    const p = parseScreenData(payloadOf(game).publicState, payloadOf(game).classView)!;
    const ex = leaderTabs(p).find((t) => t.id === 'exports')!;
    for (const e of ex.entries) expect(dom.root.textContent).not.toContain(String(e.value));
    // 하위 순위 회사는 화면에 없다
    const shown = new Set(ex.entries.map((e) => e.company));
    for (const c of p.pub.companies) if (!shown.has(c.name) && c.name) expect(dom.root.textContent).not.toContain(c.name);
  });
});

describe('순위판: 순위가 없을 때', () => {
  it('거래 전(모든 값이 같음) → 1위·1위·1위 대신 안내, 도약 탭은 "곧 공개"', () => {
    show('between', { topN: 3, choice: 'leaderboard', plain: true });
    expect(byTest('board-row')).toHaveLength(0);
    expect(byTest('board-empty')[0]!.textContent).toContain('아직 순위를 매길 기록이 없어요');
    expect(dom.root.textContent).toContain('도약(성장률) · 곧 공개');
  });
  it('제목 "상위 N개 회사"는 회사 수를 넘지 않는다', () => {
    show('between', { topN: 5, choice: 'leaderboard', n: 3 });
    expect(byTest('board-topn')[0]!.textContent).toBe('상위 3개 회사');
    expect(byTest('board-row')).toHaveLength(3);
  });
});

describe('시상: 수상 회사 없는 상은 카드가 없다', () => {
  it('거래 없이 마무리(단원 한 판)', () => {
    const { game } = show('awards', { plain: true, unit: true, n: 3 });
    const p = parseScreenData(payloadOf(game).publicState, payloadOf(game).classView)!;
    const withWinners = (p.pub.awards ?? []).filter((a) => a.winners.length > 0);
    expect((p.pub.awards ?? []).length).toBeGreaterThan(withWinners.length);
    const cards = byTest('award-card');
    expect(cards).toHaveLength(withWinners.length);
    for (const c of cards) expect(c.find((el) => el.getAttribute('data-testid') === 'screen-company').length).toBeGreaterThan(0);
    if (withWinners.length === 0) expect(byTest('route-screen')[0]!.getAttribute('data-scene')).not.toBe('awards');
  });
});

describe('그 밖 장면 내용', () => {
  it('해도: 라운드 타이머 + 출항 준비, 시계 띠에 구간 이름', () => {
    show('map');
    expect(byTest('map-round-left')[0]!.textContent).toMatch(/^2:\d\d$/);
    expect(byTest('map-ready')[0]!.textContent).toMatch(/^출항 준비 \d+\/27$/);
    expect(byTest('screen-clock-stage')[0]!.textContent).toBe('L1 · 물건은 어디에서 왔을까? 왜 무역을 할까?');
  });
  it('일시정지: "선생님을 보세요" + 시계 옆 "멈춤"', () => {
    show('pause');
    expect(byTest('scene-pause')[0]!.textContent).toContain('선생님을 보세요');
    expect(byTest('screen-clock-paused')).toHaveLength(1);
  });
  it('학습지 시간: 묶음 번호 + 완료 18/27(이름 없음)', () => {
    show('worksheetBundle');
    expect(byTest('ws-title')[0]!.textContent).toBe('잠깐! ①②③④ 학습지를 써요');
    expect(byTest('ws-row')).toHaveLength(4);
    expect(byTest('ws-done-count')[0]!.textContent).toBe('18/27');
  });
  it('사건: 제목·본문·쪽수(111: 학생 화면과 같은 카드)', () => {
    show('event');
    expect(byTest('card-title')[0]!.textContent).toBe('무역·수입·수출');
    expect(byTest('card-pages')[0]!.textContent).toBe('교과서 연결 p.96');
    expect(byTest('card-band')[0]!.textContent).toContain('개념');
  });
  it('(작업 113) 벽란도 진행 중 마친 학생이 있으면: "다 한 친구 n명" + 맞힌 카드 수 막대 0~9장(이름 없음)', () => {
    const { game } = show('vote');
    expect(byTest('mg-result-count')[0]!.textContent).toBe('다 한 친구 21명');
    expect(byTest('mg-result-bar')).toHaveLength(10);
    const text = dump();
    for (const p of Object.values(game.players)) if (p.company.name) expect(text).not.toContain(p.company.name);
  });
  it('차시 표지(L1)', () => {
    show('cover');
    expect(byTest('cover-kicker')[0]!.textContent).toBe('L1 차시');
    expect(byTest('cover-question')[0]!.textContent).toContain('까닭은 무엇일까요?');
  });
  it('시상: 상 카드 + 회사 이름 + 깃발', () => {
    const { game } = show('awards');
    expect(byTest('award-card').length).toBeGreaterThan(3);
    const names = Object.values(game.players).map((p) => p.company.name);
    const winners = byTest('award-card').flatMap((c) => c.find((el) => el.getAttribute('data-testid') === 'screen-company').map((el) => el.textContent));
    expect(winners.length).toBeGreaterThan(0);
    for (const w of winners) expect(names).toContain(w);
  });
  it('발표 모드(embedded)도 같은 화면', () => {
    show('map', {}, true);
    expect(byTest('route-screen')[0]!.hasClass('scr--embedded')).toBe(true);
    expect(byTest('scene-map')).toHaveLength(1);
  });
  it('호스트 탭 소식이 끊기면 구석 점만', () => {
    show('map');
    expect(byTest('screen-conn')).toHaveLength(0);
    // 호스트가 살아 있으면 hello에 답이 와서 점이 없다
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(byTest('screen-conn')).toHaveLength(0);
    const pubs = [...FakeBC.all].filter((c) => c.name === `voyage-screen-${CODE}`);
    pubs[0]?.close(); // 첫 번째 = 퍼블리셔(먼저 만들어짐)
    act(() => {
      vi.advanceTimersByTime(14_000);
    });
    expect(byTest('screen-conn')).toHaveLength(1);
    expect(byTest('scene-map')).toHaveLength(1);
  });
});

it('fixtures: 학생 자료에 출석번호 키가 있다(공개 상태에서만 빠짐)', () => {
  const game = buildGame('map', { now: Date.now() });
  expect(game.players[seatKey(1)]?.seat).toBe(1);
});

describe('(작업 111 수정 2회차) 결과 표시는 호스트 시각 기준 — 공용 화면 기기 시계가 어긋나도', () => {
  for (const skew of [-60_000, -30_000, 30_000]) {
    it(`호스트 시계가 화면보다 ${skew / 1000}초: 결과 20초 중 남은 10초 동안 사건 장면, 그 뒤 끝`, () => {
      const hostNow = () => Date.now() + skew;
      const game = buildGame('map', { now: Date.now() });
      const cls = game.class;
      game.class = {
        ...cls,
        phase: 'between',
        currentEvent: { id: 'L1-E8', openedAt: hostNow() - 30_000, closesAt: null, closed: true, short: false, revealed: true, resultUntil: hostNow() + 10_000 },
      };
      const pub = createScreenPublisher(CODE, { strict: true, now: hostNow });
      act(() => {
        render(<ScreenApp code={CODE} />, dom.root as unknown as Element);
      });
      act(() => {
        const p = payloadOf(game);
        pub.publishToScreen(p.publicState as never, p.classView as never);
      });
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(byTest('route-screen')[0]!.getAttribute('data-scene')).toBe('event');
      expect(byTest('quiz-rate')).toHaveLength(2);
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      expect(byTest('route-screen')[0]!.getAttribute('data-scene')).not.toBe('event');
    });
  }
});
