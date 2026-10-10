# 대항해 무역왕 — 서버 운영자 문서 (배포·운영·공개 운영·자체 설치)

- 문서 버전: **v0.3.2** (2026-10-09, PRD v0.3.4 — **1.3.2 ⓐ 점검 결과**(1GB·available 408MB → 상한 30 구간, 상한 결정은 교사 대기), 2.3 체크리스트의 문의처·"사용 중인 방" 위치 갱신). v0.3.1 (2026-10-09, PRD v0.3.3 — 배포 기본 = 미리 보기·실제는 `--execute`, `RESUME_GRACE` 설명). v0.3(PRD v0.3.2 기준 — **동시 방 50**, 서버 크기별 상한표·nginx·systemd 값 다시 계산, `/health`의 `acceptingNewRooms`, 교사 커뮤니티 공개 체크리스트). v0.2: PRD v0.3.1 — 서버 공개, nginx·systemd 연결 한도, 공지·점검
- 대상: **1부·2부** = 이 프로젝트의 교사(서버 `lab.ches.es.kr` 운영자). **3부** = 자기 서버에 설치하려는 다른 교사(저장소 README로 옮김).
- 게임을 수업에 쓰기만 하는 교사는 이 문서가 필요 없다 → `docs/teacher-setup.md`.
- 관련: `docs/PRD.md` 7장(호스트 권위·재접속), **7.5.1("사용 중인 방 n/50" 표시)**, 7.9(개인정보), 10.5(중계 프로토콜), 10.9(배포 구조·nginx 연결 수), 10.10(운영 규칙·**10.10.1 자원 추정 — 50방**), 10.11(코드 공개), **10.12(공개 운영)·10.12.1(화면 하단 이용 안내 문구)·10.12.2(커뮤니티 공개 글)**
- 구현 작업: 104(방 라우팅·상한 로직), 105(중계 서버·공지·`/health`·부하 테스트), 128(배포 틀·스크립트·README), 129(실제 서버 적용 — **교사 승인 단계**), 130(GitHub 공개 — **교사 승인 단계**), 131(사용 중인 방 표시·이용 안내 화면 부품)

> **[교사 승인] 원칙**: 서버에 접속해 명령을 실행하는 모든 단계(읽기 전용 점검 포함)와 GitHub 원격 저장소 작업은 교사가 단계별로 승인한 뒤에만 한다. 아래 표의 ⓐ~ⓕ가 승인 지점이다. 승인 없이 진행하지 않는다.

---

## 1부. 구조와 처음 설치 (서버 운영자)

### 1.1 한눈에 보기
```
학생·교사 브라우저 ──HTTPS/WSS 443──▶ nginx 1.18 (기존 server 블록 lab.ches.es.kr, 기존 인증서 그대로)
   ├─ /voyage            → 301 /voyage/
   ├─ ^~ /voyage/        → 정적 파일  /var/www/voyage/current/      (빌드 결과 dist/)
   ├─ =  /voyage/ws      → 127.0.0.1:8787/ws   (WebSocket 프록시)
   ├─ =  /voyage/health  → 127.0.0.1:8787/health
   ├─ =  /voyage/notice  → 127.0.0.1:8787/notice  (v0.2 서버 공지)
   └─ /                  → 기존 Next.js 포트폴리오 (건드리지 않음)
중계 서버: systemd 서비스 voyage-relay
   - 전용 사용자 voyage(로그인 셸 없음), 127.0.0.1:8787에만 열림
   - 코드 /opt/voyage-relay/current/, 설정 /etc/voyage-relay.env, 공지 /etc/voyage-relay.notice.json(읽기만)
   - 디스크·DB에 아무것도 저장하지 않음(방은 메모리에만)
   - 연결 한도 LimitNOFILE=8192, 메모리 한도 MemoryMax(1.3.1 표)
nginx 본문(/etc/nginx/nginx.conf): 50방 운영 시 worker_rlimit_nofile 12288, worker_connections 6144 (ⓒ-2, 별도 승인)
```
- 새 포트를 열지 않는다. Lightsail 방화벽·인증서는 바꾸지 않는다.
- 경로 `/voyage`는 바꿀 수 있다: 앱이 상대 경로로 빌드되므로 nginx 조각의 경로만 바꾸면 된다(중계 주소도 페이지 위치 기준 `./ws`).

### 1.2 단계와 승인 지점
| 단계 | 내용 | 서버 변경 | 승인 |
|---|---|---|---|
| ⓐ 점검 | 읽기 전용 명령으로 서버 상태 확인(1.3), 결과로 상한·메모리 한도 정하기(1.3.1) | 없음 | **필요** |
| ⓑ 설치 | 사용자·폴더 만들기, 정적 파일·중계 서버 올리기, 설정·공지 파일, systemd 등록·시작(1.4) | 있음(새 파일·서비스만) | **필요** |
| ⓒ-1 nginx 조각 | 설정 백업 → 조각 파일 추가 → include 한 줄 → `nginx -t` → reload(1.5) | 있음(기존 사이트 설정 1줄) | **필요** |
| ⓒ-2 nginx 용량 | `/etc/nginx/nginx.conf`의 `worker_rlimit_nofile`·`worker_connections` 상향(1.5.1). **기존 포트폴리오도 쓰는 전체 설정**을 바꾸므로 따로 승인 | 있음(nginx 전체 설정 2줄) | **필요(별도)** |
| ⓓ 확인 | 포트폴리오·게임·/health·WebSocket·연결 한도 확인(1.6) | 없음 | ⓒ에 포함 |
| ⓔ 업데이트 | 이후 새 버전 배포마다(2.1) | 있음 | **배포마다 필요**(수업 시간 외) |
| ⓕ 공개 시작 | 교사 커뮤니티에 공개 글을 올리기 전 최종 확인(2.3) | 공지 파일만(v0.3.4: 문의처 `Instagram @hanuipyo`는 앱 기본값이라 `config.json` 불필요) | **필요** |
| 되돌리기 | 문제가 생기면 즉시(1.7) | 있음 | 사후 보고 허용(포트폴리오 장애 시 즉시 되돌림) |

- ⓒ-2는 동시 방을 약 10개 넘게 받을 때 필요하다. ⓒ-2 승인 전에는 `MAX_ROOMS`를 10으로 두고 공개(ⓕ)하지 않는다.

