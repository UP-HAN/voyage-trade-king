/**
 * HUD 편지함 아이콘(작업 112, PRD 6.7.2 — 화면 오른쪽 위 HUD의 48px 칸).
 * 숫자 배지 = 아직 답하지 않았고 기한이 남은 편지 수. 누르면 오른쪽 편지 패널(`LetterLayer`)이 열린다(거래를 막지 않음).
 * slots.tsx `LetterHudSlot`이 이 컴포넌트를 그린다(onOpen은 넘어오지 않아 `ui.ts` 저장소로 패널을 연다).
 */
import type { PublicClass } from '../../core';
import type { MeView } from '../predict';
import { letterBox, unansweredCount } from './model';
import { openLetters, closeLetters, useLetterUi } from './ui';
import './letters.css';

export interface LetterBadgeProps {
  classState: PublicClass | null;
  player: MeView | null;
  /** 편지 패널 열기(주면 이것을 부른다) */
  onOpen?: () => void;
}

export function EnvelopeIcon({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" aria-hidden="true">
      <path d="M3 7H23V20H3Z" fill="#EFE2BF" stroke="#2B2318" stroke-width="1.6" stroke-linejoin="round" />
      <path d="M3 7L13 15L23 7" fill="none" stroke="#2B2318" stroke-width="1.5" stroke-linejoin="round" />
      <circle cx="13" cy="15" r="2.6" fill="#C0623F" stroke="#2B2318" stroke-width="0.8" />
    </svg>
  );
}

export function LetterBadge({ classState, player, onOpen }: LetterBadgeProps) {
  const ui = useLetterUi();
  if (!classState || !player) return <span class="st-hud__slot" data-slot="letters" aria-hidden="true" />;
  const views = letterBox(classState, player);
  const n = unansweredCount(views);
  const label = n > 0 ? `편지함, 새 편지 ${n}통` : '편지함';
  return (
    <button
      type="button"
      class={`st-tool-btn lt-badge${n > 0 ? ' has-new' : ''}`}
      data-slot="letters"
      data-testid="hud-letters"
      data-count={n}
      aria-label={label}
      aria-expanded={ui.open}
      onClick={() => {
        if (onOpen) return onOpen();
        if (ui.open) closeLetters();
        else openLetters();
      }}
    >
      <EnvelopeIcon />
      <span>편지</span>
      {n > 0 && (
        <span class="lt-badge__n" data-testid="letter-count" aria-hidden="true">
          {n}
        </span>
      )}
    </button>
  );
}

export default LetterBadge;
