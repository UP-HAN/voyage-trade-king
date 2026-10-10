/**
 * 생성 이미지(assets/images/**) 경로 헬퍼.
 * - 빌드: vite.config.ts 가 assets/images 를 dist/assets/images 로 복사하고, base './' 이므로 `./assets/images/...`
 * - 개발 서버: Vite 가 프로젝트 루트의 assets/images 를 그대로 제공하므로 `/assets/images/...`
 * 해시 라우팅이라 문서 주소의 폴더가 항상 index.html 위치이므로, 상대 경로가 어느 하위 경로에서나 맞는다.
 *
 * 예) img('ports/busan.png') → './assets/images/ports/busan.png'
 *
 * (작업 133) 빌드본에는 웹용 사본(WebP, 큰 그림은 AVIF·크기별)이 있다 — 목록은 `__IMAGE_VARIANTS__`(scripts/vite-image-variants.ts).
 * - `img(path)`: 목록에 있으면 **원본 폭 WebP** 주소(모든 호출처가 자동으로 작아짐 — 크기·border-image 조각 값이 그대로 맞음).
 * - `imgSrcSet(path, format)`: `<img srcset>`·`<picture><source srcset>`용 "주소 폭w, …". 목록이 비면 원본 하나.
 * - `imgCss(path, { maxWidth })`: CSS `image-set()`(AVIF → WebP, `type()` 표기). 목록이 비거나 브라우저가 못 읽으면 `url(...)`.
 * - `imgAt(path, minWidth, format)`: 폭이 minWidth 이상인 가장 작은 사본(없으면 가장 큰 것) 주소 — 해도 크기 고르기용.
 * 개발 서버·vitest 에서는 목록이 비어 지금처럼 원본 PNG 를 쓴다.
 */
export const IMAGE_ROOT = 'assets/images/';

/**
 * (작업 134) 없는 그림 대신 쓰는 주소: 네트워크 요청 없이 바로 onError 가 나서 각 화면의 대체 표시(키아트·해도·글자 꼬리표)로 간다.
 */
export const MISSING_IMAGE = 'data:,';

export interface ImageVariant {
  w: number;
  webp: string;
  avif?: string;
}
export interface ImageEntry {
  width: number;
  height: number;
  variants: ImageVariant[];
}
export type ImageManifest = Readonly<Record<string, ImageEntry>>;
export type ImageFormat = 'webp' | 'avif';

/** 빌드(개발 서버는 시작) 때 있던 그림 목록. 모르면 null(그대로 요청) */
const IMAGE_SET: ReadonlySet<string> | null =
  typeof __IMAGE_LIST__ !== 'undefined' && Array.isArray(__IMAGE_LIST__) ? new Set<string>(__IMAGE_LIST__) : null;

/**
 * 빌드가 넣은 짧은 목록([폭, 높이, 해시, 사본 폭들, AVIF 1/0])을 펼친다.
 * 사본 이름 규칙(scripts/vite-image-variants.ts): `<경로에서 .png 뺀 것>.<해시>.<폭>.webp|avif`. 모양이 틀린 항목은 버린다(원본 PNG).
 */
export function expandManifest(raw: unknown): ImageManifest {
  const out: Record<string, ImageEntry> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [rel, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(v) || v.length < 5) continue;
    const [width, height, hash, widths, avif] = v as [unknown, unknown, unknown, unknown, unknown];
    if (typeof width !== 'number' || typeof height !== 'number' || typeof hash !== 'string' || !/^[0-9a-f]{8}$/.test(hash) || !Array.isArray(widths)) continue;
    const stem = rel.replace(/\.png$/i, '');
    const variants = widths
      .filter((w): w is number => typeof w === 'number' && w > 0)
      .sort((a, b) => a - b)
      .map((w) => ({ w, webp: `${stem}.${hash}.${w}.webp`, ...(avif ? { avif: `${stem}.${hash}.${w}.avif` } : {}) }));
    if (variants.length) out[rel] = { width, height, variants };
  }
  return out;
}

/** 빌드 때 만든 사본 목록. 개발 서버·vitest·하네스 묶음에서는 빈 목록 */
const MANIFEST: ImageManifest = expandManifest(typeof __IMAGE_VARIANTS__ !== 'undefined' ? __IMAGE_VARIANTS__ : null);

const cleanPath = (path: string) => path.replace(/\\/g, '/').replace(/^\.?\/+/, '');

const encodePath = (clean: string) =>
  clean
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');

export interface ImageHelpers {
  hasImage(path: string): boolean;
  img(path: string): string;
  imgSrcSet(path: string, format?: ImageFormat, opts?: { maxWidth?: number }): string;
  imgCss(path: string, opts?: { maxWidth?: number }): string;
  imgAt(path: string, minWidth: number, format?: ImageFormat): string;
  imgWidths(path: string): number[];
  imageEntry(path: string): ImageEntry | null;
}

