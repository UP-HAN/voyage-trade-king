// 작업 128 — scripts/deploy.mjs 순수 함수 테스트(서버 접속 없음)
import { describe, expect, it } from 'vitest';
import {
  activateScript,
  buildRelayLock,
  cleanupScript,
  decidePlan,
  describeRollback,
  relayPreparePlan,
  rollbackScript,
  runDeploy,
  staticPreparePlan,
  findDangerousCommands,
  formatHealth,
  isSchoolHours,
  loadDeployConfig,
  parseArgs,
  pruneScript,
  relayRestartDecision,
  releaseStamp,
  renderDryRun,
  schoolHoursGate,
  validateConfig,
  type DeployConfig,
  type DeployDeps,
  type Health,
} from '../../scripts/deploy.mjs';

const FAKE: DeployConfig = {
  host: 'deploy-test.invalid',
  user: 'tester',
  keyPath: '~/.ssh/test_key',
  port: 22,
  staticRoot: '/var/www/voyage',
  relayRoot: '/opt/voyage-relay',
  service: 'voyage-relay',
  healthUrl: 'https://deploy-test.invalid/voyage/health',
  remoteNpm: 'npm',
};

// 로컬 시각으로 만든다(스크립트도 현지 시각 기준). 2026-10-12는 월요일.
const at = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi);

describe('시간 검사(평일 08:30~16:30 거부)', () => {
  it('평일 경계', () => {
    expect(at(2026, 10, 12, 8, 29).getDay()).toBe(1);
    expect(isSchoolHours(at(2026, 10, 12, 8, 29))).toBe(false);
    expect(isSchoolHours(at(2026, 10, 12, 8, 30))).toBe(true);
    expect(isSchoolHours(at(2026, 10, 12, 12, 0))).toBe(true);
    expect(isSchoolHours(at(2026, 10, 16, 16, 29))).toBe(true); // 금요일
    expect(isSchoolHours(at(2026, 10, 12, 16, 30))).toBe(false);
    expect(isSchoolHours(at(2026, 10, 12, 21, 0))).toBe(false);
  });
  it('주말은 언제든 허용', () => {
    expect(isSchoolHours(at(2026, 10, 10, 10, 0))).toBe(false); // 토
    expect(isSchoolHours(at(2026, 10, 11, 10, 0))).toBe(false); // 일
  });
  it('--allow-school-hours로만 통과', () => {
    const t = at(2026, 10, 13, 10, 0);
    expect(schoolHoursGate(t, false).ok).toBe(false);
    expect(schoolHoursGate(t, false).message).toContain('수업 시간');
    expect(schoolHoursGate(t, true).ok).toBe(true);
  });
  it('release 이름 YYYYMMDD-HHMM', () => {
    expect(releaseStamp(at(2026, 1, 2, 3, 4))).toBe('20260102-0304');
  });
});

describe('rooms > 0이면 중계 서버 재시작 거부', () => {
  it('열린 방 0 → 허용', () => {
    expect(relayRestartDecision({ ok: true, rooms: 0, maxRooms: 50 })).toMatchObject({ allowed: true, needsConfirm: false });
  });
  it('열린 방 있음 → 거부 + 점검 공지 안내', () => {
    const d = relayRestartDecision({ ok: true, rooms: 3, maxRooms: 50 });
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain('3개');
    expect(d.reason).toContain('점검 공지');
    expect(d.reason).toContain('2.5');
  });
  it('/health를 못 읽으면 거부(모르면 안전하게)', () => {
    expect(relayRestartDecision(null).allowed).toBe(false);
    expect(relayRestartDecision({ ok: true } as never).allowed).toBe(false);
  });
  it('--force면 확인 질문 뒤 진행', () => {
    expect(relayRestartDecision({ rooms: 5 }, { force: true })).toMatchObject({ allowed: true, needsConfirm: true });
    expect(relayRestartDecision(null, { force: true })).toMatchObject({ allowed: true, needsConfirm: true });
  });
  it('/health 한 줄 요약', () => {
    expect(formatHealth({ ok: true, rooms: 3, maxRooms: 50, acceptingNewRooms: true, notice: null })).toBe('열린 방 3/50, 새 방 받는 중, 공지 없음');
    expect(formatHealth({ ok: true, rooms: 50, maxRooms: 50, acceptingNewRooms: false, notice: 'maintenance' })).toBe(
      '열린 방 50/50, 새 방 받지 않음, 공지 maintenance',
    );
    expect(formatHealth(null)).toContain('알 수 없음');
  });
});

