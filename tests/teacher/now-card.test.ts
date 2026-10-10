/**
 * 작업 137 '지금 할 일' 카드 상태 계산(PRD 7.5.2.1 표 13줄·우선순위) — 순수 함수 `nowCard`.
 * 표본: 차시 L1 10분 판(배치표: 표지 0 · 벽란도 20 · 무역·수입·수출 170 · 라운드 1 230(+천연가스 소식) · 두 섬 320 · ③★ 470 · 라운드 2 510(+흑연 결정)),
 * 수동 진행, 멈춤, 끊김, 마무리, 끝, 단원 한 판(배치표 표본 — 문구에 L1을 박지 않음).
 */
import { describe, expect, it } from 'vitest';
import type { SessionInput } from '../../src/sync/host-session';
import { autoStartWrap, firstWrapStep, teacherReducer, type TeacherGame } from '../../src/teacher/game';
import { endRoundConfirm, nowCard, NOW_PRIORITY, type NowCard, type NowUi, type NowView } from '../../src/teacher/now-card';
import { teacherWarningText } from '../../src/teacher/notice-text';
import { MANUAL_HINT, OLD_TEACHER_TERMS } from '../../src/teacher/teacher-terms';
import { gameWith } from './helpers';

const T0 = 1_000_000;
const UI: NowUi = { screenConnected: true };

function viewOf(g: TeacherGame, o: Partial<NowView> = {}): NowView {
  return {
    status: 'open',
    connection: 'online',
    disconnectedAt: null,
    ended: false,
    code: '304871',
    locked: false,
    rejoinRequests: [],
    codeChanged: null,
    seats: Object.values(g.players)
      .sort((a, b) => a.seat - b.seat)
      .map((p) => ({ seat: p.seat, pid: p.pid, companyName: p.company.name, nameStatus: 'ok' as const, online: true, joinedAt: 0 })),
    ...o,
  };
}

/** n명 판 + 무역 시작(T0) + t초까지 1초 틱 */
function play(o: { n?: number; manual?: boolean; unit?: boolean; minutes?: number } = {}) {
  const h = gameWith(o.n ?? 3, { playUnit: o.unit ? 'unit' : 'lesson', minutes: o.minutes ?? 10 });
  let t = 0;
  const run = (i: SessionInput, at: number) => h.run(i, at);
  if (o.manual) run({ type: 'teacher', action: { type: 'updateSettings', settings: { progressMode: 'manual' } } }, T0 - 10);
  run({ type: 'teacher', action: { type: 'startTrade' } }, T0);
  const to = (sec: number) => {
    for (; t < sec; ) {
      t += 1;
      run({ type: 'tick' }, T0 + t * 1000);
    }
  };
  const teacher = (action: Record<string, unknown>) => run({ type: 'teacher', action } as unknown as SessionInput, T0 + t * 1000);
  const card = (ui: NowUi = UI, v: Partial<NowView> = {}) => nowCard(h.get(), viewOf(h.get(), v), T0 + t * 1000, ui);
  return { h, to, teacher, card, now: () => T0 + t * 1000 };
}

const subText = (c: NowCard) => c.sub.map((s) => s.text).join(' | ');
const allText = (c: NowCard) => [c.tag, c.line, subText(c), c.primary?.label ?? '', c.secondary?.label ?? '', ...c.notes.map((n) => n.text), c.tv.text].join(' / ');

describe('우선순위 표(PRD 7.5.2.1)', () => {
  it('13줄의 우선 번호', () => {
    expect(NOW_PRIORITY).toEqual({
      disconnected: 1, replaced: 1, paused: 2, ended: 3, wrapup: 4, timeUp: 5, result: 6, worksheet: 7, respond: 8, card: 9, round: 10, waiting: 11, ready: 12, lobby: 13,
    });
  });
});

