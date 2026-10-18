/**
 * 작업 110 공용 화면 모델: 장면 고르기, 상위 N 순위판(0/3/4/5), 무역 시계, 막대, 표지·요약 카드, 주소·방 코드.
 * 자료는 실제 교사 리듀서로 만든 공개 상태(tests/screen/fixtures.ts).
 */
import { describe, expect, it } from 'vitest';
import {
  barsFor,
  clockInfo,
  coverFor,
  currentLeaderTab,
  leaderTabs,
  parseScreenData,
  pickScene,
  rotatingTabs,
  joinUrl,
  hasAwardWinners,
  rulesFor,
  shortAddress,
  spacedCode,
  summaryFor,
  type ScreenData,
} from '../../src/screen/model';
import { buildGame, payloadOf, scenePayload, type FixtureOptions, type FixtureScene } from './fixtures';

const NOW = Date.UTC(2026, 9, 9, 2, 0, 0);
function data(scene: FixtureScene, o: FixtureOptions = {}): ScreenData {
  const p = scenePayload(scene, { now: NOW, ...o });
  const d = parseScreenData(p.publicState, p.classView);
  if (!d) throw new Error('parse');
  return d;
}

describe('장면 고르기(자동)', () => {
  it.each([
    ['prep', 'code'],
    ['cover', 'cover'],
    ['summary', 'summary'],
    ['event', 'event'],
    ['vote', 'event'],
    ['bars', 'bars'],
    ['map', 'map'],
    ['between', 'leaderboard'],
    ['worksheet', 'worksheet'],
    ['worksheetBundle', 'worksheet'],
    ['pause', 'pause'],
    ['awards', 'awards'],
    ['unitL2Cover', 'cover'],
  ] as const)('%s → %s', (scene, want) => {
    expect(pickScene(data(scene), NOW)).toBe(want);
  });

  it('우선순위: 일시정지 > 학습지 시간 > 사건 > 해도', () => {
    const d = data('map');
    const ws = { ...d, cls: { ...d.cls, worksheet: { ...d.cls.worksheet, current: ['W01' as const] } } };
    expect(pickScene(ws, NOW)).toBe('worksheet');
    expect(pickScene({ ...ws, cls: { ...ws.cls, paused: true } }, NOW)).toBe('pause');
    const ev = { ...d, cls: { ...d.cls, currentEvent: { id: 'L1-E6', openedAt: NOW, closesAt: null, closed: false, short: false } } };
    expect(pickScene(ev, NOW)).toBe('event');
  });

  it('교사가 고른 장면이 자동보다 먼저(순위판·해도·방 코드·검은 화면)', () => {
    for (const c of ['leaderboard', 'map', 'code', 'black'] as const) expect(pickScene(data('cover', { choice: c }), NOW)).toBe(c);
  });

  it('준비 단계: 회사가 들어오면 방 코드 20초 ↔ 항해 규칙 12초', () => {
    const d = data('prep');
    const t0 = Math.ceil(NOW / 32_000) * 32_000;
    expect(pickScene(d, t0 + 5_000)).toBe('code');
    expect(pickScene(d, t0 + 25_000)).toBe('rules');
    expect(pickScene(data('prep', { n: 0 }), t0 + 25_000)).toBe('code');
  });

  it('N=0이면 라운드 사이에 순위판 대신 해도', () => {
    expect(pickScene(data('between', { topN: 0 }), NOW)).toBe('map');
  });
});

