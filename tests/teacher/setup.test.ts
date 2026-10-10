/**
 * 작업 109 판 설정(순수 함수): 판 단위 기본 선택 없음, 기억(prefs) 저장·복원, 미리보기 갱신, [방 열기] 비활성 이유 순서.
 */
import { describe, expect, it } from 'vitest';
import {
  PREFS_KEY,
  defaultSetup,
  implementedLessons,
  lessonImplemented,
  loadPrefs,
  openDisabledReason,
  previewOf,
  savePrefs,
  type SetupValues,
} from '../../src/teacher/setup';
import { MemStorage } from '../sync/session-helpers';

const ok = { kind: 'ok' as const, rooms: 23, maxRooms: 50 };
const L1 = (patch: Partial<SetupValues> = {}): SetupValues => ({ ...defaultSetup(), playUnit: 'lesson', lesson: 'L1', ...patch });

describe('판 단위', () => {
  it('기본 선택 없음 → 미리보기 없음, [방 열기] 비활성(판 단위 이유)', () => {
    const v = defaultSetup();
    expect(v.playUnit).toBeNull();
    expect(previewOf(v)).toBeNull();
    expect(openDisabledReason(v, previewOf(v), ok)).toEqual({ kind: 'unit', text: '판 단위를 먼저 골라 주세요' });
  });

  it('차시 카드만 고르고 차시를 안 고르면 비활성', () => {
    const v = { ...defaultSetup(), playUnit: 'lesson' as const };
    expect(openDisabledReason(v, previewOf(v), ok)?.kind).toBe('unit');
  });

  it('L1은 구현됨, 준비 중 차시는 고를 수 없다', () => {
    expect(lessonImplemented('L1')).toBe(true);
    expect(implementedLessons()).toContain('L1');
    for (const l of ['L2', 'L3', 'L4'] as const) {
      if (!lessonImplemented(l)) expect(openDisabledReason(L1({ lesson: l }), previewOf(L1({ lesson: l })), ok)?.text).toBe('이 차시는 아직 준비 중이에요');
    }
  });

  it('차시 한 판 L1 → 구간 띠 1칸, 단원 한 판 → 4칸', () => {
    const p1 = previewOf(L1());
    expect(p1 && p1.ok && p1.bands.length).toBe(1);
    const pu = previewOf({ ...defaultSetup(), playUnit: 'unit' });
    expect(pu && pu.ok && pu.bands.length).toBe(4);
  });

  it('무역 시간을 바꾸면 미리보기·예상 수업 시간이 바로 바뀐다', () => {
    const a = previewOf(L1({ tradeMinutes: 25 }));
    const b = previewOf(L1({ tradeMinutes: 10 }));
    expect(a?.ok && b?.ok).toBe(true);
    if (!a?.ok || !b?.ok) return;
    expect(a.expected.text).toContain('무역 25분');
    expect(b.expected.text).toContain('무역 10분');
    expect(a.expected.totalMin).toBeGreaterThan(b.expected.totalMin);
    expect(a.totalRounds).not.toBe(b.totalRounds);
  });

  it('[넣기/짧게/빼기]가 미리보기에 반영되고 1등급은 빼기 없음', () => {
    const p = previewOf(L1({ tradeMinutes: 25 }));
    if (!p?.ok) throw new Error('preview');
    const t2 = p.activities.find((a) => a.tier !== 1 && a.form !== 'dropped');
    expect(p.activities.filter((a) => a.tier === 1).every((a) => !a.canDrop)).toBe(true);
    if (!t2) return;
    const q = previewOf(L1({ tradeMinutes: 25, overrides: { [t2.id]: 'dropped' } }));
    if (!q?.ok) throw new Error('preview');
    expect(q.activities.find((a) => a.id === t2.id)?.form).toBe('dropped');
  });

  it('비활성 이유 순서: 판 단위 → 시간(SCOPE_TOO_LONG) → 서버', () => {
    const full = { kind: 'full' as const, rooms: 50, maxRooms: 50 };
    // (작업 134) 단원 한 판은 기능 플래그가 꺼져 있으면 '준비 중'(판 단위 이유)이 먼저
    const unit = { ...defaultSetup(), playUnit: 'unit' as const, tradeMinutes: 5 };
    expect(openDisabledReason(unit, previewOf(unit), full)).toEqual({ kind: 'unit', text: '단원 전체 한 판은 아직 준비 중이에요' });
    expect(openDisabledReason(L1(), { ok: false, error: 'SCOPE_TOO_LONG', message: '범위를 줄이거나 시간을 늘려 주세요' }, full)?.kind).toBe('time');
    expect(openDisabledReason(L1(), previewOf(L1()), full)).toEqual({ kind: 'server', text: '서버에 방이 가득 찼어요' });
    expect(openDisabledReason(L1(), previewOf(L1()), { kind: 'blocked', rooms: 3, maxRooms: 50 })?.text).toBe('점검 중이라 새 방을 열 수 없어요');
    expect(openDisabledReason(L1(), previewOf(L1()), { kind: 'unknown' })).toBeNull();
    expect(openDisabledReason(L1(), previewOf(L1()), { kind: 'loading' })).toBeNull();
    expect(openDisabledReason(L1(), previewOf(L1()), { kind: 'local' })).toBeNull();
  });
});