describe('13 입장 대기 / 12 무역 시작 전', () => {
  it('13: 학생 0명 — [무역 시작] 보조 색·비활성 + 까닭, 준비 체크 3줄, [공용 화면 창 열기]', () => {
    const h = gameWith(0);
    const c = nowCard(h.get(), viewOf(h.get()), T0, { screenConnected: false });
    expect(c.state).toBe('lobby');
    expect(c.priority).toBe(13);
    expect(c.tag).toBe('준비');
    expect(c.line).toBe('학생들이 들어오고 있어요 · 방 코드 304871');
    expect(c.primary).toMatchObject({ label: '무역 시작', kind: 'startTrade', testId: 'btn-start-trade', tone: 'secondary', disabled: true, reason: '학생이 1명 이상 들어오면 눌러요' });
    expect(c.sub.map((s) => s.check)).toEqual([false, false, false]);
    expect(c.sub[1]!.text).toBe('② 학생 입장 · 들어온 0 · 회사 만든 0 · 만드는 중 0');
    expect(c.secondary).toMatchObject({ label: '공용 화면 창 열기', kind: 'openScreen' });
    expect(c.showPause).toBe(false);
    expect(c.tv.kind).toBe('off');
    expect(c.tv.text).toBe('TV 화면 창이 열려 있지 않아요');
  });

  it('13: 회사를 만드는 중인 학생이 있으면 입장 대기(그래도 [무역 시작]은 누를 수 있음), TV가 연결되면 ① ✓', () => {
    const h = gameWith(2);
    h.run({ type: 'join', seat: 3, pid: 'p00003', companyName: '늦은배무역', nameKey: 'k3', nameStatus: 'ok' }, 300);
    const c = nowCard(h.get(), viewOf(h.get()), T0, UI);
    expect(c.state).toBe('lobby');
    expect(c.sub[0]!.check).toBe(true);
    expect(c.sub[1]!.text).toBe('② 학생 입장 · 들어온 3 · 회사 만든 2 · 만드는 중 1');
    expect(c.primary).toMatchObject({ kind: 'startTrade', disabled: false });
    expect(c.secondary).toBeNull();
  });

  it('12: 모두 회사를 만들었으면 [무역 시작](주 색) + 첫 순서 한 줄 + [새 학생 그만 받기]', () => {
    const h = gameWith(3);
    const c = nowCard(h.get(), viewOf(h.get()), T0, UI);
    expect(c.state).toBe('ready');
    expect(c.tag).toBe('준비 3/3');
    expect(c.line).toBe('모두 들어왔으면 무역을 시작하세요');
    expect(subText(c)).toContain('들어온 학생 3 · 회사 만든 학생 3');
    expect(subText(c)).toContain('먼저 벽란도 시장·무역·수입·수출을 하고 약 3분 50초 뒤 라운드 1');
    expect(c.primary).toMatchObject({ label: '무역 시작', kind: 'startTrade', tone: 'primary' });
    expect(c.secondary).toMatchObject({ label: '새 학생 그만 받기', kind: 'lock' });
    expect(nowCard(h.get(), viewOf(h.get(), { locked: true }), T0, UI).secondary!.label).toBe('새 학생 다시 받기');
  });
});

