/**
 * 게임 화면 틀: 상태 띠 → HUD → (준비 단계 / 해도 S07 / 항구 자리 / 무역 끝) → 하단 바, 그 위에 끼워 넣기 층(slots.tsx).
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { nextRoundWait, voyageCostFor, type PublicClass } from '../core';
import { missionsById } from '../data/missions';
import { portLabel } from '../data/ports';
import type { PortId } from '../data/types';
import { flagHex } from '../ui/common/FlagIcon';
import { WorldMap, type OtherShip } from '../ui/map/WorldMap';
import { Dex } from './Dex';
import { useServerNow, useSessionValue } from './hooks';
import { Hud } from './Hud';
import { PortCardModal } from './port/PortCard';
import { PortScreen } from './port/PortScreen';
import { classForPredict, playerForPredict, type MeView } from './predict';
import { FoundCompany, PrepWait } from './Prep';
import { SlotLayers, topLayer } from './slots';
import type { StudentState, StudentStore } from './store';
import { toggleAllowed } from './guard';
import { formatClock, formatMoney } from './text';
import { WrapupView } from './wrapup/WrapupView';

/** 호스트가 15초 넘게 없으면 띠(PRD 7.8) */
export const HOST_WAIT_BAND_MS = 15_000;

export type BandKind = 'reconnecting' | 'hostWait' | 'version';

/** 지금 보일 상단 띠(순수) */
export function statusBands(st: StudentState, now: number): BandKind[] {
  const p = st.peer;
  const out: BandKind[] = [];
  if (p.status === 'reconnecting') out.push('reconnecting');
  if (p.status === 'hostOffline' && p.hostOfflineSince !== null && now - p.hostOfflineSince >= HOST_WAIT_BAND_MS) out.push('hostWait');
  if (p.versionMismatch) out.push('version');
  return out;
}

const BAND_TEXT: Record<BandKind, string> = {
  reconnecting: '연결이 끊겼어요. 다시 잇는 중…',
  hostWait: '선생님 화면을 기다리고 있어요',
  version: '새 버전이 나왔어요. 새로 고침해 주세요',
};

