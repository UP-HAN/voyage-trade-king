/**
 * 바다 이미지 + 육지(Natural Earth) 레이어. 한 번 그린 뒤 다시 그리지 않는다(memo — props 없음).
 * 레이어 ① 바다 이미지 ② 육지 path(질감 타일 채움 + 해안 음영 번짐 + 잉크 해안선).
 *
 * (작업 133) 바다 그림은 빌드본의 크기별 사본(1024/1600/2560/원본 2700, WebP + AVIF) 중
 * **처음 보이는 폭 = 2700 × 처음 배율 × 기기 픽셀 비율** 이상인 가장 작은 것을 먼저 받는다(수정 1회차 — 오케스트레이터 결정).
 * 처음 배율은 WorldMap 과 같은 계산(학생: 기본 보기 `defaultStudentScale`, 그 밖: 전체 보기 `fullScale`, 지도 틀 크기 기준)이라
 * 학생 기본 보기(1366 폭에서 약 1.8배)는 처음부터 원본 폭 2700 사본, 교사·공용 화면 전체 보기(1366)는 1600 사본이 된다.
 * 처음 폭을 정하기 전(첫 그리기)에는 src 를 비워 두어 작은 사본을 헛되이 받지 않는다.
 * 학생이 확대·축소(휠·핀치)한 뒤 지도가 멈추면(WorldMap 이 `wm-settle` 이벤트) 보이는 폭(2700 × 배율 × 픽셀 비율)에 맞는
 * 더 큰 사본을 **뒤에서 받아 디코드까지 끝낸 다음** 바꿔 끼운다(깜박임 없음). 개발 서버·vitest(사본 없음)는 원본 PNG 그대로.
 */
import { memo } from 'preact/compat';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { COAST_PATH, LAND_PATH } from '../../data/world-land';
import { imageEntry, img, imgAt, imgWidths } from '../common/asset';
import { defaultStudentScale, fullScale } from './camera';
import { MAP_H, MAP_W, nodeXY } from './geometry';

export const SEA_IMAGE = 'map/world-sea-chart.png';
export const LAND_TILE = 'map/land-parchment-tile.png';
/** 질감 타일 한 장이 덮는 지도 단위(512px 타일을 이 크기로 줄여 반복) */
const TILE_UNITS = 160;

/** WorldMap 이 지도가 멈출 때 루트(.world-map)에 보내는 이벤트 */
export const MAP_SETTLE_EVENT = 'wm-settle';
export interface MapSettleDetail {
  /** 지도 배율(지도 1단위 = 화면 k px) */
  k: number;
  /** 학생이 확대·축소 몸짓(휠·핀치)을 한 적이 있는가 */
  zoomed: boolean;
}

/** 폭 목록(오름차순)에서 need 이상인 가장 작은 폭(없으면 가장 큰 폭) */
export function pickSeaWidth(widths: readonly number[], need: number): number {
  return widths.find((w) => w >= need) ?? widths[widths.length - 1] ?? 0;
}

const pixelRatio = () => (typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1);

/**
 * 처음 받을 바다 그림 폭: 2700 × 처음 배율 × 기기 픽셀 비율.
 * 처음 배율 = WorldMap 의 첫 카메라(학생 `studentDefaultView` = defaultStudentScale, 그 밖 `fullView` = fullScale)와 같은 계산.
 * 틀 크기를 모르면 WorldMap 과 같은 기본값(1366×640).
 */
export function initialSeaNeed(size: { w: number; h: number } | null, student: boolean, dpr: number): number {
  const v = { w: size && size.w > 0 ? size.w : 1366, h: size && size.h > 0 ? size.h : 640 };
  const k = student ? defaultStudentScale(v) : fullScale(v);
  return Math.round(MAP_W * k * (dpr > 0 ? dpr : 1));
}