describe('자동 진행 — 차시 L1 10분', () => {
  it('9: 차시 표지 → "n초 뒤 저절로 다음", [다음으로] = 표지 끝내고 벽란도 시작(fireNow clear)', () => {
    const p = play();
    p.to(5);
    const c = p.card();
    expect(c.state).toBe('card');
    expect(c.priority).toBe(9);
    expect(c.line).toBe('1차시 표지를 TV에 보여 주는 중');
    expect(subText(c)).toContain('차시 질문을 함께 읽어요');
    expect(subText(c)).toContain('15초 뒤 저절로 다음: 벽란도 시장');
    expect(c.primary).toMatchObject({ label: '다음으로', kind: 'next', itemId: 'ev:L1-E1' });
    expect(c.showPause).toBe(true);
    // 실제로 누르면: 표지가 끝나고 벽란도가 바로 열린다
    p.teacher({ type: 'fireNow', id: 'ev:L1-E1', clear: true });
    expect(p.h.get().class.currentEvent).toMatchObject({ id: 'L1-E1', closed: false });
    expect(p.h.get().class.schedule.items.find((it) => it.id === 'cover:L1')!.status).toBe('done');
    expect(p.card().state).toBe('respond');
  });

  it('8: 응답 받는 활동(벽란도) — "학생 k/n 응답 · n초 뒤 저절로 다음", 반 미만이면 응답 없음 안내, [다음으로] = 응답 받기 끝내기', () => {
    const p = play();
    p.to(30);
    const c = p.card();
    expect(c.state).toBe('respond');
    expect(c.tag).toBe('사전 활동 1/2');
    expect(c.line).toBe('벽란도 시장 하는 중');
    expect(c.eventId).toBe('L1-E1');
    expect(c.sub[0]).toMatchObject({ text: '학생 0/3 응답', testId: 'tl-resp-count' });
    expect(subText(c)).toContain('2:20 뒤 저절로 다음: 무역·수입·수출');
    expect(subText(c)).toContain("아직 응답 안 한 학생은 '응답 없음'이 돼요");
    expect(c.primary).toMatchObject({ label: '다음으로', kind: 'closeEvent', testId: 'btn-close-event' });
    // 결과 막대가 없는 활동 — 작은 글자 자리는 라운드 1 전 [라운드 바로 시작](수정 1회차)
    expect(c.secondary).toMatchObject({ label: '라운드 바로 시작', kind: 'roundNow' });
  });

  it('11: 활동을 일찍 끝내면 다음 항목 기다림 — [지금 시작] + [라운드 바로 시작]', () => {
    const p = play();
    p.to(30);
    p.teacher({ type: 'closeEvent', reveal: true });
    const c = p.card();
    expect(c.state).toBe('waiting');
    expect(c.tag).toBe('사전 활동 2/2');
    expect(c.line).toBe('다음: 무역·수입·수출 · 2:20 뒤');
    expect(subText(c)).toBe('학생 화면에는 남은 시간이 보여요');
    expect(c.primary).toMatchObject({ label: '지금 시작', kind: 'startItem', itemId: 'ev:L1-E2' });
    expect(c.secondary).toMatchObject({ label: '라운드 바로 시작', kind: 'roundNow' });
  });

  it('9 → 11: 개념 카드(무역·수입·수출) 다음은 라운드 1 — 카드를 끝내면 "라운드 1까지 m:ss" + [라운드 지금 시작]', () => {
    const p = play();
    p.to(180);
    let c = p.card();
    expect(c.state).toBe('card');
    expect(c.tag).toBe('사전 활동 2/2');
    expect(c.line).toBe('무역·수입·수출을 TV에 보여 주는 중');
    expect(subText(c)).toContain('50초 뒤 저절로 다음: 라운드 1');
    p.teacher({ type: 'closeEvent', reveal: true });
    c = p.card();
    expect(c.state).toBe('waiting');
    expect(c.line).toBe('라운드 1까지 0:50');
    expect(c.primary).toMatchObject({ label: '라운드 지금 시작', kind: 'roundNow', testId: 'btn-round-now', disabled: false });
    expect(c.secondary).toBeNull();
  });

  it('10: 라운드 — 남은 시간·항해 준비 수·다음, [라운드 끝내기] 보조 색 → 모두 준비면 주 색 + 문구', () => {
    const p = play();
    p.to(240);
    const c = p.card();
    expect(c.state).toBe('round');
    expect(c.tag).toBe('라운드 1/2');
    expect(c.line).toBe('라운드 1 · 학생들이 사고팔고 항해하는 중');
    expect(subText(c)).toContain('라운드 1 남은 1:20');
    expect(c.sub.find((s) => s.testId === 'ready-count')!.text).toBe('항해 준비 끝낸 학생 0/3');
    expect(subText(c)).toContain('다음: 두 섬 이야기');
    expect(c.primary).toMatchObject({ label: '라운드 끝내기', kind: 'endRound', testId: 'btn-end-round', tone: 'secondary' });
    // 모두 항해 준비
    const g = p.h.get();
    const players = Object.fromEntries(Object.entries(g.players).map(([k, pl]) => [k, { ...pl, game: { ...pl.game, ready: true } }]));
    const all = nowCard({ ...g, players }, viewOf(g), p.now(), UI);
    expect(all.line).toBe('모두 준비됐어요 — 라운드를 끝낼까요?');
    expect(all.primary!.tone).toBe('primary');
  });

  it('7: 학습지 ③★ 지금 쓰기 — 다 쓴 학생 수·닫히는 시간, [다음으로] = 학습지 모두 닫기, [아직 안 쓴 학생 보기]', () => {
    const p = play();
    p.to(475);
    const c = p.card();
    expect(c.state).toBe('worksheet');
    expect(c.tag).toBe('학습지');
    expect(c.line).toBe('학습지 ③★ 지금 바로 쓰기');
    expect(c.sub[0]).toMatchObject({ text: '다 쓴 학생 0/3' });
    expect(subText(c)).toContain('35초 뒤 저절로 닫혀요');
    expect(c.primary).toMatchObject({ label: '다음으로', kind: 'closeWorksheet' });
    expect(c.secondary).toMatchObject({ label: '아직 안 쓴 학생 보기', kind: 'showNoWorksheet' });
  });

  it('(수정 1회차, PRD 7.5.2.1 예외) 라운드 중 결정 패널이 열려도 라운드 카드: [라운드 끝내기] 그대로, 결정 진행은 보조 정보 + 작은 글자 [응답 받기 끝내기], 결과도 보조 정보', () => {
    const p = play();
    p.to(520);
    let c = p.card();
    expect(c.state).toBe('round');
    expect(c.line).toBe('라운드 2 · 학생들이 사고팔고 항해하는 중');
    expect(c.tag).toBe('라운드 2/2');
    expect(c.primary).toMatchObject({ label: '라운드 끝내기', kind: 'endRound', testId: 'btn-end-round' });
    expect(c.sub.find((x) => x.testId === 'tl-resp-count')).toMatchObject({ text: '흑연을 어디서 살까요? 학생 0/3 응답', eventId: 'L1-E7' });
    expect(c.secondary).toMatchObject({ label: '응답 받기 끝내기', kind: 'closeEvent', testId: 'btn-close-event' });
    p.teacher({ type: 'closeEvent', reveal: true });
    c = p.card();
    expect(c.state).toBe('round');
    expect(c.primary!.kind).toBe('endRound');
    const r = c.sub.find((x) => x.testId === 'tl-result')!;
    expect(r.text).toMatch(/^흑연을 어디서 살까요\? 결과를 TV에 보여 주는 중 · 20초$/);
    expect(r.eventId).toBe('L1-E7');
    expect(c.secondary).toMatchObject({ label: '결과 닫기', kind: 'endResult', testId: 'btn-end-result' });
    p.teacher({ type: 'endResult' });
    expect(p.card().secondary).toBeNull();
  });

  it('(수정 1회차) 라운드 중 결정이 열려 있어도 모두 항해 준비면 "모두 준비됐어요" + 주 색', () => {
    const p = play();
    p.to(520);
    const g = p.h.get();
    const players = Object.fromEntries(Object.entries(g.players).map(([k, pl]) => [k, { ...pl, game: { ...pl.game, ready: true } }]));
    const c = nowCard({ ...g, players }, viewOf(g), p.now(), UI);
    expect(c.state).toBe('round');
    expect(c.line).toBe('모두 준비됐어요 — 라운드를 끝낼까요?');
    expect(c.primary!.tone).toBe('primary');
  });

  it('8: 라운드 밖 응답 활동 — 응답이 모두 모이면 "모두 응답했어요"', () => {
    const p = play();
    p.to(520);
    for (const s of [1, 2, 3]) p.h.run({ type: 'act', seat: s, seq: 50, action: { type: 'respondEvent', eventId: 'L1-E7', response: { choice: 'SHA' } } }, p.now());
    const g = p.h.get();
    const between: TeacherGame = { ...g, class: { ...g.class, phase: 'between' } };
    const c = nowCard(between, viewOf(between), p.now(), UI);
    expect(c.state).toBe('respond');
    expect(c.sub[0]!.text).toBe('학생 3/3 응답');
    expect(subText(c)).toContain('모두 응답했어요');
  });

  it('(수정 1회차) [라운드 끝내기] 확인: 마지막 라운드면 "무역을 마치고 마무리로", 결정을 안 한 학생은 응답 없음, 모두 준비·전원 응답이면 확인 없음', () => {
    const p = play();
    p.to(240);
    let k = endRoundConfirm(p.h.get(), 3, p.now());
    expect(k.needed).toBe(true);
    expect(k.title).toBe('라운드를 지금 끝낼까요?');
    expect(k.body).toBe('라운드가 1:20 남았어요. 지금 끝내면 학생들의 거래가 멈추고 다음 순서로 넘어가요.');
    p.to(530);
    k = endRoundConfirm(p.h.get(), 3, p.now());
    expect(k.needed).toBe(true);
    expect(k.title).toBe('마지막 라운드를 끝낼까요?');
    expect(k.body).toBe("마지막 라운드예요. 지금 끝내면 무역을 마치고 마무리(결산·시상)로 넘어가요. 남은 무역 시간 1:10는 쓰지 않아요. 아직 결정하지 않은 학생은 '응답 없음'이 돼요(3명).");
    // 실제로 그렇게 된다
    p.teacher({ type: 'endRound' });
    p.to(532);
    expect(p.h.get().class.phase).toBe('wrapup');
    // 모두 준비 + 결정 없음이면 확인 없음
    const q = play();
    q.to(240);
    const g = q.h.get();
    const players = Object.fromEntries(Object.entries(g.players).map(([key, pl]) => [key, { ...pl, game: { ...pl.game, ready: true } }]));
    expect(endRoundConfirm({ ...g, players }, 3, q.now()).needed).toBe(false);
    // 모두 준비여도 결정을 안 한 학생이 있으면 확인
    q.to(520);
    const g2 = q.h.get();
    const players2 = Object.fromEntries(Object.entries(g2.players).map(([key, pl]) => [key, { ...pl, game: { ...pl.game, ready: true } }]));
    expect(endRoundConfirm({ ...g2, players: players2 }, 3, q.now()).needed).toBe(true);
  });

  it('(수정 1회차) 라운드 1 전 사전 활동 카드에 작은 글자 [라운드 바로 시작] — 다음이 라운드면 없음', () => {
    const p = play();
    p.to(5);
    expect(p.card().secondary).toMatchObject({ label: '라운드 바로 시작', kind: 'roundNow', testId: 'now-round-now' });
    p.to(30);
    expect(p.card().secondary).toMatchObject({ label: '라운드 바로 시작', kind: 'roundNow' });
    p.to(180);
    expect(p.card().state).toBe('card');
    expect(p.card().secondary).toBeNull(); // 다음이 라운드 1 — 큰 버튼 [다음으로]가 그 일
  });

  it('2: 잠깐 멈춤이 라운드·활동보다 먼저 — [이어서 하기], [잠깐 멈춤]은 숨김', () => {
    const p = play();
    p.to(240);
    p.teacher({ type: 'pause' });
    const c = p.card();
    expect(c.state).toBe('paused');
    expect(c.priority).toBe(2);
    expect(c.line).toBe('잠깐 멈춤 중이에요');
    expect(c.sub[0]!.text).toBe("학생 화면에 '선생님을 보세요'가 떠 있고 시계도 멈췄어요");
    expect(c.primary).toMatchObject({ label: '이어서 하기', kind: 'resume', testId: 'btn-resume-trade' });
    expect(c.showPause).toBe(false);
  });

  it('5: 무역 시간이 끝났는데 활동 중 — [지금 마무리로](확인 없음) + [이 활동 끝나고] → 누르면 작은 버튼만 사라짐', () => {
    const p = play();
    p.to(30);
    const g = p.h.get();
    const tu: TeacherGame = { ...g, class: { ...g.class, schedule: { ...g.class.schedule, timeUp: { at: p.now() } } } };
    let c = nowCard(tu, viewOf(tu), p.now(), UI);
    expect(c.state).toBe('timeUp');
    expect(c.tag).toBe('마무리 직전');
    expect(c.line).toBe('무역 시간이 끝났어요');
    expect(c.sub[0]!.text).toBe('지금 활동이 끝나면(최대 2분) 저절로 마무리로 넘어가요');
    expect(c.primary).toMatchObject({ label: '지금 마무리로', kind: 'finishNow', testId: 'btn-finish-now' });
    expect(c.secondary).toMatchObject({ label: '이 활동 끝나고', kind: 'dismissTimeUp', testId: 'btn-after-activity' });
    c = nowCard(tu, viewOf(tu), p.now(), { ...UI, timeUpDismissed: true });
    expect(c.state).toBe('timeUp');
    expect(c.secondary).toBeNull();
  });

  it('4: 무역 시간이 끝나면 첫 마무리 항목(결산·시상)이 저절로 시작 → [다음으로: 되돌아보기] … 마지막 [수업 끝내기] + [결과 파일 저장]', () => {
    const p = play();
    p.to(605);
    const g = p.h.get();
    expect(g.class.tradeEnded).toBe(true);
    expect(g.wrapProgress).toEqual({ settle: 'done', awards: 'live' });
    let c = p.card();
    expect(c.state).toBe('wrapup');
    expect(c.priority).toBe(4);
    expect(c.tag).toBe('마무리 1/3');
    expect(c.line).toBe('결산·시상 하는 중');
    expect(subText(c)).toContain('TV에서 상을 차례로 보여 줘요');
    expect(subText(c)).toContain('다음: 되돌아보기');
    expect(c.primary).toMatchObject({ label: '다음으로: 되돌아보기', kind: 'wrapNext', wrapId: 'awards', nextWrapId: 'reflect' });
    expect(c.secondary).toMatchObject({ label: '이 항목 건너뛰기', kind: 'wrapSkip' });
    p.teacher({ type: 'setWrapStep', id: 'awards', status: 'done' });
    p.teacher({ type: 'setWrapStep', id: 'reflect', status: 'live' });
    c = p.card();
    expect(c.tag).toBe('마무리 2/3');
    expect(c.primary!.nextWrapId).toBe('afterWorksheet');
    p.teacher({ type: 'setWrapStep', id: 'reflect', status: 'done' });
    p.teacher({ type: 'setWrapStep', id: 'afterWorksheet', status: 'live' });
    c = p.card();
    expect(c.tag).toBe('마무리 3/3');
    expect(c.sub[0]!.pdfLink).toBe(true);
    expect(c.sub[0]!.text).toContain('항해 기록장을 보며 써요');
    expect(c.primary).toMatchObject({ label: '수업 끝내기', kind: 'endSession' });
    expect(c.secondary).toMatchObject({ label: '결과 파일 저장', kind: 'saveResult' });
    // 끝 항목도 끝내면 "마무리를 모두 했어요" + [수업 끝내기]
    p.teacher({ type: 'setWrapStep', id: 'afterWorksheet', status: 'done' });
    c = p.card();
    expect(c.line).toBe('마무리를 모두 했어요');
    expect(c.primary!.kind).toBe('endSession');
  });

  it('3: 판 끝 — [처음으로] + [결과 파일 저장], 멈춤이어도 끝이 먼저', () => {
    const p = play();
    p.to(40);
    p.teacher({ type: 'pause' });
    p.teacher({ type: 'endSession' });
    const c = p.card(UI, { ended: true, status: 'closed' });
    expect(c.state).toBe('ended');
    expect(c.line).toBe('수업이 끝났어요');
    expect(c.sub[0]!.text).toBe('이 브라우저의 기록은 24시간 뒤 저절로 지워져요');
    expect(c.primary).toMatchObject({ label: '처음으로', kind: 'exit', testId: 'btn-exit' });
    expect(c.secondary).toMatchObject({ label: '결과 파일 저장', kind: 'saveResult' });
    expect(c.showPause).toBe(false);
  });

  it('1: 서버 끊김·다른 탭이 가져감 — 큰 버튼 없음, 모든 상태보다 먼저', () => {
    const p = play();
    p.to(240);
    p.teacher({ type: 'pause' });
    const d = p.card(UI, { status: 'reconnecting', connection: 'reconnecting' });
    expect(d.state).toBe('disconnected');
    expect(d.priority).toBe(1);
    expect(d.line).toBe('서버와 다시 연결하고 있어요');
    expect(d.sub[0]!.text).toBe('끊긴 동안은 멈춤으로 처리돼 학생 시간이 줄지 않아요');
    expect(d.primary).toBeNull();
    expect(d.showPause).toBe(false);
    const r = p.card(UI, { status: 'replaced' });
    expect(r.state).toBe('replaced');
    expect(r.line).toBe('다른 탭이나 PC에서 이 판을 이어 가고 있어요');
    expect(r.sub[0]!.text).toBe('이 탭은 멈췄어요');
    expect(r.primary).toBeNull();
  });

  it('겹칠 때: 학습지(7)가 응답 활동(8)보다, 결과(6)가 학습지(7)보다 먼저', () => {
    const p = play();
    p.to(30);
    const g = p.h.get();
    const both: TeacherGame = { ...g, class: { ...g.class, worksheet: { ...g.class.worksheet, current: ['W01'] } } };
    expect(nowCard(both, viewOf(both), p.now(), UI).state).toBe('worksheet');
    const res: TeacherGame = {
      ...both,
      class: { ...both.class, currentEvent: { ...both.class.currentEvent!, closed: true, resultUntil: p.now() + 10_000 } },
    };
    expect(nowCard(res, viewOf(res), p.now(), UI).state).toBe('result');
  });
});

