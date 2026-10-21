/**
 * 작업 135 리허설 — 막힘 탐지기의 기록 도구와 순수 판정 함수(node 전용 코드 없음, 단위 테스트: detector.test.ts).
 *
 * 문제 등급
 * - 막힘: 수업이 그 자리에서 멈춤(학생이 라운드 중 할 수 있는 행동 없음, 교사가 눌러야 하는데 안내 없음, 판이 끝나지 않음, 재접속 실패)
 * - 문제: 고쳐야 할 오류(페이지·콘솔 오류, 학생·교사 불일치, 팝업·편지·결과 화면 안 뜸, 판이 T를 넘김, 서버 이상)
 * - 혼란: 막히지는 않지만 사람이 헷갈림(라운드 전 대기 안내·남은 시간 없음 등)
 * - 참고: 기록만(거절 응답 표처럼 정상일 수도 있는 것)
 */

export type Severity = '막힘' | '문제' | '혼란' | '참고';

export type DetectorKind =
  | 'no-action' // 1. 학생이 라운드 중 N초 넘게 할 수 있는 행동이 없음
  | 'wait-guidance' // 1b. 라운드 밖 대기 중 할 일·남은 시간 안내 없음(혼란)
  | 'teacher-guidance' // 2. 교사가 눌러야 진행되는데 화면에 안내 없음
  | 'page-error' // 3. 페이지 오류·콘솔 오류
  | 'rejections' // 4. 거절 응답(코드별 횟수)
  | 'overtime' // 5. 판이 T를 넘김·끝나지 않음
  | 'mismatch' // 6. 학생 화면과 교사 표 불일치
  | 'missing-screen' // 7. 학습지 팝업·편지·결과 화면 안 뜸
  | 'reconnect' // 8. 재접속 실패
  | 'health' // 9. 메모리·메시지율 이상(/health)
  | 'harness' // 리허설 도구 자체 문제(앱 문제 아님)
  | 'blocked-click' // (수정 1) 핵심 버튼이 정상 층이 아닌 것에 가려 눌리지 않음·층이 닫히지 않고 남음
  | 'preview'; // 준비 중 기능(기능 플래그가 꺼진 단원 판·L2~L4) 때문에 생긴 것 — 참고

export const KIND_LABEL: Record<DetectorKind, string> = {
  'no-action': '라운드 중 할 수 있는 행동 없음',
  'wait-guidance': '대기 중 할 일·남은 시간 안내 없음',
  'teacher-guidance': '교사가 눌러야 하는데 안내 없음',
  'page-error': '페이지·콘솔 오류',
  rejections: '거절 응답',
  overtime: '판 시간 초과·끝나지 않음',
  mismatch: '학생 화면 ↔ 교사 표 불일치',
  'missing-screen': '학습지·편지·결과 화면 안 뜸',
  reconnect: '재접속 실패',
  health: '서버 메모리·메시지율 이상',
  harness: '리허설 도구 문제(앱 문제 아님)',
  'blocked-click': '버튼이 가려 눌리지 않음·층이 닫히지 않음',
  preview: '준비 중 기능(참고 — 기능 플래그 FULL_UNIT_READY=false인 단원 판·L2~L4)',
};

export interface Problem {
  scenario: string;
  kind: DetectorKind;
  severity: Severity;
  /** 같은 문제 묶음 키(같은 키는 횟수만 늘린다) */
  key: string;
  title: string;
  detail: string;
  /** 처음 발견: 무역 경과(빠른 시계 m:ss) 또는 단계 이름 */
  at: string;
  who: string[];
  steps: string[];
  shots: string[];
  logs: string[];
  count: number;
}

export class Collector {
  readonly problems: Problem[] = [];
  /** 진행 기록(재현 단계로 씀) */
  readonly steps: string[] = [];
  constructor(readonly scenario: string) {}
  step(s: string): void {
    this.steps.push(s);
    if (this.steps.length > 400) this.steps.splice(0, this.steps.length - 400);
  }
  has(key: string): boolean {
    return this.problems.some((p) => p.key === key);
  }
  add(p: Omit<Problem, 'scenario' | 'count' | 'steps' | 'shots' | 'logs' | 'who'> & Partial<Pick<Problem, 'shots' | 'logs' | 'who'>>): Problem {
    const ex = this.problems.find((x) => x.key === p.key);
    if (ex) {
      ex.count++;
      for (const w of p.who ?? []) if (!ex.who.includes(w)) ex.who.push(w);
      return ex;
    }
    const np: Problem = { scenario: this.scenario, count: 1, steps: this.steps.slice(-12), shots: [], logs: [], who: [], ...p };
    this.problems.push(np);
    return np;
  }
}

