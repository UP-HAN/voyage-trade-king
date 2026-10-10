#!/usr/bin/env bash
# 대항해 무역왕 — nginx 조각 로컬 검사 (작업 128, 선택 — Docker 필요)
#
#   bash deploy/check-nginx.sh
#
# 하는 일(서버에 접속하지 않음, 로컬 Docker 컨테이너 안에서만):
#   1) nginx:1.18 이미지에 "가짜 사이트 server 블록 + include voyage.conf + 정규식 location(~* \.(js|css)$ → :3000)"을 넣고 nginx -t
#   2) 요청 라우팅 확인: /voyage → 301, /voyage/x.js·/voyage/static/a.js 는 정적 파일(정규식 location에 가로채이지 않음),
#      /voyage/static/ 캐시 헤더 immutable, /voyage/ no-cache, /voyage/health·/voyage/notice 는 :8787 프록시, / 는 :3000
# 하지 않는 일: v0.3.1 7번의 동시 1,000연결 용량 시험(worker_connections 768 vs 6144/12288)은 이 스크립트에 없다.
#
# 상태: 작업 128 환경에 Docker가 없어 **실행해 보지 못했다**(result.md 참고). 처음 쓸 때 출력을 꼭 확인할 것.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
if ! command -v docker >/dev/null 2>&1; then
  echo "docker가 없어 검사를 건너뜀" >&2
  exit 0
fi

WORK="$(mktemp -d)"
NAME="voyage-nginx-check-$$"
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -r -- "$WORK"; }
trap cleanup EXIT

mkdir -p "$WORK/snippets" "$WORK/www/current/static" "$WORK/www/current/assets/images"
cp "$HERE/nginx/voyage.conf" "$WORK/snippets/voyage.conf"
# 컨테이너 안의 정적 폴더 위치에 맞춰 alias만 바꾼 사본
sed -i.bak 's#/var/www/voyage/current/#/srv/voyage/current/#' "$WORK/snippets/voyage.conf"
echo '<!doctype html><title>voyage</title>' > "$WORK/www/current/index.html"
echo 'console.log("static")' > "$WORK/www/current/x.js"
echo 'console.log("hashed")' > "$WORK/www/current/static/a.js"
echo 'img' > "$WORK/www/current/assets/images/a.png"

cat > "$WORK/default.conf" <<'EOF'
# 가짜 "기존 포트폴리오" 사이트 + 가짜 업스트림(3000 = Next.js, 8787 = 중계 서버)
server { listen 3000; location / { return 200 "nextjs\n"; } }
server { listen 8787; location / { add_header Cache-Control no-store; return 200 "relay $uri\n"; } }
server {
    listen 80;
    server_name _;
    include /etc/nginx/snippets/voyage.conf;
    location ~* \.(js|css)$ { proxy_pass http://127.0.0.1:3000; }
    location / { proxy_pass http://127.0.0.1:3000; }
}
EOF

docker run -d --name "$NAME" -p 127.0.0.1::80 \
  -v "$WORK/default.conf:/etc/nginx/conf.d/default.conf:ro" \
  -v "$WORK/snippets:/etc/nginx/snippets:ro" \
  -v "$WORK/www:/srv/voyage:ro" \
  nginx:1.18 >/dev/null
sleep 1
docker exec "$NAME" nginx -t
PORT="$(docker port "$NAME" 80/tcp | head -n1 | sed 's/.*://')"
B="http://127.0.0.1:$PORT"

fail=0
expect() { # 설명, 실제, 기대(부분 문자열)
  if [[ "$2" == *"$3"* ]]; then echo "OK   $1"; else echo "FAIL $1 — 기대: $3 / 실제: $2"; fail=1; fi
}
expect "/voyage → 301"                 "$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$B/voyage")" "301"
expect "/voyage/ index no-cache"       "$(curl -s -D - "$B/voyage/" | tr -d '\r')" "Cache-Control: no-cache"
expect "/voyage/x.js 정적(정규식 무시)" "$(curl -s "$B/voyage/x.js")" 'console.log("static")'
expect "/voyage/static/a.js 정적"      "$(curl -s "$B/voyage/static/a.js")" 'console.log("hashed")'
expect "/voyage/static/ immutable"     "$(curl -s -D - -o /dev/null "$B/voyage/static/a.js" | tr -d '\r')" "immutable"
expect "/voyage/assets/images 1일"     "$(curl -s -D - -o /dev/null "$B/voyage/assets/images/a.png" | tr -d '\r')" "max-age=86400"
expect "/voyage/health → 8787"         "$(curl -s "$B/voyage/health")" "relay /health"
expect "/voyage/notice → 8787"         "$(curl -s "$B/voyage/notice")" "relay /notice"
expect "/ → 포트폴리오(3000)"           "$(curl -s "$B/")" "nextjs"
expect "/other.js → 포트폴리오(3000)"   "$(curl -s "$B/other.js")" "nextjs"
exit "$fail"