### 1.3 ⓐ 읽기 전용 점검 (약 10분)
교사 노트북에서 `ssh <사용자>@lab.ches.es.kr`로 접속해 아래만 실행한다(아무것도 바꾸지 않음).
| 확인할 것 | 명령 | 판단 |
|---|---|---|
| OS | `lsb_release -ds; uname -m` | Ubuntu 20.04 이상 권장 |
| sudo 가능 | `sudo -n true && echo ok` | ok가 아니면 비밀번호 필요 여부 확인 |
| nginx 버전·설정 위치 | `nginx -v; ls -l /etc/nginx/sites-enabled/` | 1.18 확인, lab.ches.es.kr의 설정 파일 이름 기록 |
| 기존 server 블록 | `sudo nginx -T 2>/dev/null \| grep -nE "server_name\|listen\|location\|include"` | lab.ches.es.kr 블록의 `location` 목록, **정규식 location(`~`, `~*`) 유무** 기록 |
| **nginx 연결 설정(v0.2)** | `grep -nE "worker_processes\|worker_connections\|worker_rlimit_nofile\|multi_accept" /etc/nginx/nginx.conf` | `worker_connections`가 6144 미만(기본 768)이면 ⓒ-2 필요. 현재 값 기록 |
| **nginx 워커 파일 한도(v0.2)** | `for p in $(pgrep -f "nginx: worker"); do grep "open files" /proc/$p/limits; done; systemctl show nginx -p LimitNOFILE` | 워커의 Soft limit 기록(ⓒ-2 뒤 12288 이상이어야 함) |
| Node | `node -v; which node; npm -v` | v20 이상이면 그대로 사용. 없거나 18 이하면 ⓑ에서 설치 방법 결정. `which node`가 `~/.nvm/...`이면 systemd에서 쓸 절대 경로 기록 |
| 기존 Next.js 실행 방식 | `systemctl list-units --type=service --state=running \| grep -iE "node\|next\|pm2"; command -v pm2 && pm2 ls` | pm2면 pm2로, systemd면 systemd로 맞출지 결정(기본: 중계 서버는 systemd) |
| **기존 Next.js 메모리(v0.2)** | `ps -eo pid,user,rss,pcpu,etimes,cmd --sort=-rss \| head -15` (RSS는 KB). systemd면 `systemctl show <서비스> -p MemoryCurrent` | Next.js·nginx·기타 프로세스가 쓰는 메모리 합계 기록 |
| 사용 중 포트 | `sudo ss -ltnp \| grep -E ':(80\|443\|3000\|8787)\b'` | 8787이 비어 있는지. 쓰이면 다른 포트(예: 8790) |
| **메모리·스왑·디스크·CPU(v0.2)** | `free -m; swapon --show; df -h /; nproc; lscpu \| grep -E "Model name\|^CPU\(s\)"; uptime` | `free -m`의 **total**(인스턴스 크기)과 **available**(지금 남은 양)으로 1.3.1 표를 적용 |
| **커널 한도(v0.2)** | `sysctl net.core.somaxconn fs.file-max net.ipv4.ip_local_port_range; ulimit -n` | 기록만(바꾸지 않음). `somaxconn`이 128 이하면 결과에 표시 |
| 인증서 | `sudo certbot certificates 2>/dev/null \| head -20` | 갱신 방식 기록(바꾸지 않음) |
| **Lightsail 콘솔(교사가 직접)** | 브라우저 Lightsail 콘솔 → 인스턴스 → 요금제(메모리·vCPU·월 전송 한도), 지표 탭 CPU 사용률·**버스트 용량** | 요금제와 지난 2주 CPU·버스트 그래프를 결과에 적음 |
- 결과를 작업 129의 `result.md`에 표로 남긴다. 이 결과로 ⓑ·ⓒ의 값(Node 경로, 포트, `MAX_ROOMS`, `MemoryMax`, nginx 파일 이름, ⓒ-2 필요 여부)을 확정한다.

### 1.3.1 서버 크기별 권장 상한 (v0.3 — 기본 상한 50)
PRD 10.10.1 추정(v0.3.2): 50방 × 30명(약 1,550 연결)이면 이 게임이 **약 200~300MB**(중계 서버 140~180MB + nginx 50~80MB + 커널 15~40MB)를 더 쓴다. 전체 연결 상한(`MAX_CONN=2300`)까지 차는 최악의 경우 약 270~400MB. 기존 Next.js(보통 100~300MB)와 OS(약 150MB)를 더하면 서버 전체 약 450~750MB.
**권장 인스턴스: 2GB**(공개 운영 여유). 1GB는 아래 조건을 만족할 때만 50.

| 인스턴스 메모리(`free -m` total) | 점검 때 available | 권장 `MAX_ROOMS` | `MAX_CONN` | `MemoryMax` / `--max-old-space-size` | 공개(ⓕ) |
|---|---|---|---|---|---|
| **512MB 이하** | 무엇이든 | **10** | 500 | 160M / 128 | **보류** — 2GB로 업그레이드를 권고. 업그레이드 전에는 이 교사 반만 사용 |
| 1GB | 400~599MB | 30 | 1,400 | 256M / 192 | 가능(이용 안내·공개 글의 상한이 화면 값 `maxRooms`로 30이 됨). 50이 필요하면 업그레이드 |
| 1GB | 600MB 이상 | **50** | 2,300 | 320M / 224 | 가능 — 여유가 적으므로 첫 2주 매일 `free -m` available이 250MB 아래로 떨어지지 않는지 확인 |
| **2GB(권장)** | 1,000MB 이상 | **50**(기본) | 2,300 | 384M / 256 | 가능 |
| 4GB 이상 | 2,500MB 이상 | 50(105 참고 측정·운영 2주 관찰 뒤 교사 결정으로 100까지) | 2,300(100이면 4,600) | 512M / 384 | 가능 |
- **하향 규칙**: available이 그 줄의 기준보다 적으면 한 줄 아래 값을 쓴다. 점검 때 available이 **400MB 미만**이면 인스턴스 크기와 관계없이 상한을 10으로 두고 원인(Next.js 메모리 등)을 교사에게 보고한다.
- 공통 값(크기와 무관): `MAX_ROOMS_PER_IP=10`, `MAX_CONN_PER_IP=500`, systemd `LimitNOFILE=8192`, nginx `worker_connections 6144`·`worker_rlimit_nofile 12288`(ⓒ-2). 4GB에서 100방으로 올릴 때만 v0.2 값(`LimitNOFILE=16384`, nginx 8192/16384)으로 올린다.
- 스왑이 없으면 메모리가 꽉 찼을 때 프로세스가 강제 종료될 수 있다. 스왑 추가는 이 문서 범위 밖(교사 판단) — 결과에 "스왑 없음"을 표시만 한다.
- CPU: 50방 피크에 1코어의 약 10~20%(상한까지 차면 약 25%). Lightsail 버스트형 CPU이므로 1코어 작은 요금제는 첫 공개 주에 버스트 용량 그래프를 확인하고, 계속 줄어들면 상한을 낮추거나 요금제를 올린다.
- 상한을 바꾸면 화면의 "사용 중인 방 n/○○"과 이용 안내 문구의 숫자는 `/health`의 `maxRooms`를 따라 자동으로 바뀐다(앱을 다시 배포할 필요 없음). 공개 글의 숫자는 운영자가 고친다.
- 정한 값은 `/etc/voyage-relay.env`와 systemd 서비스 파일에 쓰고 작업 129 result.md에 기록한다.

