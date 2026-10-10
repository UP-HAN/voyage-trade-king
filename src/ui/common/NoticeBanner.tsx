/**
 * 서버 공지 띠(PRD 10.12, docs/server-setup.md 2.4) — 공통 컴포넌트. 배치는 107(학생 입장·타이틀)·109(교사 시작 화면).
 *
 * 공지를 얻는 방법(셋 중 하나):
 * - `notice`: 이미 가진 공지를 그대로 보여 줌
 * - `source`: 전송 어댑터(`onNotice` — WebSocket `server.notice`)를 구독
 * - `fetchFrom`: `/notice`를 한 번 가져옴(문자열 = 그 주소, true = 중계 주소와 같은 폴더의 `notice`)
 * 색: info 파랑, warn 주황, maintenance 빨강. 글자 18px 이상. 공지가 없으면 아무것도 그리지 않는다.
 */
import { useEffect, useState } from 'preact/hooks';
import type { ActiveNotice, NoticeLevel } from '@shared/protocol';
import { relayUrl } from '../../config/deploy';
import type { Unsub } from '../../sync/adapter';
import { relayHttpUrl } from '../../sync/relay';

export interface NoticeSource {
  onNotice(cb: (n: ActiveNotice | null) => void): Unsub;
  currentNotice?(): ActiveNotice | null;
}

export interface NoticeBannerProps {
  notice?: ActiveNotice | null;
  source?: NoticeSource;
  fetchFrom?: string | true;
  fetchImpl?: typeof fetch;
  /** 작게(진행 중 교사 대시보드용 작은 알림) */
  compact?: boolean;
}

export const NOTICE_STYLE: Record<NoticeLevel, { bg: string; border: string; label: string }> = {
  info: { bg: '#1F5F8B', border: '#123448', label: '알림' },
  warn: { bg: '#C77A1A', border: '#8D5410', label: '안내' },
  maintenance: { bg: '#B23A2A', border: '#7A2418', label: '점검' },
};

/** `/notice` 응답 → 공지(형식이 틀리면 null) */
export function noticeFromBody(body: unknown): ActiveNotice | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as { level?: unknown; text?: unknown; until?: unknown };
  if (b.level !== 'info' && b.level !== 'warn' && b.level !== 'maintenance') return null;
  if (typeof b.text !== 'string' || !b.text) return null;
  return { level: b.level, text: b.text, ...(typeof b.until === 'string' ? { until: b.until } : {}) };
}

/** 끝나는 시각 표시: "10월 20일 18:00까지" */
export function formatUntil(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${hh}:${mm}까지`;
}

export function NoticeBanner({ notice, source, fetchFrom, fetchImpl, compact = false }: NoticeBannerProps) {
  const [fromSource, setFromSource] = useState<ActiveNotice | null>(() => source?.currentNotice?.() ?? null);
  const [fetched, setFetched] = useState<ActiveNotice | null>(null);

  useEffect(() => {
    if (!source) return undefined;
    setFromSource(source.currentNotice?.() ?? null);
    return source.onNotice((n) => setFromSource(n));
  }, [source]);

  useEffect(() => {
    if (!fetchFrom) return undefined;
    let alive = true;
    const f = fetchImpl ?? (typeof fetch === 'function' ? fetch : undefined);
    if (!f) return undefined;
    (async () => {
      try {
        const url = fetchFrom === true ? relayHttpUrl(await relayUrl(), 'notice') : fetchFrom;
        const res = await f(url, { cache: 'no-store' });
        if (!res.ok) return;
        const n = noticeFromBody(await res.json());
        if (alive) setFetched(n);
      } catch {
        /* 공지를 못 가져오면 띠를 숨긴다 */
      }
    })();
    return () => {
      alive = false;
    };
  }, [fetchFrom, fetchImpl]);

  const shown = notice !== undefined ? notice : source ? fromSource : fetched;
  if (!shown || !shown.text) return null;
  const st = NOTICE_STYLE[shown.level];
  const until = formatUntil(shown.until);
  return (
    <div
      class={`notice-banner notice-banner--${shown.level}`}
      data-testid="notice-banner"
      data-level={shown.level}
      role={shown.level === 'maintenance' ? 'alert' : 'status'}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        background: st.bg,
        color: '#FFFFFF',
        borderBottom: `3px solid ${st.border}`,
        padding: compact ? '6px 12px' : '10px 16px',
        fontSize: compact ? '18px' : '20px',
        lineHeight: 1.4,
      }}
    >
      <span
        style={{
          flex: '0 0 auto',
          border: '2px solid rgba(255,255,255,0.85)',
          borderRadius: '6px',
          padding: '0 8px',
          fontSize: '18px',
          fontWeight: 700,
        }}
      >
        {st.label}
      </span>
      <span style={{ flex: '1 1 auto' }}>{shown.text}</span>
      {until && <span style={{ flex: '0 0 auto', fontSize: '18px', opacity: 0.9 }}>{until}</span>}
    </div>
  );
}

export default NoticeBanner;
