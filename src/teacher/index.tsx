/**
 * 교사 라우트(#/teacher) — 작업 109. 이 페이지가 판의 **호스트**다(124 세션 + 103·123 리듀서, 교사 localStorage 저장).
 *
 * 화면: T01 시작(StartScreen) → 판 설정(SetupScreen, "사용 중인 방" 30초 읽기) → 대시보드(Dashboard, 방 수 읽기 없음).
 * - 새로 고침: 이 탭에서 연 판(sessionStorage 표시)이 저장돼 있으면 자동 [이어하기](124 resume — 끊긴 시간은 일시정지 처리).
 * - 새 탭·브라우저 다시 열기: 시작 화면에 [이어하기]를 크게.
 * - 개발 서버 `?demo=30`: 학생 30명 가짜 데이터 대시보드(세션 없음).
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { errorToKorean } from '@shared/protocol';
import type { SchedulePreview } from '../core';
import { syncMode } from '../config/deploy';
import { LOADING_STATUS, sharedServerRooms, type RoomStatus, type ServerRoomsStore } from '../ui/common/server-status';
import type { HostView } from '../sync/host-session';
import { demoActions, sessionActions, type TeacherActions } from './actions';
import { Dashboard } from './Dashboard';
import { newTeacherGame, type TeacherGame } from './game';
import { activeTabCode, createTeacherHost, markActiveTab, teacherStore, type TeacherHost } from './host';
import { SetupScreen, type OpenError } from './SetupScreen';
import { lessonPartOf, loadPrefs, savePrefs, scopeOf, voyageModeOf, type SetupValues } from './setup';
import { resumeInfoOf, StartScreen, type ResumeInfo } from './StartScreen';
import './teacher.css';

function hashParam(name: string): string | null {
  if (typeof location === 'undefined') return null;
  const h = location.hash;
  const i = h.indexOf('?');
  const fromHash = i < 0 ? null : new URLSearchParams(h.slice(i + 1)).get(name);
  return fromHash ?? new URLSearchParams(location.search).get(name);
}

/** 사용 중인 방 상태(판 설정 화면에서만 — 언마운트되면 주기 읽기도 멈춤) */
export function useRoomsFrom(store: ServerRoomsStore, poll: boolean): { status: RoomStatus; refresh: () => void } {
  const [status, setStatus] = useState<RoomStatus>(() => (syncMode() === 'relay' ? LOADING_STATUS : { kind: 'local' }));
  useEffect(() => store.subscribe(setStatus, { poll }), [store, poll]);
  return { status, refresh: () => void store.refresh() };
}

export interface SetupContainerProps {
  values: SetupValues;
  onChange: (v: SetupValues) => void;
  opening: boolean;
  openError: OpenError | null;
  onOpen: (v: SetupValues, p: SchedulePreview, rooms: { status: RoomStatus; refresh: () => void }) => void;
  onBack: () => void;
  roomsStore?: ServerRoomsStore;
  prefsStorage?: Pick<Storage, 'getItem' | 'setItem'> | null;
}

/** 판 설정 + 방 수 상태(화면에서 한 번만 만들어 RoomCount·RoomFullNotice·[방 열기]가 같이 씀) */
export function SetupContainer(p: SetupContainerProps) {
  const rooms = useRoomsFrom(p.roomsStore ?? sharedServerRooms(), true);
  return (
    <SetupScreen
      values={p.values}
      onChange={p.onChange}
      rooms={rooms}
      opening={p.opening}
      openError={p.openError}
      onOpen={(v, pv) => p.onOpen(v, pv, rooms)}
      onBack={p.onBack}
      prefsStorage={p.prefsStorage}
    />
  );
}

type Screen = 'start' | 'setup' | 'dash' | 'demo' | 'loading';

/** 교사 라우트 공통 래퍼(시작·설정·대시보드 모두) — smoke e2e가 `route-teacher`를 찾는다 */
export default function TeacherApp() {
  return (
    <div class="t-route" data-testid="route-teacher">
      <TeacherScreens />
    </div>
  );
}

