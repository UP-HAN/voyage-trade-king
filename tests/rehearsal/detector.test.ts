import { describe, expect, it } from 'vitest';
import { Collector, Streak, isNormalCover, layerLegit, isPreviewAct, hasRoundGuidance, hasStartConfirmRoundHint, hasTeacherRoundCountdown, parseHudMoney, parseTableMoney } from './detector';
import { relayEnv } from './env';

describe('리허설 탐지기(작업 135)', () => {
  it('HUD 금액·교사 표 금액을 만 원 단위로 읽는다', () => {
    expect(parseHudMoney('1억 2,345만 원')).toBe(12345);
    expect(parseHudMoney('2,345만 원')).toBe(2345);
    expect(parseHudMoney('자금 1억 원')).toBe(10000);
    expect(parseHudMoney('-30만 원')).toBe(-30);
    expect(parseHudMoney('없음')).toBeNull();
    expect(parseTableMoney('12,345')).toBe(12345);
  });

  it('라운드 안내 글을 알아본다(134 예정 문구 포함)', () => {
    expect(hasRoundGuidance('지금은 다 함께 활동하는 시간이에요 · 라운드 1까지 3:30')).toBe(true);
    expect(hasRoundGuidance('다음 라운드까지 0:45')).toBe(true);
    expect(hasRoundGuidance('선생님이 시작하면 라운드가 열려요')).toBe(true);
    expect(hasRoundGuidance('선생님 활동이 끝나면 이어서 해요')).toBe(false);
    expect(hasRoundGuidance('남은 무역 시간 8:30')).toBe(false);
    expect(hasTeacherRoundCountdown('라운드 1까지 2:10 [지금 라운드 시작]')).toBe(true);
    expect(hasTeacherRoundCountdown('9:58 일시정지')).toBe(false);
    expect(hasStartConfirmRoundHint('먼저 벽란도 시장 활동을 하고 약 3분 50초 뒤 라운드 1이 시작돼요')).toBe(true);
    expect(hasStartConfirmRoundHint('무역 시간 10분이 시작돼요.')).toBe(false);
  });

  it('연속 시간과 문제 묶음', () => {
    const s = new Streak();
    expect(s.update(true, 1000)).toBe(0);
    expect(s.update(true, 31_000)).toBe(30_000);
    expect(s.update(false, 32_000)).toBe(0);
    expect(s.longest).toBe(30_000);
    const c = new Collector('a');
    c.step('하나');
    c.add({ kind: 'page-error', severity: '문제', key: 'k', title: 't', detail: 'd', at: '0:10', who: ['학생1'] });
    c.add({ kind: 'page-error', severity: '문제', key: 'k', title: 't', detail: 'd', at: '0:20', who: ['학생2'] });
    expect(c.problems).toHaveLength(1);
    expect(c.problems[0]!.count).toBe(2);
    expect(c.problems[0]!.who).toEqual(['학생1', '학생2']);
    expect(c.problems[0]!.steps).toEqual(['하나']);
  });

  it('중계 서버 환경 변수는 운영 결정(1.3.2)과 같다', () => {
    const e = relayEnv();
    expect(e.MAX_ROOMS).toBe('30');
    expect(e.MAX_CONN).toBe('1380');
    expect(e.MSG_RATE).toBe('20');
    expect(e.HOST_MSG_RATE).toBe('120');
    expect(e.PORT).toBeUndefined();
  });

  it('준비 중(L2~L4) 행동과 정상 층 가림을 가려낸다(보완 1)', () => {
    expect(isPreviewAct('respondEvent L3-E4')).toBe(true);
    expect(isPreviewAct('respondEvent L1-E5')).toBe(false);
    expect(isPreviewAct(undefined)).toBe(false);
    const base = { top: '<div>', chain: '<div>', inert: false };
    expect(isNormalCover({ ...base, layer: 'event' })).toBe(true);
    expect(isNormalCover({ ...base, layer: 'worksheet' })).toBe(true);
    expect(isNormalCover({ ...base, layer: null, inert: true })).toBe(true);
    expect(isNormalCover({ ...base, layer: null })).toBe(false);
    expect(isNormalCover({ ...base, layer: 'toast' })).toBe(false);
  });

  it('맨 위 층이 공개 상태와 맞는지 본다(수정 1)', () => {
    const scr = { catchup: false, minigame: false, eventResult: false, worksheet: false };
    const pub = { event: null, worksheetOn: false, paused: false, phase: 'round' };
    expect(layerLegit(null, scr, pub)).toBe(true);
    expect(layerLegit('event', scr, pub)).toBe(false); // 사건 없음인데 사건 층
    expect(layerLegit('event', scr, { ...pub, event: { closed: false, blocking: false } })).toBe(false); // 비차단 사건인데 가운데 층
    expect(layerLegit('event', scr, { ...pub, event: { closed: true, blocking: true } })).toBe(true); // 차단형 마감 결과
    expect(layerLegit('event', { ...scr, catchup: true }, pub)).toBe(true);
    expect(layerLegit('worksheet', scr, pub)).toBe(false);
    expect(layerLegit('worksheet', scr, { ...pub, worksheetOn: true })).toBe(true);
    expect(layerLegit('modal', scr, pub)).toBeNull();
  });
});
