/**
 * 작업 138 — 학습지 PDF(PRD 7.5.3)와 판 설정·시작 화면 정리(PRD 7.5.2.3~7.5.2.5).
 * - 빌드 플러그인 대응표·없는 파일·용량·원본보다 오래됨 경고(scripts/vite-worksheet-pdfs.ts)
 * - 앱 목록·'이 차시 학습지' 키·빈 목록 문구(src/teacher/worksheet-pdfs.ts, WorksheetPdfMenu.tsx)
 * - 오늘 순서 한 줄 요약(L1 10/25분 표본)
 * - 판 설정 렌더: [고급 설정] 접힘 기본, 쉬운 말, FULL_UNIT_READY 꺼짐/켜짐(개발용 열쇠로 켬)
 * - 시작 화면 '수업 준비 3단계' 상자·접힘 기억
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { countPdfPages, PDF_FILE_MAX, scanWorksheetPdfs, STALE_WARNING, WORKSHEET_PDF_SOURCES, manifestOf } from '../../scripts/vite-worksheet-pdfs';
import { SetupContainer } from '../../src/teacher/index';
import { defaultSetup, DEV_FULL_UNIT_KEY, NOT_READY_TEXT, orderSummaryOf, orderSummaryText, type SetupValues } from '../../src/teacher/setup';
import { guideOpenInitially, GUIDE_KEY, PrepGuide, rememberGuide } from '../../src/teacher/StartScreen';
import { WorksheetPdfMenu } from '../../src/teacher/WorksheetPdfMenu';
import { availablePdfs, lessonPdfKeys, metaText, NO_PDF_TEXT, WORKSHEET_PDF_META, type WorksheetPdfManifestEntry } from '../../src/teacher/worksheet-pdfs';
import { ServerRoomsStore, type RoomStatus } from '../../src/ui/common/server-status';
import { installFakeDom, type FakeElement } from '../map/fake-dom';
import { MemStorage } from '../sync/session-helpers';

const ALL_KEYS = ['student-all', 'L1', 'L2', 'L3', 'L4-1', 'L4-2', 'optional', 'teacher-answers'];
const FILES = [
  'logbook-student-all.pdf',
  'logbook-L1.pdf',
  'logbook-L2.pdf',
  'logbook-L3.pdf',
  'logbook-L4-1.pdf',
  'logbook-L4-2.pdf',
  'logbook-optional.pdf',
  'logbook-teacher-answers.pdf',
];
const fullManifest = (): WorksheetPdfManifestEntry[] => ALL_KEYS.map((k, i) => ({ key: k, file: FILES[i]!, bytes: 300_000 + i, hash: `h${i}`, pages: i + 1 }));

// ───────────────────────────── 빌드 플러그인(파일 대응표) ─────────────────────────────

describe('빌드 플러그인: print/dist → dist/print 대응표(PRD 7.5.3)', () => {
  const tmps: string[] = [];
  afterAll(async () => {
    for (const d of tmps) await rm(d, { recursive: true, force: true }); // fs.rmSync 금지(CLAUDE.md)
  });
  const fakeSrc = (skip: string[] = [], big: string | null = null) => {
    const dir = mkdtempSync(join(tmpdir(), 'voyage-ws-'));
    tmps.push(dir);
    mkdirSync(join(dir, '장별'), { recursive: true });
    for (const s of WORKSHEET_PDF_SOURCES) {
      if (skip.includes(s.src)) continue;
      writeFileSync(join(dir, ...s.src.split('/')), s.src === big ? Buffer.alloc(PDF_FILE_MAX + 10) : Buffer.from(`%PDF-1.7 ${s.key}`));
    }
    return dir;
  };

  it('영문 이름 8개, 키 순서 고정', () => {
    expect(WORKSHEET_PDF_SOURCES.map((s) => s.file)).toEqual(FILES);
    expect(WORKSHEET_PDF_SOURCES.map((s) => s.key)).toEqual(ALL_KEYS);
    expect(WORKSHEET_PDF_META.map((m) => m.key)).toEqual(ALL_KEYS);
    for (const f of FILES) expect(f).toMatch(/^[a-z0-9-]+\.pdf$/i); // 주소에 한글 없음
  });

  it('실제 print/dist 원본: 8개 모두 있고 파일당 2MB·합계 6MB 이하', () => {
    const scan = scanWorksheetPdfs(join(__dirname, '..', '..', 'print', 'dist'), null);
    expect(scan.entries.map((e) => e.file)).toEqual(FILES);
    expect(scan.missing).toEqual([]);
    for (const e of scan.entries) expect(e.bytes).toBeLessThanOrEqual(2_000_000);
    expect(scan.total).toBeLessThanOrEqual(6_000_000);
    expect(scan.warnings.filter((w) => !w.includes('오래됐어요'))).toEqual([]);
  });

  it('(수정 1회차) 쪽 수를 PDF에서 센다: 장별 합 = 학생용 전체, 교사용 3쪽, 화면 표시 "n쪽"', () => {
    const scan = scanWorksheetPdfs(join(__dirname, '..', '..', 'print', 'dist'), null);
    const pg = Object.fromEntries(scan.entries.map((e) => [e.key, e.pages]));
    for (const e of scan.entries) expect(e.pages, e.file).toBeGreaterThan(0);
    const chapters = ['L1', 'L2', 'L3', 'L4-1', 'L4-2', 'optional'].reduce((n, k) => n + (pg[k] ?? 0), 0);
    expect(pg['student-all']).toBe(chapters); // 139 기준 20쪽(활동 1개 = 1쪽)
    expect(pg['student-all']).toBe(20);
    expect(pg['optional']).toBe(2); // ⑲·⑳ 각 1쪽
    expect(pg['teacher-answers']).toBe(4); // 140: 항해 퀴즈 정답 6행·사용법 추가로 3 → 4쪽
    expect(manifestOf(scan).every((e) => typeof e.pages === 'number')).toBe(true);
    const list = availablePdfs(manifestOf(scan));
    expect(metaText(list.find((p) => p.key === 'student-all')!)).toMatch(/^A4 단면 · 20쪽 · \d/);
    expect(metaText({ pages: 0, bytes: 350_000 })).toBe('A4 단면 · 0.35MB'); // 못 세면 쪽 수는 빼고
    expect(countPdfPages(Buffer.from('<< /Type /Pages /Count 2 >> << /Type /Page >> << /Type/Page >>'))).toBe(2);
  });

  it('원본 하나가 없으면 그 항목만 빠지고 경고 한 줄(빌드는 계속)', () => {
    const scan = scanWorksheetPdfs(fakeSrc(['장별/L2.pdf']), null);
    expect(scan.entries.map((e) => e.key)).toEqual(ALL_KEYS.filter((k) => k !== 'L2'));
    expect(scan.missing).toEqual(['장별/L2.pdf']);
    expect(scan.warnings).toHaveLength(1);
    expect(scan.warnings[0]).toContain('장별/L2.pdf');
    // 앱 목록에서도 그 버튼만 사라진다
    const list = availablePdfs(manifestOf(scan));
    expect(list.map((p) => p.key)).toEqual(ALL_KEYS.filter((k) => k !== 'L2'));
  });

  it('하나도 없으면 빈 목록 + 경고(빌드 실패 아님)', () => {
    const scan = scanWorksheetPdfs(join(tmpdir(), 'voyage-ws-none-not-exist'), null);
    expect(scan.entries).toEqual([]);
    expect(scan.warnings.length).toBe(1);
  });

  it('파일 하나 2MB 초과면 경고', () => {
    const scan = scanWorksheetPdfs(fakeSrc([], '장별/L3.pdf'), null);
    expect(scan.warnings.some((w) => w.includes('logbook-L3.pdf') && w.includes('2MB'))).toBe(true);
  });

  it('print/worksheet 의 .html·.css·.js 가 PDF보다 새로우면 "오래됐어요" 경고', () => {
    const src = fakeSrc();
    const ws = mkdtempSync(join(tmpdir(), 'voyage-wsrc-'));
    tmps.push(ws);
    writeFileSync(join(ws, 'student.html'), '<html></html>');
    const old = new Date(Date.now() - 3600_000);
    for (const s of WORKSHEET_PDF_SOURCES) utimesSync(join(src, ...s.src.split('/')), old, old);
    expect(scanWorksheetPdfs(src, ws).warnings).toContain(STALE_WARNING);
    // 원본이 더 오래되면 경고 없음
    const older = new Date(Date.now() - 7200_000);
    utimesSync(join(ws, 'student.html'), older, older);
    expect(scanWorksheetPdfs(src, ws).warnings).not.toContain(STALE_WARNING);
  });

  it('(수정 1회차) ref/·그림·문서(.png·.md)는 비교하지 않는다 — 새로 고쳐도 경고 없음', () => {
    const src = fakeSrc();
    const ws = mkdtempSync(join(tmpdir(), 'voyage-wsrc-'));
    tmps.push(ws);
    const older = new Date(Date.now() - 7200_000);
    const old = new Date(Date.now() - 3600_000);
    for (const f of ['student.html', 'worksheet.css', 'common.js']) {
      writeFileSync(join(ws, f), 'x');
      utimesSync(join(ws, f), older, older);
    }
    for (const s of WORKSHEET_PDF_SOURCES) utimesSync(join(src, ...s.src.split('/')), old, old);
    // PDF 보다 새 파일: ref/ 대조본(html·css), 견본 그림·설명 문서, img/ 그림
    mkdirSync(join(ws, 'ref'));
    mkdirSync(join(ws, 'img'));
    for (const f of ['ref/student-136.html', 'ref/worksheet-136.css', 'design-specimen.png', 'DESIGN.md', 'img/ship.png']) writeFileSync(join(ws, ...f.split('/')), 'new');
    expect(scanWorksheetPdfs(src, ws).warnings).not.toContain(STALE_WARNING);
    // 바로 아래 .css 를 고치면 경고
    writeFileSync(join(ws, 'worksheet.css'), 'changed');
    expect(scanWorksheetPdfs(src, ws).warnings).toContain(STALE_WARNING);
  });

  it('vite.config.ts 가 플러그인을 쓰고, 플러그인은 cpSync·rmSync 를 쓰지 않는다', () => {
    const cfg = readFileSync(join(__dirname, '..', '..', 'vite.config.ts'), 'utf8');
    expect(cfg).toMatch(/worksheetPdfs\(\{ root \}\)/);
    const plug = readFileSync(join(__dirname, '..', '..', 'scripts', 'vite-worksheet-pdfs.ts'), 'utf8');
    expect(plug).not.toMatch(/cpSync\(|rmSync\(/);
  });
});

// ───────────────────────────── 앱 목록 ─────────────────────────────

describe('학습지 PDF 목록·이 차시 학습지', () => {
  it('주소는 페이지 기준 상대 주소 + ?v=해시, 화면 이름은 PRD 표대로', () => {
    const list = availablePdfs(fullManifest());
    expect(list.map((p) => p.label)).toEqual([
      '학생용 전체',
      '1차시',
      '2차시',
      '3차시',
      '4차시 ①(⑬~⑯·⑱)',
      '4차시 ②(⑰ 잡지 표지 원고)',
      '특별 항해(⑲·⑳)',
      '교사용 예시 답',
    ]);
    expect(list[1]!.href).toBe('./print/logbook-L1.pdf?v=h1');
    expect(list.find((p) => p.key === 'teacher-answers')!.group).toBe('teacher');
    expect(list[1]!.saveName).toBe('대항해무역왕_항해일지_1차시.pdf');
  });

  it('차시 → 파일 키(L4는 두 파일, 단원은 학생용 전체)', () => {
    expect(lessonPdfKeys('L1')).toEqual(['L1']);
    expect(lessonPdfKeys('L3')).toEqual(['L3']);
    expect(lessonPdfKeys('L4')).toEqual(['L4-1', 'L4-2']);
    expect(lessonPdfKeys('unit')).toEqual(['student-all']);
    expect(lessonPdfKeys(null)).toEqual([]);
  });

  it('학생·타이틀·공용 화면 코드는 학습지 PDF 부품을 가져오지 않는다', async () => {
    const { readdirSync, statSync } = await import('node:fs');
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap((n) => {
        const p = join(d, n);
        return statSync(p).isDirectory() ? walk(p) : [p];
      });
    const src = join(__dirname, '..', '..', 'src');
    for (const dir of ['student', 'screen', 'title']) {
      for (const f of walk(join(src, dir)).filter((x) => /\.(ts|tsx)$/.test(x))) {
        expect(readFileSync(f, 'utf8'), f).not.toMatch(/worksheet-pdfs|WorksheetPdfMenu|__WORKSHEET_PDFS__|logbook-[\w-]+\.pdf|print\/logbook/);
      }
    }
  });
});

// ───────────────────────────── 렌더 ─────────────────────────────

let dom: ReturnType<typeof installFakeDom>;
beforeEach(() => {
  dom = installFakeDom();
});
afterEach(() => {
  act(() => render(null, dom.root as unknown as Element));
  dom.restore();
});
const byId = (root: FakeElement, id: string) => root.find((el) => el.getAttribute('data-testid') === id)[0];
const text = (el: FakeElement | undefined) => el?.textContent ?? '';
const inside = (outer: FakeElement | undefined, id: string) => !!outer && !!byId(outer, id);

describe('WorksheetPdfMenu', () => {
  const mount = (el: preact.VNode) => act(() => render(el, dom.root as unknown as Element));

  it('목록이 비면 안내 한 줄', () => {
    mount(<WorksheetPdfMenu variant="menu" pdfs={[]} />);
    expect(text(byId(dom.root, 'worksheet-pdf-empty'))).toBe(NO_PDF_TEXT);
    expect(NO_PDF_TEXT).toBe('학습지 PDF가 이 서버에 없어요. docs/worksheet.md를 보고 인쇄하세요');
  });

  it('펼침형: [학습지 열기 ▾] → 8개(교사용 포함), 새 탭·noopener, A4 단면 표시', () => {
    mount(<WorksheetPdfMenu variant="menu" pdfs={availablePdfs(fullManifest())} />);
    expect(byId(dom.root, 'worksheet-pdf-L1')).toBeUndefined();
    const t = byId(dom.root, 'worksheet-pdf-toggle')!;
    expect(text(t)).toContain('학습지 열기');
    act(() => {
      t.dispatch('click');
    });
    for (const k of ALL_KEYS) {
      const a = byId(dom.root, `worksheet-pdf-${k}`)!;
      expect(a.localName).toBe('a');
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener');
      expect(a.hasAttribute('download')).toBe(false); // 새 탭 열기 우선
      expect(text(a)).toContain('A4 단면');
      expect(text(a)).toMatch(/\d+쪽/); // 쪽 수는 빌드가 센 값
    }
  });

  it('인라인형: 1차시 강조 + [다른 학습지 ▾], L4는 두 파일, 단원은 학생용 전체', () => {
    const pdfs = availablePdfs(fullManifest());
    mount(<WorksheetPdfMenu variant="inline" highlightLesson="L1" pdfs={pdfs} />);
    expect(byId(dom.root, 'worksheet-pdf-L1')?.getAttribute('data-highlight')).toBe('true');
    expect(byId(dom.root, 'worksheet-pdf-L2')).toBeUndefined();
    expect(text(byId(dom.root, 'worksheet-pdf-toggle'))).toContain('다른 학습지');
    mount(<WorksheetPdfMenu variant="inline" highlightLesson="L4" pdfs={pdfs} />);
    expect(byId(dom.root, 'worksheet-pdf-L4-1')?.getAttribute('data-highlight')).toBe('true');
    expect(byId(dom.root, 'worksheet-pdf-L4-2')?.getAttribute('data-highlight')).toBe('true');
    mount(<WorksheetPdfMenu variant="inline" highlightLesson="unit" pdfs={pdfs} />);
    expect(byId(dom.root, 'worksheet-pdf-student-all')?.getAttribute('data-highlight')).toBe('true');
    // 강조할 파일이 없으면(그 차시 PDF가 빠짐) 펼침 버튼만
    mount(<WorksheetPdfMenu variant="inline" highlightLesson="L2" pdfs={pdfs.filter((p) => p.key !== 'L2')} />);
    expect(byId(dom.root, 'worksheet-pdf-L2')).toBeUndefined();
    expect(text(byId(dom.root, 'worksheet-pdf-toggle'))).toContain('학습지 열기');
  });
});

describe('오늘 순서 한 줄 요약(PRD 7.5.2.3)', () => {
  const L1 = (m: number): SetupValues => ({ ...defaultSetup(), playUnit: 'lesson', lesson: 'L1', tradeMinutes: m });
  it('L1 10분 표본', () => {
    expect(orderSummaryOf(L1(10))).toBe(
      '차시 표지 → 벽란도 시장 → 무역·수입·수출 → 라운드 1 → 부산에 강추위, 천연가스가 필요해요 → 두 섬 이야기 → ③★ 지금 바로 쓰기 → 라운드 2 → 흑연을 어디서 살까요? → 마무리',
    );
    const parts = orderSummaryOf(L1(10))!.split(' → ');
    expect(parts[0]).toBe('차시 표지');
    expect(parts.at(-1)).toBe('마무리');
    expect(parts.join(' ')).not.toMatch(/… 외/); // 10분은 다 보인다
  });
  it('L1 25분 표본: 길면 "… 외 n개"', () => {
    const s = orderSummaryOf(L1(25))!;
    expect(s.startsWith('차시 표지 → 벽란도 시장 → 무역·수입·수출 → 라운드 1 → ')).toBe(true);
    expect(s).toMatch(/… 외 \d+개 → 마무리$/);
    expect(s.split(' → ').length).toBeLessThanOrEqual(10);
  });
  it('이어지는 라운드는 묶고, 편지·빠진 활동은 넣지 않는다', () => {
    const it0 = { stage: 'L1' as const, durSec: 10, status: 'pending' as const, form: 'full' as const };
    const s = orderSummaryText(
      [
        { ...it0, id: 'c', kind: 'stageCover', refId: 'L1', at: 0, variant: 'lesson' },
        { ...it0, id: 'r1', kind: 'round', refId: '1', round: 1, at: 10 },
        { ...it0, id: 'l', kind: 'letter', refId: 'S1', at: 15 },
        { ...it0, id: 'r2', kind: 'round', refId: '2', round: 2, at: 20 },
        { ...it0, id: 'e', kind: 'event', refId: 'L1-E2', at: 25, form: 'dropped' },
        { ...it0, id: 'w', kind: 'worksheet', refId: 'W01', refIds: ['W01', 'W02'], at: 30, placement: 'stageEnd' },
      ],
      'lesson',
    );
    expect(s).toBe('차시 표지 → 라운드 1~2 → 학습지 ①② → 마무리');
  });
  it('단원 한 판은 "1차시 표지"처럼 차시 이름(L1을 박지 않음)', () => {
    const s = orderSummaryOf({ ...defaultSetup(), playUnit: 'unit', tradeMinutes: 25 })!;
    expect(s.startsWith('1차시 표지')).toBe(true);
    expect(s).not.toMatch(/\bL[1-4]\b/);
  });
});

// ───────────────────────────── 판 설정 렌더 ─────────────────────────────

function roomsStore() {
  return new ServerRoomsStore({
    read: async () => ({ kind: 'ok', rooms: 3, maxRooms: 50 }) as RoomStatus,
    visibility: null,
    random: () => 0.5,
    setTimer: () => 1,
    clearTimer: () => undefined,
  });
}

async function mountSetup(values: SetupValues) {
  await act(async () => {
    render(
      <SetupContainer
        values={values}
        onChange={() => undefined}
        opening={false}
        openError={null}
        onOpen={() => undefined}
        onBack={() => undefined}
        roomsStore={roomsStore()}
        prefsStorage={new MemStorage()}
      />,
      dom.root as unknown as Element,
    );
  });
  await act(async () => undefined);
}

/** 기능 플래그를 개발용 열쇠로 켠다(FULL_UNIT_READY=true 와 같은 길 — setup.ts fullUnitReady) */
function withFullUnit(on: boolean): () => void {
  const g = globalThis as Record<string, unknown>;
  const prev = g.localStorage;
  const mem = new MemStorage();
  if (on) mem.setItem(DEV_FULL_UNIT_KEY, '1');
  g.localStorage = mem;
  return () => {
    g.localStorage = prev;
  };
}

