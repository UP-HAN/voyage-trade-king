/**
 * 작업 174 — 마무리 단계: 마무리 항목 ↔ 코어 사건 발동(한 번만, 새로 고침·복구 뒤에도), 컨테이너 싣기 채점·자기 평가,
 * 잡지 표지(칸 길이·사회적 책임 +10 한 번·배경), 되돌아보기 저장, 학생 결산 요약 숨김 규칙, 시상 차례, 갤러리 공개 상태.
 */
import { describe, expect, it } from 'vitest';
import { aggregate, awards, FLAG_COLOR_IDS, FLAG_EMBLEM_IDS, AVATAR_IDS, seatKey, type PublicPayload } from '../../src/core';
import type { LessonId } from '../../src/data/types';
import { normalizeSnapshot } from '../../src/core/state';
import { helperLine } from '../../src/core/worksheet-helpers';
import { AWARD_ORDER } from '../../src/data/awards';
import { containerSentences, selfEvaluation } from '../../src/data/containers';
import { L4_FRONT_REFLECT, type LessonPart } from '../../src/data/lessonParts';
import { magazineFields } from '../../src/data/magazine';
import type { SessionInput } from '../../src/sync/host-session';
import {
  awardsRevealed,
  hiddenOnScreen,
  resultTableOf,
  screenSafeText,
  liveWrapStep,
  magazineModeOf,
  newTeacherGame,
  publicView,
  teacherReducer,
  wrapAwardList,
  type TeacherGame,
} from '../../src/teacher/game';
import { hiddenSummaryMetrics, isLastVoyage, reflectQuestionsOf, revealedAwards } from '../../src/student/wrapup/model';

interface World {
  get: () => TeacherGame;
  run: (i: SessionInput, t?: number) => ReturnType<typeof teacherReducer>;
  teach: (a: Record<string, unknown>) => ReturnType<typeof teacherReducer>;
  respond: (seat: number, eventId: string, response: unknown) => { ok: boolean; error?: string };
  set: (g: TeacherGame) => void;
}

/** 판을 열고 n명이 회사를 세운 뒤 무역 시작 → [지금 마무리로](마무리 첫 항목 자동 시작) */
function wrapWorld(o: { n?: number; scope?: LessonId[]; playUnit?: 'lesson' | 'unit'; part?: LessonPart; minutes?: number } = {}): World {
  const n = o.n ?? 3;
  let g = newTeacherGame({
    className: '6-1',
    playUnit: o.playUnit ?? 'lesson',
    scope: o.scope ?? ['L4'],
    tradeMinutes: o.minutes ?? 15,
    settings: { worksheetMode: 'after', ...(o.part ? { lessonPart: o.part } : {}) },
    overrides: {},
    seed: 7,
    now: 0,
  });
  let t = 100;
  const seq: Record<number, number> = {};
  const run = (i: SessionInput, at?: number) => {
    t = at ?? t + 100;
    const r = teacherReducer(g, i, t);
    g = r.snapshot;
    return r;
  };
  for (let s = 1; s <= n; s++) {
    run({ type: 'join', seat: s, pid: `p${String(s).padStart(5, '0')}`, companyName: `회사${String.fromCharCode(0xac00 + s * 37)}무역`, nameKey: `k${s}`, nameStatus: 'ok' });
    seq[s] = 1;
    run({ type: 'act', seat: s, seq: seq[s]++, action: { type: 'foundCompany', color: FLAG_COLOR_IDS[s % FLAG_COLOR_IDS.length], emblem: FLAG_EMBLEM_IDS[s % FLAG_EMBLEM_IDS.length], avatar: AVATAR_IDS[s % AVATAR_IDS.length] } });
  }
  run({ type: 'teacher', action: { type: 'startTrade' } }, 1000);
  run({ type: 'teacher', action: { type: 'finishNow' } }, 2000);
  return {
    get: () => g,
    set: (x) => {
      g = x;
    },
    run,
    teach: (a) => run({ type: 'teacher', action: a as never }),
    respond: (seat, eventId, response) => {
      const r = run({ type: 'act', seat, seq: seq[seat]++, action: { type: 'respondEvent', eventId, response: response as never } });
      const ack = (r.outputs as unknown as { type: string; ok?: boolean; error?: string }[]).find((x) => x.type === 'ack') as { ok: boolean; error?: string } | undefined;
      return ack ?? { ok: false, error: 'NO_ACK' };
    },
  };
}

