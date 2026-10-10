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
  | 'harness'; // 리허설 도구 자체 문제(앱 문제 아님)

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
