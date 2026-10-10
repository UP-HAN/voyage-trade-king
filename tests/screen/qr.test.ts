/**
 * 작업 110: 직접 만든 QR 코드(바이트 모드, 오류 정정 M) — 표준 값과 대조.
 */
import { describe, expect, it } from 'vitest';
import { addEccAndInterleave, dataCodewords, encodeData, formatBits, makeQr, rsDivisor, rsRemainder, versionBits } from '../../src/screen/qr';

describe('리드-솔로몬', () => {
  it('ISO 예시 "HELLO WORLD" 1-M 데이터 → 정정 코드 10개', () => {
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    expect(rsRemainder(data, rsDivisor(10))).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  });
});

describe('형식·버전 정보', () => {
  it('M + 마스크 0~7 형식 비트(표준 표)', () => {
    const table = ['101010000010010', '101000100100101', '101111001111100', '101101101001011', '100010111111001', '100000011001110', '100111110010111', '100101010100000'];
    table.forEach((bits, mask) => expect(formatBits(mask).toString(2).padStart(15, '0')).toBe(bits));
  });
  it('버전 7 정보 = 000111110010010100', () => {
    expect(versionBits(7).toString(2).padStart(18, '0')).toBe('000111110010010100');
  });
});

describe('데이터 용량(M)', () => {
  it('버전 1~5 데이터 코드워드 수', () => {
    expect([1, 2, 3, 4, 5].map(dataCodewords)).toEqual([16, 28, 44, 64, 86]);
  });
  it('채움 바이트 EC 11 반복, 길이 = 데이터+정정', () => {
    const d = encodeData([0x41], 1);
    expect(d).toHaveLength(16);
    expect(d.slice(0, 3)).toEqual([0x40, 0x14, 0x10]);
    expect(d.slice(3, 6)).toEqual([0xec, 0x11, 0xec]);
    expect(addEccAndInterleave(d, 1)).toHaveLength(26);
    expect(addEccAndInterleave(encodeData([], 5), 5)).toHaveLength(134);
  });
});

describe('행렬', () => {
  const url = 'https://lab.ches.es.kr/voyage/';
  const q = makeQr(url)!;
  const m = q.modules;
  const at = (x: number, y: number) => (m[y] as boolean[])[x];

  it('짧은 주소는 버전 2~3, 크기 = 4v+17', () => {
    expect(q.version).toBeGreaterThanOrEqual(2);
    expect(q.version).toBeLessThanOrEqual(3);
    expect(q.size).toBe(q.version * 4 + 17);
    expect(m).toHaveLength(q.size);
  });
  it('세 귀퉁이 위치 찾기 무늬와 타이밍 선', () => {
    for (const [ox, oy] of [
      [0, 0],
      [q.size - 7, 0],
      [0, q.size - 7],
    ] as const) {
      for (let i = 0; i < 7; i++) {
        expect(at(ox + i, oy)).toBe(true);
        expect(at(ox + i, oy + 6)).toBe(true);
        expect(at(ox, oy + i)).toBe(true);
      }
      expect(at(ox + 1, oy + 1)).toBe(false);
      expect(at(ox + 3, oy + 3)).toBe(true);
    }
    for (let i = 8; i < q.size - 8; i++) {
      expect(at(i, 6)).toBe(i % 2 === 0);
      expect(at(6, i)).toBe(i % 2 === 0);
    }
    expect(at(8, q.size - 8)).toBe(true); // 검은 모듈
  });
  it('형식 비트 두 벌이 같은 값(마스크 기록)', () => {
    let a = 0;
    let b = 0;
    const bitsA: boolean[] = [];
    for (let i = 0; i <= 5; i++) bitsA.push(at(8, i));
    bitsA.push(at(8, 7), at(8, 8), at(7, 8));
    for (let i = 9; i < 15; i++) bitsA.push(at(14 - i, 8));
    const bitsB: boolean[] = [];
    for (let i = 0; i < 8; i++) bitsB.push(at(q.size - 1 - i, 8));
    for (let i = 8; i < 15; i++) bitsB.push(at(8, q.size - 15 + i));
    bitsA.forEach((v, i) => (a |= (v ? 1 : 0) << i));
    bitsB.forEach((v, i) => (b |= (v ? 1 : 0) << i));
    expect(a).toBe(b);
    expect(a).toBe(formatBits(q.mask));
  });
  it('너무 긴 글자는 null', () => {
    expect(makeQr('x'.repeat(400))).toBeNull();
  });
});
