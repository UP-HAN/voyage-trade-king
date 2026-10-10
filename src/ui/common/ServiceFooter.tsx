/**
 * 화면 하단 이용 안내 두 줄 + [이용 안내] 창(PRD 10.12.1 v0.3.4).
 * 배치: 타이틀(S01, 작업 131)·교사 시작 화면(T01, 작업 109). 판 설정·대시보드·학생 화면·공용 화면에는 두지 않는다.
 * 첫 줄 = 안내 한 줄 + [이용 안내], 둘째 줄 = 저작권·문의(`credit`, 글자로만 — 링크 아님, 작업 132).
 * 문구는 `service-notice.ts` 한곳에서만 읽는다. `config.json` 값은 글자로만 낸다(HTML로 해석하지 않음).
 * `/health`(3번의 `{maxRooms}`)는 학생도 거치는 타이틀 요청을 줄이려고 [이용 안내] 창을 **처음 열 때 1번** 읽는다(작업 132).
 * 교사 시작 화면처럼 이미 방 수를 읽는 화면에서는 같은 저장소의 값을 그대로 쓴다(새 요청 없음).
 */
import type { CSSProperties } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  loadConfigJson,
  parseServerInfo,
  parseServiceNoticeOverride,
  type ServerInfo,
  type ServiceNoticeOverride,
} from '../../config/deploy';
import { sharedServerRooms } from './server-status';
import { buildServiceNotice, splitLinks } from './service-notice';

/** [이용 안내] 창을 처음 열 때부터 방 상한(maxRooms)을 읽는다(그 전에는 /health 요청 없음) */
function useMaxRoomsAfterOpen(enabled: boolean): number | undefined {
  const [maxRooms, setMaxRooms] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (!enabled) return undefined;
    return sharedServerRooms().subscribe((s) => setMaxRooms(s.maxRooms));
  }, [enabled]);
  return maxRooms;
}

/** `config.json`의 serverInfo·serviceNotice(한 번 읽고 캐시) */
function useNoticeConfig(): { serverInfo: ServerInfo | null; override: ServiceNoticeOverride | null } {
  const [cfg, setCfg] = useState<{ serverInfo: ServerInfo | null; override: ServiceNoticeOverride | null }>({
    serverInfo: null,
    override: null,
  });
  useEffect(() => {
    let alive = true;
    loadConfigJson().then((raw) => {
      if (!alive) return;
      setCfg({ serverInfo: parseServerInfo(raw), override: parseServiceNoticeOverride(raw) });
    });
    return () => {
      alive = false;
    };
  }, []);
  return cfg;
}

