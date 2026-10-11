/**
 * 작업 138 — 인쇄용 학습지 PDF(작업 136 산출 `print/dist/`)를 빌드에 함께 넣는 Vite 플러그인 (PRD 7.5.3).
 *
 * - 원본 `print/dist/`는 **읽기만** 한다. 빌드 중에 PDF를 다시 만들지 않는다(크로미움이 필요 — `npm run worksheet:pdf`).
 * - 빌드(`vite build`)가 끝나면(`closeBundle`) 있는 파일만 `dist/print/`에 **영문 이름**으로 복사한다(주소에 한글을 쓰지 않음).
 * - 실제로 있는 파일 목록(키·영문 이름·바이트·내용 해시)을 `define`(`__WORKSHEET_PDFS__`)으로 앱에 넣는다
 *   (`__IMAGE_LIST__`·`__IMAGE_VARIANTS__`와 같은 방식 — e2e 하네스가 `configFile: false`로 따로 묶을 때는 정의가 없어 빈 목록).
 *   원본이 없으면 그 항목만 목록에서 빠지고 빌드는 계속된다(경고 한 줄). 화면은 없는 파일의 버튼을 그리지 않는다.
 * - 개발 서버(`npm run dev`)에서는 같은 주소(`…/print/logbook-*.pdf`)를 미들웨어가 원본에서 읽어 준다.
 * - 검사(경고만, 실패 아님): 파일 하나 2MB·합계 6MB 초과, `print/worksheet/*.{html,css,js}`가 PDF보다 새로움(수정 1회차: ref/·그림·문서 제외).
 * - 쪽 수는 PDF 안의 쪽 객체를 세어 목록에 넣는다(화면이 "n쪽"을 고정 문구로 갖지 않게 — 수정 1회차).
 * - 시험용: 환경 변수 `VOYAGE_WORKSHEET_PDF_DIR`로 원본 폴더를 바꿀 수 있다(파일 하나를 뺀 폴더로 빌드해 보기).
 *
 * (작업 141) 공략집 PDF(`npm run guide:build` 산출 `print/dist/대항해무역왕_공략집_*.pdf`)도 같은 방식으로 `dist/print/guide-*.pdf`에 복사하고
 *   목록을 `__GUIDE_PDFS__`로 넣는다(학습지 목록·용량 기준·원본보다 오래됨 검사와는 따로 — 스크린숏이 많아 학습지보다 크다).
 *
 * fs.rmSync·fs.cpSync 는 쓰지 않는다(Windows + Node 24 + 한글 경로에서 프로세스가 죽음 — CLAUDE.md). copyFileSync·mkdirSync 만.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Plugin } from 'vite';

/** 원본(print/dist 기준 경로) → 배포 이름. 순서 = 화면 목록 순서 */
export const WORKSHEET_PDF_SOURCES: readonly { key: string; src: string; file: string }[] = [
  { key: 'student-all', src: '대항해무역왕_항해일지_학생용.pdf', file: 'logbook-student-all.pdf' },
  { key: 'L1', src: '장별/L1.pdf', file: 'logbook-L1.pdf' },
  { key: 'L2', src: '장별/L2.pdf', file: 'logbook-L2.pdf' },
  { key: 'L3', src: '장별/L3.pdf', file: 'logbook-L3.pdf' },
  { key: 'L4-1', src: '장별/L4-1.pdf', file: 'logbook-L4-1.pdf' },
  { key: 'L4-2', src: '장별/L4-2.pdf', file: 'logbook-L4-2.pdf' },
  { key: 'optional', src: '장별/선택활동.pdf', file: 'logbook-optional.pdf' },
  { key: 'teacher-answers', src: '대항해무역왕_항해일지_교사용_예시답.pdf', file: 'logbook-teacher-answers.pdf' },
];

/** (작업 141) 공략집 PDF: 원본(print/dist 기준) → 배포 이름. 순서 = 화면 순서 */
export const GUIDE_PDF_SOURCES: readonly { key: string; src: string; file: string }[] = [
  { key: 'guide-teacher', src: '대항해무역왕_공략집_선생님.pdf', file: 'guide-teacher.pdf' },
  { key: 'guide-student', src: '대항해무역왕_공략집_학생.pdf', file: 'guide-student.pdf' },
];
/** 공략집 파일 하나 용량 경고 기준(경고만) */
export const GUIDE_FILE_MAX = 15_000_000;