describe('옵션', () => {
  it('기본은 dry-run, --execute여야 실행', () => {
    expect(parseArgs([]).mode).toBe('dry-run');
    expect(parseArgs(['--dry-run']).mode).toBe('dry-run');
    expect(parseArgs(['--execute']).mode).toBe('execute');
    expect(parseArgs(['--pack-only']).mode).toBe('pack');
  });
  it('조합', () => {
    expect(parseArgs(['--static-only'])).toMatchObject({ doStatic: true, doRelay: false });
    expect(parseArgs(['--relay-only'])).toMatchObject({ doStatic: false, doRelay: true });
    expect(parseArgs(['--static-only', '--relay-only']).problems.length).toBe(1);
    expect(parseArgs(['--dry-run', '--execute']).problems.length).toBe(1);
    expect(parseArgs(['--nope']).problems[0]).toContain('--nope');
  });
});

describe('설정 파싱', () => {
  const noFile = { exists: () => false, readFile: () => '', home: '/home/x' };
  it('파일·환경 변수가 없으면 missing', () => {
    expect(loadDeployConfig({ env: {}, ...noFile }).status).toBe('missing');
  });
  it('~/.voyage-deploy.json 읽기 + 기본값', () => {
    const r = loadDeployConfig({
      env: {},
      home: '/home/x',
      exists: (p) => p.replace(/\\/g, '/').endsWith('/home/x/.voyage-deploy.json'),
      readFile: () => JSON.stringify({ host: 'a.example', user: 'me', healthUrl: 'https://a.example/voyage/health' }),
    });
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.config).toMatchObject({ port: 22, staticRoot: '/var/www/voyage', relayRoot: '/opt/voyage-relay', service: 'voyage-relay' });
  });
  it('환경 변수만으로도 되고 파일보다 우선', () => {
    const r = loadDeployConfig({
      env: { VOYAGE_DEPLOY_HOST: 'b.example', VOYAGE_DEPLOY_USER: 'u', VOYAGE_HEALTH_URL: 'https://b.example/voyage/health', VOYAGE_DEPLOY_PORT: '2222' },
      ...noFile,
    });
    expect(r.status).toBe('ok');
    if (r.status === 'ok') expect(r.config.port).toBe(2222);
  });
  it('깨진 JSON·위험한 폴더는 invalid', () => {
    expect(loadDeployConfig({ env: {}, home: '/h', exists: () => true, readFile: () => '{' }).status).toBe('invalid');
    const bad = (over: Partial<DeployConfig>) => validateConfig({ ...FAKE, ...over }).problems;
    expect(bad({ staticRoot: '/' })).not.toHaveLength(0);
    expect(bad({ staticRoot: '/var' })).not.toHaveLength(0);
    expect(bad({ staticRoot: '/etc/nginx/x' })).not.toHaveLength(0);
    expect(bad({ relayRoot: '/var/www/voyage/x' })).not.toHaveLength(0); // 겹침
    expect(bad({ staticRoot: '/var/www/a b' })).not.toHaveLength(0);
    expect(bad({ service: 'nginx' })).not.toHaveLength(0);
    expect(bad({ host: '-oProxyCommand=x' })).not.toHaveLength(0);
    expect(bad({ healthUrl: 'nope' })).not.toHaveLength(0);
    expect(bad({})).toHaveLength(0);
  });
});

