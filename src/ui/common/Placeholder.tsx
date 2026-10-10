import type { ComponentChildren } from 'preact';

/** 아직 만들지 않은 화면의 자리표시: 제목 + "준비 중" */
export function Placeholder({ title, testId, children }: { title: string; testId: string; children?: ComponentChildren }) {
  return (
    <main class="placeholder" data-testid={testId}>
      <h1 class="title-font">{title}</h1>
      <p class="placeholder__status">준비 중</p>
      {children}
      <p>
        <a class="link-small" href="#/">
          처음 화면으로
        </a>
      </p>
    </main>
  );
}
