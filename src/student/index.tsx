/**
 * 학생 라우트(#/play) 진입점 — 작업 107.
 * 저장소(store.ts)를 만들고 자동 재입장을 시도한 뒤, 상태에 따라 입장(S02) / 게임 / 전체 화면 안내를 보여 준다.
 * 화면 끼워 넣기 지점은 slots.tsx, 항구 화면 자리는 port/PortScreen.tsx.
 */
import { lazy, Suspense } from 'preact/compat';
import { useEffect, useState } from 'preact/hooks';
import { RotateNotice } from '../ui/common/RotateNotice';
import { EntryScreen } from './EntryScreen';
import { GameScreen, StatusBands } from './GameScreen';
import { StoreContext, useServerNow, useStudentState } from './hooks';
import { FullMessage, Toasts } from './overlays';
import { IN_GAME, openStudentStore, type StudentStore } from './store';
import './student.css';

/** 개발 서버 전용 해도 데모(작업 106): `#/play?demo=map` */
const MapDemo = import.meta.env.DEV ? lazy(() => import('../ui/map/MapDemo')) : null;

function demoParam(): string | null {
  const h = typeof location !== 'undefined' ? location.hash : '';
  const i = h.indexOf('?');
  return i < 0 ? null : new URLSearchParams(h.slice(i + 1)).get('demo');
}

function Booting({ store }: { store: StudentStore }) {
  const st = useStudentState(store);
  const now = useServerNow(store);
  return (
    <main class="st-full st-full--soft" data-testid="student-booting">
      <StatusBands st={st} now={now} />
      <div class="st-full__box">
        <h1 class="title-font">{st.saved?.companyName ? `${st.saved.companyName} 회사로 돌아가는 중이에요` : '들어가는 중이에요'}</h1>
        <p>{st.peer.status === 'hostOffline' ? '선생님 화면이 켜지면 바로 이어서 해요.' : '잠시만 기다려요.'}</p>
      </div>
    </main>
  );
}

export function StudentShell({ store }: { store: StudentStore }) {
  const st = useStudentState(store);
  const p = st.peer;
  let screen;
  if (p.status === 'moved') {
    screen = (
      <FullMessage title="다른 기기로 옮겨졌어요" testId="student-moved">
        <p>선생님이 이 회사를 다른 기기로 옮겼어요. 이 기기에서는 더 할 수 없어요.</p>
      </FullMessage>
    );
  } else if (p.status === 'kicked') {
    screen = (
      <FullMessage title="이번 수업 방에서 나왔어요" testId="student-kicked">
        <p>궁금한 점은 선생님께 말해요.</p>
        <a class="btn btn--secondary" href="#/">
          처음 화면으로
        </a>
      </FullMessage>
    );
  } else if (p.status === 'roomClosed') {
    screen = (
      <FullMessage title="선생님이 이번 판을 끝냈어요" testId="student-room-closed">
        <p>함께 항해해 줘서 고마워요.</p>
        <a class="btn btn--secondary" href="#/">
          처음 화면으로
        </a>
      </FullMessage>
    );
  } else if (IN_GAME.includes(p.status) && p.me) {
    screen = <GameScreen store={store} st={st} />;
  } else if (st.booting) {
    screen = <Booting store={store} />;
  } else {
    screen = <EntryScreen store={store} st={st} />;
  }
  return (
    <StoreContext.Provider value={store}>
      <div class="st-app" data-testid="route-student">
        {screen}
        <Toasts toasts={st.toasts} onDismiss={store.dismissToast} />
      </div>
    </StoreContext.Provider>
  );
}

/** 학생 라우트 진입점(#/play) */
export default function StudentApp() {
  const demo = MapDemo && demoParam() === 'map';
  const [store, setStore] = useState<StudentStore | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (demo) return undefined;
    let alive = true;
    let made: StudentStore | null = null;
    openStudentStore().then(
      (s) => {
        if (!alive) return s.dispose();
        made = s;
        s.autoRejoin();
        setStore(s);
      },
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
      made?.dispose();
    };
  }, []);

  if (demo && MapDemo) {
    return (
      <Suspense fallback={<p class="route-loading">불러오는 중…</p>}>
        <MapDemo />
      </Suspense>
    );
  }
  return (
    <>
      <RotateNotice />
      {failed ? (
        <FullMessage title="연결을 준비하지 못했어요" testId="student-failed">
          <p>새로 고침해 주세요.</p>
        </FullMessage>
      ) : store ? (
        <StudentShell store={store} />
      ) : (
        <p class="route-loading" data-testid="route-student-loading">
          불러오는 중…
        </p>
      )}
    </>
  );
}
