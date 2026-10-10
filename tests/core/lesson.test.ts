import { describe, expect, it } from 'vitest';
import { applyTeacherAction, catchUpQueue } from '../../src/core/lesson';
import { applyAction } from '../../src/core/rules';
import { normalizeClass, normalizePlayer, normalizeSnapshot } from '../../src/core/types';
import { stageStartByLesson } from '../../src/data/schedule';
import { act, makeSession, player, run, teach } from './helpers';

describe('구간별 시작 조건(PRD 4.2.3)', () => {
  it('L2로 시작하면 800만 원·12항구·공장', () => {
    let s = makeSession({ n: 2, scope: ['L2'], playUnit: 'lesson' });
    expect(player(s, 1).game.money).toBe(800);
    expect(s.class.openPorts).toHaveLength(12);
    expect(s.class.features).toEqual(expect.arrayContaining(['market', 'factory']));
    s = teach(s, { type: 'startRound' });
    // 공장 사용 가능(재료가 있으면)
    s = { ...s, players: { ...s.players, s01: { ...player(s, 1), game: { ...player(s, 1).game, cargo: [{ good: 'iron', qty: 2, unitCost: 18, origin: 'foreign', source: 'specialty', boughtAt: 'PHE' }] } } } };
    expect(applyAction(s.class, player(s, 1), { type: 'produce', recipe: 'steel', qty: 1 }).error).toBeUndefined();
  });

  it.each([
    ['L1', 500, 6],
    ['L3', 1000, 12],
    ['L4', 1200, 12],
  ] as const)('%s 시작: %i만 원, 항구 %i곳', (stage, money, ports) => {
    const s = makeSession({ n: 1, scope: [stage] });
    expect(player(s, 1).game.money).toBe(money);
    expect(s.class.openPorts).toHaveLength(ports);
    expect(s.class.features).toEqual([...stageStartByLesson[stage].features]);
  });

  it('L1 판에서는 공장을 쓸 수 없다', () => {
    let s = teach(makeSession({ n: 1, scope: ['L1'] }), { type: 'startRound' });
    s = { ...s, players: { ...s.players, s01: { ...player(s, 1), game: { ...player(s, 1).game, cargo: [{ good: 'iron', qty: 2, unitCost: 18, origin: 'foreign', source: 'specialty', boughtAt: 'PHE' }] } } } };
    expect(applyAction(s.class, player(s, 1), { type: 'produce', recipe: 'steel', qty: 1 }).error).toBe('NO_FACTORY');
  });

  it('단원 한 판: 구간 전환 때 항구·기능이 열리고 구간 표지가 뜬다, L1 효과는 끝난다', () => {
    let s = makeSession({ n: 1, scope: ['L1', 'L2', 'L3', 'L4'], playUnit: 'unit' });
    s = teach(s, { type: 'startStage', stage: 'L1' });
    expect(s.class.currentEvent?.id).toBe('L1-COVER');
    expect(s.class.phase).toBe('event');
    s = teach(s, { type: 'closeEvent' });
    s = teach(s, { type: 'fireEvent', id: 'L1-E6' });
    expect(s.class.activeEffects.some((e) => e.effect.type === 'priceTag')).toBe(true);
    expect(player(s, 1).game.missions['M-GAS']?.status).toBe('active');
    s = teach(s, { type: 'startRound' });
    s = teach(s, { type: 'endRound' });
    s = teach(s, { type: 'startStage', stage: 'L2' });
    expect(s.class.stage).toBe('L2');
    expect(s.class.openPorts).toHaveLength(12);
    expect(s.class.features).toContain('factory');
    expect(s.class.currentEvent?.id).toBe('L2-E1');
    expect(s.class.activeEffects.some((e) => e.effect.type === 'priceTag')).toBe(false);
    expect(s.class.stageFirstRound).toBeNull();
  });
});