describe('수동 진행(선생님이 하나씩 넘기기)', () => {
  it('큰 버튼은 [다음으로](btn-fire = 옛 [발동]), 문구 "선생님이 [다음으로]를 눌러야 넘어가요" — 표지부터 라운드 1까지 [다음으로]만', () => {
    const p = play({ manual: true });
    p.to(5);
    let c = p.card();
    expect(c.manual).toBe(true);
    // 수동 진행은 표지도 저절로 뜨지 않는다 → 기다리는 항목 "다음: 1차시 표지"
    expect(c.state).toBe('waiting');
    expect(c.line).toBe('다음: 1차시 표지');
    expect(c.primary).toMatchObject({ label: '다음으로', kind: 'next', testId: 'btn-fire', itemId: 'cover:L1' });
    expect(subText(c)).toContain(MANUAL_HINT);
    p.teacher({ type: 'fireNow', id: 'cover:L1', clear: true });
    c = p.card();
    expect(c.state).toBe('card');
    expect(c.primary).toMatchObject({ label: '다음으로', kind: 'next', testId: 'btn-fire', itemId: 'ev:L1-E1' });
    expect(subText(c)).toContain(MANUAL_HINT);
    expect(subText(c)).not.toContain('저절로');
    // 시각이 지나도 표지에서 저절로 넘어가지 않는다 → [다음으로]
    p.to(40);
    expect(p.card().state).toBe('card');
    p.teacher({ type: 'fireNow', id: 'ev:L1-E1', clear: true });
    c = p.card();
    expect(c.state).toBe('respond');
    expect(c.primary).toMatchObject({ testId: 'btn-fire', itemId: 'ev:L1-E2' });
    p.teacher({ type: 'fireNow', id: 'ev:L1-E2', clear: true });
    p.teacher({ type: 'fireNow', id: 'r:1', clear: true });
    c = p.card();
    expect(c.state).toBe('round');
    expect(p.h.get().class.round).toBe(1);
  });

  it('10(수동): 라운드 중 선생님을 기다리는 소식·결정은 보조 정보 + 작은 글자 [열기: ○○](btn-fire), 큰 버튼은 [라운드 끝내기]', () => {
    const p = play({ manual: true });
    p.to(2);
    for (const id of ['cover:L1', 'ev:L1-E1', 'ev:L1-E2']) p.teacher({ type: 'fireNow', id, clear: true });
    p.to(235);
    p.teacher({ type: 'fireNow', id: 'r:1', clear: true });
    p.to(240);
    let c = p.card();
    expect(c.state).toBe('round');
    expect(c.primary).toMatchObject({ kind: 'endRound', testId: 'btn-end-round' });
    // 수동 진행에서 라운드를 [다음으로]로 열면 라운드에 붙은 소식(L1-E6)은 따로 기다린다(134 동작) — 카드에 보이게
    expect(c.sub.find((x) => x.testId === 'tl-waiting')!.text).toBe('부산에 강추위, 천연가스가 필요해요 — 선생님이 열어야 학생 화면에 떠요');
    expect(c.secondary).toMatchObject({ label: '열기: 부산에 강추위, 천연가스가 필요해요', kind: 'next', testId: 'btn-fire', itemId: 'ev:L1-E6' });
    p.teacher({ type: 'fireNow', id: 'ev:L1-E6', clear: true });
    c = p.card();
    expect(subText(c)).toContain("학생 화면에 '부산에 강추위, 천연가스가 필요해요' 소식이 떠 있어요");
  });

  it('11(수동): 기다리는 항목 "다음: ○○" + [다음으로]', () => {
    const p = play({ manual: true });
    p.to(5);
    p.teacher({ type: 'fireNow', id: 'cover:L1', clear: true });
    p.teacher({ type: 'closeEvent', reveal: true });
    const c = p.card();
    expect(c.state).toBe('waiting');
    expect(c.line).toBe('다음: 벽란도 시장');
    expect(c.lineTestId).toBe('tl-waiting');
    expect(c.primary).toMatchObject({ testId: 'btn-fire', kind: 'next', itemId: 'ev:L1-E1' });
    expect(subText(c)).toContain(MANUAL_HINT);
  });
});