const player = (g: TeacherGame, seat: number) => g.players[seatKey(seat)]!;
const fireCount = (g: TeacherGame, id: string) => g.class.firedEvents.filter((x) => x === id).length;
const pub = (g: TeacherGame) => publicView(g) as unknown as PublicPayload;
const CORRECT = containerSentences.filter((s) => s.correct).map((s) => s.no);
const WRONG = containerSentences.filter((s) => !s.correct).map((s) => s.no);

describe('A. 마무리 항목 ↔ 코어 사건 발동', () => {
  it('4차시 뒤 시간: 무역이 끝나면 컨테이너 싣기가 저절로 시작되고 L4-E6이 발동(단계는 wrapup 그대로)', () => {
    const w = wrapWorld({ part: 'back' });
    const g = w.get();
    expect(g.class.phase).toBe('wrapup');
    expect(liveWrapStep(g)).toBe('containers');
    expect(fireCount(g, 'L4-E6')).toBe(1);
    expect(g.class.currentEvent?.id).toBe('L4-E6');
    expect(g.class.currentEvent?.closed).toBe(false);
    expect(pub(g).wrapLive).toBe('containers');
    expect(pub(g).public.containers).toEqual({ done: 0, total: 3, right: [0, 0, 0, 0, 0, 0, 0, 0] });
  });

  it('같은 항목을 다시 시작하거나 새로 고침(스냅숏 다시 읽기)한 뒤에도 두 번 발동하지 않는다', () => {
    const w = wrapWorld({ part: 'back' });
    const openedAt = w.get().class.currentEvent?.openedAt;
    w.teach({ type: 'setWrapStep', id: 'containers', status: 'live' });
    expect(fireCount(w.get(), 'L4-E6')).toBe(1);
    // 새로 고침: 저장된 스냅숏을 다시 읽어 이어 감
    const restored = normalizeSnapshot(JSON.parse(JSON.stringify(w.get()))) as TeacherGame;
    w.set({ ...restored, wrapProgress: w.get().wrapProgress, wrapAutoStarted: true });
    w.run({ type: 'tick' });
    w.teach({ type: 'setWrapStep', id: 'containers', status: 'live' });
    expect(fireCount(w.get(), 'L4-E6')).toBe(1);
    expect(w.get().class.currentEvent?.openedAt).toBe(openedAt);
    // 복구 뒤에도 응답을 받는다(발동 기록이 호스트 상태에 남아 있음)
    expect(w.respond(1, 'L4-E6', { picks: CORRECT, self: [3, 3, 3] }).ok).toBe(true);
  });

  it('결산·시상(L4-E7)은 발동하지 않고, 되돌아보기·잡지 표지는 시작할 때 각각 한 번 발동', () => {
    const w = wrapWorld({ part: 'back' });
    w.teach({ type: 'setWrapStep', id: 'containers', status: 'done' });
    w.teach({ type: 'setWrapStep', id: 'awards', status: 'live' });
    expect(w.get().class.firedEvents).not.toContain('L4-E7');
    w.teach({ type: 'setWrapStep', id: 'awards', status: 'done' });
    w.teach({ type: 'setWrapStep', id: 'reflect', status: 'live' });
    expect(fireCount(w.get(), 'L4-E9')).toBe(1);
    expect(w.get().class.phase).toBe('wrapup');
    w.teach({ type: 'setWrapStep', id: 'reflect', status: 'done' });
    w.teach({ type: 'setWrapStep', id: 'magazine', status: 'live' });
    w.teach({ type: 'setWrapStep', id: 'magazine', status: 'live' });
    expect(fireCount(w.get(), 'L4-E8')).toBe(1);
    expect(w.get().class.phase).toBe('wrapup');
  });

  it('1차시 판: 첫 항목은 결산·시상(발동 없음), 되돌아보기를 시작하면 L4-E9가 발동해 응답을 받는다', () => {
    const w = wrapWorld({ scope: ['L1'] });
    expect(liveWrapStep(w.get())).toBe('awards');
    expect(w.get().class.firedEvents.some((x) => /^L4-E[6-9]$/.test(x))).toBe(false);
    expect(w.respond(1, 'L4-E9', { answers: ['a', 'b'] }).error).toBe('NOT_FIRED');
    w.teach({ type: 'setWrapStep', id: 'awards', status: 'done' });
    w.teach({ type: 'setWrapStep', id: 'reflect', status: 'live' });
    expect(w.respond(1, 'L4-E9', { answers: ['비단을 팔았어요', ''] }).ok).toBe(true);
  });

  it('4차시 앞 시간: 컨테이너·잡지 표지·⑯⑰⑱ 없음, 되돌아보기 2문항은 108~110쪽 내용(관세·해외 공장 책임)', () => {
    const w = wrapWorld({ part: 'front', minutes: 15 });
    const wrap = w.get().class.schedule.wrapup ?? [];
    expect(wrap.map((x) => x.id)).toEqual(['settle', 'awards', 'reflect', 'afterWorksheet']);
    expect(wrap.flatMap((x) => x.worksheetIds).some((x) => ['W16', 'W17', 'W18'].includes(x))).toBe(false);
    const r = wrap.find((x) => x.id === 'reflect');
    expect(reflectQuestionsOf(r)).toEqual([...L4_FRONT_REFLECT]);
    expect(L4_FRONT_REFLECT[0]).toContain('관세');
    expect(L4_FRONT_REFLECT[1]).toContain('공장');
    expect(liveWrapStep(w.get())).toBe('awards');
  });
});

