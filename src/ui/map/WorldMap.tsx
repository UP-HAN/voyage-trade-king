/**
 * 세계 해도 (PRD 6.3.1, 8.3 S07) — 작업 106.
 *
 * 레이어(아래→위)
 *   ① 바다 이미지 ② 육지 path — LandLayer, 한 번만 그림
 *   ③ 항로 점선(선택한 목적지까지 최단 경로, 모서리를 둥글린 곡선)
 *   ④ 항구 표식(놋쇠 원 + 닻) + 이름표 "부산(대한민국)"(HTML, 18px 이상)
 *   ⑤ 배(내 배: 크게 + 금색 테두리 / 다른 학생 배: 작게 반투명, 항구마다 부채꼴, 최대 8척 + "+n")
 *
 * 확대·이동: 지도 레이어는 CSS transform 하나로 움직인다. 카메라 값(--k, --tx, --ty)은 루트 요소의 CSS 변수로만
 * 바꾸므로(Preact 다시 그리기 없음) 끌기·핀치·휠 중에도 육지 path 를 다시 그리지 않는다. 항구·배·이름표는
 * 화면 크기가 일정하도록 같은 변수로 위치만 계산한다.
 *
 * 식별(v0.3.1, PRD 7.3.1): 다른 학생 배는 공개 ID(pid)로만 구분하고, 누르면 그 항구의 회사 이름만 보인다.
 * 공용 화면 모드는 전체 보기 고정, 말풍선·이름 없음(배만).
 *
 * 항해 연출(M02)은 작업 201: `onRouteChange`로 받은 좌표(또는 geometry.routePoints)를 fx.sail 에 넘긴다.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { ports, portLabel } from '../../data/ports';
import type { LessonId, PortId } from '../../data/types';
import { reducedMotion } from '../common/fx';
import {
  centerOn,
  defaultStudentScale,
  fullView,
  lerpCamera,
  panBy,
  studentDefaultView,
  zoomAt,
  type Camera,
  type Viewport,
} from './camera';
import { MAP_H, MAP_W, routePoints, toPathD, type XY } from './geometry';
import { LandLayer, MAP_SETTLE_EVENT, type MapSettleDetail } from './LandLayer';
import { bubbleContent, isPortOpen, layoutShips, type MyShip, type OtherShip } from './ships';
import { ShipIcon } from './ShipIcon';
import './world-map.css';

export type { MyShip, OtherShip } from './ships';

export interface PortHighlight {
  port: PortId;
  /** 'hot' = 불꽃 배지(인기 상품 등), 'ring' = 강조 고리 */
  kind?: 'hot' | 'ring';
  /** 화면 읽기용 설명 */
  label?: string;
}

export interface RouteInfo {
  from: PortId;
  to: PortId;
  /** 지도 좌표 곡선 점들 — fx.sail 연출(작업 201)에 넘긴다 */
  points: XY[];
}

export interface WorldMapProps {
  mode: 'student' | 'screen';
  /** 현재 구간. 이 구간까지 열린 항구만 활성 */
  lesson: LessonId;
  myShip?: MyShip | null;
  otherShips?: readonly OtherShip[];
  /** 고른 목적지 — 내 배 항구에서 여기까지 항로 점선 */
  selectedDest?: PortId | null;
  onSelectPort?: (port: PortId) => void;
  highlightPorts?: readonly PortHighlight[];
  /** 항로 미리 보기(내 배·목적지와 상관없이 그릴 항로). 주면 selectedDest 항로보다 우선 */
  routePreview?: { from: PortId; to: PortId } | null;
  /** 그리는 항로가 바뀔 때(없어지면 null) */
  onRouteChange?: (route: RouteInfo | null) => void;
  /** (작업 167) 학급의 열린 항구. 주면 이 목록에 없는 항구도 잠김으로 그린다(2차시 앞 시간 싱가포르). 없으면 구간만 본다 */
  openPorts?: readonly PortId[];
  class?: string;
}

const MY_SHIP_SIZE = 46;
const OTHER_SHIP_SIZE = 26;
/** 내 배 자리: 항구 표식 왼쪽 */
const MY_SHIP_OFFSET = { dx: -38, dy: -4 };
/** 이름표 자리(항구가 몰린 동아시아에서 서로 덜 겹치게) */
const LABEL_SIDE: Partial<Record<PortId, 'left' | 'right'>> = { SHA: 'left', BKK: 'left', LAX: 'left', YOK: 'right', MUM: 'right' };