describe('알림 줄·TV 꼬리표', () => {
  it('다시 들어오기 요청·같은 번호 시도·이름 확인 → [보기](입장 관리), 5분 뒤 새 학생 그만 받기 제안, 방 코드 바뀜', () => {
    const p = play();
    p.to(301);
    const g = p.h.get();
    const v = viewOf(g, {
      rejoinRequests: [{ seat: 2, companyName: '회사', oldOnline: false, at: 0, peerId: 'x' }] as NowView['rejoinRequests'],
      codeChanged: { from: '304871', to: '123456' },
    });
    v.seats = v.seats.map((s) => (s.seat === 3 ? { ...s, nameStatus: 'checkRealName' as const } : s));
    const c = nowCard(g, v, p.now(), { ...UI, seatProblems: 1 });
    expect(c.notes.map((n) => n.text)).toEqual([
      '다른 기기에서 다시 들어오기 요청 1명',
      '같은 번호로 다른 이름 입장 시도 1건',
      '이름 확인이 필요한 회사 1',
      '무역 시작 5분이 지났어요. 새 학생을 그만 받을까요?',
      '방 코드가 바뀌었어요: 123456',
    ]);
    expect(c.notes[0]!.buttons[0]).toMatchObject({ label: '보기', kind: 'showFold', fold: 'entry' });
    expect(c.notes[3]!.buttons.map((b) => b.label)).toEqual(['그만 받기', '계속 받기']);
    expect(nowCard(g, viewOf(g, { locked: true }), p.now(), UI).notes).toEqual([]);
    expect(nowCard(g, viewOf(g), p.now(), { ...UI, lockSuggestDismissed: true }).notes).toEqual([]);
  });

  it('TV: 연결 안 됨(회색 [열기]) / 알아서 바꾸기("TV: 장면") / 손으로 고정(주황 [알아서 바꾸기로])', () => {
    const p = play();
    p.to(30);
    expect(p.card({ screenConnected: false }).tv).toMatchObject({ kind: 'off', text: 'TV 화면 창이 열려 있지 않아요', button: { label: '열기', kind: 'openScreen' } });
    expect(p.card().tv).toMatchObject({ kind: 'auto', text: 'TV: 벽란도 시장 카드', scene: 'event', button: null });
    p.teacher({ type: 'setScreenScene', scene: 'leaderboard' });
    expect(p.card().tv).toMatchObject({ kind: 'fixed', text: "TV가 '순위판'에 고정돼 있어요", button: { label: '알아서 바꾸기로', kind: 'autoScene' } });
    p.teacher({ type: 'setScreenScene', scene: 'auto' });
    p.to(240);
    // 라운드 1에는 천연가스 소식 패널이 함께 떠 있어 그 카드 → 패널을 닫으면 해도
    expect(p.card().tv.text).toBe('TV: 부산에 강추위, 천연가스가 필요해요 카드');
    p.teacher({ type: 'closeEvent', reveal: true });
    expect(p.card().tv).toMatchObject({ text: 'TV: 해도', scene: 'map' });
    p.teacher({ type: 'pause' });
    expect(p.card().tv.text).toBe("TV: '선생님을 보세요'");
  });
});

