/**
 * 헤드리스 학생 봇 페이지(bot-harness.ts)를 Vite로 한 파일로 묶어 앱 주소 아래 `__bots.html`로 끼워 넣는다(작업 107 e2e의 하네스 방식).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';
import { ROOT, type StaticServer } from './voyage-servers';

let js: string | null = null;

async function build(): Promise<string> {
  if (js) return js;
  const { build: viteBuild } = await import('vite');
  const preact = (await import('@preact/preset-vite')).default;
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string };
  const res = await viteBuild({
    configFile: false,
    root: ROOT,
    logLevel: 'error',
    plugins: [preact()],
    resolve: { alias: { '@shared': join(ROOT, 'shared') } },
    define: { __APP_VERSION__: JSON.stringify(pkg.version), __BUILD_TIME__: JSON.stringify('2026-10-09T00:00:00.000Z') },
    build: {
      write: false,
      minify: false,
      emptyOutDir: false,
      cssCodeSplit: false,
      lib: { entry: join(ROOT, 'e2e', 'support', 'bot-harness.ts'), formats: ['es'], fileName: 'bots' },
    },
  });
  const outputs = (Array.isArray(res) ? res : [res]) as { output: { type: string; isEntry?: boolean; code?: string }[] }[];
  const entry = outputs.flatMap((o) => o.output).find((c) => c.type === 'chunk' && c.isEntry);
  if (!entry?.code) throw new Error('봇 페이지를 묶지 못했어요');
  js = entry.code;
  return js;
}

/** 봇 페이지를 정적 서버에 넣고(같은 로컬 출처) 연다 */
export async function openBots(ctx: BrowserContext, web: StaticServer): Promise<Page> {
  const code = await build();
  web.addFile('__bots.html', '<!doctype html><meta charset="utf-8"><title>bots</title><pre id="out">…</pre><script type="module" src="./__bots.js"></script>', 'text/html; charset=utf-8');
  web.addFile('__bots.js', code, 'text/javascript; charset=utf-8');
  const p = await ctx.newPage();
  await p.goto('./__bots.html');
  await p.waitForFunction(() => document.getElementById('out')?.textContent === 'bots ready');
  return p;
}