/** 링크로 허락된 부분만 `<a>`로, 나머지는 글자로 */
function LinkedText({ text, links, linkStyle }: { text: string; links: readonly string[]; linkStyle?: CSSProperties }) {
  return (
    <>
      {splitLinks(text, links).map((p, i) =>
        p.href ? (
          <a key={i} href={p.href} target="_blank" rel="noopener noreferrer" style={linkStyle}>
            {p.text}
          </a>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** (작업 109) Tab·Shift+Tab을 창 안에서 돌린다 — 창이 열린 동안 뒤 화면으로 포커스가 가지 않게 */
export function trapFocus(e: Pick<KeyboardEvent, 'shiftKey' | 'preventDefault'>, box: HTMLElement | null): void {
  if (!box) return;
  const items = Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE));
  const active = (typeof document !== 'undefined' ? document.activeElement : null) as HTMLElement | null;
  if (!items.length) {
    e.preventDefault();
    box.focus();
    return;
  }
  const first = items[0] as HTMLElement;
  const last = items[items.length - 1] as HTMLElement;
  const inside = !!active && box.contains(active) && active !== box;
  if (e.shiftKey && (!inside || active === first)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (!inside || active === last)) {
    e.preventDefault();
    first.focus();
  }
}

export interface ServiceFooterProps {
  /** 줄을 문서 흐름 안에 둘지(기본) 화면 아래에 고정할지 */
  fixed?: boolean;
}

export function ServiceFooter({ fixed = false }: ServiceFooterProps) {
  const { serverInfo, override } = useNoticeConfig();
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(false);
  const maxRooms = useMaxRoomsAfterOpen(opened);
  const btnRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);

  const notice = buildServiceNotice({ maxRooms, serverInfo, override });

  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      dialogRef.current?.focus();
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          setOpen(false);
        } else if (e.key === 'Tab') trapFocus(e, dialogRef.current); // (작업 109) 창 밖으로 포커스가 나가지 않게
      };
      document.addEventListener('keydown', onKey);
      return () => document.removeEventListener('keydown', onKey);
    }
    if (wasOpen.current) {
      wasOpen.current = false;
      btnRef.current?.focus();
    }
    return undefined;
  }, [open]);

  const bar: CSSProperties = {
    ...(fixed ? { position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 20 } : {}),
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '4px 12px',
    padding: '6px 16px',
    background: 'rgba(12, 34, 48, 0.86)', // --sea-deep 반투명: 흰 글씨 대비 AA 이상
    color: '#FFFFFF',
    fontSize: '15px',
    lineHeight: 1.45,
    textAlign: 'center',
    boxSizing: 'border-box',
    width: '100%',
  };

  return (
    <footer class="service-footer" data-testid="service-footer" style={bar}>
      <p data-testid="service-footer-text" style={{ margin: 0, flex: '0 1 auto', minWidth: 0 }}>
        <LinkedText text={notice.short} links={notice.links} linkStyle={{ color: '#FFE3A8' }} />
      </p>
      <button
        ref={btnRef}
        type="button"
        data-testid="service-footer-open"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setOpened(true);
          setOpen(true);
        }}
        style={{
          flex: '0 0 auto',
          minHeight: '48px',
          minWidth: '48px',
          padding: '0 16px',
          border: '2px solid rgba(255,255,255,0.85)',
          borderRadius: '8px',
          background: 'transparent',
          color: '#FFFFFF',
          font: 'inherit',
          fontSize: '16px',
          cursor: 'pointer',
        }}
      >
        이용 안내
      </button>
      {/* 둘째 줄: 저작권·문의(글자만 — 학생이 타이틀에서 인스타그램으로 넘어가지 않게) */}
      <p
        data-testid="service-footer-credit"
        style={{ margin: 0, flex: '1 0 100%', fontSize: '13px', lineHeight: 1.4, color: '#FFFFFF', opacity: 0.92 }}
      >
        {notice.credit}
      </p>
      {open && (
        <div
          data-testid="service-notice-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            background: 'rgba(12, 34, 48, 0.6)',
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="service-notice-title"
            tabIndex={-1}
            data-testid="service-notice-dialog"
            style={{
              width: 'min(880px, 100%)',
              maxHeight: 'calc(100vh - 32px)',
              display: 'flex',
              flexDirection: 'column',
              padding: '24px 28px 20px',
              border: '2px solid var(--brass, #DCAA48)',
              borderRadius: '14px',
              background: 'var(--parchment-light, #EFE2BF)',
              color: 'var(--ink, #2B2318)',
              textAlign: 'left',
              fontSize: '18px',
              lineHeight: 1.6,
              boxShadow: '0 8px 28px rgba(12, 34, 48, 0.45)',
              outline: 'none',
            }}
          >
            <h2 id="service-notice-title" class="title-font" style={{ margin: '0 0 12px', fontSize: '28px' }}>
              {notice.full.title}
            </h2>
            <ol
              data-testid="service-notice-items"
              style={{ margin: 0, paddingLeft: '1.6em', overflowY: 'auto', flex: '1 1 auto', minHeight: 0 }}
            >
              {notice.full.items.map((t, i) => (
                <li key={i} style={{ marginBottom: '8px' }}>
                  <LinkedText text={t} links={notice.links} />
                </li>
              ))}
            </ol>
            <p style={{ margin: '12px 0 0', textAlign: 'right', flex: '0 0 auto' }}>
              <button
                type="button"
                class="btn btn--primary"
                data-testid="service-notice-close"
                onClick={() => setOpen(false)}
              >
                닫기
              </button>
            </p>
          </div>
        </div>
      )}
    </footer>
  );
}

export default ServiceFooter;