describe('B. 컨테이너 싣기 채점·자기 평가', () => {
  it('전부 맞음 · 전부 틀림 · 빈 제출', () => {
    const w = wrapWorld({ part: 'back' });
    expect(w.respond(1, 'L4-E6', { picks: CORRECT, self: [3, 2, 1] }).ok).toBe(true);
    expect(w.respond(2, 'L4-E6', { picks: WRONG, self: [1, 1, 1] }).ok).toBe(true);
    expect(w.respond(3, 'L4-E6', { picks: [] }).ok).toBe(true);
    const g = w.get();
    expect(player(g, 1).game.responses['L4-E6']).toMatchObject({ correct: 8, total: 8, wrongNos: [], self: [3, 2, 1] });
    expect(player(g, 2).game.responses['L4-E6']).toMatchObject({ correct: 0, wrongNos: [1, 2, 3, 4, 5, 6, 7, 8] });
    expect(player(g, 3).game.responses['L4-E6']).toMatchObject({ correct: 4, wrongNos: CORRECT });
    // 보상 없음: 자금·지표 그대로(정답 수는 지표에 넣지 않음)
    const before = wrapWorld({ part: 'back' }).get();
    expect(player(g, 1).game.money).toBe(player(before, 1).game.money);
    expect(player(g, 1).game.metrics.csr).toBe(player(before, 1).game.metrics.csr);
    // TV 집계: 이름 없이 문장별 맞힌 수
    expect(pub(g).public.containers).toEqual({ done: 3, total: 3, right: [1, 2, 2, 2, 1, 2, 1, 1] });
    // ⑯ 도우미
    expect(helperLine('containerResult', { cls: g.class, player: player(g, 2), pub: null })).toBe('컨테이너 OX 8개 중 0개 맞혔어요 · 틀린 문장: 1번, 2번, 3번, 4번, 5번, 6번, 7번, 8번');
    expect(helperLine('containerResult', { cls: g.class, player: player(g, 1), pub: null })).toBe('컨테이너 OX 8개 중 8개 맞혔어요');
    // 한 번만(다시 보내면 ANSWERED)
    expect(w.respond(1, 'L4-E6', { picks: WRONG }).error).toBe('ANSWERED');
  });

  it('자기 평가 범위 밖·모양이 틀리면 거절(별 1~3개, 3문항)', () => {
    const w = wrapWorld({ part: 'back' });
    for (const self of [[0, 2, 3], [1, 2, 4], [1, 2], [1.5, 2, 3], 'x']) expect(w.respond(1, 'L4-E6', { picks: CORRECT, self }).error, JSON.stringify(self)).toBe('BAD_RESPONSE');
    expect(w.respond(1, 'L4-E6', { self: [1, 1, 1] }).error).toBe('BAD_RESPONSE');
    expect(player(w.get(), 1).game.responses['L4-E6']).toBeUndefined();
    expect(selfEvaluation).toHaveLength(3);
  });

  it('사고팔기 기록을 남기지 않는다(폭풍·보너스·개척 지표 영향 없음)', () => {
    const w = wrapWorld({ part: 'back' });
    const logBefore = player(w.get(), 1).game.log.length;
    const exploreBefore = JSON.stringify(player(w.get(), 1).game.fairTrade ?? null);
    w.respond(1, 'L4-E6', { picks: CORRECT, self: [3, 3, 3] });
    w.teach({ type: 'setWrapStep', id: 'magazine', status: 'live' });
    w.respond(1, 'L4-E8', { fields: ['반도체', '', '', '목표', '노력', ''], bg: 1 });
    w.teach({ type: 'setWrapStep', id: 'reflect', status: 'live' });
    w.respond(1, 'L4-E9', { answers: ['a', 'b', 'c'] });
    expect(player(w.get(), 1).game.log.length).toBe(logBefore);
    expect(JSON.stringify(player(w.get(), 1).game.fairTrade ?? null)).toBe(exploreBefore);
  });
});