/** m:ss (음수는 0) */
export function mmss(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * 학생 HUD 금액("1억 2,345만 원", "2,345만 원", "-30만 원")을 만 원 단위 수로. 못 읽으면 null.
 * 교사 표는 만 원 단위 숫자("12,345")라 parseTableMoney.
 */
export function parseHudMoney(text: string): number | null {
  const t = text.replace(/\s+/g, '');
  const m = /(-?)(?:(\d[\d,]*)억)?(?:(\d[\d,]*)만)?원/.exec(t);
  if (!m || (m[2] === undefined && m[3] === undefined)) {
    const z = /(-?)(\d[\d,]*)원/.exec(t);
    return z ? (z[1] ? -1 : 1) * Number(z[2]!.replace(/,/g, '')) : null;
  }
  const eok = m[2] ? Number(m[2].replace(/,/g, '')) : 0;
  const man = m[3] ? Number(m[3].replace(/,/g, '')) : 0;
  return (m[1] ? -1 : 1) * (eok * 10000 + man);
}

export function parseTableMoney(text: string): number | null {
  const m = /-?\d[\d,]*/.exec(text.replace(/\s+/g, ''));
  return m ? Number(m[0].replace(/,/g, '')) : null;
}

/**
 * 학생 화면 글자에 '언제 거래가 열리는지'(남은 시간) 또는 '선생님이 시작하면' 같은 안내가 있는가.
 * (134에서 "라운드 1까지 3:30", "다음 라운드까지 m:ss", "선생님이 시작하면 라운드가 열려요"가 들어올 예정 — 그 모양을 넓게 받는다)
 */
export function hasRoundGuidance(text: string): boolean {
  const t = text.replace(/\s+/g, ' ');
  if (/라운드\s*\d*\s*(까지|시작까지)\s*\d{1,2}:\d{2}/.test(t)) return true;
  if (/(다음|첫)\s*라운드[^.\n]{0,12}\d{1,2}:\d{2}/.test(t)) return true;
  if (/\d{1,2}:\d{2}\s*(뒤|후)에?\s*(라운드|거래|무역)/.test(t)) return true;
  if (/(약\s*)?\d+\s*분(\s*\d+\s*초)?\s*(뒤|후)에?\s*(라운드|거래)/.test(t)) return true;
  if (/선생님이\s*(시작|라운드를\s*시작)하면/.test(t)) return true;
  // (작업 153 추가) 자유 항해 판: 라운드 끝이 막지 않는다 — "선생님이 멈출 때까지 자유롭게 다녀요"
  if (/선생님이\s*멈출\s*때까지/.test(t)) return true;
  // (작업 149·151) 새 학생 안내: 남은 라운드 없음 → 정리 활동, 카드 확인 뒤 "선생님이 다음으로 넘기면", 라운드 사이 "라운드가 열리면/선생님이 라운드를 열면"
  if (/남은\s*라운드가\s*없어요/.test(t) || /라운드가\s*모두\s*끝났어요/.test(t)) return true;
  if (/선생님이\s*(다음으로\s*넘기면|라운드를\s*열면)/.test(t)) return true;
  if (/다음\s*라운드가\s*열리면/.test(t)) return true;
  return false;
}

/** 교사 화면에 '라운드 1까지 m:ss'/'다음 라운드까지 m:ss' 같은 표시가 있는가(134 예정) */
export function hasTeacherRoundCountdown(text: string): boolean {
  const t = text.replace(/\s+/g, ' ');
  return /라운드\s*\d*\s*까지\s*\d{1,2}:\d{2}/.test(t) || /다음\s*라운드[^.\n]{0,8}\d{1,2}:\d{2}/.test(t);
}

/** [무역 시작] 확인 창 안내에 라운드 1까지의 시간 안내가 있는가(134 예정: "약 m분 s초 뒤 라운드 1이 시작돼요") */
export function hasStartConfirmRoundHint(text: string): boolean {
  const t = text.replace(/\s+/g, ' ');
  return /라운드\s*1[이가]?\s*(시작|열)/.test(t) && /(\d+\s*분|\d{1,2}:\d{2})/.test(t);
}

/**
 * 같은 상태가 이어진 시간을 잰다(빠른 시계 ms). on(true)이 연속으로 들어오면 시작 시각을 기억하고, 끊기면 지운다.
 * longest = 지금까지 가장 긴 연속 시간.
 */
export class Streak {
  since: number | null = null;
  longest = 0;
  /** 이번 연속에서 이미 보고했는가 */
  reported = false;
  update(on: boolean, now: number): number {
    if (!on) {
      this.since = null;
      this.reported = false;
      return 0;
    }
    this.since ??= now;
    const d = now - this.since;
    if (d > this.longest) this.longest = d;
    return d;
  }
}

/** 거절 코드 표 합치기 */
export function mergeCounts(into: Record<string, number>, from: Record<string, number>): Record<string, number> {
  for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + v;
  return into;
}

/** 리허설에서 일부러 만든 거절(이름 다시 짓기·다른 기기 허락 대기) — 정상 경로 */
export const EXPECTED_REJECTS = /^(NAME_TAKEN|BAD_NAME|NAME_FORMAT|BAD_NAME\(기기 검사\)|NAME_TAKEN\(기기 검사\)|NAME_FORMAT\(기기 검사\)|REJOIN_PENDING)$/;

/** 준비 중(L2~L4) 사건·활동에 대한 행동인가(예: "respondEvent L3-E4") */
export function isPreviewAct(act: string | undefined): boolean {
  return Boolean(act && /\bL[234]-/.test(act));
}

/**
 * 학생 화면의 '정상 층'(앱이 일부러 아래 화면을 덮는 층): 사건·미니게임·학습지·일시정지·이름 막힘(LayerFrame data-layer),
 * 편지 패널(data-layer="letter"), 비차단 사건 패널(event-panel), 화면 가운데 창(.st-modal[aria-modal=true] — 라운드 밖 항구 카드 등 → 'modal'). 이 층에 가려 눌리지 않는 것은 정상 흐름이다 — 학생은 층에 먼저 답하거나 닫는다.
 */
export const NORMAL_LAYERS = new Set(['event', 'minigame', 'worksheet', 'pause', 'nameBlocked', 'letter', 'event-panel', 'modal']);

export interface CoverInfo {
  /** 가린 요소가 속한 층(data-layer 또는 'event-panel'), 없으면 null */
  layer: string | null;
  /** 누르려던 요소가 inert 안에 있음(앱이 일시정지·이름 막힘 때 아래 화면을 일부러 막음) */
  inert: boolean;
  /** 맨 위 요소 설명 */
  top: string;
  /** 맨 위 요소부터 조상 몇 단계 */
  chain: string;
}

export function isNormalCover(c: CoverInfo): boolean {
  return c.inert || (c.layer !== null && NORMAL_LAYERS.has(c.layer));
}

/**
 * (수정 1) 학생 화면 맨 위 층이 공개 상태와 맞는가(정상 층인가).
 * true = 지금 떠 있어야 하는 층, false = 공개 상태로는 없어야 하는 층(닫히지 않고 남음), null = 공개 상태로 판단할 수 없음(시간 제한만 적용: 화면 가운데 창 등).
 */
export function layerLegit(
  layer: string | null,
  screen: { catchup: boolean; minigame: boolean; eventResult: boolean; worksheet: boolean },
  pub: { event: { closed: boolean; blocking: boolean } | null; worksheetOn: boolean; paused: boolean; phase: string },
): boolean | null {
  if (!layer) return true;
  switch (layer) {
    case 'worksheet':
      return pub.worksheetOn;
    case 'pause':
      return pub.paused;
    case 'event':
    case 'minigame':
      // 따라잡기(늦게 온·돌아온 학생)·지금 미니게임은 언제든 정상. 그 밖에는 차단형 사건이 떠 있거나(진행·마감 결과) 마감 결과 카드가 보일 때만
      if (screen.catchup || screen.minigame) return true;
      if (!pub.event) return false;
      return pub.event.blocking || screen.eventResult;
    case 'nameBlocked':
      return true;
    default:
      return null;
  }
}
