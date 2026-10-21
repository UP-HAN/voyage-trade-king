/**
 * 학습지 "잠깐!" 팝업 층(S22, PRD 7.7·4.3.3) — 작업 112. z-index 70(사건 카드보다 위), 모달.
 *
 * - `class.worksheet.current`가 있으면 모달: 큰 "잠깐!", 판 단위 꼬리표("차시 한 판 · L1" / "단원 한 판 · L3 구간"),
 *   번호(원문자)·문구(prompt)·"교과서 98~99쪽"·기록 도우미 `[내 기록: …]`(helper 키가 있을 때, 기록이 없으면 "아직 기록이 없어요").
 *   묶음(번호 배열)이면 "잠깐! ①②③④" + 번호마다 한 줄씩 세로로, [다 썼어요]는 1번(번호별 완료로 모두 기록). 3분이 지나면
 *   "다 못 쓴 번호는 마무리 때 이어 써요".
 * - [다 썼어요]는 교사 설정 `worksheetWaitSec`(0/15/30) 뒤 켜짐(남은 초 표시, 시각은 호스트 기준 서버 시각 `store.serverNow()`와
 *   호스트가 정한 `openedAt` 비교). 누르면 `markWorksheetDone` → "친구들을 기다려요"(도감·편지함·항해 기록장 열람 가능).
 *   연속 클릭 가드는 107 `READY_TOGGLE_GUARD_MS`(guard.ts).
 * - 팝업 동안 그 학생의 게임 조작은 막힌다(층 틀이 화면을 덮음). 무역 시계는 흐른다. 등장 때 `fx.popupIn(팝업 요소)`.
 * - 늦게 들어온 학생: 지금 떠 있는 팝업만 보인다(이미 닫힌 팝업은 학급 상태에 없어서 다시 뜨지 않음).
 *   교사가 학생 상세에서 [이 학생에게 학습지 다시 보내기](core `resendWorksheet`)를 하면 그 학생에게만 개인 팝업
 *   (반 전체 팝업이 없고 라운드 중·차단형 사건 카드 중이 아닐 때, 하나씩 — 사건 카드를 덮지 않음). [다 썼어요]를 누를 때까지 재접속해도 다시 뜬다.
 * - (작업 132, PRD 4.3.3.1) '지금 쓰기'(`worksheet.during`): 머리말 "잠깐! ③(별표) 지금 써요", 본문 = `during.prompt`
 *   (+ 결정 패널과 보도가 같은 라운드면 "보도를 보기 전의 생각을 떠올려 써요."), 쪽·기록 도우미는 같고, 아래 작은 글씨
 *   "나머지 칸은 끝나고 써요"/"나머지 칸은 구간 끝에 써요". [다 썼어요]는 `markWorksheetDone{during:true}` — 번호 완료와 따로 센다.
 * - 마무리 단계(`phase:'wrapup'`): '끝나고 쓰기' 번호가 있으면 "오늘 쓸 학습지: ⑤ ⑥ ⑦ ⑧" + 판 단위·차시 + [항해 기록장](모달 아님).
 * - 게임 중 항해 기록장을 기기에 저장한다(`useLogbookSync`, 판이 끝난 뒤 24시간 — src/student/logbook/).
 * slots.tsx가 학급 상태·내 회사·행동 함수를 넘긴다(그 파일은 고치지 않음). 방 코드·공개 집계·서버 시각은 StoreContext에서 읽는다.
 */
import { useContext, useEffect, useRef, useState } from 'preact/hooks';
import type { Action, PublicClass, PublicState } from '../../core';
import {
  afterWorksheetIds,
  playScopeTag,
  playUnitTag,
  worksheetHelperRows,
  worksheetStage,
  type HelperPublic,
} from '../../core/worksheet-helpers';
import { DURING_AFTER_NEWS_TEXT } from '../../data/schedule';
import { bundleTitle, duringLabel, worksheetById, worksheetFor } from '../../data/worksheet';
import type { LessonId, WorksheetId } from '../../data/types';
import { lessonPartRulesOf, WS6_ALONG_TEXT, type LessonPart } from '../../data/lessonParts';
import { alongPlanned } from './along';
import { resentWorksheets } from '../../core/host';
import { fx } from '../../ui/common/fx';
import { Dex } from '../Dex';
import { toggleAllowed } from '../guard';
import { StoreContext } from '../hooks';
import { LayerFrame } from '../layer';
import { LetterPanel } from '../letters/LetterLayer';
import { LogbookSheet, useLogbookSync } from '../logbook/Logbook';
import type { LogbookEntry } from '../logbook/model';
import type { MeView } from '../predict';
import type { StudentActResult } from '../store';
import './worksheet.css';

