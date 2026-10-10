// 빌드 결과 진입점(server/dist/index.js로 복사됨 — scripts/postbuild.mjs).
// systemd ExecStart: `node dist/index.js` (docs/server-setup.md 1.4). 실제 코드는 dist/server/src/main.js.
import './server/src/main.js';
