/**
 * 학습지 PDF 열기 부품(작업 138, PRD 7.5.3) — 교사 화면 전용.
 *
 * - variant 'menu'  : 펼침 목록형 — [학습지 열기 ▾] → 학생용·교사용 목록(교사 시작 화면, 137 대시보드 위쪽 띠).
 * - variant 'inline': 인라인형 — 고른 차시 파일을 크게 + [다른 학습지 ▾](판 설정 미리보기 '이 차시 학습지', 137 '학습지' 접힘 영역).
 * 누르면 새 탭으로 PDF(브라우저 PDF 보기 → 인쇄·저장). `download` 속성은 쓰지 않는다 — 크로뮴 계열에서 새 탭 대신 바로 내려받기가 돼서.
 * 목록이 비면 안내 한 줄. data-testid: 바깥 `worksheet-pdf-menu`, 항목 `worksheet-pdf-<key>`.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { LessonId } from '../data/types';
import { availablePdfs, lessonPdfKeys, metaText, NO_PDF_TEXT, type WorksheetPdf } from './worksheet-pdfs';

export interface WorksheetPdfMenuProps {
  variant: 'menu' | 'inline';
  /** 인라인형에서 강조할 차시('unit' = 학생용 전체) */
  highlightLesson?: LessonId | 'unit' | null;
  /** 펼침 버튼 글자(기본 '학습지 열기') */
  label?: string;
  /** 시험용 주입(기본: 빌드 목록) */
  pdfs?: readonly WorksheetPdf[];
}

function PdfLink({ p, big, onPick }: { p: WorksheetPdf; big?: boolean; onPick?: () => void }) {
  return (
    <a
      class={`t-wsm__link${big ? ' t-wsm__link--big' : ''}${p.group === 'teacher' ? ' t-wsm__link--teacher' : ''}`}
      href={p.href}
      target="_blank"
      rel="noopener"
      title={`새 탭에서 열어 인쇄해요 (저장 이름 예: ${p.saveName})`}
      data-testid={`worksheet-pdf-${p.key}`}
      data-highlight={big ? 'true' : undefined}
      onClick={onPick}
    >
      <span class="t-wsm__name">{big ? `${p.label} 학습지 열기` : p.label}</span>
      <span class="t-wsm__meta">{metaText(p)}</span>
    </a>
  );
}

function PdfList({ list, onPick }: { list: readonly WorksheetPdf[]; onPick: () => void }) {
  const students = list.filter((p) => p.group === 'student');
  const teacher = list.filter((p) => p.group === 'teacher');
  return (
    <div class="t-wsm__pop" data-testid="worksheet-pdf-list">
      {students.length > 0 && (
        <>
          <p class="t-wsm__group">학생용</p>
          {students.map((p) => (
            <PdfLink key={p.key} p={p} onPick={onPick} />
          ))}
        </>
      )}
      {teacher.length > 0 && (
        <>
          <p class="t-wsm__group">선생님용</p>
          {teacher.map((p) => (
            <PdfLink key={p.key} p={p} onPick={onPick} />
          ))}
        </>
      )}
    </div>
  );
}

export function WorksheetPdfMenu({ variant, highlightLesson, label = '학습지 열기', pdfs }: WorksheetPdfMenuProps) {
  const all = pdfs ?? availablePdfs();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // 펼친 목록: 바깥을 누르거나 Esc 면 닫는다
  useEffect(() => {
    if (!open || typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
    const onDown = (e: Event) => {
      const el = ref.current;
      if (el && typeof el.contains === 'function' && !el.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!all.length) {
    return (
      <div class={`t-wsm t-wsm--${variant}`} data-testid="worksheet-pdf-menu">
        <p class="t-wsm__empty" data-testid="worksheet-pdf-empty">
          {NO_PDF_TEXT}
        </p>
      </div>
    );
  }

  const keys = variant === 'inline' ? lessonPdfKeys(highlightLesson) : [];
  const main = all.filter((p) => (keys as string[]).includes(p.key));
  const rest = variant === 'inline' ? all.filter((p) => !main.includes(p)) : all;
  const toggleText = variant === 'inline' && main.length ? '다른 학습지' : label;

  return (
    <div class={`t-wsm t-wsm--${variant}`} data-testid="worksheet-pdf-menu" ref={ref}>
      {main.length > 0 && (
        <div class="t-wsm__main">
          {main.map((p) => (
            <PdfLink key={p.key} p={p} big />
          ))}
        </div>
      )}
      {rest.length > 0 && (
        <div class="t-wsm__drop">
          <button
            type="button"
            class={variant === 'menu' ? 'btn btn--secondary t-wsm__toggle' : 'link-small t-wsm__toggle'}
            aria-expanded={open}
            data-testid="worksheet-pdf-toggle"
            onClick={() => setOpen((v) => !v)}
          >
            {toggleText} ▾
          </button>
          {open && <PdfList list={rest} onPick={() => setOpen(false)} />}
        </div>
      )}
    </div>
  );
}