describe('원격 명령', () => {
  const now = at(2026, 10, 12, 18, 5);
  const all = renderDryRun(FAKE, parseArgs([]), now);

  it('dry-run 출력에 위험 명령이 없다', () => {
    expect(findDangerousCommands(all, FAKE)).toEqual([]);
    expect(all).not.toMatch(/rm -rf \/(\s|$)/);
    expect(all).not.toContain('/etc/nginx');
    expect(all).not.toMatch(/systemctl\s+\w+\s+nginx/);
    expect(all).not.toMatch(/\.next\b|pm2 /);
    expect(all).toContain('--execute');
  });
  it('검사기가 위험 명령을 잡는다', () => {
    expect(findDangerousCommands('rm -rf /')).not.toHaveLength(0);
    expect(findDangerousCommands("rm -rf -- '/'")).not.toHaveLength(0);
    expect(findDangerousCommands('sudo tee /etc/nginx/nginx.conf')).not.toHaveLength(0);
    expect(findDangerousCommands('sudo systemctl reload nginx')).not.toHaveLength(0);
    expect(findDangerousCommands('rm -rf /home/ubuntu/portfolio', FAKE)).not.toHaveLength(0);
    expect(findDangerousCommands("rm -rf -- '/opt/voyage-relay/releases'/\"$d\"", FAKE)).toEqual([]);
  });
  it('정적 준비는 config.json을 보존하고, 링크 교체는 교체 단계에서 함께', () => {
    const s = staticPreparePlan(FAKE, '20261012-1805', '.tmp-deploy/static.tgz').script.join('\n');
    expect(s).toContain("cp -p '/var/www/voyage/current/config.json' '/var/www/voyage/releases/20261012-1805/config.json'");
    expect(s).not.toContain('ln -sfn');
    const a = activateScript(FAKE, '20261012-1805', { doStatic: true, doRelay: true }).join('\n');
    expect(a.indexOf('PREV_STATIC=')).toBeLessThan(a.indexOf("ln -sfn '/var/www/voyage/releases/20261012-1805'"));
    expect(a.indexOf("ln -sfn '/opt/voyage-relay/releases/20261012-1805'")).toBeLessThan(a.indexOf("systemctl restart 'voyage-relay'"));
    expect(a).toContain('PREV_RELAY=');
    expect(all).toContain('config.json');
  });
  it('중계 서버 준비: npm ci --omit=dev(재시작 없음), lock 없으면 npm install', () => {
    const s = relayPreparePlan(FAKE, '20261012-1805', 'x').script.join('\n');
    expect(s).toContain('npm ci --omit=dev');
    expect(s).not.toContain('systemctl');
    expect(relayPreparePlan(FAKE, 'x', 'x', { hasLock: false }).script.join('\n')).toContain('npm install --omit=dev');
  });
  it('실패한 release 정리는 current가 가리키지 않을 때만, 허용 폴더 안에서만', () => {
    const s = cleanupScript(FAKE, '20261012-1805', { doStatic: true, doRelay: true }).join('\n');
    expect(s).toContain("rm -rf -- '/var/www/voyage/releases/20261012-1805'");
    expect(s).toContain("!= '/opt/voyage-relay/releases/20261012-1805'");
    expect(findDangerousCommands(s, FAKE)).toEqual([]);
    const rb = rollbackScript(FAKE, {
      prevStatic: '/var/www/voyage/releases/a',
      prevRelay: '/opt/voyage-relay/releases/b',
      doStatic: true,
      doRelay: true,
      restart: true,
    }).join('\n');
    expect(rb).toContain('RESTART=ok');
    expect(findDangerousCommands(rb, FAKE)).toEqual([]);
  });
  it('정리는 release 이름 형식만, 최근 5개 남김', () => {
    const s = pruneScript('/var/www/voyage').join('\n');
    expect(s).toContain("grep -E '^[0-9]{8}-[0-9]{4}$'");
    expect(s).toContain('tail -n +6');
    expect(findDangerousCommands(s, FAKE)).toEqual([]);
  });
  it('--static-only면 중계 서버 명령이 없다', () => {
    const s = renderDryRun(FAKE, parseArgs(['--static-only']), now);
    expect(s).not.toContain('systemctl');
    expect(s).not.toContain('/opt/voyage-relay/releases');
    expect(s).not.toContain('npm ci');
  });
  it('수업 시간 dry-run은 멈출 것이라고 알린다', () => {
    expect(renderDryRun(FAKE, parseArgs([]), at(2026, 10, 12, 10, 0))).toContain('여기서 멈춤');
  });
});

describe('중계 서버 lock 추출', () => {
  it('루트 lock에서 ws만 뽑는다', () => {
    const lock = buildRelayLock(
      {
        lockfileVersion: 3,
        packages: {
          '': { name: 'root' },
          'node_modules/ws': { version: '8.22.0', resolved: 'r', integrity: 'i', peerDependencies: { bufferutil: '^4' } },
          'node_modules/vite': { version: '1', dev: true },
        },
      },
      { name: 'voyage-relay', version: '0.1.0', dependencies: { ws: '^8.22.0' } },
    );
    expect(lock).not.toBeNull();
    expect(Object.keys(lock!.packages)).toEqual(['', 'node_modules/ws']);
  });
  it('찾지 못하면 null', () => {
    expect(buildRelayLock({ lockfileVersion: 3, packages: {} }, { name: 'a', version: '1', dependencies: { ws: '1' } })).toBeNull();
  });
});

