/**
 * 작업 132(114 검증 반영): 교사 행동 거절·알림 코드는 모두 한글 문구가 있다(영어 코드가 화면에 보이지 않게).
 * 코어가 교사 행동에 돌려주는 코드(lesson.ts err, trade.ts fail·notice, host.ts notice, schedule.ts fail)를 소스에서 모아 대조한다.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SILENT_NOTICES, TEACHER_NOTICE_TEXT, teacherNoticeText } from '../../src/teacher/notice-text';

const src = (f: string) => readFileSync(join(process.cwd(), 'src', f), 'utf8');

function codesIn(text: string, re: RegExp): string[] {
  return [...text.matchAll(re)].map((m) => m[1]!);
}

describe('교사 알림·거절 코드 → 한글', () => {
  it('코어가 교사 행동에 돌려주는 모든 코드에 문구가 있다', () => {
    const codes = new Set<string>([
      ...codesIn(src('core/lesson.ts'), /err\((?:cs|c), '([A-Z_]+)'\)/g),
      ...codesIn(src('core/lesson.ts'), /needsConfirm: '([A-Z_]+)'/g),
      ...codesIn(src('core/trade.ts'), /fail\('([A-Z_]+)'\)/g),
      ...codesIn(src('core/trade.ts'), /notice\(ctx, '([A-Z_]+)'/g),
      ...codesIn(src('core/host.ts'), /notice\(w, '([A-Z_]+)'/g),
      ...codesIn(src('core/schedule.ts'), /fail\('([A-Z_]+)'\)/g),
    ]);
    expect(codes.size).toBeGreaterThan(30);
    const missing = [...codes].filter((c) => !TEACHER_NOTICE_TEXT[c] && !SILENT_NOTICES.has(c) && c !== 'SCHEDULE_WARNING');
    expect(missing).toEqual([]);
    for (const c of ['WORKSHEET_OPEN', 'EVENT_OPEN', 'ALREADY_PAUSED', 'NO_SHORT_FORM', 'STAGE_BACKWARD']) expect(TEACHER_NOTICE_TEXT[c]).toMatch(/[가-힣]/);
  });

  it('모든 문구는 한글이고 영어 코드를 담지 않는다', () => {
    for (const [code, text] of Object.entries(TEACHER_NOTICE_TEXT)) {
      expect(text, code).toMatch(/[가-힣]/);
      expect(text, code).not.toMatch(/[A-Z]{2,}_[A-Z]/);
    }
  });

  it('모르는 코드도 영어 코드 없이 한글로', () => {
    expect(teacherNoticeText('WORKSHEET_OPEN')).toBe('학습지 팝업이 떠 있어요. 학습지 시간이 끝난 뒤에 해요.');
    expect(teacherNoticeText('SOMETHING_NEW')).not.toContain('SOMETHING_NEW');
    expect(teacherNoticeText('SOMETHING_NEW')).toMatch(/[가-힣]/);
    expect(teacherNoticeText('X_Y', '편지 문제가 모자라요')).toBe('편지 문제가 모자라요');
    expect(teacherNoticeText('X_Y', 'X_Y')).not.toContain('X_Y');
    // 대시보드는 이 함수로만 문구를 만든다(코드 그대로 출력 금지)
    const dash = src('teacher/Dashboard.tsx');
    expect(dash).toContain('teacherNoticeText(code, t.message)');
    expect(dash).not.toMatch(/할 수 없어요 \(\$\{code\}\)/);
  });
});
