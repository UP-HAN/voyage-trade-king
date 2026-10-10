/**
 * 작업 135 리허설 — 시나리오 묶음(a~e). 시각은 무역 시간 T에 대한 비율(0~1, 빠른 시계·호스트 기준 경과)이다.
 * 학생 25명 = 실제 학생 화면 브라우저 4명(1~4번) + 가벼운 봇 21명(5~25번, 실제 학생 코드 + 실제 중계 서버 연결).
 */

export type TeacherOp =
  | { op: 'pause'; holdSec: number }
  | { op: 'extend1' }
  | { op: 'endRound' } // 라운드 중일 때 [라운드 끝]
  | { op: 'closeEvent' } // 응답 받는 사건이 떠 있을 때 [마감]
  | { op: 'lock' } // 입장 마감
  | { op: 'teacherReload' }
  | { op: 'serverRestart' } // 로컬만
  | { op: 'startRoundNow' }; // (134) [지금 라운드 시작] — 있으면 쓰고 없으면 건너뜀

export type CrowdOp =
  | { op: 'lateJoin'; seats: number[] }
  | { op: 'botDrop'; seat: number; backAfterSec: number; newDevice?: boolean }
  | { op: 'refresh'; student: number } // 브라우저 학생 새로 고침
  | { op: 'browserDrop'; student: number; backAfterSec: number }; // 탭을 닫았다가 다시 열기(같은 기기)

export interface Timed<T> {
  /** 무역 경과 비율. phase를 주면 그 단계가 될 때까지 기다렸다가 함 */
  at: number;
  phase?: 'round' | 'event-open' | 'pre-round';
  do: T;
}

export interface Scenario {
  id: 'a' | 'b' | 'c' | 'd' | 'e';
  title: string;
  unit: boolean;
  minutes: number;
  manual: boolean;
  /** (보완 1) 기능 플래그로 꺼 둔 준비 중 기능을 개발용 열쇠(localStorage)로 열어 돌리는 시나리오 — L2~L4 미구현 때문에 생긴 것은 '준비 중 기능(참고)'로 */
  preview?: { devKey: string; why: string };
  teacher: Timed<TeacherOp>[];
  crowd: Timed<CrowdOp>[];
}

/** 이름이 처음부터 겹치거나(같은 이름) 금칙어가 섞인 학생(다시 짓기 경로) — 브라우저 2번(1번과 같은 이름), 봇 6번(5번과 같은 이름), 봇 7번(금칙어) */
export const NAME_PLAN = { browserDupOf: 1, browserDup: 2, botDupOf: 5, botDup: 6, botBad: 7, browserBad: 3 };