### 1.3.2 ⓐ 점검 결과 — `lab.ches.es.kr` (2026-10-09, 오케스트레이터가 읽기 전용으로 실행, v0.3.2 신설)
**결정: 이 서버의 동시 방 상한은 30(교사 결정, 2026-10-10).** 서버 환경 변수 `MAX_ROOMS=30`, `MAX_CONN=1380`(30×46)으로 설치한다. 코드 기본값(50)은 그대로 두고, 나중에 인스턴스를 키우면 환경 변수만 바꿔 올린다.

| 항목 | 결과 | 판단 |
|---|---|---|
| 서버 | `lab.ches.es.kr` = `ras.ches.es.kr`과 **같은 Lightsail 인스턴스**. Ubuntu 22.04, **2 vCPU** | OS 조건 충족. 다른 사이트(ras)도 같은 자원을 쓴다 |
| 메모리 | total **914MB**(1GB 요금제), available **약 408MB** | 1.3.1 표 **"1GB, available 400~599MB → 상한 30"** 줄. 하향 규칙 경계(400MB)에서 8MB 위 |
| 스왑 | 2GB 중 **988MB 사용**, 그중 mysqld 약 700MB | 이미 메모리가 빠듯해 쉬는 MySQL 페이지가 스왑으로 밀려나 있다. 스왑이 있어 강제 종료 위험은 낮지만, 메모리가 더 줄면 스왑 읽기·쓰기로 **모든 앱이 느려질** 수 있다 |
| 같은 서버의 다른 프로그램 | pm2 앱 4개 + systemd `lab-ches`(Next.js :3100) + MySQL + PostgreSQL | 포트폴리오 외에도 상주 프로그램이 많다. 이 게임의 메모리 증가가 이들에게도 영향 |
| nginx | 1.18, `worker_connections 768` | **ⓒ-2 필요**(10방을 넘기려면). 승인 전에는 `MAX_ROOMS` 10. lab 사이트 nginx에는 `/kart/` 프록시 선례가 있어 include 방식 적용이 익숙한 구조 |
| Node | **v20.20.2**, `/usr/bin/node` | 중계 서버 요구(`server/package.json` engines `>=20`) 충족. systemd `ExecStart`는 `/usr/bin/node` 절대 경로 |
| 포트 | **8787 비어 있음** | 기본 포트 그대로 |
| sudo | `sudo -n` 가능 | 배포 스크립트의 원격 재시작 단계(128) 그대로 쓸 수 있음 |

**추정**(PRD 10.10.1 비례): 이 게임이 더 쓰는 메모리 — 30방 약 130~200MB, 50방 약 200~300MB.
- 30방: 지금 available 408MB → 수업 피크에 약 **210~280MB** 남음. 1.3.1 '첫 2주 관찰' 기준선(250MB)과 비슷 — 가능하지만 여유가 적다.
- 50방: 약 **110~210MB** 남음 → 기준선 아래. 스왑 사용이 늘어 포트폴리오·ras·MySQL까지 느려질 위험. **이 인스턴스 그대로 50은 권하지 않는다.**

**권고(기획)** — 교사가 고른다:
| 안 | 내용 | 장점 | 비용·위험 |
|---|---|---|---|
| ⓐ **30으로 공개**(권장 시작점) | `MAX_ROOMS=30`, `MAX_CONN=1400`, `MemoryMax=256M`, `--max-old-space-size=192`, ⓒ-2(nginx 6144/12288) 승인 후 공개. 화면·이용 안내 숫자는 `/health`를 따라 30으로 바뀐다(앱 재배포 불필요) | 비용 없음, 지금 서버 그대로 | 공개 후 2주 매일 수업 뒤 `free -m` available·`swapon --show`·응답 지연 확인. **available이 250MB 아래로 자주 떨어지거나 30방 중 80%(24방)를 주 3일 넘게 쓰면** ⓑ로 넘어간다 |
| ⓑ **2GB로 올린 뒤 50** | Lightsail은 요금제를 그 자리에서 바꾸지 못하므로 **스냅숏 → 2GB 인스턴스로 새로 만들기 → 고정 IP 옮기기**. 그 뒤 1.3.1 '2GB' 줄 값(`MAX_ROOMS=50`, `MAX_CONN=2300`, `MemoryMax=384M`) | 커뮤니티 공개에 여유, 같은 서버의 다른 앱도 함께 숨통 | 월 요금 증가(Lightsail 요금표 확인), 옮기는 동안 **ras·포트폴리오·다른 앱 모두 잠시 멈춤**(수업 시간 밖, 별도 [교사 승인]). 고정 IP가 아니면 DNS 변경 필요 |
| (참고) 다른 프로그램 정리 | 쓰지 않는 pm2 앱·DB를 멈춰 메모리를 확보한 뒤 다시 점검 | 비용 없음 | 이 문서 범위 밖(교사 판단). 정리 뒤 available이 600MB를 넘으면 1.3.1 표로 50도 가능 |

- 어느 안이든 공개(ⓕ) 전에 작업 105 부하 테스트를 **정한 상한**으로 돌려 중계 서버 RSS를 확인한다(30방이면 RSS 150MB 이하 목표).
- 상한이 정해지면 이 절 맨 위에 "결정: ○○(날짜)"를 적고, 작업 129 ⓑ·ⓒ의 값으로 쓴다.

### 1.4 ⓑ 설치
1. **사용자·폴더**
   ```bash
   sudo useradd --system --no-create-home --shell /usr/sbin/nologin voyage
   sudo mkdir -p /var/www/voyage/releases /opt/voyage-relay/releases
   sudo chown -R <운영자계정>:<운영자계정> /var/www/voyage /opt/voyage-relay   # 업로드는 운영자 계정으로
   ```
2. **Node**(필요할 때만): Node 20 LTS 이상이 없으면 배포판 패키지 대신 NodeSource 또는 공식 바이너리를 `/usr/local`에 설치하는 방법 중 교사와 정한다. 기존 Next.js가 쓰는 Node를 바꾸지 않는다(다른 버전이 필요하면 `/opt/node20/`처럼 따로 두고 systemd에서 절대 경로로 부른다).
3. **정적 파일**: 교사 노트북에서 `npm run build` → `dist/`를 `/var/www/voyage/releases/<YYYYMMDD-HHMM>/`로 올리고 `ln -sfn <그 폴더> /var/www/voyage/current`.
4. **중계 서버**: 저장소의 `server/` 빌드 결과(`dist/`, `package.json`, `package-lock.json`)를 `/opt/voyage-relay/releases/<날짜시각>/`로 올림 → 그 폴더에서 `npm ci --omit=dev` → `ln -sfn … /opt/voyage-relay/current`.
5. **설정 파일** `/etc/voyage-relay.env`(권한 640, root:voyage) — 값은 3부 3.3 표 + 1.3.1에서 정한 상한. 예(2GB 서버):
   ```
   HOST=127.0.0.1
   PORT=8787
   ALLOWED_ORIGINS=https://lab.ches.es.kr
   TRUST_PROXY=127.0.0.1
   MAX_ROOMS=50
   MAX_CONN=2300
   MAX_CONN_PER_IP=500
   NOTICE_FILE=/etc/voyage-relay.notice.json
   NODE_OPTIONS=--max-old-space-size=256
   ```