describe('순위판 상위 N', () => {
  it.each([0, 3, 4, 5] as const)('N=%i → 탭마다 N개 회사만(하위 순위 없음)', (n) => {
    const d = data('between', { topN: n });
    const tabs = leaderTabs(d);
    if (n === 0) {
      expect(tabs).toEqual([]);
      expect(d.pub.leaderboard).toEqual({});
      return;
    }
    expect(tabs.length).toBeGreaterThan(3);
    for (const t of tabs) {
      if (t.state !== 'ok') {
        expect(t.entries).toEqual([]);
        continue;
      }
      expect(t.entries.length).toBe(n);
      for (const e of t.entries) expect(e.rank).toBeLessThanOrEqual(n);
    }
  });

  it('도약 탭은 기준 자산 전 "곧 공개"(순환에서 뺌), 모든 값이 같은 지표(도감 0·협력 0)도 순환에서 뺌', () => {
    const d = data('between');
    const tabs = leaderTabs(d);
    expect(tabs[0]?.id).toBe('exports');
    expect(tabs.find((t) => t.id === 'leap')?.state).toBe('soon');
    expect(tabs.find((t) => t.id === 'dex')?.state).toBe('flat');
    const rot = rotatingTabs(d);
    expect(rot.map((t) => t.id)).toEqual(['exports', 'csr', 'quiz', 'explore', 'finalAsset']);
    for (const t of rot) expect(t.entries).toHaveLength(3);
  });

  it('거래 전(모든 값이 같음)이면 순환할 탭이 없다 — 1위·1위·1위 대신 안내', () => {
    const d = data('between', { plain: true });
    expect(leaderTabs(d).length).toBeGreaterThan(3);
    expect(rotatingTabs(d)).toEqual([]);
  });

  it('10초마다 다음 탭', () => {
    const tabs = rotatingTabs(data('between'));
    const base = tabs.length * 10_000 * 1000;
    expect(currentLeaderTab(tabs, base)).toBe(0);
    expect(currentLeaderTab(tabs, base + 10_000)).toBe(1);
    expect(currentLeaderTab([], base)).toBe(-1);
  });

  it('막힌 이름은 null로 온다(화면은 "이름 짓는 중")', () => {
    const d = data('between', { blockSeats: [18] });
    const ex = leaderTabs(d).find((t) => t.id === 'exports')!;
    expect(ex.entries[0]?.company).toBeNull();
  });
});

describe('무역 시계', () => {
  it('구간 이름 + 남은 시간, 준비 단계·마무리', () => {
    const c = clockInfo(data('map'), NOW);
    expect(c.mode).toBe('trade');
    expect(c.stageLabel).toBe('1차시 · 물건은 어디에서 왔을까? 왜 무역을 할까?');
    expect(c.remaining).toMatch(/^2[01]:\d\d$/);
    expect(clockInfo(data('prep'), NOW).mode).toBe('prep');
    expect(clockInfo(data('awards'), NOW).mode).toBe('hidden');
    expect(clockInfo(data('pause'), NOW).paused).toBe(true);
  });
  it('차시 한 판 L2는 L2 이름 하나', () => {
    expect(clockInfo(data('summary'), NOW).stageLabel).toBe('2차시 · 자원을 사 와서 만들어 팔아요');
  });
});

describe('표지·요약 카드', () => {
  it('차시 한 판 L1: 차시 표지(번호·제목·질문)', () => {
    const d = data('cover');
    const m = coverFor(d, 'L1-COVER');
    expect(m.variant).toBe('lesson');
    expect(m.kicker).toBe('1차시');
    expect(m.question).toContain('생산지가 다양한 까닭');
    expect(m.topCompanies).toBeNull();
  });
  it('차시 한 판 L2: 표지 뒤 앞 차시 요약 카드', () => {
    const cards = summaryFor(data('summary'));
    expect(cards.map((c) => c.title)).toEqual(['1차시 요약 — 무역과 무역이 이루어지는 까닭']);
  });
  it('단원 한 판 L2 표지: "지금까지 상위 N개 회사"(N=0이면 없음)', () => {
    const m = coverFor(data('unitL2Cover', { topN: 4 }), 'L2-E1');
    expect(m.variant).toBe('stage');
    expect(m.topCompanies).toHaveLength(4);
    expect(coverFor(data('unitL2Cover', { topN: 0 }), 'L2-E1').topCompanies).toBeNull();
  });
});