describe('배포 순서(오케스트레이터 결정): 재시작이 거부되면 정적도 바꾸지 않음', () => {
  const opts = (a: string[] = []) => parseArgs(['--execute', ...a]);
  it('decidePlan', () => {
    expect(decidePlan(opts(), { rooms: 2 }, true)).toMatchObject({ abort: true, doStatic: false, doRelay: false });
    expect(decidePlan(opts(), { rooms: 2 }, true).reason).toContain('정적 파일도 바꾸지 않아요');
    expect(decidePlan(opts(), null, true).abort).toBe(true);
    expect(decidePlan(opts(), { rooms: 0 }, true)).toMatchObject({ abort: false, doStatic: true, doRelay: true });
    expect(decidePlan(opts(), { rooms: 2 }, false)).toMatchObject({ abort: false, doStatic: true, doRelay: false });
    expect(decidePlan(opts(['--static-only']), { rooms: 2 }, true)).toMatchObject({ abort: false, doStatic: true, doRelay: false });
    expect(decidePlan(opts(['--relay-only']), { rooms: 0 }, false)).toMatchObject({ abort: false, doStatic: false, doRelay: false });
    expect(decidePlan(opts(['--force']), { rooms: 2 }, true)).toMatchObject({ abort: false, doRelay: true, needsConfirm: true });
  });
});

const PREV_OUT = 'PREV_STATIC=/var/www/voyage/releases/20261001-1700\nPREV_RELAY=/opt/voyage-relay/releases/20261001-1700\n';
const NOW_OLD = 'NOW_STATIC=/var/www/voyage/releases/20261001-1700\nNOW_RELAY=/opt/voyage-relay/releases/20261001-1700\n';

/** 서버 접속 없는 가짜 의존성 — 무엇이 실행됐는지 기록 */
function fakeDeps(
  o: { health?: Health | null; remoteHash?: string; activateStatus?: number; rollbackStdout?: string; healthy?: boolean; confirm?: boolean } = {},
) {
  const calls: { kind: string; text: string }[] = [];
  const out: string[] = [];
  const deps: DeployDeps = {
    log: (s) => out.push(s),
    err: (s) => out.push(s),
    runNpm: () => 0,
    readHealth: async () => (o.health === undefined ? { ok: true, rooms: 0, maxRooms: 50, acceptingNewRooms: true, notice: null } : o.health),
    waitHealthy: async () => (o.healthy === false ? null : { ok: true, rooms: 0, maxRooms: 50 }),
    packStatic: async () => ({ tar: '.tmp-deploy/static.tgz', hash: 's', files: 1 }),
    packRelay: async () => ({ tar: '.tmp-deploy/relay.tgz', hash: 'NEW', hasLock: true, files: 1 }),
    confirm: async () => o.confirm ?? false,
    runScp: (local, remote) => {
      calls.push({ kind: 'scp', text: `${local} ${remote}` });
      return 0;
    },
    runSsh: (lines) => {
      const text = lines.join('\n');
      calls.push({ kind: 'ssh', text });
      if (text.includes('.bundle-hash')) return { status: 0, stdout: `${o.remoteHash ?? 'OLD'}\n` };
      if (text.includes('PREV_STATIC') || text.includes('PREV_RELAY')) return { status: o.activateStatus ?? 0, stdout: PREV_OUT };
      if (text.includes('NOW_')) return { status: 0, stdout: o.rollbackStdout ?? '' };
      return { status: 0, stdout: '' };
    },
  };
  return { deps, calls, out };
}

