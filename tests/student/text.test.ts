/**
 * 학생 화면 문구·입력 도우미(작업 107): 회사 이름 미리 검사(글자 수·낱자·그림 문자·길이), NAME_TAKEN 제안이 자동 제출하지 않음,
 * 조사·돈·시간 표시, 시간 표시 계산, 항해 규칙 카드(역전 장치), 화면 코드에 이모지·실명 예시·방 수 부품 없음.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { startSession, publicClass } from '../../src/core';
import { applySuggestion, canSubmit, cleanCode } from '../../src/student/EntryScreen';
import { timeInfo } from '../../src/student/Hud';
import { visibleRuleCards } from '../../src/student/Prep';
import { companyNameHint, entryErrorText, formatClock, formatMinutes, formatMoney, withEuro, withEul } from '../../src/student/text';

describe('회사 이름 미리 검사', () => {
  it('글자 수 "n/10"과 통과 여부', () => {
    expect(companyNameHint('')).toMatchObject({ count: '0/10', ok: false, message: null });
    expect(companyNameHint('해오름무역')).toMatchObject({ count: '5/10', ok: true, message: null, realNameHint: false });
    expect(companyNameHint('  해오름   무역 ')).toMatchObject({ count: '6/10', ok: true, name: '해오름 무역' });
  });

  it('낱자(자음·모음)·그림 문자·길이·기호는 바로 안내', () => {
    expect(companyNameHint('ㅋㅋ').message).toContain('낱자');
    expect(companyNameHint('바다\u{1F6A2}').message).toContain('그림 문자');
    expect(companyNameHint('가나다라마바사아자차카').message).toContain('10자까지');
    expect(companyNameHint('가').message).toContain('2자 이상');
    expect(companyNameHint('바다!!').message).toContain('기호');
    expect(companyNameHint('바다!!').ok).toBe(false);
  });

  it('금칙어·개인정보 형태는 어떤 낱말인지 말하지 않고 막음', () => {
    const h = companyNameHint('바다1234무역');
    expect(h.ok).toBe(false);
    expect(h.message).toBe('회사 이름으로 쓸 수 없는 말이 있어요. 다른 이름을 지어요.');
  });

  it('사람 이름처럼 보이면 보낼 때 확인 창(realNameHint)', () => {
    expect(companyNameHint('김바다').realNameHint).toBe(true);
    expect(companyNameHint('김바다무역').realNameHint).toBe(false);
  });

  it('NAME_TAKEN 제안 버튼은 칸만 채우고 보내지 않음(입장 폼 값만 바뀜)', () => {
    const form = { code: '482137', seat: 7, name: '해오름무역' };
    const next = applySuggestion(form, '해오름무역2');
    expect(next).toEqual({ code: '482137', seat: 7, name: '해오름무역2' });
    expect(next).not.toHaveProperty('submitted');
    expect(canSubmit(next)).toBe(true);
    expect(canSubmit({ ...next, code: '48213' })).toBe(false);
    expect(canSubmit({ ...next, seat: null })).toBe(false);
    expect(canSubmit({ ...next, name: 'ㅋ' })).toBe(false);
  });

  it('방 코드는 숫자 6자리만', () => {
    expect(cleanCode('48a2 13-79')).toBe('482137');
  });

  it('입장 오류 문구(v0.3.1)', () => {
    expect(entryErrorText('HOST_OFFLINE', 'x')).toContain('선생님 화면이 켜지면 들어갈 수 있어요');
    expect(entryErrorText('TOO_MANY_TRIES', 'x')).toBe('잠시 뒤에 다시 해 봐요(1분).');
    expect(entryErrorText('NAME_FORMAT', 'x')).toBe('한글·영문·숫자로 2~10자를 써요.');
    expect(entryErrorText('SEAT_TAKEN', '이 번호는…')).toBe('이 번호는…');
    expect(entryErrorText(null, 'x')).toBeNull();
  });
});

describe('표시 도우미', () => {
  it('조사', () => {
    expect(withEuro('해오름무역')).toBe('해오름무역으로');
    expect(withEuro('바다')).toBe('바다로');
    expect(withEuro('별빛상회')).toBe('별빛상회로');
    expect(withEuro('은하상단')).toBe('은하상단으로');
    expect(withEuro('달')).toBe('달로');
    expect(withEuro('Sea7')).toBe('Sea7로');
    expect(withEul('해오름무역')).toBe('해오름무역을');
    expect(withEul('바다')).toBe('바다를');
  });

  it('돈·시간', () => {
    expect(formatMoney(500)).toBe('500만 원');
    expect(formatMoney(1200)).toBe('1,200만 원');
    expect(formatMoney(12000)).toBe('1억 2,000만 원');
    expect(formatMoney(-30)).toBe('-30만 원');
    expect(formatClock(130)).toBe('2:10');
    expect(formatClock(0)).toBe('0:00');
    expect(formatMinutes(14 * 60)).toBe('14분');
    expect(formatMinutes(30)).toBe('1분 안');
  });

  it('HUD 시간: 준비·라운드·쉬는 중, 무역 남은 시간은 작은 글씨 문구', () => {
    const now = Date.UTC(2026, 9, 9, 1, 0, 0);
    const snap = startSession({ code: '000000', playUnit: 'lesson', scope: ['L1'], seed: 1, now, settings: { tradeMinutes: 25 } });
    const prep = timeInfo(publicClass(snap.class), now);
    expect(prep).toMatchObject({ label: '준비 시간', round: null });
    expect(prep.trade).toContain('25분');
    const started = { ...snap.class, phase: 'round' as const, round: 2, roundEndsAt: now + 130_000, clock: { ...snap.class.clock, startedAt: now - 60_000, endsAt: now + 24 * 60_000 } };
    const t = timeInfo(publicClass(started), now);
    expect(t).toMatchObject({ label: '1차시 · 라운드 2', round: '2:10', warn: false });
    expect(t.trade).toBe('무역 24분 남음');
    expect(timeInfo(publicClass({ ...started, roundEndsAt: now + 20_000 }), now).warn).toBe(true);
    expect(timeInfo(publicClass({ ...started, phase: 'between', roundEndsAt: null }), now).label).toBe('1차시 · 쉬는 중');
  });

  it('항해 규칙 카드: 역전 장치가 꺼지면 2번 숨김', () => {
    expect(visibleRuleCards(true).map((c) => c.no)).toEqual([1, 2, 3, 4]);
    expect(visibleRuleCards(false).map((c) => c.no)).toEqual([1, 3, 4]);
  });
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe('화면 코드 검사(src/student)', () => {
  const files = walk(join(__dirname, '..', '..', 'src', 'student')).filter((f) => /\.(tsx?|css)$/.test(f));
  const all = files.map((f) => [f, readFileSync(f, 'utf8')] as const);

  it('이모지가 없다', () => {
    const emoji = /\p{Extended_Pictographic}/u;
    for (const [f, s] of all) expect(emoji.test(s), f).toBe(false);
  });

  it('실명 예시 문구(김바다)가 없다', () => {
    for (const [f, s] of all) expect(s.includes('김바다'), f).toBe(false);
  });

  it('RoomCount·ServiceFooter를 쓰지 않는다(v0.3.2)', () => {
    for (const [f, s] of all) expect(/RoomCount|ServiceFooter/.test(s), f).toBe(false);
  });
});
