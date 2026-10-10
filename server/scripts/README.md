# server/scripts/

- `loadtest.ts` — 부하 테스트. 서버(자식 프로세스 1)와 부하 생성기(자식 프로세스 여러 개, 기본 4)를 띄워 방 N × (호스트 1 + 학생 30)을 흉내 낸다.
  단계(기본 10 → 30 → 50방)마다 지연 p50/p95/p99, 서버 RSS·CPU, 초당 메시지·프레임·바이트, 끊김, 오류 코드를 표로 출력하고, 기본 설정 서버로 상한(51번째 BUSY·`acceptingNewRooms:false`·같은 IP 11번째 ROOM_LIMIT)을 확인한다.
  - 선택지: `--rooms 50 --students 30 --minutes 5 --stages 10,30,50 --stage-minutes 2 --warmup 10 --workers 4 --interval 0.3 --max-rooms 50 --no-check-limits`
  - 로컬 127.0.0.1에서만 돈다. 결과는 표준 출력(파일을 쓰지 않음).
  - 기본 `npm test`에는 들어가지 않는다(스모크만: `tests/server/loadtest.smoke.test.ts`).
- `postbuild.mjs`, `dist-entry.js` — `npm run build`(server) 뒤 `dist/index.js` 진입점을 놓는다.
