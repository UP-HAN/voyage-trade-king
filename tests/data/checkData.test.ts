import { describe, expect, it } from 'vitest';
import { runChecks } from '../../scripts/check-data';

describe('check:data', () => {
  it('오류 0, 경고는 L2~L4 사건 TODO 만', () => {
    const { errors, warnings } = runChecks();
    expect(errors).toEqual([]);
    for (const w of warnings) expect(w).toMatch(/^events L[234]-[A-Z0-9]+: TODO/);
  });
});