/** 목록·그림 집합·기본 주소를 받아 헬퍼를 만든다(시험에서 가짜 목록으로 부르려고 나눔) */
export function createImageHelpers(o: {
  manifest: ImageManifest;
  imageSet: ReadonlySet<string> | null;
  base: string;
  /** CSS image-set() 을 읽는가(모르면 true) */
  supportsImageSet?: () => boolean;
}): ImageHelpers {
  const { manifest, imageSet, base } = o;
  const url = (rel: string) => `${base}${IMAGE_ROOT}${encodePath(rel)}`;
  const has = (clean: string) => !imageSet || imageSet.has(clean);
  const entryOf = (path: string): ImageEntry | null => {
    const clean = cleanPath(path);
    if (!has(clean)) return null;
    const e = manifest[clean];
    return e && Array.isArray(e.variants) && e.variants.length ? e : null;
  };
  const original = (path: string): string => {
    const clean = cleanPath(path);
    // 빌드에 없는 그림은 요청하지 않는다(404 대신 바로 대체 표시)
    if (!has(clean)) return MISSING_IMAGE;
    return url(clean);
  };
  const fileOf = (v: ImageVariant, format: ImageFormat): string | null => (format === 'avif' ? v.avif ?? null : v.webp);
  /** maxWidth 이하 중 가장 큰 사본(없으면 가장 작은 사본) */
  const atMost = (e: ImageEntry, maxWidth: number): ImageVariant => {
    const fit = e.variants.filter((v) => v.w <= maxWidth);
    return fit.length ? fit[fit.length - 1]! : e.variants[0]!;
  };

  const helpers: ImageHelpers = {
    hasImage: (path) => has(cleanPath(path)),
    imageEntry: entryOf,
    imgWidths: (path) => entryOf(path)?.variants.map((v) => v.w) ?? [],
    img(path) {
      const e = entryOf(path);
      if (!e) return original(path);
      const full = e.variants.find((v) => v.w === e.width) ?? e.variants[e.variants.length - 1]!;
      return url(full.webp);
    },
    imgSrcSet(path, format = 'webp', opts = {}) {
      const e = entryOf(path);
      if (!e) return format === 'webp' ? original(path) : '';
      const max = opts.maxWidth ?? Infinity;
      const list = e.variants.filter((v, i) => v.w <= max || i === 0);
      const parts = list.map((v) => fileOf(v, format)).every(Boolean) ? list.map((v) => `${url(fileOf(v, format)!)} ${v.w}w`) : [];
      return parts.join(', ');
    },
    imgCss(path, opts = {}) {
      const e = entryOf(path);
      if (!e) return `url("${original(path)}")`;
      const v = atMost(e, opts.maxWidth ?? Infinity);
      const webp = `url("${url(v.webp)}")`;
      if (!v.avif) return webp;
      const set = `image-set(url("${url(v.avif)}") type("image/avif"), url("${url(v.webp)}") type("image/webp"))`;
      const ok = o.supportsImageSet ? o.supportsImageSet() : true;
      return ok ? set : webp;
    },
    imgAt(path, minWidth, format = 'webp') {
      const e = entryOf(path);
      if (!e) return original(path);
      const v = e.variants.find((x) => x.w >= minWidth) ?? e.variants[e.variants.length - 1]!;
      return url(fileOf(v, format) ?? v.webp);
    },
  };
  return helpers;
}

let imageSetSupport: boolean | null = null;
/** CSS `image-set(... type())`를 읽는 브라우저인가(못 읽으면 imgCss 가 WebP url() 로) */
function supportsImageSet(): boolean {
  if (imageSetSupport !== null) return imageSetSupport;
  try {
    imageSetSupport =
      typeof CSS === 'undefined' || typeof CSS.supports !== 'function'
        ? true
        : CSS.supports('background-image', 'image-set(url("a.avif") type("image/avif"), url("a.webp") type("image/webp"))');
  } catch {
    imageSetSupport = true;
  }
  return imageSetSupport;
}

const helpers = createImageHelpers({ manifest: MANIFEST, imageSet: IMAGE_SET, base: import.meta.env.BASE_URL, supportsImageSet });

/** 이 그림이 빌드에 있는가(목록을 모르면 true) */
export const hasImage = helpers.hasImage;
/** 원본 폭 WebP(빌드본) 또는 원본 PNG 주소 */
export const img = helpers.img;
/** `<img srcset>`·`<source srcset>` 문자열(목록이 비면 원본 하나, AVIF 가 없으면 '') */
export const imgSrcSet = helpers.imgSrcSet;
/** CSS 배경 값(`image-set()` 또는 `url()`) */
export const imgCss = helpers.imgCss;
/** 폭이 minWidth 이상인 가장 작은 사본 주소 */
export const imgAt = helpers.imgAt;
/** 사본 폭 목록(오름차순, 없으면 빈 배열) */
export const imgWidths = helpers.imgWidths;
export const imageEntry = helpers.imageEntry;
