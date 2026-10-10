/**
 * 회사 이름 검사 (PRD 6.1.1, v0.3.1) — 순수 함수. `src/core`를 import하지 않는다.
 *
 * 학생 기기(작업 107)는 입력하는 동안 미리 검사(빠른 안내)에, 호스트(교사 브라우저, host-session)는 최종 판정에
 * **같은 함수**를 쓴다. 서버는 이름을 보지 않는다.
 *
 * 검사 순서: 길이(2~10 코드 포인트) → 개인정보 형태(BAD_NAME) → 쓸 수 있는 글자(NAME_FORMAT)
 *          → 금칙어(BAD_NAME) → 이 판에서 막힌 이름(BAD_NAME) → 중복(NAME_TAKEN + 제안)
 */
import { nameFilter, type NameFilterData } from '../data/name-filter';

export const COMPANY_NAME_MIN = 2;
export const COMPANY_NAME_MAX = 10;

export type CompanyNameError = 'NAME_FORMAT' | 'BAD_NAME' | 'NAME_TAKEN';

export type CompanyNameCheck =
  | { ok: true; name: string; key: string; realNameHint: boolean }
  | { ok: false; error: CompanyNameError; suggestions?: string[] };

export interface ValidateOptions {
  /** 이미 쓰이는 이름의 비교 키(자기 자신은 빼고 넘긴다) */
  takenKeys?: Iterable<string>;
  /** 이 판에서 교사가 막은 이름의 비교 키 */
  bannedKeys?: Iterable<string>;
  /** 교사 추가 금칙어(P1) */
  extraWords?: Iterable<string>;
  /** 금칙어 검사를 건너뜀(교사의 [회사 이름 바꾸기] — 금칙어는 경고만) */
  skipBadWords?: boolean;
  /** 금칙어 데이터(테스트·교체용). 기본 `src/data/name-filter.ts` */
  filter?: NameFilterData;
}

/** 앞뒤 공백 제거, 가운데 연속 공백 1칸, NFC */
export function normalizeCompanyName(raw: string): string {
  return String(raw ?? '')
    .normalize('NFC')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** 비교 키: 공백 제거 + 영문 소문자 + NFC ("해오름 무역" = "해오름무역") */
export function nameKey(name: string): string {
  return String(name ?? '')
    .normalize('NFC')
    .replace(/\s+/gu, '')
    .toLowerCase();
}

/** 코드 포인트 길이 */
export function nameLength(name: string): number {
  return [...name].length;
}

const ALLOWED = /^[가-힣A-Za-z0-9 ]+$/u;

/** 금칙어 검사용 키: 기호·공백 제거 + 소문자 */
function cleanKey(s: string): string {
  return nameKey(s).replace(/[^가-힣a-z0-9]/gu, '');
}
/** 숫자·영문을 뺀 키(글자 사이에 숫자·영문을 끼운 변형 잡기) */
function hangulOnly(s: string): string {
  return cleanKey(s).replace(/[a-z0-9]/gu, '');
}

/**
 * (작업 134) 늘여 쓴 변형 줄이기: 받침 없는 글자 뒤에 같은 모음의 'ㅇ+모음' 글자가 오면 뺀다('시이발' → '시발', '바아보' → '바보').
 */
export function unstretch(s: string): string {
  const out: string[] = [];
  for (const ch of s) {
    const code = ch.codePointAt(0)! - 0xac00;
    const prev = out.length ? out[out.length - 1]!.codePointAt(0)! - 0xac00 : -1;
    if (code >= 0 && code < 11172 && prev >= 0 && prev < 11172) {
      const ini = Math.floor(code / 588);
      const med = Math.floor((code % 588) / 28);
      const fin = code % 28;
      const pMed = Math.floor((prev % 588) / 28);
      const pFin = prev % 28;
      // 11 = 초성 ㅇ
      if (ini === 11 && fin === 0 && pFin === 0 && med === pMed) continue;
    }
    out.push(ch);
  }
  return out.join('');
}

/** (작업 134) 영문 금칙어의 숫자 바꿔 쓰기(sh1t → shit) */
const LEET: Readonly<Record<string, string>> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't' };
function unleet(s: string): string {
  return s.replace(/[013457]/gu, (d) => LEET[d] ?? d);
}

const wordCache = new WeakMap<NameFilterData, string[]>();
function filterWords(f: NameFilterData): string[] {
  let w = wordCache.get(f);
  if (!w) {
    const c = f.categories;
    w = [...c.profanity, ...c.slur, ...c.sexual, ...c.violence, ...c.teasing].map(cleanKey).filter((x) => x.length > 0);
    wordCache.set(f, w);
  }
  return w;
}

function indexesOf(hay: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) out.push(i);
  return out;
}

interface AllowGuard {
  /** 금칙어를 통째로 품은 낱말 */
  words: string[];
  /** 허용 조합 구절(앞 낱말 + 다음 낱말)과 그 자리에서만 봐주는 금칙어 */
  phrases: { phrase: string; bad: string }[];
}
const allowCache = new WeakMap<NameFilterData, AllowGuard>();
function allowGuard(f: NameFilterData): AllowGuard {
  let a = allowCache.get(f);
  if (!a) {
    a = {
      words: (f.allowWords ?? []).map(cleanKey).filter((x) => x.length > 0),
      phrases: (f.allowJoins ?? []).flatMap((j) => j.next.map((n) => ({ phrase: cleanKey(j.word + n), bad: cleanKey(j.bad) }))),
    };
    allowCache.set(f, a);
  }
  return a;
}