/** 용량 기준(PRD 7.5.3): 1MB = 1,000,000 바이트(보수적으로 10진) */
export const PDF_FILE_MAX = 2_000_000;
export const PDF_TOTAL_MAX = 6_000_000;
export const STALE_WARNING = '학습지 PDF가 원본보다 오래됐어요 — npm run worksheet:pdf';

/** 앱에 넣는 목록 한 줄 */
export interface WorksheetPdfEntry {
  key: string;
  file: string;
  bytes: number;
  /** 내용 해시 앞 10자리 — 주소 끝 ?v= (예전 파일이 캐시로 남지 않게) */
  hash: string;
  /** 쪽 수(PDF 안의 /Type /Page 개수, 못 세면 0) — 화면 "n쪽" 표시 */
  pages: number;
}

export interface WorksheetPdfScan {
  entries: (WorksheetPdfEntry & { path: string })[];
  missing: string[];
  warnings: string[];
  total: number;
}

/**
 * PDF 쪽 수(외부 의존 없이): 쪽 객체 `/Type /Page`(뒤에 s 가 붙은 `/Pages` 제외) 개수.
 * 크로뮴 출력은 쪽 객체를 압축 객체 묶음에 넣지 않아 그대로 셀 수 있다(scripts/build-worksheet-pdf.mjs inspectPdf 와 같은 방법). 못 세면 0.
 */
export function countPdfPages(buf: Buffer): number {
  return (buf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
}

/** PDF 를 만드는 원본(print/worksheet 바로 아래 .html·.css·.js)만 — ref/(옛 대조본)·img/·png·md 는 비교하지 않는다 */
export const WORKSHEET_SOURCE_EXT = /\.(html|css|js)$/i;

function newestSourceMtime(dir: string): number {
  if (!existsSync(dir)) return 0;
  let max = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isFile() && WORKSHEET_SOURCE_EXT.test(e.name)) max = Math.max(max, statSync(join(dir, e.name)).mtimeMs);
  }
  return max;
}

/** 원본 폴더를 읽어 있는 파일 목록·경고를 만든다(쓰지 않음) */
export function scanWorksheetPdfs(srcDir: string, worksheetDir: string | null): WorksheetPdfScan {
  const entries: WorksheetPdfScan['entries'] = [];
  const missing: string[] = [];
  const warnings: string[] = [];
  let oldest = Infinity;
  for (const s of WORKSHEET_PDF_SOURCES) {
    const path = join(srcDir, ...s.src.split('/'));
    if (!existsSync(path) || !statSync(path).isFile()) {
      missing.push(s.src);
      continue;
    }
    const buf = readFileSync(path);
    const st = statSync(path);
    oldest = Math.min(oldest, st.mtimeMs);
    entries.push({ key: s.key, file: s.file, bytes: buf.length, hash: createHash('sha1').update(buf).digest('hex').slice(0, 10), pages: countPdfPages(buf), path });
    if (buf.length > PDF_FILE_MAX) warnings.push(`학습지 PDF ${s.file}가 ${(buf.length / 1e6).toFixed(2)} MB예요(기준 2MB 이하)`);
  }
  const total = entries.reduce((n, e) => n + e.bytes, 0);
  if (total > PDF_TOTAL_MAX) warnings.push(`학습지 PDF 합계가 ${(total / 1e6).toFixed(2)} MB예요(기준 6MB 이하)`);
  if (missing.length) {
    warnings.push(
      entries.length
        ? `학습지 PDF ${missing.length}개가 없어 그 버튼은 숨겨요: ${missing.join(', ')}`
        : `학습지 PDF가 없어요(${srcDir}) — 화면에는 안내 한 줄만 나와요. npm run worksheet:pdf`,
    );
  }
  if (entries.length && worksheetDir && newestSourceMtime(worksheetDir) > oldest) warnings.push(STALE_WARNING);
  return { entries, missing, warnings, total };
}

