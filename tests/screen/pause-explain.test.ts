/**
 * (10-22 교사 피드백) [잠깐 멈춤] 중 TV: 설명할 내용(개념 슬라이드·사건 카드·세관 게시판+학습지)이 있으면 그 장면을 그대로 두고,
 * 설명할 것이 없으면(라운드 중 해도 등) 예전처럼 '선생님을 보세요' 멈춤 장면.
 */
import { describe, expect, it } from 'vitest';
import { PAUSE_EXPLAIN_SCENES, resolveScene } from '../../src/screen';
import { parseScreenData, type ScreenData } from '../../src/screen/model';
import { scenePayload, type FixtureScene } from './fixtures';

const NOW = Date.UTC(2026, 9, 9, 2, 0, 0);
function data(scene: FixtureScene): ScreenData {
  const p = scenePayload(scene, { now: NOW });
  const d = parseScreenData(p.publicState, p.classView);
  if (!d) throw new Error('parse');
  return d;
}
const paused = (d: ScreenData): ScreenData => ({ ...d, cls: { ...d.cls, paused: true } });

describe('잠깐 멈춤 중 TV 장면', () => {
  it('멈춤이 아니면 평소와 같다(회귀)', () => {
    expect(resolveScene(data('event'), NOW)).toBe('event');
    expect(resolveScene(data('map'), NOW)).toBe('map');
  });
  it('사건 카드·개념 슬라이드가 떠 있으면 멈춰도 그 장면을 둔다', () => {
    const d = data('event');
    expect(resolveScene(paused(d), NOW)).toBe(resolveScene(d, NOW));
    expect(PAUSE_EXPLAIN_SCENES.has(resolveScene(paused(d), NOW))).toBe(true);
  });
  it('표지·앞 차시 요약·학습지 팝업이 떠 있어도 멈춤 장면으로 바꾸지 않는다', () => {
    for (const sc of ['cover', 'summary', 'worksheet', 'worksheetCustoms'] as const) {
      const d = data(sc);
      expect(resolveScene(paused(d), NOW), sc).toBe(resolveScene(d, NOW));
      expect(resolveScene(paused(d), NOW), sc).not.toBe('pause');
    }
  });
  it('설명할 내용이 없으면(라운드 중 해도·라운드 사이) 멈춤 장면(선생님을 보세요)', () => {
    expect(resolveScene(paused(data('map')), NOW)).toBe('pause');
    expect(resolveScene(paused(data('between')), NOW)).toBe('pause');
    expect(resolveScene(data('pause'), NOW)).toBe('pause');
  });
  it('끝난 판(phase ended)에서는 멈춤 규칙을 쓰지 않는다', () => {
    const d = data('awards');
    const ended = { ...d, cls: { ...d.cls, phase: 'ended' as const } };
    expect(resolveScene({ ...ended, cls: { ...ended.cls, paused: true } }, NOW)).toBe(resolveScene({ ...ended, cls: { ...ended.cls, paused: false } }, NOW));
  });
  it('마무리(결산) 중 멈춤은 예전처럼 멈춤 장면', () => {
    expect(resolveScene(paused(data('awards')), NOW)).toBe('pause');
  });
});
