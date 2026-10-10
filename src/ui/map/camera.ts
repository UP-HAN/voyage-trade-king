/**
 * 해도 확대·이동 계산(순수 함수) — 작업 106.
 * 화면 좌표 = 지도 좌표 × k + (tx, ty). k 는 지도 1단위(0.1°)당 화면 px.
 */
import { MAP_H, MAP_W } from './geometry';

export interface Camera {
  k: number;
  tx: number;
  ty: number;
}

export interface Viewport {
  w: number;
  h: number;
}

/** 학생 기본 보기: 동아시아~동남아(x 1000~1750, PRD 6.3.2) */
export const STUDENT_VIEW = { x0: 1000, x1: 1750, cy: 490 } as const;
/** 최대 확대 = 학생 기본 보기의 3배 */
export const MAX_ZOOM_OVER_DEFAULT = 3;

/** 지도 전체가 들어가는 배율(최소 배율) */
export function fullScale(v: Viewport): number {
  return Math.min(v.w / MAP_W, v.h / MAP_H);
}

export function defaultStudentScale(v: Viewport): number {
  return Math.max(fullScale(v), v.w / (STUDENT_VIEW.x1 - STUDENT_VIEW.x0));
}

export function scaleLimits(v: Viewport): { min: number; max: number } {
  const min = fullScale(v);
  return { min, max: Math.max(min, defaultStudentScale(v) * MAX_ZOOM_OVER_DEFAULT) };
}

/** 지도가 화면보다 작으면 가운데, 크면 빈 곳이 보이지 않게 */
export function clampCamera(c: Camera, v: Viewport): Camera {
  const { min, max } = scaleLimits(v);
  const k = Math.min(max, Math.max(min, c.k));
  const clampAxis = (t: number, size: number, view: number) => {
    const span = size * k;
    if (span <= view) return (view - span) / 2;
    return Math.min(0, Math.max(view - span, t));
  };
  return { k, tx: clampAxis(c.tx, MAP_W, v.w), ty: clampAxis(c.ty, MAP_H, v.h) };
}

/** 지도 점 (x, y)를 화면 가운데에 두는 카메라 */
export function centerOn(x: number, y: number, k: number, v: Viewport): Camera {
  return clampCamera({ k, tx: v.w / 2 - x * k, ty: v.h / 2 - y * k }, v);
}

export function fullView(v: Viewport): Camera {
  return clampCamera({ k: fullScale(v), tx: 0, ty: 0 }, v);
}

export function studentDefaultView(v: Viewport): Camera {
  const k = defaultStudentScale(v);
  return centerOn((STUDENT_VIEW.x0 + STUDENT_VIEW.x1) / 2, STUDENT_VIEW.cy, k, v);
}

/** 화면 점(sx, sy)을 고정한 채 factor 배 확대 */
export function zoomAt(c: Camera, factor: number, sx: number, sy: number, v: Viewport): Camera {
  const { min, max } = scaleLimits(v);
  const k = Math.min(max, Math.max(min, c.k * factor));
  const f = k / c.k;
  return clampCamera({ k, tx: sx - (sx - c.tx) * f, ty: sy - (sy - c.ty) * f }, v);
}

export function panBy(c: Camera, dx: number, dy: number, v: Viewport): Camera {
  return clampCamera({ k: c.k, tx: c.tx + dx, ty: c.ty + dy }, v);
}

/** 두 카메라 사이 보간(버튼 이동 연출용) */
export function lerpCamera(a: Camera, b: Camera, t: number): Camera {
  // 배율은 로그 공간에서 보간해야 속도가 고르게 보인다
  const k = Math.exp(Math.log(a.k) + (Math.log(b.k) - Math.log(a.k)) * t);
  return { k, tx: a.tx + (b.tx - a.tx) * t, ty: a.ty + (b.ty - a.ty) * t };
}
