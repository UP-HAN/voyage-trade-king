/**
 * 교사 화면이 부르는 조작 묶음(작업 109). 실제 판은 124 세션, `?demo=30`은 아무것도 하지 않는 가짜.
 * 학급 상태는 `dispatch`(= 세션 → 103 hostReduce)로만 바꾼다.
 */
import type { TeacherAction } from '../core';
import type { HostSession, RenameResult } from '../sync/host-session';
import type { ResultFiles } from '../sync/host-store';
import type { TeacherGame, TeacherLocalAction } from './game';

export interface TeacherActions {
  dispatch(a: TeacherAction | TeacherLocalAction): void;
  setLocked(locked: boolean): void;
  kick(seat: number): boolean;
  approveRejoin(seat: number): boolean;
  denyRejoin(seat: number): boolean;
  renameCompany(seat: number, name: string): RenameResult;
  blockCompanyName(seat: number): boolean;
  reassignSeat(from: number, to: number): boolean;
  bindDeviceToSeat(peerId: string, seat: number): boolean;
  exportResult(className: string): ResultFiles | null;
  exportMoveFile(): string | null;
  close(): Promise<void>;
  now(): number;
}

export function sessionActions(session: HostSession<TeacherGame>, now: () => number): TeacherActions {
  return {
    dispatch: (a) => session.dispatchTeacher(a as unknown as { type: string }),
    setLocked: (b) => session.setLocked(b),
    kick: (s) => session.kick(s),
    approveRejoin: (s) => session.approveRejoin(s),
    denyRejoin: (s) => session.denyRejoin(s),
    renameCompany: (s, n) => session.renameCompany(s, n),
    blockCompanyName: (s) => session.blockCompanyName(s),
    reassignSeat: (f, t) => session.reassignSeat(f, t),
    bindDeviceToSeat: (p, s) => session.bindDeviceToSeat(p, s),
    exportResult: (className) => session.exportResult({ className }),
    exportMoveFile: () => session.exportMoveFile(),
    close: () => session.close(),
    now,
  };
}

/** `?demo=30`: 화면만 확인(바꾸지 않음) */
export function demoActions(now: () => number = () => Date.now()): TeacherActions {
  return {
    dispatch: () => undefined,
    setLocked: () => undefined,
    kick: () => false,
    approveRejoin: () => false,
    denyRejoin: () => false,
    renameCompany: () => ({ ok: false, error: 'NO_SEAT' }),
    blockCompanyName: () => false,
    reassignSeat: () => false,
    bindDeviceToSeat: () => false,
    exportResult: () => null,
    exportMoveFile: () => null,
    close: async () => undefined,
    now,
  };
}
