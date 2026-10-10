/**
 * 연결 테스트 로직(src/ui/common/ConnectionTest.tsx의 runConnectionTest) — 로컬 모드·정상·서버 꺼짐·느림.
 * 화면 모양은 스크린숏(.orch/tasks/105-relay-server/)으로 확인한다.
 */
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import {
  GOOD_MESSAGE,
  LOCAL_MODE_MESSAGE,
  SLOW_MESSAGE,
  failMessage,
  runConnectionTest,
} from '../../src/ui/common/ConnectionTest';
import { noticeFromBody, formatUntil } from '../../src/ui/common/NoticeBanner';
import type { WebSocketLike } from '../../src/sync/relay';
import { TEST_ORIGIN, startTestServer, type TestServer } from '../server/relay-helpers';

let servers: TestServer[] = [];
afterEach(async () => {
  for (const s of servers) await s.stop();
  servers = [];
});

const wsFactory = (url: string) => {
  const ws = new WebSocket(url, { origin: TEST_ORIGIN });
  ws.on('error', () => {});
  return ws as unknown as WebSocketLike;
};

describe('연결 테스트', () => {
  it('?sync=local이면 "로컬 모드(서버 없이)"만', async () => {
    const r = await runConnectionTest({ href: 'http://localhost:5173/?sync=local#/' });
    expect(r).toEqual({ verdict: 'local', message: LOCAL_MODE_MESSAGE, steps: [] });
  });

  it('정상: 6단계 모두 성공 → "연결 좋아요", 공지 문구 표시, 방 수는 없음', async () => {
    const s = await startTestServer();
    servers.push(s);
    s.writeNotice({ level: 'info', text: '새 학기 업데이트를 했어요.' });
    s.server.reloadNotice();
    const progress: string[] = [];
    const r = await runConnectionTest({
      href: 'https://lab.ches.es.kr/voyage/?sync=relay#/',
      relayUrl: s.url,
      createSocket: wsFactory,
      onProgress: (steps) => progress.push(steps.map((x) => x.state[0]).join('')),
    });
    expect(r.verdict).toBe('good');
    expect(r.message).toBe(GOOD_MESSAGE);
    expect(r.steps.map((x) => [x.key, x.state])).toEqual([
      ['page', 'ok'],
      ['health', 'ok'],
      ['ws', 'ok'],
      ['clock', 'ok'],
      ['rtt', 'ok'],
      ['notice', 'ok'],
    ]);
    expect(r.steps.find((x) => x.key === 'notice')!.detail).toBe('새 학기 업데이트를 했어요.');
    expect(r.steps.find((x) => x.key === 'page')!.detail).toBe(s.url);
    expect(Math.abs(r.steps.find((x) => x.key === 'clock')!.ms!)).toBeLessThan(100);
    const text = JSON.stringify(r);
    expect(text).not.toMatch(/rooms|maxRooms|\/50|사용 중인 방/);
    expect(progress.length).toBeGreaterThan(5);
    // 테스트가 연결을 닫고 간다
    await new Promise((res) => setTimeout(res, 100));
    expect(s.server.health().conns).toBe(0);
  });

  it('서버 꺼짐: "연결 안 돼요 — … https://<현재 도메인>(HTTPS·WebSocket 443) 허용을 요청하세요"', async () => {
    const s = await startTestServer();
    const url = s.url;
    await s.stop(); // 닫힌 포트
    const r = await runConnectionTest({
      href: 'https://lab.ches.es.kr/voyage/?sync=relay#/play',
      relayUrl: url,
      createSocket: wsFactory,
      stepTimeoutMs: 2000,
    });
    expect(r.verdict).toBe('fail');
    expect(r.message).toBe(failMessage('https://lab.ches.es.kr/voyage/'));
    expect(r.message).toContain('https://lab.ches.es.kr(HTTPS·WebSocket 443)');
    expect(r.steps.find((x) => x.key === 'health')!.state).toBe('fail');
    expect(r.steps.find((x) => x.key === 'ws')!.state).toBe('fail');
    expect(r.steps.filter((x) => x.state === 'skip').map((x) => x.key)).toEqual(['clock', 'rtt', 'notice']);
  });

  it('왕복 1초 이상이면 "느려요"', async () => {
    let t = 0;
    const fake = (): WebSocketLike => {
      const sock: WebSocketLike & { readyState: number } = {
        readyState: 0,
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
        send(data: string) {
          const m = JSON.parse(data) as { t: string; at: number };
          t += 1200;
          setTimeout(() => sock.onmessage?.({ data: JSON.stringify({ v: 3, t: 'pong', at: m.at, serverNow: t }) }), 0);
        },
        close() {},
      };
      setTimeout(() => {
        sock.readyState = 1;
        sock.onopen?.({});
        sock.onmessage?.({ data: JSON.stringify({ v: 3, t: 'server.notice', level: null }) });
      }, 0);
      return sock;
    };
    const r = await runConnectionTest({
      href: 'https://lab.ches.es.kr/voyage/?sync=relay',
      relayUrl: 'wss://lab.ches.es.kr/voyage/ws',
      createSocket: fake,
      fetchImpl: (async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch,
      now: () => t,
    });
    expect(r.verdict).toBe('slow');
    expect(r.message).toBe(SLOW_MESSAGE);
    expect(r.steps.find((x) => x.key === 'rtt')!.ms).toBe(1200);
  });
});

describe('공지 띠 도우미', () => {
  it('/notice 응답 해석·끝 시각 표시', () => {
    expect(noticeFromBody({ level: null })).toBeNull();
    expect(noticeFromBody({ level: 'warn', text: '점검' })).toEqual({ level: 'warn', text: '점검' });
    expect(noticeFromBody({ level: 'loud', text: 'x' })).toBeNull();
    expect(formatUntil(undefined)).toBe('');
    expect(formatUntil(new Date(2026, 9, 20, 18, 0).toISOString())).toBe('10월 20일 18:00까지');
  });
});
