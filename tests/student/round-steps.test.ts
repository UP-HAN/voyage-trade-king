/**
 * 작업 149: 라운드 중 할 일 띠 단계(roundSteps) — 사고팔기(선택) → 목적지 → 출항 준비.
 */
import { describe, expect, it } from 'vitest';
import { publicClass } from '../../src/core';
import { playerView } from '../../src/core/host';
import type { LogEntry } from '../../src/core/types';
import { roundSteps } from '../../src/student/GameScreen';
import type { MeView } from '../../src/student/predict';
import { makeSession, player, startFirstRound } from '../core/helpers';

const s = startFirstRound(makeSession({ n: 1 }));
const cls = publicClass(s.class);

function me(fn?: (m: MeView) => void): MeView {
  const m = JSON.parse(JSON.stringify(playerView(player(s, 1)))) as MeView;
  fn?.(m);
  return m;
}
const trade = (round: number, kind: LogEntry['kind'] = 'buy') => ({ round, stage: cls.stage, kind, port: 'lisbon', amount: 100 }) as unknown as LogEntry;

describe('roundSteps', () => {
  it('라운드 1이 열려 있다', () => {
    expect(cls.phase).toBe('round');
    expect(cls.round).toBe(1);
  });

  it('아무것도 안 함 → 1', () => {
    expect(roundSteps(cls, me())).toEqual({ step: 1, traded: false, dest: false, ready: false });
  });

  it('이번 라운드에 사고팜(buy·sell·produce) → 2', () => {
    for (const kind of ['buy', 'sell', 'produce'] as const) {
      expect(roundSteps(cls, me((m) => { m.game.log.push(trade(1, kind)); }))).toMatchObject({ step: 2, traded: true });
    }
  });

  it('이전 라운드 기록·항해 기록은 traded 에 안 셈', () => {
    expect(roundSteps(cls, me((m) => { m.game.log.push(trade(0, 'buy'), trade(1, 'voyage')); }))).toMatchObject({ step: 1, traded: false });
  });

  it('목적지 고름 → 3 (사고팔기 안 해도)', () => {
    expect(roundSteps(cls, me((m) => { m.game.dest = 'lisbon' as never; }))).toEqual({ step: 3, traded: false, dest: true, ready: false });
  });

  it('출항 준비 → done', () => {
    expect(roundSteps(cls, me((m) => { m.game.dest = 'lisbon' as never; m.game.ready = true; m.game.log.push(trade(1)); }))).toEqual({ step: 'done', traded: true, dest: true, ready: true });
  });
});

// ─── 작업 151: 자유 항해 갈래 ───
import { applyAction } from '../../src/core/rules';
import { isFreeVoyage, laterFareText, pickInfo } from '../../src/student/GameScreen';
import { tutorialStep, tutorialText, TUTORIAL_FREE_ORDER } from '../../src/student/events/logic';
import { teach } from '../core/helpers';

const fs = startFirstRound(teach(makeSession({ n: 1 }), { type: 'updateSettings', settings: { voyageMode: 'free' } }, 0));
const fcls = publicClass(fs.class);
function fme(fn?: (m: MeView) => void): MeView {
  const m = JSON.parse(JSON.stringify(playerView(player(fs, 1)))) as MeView;
  fn?.(m);
  return m;
}

describe('roundSteps — 자유 항해(작업 151)', () => {
  it('자유 항해 판이다', () => {
    expect(isFreeVoyage(fcls)).toBe(true);
    expect(isFreeVoyage(cls)).toBe(false);
  });

  it('처음 → ①(작업 153 추가: 남은 항해 수 없음)', () => {
    expect(roundSteps(fcls, fme())).toEqual({ step: 1, traded: false, dest: false, ready: false, mode: 'free' });
  });

  it('사고팜 → ②, 출발해 도착하면 다시 ①', () => {
    expect(roundSteps(fcls, fme((m) => { m.game.log.push(trade(1, 'buy')); }))).toMatchObject({ step: 2, traded: true });
    const after = fme((m) => {
      m.game.log.push(trade(1, 'buy'), trade(1, 'voyage'));
      m.game.sailsThisRound = 1;
    });
    expect(roundSteps(fcls, after)).toMatchObject({ step: 1, traded: true });
  });
});

describe('pickInfo — 자유 항해(작업 151)', () => {
  it('갈 수 있으면 바로 출발(sail), 운항비는 낼 운항비로', () => {
    const info = pickInfo(fme(), fcls, 'SHA');
    expect(info).toMatchObject({ kind: 'ok', sail: true, free: false });
  });

  it('라운드마다 판은 그대로 목적지 정하기', () => {
    expect(pickInfo(me(), cls, 'SHA')).toMatchObject({ kind: 'ok' });
    expect((pickInfo(me(), cls, 'SHA') as { sail?: boolean }).sail).toBeUndefined();
  });

  it('(작업 153 추가) 여러 번 항해해도 ok(횟수 제한 없음), (작업 159) 쓸 수 있는 돈이 모자라도 ok + later(후불)', () => {
    expect(pickInfo(fme((m) => { m.game.sailsThisRound = 10; }), fcls, 'SHA').kind).toBe('ok');
    const poor = pickInfo(fme((m) => { m.game.money = 50; m.game.fareDue = 45; }), fcls, 'SHA');
    expect(poor).toMatchObject({ kind: 'ok', sail: true, later: true });
    expect(laterFareText((poor as { cost: number }).cost)).toMatch(/^운항비 .+만 원은 나중에 내요\. 도착해서 팔면 돼요\.$/);
    // 돈이 넉넉하면 later 없음
    expect((pickInfo(fme(), fcls, 'SHA') as { later?: boolean }).later).toBeUndefined();
    // 돈이 0이어도(빈손) 출발 가능
    expect(pickInfo(fme((m) => { m.game.money = 0; }), fcls, 'SHA')).toMatchObject({ kind: 'ok', later: true });
  });

  it('학생 예측과 같은 판정: 예측이 되면 pickInfo 도 ok', () => {
    const m = fme();
    const r = applyAction(fs.class, player(fs, 1), { type: 'sailTo', port: 'PHE' });
    expect(r.error).toBeUndefined();
    expect(pickInfo(m, fcls, 'PHE').kind).toBe('ok');
  });
});

describe('1차시 첫 라운드 튜토리얼 — 자유 항해(작업 151)', () => {
  it('출항 준비 단계 없이 고르면 바로 도착, 문구는 자유 항해 갈래', () => {
    expect(tutorialStep(fme(), false, fcls)).toBe('pickDest');
    expect(tutorialStep(fme((m) => { m.game.dest = 'PHE'; }), false, fcls)).toBe('pickDest');
    expect(tutorialStep(fme((m) => { m.game.port = 'PHE'; }), true, fcls)).toBe('buyGas');
    expect(tutorialText('pickDest', fcls)).toContain(TUTORIAL_FREE_ORDER);
    expect(TUTORIAL_FREE_ORDER).toBe('① 항구에 들어가 사고팔기 → ② 지도에서 다음 항구를 누르고 [여기로 출발] → 도착하면 바로 사고팔 수 있어요. 운항비는 라운드가 끝날 때 한꺼번에 내요.');
    // 라운드마다 판은 그대로
    expect(tutorialStep(me((m) => { m.game.dest = 'PHE'; }), false, cls)).toBe('ready');
    expect(tutorialText('pickDest', cls)).toBe('① 지도에서 포트헤들랜드를 눌러 목적지로 정해요.');
  });
});