function SeaImage() {
  const [loaded, setLoaded] = useState(false);
  const widths = imgWidths(SEA_IMAGE);
  const hasAvif = Boolean(imageEntry(SEA_IMAGE)?.variants.some((v) => v.avif));
  // 사본이 있으면 첫 그리기 뒤(지도 틀 크기를 안 뒤) 폭을 정한다 — 그 전에는 0(src 없음)
  const [w, setW] = useState(0);
  const ref = useRef<HTMLImageElement>(null);
  const cur = useRef(w);
  const busy = useRef(false);

  useLayoutEffect(() => {
    if (!widths.length) return;
    const root = ref.current?.closest?.('.world-map') as HTMLElement | null | undefined;
    const r = root && typeof root.getBoundingClientRect === 'function' ? root.getBoundingClientRect() : null;
    const student = Boolean(root?.classList?.contains('world-map--student'));
    const first = pickSeaWidth(widths, initialSeaNeed(r ? { w: r.width, h: r.height } : null, student, pixelRatio()));
    cur.current = first;
    setW(first);
  }, []);

  useEffect(() => {
    const el = ref.current;
    const root = el?.closest?.('.world-map');
    if (!el || !root || widths.length < 2) return;
    const onSettle = (e: Event) => {
      const curEl = ref.current ?? el;
      const d = (e as CustomEvent<MapSettleDetail>).detail;
      if (!d || !d.zoomed || busy.current) return;
      const next = pickSeaWidth(widths, MAP_W * d.k * pixelRatio());
      if (next <= cur.current) return;
      // 브라우저가 고른 형식(AVIF/WebP) 그대로 큰 사본을 미리 받아 디코드 → 끝나면 바꿔 끼움(그 사이에는 작은 그림이 그대로 보임)
      const format = /\.avif(\?|#|$)/i.test(curEl.currentSrc || '') ? 'avif' : 'webp';
      const pre = new Image();
      pre.decoding = 'async';
      pre.src = imgAt(SEA_IMAGE, next, format);
      busy.current = true;
      const done = (ok: boolean) => {
        busy.current = false;
        if (!ok) return;
        cur.current = next;
        setW(next);
      };
      const p = typeof pre.decode === 'function' ? pre.decode() : new Promise<void>((res, rej) => ((pre.onload = () => res()), (pre.onerror = rej)));
      p.then(() => done(true)).catch(() => done(false));
    };
    root.addEventListener(MAP_SETTLE_EVENT, onSettle);
    return () => root.removeEventListener(MAP_SETTLE_EVENT, onSettle);
  }, []);

  const tag = (
    <img
      ref={ref}
      class={`wm-sea${loaded ? ' is-loaded' : ''}`}
      src={widths.length ? (w ? imgAt(SEA_IMAGE, w, 'webp') : undefined) : img(SEA_IMAGE)}
      alt=""
      width={MAP_W}
      height={MAP_H}
      loading="lazy"
      decoding="async"
      draggable={false}
      data-sea-width={widths.length && w ? w : undefined}
      onLoad={() => setLoaded(true)}
    />
  );
  if (!hasAvif) return tag;
  // 모양(picture > source + img)은 처음부터 같게 둔다 — 폭을 정할 때 img 요소가 새로 만들어지지 않게
  return (
    <picture style={{ display: 'contents' }}>
      <source type="image/avif" srcset={w ? imgAt(SEA_IMAGE, w, 'avif') : undefined} />
      {tag}
    </picture>
  );
}

/** 수에즈 운하(경유점 suez ↔ portSaid)를 육지 위에 가는 물길로 */
function Canal() {
  try {
    const a = nodeXY('suez');
    const b = nodeXY('portSaid');
    return <path class="wm-canal" d={`M${a.x} ${a.y}L${b.x} ${b.y}`} />;
  } catch {
    return null;
  }
}

function LandLayerImpl() {
  return (
    <>
      <SeaImage />
      <svg class="wm-land" viewBox={`0 0 ${MAP_W} ${MAP_H}`} width={MAP_W} height={MAP_H} aria-hidden="true">
        <defs>
          <pattern id="wm-land-tile" patternUnits="userSpaceOnUse" width={TILE_UNITS} height={TILE_UNITS}>
            <image href={img(LAND_TILE)} width={TILE_UNITS} height={TILE_UNITS} preserveAspectRatio="none" />
          </pattern>
        </defs>
        {/* 해안 바깥 번짐(필터 대신 넓은 반투명 선 — 크롬북 성능) */}
        <path d={COAST_PATH} class="wm-coast-glow wm-coast-glow--wide" />
        <path d={COAST_PATH} class="wm-coast-glow" />
        <path d={LAND_PATH} class="wm-land-base" />
        <path d={LAND_PATH} class="wm-land-tex" fill="url(#wm-land-tile)" />
        <path d={COAST_PATH} class="wm-coast" />
        <Canal />
      </svg>
    </>
  );
}

export const LandLayer = memo(LandLayerImpl, () => true);
