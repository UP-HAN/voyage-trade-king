import { describe, expect, it, vi } from 'vitest';
import {
  APP_VERSION,
  defaultRelayUrl,
  loadRuntimeConfig,
  readQueryParam,
  relayUrl,
  resolveRelayUrl,
  syncMode,
} from '../../src/config/deploy';

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as unknown as Response;
}

describe('defaultRelayUrl — 페이지 위치 기준 ./ws', () => {
  const cases: Array<[string, string]> = [
    ['https://lab.ches.es.kr/voyage/#/play', 'wss://lab.ches.es.kr/voyage/ws'],
    ['https://lab.ches.es.kr/voyage/', 'wss://lab.ches.es.kr/voyage/ws'],
    ['https://lab.ches.es.kr/voyage/index.html#/teacher', 'wss://lab.ches.es.kr/voyage/ws'],
    ['https://lab.ches.es.kr/voyage/?sync=relay#/screen', 'wss://lab.ches.es.kr/voyage/ws'],
    ['https://example.org/other/path/#/play?x=1', 'wss://example.org/other/path/ws'],
    ['https://example.org/', 'wss://example.org/ws'],
    ['http://localhost:5173/', 'ws://localhost:5173/ws'],
    ['http://localhost:4173/#/play', 'ws://localhost:4173/ws'],
    ['http://192.168.0.10:8080/game/voyage/#/', 'ws://192.168.0.10:8080/game/voyage/ws'],
    ['https://school.example.kr:8443/a/b/c/#/screen', 'wss://school.example.kr:8443/a/b/c/ws'],
  ];
  it.each(cases)('%s → %s', (href, expected) => {
    expect(defaultRelayUrl(href)).toBe(expected);
  });
});

describe('resolveRelayUrl — 우선순위', () => {
  const href = 'https://lab.ches.es.kr/voyage/#/play';

  it('설정이 없으면 기본값', () => {
    expect(resolveRelayUrl(href)).toBe('wss://lab.ches.es.kr/voyage/ws');
    expect(resolveRelayUrl(href, null)).toBe('wss://lab.ches.es.kr/voyage/ws');
    expect(resolveRelayUrl(href, {})).toBe('wss://lab.ches.es.kr/voyage/ws');
  });

  it('config.json 의 relayUrl 이 기본값보다 앞선다', () => {
    expect(resolveRelayUrl(href, { relayUrl: 'wss://relay.example.org/ws' })).toBe('wss://relay.example.org/ws');
  });

  it('?relay= 가 config.json 보다 앞선다(해시 앞 질의)', () => {
    const h = 'https://lab.ches.es.kr/voyage/?relay=wss://other.example.org/r/ws#/play';
    expect(resolveRelayUrl(h, { relayUrl: 'wss://relay.example.org/ws' })).toBe('wss://other.example.org/r/ws');
  });

  it('?relay= 는 해시 안의 질의도 읽는다', () => {
    const h = 'https://lab.ches.es.kr/voyage/#/play?relay=ws://localhost:8787/ws';
    expect(resolveRelayUrl(h)).toBe('ws://localhost:8787/ws');
  });

  it('http(s) 주소는 ws(s)로 바꾸고, 상대 주소는 페이지 위치 기준으로 푼다', () => {
    expect(resolveRelayUrl(href, { relayUrl: 'https://relay.example.org/ws' })).toBe('wss://relay.example.org/ws');
    expect(resolveRelayUrl(href, { relayUrl: './relay' })).toBe('wss://lab.ches.es.kr/voyage/relay');
  });

  it('쓸 수 없는 값은 무시하고 다음 순위로 넘어간다', () => {
    const h = 'https://lab.ches.es.kr/voyage/?relay=ftp://x/ws#/play';
    expect(resolveRelayUrl(h, { relayUrl: 'mailto:a@b.c' })).toBe('wss://lab.ches.es.kr/voyage/ws');
  });
});

describe('relayUrl / loadRuntimeConfig — config.json 읽기', () => {
  const href = 'https://lab.ches.es.kr/voyage/#/play';

  it('같은 폴더의 config.json 을 읽는다', async () => {
    const f = vi.fn(async () => jsonResponse({ relayUrl: 'wss://relay.example.org/ws' }));
    await expect(relayUrl(href, f as unknown as typeof fetch)).resolves.toBe('wss://relay.example.org/ws');
    expect(f).toHaveBeenCalledWith('https://lab.ches.es.kr/voyage/config.json', expect.anything());
  });

  it('config.json 이 없으면(404) 기본값', async () => {
    const f = vi.fn(async () => jsonResponse(null, false));
    await expect(relayUrl(href, f as unknown as typeof fetch)).resolves.toBe('wss://lab.ches.es.kr/voyage/ws');
  });

  it('네트워크 오류·잘못된 JSON 이면 기본값', async () => {
    const f = vi.fn(async () => {
      throw new Error('network');
    });
    await expect(relayUrl(href, f as unknown as typeof fetch)).resolves.toBe('wss://lab.ches.es.kr/voyage/ws');
    const g = vi.fn(async () => ({ ok: true, json: async () => { throw new SyntaxError('bad'); } }) as unknown as Response);
    await expect(loadRuntimeConfig(href, g as unknown as typeof fetch)).resolves.toBeNull();
  });

  it('?relay= 가 있으면 config.json 을 읽지 않는다', async () => {
    const f = vi.fn(async () => jsonResponse({ relayUrl: 'wss://relay.example.org/ws' }));
    const h = 'https://lab.ches.es.kr/voyage/?relay=wss://q.example.org/ws#/play';
    await expect(relayUrl(h, f as unknown as typeof fetch)).resolves.toBe('wss://q.example.org/ws');
    expect(f).not.toHaveBeenCalled();
  });
});

describe('syncMode', () => {
  it('?sync= 가 우선', () => {
    expect(syncMode('https://a.kr/voyage/?sync=memory#/play', false)).toBe('memory');
    expect(syncMode('https://a.kr/voyage/?sync=local#/play', false)).toBe('local');
    expect(syncMode('http://localhost:5173/#/teacher?sync=relay', true)).toBe('relay');
  });
  it('없거나 틀린 값이면 개발 서버는 local, 빌드는 relay', () => {
    expect(syncMode('http://localhost:5173/#/play', true)).toBe('local');
    expect(syncMode('https://a.kr/voyage/#/play', false)).toBe('relay');
    expect(syncMode('https://a.kr/voyage/?sync=firebird#/play', false)).toBe('relay');
  });
});

describe('readQueryParam / APP_VERSION', () => {
  it('해시 앞 질의를 먼저 본다', () => {
    expect(readQueryParam('https://a.kr/?k=1#/p?k=2', 'k')).toBe('1');
    expect(readQueryParam('https://a.kr/#/p?k=2', 'k')).toBe('2');
    expect(readQueryParam('https://a.kr/#/p', 'k')).toBeNull();
  });
  it('APP_VERSION 은 package.json 버전 + 빌드 시각', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+\+\d{8}T\d{6}Z$/);
  });
});
