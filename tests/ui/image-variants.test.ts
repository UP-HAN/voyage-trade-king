/**
 * 작업 133 — 웹용 이미지 사본: 사본 규칙·짧은 목록 펼치기·화면 헬퍼(img/imgSrcSet/imgCss/imgAt)·sharp 없을 때 빈 목록·캐시.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { compactManifest, generateVariants, listPngs, variantPlan, type ImageManifest } from '../../scripts/vite-image-variants';
import { createImageHelpers, expandManifest, img, imgSrcSet, imgCss } from '../../src/ui/common/asset';
import { initialSeaNeed, pickSeaWidth } from '../../src/ui/map/LandLayer';

describe('variantPlan (brief 133 표)', () => {
  it('키아트 960/1280/1920 + AVIF', () => {
    expect(variantPlan('title/keyart.png', 1920)).toEqual({ widths: [960, 1280, 1920], avif: true });
  });
  it('해도 1024/1600/2560 + 원본 폭(2700) + AVIF', () => {
    expect(variantPlan('map/world-sea-chart.png', 2700)).toEqual({ widths: [1024, 1600, 2560, 2700], avif: true, quality: { webp: 90, avif: 60 } });
  });
  it('육지 타일은 원본 폭만', () => {
    expect(variantPlan('map/land-parchment-tile.png', 512)).toEqual({ widths: [512], avif: false });
  });
  it('항구·장면 960/1600 + 원본 폭', () => {
    expect(variantPlan('ports/busan.png', 1920)).toEqual({ widths: [960, 1600, 1920], avif: false });
    expect(variantPlan('scenes/byeokrando.png', 1920).widths).toEqual([960, 1600, 1920]);
  });
  it('그 밖은 원본 폭 + (512보다 크면) 512, 원본보다 큰 폭은 만들지 않음', () => {
    expect(variantPlan('goods/car.png', 256)).toEqual({ widths: [256], avif: false });
    expect(variantPlan('characters/sheet-main.png', 1536)).toEqual({ widths: [512, 1536], avif: false });
    expect(variantPlan('ports/tiny.png', 800).widths).toEqual([800]);
  });
});

const FULL: ImageManifest = {
  'title/keyart.png': {
    width: 1920,
    height: 1080,
    variants: [
      { w: 960, webp: 'title/keyart.1a2b3c4d.960.webp', avif: 'title/keyart.1a2b3c4d.960.avif' },
      { w: 1280, webp: 'title/keyart.1a2b3c4d.1280.webp', avif: 'title/keyart.1a2b3c4d.1280.avif' },
      { w: 1920, webp: 'title/keyart.1a2b3c4d.1920.webp', avif: 'title/keyart.1a2b3c4d.1920.avif' },
    ],
  },
  'goods/car.png': { width: 256, height: 256, variants: [{ w: 256, webp: 'goods/car.0badf00d.256.webp' }] },
};

describe('짧은 목록 ↔ 펼친 목록', () => {
  it('compactManifest → expandManifest 가 같은 목록', () => {
    expect(expandManifest(compactManifest(FULL))).toEqual(FULL);
  });
  it('모양이 틀린 항목은 버린다', () => {
    expect(expandManifest({ a: [1, 2, 'zz', [1], 0], b: 'x', c: [10, 10, '12345678', [], 0] })).toEqual({});
    expect(expandManifest(null)).toEqual({});
  });
});

describe('화면 헬퍼', () => {
  const h = createImageHelpers({ manifest: FULL, imageSet: new Set(['title/keyart.png', 'goods/car.png', 'ports/busan.png']), base: './' });
  it('img 는 원본 폭 WebP, 목록에 없으면 원본 PNG, 빌드에 없으면 MISSING', () => {
    expect(h.img('title/keyart.png')).toBe('./assets/images/title/keyart.1a2b3c4d.1920.webp');
    expect(h.img('goods/car.png')).toBe('./assets/images/goods/car.0badf00d.256.webp');
    expect(h.img('ports/busan.png')).toBe('./assets/images/ports/busan.png');
    expect(h.img('ports/nowhere.png')).toBe('data:,');
  });
  it('imgSrcSet: 폭 설명자 목록, AVIF 없으면 빈 문자열', () => {
    expect(h.imgSrcSet('title/keyart.png')).toBe(
      './assets/images/title/keyart.1a2b3c4d.960.webp 960w, ./assets/images/title/keyart.1a2b3c4d.1280.webp 1280w, ./assets/images/title/keyart.1a2b3c4d.1920.webp 1920w',
    );
    expect(h.imgSrcSet('title/keyart.png', 'avif', { maxWidth: 1280 })).toBe(
      './assets/images/title/keyart.1a2b3c4d.960.avif 960w, ./assets/images/title/keyart.1a2b3c4d.1280.avif 1280w',
    );
    expect(h.imgSrcSet('goods/car.png', 'avif')).toBe('');
    expect(h.imgSrcSet('ports/busan.png')).toBe('./assets/images/ports/busan.png');
  });
  it('imgCss: maxWidth 이하 가장 큰 사본의 image-set(AVIF → WebP), 못 읽는 브라우저는 url()', () => {
    expect(h.imgCss('title/keyart.png', { maxWidth: 1920 })).toBe(
      'image-set(url("./assets/images/title/keyart.1a2b3c4d.1920.avif") type("image/avif"), url("./assets/images/title/keyart.1a2b3c4d.1920.webp") type("image/webp"))',
    );
    expect(h.imgCss('title/keyart.png', { maxWidth: 1000 })).toContain('keyart.1a2b3c4d.960.avif');
    expect(h.imgCss('ports/busan.png')).toBe('url("./assets/images/ports/busan.png")');
    const old = createImageHelpers({ manifest: FULL, imageSet: null, base: './', supportsImageSet: () => false });
    expect(old.imgCss('title/keyart.png', { maxWidth: 1920 })).toBe('url("./assets/images/title/keyart.1a2b3c4d.1920.webp")');
  });
  it('imgAt: minWidth 이상 가장 작은 사본, 없으면 가장 큰 사본', () => {
    expect(h.imgAt('title/keyart.png', 1000)).toBe('./assets/images/title/keyart.1a2b3c4d.1280.webp');
    expect(h.imgAt('title/keyart.png', 5000, 'avif')).toBe('./assets/images/title/keyart.1a2b3c4d.1920.avif');
    expect(h.imgWidths('title/keyart.png')).toEqual([960, 1280, 1920]);
  });
  it('vitest(목록 없음)에서는 지금처럼 원본 PNG', () => {
    expect(img('title/keyart.png')).toMatch(/assets\/images\/title\/keyart\.png$/);
    expect(imgSrcSet('title/keyart.png', 'avif')).toBe('');
    expect(imgCss('title/keyart.png', { maxWidth: 1920 })).toMatch(/^url\(".*keyart\.png"\)$/);
  });
  it('pickSeaWidth: 화면 폭 × 픽셀 비율 이상인 가장 작은 사본', () => {
    const ws = [1024, 1600, 2560, 2700];
    expect(pickSeaWidth(ws, 1366)).toBe(1600);
    expect(pickSeaWidth(ws, 2360)).toBe(2560);
    expect(pickSeaWidth(ws, 4917)).toBe(2700);
    expect(pickSeaWidth([], 1000)).toBe(0);
  });
  it('initialSeaNeed (수정 1회차): 2700 × 처음 배율 × 픽셀 비율 — 학생 기본 보기는 원본 폭, 전체 보기는 화면 폭 정도', () => {
    const ws = [1024, 1600, 2560, 2700];
    // 학생 1366×(지도 틀 약 610): 기본 배율 1366/750 ≈ 1.82 → 약 4918px → 2700
    expect(initialSeaNeed({ w: 1366, h: 610 }, true, 1)).toBe(Math.round(2700 * (1366 / 750)));
    expect(pickSeaWidth(ws, initialSeaNeed({ w: 1366, h: 610 }, true, 1))).toBe(2700);
    expect(pickSeaWidth(ws, initialSeaNeed({ w: 1180, h: 660 }, true, 2))).toBe(2700);
    // 교사·공용 화면 전체 보기 1366×640: 배율 min(1366/2700, 640/1350) ≈ 0.474 → 약 1280px → 1600
    expect(pickSeaWidth(ws, initialSeaNeed({ w: 1366, h: 640 }, false, 1))).toBe(1600);
    // 틀 크기를 모르면 1366×640 기본값
    expect(initialSeaNeed(null, false, 1)).toBe(initialSeaNeed({ w: 1366, h: 640 }, false, 1));
  });
});

/** 단색 RGBA PNG(시험용 — sharp 없이 zlib 으로 만든다) */
function solidPng(w: number, h: number, rgba: [number, number, number, number]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const row = Buffer.alloc(1 + w * 4);
  for (let x = 0; x < w; x++) row.set(rgba, 1 + x * 4);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const SHARP_MODULE = 'sharp';
const HAS_SHARP = await import(/* @vite-ignore */ SHARP_MODULE).then(
  () => true,
  () => false,
);

describe('generateVariants (sharp)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'voyage133-'));
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('sharp 를 못 불러오면(VOYAGE_NO_SHARP=1) 경고와 함께 빈 목록', async () => {
    const prev = process.env.VOYAGE_NO_SHARP;
    process.env.VOYAGE_NO_SHARP = '1';
    try {
      const r = await generateVariants(join(dir, 'src'), join(dir, 'cache'));
      expect(r.sharp).toBe(false);
      expect(r.manifest).toEqual({});
      expect(r.files).toEqual([]);
    } finally {
      if (prev === undefined) delete process.env.VOYAGE_NO_SHARP;
      else process.env.VOYAGE_NO_SHARP = prev;
    }
  });

  // sharp 가 없는 PC(설치 실패)에서는 이 시험만 건너뛴다 — 빌드는 그때도 원본 PNG 로 계속된다(위 시험)
  it.skipIf(!HAS_SHARP)('사본을 만들고 두 번째는 캐시를 쓴다, "_" 폴더는 뺀다', async () => {
    const src = join(dir, 'src');
    mkdirSync(join(src, 'characters'), { recursive: true });
    mkdirSync(join(src, '_candidates'), { recursive: true });
    const png = solidPng(600, 300, [200, 120, 40, 204]);
    writeFileSync(join(src, 'characters', 'a.png'), png);
    writeFileSync(join(src, '_candidates', 'b.png'), png);
    expect(listPngs(src)).toEqual(['characters/a.png']);
    const cache = join(dir, 'cache');
    const r1 = await generateVariants(src, cache);
    expect(r1.sharp).toBe(true);
    const e = r1.manifest['characters/a.png']!;
    expect(e.width).toBe(600);
    expect(e.variants.map((v) => v.w)).toEqual([512, 600]);
    expect(e.variants[0]!.webp).toMatch(/^characters\/a\.[0-9a-f]{8}\.512\.webp$/);
    expect(r1.converted).toBe(2);
    expect(readdirSync(cache).filter((f) => f.endsWith('.webp'))).toHaveLength(2);
    const r2 = await generateVariants(src, cache);
    expect(r2.converted).toBe(0);
    expect(r2.cached).toBe(2);
    expect(r2.manifest).toEqual(r1.manifest);
    for (const f of r2.files) expect(existsSync(f.cache)).toBe(true);
  }, 60_000);
});