6. **공지 파일**(선택, 처음에는 없어도 됨) `/etc/voyage-relay.notice.json`(권한 644, 틀: 저장소 `deploy/notice.example.json`). 형식은 2.4.
7. **systemd** `/etc/systemd/system/voyage-relay.service`(틀: 저장소 `deploy/systemd/voyage-relay.service`)
   ```ini
   [Unit]
   Description=Voyage relay (대항해 무역왕 WebSocket 중계, 저장 없음)
   After=network.target

   [Service]
   Type=simple
   User=voyage
   Group=voyage
   WorkingDirectory=/opt/voyage-relay/current
   EnvironmentFile=/etc/voyage-relay.env
   ExecStart=/usr/bin/node dist/index.js
   ExecReload=/bin/kill -HUP $MAINPID
   Restart=always
   RestartSec=2
   MemoryMax=384M
   LimitNOFILE=8192
   NoNewPrivileges=true
   ProtectSystem=strict
   ProtectHome=true
   PrivateTmp=true

   [Install]
   WantedBy=multi-user.target
   ```
   - `ExecStart`의 node 경로는 1.3에서 기록한 절대 경로로. `MemoryMax`는 1.3.1 표 값으로.
   - `LimitNOFILE=8192`(v0.3, 이전 16384): systemd 서비스의 기본 열린 파일 한도(소프트 1024)로는 약 1,000연결에서 새 연결이 거부된다. 50방 상한(`MAX_CONN=2300`)의 약 3.5배 여유. 이 서비스에만 적용되므로 포트폴리오에 영향 없음.
   - `ExecReload`: `sudo systemctl reload voyage-relay`로 공지 파일만 다시 읽는다(연결 유지).
   - `sudo systemctl daemon-reload && sudo systemctl enable --now voyage-relay`
   - 확인: `systemctl status voyage-relay --no-pager`, `curl -s http://127.0.0.1:8787/health` → `{"ok":true,…,"rooms":0,"maxRooms":50,"acceptingNewRooms":true,…}`, `grep "open files" /proc/$(systemctl show -p MainPID --value voyage-relay)/limits` → 8192
   - (pm2로 맞추기로 했다면 저장소 `deploy/pm2/ecosystem.config.cjs`를 쓰고, 이 절의 systemd는 생략. pm2는 파일 한도를 pm2 데몬의 한도로 물려받으므로 1.3의 `ulimit -n`을 확인하고 교사에게 보고)

### 1.5 ⓒ-1 nginx 조각 적용 (기존 포트폴리오 보호)
1. **백업**: `sudo cp -a /etc/nginx/sites-available/<파일> /etc/nginx/sites-available/<파일>.bak-$(date +%Y%m%d%H%M)`
2. **조각 파일** `/etc/nginx/snippets/voyage.conf`(틀: 저장소 `deploy/nginx/voyage.conf`)
   ```nginx
   # 대항해 무역왕 — lab.ches.es.kr server 블록 안에서 include
   location = /voyage { return 301 /voyage/; }

   location ^~ /voyage/ {
       alias /var/www/voyage/current/;
       index index.html;
       # index.html은 캐시하지 않음(배포 직후 새 버전), 해시 붙은 파일은 길게 — 세부는 작업 128이 확정
   }

   location = /voyage/ws {
       proxy_pass http://127.0.0.1:8787/ws;
       proxy_http_version 1.1;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection "upgrade";
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
       proxy_read_timeout 120s;
       proxy_send_timeout 120s;
   }

   location = /voyage/health {
       proxy_pass http://127.0.0.1:8787/health;
       proxy_set_header Host $host;
   }

   location = /voyage/notice {
       proxy_pass http://127.0.0.1:8787/notice;
       proxy_set_header Host $host;
   }
   ```
   - `^~`: 기존 설정의 정규식 location이 `/voyage/` 아래 파일을 가로채지 않게 한다.
   - `= /voyage/ws`, `= /voyage/health`, `= /voyage/notice`는 정확히 일치 location이라 `^~ /voyage/`보다 먼저 적용된다.
3. **include 한 줄**: lab.ches.es.kr의 `listen 443 ssl` server 블록 안, 기존 `location /` **앞**에 `include snippets/voyage.conf;` 한 줄만 추가한다. 다른 줄은 바꾸지 않는다.
4. **검사**: `sudo nginx -t` — 실패하면 include 줄을 지우고 멈춘다(reload 하지 않음).
5. **적용**: `sudo systemctl reload nginx`(restart 아님).

### 1.5.1 ⓒ-2 nginx 용량 설정 (v0.2, v0.3 값 조정, 별도 승인)
**왜 필요한가**: nginx가 WebSocket을 프록시하면 연결 하나에 nginx 연결 2개(학생↔nginx, nginx↔중계 서버)를 쓴다. Ubuntu 기본 `worker_connections 768`(워커당)이면 1코어 서버에서 동시 WebSocket 약 380개가 한계이고, 같은 nginx가 포트폴리오 요청도 받으므로 **10개 반 정도에서 새 연결이 거부**된다(nginx 오류 로그 `worker_connections are not enough`). 50방(약 1,550 WebSocket ≈ nginx 연결 3,100, 전체 연결 상한 2,300까지 차면 약 4,600)을 받으려면 늘려야 한다.

**바꾸는 것**(파일 `/etc/nginx/nginx.conf` — 포트폴리오도 쓰는 전체 설정이므로 교사 승인 ⓒ-2를 따로 받는다. 틀과 설명: 저장소 `deploy/nginx/capacity.md`):
```nginx
# main 문맥(파일 맨 위, events 블록 밖) — 한 줄 추가
worker_rlimit_nofile 12288;

events {
    worker_connections 6144;   # 기존 768에서 변경(다른 줄은 그대로)
    # multi_accept 등 기존 줄은 건드리지 않음
}
```
- 값의 근거(1코어 = 워커 1개): 상한까지 찬 4,600 + 포트폴리오 수백 + 여유 ≈ 6,144. 파일 한도는 워커 연결 수의 2배. 2코어 이상이면 워커가 늘어 여유가 더 커진다(값은 그대로 둔다).
- 이미 v0.2 값(8192/16384)으로 적용했다면 **고치지 않아도 된다**(더 큰 값이고 메모리 차이는 수 MB). 일부러 낮추는 작업은 하지 않는다.
1. **백업**: `sudo cp -a /etc/nginx/nginx.conf /etc/nginx/nginx.conf.bak-$(date +%Y%m%d%H%M)`
2. 위 두 곳만 고친다(`worker_processes`는 그대로 `auto`).
3. **검사**: `sudo nginx -t` — 실패하면 백업으로 되돌리고 멈춘다.
4. **적용**: `sudo systemctl reload nginx`(새 워커가 새 한도로 뜬다. 진행 중인 연결은 기존 워커가 마칠 때까지 유지).
5. **확인**: `for p in $(pgrep -f "nginx: worker"); do grep "open files" /proc/$p/limits; done` → 12288(또는 그 이상). 포트폴리오 첫 화면·주요 페이지 2개 확인.
6. (워커 한도가 12288이 되지 않을 때만, 추가 승인) nginx systemd 드롭인 `/etc/systemd/system/nginx.service.d/limits.conf`에 `[Service]` `LimitNOFILE=12288` → `daemon-reload` → `systemctl restart nginx`(이 경우만 restart — 포트폴리오가 1~2초 끊기므로 수업·방문이 적은 시간에).
- 메모리: `worker_connections`를 늘려도 미리 메모리를 잡지 않는다(연결이 생길 때만 쓴다). 실제 메모리는 1.3.1 표로 관리.
- 되돌리기: 백업 파일 복원 → `nginx -t` → reload.

