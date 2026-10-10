import { describe, expect, it } from 'vitest';
import { hasImage, img, MISSING_IMAGE } from '../../src/ui/common/asset';
import { fx, reducedMotion, setReducedMotionOverride } from '../../src/ui/common/fx';

describe('img()', () => {
  it('assets/images 아래 상대 경로를 만든다', () => {
    const base = import.meta.env.BASE_URL;
    expect(img('ports/busan.png')).toBe(`${base}assets/images/ports/busan.png`);
    expect(img('/title/keyart.png')).toBe(`${base}assets/images/title/keyart.png`);
  });
  it('(작업 134) 빌드에 없는 그림은 요청하지 않고 바로 대체 표시(data:,)', () => {
    expect(hasImage('ports/busan.png')).toBe(true);
    expect(hasImage('lessons/l1.png')).toBe(false);
    expect(img('lessons/l1.png')).toBe(MISSING_IMAGE);
    expect(img('a b/c.png')).toBe(MISSING_IMAGE);
  });
});

describe('fx', () => {
  it('모든 훅이 즉시 resolve 한다', async () => {
    for (const hook of Object.values(fx)) {
      await expect(hook()).resolves.toBeUndefined();
    }
    expect(Object.keys(fx)).toEqual(
      expect.arrayContaining(['stamp', 'sail', 'cardIn', 'gull', 'popupIn', 'pauseIn', 'clockWarn', 'incident', 'cardFlip']),
    );
  });
  it('reduced-motion 판별: 브라우저가 아니면 false, 덮어쓰기 가능', () => {
    expect(reducedMotion()).toBe(false);
    setReducedMotionOverride(true);
    expect(reducedMotion()).toBe(true);
    setReducedMotionOverride(null);
  });
});
