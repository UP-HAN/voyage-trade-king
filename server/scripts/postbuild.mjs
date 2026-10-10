// tsc 빌드 뒤 진입점 파일 dist/index.js 를 놓는다(shared/ 를 함께 컴파일하느라 tsc 출력이 dist/server/src/ 아래에 생기므로).
// 주의: fs.cpSync·rmSync 를 쓰지 않는다(한글 경로 + Node 24 문제, 루트 CLAUDE.md). 복사만 한다.
import { copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const from = fileURLToPath(new URL('./dist-entry.js', import.meta.url));
const to = fileURLToPath(new URL('../dist/index.js', import.meta.url));
copyFileSync(from, to);
console.log('server/dist/index.js 준비됨');
