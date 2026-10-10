/**
 * 교사 대시보드 T02(작업 109 → 작업 137 개편, PRD 7.5.2 '지금 할 일' 카드와 거의 자동 진행).
 *
 * 배치(PRD 7.5.2.8, 1366×768):
 * - 위쪽 띠 한 줄(≤ 48px): 학급 이름 · 방 코드 · 연결 점 …… [학습지 인쇄 ▾](138 WorksheetPdfMenu) [TV 화면 ▾] [설정]
 * - (저장 공간 오류 빨간 띠)
 * - '지금 할 일' 카드(now-card.ts가 고른 상태 하나 — 한 줄 + 큰 버튼 하나 + [잠깐 멈춤] + 알림 줄 + "TV: ○○")
 * - 진행 줄(무역 시작 뒤): 무역 시간 남음 · 라운드 · 차시 띠 · 다음 항목 · [시간 조절 ▾]
 * - 아래 2단(각자 스크롤): 왼쪽 학생 표, 오른쪽 접힘 영역 5개(시간 조절·오늘 순서·입장 관리·학습지·편지/돌발/공정한 바다).
 *   무역 시작 전에는 오른쪽 맨 위에 방 코드 크게, 마무리 중에는 마무리 순서, 판이 끝나면 결과 안내만.
 * 옛 상단 진행 바 3줄·10초 전 예고 띠·"모두 준비됨" 띠·입장 마감 제안 띠·time-up 창은 카드 상태·알림 줄로 흡수했다.
 * 방을 연 뒤라 방 수 표시와 서버 상태 읽기는 두지 않는다(PRD 7.5.1).
 */
import { lazy, Suspense } from 'preact/compat';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentType } from 'preact';
import { roundNowPlan } from '../core';
import { fx } from '../ui/common/fx';
import type { HostView } from '../sync/host-session';
import type { TeacherActions } from './actions';
import { Fold, useFolds } from './Fold';
import { SCREEN_SCENES, type TeacherGame, type WrapStepStatus } from './game';
import { downloadText, screenConnected } from './host';
import { NowCard } from './NowCard';
import { endRoundConfirm, nextItemOf, nowCard, wrapSteps, type FoldId, type NowButton } from './now-card';
import { FairSeaPanel } from './panels/FairSeaPanel';
import { IncidentPanel } from './panels/IncidentPanel';
import { LettersPanel } from './panels/LettersPanel';
import { WorksheetPanel } from './panels/WorksheetPanel';
import { SettingsModal } from './SettingsModal';
import { StudentDrawer } from './StudentDrawer';
import { StudentTable } from './StudentTable';
import { buildRows, type FilterId, type SortId } from './table';
import { skipWithConfirm, Timeline } from './Timeline';
import {
  itemLabel, mmss, nextRoundText, ROUND_NOW_BLOCK_TEXT, roundNowConfirmBody, roundRemainingSec, shortenDrops, stageBands, startConfirmText, tradeRemainingSec,
} from './schedule-view';
import { SILENT_NOTICES, teacherNoticeText, teacherWarningText } from './notice-text';
import { lessonText, SCENE_CHOICE_TEXT } from './teacher-terms';
import { Dot, DOT, useConfirm, useDismiss } from './ui';
import { WorksheetPdfMenu } from './WorksheetPdfMenu';

// 공용 화면 컴포넌트(작업 110)를 'TV로 보여 주기'(옛 발표 모드)에서 lazy import — 없으면 자리표시
const ScreenApp = lazy(() =>
  import('../screen/index').then(
    (m) => ({ default: m.default as ComponentType<Record<string, unknown>> }),
    () => ({ default: (() => <p class="t-present__empty">공용 화면을 불러오지 못했어요.</p>) as ComponentType<Record<string, unknown>> }),
  ),
);

function useNow(read: () => number, ms = 1000): number {
  const [t, setT] = useState(read);
  useEffect(() => {
    const id = setInterval(() => setT(read()), ms);
    return () => clearInterval(id);
  }, [read, ms]);
  return t;
}

export interface DashboardProps {
  view: HostView<TeacherGame>;
  actions: TeacherActions;
  demo?: boolean;
  /** 판을 닫은 뒤 시작 화면으로 */
  onExit: () => void;
  /** 공용 화면 창 연결 신호(기본: screen-bridge hello — 시험 주입용) */
  screenLinked?: () => boolean;
}

const FOLD_TITLES: Readonly<Record<FoldId, string>> = {
  time: '시간 조절',
  order: '오늘 순서',
  entry: '입장 관리',
  worksheet: '학습지',
  more: '편지·돌발 사건·공정한 바다',
};

