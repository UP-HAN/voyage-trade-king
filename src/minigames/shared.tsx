/**
 * 미니게임 공통(작업 113): 진행 저장 훅, 결과 보내기(연속 클릭 가드), 화면 틀.
 *
 * 결과(`respondEvent`)는 학생이 정답 공개·정의 카드·결과 그래프까지 본 뒤 [마치기]에서 보낸다.
 * 사건 층(111)은 기록이 생기면 지금 사건의 미니게임을 닫고 "기다려요" 화면으로 바꾸기 때문이다.
 * 다만 채점이 끝난 뒤(첫 제출·두 섬 성공) 교사가 사건을 마감해 화면이 닫히면, 닫히는 순간 그 결과를 보낸다(보상을 잃지 않게).
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Action, Json } from '../core';
import { toggleAllowed } from '../student/guard';
import type { StudentActResult } from '../student/store';
import { loadProgress, saveProgress } from './logic';

/** 저장되는 진행 상태 — 새로 고침해도 단계 유지 */
export function usePersisted<T extends { v: number }>(key: string, v: number, init: () => T): [T, (next: T | ((s: T) => T)) => void] {
  const [state, setState] = useState<T>(() => loadProgress<T>(key, v) ?? init());
  const ref = useRef(state);
  ref.current = state;
  const update = (next: T | ((s: T) => T)) => {
    const value = typeof next === 'function' ? (next as (s: T) => T)(ref.current) : next;
    ref.current = value;
    saveProgress(key, value);
    setState(value);
  };
  // 처음 그린 상태도 저장(시작 시각 등)
  useEffect(() => saveProgress(key, ref.current), [key]);
  return [state, update];
}

export type SendResult = 'ok' | 'guard' | 'fail';

/**
 * 결과 보내기. 연속 클릭 가드(107 READY_TOGGLE_GUARD_MS 패턴)와 "닫힐 때 보내기"를 맡는다.
 * - `setPending(response)`: 채점이 끝나 보낼 결과가 생기면 기억해 둔다(화면이 닫히면 그때 보냄).
 * - `send()`: [마치기] — 기억해 둔 결과를 보낸다.
 */
export function useResultSender(eventId: string, act: (a: Action) => StudentActResult, alreadySent: boolean) {
  const lastAt = useRef<number | null>(null);
  const pending = useRef<Json | null>(null);
  const sent = useRef(alreadySent);
  const actRef = useRef(act);
  actRef.current = act;

  useEffect(
    () => () => {
      // 화면이 닫힘(교사 마감 등) — 채점이 끝난 결과가 남아 있으면 지금 보낸다
      if (pending.current !== null && !sent.current) {
        sent.current = true;
        try {
          actRef.current({ type: 'respondEvent', eventId, response: pending.current });
        } catch {
          /* 무시 */
        }
      }
    },
    [eventId],
  );

  return {
    setPending(r: Json | null) {
      pending.current = r;
    },
    /** 연속 클릭 가드만(보내지 않는 버튼용) */
    guard(): boolean {
      const t = Date.now();
      if (!toggleAllowed(lastAt.current, t)) return false;
      lastAt.current = t;
      return true;
    },
    send(): SendResult {
      const t = Date.now();
      if (!toggleAllowed(lastAt.current, t)) return 'guard';
      lastAt.current = t;
      if (sent.current) return 'ok';
      if (pending.current === null) return 'fail';
      const r = actRef.current({ type: 'respondEvent', eventId, response: pending.current });
      if (r === 'sent' || r === 'queued') {
        sent.current = true;
        return 'ok';
      }
      return 'fail';
    },
    get sent() {
      return sent.current;
    },
  };
}

/** 미니게임 화면 틀(배경 그림은 확대하지 않고 덮기만, 없으면 양피지 + 물결 무늬) */
export function MinigameFrame({
  id,
  game,
  title,
  kicker,
  bg,
  bgSet,
  children,
  step,
  extra,
}: {
  id: string;
  game: 'byeokrando' | 'twoIslands';
  title: string;
  kicker: ComponentChildren;
  bg: string | null;
  /** (작업 133) 배경 그림 크기별 사본 srcset(빌드본) — 없으면 bg 하나 */
  bgSet?: string;
  step: string;
  /** 머리 오른쪽(상인 그림, 단계 표시 등) */
  extra?: ComponentChildren;
  children: ComponentChildren;
}) {
  const [bgOk, setBgOk] = useState(true);
  return (
    <section class={`mg mg--${game}`} role="dialog" aria-label={title} data-testid="minigame" data-event={id} data-step={step}>
      {bg && bgOk && <img class="mg__bg" src={bg} srcset={bgSet || undefined} sizes="100vw" alt="" aria-hidden="true" decoding="async" onError={() => setBgOk(false)} />}
      <div class="mg__veil" aria-hidden="true" />
      <header class="mg__head">
        <div class="mg__titles">
          <p class="mg__kicker">{kicker}</p>
          <h2 class="mg__title title-font">{title}</h2>
        </div>
        {extra}
      </header>
      {children}
    </section>
  );
}

/** 이미지 + 없으면 이름 꼬리표(PRD 8.1-9) */
export function GoodsImg({ src, name, class: cls }: { src: string; name: string; class?: string }) {
  const [ok, setOk] = useState(true);
  if (!ok) return <span class={`mg-noimg ${cls ?? ''}`.trim()}>{name}</span>;
  return <img class={cls} src={src} alt="" aria-hidden="true" draggable={false} decoding="async" onError={() => setOk(false)} />;
}

/** 그림이 없으면 아예 숨김(상인 등 꾸밈 그림) */
export function OptionalImg({ src, alt, class: cls }: { src: string; alt: string; class?: string }) {
  const [ok, setOk] = useState(true);
  if (!ok) return null;
  return <img class={cls} src={src} alt={alt} draggable={false} decoding="async" onError={() => setOk(false)} />;
}
