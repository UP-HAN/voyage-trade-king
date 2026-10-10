/**
 * 작업 133 — 웹용 이미지 사본(WebP·AVIF·크기별) 빌드 플러그인.
 *
 * - 원본 `assets/images/**.png`(이름이 '_'로 시작하는 폴더·파일 제외)는 **읽기만** 한다. `assets/` 안에는 아무것도 쓰지 않는다.
 * - 빌드(`vite build`) 때만 사본을 만든다. 개발 서버·vitest 에서는 빈 목록 → 화면은 지금처럼 원본 PNG 를 쓴다.
 * - 도구: sharp(libvips, devDependency — 빌드 PC 에서만, 서버 실행에는 들어가지 않음).
 *   한글·공백 경로 대비로 sharp 에 경로 문자열을 넘기지 않는다: readFileSync → Buffer → sharp → Buffer → writeFileSync.
 * - 변환 결과는 `.cache/images/`(git 제외)에 `원본 내용 해시 + 설정` 키로 저장 → 두 번째 빌드부터 변환을 건너뛴다.
 * - sharp 를 못 불러오면(설치 실패 등) 경고만 찍고 빈 목록으로 빌드를 계속한다(원본 PNG 만으로 동작).
 *   재현: `VOYAGE_NO_SHARP=1 npm run build` (sharp 를 못 불러온 것과 같은 길로 간다).
 * - 목록(manifest)은 `define`(`__IMAGE_VARIANTS__`)으로 앱 번들 안에 넣는다(첫 화면에서 따로 받지 않음).
 *   가상 모듈(import) 대신 define 을 쓴 까닭: e2e·리허설 하네스가 `configFile: false` 로 앱 코드를 따로 묶는데,
 *   그때 가상 모듈은 풀리지 않아 빌드가 깨진다. define 은 없으면 `typeof` 검사로 빈 목록이 된다(기존 `__IMAGE_LIST__`와 같은 방식).
 *
 * fs.rmSync·fs.cpSync 는 쓰지 않는다(Windows + Node 24 + 한글 경로에서 프로세스가 죽음 — CLAUDE.md).
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Plugin } from 'vite';

export interface ImageVariant {
  /** 가로 폭(px) */
  w: number;
  /** assets/images/ 아래 경로 */
  webp: string;
  avif?: string;
}
export interface ImageEntry {
  width: number;
  height: number;
  /** 폭 오름차순 */
  variants: ImageVariant[];
}
export type ImageManifest = Record<string, ImageEntry>;

/** 품질 설정(바꾸면 캐시 키·파일 이름 해시가 바뀐다) */
export const WEBP_OPTIONS = { quality: 80, alphaQuality: 100, effort: 5, smartSubsample: true } as const;
/** AVIF: 색 번짐을 막으려 크로마 4:4:4(sharp 기본) */
export const AVIF_OPTIONS = { quality: 55, effort: 4, chromaSubsampling: '4:4:4' } as const;
/** 설정 판 번호 — 변환 방식이 바뀌면 올린다 */
const RECIPE_VERSION = 1;

/**
 * 앱 번들에 넣는 짧은 목록: 경로 → [원본 폭, 원본 높이, 이름 해시, 사본 폭들, AVIF 있음(1/0)].
 * 사본 이름은 `<경로에서 .png 뺀 것>.<해시>.<폭>.webp|avif` 규칙이라 앱(src/ui/common/asset.ts `expandManifest`)이 다시 펼친다.
 * (전체 목록을 그대로 넣으면 첫 화면 스크립트가 약 10KB 커진다)
 */
export type CompactEntry = [number, number, string, number[], 0 | 1];
export function compactManifest(m: ImageManifest): Record<string, CompactEntry> {
  const out: Record<string, CompactEntry> = {};
  for (const [rel, e] of Object.entries(m)) {
    const first = e.variants[0];
    const hash = first ? (/\.([0-9a-f]{8})\.\d+\.webp$/.exec(first.webp)?.[1] ?? '') : '';
    out[rel] = [e.width, e.height, hash, e.variants.map((v) => v.w), e.variants.some((v) => v.avif) ? 1 : 0];
  }
  return out;
}

export interface VariantPlan {
  widths: number[];
  avif: boolean;
  /** 이 그림만 품질을 올릴 때(해도: 어두운 바다의 물결 결이 q80 WebP 에서 뭉개져 q90 — check/sea-chart-x3.png) */
  quality?: { webp: number; avif: number };
}

/**
 * 그림별 사본 규칙(brief 133 표). 원본보다 큰 폭은 만들지 않고, 원본 폭 WebP 는 늘 넣는다(`img()`가 쓰는 기본 사본).
 */