describe('D. 잡지 표지', () => {
  it('6칸 길이 자르기, 4·5번을 쓰면 사회적 책임 +10 한 번만, 배경 번호', () => {
    const w = wrapWorld({ part: 'back' });
    w.teach({ type: 'setWrapStep', id: 'magazine', status: 'live' });
    const csr0 = player(w.get(), 1).game.metrics.csr;
    const long = '가'.repeat(80);
    expect(w.respond(1, 'L4-E8', { fields: [long, long, long, long, long, long], bg: 2 }).ok).toBe(true);
    let p = player(w.get(), 1);
    const cover = p.game.cover as { fields: string[]; bg: number };
    expect(cover.fields.map((f) => [...f].length)).toEqual(magazineFields.map((f) => f.max));
    expect(cover.bg).toBe(2);
    expect(p.game.metrics.csr).toBe(csr0 + 10);
    // 다시 보내도(고쳐 쓰기) +10은 한 번만, 배경 범위 밖은 1
    expect(w.respond(1, 'L4-E8', { fields: ['반도체', '빨라요', '베트남', '환경 지키기', '정당한 임금', '협력'], bg: 9 }).ok).toBe(true);
    p = player(w.get(), 1);
    expect(p.game.metrics.csr).toBe(csr0 + 10);
    expect((p.game.cover as { bg: number }).bg).toBe(1);
    // 4·5번 중 하나라도 비면 +10 없음
    expect(w.respond(2, 'L4-E8', { fields: ['a', '', '', '목표', '', ''], bg: 3 }).ok).toBe(true);
    expect(player(w.get(), 2).game.metrics.csr).toBe(csr0);
    // 칸 수가 틀리면 거절
    expect(w.respond(3, 'L4-E8', { fields: ['a', 'b'] }).error).toBe('BAD_RESPONSE');
    expect(pub(w.get()).public.covers).toEqual({ done: 2, total: 3 });
  });

  it('갤러리: 교사가 고르기 전에는 공개 상태에 학생 글이 없고, 고른 표지 하나만 싣는다(금칙어는 ***)', () => {
    const w = wrapWorld({ part: 'back', minutes: 15 });
    w.teach({ type: 'setWrapStep', id: 'magazine', status: 'live' });
    expect(magazineModeOf(w.get())).toBe('paper'); // 40분 미만 = 종이 기본
    w.teach({ type: 'setMagazineMode', mode: 'game' });
    w.respond(1, 'L4-E8', { fields: ['반도체특별', '작고빨라요', '베트남나라', '바보 같은 목표', '정당한 임금 주기', '협력해요'], bg: 3 });
    w.respond(2, 'L4-E8', { fields: ['자동차비밀', '튼튼해요', '미국', '환경', '대화', '친절'], bg: 1 });
    const before = JSON.stringify(publicView(w.get()));
    for (const t of ['반도체특별', '작고빨라요', '자동차비밀', '정당한 임금 주기']) expect(before).not.toContain(t);
    expect(pub(w.get()).wrap?.cover).toBeNull();
    // 고르기
    const pid1 = player(w.get(), 1).pid;
    w.teach({ type: 'pickCover', pid: pid1 });
    const after = pub(w.get());
    expect(after.wrap?.cover?.pid).toBe(pid1);
    expect(after.wrap?.cover?.fields[0]).toBe('반도체특별');
    expect(after.wrap?.cover?.fields[3]).toBe('***');
    expect(after.wrap?.cover?.bg).toBe(3);
    expect(JSON.stringify(after)).not.toContain('자동차비밀');
    // 출석번호 없음
    expect(JSON.stringify(after.wrap)).not.toMatch(/"seat"/);
    // 종이로 바꾸면 내림
    w.teach({ type: 'setMagazineMode', mode: 'paper' });
    expect(pub(w.get()).wrap?.cover).toBeNull();
  });

  it('무역 시간 40분 이상이면 기본이 게임', () => {
    const w = wrapWorld({ part: 'back', minutes: 40 });
    expect(magazineModeOf(w.get())).toBe('game');
  });
});

