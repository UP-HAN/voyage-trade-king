# server/ — 저장 없는 WebSocket 중계 서버 (작업 105)

방 라우팅 규칙(코드 발급·역할·격리·속도 제한·상한·수명)은 `shared/relay-core.ts`(104)에 있고, 이 폴더는 그것을 실제 Node 서버에 연결한다.
디스크·DB에 아무것도 쓰지 않는다(공지 파일은 읽기만). 런타임 의존성은 `ws` 하나.

## 파일
| 파일 | 하는 일 |
|---|---|
| `src/config.ts` | 환경 변수 읽기·검사(`docs/server-setup.md` 3.3 — 잘못된 값이면 이유를 출력하고 시작하지 않음), 출처·클라이언트 IP 판정 |
| `src/server.ts` | HTTP(`GET /health`, `GET /notice`, 그 밖 404) + `/ws` 업그레이드, relay-core 연결, sweep 15초·ping 20초·45초 무응답 끊기·1분 집계 로그, 종료 처리 |
| `src/notice-file.ts` | 공지 파일 읽기(`NOTICE_FILE`, 시작·SIGHUP) |
| `src/log.ts` | 한 줄 JSON 로그(방 코드는 앞 2자리, IP는 끝자리 x — 이름·내용·IP 전체는 남기지 않음) |
| `src/main.ts` | 프로세스 진입점(SIGTERM/SIGINT → `server.restarting` → 2초 뒤 종료, SIGHUP → 공지 다시 읽기) |
| `src/index.ts` | 테스트·부하 테스트가 쓰는 공개 모듈 |
| `scripts/loadtest.ts` | 부하 테스트(`npm run loadtest -- --rooms 50 --students 30 --minutes 5`) |
| `scripts/postbuild.mjs`, `scripts/dist-entry.js` | 빌드 뒤 진입점 `dist/index.js`를 놓음 |

## 명령 (루트에서)
```bash
npm run build:server                       # → server/dist/ (진입점 dist/index.js)
ALLOW_LOCALHOST=1 node server/dist/index.js   # 개발: http://localhost:* 출처 허용, 127.0.0.1:8787
curl -s http://127.0.0.1:8787/health
npm run loadtest -- --rooms 50 --students 30 --minutes 5   # 부하 테스트(약 10분, 로컬 전용)
npm run loadtest -- --rooms 100 --stages 100 --minutes 3   # 참고 측정
```
- 서버에서는 `server/`의 `dist/`·`package.json`·`package-lock.json`을 올리고 `npm ci --omit=dev` → `node dist/index.js`(systemd, `docs/server-setup.md` 1.4).
- 설정 예시: `deploy/env.example`.
- `shared/` 코드는 상대 경로 + `.js` 확장자로 import 한다(`shared/README.md`). 게임 규칙(`src/core`)은 import 하지 않는다.

## HTTP
- `GET /health` → `{ ok, version, uptimeSec, rooms, maxRooms, acceptingNewRooms, peers, conns, maxConn, memMB, notice, blockedIps, joinFailPerMin }` (`Cache-Control: no-store`, CORS 없음 — 같은 출처). 방 코드·IP·이름 없음. 요청마다 로그를 쓰지 않고 1분 집계에 횟수만.
- `GET /notice` → `{ level, text, until? }` 또는 `{ level: null }`.
- WebSocket `/ws`: `Origin`이 `ALLOWED_ORIGINS`에 없으면 `error{code:'ORIGIN'}` 뒤 4007로 끊음. 메시지 64KB 초과는 1009.
