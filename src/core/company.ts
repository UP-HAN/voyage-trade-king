/**
 * 회사 설립·회사 이름 규칙 (PRD 6.1, 6.1.1) — 작업 103.
 *
 * 회사 이름 검사(형식·금칙어·중복)의 최종 규칙은 작업 124의 `validateCompanyName`(src/sync/company-name.ts)이다.
 * `src/core`는 `src/sync`를 import 하지 않으므로, 호스트·학생 기기가 그 함수를 **주입**한다(`NameValidator`).
 * 주입이 없을 때는 아래 `basicNameValidator`(길이·글자 종류·중복·막힌 이름만)를 쓴다.
 */

/** 깃발 색 6종(art-style.md 3.2, PRD 6.1) — 다른 학생과 겹쳐도 된다 */
export const FLAG_COLORS = [
  { id: 'red', label: '홍', hex: '#B5523B' },
  { id: 'blue', label: '청', hex: '#3B6E8F' },
  { id: 'green', label: '녹', hex: '#6C8F4E' },
  { id: 'yellow', label: '황', hex: '#D9A441' },
  { id: 'purple', label: '자', hex: '#7A5C8E' },
  { id: 'teal', label: '청록', hex: '#2E7D8C' },
] as const;

/** 깃발 문양 6종 */
export const FLAG_EMBLEMS = [
  { id: 'anchor', label: '닻' },
  { id: 'compass', label: '나침반' },
  { id: 'star', label: '별' },
  { id: 'fish', label: '물고기' },
  { id: 'wave', label: '파도' },
  { id: 'lighthouse', label: '등대' },
] as const;

/** 선장 아바타 4종(P2에서 6종) */
export const AVATARS = ['captain-1', 'captain-2', 'captain-3', 'captain-4'] as const;

export const FLAG_COLOR_IDS: readonly string[] = FLAG_COLORS.map((c) => c.id);
export const FLAG_EMBLEM_IDS: readonly string[] = FLAG_EMBLEMS.map((e) => e.id);
export const AVATAR_IDS: readonly string[] = AVATARS;

/** 회사 설립 전 기본 깃발(출석번호 순서로 돌려 배정 — 호스트 내부 계산) */
export function defaultFlag(seat: number): { color: string; emblem: string; avatar: string } {
  const i = Math.max(0, seat - 1);
  return {
    color: FLAG_COLOR_IDS[i % FLAG_COLOR_IDS.length],
    emblem: FLAG_EMBLEM_IDS[Math.floor(i / FLAG_COLOR_IDS.length) % FLAG_EMBLEM_IDS.length],
    avatar: AVATAR_IDS[i % AVATAR_IDS.length],
  };
}

/** 회사 이름 정리: 앞뒤 공백 제거, 가운데 연속 공백 1칸, NFC */
export function basicNormalizeName(raw: string): string {
  return raw.normalize('NFC').trim().replace(/\s+/g, ' ');
}

/** 비교 키: 공백 제거 + 영문 소문자 + NFC (PRD 6.1.1) */
export function basicNameKey(name: string): string {
  return name.normalize('NFC').replace(/\s+/g, '').toLowerCase();
}

export interface NameCheckOptions {
  /** 이미 쓰는 비교 키(자기 자신 제외) */
  takenKeys: readonly string[];
  /** 이 판에서 막힌 비교 키 */
  bannedKeys: readonly string[];
  extraWords: readonly string[];
}

/** 작업 124 `validateCompanyName`과 같은 모양 */
export type NameCheckResult =
  | { ok: true; name: string; key: string; realNameHint: boolean }
  | { ok: false; error: 'NAME_FORMAT' | 'BAD_NAME' | 'NAME_TAKEN'; suggestions?: string[] };

export type NameValidator = (raw: string, opts: NameCheckOptions) => NameCheckResult;

/**
 * 주입이 없을 때 쓰는 최소 검사: 2~10자(코드 포인트), 한글 완성형·영문·숫자·공백만, 막힌 이름, 중복.
 * 금칙어·개인정보 형태·실명 추정은 작업 124 함수가 맡는다.
 */
export const basicNameValidator: NameValidator = (raw, opts) => {
  const name = basicNormalizeName(raw);
  const len = [...name].length;
  if (len < 2 || len > 10 || !/^[가-힣A-Za-z0-9 ]+$/.test(name)) return { ok: false, error: 'NAME_FORMAT' };
  const key = basicNameKey(name);
  if (opts.bannedKeys.includes(key)) return { ok: false, error: 'BAD_NAME' };
  if (opts.takenKeys.includes(key)) return { ok: false, error: 'NAME_TAKEN' };
  return { ok: true, name, key, realNameHint: false };
};