export function variantPlan(rel: string, width: number): VariantPlan {
  const p = rel.replace(/\\/g, '/');
  let wanted: number[];
  let avif = false;
  let quality: VariantPlan['quality'];
  if (p === 'title/keyart.png') {
    wanted = [960, 1280, 1920];
    avif = true;
  } else if (p === 'map/world-sea-chart.png') {
    wanted = [1024, 1600, 2560];
    avif = true;
    quality = { webp: 90, avif: 60 };
  } else if (p === 'map/land-parchment-tile.png') {
    wanted = [];
  } else if (p.startsWith('ports/') || p.startsWith('scenes/')) {
    wanted = [960, 1600];
  } else {
    wanted = width > 512 ? [512] : [];
  }
  const widths = [...new Set([...wanted.filter((w) => w < width), width])].sort((a, b) => a - b);
  return quality ? { widths, avif, quality } : { widths, avif };
}

/** 이름이 '_'로 시작하는 폴더·파일을 뺀 .png 목록(assets/images 기준 상대 경로, '/' 구분) */
export function listPngs(dir: string, base = ''): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('_')) continue;
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listPngs(join(dir, entry.name), rel));
    else if (entry.isFile() && /\.png$/i.test(entry.name)) out.push(rel);
  }
  return out.sort();
}

/**
 * 이 플러그인이 쓰는 sharp 의 일부(타입). sharp 의 타입을 직접 가져오지 않는다 —
 * sharp 가 설치되지 않은 PC 에서도 `tsc --noEmit`(npm run build 의 첫 단계)가 통과해야 해서.
 */
interface SharpPipe {
  metadata(): Promise<{ width?: number; height?: number }>;
  resize(o: { width: number; kernel?: string }): SharpPipe;
  webp(o: Record<string, unknown>): SharpPipe;
  avif(o: Record<string, unknown>): SharpPipe;
  toBuffer(): Promise<Buffer>;
}
type SharpFn = ((input: Buffer) => SharpPipe) & { versions?: { vips?: string } };
/** 변수로 불러와 타입 검사·번들러가 모듈을 미리 찾지 않게 한다(없으면 실행 때 잡아서 경고) */
const SHARP_MODULE = 'sharp';

async function loadSharp(): Promise<SharpFn | null> {
  if (process.env.VOYAGE_NO_SHARP === '1') {
    console.warn('\n[image-variants] 경고: VOYAGE_NO_SHARP=1 — sharp 를 불러오지 않아요. 원본 PNG 만으로 빌드해요(사본·목록 없음).');
    return null;
  }
  try {
    const mod = (await import(/* @vite-ignore */ SHARP_MODULE)) as { default?: SharpFn } & SharpFn;
    return (mod.default ?? mod) as SharpFn;
  } catch (err) {
    console.warn(
      `\n[image-variants] 경고: sharp 를 불러오지 못했어요(${(err as Error)?.message ?? err}). 원본 PNG 만으로 빌드를 계속해요(사본·목록 없음).\n` +
        '  고치려면: npm install (devDependency sharp). 화면은 원본 PNG 로 그대로 동작해요.',
    );
    return null;
  }
}

interface PendingFile {
  /** assets/images/ 아래 출력 경로 */
  out: string;
  /** 캐시 파일 */
  cache: string;
  bytes: number;
}

export interface GenerateResult {
  manifest: ImageManifest;
  files: PendingFile[];
  converted: number;
  cached: number;
  ms: number;
  sharp: boolean;
}

