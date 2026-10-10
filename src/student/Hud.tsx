/**
 * S07 상단 HUD (PRD 8.3 S07, 8.1-2 핵심 숫자 3개: 자금·배 칸·라운드 남은 시간).
 * 무역 남은 시간은 작게("무역 14분 남음"). 시각은 서버 시각(`store.serverNow()`) 기준.
 * 출석번호는 HUD에 없다 — 설정(톱니) 안 작은 글씨에만(v0.3.1).
 */
import { useEffect, useState } from 'preact/hooks';
import type { ActiveNotice } from '@shared/protocol';
import { tradeClock, type PublicClass } from '../core';
import { shipsById } from '../data/ships';
import { FlagIcon } from '../ui/common/FlagIcon';
import { NoticeBanner } from '../ui/common/NoticeBanner';
import { BellDotIcon, BookIcon, CoinIcon, CrateIcon, ClockIcon, GearIcon } from './icons';
import type { MeView } from './predict';
import { LetterHudSlot } from './slots';
import type { StudentState, StudentStore } from './store';
import { formatClock, formatMinutes, formatMoney } from './text';

export function cargoUsed(me: MeView): number {
  return me.game.cargo.reduce((s, l) => s + l.qty, 0);
}

export interface TimeInfo {
  /** 구간·라운드 표시 */
  label: string;
  /** 큰 숫자(라운드 남은 시간) — 없으면 null */
  round: string | null;
  /** 작은 글씨: "무역 14분 남음" */
  trade: string;
  /** 라운드 30초 이하 */
  warn: boolean;
}

/** 시간 표시 계산(순수) */
export function timeInfo(cls: PublicClass, now: number): TimeInfo {
  const stage = `${cls.stage} 구간`;
  const tradeLeft = tradeClock.remaining(cls.clock, now);
  const started = cls.clock.startedAt !== null;
  const trade = !started ? `무역 ${formatMinutes(cls.clock.durationSec)} · 시작 전` : cls.tradeEnded ? '무역 끝' : `무역 ${formatMinutes(tradeLeft)} 남음`;
  if (cls.phase === 'prep') return { label: '준비 시간', round: null, trade, warn: false };
  if (cls.phase === 'wrapup' || cls.phase === 'ended') return { label: '마무리', round: null, trade: '무역 끝', warn: false };
  if (cls.phase === 'round') {
    const ms = cls.paused || cls.roundEndsAt === null ? cls.roundRemainingMs ?? 0 : cls.roundEndsAt - now;
    const sec = Math.max(0, ms / 1000);
    return { label: `${stage} · 라운드 ${cls.round}`, round: formatClock(sec), trade, warn: sec <= 30 };
  }
  if (cls.phase === 'event') return { label: `${stage} · 활동`, round: null, trade, warn: false };
  if (cls.phase === 'worksheet') return { label: `${stage} · 잠깐!`, round: null, trade, warn: false };
  return { label: `${stage} · 쉬는 중`, round: null, trade, warn: false };
}

export function Hud({
  store,
  st,
  now,
  onDex,
}: {
  store: StudentStore;
  st: StudentState;
  now: number;
  onDex: () => void;
}) {
  const me = st.peer.me!;
  const cls = st.peer.public?.class ?? null;
  const ship = shipsById[me.game.ship];
  const used = cargoUsed(me);
  const t = cls ? timeInfo(cls, now) : null;
  const [menu, setMenu] = useState(false);
  const [notice, setNotice] = useState<ActiveNotice | null>(() => store.notice());
  const [showNotice, setShowNotice] = useState(false);
  useEffect(() => store.onNotice((n) => setNotice(n)), [store]);
  const name = st.peer.nameStatus === 'blocked' ? '이름 짓는 중' : me.company.name;

  return (
    <header class="st-hud" data-testid="hud">
      <div class="st-hud__company">
        <FlagIcon color={me.company.color} emblem={me.company.emblem} size={44} />
        <span class="st-hud__name" data-testid="hud-company">
          {name}
        </span>
      </div>
      <div class="st-hud__stat" data-testid="hud-money">
        <span class="st-hud__label">
          <CoinIcon /> 자금
        </span>
        <span class="st-hud__num">{formatMoney(me.game.money)}</span>
      </div>
      <div class="st-hud__stat" data-testid="hud-cargo">
        <span class="st-hud__label">
          <CrateIcon /> 배 칸 <span class={`st-ship-chip st-ship-chip--${ship.id}`}>{ship.name.split(' ')[0]}</span>
        </span>
        <span class="st-hud__num">
          {used}/{ship.capacity}
          <small>칸</small>
        </span>
      </div>
      {t && (
        <div class={`st-hud__stat st-hud__time${t.warn ? ' is-warn' : ''}`} data-testid="hud-time">
          <span class="st-hud__label">
            <ClockIcon /> {t.label}
          </span>
          <span class="st-hud__num-row">
            {t.round && <span class="st-hud__num">{t.round}</span>}
            <span class="st-hud__trade" data-testid="hud-trade-left">
              {t.trade}
            </span>
          </span>
        </div>
      )}
      <div class="st-hud__tools">
        {notice && (
          <button type="button" class="st-icon-btn" aria-label="서버 공지 보기" data-testid="hud-notice" onClick={() => setShowNotice((v) => !v)}>
            <BellDotIcon />
          </button>
        )}
        <button type="button" class="st-tool-btn" data-testid="hud-dex" onClick={onDex}>
          <BookIcon />
          <span>도감</span>
        </button>
        <LetterHudSlot store={store} st={st} />
        <button
          type="button"
          class="st-icon-btn"
          aria-label="설정"
          aria-expanded={menu}
          data-testid="hud-settings"
          onClick={() => setMenu((v) => !v)}
        >
          <GearIcon />
        </button>
      </div>
      {showNotice && notice && (
        <div class="st-hud__notice" onClick={() => setShowNotice(false)}>
          <NoticeBanner notice={notice} compact />
        </div>
      )}
      {menu && <SettingsMenu store={store} st={st} onClose={() => setMenu(false)} />}
    </header>
  );
}

function SettingsMenu({ store, st, onClose }: { store: StudentStore; st: StudentState; onClose: () => void }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div class="st-menu" role="menu" data-testid="settings-menu">
      {st.peer.seat !== null && (
        <p class="st-menu__seat" data-testid="settings-seat">
          내 출석번호 {st.peer.seat}번
        </p>
      )}
      {!confirm ? (
        <>
          <button type="button" class="btn btn--secondary" role="menuitem" data-testid="settings-leave" onClick={() => setConfirm(true)}>
            게임 나가기
          </button>
          <button type="button" class="btn btn--secondary" role="menuitem" onClick={onClose}>
            닫기
          </button>
        </>
      ) : (
        <div class="st-menu__confirm">
          <p>게임에서 나갈까요? 다시 들어오려면 방 코드와 출석번호, 회사 이름을 넣어요.</p>
          <div class="st-row-btns">
            <button type="button" class="btn btn--secondary" onClick={() => setConfirm(false)}>
              그대로 하기
            </button>
            <button
              type="button"
              class="btn btn--primary"
              data-testid="settings-leave-ok"
              onClick={() => {
                store.leaveGame();
                onClose();
                location.hash = '#/';
              }}
            >
              나가기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
