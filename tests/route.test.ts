import { describe, expect, it } from 'vitest';
import { routeFromHash } from '../src/route';

describe('routeFromHash', () => {
  it.each([
    ['', '/'],
    ['#', '/'],
    ['#/', '/'],
    ['#/play', '/play'],
    ['#/play/', '/play'],
    ['#/teacher?sync=local', '/teacher'],
    ['#screen', '/screen'],
  ])('%s → %s', (hash, expected) => {
    expect(routeFromHash(hash)).toBe(expected);
  });
});