describe('사건(PRD 6.11.2)', () => {
  it('1등급 사건 건너뛰기는 확인이 필요하다', () => {
    const s = makeSession({ n: 1 });
    const r = applyTeacherAction(s.class, { type: 'skipEvent', id: 'L1-E2' }, 0);
    expect(r.needsConfirm).toBe('REQUIRED_EVENT');
    expect(applyTeacherAction(s.class, { type: 'skipEvent', id: 'L1-E2', confirm: true }, 0).needsConfirm).toBeUndefined();
    expect(applyTeacherAction(s.class, { type: 'skipEvent', id: 'L1-E4' }, 0).needsConfirm).toBeUndefined();
  });

  it('차단형 사건은 라운드 중에 발동하지 않는다', () => {
    const s = teach(makeSession({ n: 1 }), { type: 'startRound' });
    expect(applyTeacherAction(s.class, { type: 'fireEvent', id: 'L1-E5' }, 0).error).toBe('ROUND_IN_PROGRESS');
    expect(applyTeacherAction(s.class, { type: 'fireEvent', id: 'L1-E7' }, 0).error).toBeUndefined();
  });

  it('벽란도: 기기가 보낸 답으로 호스트가 채점, 맞힌 수 × 20(최대 180), 짧은 형태는 × 36', () => {
    let s = teach(makeSession({ n: 2 }), { type: 'fireEvent', id: 'L1-E1' });
    const all = { silk: 'sold', medicine: 'sold', books: 'sold', instrument: 'sold', jewel: 'sold', hemp: 'bought', ramie: 'bought', ginseng: 'bought', paper: 'bought' };
    const r = act(s, 1, { type: 'respondEvent', eventId: 'L1-E1', response: { answers: all } });
    expect(player(r.snapshot, 1).game.money).toBe(500 + 180);
    const half = { ...all, silk: 'bought', paper: 'sold' };
    const r2 = act(r.snapshot, 2, { type: 'respondEvent', eventId: 'L1-E1', response: { answers: half } });
    expect(player(r2.snapshot, 2).game.money).toBe(500 + 7 * 20);
    expect(act(r2.snapshot, 2, { type: 'respondEvent', eventId: 'L1-E1', response: { answers: all } }).outputs.find((o) => o.kind === 'ack')).toMatchObject({ ok: false, error: 'ANSWERED' });
    s = teach(makeSession({ n: 1 }), { type: 'fireEvent', id: 'L1-E1', short: true });
    const r3 = act(s, 1, { type: 'respondEvent', eventId: 'L1-E1', response: { answers: all } });
    expect(player(r3.snapshot, 1).game.money).toBe(500 + 180);
    expect(player(r3.snapshot, 1).game.responses['L1-E1']).toEqual({ correct: 5, total: 5 });
  });

  it('두 섬: 성공 조합이면 +50·도감, 실패면 다시', () => {
    const s = teach(makeSession({ n: 1 }), { type: 'fireEvent', id: 'L1-E5' });
    expect(act(s, 1, { type: 'respondEvent', eventId: 'L1-E5', response: { riceDays: { A: 5, B: 5 }, units: 0 } }).outputs.find((o) => o.kind === 'ack')).toMatchObject({ error: 'TRY_AGAIN' });
    const ok = act(s, 1, { type: 'respondEvent', eventId: 'L1-E5', response: { riceDays: { A: 2, B: 10 }, units: 10 } }).snapshot;
    expect(player(ok, 1).game.money).toBe(550);
    expect(player(ok, 1).game.metrics.dex).toContain('trade-benefit');
  });

  it('따라잡기: 늦게 온 학생은 지난 개인 응답 사건을 받는다', () => {
    let s = makeSession({ n: 1 });
    s = teach(s, { type: 'fireEvent', id: 'L1-E1' });
    s = teach(s, { type: 'closeEvent' });
    s = teach(s, { type: 'fireEvent', id: 'L1-E2' });
    s = teach(s, { type: 'closeEvent' });
    s = teach(s, { type: 'fireEvent', id: 'L1-E6' });
    s = run(s, { type: 'join', seat: 9, pid: 'late09', deviceToken: 'tok-late-9', companyName: '늦은무역', nameKey: '늦은무역' }).snapshot;
    const late = player(s, 9);
    expect(catchUpQueue(s.class, late)).toEqual(['L1-E3', 'L1-E1']);
    // 지난 임무는 들어오자마자 시작되어 있다
    expect(late.game.missions['M-GAS']?.status).toBe('active');
    // 응답하지 않는 개념 사건 카드는 요약으로 받음
    expect(late.game.metrics.dex).toContain('trade-def');
  });
});