describe('runDeploy(가짜 의존성 — 서버 접속 없음)', () => {
  const evening = at(2026, 10, 12, 18, 5);
  const ex = (a: string[] = []) => parseArgs(['--execute', ...a]);
  const ln = (calls: { text: string }[]) => calls.filter((c) => c.text.includes('ln -sfn'));

  it('열린 방이 있고 중계 서버가 바뀌었으면: 아무것도 올리지도 바꾸지도 않는다(정적 포함)', async () => {
    const f = fakeDeps({ health: { ok: true, rooms: 3, maxRooms: 50, acceptingNewRooms: true, notice: null } });
    expect(await runDeploy(FAKE, ex(), f.deps, evening)).toBe(1);
    expect(f.calls.filter((c) => c.kind === 'scp')).toHaveLength(0);
    expect(ln(f.calls)).toHaveLength(0);
    expect(f.out.join('\n')).toContain('정적 파일도 바꾸지 않아요');
  });
  it('중계 서버가 그대로면 열린 방이 있어도 정적만 바꾼다(재시작 없음)', async () => {
    const f = fakeDeps({ health: { ok: true, rooms: 3, maxRooms: 50 }, remoteHash: 'NEW' });
    expect(await runDeploy(FAKE, ex(), f.deps, evening)).toBe(0);
    const all = f.calls.map((c) => c.text).join('\n');
    expect(all).toContain("ln -sfn '/var/www/voyage/releases/20261012-1805' '/var/www/voyage/current'");
    expect(all).not.toContain('systemctl restart');
  });
  it('--static-only면 열린 방이 있어도 정적만 바꾼다(재시작 없음)', async () => {
    const f = fakeDeps({ health: { ok: true, rooms: 3, maxRooms: 50 } });
    expect(await runDeploy(FAKE, ex(['--static-only']), f.deps, evening)).toBe(0);
    const all = f.calls.map((c) => c.text).join('\n');
    expect(all).toContain("ln -sfn '/var/www/voyage/releases/20261012-1805' '/var/www/voyage/current'");
    expect(all).not.toContain('systemctl restart');
  });
  it('열린 방 0: 둘 다 준비한 뒤 한 번에 교체 + 재시작', async () => {
    const f = fakeDeps();
    expect(await runDeploy(FAKE, ex(), f.deps, evening)).toBe(0);
    const kinds = f.calls.map((c) => (c.text.includes('ln -sfn') ? 'activate' : c.kind));
    expect(kinds.indexOf('activate')).toBeGreaterThan(kinds.lastIndexOf('scp'));
    expect(ln(f.calls)).toHaveLength(1);
    expect(ln(f.calls)[0]!.text).toContain('systemctl restart');
  });
  it('--force여도 확인에 yes가 없으면 아무것도 바꾸지 않는다', async () => {
    const f = fakeDeps({ health: { ok: true, rooms: 3 }, confirm: false });
    expect(await runDeploy(FAKE, ex(['--force']), f.deps, evening)).toBe(1);
    expect(f.calls.filter((c) => c.kind === 'scp')).toHaveLength(0);
  });
  it('수업 시간이면 아무것도 하지 않는다', async () => {
    const f = fakeDeps();
    expect(await runDeploy(FAKE, ex(), f.deps, at(2026, 10, 12, 10, 0))).toBe(1);
    expect(f.calls).toHaveLength(0);
  });
  it('교체(재시작) 실패 → 둘 다 되돌리고 결과를 출력, 실패한 release를 지운다', async () => {
    const f = fakeDeps({ activateStatus: 1, rollbackStdout: `${NOW_OLD}RESTART=fail\nACTIVE=active\n` });
    expect(await runDeploy(FAKE, ex(), f.deps, evening)).toBe(1);
    const text = f.out.join('\n');
    expect(text).toContain('정적: 이전 release로 되돌렸어요 — 지금 current → /var/www/voyage/releases/20261001-1700');
    expect(text).toContain('중계 서버: 이전 release로 되돌렸어요');
    expect(text).toContain('다시 시작하지 못했어요');
    expect(text).toContain('되돌리기가 완전하지 않아요');
    expect(f.calls.some((c) => c.text.includes("rm -rf -- '/opt/voyage-relay/releases/20261012-1805'"))).toBe(true);
  });
  it('health 확인 실패 → 되돌리기 성공 메시지', async () => {
    const f = fakeDeps({ healthy: false, rollbackStdout: `${NOW_OLD}RESTART=ok\nACTIVE=active\n` });
    expect(await runDeploy(FAKE, ex(), f.deps, evening)).toBe(1);
    expect(f.out.join('\n')).toContain('되돌리기 성공.');
  });
});

describe('describeRollback', () => {
  const base = { prevStatic: '/var/www/voyage/releases/a', prevRelay: '/opt/voyage-relay/releases/b', doStatic: true, doRelay: true, restart: true };
  it('링크가 기대와 다르면 실패로 알린다', () => {
    const d = describeRollback(FAKE, { ...base, stdout: 'NOW_STATIC=/var/www/voyage/releases/new\nNOW_RELAY=/opt/voyage-relay/releases/b\nRESTART=ok\nACTIVE=active' });
    expect(d.ok).toBe(false);
    expect(d.lines.join('\n')).toContain('정적: 되돌리기 실패 — 지금 current → /var/www/voyage/releases/new');
  });
  it('이전 release가 없으면(첫 배포) 손으로 확인 안내', () => {
    const d = describeRollback(FAKE, { ...base, prevRelay: null, stdout: 'NOW_STATIC=/var/www/voyage/releases/a\nRESTART=ok' });
    expect(d.ok).toBe(false);
    expect(d.lines.join('\n')).toContain('되돌릴 이전 release가 없어요');
  });
  it('모두 성공', () => {
    const d = describeRollback(FAKE, { ...base, stdout: 'NOW_STATIC=/var/www/voyage/releases/a\nNOW_RELAY=/opt/voyage-relay/releases/b\nRESTART=ok\nACTIVE=active' });
    expect(d).toMatchObject({ ok: true });
    expect(d.lines[0]).toBe('되돌리기 성공.');
  });
});
