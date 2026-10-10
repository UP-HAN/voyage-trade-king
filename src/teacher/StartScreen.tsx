/**
 * T01 교사 시작 화면(작업 109, PRD 7.5 v0.3.2): 서버 공지 띠 → "사용 중인 방 n/50"(30초마다) →
 * [새 판 열기] / [이어하기](이 브라우저에 진행 중인 판이 있으면 크게) / [판 옮기기 파일 열기] / [연결 테스트] → 맨 아래 이용 안내 한 줄.
 * [새 판 열기]·[이어하기]는 방 수와 관계없이 막지 않는다. 로컬 모드에서는 131 부품이 스스로 숨는다.
 * (작업 138, PRD 7.5.2.4) 큰 버튼 아래 "처음이세요? 수업 준비 3단계" 상자(① 학습지 인쇄 [학습지 열기 ▾] ② 새 판 열기 ③ TV·입장).
 * 접으면 이 브라우저에 기억(`voyage.teacher.guide` = 'closed', 학생 정보 없음).
 */
import { useState } from 'preact/hooks';
import { syncMode } from '../config/deploy';
import { ConnectionTest } from '../ui/common/ConnectionTest';
import { NoticeBanner } from '../ui/common/NoticeBanner';
import { RoomCount } from '../ui/common/RoomCount';
import { ServiceFooter } from '../ui/common/ServiceFooter';
import { playUnitLabel, scopeLabel, type TeacherGame } from './game';
import { mmss, tradeRemainingSec } from './schedule-view';
import type { StoredHost } from '../sync/host-store';
import { WorksheetPdfMenu } from './WorksheetPdfMenu';

/** 수업 준비 3단계 상자를 접었는지 기억하는 열쇠(교사 localStorage) */
export const GUIDE_KEY = 'voyage.teacher.guide';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
function guideStorage(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** 상자를 펼쳐 둘까(처음엔 펼침, 한 번 접으면 접힘으로 기억) */
export function guideOpenInitially(storage: StorageLike | null = guideStorage()): boolean {
  try {
    return storage?.getItem(GUIDE_KEY) !== 'closed';
  } catch {
    return true;
  }
}

export function rememberGuide(open: boolean, storage: StorageLike | null = guideStorage()): void {
  try {
    storage?.setItem(GUIDE_KEY, open ? 'open' : 'closed');
  } catch {
    /* 기억 못 해도 괜찮다 */
  }
}

/** "처음이세요? 수업 준비 3단계" 상자 */
export function PrepGuide({ storage }: { storage?: StorageLike | null }) {
  const st = storage === undefined ? guideStorage() : storage;
  const [open, setOpen] = useState(() => guideOpenInitially(st));
  return (
    <details
      class="t-guide"
      data-testid="start-guide"
      open={open}
      onToggle={(e) => {
        const now = (e.currentTarget as HTMLDetailsElement).open;
        if (now === open) return;
        setOpen(now);
        rememberGuide(now, st);
      }}
    >
      <summary class="t-guide__sum">처음이세요? 수업 준비 3단계</summary>
      <ol class="t-guide__steps">
        <li data-testid="guide-step-1">
          <b>학습지 인쇄</b> — 오늘 차시 학습지를 A4 단면으로 뽑아 두세요.
          <WorksheetPdfMenu variant="menu" />
        </li>
        <li data-testid="guide-step-2">
          <b>[새 판 열기]</b>에서 차시와 무역 시간을 고르고 [방 열기]를 누르세요.
        </li>
        <li data-testid="guide-step-3">
          <b>TV에 방 코드</b>를 띄우고([공용 화면 창 열기]) 학생들이 들어오게 하세요.
        </li>
      </ol>
    </details>
  );
}

export interface ResumeInfo {
  code: string;
  className: string;
  playUnit: string;
  scope: string;
  /** 남은 무역 시간(초) — 무역 시작 전이면 null */
  remainingSec: number | null;
  ended: boolean;
}

/** 저장된 판 → 이어하기 카드 정보(남은 시간은 저장 시각 기준 — 끊긴 시간은 일시정지로 처리되므로 줄지 않는다) */
export function resumeInfoOf(rec: StoredHost | null): ResumeInfo | null {
  if (!rec || !rec.game) return null;
  const g = rec.game as TeacherGame;
  if (!g.class || !g.meta) return null;
  const c = g.class;
  const at = Math.max(rec.savedAt, c.clock.pausedAt ?? 0);
  return {
    code: rec.code,
    className: g.meta.className,
    playUnit: playUnitLabel(g.meta.playUnit),
    scope: scopeLabel(g.meta.scope),
    remainingSec: c.clock.startedAt === null ? null : tradeRemainingSec({ ...c, clock: { ...c.clock, pausedAt: c.clock.pausedAt ?? at } }, at),
    ended: rec.endedAt !== null || c.phase === 'ended',
  };
}

export interface StartScreenProps {
  resume: ResumeInfo | null;
  busy: boolean;
  error: string | null;
  onNew: () => void;
  onResume: () => void;
  onImport: (json: string) => void;
}

export function StartScreen({ resume, busy, error, onNew, onResume, onImport }: StartScreenProps) {
  const [showConn, setShowConn] = useState(false);
  const relay = syncMode() === 'relay';
  const canResume = !!resume && !resume.ended;
  const pickFile = (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0];
    if (!f) return;
    void f.text().then((t) => onImport(t));
    input.value = '';
  };
  return (
    <main class="t-start" data-testid="teacher-start">
      {relay && <NoticeBanner fetchFrom={true} />}
      <div class="t-start__body">
        <div class="t-start__panel">
          <h1 class="title-font t-start__title">선생님 대시보드</h1>
          <div class="t-start__rooms">
            <RoomCount poll />
          </div>
          {error && (
            <p class="t-alert t-alert--error" role="alert" data-testid="start-error">
              {error}
            </p>
          )}
          {canResume && resume && (
            <section class="t-resume" data-testid="resume-card">
              <h2 class="t-resume__title">진행 중인 판이 있어요</h2>
              <p class="t-resume__meta">
                {resume.className || '학급 이름 없음'} · {resume.playUnit} {resume.scope} · 방 코드 <b>{resume.code}</b>
                {resume.remainingSec !== null ? ` · 남은 시간 ${mmss(resume.remainingSec)}` : ' · 무역 시작 전'}
              </p>
              <button type="button" class="btn btn--primary btn--large" data-testid="btn-resume" disabled={busy} onClick={onResume}>
                이어하기
              </button>
            </section>
          )}
          <div class="t-start__actions">
            <button
              type="button"
              class={`btn ${canResume ? 'btn--secondary' : 'btn--primary btn--large'}`}
              data-testid="btn-new"
              disabled={busy}
              onClick={onNew}
            >
              새 판 열기
            </button>
          </div>
          <PrepGuide />
          <div class="t-start__small">
            <label class="link-small t-file" data-testid="btn-import">
              판 옮기기 파일 열기
              <input type="file" accept="application/json,.json" onChange={pickFile} disabled={busy} />
            </label>
            <button type="button" class="link-small" aria-expanded={showConn} data-testid="btn-conn" onClick={() => setShowConn((v) => !v)}>
              연결 테스트
            </button>
          </div>
          {showConn && (
            <div class="t-start__conn">
              <ConnectionTest />
            </div>
          )}
        </div>
      </div>
      <ServiceFooter />
    </main>
  );
}