/** 이름표 그리는 순서: 잠긴 항구 먼저(겹치면 열린 항구 이름표가 위에 보이게) */
function labelOrder(lesson: LessonId, openPorts?: readonly PortId[]) {
  return [...ports].sort((a, b) => Number(portOpenIn(a.id, lesson, openPorts)) - Number(portOpenIn(b.id, lesson, openPorts)));
}

/** (작업 167) 해도에서 열린 항구인가: 구간으로 열렸고, 학급 열린 항구를 주었으면 거기에도 있어야 한다 */
export function portOpenIn(port: PortId, lesson: LessonId, openPorts?: readonly PortId[]): boolean {
  return isPortOpen(port, lesson) && (!openPorts || openPorts.includes(port));
}

/** (107) 학생 기본 배율의 이 비율보다 작게 보면 '멀리 본 보기'(is-far) — 이름표를 짧게 */
const FAR_RATIO = 0.75;

/** 이 거리(px)보다 많이 움직이면 끌기로 보고 클릭을 막는다 */
const DRAG_THRESHOLD = 6;

/** 지도 좌표 + 화면 px 오프셋을 CSS 변수로 위치시키는 스타일 */
function at(x: number, y: number, dx = 0, dy = 0): { transform: string } {
  return {
    transform: `translate(calc(var(--k) * ${x}px + var(--tx) + ${dx}px), calc(var(--k) * ${y}px + var(--ty) + ${dy}px))`,
  };
}

const portXY = (id: PortId): XY => {
  const p = ports.find((q) => q.id === id)!;
  return { x: p.x, y: p.y };
};

function readViewport(el: HTMLElement | null): Viewport {
  const r = el && typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
  const w = r && r.width > 0 ? r.width : 1366;
  const h = r && r.height > 0 ? r.height : 640;
  return { w, h };
}

