/**
 * 편지함 화면 상태(작업 112) — HUD 편지함 아이콘(`LetterBadge`)과 편지 패널(`LetterLayer`)이 함께 쓰는 작은 저장소.
 * slots.tsx가 둘에게 열기 함수를 넘기지 않으므로(111이 고정한 연결) 이 모듈 하나로 잇는다. 기기 화면 상태일 뿐 저장하지 않는다.
 */
import { useEffect, useState } from 'preact/hooks';

export interface LetterUiState {
  /** 오른쪽 편지 패널이 열렸는가 */
  open: boolean;
  /** 패널 안에서 읽는 편지 슬롯(null = 편지함 목록) */
  slotId: string | null;
  /** 탭: 편지 / 바다 소식(예보 — 작업 126이 채움) */
  tab: 'letters' | 'forecast';
}

let state: LetterUiState = { open: false, slotId: null, tab: 'letters' };
const subs = new Set<() => void>();

export function letterUi(): LetterUiState {
  return state;
}

export function setLetterUi(patch: Partial<LetterUiState>): void {
  state = { ...state, ...patch };
  for (const f of [...subs]) f();
}

/** 편지함 열기(슬롯을 주면 그 편지를 바로 읽기) */
export function openLetters(slotId: string | null = null): void {
  setLetterUi({ open: true, slotId, tab: 'letters' });
}

export function closeLetters(): void {
  setLetterUi({ open: false, slotId: null });
}

/** 테스트용: 처음 상태로 */
export function resetLetterUi(): void {
  state = { open: false, slotId: null, tab: 'letters' };
  for (const f of [...subs]) f();
}

export function useLetterUi(): LetterUiState {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((x) => x + 1);
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  }, []);
  return state;
}