export interface WorksheetLayerProps {
  classState: PublicClass;
  player: MeView;
  act: (action: Action) => StudentActResult;
}

/** 구간 끝 묶음 팝업의 시간(초) — 지나면 "다 못 쓴 번호는 마무리 때 이어 써요"(PRD 4.3.3) */
export const BUNDLE_SEC = 180;

/** [다 썼어요]까지 남은 초(0이면 누를 수 있음). openedAt·now는 호스트 기준 시각(ms) */
export function waitLeftSec(openedAt: number | null, waitSec: number, now: number): number {
  if (!waitSec || openedAt === null) return 0;
  return Math.max(0, Math.ceil(waitSec - (now - openedAt) / 1000));
}

/** 지금 떠 있는 팝업 번호(판이 끝났으면 없음). 마무리 단계에 교사가 [지금 띄우기]한 팝업은 보인다(공용 화면과 같게) */
export function openWorksheetIds(cls: PublicClass): WorksheetId[] {
  const ids = cls.worksheet.current;
  if (!ids || !ids.length || cls.phase === 'ended') return [];
  return ids.filter((id) => worksheetById[id]);
}

/** 이 팝업 번호를 모두 다 썼는가(during = '지금 쓰기' (별표) 칸 완료로 본다) */
export function allDone(me: MeView, ids: readonly WorksheetId[], during = false): boolean {
  const done = during ? (me.game.duringDone ?? []) : me.game.worksheetDone;
  return ids.length > 0 && ids.every((id) => done.includes(id));
}

/**
 * (작업 153) 팝업 머리 아래 '오늘 학습지 순서' 한 줄의 조각: 팝업 첫 번호와 같은 차시의 무역 학습지(번호 순).
 * 다 쓴 번호 `⑤✓`, 지금 팝업 번호 `⑥ 지금`(now: true → 굵게), 아직 `⑦`.
 */
export function worksheetOrderParts(
  me: MeView,
  ids: readonly WorksheetId[],
  /** (작업 154) 판 설정(공개 settings) — 2차시 나눠 고르기로 빠진 번호는 보이지 않는다 */
  settings?: { playUnit: string; scope: readonly LessonId[]; lessonPart?: LessonPart | null } | null,
): { id: WorksheetId; text: string; now: boolean }[] {
  const first = worksheetById[ids[0]];
  if (!first || first.lesson === 'optional') return [];
  const done = me.game.worksheetDone;
  const drop = lessonPartRulesOf(settings)?.dropWorksheets ?? [];
  return worksheetFor(first.lesson as Exclude<typeof first.lesson, 'optional'>)
    .filter((w) => w.phase === 'trade' && !drop.includes(w.id))
    .sort((a, b) => a.no - b.no)
    .map((w) => {
      const now = ids.includes(w.id);
      return { id: w.id, now, text: now ? `${w.label} 지금` : done.includes(w.id) ? `${w.label}✓` : w.label };
    });
}

/** 지금 쓰기 팝업 문구: during.prompt(+ 보도 앞 덧붙임) */
export function duringPromptText(id: WorksheetId, afterNews = false): string {
  const p = worksheetById[id]?.during?.prompt ?? worksheetById[id]?.prompt ?? '';
  return afterNews ? `${p} ${DURING_AFTER_NEWS_TEXT}` : p;
}

/** 지금 쓰기 팝업 아래 작은 글씨(그 구간 학습지 방식) */
export function duringRestText(mode: string | undefined): string {
  return mode === 'stageEnd' ? '나머지 칸은 구간 끝에 써요' : '나머지 칸은 끝나고 써요';
}