describe('E. 되돌아보기', () => {
  it('문항마다 60자로 잘라 저장, 고쳐 쓰면 다시 보낼 수 있음, 모양이 틀리면 거절', () => {
    const w = wrapWorld({ part: 'back' });
    w.teach({ type: 'setWrapStep', id: 'reflect', status: 'live' });
    expect(w.respond(1, 'L4-E9', { answers: ['나'.repeat(90), '  상호 의존  ', ''] }).ok).toBe(true);
    let r = player(w.get(), 1).game.reflect as { answers: string[] };
    expect([...r.answers[0]].length).toBe(60);
    expect(r.answers[1]).toBe('상호 의존');
    expect(w.respond(1, 'L4-E9', { answers: ['고쳤어요'] }).ok).toBe(true);
    r = player(w.get(), 1).game.reflect as { answers: string[] };
    expect(r.answers).toEqual(['고쳤어요']);
    expect(w.respond(2, 'L4-E9', { text: 'x' }).error).toBe('BAD_RESPONSE');
    // 내용은 공개 상태에 없다
    expect(JSON.stringify(publicView(w.get()))).not.toContain('고쳤어요');
  });
});

describe('C. 결산 요약·시상', () => {
  it('학생 결산 요약: 차시 한 판에서 사회적 책임·협력은 판에서 실제로 모두 같을 때만 숨긴다', () => {
    const w = wrapWorld({ scope: ['L3'], n: 3 });
    const item = w.get().class.schedule.wrapup?.find((x) => x.id === 'awards');
    expect(item?.hideFlatMetrics).toBe(true);
    let p = pub(w.get()).public;
    expect(p.flatMetrics).toEqual(expect.arrayContaining(['csr', 'coop']));
    expect([...hiddenSummaryMetrics(item, p)].sort()).toEqual(['coop', 'csr']);
    // 협력 값이 달라지면 협력은 보인다(사회적 책임은 그대로 같으면 숨김)
    const g = w.get();
    const k = seatKey(2);
    const changed: TeacherGame = { ...g, players: { ...g.players, [k]: { ...g.players[k]!, game: { ...g.players[k]!.game, metrics: { ...g.players[k]!.game.metrics, coop: 10 } } } } };
    p = aggregate(changed.class, changed.players, { playUnit: 'lesson' });
    expect([...hiddenSummaryMetrics(item, p)]).toEqual(['csr']);
    // 단원 한 판은 숨김 없음
    expect(hiddenSummaryMetrics({ ...item!, hideFlatMetrics: false }, p).size).toBe(0);
  });

  it('시상 차례: 발표 순서는 도약상이 무역왕상 바로 앞, [다음 상]으로 한 장씩, 시작 전에는 0', () => {
    expect(AWARD_ORDER.indexOf('leap')).toBe(AWARD_ORDER.indexOf('finalAsset') - 1);
    const w = wrapWorld({ part: 'back', n: 4 });
    // 지표를 서로 다르게(모든 상에 수상 회사가 생기게)
    const g0 = w.get();
    const players = { ...g0.players };
    [1, 2, 3, 4].forEach((s) => {
      const p = players[seatKey(s)]!;
      players[seatKey(s)] = { ...p, game: { ...p.game, money: p.game.money + s * 100, metrics: { ...p.game.metrics, exports: s * 50, quizRight: s, dex: p.game.metrics.dex } } };
    });
    w.set({ ...g0, players });
    const list = wrapAwardList(w.get());
    expect(list.length).toBeGreaterThan(1);
    const order = list.map((a) => AWARD_ORDER.indexOf(a.metric));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(awards(Object.values(w.get().players)).map((a) => a.metric)).toEqual(AWARD_ORDER.filter((id) => awards(Object.values(w.get().players)).some((a) => a.metric === id)));
    // 시작 전: 공개 0, 학생 화면 공개 목록 비어 있음
    expect(awardsRevealed(w.get())).toBe(0);
    expect(revealedAwards(pub(w.get()).public, pub(w.get()).wrap)).toEqual([]);
    w.teach({ type: 'setWrapStep', id: 'containers', status: 'done' });
    w.teach({ type: 'setWrapStep', id: 'awards', status: 'live' });
    expect(pub(w.get()).wrap?.awardsShown).toBe(0);
    w.teach({ type: 'awardNext' });
    expect(pub(w.get()).wrap?.awardsShown).toBe(1);
    expect(revealedAwards(pub(w.get()).public, pub(w.get()).wrap).map((a) => a.metric)).toEqual([list[0]!.metric]);
    for (let i = 0; i < list.length + 3; i++) w.teach({ type: 'awardNext' });
    expect(pub(w.get()).wrap?.awardsShown).toBe(list.length);
    expect(pub(w.get()).wrap?.awardsList).toBe(true);
    // 시상을 끝내면 전부, 다시 시작하면 처음부터
    w.teach({ type: 'setWrapStep', id: 'awards', status: 'done' });
    expect(awardsRevealed(w.get())).toBe(list.length);
    w.teach({ type: 'setWrapStep', id: 'awards', status: 'live' });
    expect(awardsRevealed(w.get())).toBe(0);
  });
});