describe('단원 한 판(배치표 표본) — 문구에 L1·옛 말을 박지 않는다', () => {
  it('25분 단원 판을 끝까지 돌리며 모든 카드 문구에 "L1~L4"·옛 말이 없다', () => {
    const p = play({ unit: true, minutes: 25 });
    const seen = new Set<string>();
    for (let s = 1; s <= 25 * 60 + 12; s += 7) {
      p.to(s);
      const c = p.card();
      seen.add(c.state);
      const text = allText(c);
      expect(text, `${s}초 ${c.state}`).not.toMatch(/\bL[1-4]\b/);
      expect(text, `${s}초 ${c.state}`).not.toMatch(OLD_TEACHER_TERMS);
      expect(c.primary, `${s}초 ${c.state}`).not.toBeNull();
    }
    expect([...seen].sort()).toEqual(['card', 'respond', 'result', 'round', 'worksheet', 'wrapup']);
    // 첫 표지는 "1차시 표지", 라운드 꼬리표는 판 전체 라운드 수
    const q = play({ unit: true, minutes: 25 });
    q.to(3);
    expect(q.card().line).toMatch(/^1차시 표지를 TV에 보여 주는 중$/);
  });

  it('차시 L1 10분 판도 같은 검사(옛 말 없음, 무역 시작 뒤 큰 버튼은 늘 하나)', () => {
    const p = play();
    for (let s = 1; s <= 605; s += 3) {
      p.to(s);
      const c = p.card();
      expect(allText(c), `${s}초`).not.toMatch(OLD_TEACHER_TERMS);
      expect(c.primary, `${s}초 ${c.state}`).not.toBeNull();
    }
  });
});

