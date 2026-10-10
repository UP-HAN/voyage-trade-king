/**
 * 작업 135 리허설 — 봇 페이지(bot-page.ts)를 Vite로 한 파일로 묶어 앱과 같은 주소 `<base>__rehearsal-bots.html`로 끼워 넣는다.
 * 정적 서버를 고치지 않고 **page.route**로 그 주소만 가로채 주므로 로컬·운영 대상 모두 같은 방식이다(같은 출처 → 중계 주소 `./ws`).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';
import { ROOT } from '../../e2e/support/voyage-servers';

let js: string | null = null;

async function bundle(): Promise<string> {
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
    define: { __APP_VERSION__: JSON.stringify(pkg.version), __BUILD_TIME__: JSON.stringify('2026-10-10T00:00:00.000Z') },
    build: {
      write: false,
      minify: false,
      emptyOutDir: false,
      cssCodeSplit: false,
      lib: { entry: join(ROOT, 'tests', 'rehearsal', 'bot-page.ts'), formats: ['es'], fileName: 'bots' },
    },
  });
  const outputs = (Array.isArray(res) ? res : [res]) as { output: { type: string; isEntry?: boolean; code?: string }[] }[];
  const entry = outputs.flatMap((o) => o.output).find((c) => c.type === 'chunk' && c.isEntry);
  if (!entry?.code) throw new Error('봇 페이지를 묶지 못했어요');
  js = entry.code;
  return js;
}

/**
 * 앱 빌드의 APP_VERSION(패키지 버전 + 빌드 시각)을 읽는다 — 봇이 교사(호스트)와 같은 버전을 보내야 '새로 고침해 주세요'가 뜨지 않는다.
 * 빌드 결과 JS 안의 `0.1.0+${`2026-…Z`.replace…}` 모양을 찾는다(못 찾으면 빈 문자열 → 봇 번들 기본값).
 */
export async function readAppVersion(base: string): Promise<string> {
  try {
    const html = await (await fetch(base, { cache: 'no-store' })).text();
    const entry = /src="\.?\/?(static\/index-[^"]+\.js)"/.exec(html)?.[1];
    if (!entry) return '';
    const seen = new Set<string>();
    const queue = [entry];
    while (queue.length && seen.size < 30) {
      const rel = queue.shift()!;
      if (seen.has(rel)) continue;
      seen.add(rel);
      const code = await (await fetch(new URL(rel, base).href, { cache: 'no-store' })).text();
      const m = /`(\d+\.\d+\.\d+)\+\$\{`(\d{4}-\d\d-\d\dT[\d:.]+Z)`/.exec(code);
      if (m) return `${m[1]}+${m[2]!.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}`;
      for (const im of code.matchAll(/["'`]\.\/([\w.-]+\.js)["'`]/g)) queue.push(`static/${im[1]}`);
    }
  } catch {
    /* 못 읽음 */
  }
  return '';
}

/**
 * 봇 페이지를 연다.
 * - 로컬: 정적 서버에 파일로 끼워 넣는다(web.addFile). page.route로 만든 응답은 '실제 로컬 출처'가 아니어서 크롬의 로컬 네트워크 검사가
 *   127.0.0.1 WebSocket을 막는다(ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS — 114 e2e와 같은 이유).
 * - 운영 대상: 정적 서버를 고칠 수 없으므로 page.route로 같은 주소를 가로채 준다(공개 주소라 로컬 네트워크 검사 대상이 아님).
 */
export async function openBotPage(ctx: BrowserContext, base: string, web?: { addFile(rel: string, body: string, type: string): void }): Promise<Page> {
  const code = await bundle();
  const html = '<!doctype html><meta charset="utf-8"><title>rehearsal bots</title><pre id="out">…</pre><script type="module" src="./__rehearsal-bots.js"></script>';
  if (web) {
    web.addFile('__rehearsal-bots.html', html, 'text/html; charset=utf-8');
    web.addFile('__rehearsal-bots.js', code, 'text/javascript; charset=utf-8');
  } else {
    await ctx.route(new URL('__rehearsal-bots.html', base).href, (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
    await ctx.route(new URL('__rehearsal-bots.js', base).href, (r) => r.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: code }));
  }
  const p = await ctx.newPage();
  await p.goto(new URL('__rehearsal-bots.html', base).href);
  await p.waitForFunction(() => document.getElementById('out')?.textContent === 'bots ready', undefined, { timeout: 30_000 });
  return p;
}
