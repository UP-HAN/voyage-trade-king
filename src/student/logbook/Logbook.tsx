/**
 * 항해 기록장 화면(S26, PRD 4.3.3) — 작업 112.
 *
 * - 이번 판의 학습지 번호별 문구·쪽수·기록 도우미 값을 한 화면에. 단원 한 판이면 구간별로 묶는다.
 * - 제목: "항해 기록장 — 차시 한 판 L2 · 10월 14일".
 * - [인쇄]: A4 단면(v0.3.4), 흑백에서도 읽히게(인쇄 때는 이 시트만 — logbook.css @media print). 한 장을 넘으면 2쪽 이상으로 넘어가고
 *   쪽마다 머리띠(판 단위·차시·날짜)를 되풀이한다 — 표 머리(`thead`)를 인쇄 때만 보이게 해 브라우저가 쪽마다 다시 그린다(작업 132).
 * - (작업 132) 지금 쓰기 (별표) 칸을 이 기기에서 다 쓴 번호는 "(별표) 2번 칸은 이미 썼어요" 작은 표시.
 * - `useLogbookSync`: 게임 중 학생 기기가 기록장을 계속 저장한다(판이 끝난 뒤 24시간 — storage.ts).
 */
import { useEffect, useRef } from 'preact/hooks';
import type { PublicClass, PublicState } from '../../core';
import type { MeView } from '../predict';
import { DURING_MARK } from '../../data/worksheet';
import { buildLogbookEntry, groupRows, logbookKey, logbookTitle, type LogbookEntry } from './model';
import { findLogbook, logbookStorage, sameContent, saveLogbook } from './storage';
import './logbook.css';

export function LogbookSheet({ entry, onClose, className }: { entry: LogbookEntry; onClose?: () => void; className?: string | null }) {
  const groups = groupRows(entry);
  const print = () => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    document.documentElement.classList.add('lb-printing');
    const done = () => {
      document.documentElement.classList.remove('lb-printing');
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    try {
      window.print();
    } finally {
      // 인쇄 창이 동기로 닫히는 브라우저도 있다
      setTimeout(done, 1000);
    }
  };
  return (
    <div class="lb-wrap" role="dialog" aria-label="항해 기록장" data-testid="logbook">
      <section class="lb-sheet" data-testid="logbook-sheet" data-key={entry.key}>
        <header class="lb-head">
          <h1 class="lb-title title-font" data-testid="logbook-title">
            {logbookTitle(entry, className)}
          </h1>
          <p class="lb-sub">
            {entry.companyName} · 학습지(항해 일지)를 쓸 때 이 기록을 보고 써요. 기록이 없으면 교과서를 보고 써요.
          </p>
        </header>
        {entry.rows.length === 0 ? (
          <p class="lb-empty" data-testid="logbook-empty">
            이번 판에 쓸 학습지 번호가 없어요.
          </p>
        ) : (
          <table class="lb-table" data-testid="logbook-table">
            {/* 인쇄 때만 보이는 머리띠 — 쪽마다 되풀이(화면에서는 위 제목이 같은 내용) */}
            <thead class="lb-band">
              <tr>
                <th colSpan={3} class="lb-band__cell" data-testid="logbook-band">
                  {logbookTitle(entry, className)} · {entry.companyName}
                </th>
              </tr>
            </thead>
            {groups.map((g) => (
              <tbody key={g.stage ?? 'all'} class="lb-group">
                {g.stage && (
                  <tr class="lb-stage-row">
                    <th colSpan={3} class="lb-stage">
                      {g.stage === '선택 활동' ? g.stage : `${String(g.stage).replace(/^L/, '')}차시`}
                    </th>
                  </tr>
                )}
                {g.rows.map((r) => (
                  <tr key={r.id} class="lb-row" data-testid="logbook-row" data-id={r.id} data-helper={r.helper ?? ''}>
                    <td class="lb-no" aria-label={`${Number(r.id.slice(1))}번`}>
                      {r.label}
                    </td>
                    <td class="lb-body">
                      <p class="lb-prompt">{r.prompt}</p>
                      <p class="lb-pages">{r.pagesLabel}</p>
                      <p class={`lb-helper${r.hasRecord ? '' : ' is-empty'}`} data-testid="logbook-helper">
                        {r.text === null ? '기록 도우미 없음 — 교과서를 보고 써요' : `내 기록: ${r.text}`}
                      </p>
                      {r.duringDone && (
                        <p class="lb-during" data-testid="logbook-during">
                          {DURING_MARK} {r.duringPart ?? '2'}번 칸은 이미 썼어요
                        </p>
                      )}
                    </td>
                    <td class="lb-mark">{r.done && <span class="lb-done">다 씀</span>}</td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        )}
        <div class="lb-actions">
          <button type="button" class="btn btn--secondary" data-testid="logbook-print" onClick={print}>
            인쇄
          </button>
          {onClose && (
            <button type="button" class="btn btn--primary" data-testid="logbook-close" onClick={onClose}>
              닫기
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

/**
 * 게임 중 기록장 저장(학생 기기). 내용이 바뀔 때만 쓴다. 저장한 최신 판 기록을 돌려준다.
 * 학습지 층(WorksheetLayer)이 부른다 — 회사를 세운 뒤 게임 화면에 늘 그려지는 층이라서.
 */
export function useLogbookSync(o: { cls: PublicClass; me: MeView; pub: PublicState | null; code: string | null }): LogbookEntry {
  const last = useRef<LogbookEntry | null>(null);
  const storage = useRef(logbookStorage());
  const key = logbookKey(o.code, o.cls);
  if (last.current === null || last.current.key !== key) last.current = findLogbook(storage.current, key);
  const entry = buildLogbookEntry({ cls: o.cls, me: o.me, pub: o.pub, code: o.code, now: Date.now(), prev: last.current });
  useEffect(() => {
    if (sameContent(last.current, entry)) return;
    last.current = entry;
    saveLogbook(storage.current, entry);
  });
  return entry;
}
