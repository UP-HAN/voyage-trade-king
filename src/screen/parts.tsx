/**
 * 공용 화면 공통 부품 (작업 110): 회사 표시(깃발 + 회사 이름), 무역 시계 띠, QR, 연결 점, 돌발 사건·예보 자리(P1, 126이 채움).
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { img } from '../ui/common/asset';
import { FlagIcon } from '../ui/common/FlagIcon';
import { clockInfo, companyLabel, type ScreenData } from './model';
import { makeQr } from './qr';

/** 회사 표시 = 깃발 + 회사 이름(이름이 없으면 "이름 짓는 중"). 출석번호·실명은 받지도 그리지도 않는다 */
export function CompanyTag({ name, color, emblem, size = 64 }: { name: string | null; color: string; emblem: string; size?: number }) {
  const label = companyLabel(name);
  return (
    <span class={`scr-company${name ? '' : ' scr-company--pending'}`} data-testid="screen-company">
      <FlagIcon color={color} emblem={emblem} size={size} />
      <span class="scr-company__name">{label}</span>
    </span>
  );
}

/** 위쪽 구석 무역 시계 + 구간 이름(준비 단계 "곧 무역이 시작돼요", 마무리에는 숨김, 멈춤 표시) */
export function TradeClockBar({ d, now }: { d: ScreenData; now: number }) {
  const c = clockInfo(d, now);
  if (c.mode === 'hidden') return null;
  if (c.mode === 'prep') {
    return (
      <div class="scr-clock" data-testid="screen-clock" data-mode="prep">
        <span class="scr-clock__stage">곧 무역이 시작돼요</span>
      </div>
    );
  }
  return (
    <div class={`scr-clock${c.remainingSec <= 60 ? ' scr-clock--warn' : ''}`} data-testid="screen-clock" data-mode="trade" data-sec={Math.round(c.remainingSec)}>
      <span class="scr-clock__stage" data-testid="screen-clock-stage">
        {c.stageLabel}
      </span>
      <span class="scr-clock__time" aria-label={`무역 남은 시간 ${c.remaining}`}>
        {c.remaining}
      </span>
      {c.paused && (
        <span class="scr-clock__paused" data-testid="screen-clock-paused">
          멈춤
        </span>
      )}
    </div>
  );
}

/** (P1 자리, 126) 돌발 사건 진행 표시: 작은 기상도 아이콘 + "○○ 항구 문 닫음(1라운드)". 지금은 아무것도 그리지 않는다 */
export function IncidentBadge(_props: { d: ScreenData }) {
  return null;
}

/** (P1 자리, 126) 예보 띠: "갈매기가 바다 소식을 가져왔어요"(내용은 교사 설정이 켜졌을 때만). 지금은 아무것도 그리지 않는다 */
export function ForecastBand(_props: { d: ScreenData }) {
  return null;
}

/** QR 코드(SVG). 만들 수 없으면 주소 글자만 */
export function QrCode({ text, size }: { text: string; size: number }) {
  const qr = useMemo(() => makeQr(text), [text]);
  if (!qr) return null;
  const quiet = 4;
  const n = qr.size + quiet * 2;
  let d = '';
  qr.modules.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    });
  });
  return (
    <svg class="scr-qr" data-testid="screen-qr" data-version={qr.version} width={size} height={size} viewBox={`0 0 ${n} ${n}`} role="img" aria-label="들어오는 주소 QR 코드" shape-rendering="crispEdges">
      <rect width={n} height={n} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}

/** 양피지 판(놋쇠 테두리) */
export function Panel({ children, class: cls, testId }: { children: ComponentChildren; class?: string; testId?: string }) {
  return (
    <section class={`scr-panel ${cls ?? ''}`.trim()} data-testid={testId}>
      {children}
    </section>
  );
}

/** 막대 하나(이름 없이 수만) */
export function Bar({ label, value, max, suffix, testId }: { label: string; value: number; max: number; suffix: string; testId?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div class="scr-bar" data-testid={testId ?? 'screen-bar'}>
      <span class="scr-bar__label">{label}</span>
      <span class="scr-bar__track">
        <span class="scr-bar__fill" style={{ width: `${pct}%` }} />
      </span>
      <span class="scr-bar__value">
        {value}
        <small>{suffix}</small>
      </span>
    </div>
  );
}

/** 그림(없으면 대체 그림 → 그것도 없으면 숨김). 아직 만들지 않은 표지(작업 013)는 키아트로 대신한다 */
export function ArtImg({ path, fallback, alt, class: cls }: { path: string; fallback?: string; alt: string; class?: string }) {
  const [src, setSrc] = useState(path);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    setSrc(path);
    setGone(false);
  }, [path]);
  if (gone) return null;
  return (
    <img
      class={cls}
      src={img(src)}
      alt={alt}
      decoding="async"
      data-src-path={src}
      onError={() => {
        if (fallback && src !== fallback) setSrc(fallback);
        else setGone(true);
      }}
    />
  );
}