function useStoreBits(): { pub: PublicState | null; code: string | null; wrapLive: string | null; now: () => number } {
  const store = useContext(StoreContext);
  const st = store?.getState();
  return {
    pub: st?.peer.public?.public ?? null,
    wrapLive: st?.peer.public?.wrapLive ?? null,
    code: st?.peer.code ?? null,
    now: () => {
      try {
        return store ? store.serverNow() : Date.now();
      } catch {
        return Date.now();
      }
    },
  };
}

function useTicker(on: boolean, read: () => number): number {
  const [t, setT] = useState(read);
  useEffect(() => {
    if (!on) return;
    setT(read());
    const id = setInterval(() => setT(read()), 500);
    return () => clearInterval(id);
  }, [on]);
  return on ? Math.max(t, read()) : t;
}

type Overlay = null | 'dex' | 'letters' | 'logbook';

export function WorksheetLayer({ classState, player, act }: WorksheetLayerProps) {
  const bits = useStoreBits();
  const entry = useLogbookSync({ cls: classState, me: player, pub: bits.pub, code: bits.code });
  const [overlay, setOverlay] = useState<Overlay>(null);
  const ids = openWorksheetIds(classState);
  const tradeOver = classState.phase === 'wrapup' || classState.phase === 'ended';
  const tools = <ToolOverlay which={overlay} cls={classState} me={player} act={act} entry={entry} onClose={() => setOverlay(null)} />;

  // (교사 [이 학생에게 학습지 다시 보내기]) 반 전체 팝업이 없고 라운드 중·차단형 사건 중이 아니면 그 학생에게만 하나씩 뜬다
  const resent = resentWorksheets(player);
  const personal = !ids.length && resent.length && classState.phase !== 'round' && classState.phase !== 'event' && classState.phase !== 'ended' && !classState.paused ? [resent[0]] : [];
  const seenAt = useRef<Record<string, number>>({});
  if (personal.length && seenAt.current[personal[0]] === undefined) seenAt.current[personal[0]] = bits.now();
  if (personal.length) {
    return (
      <LayerFrame name="worksheet">
        <WorksheetPopup cls={classState} me={player} act={act} ids={personal} openedAt={seenAt.current[personal[0]] ?? null} personal pub={bits.pub} now={bits.now} onTool={setOverlay} />
        {tools}
      </LayerFrame>
    );
  }

  if (tradeOver && !ids.length) {
    const after = afterWorksheetIds(classState.schedule);
    return (
      <>
        {after.length > 0 && <AfterList cls={classState} ids={after} wrapLive={bits.wrapLive} onLogbook={() => setOverlay('logbook')} />}
        {overlay === 'logbook' && tools}
      </>
    );
  }
  if (!ids.length) return overlay === 'logbook' ? tools : null;
  return (
    <LayerFrame name="worksheet">
      <WorksheetPopup
        cls={classState}
        me={player}
        act={act}
        ids={ids}
        openedAt={classState.worksheet.openedAt}
        during={classState.worksheet.during === true && ids.length === 1}
        afterNews={classState.worksheet.afterNews === true}
        pub={bits.pub}
        now={bits.now}
        onTool={setOverlay}
      />
      {tools}
    </LayerFrame>
  );
}

function ToolOverlay({
  which,
  cls,
  me,
  act,
  entry,
  onClose,
}: {
  which: Overlay;
  cls: PublicClass;
  me: MeView;
  act: (a: Action) => StudentActResult;
  entry: LogbookEntry;
  onClose: () => void;
}) {
  if (which === 'dex') return <Dex player={me} collected={me.game.metrics.dex} comeback={Boolean(cls.settings?.comeback)} onClose={onClose} />;
  if (which === 'letters') {
    return (
      <div class="lt-dock ws-letters">
        <LetterPanel classState={cls} player={me} act={act} onClose={onClose} />
      </div>
    );
  }
  if (which === 'logbook') {
    return (
      <div class="lb-overlay">
        <LogbookSheet entry={entry} onClose={onClose} />
      </div>
    );
  }
  return null;
}

