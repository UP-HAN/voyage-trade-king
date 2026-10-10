#!/usr/bin/env node
/**
 * 대항해 무역왕 — 업데이트 배포 스크립트 (작업 128, docs/server-setup.md 2.1·2.5, PRD 10.9)
 *
 *   npm run deploy                         # 기본 = 미리 보기(dry-run): 할 일과 원격 명령을 출력만 한다
 *   npm run deploy -- --execute            # 실제 배포(설정 파일 필요, 수업 시간 거부, 열린 방이 있으면 중계 서버 재시작 거부)
 *   npm run deploy -- --execute --static-only
 *   npm run deploy -- --execute --relay-only
 *   npm run deploy -- --pack-only          # 서버에 접속하지 않고 이미 빌드된 dist/·server/dist/를 .tmp-deploy/에 묶기만
 *
 * 옵션: --dry-run(기본), --execute, --static-only, --relay-only, --force, --allow-school-hours, --pack-only, --help
 *
 * 원칙
 * - 의존성 없음(Node 20+). 원격 작업은 시스템의 ssh·scp, 묶기는 tar를 부른다(Windows OpenSSH·Git Bash·macOS·Linux).
 * - 서버 주소·사용자·키 경로는 저장소 밖 `~/.voyage-deploy.json` 또는 환경 변수(VOYAGE_DEPLOY_*)에서만 읽는다.
 *   이 파일 안에는 서버 주소를 적지 않는다.
 * - 원격 명령은 실행 전에 모두 화면에 보여 준다. 정적 폴더(staticRoot)·중계 서버 폴더(relayRoot)와
 *   `systemctl restart <service>` 밖의 것을 건드리지 않는다. nginx 설정(/etc/nginx)·Next.js 폴더는 절대 건드리지 않는다
 *   (nginx 조각·용량 설정은 사람이 교사 승인 뒤 docs/server-setup.md 1.5·1.5.1대로 한다).
 * - Windows + 한글 경로에서 fs.rmSync·fs.cpSync가 프로세스를 죽이므로 쓰지 않는다(fs.promises.rm, copyFileSync + 직접 순회).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** 묶음을 만드는 임시 폴더(.gitignore의 .tmp-* 규칙에 걸림). 프로젝트 루트 기준 상대 경로로만 쓴다 — scp·tar가 `C:` 를 호스트로 읽지 않게 */
export const STAGE_DIR = '.tmp-deploy';
/** 남길 release 수 (server-setup.md 2.1) */
export const KEEP_RELEASES = 5;
/** 재시작 뒤 /health ok를 기다리는 시간(ms) */
export const HEALTH_WAIT_MS = 10_000;
export const CONFIG_FILE_NAME = '.voyage-deploy.json';

/* ───────────────────────── 옵션 ───────────────────────── */

const FLAGS = {
  '--dry-run': 'dryRun',
  '--execute': 'execute',
  '--static-only': 'staticOnly',
  '--relay-only': 'relayOnly',
  '--force': 'force',
  '--allow-school-hours': 'allowSchoolHours',
  '--pack-only': 'packOnly',
  '--help': 'help',
  '-h': 'help',
};

/**
 * 명령행 옵션 읽기. 모르는 옵션·서로 맞지 않는 조합은 problems에 담는다.
 * 기본은 미리 보기(dry-run)이고 `--execute`가 있어야 실제로 실행한다.
 */
export function parseArgs(argv) {
  const o = {
    dryRun: false,
    execute: false,
    staticOnly: false,
    relayOnly: false,
    force: false,
    allowSchoolHours: false,
    packOnly: false,
    help: false,
  };
  const problems = [];
  for (const a of argv) {
    const key = FLAGS[a];
    if (key) o[key] = true;
    else problems.push(`모르는 옵션: ${a}`);
  }
  if (o.dryRun && o.execute) problems.push('--dry-run과 --execute는 함께 쓸 수 없어요');
  if (o.staticOnly && o.relayOnly) problems.push('--static-only와 --relay-only는 함께 쓸 수 없어요');
  if (o.packOnly && o.execute) problems.push('--pack-only는 서버에 접속하지 않아요(--execute와 함께 쓸 수 없음)');
  const mode = o.packOnly ? 'pack' : o.execute ? 'execute' : 'dry-run';
  return {
    ...o,
    mode,
    doStatic: !o.relayOnly,
    doRelay: !o.staticOnly,
    problems,
  };
}

/* ───────────────────────── 시간 검사 ───────────────────────── */

/**
 * 수업 시간(평일 08:30 이상 16:30 미만, 이 컴퓨터의 현지 시각)인가 — server-setup.md 2.1.
 * @param {Date} date
 */
export function isSchoolHours(date) {
  const day = date.getDay(); // 0 일요일 … 6 토요일
  if (day === 0 || day === 6) return false;
  const minutes = date.getHours() * 60 + date.getMinutes();
  return minutes >= 8 * 60 + 30 && minutes < 16 * 60 + 30;
}

/**
 * 시간 검사 결과. 수업 시간이면 `--allow-school-hours`로만 통과.
 * @returns {{ ok: boolean, message: string }}
 */
export function schoolHoursGate(date, allowSchoolHours) {
  if (!isSchoolHours(date)) return { ok: true, message: '수업 시간 밖이에요.' };
  if (allowSchoolHours) return { ok: true, message: '수업 시간이지만 --allow-school-hours로 진행해요.' };
  return { ok: false, message: '수업 시간(평일 08:30~16:30)에는 배포하지 않아요. 꼭 해야 하면 --allow-school-hours를 붙이세요.' };
}

