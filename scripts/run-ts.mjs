// TypeScript 스크립트 실행기: `node scripts/run-ts.mjs <파일.ts> [인자...]`
// Vite 모듈 러너(runnerImport)로 불러오므로 추가 의존성 없이 TS·확장자 없는 import·`@shared/*` 별칭을 쓸 수 있다.
// 불러온 모듈이 기본 내보내기 함수를 가지면 (인자 배열)로 호출하고, 숫자를 돌려주면 그 값을 종료 코드로 쓴다.
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runnerImport } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const [target, ...args] = process.argv.slice(2);
if (!target) {
  console.error('사용법: node scripts/run-ts.mjs <파일.ts> [인자...]');
  process.exit(2);
}

try {
  const { module } = await runnerImport(pathToFileURL(resolve(process.cwd(), target)).href, {
    root,
    logLevel: 'warn',
    resolve: { alias: { '@shared': join(root, 'shared') } },
  });
  if (typeof module.default === 'function') {
    const code = await module.default(args);
    if (typeof code === 'number') process.exitCode = code;
  }
} catch (err) {
  console.error(err);
  process.exitCode = 1;
}