### 1.6 ⓓ 확인 (적용 직후 10분)
- [ ] `https://lab.ches.es.kr/` 포트폴리오 첫 화면과 주요 페이지 2개가 전과 같다.
- [ ] `https://lab.ches.es.kr/voyage` → `/voyage/`로 넘어가고 타이틀 화면이 나온다. 브라우저 개발자 도구 콘솔 오류 0.
- [ ] `https://lab.ches.es.kr/voyage/health` → `{"ok":true,…}`, `maxRooms`가 1.3.1에서 정한 값, `acceptingNewRooms: true`.
- [ ] 교사 시작 화면과 판 설정에 "사용 중인 방 0/○○"(정한 상한)이 보이고, 타이틀·교사 시작 화면 맨 아래 이용 안내 한 줄과 저작권·문의 줄이 보인다. **타이틀**·학생 입장 화면에는 방 수가 없다(v0.3.4).
- [ ] `https://lab.ches.es.kr/voyage/notice` → 공지 파일이 없으면 `{"level":null}`.
- [ ] 게임 [연결 테스트]: "연결 좋아요"(HTTPS·WebSocket·서버 시각 단계 통과).
- [ ] 교사 탭에서 방 열기 → 다른 기기(휴대폰 LTE 등 학교 밖 망 1개 포함)에서 입장(출석번호 + 회사 이름) → 거래 1번 → 교사 화면 학생 표에 반영.
- [ ] 중계 서버 파일 한도 8192(1.4의 7 확인 명령), (ⓒ-2 했으면) nginx 워커 한도 12288 이상.
- [ ] `journalctl -u voyage-relay -n 50 --no-pager`에 오류 없음, 출석번호·회사 이름 같은 정보가 찍히지 않음.
- [ ] `sudo tail -n 50 /var/log/nginx/error.log`에 `worker_connections are not enough`가 없음.

### 1.7 되돌리기
| 증상 | 조치 |
|---|---|
| 포트폴리오가 이상함(ⓒ-1 뒤) | 즉시 include 줄 삭제(또는 백업 파일 복원) → `sudo nginx -t && sudo systemctl reload nginx` → 확인 후 교사에게 보고 |
| 포트폴리오가 이상함(ⓒ-2 뒤) | 즉시 `/etc/nginx/nginx.conf` 백업 복원(드롭인을 만들었으면 삭제 + `daemon-reload`) → `nginx -t` → reload(드롭인을 지웠으면 restart) → 보고 |
| 게임만 안 됨 | `sudo systemctl stop voyage-relay` 후 원인 조사. 정적 파일은 `current` 링크를 이전 release로 되돌림 |
| 서버 메모리가 모자람(`free -m` available이 200MB 이하로 떨어짐) | `/etc/voyage-relay.env`의 `MAX_ROOMS`를 1.3.1 한 단계 아래로 → **열린 방이 없을 때** `sudo systemctl restart voyage-relay`. 급하면 공지 `blockNewRooms: true`로 새 방만 막고 reload |
| 완전 제거 | include 줄·`snippets/voyage.conf` 삭제 → (ⓒ-2를 되돌릴지 교사에게 확인) → reload → `sudo systemctl disable --now voyage-relay` → 서비스 파일·`/etc/voyage-relay.env`·`/etc/voyage-relay.notice.json`·`/opt/voyage-relay`·`/var/www/voyage` 삭제 → `sudo userdel voyage` |

---

## 2부. 운영 (서버 운영자)

### 2.1 ⓔ 업데이트 배포
- **수업 시간(평일 08:30~16:30)에는 배포하지 않는다.**
- 교사 노트북(Windows, OpenSSH 클라이언트)에서 저장소 루트:
  ```
  npm run deploy                              # 기본 = 미리 보기(dry-run): 할 일과 원격 명령을 출력만, 아무것도 바꾸지 않음
  npm run deploy -- --execute                 # 실제 배포: 검사·테스트 → 빌드 → 업로드 → current 교체 → (중계 서버가 바뀐 경우만) 재시작
  npm run deploy -- --execute --static-only   # 정적 파일만
  npm run deploy -- --execute --relay-only    # 중계 서버만
  npm run deploy -- --pack-only               # 서버에 접속하지 않고 이미 빌드된 결과를 .tmp-deploy/에 묶기만
  npm run deploy -- --help                    # 옵션 설명
  ```
  - (v0.3.1 고침) **옵션 없이 실행하면 미리 보기만 한다.** 실제로 바꾸려면 반드시 `--execute`를 붙인다(작업 128 구현). 먼저 미리 보기로 원격 명령을 읽어 본 뒤 `--execute`로 실행하는 것을 습관으로 한다.
  - 수업 시간(평일 08:30~16:30)에 `--execute`를 하면 거부한다. 꼭 필요하면 `--allow-school-hours`(권하지 않음).
  - 스크립트는 먼저 `https://lab.ches.es.kr/voyage/health`를 읽어 `rooms > 0`이거나 읽지 못하면 **중계 서버 재시작을 거부**한다(`--force`로만 진행, 확인 질문 1번 더). 공개 운영 중에는 다른 학교 방이 열려 있을 수 있으므로 2.5 점검 절차(공지 → 새 방 막기 → 방이 0이 되면 재시작)를 먼저 한다. 정적 파일 교체는 열린 방이 있어도 되지만, 새로 고침한 학생과 아닌 학생의 앱 버전이 달라질 수 있어 화면에 "새로 고침해 주세요"가 뜬다. **중계 서버가 바뀌었는데 재시작이 거부되면 정적 파일도 바꾸지 않는다**(새 앱과 옛 중계 서버가 섞이지 않게). 그럴 때 정적 파일만 바꾸려면 `--static-only`를 쓴다(128 구현).
  - 접속 정보(호스트·사용자·키 경로)는 저장소 밖 파일(`~/.voyage-deploy.json`)이나 환경 변수에서 읽는다. 저장소에 넣지 않는다.
  - 오래된 release는 최근 5개만 남긴다.

