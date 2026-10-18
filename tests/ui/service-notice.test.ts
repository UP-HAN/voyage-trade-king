import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_CONTACT,
  INSTALL_GUIDE_DEFAULT,
  SERVICE_CREDIT,
  SERVICE_NOTICE_FULL,
  SERVICE_NOTICE_SHORT,
  buildServiceNotice,
  splitLinks,
} from '../../src/ui/common/service-notice';
import {
  isSafeLink,
  loadConfigJson,
  parseDisplayConfig,
  parseServerInfo,
  parseServiceNoticeOverride,
  resetConfigJsonCache,
} from '../../src/config/deploy';

// ── PRD 10.12.1(v0.3.4)에서 그대로 복사(굵게 표시 ** 만 뺌) ──
const PRD_SHORT =
  '이 게임 서버는 교사 한 사람이 개인적으로 운영하는 무료 서버예요. 예고 없이 점검하거나 멈출 수 있어요. 학생 실명은 받지 않고, 학생 정보는 서버에 저장하지 않아요.';
const PRD_ITEMS = [
  '이 서버는 초등학교 교사 한 사람이 개인 비용으로 운영하는 무료 서버입니다. 학교·교육청·회사가 운영하는 서비스가 아닙니다.',
  '서버 사정에 따라 예고 없이 점검하거나 멈출 수 있고, 운영을 끝낼 수도 있습니다. 늘 쓸 수 있다고 약속드리지 못합니다. 중요한 수업에는 종이 학습지·교과서 활동을 함께 준비해 주세요. 미리 정한 점검은 화면 맨 위 띠로 알려 드립니다.',
  "서버 전체에서 동시에 열 수 있는 방은 {maxRooms}개, 같은 학교(같은 인터넷 주소)에서는 10개까지입니다. 가득 차면 방이 빌 때까지 새 방을 열 수 없습니다. 선생님 시작 화면과 판 설정의 [방 열기] 위 '사용 중인 방'에서 확인할 수 있습니다.",
  '학생 실명을 받지 않습니다. 학생은 출석번호와 스스로 지은 회사 이름만 입력합니다. 회사 이름에 실제 이름·전화번호를 쓰지 않도록 지도해 주세요. 출석번호는 선생님 화면에만 보입니다.',
  '서버는 학생 정보를 저장하지 않습니다. 수업 중 메시지를 전달만 하고, 서버 기록에도 출석번호·회사 이름이 남지 않습니다. 접속 제한을 위해 인터넷 주소(IP)를 서버 메모리에 잠시(최대 1시간) 두었다가 지웁니다.',
  '게임 기록은 선생님 PC 브라우저와 학생 기기에만 있다가 24시간 뒤 자동으로 지워집니다. [결과 파일 저장]을 누른 경우에만 선생님 PC에 파일이 남습니다.',
  '게임 속 가격·뉴스·사건은 수업을 위해 지어낸 것입니다. 교과서 내용은 쪽수를 밝혀 수업에 필요한 만큼만 인용했습니다.',
  '자주 쓰신다면 같은 프로그램을 학교 서버에 직접 설치해 쓰실 수 있습니다(설치 안내: 공개 저장소 README — https://github.com/UP-HAN/voyage-trade-king).',
];

const PRD_CONTACT = '문의: GitHub 저장소(github.com/UP-HAN/voyage-trade-king)';
const PRD_CREDIT = 'Copyright 2026. hanuipyo';
const withMax = (items: string[], m: string) => items.map((t) => t.replace('{maxRooms}개', m));

