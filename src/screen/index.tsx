/**
 * 공용 화면(TV·프로젝터) 라우트 진입점 `#/screen?room=482137` (작업 110, PRD 7.6).
 *
 * - **읽기 전용**: 같은 브라우저의 호스트 탭(교사 대시보드)이 `screen-bridge`(124, BroadcastChannel)로 보내는 공개 상태만 받는다.
 *   네트워크 구독·쓰기는 하지 않는다. 호스트 탭이 없으면 "선생님 대시보드 창을 열어 주세요".
 * - 발표 모드(109 대시보드): `<ScreenApp code={code} embedded />`로 교사 창 안에 그대로 그린다([대시보드로] 버튼은 109 쪽).
 * - 화면에 나오는 학생 표시는 회사 이름 + 깃발뿐. 출석번호·학생별 자금·응답 여부·미접속 명단·재접속 요청·교사 설정·서버 공지는 없다.
 * - 원격 공용 화면(다른 기기, `&key=`)은 P1 — 지금은 안내만.
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { SCREEN_CHANNEL_PREFIX, subscribeScreen } from '../sync/screen-bridge';
import { parseScreenData, pickScene, shortAddress, type SceneId, type ScreenData } from './model';
import { ForecastBand, IncidentBadge, TradeClockBar } from './parts';
import { CodeScene } from './scenes/CodeScene';
import { SCENE_PICKERS, sceneComponent } from './scenes';
import { AfterWorksheetBand } from './scenes/WorksheetScene';
import './screen.css';

export interface ScreenAppProps {
  /** 방 코드(발표 모드에서 대시보드가 넘김). 없으면 주소의 `room` */
  code?: string;
  /** 교사 창 안(발표 모드) */
  embedded?: boolean;
  children?: ComponentChildren;
}

/** 호스트 탭 소식이 이만큼 없으면 "기다리는 중"(첫 상태) / 연결 끊김 점(이후) */
const FIRST_WAIT_MS = 2500;
const HEARTBEAT_MS = 4000;
const LOST_MS = 12_000;
const CODE_CHANGED_MS = 10_000;
const IDLE_MS = 3000;

/** `#/screen?room=482137&key=…` → 값 */
export function hashParam(hash: string, name: string): string | null {
  const q = hash.split('?')[1];
  if (!q) return null;
  return new URLSearchParams(q).get(name);
}

/** 멈춤 중에도 TV에 그대로 두는 '설명할 수 있는' 장면 */
export const PAUSE_EXPLAIN_SCENES: ReadonlySet<string> = new Set(['cover', 'summary', 'event', 'bars', 'customs', 'worksheet']);

/** '자동'이면 확장 고르기(115~118) → 기본 규칙 */
export function resolveScene(d: ScreenData, now: number): string {
  if (d.choice !== 'auto') return d.choice;
  if (d.cls.paused && d.cls.phase !== 'ended') {
    // (10-22 교사 피드백) [잠깐 멈춤] 중 TV에 설명할 내용(개념 슬라이드·사건 카드·세관 게시판·학습지)이 있으면 '선생님을 보세요' 대신 그 장면을 둔다.
    // 학생 화면은 그대로 '선생님을 보세요'. 설명할 것이 없으면(라운드 중 해도 등) 예전처럼 멈춤 장면.
    const alt = resolveScene({ ...d, cls: { ...d.cls, paused: false } }, now);
    return PAUSE_EXPLAIN_SCENES.has(alt) ? alt : 'pause';
  }
  for (const p of SCENE_PICKERS) {
    const id = p(d, now);
    if (id) return id;
  }
  return pickScene(d, now);
}

