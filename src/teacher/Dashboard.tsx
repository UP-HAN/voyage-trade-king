/**
 * 교사 대시보드 T02(작업 109, PRD 7.5): 상단 진행 바(무역 시계·구간 띠·라운드·준비 수·연결 점·공용 화면 제어),
 * 알림 띠(방 코드 바뀜·저장 실패·연결 끊김·예고·모두 준비됨·입장 마감 제안), 학생 표 + 오른쪽(준비/타임라인/입장 문제/패널/마무리),
 * 학생 상세 서랍, 설정, 발표 모드. 방을 연 뒤라 방 수 표시와 서버 상태 읽기는 두지 않는다(PRD 7.5.1).
 */
import { lazy, Suspense } from 'preact/compat';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentType } from 'preact';
import { roundNowPlan, type ScheduleItem } from '../core';
import { fx } from '../ui/common/fx';
import type { HostView } from '../sync/host-session';
import type { TeacherActions } from './actions';
import { SCREEN_SCENES, type TeacherGame, type WrapStepStatus } from './game';
import { downloadText } from './host';
import { FairSeaPanel } from './panels/FairSeaPanel';
import { IncidentPanel } from './panels/IncidentPanel';
import { LettersPanel } from './panels/LettersPanel';
import { WorksheetPanel } from './panels/WorksheetPanel';
import { SettingsModal } from './SettingsModal';
import { StudentDrawer } from './StudentDrawer';
import { StudentTable } from './StudentTable';
import { buildRows, type FilterId, type SortId } from './table';
import { skipWithConfirm, TierMark, Timeline } from './Timeline';
import {
  itemLabel, mmss, nextRoundText, ROUND_NOW_BLOCK_TEXT, roundNowConfirmBody, roundRemainingSec, stageBands, startConfirmText, tradeRemainingSec,
} from './schedule-view';
import { SILENT_NOTICES, teacherNoticeText } from './notice-text';
import { Dot, DOT, Modal, useConfirm } from './ui';

// 공용 화면 컴포넌트(작업 110)를 발표 모드에서 lazy import — 없으면 자리표시
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
}