/** 작업 수를 제한해 순서대로 돈다(AVIF 는 CPU 를 많이 쓴다) */
async function pool<T>(items: T[], limit: number, fn: (t: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++]!;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

export async function generateVariants(srcDir: string, cacheDir: string): Promise<GenerateResult> {
  const t0 = Date.now();
  const sharp = await loadSharp();
  const result: GenerateResult = { manifest: {}, files: [], converted: 0, cached: 0, ms: 0, sharp: Boolean(sharp) };
  if (!sharp) return result;
  mkdirSync(cacheDir, { recursive: true });
  const recipe = JSON.stringify({ v: RECIPE_VERSION, webp: WEBP_OPTIONS, avif: AVIF_OPTIONS, vips: sharp.versions?.vips ?? '' });
  const pngs = listPngs(srcDir);
  const entries: [string, ImageEntry][] = [];
  await pool(pngs, 3, async (rel) => {
    try {
      const buf = readFileSync(join(srcDir, ...rel.split('/')));
      const srcHash = createHash('sha256').update(buf).digest('hex');
      const meta = await sharp(buf).metadata();
      const width = meta.width ?? 0;
      const height = meta.height ?? 0;
      if (!width || !height) throw new Error('크기를 읽지 못함');
      const plan = variantPlan(rel, width);
      // 파일 이름 해시: 원본 내용 + 설정(원본이나 품질을 바꾸면 이름이 바뀌어 브라우저 캐시가 섞이지 않음)
      const q = JSON.stringify(plan.quality ?? null);
      const nameHash = createHash('sha256').update(srcHash).update(recipe).update(q).digest('hex').slice(0, 8);
      const stem = rel.replace(/\.png$/i, '');
      const variants: ImageVariant[] = [];
      const files: PendingFile[] = [];
      for (const w of plan.widths) {
        const v: ImageVariant = { w, webp: `${stem}.${nameHash}.${w}.webp` };
        const formats: ('webp' | 'avif')[] = plan.avif ? ['webp', 'avif'] : ['webp'];
        for (const fmt of formats) {
          const key = createHash('sha256').update(srcHash).update(recipe).update(q).update(`${fmt}:${w}`).digest('hex').slice(0, 32);
          const cache = join(cacheDir, `${key}.${fmt}`);
          if (existsSync(cache) && statSync(cache).size > 0) {
            result.cached++;
          } else {
            let pipe = sharp(buf);
            if (w !== width) pipe = pipe.resize({ width: w, kernel: 'lanczos3' });
            const out = fmt === 'webp' ? await pipe.webp({ ...WEBP_OPTIONS, ...(plan.quality ? { quality: plan.quality.webp } : {}) }).toBuffer()
                : await pipe.avif({ ...AVIF_OPTIONS, ...(plan.quality ? { quality: plan.quality.avif } : {}) }).toBuffer();
            writeFileSync(cache, out);
            result.converted++;
          }
          const outRel = fmt === 'webp' ? v.webp : `${stem}.${nameHash}.${w}.avif`;
          if (fmt === 'avif') v.avif = outRel;
          files.push({ out: outRel, cache, bytes: statSync(cache).size });
        }
        variants.push(v);
      }
      entries.push([rel, { width, height, variants }]);
      result.files.push(...files);
    } catch (err) {
      console.warn(`[image-variants] 경고: ${rel} 사본을 만들지 못했어요(${(err as Error)?.message ?? err}) — 이 그림은 원본 PNG 를 써요.`);
    }
  });
  for (const [rel, e] of entries.sort((a, b) => a[0].localeCompare(b[0]))) result.manifest[rel] = e;
  // 모든 그림이 성공했으면 이번에 쓰지 않은 옛 캐시 파일(원본·설정이 바뀌기 전 것)을 지운다(캐시가 끝없이 커지지 않게)
  if (entries.length === pngs.length) {
    const used = new Set(result.files.map((f) => f.cache));
    for (const name of readdirSync(cacheDir)) {
      const full = join(cacheDir, name);
      if (/^[0-9a-f]{32}\.(webp|avif)$/.test(name) && !used.has(full)) {
        try {
          unlinkSync(full);
        } catch {
          /* 무시 */
        }
      }
    }
  }
  result.ms = Date.now() - t0;
  return result;
}

/**
 * Vite 플러그인. `config` 단계에서 사본을 만들고(캐시) 목록을 `__IMAGE_VARIANTS__`로 넣는다.
 * 사본 파일은 번들이 끝난 뒤(`closeBundle`) `dist/assets/images/`에 복사한다(원본 PNG 복사는 voyageBuildOutput 이 함).
 */
export function imageVariants(o: { root: string; srcDir: string; cacheDir: string }): Plugin {
  let result: GenerateResult | null = null;
  let outDir = '';
  return {
    name: 'voyage:image-variants',
    async config(_config, env) {
      const isTest = Boolean(process.env.VITEST) || env.mode === 'test';
      if (env.command !== 'build' || isTest) {
        result = null;
        return { define: { __IMAGE_VARIANTS__: '{}' } };
      }
      result = await generateVariants(o.srcDir, o.cacheDir);
      if (result.sharp) {
        const total = result.files.reduce((s, f) => s + f.bytes, 0);
        console.log(
          `[image-variants] 그림 ${Object.keys(result.manifest).length}개 → 사본 ${result.files.length}개(${(total / 1e6).toFixed(2)} MB), ` +
            `새로 변환 ${result.converted} · 캐시 ${result.cached}, ${(result.ms / 1000).toFixed(1)}초`,
        );
        // 확인용 목록(캐시 폴더 — 배포에 들어가지 않음)
        writeFileSync(
          join(o.cacheDir, 'last-manifest.json'),
          JSON.stringify({ manifest: result.manifest, files: result.files.map((f) => ({ out: f.out, bytes: f.bytes })) }, null, 1),
        );
      }
      return { define: { __IMAGE_VARIANTS__: JSON.stringify(compactManifest(result.manifest)) } };
    },
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      if (!result || !result.files.length) return;
      const dest = join(outDir, 'assets', 'images');
      for (const f of result.files) {
        const to = join(dest, ...f.out.split('/'));
        mkdirSync(dirname(to), { recursive: true });
        copyFileSync(f.cache, to);
      }
    },
  };
}