function WorksheetPopup({
  cls,
  me,
  act,
  ids,
  openedAt,
  personal = false,
  during = false,
  afterNews = false,
  pub,
  now: readNow,
  onTool,
}: {
  cls: PublicClass;
  me: MeView;
  act: (a: Action) => StudentActResult;
  ids: WorksheetId[];
  /** [다 썼어요] 대기 기준 시각(반 전체 팝업 = 호스트 openedAt, 개인 팝업 = 이 기기가 처음 본 서버 시각) */
  openedAt: number | null;
  /** 선생님이 이 학생에게만 다시 보낸 학습지 */
  personal?: boolean;
  /** (작업 132) '지금 쓰기' (별표) 칸 팝업 */
  during?: boolean;
  afterNews?: boolean;
  pub: PublicState | null;
  now: () => number;
  onTool: (o: Overlay) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const lastAt = useRef<number | null>(null);
  const idsKey = `${ids.join(',')}@${openedAt ?? ''}${during ? '*' : ''}`;
  const done = allDone(me, ids, during);
  const waitSec = cls.settings.worksheetWaitSec ?? 15;
  const bundle = ids.length > 1;
  const now = useTicker(true, readNow);
  const left = waitLeftSec(openedAt, waitSec, now);
  const late = bundle && openedAt !== null && now - openedAt >= BUNDLE_SEC * 1000;
  useEffect(() => {
    void fx.popupIn(ref.current, { ids });
  }, [idsKey]);
  const stage = worksheetStage(ids, cls.stage);
  const tag = playUnitTag(cls.settings.playUnit, stage);
  const rows = worksheetHelperRows(ids, { cls, player: me, pub: pub as HelperPublic | null });
  const markDone = () => {
    const t = Date.now();
    if (!toggleAllowed(lastAt.current, t)) return;
    lastAt.current = t;
    act({ type: 'markWorksheetDone', ids, ...(during ? { during: true } : {}) });
  };
  const order = worksheetOrderParts(me, ids, cls.settings);
  const stageMode = cls.schedule.stageModes?.[stage as keyof NonNullable<typeof cls.schedule.stageModes>] ?? cls.worksheet.mode;
  return (
    <div
      ref={ref}
      class={`ws-modal${bundle ? ' ws-modal--bundle' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={during ? `잠깐! ${duringLabel(ids[0])} 지금 써요` : '잠깐! 학습지를 써요'}
      data-testid="worksheet-popup"
      data-ids={ids.join(',')}
      data-done={done ? '1' : '0'}
      data-personal={personal ? '1' : '0'}
      data-during={during ? '1' : '0'}
    >
      <p class="ws-head title-font" data-testid="worksheet-head">
        {during ? `잠깐! ${duringLabel(ids[0])} 지금 써요` : bundle ? bundleTitle(ids.map((id) => worksheetById[id])) : '잠깐!'}
      </p>
      <p class="ws-tag" data-testid="worksheet-tag">
        {tag}
      </p>
      {!during && order.length > 1 && (
        <p class="ws-order" data-testid="worksheet-order">
          오늘 학습지:{' '}
          {order.map((o, i) => (
            <span key={o.id} data-id={o.id}>
              {i > 0 && ' → '}
              {o.now ? <b>{o.text}</b> : o.text}
            </span>
          ))}
        </p>
      )}
      {personal && (
        <p class="ws-personal" data-testid="worksheet-personal">
          선생님이 다시 보낸 학습지예요
        </p>
      )}
      {done ? (
        <div class="ws-wait" data-testid="worksheet-waiting">
          <p class="ws-wait__title title-font">친구들을 기다려요</p>
          <p>선생님이 학습지 시간을 끝내면 이어서 해요. 그동안 도감·편지함·항해 기록장을 볼 수 있어요.</p>
        </div>
      ) : (
        <>
          {!during && ids.length === 1 && ids[0] === 'W06' && alongPlanned(cls) && (
            <p class="ws-along" data-testid="worksheet-along">
              {WS6_ALONG_TEXT.last}
            </p>
          )}
          <ol class="ws-rows">
            {rows.map((r) => {
              const w = worksheetById[r.id];
              return (
                <li key={r.id} class="ws-row" data-testid="worksheet-row" data-id={r.id}>
                  <span class="ws-no" data-testid="worksheet-no">
                    {during ? duringLabel(r.id) : w.label}
                  </span>
                  <div class="ws-row__body">
                    <p class="ws-prompt" data-testid="worksheet-prompt">
                      {during ? duringPromptText(r.id, afterNews) : w.prompt}
                    </p>
                    <p class="ws-pages" data-testid="worksheet-pages">
                      {w.pagesLabel}
                    </p>
                    {r.text !== null && (
                      <p class={`ws-helper${r.hasRecord ? '' : ' is-empty'}`} data-testid="worksheet-helper" data-helper={r.helper ?? ''}>
                        [내 기록: {r.text}]
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
          {late && (
            <p class="ws-late" data-testid="worksheet-late">
              다 못 쓴 번호는 마무리 때 이어 써요
            </p>
          )}
          {during && (
            <p class="ws-during-rest" data-testid="worksheet-during-rest">
              {duringRestText(stageMode)}
            </p>
          )}
        </>
      )}
      <div class="ws-foot">
        {!done && (
          <button type="button" class="btn btn--primary btn--large ws-done" data-testid="worksheet-done" disabled={left > 0} data-left={left} onClick={markDone}>
            다 썼어요{left > 0 ? ` (${left}초 뒤에 켜져요)` : ''}
          </button>
        )}
        <div class="ws-tools">
          <button type="button" class="btn btn--secondary" data-testid="worksheet-tool-dex" onClick={() => onTool('dex')}>
            도감
          </button>
          <button type="button" class="btn btn--secondary" data-testid="worksheet-tool-letters" onClick={() => onTool('letters')}>
            편지함
          </button>
          <button type="button" class="btn btn--secondary" data-testid="worksheet-tool-logbook" onClick={() => onTool('logbook')}>
            항해 기록장
          </button>
        </div>
      </div>
    </div>
  );
}

/** 마무리 단계 '끝나고 쓰기' 목록(모달 아님 — 접을 수 있음) */
function AfterList({ cls, ids, wrapLive, onLogbook }: { cls: PublicClass; ids: WorksheetId[]; wrapLive: string | null; onLogbook: () => void }) {
  // (작업 132 수정 1회차) 교사가 마무리 단계(결산·되돌아보기)를 [시작]하면 그 화면을 덮지 않게 접어 둔다(펼치기는 학생이)
  const [folded, setFolded] = useState(Boolean(wrapLive));
  useEffect(() => setFolded(Boolean(wrapLive)), [wrapLive]);
  const tag = playScopeTag(cls.settings.playUnit, cls.settings.scope);
  const labels = ids.map((id) => worksheetById[id]?.label ?? id).join(' ');
  if (folded) {
    return (
      <button type="button" class="btn btn--secondary ws-after-pill" data-testid="after-unfold" onClick={() => setFolded(false)}>
        오늘 쓸 학습지 {labels}
      </button>
    );
  }
  return (
    <section class="ws-after" aria-label="오늘 쓸 학습지" data-testid="after-worksheets-student" data-ids={ids.join(',')}>
      <p class="ws-tag" data-testid="after-tag">
        {tag}
      </p>
      <h2 class="ws-after__title title-font" data-testid="after-title">
        오늘 쓸 학습지: {labels}
      </h2>
      <ul class="ws-after__rows">
        {ids.map((id) => {
          const w = worksheetById[id];
          return (
            <li key={id} data-testid="after-row" data-id={id}>
              <b class="ws-no ws-no--small">{w.label}</b> {w.prompt} <small>{w.pagesLabel}</small>
            </li>
          );
        })}
      </ul>
      <p class="ws-after__hint">수업 뒤나 다음 시간에 항해 기록장을 보며 써요. 이 기기에서 24시간 동안 열 수 있어요.</p>
      <div class="ws-after__btns">
        <button type="button" class="btn btn--primary" data-testid="after-logbook" onClick={onLogbook}>
          항해 기록장
        </button>
        <button type="button" class="btn btn--secondary" onClick={() => setFolded(true)}>
          접기
        </button>
      </div>
    </section>
  );
}

export default WorksheetLayer;
