/**
 * 화면 하단 이용 안내 문구 — 이 파일이 **유일한 출처**다(PRD 10.12.1, docs/teacher-setup.md 0.1).
 * 문구는 PRD 10.12.1(v0.3.4 교사 승인)을 글자 그대로 옮겼다(굵게 표시 `**`만 뺌). 문구를 바꾸려면 PRD와 teacher-setup.md 0장을 함께 고친다.
 *
 * 채울 자리
 * - `{maxRooms}개` — `/health`의 `maxRooms`. 못 읽으면 그 구절을 "정해진 수"로 바꾼다.
 * - 문의 — `config.json`의 `serverInfo`(다른 운영자)가 있으면 한 줄 끝 " · 문의: {operator} {contact}"와 9번 "문의: {operator} · {contact}".
 *   없으면(기본) 한 줄에는 붙이지 않고, 9번은 늘 "문의: Instagram @hanuipyo"(v0.3.4, 작업 132).
 * - 저작권·문의 줄(하단 둘째 줄) `credit` — `serverInfo`와 관계없이 늘 `SERVICE_CREDIT`. 글자로만 낸다(링크 아님).
 * - 8번 항목의 설치 안내 — `serverInfo.repoUrl`이 있으면 "설치 안내: <링크>", 없으면 PRD 문구 그대로.
 */
import { isSafeLink, type ServerInfo, type ServiceNoticeOverride } from '../../config/deploy';

/** 하단 한 줄(오른쪽 [이용 안내] 버튼은 화면이 붙인다) */
export const SERVICE_NOTICE_SHORT =
  '이 게임 서버는 교사 한 사람이 개인적으로 운영하는 무료 서버예요. 예고 없이 점검하거나 멈출 수 있어요. 학생 실명은 받지 않고, 학생 정보는 서버에 저장하지 않아요.';

/** 하단 둘째 줄 — 저작권·문의(PRD 10.12.1 v0.3.4). 늘 같고 링크가 아니다 */
export const SERVICE_CREDIT = 'Copyright 2026. hanuipyo · Instagram @hanuipyo';
/** 기본 문의처(serverInfo가 없을 때 [이용 안내] 9번) */
export const DEFAULT_CONTACT = 'Instagram @hanuipyo';

/** [이용 안내] 창 전문(1~8번, 9번 문의는 `buildServiceNotice`가 붙인다) */
export const SERVICE_NOTICE_FULL = {
  title: '이용 안내',
  items: [
    '이 서버는 초등학교 교사 한 사람이 개인 비용으로 운영하는 무료 서버입니다. 학교·교육청·회사가 운영하는 서비스가 아닙니다.',
    '서버 사정에 따라 예고 없이 점검하거나 멈출 수 있고, 운영을 끝낼 수도 있습니다. 늘 쓸 수 있다고 약속드리지 못합니다. 중요한 수업에는 종이 학습지·교과서 활동을 함께 준비해 주세요. 미리 정한 점검은 화면 맨 위 띠로 알려 드립니다.',
    "서버 전체에서 동시에 열 수 있는 방은 {maxRooms}개, 같은 학교(같은 인터넷 주소)에서는 10개까지입니다. 가득 차면 방이 빌 때까지 새 방을 열 수 없습니다. 선생님 시작 화면과 판 설정의 [방 열기] 위 '사용 중인 방'에서 확인할 수 있습니다.",
    '학생 실명을 받지 않습니다. 학생은 출석번호와 스스로 지은 회사 이름만 입력합니다. 회사 이름에 실제 이름·전화번호를 쓰지 않도록 지도해 주세요. 출석번호는 선생님 화면에만 보입니다.',
    '서버는 학생 정보를 저장하지 않습니다. 수업 중 메시지를 전달만 하고, 서버 기록에도 출석번호·회사 이름이 남지 않습니다. 접속 제한을 위해 인터넷 주소(IP)를 서버 메모리에 잠시(최대 1시간) 두었다가 지웁니다.',
    '게임 기록은 선생님 PC 브라우저와 학생 기기에만 있다가 24시간 뒤 자동으로 지워집니다. [결과 파일 저장]을 누른 경우에만 선생님 PC에 파일이 남습니다.',
    '게임 속 가격·뉴스·사건은 수업을 위해 지어낸 것입니다. 교과서 내용은 쪽수를 밝혀 수업에 필요한 만큼만 인용했습니다.',
    '자주 쓰신다면 같은 프로그램을 학교 서버에 직접 설치해 쓰실 수 있습니다(설치 안내: {install}).',
  ] as readonly string[],
} as const;

