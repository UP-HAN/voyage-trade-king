/**
 * 연출 훅 (PRD 12장 4). 화면 코드는 연출을 이 훅으로만 호출한다.
 * 지금은 이름만 정의하고 기본 구현은 즉시 완료(resolve)한다. motion-designer 가 실제 연출로 채운다.
 * 실제 연출을 넣을 때는 `reducedMotion()` 이 true 면 위치 이동 대신 페이드로 줄인다.
 */
import { prefersReducedMotion } from './motion';

export { prefersReducedMotion };

/** 연출 대상과 선택 옵션. 구현이 채워지면 훅마다 필요한 값을 더한다. */
export interface FxOptions {
  /** 연출을 건너뛰고 즉시 끝낼지 */
  skip?: boolean;
  [key: string]: unknown;
}

export type FxTarget = Element | null | undefined;

export type FxHook = (target?: FxTarget, options?: FxOptions) => Promise<void>;

const done: FxHook = () => Promise.resolve();

/** 연출 축소 여부(테스트·설정에서 덮어쓸 수 있음) */
let reducedOverride: boolean | null = null;

export function reducedMotion(): boolean {
  return reducedOverride ?? prefersReducedMotion();
}

/** 테스트·교사 설정용: null 이면 브라우저 설정을 따른다. */
export function setReducedMotionOverride(value: boolean | null): void {
  reducedOverride = value;
}

export interface Fx {
  /** 무역 종류·관세 도장 찍기 */
  stamp: FxHook;
  /** 배 출항·항해 */
  sail: FxHook;
  /** 사건·결정 카드 등장 */
  cardIn: FxHook;
  /** 갈매기(편지·예보) 날아오기 */
  gull: FxHook;
  /** 팝업 등장(학습지 "잠깐!" 등) */
  popupIn: FxHook;
  /** 일시정지 화면 등장 */
  pauseIn: FxHook;
  /** 남은 시간 경고 */
  clockWarn: FxHook;
  /** 돌발 사건 등장 */
  incident: FxHook;
  /** 카드 뒤집기 */
  cardFlip: FxHook;
  /** 도착 */
  arrive: FxHook;
  /** 매매 결과(돈 오르내림) */
  trade: FxHook;
  /** 상품 사기(상자가 배에 실림 — 작업 108이 부르고 202가 채움) */
  buy: FxHook;
  /** 화면 전환 */
  screenIn: FxHook;
}

export const fx: Fx = {
  stamp: done,
  sail: done,
  cardIn: done,
  gull: done,
  popupIn: done,
  pauseIn: done,
  clockWarn: done,
  incident: done,
  cardFlip: done,
  arrive: done,
  trade: done,
  buy: done,
  screenIn: done,
};
