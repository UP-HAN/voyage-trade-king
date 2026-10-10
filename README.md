# 대항해 무역왕

초등 6학년 사회 「세계 속의 무역」 수업용 웹 게임. 학생 한 명이 무역 회사 하나를 맡아 항구를 오가며 사고팔고, 교사는 교사 PC 대시보드로 수업을 이끌고 TV에는 공용 화면을 띄운다.
학생은 크롬북·태블릿으로 6자리 방 코드를 넣고 들어온다(계정·실명 없음). 서버는 메시지를 전달만 하고 아무것도 저장하지 않는다.

- **수업에 쓰려는 선생님**: [`docs/teacher-setup.md`](docs/teacher-setup.md) — 이미 운영 중인 서버(`https://lab.ches.es.kr/voyage`)를 그대로 쓰면 설치가 필요 없다.
- **자기 서버에 설치하려는 선생님**: 아래 [내 서버에 설치하기](#내-서버에-설치하기).
- 기획 문서: `docs/PRD.md`, 서버 운영자 문서: `docs/server-setup.md`

---

## 개발

- 웹앱: Vite + TypeScript + Preact, 상대 경로(`base: './'`) 정적 빌드 → 어느 하위 경로(예: `/voyage/`)에서나 동작
- 중계 서버: `server/` (Node, 저장 없는 WebSocket 중계)

### 준비물

- Node.js 22.12 이상 (`.nvmrc`는 24). npm 사용. (서버에서 중계 서버만 돌릴 때는 Node 20 이상)

### 실행 방법

```bash
npm install            # 웹앱 + server/ (npm workspaces) 의존성 한 번에 설치
npm run dev            # 개발 서버 http://localhost:5173/
npm test               # 단위 테스트(Vitest — 웹·shared·server·배포 스크립트)
npm run check:data     # 게임 데이터 검사
npm run build          # 타입 검사 + 웹앱 빌드 → dist/
npm run preview        # 빌드 결과 미리 보기 http://localhost:4173/
npm run build:server   # 중계 서버 빌드 → server/dist/
npm run loadtest       # 중계 서버 부하 테스트(server/scripts/loadtest.ts)
npm run e2e            # Playwright 스모크(처음 한 번: npx playwright install chromium)
npm run deploy         # 배포 미리 보기(아래 '업데이트 배포')
```

화면 주소(해시 라우팅):

| 주소 | 화면 |
|---|---|
| `#/` | 타이틀 |
| `#/play` | 학생 |
| `#/teacher` | 교사 대시보드 |
| `#/screen` | 공용 화면(TV) |

### 서버 없이 해 보기

주소에 `?sync=local`을 붙이면 중계 서버 없이 같은 브라우저의 여러 탭으로 해 볼 수 있다(예: `http://localhost:5173/?sync=local#/teacher`). 개발 서버는 기본이 `local`, 빌드 결과는 기본이 `relay`다. `?sync=memory`는 테스트용.

### 중계 서버 주소

기본값은 페이지 위치 기준 `./ws`다(예: `https://lab.ches.es.kr/voyage/` → `wss://lab.ches.es.kr/voyage/ws`). 바꾸려면 다음 중 하나:

1. 주소에 `?relay=wss://…/ws`
2. `index.html`과 같은 폴더에 `config.json`: `{ "relayUrl": "wss://…/ws" }`

### 폴더

```
src/        웹앱 (main.tsx 해시 라우터, config/ data/ core/ sync/ ui/common/ student/ teacher/ screen/ minigames/ styles/)
shared/     브라우저·중계 서버 공용 코드(@shared/*)
server/     중계 서버 (src/, scripts/)
deploy/     서버 설치용 틀(nginx 조각·용량 안내, systemd·pm2, env·공지·config.json 예시)
scripts/    검사·배포 스크립트(deploy.mjs)
tests/      단위 테스트,  e2e/  Playwright 스모크
assets/images/  생성 이미지(빌드 시 dist/assets/images/로 복사, `_`로 시작하는 작업 폴더 제외)
```

### 글꼴

Song Myung(제목), Gowun Dodum(본문) — SIL Open Font License 1.1, `src/styles/fonts/`에 동봉(`OFL.txt`).

---

## 내 서버에 설치하기

`docs/server-setup.md` 3부를 옮긴 것이다. 구조: nginx가 `/voyage/` 정적 파일을 주고, `/voyage/ws`·`/voyage/health`·`/voyage/notice`를 서버 안 `127.0.0.1:8787`의 중계 서버(systemd 서비스 `voyage-relay`)로 넘긴다. 새 포트를 열지 않고, 기존 사이트(`location /`)는 건드리지 않는다.

### 준비물
- 우분투 서버 1대(메모리 1GB 이상 권장 — 한 학교 몇 반이면 충분(상한 10~30), 여러 학교가 함께 쓰려면 2GB(상한 50)), 도메인과 HTTPS 인증서가 붙은 nginx, Node 20 LTS 이상, SSH 접속.
- 이 저장소(GitHub)와 노트북의 Node 20 이상.

### 순서 (약 30분)
1. 저장소 받기 → `npm ci` → `npm run build`(정적 파일 `dist/`) → `npm run build:server`(중계 서버 `server/dist/`).
2. 서버에 사용자 `voyage`, 폴더 `/var/www/voyage`, `/opt/voyage-relay` 만들기:
   ```bash
   sudo useradd --system --no-create-home --shell /usr/sbin/nologin voyage
   sudo mkdir -p /var/www/voyage/releases /opt/voyage-relay/releases
   sudo chown -R <내계정>:<내계정> /var/www/voyage /opt/voyage-relay
   ```
3. `dist/` → `/var/www/voyage/current/`, `server/` 빌드 결과 → `/opt/voyage-relay/current/` 후 `npm ci --omit=dev`.
   (노트북에서 `npm run deploy -- --pack-only`를 하면 `.tmp-deploy/static.tgz`·`relay.tgz`가 만들어진다. `relay.tgz`에는 `dist/`, 런타임 `package.json`, `package-lock.json`이 들어 있어 서버에서 풀고 `npm ci --omit=dev`만 하면 된다. release 폴더에 풀고 `ln -sfn <release> current`로 링크하면 이후 `npm run deploy`와 같은 구조가 된다.)
4. `/etc/voyage-relay.env` 작성(틀: [`deploy/env.example`](deploy/env.example), 권한 640 `root:voyage`). `ALLOWED_ORIGINS`에 **자기 도메인**, `MAX_ROOMS`는 아래 [서버 크기별 권장 상한](#서버-크기별-권장-상한) — 한 학교만 쓰면 10~20.
5. [`deploy/systemd/voyage-relay.service`](deploy/systemd/voyage-relay.service)를 `/etc/systemd/system/`에 복사(`ExecStart`의 node 경로, `MemoryMax`·`LimitNOFILE=8192` 확인) → `sudo systemctl daemon-reload && sudo systemctl enable --now voyage-relay` → `curl http://127.0.0.1:8787/health`.
   (서버가 이미 pm2를 쓰면 대신 [`deploy/pm2/ecosystem.config.cjs`](deploy/pm2/ecosystem.config.cjs))
6. [`deploy/nginx/voyage.conf`](deploy/nginx/voyage.conf)를 `/etc/nginx/snippets/`에 복사(다른 경로를 쓰려면 파일 안 `/voyage` 5곳을 바꿈) → 자기 사이트 server 블록(`listen 443 ssl`)의 `location /` 앞에 `include snippets/voyage.conf;` → `sudo nginx -t` → `sudo systemctl reload nginx`. (먼저 사이트 설정 파일을 백업)
7. 동시 방이 10개를 넘을 것 같으면 [`deploy/nginx/capacity.md`](deploy/nginx/capacity.md)대로 `worker_connections`·`worker_rlimit_nofile`을 올린다(nginx 전체 설정이므로 따로 백업·검사).
8. `https://<내 도메인>/voyage/`에서 [연결 테스트] → 리허설.

- 다른 경로·다른 도메인에서 중계 서버를 돌린다면 정적 폴더에 `config.json`(`{"relayUrl":"wss://…/ws"}`)을 둔다.
- 설정값(환경 변수) 표: [`docs/server-setup.md` 3.3](docs/server-setup.md) — 이름·기본값은 [`deploy/env.example`](deploy/env.example)과 같다.
- 문제가 생기면 include 줄을 지우고 `nginx -t` → reload 하면 원래대로 돌아간다(되돌리기 전체: `docs/server-setup.md` 1.7).

### 경로 바꾸기
앱은 상대 경로로 빌드되므로 `/voyage` 대신 다른 경로(예: `/game`)를 쓰려면 `deploy/nginx/voyage.conf`의 `/voyage` 5곳(파일 맨 위 주석에 목록)과 `alias` 경로만 바꾸면 된다. 다시 빌드할 필요가 없다. 중계 주소도 페이지 위치 기준(`./ws`)이라 따라 바뀐다.

### `config.json` (정적 폴더, 선택)
`/var/www/voyage/current/config.json` — 비밀값이 아니다. 없으면 모두 기본값. 예시: [`deploy/config.example.json`](deploy/config.example.json)
```json
{
  "relayUrl": "wss://example.org/voyage/ws",
  "serverInfo": { "operator": "", "contact": "", "repoUrl": "" },
  "serviceNotice": { "short": "…", "items": ["…"] },
  "display": { "titleRoomCount": true }
}
```
- `relayUrl`: 중계 서버가 다른 곳에 있을 때만.
- `serverInfo`·`serviceNotice`: 아래 [화면 하단 이용 안내와 문의처](#화면-하단-이용-안내와-문의처).
- `display.titleRoomCount`(기본 `true`): `false`면 **타이틀 화면에서만** "사용 중인 방 n/○○" 표시를 숨긴다(교사 시작 화면·판 설정의 표시와 가득 참 안내는 그대로). 한 학교만 쓰는 서버처럼 방 수를 보일 필요가 없을 때.
- `npm run deploy`는 새 release에 `config.json`이 없으면 **이전 release의 `config.json`을 복사**하므로, 배포해도 운영자가 정한 값이 사라지지 않는다.

---

## 업데이트 배포 (서버 운영자용 요약)

교사 노트북(Windows OpenSSH·Git Bash·macOS·Linux)에서 저장소 루트:
```bash
npm run deploy                                 # 기본 = 미리 보기(dry-run): 할 일과 원격 명령을 보여 주기만 함
npm run deploy -- --execute                    # 실제 배포
npm run deploy -- --execute --static-only      # 정적 파일만
npm run deploy -- --execute --relay-only       # 중계 서버만
npm run deploy -- --pack-only                  # 서버 접속 없이 묶음(.tmp-deploy/)만 만들기
npm run deploy -- --help
```
- **접속 정보는 저장소 밖에 둔다**: 홈 폴더의 `~/.voyage-deploy.json`(Windows `%USERPROFILE%\.voyage-deploy.json`) 또는 환경 변수 `VOYAGE_DEPLOY_*`. 설정이 없으면 예시를 보여 주고 끝난다.
  ```json
  { "host": "<서버 도메인>", "user": "<SSH 사용자>", "keyPath": "<키 경로, 선택>",
    "staticRoot": "/var/www/voyage", "relayRoot": "/opt/voyage-relay", "service": "voyage-relay",
    "healthUrl": "https://<서버 도메인>/voyage/health" }
  ```
- 순서: ① 수업 시간(평일 08:30~16:30)이면 멈춤(`--allow-school-hours`로만) ② `check:data`·`test`·`build`·`build:server` ③ 묶기 ④ **바꾸기 전에 판단**: `/health`를 읽어 "열린 방 3/50, 새 방 받는 중, 공지 없음"처럼 출력하고, 중계 서버 묶음 해시를 지난 배포와 비교 ⑤ 정적·중계 release를 `releases/<YYYYMMDD-HHMM>/`에 올려 풀기(정적은 `config.json` 보존, 중계는 `npm ci --omit=dev`) — 여기까지는 `current`를 바꾸지 않음 ⑥ 두 `current` 링크를 **함께** 교체 → `sudo systemctl restart voyage-relay` ⑦ 10초 안에 `/health` ok가 아니면 둘 다 이전 release로 되돌리고 결과(성공/실패, 지금 살아 있는 release)를 출력 ⑧ release는 최근 5개만 남김 ⑨ 요약.
- **중계 서버가 바뀌었는데 열린 방이 있으면(`rooms > 0`, 또는 `/health`를 못 읽으면) 재시작을 거부하고 정적 파일도 바꾸지 않는다** — 새 앱과 옛 중계 서버가 섞여 돌지 않게. 중계 서버가 바뀐 배포는 방이 0일 때(아래 점검 절차) 한다. `--force`는 확인 질문 1번 더. 중계 서버가 그대로면 정적 파일만 바꾸고 재시작하지 않는다. 정적만 꼭 바꿔야 하면 `--static-only`(열린 방이 있어도 됨, 새로 고침 안내가 뜬다).
- 준비 중 실패하면 아무것도 바꾸지 않고 새 release 폴더를 지운다(같은 분 안에 다시 실행해도 됨).
- 원격 명령은 실행 전에 모두 화면에 보인다. nginx 설정·기존 사이트는 건드리지 않는다. 원격 `sudo`는 `sudo -n systemctl restart voyage-relay`만 쓰므로, 그 명령에 비밀번호가 필요한 서버라면 sudoers에 그 명령 하나만 허용하거나 재시작을 손으로 한다.

---

## 공개 운영 (여러 학교가 함께 쓸 때)

한 서버를 여러 학교 선생님이 함께 쓰게 하려면(예: 교사 커뮤니티에 주소 공개) 먼저 [`docs/server-setup.md` 2.3 공개 전 체크리스트](docs/server-setup.md)를 모두 확인한다.

### 서버 크기별 권장 상한
기본 상한은 **동시 방 50개**(`MAX_ROOMS=50`), 같은 IP(같은 학교)는 10개(`MAX_ROOMS_PER_IP=10`). **권장 인스턴스는 2GB.** (`docs/server-setup.md` 1.3.1 요약)

| 서버 메모리 | 점검 때 `free -m` available | `MAX_ROOMS` | `MAX_CONN` | `MemoryMax` / `--max-old-space-size` |
|---|---|---|---|---|
| 512MB 이하 | 무엇이든 | 10 | 500 | 160M / 128 (공개 보류, 업그레이드 권고) |
| 1GB | 400~599MB | 30 | 1400 | 256M / 192 |
| 1GB | 600MB 이상 | 50 | 2300 | 320M / 224 |
| **2GB(권장)** | 1,000MB 이상 | 50 | 2300 | 384M / 256 |
| 4GB 이상 | 2,500MB 이상 | 50 | 2300 | 512M / 384 |

- available이 그 줄 기준보다 적으면 한 줄 아래. 400MB 미만이면 크기와 관계없이 10.
- 상한이 10을 넘으면 nginx 용량 설정([`deploy/nginx/capacity.md`](deploy/nginx/capacity.md), `worker_connections 6144`·`worker_rlimit_nofile 12288`)이 필요하다. 중계 서버는 systemd `LimitNOFILE=8192`.
- 화면의 **"사용 중인 방 n/50"** 표시(타이틀의 [선생님으로 시작] 아래·교사 시작 화면·판 설정)와 이용 안내 문구의 숫자는 `/health`의 `maxRooms`를 그대로 따른다. 상한을 바꾸면 앱을 다시 배포할 필요 없이 숫자가 바뀐다. 학생 화면·공용 화면에는 방 수가 없다.

### `/health` 보기
```bash
curl -s https://<내 도메인>/voyage/health
# {"ok":true,"version":"…","uptimeSec":…,"rooms":3,"maxRooms":50,"acceptingNewRooms":true,"peers":…,"conns":…,"maxConn":2300,"memMB":…,"notice":null,"blockedIps":0,"joinFailPerMin":0}
```
- `rooms`/`maxRooms` 열린 방/상한, `acceptingNewRooms` 지금 새 방을 받는지, `notice` 공지 단계(없으면 null). 방 코드·IP·이름은 들어 있지 않다.
- **외부 가동 확인을 권장**한다(커뮤니티 공개 뒤에는 필수): 무료 가동 확인 서비스에 `https://<내 도메인>/voyage/health`를 5분 간격으로 등록하고 멈추면 메일 알림.
- 첫 2주는 수업이 끝난 뒤 `/health` 최대치와 서버 메모리(`free -m`)를 본다. 방 최대치가 상한의 80%를 자주 넘으면 상한·서버 크기를 조정한다.

### 공지·점검
- 공지 파일: 서버의 `/etc/voyage-relay.notice.json`(환경 변수 `NOTICE_FILE`). 틀은 [`deploy/notice.example.json`](deploy/notice.example.json)을 복사해 고친다.
  ```bash
  sudo cp deploy/notice.example.json /etc/voyage-relay.notice.json   # 서버에 올린 뒤
  sudo nano /etc/voyage-relay.notice.json
  sudo systemctl reload voyage-relay                                  # 공지만 다시 읽음(연결 유지)
  sudo rm /etc/voyage-relay.notice.json && sudo systemctl reload voyage-relay   # 공지 없애기
  ```
  - `level`: `info`(파랑) / `warn`(주황) / `maintenance`(빨강), `text` 80자 이내, `from`~`until` 밖이면 표시 안 함(없으면 항상).
  - `blockNewRooms: true`(또는 `maintenance`이고 지금이 그 사이)면 새 방만 막는다. 이미 열린 방은 그대로.
  - 표시: 타이틀·교사 시작 화면·학생 입장 화면 맨 위 띠, 진행 중인 교사 대시보드에는 작은 알림.
- 재시작이 필요한 배포(점검): ① 하루 전 `warn` 공지 ② 시작 시각에 `maintenance` + `blockNewRooms: true` → reload ③ `/health`의 `rooms`가 0이 될 때까지 기다림 ④ `npm run deploy -- --execute` ⑤ 공지 파일 삭제 → reload. 수업 시간에는 점검하지 않는다.

### 화면 하단 이용 안내와 문의처
타이틀과 교사 시작 화면 맨 아래에 이용 안내 한 줄과 [이용 안내] 창이 있다. **기본 문구는 "교사 한 사람이 개인적으로 운영하는 무료 서버"라는 내용**(PRD 10.12.1)이다. 자기 서버에 설치해 공개하는 선생님은 상황이 다를 수 있으므로(학교·교육청 서버 등) **정적 폴더 `config.json`의 `serviceNotice`로 문구를 자기 상황에 맞게 바꾼다.**

```json
{
  "serverInfo": {
    "operator": "○○초 정보부",
    "contact": "mailto:info@example.org",
    "repoUrl": "https://github.com/<계정>/<저장소>"
  },
  "serviceNotice": {
    "short": "이 게임 서버는 ○○교육지원청 연구회가 운영해요. 학생 정보는 서버에 저장하지 않아요.",
    "items": [
      "이 서버는 ○○교육지원청 수업 연구회가 운영합니다.",
      "점검이 있으면 화면 맨 위 띠로 미리 알려 드립니다.",
      "학생 실명을 받지 않고, 서버는 학생 정보를 저장하지 않습니다."
    ]
  }
}
```
- `serviceNotice.short`: 화면 맨 아래 한 줄(200자 이내). `serviceNotice.items`: [이용 안내] 창의 항목 배열(각 200자 이내, 최대 12개). 둘 다 없으면 기본 문구.
- `serverInfo`: `operator`(30자 이내)·`contact`(80자 이내)·`repoUrl`(200자 이내). **값이 비어 있으면 문의 줄이 아예 숨겨진다**(빈 자리나 "없음"을 보이지 않음). `contact`·`repoUrl`은 `https://` 또는 `mailto:`로 시작할 때만 링크가 된다. 글자로만 표시되므로 HTML을 넣어도 실행되지 않는다.
- 문의처는 공개되는 정보다. 개인 전화번호 같은 연락처는 넣지 않기를 권한다.
- `config.json`은 `index.html`과 같은 폴더(`/var/www/voyage/current/`)에 둔다. nginx 조각이 `no-cache`로 주므로 고치면 새로 고침만으로 반영된다.

---

## 개인정보 원칙
- 학생 실명을 받지 않는다. 학생은 출석번호와 스스로 지은 회사 이름만 입력한다.
- **서버는 아무것도 저장하지 않는다**(디스크·DB 없음, 방은 메모리에만). 서버 로그에도 출석번호·회사 이름·메시지 내용이 남지 않고, IP는 끝자리를 가린다. 접속 제한을 위해 IP를 메모리에 잠시(최대 1시간) 둔다.
- 게임 기록은 교사 PC 브라우저와 학생 기기에만 있다가 24시간 뒤 지워진다([결과 파일 저장]을 누른 경우만 교사 PC에 파일).
- 저장소에 비밀값(서버 접속 정보·SSH 키·토큰)을 넣지 않는다. 서버별 값은 서버의 `/etc/voyage-relay.env`와 노트북의 `~/.voyage-deploy.json`에만.

## 라이선스
- 코드: MIT © 2026 hanuipyo
- 그림(`assets/images/`)·문서·학습지(`docs/`): CC BY-NC 4.0 — 비영리 수업·연수에 자유롭게 쓰고 고칠 수 있어요(저작자 표시: hanuipyo).
- 글꼴: SIL Open Font License 1.1(`src/styles/fonts/OFL.txt`)

자세한 내용은 [`LICENSE`](LICENSE). 만든 사람: hanuipyo · Instagram [@hanuipyo](https://www.instagram.com/hanuipyo/)

## 생성 이미지·교과서 인용
- `assets/images/`의 그림은 AI 이미지 생성 도구로 만든 것이다. CC BY-NC 4.0으로 공개한다.
- 게임 속 가격·뉴스·사건은 수업을 위해 지어낸 것이다. 교과서 내용은 쪽수를 밝혀 수업에 필요한 만큼만 인용했다(자세한 출처 목록 자리).
