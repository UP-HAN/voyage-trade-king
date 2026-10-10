// scripts/deploy.mjs 타입 선언(테스트에서 import할 때 tsc --noEmit용)

export interface DeployOptions {
  dryRun: boolean;
  execute: boolean;
  staticOnly: boolean;
  relayOnly: boolean;
  force: boolean;
  allowSchoolHours: boolean;
  packOnly: boolean;
  help: boolean;
  mode: 'dry-run' | 'execute' | 'pack';
  doStatic: boolean;
  doRelay: boolean;
  problems: string[];
}

export interface DeployConfig {
  host: string;
  user: string;
  keyPath?: string;
  port: number;
  staticRoot: string;
  relayRoot: string;
  service: string;
  healthUrl: string;
  remoteNpm: string;
}

export interface Health {
  ok?: boolean;
  rooms?: number;
  maxRooms?: number;
  acceptingNewRooms?: boolean;
  notice?: string | null;
  [k: string]: unknown;
}

export const STAGE_DIR: string;
export const KEEP_RELEASES: number;
export const HEALTH_WAIT_MS: number;
export const CONFIG_FILE_NAME: string;
export const CONFIG_DEFAULTS: Readonly<Partial<DeployConfig>>;
export const CONFIG_ENV: Readonly<Record<keyof DeployConfig, string>>;
export const CONFIG_EXAMPLE: Record<string, string | number>;

export function parseArgs(argv: string[]): DeployOptions;
export function isSchoolHours(date: Date): boolean;
export function schoolHoursGate(date: Date, allowSchoolHours: boolean): { ok: boolean; message: string };
export function releaseStamp(date: Date): string;
export function validateConfig(raw: unknown): { config: DeployConfig | null; problems: string[] };
export function loadDeployConfig(deps?: {
  env?: Record<string, string | undefined>;
  home?: string;
  readFile?: (p: string) => string;
  exists?: (p: string) => boolean;
}):
  | { status: 'missing' }
  | { status: 'invalid'; source: string; problems: string[] }
  | { status: 'ok'; source: string; config: DeployConfig };
export function configHelpText(): string;
export function formatHealth(h: Health | null | undefined): string;
export function relayRestartDecision(
  health: Health | null | undefined,
  opts?: { force?: boolean },
): { allowed: boolean; needsConfirm: boolean; reason: string };
export function shq(s: string): string;
export interface Parts {
  doStatic?: boolean;
  doRelay?: boolean;
}
export interface RollbackInput extends Parts {
  prevStatic?: string | null;
  prevRelay?: string | null;
  restart?: boolean;
}
export function staticPreparePlan(cfg: DeployConfig, stamp: string, localTar: string): { upload: { local: string; remote: string }; script: string[] };
export function relayHashReadScript(cfg: DeployConfig): string[];
export function relayPreparePlan(
  cfg: DeployConfig,
  stamp: string,
  localTar: string,
  opts?: { hasLock?: boolean },
): { upload: { local: string; remote: string }; script: string[] };
export function activateScript(cfg: DeployConfig, stamp: string, parts: Parts): string[];
export function readMarker(stdout: string, key: string): string | null;
export function rollbackScript(cfg: DeployConfig, input?: RollbackInput): string[];
export function describeRollback(cfg: DeployConfig, input?: RollbackInput & { stdout?: string; status?: number }): { ok: boolean; lines: string[] };
export function cleanupScript(cfg: DeployConfig, stamp: string, parts?: Parts): string[];
export function decidePlan(
  opts: DeployOptions,
  health: Health | null | undefined,
  relayChanged: boolean,
): { abort: boolean; doStatic: boolean; doRelay: boolean; needsConfirm: boolean; reason: string };
export function pruneScript(root: string, keep?: number): string[];
export function findDangerousCommands(text: string, cfg?: Partial<DeployConfig>): string[];
export function hashDir(dir: string, ignore?: string[]): string;
export function buildRelayLock(rootLock: unknown, serverPkg: { name: string; version: string; dependencies?: Record<string, string>; engines?: Record<string, string> }): {
  name: string;
  version: string;
  lockfileVersion: number;
  requires: boolean;
  packages: Record<string, Record<string, unknown>>;
} | null;
export function packStatic(): Promise<{ tar: string; hash: string; files: number }>;
export function packRelay(): Promise<{ tar: string; hash: string; hasLock: boolean; files: number }>;
export function sshArgs(cfg: DeployConfig, opts?: { expand?: boolean }): string[];
export function scpArgs(cfg: DeployConfig, local: string, remote: string, opts?: { expand?: boolean }): string[];
export function renderDryRun(cfg: DeployConfig, opts: DeployOptions, now?: Date): string;
export interface DeployDeps {
  log: (s: string) => void;
  err: (s: string) => void;
  runNpm: (args: string[]) => number | Promise<number>;
  readHealth: (url: string) => Promise<Health | null>;
  waitHealthy: (url: string, ms: number) => Promise<Health | null>;
  packStatic: () => Promise<{ tar: string; hash: string; files: number }>;
  packRelay: () => Promise<{ tar: string; hash: string; hasLock: boolean; files: number }>;
  confirm: (q: string) => Promise<boolean>;
  runScp: (local: string, remote: string) => number;
  runSsh: (lines: string[], opts?: { capture?: boolean }) => { status: number; stdout: string };
}
export function realDeps(cfg: DeployConfig): DeployDeps;
export function runDeploy(cfg: DeployConfig, opts: DeployOptions, deps: DeployDeps, now?: Date): Promise<number>;
export function main(argv?: string[], now?: Date): Promise<number>;