### 2.2 상태 보기·로그
| 하고 싶은 것 | 방법 |
|---|---|
| 지금 열린 방·인원 | `curl -s https://lab.ches.es.kr/voyage/health` → `rooms`/`maxRooms`, `acceptingNewRooms`(v0.3 — 화면의 "사용 중인 방" 표시가 씀), `peers`, `conns`/`maxConn`, `memMB`, `blockedIps`, `joinFailPerMin` |
| 서비스 상태 | `systemctl status voyage-relay --no-pager` |
| 로그 | `journalctl -u voyage-relay --since "1 hour ago" --no-pager` (방 열림/닫힘·인원·거부 사유 집계만. 출석번호·회사 이름·내용 없음) |
| 서버 전체 메모리 | `free -m`(available), `ps -eo pid,rss,cmd --sort=-rss \| head` |
| nginx 연결 부족 여부 | `sudo grep -c "worker_connections are not enough" /var/log/nginx/error.log` |
| 공지만 다시 읽기 | `sudo systemctl reload voyage-relay`(연결 유지) |
| 재시작 | 열린 방이 없을 때 `sudo systemctl restart voyage-relay`. 수업 중 재시작하면 학생·교사 화면이 몇 초 끊긴 뒤 같은 코드로 다시 이어진다(PRD 7.3) — 그래도 피한다 |
| 외부 가동 확인(선택) | 무료 가동 확인 서비스에 `https://lab.ches.es.kr/voyage/health`를 5분 간격으로 등록 → 멈추면 메일 알림 |

### 2.3 ⓕ 교사 커뮤니티에 공개 (PRD 10.12, v0.3 — 공개 방식 확정: 교사 커뮤니티 공개 글)
공개 전 확인(교사 승인 ⓕ). **모두 체크되어야 공개 글을 올린다.**

**가. 서버 용량**
- [ ] ⓐ 점검 결과로 정한 `MAX_ROOMS`·`MAX_CONN`·`MemoryMax`가 적용되어 있다(`/health`의 `maxRooms`가 1.3.1 판정 값).
- [ ] 정한 상한이 10을 넘으면 ⓒ-2가 적용되어 있다(nginx 워커 한도 12288 이상). 아니면 `MAX_ROOMS`를 10 이하로 두고 공개하지 않는다.
- [ ] 작업 105 부하 테스트가 정한 상한(기본 50방 × 30명)에서 목표(p95 300ms·p99 1초 이하, 중계 서버 RSS 250MB 이하, 끊김 0)를 만족했다.
- [ ] Lightsail 월 전송 한도가 예상 사용량(PRD 10.10.1 — 예: 월 600판 ≈ 90~150GB)보다 넉넉하다.
- [ ] 외부 가동 확인(무료 가동 확인 서비스에 `/voyage/health`, 5분 간격, 메일 알림)을 등록했다 — **커뮤니티 공개에서는 필수**(v0.3, 이전 선택).

**나. 화면·안내 문구(커뮤니티 공개 기준)**
- [ ] 타이틀·교사 시작 화면 맨 아래에 이용 안내 한 줄 + 둘째 줄 `Copyright 2026. hanuipyo · Instagram @hanuipyo`(글자만, 링크 아님)와 [이용 안내] 창(PRD 10.12.1 전문, 9번 "문의: Instagram @hanuipyo")이 보인다(문구는 v0.3.4에 교사 승인).
- [ ] 서버의 `/var/www/voyage/current/config.json`에 `serverInfo`가 **비어 있다**(넣으면 문의가 그 값으로 바뀜 — 이 서버는 기본값 사용).
- [ ] "사용 중인 방 n/○○"이 교사 시작 화면·판 설정에 맞는 숫자로 보이고, **타이틀·학생 입장 화면·공용 화면에는 없다**(v0.3.4, `display.titleRoomCount` 기본 `false`).
- [ ] 가득 참 동작(판 설정 [방 열기] 비활성 + 안내)과 서버 확인 실패 시 "알 수 없음"(버튼은 켜짐)이 작업 114 로컬 시험에서 확인되었다(운영 서버에서 상한을 일부러 채우지 않는다).
- [ ] `docs/teacher-setup.md` 0장 문구가 화면의 이용 안내 전문과 같다.
- [ ] 공개 `/voyage/health` 응답에 방 코드·IP·이름이 없다(`curl`로 확인). 운영 필드 공개 여부는 PRD 16.2-17 결정대로.

**다. 개인정보·운영**
- [ ] `journalctl -u voyage-relay`에 출석번호·회사 이름·메시지 내용·IP 전체가 없다(최근 1일 확인).
- [ ] 점검 공지 절차(2.4·2.5)를 한 번 연습했다(수업 시간 밖에 `info` 공지 → reload → 화면 확인 → 삭제).
- [ ] 공개 글 초안이 PRD 10.12.2의 순서(소개 → 주소 → 이용 안내 전문 → 준비 → 상한 → (문의처) → (저장소))를 따르고, 서버 운영 정보·개인 연락처(정하지 않은 경우)가 없다.
- [ ] 교사가 공개 글을 올릴 커뮤니티와 시각(수업 시간 밖)을 정했다.

공개 후 운영:
- 다른 교사는 주소 `https://lab.ches.es.kr/voyage`만 알면 된다(계정 없음). 방은 코드별로 완전히 분리된다.
- 첫 2주는 매일 수업 시간이 끝난 뒤 `/health`의 최대치(로그의 1분 집계)와 Lightsail CPU 버스트 그래프를 본다. **방 최대치가 상한의 80%(30이면 24방, 50이면 40방)를 일주일에 3일 넘게 넘거나** 메모리 available이 250MB 아래로 떨어지면 1.3.1 표에 따라 상한을 조정하거나 인스턴스를 키운다(교사 결정).
- 커뮤니티 글의 댓글·문의로 장애가 알려지면: 공지 띠(2.4)로 상황을 먼저 알리고, 원인 조사·되돌리기(1.7) 뒤 공지를 지운다.
- 남용이 보이면(로그의 `ROOM_LIMIT`·`RATE_LIMITED`가 급증) 3.3의 제한 값을 낮추거나, 급하면 공지 `blockNewRooms: true`.
- 개인정보: 서버는 저장하지 않으며 로그에도 출석번호·회사 이름을 남기지 않는다. 학생 기록은 각 교사 브라우저에만 있다(PRD 7.9).

