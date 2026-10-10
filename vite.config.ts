import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import preact from '@preact/preset-vite';
import { defineConfig, type Plugin } from 'vitest/config';
import { imageVariants } from './scripts/vite-image-variants.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };

/**
 * 이름이 '_'로 시작하는 폴더·파일(_candidates, _check 등 작업용 후보·검수 자료)을 빼고 재귀 복사한다.
 * fs.cpSync 는 쓰지 않는다: Windows + Node 24 에서 한글 경로(이 프로젝트 위치)일 때 cpSync·rmSync 가
 * 오류 없이 프로세스를 죽이는 문제가 있어(0xC0000409), copyFileSync·mkdirSync·fs.promises.rm 만 쓴다.
 */
function copyTree(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (entry.name.startsWith('_')) continue;
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (entry.isDirectory()) copyTree(from, to);
    else if (entry.isFile()) copyFileSync(from, to);
  }
}

/**
 * (작업 134) assets/images 아래에 실제로 있는 그림 목록(빌드·개발 서버 시작 때). '_' 폴더·파일은 뺀다(복사하지 않으므로).
 * 화면은 목록에 없는 그림을 요청하지 않고 바로 대체 표시로 간다(404 없음) — src/ui/common/asset.ts.
 */
function listImages(dir: string, base = ''): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('_')) continue;
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listImages(join(dir, entry.name), rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out.sort();
}

/**
 * (1) 빌드 시작 때 출력 폴더(dist/)를 비운다 — Vite 기본 emptyOutDir 는 내부에서 fs.rmSync 를 써서
 *     위 문제로 죽기 때문에 끄고(build.emptyOutDir: false) 여기서 fs.promises.rm 으로 대신 비운다.
 * (2) assets/images/** 를 빌드 결과 dist/assets/images/ 로 그대로 복사한다.
 *   - assets/ 폴더는 이동·수정하지 않는다(읽기만).
 *   - 개발 서버에서는 Vite 가 프로젝트 루트의 assets/images/... 를 그대로 제공하므로 복사가 필요 없다.
 *   - Vite 해시 출력은 build.assetsDir('static')로 보내 assets/ 와 부딪히지 않게 한다.
 */
function voyageBuildOutput(): Plugin {
  let outDir = '';
  const srcDir = join(root, 'assets', 'images');
  return {
    name: 'voyage:build-output',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    async buildStart() {
      const rel = relative(root, outDir);
      // 안전장치: 프로젝트 안의 하위 폴더일 때만 비운다.
      if (!rel || rel.startsWith('..') || resolve(root, rel) !== outDir) return;
      await rm(outDir, { recursive: true, force: true });
    },
    closeBundle() {
      if (!existsSync(srcDir)) return;
      copyTree(srcDir, join(outDir, 'assets', 'images'));
    },
  };
}

export default defineConfig({
  // 상대 경로 빌드: 같은 dist/ 가 /voyage/, /other/path/ 등 어느 하위 경로에서나 동작한다.
  base: './',
  // (작업 133) imageVariants: 빌드 때 assets/images/**.png 의 WebP·AVIF·크기별 사본을 만들어(.cache/images 캐시) dist 에 넣고
  // 목록을 __IMAGE_VARIANTS__ 로 앱에 넣는다. 개발 서버·vitest 는 빈 목록(원본 PNG).
  plugins: [preact(), voyageBuildOutput(), imageVariants({ root, srcDir: join(root, 'assets', 'images'), cacheDir: join(root, '.cache', 'images') })],
  resolve: {
    alias: {
      '@shared': join(root, 'shared'),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __IMAGE_LIST__: JSON.stringify(listImages(join(root, 'assets', 'images'))),
  },
  build: {
    outDir: 'dist',
    // 해시가 붙는 JS·CSS·글꼴 출력 폴더. 'assets'(생성 이미지 폴더)와 겹치지 않게 'static'으로 둔다.
    assetsDir: 'static',
    // 출력 폴더 비우기는 voyageBuildOutput 플러그인이 한다(위 설명).
    emptyOutDir: false,
  },
  server: {
    port: 5173,
  },
  preview: {
    port: 4173,
  },
  test: {
    include: [
      'tests/**/*.test.{ts,tsx}',
      'src/**/*.test.{ts,tsx}',
      'shared/**/*.test.ts',
      'server/src/**/*.test.ts',
      'server/scripts/**/*.test.ts',
      'scripts/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
    environment: 'node',
  },
});
