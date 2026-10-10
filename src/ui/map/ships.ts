/**
 * 지도 위 배 배치·말풍선 내용(순수 함수) — 작업 106, v0.3.1.
 * 다른 학생 배는 공개 ID(pid)로만 구분한다. 출석번호는 지도에 들어오지 않는다(PRD 7.3.1).
 */
import { LESSON_IDS, type LessonId, type PortId } from '../../data/types';
import { ports } from '../../data/ports';

/** 다른 학생 배(공개 상태 PublicState.ships + companies 에서 만든 값) */
export interface OtherShip {
  /** 공개 ID(호스트가 발급한 뜻 없는 6자) */
  pid: string;
  port: PortId;
  /** 깃발 색(#RRGGBB) */
  color: string;
  /** 깃발 문양 ID */
  emblem: string;
  /** 회사 이름. null 이면 "이름 짓는 중" */
  company?: string | null;
}

/** 내 배 */
export interface MyShip {
  port: PortId;
  color: string;
  emblem: string;
}

/** 한 항구에 그리는 다른 배 수(넘치면 "+n" 배지) */
export const MAX_SHIPS_PER_PORT = 8;
/** 말풍선에 보이는 회사 이름 수(넘치면 "외 n개") */
export const MAX_BUBBLE_NAMES = 8;
export const NAMING_PLACEHOLDER = '이름 짓는 중';

/** 그 구간에 열린 항구인가(처음 열리는 구간 이후는 계속 열림) */
export function isPortOpen(port: PortId, lesson: LessonId): boolean {
  const p = ports.find((q) => q.id === port);
  if (!p) return false;
  return LESSON_IDS.indexOf(p.unlockLesson) <= LESSON_IDS.indexOf(lesson);
}

export interface ShipSlot {
  ship: OtherShip;
  /** 항구 표식 중심에서 떨어진 화면 거리(px) */
  dx: number;
  dy: number;
}

export interface PortShipGroup {
  port: PortId;
  /** 그리는 배(최대 MAX_SHIPS_PER_PORT), pid 순 */
  shown: ShipSlot[];
  /** 그리지 못한 배 수("+n" 배지) */
  hidden: number;
  /** 배지 위치(px) */
  badge: { dx: number; dy: number } | null;
  /** 이 항구 배 전체(pid 순) — 말풍선용 */
  all: OtherShip[];
}

/** 부채꼴 반지름(px)과 각도 범위(위쪽 반원) */
const FAN_RADIUS = 40;
const FAN_FROM = -165;
const FAN_TO = -15;

/** 항구별로 묶고 pid 순으로 정렬해 부채꼴 자리를 정한다 */
export function layoutShips(ships: readonly OtherShip[]): PortShipGroup[] {
  const byPort = new Map<PortId, OtherShip[]>();
  for (const s of ships) {
    const list = byPort.get(s.port);
    if (list) list.push(s);
    else byPort.set(s.port, [s]);
  }
  const groups: PortShipGroup[] = [];
  for (const [port, list] of byPort) {
    const all = list.slice().sort((a, b) => (a.pid < b.pid ? -1 : a.pid > b.pid ? 1 : 0));
    const shown = all.slice(0, MAX_SHIPS_PER_PORT);
    const hidden = all.length - shown.length;
    const n = shown.length;
    const slots = shown.map((ship, i): ShipSlot => {
      const deg = n === 1 ? -90 : FAN_FROM + ((FAN_TO - FAN_FROM) * i) / (n - 1);
      const rad = (deg * Math.PI) / 180;
      // 많을수록 반지름을 조금 넓혀 겹침을 줄인다
      const r = FAN_RADIUS + Math.max(0, n - 4) * 3;
      return { ship, dx: Math.round(Math.cos(rad) * r), dy: Math.round(Math.sin(rad) * r) };
    });
    groups.push({
      port,
      shown: slots,
      hidden,
      badge: hidden > 0 ? { dx: 0, dy: -(FAN_RADIUS + Math.max(0, n - 4) * 3) - 30 } : null,
      all,
    });
  }
  return groups.sort((a, b) => (a.port < b.port ? -1 : 1));
}

export interface BubbleContent {
  names: string[];
  /** "외 n개"의 n(0이면 표시 안 함) */
  more: number;
}

/** 말풍선: 그 항구 회사 이름만(최대 8개 + 외 n개). 출석번호·자금은 넣지 않는다 */
export function bubbleContent(ships: readonly OtherShip[]): BubbleContent {
  const names = ships.map((s) => (s.company == null || s.company.trim() === '' ? NAMING_PLACEHOLDER : s.company));
  return { names: names.slice(0, MAX_BUBBLE_NAMES), more: Math.max(0, names.length - MAX_BUBBLE_NAMES) };
}