describe('(작업 178) 시상 결과 고정·공개 상태·표지 글 가림·마지막 항해 줄', () => {
  /** 4명, 사회적 책임만 1번이 근소하게 앞섬 → 착한 기업상 1번. 잡지 표지 +10을 받은 2번이 뒤에 앞서도 상은 그대로 */
  function csrWorld() {
    const w = wrapWorld({ part: 'back', n: 4 });
    const g0 = w.get();
    const players = { ...g0.players };
    [1, 2, 3, 4].forEach((s) => {
      const p = players[seatKey(s)]!;
      players[seatKey(s)] = { ...p, game: { ...p.game, metrics: { ...p.game.metrics, csr: s === 1 ? 55 : 50, exports: s === 4 ? 40 : 0, quizRight: s === 3 ? 5 : 0 } } };
    });
    w.set({ ...g0, class: { ...g0.class, settings: { ...g0.class.settings, awardsPerPrize: 1 } }, players });
    return w;
  }
  const csrWinner = (list: ReturnType<typeof wrapAwardList>) => list.find((a) => a.metric === 'csr')?.winners.map((x) => x.pid) ?? [];

  it('[첫 상 공개] 순간 고정 — 잡지 표지 +10 뒤에도 TV·학생·끝 화면·결과 파일의 상이 그대로, 지표 값만 바뀜', () => {
    const w = csrWorld();
    w.teach({ type: 'setWrapStep', id: 'awards', status: 'live' });
    expect(w.get().awardsFrozen ?? null).toBeNull();
    w.teach({ type: 'awardNext' });
    const frozen = w.get().awardsFrozen!;
    expect(Array.isArray(frozen)).toBe(true);
    const pid1 = player(w.get(), 1).pid;
    const pid2 = player(w.get(), 2).pid;
    expect(csrWinner(frozen)).toEqual([pid1]);
    for (let i = 0; i < 10; i++) w.teach({ type: 'awardNext' });
    w.teach({ type: 'setWrapStep', id: 'reflect', status: 'live' });
    w.teach({ type: 'setWrapStep', id: 'magazine', status: 'live' });
    w.teach({ type: 'setMagazineMode', mode: 'game' });
    expect(w.respond(2, 'L4-E8', { fields: ['a', 'b', 'c', '목표', '노력', 'f'], bg: 1 }).ok).toBe(true);
    expect(player(w.get(), 2).game.metrics.csr).toBe(60);
    // 지금 다시 계산하면 2번이 착한 기업상이지만, 고정한 목록은 1번
    expect(csrWinner(awards(Object.values(w.get().players), { perPrize: 1, hideFlatMetrics: true }) as never)).toEqual([pid2]);
    expect(csrWinner(wrapAwardList(w.get()))).toEqual([pid1]);
    expect(csrWinner(pub(w.get()).public.awards ?? [])).toEqual([pid1]);
    w.teach({ type: 'endSession' });
    expect(w.get().class.phase).toBe('ended');
    expect(csrWinner(pub(w.get()).public.awards ?? [])).toEqual([pid1]);
    const table = resultTableOf(w.get());
    const row1 = table.rows.find((r) => r.seat === 1)!;
    const row2 = table.rows.find((r) => r.seat === 2)!;
    expect(row1.awards).toContain('착한 기업상');
    expect(row2.awards).not.toContain('착한 기업상');
    expect(row2.values.csr).toBe(60);
  });

  it('공개 상태 awards에는 공개한 상만(시상식 전 0개, 한 장씩 늘어남)', () => {
    const w = csrWorld();
    expect(pub(w.get()).public.awards).toEqual([]);
    w.teach({ type: 'setWrapStep', id: 'awards', status: 'live' });
    expect(pub(w.get()).public.awards).toEqual([]);
    const total = wrapAwardList(w.get()).length;
    expect(total).toBeGreaterThan(1);
    w.teach({ type: 'awardNext' });
    expect(pub(w.get()).public.awards).toHaveLength(1);
    w.teach({ type: 'awardNext' });
    expect(pub(w.get()).public.awards).toHaveLength(2);
    expect(JSON.stringify(pub(w.get()).public.awards)).not.toContain(wrapAwardList(w.get())[2]?.award ?? '없는 상');
  });

  it('시상식을 건너뛰면 수업을 끝낼 때 고정', () => {
    const w = csrWorld();
    w.teach({ type: 'setWrapStep', id: 'awards', status: 'skipped' });
    expect(w.get().awardsFrozen ?? null).toBeNull();
    w.teach({ type: 'endSession' });
    expect(Array.isArray(w.get().awardsFrozen)).toBe(true);
  });

  it('표지 글 가림: 단위 붙은 숫자(2030년·1000만 원)는 그대로, 전화번호·주소·금칙어는 ***', () => {
    expect(screenSafeText('2030년까지 탄소 줄이기')).toBe('2030년까지 탄소 줄이기');
    expect(screenSafeText('수출 1000만 원 달성')).toBe('수출 1000만 원 달성');
    expect(screenSafeText('010-1234-5678로 연락')).toBe('***');
    expect(screenSafeText('20301234')).toBe('***');
    expect(screenSafeText('www 홈페이지')).toBe('***');
    expect(screenSafeText('바보 회사')).toBe('***');
    expect(hiddenOnScreen('바보 회사')).toBe(true);
    expect(hiddenOnScreen('2030년까지')).toBe(false);
  });

  it("'마지막 항해예요' 강조 줄: 4차시 앞 시간 판에서는 빼고, 뒤 시간·두 시간 모두·단원 한 판에만", () => {
    expect(isLastVoyage(wrapWorld({ part: 'front' }).get().class.settings as never)).toBe(false);
    expect(isLastVoyage(wrapWorld({ part: 'back' }).get().class.settings as never)).toBe(true);
    expect(isLastVoyage(wrapWorld({ part: 'all' }).get().class.settings as never)).toBe(true);
    expect(isLastVoyage(wrapWorld({ scope: ['L3'] }).get().class.settings as never)).toBe(false);
    expect(isLastVoyage(wrapWorld({ playUnit: 'unit', scope: ['L1', 'L2', 'L3', 'L4'] }).get().class.settings as never)).toBe(true);
  });
});
