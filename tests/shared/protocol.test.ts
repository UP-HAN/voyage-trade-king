import { describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  MESSAGE_TYPES,
  PROTOCOL_VERSION,
  errorToKorean,
  isRoomCode,
  normalizeNotice,
  parseClientMessage,
  parseMessage,
  parseServerMessage,
  utf8Length,
} from '@shared/protocol';

describe('shared/protocol', () => {
  it('PROTOCOL_VERSION 은 3 (PRD 10.3)', () => {
    expect(PROTOCOL_VERSION).toBe(3);
  });

  it('메시지 종류에 PRD 10.5 목록 + server.notice가 모두 있다', () => {
    for (const t of [
      'host.open', 'room.opened', 'host.resume', 'host.lock', 'host.unlock', 'host.admit', 'host.reject', 'host.kick',
      'host.close', 'host.to', 'host.all', 'peer.join', 'peer.hello', 'peer.msg', 'peer.left', 'host.status', 'admitted',
      'rejected', 'kicked', 'room.closed', 'server.restarting', 'server.notice', 'ping', 'pong', 'error',
    ]) {
      expect(MESSAGE_TYPES).toContain(t);
    }
  });

  it('오류 코드마다 사람 말 문구가 있다(v0.3.1 문구 포함)', () => {
    for (const c of ERROR_CODES) expect(errorToKorean(c)).toMatch(/[가-힣]/);
    expect(errorToKorean('NO_ROOM')).toBe('그런 방이 없어요. 칠판의 여섯 자리 숫자를 다시 봐요.');
    expect(errorToKorean('RATE_LIMITED')).toBe('잠시 뒤에 다시 해 봐요.');
    expect(errorToKorean('MAINTENANCE')).toBe('서버 점검 중이에요. 공지를 확인해 주세요.');
    expect(errorToKorean('ROOM_LIMIT')).toContain('같은 인터넷 주소');
    expect(errorToKorean('BUSY', { rooms: 50, maxRooms: 50 })).toBe('지금 서버에 방이 가득 찼어요(50/50). 몇 분 뒤 다시 해 보세요.');
    expect(errorToKorean('BUSY')).toBe('지금 서버에 방이 가득 찼어요. 몇 분 뒤 다시 해 보세요.');
    expect(errorToKorean('MAINTENANCE', { text: '17시까지 점검' })).toBe('17시까지 점검');
    expect(errorToKorean('WHAT')).toMatch(/[가-힣]/);
  });

  it('parseMessage: 올바른 메시지·버전·크기·모양 검사', () => {
    const ok = parseMessage(JSON.stringify({ v: 3, t: 'peer.join', code: '482137', hello: { seat: 7 } }));
    expect(ok).toEqual({ ok: true, msg: { v: 3, t: 'peer.join', code: '482137', hello: { seat: 7 } } });
    expect(parseMessage('{oops')).toMatchObject({ ok: false, code: 'BAD_MESSAGE' });
    expect(parseMessage(JSON.stringify({ v: 2, t: 'ping', at: 1 }))).toMatchObject({ ok: false, code: 'VERSION' });
    expect(parseMessage(JSON.stringify({ v: 3, t: 'nope' }))).toMatchObject({ ok: false, code: 'BAD_MESSAGE' });
    expect(parseMessage(JSON.stringify({ v: 3, t: 'host.to', peerId: 'p1' }))).toMatchObject({ ok: false, code: 'BAD_MESSAGE' });
    expect(parseMessage(JSON.stringify({ v: 3, t: 'host.all', msg: [1] }))).toMatchObject({ ok: false, code: 'BAD_MESSAGE' });
    // 서버만 보내는 종류는 클라이언트 메시지로 받지 않는다
    expect(parseClientMessage(JSON.stringify({ v: 3, t: 'room.opened', code: '1', hostToken: 'x' }))).toMatchObject({ ok: false });
    expect(parseServerMessage(JSON.stringify({ v: 3, t: 'room.opened', code: '482137', hostToken: 'x' })).ok).toBe(true);
    expect(parseMessage(JSON.stringify({ v: 3, t: 'error', code: 'BUSY', req: 'host.open' }), { from: 'server' }).ok).toBe(true);
    const big = JSON.stringify({ v: 3, t: 'host.all', msg: { s: '가'.repeat(22000) } });
    expect(big.length).toBeLessThan(65536);
    expect(parseMessage(big)).toMatchObject({ ok: false, code: 'TOO_LARGE' }); // 한글 3바이트 → 64KB 초과
  });

  it('utf8Length·isRoomCode', () => {
    expect(utf8Length('aé가🚢')).toBe(1 + 2 + 3 + 4);
    expect(isRoomCode('482137')).toBe(true);
    expect(isRoomCode('082137')).toBe(false);
    expect(isRoomCode('48213')).toBe(false);
  });

  it('normalizeNotice: 형식 검사', () => {
    expect(normalizeNotice({ level: 'warn', text: '안내', from: '2026-10-20T17:00:00+09:00', blockNewRooms: false })).toEqual({
      level: 'warn',
      text: '안내',
      from: '2026-10-20T08:00:00.000Z',
    });
    expect(normalizeNotice({ level: 'loud', text: 'x' })).toBeNull();
    expect(normalizeNotice({ level: 'info' })).toBeNull();
    expect(normalizeNotice(null)).toBeNull();
    expect(normalizeNotice({ level: 'info', text: 'x', until: 'not a date' })).toEqual({ level: 'info', text: 'x' });
  });
});