export const SCENARIOS: Scenario[] = [
  {
    id: 'a',
    title: '차시 L1 10분 자동',
    unit: false,
    minutes: 10,
    manual: false,
    teacher: [],
    crowd: [
      { at: 0.12, do: { op: 'lateJoin', seats: [24] } },
      { at: 0.1, phase: 'round', do: { op: 'refresh', student: 2 } },
      { at: 0.5, do: { op: 'botDrop', seat: 9, backAfterSec: 40 } },
      { at: 0.55, do: { op: 'lateJoin', seats: [25] } },
    ],
  },
  {
    id: 'b',
    title: '차시 L1 25분 자동(일시정지·연장·라운드 끝·입장 마감)',
    unit: false,
    minutes: 25,
    manual: false,
    teacher: [
      { at: 0.02, phase: 'pre-round', do: { op: 'startRoundNow' } },
      { at: 0.3, do: { op: 'pause', holdSec: 30 } },
      { at: 0.35, do: { op: 'extend1' } },
      { at: 0.5, phase: 'round', do: { op: 'endRound' } },
      { at: 0.6, do: { op: 'lock' } },
    ],
    crowd: [
      { at: 0.2, do: { op: 'lateJoin', seats: [23] } },
      { at: 0.4, do: { op: 'lateJoin', seats: [24, 25] } },
      { at: 0.3, do: { op: 'botDrop', seat: 10, backAfterSec: 60 } },
      { at: 0.5, do: { op: 'browserDrop', student: 4, backAfterSec: 30 } },
      { at: 0.7, do: { op: 'refresh', student: 3 } },
    ],
  },
  {
    id: 'c',
    title: '단원 한 판 25분 자동(사건 마감·다른 기기 허락)',
    unit: true,
    preview: { devKey: 'voyage.dev.fullUnit', why: '단원 한 판·L2~L4는 기능 플래그 FULL_UNIT_READY=false로 준비 중(src/data/schedule.ts)' },
    minutes: 25,
    manual: false,
    teacher: [{ at: 0.3, phase: 'event-open', do: { op: 'closeEvent' } }],
    crowd: [
      { at: 0.1, do: { op: 'lateJoin', seats: [23] } },
      { at: 0.2, do: { op: 'lateJoin', seats: [24] } },
      { at: 0.3, do: { op: 'lateJoin', seats: [25] } },
      { at: 0.4, do: { op: 'botDrop', seat: 11, backAfterSec: 30, newDevice: true } },
      { at: 0.6, do: { op: 'refresh', student: 1 } },
    ],
  },
  {
    id: 'd',
    title: '차시 L1 15분 수동 진행([발동])',
    unit: false,
    minutes: 15,
    manual: true,
    teacher: [],
    crowd: [
      { at: 0.15, do: { op: 'lateJoin', seats: [24, 25] } },
      { at: 0.45, do: { op: 'botDrop', seat: 12, backAfterSec: 45 } },
    ],
  },
  {
    id: 'e',
    title: '혼란 상황 L1 10분(교사 새로 고침·서버 재시작·늦은 입장·끊김)',
    unit: false,
    minutes: 10,
    manual: false,
    teacher: [
      { at: 0.35, do: { op: 'teacherReload' } },
      { at: 0.55, do: { op: 'serverRestart' } },
    ],
    crowd: [
      { at: 0.1, do: { op: 'lateJoin', seats: [23] } },
      { at: 0.3, do: { op: 'lateJoin', seats: [24] } },
      { at: 0.5, do: { op: 'lateJoin', seats: [25] } },
      { at: 0.25, do: { op: 'botDrop', seat: 13, backAfterSec: 40 } },
      { at: 0.25, do: { op: 'botDrop', seat: 14, backAfterSec: 50, newDevice: true } },
      { at: 0.4, do: { op: 'refresh', student: 2 } },
      { at: 0.65, do: { op: 'browserDrop', student: 4, backAfterSec: 30 } },
    ],
  },
];

/** 고장 플래그(탐지기 확인용, `--break a,b`) */
export const BREAKS = {
  'console-error': '1번 학생 화면에서 console.error를 일부러 찍음 → 페이지·콘솔 오류',
  'no-actions': '2번 학생 화면의 아래 막대(항구·출항 버튼)를 라운드 동안 숨김 → 라운드 중 할 수 있는 행동 없음',
  'fake-money': '3번 학생 HUD 자금 글자를 가짜 값으로 바꿈 → 학생 화면 ↔ 교사 표 불일치',
  'hide-worksheet': '4번 학생 화면의 학습지 팝업을 숨김 → 학습지 팝업 안 뜸',
  'hide-fire': '(수동 진행) 교사 화면 [발동] 안내를 숨김 → 교사가 눌러야 하는데 안내 없음',
  'bad-rejoin': '끊겼다 돌아오는 봇이 틀린 방 코드로 들어옴 → 재접속 실패',
  'no-end': '라운드 1에서 교사가 일시정지하고 풀지 않음 → 판이 끝나지 않음',
  // (수정 1) 층·가림 고장 — '보이지만 눌리지 않음'·'닫혀야 할 층이 남음'을 잡는지 확인
  'stuck-layer': '1번 학생 화면에 닫힌 사건 층(dim, data-layer=event)이 라운드 1부터 남음 → 공개 상태와 맞지 않는 층 [문제]·[막힘]',
  'stuck-modal': '2번 학생 화면에 닫기 버튼 없는 가운데 창(aria-modal)이 남음 → 창이 닫히지 않음 [막힘]',
  'click-shield': '3번 학생 아래 막대 위에 투명 층(data-layer 없음) → 핵심 버튼이 가려 눌리지 않음 [문제]·라운드 중 행동 없음 [막힘]',
  'bar-no-pointer': '4번 학생 아래 막대에 pointer-events:none → 라운드 중 행동 없음 [막힘]',
} as const;

export type BreakId = keyof typeof BREAKS;