### 2.4 서버 공지 파일
- 위치 `/etc/voyage-relay.notice.json`(환경 변수 `NOTICE_FILE`), 운영자가 `sudo nano`로 고친 뒤 `sudo systemctl reload voyage-relay`. 파일을 지우고 reload하면 공지 없음.
- 형식:
  ```json
  {
    "level": "warn",
    "text": "10월 20일(월) 17:00~18:00 서버 점검이 있어요. 그 시간에는 새 방을 열 수 없어요.",
    "from": "2026-10-20T17:00:00+09:00",
    "until": "2026-10-20T18:00:00+09:00",
    "blockNewRooms": false
  }
  ```
  - `level`: `info`(파랑) / `warn`(주황) / `maintenance`(빨강). `text` 80자 이내.
  - `from`~`until` 밖이면 표시하지 않는다(없으면 항상). `maintenance`이고 지금이 그 사이면 새 방을 막는다. `blockNewRooms: true`면 시각과 관계없이 새 방을 막는다. 이미 열린 방은 그대로.
- 표시 위치: 타이틀·교사 시작 화면·학생 입장 화면 맨 위 띠, 진행 중인 교사 대시보드에는 작은 알림.

### 2.5 점검(재시작이 필요한 배포) 절차
1. 하루 전: `warn` 공지("내일 17:00~18:00 점검").
2. 시작 시각: `maintenance` + `blockNewRooms: true` → reload.
3. `/health`의 `rooms`가 0이 될 때까지 기다린다(최대 1교시. 수업 시간에는 점검하지 않으므로 보통 0).
4. `npm run deploy`(미리 보기)로 할 일을 확인한 뒤 `npm run deploy -- --execute`(재시작 포함).
5. 공지 파일 삭제 → reload → `/health` 확인.

### 2.6 보안 점검표 (분기 1회 권장)
- [ ] `ALLOWED_ORIGINS`가 운영 도메인만 담고 있다.
- [ ] 8787 포트가 밖에서 열리지 않는다(`curl http://lab.ches.es.kr:8787/health`가 실패해야 정상).
- [ ] 서비스가 `voyage` 사용자로 돈다(`ps -o user= -C node`).
- [ ] 저장소에 서버 주소 외 비밀값(키·토큰)이 없다.
- [ ] Ubuntu 보안 업데이트, Node LTS 지원 기간.
- [ ] (공개 중) 로그의 거부 사유 집계에 이상한 급증이 없다.

---

## 3부. 내 서버에 설치하기 (다른 교사용 — README로 옮김)

### 3.1 준비물
- 우분투 서버 1대(메모리 1GB 이상 권장 — 한 학교 몇 반이면 충분(상한 10~30), 여러 학교가 함께 쓰려면 2GB(상한 50)), 도메인과 HTTPS 인증서가 붙은 nginx, Node 20 LTS 이상, SSH 접속.
- 이 저장소(GitHub)와 노트북의 Node 20 이상.

### 3.2 순서 (약 30분)
1. 저장소 받기 → `npm ci` → `npm run build`(정적 파일 `dist/`) → `npm run build:server`(중계 서버 `server/dist/`).
2. 서버에 사용자 `voyage`, 폴더 `/var/www/voyage`, `/opt/voyage-relay` 만들기(1.4의 1).
3. `dist/` → `/var/www/voyage/current/`, `server/` 빌드 결과 → `/opt/voyage-relay/current/` 후 `npm ci --omit=dev`.
4. `/etc/voyage-relay.env` 작성(3.3 표, `ALLOWED_ORIGINS`에 **자기 도메인**, `MAX_ROOMS`는 1.3.1 표 — 한 학교만 쓰면 10~20).
5. `deploy/systemd/voyage-relay.service` 복사(`MemoryMax`·`LimitNOFILE=8192` 확인) → `systemctl enable --now voyage-relay` → `curl http://127.0.0.1:8787/health`.
6. `deploy/nginx/voyage.conf`를 `/etc/nginx/snippets/`에 복사(다른 경로를 쓰려면 파일 안 `/voyage` 5곳을 바꿈) → 자기 사이트 server 블록에 `include snippets/voyage.conf;` → `nginx -t` → reload.
7. 동시 방이 10개를 넘을 것 같으면 `deploy/nginx/capacity.md`대로 `worker_connections`·`worker_rlimit_nofile`을 올린다(1.5.1).
8. `https://<내 도메인>/voyage/`에서 [연결 테스트] → 리허설.
- 다른 경로·다른 도메인에서 중계 서버를 돌린다면 정적 폴더에 `config.json`(`{"relayUrl":"wss://…/ws"}`)을 둔다.

