import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nameFilter } from '../../src/data/name-filter';
import { hasBadWord, nameKey, normalizeCompanyName, validateCompanyName } from '../../src/sync/company-name';

describe('회사 이름 정리·비교 키', () => {
  it('앞뒤 공백 제거, 가운데 공백 1칸, NFC', () => {
    expect(normalizeCompanyName('  해오름   무역 ')).toBe('해오름 무역');
    // 조합형(NFD) 한글도 완성형으로
    expect(normalizeCompanyName('해오름'.normalize('NFD'))).toBe('해오름');
  });
  it('비교 키: 공백 제거 + 영문 소문자', () => {
    expect(nameKey('해오름 무역')).toBe(nameKey('해오름무역'));
    expect(nameKey('Sea Star')).toBe('seastar');
  });
});

describe('validateCompanyName (PRD 6.1.1)', () => {
  it('길이: 1자·11자 → NAME_FORMAT, 2자·10자 → 통과', () => {
    expect(validateCompanyName('해')).toEqual({ ok: false, error: 'NAME_FORMAT' });
    expect(validateCompanyName('가나다라마바사아자차카')).toEqual({ ok: false, error: 'NAME_FORMAT' });
    expect(validateCompanyName('해달').ok).toBe(true);
    expect(validateCompanyName('가나다라마바사아자차').ok).toBe(true);
  });
  it('자모 단독·이모지·기호 → NAME_FORMAT', () => {
    expect(validateCompanyName('ㅋㅋ무역')).toEqual({ ok: false, error: 'NAME_FORMAT' });
    expect(validateCompanyName('해오름🚢')).toEqual({ ok: false, error: 'NAME_FORMAT' });
    expect(validateCompanyName('해오름!무역')).toEqual({ ok: false, error: 'NAME_FORMAT' });
  });
  it('중복: "해오름 무역" vs "해오름무역" → NAME_TAKEN + 제안 2개(10자 이내, 겹치지 않음)', () => {
    const r = validateCompanyName('해오름 무역', { takenKeys: [nameKey('해오름무역'), nameKey('해오름 무역2')] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('NAME_TAKEN');
    expect(r.suggestions).toHaveLength(2);
    for (const s of r.suggestions ?? []) {
      expect([...s].length).toBeLessThanOrEqual(10);
      expect(nameKey(s)).not.toBe(nameKey('해오름무역2'));
      expect(validateCompanyName(s, { takenKeys: [nameKey('해오름무역')] }).ok).toBe(true);
    }
    expect(r.suggestions).toEqual(['해오름 무역3', '해오름 무역4']);
  });
  it('10자 이름이 겹치면 제안 없이 NAME_TAKEN', () => {
    const r = validateCompanyName('가나다라마바사아자차', { takenKeys: [nameKey('가나다라마바사아자차')] });
    expect(r).toEqual({ ok: false, error: 'NAME_TAKEN' });
  });
  it('금칙어와 글자 사이에 숫자·영문을 끼운 변형 → BAD_NAME', () => {
    expect(validateCompanyName('바보무역')).toEqual({ ok: false, error: 'BAD_NAME' });
    expect(validateCompanyName('바1보무역')).toEqual({ ok: false, error: 'BAD_NAME' });
    expect(validateCompanyName('바 a 보 상사')).toEqual({ ok: false, error: 'BAD_NAME' });
    expect(validateCompanyName('STUPID 상사')).toEqual({ ok: false, error: 'BAD_NAME' });
  });
  it('교사 추가 금칙어·이 판에서 막힌 이름 → BAD_NAME', () => {
    expect(validateCompanyName('고등어무역', { extraWords: ['고등어'] })).toEqual({ ok: false, error: 'BAD_NAME' });
    expect(validateCompanyName('해 오름', { bannedKeys: [nameKey('해오름')] })).toEqual({ ok: false, error: 'BAD_NAME' });
  });
  it('개인정보 형태 → BAD_NAME', () => {
    expect(validateCompanyName('0101234무역')).toEqual({ ok: false, error: 'BAD_NAME' });
    expect(validateCompanyName('무역 2013')).toEqual({ ok: false, error: 'BAD_NAME' });
    expect(validateCompanyName('www상사')).toEqual({ ok: false, error: 'BAD_NAME' });
    expect(validateCompanyName('a@b.kr')).toEqual({ ok: false, error: 'BAD_NAME' });
    expect(validateCompanyName('해오름123').ok).toBe(true);
  });
  it('실명처럼 보이는 이름: "김민수" → ok + realNameHint, "김밥무역" → 힌트 없음', () => {
    expect(validateCompanyName('김민수')).toEqual({ ok: true, name: '김민수', key: '김민수', realNameHint: true });
    expect(validateCompanyName('김밥무역')).toMatchObject({ ok: true, realNameHint: false });
    expect(validateCompanyName('바다사랑')).toMatchObject({ ok: true, realNameHint: false });
    expect(validateCompanyName('이순신호')).toMatchObject({ ok: true, realNameHint: false });
  });
  it('평범한 이름은 통과(금칙어가 잘못 걸리지 않음)', () => {
    for (const n of ['해오름무역', '바다상사', '무지개새 해운', '푸른별 물산', 'Sea Star', '씨앗상회', '새끼줄 상점', '스킬무역']) {
      expect(validateCompanyName(n).ok, n).toBe(true);
    }
  });
  it('(작업 132 수정 2회차·134) 오탐 예외는 허용 조합(햇살·화살·물살·눈살 + 해운·해상)뿐', () => {
    const pass = [
      '햇살해운', '햇살 해운', '화살해운', '물살해상', '눈살해운',
      '바다무역', '별빛해운', '시원상사', '해오름무역', '고래해운', '사랑해운', '자장면상회', '자전거무역', '자유무역', '해님상사',
      '해바라기무역', '해돋이상회', '살구무역', '살림상사', '시바견무역', '바다해운', '푸른별 물산', '씨앗상회',
    ];
    for (const n of pass) expect(validateCompanyName(n).ok, n).toBe(true);
    const blocked = [
      '살해무역', '살해해운', '바보해운', '자살해운', '햇살바보', '시발무역', '씨발점', '해운바보', '살1해상사', '살해상사',
      '선생님살해운', '엄마살해운송', '친구살해운', '너살해운', '선생님살해님', '친구살해돋이', '바다살해운',
      '아자지', '아자지무역', '친구아자지', '아자살', '아자살무역', '아자해', '아자해운',
      '햇살인', '햇살인마', '화살인', '물살인', '눈살인무역', '친구햇살인마',
      '친구햇살해', '선생님화살해', '햇살해', '햇살해적', '햇살해돋이',
      // (작업 134) 시발점 예외 삭제·해님 삭제·금칙어 보강(확실하지 않으면 막는다)
      '시발점무역', '아시발점', '시발점시발점', '엄마시발점', '시발점', '선생님햇살해님', '햇살해님', '햇살해님상사', '화살해님',
      '죽어해운', '죽어', '시이발', '시이발무역', '씨이발상사', '바아보해운', 'sh1t', 'sh1t무역', 'Sh1t', 'b1tch', '5ex무역',
    ];
    for (const n of blocked) expect(validateCompanyName(n), n).toEqual({ ok: false, error: 'BAD_NAME' });
    // 교사가 더한 금칙어는 예외 없이 막는다
    expect(validateCompanyName('햇살해운', { extraWords: ['살해'] })).toEqual({ ok: false, error: 'BAD_NAME' });
  });

  const c = nameFilter.categories;
  const BAD = [...c.profanity, ...c.slur, ...c.sexual, ...c.violence, ...c.teasing].filter((w) => /[가-힣]/u.test(w));
  const JOINS = nameFilter.allowJoins ?? [];
  /** 이 이름이 허용 조합 구절(앞 낱말 + 다음 낱말)을 품고 있나 */
  const hasJoinPhrase = (n: string) => JOINS.some((j) => j.next.some((x) => n.includes(j.word + x)));

  it('(작업 132 수정 2회차) 겹침 조합 자동 생성: 허용 조합 목록에 있는 것만 통과', () => {
    const words = [...new Set([...JOINS.map((j) => j.word), ...(nameFilter.allowWords ?? []), '아자', '바다', '구름', '해오름'])];
    const fronts = ['', '친구', '선생님', '바다'];
    const tails = ['', '운', '상', '님', '운송', '님상사', '돋이', '적', '무역', '해운', '인', '마', '1', '상사'];
    const wrong: string[] = [];
    let made = 0;
    for (const w of words) {
      for (const b of BAD) {
        for (let k = 1; k <= 2; k++) {
          if (k >= b.length || !w.endsWith(b.slice(0, k))) continue;
          for (const f of fronts) {
            for (const t of tails) {
              const n = `${f}${w}${b.slice(k)}${t}`;
              made++;
              // 기대: 허용 조합의 금칙어(살해)이고, 이름이 그 조합 구절(예: 햇살해운)을 품을 때만 통과
              const expectPass = JOINS.some((j) => j.word === w && j.bad === b) && hasJoinPhrase(n);
              if (hasBadWord(n) === expectPass) wrong.push(`${n}(${expectPass ? '통과해야' : '막혀야'})`);
            }
          }
        }
      }
    }
    expect(made).toBeGreaterThan(100);
    expect(wrong).toEqual([]);
  }, 60_000);

  it('(작업 132 수정 2회차·134) 124 기준(단순 부분 일치)보다 덜 막는 이름은 허용 조합뿐', () => {
    const key = (n: string) => n.replace(/[^가-힣a-z0-9]/gu, '');
    const base124 = (n: string) => BAD.some((b) => key(n).includes(b) || key(n).replace(/[a-z0-9]/gu, '').includes(b));
    const fronts = ['', '친구', '선생님', '너', '아', '해', '햇', '시', '점', '화', '물', '눈', '바다', '아자', '햇살', '시발점'];
    const tails = ['', ...nameFilter.companyWords, '님', '돋이', '점', '해', '인', '아', '자', '1', '햇살', '시발점', '해운', '해님'];
    const loosened: string[] = [];
    for (const b of BAD) for (const f of fronts) for (const t of tails) {
      const n = `${f}${b}${t}`;
      if (base124(n) && !hasBadWord(n)) loosened.push(n);
    }
    // 겹침으로 만든 이름(앞 낱말 끝 + 금칙어 뒷부분)도 더한다
    for (const j of JOINS) for (const x of [...j.next, '', '적', '인']) for (const f of ['', '친구']) {
      const n = `${f}${j.word}${x}`;
      if (base124(n) && !hasBadWord(n)) loosened.push(n);
    }
    const unexplained = loosened.filter((n) => !hasJoinPhrase(n));
    expect(unexplained).toEqual([]);
  }, 60_000);

  it('(작업 134) 정상 이름 70개는 오탐 없이 통과(늘여 쓴 변형·숫자 바꿔 쓰기 검사 추가 뒤에도)', () => {
    const NORMAL = [
      '해오름무역', '바다상사', '무지개새 해운', '푸른별 물산', 'Sea Star', '씨앗상회', '새끼줄 상점', '스킬무역', '햇살해운', '햇살 해운',
      '화살해운', '물살해상', '눈살해운', '바다무역', '별빛해운', '시원상사', '고래해운', '사랑해운', '자장면상회', '자전거무역',
      '자유무역', '해님상사', '해바라기무역', '해돋이상회', '살구무역', '살림상사', '시바견무역', '바다해운', 'Sea무역', '해오름2',
      '김밥무역', '바다사랑', '이순신호', '해오름123', '은하수상단', '푸른바다호', '황금돛상회', '파도타기무역', '고래상어해운', '별바다물산',
      '미래무역', '하늘상사', '나비무역', '토끼상회', '거북선해운', '무궁화상사', '진주무역', '동해물산', '서해상선', '남해교역',
      '북극성호', '태양무역', '달빛상회', '구름해운', '산들바람상사', '이음무역', '모두의상점', '꿈나무유통', '희망기업', '반짝산업',
      '오션트레이딩', 'Blue Ocean', 'Star Trade', 'Sunrise', 'Happy Ship', 'Win7', '해피무역', '미어캣상사', '아이리스무역', '피아노상회',
    ];
    expect(NORMAL.length).toBe(70);
    const blocked = NORMAL.filter((n) => !validateCompanyName(n).ok);
    expect(blocked).toEqual([]);
  });

  it('금칙어 데이터: 분류마다 10~40개', () => {
    for (const [k, list] of Object.entries(nameFilter.categories)) {
      expect(list.length, k).toBeGreaterThanOrEqual(10);
      expect(list.length, k).toBeLessThanOrEqual(40);
    }
    expect(nameFilter.commonSurnames.length).toBeGreaterThanOrEqual(25);
  });
});

describe('세션 파일은 src/core를 import하지 않는다', () => {
  it('grep', () => {
    const root = join(__dirname, '../../src');
    const files = [
      ...readdirSync(join(root, 'sync'))
        .filter((f) => f.endsWith('.ts'))
        .map((f) => join(root, 'sync', f)),
      join(root, 'data', 'name-filter.ts'),
    ];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect(/from\s+['"][^'"]*core\//.test(src), f).toBe(false);
    }
  });
});