describe('기본 문구 = PRD 10.12.1', () => {
  it('한 줄(복사본과 글자 그대로)', () => {
    expect(SERVICE_NOTICE_SHORT).toBe(PRD_SHORT);
    expect(buildServiceNotice({ maxRooms: 50 }).short).toBe(PRD_SHORT);
  });

  it('전문 1~9(복사본과 글자 그대로, maxRooms 50 — 9번은 기본 문의)', () => {
    const n = buildServiceNotice({ maxRooms: 50 });
    expect(n.full.title).toBe('이용 안내');
    expect(n.full.items).toEqual([...withMax(PRD_ITEMS, '50개'), PRD_CONTACT]);
    expect(n.full.items).toHaveLength(9);
  });

  it('저작권·문의 줄(credit)은 늘 같고 링크가 아니다', () => {
    expect(SERVICE_CREDIT).toBe(PRD_CREDIT);
    expect(DEFAULT_CONTACT).toBe('GitHub 저장소(github.com/UP-HAN/voyage-trade-king)');
    for (const serverInfo of [undefined, null, {}, { operator: '홍길동', contact: 'https://example.org/q' }]) {
      const n = buildServiceNotice({ maxRooms: 50, serverInfo });
      expect(n.credit).toBe(PRD_CREDIT);
      expect(n.links.some((l) => /hanuipyo|UP-HAN/i.test(l))).toBe(false);
    }
  });

  it('PRD 파일의 10.12.1 본문과도 같다(문서가 바뀌면 이 테스트가 알린다)', () => {
    const prd = readFileSync(join(__dirname, '../../docs/PRD.md'), 'utf8');
    const sec = prd.slice(prd.indexOf('#### 10.12.1'), prd.indexOf('#### 10.12.2'));
    const quoted = sec
      .split('\n')
      .filter((l) => l.trim().startsWith('>'))
      .map((l) => l.trim().replace(/^>\s*/, '').replace(/\*\*/g, ''));
    expect(quoted[0]).toBe(`${SERVICE_NOTICE_SHORT} [이용 안내]`);
    expect(quoted[1]).toBe(SERVICE_NOTICE_FULL.title);
    const items = quoted.slice(2, 10).map((l) => l.replace(/^\d+\.\s*/, ''));
    expect(items).toEqual(SERVICE_NOTICE_FULL.items.map((t) => t.replace('{install}', INSTALL_GUIDE_DEFAULT)));
    expect(quoted[10]).toBe(`9. ${PRD_CONTACT}`);
    // 둘째 줄(저작권·문의)은 인용이 아니라 목록 줄 — 본문에 글자 그대로 들어 있다
    expect(sec).toContain('`' + SERVICE_CREDIT + '`');
  });

  it('teacher-setup.md 0.1의 1~9와 같다(maxRooms 50, 9번 = 기본 문의)', () => {
    const doc = readFileSync(join(__dirname, '../../docs/teacher-setup.md'), 'utf8');
    const sec = doc.slice(doc.indexOf('### 0.1'), doc.indexOf('### 0.2'));
    const items = sec
      .split('\n')
      .filter((l) => /^[1-9]\.\s/.test(l))
      .map((l) => l.replace(/^\d+\.\s*/, '').replace(/\*\*/g, ''));
    expect(items).toHaveLength(9);
    expect(items[8]).toBe(PRD_CONTACT);
    expect(items).toEqual(buildServiceNotice({ maxRooms: 50 }).full.items);
    expect(sec).toContain(SERVICE_CREDIT);
  });
});

describe('채울 자리', () => {
  it('maxRooms를 응답 값으로 채운다', () => {
    expect(buildServiceNotice({ maxRooms: 30 }).full.items[2]).toContain('방은 30개, 같은 학교');
  });
  it.each([undefined, null, 0, -3, 2.5])('maxRooms=%s → "정해진 수"', (m) => {
    const t = buildServiceNotice({ maxRooms: m as number | undefined }).full.items[2];
    expect(t).toContain('동시에 열 수 있는 방은 정해진 수, 같은 학교');
    expect(t).not.toContain('{maxRooms}');
  });

  it('문의처 없음(serverInfo 없음) → 한 줄에는 붙이지 않고, 9번은 기본 문의 GitHub 저장소', () => {
    for (const serverInfo of [undefined, null, {}]) {
      const n = buildServiceNotice({ maxRooms: 50, serverInfo });
      expect(n.short).toBe(PRD_SHORT);
      expect(n.short).not.toContain('문의');
      expect(n.full.items).toHaveLength(9);
      expect(n.full.items[8]).toBe(PRD_CONTACT);
      expect(n.full.items.slice(0, 8).join('\n')).not.toContain('문의');
      expect(n.links).toEqual([]);
    }
  });

  it('문의처 있음 → 한 줄 끝과 9번 항목 둘 다', () => {
    const n = buildServiceNotice({
      maxRooms: 50,
      serverInfo: { operator: '○○초 홍길동', contact: 'mailto:teacher@example.org' },
    });
    expect(n.short).toBe(`${PRD_SHORT} · 문의: ○○초 홍길동 mailto:teacher@example.org`);
    expect(n.full.items).toHaveLength(9);
    expect(n.full.items[8]).toBe('문의: ○○초 홍길동 · mailto:teacher@example.org');
    expect(n.links).toEqual(['mailto:teacher@example.org']);
  });

  it('운영자만·연락처만 있어도 그 값만 보인다', () => {
    expect(buildServiceNotice({ serverInfo: { operator: '홍길동' } }).full.items[8]).toBe('문의: 홍길동');
    const c = buildServiceNotice({ serverInfo: { contact: '학교 교무실 031-000-0000' } });
    expect(c.short.endsWith(' · 문의: 학교 교무실 031-000-0000')).toBe(true);
    expect(c.links).toEqual([]); // https·mailto가 아니면 링크 아님
  });

  it('repoUrl이 있으면 8번이 "설치 안내: <링크>"', () => {
    const n = buildServiceNotice({ maxRooms: 50, serverInfo: { repoUrl: 'https://github.com/example/voyage' } });
    expect(n.full.items[7]).toBe(
      '자주 쓰신다면 같은 프로그램을 학교 서버에 직접 설치해 쓰실 수 있습니다(설치 안내: https://github.com/example/voyage).',
    );
    expect(n.links).toContain('https://github.com/example/voyage');
    expect(n.full.items).toHaveLength(9);
    expect(n.full.items[8]).toBe(PRD_CONTACT); // repoUrl만으로는 문의가 바뀌지 않음
  });
});

