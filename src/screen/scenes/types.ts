import type { ScreenData } from '../model';

/** 모든 장면 컴포넌트가 받는 값(공개 상태만) */
export interface SceneProps {
  d: ScreenData;
  /** 화면 시각(ms, 1초마다 갱신) */
  now: number;
  /** 방 코드 6자리 */
  code: string;
  /** 학생이 들어오는 주소 */
  address: { display: string; url: string };
  /** 이 화면이 회사를 처음 본 순서(pid) — 방 코드 장면의 회사 이름 목록용 */
  joinOrder?: readonly string[];
}