export function Dashboard({ view, actions, demo, onExit }: DashboardProps) {
  const game = view.game;
  const now = useNow(actions.now);
  const [confirmNode, ask] = useConfirm();
  const [filter, setFilter] = useState<FilterId>('all');
  const [sort, setSort] = useState<SortId>('seat');
  const [selected, setSelected] = useState<number | null>(null);
  const [present, setPresent] = useState(false);
  const [settings, setSettings] = useState(false);
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);
  const [ignored, setIgnored] = useState<Set<string>>(new Set());
  const [lockDismissed, setLockDismissed] = useState(false);
  const [timeUpDismissed, setTimeUpDismissed] = useState<number | null>(null);
  const [customMin, setCustomMin] = useState('');
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
  const roundNowRef = useRef<((force?: boolean) => Promise<void>) | null>(null);
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
    if (code === 'SCHEDULE_WARNING' && typeof t.message === 'string') return toast(t.message);
    // 거절·알림 코드는 한글 문구로만(영어 코드를 화면에 내지 않음 — 작업 132)
    toast(teacherNoticeText(code, t.message));
  }, [view.teacher]);

  const c = game?.class ?? null;
  const started = !!c && c.clock.startedAt !== null;
  const remaining = c ? tradeRemainingSec(c, now) : 0;

  // 남은 5분·1분 경고
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

  const rows = useMemo(() => buildRows(game, view, lastSeen.current), [game, view]);

  if (!game || !c) {
    return (
      <main class="t-dash" data-testid="teacher-dashboard">
        <p class="route-loading">판을 불러오는 중…</p>
      </main>
    );
  }

  const code = view.code ?? '';
  const scope = game.meta.scope;
  const phase = c.phase;
  const ended = view.ended || view.status === 'closed' || phase === 'ended';
  const pub = { joined: view.seats.length, ready: Object.values(game.players).filter((p) => p.game.ready).length };
  const roundLeft = roundRemainingSec(c, now);
  const bands = started ? stageBands(c, scope, game.meta.playUnit, now) : [];
  const elapsed = started ? c.clock.durationSec - remaining : 0;
  const allReady = phase === 'round' && pub.joined > 0 && pub.ready >= pub.joined;
  const upcomingId = c.schedule.mode === 'auto' ? (c.schedule.upcoming ?? [])[0] : undefined;
  const upcoming: ScheduleItem | undefined = upcomingId ? c.schedule.items.find((it) => it.id === upcomingId && it.status === 'pending') : undefined;
  const timeUp = c.schedule.timeUp ?? null;
  const showTimeUp = !!timeUp && !c.tradeEnded && timeUpDismissed !== timeUp.at;
  const suggestLock = started && !view.locked && !lockDismissed && elapsed >= 300 && !c.tradeEnded;
  const problems = view.joinProblems.filter((p) => !ignored.has(`${p.peerId}:${p.seat}`));
  const badge = view.rejoinRequests.length + problems.length;
  const conn = view.connection === 'online' && !view.disconnectedAt ? 'green' : view.connection === 'reconnecting' ? 'yellow' : 'red';
  const connText = conn === 'green' ? '서버 연결 좋음' : conn === 'yellow' ? '다시 연결하는 중' : '서버 연결 끊김';

  const openScreenWindow = () => {
    if (typeof window === 'undefined') return;
    const base = `${location.pathname}${location.search}`;
    window.open(`${base}#/screen?room=${code}`, 'voyage-screen');
  };
  const saveResult = async () => {
    const yes = await ask({
      title: '결과 파일 저장',
      body: '실명은 들어 있지 않아요. 명렬표와 대조해 쓰세요. (출석번호·회사 이름·지표·상이 JSON·CSV 두 파일로 저장돼요)',
      ok: '저장',
      testId: 'confirm-result',
    });
    if (!yes) return;
    const f = actions.exportResult(game.meta.className);
    if (!f) return toast('결과 파일을 만들 수 없어요.');
    downloadText(`${f.fileBase}.csv`, f.csv, 'text/csv;charset=utf-8');
    downloadText(`${f.fileBase}.json`, f.json, 'application/json');
    toast('결과 파일을 저장했어요.');
  };
  const saveMove = async () => {
    const yes = await ask({
      title: '판 옮기기 파일 저장',
      body: '이 파일이 있으면 선생님 권한을 가질 수 있어요. 다른 사람에게 주지 마세요.',
      ok: '저장',
      testId: 'confirm-move',
    });
    if (!yes) return;
    const json = actions.exportMoveFile();
    if (!json) return;
    downloadText(`대항해무역왕-판옮기기-${code}.json`, json, 'application/json');
  };
  const endSession = async () => {
    const a = await ask({ title: '판 끝내기', body: '판을 끝내고 방을 닫을까요?', ok: '다음', danger: true, testId: 'confirm-end-1' });
    if (!a) return;
    const b = await ask({
      title: '정말 방을 닫을까요?',
      body: '학생들은 더 이상 들어오거나 거래할 수 없어요. 결과 파일은 닫은 뒤에도 저장할 수 있어요.',
      ok: '판 끝내기·방 닫기',
      danger: true,
      testId: 'confirm-end-2',
    });
    if (!b) return;
    setSettings(false);
    actions.dispatch({ type: 'endSession' });
    await actions.close();
  };
  const startTrade = async () => {
    const yes = await ask({
      title: '무역 시작',
      // (작업 134) 먼저 할 활동과 라운드 1까지 시간을 배치표에서 계산해 보인다
      body: startConfirmText(c, game.meta.playUnit, game.meta.scope),
      ok: '무역 시작',
      testId: 'confirm-start',
    });
    if (yes) actions.dispatch({ type: 'startTrade' });
  };
  /** (작업 134) [지금 라운드 시작]: 1등급 활동이 빠지면 이름을 보이고 확인 */
  const roundNow = async (force = false) => {
    const plan = roundNowPlan(c, actions.now());
    if (plan.block) return toast(ROUND_NOW_BLOCK_TEXT[plan.block]);
    if (plan.needsConfirm || force) {
      if (!plan.needsConfirm) return actions.dispatch({ type: 'startRoundNow', confirm: true });
      const yes = await ask({
        title: plan.tier1.length ? '핵심 활동을 건너뛰고 라운드 시작' : '학습지를 끝나고 쓰기로 옮기고 라운드 시작',
        body: roundNowConfirmBody(plan),
        ok: '건너뛰고 라운드 시작',
        danger: true,
        testId: 'confirm-round-now',
      });
      if (yes) actions.dispatch({ type: 'startRoundNow', confirm: true });
      return;
    }
    actions.dispatch({ type: 'startRoundNow' });
  };
  roundNowRef.current = roundNow;
  const applyCustom = (sign: 1 | -1) => {
    const m = Math.round(Number(customMin));
    if (!m || m <= 0) return;
    actions.dispatch(sign > 0 ? { type: 'extend', sec: m * 60 } : { type: 'shorten', sec: m * 60 });
    setCustomMin('');
  };

  if (present) {
    return (
      <div class="t-present" data-testid="presentation">
        <Suspense fallback={<p class="route-loading">공용 화면을 불러오는 중…</p>}>
          <ScreenApp code={code} embedded />
        </Suspense>
        <button type="button" class="btn btn--secondary t-present__back" data-testid="btn-back-dashboard" onClick={() => setPresent(false)}>
          대시보드로
        </button>
      </div>
    );
  }

  const founded = Object.values(game.players).filter((p) => p.company.founded).length;

  return (
    <main class="t-dash" data-testid="teacher-dashboard" data-phase={phase}>
      {/* ── 상단 진행 바 1: 방·연결·공용 화면 ── */}
      <header class="t-top">
        <div class="t-top__row">
          <span class="t-code" data-testid="room-code-small">
            방 코드 <b>{code}</b>
          </span>
          <span class="t-conn" data-testid="conn-dot" data-state={conn}>
            <Dot color={DOT[conn]} />
            {connText}
          </span>
          {game.meta.className && <span class="t-small">{game.meta.className}</span>}
          {demo && <span class="t-tag">데모(가짜 데이터)</span>}
          <span class="t-grow" />
          {badge > 0 && (
            <a class="t-badge" href="#entry-issues" data-testid="issue-badge">
              입장 문제 {badge}
            </a>
          )}
          <button type="button" class="btn btn--secondary t-btn-sm" data-testid="btn-open-screen" onClick={openScreenWindow}>
            공용 화면 창 열기
          </button>
          <label class="t-scene">
            공용 화면
            <select
              data-testid="scene-select"
              value={game.screenScene ?? 'auto'}
              onChange={(e) => actions.dispatch({ type: 'setScreenScene', scene: (e.currentTarget as HTMLSelectElement).value as never })}
            >
              {SCREEN_SCENES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" class="btn btn--secondary t-btn-sm" data-testid="btn-present" onClick={() => setPresent(true)}>
            발표 모드
          </button>
          <button type="button" class="btn btn--secondary t-btn-sm" data-testid="btn-settings" onClick={() => setSettings(true)}>
            설정
          </button>
        </div>
        {/* ── 상단 진행 바 2: 무역 시계·라운드·준비 수·구간 띠 ── */}
        {started && !ended && (
          <div class="t-top__row t-top__row--clock">
            <span class={`t-clock${c.paused ? ' t-clock--paused' : ''}${remaining <= 60 ? ' t-clock--warn' : ''}`} data-testid="trade-clock" data-sec={Math.round(remaining)}>
              {mmss(remaining)}
              {c.paused && <span class="t-clock__state">멈춤</span>}
            </span>
            {c.paused ? (
              <button type="button" class="btn btn--primary t-btn-sm" data-testid="btn-resume-trade" onClick={() => actions.dispatch({ type: 'resume' })}>
                이어서 하기
              </button>
            ) : (
              <button type="button" class="btn btn--primary t-btn-sm" data-testid="btn-pause" onClick={() => actions.dispatch({ type: 'pause' })}>
                일시정지
              </button>
            )}
            <span class="t-seg" role="group" aria-label="무역 시간 바꾸기">
              {[1, 3, 5].map((m) => (
                <button key={m} type="button" class="t-seg__btn" data-testid={`btn-extend-${m}`} onClick={() => actions.dispatch({ type: 'extend', sec: m * 60 })}>
                  +{m}
                </button>
              ))}
              <button type="button" class="t-seg__btn" data-testid="btn-shorten-1" onClick={() => actions.dispatch({ type: 'shorten', sec: 60 })}>
                −1
              </button>
              <input
                class="t-input t-input--num"
                type="number"
                min={1}
                max={60}
                placeholder="분"
                aria-label="직접(분)"
                data-testid="custom-min"
                value={customMin}
                onInput={(e) => setCustomMin((e.currentTarget as HTMLInputElement).value)}
              />
              <button type="button" class="t-seg__btn" onClick={() => applyCustom(1)} disabled={!customMin}>
                직접 +
              </button>
              <button type="button" class="t-seg__btn" onClick={() => applyCustom(-1)} disabled={!customMin}>
                직접 −
              </button>
            </span>
            {phase === 'round' && (
              <span class="t-round" data-testid="round-info">
                라운드 {c.round} · {roundLeft !== null ? mmss(roundLeft) : '—'}
                <button type="button" class="btn btn--secondary t-btn-sm" data-testid="btn-end-round" onClick={() => actions.dispatch({ type: 'endRound' })}>
                  라운드 끝
                </button>
              </span>
            )}
            <span class="t-ready" data-testid="ready-count">
              출항 준비 {pub.ready}/{pub.joined}
            </span>
          </div>
        )}
        {started && !ended && !c.tradeEnded && <NextRoundBar game={game} now={now} onRoundNow={() => void roundNow()} actions={actions} />}
        {started && !ended && (
          <div class="t-stagebar" data-testid="stage-bar" aria-label="구간 띠">
            {bands.map((b) => (
              <div key={b.stage} class={`t-stage${b.current ? ' t-stage--cur' : ''}`} style={{ flex: `${Math.max(0.05, b.ratio)} 1 0` }}>
                <span class="t-stage__fill" style={{ width: `${Math.round(b.progress * 100)}%` }} />
                <span class="t-stage__name">{b.label}</span>
              </div>
            ))}
          </div>
        )}
      </header>

      {/* ── 알림 띠 ── */}
      <div class="t-banners">
        {view.codeChanged && (
          <p class="t-band-red" role="alert" data-testid="code-changed">
            방 코드가 바뀌었어요: <b>{view.codeChanged.to}</b> — 공용 화면에도 크게 나와요
          </p>
        )}
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
        {view.status === 'replaced' && (
          <p class="t-band-red" role="alert" data-testid="replaced">
            다른 탭이나 PC에서 이 판을 이어 가고 있어요. 이 탭은 멈췄어요.
          </p>
        )}
        {(view.status === 'reconnecting' || view.status === 'offline') && (
          <p class="t-band-yellow" role="status" data-testid="disconnected">
            서버 연결이 끊겨 다시 연결하고 있어요. 끊긴 시간은 일시정지로 처리돼 학생 시간이 줄지 않아요.
          </p>
        )}
        {upcoming && (
          <p class="t-band-info" data-testid="upcoming">
            10초 뒤: <b>{itemLabel(upcoming)}</b>
            <button type="button" class="t-mini" data-testid="upcoming-now" onClick={() => actions.dispatch({ type: 'fireNow', id: upcoming.id })}>
              지금
            </button>
            <button type="button" class="t-mini" data-testid="upcoming-postpone" onClick={() => actions.dispatch({ type: 'postpone', id: upcoming.id })}>
              1분 미루기
            </button>
            <button type="button" class="t-mini" data-testid="upcoming-skip" onClick={() => void skipWithConfirm(upcoming, actions, ask)}>
              건너뛰기
            </button>
          </p>
        )}
        {allReady && (
          <p class="t-band-info" data-testid="all-ready">
            모두 준비됨 — 라운드를 끝낼까요?
            <button type="button" class="t-mini" onClick={() => actions.dispatch({ type: 'endRound' })}>
              라운드 끝
            </button>
          </p>
        )}
        {suggestLock && (
          <p class="t-band-info" data-testid="lock-suggest">
            무역을 시작한 지 5분이 지났어요. 입장을 마감할까요?
            <button type="button" class="t-mini" data-testid="lock-yes" onClick={() => actions.setLocked(true)}>
              마감
            </button>
            <button type="button" class="t-mini" onClick={() => setLockDismissed(true)}>
              계속 받기
            </button>
          </p>
        )}
      </div>

      {ended ? (
        <section class="t-ended" data-testid="ended">
          <h2 class="title-font">판이 끝났어요</h2>
          <p>결과 파일은 필요할 때만 저장하세요. 이 브라우저의 기록은 24시간 뒤 자동으로 지워져요.</p>
          <div class="t-row">
            <button type="button" class="btn btn--primary" data-testid="btn-save-result-end" onClick={() => void saveResult()}>
              결과 파일 저장
            </button>
            {view.status !== 'closed' && (
              <button type="button" class="btn t-btn--danger" data-testid="btn-close-room" onClick={() => void actions.close()}>
                방 닫기
              </button>
            )}
            <button type="button" class="btn btn--secondary" data-testid="btn-exit" onClick={onExit}>
              처음으로
            </button>
          </div>
        </section>
      ) : (
        <div class="t-main">
          <StudentTable rows={rows} filter={filter} sort={sort} onFilter={setFilter} onSort={setSort} onOpen={setSelected} selected={selected} />
          <aside class="t-side" aria-label="진행 관리">
            {!started && (
              <section class="t-prep" data-testid="prep-panel">
                <p class="t-prep__label">방 코드</p>
                <p class="t-prep__code" data-testid="room-code">
                  {code}
                </p>
                <p class="t-small">공용 화면 창을 열어 TV로 옮기면 학생들이 이 코드로 들어와요.</p>
                <p data-testid="prep-counts">
                  들어온 회사 <b>{view.seats.length}</b> · 회사 설립 <b>{founded}</b>
                </p>
                <div class="t-row">
                  <button type="button" class="btn btn--primary btn--large" data-testid="btn-start-trade" onClick={() => void startTrade()}>
                    무역 시작
                  </button>
                  <button
                    type="button"
                    class="btn btn--secondary"
                    data-testid="btn-lock"
                    aria-pressed={view.locked}
                    onClick={() => actions.setLocked(!view.locked)}
                  >
                    {view.locked ? '입장 다시 받기' : '입장 마감'}
                  </button>
                </div>
              </section>
            )}
            {started && (
              <div class="t-row t-ctrl">
                <button type="button" class="btn btn--secondary t-btn-sm" data-testid="btn-lock" aria-pressed={view.locked} onClick={() => actions.setLocked(!view.locked)}>
                  {view.locked ? '입장 다시 받기' : '입장 마감'}
                </button>
                <button
                  type="button"
                  class="btn btn--secondary t-btn-sm"
                  data-testid="btn-letters"
                  aria-pressed={c.letters.enabled}
                  onClick={() => actions.dispatch({ type: 'toggleLetters', enabled: !c.letters.enabled })}
                >
                  편지 배달 {c.letters.enabled ? '켜짐' : '꺼짐'}
                </button>
              </div>
            )}
            {(phase === 'wrapup' || c.tradeEnded) && <WrapupPanel game={game} actions={actions} onSaveResult={() => void saveResult()} onEnd={() => void endSession()} />}
            {started && !c.tradeEnded && <Timeline game={game} now={now} actions={actions} ask={ask} />}
            <EntryIssues view={view} actions={actions} problems={problems} onIgnore={(k) => setIgnored(new Set([...ignored, k]))} toast={toast} />
            <details class="t-panels" data-testid="side-panels">
              <summary>학습지 · 편지 · 돌발 사건 · 공정한 바다</summary>
              <h3 class="t-h4">학습지</h3>
              <WorksheetPanel game={game} view={view} actions={actions} now={now} />
              <h3 class="t-h4">편지</h3>
              <LettersPanel game={game} view={view} actions={actions} now={now} />
              <h3 class="t-h4">돌발 사건</h3>
              <IncidentPanel game={game} view={view} actions={actions} now={now} />
              <h3 class="t-h4">공정한 바다</h3>
              <FairSeaPanel game={game} view={view} actions={actions} now={now} />
            </details>
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
      {showTimeUp && timeUp && (
        <Modal title="무역 시간이 끝났어요" onClose={() => setTimeUpDismissed(timeUp.at)} testId="time-up">
          <p class="t-modal__body">지금 활동이 진행 중이에요. 활동이 끝나면(최대 2분) 결산으로 넘어가요.</p>
          <div class="t-modal__actions">
            <button type="button" class="btn btn--secondary" data-testid="btn-after-activity" onClick={() => setTimeUpDismissed(timeUp.at)}>
              이 활동 끝나고
            </button>
            <button type="button" class="btn btn--primary" data-testid="btn-finish-now" data-autofocus onClick={() => actions.dispatch({ type: 'finishNow' })}>
              지금 결산
            </button>
          </div>
        </Modal>
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

/**
 * (작업 134) 상단 진행 바 3: "라운드 1까지 m:ss" + [지금 라운드 시작], 수동 진행이면 [발동] 안내(첫 화면에 늘 보이게).
 */
function NextRoundBar({ game, now, onRoundNow, actions }: { game: TeacherGame; now: number; onRoundNow: () => void; actions: TeacherActions }) {
  const c = game.class;
  const manual = c.schedule.mode === 'manual';
  const text = nextRoundText(c, now);
  const plan = c.phase === 'round' ? null : roundNowPlan(c, now);
  const waiting = manual && c.schedule.waiting ? c.schedule.items.find((it) => it.id === c.schedule.waiting) : null;
  if (!text && !manual) return null;
  return (
    <div class="t-top__row t-top__row--next" data-testid="next-round-bar">
      {text && (
        <span class="t-next-round" data-testid="next-round">
          {text}
        </span>
      )}
      {plan && plan.block !== 'NO_NEXT_ROUND' && plan.block !== 'TRADE_ENDED' && (
        <>
          <button
            type="button"
            class="btn btn--primary t-btn-sm"
            data-testid="btn-round-now"
            disabled={!!plan.block}
            title={plan.block ? ROUND_NOW_BLOCK_TEXT[plan.block] : '남은 사전 활동을 건너뛰고 라운드를 지금 열어요'}
            onClick={onRoundNow}
          >
            지금 라운드 시작
          </button>
          {plan.block && (
            <span class="t-small" data-testid="round-now-reason">
              {ROUND_NOW_BLOCK_TEXT[plan.block]}
            </span>
          )}
        </>
      )}
      {manual && (
        <span class="t-manual" data-testid="manual-hint">
          {waiting ? (
            <span class="t-tl-wait" data-testid="tl-waiting">
              <span>
                수동 진행 · 다음: <b>{itemLabel(waiting)}</b> <TierMark it={waiting} />
              </span>
              <button type="button" class="btn btn--primary t-btn-sm" data-testid="btn-fire" onClick={() => actions.dispatch({ type: 'fireNow', id: waiting.id })}>
                발동
              </button>
              <span class="t-small">[발동]을 누르면 지금 활동을 끝내고 다음 항목이 시작돼요</span>
            </span>
          ) : (
            <span class="t-small">{c.phase === 'round' ? '수동 진행 · 라운드가 끝나면 [발동]으로 다음 항목을 시작해요' : '수동 진행 · 다음 항목 시각이 되면 [발동] 버튼이 나와요'}</span>
          )}
        </span>
      )}
    </div>
  );
}

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
    <section class="t-issues" id="entry-issues" data-testid="entry-issues" aria-label="입장 문제">
      <h2 class="t-h3">입장 문제</h2>
      {!has && <p class="t-small">없어요.</p>}
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
    </section>
  );
}

function WrapupPanel({ game, actions, onSaveResult, onEnd }: { game: TeacherGame; actions: TeacherActions; onSaveResult: () => void; onEnd: () => void }) {
  const items = game.class.schedule.wrapup ?? [];
  const wp = game.wrapProgress ?? {};
  const set = (id: string, status: WrapStepStatus | null) => actions.dispatch({ type: 'setWrapStep', id, status });
  return (
    <section class="t-wrap" data-testid="wrapup-panel" aria-label="마무리">
      <h2 class="t-h3">마무리</h2>
      <ol class="t-wrap__list">
        {items.map((w) => {
          const st = wp[w.id];
          return (
            <li key={w.id} data-testid="wrap-item" data-status={st ?? 'pending'}>
              <span>
                {w.label}
                {w.optional ? ' (선택)' : ''}
                {w.worksheetIds.length > 0 && <span class="t-small"> 학습지 {w.worksheetIds.map((x) => x.replace(/^W0?/, '')).join(', ')}번</span>}
                {st === 'done' && <span class="t-tag">끝</span>}
                {st === 'skipped' && <span class="t-tag">건너뜀</span>}
                {st === 'live' && <span class="t-tag">진행 중</span>}
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
        [시작]을 누르면 학생 화면이 바뀌어요 — 결산·시상: 내 회사 결산과 받은 상, 되돌아보기: 문항(학습지에 써요). 시상식은 공용 화면에서 함께 봐요.
      </p>
      <div class="t-row">
        <button type="button" class="btn btn--secondary t-btn-sm" data-testid="btn-save-result-wrap" onClick={onSaveResult}>
          결과 파일 저장
        </button>
        <button type="button" class="btn t-btn--danger t-btn-sm" onClick={onEnd}>
          판 끝내기·방 닫기
        </button>
      </div>
    </section>
  );
}
