/**
 * 타이틀 화면 [항해 기록장] 버튼(작업 112, PRD 4.3.3) — 이 기기에 저장된 기록장이 있을 때만 보인다.
 * 판이 여러 개면 목록(판 단위·차시·날짜)에서 고른다. 다른 날 판과 섞지 않는다. 24시간이 지난 기록은 열 때 지운다.
 */
import { useState } from 'preact/hooks';
import { LogbookSheet } from './Logbook';
import { logbookTitle, type LogbookEntry } from './model';
import { loadLogbooks, logbookStorage } from './storage';
import './logbook.css';

export function TitleLogbookButton() {
  const [list] = useState<LogbookEntry[]>(() => loadLogbooks(logbookStorage()));
  const [open, setOpen] = useState<'list' | string | null>(null);
  if (!list.length) return null;
  const pick = open && open !== 'list' ? list.find((e) => e.key === open) ?? null : null;
  return (
    <>
      <button
        type="button"
        class="btn btn--secondary"
        data-testid="title-logbook"
        onClick={() => setOpen(list.length === 1 ? list[0].key : 'list')}
      >
        항해 기록장
      </button>
      {open === 'list' && (
        <div class="lb-overlay" role="dialog" aria-label="항해 기록장 고르기" data-testid="logbook-list">
          <div class="lb-picker">
            <h2 class="title-font">항해 기록장</h2>
            <p class="lb-sub">이 기기에 남은 기록이에요. 판이 끝나고 24시간이 지나면 지워져요.</p>
            <ul class="lb-picker__list">
              {list.map((e) => (
                <li key={e.key}>
                  <button type="button" class="btn btn--secondary lb-picker__btn" data-testid="logbook-pick" onClick={() => setOpen(e.key)}>
                    {logbookTitle(e).replace(/^항해 기록장 — /, '')}
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" class="btn btn--primary" onClick={() => setOpen(null)}>
              닫기
            </button>
          </div>
        </div>
      )}
      {pick && (
        <div class="lb-overlay">
          <LogbookSheet entry={pick} onClose={() => setOpen(list.length > 1 ? 'list' : null)} />
        </div>
      )}
    </>
  );
}

export default TitleLogbookButton;