/** 8번 항목의 기본 설치 안내(저장소 주소가 없을 때) */
export const INSTALL_GUIDE_DEFAULT = '공개 저장소 README — 저장소 공개 뒤에 링크를 넣습니다';
/** `maxRooms`를 못 읽었을 때 3번 항목의 "{maxRooms}개" 자리 */
export const MAX_ROOMS_UNKNOWN = '정해진 수';

export interface BuildServiceNoticeInput {
  /** `/health`의 `maxRooms`(못 읽었으면 undefined) */
  maxRooms?: number | null;
  serverInfo?: ServerInfo | null;
  override?: ServiceNoticeOverride | null;
}

export interface ServiceNotice {
  short: string;
  full: { title: string; items: string[] };
  /**
   * 화면이 링크로 바꿔도 되는 문자열(`https://`·`mailto:`로 시작하는 contact·repoUrl).
   * 그 밖의 글자는 모두 그냥 글자로 낸다. 기본 문의·`credit`은 넣지 않는다(링크 아님).
   */
  links: string[];
  /** 하단 둘째 줄(저작권·문의) — 늘 `SERVICE_CREDIT` */
  credit: string;
}

function fillMaxRooms(text: string, maxRooms: number | null | undefined): string {
  const ok = typeof maxRooms === 'number' && Number.isInteger(maxRooms) && maxRooms > 0;
  return text.replace(/\{maxRooms\}개/g, ok ? `${maxRooms}개` : MAX_ROOMS_UNKNOWN).replace(
    /\{maxRooms\}/g,
    ok ? String(maxRooms) : MAX_ROOMS_UNKNOWN,
  );
}

/** 이용 안내 문구 만들기(순수 함수) */
export function buildServiceNotice({ maxRooms, serverInfo, override }: BuildServiceNoticeInput = {}): ServiceNotice {
  const operator = serverInfo?.operator?.trim() || '';
  const contact = serverInfo?.contact?.trim() || '';
  const repoUrl = serverInfo?.repoUrl?.trim() || '';
  const links: string[] = [];
  if (contact && isSafeLink(contact)) links.push(contact);
  if (repoUrl && isSafeLink(repoUrl) && /^https:/i.test(repoUrl)) links.push(repoUrl);

  // 한 줄
  let short = fillMaxRooms(override?.short ?? SERVICE_NOTICE_SHORT, maxRooms);
  const shortContact = [operator, contact].filter(Boolean).join(' ');
  if (shortContact) short += ` · 문의: ${shortContact}`;

  // 전문
  const install = repoUrl || INSTALL_GUIDE_DEFAULT;
  const base = override?.items ?? SERVICE_NOTICE_FULL.items;
  const items = base.map((t) => fillMaxRooms(t.replace(/\{install\}/g, install), maxRooms));
  const fullContact = [operator, contact].filter(Boolean).join(' · ');
  items.push(`문의: ${fullContact || DEFAULT_CONTACT}`);

  return { short, full: { title: SERVICE_NOTICE_FULL.title, items }, links, credit: SERVICE_CREDIT };
}

/**
 * 글을 [글자, 링크] 조각으로 나눈다(화면이 `<a>`를 만들 때 씀). 링크는 `links`에 있는 문자열과 정확히 같은 부분만.
 * HTML로 해석하지 않으므로 `<`·`>` 같은 글자도 그대로 글자다.
 */
export function splitLinks(text: string, links: readonly string[]): Array<{ text: string; href?: string }> {
  const out: Array<{ text: string; href?: string }> = [];
  let rest = text;
  for (;;) {
    let best = -1;
    let link = '';
    for (const l of links) {
      if (!l) continue;
      const i = rest.indexOf(l);
      if (i >= 0 && (best < 0 || i < best || (i === best && l.length > link.length))) {
        best = i;
        link = l;
      }
    }
    if (best < 0) {
      if (rest) out.push({ text: rest });
      return out;
    }
    if (best > 0) out.push({ text: rest.slice(0, best) });
    out.push({ text: link, href: link });
    rest = rest.slice(best + link.length);
  }
}