/** release 폴더 이름 YYYYMMDD-HHMM(현지 시각) */
export function releaseStamp(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}`;
}

/* ───────────────────────── 설정 ───────────────────────── */

export const CONFIG_DEFAULTS = Object.freeze({
  port: 22,
  staticRoot: '/var/www/voyage',
  relayRoot: '/opt/voyage-relay',
  service: 'voyage-relay',
  remoteNpm: 'npm',
});

/** 환경 변수 → 설정 키 */
export const CONFIG_ENV = Object.freeze({
  host: 'VOYAGE_DEPLOY_HOST',
  user: 'VOYAGE_DEPLOY_USER',
  keyPath: 'VOYAGE_DEPLOY_KEY',
  port: 'VOYAGE_DEPLOY_PORT',
  staticRoot: 'VOYAGE_STATIC_ROOT',
  relayRoot: 'VOYAGE_RELAY_ROOT',
  service: 'VOYAGE_SERVICE',
  healthUrl: 'VOYAGE_HEALTH_URL',
  remoteNpm: 'VOYAGE_REMOTE_NPM',
});

/** 설정이 없을 때 보여 줄 예시(주소는 자리표시) */
export const CONFIG_EXAMPLE = {
  host: '<서버 도메인 또는 IP>',
  user: '<SSH 사용자>',
  keyPath: '<SSH 개인 키 경로, 선택 — 예: C:/Users/me/.ssh/id_ed25519>',
  port: 22,
  staticRoot: '/var/www/voyage',
  relayRoot: '/opt/voyage-relay',
  service: 'voyage-relay',
  healthUrl: 'https://<서버 도메인>/voyage/health',
};

/** 위험한 루트 폴더(이것 자체나 그 아래는 배포 폴더로 받지 않음) */
const FORBIDDEN_PREFIXES = ['/etc', '/usr', '/bin', '/sbin', '/lib', '/boot', '/proc', '/sys', '/dev', '/root', '/run'];
const SAFE_PATH = /^\/[A-Za-z0-9._\-/]+$/;

function checkRoot(name, value, problems) {
  if (typeof value !== 'string' || !SAFE_PATH.test(value)) {
    problems.push(`${name}는 영문·숫자·._-/ 로 된 절대 경로여야 해요(받은 값: ${JSON.stringify(value)})`);
    return;
  }
  const clean = value.replace(/\/+$/, '');
  const segs = clean.split('/').filter(Boolean);
  if (segs.length < 2 || segs.includes('..') || segs.includes('.')) {
    problems.push(`${name}는 두 단계 이상의 폴더여야 해요(예: /var/www/voyage, 받은 값: ${value})`);
    return;
  }
  for (const p of FORBIDDEN_PREFIXES) {
    if (clean === p || clean.startsWith(`${p}/`)) problems.push(`${name}가 시스템 폴더(${p}) 아래예요: ${value}`);
  }
  if (/nginx/i.test(clean)) problems.push(`${name}에 nginx 폴더를 쓸 수 없어요: ${value}`);
}

/**
 * 설정 값 검사·정리.
 * @returns {{ config: object|null, problems: string[] }}
 */
export function validateConfig(raw) {
  const problems = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { config: null, problems: ['설정은 JSON 객체여야 해요'] };
  const c = { ...CONFIG_DEFAULTS };
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined || v === null || v === '') continue;
    c[k] = v;
  }
  if (typeof c.host !== 'string' || !/^[A-Za-z0-9.-]+$/.test(c.host) || c.host.startsWith('-')) problems.push('host가 없거나 형식이 틀렸어요(도메인 또는 IPv4)');
  if (typeof c.user !== 'string' || !/^[a-z_][a-z0-9_.-]*$/i.test(c.user)) problems.push('user가 없거나 형식이 틀렸어요');
  if (c.keyPath !== undefined && (typeof c.keyPath !== 'string' || c.keyPath.startsWith('-'))) problems.push('keyPath 형식이 틀렸어요');
  const port = Number(c.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) problems.push(`port는 1~65535 정수여야 해요(받은 값: ${c.port})`);
  else c.port = port;
  checkRoot('staticRoot', c.staticRoot, problems);
  checkRoot('relayRoot', c.relayRoot, problems);
  if (typeof c.staticRoot === 'string' && typeof c.relayRoot === 'string') {
    const a = c.staticRoot.replace(/\/+$/, '');
    const b = c.relayRoot.replace(/\/+$/, '');
    c.staticRoot = a;
    c.relayRoot = b;
    if (a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)) problems.push('staticRoot와 relayRoot는 서로 다른(겹치지 않는) 폴더여야 해요');
  }
  if (typeof c.service !== 'string' || !/^[A-Za-z0-9@._-]+$/.test(c.service) || /nginx/i.test(c.service)) problems.push('service 이름이 틀렸어요(예: voyage-relay, nginx는 안 됨)');
  if (typeof c.remoteNpm !== 'string' || !/^[A-Za-z0-9._\-/]+$/.test(c.remoteNpm)) problems.push('remoteNpm은 npm 또는 절대 경로여야 해요');
  try {
    const u = new URL(String(c.healthUrl));
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('protocol');
  } catch {
    problems.push('healthUrl이 없거나 형식이 틀렸어요(예: https://<서버 도메인>/voyage/health)');
  }
  return { config: problems.length ? null : c, problems };
}

/**
 * 설정 읽기: ① VOYAGE_DEPLOY_CONFIG(파일 경로) ② ~/.voyage-deploy.json ③ 환경 변수 VOYAGE_DEPLOY_*.
 * 파일과 환경 변수가 둘 다 있으면 환경 변수가 이긴다.
 * @returns {{ status: 'missing' } | { status: 'invalid', source: string, problems: string[] } | { status: 'ok', source: string, config: object }}
 */
export function loadDeployConfig({ env = process.env, home = homedir(), readFile = (p) => readFileSync(p, 'utf8'), exists = existsSync } = {}) {
  const file = env.VOYAGE_DEPLOY_CONFIG ? resolve(env.VOYAGE_DEPLOY_CONFIG) : join(home, CONFIG_FILE_NAME);
  let raw = {};
  const sources = [];
  if (exists(file)) {
    try {
      raw = JSON.parse(readFile(file));
      sources.push(file);
    } catch (e) {
      return { status: 'invalid', source: file, problems: [`JSON을 읽을 수 없어요: ${e instanceof Error ? e.message : e}`] };
    }
  } else if (env.VOYAGE_DEPLOY_CONFIG) {
    return { status: 'invalid', source: file, problems: ['VOYAGE_DEPLOY_CONFIG가 가리키는 파일이 없어요'] };
  }
  let fromEnv = false;
  for (const [k, name] of Object.entries(CONFIG_ENV)) {
    if (env[name] !== undefined && env[name] !== '') {
      raw = { ...raw, [k]: env[name] };
      fromEnv = true;
    }
  }
  if (fromEnv) sources.push('환경 변수 VOYAGE_DEPLOY_*');
  if (!sources.length) return { status: 'missing' };
  const { config, problems } = validateConfig(raw);
  if (!config) return { status: 'invalid', source: sources.join(' + '), problems };
  return { status: 'ok', source: sources.join(' + '), config };
}

export function configHelpText() {
  return [
    `배포 설정이 없어요. 저장소 밖 홈 폴더에 ${CONFIG_FILE_NAME}를 만드세요(저장소에 넣지 않음):`,
    `  위치: ${join('~', CONFIG_FILE_NAME)}  (Windows: %USERPROFILE%\\${CONFIG_FILE_NAME})`,
    '',
    JSON.stringify(CONFIG_EXAMPLE, null, 2),
    '',
    '또는 환경 변수: ' + Object.values(CONFIG_ENV).join(', '),
    '(다른 위치의 파일을 쓰려면 VOYAGE_DEPLOY_CONFIG=<경로>)',
  ].join('\n');
}

/* ───────────────────────── /health ───────────────────────── */

/** /health 응답 한 줄 요약 — "열린 방 3/50, 새 방 받는 중, 공지 없음" */
export function formatHealth(h) {
  if (!h || typeof h !== 'object') return '/health를 읽지 못했어요(열린 방 수 알 수 없음)';
  const rooms = Number.isFinite(h.rooms) ? h.rooms : '?';
  const max = Number.isFinite(h.maxRooms) ? h.maxRooms : '?';
  const accepting = h.acceptingNewRooms === true ? '새 방 받는 중' : h.acceptingNewRooms === false ? '새 방 받지 않음' : '새 방 여부 알 수 없음';
  const notice = h.notice ? `공지 ${h.notice}` : '공지 없음';
  const ok = h.ok === true ? '' : ' (ok 아님)';
  return `열린 방 ${rooms}/${max}, ${accepting}, ${notice}${ok}`;
}

/**
 * 중계 서버 재시작 판단(server-setup.md 2.1): 열린 방이 있거나 방 수를 모르면 거부, `--force`면 확인 질문 뒤 진행.
 * @returns {{ allowed: boolean, needsConfirm: boolean, reason: string }}
 */
export function relayRestartDecision(health, { force = false } = {}) {
  const rooms = health && typeof health === 'object' && Number.isFinite(health.rooms) ? health.rooms : null;
  if (rooms === 0) return { allowed: true, needsConfirm: false, reason: '열린 방이 없어요.' };
  const why =
    rooms === null
      ? '/health를 읽지 못해 열린 방이 있는지 알 수 없어요.'
      : `열린 방이 ${rooms}개 있어요. 재시작하면 그 방들이 몇 초 끊겨요.`;
  const hint = '공개 운영 중이면 먼저 점검 공지를 하세요(docs/server-setup.md 2.5: 공지 → 새 방 막기 → 방이 0이 되면 배포).';
  if (force) return { allowed: true, needsConfirm: true, reason: `${why} --force로 진행하려면 확인이 필요해요. ${hint}` };
  return { allowed: false, needsConfirm: false, reason: `${why} 중계 서버 재시작을 하지 않아요(--force로만 진행). ${hint}` };
}

async function readHealth(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000), headers: { 'cache-control': 'no-cache' } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/* ───────────────────────── 원격 명령 만들기 ───────────────────────── */

/** 셸 작은따옴표 인용 */
export function shq(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

const releasePath = (root, stamp) => `${root}/releases/${stamp}`;
const sameReleaseMsg = (rel) => `같은 이름의 release가 이미 있어요: ${rel} — 1분 뒤 다시 실행하세요`;

/**
 * 정적 release 준비: 올린 묶음을 새 release 폴더에 풀고 `config.json`을 보존한다(current는 아직 바꾸지 않음).
 * `config.json`은 덮어쓰지 않는다 — 새 release에 없으면 이전 current의 것을 복사.
 * @returns {{ upload: { local: string, remote: string }, script: string[] }}
 */
export function staticPreparePlan(cfg, stamp, localTar) {
  const R = cfg.staticRoot;
  const rel = releasePath(R, stamp);
  const tgz = `${rel}.tgz`;
  return {
    upload: { local: localTar, remote: tgz },
    script: [
      `test ! -e ${shq(rel)} || { echo ${shq(sameReleaseMsg(rel))} >&2; exit 1; }`,
      `mkdir ${shq(rel)}`,
      `tar -xzf ${shq(tgz)} -C ${shq(rel)}`,
      `rm -f ${shq(tgz)}`,
      `# config.json 보존(운영자가 정한 serverInfo·serviceNotice·display·relayUrl이 배포마다 사라지지 않게)`,
      `if [ ! -e ${shq(`${rel}/config.json`)} ] && [ -f ${shq(`${R}/current/config.json`)} ]; then cp -p ${shq(`${R}/current/config.json`)} ${shq(`${rel}/config.json`)}; echo 'config.json 보존함'; fi`,
    ],
  };
}

