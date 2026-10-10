/**
 * 학생 화면 문구 도우미: 조사(으로/로, 을/를), 돈·시간 표시, 회사 이름 입력 미리 검사 문구.
 * 화면 문구는 '~해요'체(PRD 8.1-3). 이모지를 쓰지 않는다.
 */
import { nameLength, normalizeCompanyName, validateCompanyName, COMPANY_NAME_MAX } from '../sync/company-name';

/** 끝 글자에 받침이 있나(ㄹ받침은 따로). 한글이 아니면 숫자 읽기로 어림, 영문은 받침 없음으로 본다 */
function finalSound(word: string): 'none' | 'rieul' | 'other' {
  const ch = [...word.trim()].pop() ?? '';
  const code = ch.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) {
    const jong = (code - 0xac00) % 28;
    if (jong === 0) return 'none';
    if (jong === 8) return 'rieul';
    return 'other';
  }
  // 숫자: 영(ㅇ) 일(ㄹ) 이 삼(ㅁ) 사 오 육(ㄱ) 칠(ㄹ) 팔(ㄹ) 구
  const digit: Record<string, 'none' | 'rieul' | 'other'> = {
    '0': 'other', '1': 'rieul', '2': 'none', '3': 'other', '4': 'none', '5': 'none', '6': 'other', '7': 'rieul', '8': 'rieul', '9': 'none',
  };
  return digit[ch] ?? 'none';
}

/** "해오름무역으로", "바다로", "별빛상회로" */
export function withEuro(word: string): string {
  const f = finalSound(word);
  return `${word}${f === 'other' ? '으로' : '로'}`;
}

/** "해오름무역을", "바다를" */
export function withEul(word: string): string {
  return `${word}${finalSound(word) === 'none' ? '를' : '을'}`;
}

/** 돈(만 원 단위 정수) → "500만 원", "1억 200만 원", "-30만 원" */
export function formatMoney(manwon: number): string {
  const n = Math.round(manwon);
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  const eok = Math.floor(a / 10000);
  const man = a % 10000;
  if (eok > 0) return `${sign}${eok}억${man ? ` ${man.toLocaleString('ko-KR')}만` : ''} 원`;
  return `${sign}${man.toLocaleString('ko-KR')}만 원`;
}

/** 초 → "2:05" */
export function formatClock(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** 초 → "14분", 1분 미만이면 "1분 안" */
export function formatMinutes(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  if (s < 60) return s === 0 ? '0분' : '1분 안';
  return `${Math.ceil(s / 60)}분`;
}

// ─── 회사 이름 입력 미리 검사(입장·이름 바꾸기·막힌 이름 공통) ───

export const NAME_GUIDE = '실제 이름은 쓰지 않아요. 우리 회사 이름을 지어요.';
export const NAME_FORMAT_TEXT = '한글·영문·숫자로 2~10자를 써요.';

export interface NameHint {
  /** 글자 수 표시 "5/10" */
  count: string;
  length: number;
  /** 입력을 보낼 수 있나(형식·금칙어 통과) */
  ok: boolean;
  /** 바로 보여 줄 문구(없으면 null) */
  message: string | null;
  /** 사람 이름처럼 보임 → 보낼 때 확인 창 */
  realNameHint: boolean;
  /** 정리된 이름(보낼 값) */
  name: string;
}

const JAMO = /[ㄱ-ㆎᄀ-ᇿ]/u;
const EMOJI = /\p{Extended_Pictographic}/u;

/** 입력 중 미리 검사(최종 판정은 호스트). 빈 칸이면 문구 없음 */
export function companyNameHint(raw: string): NameHint {
  const name = normalizeCompanyName(raw);
  const length = nameLength(name);
  const count = `${length}/${COMPANY_NAME_MAX}`;
  if (!name) return { count, length, ok: false, message: null, realNameHint: false, name };
  const v = validateCompanyName(name);
  if (v.ok) return { count, length, ok: true, message: null, realNameHint: v.realNameHint, name: v.name };
  let message: string;
  if (v.error === 'BAD_NAME') message = '회사 이름으로 쓸 수 없는 말이 있어요. 다른 이름을 지어요.';
  else if (JAMO.test(name)) message = 'ㅋ 같은 낱자(자음·모음만)는 쓸 수 없어요.';
  else if (EMOJI.test(name)) message = '그림 문자는 쓸 수 없어요. 한글·영문·숫자로 써요.';
  else if (length > COMPANY_NAME_MAX) message = `회사 이름은 ${COMPANY_NAME_MAX}자까지 쓸 수 있어요.`;
  else if (length < 2) message = '회사 이름은 2자 이상으로 지어요.';
  else if (v.error === 'NAME_FORMAT') message = `기호는 쓸 수 없어요. ${NAME_FORMAT_TEXT}`;
  else message = NAME_FORMAT_TEXT;
  return { count, length, ok: false, message, realNameHint: false, name };
}

/** 입장 오류 코드 → 학생 문구(brief v0.3.1 문구 우선, 나머지는 appErrorToKorean) */
export function entryErrorText(code: string | null, fallback: string | null): string | null {
  if (!code) return null;
  switch (code) {
    case 'HOST_OFFLINE':
      return '선생님 화면이 켜지면 들어갈 수 있어요. 잠시만 기다려요.';
    case 'TOO_MANY_TRIES':
      return '잠시 뒤에 다시 해 봐요(1분).';
    case 'NAME_FORMAT':
      return NAME_FORMAT_TEXT;
    case 'REJOIN_PENDING':
      return null;
    default:
      return fallback;
  }
}