describe('판 설정 정리(PRD 7.5.2.3·7.5.2.5)', () => {
  const L1: SetupValues = { ...defaultSetup(), playUnit: 'lesson', lesson: 'L1', tradeMinutes: 10 };

  for (const flag of [false, true]) {
    it(`FULL_UNIT_READY ${flag ? '켜짐' : '꺼짐'}: 기본 4가지만 밖, 나머지는 [고급 설정](접힘) 안`, async () => {
      const restore = withFullUnit(flag);
      try {
        await mountSetup(L1);
        const adv = byId(dom.root, 'setup-advanced')!;
        expect(adv.localName).toBe('details');
        expect(adv.hasAttribute('open')).toBe(false); // 접힘 기본
        // 밖: 판 단위·차시·무역 시간·학급 이름
        for (const id of ['unit-lesson', 'unit-unit', 'lesson-L1', 'trade-minutes', 'trade-minutes-custom', 'class-name']) {
          expect(byId(dom.root, id), id).toBeDefined();
          expect(inside(adv, id), id).toBe(false);
        }
        // 안: 나머지 전부
        for (const id of ['worksheet-mode', 'activity-ratio', 'incident-freq', 'comeback', 'top-n', 'progress-mode', 'custom-scope']) {
          expect(inside(adv, id), id).toBe(true);
        }
        // 기본값 그대로(진행 방식 자동)
        const auto = byId(dom.root, 'progress-mode')!.find((el) => el.getAttribute('data-value') === 'auto')[0];
        expect(auto?.getAttribute('aria-pressed')).toBe('true');
        // 쉬운 말
        expect(text(byId(dom.root, 'progress-mode'))).toContain('시간 맞춰 저절로 넘어가기');
        expect(text(byId(dom.root, 'progress-mode'))).toContain('선생님이 하나씩 넘기기');
        expect(text(byId(dom.root, 'worksheet-mode'))).toContain('활동마다 바로');
        expect(text(byId(dom.root, 'worksheet-mode'))).toContain('차시 끝에 모아서');
        expect(text(byId(dom.root, 'worksheet-mode'))).toContain('게임 끝나고');
        expect(text(byId(dom.root, 'worksheet-mode'))).toContain('학습지 안 씀');
        expect(text(byId(dom.root, 'activity-ratio'))).toBe('활동 비중거래 시간 많이반반활동 많이');
        expect(text(byId(dom.root, 'lesson-L1'))).toContain('1차시 (L1)');
        // 미리보기: 오늘 순서·예상 시간·이 차시 학습지, 활동 표는 [활동 직접 고치기](접힘) 안
        expect(text(byId(dom.root, 'preview-order'))).toContain('차시 표지 → ');
        expect(byId(dom.root, 'expected-time')).toBeDefined();
        expect(text(byId(dom.root, 'preview-worksheets'))).toContain('이 차시 학습지');
        const actsBox = byId(dom.root, 'preview-activities-toggle')!;
        expect(actsBox.localName).toBe('details');
        expect(actsBox.hasAttribute('open')).toBe(false);
        expect(inside(actsBox, 'preview-activities')).toBe(true);
        const tiers = actsBox.find((el) => el.hasClass('t-tier')).map((el) => el.textContent);
        expect(tiers.length).toBeGreaterThan(0);
        for (const t of tiers) expect(['꼭 할 활동', '하면 좋은 활동', '시간 나면 하는 활동']).toContain(t);
        expect(text(dom.root as unknown as FakeElement)).not.toMatch(/[123]등급/);
        // 단원 카드: 꺼짐이면 준비 중 + 이유, 켜짐이면 고를 수 있음
        const unit = byId(dom.root, 'unit-unit')!;
        if (flag) {
          expect(unit.hasAttribute('disabled')).toBe(false);
          expect(byId(dom.root, 'unit-soon')).toBeUndefined();
          for (const l of ['L2', 'L3', 'L4']) expect(byId(dom.root, `lesson-${l}`)).toBeDefined();
        } else {
          expect(unit.hasAttribute('disabled')).toBe(true);
          expect(text(byId(dom.root, 'unit-soon'))).toBe(NOT_READY_TEXT);
        }
      } finally {
        restore();
      }
    });
  }

  it('플래그 켜짐 + 단원 한 판: 미리보기·학습지(학생용 전체 강조) 문구에 L1을 박지 않음', async () => {
    const restore = withFullUnit(true);
    try {
      await mountSetup({ ...defaultSetup(), playUnit: 'unit', tradeMinutes: 25 });
      expect(byId(dom.root, 'preview')).toBeDefined();
      expect(text(byId(dom.root, 'preview-order'))).toMatch(/^오늘 순서 1차시 표지 → /);
      expect(text(byId(dom.root, 'unit-note'))).toContain('1~4차시');
      const facts = text(byId(dom.root, 'preview-facts'));
      expect(facts).toContain('학습지 넣는 때');
      expect(facts).not.toMatch(/\bL[1-4]\b/);
      expect(text(byId(dom.root, 'preview-worksheets'))).toContain('학습지');
    } finally {
      restore();
    }
  });

  it('판 단위를 고르기 전에는 [고급 설정] 안의 설정도 비활성(연속 구간 고르기는 됨)', async () => {
    await mountSetup(defaultSetup());
    expect(byId(dom.root, 'setup-rest')?.getAttribute('aria-disabled')).toBe('true');
    expect(byId(dom.root, 'setup-adv-rest')?.getAttribute('aria-disabled')).toBe('true');
    expect(inside(byId(dom.root, 'setup-adv-rest'), 'custom-scope')).toBe(false);
  });
});