describe('덮어쓰기(config.json serviceNotice)', () => {
  it('short·items를 그 값으로', () => {
    const n = buildServiceNotice({
      maxRooms: 20,
      override: { short: '우리 학교 서버예요.', items: ['첫째 안내', '방은 {maxRooms}개까지'] },
    });
    expect(n.short).toBe('우리 학교 서버예요.');
    expect(n.full.items).toEqual(['첫째 안내', '방은 20개까지', PRD_CONTACT]);
  });
  it('items 없이 short만 덮어써도 전문은 기본', () => {
    const n = buildServiceNotice({ maxRooms: 50, override: { short: '짧게' } });
    expect(n.full.items).toEqual([...withMax(PRD_ITEMS, '50개'), PRD_CONTACT]);
  });
  it('덮어쓴 경우에도 문의처가 있으면 뒤에 붙는다', () => {
    const n = buildServiceNotice({ override: { short: '짧게', items: ['하나'] }, serverInfo: { operator: '홍길동' } });
    expect(n.short).toBe('짧게 · 문의: 홍길동');
    expect(n.full.items).toEqual(['하나', '문의: 홍길동']);
  });
});

describe('config.json 읽기 — 형식·길이 검사', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetConfigJsonCache();
  });

  it('serverInfo 정상', () => {
    expect(parseServerInfo({ serverInfo: { operator: '홍길동', contact: 'https://example.org/q', repoUrl: 'https://github.com/a/b' } })).toEqual({
      operator: '홍길동',
      contact: 'https://example.org/q',
      repoUrl: 'https://github.com/a/b',
    });
    expect(parseServerInfo({})).toBeNull();
    expect(parseServerInfo(null)).toBeNull();
    expect(parseServerInfo({ serverInfo: { operator: '  ' } })).toBeNull();
  });

  it('길이 초과·형식 오류는 무시 + 경고', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseServerInfo({ serverInfo: { operator: 'x'.repeat(31), contact: 'ok' } })).toEqual({ contact: 'ok' });
    expect(parseServerInfo({ serverInfo: { contact: 'x'.repeat(81) } })).toBeNull();
    expect(parseServerInfo({ serverInfo: { repoUrl: 'https://' + 'x'.repeat(200) } })).toBeNull();
    expect(parseServerInfo({ serverInfo: { operator: 123 } })).toBeNull();
    expect(parseServerInfo({ serverInfo: 'abc' })).toBeNull();
    expect(parseServiceNoticeOverride({ serviceNotice: { short: 'x'.repeat(201) } })).toBeNull();
    expect(parseServiceNoticeOverride({ serviceNotice: { items: Array(13).fill('a') } })).toBeNull();
    expect(parseServiceNoticeOverride({ serviceNotice: { items: ['ok', 'x'.repeat(201)] } })).toBeNull();
    expect(parseServiceNoticeOverride({ serviceNotice: { items: ['ok', 3] } })).toBeNull();
    expect(parseServiceNoticeOverride({ serviceNotice: { items: Array(12).fill('a'), short: 's' } })).toEqual({
      short: 's',
      items: Array(12).fill('a'),
    });
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.length).toBeGreaterThanOrEqual(9);
  });

  it('display.titleRoomCount(v0.3.4 기본 숨김 — true일 때만 타이틀에 보임)', () => {
    // 타이틀 판정식(src/title/index.tsx): parseDisplayConfig(raw).titleRoomCount === true
    const shows = (raw: unknown) => parseDisplayConfig(raw).titleRoomCount === true;
    expect(shows(null)).toBe(false);
    expect(shows({})).toBe(false);
    expect(shows({ display: {} })).toBe(false);
    expect(shows({ display: { titleRoomCount: false } })).toBe(false);
    expect(shows({ display: { titleRoomCount: true } })).toBe(true);
    const title = readFileSync(join(__dirname, '../../src/title/index.tsx'), 'utf8');
    expect(title).toContain('parseDisplayConfig(raw).titleRoomCount === true');
    expect(parseDisplayConfig(null)).toEqual({});
    expect(parseDisplayConfig({})).toEqual({});
    expect(parseDisplayConfig({ display: { titleRoomCount: false } })).toEqual({ titleRoomCount: false });
    expect(parseDisplayConfig({ display: { titleRoomCount: true } })).toEqual({ titleRoomCount: true });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseDisplayConfig({ display: { titleRoomCount: 'no' } })).toEqual({});
  });

  it('loadConfigJson은 한 번만 읽고 실패하면 null', async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => ({ serverInfo: { operator: 'A' } }) }) as unknown as Response);
    const a = await loadConfigJson('https://lab.ches.es.kr/voyage/#/', f as unknown as typeof fetch);
    const b = await loadConfigJson('https://lab.ches.es.kr/voyage/#/', f as unknown as typeof fetch);
    expect(a).toEqual({ serverInfo: { operator: 'A' } });
    expect(b).toBe(a);
    expect(f).toHaveBeenCalledTimes(1);
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe('https://lab.ches.es.kr/voyage/config.json');
    resetConfigJsonCache();
    const g = vi.fn(async () => ({ ok: false, json: async () => ({}) }) as unknown as Response);
    expect(await loadConfigJson('https://x.example/', g as unknown as typeof fetch)).toBeNull();
  });
});