function useTick(ms: number): number {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setT(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return t;
}

export default function ScreenApp(props: ScreenAppProps = {}) {
  const hash = typeof location !== 'undefined' ? location.hash : '';
  const startCode = (props.code ?? hashParam(hash, 'room') ?? '').replace(/\D/g, '').slice(0, 6);
  const remoteKey = props.embedded ? null : hashParam(hash, 'key');
  const [code, setCode] = useState(startCode);
  const [data, setData] = useState<ScreenData | null>(null);
  const [closed, setClosed] = useState(false);
  const [changedUntil, setChangedUntil] = useState(0);
  const [lastSeen, setLastSeen] = useState(0);
  const [openedAt] = useState(() => Date.now());
  const [idle, setIdle] = useState(false);
  const orderRef = useRef<string[]>([]);
  // 시각: 기기 시계(local)와 호스트 기준 시각(now = local + 호스트와의 차이). 무역 시계·결과 표시 등 학급 상태 시각은 호스트 시각과 비교한다(작업 111)
  const local = useTick(1000);
  const [offset, setOffset] = useState(0);
  const takeHostNow = (h: unknown) => {
    if (typeof h === 'number' && Number.isFinite(h)) setOffset(h - Date.now());
  };
  const now = local + offset;

  // 공개 상태 받기(screen-bridge). 코드가 바뀌면 다리가 새 채널로 저절로 옮겨 간다
  useEffect(() => {
    setCode(startCode);
    if (!startCode || remoteKey) return;
    return subscribeScreen(startCode, (e) => {
      setLastSeen(Date.now());
      if (e.type === 'clock') takeHostNow(e.hostNow);
      if (e.type === 'state') {
        takeHostNow(e.hostNow);
        const d = parseScreenData(e.publicState, e.classView);
        if (d) {
          for (const c of d.pub.companies) if (!orderRef.current.includes(c.pid)) orderRef.current.push(c.pid);
          setData(d);
          setClosed(false);
        }
      } else if (e.type === 'code.changed') {
        setCode(e.newCode);
        setChangedUntil(Date.now() + CODE_CHANGED_MS);
        if (!props.embedded && typeof history !== 'undefined') {
          try {
            history.replaceState(null, '', `${location.pathname}${location.search}#/screen?room=${e.newCode}`);
          } catch {
            /* 무시 */
          }
        }
      } else if (e.type === 'closed') {
        setClosed(true);
      }
    });
  }, [startCode, remoteKey, props.embedded]);

  // 살아 있는지 보기: 같은 채널에 hello를 보내고, 호스트 탭이 다시 보내는 상태를 듣는다(다리 코드는 그대로)
  useEffect(() => {
    if (!code || remoteKey || typeof BroadcastChannel === 'undefined') return;
    let ch: BroadcastChannel | null = null;
    try {
      ch = new BroadcastChannel(SCREEN_CHANNEL_PREFIX + code);
    } catch {
      return;
    }
    ch.onmessage = (ev: MessageEvent) => {
      const m = ev.data as { t?: string; hostNow?: unknown } | null;
      const t = m?.t;
      if (t === 'state' || t === 'code.changed' || t === 'closed') setLastSeen(Date.now());
      if (t === 'state') takeHostNow(m?.hostNow);
    };
    const id = setInterval(() => ch?.postMessage({ t: 'hello' }), HEARTBEAT_MS);
    return () => {
      clearInterval(id);
      if (ch) {
        ch.onmessage = null;
        ch.close();
      }
    };
  }, [code, remoteKey]);

  // 마우스가 3초 멈추면 커서·[전체 화면] 숨김
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const wake = () => {
      setIdle(false);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), IDLE_MS);
    };
    wake();
    window.addEventListener('mousemove', wake);
    window.addEventListener('pointerdown', wake);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('mousemove', wake);
      window.removeEventListener('pointerdown', wake);
    };
  }, []);

  const address = useMemo(() => shortAddress(typeof location !== 'undefined' ? location.href : ''), []);

  const toggleFullscreen = () => {
    try {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen();
    } catch {
      /* 전체 화면을 못 쓰는 브라우저 */
    }
  };

  const shell = (scene: string, body: ComponentChildren, extra?: ComponentChildren) => (
    <div class={`scr${idle ? ' scr--idle' : ''}${props.embedded ? ' scr--embedded' : ''}`} data-testid="route-screen" data-scene={scene}>
      {body}
      {extra}
      <button type="button" class="scr-fs" data-testid="screen-fullscreen" onClick={toggleFullscreen}>
        전체 화면
      </button>
    </div>
  );

  if (remoteKey) {
    return shell(
      'remote',
      <div class="scr-scene scr-wait" data-testid="scene-wait">
        <h1 class="scr-h1">공용 화면</h1>
        <p class="scr-lead">다른 기기에서 여는 공용 화면은 곧 열려요. 선생님 컴퓨터에서 [공용 화면 창 열기]를 눌러 주세요.</p>
      </div>,
    );
  }

  if (!data) {
    const waitingLong = !code || local - openedAt > FIRST_WAIT_MS;
    return shell(
      'wait',
      <div class="scr-scene scr-wait" data-testid="scene-wait">
        <h1 class="scr-h1">공용 화면</h1>
        <p class="scr-lead" data-testid="wait-text">
          {waitingLong ? '선생님 대시보드 창을 열어 주세요' : '선생님 화면과 연결하는 중이에요…'}
        </p>
        {waitingLong && <p class="scr-small">같은 컴퓨터, 같은 브라우저에서 선생님 대시보드를 열고 [공용 화면 창 열기]를 누르면 연결돼요.</p>}
      </div>,
    );
  }

  const lost = local - lastSeen > LOST_MS;
  const showChanged = local < changedUntil;
  const sceneId = closed ? 'ended' : resolveScene(data, now);
  const Scene = sceneComponent(sceneId);
  const sceneProps = { d: data, now, code, address, joinOrder: orderRef.current };
  const hideClock = sceneId === 'black' || showChanged;

  return shell(
    sceneId,
    <>
      <div class="scr-stage" key={sceneId}>
        <Scene {...sceneProps} />
      </div>
      {!hideClock && (
        <div class="scr-top">
          <TradeClockBar d={data} now={now} />
          <IncidentBadge d={data} />
        </div>
      )}
      {sceneId !== 'black' && <ForecastBand d={data} />}
      {/* (작업 112) 마무리 단계: 결산 순위판·해도 위에 '끝나고 쓰기' 번호 띠(시상·끝 장면은 자기 목록이 있음) */}
      {!showChanged && <AfterWorksheetBand d={data} sceneId={sceneId} />}
      {showChanged && (
        <div class="scr-overlay" data-testid="code-changed-overlay">
          <CodeScene {...sceneProps} changed />
        </div>
      )}
    </>,
    lost && <span class="scr-conn" data-testid="screen-conn" data-state="lost" role="img" aria-label="선생님 화면과 연결이 끊겼어요" title="선생님 화면과 연결이 끊겼어요" />,
  );
}

export type { SceneId };