/** 중계 서버 쪽 지난 배포 해시 읽기(읽기 전용) */
export function relayHashReadScript(cfg) {
  return [`cat ${shq(`${cfg.relayRoot}/current/.bundle-hash`)} 2>/dev/null || true`];
}

/** 중계 서버 release 준비: 풀기 → npm ci(current는 아직 바꾸지 않음, 재시작 없음) */
export function relayPreparePlan(cfg, stamp, localTar, { hasLock = true } = {}) {
  const R = cfg.relayRoot;
  const rel = releasePath(R, stamp);
  const tgz = `${rel}.tgz`;
  const install = hasLock
    ? `${cfg.remoteNpm} ci --omit=dev --no-audit --no-fund`
    : `${cfg.remoteNpm} install --omit=dev --no-audit --no-fund --no-package-lock`;
  return {
    upload: { local: localTar, remote: tgz },
    script: [
      `test ! -e ${shq(rel)} || { echo ${shq(sameReleaseMsg(rel))} >&2; exit 1; }`,
      `mkdir ${shq(rel)}`,
      `tar -xzf ${shq(tgz)} -C ${shq(rel)}`,
      `rm -f ${shq(tgz)}`,
      `cd ${shq(rel)} && ${install}`,
    ],
  };
}

/**
 * 교체: 이전 링크를 출력(PREV_STATIC=/PREV_RELAY=) → current 링크를 함께 교체 → (중계 포함이면) 재시작.
 * 정적·중계를 한 원격 스크립트에서 바꿔 "새 앱 + 옛 중계 서버"가 섞이는 시간을 줄인다.
 */
export function activateScript(cfg, stamp, { doStatic, doRelay }) {
  const lines = [];
  if (doStatic) lines.push(`echo "PREV_STATIC=$(readlink ${shq(`${cfg.staticRoot}/current`)} || true)"`);
  if (doRelay) lines.push(`echo "PREV_RELAY=$(readlink ${shq(`${cfg.relayRoot}/current`)} || true)"`);
  if (doStatic) lines.push(`ln -sfn ${shq(releasePath(cfg.staticRoot, stamp))} ${shq(`${cfg.staticRoot}/current`)}`);
  if (doRelay) {
    lines.push(`ln -sfn ${shq(releasePath(cfg.relayRoot, stamp))} ${shq(`${cfg.relayRoot}/current`)}`);
    lines.push(`sudo -n systemctl restart ${shq(cfg.service)}`);
  }
  return lines;
}

