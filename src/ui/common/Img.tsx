import { useState } from 'preact/hooks';
import { imageEntry, img, imgSrcSet } from './asset';

export interface ImgProps {
  /** assets/images/ 아래 경로. 예: 'ports/busan.png' */
  path: string;
  alt: string;
  /** 이미지가 없을 때 보일 글자 꼬리표(PRD 8.1-9). 없으면 alt 를 쓴다. */
  fallbackLabel?: string;
  class?: string;
  width?: number;
  height?: number;
  loading?: 'eager' | 'lazy';
  /**
   * (작업 133) `<img sizes>` — 주면 크기별 사본 `srcset`(+ AVIF 사본이 있으면 `<picture>`)을 쓴다. 예: '100vw', '(min-width: 900px) 50vw, 100vw'.
   * 주지 않으면 `srcset` 없이 원본 폭 WebP 하나(`img()`) — srcset 의 폭 설명자는 그림의 고유 크기(naturalWidth)를 sizes 기준으로 바꿔서,
   * 고유 크기에 기대는 기존 배치(캐릭터 썸네일 자르기 등)가 달라지지 않게 기본은 끈다.
   */
  sizes?: string;
}

/**
 * 생성 이미지 표시 + 파일이 없을 때 대체 표시(onError) 예시.
 * <Img path="ports/busan.png" alt="부산항" fallbackLabel="부산" loading="lazy" />
 * (작업 133) 빌드본에서는 원본 폭 WebP 를 쓰고, `sizes`를 주면 크기별 WebP 사본 `srcset`(AVIF 사본이 있으면 `<picture>`로 AVIF 먼저)을 쓴다.
 */
export function Img({ path, alt, fallbackLabel, class: className, width, height, loading, sizes }: ImgProps) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span class={`img-fallback ${className ?? ''}`.trim()} role="img" aria-label={alt}>
        {fallbackLabel ?? alt}
      </span>
    );
  }
  const entry = sizes ? imageEntry(path) : null;
  const sz = sizes ?? '100vw';
  const tag = (
    <img
      class={className}
      src={img(path)}
      srcset={entry ? imgSrcSet(path, 'webp') : undefined}
      sizes={entry ? sz : undefined}
      alt={alt}
      width={width}
      height={height}
      loading={loading}
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
  const avif = entry ? imgSrcSet(path, 'avif') : '';
  if (!avif) return tag;
  return (
    <picture style={{ display: 'contents' }}>
      <source type="image/avif" srcset={avif} sizes={sz} />
      {tag}
    </picture>
  );
}
