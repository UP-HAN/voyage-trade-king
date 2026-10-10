/**
 * 학생 상세 서랍(작업 109, PRD 7.5 학생 상세 v0.3.1): 위치·화물·결정 기록·사건 로그,
 * [회사 이름 바꾸기] [이름 막기] [번호 바꾸기] [내보내기](두 번 확인), [이 학생만 사건 다시 보내기](111),
 * [이 학생에게 학습지 다시 보내기](112), (자리) [이름 확인 완료].
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { seatKey } from '../core';
import { resentWorksheets } from '../core/host';
import { playWorksheetIds } from '../core/worksheet-helpers';
import { eventsById } from '../data/events';
import { worksheet, worksheetById } from '../data/worksheet';
import type { WorksheetId } from '../data/types';
import { goodsById } from '../data/goods';
import { portsById } from '../data/ports';
import { hasBadWord } from '../sync/company-name';
import { MAX_SEAT, MIN_SEAT, type HostView } from '../sync/host-session';
import type { TeacherActions } from './actions';
import type { TeacherGame } from './game';
import { moneyText } from './table';
import { trapTab, type ConfirmOptions } from './ui';

const NAME_ERR: Record<string, string> = {
  NAME_FORMAT: '회사 이름은 2~10자(한글·영문·숫자)로 지어요.',
  NAME_TAKEN: '이미 다른 회사가 쓰는 이름이에요.',
  BAD_NAME: '회사 이름으로 쓸 수 없는 말이 있어요.',
  NO_SEAT: '이 번호의 회사를 찾지 못했어요.',
};

export interface StudentDrawerProps {
  seat: number;
  game: TeacherGame | null;
  view: HostView<TeacherGame>;
  actions: TeacherActions;
  ask: (o: ConfirmOptions) => Promise<boolean>;
  toast: (text: string) => void;
  onClose: () => void;
  onSeatChanged: (seat: number) => void;
}

export function StudentDrawer({ seat, game, view, actions, ask, toast, onClose, onSeatChanged }: StudentDrawerProps) {
  const rec = view.seats.find((s) => s.seat === seat);
  const p = game?.players[seatKey(seat)];
  const [name, setName] = useState(rec?.companyName ?? '');
  const [newSeat, setNewSeat] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [resendId, setResendId] = useState('');
  const [wsId, setWsId] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setName(rec?.companyName ?? '');
    setErr(null);
  }, [seat, rec?.companyName]);
  useEffect(() => {
    box.current?.focus();
  }, [seat]);
  if (!rec) return null;

  // [이 학생만 사건 다시 보내기](작업 111): 이미 발동한 사건 중 학생 기기에서 다시 할 수 있는 것(표지·준비·확인 퀴즈·학습지 제외), 최근 것 먼저
  const resendable = [...(game?.class.firedEvents ?? [])]
    .filter((id) => {
      const d = eventsById[id];
      return !!d && !d.isCover && d.tier !== 'prep' && d.tier !== 'wrap' && d.kind !== 'checkQuiz' && d.kind !== 'worksheet';
    })
    .reverse();
  const resendSel = resendable.includes(resendId) ? resendId : (resendable[0] ?? '');

  // [이 학생에게 학습지 다시 보내기](작업 112): 이번 판 번호 먼저, 이 학생이 아직 쓰지 않은 번호
  const playWs = game ? playWorksheetIds(game.class.schedule) : [];
  const wsChoices: WorksheetId[] = [...playWs, ...worksheet.map((w) => w.id).filter((id) => !playWs.includes(id))].filter((id) => !p?.game.worksheetDone.includes(id));
  const wsSel = (wsChoices.includes(wsId as WorksheetId) ? wsId : (wsChoices[0] ?? '')) as WorksheetId | '';
  const wsPending = p ? resentWorksheets(p) : [];

  const taken = new Set(view.seats.map((s) => s.seat));
  const emptySeats: number[] = [];
  for (let n = MIN_SEAT; n <= MAX_SEAT; n++) if (!taken.has(n)) emptySeats.push(n);

  const rename = async () => {
    const v = name.trim();
    if (!v || v === rec.companyName) return;
    if (hasBadWord(v, [])) {
      const yes = await ask({ title: '그래도 바꿀까요?', body: '회사 이름으로 쓰기 어려운 말이 들어 있어요. 그래도 이 이름으로 바꿀까요?', ok: '바꾸기', testId: 'confirm-badname' });
      if (!yes) return;
    }
    const r = actions.renameCompany(seat, v);
    if (r.ok) {
      setErr(null);
      toast(`${seat}번 회사 이름을 '${r.companyName}'(으)로 바꿨어요`);
    } else setErr(NAME_ERR[r.error] ?? '바꾸지 못했어요.');
  };
  const block = async () => {
    const yes = await ask({
      title: '이름 막기',
      body: '이 이름을 이번 판에서 쓸 수 없게 하고 학생이 다시 짓게 해요.',
      ok: '이름 막기',
      danger: true,
      testId: 'confirm-block',
    });
    if (yes && actions.blockCompanyName(seat)) toast(`${seat}번 회사 이름을 막았어요. 학생이 새 이름을 지어요`);
  };
  const move = async () => {
    const to = Number(newSeat);
    if (!to) return;
    const yes = await ask({ title: '번호 바꾸기', body: `${seat}번 회사를 ${to}번으로 옮겨요. 회사 상태는 그대로예요.`, ok: '옮기기', testId: 'confirm-reseat' });
    if (!yes) return;
    if (actions.reassignSeat(seat, to)) {
      toast(`${seat}번 회사를 ${to}번으로 옮겼어요`);
      setNewSeat('');
      onSeatChanged(to);
    } else setErr('그 번호로 옮길 수 없어요.');
  };
  const kick = async () => {
    const a = await ask({ title: '내보내기', body: `${seat}번 ${rec.companyName}을(를) 내보낼까요?`, ok: '내보내기', danger: true, testId: 'confirm-kick-1' });
    if (!a) return;
    const b = await ask({
      title: '정말 내보낼까요?',
      body: '이 기기는 이번 판에 다시 들어올 수 없어요. 번호는 비워져요.',
      ok: '정말 내보내기',
      danger: true,
      testId: 'confirm-kick-2',
    });
    if (b && actions.kick(seat)) {
      toast(`${seat}번 회사를 내보냈어요`);
      onClose();
    }
  };

  const g = p?.game;
  const cargo = g ? [...g.cargo, ...g.contracts] : [];
  return (
    <div
      ref={box}
      class="t-drawer"
      role="dialog"
      aria-label={`${seat}번 학생 상세`}
      tabIndex={-1}
      data-testid="student-drawer"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
        else trapTab(e as unknown as KeyboardEvent, box.current);
      }}
    >
      <header class="t-drawer__head">
        <h2>
          {seat}번 · <span data-testid="drawer-company">{rec.companyName}</span>
        </h2>
        <button type="button" class="btn btn--secondary" data-testid="drawer-close" onClick={onClose}>
          닫기
        </button>
      </header>
      {err && (
        <p class="t-alert t-alert--error" role="alert" data-testid="drawer-error">
          {err}
        </p>
      )}
      <section class="t-drawer__sec">
        <h3>회사 이름</h3>
        <div class="t-row">
          <input
            class="t-input"
            data-testid="rename-input"
            maxLength={10}
            value={name}
            onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
          />
          <button type="button" class="btn btn--primary" data-testid="btn-rename" onClick={() => void rename()}>
            회사 이름 바꾸기
          </button>
        </div>
        <div class="t-row">
          <button type="button" class="btn btn--secondary" data-testid="btn-block" onClick={() => void block()}>
            이름 막기
          </button>
          <button type="button" class="btn btn--secondary" disabled title="곧 열려요">
            이름 확인 완료 <span class="t-soon">곧 열려요</span>
          </button>
        </div>
      </section>
      <section class="t-drawer__sec">
        <h3>번호 바꾸기</h3>
        <div class="t-row">
          <select data-testid="reseat-select" value={newSeat} onChange={(e) => setNewSeat((e.currentTarget as HTMLSelectElement).value)}>
            <option value="">빈 번호 고르기</option>
            {emptySeats.map((n) => (
              <option key={n} value={String(n)}>
                {n}번
              </option>
            ))}
          </select>
          <button type="button" class="btn btn--secondary" data-testid="btn-reseat" disabled={!newSeat} onClick={() => void move()}>
            번호 바꾸기
          </button>
        </div>
      </section>
      {g && (
        <section class="t-drawer__sec" data-testid="drawer-detail">
          <h3>지금 상태</h3>
          <p>
            위치 {portsById[g.port]?.name ?? g.port}
            {g.dest ? ` → ${portsById[g.dest]?.name ?? g.dest}` : ''} · 자금 {moneyText(g.money)}만 원
            {g.loan ? ` · 대출 ${moneyText(g.loan)}만 원` : ''} · {g.ready ? '출항 준비 됨' : '출항 준비 안 함'}
          </p>
          <p>
            화물:{' '}
            {cargo.length
              ? cargo.map((c) => `${goodsById[c.good]?.name ?? c.good} ${c.qty}`).join(', ')
              : '없음'}
          </p>
          <p>
            결정 기록:{' '}
            {Object.keys(g.decisions).length
              ? Object.entries(g.decisions)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(', ')
              : '없음'}
          </p>
          <h3>사건 로그(최근 8개)</h3>
          <ol class="t-log">
            {g.log.slice(-8).map((l, i) => (
              <li key={i}>
                라운드 {l.round} · {l.kind}
                {l.good ? ` ${goodsById[l.good]?.name ?? l.good}` : ''}
                {l.qty ? ` ${l.qty}` : ''}
                {l.amount ? ` ${moneyText(l.amount)}만 원` : ''}
              </li>
            ))}
            {g.log.length === 0 && <li>아직 기록이 없어요.</li>}
          </ol>
        </section>
      )}
      <section class="t-drawer__sec">
        <div class="t-row">
          {resendable.length > 0 && (
            <>
              <select data-testid="resend-select" aria-label="다시 보낼 사건" value={resendSel} onChange={(e) => setResendId((e.currentTarget as HTMLSelectElement).value)}>
                {resendable.map((id) => (
                  <option key={id} value={id}>
                    {eventsById[id]?.title ?? id}
                  </option>
                ))}
              </select>
              <button
                type="button"
                class="btn btn--secondary"
                data-testid="btn-resend-event"
                title="이 학생 기기의 따라잡기 큐에 사건을 넣어요"
                onClick={() => {
                  // 호스트가 거절할 경우(번호 없음·발동 전 사건)를 먼저 걸러 거절 이유를 보인다(수정 1회차)
                  const title = eventsById[resendSel]?.title ?? resendSel;
                  if (!game?.players[seatKey(seat)]) return toast('이 번호의 회사를 찾지 못해 보내지 못했어요.');
                  if (!game.class.firedEvents.includes(resendSel)) return toast(`'${title}'은(는) 아직 열리지 않은 활동이라 보낼 수 없어요.`);
                  actions.dispatch({ type: 'resendEvent', seat, id: resendSel });
                  toast(
                    rec.online
                      ? `'${title}'을(를) 이 학생에게 다시 보냈어요`
                      : `이 학생은 지금 접속하지 않았어요. '${title}'에 아직 답하지 않았다면 다시 들어올 때 받아요`,
                  );
                }}
              >
                이 학생만 사건 다시 보내기
              </button>
            </>
          )}
          {wsChoices.length > 0 && (
            <>
              <select data-testid="resend-ws-select" aria-label="다시 보낼 학습지 번호" value={wsSel} onChange={(e) => setWsId((e.currentTarget as HTMLSelectElement).value)}>
                {wsChoices.map((id) => (
                  <option key={id} value={id}>
                    {worksheetById[id].label} {playWs.includes(id) ? '' : '(이번 판 밖)'}
                  </option>
                ))}
              </select>
              <button
                type="button"
                class="btn btn--secondary"
                data-testid="btn-resend-ws"
                title="이 학생에게만 학습지 팝업을 다시 보내요"
                onClick={() => {
                  // 호스트가 거절할 경우(번호 없음·이미 다 씀)를 먼저 걸러 거절 이유를 보인다(111 [다시 보내기]와 같은 방식)
                  if (!wsSel) return;
                  const label = worksheetById[wsSel].label;
                  if (!game?.players[seatKey(seat)]) return toast('이 번호의 회사를 찾지 못해 보내지 못했어요.');
                  if (game.players[seatKey(seat)].game.worksheetDone.includes(wsSel)) return toast(`이 학생은 학습지 ${label}을(를) 이미 다 썼어요.`);
                  actions.dispatch({ type: 'resendWorksheet', seat, wId: wsSel });
                  toast(
                    rec.online
                      ? `학습지 ${label}을(를) 이 학생에게 다시 보냈어요(라운드·활동 카드 중이면 그게 끝나면 떠요)`
                      : `이 학생은 지금 접속하지 않았어요. 다시 들어오면 학습지 ${label} 팝업이 떠요`,
                  );
                }}
              >
                이 학생에게 학습지 다시 보내기
              </button>
              {wsPending.length > 0 && (
                <span class="t-small" data-testid="resend-ws-pending">
                  보낸 학습지(아직 안 씀): {wsPending.map((id) => worksheetById[id].label).join('')}
                </span>
              )}
            </>
          )}
          <button type="button" class="btn t-btn--danger" data-testid="btn-kick" onClick={() => void kick()}>
            내보내기
          </button>
        </div>
      </section>
    </div>
  );
}
