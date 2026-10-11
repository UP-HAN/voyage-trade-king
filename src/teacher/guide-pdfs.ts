/**
 * 공략집 PDF 목록(작업 141) — 교사 화면 전용(학생·타이틀·공용 화면에서는 import 하지 않는다).
 *
 * `npm run guide:build`가 만든 print/dist/대항해무역왕_공략집_{선생님,학생}.pdf 를 빌드가 dist/print/guide-*.pdf 로 복사하고
 * 실제로 있던 파일만 `__GUIDE_PDFS__`로 넣는다(scripts/vite-worksheet-pdfs.ts). 없는 파일의 링크는 그리지 않는다.
 */
import { sizeText, type WorksheetPdfManifestEntry } from './worksheet-pdfs';

export type GuidePdfKey = 'guide-teacher' | 'guide-student';

export interface GuidePdfMeta {
  key: GuidePdfKey;
  /** 링크 글자 */
  label: string;
}

/** 화면 순서 = 이 배열 순서 */
export const GUIDE_PDF_META: readonly GuidePdfMeta[] = [
  { key: 'guide-teacher', label: '선생님 편' },
  { key: 'guide-student', label: '학생 편' },
];

export interface GuidePdf extends GuidePdfMeta {
  file: string;
  bytes: number;
  pages: number;
  href: string;
}

const BUILT: readonly WorksheetPdfManifestEntry[] = typeof __GUIDE_PDFS__ !== 'undefined' && Array.isArray(__GUIDE_PDFS__) ? __GUIDE_PDFS__ : [];

/** 실제로 있는 공략집만, 화면 순서대로 */
export function availableGuides(manifest: readonly WorksheetPdfManifestEntry[] = BUILT): GuidePdf[] {
  const out: GuidePdf[] = [];
  for (const m of GUIDE_PDF_META) {
    const e = manifest.find((x) => x.key === m.key);
    if (!e) continue;
    out.push({ ...m, file: e.file, bytes: e.bytes, pages: e.pages ?? 0, href: `./print/${e.file}?v=${encodeURIComponent(e.hash)}` });
  }
  return out;
}

/** 링크 옆 작은 글자 "24쪽 · 3.1MB" */
export function guideMetaText(g: Pick<GuidePdf, 'pages' | 'bytes'>): string {
  return [g.pages > 0 ? `${g.pages}쪽` : null, sizeText(g.bytes)].filter(Boolean).join(' · ');
}
