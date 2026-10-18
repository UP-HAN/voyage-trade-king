# deploy/

서버 설치용 틀(작업 128). 절차는 저장소 `README.md`의 '내 서버에 설치하기'와 `docs/server-setup.md`.
이 폴더에 비밀값(서버 접속 정보·키·토큰)을 넣지 않는다.

| 파일 | 서버 위치 | 설명 |
|---|---|---|
| `nginx/voyage.conf` | `/etc/nginx/snippets/voyage.conf` | location 조각. 사이트 server 블록에 `include` 한 줄로 붙임(ⓒ-1) |
| `nginx/capacity.md` | (문서) | nginx 전체 설정 `worker_connections 6144`·`worker_rlimit_nofile 12288` — **별도 교사 승인(ⓒ-2)** |
| `systemd/voyage-relay.service` | `/etc/systemd/system/` | 중계 서버 서비스(`LimitNOFILE=8192`, `MemoryMax=384M`, 서버 크기별 표는 주석) |
| `pm2/ecosystem.config.cjs` | (pm2를 쓸 때만) | systemd 대신 pm2 |
| `env.example` | `/etc/voyage-relay.env` | 환경 변수(권한 640, root:voyage) |
| `notice.example.json` | `/etc/voyage-relay.notice.json` | 서버 공지 예시(바꾼 뒤 `sudo systemctl reload voyage-relay`) |
| `config.example.json` | `/var/www/voyage/current/config.json` | 정적 폴더 설정 예시. `serverInfo`를 넣으면 문의(한 줄 끝·[이용 안내] 9번)가 그 값으로 바뀜. 비우면 기본 문의 `GitHub 저장소(github.com/UP-HAN/voyage-trade-king)`(저작권 줄은 늘 같음). `display.titleRoomCount`(기본 `false`) = 타이틀에 '사용 중인 방' 표시 |
| `check-nginx.sh` | (로컬) | Docker로 nginx 조각 라우팅 검사(선택) |

업데이트 배포는 `npm run deploy`(`scripts/deploy.mjs`, 기본 미리 보기 — 실제 배포는 `--execute`).
