// 작업 128 — deploy/ 틀 파일 정적 검사(nginx 조각 구조, systemd 값, env.example ↔ server-setup.md 3.3, 예시 JSON)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../..', import.meta.url));
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const stripComments = (s: string) =>
  s
    .split('\n')
    .map((l) => l.replace(/(^|\s)#.*$/, ''))
    .join('\n');

describe('deploy/nginx/voyage.conf', () => {
  const raw = read('deploy/nginx/voyage.conf');
  const conf = stripComments(raw);

  it('중괄호가 맞고 모든 지시어가 ; 또는 { } 로 끝난다', () => {
    let depth = 0;
    for (const ch of conf) {
      if (ch === '{') depth++;
      if (ch === '}') depth--;
      expect(depth).toBeGreaterThanOrEqual(0);
    }
    expect(depth).toBe(0);
    for (const line of conf.split('\n').map((l) => l.trim()).filter(Boolean)) {
      expect(line, line).toMatch(/[;{}]$/);
    }
  });
  it('필요한 location이 있다', () => {
    expect(conf).toMatch(/location = \/voyage \{ return 301 \/voyage\/; \}/);
    expect(conf).toMatch(/location \^~ \/voyage\/ \{[\s\S]*alias \/var\/www\/voyage\/current\/;/);
    expect(conf).toMatch(/location = \/voyage\/ws \{[^}]*proxy_pass http:\/\/127\.0\.0\.1:8787\/ws;/);
    const ws = /location = \/voyage\/ws \{([^}]*)\}/.exec(conf)![1];
    expect(ws).toContain('proxy_http_version 1.1;');
    expect(ws).toContain('proxy_set_header Upgrade $http_upgrade;');
    expect(ws).toContain('proxy_set_header Connection "upgrade";');
    expect(ws).toContain('proxy_read_timeout 120s;');
    expect(conf).toMatch(/location = \/voyage\/health \{[^}]*proxy_pass http:\/\/127\.0\.0\.1:8787\/health;/);
    expect(conf).toMatch(/location = \/voyage\/notice \{[^}]*proxy_pass http:\/\/127\.0\.0\.1:8787\/notice;/);
  });
  it('location / · events · worker_* · server 블록을 정의하지 않는다', () => {
    expect(conf).not.toMatch(/location\s+\/\s*\{/);
    expect(conf).not.toMatch(/\bevents\b/);
    expect(conf).not.toMatch(/\bworker_/);
    expect(conf).not.toMatch(/\bserver\s*\{/);
    expect(conf).not.toMatch(/\blisten\b/);
  });
  it('캐시 규칙', () => {
    expect(conf).toMatch(/alias[^;]*;\s*index index\.html;\s*add_header Cache-Control "no-cache" always;/);
    expect(conf).toMatch(/location \^~ \/voyage\/static\/ \{\s*add_header Cache-Control "public, max-age=604800, immutable" always;/);
    expect(conf).toMatch(/location \^~ \/voyage\/assets\/images\/ \{\s*add_header Cache-Control "public, max-age=86400" always;/);
  });
  it('경로 /voyage를 쓰는 location은 정확히 5종(맨 위 주석과 같음)', () => {
    const names = [...conf.matchAll(/location\s+(=|\^~)\s+(\/voyage[^\s{]*)/g)].map((m) => m[2]);
    const top = new Set(names.filter((n) => !/\/voyage\/(static|assets)/.test(n)));
    expect([...top].sort()).toEqual(['/voyage', '/voyage/', '/voyage/health', '/voyage/notice', '/voyage/ws']);
    expect(raw).toContain('5곳');
  });
});

describe('deploy/systemd/voyage-relay.service', () => {
  const unit = read('deploy/systemd/voyage-relay.service');
  const sections = new Map<string, Map<string, string>>();
  let cur = '';
  for (const line of unit.split('\n').map((l) => l.trim())) {
    if (!line || line.startsWith('#')) continue;
    const s = /^\[(\w+)\]$/.exec(line);
    if (s) {
      cur = s[1]!;
      sections.set(cur, new Map());
      continue;
    }
    const kv = /^([A-Za-z]+)=(.*)$/.exec(line);
    expect(kv, `systemd 줄 형식: ${line}`).not.toBeNull();
    expect(cur, '섹션 밖의 키').not.toBe('');
    sections.get(cur)!.set(kv![1]!, kv![2]!);
  }
  const svc = sections.get('Service')!;

  it('섹션과 값(server-setup.md v0.3 1.4)', () => {
    expect([...sections.keys()]).toEqual(['Unit', 'Service', 'Install']);
    expect(svc.get('LimitNOFILE')).toBe('8192');
    expect(svc.get('MemoryMax')).toBe('384M');
    expect(svc.get('ExecReload')).toBe('/bin/kill -HUP $MAINPID');
    expect(svc.get('ExecStart')).toMatch(/^\/\S+\/node dist\/index\.js$/);
    expect(svc.get('User')).toBe('voyage');
    expect(svc.get('EnvironmentFile')).toBe('/etc/voyage-relay.env');
    expect(svc.get('WorkingDirectory')).toBe('/opt/voyage-relay/current');
    expect(svc.get('Restart')).toBe('always');
    expect(sections.get('Install')!.get('WantedBy')).toBe('multi-user.target');
  });
  it('node 경로 안내는 홈 밖 절대 경로(ProtectHome=true)', () => {
    expect(unit).not.toMatch(/nvm이면|~\/\.nvm\/\.\.\. 의 절대 경로/);
    expect(unit).toContain('홈 폴더 밖');
    expect(unit).toContain('203/EXEC');
    expect(svc.get('ProtectHome')).toBe('true');
  });
  it('주석에 서버 크기별 표(1.3.1)', () => {
    for (const s of ['160M / 128', '256M / 192', '320M / 224', '384M / 256', '512M / 384', 'LimitNOFILE=16384']) expect(unit).toContain(s);
  });
});

describe('deploy/env.example ↔ docs/server-setup.md 3.3', () => {
  const env = new Map<string, string>();
  for (const line of read('deploy/env.example').split('\n')) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m) env.set(m[1]!, m[2]!);
  }
  const doc = read('docs/server-setup.md');
  const table = doc.slice(doc.indexOf('### 3.3'), doc.indexOf('## 변경 이력'));
  const rows: [string, string][] = [];
  for (const line of table.split('\n')) {
    const m = /^\| (`[A-Z_]+`(?: \/ `[A-Z_]+`)*) \| ([^|]+) \|/.exec(line);
    if (!m) continue;
    const names = [...m[1]!.matchAll(/`([A-Z_]+)`/g)].map((x) => x[1]!);
    const vals = m[2]!.replace(/\*\*/g, '').replace(/\(.*?\)/g, '').trim().split(/\s+\/\s+/);
    names.forEach((n, i) => rows.push([n, (vals[i] ?? '').trim()]));
  }

  it('표의 변수가 모두 있고 기본값이 같다', () => {
    expect(rows.length).toBeGreaterThan(25);
    for (const [name, val] of rows) {
      expect(env.has(name), `${name} 없음`).toBe(true);
      if (name === 'NODE_OPTIONS') expect(env.get(name)).toBe('--max-old-space-size=256');
      else expect(env.get(name), name).toBe(val);
    }
  });
  it('50방 기준 값', () => {
    expect(env.get('MAX_ROOMS')).toBe('50');
    expect(env.get('MAX_CONN')).toBe('2300');
    expect(env.get('MAX_CONN_PER_IP')).toBe('500');
  });
});

describe('capacity.md · 예시 JSON', () => {
  it('capacity.md 값(6144/12288)과 승인 경고', () => {
    const md = read('deploy/nginx/capacity.md');
    expect(md).toContain('worker_rlimit_nofile 12288;');
    expect(md).toContain('worker_connections 6144;');
    expect(md).toContain('LimitNOFILE=12288');
    expect(md).toContain('교사 승인');
    expect(md).toContain('8192/16384');
  });
  it('notice.example.json = server-setup.md 2.4 형식', () => {
    const n = JSON.parse(read('deploy/notice.example.json'));
    expect(Object.keys(n)).toEqual(['level', 'text', 'from', 'until', 'blockNewRooms']);
    expect(['info', 'warn', 'maintenance']).toContain(n.level);
    expect(n.text.length).toBeLessThanOrEqual(80);
  });
  it('config.example.json = serverInfo(operator·contact·repoUrl) 빈 값 + display.titleRoomCount false(v0.3.4 타이틀 숨김)', () => {
    const c = JSON.parse(read('deploy/config.example.json'));
    expect(c).toEqual({ serverInfo: { operator: '', contact: '', repoUrl: '' }, display: { titleRoomCount: false } });
  });
});
