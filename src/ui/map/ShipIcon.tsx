/**
 * 지도 위 배 아이콘. 배 이미지(assets/images/ships/ship-small.png)가 있으면 그 이미지를,
 * 없으면 단순 SVG 배 실루엣을 그린다. 어느 쪽이든 깃발(색 + 문양)을 올린다.
 */
import { useEffect, useState } from 'preact/hooks';
import { img } from '../common/asset';

export const SHIP_IMAGE_PATH = 'ships/ship-small.png';

type ImageState = 'unknown' | 'ok' | 'missing';
let shipImageState: ImageState = 'unknown';
let probe: Promise<ImageState> | null = null;
const listeners = new Set<(s: ImageState) => void>();

/** 배 이미지가 있는지 한 번만 알아본다(브라우저가 아니면 'missing') */
function probeShipImage(): Promise<ImageState> {
  if (probe) return probe;
  probe = new Promise<ImageState>((resolve) => {
    if (typeof Image === 'undefined') return resolve('missing');
    const im = new Image();
    im.onload = () => resolve('ok');
    im.onerror = () => resolve('missing');
    im.src = img(SHIP_IMAGE_PATH);
  }).then((s) => {
    shipImageState = s;
    listeners.forEach((fn) => fn(s));
    return s;
  });
  return probe;
}

export function useShipImage(): ImageState {
  const [state, setState] = useState<ImageState>(shipImageState);
  useEffect(() => {
    if (shipImageState !== 'unknown') return;
    listeners.add(setState);
    void probeShipImage();
    return () => {
      listeners.delete(setState);
    };
  }, []);
  return state;
}

/** 깃발 문양(6종, PRD 6.1). 10×10 상자 안의 단순한 모양 */
const EMBLEM_PATHS: Record<string, string> = {
  anchor: 'M5 1.5a1.2 1.2 0 1 1 0 2.4a1.2 1.2 0 1 1 0-2.4M5 3.9V8.6M3 5.2H7M1.8 6.6Q2.5 8.8 5 8.8Q7.5 8.8 8.2 6.6',
  compass: 'M5 1L6.2 5L5 9L3.8 5ZM1 5L5 3.8L9 5L5 6.2Z',
  star: 'M5 1L6.1 3.9L9.2 4L6.8 5.9L7.6 8.9L5 7.2L2.4 8.9L3.2 5.9L0.8 4L3.9 3.9Z',
  fish: 'M1.5 5Q4 2 7 5Q4 8 1.5 5ZM7 5L9 3.3V6.7Z',
  wave: 'M0.8 6Q2.2 3.6 3.6 6T6.4 6T9.2 6M0.8 8.2Q2.2 5.8 3.6 8.2T6.4 8.2T9.2 8.2',
  lighthouse: 'M4 2H6L6.8 9H3.2ZM3.4 2L5 0.8L6.6 2M2 3.2L3.6 3.6M8 3.2L6.4 3.6',
};

export function emblemPath(emblem: string): string | null {
  return EMBLEM_PATHS[emblem] ?? null;
}

export interface ShipIconProps {
  color: string;
  emblem: string;
  /** 화면 크기(px) */
  size: number;
  /** 내 배: 금색 테두리 */
  mine?: boolean;
}

/** 실루엣 배(40×40 상자). 이미지가 없을 때 쓴다 */
function Silhouette() {
  return (
    <g>
      <path d="M5 26H35L30 34H10Z" fill="#5A4329" stroke="#2B2318" stroke-width="1.4" stroke-linejoin="round" />
      <path d="M19.5 6V26" stroke="#2B2318" stroke-width="1.6" />
      <path d="M19 9L9.5 24H19Z" fill="#EFE2BF" stroke="#2B2318" stroke-width="1.1" stroke-linejoin="round" />
      <path d="M20.5 11L29 24H20.5Z" fill="#E4D3A8" stroke="#2B2318" stroke-width="1.1" stroke-linejoin="round" />
    </g>
  );
}

export function ShipIcon({ color, emblem, size, mine }: ShipIconProps) {
  const image = useShipImage();
  const ep = emblemPath(emblem);
  return (
    <svg class="wm-ship-icon" width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      {mine && <circle cx="20" cy="21" r="18.5" fill="rgba(12,34,48,0.55)" stroke="#DCAA48" stroke-width="2.6" />}
      {image === 'ok' ? <image href={img(SHIP_IMAGE_PATH)} x="3" y="5" width="34" height="32" /> : <Silhouette />}
      {/* 깃발 */}
      <path d="M20 2.5H31.5V10.5H20Z" fill={color} stroke="#2B2318" stroke-width="1" />
      {mine && ep && (
        <g transform="translate(21.4 2.9) scale(0.72)">
          <path d={ep} fill="none" stroke="#EFE2BF" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        </g>
      )}
    </svg>
  );
}