function scrollToId(id: string): void {
  if (typeof document === 'undefined') return;
  // 펼친 뒤 다시 그려진 다음에
  setTimeout(() => {
    if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
    document.getElementById(id)?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, 30);
}

export function Dashboard({ view, actions, demo, onExit, screenLinked }: DashboardProps) {
  const game = view.game;
  const now = useNow(actions.now);
  const [confirmNode, ask] = useConfirm();
  const [filter, setFilter] = useState<FilterId>('all');
  const [sort, setSort] = useState<SortId>('seat');
  const [selected, setSelected] = useState<number | null>(null);
  const [present, setPresent] = useState(false);
  const [settings, setSettings] = useState(false);
  const [tvMenu, setTvMenu] = useState(false);
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);
  const [ignored, setIgnored] = useState<Set<string>>(new Set());
  const [lockDismissed, setLockDismissed] = useState(false);
  const [timeUpDismissed, setTimeUpDismissed] = useState<number | null>(null);
  const [customMin, setCustomMin] = useState('');
  const [folds, setFold] = useFolds();
  const tvRef = useRef<HTMLSpanElement>(null);
  useDismiss(tvMenu, tvRef, () => setTvMenu(false));
  const [openedScreen, setOpenedScreen] = useState(false);
  const lastSeen = useRef(new Map<number, number>());
  const prevOnline = useRef(new Map<number, boolean>());
  const toastId = useRef(0);

  const toast = (text: string) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-3), { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  };

  // 마지막 접속 시각(교사 화면이 본 것)
  for (const s of view.seats) {
    const was = prevOnline.current.get(s.seat);
    if (was && !s.online) lastSeen.current.set(s.seat, now);
    prevOnline.current.set(s.seat, s.online);
  }

  // 교사 알림
  const lastTeacher = useRef<unknown>(null);
  const roundNowRef = useRef<((force?: boolean) => Promise<boolean | void>) | null>(null);
  useEffect(() => {
    const t = view.teacher;
    if (!t || t === lastTeacher.current) return;
    lastTeacher.current = t;
    const code = String(t.notice ?? '');
    const action = t.action as { type?: string; id?: string } | undefined;
    if (action?.type === 'bindDeviceToSeat') return; // 세션 전용 행동(103에는 없음)
    if (code === 'NEEDS_CONFIRM' && action?.type === 'skipItem' && action.id && game) {
      const it = game.class.schedule.items.find((x) => x.id === action.id || (x.kind === 'event' && x.refId === action.id));
      if (it) void skipWithConfirm(it, actions, ask);
      return;
    }
    if (code === 'NEEDS_CONFIRM' && action?.type === 'startRoundNow') {
      void roundNowRef.current?.(true);
      return;
    }
    if (SILENT_NOTICES.has(code)) return;
    if (code === 'SCHEDULE_WARNING' && typeof t.message === 'string') return toast(teacherWarningText(t.message));
    // 거절·알림 코드는 한글 문구로만(영어 코드를 화면에 내지 않음 — 작업 132)
    toast(teacherNoticeText(code, t.message));
  }, [view.teacher]);

  const c = game?.class ?? null;
  const started = !!c && c.clock.startedAt !== null;
  const remaining = c ? tradeRemainingSec(c, now) : 0;

  // 남은 5분·1분 경고(소리) — 그대로
  const prevRemain = useRef<number | null>(null);
  useEffect(() => {
    if (!started || !c || c.paused) {
      prevRemain.current = remaining;
      return;
    }
    const p = prevRemain.current;
    if (p !== null && ((p > 300 && remaining <= 300) || (p > 60 && remaining <= 60))) void fx.clockWarn();
    prevRemain.current = remaining;
  }, [Math.floor(remaining)]);

  // 입장 관리: 요청·시도가 새로 생기면 저절로 펼침
  const problems = view.joinProblems.filter((p) => !ignored.has(`${p.peerId}:${p.seat}`));
  const entryBadge = view.rejoinRequests.length + problems.length;
  const prevBadge = useRef(entryBadge);
  useEffect(() => {
    if (entryBadge > prevBadge.current) setFold('entry', true);
    prevBadge.current = entryBadge;
  }, [entryBadge]);

  const rows = useMemo(() => buildRows(game, view, lastSeen.current), [game, view]);

  if (!game || !c) {
    return (
      <main class="t-dash" data-testid="teacher-dashboard">
        <p class="route-loading">판을 불러오는 중…</p>
      </main>
    );
  }

  const code = view.code ?? '';
  const phase = c.phase;
  const ended = view.ended || view.status === 'closed' || phase === 'ended';
  const linked = (screenLinked ?? (() => screenConnected()))() || present;
  const timeUp = c.schedule.timeUp ?? null;
  const card = nowCard(game, view, now, {
    timeUpDismissed: !!timeUp && timeUpDismissed === timeUp.at,
    screenConnected: linked,
    seatProblems: problems.length,
    lockSuggestDismissed: lockDismissed,
  });
  const joined = view.seats.length;
  const readyN = Object.values(game.players).filter((p) => p.game.ready).length;
  const allReady = phase === 'round' && joined > 0 && readyN >= joined;
  const conn = view.connection === 'online' && !view.disconnectedAt ? 'green' : view.connection === 'reconnecting' ? 'yellow' : 'red';
  const connText = conn === 'green' ? '연결 좋음' : conn === 'yellow' ? '다시 연결하는 중' : '연결 끊김';

  const openFold = (id: FoldId) => {
    setFold(id, true);
    scrollToId(`fold-${id}`);
  };
  const openScreenWindow = () => {
    if (typeof window === 'undefined') return;
    const base = `${location.pathname}${location.search}`;
    window.open(`${base}#/screen?room=${code}`, 'voyage-screen');
    setOpenedScreen(true);
    setTvMenu(false);
  };
  const saveResult = async (): Promise<boolean> => {
    const yes = await ask({
      title: '결과 파일을 저장할까요?',
      body: '실명은 들어 있지 않아요. 명렬표와 대조해 쓰세요. (출석번호·회사 이름·지표·상이 JSON·CSV 두 파일로 저장돼요)',
      ok: '저장하기',
      testId: 'confirm-result',
    });
    if (!yes) return false;
    const f = actions.exportResult(game.meta.className);
    if (!f) {
      toast('결과 파일을 만들 수 없어요.');
      return false;
    }
    downloadText(`${f.fileBase}.csv`, f.csv, 'text/csv;charset=utf-8');
    downloadText(`${f.fileBase}.json`, f.json, 'application/json');
    toast('결과 파일을 저장했어요.');
    return true;
  };
  const saveMove = async () => {
    const yes = await ask({
      title: '판 옮기기 파일을 저장할까요?',
      body: '이 파일이 있으면 선생님 권한을 가질 수 있어요. 다른 사람에게 주지 마세요.',
      ok: '저장하기',
      testId: 'confirm-move',
    });
    if (!yes) return;
    const json = actions.exportMoveFile();
    if (!json) return;
    downloadText(`대항해무역왕-판옮기기-${code}.json`, json, 'application/json');
  };
  /** 수업 끝내기(방 닫기) — 확인 2번(PRD 7.5.2.6) */
  const endSession = async (): Promise<boolean> => {
    const a = await ask({ title: '수업을 끝내고 방을 닫을까요?', body: '마무리를 다 했는지 확인해 주세요.', ok: '다음', danger: true, testId: 'confirm-end-1' });
    if (!a) return false;
    const b = await ask({
      title: '정말 방을 닫을까요?',
      body: '학생들은 더 이상 들어오거나 거래할 수 없어요. 결과 파일은 닫은 뒤에도 저장할 수 있어요.',
      ok: '수업 끝내기(방 닫기)',
      danger: true,
      testId: 'confirm-end-2',
    });
    if (!b) return false;
    setSettings(false);
    actions.dispatch({ type: 'endSession' });
    await actions.close();
    return true;
  };
  const startTrade = async (): Promise<boolean> => {
    const yes = await ask({
      title: '무역을 시작할까요?',
      // (작업 134) 먼저 할 활동과 라운드 1까지 시간을 배치표에서 계산해 보인다
      body: startConfirmText(c, game.meta.playUnit, game.meta.scope),
      ok: '무역 시작',
      testId: 'confirm-start',
    });
    if (yes) actions.dispatch({ type: 'startTrade' });
    return yes;
  };
  /**
   * (작업 134) 라운드 지금 시작: 꼭 할 활동이 빠지면 이름을 보이고 확인.
   * (작업 137) seen = 카드 [다음으로](라운드가 바로 다음): 지금 보여 주던 활동을 끝내는 것뿐이면(빠지는 활동·옮기는 학습지 없음) 확인 없이.
   */
  const roundNow = async (force = false, seen = false): Promise<boolean> => {
    const plan = roundNowPlan(c, actions.now());
    if (plan.block) {
      toast(ROUND_NOW_BLOCK_TEXT[plan.block]);
      return false;
    }
    if (seen && plan.needsConfirm && plan.tier1.every((x) => x.live) && plan.movedWorksheets.length === 0) {
      actions.dispatch({ type: 'startRoundNow', confirm: true });
      return true;
    }
    if (plan.needsConfirm || force) {
      if (!plan.needsConfirm) {
        actions.dispatch({ type: 'startRoundNow', confirm: true });
        return true;
      }
      const yes = await ask({
        title: plan.tier1.length ? '꼭 할 활동을 빼고 라운드를 시작할까요?' : '학습지를 끝나고 쓰기로 옮기고 라운드를 시작할까요?',
        body: roundNowConfirmBody(plan),
        ok: '빼고 라운드 시작',
        danger: true,
        testId: 'confirm-round-now',
      });
      if (yes) actions.dispatch({ type: 'startRoundNow', confirm: true });
      return yes;
    }
    actions.dispatch({ type: 'startRoundNow' });
    return true;
  };
  roundNowRef.current = roundNow;
  /** 라운드 끝내기: 남은 시간이 있고 모두 준비가 아니면 확인 1번, 모두 준비면 확인 없음 */
  const endRound = async (): Promise<boolean> => {
    // (수정 1회차) 마지막 라운드면 실제로 일어나는 일(무역을 마치고 마무리로), 라운드에 붙은 결정을 안 한 학생이 있으면 '응답 없음' 안내
    const conf = endRoundConfirm(game, joined, actions.now());
    if (conf.needed) {
      const yes = await ask({ title: conf.title, body: conf.body, ok: '라운드 끝내기', testId: 'confirm-end-round' });
      if (!yes) return false;
    }
    actions.dispatch({ type: 'endRound' });
    return true;
  };
  /** 지금 마무리로(무역 시간이 남았을 때 — 확인 1번) */
  const finishEarly = async (): Promise<boolean> => {
    const left = tradeRemainingSec(c, actions.now());
    if (left >= 1) {
      const rest = nextItemOf(c);
      const yes = await ask({
        title: '지금 마무리로 갈까요?',
        body: rest
          ? `무역 시간이 ${mmss(left)} 남았어요. 지금 마무리로 가면 남은 라운드와 활동은 하지 않아요.`
          : `남은 순서는 없어요. 지금 마무리로 가면 남은 무역 시간(${mmss(left)})은 쓰지 않아요.`,
        ok: '지금 마무리로',
        danger: true,
        testId: 'confirm-finish',
      });
      if (!yes) return false;
    }
    actions.dispatch({ type: 'finishNow' });
    return true;
  };
  /** 무역 시간 줄이기: 활동이 빠지게 되면 이름을 보이는 확인 창(빠지는 것이 없으면 확인 없음) */
  const shorten = async (min: number): Promise<boolean> => {
    const drops = shortenDrops(c, game.meta.playUnit, game.meta.scope, min * 60, actions.now());
    if (drops.length) {
      const yes = await ask({
        title: '무역 시간을 줄일까요?',
        body: `${min}분 줄이면 ${drops.map((d) => `「${d}」`).join('·')}이(가) 빠져요.`,
        ok: '줄이기',
        testId: 'confirm-shorten',
      });
      if (!yes) return false;
    }
    actions.dispatch({ type: 'shorten', sec: min * 60 });
    return true;
  };
  const applyCustom = async (sign: 1 | -1) => {
    const m = Math.round(Number(customMin));
    if (!m || m <= 0) return;
    if (sign > 0) actions.dispatch({ type: 'extend', sec: m * 60 });
    else if (!(await shorten(m))) return;
    setCustomMin('');
  };
  const setWrap = (id: string | undefined, status: WrapStepStatus | null) => id && actions.dispatch({ type: 'setWrapStep', id, status });

  /** 카드 버튼 → 기존 교사 행동 */
  const run = async (b: NowButton): Promise<boolean | void> => {
    switch (b.kind) {
      case 'startTrade':
        return startTrade();
      case 'resume':
        return actions.dispatch({ type: 'resume' });
      case 'pause':
        return actions.dispatch({ type: 'pause' });
      case 'exit':
        return onExit();
      case 'saveResult':
        return saveResult();
      case 'wrapNext':
        setWrap(b.wrapId, 'done');
        setWrap(b.nextWrapId, 'live');
        return;
      case 'wrapSkip':
        setWrap(b.wrapId, 'skipped');
        setWrap(b.nextWrapId, 'live');
        return;
      case 'wrapStart':
        setWrap(b.nextWrapId, 'live');
        return;
      case 'endSession':
        return endSession();
      case 'finishNow':
        return actions.dispatch({ type: 'finishNow' });
      case 'finishEarly':
        return finishEarly();
      case 'dismissTimeUp':
        if (timeUp) setTimeUpDismissed(timeUp.at);
        return;
      case 'endResult':
        return actions.dispatch({ type: 'endResult' });
      case 'closeEvent':
        return actions.dispatch({ type: 'closeEvent', reveal: true });
      case 'reveal':
        return actions.dispatch({ type: 'revealEvent' });
      case 'next': {
        // 다음이 라운드면(자동 진행) 134 '라운드 지금 시작'과 같은 길 — 뒤 항목·라운드에 붙은 결정 패널도 함께 당긴다
        const target = c.schedule.items.find((it) => it.id === b.itemId);
        if (target?.kind === 'round' && c.schedule.mode === 'auto') return roundNow(false, true);
        if (b.itemId) actions.dispatch({ type: 'fireNow', id: b.itemId, clear: true });
        return;
      }
      case 'startItem':
        if (b.itemId) actions.dispatch({ type: 'fireNow', id: b.itemId });
        return;
      case 'closeWorksheet':
        return actions.dispatch({ type: 'closeWorksheet', all: true });
      case 'endRound':
        return endRound();
      case 'roundNow':
        return roundNow();
      case 'lock':
        return actions.setLocked(!view.locked);
      case 'dismissLock':
        return setLockDismissed(true);
      case 'openScreen':
        return openScreenWindow();
      case 'autoScene':
        return actions.dispatch({ type: 'setScreenScene', scene: 'auto' });
      case 'showNoWorksheet':
        setFilter('noWorksheet');
        scrollToId('student-table');
        return;
      case 'showFold':
        if (b.fold) openFold(b.fold);
        return;
    }
  };

  if (present) {
    return (
      <div class="t-present" data-testid="presentation">
        <Suspense fallback={<p class="route-loading">공용 화면을 불러오는 중…</p>}>
          <ScreenApp code={code} embedded />
        </Suspense>
        <button type="button" class="btn btn--secondary t-present__back" data-testid="btn-back-dashboard" onClick={() => setPresent(false)}>
          선생님 화면으로
        </button>
      </div>
    );
  }

  const founded = Object.values(game.players).filter((p) => p.company.founded).length;
  const bands = started ? stageBands(c, game.meta.scope, game.meta.playUnit, now) : [];
  const next = started && !c.tradeEnded ? nextItemOf(c) : null;
  const nextIn = next ? Math.max(0, next.at - (c.clock.durationSec - remaining)) : 0;
  const nextRound = started && !c.tradeEnded ? nextRoundText(c, now) : null;
  const roundLeft = roundRemainingSec(c, now);
  const wrapping = c.tradeEnded && !ended;

  return (
    <main class={`t-dash${started && !ended ? ' t-dash--started' : ''}`} data-testid="teacher-dashboard" data-phase={phase}>
      {/* ── 위쪽 띠(한 줄) ── */}
      <header class="t-top">
        <div class="t-top__row">
          {game.meta.className && <span class="t-top__class">{game.meta.className}</span>}
          <span class="t-code" data-testid="room-code-small">
            방 코드 <b>{code}</b>
          </span>
          <span class="t-conn" data-testid="conn-dot" data-state={conn}>
            <Dot color={DOT[conn]} />
            {connText}
          </span>
          {demo && <span class="t-tag">데모(가짜 데이터)</span>}
          <span class="t-grow" />
          <span class="t-top__pdf">
            <WorksheetPdfMenu variant="menu" label="학습지 인쇄" />
          </span>
          <span class="t-tvmenu" ref={tvRef}>
            <button type="button" class="btn btn--secondary t-btn-sm" data-testid="tv-menu" aria-expanded={tvMenu} onClick={() => setTvMenu((v) => !v)}>
              TV 화면 ▾
            </button>
            {tvMenu && (
              <div class="t-tvmenu__pop" data-testid="tv-menu-list">
                <button type="button" class="btn btn--secondary t-btn-sm" data-testid="btn-open-screen" onClick={openScreenWindow}>
                  공용 화면 창 열기
                </button>
                <label class="t-scene">
                  장면 고르기
                  <select
                    data-testid="scene-select"
                    value={game.screenScene ?? 'auto'}
                    onChange={(e) => actions.dispatch({ type: 'setScreenScene', scene: (e.currentTarget as HTMLSelectElement).value as never })}
                  >
                    {SCREEN_SCENES.map((s) => (
                      <option key={s.id} value={s.id}>
                        {SCENE_CHOICE_TEXT[s.id]}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  class="btn btn--secondary t-btn-sm"
                  data-testid="btn-present"
                  onClick={() => {
                    setTvMenu(false);
                    setPresent(true);
                  }}
                >
                  이 화면을 TV로 보여 주기
                </button>
                {openedScreen && !linked && <p class="t-small">창이 열리면 TV(확장 모니터)로 끌어 F11로 전체 화면을 해요.</p>}
              </div>
            )}
          </span>
          <button type="button" class="btn btn--secondary t-btn-sm" data-testid="btn-settings" onClick={() => setSettings(true)}>
            설정
          </button>
        </div>
      </header>

      {view.storageError && (
        <p class="t-band-red" role="alert" data-testid="storage-error">
          {view.storageError === 'QUOTA'
            ? '이 브라우저의 저장 공간이 모자라 판을 저장하지 못하고 있어요. 새로 고침하면 판을 잃을 수 있어요.'
            : '이 브라우저가 저장을 막고 있어 판을 저장하지 못하고 있어요(시크릿 창이면 일반 창으로). 새로 고침하면 판을 잃을 수 있어요.'}{' '}
          <button type="button" class="btn btn--secondary t-btn-sm" onClick={() => void saveMove()}>
            판 옮기기 파일 저장
          </button>
        </p>
      )}

      {/* ── 지금 할 일 ── */}
      <NowCard card={card} onAction={run} />

      {/* ── 진행 줄 ── */}
      {started && !ended && (
        <div class="t-progress" data-testid="progress-line">
          <span
            class={`t-clock${c.paused ? ' t-clock--paused' : ''}${remaining <= 60 && !c.tradeEnded ? ' t-clock--warn' : ''}${remaining <= 300 && remaining > 60 ? ' t-clock--soon' : ''}`}
            data-testid="trade-clock"
            data-sec={Math.round(remaining)}
          >
            {c.tradeEnded ? (
              <>무역이 끝났어요 · 마무리 중</>
            ) : (
              <>
                무역 시간 <b>{mmss(remaining)}</b> 남음
              </>
            )}
            {c.paused && <span class="t-clock__state">멈춤</span>}
          </span>
          {phase === 'round' && (
            <span class="t-round" data-testid="round-info">
              라운드 {c.round} · {roundLeft !== null ? mmss(roundLeft) : '—'}
            </span>
          )}
          {!c.tradeEnded && <span class="t-stagebar" data-testid="stage-bar" aria-label="차시 띠">
            {bands.map((b) => (
              <span key={b.stage} class={`t-stage${b.current ? ' t-stage--cur' : ''}`} style={{ flex: `${Math.max(0.05, b.ratio)} 1 0` }}>
                <span class="t-stage__fill" style={{ width: `${Math.round(b.progress * 100)}%` }} />
                <span class="t-stage__name">{lessonText(b.stage)}</span>
              </span>
            ))}
          </span>}
          {nextRound && (
            <span class="t-next-round" data-testid="next-round">
              {nextRound}
            </span>
          )}
          {next && !timeUp && (
            <span class="t-progress__next" data-testid="progress-next">
              다음: {itemLabel(next)} · {mmss(nextIn)} 뒤
            </span>
          )}
          <span class="t-grow" />
          {!c.tradeEnded && (
            <button type="button" class="t-mini" data-testid="btn-time-fold" aria-expanded={!!folds.time} onClick={() => (folds.time ? setFold('time', false) : openFold('time'))}>
              시간 조절 ▾
            </button>
          )}
        </div>
      )}

      {ended ? (
        <section class="t-ended" data-testid="ended">
          <h2 class="title-font">결과 안내</h2>
          <p>결과 파일(출석번호·회사 이름·지표·상)은 필요할 때만 저장하세요. 실명은 들어 있지 않아요.</p>
          <div class="t-row">
            <button type="button" class="btn btn--secondary" data-testid="btn-save-result-end" onClick={() => void saveResult()}>
              결과 파일 저장
            </button>
            {view.status !== 'closed' && (
              <button type="button" class="btn t-btn--danger" data-testid="btn-close-room" onClick={() => void actions.close()}>
                방 닫기
              </button>
            )}
          </div>
        </section>
      ) : (
        <div class="t-main">
          <StudentTable rows={rows} filter={filter} sort={sort} onFilter={setFilter} onSort={setSort} onOpen={setSelected} selected={selected} />
          <aside class="t-side" aria-label="진행 관리" data-testid="side-folds">
            {!started && (
              <section class="t-prep" data-testid="prep-panel">
                <p class="t-prep__label">방 코드</p>
                <p class="t-prep__code" data-testid="room-code">
                  {code}
                </p>
                <p class="t-small">
                  들어온 학생 <b>{joined}</b> · 회사 만든 학생 <b>{founded}</b>
                </p>
              </section>
            )}
            {wrapping && <WrapupPanel game={game} actions={actions} />}
            <Fold id="time" title={FOLD_TITLES.time} open={!!folds.time} onToggle={(o) => setFold('time', o)}>
              <TimeFold
                started={started}
                remaining={remaining}
                tradeEnded={c.tradeEnded}
                customMin={customMin}
                onCustomMin={setCustomMin}
                onExtend={(m) => actions.dispatch({ type: 'extend', sec: m * 60 })}
                onShorten={(m) => void shorten(m)}
                onCustom={(s) => void applyCustom(s)}
                onFinish={() => void finishEarly()}
              />
            </Fold>
            <Fold id="order" title={FOLD_TITLES.order} open={!!folds.order} onToggle={(o) => setFold('order', o)}>
              <Timeline game={game} now={now} actions={actions} ask={ask} onRoundNow={() => void roundNow()} />
            </Fold>
            <Fold id="entry" title={FOLD_TITLES.entry} open={!!folds.entry} onToggle={(o) => setFold('entry', o)} badge={entryBadge}>
              <EntryIssues view={view} actions={actions} problems={problems} onIgnore={(k) => setIgnored(new Set([...ignored, k]))} toast={toast} />
            </Fold>
            <Fold id="worksheet" title={FOLD_TITLES.worksheet} open={!!folds.worksheet} onToggle={(o) => setFold('worksheet', o)}>
              <WorksheetPanel game={game} view={view} actions={actions} now={now} />
              <h3 class="t-h4">인쇄용 학습지</h3>
              <WorksheetPdfMenu variant="inline" highlightLesson={game.meta.playUnit === 'lesson' ? game.meta.scope[0] : 'unit'} />
            </Fold>
            <Fold id="more" title={FOLD_TITLES.more} open={!!folds.more} onToggle={(o) => setFold('more', o)}>
              <h3 class="t-h4">편지</h3>
              <LettersPanel game={game} view={view} actions={actions} now={now} />
              <h3 class="t-h4">돌발 사건</h3>
              <IncidentPanel game={game} view={view} actions={actions} now={now} />
              <h3 class="t-h4">공정한 바다</h3>
              <FairSeaPanel game={game} view={view} actions={actions} now={now} />
            </Fold>
          </aside>
        </div>
      )}

      {selected !== null && (
        <StudentDrawer
          seat={selected}
          game={game}
          view={view}
          actions={actions}
          ask={ask}
          toast={toast}
          onClose={() => setSelected(null)}
          onSeatChanged={(s) => setSelected(s)}
        />
      )}
      {settings && (
        <SettingsModal
          game={game}
          actions={actions}
          onClose={() => setSettings(false)}
          onSaveResult={() => void saveResult()}
          onSaveMove={() => void saveMove()}
          onEnd={() => void endSession()}
        />
      )}
      {confirmNode}
      <div class="t-toasts" aria-live="polite" data-testid="toasts">
        {toasts.map((t) => (
          <p key={t.id} class="t-toast">
            {t.text}
          </p>
        ))}
      </div>
    </main>
  );
}

/** '시간 조절' 접힘 영역: 남은 시간, [+1분] [+3분] [+5분] [−1분], 직접 "__분 [늘리기] [줄이기]", [지금 마무리로] */
function TimeFold(p: {
  started: boolean;
  remaining: number;
  tradeEnded: boolean;
  customMin: string;
  onCustomMin: (v: string) => void;
  onExtend: (m: number) => void;
  onShorten: (m: number) => void;
  onCustom: (sign: 1 | -1) => void;
  onFinish: () => void;
}) {
  if (p.tradeEnded) return <p class="t-small">무역 시간이 끝났어요.</p>;
  return (
    <div class="t-timefold" data-testid="time-fold">
      <p>
        남은 무역 시간 <b data-testid="time-left">{mmss(p.remaining)}</b>
        {!p.started && <span class="t-small"> (무역 시작 전 — 정한 시간을 바꿔요)</span>}
      </p>
      <div class="t-seg" role="group" aria-label="무역 시간 바꾸기">
        {[1, 3, 5].map((m) => (
          <button key={m} type="button" class="t-seg__btn" data-testid={`btn-extend-${m}`} onClick={() => p.onExtend(m)}>
            +{m}분
          </button>
        ))}
        <button type="button" class="t-seg__btn" data-testid="btn-shorten-1" onClick={() => p.onShorten(1)}>
          −1분
        </button>
      </div>
      <div class="t-seg t-timefold__custom">
        <input
          class="t-input t-input--num"
          type="number"
          min={1}
          max={60}
          placeholder="분"
          aria-label="직접(분)"
          data-testid="custom-min"
          value={p.customMin}
          onInput={(e) => p.onCustomMin((e.currentTarget as HTMLInputElement).value)}
        />
        분
        <button type="button" class="t-seg__btn" data-testid="btn-custom-extend" onClick={() => p.onCustom(1)} disabled={!p.customMin}>
          늘리기
        </button>
        <button type="button" class="t-seg__btn" data-testid="btn-custom-shorten" onClick={() => p.onCustom(-1)} disabled={!p.customMin}>
          줄이기
        </button>
      </div>
      <p class="t-small">줄여서 활동이 빠지게 되면 빠질 활동을 먼저 알려 드려요. 라운드 길이는 [설정]에서 바꿔요.</p>
      {p.started && (
        <button type="button" class="t-mini" data-testid="btn-finish-early" onClick={p.onFinish}>
          지금 마무리로
        </button>
      )}
    </div>
  );
}

/** '입장 관리' 접힘 영역: [새 학생 그만 받기/다시 받기], 다시 들어오기 요청, 같은 번호 다른 이름 시도, 쓸 수 없는 말로 거절된 수 */
function EntryIssues({
  view,
  actions,
  problems,
  onIgnore,
  toast,
}: {
  view: HostView<TeacherGame>;
  actions: TeacherActions;
  problems: HostView<TeacherGame>['joinProblems'];
  onIgnore: (key: string) => void;
  toast: (t: string) => void;
}) {
  const has = view.rejoinRequests.length + problems.length + view.badNameRejects > 0;
  return (
    <div class="t-issues" id="entry-issues" data-testid="entry-issues" aria-label="입장 관리">
      <p class="t-row">
        <button type="button" class="btn btn--secondary t-btn-sm" data-testid="btn-lock" aria-pressed={view.locked} onClick={() => actions.setLocked(!view.locked)}>
          {view.locked ? '새 학생 다시 받기' : '새 학생 그만 받기'}
        </button>
        <span class="t-small">{view.locked ? '지금은 새 학생을 받지 않아요(들어왔던 학생은 다시 들어올 수 있어요)' : '지금은 새 학생을 받고 있어요'}</span>
      </p>
      {!has && <p class="t-small">처리할 입장 문제가 없어요.</p>}
      <ul class="t-issue-list">
        {view.rejoinRequests.map((r) => (
          <li key={`r${r.peerId}`} data-testid="rejoin-request" data-seat={r.seat}>
            <span>
              {r.seat}번 {r.companyName} — 다른 기기에서 다시 들어오기 요청
              {r.oldOnline && <span class="t-warn-inline"> (지금 접속 중인 기기가 있어요)</span>}
            </span>
            <span class="t-issue-btns">
              <button type="button" class="btn btn--primary t-btn-sm" data-testid="btn-approve" onClick={() => actions.approveRejoin(r.seat) && toast(`${r.seat}번 다시 들어오기를 허락했어요`)}>
                허락
              </button>
              <button type="button" class="btn btn--secondary t-btn-sm" data-testid="btn-deny" onClick={() => actions.denyRejoin(r.seat)}>
                거절
              </button>
            </span>
          </li>
        ))}
        {problems.map((p) => (
          <li key={`p${p.peerId}${p.seat}`} data-testid="seat-problem" data-seat={p.seat}>
            <span>
              {p.seat}번으로 다른 회사 이름 입장 시도 — {p.attempts}회
            </span>
            <span class="t-issue-btns">
              <button
                type="button"
                class="btn btn--primary t-btn-sm"
                data-testid="btn-bind"
                onClick={() =>
                  actions.bindDeviceToSeat(p.peerId, p.seat)
                    ? toast(`이 기기를 ${p.seat}번 회사로 연결했어요. 학생이 [입장]을 다시 누르면 들어와요`)
                    : toast('연결하지 못했어요(이미 다른 회사에 묶인 기기예요)')
                }
              >
                이 기기를 {p.seat}번 회사로 연결
              </button>
              <button type="button" class="btn btn--secondary t-btn-sm" onClick={() => onIgnore(`${p.peerId}:${p.seat}`)}>
                무시
              </button>
            </span>
          </li>
        ))}
      </ul>
      {view.badNameRejects > 0 && (
        <p class="t-small" data-testid="bad-name-count">
          쓸 수 없는 말로 거절된 입장 {view.badNameRejects}번
        </p>
      )}
    </div>
  );
}

/**
 * 마무리 순서(마무리 단계에서 오른쪽 맨 위). 진행은 카드의 [다음으로]가 하고, 여기서는 순서를 보이고 필요하면 항목을 골라 시작·끝·건너뛰기.
 * 첫 항목은 무역 시간이 끝나는 순간 저절로 시작한다(PRD 7.5.2.9 — game.ts autoStartWrap).
 */
function WrapupPanel({ game, actions }: { game: TeacherGame; actions: TeacherActions }) {
  const items = wrapSteps(game.class);
  const wp = game.wrapProgress ?? {};
  const set = (id: string, status: WrapStepStatus | null) => actions.dispatch({ type: 'setWrapStep', id, status });
  return (
    <section class="t-wrap" data-testid="wrapup-panel" aria-label="마무리 순서">
      <h2 class="t-h3">마무리 순서</h2>
      <ol class="t-wrap__list">
        {items.map((w) => {
          const st = wp[w.id];
          return (
            <li key={w.id} data-testid="wrap-item" data-id={w.id} data-status={st ?? 'pending'}>
              <span>
                {w.label}
                {w.optional ? ' (선택)' : ''}
                {st === 'done' && <span class="t-tag">끝</span>}
                {st === 'skipped' && <span class="t-tag">건너뜀</span>}
                {st === 'live' && <span class="t-tag">하는 중</span>}
              </span>
              <span class="t-issue-btns">
                {st === 'live' ? (
                  <button type="button" class="t-mini" onClick={() => set(w.id, 'done')}>
                    끝
                  </button>
                ) : (
                  <button type="button" class="t-mini" disabled={st === 'done'} onClick={() => set(w.id, 'live')}>
                    시작
                  </button>
                )}
                <button type="button" class="t-mini" disabled={st === 'done' || st === 'skipped'} onClick={() => set(w.id, 'skipped')}>
                  건너뛰기
                </button>
              </span>
            </li>
          );
        })}
        {items.length === 0 && <li class="t-small">마무리 항목이 없어요.</li>}
      </ol>
      <p class="t-small" data-testid="wrap-hint">
        카드의 [다음으로]로 차례대로 넘겨요. 시상식은 공용 화면에서 함께 봐요.
      </p>
    </section>
  );
}