describe('기억(voyage.teacher.prefs)', () => {
  it('저장·복원: 판 단위·차시·무역 시간·설정값, 학생 정보·고정값(overrides)은 없음', () => {
    const st = new MemStorage();
    const v = L1({ tradeMinutes: 10, className: '6-3', worksheetMode: 'stageEnd', leaderboardTopN: 5, progressMode: 'manual', overrides: { 'L1-E1': 'dropped' } });
    savePrefs(v, st);
    const raw = JSON.parse(st.getItem(PREFS_KEY) as string) as Record<string, unknown>;
    expect(Object.keys(raw).sort()).toEqual(
      ['activityRatio', 'className', 'comeback', 'customScope', 'incidentFreq', 'leaderboardTopN', 'lesson', 'playUnit', 'progressMode', 'tradeMinutes', 'worksheetMode'].sort(),
    );
    const back = loadPrefs(st);
    expect(back.playUnit).toBe('lesson');
    expect(back.lesson).toBe('L1');
    expect(back.tradeMinutes).toBe(10);
    expect(back.worksheetMode).toBe('stageEnd');
    expect(back.leaderboardTopN).toBe(5);
    expect(back.progressMode).toBe('manual');
    expect(back.overrides).toEqual({});
  });

  it('없거나 깨진 값이면 기본값(선택 없음), 범위 밖 시간은 5~90으로', () => {
    const st = new MemStorage();
    expect(loadPrefs(st).playUnit).toBeNull();
    st.setItem(PREFS_KEY, '{oops');
    expect(loadPrefs(st).playUnit).toBeNull();
    st.setItem(PREFS_KEY, JSON.stringify({ playUnit: 'weird', tradeMinutes: 500, lesson: 'L9' }));
    const v = loadPrefs(st);
    expect(v.playUnit).toBeNull();
    expect(v.tradeMinutes).toBe(90);
    expect(v.lesson).toBeNull();
    expect(loadPrefs(null).playUnit).toBeNull();
  });
});

describe('(작업 134) 기능 플래그 FULL_UNIT_READY=false', () => {
  it('차시 L1만 고를 수 있고 L2~L4·단원 한 판·L2가 든 연속 구간은 준비 중', () => {
    expect(lessonImplemented('L1')).toBe(true);
    for (const l of ['L2', 'L3', 'L4'] as const) expect(lessonImplemented(l)).toBe(false);
    expect(implementedLessons()).toEqual(['L1']);
    const custom = { ...defaultSetup(), playUnit: 'custom' as const, customScope: ['L1', 'L2'] as SetupValues['customScope'] };
    expect(openDisabledReason(custom, previewOf(custom), ok)?.text).toBe('고른 구간에 아직 준비 중인 차시가 있어요');
  });
  it('기억한 단원 한 판은 고르지 않은 상태로 복원', () => {
    const st = new MemStorage();
    savePrefs({ ...defaultSetup(), playUnit: 'unit' }, st);
    expect(loadPrefs(st).playUnit).toBeNull();
  });
});