describe('학습지 팝업(PRD 7.7)', () => {
  it('라운드 중이면 예약 → 라운드가 끝나는 순간 뜬다', () => {
    let s = teach(makeSession({ n: 2 }), { type: 'startRound' });
    s = teach(s, { type: 'openWorksheet', ids: 'W01' });
    expect(s.class.worksheet.current).toBeNull();
    expect(s.class.worksheet.pending).toEqual([['W01']]);
    expect(s.class.phase).toBe('round');
    s = teach(s, { type: 'endRound' }, 5000);
    expect(s.class.phase).toBe('worksheet');
    expect(s.class.worksheet.current).toEqual(['W01']);
    expect(s.class.worksheet.openedAt).toBe(5000);
    s = teach(s, { type: 'closeWorksheet' });
    expect(s.class.phase).toBe('between');
  });

  it('묶음 팝업: 번호 여러 개를 한 팝업으로, [다 썼어요] 한 번에 모두', () => {
    let s = teach(makeSession({ n: 2 }), { type: 'openWorksheet', ids: ['W01', 'W02', 'W03', 'W04'] });
    expect(s.class.worksheet.current).toEqual(['W01', 'W02', 'W03', 'W04']);
    expect(s.class.phase).toBe('worksheet');
    const r = act(s, 1, { type: 'markWorksheetDone' });
    expect(player(r.snapshot, 1).game.worksheetDone).toEqual(['W01', 'W02', 'W03', 'W04']);
    const pub = r.outputs.find((o) => o.kind === 'public');
    expect(pub && pub.kind === 'public' ? pub.data.public.worksheetDone : null).toEqual({ W01: 1, W02: 1, W03: 1, W04: 1 });
    // 팝업이 떠 있는 동안 라운드를 시작할 수 없다
    expect(applyTeacherAction(r.snapshot.class, { type: 'startRound' }, 0).error).toBe('WORKSHEET_OPEN');
  });

  it('예약이 여러 개면 차례로 뜬다', () => {
    let s = teach(makeSession({ n: 1 }), { type: 'startRound' });
    s = teach(s, { type: 'openWorksheet', ids: 'W01' });
    s = teach(s, { type: 'openWorksheet', ids: ['W02', 'W03'] });
    s = teach(s, { type: 'endRound' });
    expect(s.class.worksheet.current).toEqual(['W01']);
    s = teach(s, { type: 'closeWorksheet' });
    expect(s.class.worksheet.current).toEqual(['W02', 'W03']);
    s = teach(s, { type: 'closeWorksheet' });
    expect(s.class.worksheet.current).toBeNull();
  });
});

describe('일시정지(PRD 7.8)', () => {
  it('라운드 타이머가 멈췄다가 남은 시간으로 이어진다', () => {
    let s = teach(makeSession({ n: 1 }), { type: 'startRound', durationSec: 120 }, 0);
    expect(s.class.roundEndsAt).toBe(120_000);
    s = teach(s, { type: 'pause' }, 30_000);
    expect(s.class.roundEndsAt).toBeNull();
    // 일시정지 중 틱은 라운드를 끝내지 않는다
    s = run(s, { type: 'tick' }, 500_000).snapshot;
    expect(s.class.phase).toBe('round');
    s = teach(s, { type: 'resume' }, 100_000);
    expect(s.class.roundEndsAt).toBe(190_000);
    expect(s.class.clock.pausedTotalSec).toBe(70);
    s = run(s, { type: 'tick' }, 190_000).snapshot;
    expect(s.class.phase).toBe('between');
  });
});

describe('저장 읽기(normalize)', () => {
  it('옛 필드는 무시하고 새 필드 기본값을 채운다', () => {
    const s = makeSession({ n: 1 });
    const raw = JSON.parse(JSON.stringify(s));
    raw.class.settings.nameDisplay = 'companyAndName';
    raw.class.settings.askName = true;
    delete raw.class.settings.nameReview;
    delete raw.class.bannedNameKeys;
    raw.players.s01.name = '홍길동';
    delete raw.players.s01.company.nameStatus;
    const n = normalizeSnapshot(raw)!;
    expect(n).not.toBeNull();
    expect('nameDisplay' in n.class.settings).toBe(false);
    expect('askName' in n.class.settings).toBe(false);
    expect(n.class.settings.nameReview).toBe(false);
    expect(n.class.settings.extraBannedWords).toEqual([]);
    expect(n.class.bannedNameKeys).toEqual([]);
    expect('name' in n.players.s01).toBe(false);
    expect(n.players.s01.company.nameStatus).toBe('ok');
    expect(normalizeSnapshot({ ...raw, v: 2 })).toBeNull();
    // 이미 정상인 상태는 그대로
    expect(normalizeSnapshot(JSON.parse(JSON.stringify(s)))).toEqual(s);
    expect(normalizePlayer({}).game.money).toBe(500);
    expect(normalizeClass({}).phase).toBe('prep');
  });
});