describe('막대', () => {
  it('벽란도 맞힌 수 분포(이름 없음)', () => {
    const m = barsFor(data('bars'), 'L1-E1')!;
    expect(m.countOnly).toBe(false);
    expect(m.rows.reduce((a, r) => a + r.value, 0)).toBe(27);
    expect(JSON.stringify(m)).not.toMatch(/무역|상사|해운|상회/);
  });
  it('투표: 결과 공개 전에는 수만', () => {
    const d = data('bars');
    const v = { ...d, pub: { ...d.pub, vote: { id: 'L3-E4', counts: { yes: 10, no: 7 }, revealed: false, result: null } } };
    expect(barsFor(v, 'L3-E4')!.countOnly).toBe(true);
    const r = barsFor({ ...v, pub: { ...v.pub, vote: { ...v.pub.vote, revealed: true } } }, 'L3-E4')!;
    expect(r.countOnly).toBe(false);
    expect(r.rows.map((x) => x.value)).toEqual([10, 7]);
  });
  it('확인 퀴즈 정답률(%)', () => {
    const d = data('bars');
    const q = { ...d, pub: { ...d.pub, checkQuiz: { 'CQ-L1-1': { right: 9, total: 12 } } } };
    const m = barsFor(q, 'L1-E8')!;
    expect(m.percent).toBe(true);
    expect(m.rows[0]).toEqual({ label: '문제 1', value: 75 });
  });
});

describe('시상: 수상 회사가 없는 상', () => {
  it('거래 없이 마무리(단원 한 판) → 수상자 없는 상만이면 시상 장면이 아니다', () => {
    const d = data('awards', { plain: true, unit: true });
    expect((d.pub.awards ?? []).some((a) => a.winners.length === 0)).toBe(true);
    expect(pickScene(d, NOW)).toBe(hasAwardWinners(d) ? 'awards' : 'leaderboard');
    const none = { ...d, pub: { ...d.pub, awards: (d.pub.awards ?? []).map((a) => ({ ...a, winners: [] })) } };
    expect(hasAwardWinners(none)).toBe(false);
    expect(pickScene(none, NOW)).toBe('leaderboard');
    expect(pickScene({ ...none, cls: { ...none.cls, phase: 'ended' } }, NOW)).toBe('ended');
  });
});

describe('그 밖', () => {
  it('QR 주소에 방 코드: ?room=코드#/play', () => {
    expect(joinUrl('https://lab.ches.es.kr/voyage/', '482137')).toBe('https://lab.ches.es.kr/voyage/?room=482137#/play');
    expect(joinUrl('https://lab.ches.es.kr/voyage/', '')).toBe('https://lab.ches.es.kr/voyage/');
  });
  it('항해 규칙: 역전 장치가 꺼지면 2번 숨김', () => {
    const d = data('prep');
    expect(rulesFor(d).map((r) => r.no)).toEqual([1, 2, 3, 4]);
    expect(rulesFor({ ...d, cls: { ...d.cls, settings: { ...d.cls.settings, comeback: false } } }).map((r) => r.no)).toEqual([1, 3, 4]);
  });
  it('짧은 주소·방 코드 3+3', () => {
    expect(shortAddress('https://lab.ches.es.kr/voyage/?sync=local#/screen?room=482137')).toEqual({ display: 'lab.ches.es.kr/voyage', url: 'https://lab.ches.es.kr/voyage/' });
    expect(shortAddress('http://127.0.0.1:5288/index.html#/screen').display).toBe('127.0.0.1:5288');
    expect(spacedCode('482137')).toBe('482 137');
  });
  it('공개 상태에 출석번호·자금이 없다(공용 화면이 받는 것 전체)', () => {
    const g = buildGame('between', { now: NOW });
    const json = JSON.stringify(payloadOf(g));
    expect(json).not.toMatch(/"seat"\s*:/);
    expect(json).not.toMatch(/"money"\s*:/);
    expect(json).not.toMatch(/"deviceToken"/);
  });
  it('모양이 다른 자료는 null', () => {
    expect(parseScreenData({}, null)).toBeNull();
    expect(parseScreenData({ class: {}, public: {} }, null)).toBeNull();
  });
});
