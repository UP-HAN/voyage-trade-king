/**
 * 표준 출력 한 줄 JSON 로그(journald가 받음).
 * 남기지 않는 것: 방 코드 전체(앞 2자리만), 출석번호·회사 이름, 메시지 내용, IP 전체(마지막 칸을 x로).
 */
import type { LogLevel } from './config.js';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

/** 로그 한 줄 쓰기(기본: 표준 출력). 테스트에서 바꿔 끼운다 */
export type LogSink = (line: string) => void;

const stdoutSink: LogSink = (line) => {
  process.stdout.write(line + '\n');
};

export function createLogger(level: LogLevel = 'info', sink: LogSink = stdoutSink, now: () => number = Date.now): Logger {
  const min = ORDER[level];
  const write = (lv: LogLevel, msg: string, fields?: LogFields) => {
    if (ORDER[lv] < min) return;
    let line: string;
    try {
      const head = { time: new Date(now()).toISOString(), level: lv, msg };
      // fields 안의 time·level·msg가 머리를 덮어쓰지 않게 한 번 더 덮는다(키 순서는 머리가 먼저)
      line = JSON.stringify(Object.assign({}, head, fields ?? {}, head));
    } catch {
      line = JSON.stringify({ time: new Date(now()).toISOString(), level: lv, msg });
    }
    sink(line);
  };
  return {
    debug: (m, f) => write('debug', m, f),
    info: (m, f) => write('info', m, f),
    warn: (m, f) => write('warn', m, f),
    error: (m, f) => write('error', m, f),
  };
}

/** 방 코드 가리기: 앞 2자리만 남김(예: 482913 → 48xxxx) */
export function maskCode(code: string): string {
  return code.length <= 2 ? 'xx' : code.slice(0, 2) + 'x'.repeat(code.length - 2);
}

/** IP 가리기: IPv4는 마지막 옥텟을 x로(1.2.3.4 → 1.2.3.x), IPv6는 앞 세 칸만 남김 */
export function maskIp(ip: string): string {
  const v4 = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/.exec(ip);
  if (v4) return `${v4[1]}.x`;
  if (ip.includes(':')) {
    const parts = ip.split(':').filter(Boolean).slice(0, 3);
    return `${parts.join(':')}:x`;
  }
  return 'x';
}

/** 오류 객체 → 짧은 설명(스택·내용 없이) */
export function errInfo(e: unknown): LogFields {
  if (e instanceof Error) return { err: e.name, errMsg: e.message.slice(0, 200), ...(hasCode(e) ? { errCode: e.code } : {}) };
  return { err: String(e).slice(0, 200) };
}

function hasCode(e: Error): e is Error & { code: string } {
  return typeof (e as { code?: unknown }).code === 'string';
}