/** (작업 141) 공략집 PDF 목록 — 없으면 그 항목만 빠지고(경고 한 줄) 빌드는 계속된다 */
export function scanGuidePdfs(srcDir: string): WorksheetPdfScan {
  const entries: WorksheetPdfScan['entries'] = [];
  const missing: string[] = [];
  const warnings: string[] = [];
  for (const s of GUIDE_PDF_SOURCES) {
    const path = join(srcDir, ...s.src.split('/'));
    if (!existsSync(path) || !statSync(path).isFile()) {
      missing.push(s.src);
      continue;
    }
    const buf = readFileSync(path);
    entries.push({ key: s.key, file: s.file, bytes: buf.length, hash: createHash('sha1').update(buf).digest('hex').slice(0, 10), pages: countPdfPages(buf), path });
    if (buf.length > GUIDE_FILE_MAX) warnings.push(`공략집 PDF ${s.file}가 ${(buf.length / 1e6).toFixed(2)} MB예요(기준 15MB 이하)`);
  }
  if (missing.length) warnings.push(`공략집 PDF ${missing.length}개가 없어 그 링크는 숨겨요: ${missing.join(', ')} — npm run guide:build`);
  return { entries, missing, warnings, total: entries.reduce((n, e) => n + e.bytes, 0) };
}

/** define 값(경로 없이) */
export function manifestOf(scan: WorksheetPdfScan): WorksheetPdfEntry[] {
  return scan.entries.map(({ key, file, bytes, hash, pages }) => ({ key, file, bytes, hash, pages }));
}

export function worksheetPdfs(o: { root: string }): Plugin {
  const srcDir = () => resolve(o.root, process.env.VOYAGE_WORKSHEET_PDF_DIR || join('print', 'dist'));
  const wsDir = join(o.root, 'print', 'worksheet');
  let scan: WorksheetPdfScan | null = null;
  let guides: WorksheetPdfScan | null = null;
  let outDir = '';
  let isBuild = false;
  return {
    name: 'voyage:worksheet-pdfs',
    config(_config, env) {
      isBuild = env.command === 'build';
      scan = scanWorksheetPdfs(srcDir(), wsDir);
      guides = scanGuidePdfs(srcDir());
      const isTest = Boolean(process.env.VITEST) || env.mode === 'test';
      if (!isTest) for (const w of [...scan.warnings, ...guides.warnings]) console.warn(`[worksheet-pdfs] ${w}`);
      return { define: { __WORKSHEET_PDFS__: JSON.stringify(manifestOf(scan)), __GUIDE_PDFS__: JSON.stringify(manifestOf(guides)) } };
    },
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      // 개발 서버: …/print/logbook-*.pdf → 원본 PDF(같은 대응표). 파일을 다시 만들었을 수 있어 요청마다 원본을 읽는다.
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0] ?? '';
        const m = /\/print\/((?:logbook|guide)-[A-Za-z0-9-]+\.pdf)$/.exec(path);
        const src = m ? [...WORKSHEET_PDF_SOURCES, ...GUIDE_PDF_SOURCES].find((s) => s.file === m[1]) : undefined;
        if (!src) return next();
        const file = join(srcDir(), ...src.src.split('/'));
        if (!existsSync(file)) return next();
        const buf = readFileSync(file);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Length', String(buf.length));
        res.setHeader('Cache-Control', 'no-cache');
        res.end(buf);
      });
    },
    closeBundle() {
      if (!isBuild || !scan || !outDir) return;
      const dest = join(outDir, 'print');
      if (scan.entries.length) {
        mkdirSync(dest, { recursive: true });
        for (const e of scan.entries) copyFileSync(e.path, join(dest, e.file));
        console.log(`[worksheet-pdfs] 학습지 PDF ${scan.entries.length}개(${(scan.total / 1e6).toFixed(2)} MB) → ${join('dist', 'print')}`);
      }
      if (guides?.entries.length) {
        mkdirSync(dest, { recursive: true });
        for (const e of guides.entries) copyFileSync(e.path, join(dest, e.file));
        console.log(`[worksheet-pdfs] 공략집 PDF ${guides.entries.length}개(${(guides.total / 1e6).toFixed(2)} MB) → ${join('dist', 'print')}`);
      }
    },
  };
}
