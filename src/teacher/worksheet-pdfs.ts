/**
 * 인쇄용 학습지 PDF 목록(작업 138, PRD 7.5.3) — 교사 화면 전용(학생·타이틀·공용 화면에서는 import 하지 않는다).
 *
 * 빌드 때 print/dist/ 에 실제로 있던 파일만 `__WORKSHEET_PDFS__`(vite.config.ts → scripts/vite-worksheet-pdfs.ts)로 들어온다.
 * 없는 파일의 버튼은 그리지 않는다. 주소는 페이지 기준 상대 주소 `./print/<영문 이름>?v=<내용 해시>`(한글 주소 없음).
 */
import type { LessonId } from '../data/types';

export type WorksheetPdfKey = 'student-all' | 'L1' | 'L2' | 'L3' | 'L4-1' | 'L4-2' | 'optional' | 'teacher-answers';

export interface WorksheetPdfMeta {
  key: WorksheetPdfKey;
  /** 화면 이름(PRD 7.5.3 표에서 쪽 수를 뺀 것 — 쪽 수는 빌드가 PDF 를 세어 넣는다, 수정 1회차) */
  label: string;
  /** 학생용 / 교사용(교사용 예시 답은 교사 화면에서만 — 16.2-21) */
  group: 'student' | 'teacher';
  /** 저장할 때 쓰면 좋은 한글 이름(참고용 — `download` 속성은 새 탭 열기를 막아 쓰지 않음) */
  saveName: string;
}

/** 화면 목록 순서 = 이 배열 순서 */
export const WORKSHEET_PDF_META: readonly WorksheetPdfMeta[] = [
  { key: 'student-all', label: '학생용 전체', group: 'student', saveName: '대항해무역왕_항해일지_학생용_전체.pdf' },
  { key: 'L1', label: '1차시', group: 'student', saveName: '대항해무역왕_항해일지_1차시.pdf' },
  { key: 'L2', label: '2차시', group: 'student', saveName: '대항해무역왕_항해일지_2차시.pdf' },
  { key: 'L3', label: '3차시', group: 'student', saveName: '대항해무역왕_항해일지_3차시.pdf' },
  { key: 'L4-1', label: '4차시 ①(⑬~⑯·⑱)', group: 'student', saveName: '대항해무역왕_항해일지_4차시_1.pdf' },
  { key: 'L4-2', label: '4차시 ②(⑰ 잡지 표지 원고)', group: 'student', saveName: '대항해무역왕_항해일지_4차시_2.pdf' },
  { key: 'optional', label: '선택 활동(⑲·⑳)', group: 'student', saveName: '대항해무역왕_항해일지_선택활동.pdf' },
  { key: 'teacher-answers', label: '교사용 예시 답', group: 'teacher', saveName: '대항해무역왕_항해일지_교사용_예시답.pdf' },
];

/** 모든 파일 공통 인쇄 안내 */
export const PRINT_NOTE = 'A4 단면';
/** 목록이 비었을 때 한 줄(PRD 7.5.3) */
export const NO_PDF_TEXT = '학습지 PDF가 이 서버에 없어요. docs/worksheet.md를 보고 인쇄하세요';

export interface WorksheetPdfManifestEntry {
  key: string;
  file: string;
  bytes: number;
  hash: string;
  /** 쪽 수(빌드가 PDF 를 셈, 못 세면 0 — 옛 목록에는 없을 수 있음) */
  pages?: number;
}

export interface WorksheetPdf extends WorksheetPdfMeta {
  file: string;
  bytes: number;
  /** 쪽 수(0 = 모름) */
  pages: number;
  /** 페이지 기준 상대 주소 */
  href: string;
}

const BUILT: readonly WorksheetPdfManifestEntry[] =
  typeof __WORKSHEET_PDFS__ !== 'undefined' && Array.isArray(__WORKSHEET_PDFS__) ? __WORKSHEET_PDFS__ : [];

/** 실제로 있는 파일만, 화면 순서대로 */
export function availablePdfs(manifest: readonly WorksheetPdfManifestEntry[] = BUILT): WorksheetPdf[] {
  const out: WorksheetPdf[] = [];
  for (const m of WORKSHEET_PDF_META) {
    const e = manifest.find((x) => x.key === m.key);
    if (!e) continue;
    out.push({ ...m, file: e.file, bytes: e.bytes, pages: e.pages ?? 0, href: `./print/${e.file}?v=${encodeURIComponent(e.hash)}` });
  }
  return out;
}

/** '이 차시 학습지' 키: 차시 한 판이면 그 차시(L4는 두 파일), 단원·연속 구간이면 학생용 전체 */
export function lessonPdfKeys(lesson: LessonId | 'unit' | null | undefined): WorksheetPdfKey[] {
  switch (lesson) {
    case 'L1':
    case 'L2':
    case 'L3':
      return [lesson];
    case 'L4':
      return ['L4-1', 'L4-2'];
    case 'unit':
      return ['student-all'];
    default:
      return [];
  }
}

/** 인쇄 안내 한 줄 "A4 단면 · 4쪽 · 0.42MB"(쪽 수를 모르면 빼고) */
export function metaText(p: Pick<WorksheetPdf, 'pages' | 'bytes'>): string {
  return [PRINT_NOTE, p.pages > 0 ? `${p.pages}쪽` : null, sizeText(p.bytes)].filter(Boolean).join(' · ');
}

/** 크기 표시 "0.35MB" */
export function sizeText(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(bytes >= 1_000_000 ? 1 : 2)}MB`;
}
