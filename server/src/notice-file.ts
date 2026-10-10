/**
 * 서버 공지 파일 읽기(docs/server-setup.md 2.4). **읽기만 한다** — 이 서버는 어떤 파일도 쓰지 않는다.
 * 시작할 때와 SIGHUP(`systemctl reload voyage-relay`) 때 부른다.
 */
import { readFileSync } from 'node:fs';
import { normalizeNotice, type Notice } from '../../shared/protocol.js';

/** 공지 문구 최대 길이(운영 문서 2.4: 80자 이내 — 넘으면 자름) */
export const NOTICE_FILE_TEXT_MAX = 80;

export type NoticeFileStatus = 'ok' | 'missing' | 'unreadable' | 'bad_json' | 'bad_fields';

export interface NoticeFileResult {
  notice: Notice | null;
  status: NoticeFileStatus;
  /** text가 80자를 넘어 잘랐는가 */
  truncated: boolean;
}

/** 공지 파일 내용(문자열) → 공지. 형식이 틀리면 null */
export function parseNoticeText(text: string): NoticeFileResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { notice: null, status: 'bad_json', truncated: false };
  }
  const n = normalizeNotice(raw);
  if (!n) return { notice: null, status: 'bad_fields', truncated: false };
  const chars = Array.from(n.text);
  const truncated = chars.length > NOTICE_FILE_TEXT_MAX;
  if (truncated) n.text = chars.slice(0, NOTICE_FILE_TEXT_MAX).join('');
  return { notice: n, status: 'ok', truncated };
}

/** 공지 파일 읽기. 파일 없음 → 공지 없음(status missing) */
export function readNoticeFile(path: string): NoticeFileResult {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    const code = (e as { code?: unknown }).code;
    return { notice: null, status: code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'unreadable', truncated: false };
  }
  if (text.trim() === '') return { notice: null, status: 'missing', truncated: false };
  return parseNoticeText(text.replace(/^﻿/, ''));
}