export function WorldMap(props: WorldMapProps) {
  const { mode, lesson, myShip, otherShips, selectedDest, onSelectPort, highlightPorts, routePreview, onRouteChange, openPorts } = props;
  const interactive = mode === 'student';
  const rootRef = useRef<HTMLDivElement>(null);
  const camRef = useRef<Camera>({ k: 0.5, tx: 0, ty: 0 });
  const viewRef = useRef<Viewport>({ w: 1366, h: 640 });
  const touchedRef = useRef(false);
  /** (작업 133) 학생이 확대·축소 몸짓(휠·핀치)을 했는가 — 해도 큰 사본으로 바꿀지 LandLayer 가 정한다 */
  const zoomedRef = useRef(false);
  const animRef = useRef<number | null>(null);
  const settleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [bubblePort, setBubblePort] = useState<PortId | null>(null);

  // ── 카메라 적용(CSS 변수만 바꿈) ─────────────────────────
  const apply = useCallback((c: Camera) => {
    camRef.current = c;
    const el = rootRef.current;
    if (!el) return;
    el.style.setProperty('--k', String(c.k));
    el.style.setProperty('--tx', `${c.tx}px`);
    el.style.setProperty('--ty', `${c.ty}px`);
    // 움직이는 동안만 will-change(합성 레이어) → 멈추면 빼서 확대한 배율로 다시 선명하게 그리게 한다
    if (el.classList) {
      // (107) 멀리 본 보기(전체 보기 등): 동아시아 이름표가 겹치지 않게 짧은 이름표·잠긴 항구 이름표 숨김·내 배를 항구 위로
      if (c.k < defaultStudentScale(viewRef.current) * FAR_RATIO) el.classList.add('is-far');
      else el.classList.remove('is-far');
      el.classList.add('is-moving');
      if (settleRef.current != null) clearTimeout(settleRef.current);
      settleRef.current = setTimeout(() => {
        settleRef.current = null;
        el.classList.remove('is-moving');
        // (작업 133) 멈춘 배율을 알린다 → 바다 그림(LandLayer)이 필요하면 큰 사본을 받아 바꿔 끼운다
        if (typeof el.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
          el.dispatchEvent(new CustomEvent<MapSettleDetail>(MAP_SETTLE_EVENT, { detail: { k: camRef.current.k, zoomed: zoomedRef.current } }));
        }
      }, 180);
    }
  }, []);

  const initialView = useCallback(
    (v: Viewport) => (interactive ? studentDefaultView(v) : fullView(v)),
    [interactive],
  );

  const animateTo = useCallback(
    (target: Camera) => {
      if (animRef.current != null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(animRef.current);
      const from = camRef.current;
      if (reducedMotion() || typeof requestAnimationFrame !== 'function') {
        apply(target);
        return;
      }
      const start = performance.now();
      const dur = 380;
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / dur);
        const e = 1 - Math.pow(1 - t, 3);
        apply(lerpCamera(from, target, e));
        animRef.current = t < 1 ? requestAnimationFrame(step) : null;
      };
      animRef.current = requestAnimationFrame(step);
    },
    [apply],
  );

  useEffect(
    () => () => {
      if (settleRef.current != null) clearTimeout(settleRef.current);
      if (animRef.current != null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(animRef.current);
    },
    [],
  );

  // 처음 크기 재기 + 화면 크기 바뀔 때
  useLayoutEffect(() => {
    const el = rootRef.current;
    const v = readViewport(el);
    viewRef.current = v;
    apply(initialView(v));
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const nv = readViewport(el);
      const old = viewRef.current;
      viewRef.current = nv;
      if (!touchedRef.current || !interactive) {
        apply(initialView(nv));
      } else {
        // 보던 가운데를 유지
        const c = camRef.current;
        const cx = (old.w / 2 - c.tx) / c.k;
        const cy = (old.h / 2 - c.ty) / c.k;
        apply(centerOn(cx, cy, c.k, nv));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [apply, initialView, interactive]);

  // ── 끌기·핀치·휠 ─────────────────────────────────────────
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ moved: boolean; startX: number; startY: number; dist: number; mid: XY } | null>(null);
  const suppressClick = useRef(false);

  const localPoint = (e: { clientX: number; clientY: number }): XY => {
    const r = rootRef.current?.getBoundingClientRect?.();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };

  const pinchInfo = () => {
    const pts = [...pointers.current.values()];
    const a = pts[0]!;
    const b = pts[1]!;
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  };

  const onPointerDown = (e: PointerEvent) => {
    if (!interactive) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const p = localPoint(e);
    pointers.current.set(e.pointerId, p);
    if (animRef.current != null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(animRef.current);
      animRef.current = null;
    }
    if (pointers.current.size === 1) {
      gesture.current = { moved: false, startX: p.x, startY: p.y, dist: 0, mid: p };
      suppressClick.current = false;
    } else if (pointers.current.size === 2) {
      const { dist, mid } = pinchInfo();
      gesture.current = { moved: true, startX: mid.x, startY: mid.y, dist, mid };
    }
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!interactive || !pointers.current.has(e.pointerId)) return;
    const prev = pointers.current.get(e.pointerId)!;
    const p = localPoint(e);
    pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    if (!g) return;
    const v = viewRef.current;
    if (pointers.current.size >= 2) {
      const { dist, mid } = pinchInfo();
      let c = camRef.current;
      if (g.dist > 0 && dist > 0) c = zoomAt(c, dist / g.dist, mid.x, mid.y, v);
      c = panBy(c, mid.x - g.mid.x, mid.y - g.mid.y, v);
      g.dist = dist;
      g.mid = mid;
      g.moved = true;
      suppressClick.current = true;
      touchedRef.current = true;
      zoomedRef.current = true;
      apply(c);
      return;
    }
    if (!g.moved && Math.hypot(p.x - g.startX, p.y - g.startY) > DRAG_THRESHOLD) {
      g.moved = true;
      suppressClick.current = true;
      touchedRef.current = true;
      try {
        rootRef.current?.setPointerCapture?.(e.pointerId);
      } catch {
        /* 무시 */
      }
    }
    if (g.moved) apply(panBy(camRef.current, p.x - prev.x, p.y - prev.y, v));
  };

  const onPointerEnd = (e: PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 1) {
      // 핀치에서 손가락 하나 남음: 그 손가락으로 끌기 계속
      const [p] = [...pointers.current.values()];
      gesture.current = { moved: true, startX: p!.x, startY: p!.y, dist: 0, mid: p! };
    } else if (pointers.current.size === 0) {
      gesture.current = null;
    }
  };

  const onWheel = (e: WheelEvent) => {
    if (!interactive) return;
    e.preventDefault();
    const p = localPoint(e);
    const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
    touchedRef.current = true;
    zoomedRef.current = true;
    apply(zoomAt(camRef.current, factor, p.x, p.y, viewRef.current));
  };

  const onClickCapture = (e: MouseEvent) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      e.stopPropagation();
      e.preventDefault();
    }
  };

  const showAll = () => {
    touchedRef.current = true;
    animateTo(fullView(viewRef.current));
  };
  const toMyShip = () => {
    if (!myShip) return;
    touchedRef.current = true;
    const v = viewRef.current;
    const k = Math.max(camRef.current.k, defaultStudentScale(v));
    const p = portXY(myShip.port);
    animateTo(centerOn(p.x, p.y, k, v));
  };

  // ── 항로 ────────────────────────────────────────────────
  const route = useMemo((): RouteInfo | null => {
    const pair = routePreview ?? (myShip && selectedDest && selectedDest !== myShip.port ? { from: myShip.port, to: selectedDest } : null);
    if (!pair || pair.from === pair.to) return null;
    return { from: pair.from, to: pair.to, points: routePoints(pair.from, pair.to) };
  }, [routePreview?.from, routePreview?.to, myShip?.port, selectedDest]);

  useEffect(() => {
    onRouteChange?.(route);
  }, [route]);

  // ── 배 배치 ─────────────────────────────────────────────
  const groups = useMemo(() => layoutShips(otherShips ?? []), [otherShips]);
  const highlightByPort = useMemo(() => {
    const m = new Map<PortId, PortHighlight>();
    for (const h of highlightPorts ?? []) m.set(h.port, h);
    return m;
  }, [highlightPorts]);

  // 말풍선 대상 항구의 배가 모두 떠나면 닫는다
  const bubbleGroup = interactive && bubblePort ? groups.find((g) => g.port === bubblePort) ?? null : null;
  const bubble = bubbleGroup ? bubbleContent(bubbleGroup.all) : null;

  const openBubble = (port: PortId) => (e: Event) => {
    e.stopPropagation();
    if (!interactive) return;
    setBubblePort((cur) => (cur === port ? null : port));
  };

  return (
    <div
      ref={rootRef}
      class={`world-map world-map--${mode}${props.class ? ` ${props.class}` : ''}`}
      data-testid="world-map"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onWheel={onWheel}
      onClickCapture={onClickCapture}
      onClick={() => setBubblePort(null)}
    >
      {/* ①② 바다 + 육지, ③ 항로 — 지도 단위로 함께 확대 */}
      <div class="wm-world" style={{ width: `${MAP_W}px`, height: `${MAP_H}px` }}>
        <LandLayer />
        <svg class="wm-routes" viewBox={`0 0 ${MAP_W} ${MAP_H}`} width={MAP_W} height={MAP_H} aria-hidden="true">
          {route && (
            <>
              <path class="wm-route-under" d={toPathD(route.points)} />
              <path class="wm-route" d={toPathD(route.points)} data-from={route.from} data-to={route.to} />
            </>
          )}
        </svg>
      </div>

      {/* ④ 항구 표식 + 이름표 */}
      <div class="wm-overlay">
        {ports.map((p) => {
          const open = portOpenIn(p.id, lesson, openPorts);
          const hl = highlightByPort.get(p.id);
          const selected = open && selectedDest === p.id;
          const here = myShip?.port === p.id;
          const label = portLabel(p.id);
          return (
            <div
              key={p.id}
              class={`wm-port${open ? '' : ' is-locked'}${selected ? ' is-selected' : ''}${here ? ' is-here' : ''}${hl?.kind === 'ring' ? ' is-ring' : ''}`}
              style={at(p.x, p.y)}
              data-port={p.id}
            >
              <button
                type="button"
                class="wm-port-hit"
                disabled={!open || !interactive}
                aria-label={open ? `${label}${hl?.label ? ` — ${hl.label}` : ''}` : `${label} — 아직 열리지 않은 항구`}
                aria-pressed={interactive && open ? selected : undefined}
                onClick={(e) => {
                  e.stopPropagation();
                  if (open && interactive) onSelectPort?.(p.id);
                }}
              >
                {open ? (
                  <svg class="wm-port-mark" viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
                    <circle cx="16" cy="16" r="14" fill="#DCAA48" stroke="#2B2318" stroke-width="2" />
                    <circle cx="16" cy="16" r="11" fill="none" stroke="#8D6C2C" stroke-width="1" />
                    <g fill="none" stroke="#2B2318" stroke-width="2" stroke-linecap="round">
                      <circle cx="16" cy="9.5" r="2.2" />
                      <path d="M16 11.7V23.5M11.5 14.5H20.5M9.5 18.5Q10.5 24 16 24Q21.5 24 22.5 18.5" />
                    </g>
                  </svg>
                ) : (
                  <span class="wm-port-dot" aria-hidden="true" />
                )}
                {hl?.kind !== 'ring' && hl && open && (
                  <svg class="wm-port-badge" viewBox="0 0 20 20" width="22" height="22" aria-hidden="true">
                    <circle cx="10" cy="10" r="9.5" fill="#2B2318" />
                    <path d="M10 3.5C12.5 7 14.5 8.6 14.5 11.6A4.5 4.5 0 0 1 5.5 11.6C5.5 9.6 6.6 8.5 7.6 7.4C7.8 9 8.6 9.8 9.4 10C9 7.6 9.4 5.6 10 3.5Z" fill="#F2B66D" stroke="#C0623F" stroke-width="1" />
                  </svg>
                )}
              </button>
            </div>
          );
        })}

        {/* ⑤ 다른 학생 배 */}
        {groups.map((g) => {
          const p = portXY(g.port);
          return (
            <div key={g.port} class="wm-fleet" data-port={g.port}>
              {g.shown.map(({ ship, dx, dy }) => (
                <button
                  type="button"
                  key={ship.pid}
                  class="wm-ship wm-ship--other"
                  style={at(p.x, p.y, dx, dy)}
                  data-pid={ship.pid}
                  tabIndex={interactive ? 0 : -1}
                  disabled={!interactive}
                  aria-label={interactive ? '이 항구의 다른 회사 보기' : '다른 회사 배'}
                  onClick={openBubble(g.port)}
                >
                  <ShipIcon color={ship.color} emblem={ship.emblem} size={OTHER_SHIP_SIZE} />
                </button>
              ))}
              {g.badge && (
                <button
                  type="button"
                  class="wm-fleet-more"
                  style={at(p.x, p.y, g.badge.dx, g.badge.dy)}
                  disabled={!interactive}
                  aria-label={`배 ${g.hidden}척 더 있음`}
                  onClick={openBubble(g.port)}
                >
                  +{g.hidden}
                </button>
              )}
            </div>
          );
        })}

        {/* 내 배 */}
        {myShip && (
          <div class="wm-ship wm-ship--mine" style={at(portXY(myShip.port).x, portXY(myShip.port).y, MY_SHIP_OFFSET.dx, MY_SHIP_OFFSET.dy)} aria-label="내 배">
            <ShipIcon color={myShip.color} emblem={myShip.emblem} size={MY_SHIP_SIZE} mine />
          </div>
        )}

        {/* 이름표: 배·표식보다 위에(겹쳐도 읽히게). 누르기는 아래 표식으로 통과 */}
        {labelOrder(lesson, openPorts).map((p) => (
          <div
            key={`label-${p.id}`}
            class={`wm-label-anchor${portOpenIn(p.id, lesson, openPorts) ? '' : ' is-locked'}${myShip?.port === p.id ? ' is-here' : ''}`}
            style={at(p.x, p.y)}
          >
            <span class={`wm-port-label wm-port-label--${LABEL_SIDE[p.id] ?? 'below'}`}>
              {p.name}
              <span class="wm-port-label__country">({p.country})</span>
            </span>
          </div>
        ))}

        {/* 말풍선: 회사 이름만 */}
        {bubble && bubbleGroup && (
          <div
            class="wm-bubble"
            role="dialog"
            aria-label={`${portLabel(bubbleGroup.port)}에 있는 회사`}
            style={at(portXY(bubbleGroup.port).x, portXY(bubbleGroup.port).y, 0, 52)}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <ul class="wm-bubble-names">
              {bubble.names.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
            {bubble.more > 0 && <p class="wm-bubble-more">외 {bubble.more}개</p>}
            <button type="button" class="wm-bubble-close" aria-label="닫기" onClick={() => setBubblePort(null)}>
              ×
            </button>
          </div>
        )}
      </div>

      {interactive && (
        <div class="wm-controls" onPointerDown={(e) => e.stopPropagation()}>
          <button type="button" class="wm-btn" onClick={(e) => (e.stopPropagation(), showAll())}>
            전체 보기
          </button>
          <button type="button" class="wm-btn" disabled={!myShip} onClick={(e) => (e.stopPropagation(), toMyShip())}>
            내 배로
          </button>
        </div>
      )}
    </div>
  );
}