/** 원격 출력에서 `KEY=값` 줄 읽기 */
export function readMarker(stdout, key) {
  const m = new RegExp(`^${key}=(.*)$`, 'm').exec(stdout || '');
  return m ? m[1].trim() : null;
}

const validPrev = (root, prev) => !!prev && prev.startsWith(`${root}/releases/`) && SAFE_PATH.test(prev);

/**
 * 되돌리기: 이전 release로 링크 복원 → 지금 링크 출력(NOW_*) → (재시작이 필요하면) 재시작 결과(RESTART=ok|fail, ACTIVE=…).
 * 실패해도 끝까지 가서 결과 표시가 나오게 `set -e`에 걸리지 않도록 쓴다.
 */
export function rollbackScript(cfg, { prevStatic = null, prevRelay = null, doStatic = false, doRelay = false, restart = false } = {}) {
  const lines = [];
  if (doStatic && validPrev(cfg.staticRoot, prevStatic)) lines.push(`ln -sfn ${shq(prevStatic)} ${shq(`${cfg.staticRoot}/current`)} || echo 'LINK_FAIL=static'`);
  if (doRelay && validPrev(cfg.relayRoot, prevRelay)) lines.push(`ln -sfn ${shq(prevRelay)} ${shq(`${cfg.relayRoot}/current`)} || echo 'LINK_FAIL=relay'`);
  if (doStatic) lines.push(`echo "NOW_STATIC=$(readlink ${shq(`${cfg.staticRoot}/current`)} || true)"`);
  if (doRelay) lines.push(`echo "NOW_RELAY=$(readlink ${shq(`${cfg.relayRoot}/current`)} || true)"`);
  if (restart) {
    lines.push(`if sudo -n systemctl restart ${shq(cfg.service)}; then echo 'RESTART=ok'; else echo 'RESTART=fail'; fi`);
    lines.push(`echo "ACTIVE=$(systemctl is-active ${shq(cfg.service)} || true)"`);
  }
  return lines;
}

/**
 * 되돌리기 결과를 한국어로 정리(순수 함수 — 테스트 대상).
 * @returns {{ ok: boolean, lines: string[] }}
 */
export function describeRollback(cfg, { stdout = '', status = 0, prevStatic = null, prevRelay = null, doStatic = false, doRelay = false, restart = false } = {}) {
  const lines = [];
  let ok = status === 0;
  if (doStatic) {
    const now = readMarker(stdout, 'NOW_STATIC');
    if (!validPrev(cfg.staticRoot, prevStatic)) {
      ok = false;
      lines.push(`정적: 되돌릴 이전 release가 없어요(첫 배포?) — 지금 current → ${now || '알 수 없음'}. 손으로 확인하세요.`);
    } else if (now === prevStatic) {
      lines.push(`정적: 이전 release로 되돌렸어요 — 지금 current → ${now}`);
    } else {
      ok = false;
      lines.push(`정적: 되돌리기 실패 — 지금 current → ${now || '알 수 없음'} (기대: ${prevStatic}). 손으로 확인하세요.`);
    }
  }
  if (doRelay) {
    const now = readMarker(stdout, 'NOW_RELAY');
    if (!validPrev(cfg.relayRoot, prevRelay)) {
      ok = false;
      lines.push(`중계 서버: 되돌릴 이전 release가 없어요(첫 배포?) — 지금 current → ${now || '알 수 없음'}. 손으로 확인하세요.`);
    } else if (now === prevRelay) {
      lines.push(`중계 서버: 이전 release로 되돌렸어요 — 지금 current → ${now}`);
    } else {
      ok = false;
      lines.push(`중계 서버: 되돌리기 실패 — 지금 current → ${now || '알 수 없음'} (기대: ${prevRelay}). 손으로 확인하세요.`);
    }
  }
  if (restart) {
    const r = readMarker(stdout, 'RESTART');
    const active = readMarker(stdout, 'ACTIVE') || '알 수 없음';
    if (r === 'ok') {
      lines.push(`중계 서버: 이전 release로 다시 시작했어요(systemctl is-active: ${active}).`);
    } else {
      ok = false;
      lines.push(
        `중계 서버: 다시 시작하지 못했어요(sudo 권한 등, systemctl is-active: ${active}). ` +
          `재시작이 처음부터 안 됐다면 기존 프로세스가 배포 전 코드로 계속 돌고 있어요. sudo systemctl status ${cfg.service} 로 확인하세요.`,
      );
    }
  }
  if (status !== 0 && !lines.length) lines.push('되돌리기 원격 명령이 실패했어요. 손으로 확인하세요.');
  return { ok, lines: [ok ? '되돌리기 성공.' : '되돌리기가 완전하지 않아요 — 아래를 확인하세요.', ...lines] };
}

/** 실패한 새 release 폴더 정리(current가 가리키지 않을 때만) — 같은 분 안에 다시 실행해도 멈추지 않게 */
export function cleanupScript(cfg, stamp, { doStatic = false, doRelay = false } = {}) {
  const lines = [];
  for (const [on, root] of [
    [doStatic, cfg.staticRoot],
    [doRelay, cfg.relayRoot],
  ]) {
    if (!on) continue;
    const rel = releasePath(root, stamp);
    lines.push(`rm -f -- ${shq(`${rel}.tgz`)}`);
    lines.push(`if [ "$(readlink ${shq(`${root}/current`)} || true)" != ${shq(rel)} ]; then rm -rf -- ${shq(rel)}; echo "실패한 release 지움: ${rel}"; fi`);
  }
  return lines;
}

/** 오래된 release 정리: 이름이 YYYYMMDD-HHMM인 폴더만, 최근 KEEP개와 current가 가리키는 것은 남김 */
export function pruneScript(root, keep = KEEP_RELEASES) {
  const releases = `${root}/releases`;
  return [
    `CUR=$(basename "$(readlink ${shq(`${root}/current`)})")`,
    `ls -1 ${shq(releases)} | grep -E '^[0-9]{8}-[0-9]{4}$' | sort -r | tail -n +${keep + 1} | while read -r d; do [ "$d" = "$CUR" ] || { echo "지움: $d"; rm -rf -- ${shq(releases)}/"$d"; }; done`,
  ];
}