export function StatusBands({ st, now }: { st: StudentState; now: number }) {
  const bands = statusBands(st, now);
  if (!bands.length) return null;
  return (
    <div class="st-bands">
      {bands.map((b) => (
        <div key={b} class={`st-band st-band--${b}`} role="status" data-testid={`band-${b}`}>
          {BAND_TEXT[b]}
          {b === 'hostWait' && st.peer.queuedCount > 0 && <span class="st-band__sub"> · 보낼 행동 {st.peer.queuedCount}개가 기다리고 있어요</span>}
          {b === 'version' && (
            <button type="button" class="btn btn--secondary st-band__btn" onClick={() => location.reload()}>
              새로 고침
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export function isTradingPhase(cls: PublicClass | null | undefined): boolean {
  return Boolean(cls && cls.phase === 'round' && !cls.paused);
}

/**
 * (작업 134) 라운드 전·사이 상태 카드 문구(순수). 무역을 시작했고 라운드가 아닐 때(사전 활동·라운드 사이) 쓴다.
 * 남은 시간은 배치표(공개 상태 schedule) − 무역 경과(서버 시각 기준) — 교사 화면과 같은 계산(nextRoundWait).
 */
export function roundWaitInfo(cls: PublicClass, now: number): { title: string; line: string; sub: string } {
  const w = nextRoundWait(cls, now);
  const first = cls.round === 0;
  // (작업 115) 남은 라운드가 없으면(마지막 라운드 뒤 정리 활동 — 세관 게시판·확인 퀴즈·학습지) "라운드가 열리면" 대신 정리 안내
  const over = !w && !cls.paused && cls.clock.startedAt !== null;
  const title = over ? '라운드가 모두 끝났어요' : first ? '지금은 다 함께 활동하는 시간이에요' : '지금은 라운드 사이 활동 시간이에요';
  const sub = over ? '선생님과 함께 오늘 배운 것을 정리해요. 곧 결산을 해요' : '라운드가 열리면 항구에서 사고팔고 출항할 수 있어요';
  let line: string;
  if (cls.paused) line = '선생님이 잠시 멈췄어요';
  else if (!w) line = cls.clock.startedAt !== null ? '남은 라운드가 없어요 · 선생님이 시작하면 정리 활동을 함께 해요' : '선생님이 시작하면 라운드가 열려요';
  else if (w.manual) line = '선생님이 시작하면 라운드가 열려요';
  else if (w.sec > 0) line = w.first ? `라운드 ${w.round}까지 ${formatClock(w.sec)}` : `다음 라운드까지 ${formatClock(w.sec)}`;
  // (수정 1회차) 계획 시각이 지났는데 활동이 아직 진행 중 — 언제 열리는지 그대로 알린다
  else line = `${w.first ? `라운드 ${w.round}` : '다음 라운드'}까지 0:00 · 지금 활동이 끝나면 열려요`;
  return { title, line, sub };
}

/** 라운드 전·사이 상태 카드(거래·출항 버튼 대신) */
function RoundWaitCard({ cls, now }: { cls: PublicClass; now: number }) {
  const info = roundWaitInfo(cls, now);
  return (
    <div class="st-wait" role="status" data-testid="round-wait-card" data-first={cls.round === 0 ? '1' : '0'}>
      <p class="st-wait__title title-font">{info.title}</p>
      <p class="st-wait__line" data-testid="round-wait-line">
        {info.line}
      </p>
      <p class="st-wait__sub">{info.sub}</p>
    </div>
  );
}

export type PickInfo =
  | { kind: 'here'; port: PortId }
  | { kind: 'notTrading'; port: PortId }
  | { kind: 'closed'; port: PortId }
  | { kind: 'locked'; port: PortId }
  | { kind: 'noMoney'; port: PortId; cost: number }
  | { kind: 'ok'; port: PortId; cost: number; free: boolean };

/** 항구를 눌렀을 때 보여 줄 정보(순수): 운항비·못 가는 이유 */
export function pickInfo(me: MeView, cls: PublicClass, port: PortId): PickInfo {
  if (port === me.game.port) return { kind: 'here', port };
  const cs = classForPredict(cls);
  if (!cls.openPorts.includes(port)) return { kind: 'locked', port };
  if (cs.activeEffects.some((e) => e.effect.type === 'portClosed' && e.effect.port === port)) return { kind: 'closed', port };
  const free = me.game.effects.tailwind > 0;
  const cost = voyageCostFor(cs, playerForPredict(me), me.game.port, port);
  if (!isTradingPhase(cls)) return { kind: 'notTrading', port };
  if (!free && cost > me.game.money) return { kind: 'noMoney', port, cost };
  return { kind: 'ok', port, cost: free ? 0 : cost, free };
}

function PickPanel({ info, onConfirm, onClose }: { info: PickInfo; onConfirm: () => void; onClose: () => void }) {
  const label = portLabel(info.port);
  let body: string;
  switch (info.kind) {
    case 'here':
      body = '지금 우리 배가 있는 항구예요.';
      break;
    case 'notTrading':
      body = '라운드가 시작되면 목적지를 고를 수 있어요.';
      break;
    case 'closed':
      body = '이 항구는 지금 막혀 있어서 갈 수 없어요.';
      break;
    case 'locked':
      body = '아직 열리지 않은 항구예요.';
      break;
    case 'noMoney':
      body = `운항비 ${formatMoney(info.cost)}이 필요한데 자금이 모자라요.`;
      break;
    case 'ok':
      body = info.free ? '순풍 덕분에 이번 운항비는 0원이에요.' : `운항비 ${formatMoney(info.cost)}`;
      break;
  }
  return (
    <div class="st-pick" role="dialog" aria-label={`${label} 목적지 확인`} data-testid="pick-panel" data-kind={info.kind}>
      <p class="st-pick__title title-font">{label}</p>
      <p class="st-pick__body" data-testid="pick-body">
        {body}
      </p>
      <div class="st-row-btns">
        <button type="button" class="btn btn--secondary" onClick={onClose}>
          닫기
        </button>
        {info.kind === 'ok' && (
          <button type="button" class="btn btn--primary" data-testid="pick-confirm" onClick={onConfirm}>
            여기로 정하기
          </button>
        )}
      </div>
    </div>
  );
}

function MissionBar({ me }: { me: MeView }) {
  // (작업 115) 임무가 여럿이면(2차시 3종) 한 줄에 칩으로: 제목 줄임 + 단계 칸
  const many = Object.entries(me.game.missions).filter(([id]) => missionsById[id]);
  if (many.length > 1) {
    return (
      <div class="st-missions" data-testid="missions">
        {many.map(([id, m]) => {
          const def = missionsById[id]!;
          const complete = m.status === 'done';
          const done = complete ? def.steps.length : m.steps.filter(Boolean).length;
          return (
            <div key={id} class={`st-mission st-mission--chip${complete ? ' is-complete' : ''}`} data-testid={`mission-${id}`} data-status={m.status} data-done={done} data-total={def.steps.length} title={def.steps.join(' → ')}>
              <span class="st-mission__title">
                {def.short ?? def.title}
                {complete && <span class="st-mission__done"> · 완료</span>}
              </span>
              <span class="st-mission__bar" role="progressbar" aria-valuemin={0} aria-valuemax={def.steps.length} aria-valuenow={done} aria-label={`${def.title} ${done}/${def.steps.length}단계`}>
                {def.steps.map((_, i) => (
                  <span key={i} class={`st-mission__step${complete || m.steps[i] ? ' is-done' : ''}`} />
                ))}
              </span>
            </div>
          );
        })}
      </div>
    );
  }
  // 진행 중 임무가 먼저, 없으면 마지막으로 끝낸 임무를 꽉 찬 막대로(작업 111: 천연가스 임무 완료가 하단 바에 보이게)
  const list = Object.entries(me.game.missions);
  const entry = list.find(([, m]) => m.status === 'active') ?? [...list].reverse().find(([, m]) => m.status === 'done');
  const def = entry ? missionsById[entry[0]] : undefined;
  if (!entry || !def) return <div class="st-mission st-mission--none">임무 없음 · 자유 항해</div>;
  const complete = entry[1].status === 'done';
  const done = complete ? def.steps.length : entry[1].steps.filter(Boolean).length;
  const total = def.steps.length;
  return (
    <div class={`st-mission${complete ? ' is-complete' : ''}`} data-testid="mission" data-mission={entry[0]} data-status={entry[1].status} data-done={done} data-total={total}>
      <span class="st-mission__title">
        임무: {def.title}
        {complete && <span class="st-mission__done"> · 완료</span>}
      </span>
      <span class="st-mission__bar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label={`임무 ${done}/${total}단계`}>
        {def.steps.map((_, i) => (
          <span key={i} class={`st-mission__step${complete || entry[1].steps[i] ? ' is-done' : ''}`} />
        ))}
      </span>
    </div>
  );
}

// 연속 클릭 가드는 guard.ts로 옮겼다(작업 111 사건 응답 버튼도 같은 것을 씀). 기존 import 경로를 위해 다시 내보낸다
export { READY_TOGGLE_GUARD_MS, toggleAllowed } from './guard';

function BottomBar({ store, st, onPort, now }: { store: StudentStore; st: StudentState; onPort: () => void; now: number }) {
  const me = st.peer.me!;
  const lastToggle = useRef<number | null>(null);
  const toggle = (type: 'setReady' | 'cancelReady') => {
    const t = Date.now();
    if (!toggleAllowed(lastToggle.current, t)) return;
    lastToggle.current = t;
    store.act({ type });
  };
  const cls = st.peer.public?.class ?? null;
  const trading = isTradingPhase(cls);
  const dest = me.game.dest;
  const cost = dest && cls ? (me.game.effects.tailwind > 0 ? 0 : voyageCostFor(classForPredict(cls), playerForPredict(me), me.game.port, dest)) : null;
  const sending = st.peer.queuedCount > 0;

  // (작업 134) 라운드 전·사이: 거래·출항 버튼을 숨기고 언제 열리는지 안내
  const waiting = !!cls && cls.phase !== 'round';
  let status: string;
  if (!cls) status = '';
  else if (waiting) {
    const info = roundWaitInfo(cls, now);
    status = info.title === '라운드가 모두 끝났어요' ? info.line : `${info.line} · 라운드가 열리면 거래할 수 있어요`;
  }
  else if (cls.phase === 'round') status = dest ? `목적지: ${portLabel(dest)} · 운항비 ${formatMoney(cost ?? 0)}` : '지도에서 항구를 눌러 목적지를 골라요';
  else if (cls.phase === 'event' || cls.phase === 'worksheet') status = '선생님 활동이 끝나면 이어서 해요';
  else status = '다음 라운드가 시작되면 거래할 수 있어요';

  return (
    <footer class="st-bottom" data-testid="bottom-bar">
      <MissionBar me={me} />
      <div class="st-bottom__dest" data-testid="bottom-status">
        {status}
        {sending && (
          <span class="st-sending" data-testid="sending">
            보내는 중
          </span>
        )}
      </div>
      {!waiting && <div class="st-bottom__actions">
        <button type="button" class="btn btn--secondary" data-testid="enter-port" onClick={onPort}>
          항구 들어가기
        </button>
        {me.game.ready && trading ? (
          <>
            {/* [취소]는 [출항 준비]와 다른 자리(왼쪽)·다른 색. 원래 버튼 자리에는 글자 안내만 둔다(연속 클릭이 취소로 이어지지 않게) */}
            <button type="button" class="btn st-btn-cancel" data-testid="cancel-ready" onClick={() => toggle('cancelReady')}>
              출항 취소
            </button>
            <span class="st-ready-note" data-testid="ready-note">
              라운드가 끝나면 출발해요
            </span>
          </>
        ) : (
          <button
            type="button"
            class="btn btn--primary"
            data-testid="set-ready"
            disabled={!trading || !dest}
            onClick={() => toggle('setReady')}
          >
            출항 준비
          </button>
        )}
      </div>}
    </footer>
  );
}

function MapView({ store, st }: { store: StudentStore; st: StudentState }) {
  const me = st.peer.me!;
  const pub = st.peer.public!;
  const cls = pub.class;
  const [picked, setPicked] = useState<PortId | null>(null);
  const others = useMemo((): OtherShip[] => {
    const names = new Map(pub.public.companies.map((c) => [c.pid, c.name]));
    return pub.public.ships
      .filter((s) => s.pid !== st.peer.pid)
      .map((s) => ({ pid: s.pid, port: s.port, color: flagHex(s.color), emblem: s.emblem, company: names.get(s.pid) ?? null }));
  }, [pub.public.ships, pub.public.companies, st.peer.pid]);
  const info = picked ? pickInfo(me, cls, picked) : null;
  const myShip = { port: me.game.port, color: flagHex(me.company.color), emblem: me.company.emblem };
  return (
    <div class="st-map">
      <WorldMap
        mode="student"
        lesson={cls.stage}
        myShip={myShip}
        otherShips={others}
        selectedDest={picked ?? me.game.dest}
        onSelectPort={(port) => setPicked(port)}
      />
      {info && (
        <PickPanel
          info={info}
          onClose={() => setPicked(null)}
          onConfirm={() => {
            store.act({ type: 'setDestination', port: info.port });
            setPicked(null);
          }}
        />
      )}
    </div>
  );
}


export function GameScreen({ store, st }: { store: StudentStore; st: StudentState }) {
  const now = useServerNow(store);
  const [view, setView] = useSessionValue<'map' | 'port'>('voyage.student.view', 'map');
  const [dex, setDex] = useState(false);
  const [editFlag, setEditFlag] = useState(false);
  // 처음 입항한 항구의 항구 카드(PRD 6.3.3) — 호스트 항해 처리 이벤트 portCard(작업 108)
  const [portCard, setPortCard] = useState<PortId | null>(null);
  useEffect(
    () =>
      store.onGameEvents((events) => {
        const card = [...events].reverse().find((e) => e.type === 'portCard') as { type: 'portCard'; port: PortId } | undefined;
        if (card) setPortCard(card.port);
      }),
    [store],
  );
  const me = st.peer.me!;
  const cls = st.peer.public?.class ?? null;
  const phase = cls?.phase ?? null;

  const tradeOver = phase === 'wrapup' || phase === 'ended' || st.peer.ended;
  const founded = me.company.founded;
  // (작업 134) 라운드 전(사전 활동)·라운드 사이: 해도 + 상태 카드(항구 화면이었으면 해도로)
  const waitPhase = Boolean(cls) && founded && !tradeOver && phase !== 'prep' && phase !== 'round';
  useEffect(() => {
    if (waitPhase && view === 'port') setView('map');
  }, [waitPhase, view]);
  let main;
  if (!cls) main = <p class="st-loading">학급 정보를 받는 중이에요…</p>;
  // 회사를 아직 세우지 않았으면 단계와 상관없이(무역 중 늦게 들어온 학생 포함, 마무리 제외) 회사 설립부터(PRD 6.1)
  else if (!tradeOver && !founded) main = <FoundCompany store={store} st={st} />;
  else if (phase === 'prep' && editFlag) main = <FoundCompany store={store} st={st} onDone={() => setEditFlag(false)} />;
  else if (phase === 'prep') main = <PrepWait store={store} st={st} onEdit={() => setEditFlag(true)} />;
  else if (tradeOver)
    main = <WrapupView cls={cls} pub={st.peer.public?.public ?? null} me={me} wrapLive={st.peer.public?.wrapLive ?? null} />;
  else if (waitPhase)
    main = (
      <>
        <MapView store={store} st={st} />
        <RoundWaitCard cls={cls} now={now} />
      </>
    );
  else if (view === 'port') main = <PortScreen store={store} st={st} onBack={() => setView('map')} />;
  else main = <MapView store={store} st={st} />;

  const showBottom = Boolean(cls) && founded && phase !== 'prep' && !tradeOver && (view === 'map' || waitPhase);
  // 일시정지·이름 막힘 층이 떠 있으면 아래 화면 전체(HUD·도감·설정 메뉴 포함)를 키보드로도 못 건드리게
  const covered = topLayer(st) !== null;

  return (
    <div class="st-game" data-testid="student-game" data-phase={phase ?? ''}>
      <div class="st-game__base" data-testid="game-base" {...(covered ? { inert: true, 'aria-hidden': 'true' } : {})}>
        <StatusBands st={st} now={now} />
        {(founded || phase !== 'prep') && <Hud store={store} st={st} now={now} onDex={() => setDex(true)} />}
        <div class="st-main">{main}</div>
        {showBottom && <BottomBar store={store} st={st} now={now} onPort={() => setView('port')} />}
        {dex && <Dex player={me} collected={me.game.metrics.dex} comeback={Boolean(cls?.settings?.comeback)} onClose={() => setDex(false)} />}
        {/* (작업 134) 처음 입항 항구 카드: 라운드 중에는 아래 화면을 막지 않는 작은 카드(왼쪽 위) — 거래 버튼·결정 패널을 가리지 않게 */}
        {portCard && !tradeOver && <PortCardModal port={portCard} soft={phase === 'round'} onClose={() => setPortCard(null)} />}
      </div>
      <SlotLayers store={store} st={st} />
    </div>
  );
}
