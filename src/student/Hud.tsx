/**
 * S07 상단 HUD (PRD 8.3 S07, 8.1-2 핵심 숫자: 자금·배 칸). 시간 칸에는 구간·라운드 이름만 —
 * (작업 159) 남은 시간 숫자는 학생 화면에 보이지 않는다(교사 요청).
 * 출석번호는 HUD에 없다 — 설정(톱니) 안 작은 글씨에만(v0.3.1).
 */
import { useEffect, useState } from 'preact/hooks';
import type { ActiveNotice } from '@shared/protocol';
import type { PublicClass } from '../core';
import { shipsById } from '../data/ships';
import { FlagIcon } from '../ui/common/FlagIcon';
import { NoticeBanner } from '../ui/common/NoticeBanner';
import { BellDotIcon, BookIcon, CoinIcon, CrateIcon, ClockIcon, GearIcon } from './icons';
import type { MeView } from './predict';
import { LetterHudSlot } from './slots';
import type { StudentState, StudentStore } from './store';
import { formatMoney } from './text';

export function cargoUsed(me: MeView): number {
  return me.game.cargo.reduce((s, l) => s + l.qty, 0);
}

export interface TimeInfo {
  /** 구간·라운드 표시 */
  label: string;
  /** 작은 글씨: "무역 중"·"무역 시작 전"·"무역 끝" — (작업 159) 시간 숫자는 보이지 않는다 */
  trade: string;
}

/**
 * 시간 표시 계산(순수).
 * (작업 159, 교사 요청 2026-10-21) 학생 화면에는 남은 무역 시간·라운드 남은 시간을 숫자로 보이지 않는다 —
 * 교사가 분위기를 보며 이끈다. 라운드 번호·구간 이름만 남긴다. `now` 는 옛 호출과 맞추려고 받기만 한다.
 */
export function timeInfo(cls: PublicClass, _now?: number): TimeInfo {
  // (작업 115) 차시 한 판이면 "2차시"(개발 용어 'L2 구간' 대신). 단원 한 판은 그대로
  const stage = `${cls.stage.replace(/^L/, '')}차시`;
  const started = cls.clock.startedAt !== null;
  const trade = !started ? '무역 시작 전' : cls.tradeEnded ? '무역 끝' : '무역 중';
  if (cls.phase === 'prep') return { label: '준비 시간', trade };
  if (cls.phase === 'wrapup' || cls.phase === 'ended') return { label: '마무리', trade: '무역 끝' };
  if (cls.phase === 'round') return { label: `${stage} · 라운드 ${cls.round}`, trade };
  if (cls.phase === 'event') return { label: `${stage} · 활동`, trade };
  if (cls.phase === 'worksheet') return { label: `${stage} · 잠깐!`, trade };
  // (작업 153 추가) 자유 항해 판의 라운드 사이는 쉬는 때가 아니다
  if (cls.settings?.voyageMode === 'free' && cls.round >= 1 && !cls.tradeEnded) return { label: `${stage} · 자유 항해`, trade };
  return { label: `${stage} · 쉬는 중`, trade };
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
        <span class="st-hud__num">
          {formatMoney(me.game.money)}
          {/* (작업 151) 자유 항해: 라운드 끝에 낼 운항비 */}
          {(me.game.fareDue ?? 0) > 0 && (
            <small class="st-hud__due" data-testid="hud-fare-due">
              {` (낼 운항비 ${me.game.fareDue})`}
            </small>
          )}
        </span>
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
        <div class="st-hud__stat st-hud__time" data-testid="hud-time">
          <span class="st-hud__label">
            <ClockIcon /> {t.label}
          </span>
          <span class="st-hud__num-row">
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