/**
 * 무엇을 바꿀지 정한다(순수 함수 — 테스트 대상, 오케스트레이터 결정 2026-10-09).
 * - 기본(정적 + 중계): 중계 서버가 바뀌었는데 재시작이 거부되면(열린 방 등) **정적도 바꾸지 않는다** — 새 앱 + 옛 중계 서버 조합 방지.
 *   중계 서버가 그대로면 정적만 바꾼다(재시작 없음).
 * - `--static-only`: 정적만(재시작 판단 없음). `--relay-only`: 중계만.
 * @returns {{ abort: boolean, doStatic: boolean, doRelay: boolean, needsConfirm: boolean, reason: string }}
 */
export function decidePlan(opts, health, relayChanged) {
  if (!opts.doRelay) return { abort: false, doStatic: true, doRelay: false, needsConfirm: false, reason: '--static-only: 정적 파일만 바꿔요(중계 서버 재시작 없음).' };
  if (!relayChanged) {
    if (!opts.doStatic) return { abort: false, doStatic: false, doRelay: false, needsConfirm: false, reason: '중계 서버가 지난 배포와 같아요 — 할 일이 없어요.' };
    return { abort: false, doStatic: true, doRelay: false, needsConfirm: false, reason: '중계 서버가 지난 배포와 같아요 — 정적 파일만 바꾸고 재시작하지 않아요.' };
  }
  const d = relayRestartDecision(health, { force: opts.force });
  if (!d.allowed) {
    const extra = opts.doStatic ? ' 새 앱과 옛 중계 서버가 섞이지 않도록 정적 파일도 바꾸지 않아요(정적만 바꾸려면 --static-only).' : '';
    return { abort: true, doStatic: false, doRelay: false, needsConfirm: false, reason: `${d.reason}${extra}` };
  }
  return { abort: false, doStatic: opts.doStatic, doRelay: true, needsConfirm: d.needsConfirm, reason: d.reason };
}

/**
 * 원격 명령에 들어 있으면 안 되는 것(테스트·실행 직전 검사 둘 다 씀).
 * @param {string} text
 * @param {{ staticRoot?: string, relayRoot?: string }} [cfg]
 * @returns {string[]} 걸린 이유 목록(빈 배열이면 안전)
 */