describe('HTML로 해석하지 않음', () => {
  it('HTML 문자열은 글자 그대로 남고 링크가 되지 않는다', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const n = buildServiceNotice({ serverInfo: { operator: evil, contact: 'javascript:alert(1)' } });
    expect(n.short).toContain(evil);
    expect(n.full.items[8]).toBe(`문의: ${evil} · javascript:alert(1)`);
    expect(n.links).toEqual([]);
    expect(splitLinks(n.full.items[8], n.links)).toEqual([{ text: n.full.items[8] }]);
  });

  it('링크는 https://·mailto: 만', () => {
    expect(isSafeLink('https://a.example')).toBe(true);
    expect(isSafeLink('mailto:a@b.example')).toBe(true);
    expect(isSafeLink('http://a.example')).toBe(false);
    expect(isSafeLink('javascript:alert(1)')).toBe(false);
    expect(isSafeLink(' https://a.example')).toBe(false);
    expect(isSafeLink('data:text/html,hi')).toBe(false);
  });

  it('splitLinks — 허락된 부분만 링크 조각', () => {
    expect(splitLinks('문의: 홍 · https://a.example/x 끝', ['https://a.example/x'])).toEqual([
      { text: '문의: 홍 · ' },
      { text: 'https://a.example/x', href: 'https://a.example/x' },
      { text: ' 끝' },
    ]);
  });

  it('화면 코드에 innerHTML·dangerouslySetInnerHTML이 없다', () => {
    for (const f of ['ServiceFooter.tsx', 'RoomCount.tsx', 'service-notice.ts', 'server-status.ts']) {
      const src = readFileSync(join(__dirname, '../../src/ui/common', f), 'utf8');
      expect(src).not.toMatch(/innerHTML|dangerouslySetInnerHTML/);
    }
  });
});
