/**
 * 작업 141 — 공략집 PDF(선생님 편·학생 편): 빌드 플러그인 대응표·없는 파일, 앱 목록, 시작 화면 링크 줄.
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GUIDE_PDF_SOURCES, manifestOf, scanGuidePdfs, WORKSHEET_PDF_SOURCES } from '../../scripts/vite-worksheet-pdfs';
import { availableGuides, GUIDE_PDF_META, guideMetaText } from '../../src/teacher/guide-pdfs';
import { GuidePdfLinks } from '../../src/teacher/StartScreen';
import { availablePdfs } from '../../src/teacher/worksheet-pdfs';
import { installFakeDom, type FakeElement } from '../map/fake-dom';

describe('빌드 플러그인: 공략집 PDF 대응표', () => {
  const tmps: string[] = [];
  afterAll(async () => {
    for (const d of tmps) await rm(d, { recursive: true, force: true }); // fs.rmSync 금지(CLAUDE.md)
  });
  const fakeSrc = (skip: string[] = []) => {
    const dir = mkdtempSync(join(tmpdir(), 'voyage-guide-'));
    tmps.push(dir);
    for (const s of GUIDE_PDF_SOURCES) if (!skip.includes(s.src)) writeFileSync(join(dir, s.src), Buffer.from(`%PDF-1.7 ${s.key} /Type /Page /Type /Page`));
    return dir;
  };

  it('영문 이름 2개(주소에 한글 없음), 학습지 목록과 겹치지 않음', () => {
    expect(GUIDE_PDF_SOURCES.map((s) => s.file)).toEqual(['guide-teacher.pdf', 'guide-student.pdf']);
    expect(GUIDE_PDF_SOURCES.map((s) => s.src)).toEqual(['대항해무역왕_공략집_선생님.pdf', '대항해무역왕_공략집_학생.pdf']);
    for (const g of GUIDE_PDF_SOURCES) {
      expect(g.file).toMatch(/^[a-z-]+\.pdf$/);
      expect(WORKSHEET_PDF_SOURCES.some((w) => w.file === g.file || w.key === g.key)).toBe(false);
    }
    expect(GUIDE_PDF_META.map((m) => m.key)).toEqual(GUIDE_PDF_SOURCES.map((s) => s.key));
  });

  it('있는 파일만 목록(쪽 수·해시), 없으면 그 항목만 빠지고 경고 한 줄', () => {
    const all = scanGuidePdfs(fakeSrc());
    expect(all.entries.map((e) => e.key)).toEqual(['guide-teacher', 'guide-student']);
    expect(all.entries[0]!.pages).toBe(2);
    expect(all.warnings).toEqual([]);
    const one = scanGuidePdfs(fakeSrc(['대항해무역왕_공략집_학생.pdf']));
    expect(manifestOf(one).map((e) => e.key)).toEqual(['guide-teacher']);
    expect(one.warnings.join('\n')).toContain('npm run guide:build');
  });

  it('공략집 목록은 학습지 메뉴에 섞이지 않는다', () => {
    const m = manifestOf(scanGuidePdfs(fakeSrc()));
    expect(availablePdfs(m)).toEqual([]);
    expect(availableGuides(m).map((g) => g.label)).toEqual(['선생님 편', '학생 편']);
    expect(availableGuides(m)[0]!.href).toMatch(/^\.\/print\/guide-teacher\.pdf\?v=[0-9a-f]+$/);
  });

  it('작은 글자: 쪽 수·크기', () => {
    expect(guideMetaText({ pages: 24, bytes: 3_100_000 })).toBe('24쪽 · 3.1MB');
    expect(guideMetaText({ pages: 0, bytes: 450_000 })).toBe('0.45MB');
  });
});

let dom: ReturnType<typeof installFakeDom>;
beforeEach(() => {
  dom = installFakeDom();
});
afterEach(() => {
  act(() => render(null, dom.root as unknown as Element));
  dom.restore();
});
const byId = (root: FakeElement, id: string) => root.find((el) => el.getAttribute('data-testid') === id)[0];

describe('시작 화면 공략집 링크 줄', () => {
  it('없으면 아무것도 그리지 않는다', () => {
    act(() => render(<GuidePdfLinks guides={[]} />, dom.root as unknown as Element));
    expect(byId(dom.root, 'guide-pdf-links')).toBeUndefined();
  });

  it('선생님 편·학생 편 — 새 탭·noopener', () => {
    const guides = availableGuides([
      { key: 'guide-teacher', file: 'guide-teacher.pdf', bytes: 3_000_000, hash: 'a1', pages: 30 },
      { key: 'guide-student', file: 'guide-student.pdf', bytes: 2_000_000, hash: 'b2', pages: 40 },
    ]);
    act(() => render(<GuidePdfLinks guides={guides} />, dom.root as unknown as Element));
    const row = byId(dom.root, 'guide-pdf-links')!;
    expect(row.textContent).toContain('공략집');
    for (const k of ['guide-teacher', 'guide-student']) {
      const a = byId(dom.root, `guide-pdf-${k}`)!;
      expect(a.localName).toBe('a');
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener');
      expect(a.getAttribute('href')).toMatch(new RegExp(`^\\./print/${k}\\.pdf\\?v=`));
    }
    expect(byId(dom.root, 'guide-pdf-guide-teacher')!.textContent).toContain('선생님 편');
    expect(byId(dom.root, 'guide-pdf-guide-student')!.textContent).toContain('40쪽');
  });
});
