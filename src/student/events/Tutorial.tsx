/**
 * 첫 출항 튜토리얼(작업 111, PRD 4.4 L1-E6, v0.3 4번): 안내 항해사 말풍선이 순서대로 손가락으로 가리킨다.
 * ① 포트헤들랜드를 눌러 목적지로 → ② [출항 준비] → (도착 후) ③ [항구 들어가기] → ④ 천연가스 사기.
 * - 판 범위에 L1이 있을 때만, L1 첫 라운드에 시작한다. [건너뛰기] 가능, 한 번만(이 기기에 기록).
 * - 거래를 막지 않는다: 말풍선과 손가락만 있고 아래 화면은 그대로 누를 수 있다.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { PublicClass } from '../../core';
import { img } from '../../ui/common/asset';
import type { MeView } from '../predict';
import { TUTORIAL_TEXT, tutorialCanStart, tutorialStep, tutorialTarget, type TutorialStep } from './logic';

type Flag = 'started' | 'done' | 'skipped' | null;

const keyOf = (code: string | null, pid: string | null) => `voyage.tutorial.L1-E6.${code ?? ''}.${pid ?? ''}`;

function readFlag(key: string): Flag {
  try {
    const v = localStorage.getItem(key);
    return v === 'started' || v === 'done' || v === 'skipped' ? v : null;
  } catch {
    return null;
  }
}

function writeFlag(key: string, v: Exclude<Flag, null>): void {
  try {
    localStorage.setItem(key, v);
  } catch {
    // 저장소가 막혀도 이 화면이 떠 있는 동안은 기억한다
  }
}

/** 지금 학생 화면이 항구 화면인가 */
function inPortScreen(): boolean {
  return typeof document !== 'undefined' && typeof document.querySelector === 'function' && !!document.querySelector('[data-testid="port-screen"]');
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** 화면 밖(지도를 끌어야 보임) */
  off: boolean;
}

function rectOf(selector: string | null): Rect | null {
  if (!selector || typeof document === 'undefined' || typeof document.querySelector !== 'function') return null;
  const el = document.querySelector(selector);
  if (!el || typeof el.getBoundingClientRect !== 'function') return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 0;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 0;
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  // 하단 바(약 90px) 아래·화면 밖이면 가장자리에 붙이고 "지도를 끌어요" 안내
  const off = vw > 0 && (cx < 0 || cx > vw || cy < 0 || cy > vh - 90);
  if (!off) return { x: r.left, y: r.top, w: r.width, h: r.height, off };
  const x = Math.min(Math.max(cx, 40), vw - 40);
  const y = Math.min(Math.max(cy, 100), vh - 160);
  return { x: x - 1, y: y - 1, w: 2, h: 2, off };
}

export function Tutorial({ me, cls, pid, code }: { me: MeView; cls: PublicClass; pid: string | null; code: string | null }) {
  const key = keyOf(code, pid);
  const [flag, setFlag] = useState<Flag>(() => readFlag(key));
  const [inPort, setInPort] = useState(false);
  const [target, setTarget] = useState<Rect | null>(null);
  // 말풍선이 가리킬 곳(손가락 자리)과 겹치면 위쪽으로 옮긴다
  const [bubbleTop, setBubbleTop] = useState(false);
  const bubbleRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => setFlag(readFlag(key)), [key]);

  // 시작: 조건이 맞을 때 한 번
  const canStart = flag === null && tutorialCanStart(cls, me);
  useEffect(() => {
    if (canStart) {
      writeFlag(key, 'started');
      setFlag('started');
    }
  }, [canStart, key]);

  const active = flag === 'started' && cls.phase !== 'wrapup' && cls.phase !== 'ended';
  const step: TutorialStep = tutorialStep(me, inPort);

  // 화면(항구인지)·손가락 위치를 0.4초마다 다시 본다
  useEffect(() => {
    if (!active) return;
    const tick = () => {
      const p = inPortScreen();
      setInPort(p);
      const r = rectOf(tutorialTarget(tutorialStep(me, p)));
      setTarget(r);
      const b = bubbleRef.current?.getBoundingClientRect?.();
      if (r && b && b.width > 0) {
        // 아래 자리 기준으로 겹침 판단(위로 옮긴 상태여도 아래 자리 높이로 계산)
        const vh = window.innerHeight;
        const bottomTop = vh - 104 - b.height;
        const hit = r.x < b.right + 24 && r.x + r.w > b.left - 24 && r.y + r.h > bottomTop - 24 && r.y < vh - 104 + 24;
        setBubbleTop(hit);
      }
    };
    tick();
    const t = setInterval(tick, 400);
    return () => clearInterval(t);
  }, [active, me]);

  if (!active) return null;
  const finish = (v: 'done' | 'skipped') => {
    writeFlag(key, v);
    setFlag(v);
  };
  const text = step === 'done' ? '잘했어요! 이제 부산으로 가서 천연가스를 팔면 [수입] 도장을 받고 임무를 끝내요.' : TUTORIAL_TEXT[step];
  // 항구 화면에서 지도 단계면 해도로 돌아가라고 덧붙인다
  const hint =
    inPort && (step === 'pickDest' || step === 'ready')
      ? ' 먼저 [해도로 돌아가기]를 눌러요.'
      : target?.off && step === 'pickDest'
        ? ' 지도 오른쪽 아래 [전체 보기]를 누르거나 지도를 끌어서 남쪽(오스트레일리아)을 찾아봐요.'
        : '';


  return (
    <div class="ev-tut" data-testid="tutorial" data-step={step}>
      {target && step !== 'done' && (
        <div
          class="ev-tut__finger"
          aria-hidden="true"
          data-testid="tutorial-finger"
          data-off={target.off ? '1' : '0'}
          style={{ left: `${Math.round(target.x + target.w / 2)}px`, top: `${Math.round(target.y + target.h)}px` }}
        >
          <svg viewBox="0 0 40 48" width="40" height="48">
            <path d="M18 2c2.2 0 4 1.8 4 4v14l2-1c2-.8 4 .4 4.6 2.3l.4 1.3 1-.4c2-.7 4 .5 4.5 2.5l.2.8c1.8-.3 3.6.9 3.9 2.8.7 4.6-.2 9.2-2.8 13l-1.6 2.4c-.6.9-1.6 1.4-2.7 1.4H16c-1 0-2-.5-2.6-1.3L5 32.2c-1.3-1.7-1-4.1.7-5.4 1.5-1.2 3.6-1.1 5 .2L14 30V6c0-2.2 1.8-4 4-4z" fill="#fff8e6" stroke="#2B2318" stroke-width="2" transform="rotate(180 20 24)" />
          </svg>
        </div>
      )}
      <div class={`ev-tut__bubble${inPort ? ' ev-tut__bubble--port' : bubbleTop ? ' ev-tut__bubble--top' : ''}`} role="status" aria-live="polite" data-testid="tutorial-bubble" ref={bubbleRef}>
        <img class="ev-tut__guide" src={img('characters/guide-hanbada.png')} alt="안내 항해사" onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')} />
        <div class="ev-tut__text">
          <p class="ev-tut__kicker">첫 항해 안내</p>
          <p class="ev-tut__msg" data-testid="tutorial-text">
            {text}
            {hint}
          </p>
          <div class="ev-tut__btns">
            {step === 'done' ? (
              <button type="button" class="btn btn--primary" data-testid="tutorial-close" onClick={() => finish('done')}>
                알겠어요
              </button>
            ) : (
              <button type="button" class="btn btn--secondary" data-testid="tutorial-skip" onClick={() => finish('skipped')}>
                건너뛰기
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