describe('마무리 첫 항목 자동 시작(PRD 7.5.2.9) — 호스트 상태, 한 번만', () => {
  it('무역이 끝나는 입력에서만 시작하고, 뒤의 틱·복구(같은 스냅숏 다시 넣기)에서는 다시 시작하지 않는다', () => {
    const p = play();
    p.to(30);
    p.teacher({ type: 'finishNow' });
    const g1 = p.h.get();
    expect(g1.wrapAutoStarted).toBe(true);
    expect(g1.wrapProgress).toEqual({ settle: 'done', awards: 'live' });
    // 교사가 결산을 건너뛰고 되돌아보기를 시작
    p.teacher({ type: 'setWrapStep', id: 'awards', status: 'skipped' });
    p.teacher({ type: 'setWrapStep', id: 'reflect', status: 'live' });
    p.to(200);
    expect(p.h.get().wrapProgress).toEqual({ settle: 'done', awards: 'skipped', reflect: 'live' });
    // 새로 고침(저장된 스냅숏으로 다시 시작) 뒤 틱
    const restored = teacherReducer(p.h.get(), { type: 'tick' }, p.now() + 1000).snapshot;
    expect(restored.wrapProgress).toEqual({ settle: 'done', awards: 'skipped', reflect: 'live' });
    // 이미 끝난 판끼리는 아무것도 하지 않는다
    expect(autoStartWrap(g1, { ...g1, wrapAutoStarted: false })).toBeNull();
  });

  it('첫 항목 = 내용이 있는 첫 항목(0분 정산 제외), 교사가 이미 무엇을 시작했으면 건드리지 않음', () => {
    const p = play();
    p.to(30);
    const g = p.h.get();
    const items = [
      { id: 'settle', label: '마지막 라운드 정산', minutes: 0, worksheetIds: [] },
      { id: 'awards', label: '결산·시상', minutes: 3, worksheetIds: [] },
    ] as never;
    expect(firstWrapStep(items)!.id).toBe('awards');
    const ended: TeacherGame = { ...g, class: { ...g.class, tradeEnded: true, phase: 'wrapup', schedule: { ...g.class.schedule, wrapup: items } }, wrapProgress: { awards: 'live' } };
    expect(autoStartWrap(g, ended)).toMatchObject({ wrapAutoStarted: true, wrapProgress: { awards: 'live' } });
  });
});

describe('(수정 1회차) core 배치 경고 → 교사 쉬운 말', () => {
  it("'L2'·'구간' → '2차시'·'차시'", () => {
    expect(teacherWarningText('L2 활동이 많아 무역 시간을 넘겨요')).toBe('2차시 활동이 많아 무역 시간을 넘겨요');
    expect(teacherWarningText('시간이 짧아 ⑭ 지금 쓰기를 넣지 못했어요(구간 끝에 써요)')).toBe('시간이 짧아 ⑭ 지금 쓰기를 넣지 못했어요(차시 끝에 모아서 써요)');
  });
});