### 3.3 설정값 (`/etc/voyage-relay.env`)
| 이름 | 기본값 | 뜻 |
|---|---|---|
| `HOST` | 127.0.0.1 | 듣는 주소(바깥에 직접 열지 않음) |
| `PORT` | 8787 | 듣는 포트 |
| `ALLOWED_ORIGINS` | https://lab.ches.es.kr | 접속을 허용할 웹 주소(쉼표로 여러 개) |
| `TRUST_PROXY` | 127.0.0.1 | 이 주소에서 온 `X-Real-IP`만 믿음(속도 제한용) |
| `MAX_ROOMS` | **50** (v0.3, 이전 v0.2 100·v0.1 40) | 동시에 열 수 있는 방 수 — 서버 크기에 맞춰 1.3.1. 화면의 "사용 중인 방 n/○○"이 이 값을 그대로 보여 준다 |
| `MAX_PEERS` | 45 | 방당 연결 수(학생 40 + 여유) |
| `MAX_CONN` | **2300** (v0.3 확정, 이전 4600) | 서버 전체 연결 수(= MAX_ROOMS × 46). `MAX_ROOMS`를 바꾸면 이 값도 함께 바꾼다(30방 1400, 10방 500) |
| `MAX_CONN_PER_IP` | **500** (v0.3, 이전 300) | IP당 연결 수(학교는 여러 반이 한 IP를 같이 씀. `MAX_ROOMS_PER_IP` 10방 × 31연결 = 310이 300을 넘어서 올림, 10 × 46 = 460 + 여유) |
| `MAX_ROOMS_PER_IP` | 10 (v0.2 신규) | IP당 동시에 열린 방 수 |
| `ROOM_CREATE_LIMIT` / `ROOM_CREATE_WINDOW` | 20 / 3600 (v0.2 신규) | IP당 방 생성 수 / 초(같은 hostToken으로 다시 여는 것은 세지 않음) |
| `EMPTY_ROOM_TTL` | 1200 (v0.2 신규) | 학생이 한 명도 들어오지 않은 방 삭제(초) |
| `UNJOINED_TIMEOUT` | 30 (v0.2 신규) | 역할을 밝히지 않은 연결 끊기(초) |
| `MSG_RATE` / `MSG_BURST` | 20 / 40 | 연결당 초당 메시지 수 / 순간 허용 |
| `HOST_MSG_RATE` / `HOST_MSG_BURST` | 120 / 240 | 교사(호스트) 연결의 초당 메시지 수 / 순간 허용. 30명 방의 개인 상태 전송을 감당하도록 학생보다 높게 (105 구현) |
| `MAX_MSG_BYTES` | 65536 | 메시지 최대 크기 |
| `JOIN_FAIL_LIMIT` / `JOIN_FAIL_WINDOW` / `JOIN_BLOCK_SEC` / `JOIN_BLOCK_MAX` | **30** / 300 / 120 / **1800** (v0.2) | 없는 방 코드 입력 실패 제한(회 / 초 / 처음 막는 초 / 반복 시 두 배로 늘리는 최대 초) |
| `IDLE_TTL` | 1800 | 무활동 방 삭제(초) |
| `HOST_GRACE` | 1800 | 교사 화면이 끊긴 방 유지(초) |
| `MAX_ROOM_AGE` | 28800 | 방 최대 수명(초, 8시간) |
| `RESUME_GRACE` | 600 | **서버 재시작 복구 유예 시간(초, 10분)** — 아래 설명 참고 (104·105 구현) |
| `CODE_REUSE_BLOCK` | 7200 | 닫힌 방 코드를 다시 쓰지 않는 시간(초) |
| `NOTICE_FILE` | /etc/voyage-relay.notice.json (v0.2 신규) | 서버 공지 파일(없으면 공지 없음, 읽기만) |
| `NODE_OPTIONS` | (없음) | Node 힙 한도, 예 `--max-old-space-size=256`(2GB 서버, 1.3.1 표) |
| `LOG_LEVEL` | info | 로그 수준 |
- **`RESUME_GRACE` 자세히**(v0.3.1 보강): 중계 서버는 아무것도 저장하지 않으므로 재시작(배포·장애·서버 재부팅)하면 열린 방이 모두 메모리에서 사라진다. 교사 브라우저(호스트)는 다시 연결되면 **전에 쓰던 방 코드 + 자기 hostToken**으로 방을 다시 열어 달라고 한다(`src/sync/PROTOCOL.md` 6장).
  - 서버가 켜진 뒤 `RESUME_GRACE`초 **안**이면: 서버에 그 코드의 기록이 없어도(재시작으로 사라졌으므로) **같은 코드로 다시 열어 준다**. 학생 기기는 같은 코드로 자동 재입장하므로 학생이 아무것도 다시 입력하지 않는다. 이 재열기는 점검 차단(`maintenance`·`blockNewRooms`)과 IP당 방 생성 한도 검사는 받지만, 생성 수(`ROOM_CREATE_LIMIT`)에는 세지 않는다. 또 이 시간 동안은 학생 기기의 "없는 방" 입장 실패를 무작위 대입 차단(`JOIN_FAIL_LIMIT`)에 세지 않는다(한 교실 30명이 한 IP에서 동시에 재입장을 시도해도 막히지 않게).
  - `RESUME_GRACE`초가 **지나면**: 기록 없는 코드는 다시 열지 않고 **새 코드**를 준다. 교사 화면과 공용 화면에 새 코드가 크게 나오고, 학생은 새 코드만 입력하면 기기 토큰으로 자기 회사에 돌아온다(토큰 없는 기기는 교사 허락).
  - 재시작이 아닌 경우(방이 무활동·호스트 부재로 닫힌 뒤 같은 교사가 다시 여는 경우)는 서버가 닫힌 방 기록과 hostToken을 대조해 확인하므로 이 값과 관계없다.
  - 값 고르기: 기본 600초면 서버가 다시 켜진 뒤 10분 안에 교사 화면이 돌아오는 대부분의 경우를 덮는다. 0이면 재시작 뒤 언제나 새 코드(가장 엄격). 너무 크게(예: 1시간) 두면 재시작 직후 아무 코드나 먼저 차지할 수 있는 시간이 길어지므로 권하지 않는다(코드는 hostToken이 있어야 열리지만, 기록이 없는 동안은 서버가 진짜 주인을 확인할 수 없다).
- 정확한 이름과 기본값은 작업 104(relay-core 설정)·105(서버)가 `deploy/env.example`에 확정하고, 이 표와 다르면 기획이 이 문서를 고친다.

---

## 변경 이력
| 버전 | 날짜 | 내용 |
|---|---|---|
| v0.1 | 2026-10-08 | 첫 작성(PRD v0.3 — Firebase 삭제, 자체 중계 서버) |
| v0.3.2 | 2026-10-09 | PRD v0.3.4 반영: **1.3.2 ⓐ 점검 결과**(같은 인스턴스에 ras·Next.js·pm2 4개·MySQL·PostgreSQL, RAM 914MB·available 약 408MB·스왑 988MB 사용, nginx `worker_connections 768`, Node v20.20.2, 8787 비어 있음, `sudo -n` 가능) → 1.3.1 표 '상한 30' 구간, 권고표(ⓐ 30으로 공개 / ⓑ 2GB 이전 후 50 / 다른 프로그램 정리) — **상한 결정은 교사 대기**. 1.2 ⓕ 변경 대상에서 `config.json` 제외(문의처 앱 기본값), 2.3 '나' 체크리스트를 저작권·문의 줄·타이틀 방 수 숨김에 맞춤 |
| v0.3.1 | 2026-10-09 | PRD v0.3.3 반영: 2.1 배포 명령을 작업 128 구현과 같게 — **기본 = 미리 보기(dry-run), 실제 배포는 `--execute`**, `--relay-only`·`--pack-only`·`--allow-school-hours`·`--help`, 방 수를 읽지 못해도 재시작 거부. 2.5 점검 절차 4단계도 `--execute`로. 3.3 `RESUME_GRACE` 설명 보강(재시작 복구·같은 코드 재열기·입장 실패 미집계·값 고르기) |
| v0.3 | 2026-10-09 | PRD v0.3.2: **동시 방 50**(`MAX_ROOMS=50`, `MAX_CONN=2300`), `MAX_CONN_PER_IP` 300 → 500, 1.3.1 서버 크기별 상한표 다시 계산(권장 2GB, 1GB 조건부 50/30, available 400MB 미만 → 10), systemd `LimitNOFILE=8192`·`MemoryMax=384M`(2GB 예), nginx `worker_connections 6144`·`worker_rlimit_nofile 12288`(v0.2 값으로 이미 적용했으면 그대로), `/health`의 `acceptingNewRooms`, 1.6 확인에 "사용 중인 방"·이용 안내, **2.3 교사 커뮤니티 공개 체크리스트**(용량·화면 문구·개인정보·운영 세 묶음, 외부 가동 확인 필수) |
| v0.2 | 2026-10-09 | PRD v0.3.1: 서버 공개·동시 방 100. 점검 항목 추가(nginx 연결 설정·워커 파일 한도·Next.js 메모리·커널 한도·Lightsail 콘솔), **1.3.1 서버 크기별 권장 상한**(512MB 이하 → 상한 10·공개 보류·업그레이드 권고), systemd `LimitNOFILE=16384`·`ExecReload`·`MemoryMax` 표, **ⓒ-2 nginx 용량 설정(별도 승인)**, `/voyage/notice`, 공지 파일·점검 절차, ⓕ 공개 전 확인, 환경 변수 추가·변경(MAX_ROOMS 100 등) |
