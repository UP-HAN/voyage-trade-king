# nginx 용량 설정 (ⓒ-2) — `worker_connections`·`worker_rlimit_nofile`

> **[교사 승인 필요 — 별도 단계 ⓒ-2]**
> 이 설정은 `/etc/nginx/nginx.conf`, 즉 **기존 Next.js 포트폴리오도 함께 쓰는 nginx 전체 설정**을 바꾼다.
> `voyage.conf` 조각(include 한 줄, ⓒ-1)과 **따로** 승인을 받고, 수업 시간(평일 08:30~16:30) 밖에 한다.
> 배포 스크립트(`npm run deploy`)는 이 작업을 하지 않는다 — 사람이 아래 순서대로 한다.
>
> 출처: `docs/server-setup.md` v0.3 1.5.1, `docs/PRD.md` v0.3.2 10.9·10.10.1

## 왜 조각(include)으로 넣을 수 없나
`worker_rlimit_nofile`은 **main 문맥**(파일 맨 위, 어떤 블록에도 속하지 않음), `worker_connections`는 **events 블록** 안에만 쓸 수 있다. `voyage.conf` 조각은 사이트의 `server` 블록 안에 include되므로 이 두 줄을 넣으면 `nginx -t`가 실패한다. 그래서 `nginx.conf` 본문을 직접 고쳐야 하고, 그 파일은 서버 전체(포트폴리오 포함)에 적용된다.

## 왜 필요한가
nginx가 WebSocket을 프록시하면 연결 하나에 nginx 연결 2개(학생↔nginx, nginx↔중계 서버)를 쓴다. Ubuntu 기본 `worker_connections 768`(워커당)이면 1코어 서버에서 동시 WebSocket 약 380개가 한계이고, 같은 nginx가 포트폴리오 요청도 받으므로 **10개 반 정도에서 새 연결이 거부**된다(nginx 오류 로그 `worker_connections are not enough`). 동시 방이 10개를 넘을 것 같으면 이 설정이 필요하다. 이 설정 전에는 `MAX_ROOMS`를 10 이하로 두고 공개하지 않는다.

## 계산 근거 (50방 기준, 1코어 = 워커 1개)
| 항목 | 계산 | 값 |
|---|---|---|
| 평소 WebSocket 연결 | 50방 × 31(교사 1 + 학생 30) | 약 1,550 |
| 평소 nginx 연결 | 1,550 × 2(클라이언트 + 업스트림) | 약 3,100 |
| 전체 연결 상한까지 찼을 때 | `MAX_CONN` 2,300 × 2 | 약 4,600 |
| + 포트폴리오 요청 + 여유 | 4,600 + 수백 + 여유 | **`worker_connections 6144`** (상한까지 차도 약 1,500 남음) |
| 워커 파일 한도 | 워커 연결 수 × 2 | **`worker_rlimit_nofile 12288`** |

- 2코어 이상이면 워커가 늘어 여유가 더 커진다(값은 그대로 둔다).
- 메모리: `worker_connections`를 늘려도 미리 메모리를 잡지 않는다(연결이 생길 때만 쓴다). 실제 메모리는 `docs/server-setup.md` 1.3.1 표로 관리한다.

## 바꾸는 것
```nginx
# main 문맥(파일 맨 위, events 블록 밖) — 한 줄 추가
worker_rlimit_nofile 12288;

events {
    worker_connections 6144;   # 기존 768에서 변경(다른 줄은 그대로)
    # multi_accept 등 기존 줄은 건드리지 않음
}
```
`worker_processes`는 그대로(`auto`) 둔다.

## 순서
1. **백업**: `sudo cp -a /etc/nginx/nginx.conf /etc/nginx/nginx.conf.bak-$(date +%Y%m%d%H%M)`
2. 위 **두 곳만** 고친다(`sudo nano /etc/nginx/nginx.conf`).
3. **검사**: `sudo nginx -t` — 실패하면 백업으로 되돌리고 멈춘다.
4. **적용**: `sudo systemctl reload nginx`(restart 아님. 새 워커가 새 한도로 뜨고, 진행 중인 연결은 기존 워커가 마칠 때까지 유지).
5. **확인**:
   - `for p in $(pgrep -f "nginx: worker"); do grep "open files" /proc/$p/limits; done` → 12288(또는 그 이상)
   - 포트폴리오 첫 화면·주요 페이지 2개가 전과 같다.
6. (워커 한도가 12288이 되지 않을 때만, **추가 승인**) nginx systemd 드롭인:
   ```ini
   # /etc/systemd/system/nginx.service.d/limits.conf
   [Service]
   LimitNOFILE=12288
   ```
   → `sudo systemctl daemon-reload` → `sudo systemctl restart nginx`(이 경우만 restart — 포트폴리오가 1~2초 끊기므로 수업·방문이 적은 시간에).

## 되돌리기
백업 파일 복원 → `sudo nginx -t` → `sudo systemctl reload nginx`. 드롭인을 만들었으면 삭제 → `daemon-reload` → `restart`. 그 뒤 포트폴리오 확인, 교사에게 보고.

## 이미 다른 값으로 적용했다면
- **이미 v0.2 값(8192/16384)으로 적용했다면 고치지 않아도 된다**(더 큰 값이고 메모리 차이는 수 MB). 일부러 낮추는 작업은 하지 않는다.
- **동시 방을 100으로 올릴 때**(4GB 이상 서버, 부하 측정·운영 2주 관찰 뒤 교사 결정)는 `worker_connections 8192`, `worker_rlimit_nofile 16384`(드롭인이 필요하면 `LimitNOFILE=16384`)로 올린다. 중계 서버도 `LimitNOFILE=16384`, `MAX_CONN=4600`.

## 적용 뒤 점검
- `sudo grep -c "worker_connections are not enough" /var/log/nginx/error.log` → 0이어야 한다.
