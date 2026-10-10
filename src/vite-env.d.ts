/// <reference types="vite/client" />

/** package.json 의 version (vite.config.ts define) */
declare const __APP_VERSION__: string;
/** 빌드(또는 개발 서버 시작) 시각, ISO 8601 (vite.config.ts define) */
declare const __BUILD_TIME__: string;
/** (작업 134) 빌드(또는 개발 서버 시작) 때 assets/images 아래에 있던 그림 경로 목록(예: 'ports/busan.png') (vite.config.ts define) */
declare const __IMAGE_LIST__: readonly string[];
/**
 * (작업 133) 빌드 때 만든 웹용 이미지 사본 목록(vite.config.ts → scripts/vite-image-variants.ts).
 * 짧은 형태: 원본 경로(예: 'title/keyart.png') → [원본 폭, 원본 높이, 이름 해시, 사본 폭들, AVIF 있음(1/0)].
 * 앱은 src/ui/common/asset.ts `expandManifest`로 { width, height, variants: [{ w, webp, avif? }] }로 펼친다. 개발 서버·vitest 에서는 빈 객체.
 */
declare const __IMAGE_VARIANTS__: Record<string, [number, number, string, number[], 0 | 1]>;
