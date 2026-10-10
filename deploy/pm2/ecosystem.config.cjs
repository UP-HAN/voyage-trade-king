/**
 * 대항해 무역왕 — 중계 서버 pm2 설정 (기존 서버가 pm2를 쓸 때의 대안, docs/server-setup.md 1.4 끝)
 * 기본은 systemd(deploy/systemd/voyage-relay.service). pm2로 맞추기로 했다면 systemd는 쓰지 않는다.
 *
 *   cd /opt/voyage-relay/current && pm2 start /path/to/ecosystem.config.cjs && pm2 save
 *   공지 다시 읽기(연결 유지): pm2 sendSignal SIGHUP voyage-relay
 *
 * 주의
 * - pm2는 열린 파일 한도를 **pm2 데몬의 한도로 물려받는다**(systemd의 LimitNOFILE 같은 설정이 없음).
 *   `ulimit -n`(또는 grep "open files" /proc/<pm2 데몬 PID>/limits)이 8192 이상인지 확인하고 교사에게 보고한다.
 *   1024면 약 1,000연결에서 새 연결이 거부된다. pm2 데몬을 systemd(pm2-<사용자>.service)로 띄웠다면
 *   그 서비스에 LimitNOFILE=8192를 넣어야 한다(별도 승인 — 기존 Next.js도 같은 데몬에서 돈다).
 * - 환경 변수는 deploy/env.example(= /etc/voyage-relay.env)과 같은 이름·값. 서버 크기별 값(docs/server-setup.md 1.3.1 v0.3):
 *     512MB 이하 → MAX_ROOMS 10, MAX_CONN 500,  메모리 160M / --max-old-space-size=128
 *     1GB(available 400~599MB) → 30, 1400, 256M / 192
 *     1GB(available 600MB 이상) → 50, 2300, 320M / 224
 *     2GB(권장) → 50, 2300, 384M / 256   ← 아래 기본값
 *     4GB 이상 → 50, 2300, 512M / 384 (100방으로 올릴 때만 MAX_CONN 4600, 파일 한도 16384)
 * - max_memory_restart는 systemd MemoryMax와 같은 값으로(넘으면 pm2가 재시작 → 열린 방이 몇 초 끊김).
 * - 이 파일에 비밀값을 넣지 않는다.
 */
module.exports = {
  apps: [
    {
      name: 'voyage-relay',
      cwd: '/opt/voyage-relay/current',
      script: 'dist/index.js',
      // Node 절대 경로가 필요하면: interpreter: '/opt/node20/bin/node',
      node_args: '--max-old-space-size=256',
      exec_mode: 'fork',
      instances: 1, // 방 상태가 메모리에 있으므로 반드시 1개(cluster 금지)
      autorestart: true,
      restart_delay: 2000,
      max_memory_restart: '384M',
      kill_timeout: 5000, // SIGTERM 뒤 server.restarting 알림 → 2초 뒤 닫기를 기다림
      env: {
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: '8787',
        ALLOWED_ORIGINS: 'https://lab.ches.es.kr',
        TRUST_PROXY: '127.0.0.1',
        NOTICE_FILE: '/etc/voyage-relay.notice.json',
        LOG_LEVEL: 'info',
        MAX_ROOMS: '50',
        MAX_PEERS: '45',
        MAX_CONN: '2300',
        MAX_CONN_PER_IP: '500',
        MAX_ROOMS_PER_IP: '10',
        ROOM_CREATE_LIMIT: '20',
        ROOM_CREATE_WINDOW: '3600',
        EMPTY_ROOM_TTL: '1200',
        UNJOINED_TIMEOUT: '30',
        IDLE_TTL: '1800',
        HOST_GRACE: '1800',
        MAX_ROOM_AGE: '28800',
        CODE_REUSE_BLOCK: '7200',
        RESUME_GRACE: '600',
        MSG_RATE: '20',
        MSG_BURST: '40',
        HOST_MSG_RATE: '120',
        HOST_MSG_BURST: '240',
        MAX_MSG_BYTES: '65536',
        JOIN_FAIL_LIMIT: '30',
        JOIN_FAIL_WINDOW: '300',
        JOIN_BLOCK_SEC: '120',
        JOIN_BLOCK_MAX: '1800',
      },
    },
  ],
};
