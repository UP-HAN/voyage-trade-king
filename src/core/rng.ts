/**
 * 시드 기반 결정적 난수 (작업 103).
 * 학급 공통 무작위(가격 흔들림·돌발 사건·기회 카드 후보)는 `seed` + 구간 + 라운드 + 열쇠로 계산해
 * 호스트와 모든 학생 기기가 같은 값을 얻는다(PRD 7.4). `Math.random()`은 쓰지 않는다.
 */

/** 문자열 → 32비트 해시(FNV-1a) */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: 32비트 시드 → [0, 1) 난수 생성기 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 여러 값을 섞은 시드 */
export function mixSeed(...parts: (string | number)[]): number {
  return hashString(parts.map(String).join('|'));
}

/** 학급 공통 난수 하나: 같은 (seed, lesson, round, key) → 언제나 같은 [0, 1) 값 */
export function roundRandom(seed: number, lesson: string, round: number, key: string): number {
  return mulberry32(mixSeed(seed, lesson, round, key))();
}

/** [-1, 1) 범위 */
export function signedRandom(seed: number, lesson: string, round: number, key: string): number {
  return roundRandom(seed, lesson, round, key) * 2 - 1;
}

/** 결정적으로 섞기(새 배열) */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const rand = mulberry32(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