/**
 * (작업 132 수정 2회차) 금칙어 `bad`의 일치 hay[at, at+len) 하나가 오탐인가 — **명시한 예외만**:
 * ① 평범한 낱말(allowWords) 안에 통째로 들어 있다(작업 134부터 목록은 비어 있음 — '시발점' 예외 삭제)
 * ② 허용 조합 구절(allowJoins: 앞 낱말 + 정해진 다음 낱말, 예: '햇살'+'해운') 안에 있고, 그 조합이 봐주는 금칙어와 같다.
 * 일반 겹침 규칙은 없다(확신이 없으면 막는다).
 */
function excusedMatch(hay: string, at: number, len: number, bad: string, f: NameFilterData): boolean {
  const end = at + len;
  const g = allowGuard(f);
  for (const aw of g.words) for (const s of indexesOf(hay, aw)) if (s <= at && end <= s + aw.length) return true;
  for (const p of g.phrases) {
    if (p.bad !== bad) continue;
    for (const s of indexesOf(hay, p.phrase)) if (s < at && end <= s + p.phrase.length) return true;
  }
  return false;
}

/** hay 안에 오탐이 아닌 w 일치가 있나 */
function realMatch(hay: string, w: string, f: NameFilterData): boolean {
  return indexesOf(hay, w).some((i) => !excusedMatch(hay, i, w.length, w, f));
}

/** 금칙어가 들어 있나(어떤 낱말인지는 돌려주지 않는다) */
export function hasBadWord(name: string, extraWords: Iterable<string> = [], filter: NameFilterData = nameFilter): boolean {
  const k1 = cleanKey(name);
  const k2 = hangulOnly(name);
  // (작업 134) 늘여 쓴 변형·영문 숫자 바꿔 쓰기
  const k3 = unstretch(k2);
  const k4 = unleet(k1);
  const extra = [...extraWords].map(cleanKey).filter((x) => x.length > 0);
  // 교사가 더한 낱말은 일부러 넣은 것이라 오탐 예외를 두지 않는다
  for (const w of extra) {
    if (k1.includes(w)) return true;
    if (/[가-힣]/u.test(w) && k2.includes(hangulOnly(w))) return true;
  }
  for (const w of filterWords(filter)) {
    if (realMatch(k1, w, filter)) return true;
    // 숫자·영문을 뺀 키는 한글 낱말로만 검사(영문 낱말은 k1에서 이미 봄)
    if (/[가-힣]/u.test(w) && realMatch(k2, hangulOnly(w), filter)) return true;
    if (/[가-힣]/u.test(w) && k3 !== k2 && realMatch(k3, hangulOnly(w), filter)) return true;
    if (/^[a-z]+$/u.test(w) && k4 !== k1 && k4.includes(w)) return true;
  }
  return false;
}

/** 개인정보 형태(숫자 4자리 이상, @, http, www, .com, .kr …) */
export function looksLikePersonalInfo(name: string, filter: NameFilterData = nameFilter): boolean {
  const lower = normalizeCompanyName(name).toLowerCase();
  const key = nameKey(name);
  return filter.patterns.personalInfo.some((p) => {
    const re = new RegExp(p, 'iu');
    return re.test(lower) || re.test(key);
  });
}

/** 실명처럼 보이나: 2~4자, 흔한 성씨 1자로 시작, 회사 낱말 없음(한 글자 회사 낱말은 이름 끝일 때만) */
export function looksLikeRealName(name: string, filter: NameFilterData = nameFilter): boolean {
  const n = normalizeCompanyName(name);
  const compact = n.replace(/ /gu, '');
  const len = nameLength(compact);
  if (len < 2 || len > 4) return false;
  if (!/^[가-힣]+$/u.test(compact)) return false;
  if (!filter.commonSurnames.includes([...compact][0] as string)) return false;
  const hasCompanyWord = filter.companyWords.some((w) => (nameLength(w) === 1 ? compact.endsWith(w) : compact.includes(w)));
  return !hasCompanyWord;
}

/**
 * 회사 이름 검사(PRD 6.1.1 표).
 * 통과하면 정리된 이름(`name`)과 비교 키(`key`), 실명처럼 보이는지(`realNameHint`)를 준다.
 */
export function validateCompanyName(raw: string, opts: ValidateOptions = {}): CompanyNameCheck {
  const filter = opts.filter ?? nameFilter;
  const name = normalizeCompanyName(raw);
  const len = nameLength(name);
  if (len < COMPANY_NAME_MIN || len > COMPANY_NAME_MAX) return { ok: false, error: 'NAME_FORMAT' };
  if (looksLikePersonalInfo(name, filter)) return { ok: false, error: 'BAD_NAME' };
  if (!ALLOWED.test(name)) return { ok: false, error: 'NAME_FORMAT' };
  if (!opts.skipBadWords && hasBadWord(name, opts.extraWords ?? [], filter)) return { ok: false, error: 'BAD_NAME' };
  const key = nameKey(name);
  const banned = new Set(opts.bannedKeys ?? []);
  if (banned.has(key)) return { ok: false, error: 'BAD_NAME' };
  const taken = new Set(opts.takenKeys ?? []);
  if (taken.has(key)) {
    const suggestions: string[] = [];
    for (let n = 2; n <= 9 && suggestions.length < 2; n++) {
      const cand = `${name}${n}`;
      const ck = nameKey(cand);
      if (nameLength(cand) > COMPANY_NAME_MAX || taken.has(ck) || banned.has(ck)) continue;
      if (looksLikePersonalInfo(cand, filter)) continue;
      suggestions.push(cand);
    }
    return suggestions.length ? { ok: false, error: 'NAME_TAKEN', suggestions } : { ok: false, error: 'NAME_TAKEN' };
  }
  return { ok: true, name, key, realNameHint: looksLikeRealName(name, filter) };
}