export function findDangerousCommands(text, cfg) {
  const hits = [];
  const rules = [
    [/rm\s+-[a-z]*r[a-z]*f?\s+(--\s+)?['"]?\/['"]?(\s|$|;)/i, '루트(/) 삭제'],
    [/rm\s+-[a-z]*\s+(--\s+)?['"]?\/\*/i, '루트(/*) 삭제'],
    [/\/etc\/nginx/i, '/etc/nginx 접근'],
    [/\bnginx\s+-s\b|systemctl\s+\S*\s*(reload|restart|stop|start)\s+['"]?nginx/i, 'nginx 재시작·reload'],
    [/sites-(available|enabled)/i, 'nginx 사이트 설정 접근'],
    [/\bpm2\s+(delete|stop|restart|kill)/i, '기존 pm2 프로세스 조작(Next.js)'],
    [/\.next\b|next\.config/i, 'Next.js 폴더 접근'],
    [/\bmkfs|\bdd\s+if=|>\s*\/dev\/sd/i, '디스크 조작'],
    [/\bchmod\s+-R\s+777|\bchown\s+-R\s+\S+\s+\/(\s|$)/i, '권한 대량 변경'],
  ];
  for (const [re, why] of rules) if (re.test(text)) hits.push(why);
  if (cfg) {
    // rm -rf 대상은 staticRoot·relayRoot 아래여야 한다
    const roots = [cfg.staticRoot, cfg.relayRoot].filter(Boolean);
    for (const m of text.matchAll(/rm\s+-[a-z]*r[a-z]*\s+(?:--\s+)?(['"]?)([^\s'";|]+)/gi)) {
      const target = m[2];
      if (!roots.some((r) => target.startsWith(`${r}/`))) hits.push(`허용 폴더 밖 삭제: ${target}`);
    }
  }
  return hits;
}

/* ───────────────────────── 묶음(로컬) ───────────────────────── */

function walkFiles(dir, base = dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, base, out);
    else if (e.isFile()) out.push(relative(base, p).split(sep).join('/'));
  }
  return out;
}

function copyTree(src, dest, skip = () => false) {
  mkdirSync(dest, { recursive: true });
  for (const e of readdirSync(src, { withFileTypes: true })) {
    const from = join(src, e.name);
    const to = join(dest, e.name);
    if (skip(from, e)) continue;
    if (e.isDirectory()) copyTree(from, to, skip);
    else if (e.isFile()) copyFileSync(from, to);
  }
}

/** 폴더 내용 해시(상대 경로 + 내용, 정렬). 묶음이 지난 배포와 같은지 비교용 */
export function hashDir(dir, ignore = ['.bundle-hash']) {
  const h = createHash('sha256');
  for (const f of walkFiles(dir).sort()) {
    if (ignore.includes(f)) continue;
    h.update(f);
    h.update('\0');
    h.update(readFileSync(join(dir, f)));
    h.update('\0');
  }
  return h.digest('hex');
}

/**
 * 루트 package-lock.json(npm workspaces)에서 중계 서버 런타임 의존성만 뽑아 독립 lock을 만든다(네트워크 없이).
 * 의존성을 다 찾지 못하면 null(→ 서버에서 npm install로 대신).
 */
export function buildRelayLock(rootLock, serverPkg) {
  const pk = rootLock && rootLock.packages;
  if (!pk || rootLock.lockfileVersion < 2) return null;
  const out = {
    '': { name: serverPkg.name, version: serverPkg.version, dependencies: { ...(serverPkg.dependencies || {}) } },
  };
  if (serverPkg.engines) out[''].engines = serverPkg.engines;
  const queue = Object.keys(serverPkg.dependencies || {});
  const seen = new Set();
  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    const entry = pk[`server/node_modules/${name}`] || pk[`node_modules/${name}`];
    if (!entry || entry.link) return null;
    const { dev, devOptional, peer, ...clean } = entry;
    out[`node_modules/${name}`] = clean;
    for (const d of Object.keys(entry.dependencies || {})) queue.push(d);
    for (const d of Object.keys(entry.optionalDependencies || {})) if (pk[`node_modules/${d}`]) queue.push(d);
  }
  return { name: serverPkg.name, version: serverPkg.version, lockfileVersion: 3, requires: true, packages: out };
}

function runLocal(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' && cmd === 'npm', ...opts });
  if (r.error) throw r.error;
  return r.status ?? 1;
}

/** dist/ → .tmp-deploy/static.tgz */
export async function packStatic() {
  if (!existsSync(join(ROOT, 'dist', 'index.html'))) throw new Error('dist/index.html이 없어요 — npm run build를 먼저 하세요');
  mkdirSync(join(ROOT, STAGE_DIR), { recursive: true });
  const out = `${STAGE_DIR}/static.tgz`;
  await rm(join(ROOT, out), { force: true });
  if (runLocal('tar', ['-czf', out, '-C', 'dist', '.']) !== 0) throw new Error('tar(정적 묶기) 실패');
  return { tar: out, hash: hashDir(join(ROOT, 'dist')), files: walkFiles(join(ROOT, 'dist')).length };
}

/** server/dist + package.json(런타임만) + lock → .tmp-deploy/relay/ → .tmp-deploy/relay.tgz */
export async function packRelay() {
  const sdist = join(ROOT, 'server', 'dist');
  if (!existsSync(join(sdist, 'index.js'))) throw new Error('server/dist/index.js가 없어요 — npm run build:server를 먼저 하세요');
  const stage = join(ROOT, STAGE_DIR, 'relay');
  await rm(stage, { recursive: true, force: true });
  // 부하 테스트(dist/server/scripts)는 운영에 필요 없으므로 뺀다
  copyTree(sdist, join(stage, 'dist'), (from) => relative(sdist, from).split(sep).join('/') === 'server/scripts');
  const pkg = JSON.parse(readFileSync(join(ROOT, 'server', 'package.json'), 'utf8'));
  const runtimePkg = {
    name: pkg.name,
    version: pkg.version,
    private: true,
    description: pkg.description,
    type: pkg.type,
    engines: pkg.engines,
    main: pkg.main,
    scripts: { start: pkg.scripts?.start ?? 'node dist/index.js' },
    dependencies: pkg.dependencies || {},
  };
  writeFileSync(join(stage, 'package.json'), `${JSON.stringify(runtimePkg, null, 2)}\n`);
  let hasLock = false;
  const rootLockPath = join(ROOT, 'package-lock.json');
  if (existsSync(rootLockPath)) {
    const lock = buildRelayLock(JSON.parse(readFileSync(rootLockPath, 'utf8')), runtimePkg);
    if (lock) {
      writeFileSync(join(stage, 'package-lock.json'), `${JSON.stringify(lock, null, 2)}\n`);
      hasLock = true;
    }
  }
  const hash = hashDir(stage);
  writeFileSync(join(stage, '.bundle-hash'), `${hash}\n`);
  const out = `${STAGE_DIR}/relay.tgz`;
  await rm(join(ROOT, out), { force: true });
  if (runLocal('tar', ['-czf', out, '-C', `${STAGE_DIR}/relay`, '.']) !== 0) throw new Error('tar(중계 서버 묶기) 실패');
  return { tar: out, hash, hasLock, files: walkFiles(stage).length };
}

/* ───────────────────────── ssh/scp ───────────────────────── */

function expandHome(p) {
  return p && p.startsWith('~') ? join(homedir(), p.slice(1)) : p;
}

export function sshArgs(cfg, { expand = true } = {}) {
  const a = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-p', String(cfg.port)];
  if (cfg.keyPath) a.push('-i', expand ? expandHome(cfg.keyPath) : cfg.keyPath);
  a.push(`${cfg.user}@${cfg.host}`);
  return a;
}

export function scpArgs(cfg, local, remote, { expand = true } = {}) {
  const a = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-P', String(cfg.port)];
  if (cfg.keyPath) a.push('-i', expand ? expandHome(cfg.keyPath) : cfg.keyPath);
  a.push(local, `${cfg.user}@${cfg.host}:${remote}`);
  return a;
}

function showSsh(cfg, lines) {
  const head = `ssh ${sshArgs(cfg, { expand: false }).join(' ')} 'bash -s' <<'EOF'`;
  return [head, '  set -eu', ...lines.map((l) => `  ${l}`), 'EOF'].join('\n');
}

function showScp(cfg, local, remote) {
  return `scp ${scpArgs(cfg, local, remote, { expand: false }).join(' ')}`;
}

/** 원격 스크립트 실행(표준 입력으로 bash에 넘김). 실행 전 위험 명령 검사 */
function runSsh(cfg, lines, { capture = false } = {}) {
  const script = ['set -eu', ...lines].join('\n') + '\n';
  const danger = findDangerousCommands(script, cfg);
  if (danger.length) throw new Error(`위험한 원격 명령이 있어 멈춰요: ${danger.join(', ')}`);
  const r = spawnSync('ssh', [...sshArgs(cfg), 'bash -s'], {
    cwd: ROOT,
    input: script,
    stdio: ['pipe', capture ? 'pipe' : 'inherit', 'inherit'],
    encoding: 'utf8',
  });
  if (r.error) throw r.error;
  return { status: r.status ?? 1, stdout: r.stdout || '' };
}

function runScp(cfg, local, remote) {
  const r = spawnSync('scp', scpArgs(cfg, local, remote), { cwd: ROOT, stdio: 'inherit' });
  if (r.error) throw r.error;
  return r.status ?? 1;
}

/* ───────────────────────── 계획 출력(dry-run) ───────────────────────── */

/**
 * dry-run 출력 문자열(순수 함수 — 테스트 대상). 아무것도 실행하지 않는다.
 */
export function renderDryRun(cfg, opts, now = new Date()) {
  const stamp = releaseStamp(now);
  const out = [];
  const say = (s = '') => out.push(s);
  const block = (lines) => say(indent(showSsh(cfg, lines), 3));
  const gate = schoolHoursGate(now, opts.allowSchoolHours);
  const both = { doStatic: opts.doStatic, doRelay: opts.doRelay };
  say('=== 배포 미리 보기(dry-run) — 아무것도 실행하지 않아요. 실제 배포는 --execute ===');
  say(`대상: ${cfg.user}@${cfg.host}:${cfg.port}  정적 ${cfg.staticRoot}  중계 ${cfg.relayRoot}  서비스 ${cfg.service}`);
  say(`release 이름: ${stamp}`);
  say(`① 시간 검사: ${gate.message}${gate.ok ? '' : ' (실제 실행이면 여기서 멈춤)'}`);
  say('② 로컬 검사·빌드:');
  say('   npm run check:data');
  say('   npm test');
  if (opts.doStatic) say('   npm run build');
  if (opts.doRelay) say('   npm run build:server');
  say('③ 묶기:');
  if (opts.doStatic) say(`   tar -czf ${STAGE_DIR}/static.tgz -C dist .`);
  if (opts.doRelay) {
    say(`   (중계) ${STAGE_DIR}/relay/ ← server/dist(부하 테스트 제외) + 런타임 package.json + package-lock.json(루트 lock에서 추출) + .bundle-hash`);
    say(`   tar -czf ${STAGE_DIR}/relay.tgz -C ${STAGE_DIR}/relay .`);
  }
  say('④ 판단(바꾸기 전에 먼저):');
  say(`   GET ${cfg.healthUrl}  → "열린 방 n/최대, 새 방 받는 중/아님, 공지" 출력`);
  if (opts.doRelay) {
    say('   중계 서버 묶음 해시 읽기(읽기 전용):');
    block(relayHashReadScript(cfg));
    say('   - 해시가 같으면: 중계 서버는 그대로' + (opts.doStatic ? ', 정적 파일만 교체(재시작 없음)' : ' — 할 일 없음'));
    say('   - 다르면: rooms > 0(또는 /health 읽기 실패)이면 재시작 거부 → ' + (opts.doStatic ? '**정적 파일도 바꾸지 않고 끝냄**(정적만은 --static-only)' : '끝냄') + '. --force면 확인 질문 1번 더');
  } else {
    say('   --static-only: 중계 서버 재시작 판단 없음');
  }
  say('⑤ 준비(올리고 풀기 — current는 아직 그대로):');
  if (opts.doStatic) {
    const p = staticPreparePlan(cfg, stamp, `${STAGE_DIR}/static.tgz`);
    say(`   ${showScp(cfg, p.upload.local, p.upload.remote)}`);
    block(p.script);
  }
  if (opts.doRelay) {
    const p = relayPreparePlan(cfg, stamp, `${STAGE_DIR}/relay.tgz`);
    say(`   ${showScp(cfg, p.upload.local, p.upload.remote)}`);
    block(p.script);
  }
  say('   준비 중 하나라도 실패하면 아무것도 교체하지 않고 새 release 폴더를 지움:');
  block(cleanupScript(cfg, stamp, both));
  say('⑥ 교체(함께) + 재시작:');
  block(activateScript(cfg, stamp, both));
  if (opts.doRelay) {
    say(`⑦ GET ${cfg.healthUrl} 를 ${HEALTH_WAIT_MS / 1000}초 안에 ok가 될 때까지 확인.`);
  } else {
    say('⑦ (재시작 없음)');
  }
  say('   교체·재시작·확인이 실패하면 이전 release로 되돌리고 결과(성공/실패, 지금 current)를 출력, 실패한 release를 지움:');
  block(
    rollbackScript(cfg, {
      prevStatic: `${cfg.staticRoot}/releases/PREV`,
      prevRelay: `${cfg.relayRoot}/releases/PREV`,
      ...both,
      restart: opts.doRelay,
    }).map((l) => l.replace(/\/releases\/PREV'/g, "/releases/<PREV_* 값>'")),
  );
  say(`⑧ 오래된 release 정리(최근 ${KEEP_RELEASES}개와 current 남김):`);
  block([...(opts.doStatic ? pruneScript(cfg.staticRoot) : []), ...(opts.doRelay ? pruneScript(cfg.relayRoot) : [])]);
  say('⑨ 요약 출력(정적 release, 중계 서버 재시작 여부, /health 한 줄)');
  say('');
  say('건드리지 않는 것: nginx 설정 파일(조각·용량 설정은 사람이 교사 승인 뒤 docs/server-setup.md 1.5·1.5.1대로), 기존 Next.js 포트폴리오, /etc/voyage-relay.env, 공지 파일.');
  return out.join('\n');
}

function indent(s, n) {
  const pad = ' '.repeat(n);
  return s
    .split('\n')
    .map((l) => pad + l)
    .join('\n');
}

/* ───────────────────────── 실행 ───────────────────────── */

async function confirm(question) {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const a = await rl.question(`${question} 진행하려면 yes를 입력하세요: `);
    return a.trim().toLowerCase() === 'yes';
  } finally {
    rl.close();
  }
}

async function waitHealthy(url, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const h = await readHealth(url);
    if (h && h.ok === true) return h;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}

/** 실제 실행에 쓰는 의존성(테스트에서는 가짜로 바꿔 끼움) */
export function realDeps(cfg) {
  return {
    log: (s) => console.log(s),
    err: (s) => console.error(s),
    runNpm: (args) => runLocal('npm', args),
    readHealth,
    waitHealthy,
    packStatic,
    packRelay,
    confirm,
    runScp: (local, remote) => {
      console.log(showScp(cfg, local, remote));
      return runScp(cfg, local, remote);
    },
    runSsh: (lines, o) => {
      console.log(showSsh(cfg, lines));
      return runSsh(cfg, lines, o);
    },
  };
}

/**
 * 실제 배포(--execute). 순서: 시간 → 검사·빌드 → 묶기 → 판단(/health·해시) → 준비(올리기·풀기) → 함께 교체·재시작 → 확인 → 정리.
 * 판단에서 거부되거나 준비가 실패하면 아무것도 교체하지 않는다. 교체 뒤 실패하면 둘 다 이전 release로 되돌린다.
 */
export async function runDeploy(cfg, opts, deps, now = new Date()) {
  const { log, err } = deps;
  const stamp = releaseStamp(now);
  const summary = { static: '바꾸지 않음', relay: '바꾸지 않음', health: null };
  const finish = (code) => {
    log('요약');
    log(`   정적: ${summary.static}`);
    log(`   중계 서버: ${summary.relay}`);
    log(`   ${formatHealth(summary.health)}`);
    return code;
  };

  const gate = schoolHoursGate(now, opts.allowSchoolHours);
  log(`① ${gate.message}`);
  if (!gate.ok) return 1;

  log('② 로컬 검사·빌드');
  const steps = [['run', 'check:data'], ['test']];
  if (opts.doStatic) steps.push(['run', 'build']);
  if (opts.doRelay) steps.push(['run', 'build:server']);
  for (const s of steps) {
    log(`$ npm ${s.join(' ')}`);
    if ((await deps.runNpm(s)) !== 0) {
      err(`npm ${s.join(' ')} 실패 — 배포하지 않아요.`);
      return 1;
    }
  }

  log('③ 묶기');
  const st = opts.doStatic ? await deps.packStatic() : null;
  const rl = opts.doRelay ? await deps.packRelay() : null;

  log('④ 판단');
  const health = await deps.readHealth(cfg.healthUrl);
  summary.health = health;
  log(`   ${formatHealth(health)}`);
  let relayChanged = false;
  if (rl) {
    const h = deps.runSsh(relayHashReadScript(cfg), { capture: true });
    if (h.status !== 0) {
      err('중계 서버의 지난 배포 해시를 읽지 못했어요(SSH 접속 확인) — 아무것도 바꾸지 않아요.');
      return finish(1);
    }
    relayChanged = h.stdout.trim() !== rl.hash;
    log(`   중계 서버 묶음: ${relayChanged ? '지난 배포와 달라요' : '지난 배포와 같아요'}`);
  }
  const plan = decidePlan(opts, health, relayChanged);
  log(`   ${plan.reason}`);
  if (plan.abort) {
    summary.relay = '재시작 거부(열린 방 있음/알 수 없음)';
    return finish(1);
  }
  if (plan.needsConfirm && !(await deps.confirm('열린 방이 끊길 수 있어요.'))) {
    log('   확인하지 않아 아무것도 바꾸지 않아요.');
    return finish(1);
  }
  if (!plan.doStatic && !plan.doRelay) {
    summary.relay = '바뀐 것 없음';
    return finish(0);
  }
  if (rl && !plan.doRelay) summary.relay = '바뀐 것 없음(재시작 안 함)';
  const parts = { doStatic: plan.doStatic, doRelay: plan.doRelay };

  log('⑤ 준비(올리기·풀기 — current는 아직 그대로)');
  const prepares = [];
  if (plan.doStatic) prepares.push(staticPreparePlan(cfg, stamp, st.tar));
  if (plan.doRelay) prepares.push(relayPreparePlan(cfg, stamp, rl.tar, { hasLock: rl.hasLock }));
  for (const p of prepares) {
    const ok = deps.runScp(p.upload.local, p.upload.remote) === 0 && deps.runSsh(p.script).status === 0;
    if (!ok) {
      err('준비 단계 실패 — 아무것도 교체하지 않아요. 새 release 폴더를 지워요.');
      deps.runSsh(cleanupScript(cfg, stamp, parts));
      return finish(1);
    }
  }

  log('⑥ 교체' + (plan.doRelay ? ' + 재시작' : ''));
  const act = deps.runSsh(activateScript(cfg, stamp, parts), { capture: true });
  const prevStatic = readMarker(act.stdout, 'PREV_STATIC');
  const prevRelay = readMarker(act.stdout, 'PREV_RELAY');
  let failed = act.status !== 0 ? '교체·재시작 단계 실패(sudo 권한 등)' : null;

  if (!failed && plan.doRelay) {
    log(`⑦ /health ok를 ${HEALTH_WAIT_MS / 1000}초 동안 기다려요…`);
    const after = await deps.waitHealthy(cfg.healthUrl, HEALTH_WAIT_MS);
    if (!after) failed = `${HEALTH_WAIT_MS / 1000}초 안에 /health가 ok가 아님`;
    else summary.health = after;
  }

  if (failed) {
    err(`${failed} — 이전 release로 되돌려요.`);
    const rb = { prevStatic, prevRelay, ...parts, restart: plan.doRelay };
    const res = deps.runSsh(rollbackScript(cfg, rb), { capture: true });
    const d = describeRollback(cfg, { stdout: res.stdout, status: res.status, ...rb });
    for (const l of d.lines) (d.ok ? log : err)(`   ${l}`);
    deps.runSsh(cleanupScript(cfg, stamp, parts));
    summary.static = plan.doStatic ? `실패 → ${d.ok ? '되돌림' : '되돌리기 확인 필요'}` : summary.static;
    summary.relay = plan.doRelay ? `실패 → ${d.ok ? '되돌림' : '되돌리기 확인 필요'}` : summary.relay;
    summary.health = await deps.readHealth(cfg.healthUrl);
    return finish(1);
  }
  if (plan.doStatic) summary.static = `${cfg.staticRoot}/releases/${stamp}`;
  if (plan.doRelay) summary.relay = `${cfg.relayRoot}/releases/${stamp} (재시작함)`;

  log(`⑧ 오래된 release 정리(최근 ${KEEP_RELEASES}개 남김)`);
  deps.runSsh([...(plan.doStatic ? pruneScript(cfg.staticRoot) : []), ...(plan.doRelay ? pruneScript(cfg.relayRoot) : [])]);
  summary.health = (await deps.readHealth(cfg.healthUrl)) ?? summary.health;
  return finish(0);
}

function helpText() {
  return [
    '사용법: npm run deploy -- [옵션]',
    '  (옵션 없음)/--dry-run  할 일과 원격 명령을 출력만(기본)',
    '  --execute              실제 배포',
    '  --static-only          정적 파일만(중계 서버 재시작 판단 없음)',
    '  --relay-only           중계 서버만',
    '  --force                열린 방이 있어도 중계 서버 재시작(확인 질문 1번 더)',
    '  --allow-school-hours   평일 08:30~16:30에도 진행',
    '  --pack-only            서버 접속 없이 이미 빌드된 dist/·server/dist/를 .tmp-deploy/에 묶기만',
    '',
    configHelpText(),
  ].join('\n');
}

export async function main(argv = process.argv.slice(2), now = new Date()) {
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log(helpText());
    return 0;
  }
  if (opts.problems.length) {
    console.error(opts.problems.join('\n'));
    console.error('도움말: npm run deploy -- --help');
    return 2;
  }

  if (opts.mode === 'pack') {
    console.log('=== 묶기만(--pack-only) — 서버에 접속하지 않아요 ===');
    if (opts.doStatic) {
      const s = await packStatic();
      console.log(`정적: ${s.tar} (파일 ${s.files}개, 해시 ${s.hash.slice(0, 12)})`);
    }
    if (opts.doRelay) {
      const r = await packRelay();
      console.log(`중계 서버: ${r.tar} (파일 ${r.files}개, 해시 ${r.hash.slice(0, 12)}, lock ${r.hasLock ? '있음 → npm ci' : '없음 → npm install'})`);
    }
    return 0;
  }

  const loaded = loadDeployConfig();
  if (loaded.status === 'missing') {
    console.log(configHelpText());
    return opts.mode === 'execute' ? 1 : 0;
  }
  if (loaded.status === 'invalid') {
    console.error(`배포 설정(${loaded.source})에 문제가 있어요:\n- ${loaded.problems.join('\n- ')}`);
    return 1;
  }
  const cfg = loaded.config;
  console.log(`설정: ${loaded.source}`);

  if (opts.mode === 'dry-run') {
    console.log(renderDryRun(cfg, opts, now));
    return 0;
  }
  return runDeploy(cfg, opts, realDeps(cfg), now);
}

const invokedDirectly = (() => {
  try {
    return process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exitCode = 1;
    },
  );
}