function TeacherScreens() {
  const [screen, setScreen] = useState<Screen>('loading');
  const [values, setValues] = useState<SetupValues>(() => loadPrefs());
  const [view, setView] = useState<HostView<TeacherGame> | null>(null);
  const [actions, setActions] = useState<TeacherActions | null>(null);
  const [resumeInfo, setResumeInfo] = useState<ResumeInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<OpenError | null>(null);
  const hostRef = useRef<TeacherHost | null>(null);
  const unsubs = useRef<(() => void)[]>([]);

  const readResume = () => {
    const store = teacherStore();
    try {
      store.purgeExpired();
    } catch {
      /* 무시 */
    }
    const info = resumeInfoOf(store.loadLast());
    setResumeInfo(info);
    return info;
  };

  const ensureHost = async (): Promise<TeacherHost> => {
    if (hostRef.current) return hostRef.current;
    const h = await createTeacherHost();
    hostRef.current = h;
    let lastCode: string | null = null;
    unsubs.current.push(
      h.session.subscribe((v) => {
        setView(v);
        if (v.code && v.code !== lastCode && v.status === 'open') {
          lastCode = v.code;
          markActiveTab(v.code);
          if (v.game && v.game.meta.code !== v.code) h.session.dispatchTeacher({ type: 'setRoomCode', code: v.code });
        }
        if (v.status === 'closed') markActiveTab(null);
      }),
      h.session.installBeforeUnload(),
    );
    setActions(sessionActions(h.session, h.now));
    return h;
  };

  const doResume = async (code?: string) => {
    setBusy(true);
    setStartError(null);
    try {
      const h = await ensureHost();
      const r = await h.session.resume(code);
      if (r.ok) {
        markActiveTab(r.code);
        setScreen('dash');
      } else {
        setStartError(r.text);
        setScreen('start');
      }
    } finally {
      setBusy(false);
    }
  };

  const doImport = async (json: string) => {
    setBusy(true);
    setStartError(null);
    try {
      const h = await ensureHost();
      const r = await h.session.importMoveFile(json);
      if (r.ok) {
        markActiveTab(r.code);
        setScreen('dash');
      } else setStartError(r.text);
    } finally {
      setBusy(false);
    }
  };

  const doOpen = async (v: SetupValues, _p: SchedulePreview, rooms: { status: RoomStatus; refresh: () => void }) => {
    const scope = scopeOf(v);
    if (!v.playUnit || !scope) return;
    setOpening(true);
    setOpenError(null);
    try {
      const h = await ensureHost();
      const seed = Math.floor(Math.random() * 0x7fffffff);
      const game = newTeacherGame({
        className: v.className.trim(),
        playUnit: v.playUnit,
        scope,
        tradeMinutes: v.tradeMinutes,
        settings: {
          activityRatio: v.activityRatio,
          worksheetMode: v.worksheetMode,
          incidentFreq: v.incidentFreq,
          comeback: v.comeback,
          leaderboardTopN: v.leaderboardTopN,
          progressMode: v.progressMode,
          // (작업 151) 항해 방식(1·2차시 차시 판 기본 '자유롭게')
          voyageMode: voyageModeOf(v),
          // (작업 154) 2차시 나눠 고르기(2차시 차시 판이 아니면 'all')
          lessonPart: lessonPartOf(v),
        },
        overrides: v.overrides,
        seed,
        now: h.now(),
      });
      const r = await h.session.open({ game });
      if (r.ok) {
        h.session.dispatchTeacher({ type: 'setRoomCode', code: r.code });
        markActiveTab(r.code);
        savePrefs(v);
        setScreen('dash');
      } else {
        const text =
          r.error === 'BUSY' && rooms.status.maxRooms
            ? errorToKorean('BUSY', { rooms: rooms.status.maxRooms, maxRooms: rooms.status.maxRooms })
            : r.text;
        setOpenError({ code: r.error, text });
        // 서버가 가득 참·점검으로 답하면 방 수 표시를 바로 다시 읽는다(PRD 7.5.1)
        if (r.error === 'BUSY' || r.error === 'MAINTENANCE') rooms.refresh();
      }
    } finally {
      setOpening(false);
    }
  };

  useEffect(() => {
    let alive = true;
    const demo = hashParam('demo');
    if (import.meta.env.DEV && demo && /^\d+$/.test(demo)) {
      void import('./demo').then((m) => {
        if (!alive) return;
        const d = m.makeDemo(Number(demo));
        setView(d.view);
        setActions(demoActions());
        setScreen('demo');
      });
      return () => {
        alive = false;
      };
    }
    const info = readResume();
    const tab = activeTabCode();
    if (tab && info && info.code === tab && !info.ended) void doResume(tab);
    else setScreen('start');
    return () => {
      alive = false;
    };
  }, []);

  // 세션은 시계 틱으로 바뀐 게임 상태를 알리지 않으므로(출력이 공개 상태뿐인 틱), 1초마다 바뀐 게임이 있으면 화면을 갱신한다
  useEffect(() => {
    if (screen !== 'dash') return undefined;
    const id = setInterval(() => {
      const h = hostRef.current;
      if (!h) return;
      const v = h.session.getView();
      setView((prev) => (prev && prev.game === v.game && prev.status === v.status && prev.connection === v.connection ? prev : v));
    }, 1000);
    return () => clearInterval(id);
  }, [screen]);

  useEffect(
    () => () => {
      for (const u of unsubs.current.splice(0)) u();
      hostRef.current?.session.dispose();
    },
    [],
  );

  if (screen === 'loading') return <p class="route-loading">불러오는 중…</p>;
  if (screen === 'start') {
    return (
      <StartScreen
        resume={resumeInfo}
        busy={busy}
        error={startError}
        onNew={() => {
          setOpenError(null);
          setScreen('setup');
        }}
        onResume={() => void doResume(resumeInfo?.code)}
        onImport={(json) => void doImport(json)}
      />
    );
  }
  if (screen === 'setup') {
    return (
      <SetupContainer
        values={values}
        onChange={setValues}
        opening={opening}
        openError={openError}
        onOpen={(v, p, rooms) => void doOpen(v, p, rooms)}
        onBack={() => {
          readResume();
          setScreen('start');
        }}
      />
    );
  }
  if (!view || !actions) return <p class="route-loading">판을 불러오는 중…</p>;
  return (
    <Dashboard
      view={view}
      actions={actions}
      demo={screen === 'demo'}
      onExit={() => {
        markActiveTab(null);
        readResume();
        setScreen('start');
      }}
    />
  );
}
