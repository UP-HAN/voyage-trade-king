import { describe, expect, it } from 'vitest';
import { describeRelay, relayVersion } from '../../server/src/index';

describe('server 모듈', () => {
  it('설명 문구에 서버 버전과 프로토콜 버전을 담는다', () => {
    expect(relayVersion()).toMatch(/^\d+\.\d+\.\d+/);
    expect(describeRelay()).toBe(`voyage-relay ${relayVersion()} (protocol v3)`);
  });
});