// ───────────────────────────── 시작 화면 3단계 상자 ─────────────────────────────

describe("교사 시작 화면 '수업 준비 3단계'(PRD 7.5.2.4)", () => {
  it('처음엔 펼침, 접으면 기억(학생 정보 없음)', () => {
    const st = new MemStorage();
    expect(guideOpenInitially(st)).toBe(true);
    rememberGuide(false, st);
    expect(st.getItem(GUIDE_KEY)).toBe('closed');
    expect(guideOpenInitially(st)).toBe(false);
    rememberGuide(true, st);
    expect(guideOpenInitially(st)).toBe(true);
  });

  it('상자: 3단계 + 1단계에 [학습지 열기 ▾]', () => {
    act(() => render(<PrepGuide storage={new MemStorage()} />, dom.root as unknown as Element));
    const box = byId(dom.root, 'start-guide')!;
    expect(box.localName).toBe('details');
    expect(box.hasAttribute('open')).toBe(true);
    expect(text(box)).toContain('처음이세요? 수업 준비 3단계');
    expect(inside(byId(dom.root, 'guide-step-1'), 'worksheet-pdf-menu')).toBe(true);
    expect(text(byId(dom.root, 'guide-step-2'))).toContain('[새 판 열기]');
    expect(text(byId(dom.root, 'guide-step-3'))).toContain('방 코드');
    const st = new MemStorage();
    st.setItem(GUIDE_KEY, 'closed');
    act(() => render(null, dom.root as unknown as Element));
    act(() => render(<PrepGuide storage={st} />, dom.root as unknown as Element));
    expect(byId(dom.root, 'start-guide')!.hasAttribute('open')).toBe(false);
  });
});
