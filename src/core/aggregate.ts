/**
 * 호스트 집계: 학생 목록 → 공개 상태(PublicState) (PRD 7.4, 7.6, 10.3 v0.3.1) — 작업 103.
 *
 * 공개 상태는 공용 화면·모든 학생 기기에 가므로 다음을 넣지 않는다:
 * - 출석번호(`seat`) — 회사는 `pid`로만 가리킨다.
 * - 학생별 자금·응답 여부·미응답 명단(수만 셈).
 * - 막힌 회사 이름(→ null, 화면은 "이름 짓는 중").
 */
import { metrics as metricDefs, type MetricId } from '../data/awards';
import { checkQuizFor } from '../data/checkQuiz';
import { eventsById } from '../data/events';
import type { WorksheetId } from '../data/types';
import { VOTE_OPTIONS, voteCounts } from './activities';
import { boardFrom } from './worksheet-helpers';
import { awards, hasCertificate, leaderboard, publicCompanyName } from './scoring';
import type { ClassState, HostSnapshot, LeaderEntry, Player, PublicClass, PublicPayload, PublicState, SessionMeta } from './types';

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

export interface AggregateOptions {
  /** 판 단위(차시 한 판이면 시상에서 값이 모두 같은 지표의 상을 숨김) */
  playUnit?: SessionMeta['playUnit'];
}

/**
 * 이 학생이 사건에 응답했나(응답 수 "응답 21/27"의 규칙 — 교사 표 `respondedToCurrent`도 같은 규칙).
 * - 확인 퀴즈: 그 구간의 지정 문항을 모두 답했을 때.
 * - 그 밖: 응답 기록이 있고 마감 때 채운 '응답 없음'이 아닐 때.
 */
export function respondedTo(eventId: string, p: Player): boolean {
  const def = eventsById[eventId];
  if (!def) return false;
  if (def.kind === 'checkQuiz') {
    const qs = checkQuizFor(def.lesson);
    return qs.length > 0 && qs.every((q) => p.game.checkQuiz[q.id] !== undefined);
  }
  const r = p.game.responses[eventId];
  return r !== undefined && !(isObj(r) && r.noResponse === true);
}

/** 학생 목록 → 공개 상태 */
export function aggregate(cs: ClassState, players: Record<string, Player> | readonly Player[], opts: AggregateOptions = {}): PublicState {
  const all: Player[] = Array.isArray(players) ? [...(players as readonly Player[])] : Object.values(players as Record<string, Player>);
  const list = all.sort((a, b) => (a.pid < b.pid ? -1 : a.pid > b.pid ? 1 : 0));
  const nameReview = cs.settings.nameReview;

  // 현재 사건 응답 수
  let event: PublicState['event'] = null;
  const ce = cs.currentEvent;
  const def = ce ? eventsById[ce.id] : undefined;
  if (ce && def && def.needsResponse) {
    const responded = list.filter((p) => respondedTo(ce.id, p)).length;
    event = { id: ce.id, responded, total: list.length };
  }

  // (작업 111) 개인 결정의 선택 분포(이름 없이 수만, '응답 없음' 기본값 제외)
  let decision: PublicState['decision'] = null;
  if (ce && def && def.kind === 'decision' && def.options?.length && !VOTE_OPTIONS[ce.id]) {
    const counts: Record<string, number> = {};
    for (const o of def.options) counts[o.id] = 0;
    for (const p of list) {
      const r = p.game.responses[ce.id];
      if (!isObj(r) || r.noResponse === true || typeof r.choice !== 'string') continue;
      if (r.choice in counts) counts[r.choice] += 1;
    }
    decision = { id: ce.id, counts };
  }

  // 학습지 완료 수
  const worksheetDone: Partial<Record<WorksheetId, number>> = {};
  for (const p of list) for (const id of p.game.worksheetDone) worksheetDone[id] = (worksheetDone[id] ?? 0) + 1;
  // '지금 쓰기' ★ 칸 완료 수(번호 완료와 따로, 작업 132)
  const duringDone: Partial<Record<WorksheetId, number>> = {};
  for (const p of list) for (const id of p.game.duringDone ?? []) duringDone[id] = (duringDone[id] ?? 0) + 1;

  // 순위판(상위 N, N=0이면 비움). 도약 탭은 기준 자산 기록 전에는 'soon'
  const leaderboardOut: Partial<Record<MetricId, LeaderEntry[] | 'soon'>> = {};
  const topN = cs.settings.leaderboardTopN;
  if (topN > 0 && list.length) {
    for (const m of metricDefs) {
      if (m.id === 'finalAsset' && !cs.settings.assetBoard) continue;
      if (m.id === 'leap' && !list.some((p) => p.game.metrics.baseAsset !== null)) {
        leaderboardOut.leap = 'soon';
        continue;
      }
      leaderboardOut[m.id] = leaderboard(list, m.id, topN, { nameReview });
    }
  }

  // 벽란도 맞힌 수 분포·두 섬 성공 수
  const byeokrando = Array.from({ length: 10 }, () => 0);
  let twoSuccess = 0;
  let twoTotal = 0;
  // (작업 113) 성공한 학생들의 3단계 '두 섬 합계'(쌀·옷) 평균 — 이름 없이 수만
  const twoSum = { rice: 0, clothes: 0, n: 0 };
  for (const p of list) {
    const b = p.game.responses['L1-E1'];
    if (isObj(b) && typeof b.correct === 'number' && b.correct >= 0 && b.correct < byeokrando.length) byeokrando[b.correct] += 1;
    const t = p.game.responses['L1-E5'];
    if (isObj(t)) {
      twoTotal += 1;
      if (t.success === true) {
        twoSuccess += 1;
        const s3 = isObj(t.stage3) ? t.stage3 : null;
        const a = s3 && isObj(s3.A) ? s3.A : null;
        const bb = s3 && isObj(s3.B) ? s3.B : null;
        if (a && bb && [a.rice, a.clothes, bb.rice, bb.clothes].every((v) => typeof v === 'number' && Number.isFinite(v))) {
          twoSum.rice += (a.rice as number) + (bb.rice as number);
          twoSum.clothes += (a.clothes as number) + (bb.clothes as number);
          twoSum.n += 1;
        }
      }
    }
  }
  const twoAvg = twoSum.n ? { rice: Math.round((twoSum.rice / twoSum.n) * 10) / 10, clothes: Math.round((twoSum.clothes / twoSum.n) * 10) / 10 } : null;

  // 확인 퀴즈 정답률(누가 틀렸는지는 없음)
  const checkQuiz: PublicState['checkQuiz'] = {};
  for (const p of list) {
    for (const [qid, r] of Object.entries(p.game.checkQuiz)) {
      const c = (checkQuiz[qid] ??= { right: 0, total: 0 });
      c.total += 1;
      if (r === 'right') c.right += 1;
    }
  }

  // 학급 투표(현재 사건이 투표이거나 마지막 투표)
  let vote: PublicState['vote'] = null;
  const voteId = ce && VOTE_OPTIONS[ce.id] ? ce.id : [...cs.firedEvents].reverse().find((id) => VOTE_OPTIONS[id]);
  if (voteId) {
    const v = cs.votes[voteId];
    vote = { id: voteId, counts: voteCounts(list, voteId), revealed: v?.revealed ?? false, result: v?.result ?? null };
  }

  const tradeOver = cs.phase === 'wrapup' || cs.phase === 'ended';
  return {
    joinedCount: list.length,
    onlineCount: list.filter((p) => p.online).length,
    readyCount: list.filter((p) => p.game.ready).length,
    // (작업 151) 자유 항해: 이번 라운드 학급 전체 항해 수(공용 화면 해도). 라운드마다 판에는 싣지 않는다
    ...(cs.settings.voyageMode === 'free' ? { sailsThisRound: list.reduce((n, p) => n + (p.game.sailsThisRound ?? 0), 0) } : {}),
    event,
    worksheetDone,
    duringDone,
    companies: list.map((p) => ({ pid: p.pid, name: publicCompanyName(p, nameReview), color: p.company.color, emblem: p.company.emblem })),
    ships: list.map((p) => ({ pid: p.pid, port: p.game.port, color: p.company.color, emblem: p.company.emblem })),
    leaderboard: leaderboardOut,
    byeokrando,
    twoIslands: { success: twoSuccess, total: twoTotal, avgStage3: twoAvg },
    checkQuiz,
    decision,
    vote,
    certificates: list.filter((p) => hasCertificate(cs, p)).length,
    awards: tradeOver
      ? awards(list, {
          perPrize: cs.settings.awardsPerPrize,
          hideFlatMetrics: opts.playUnit === 'lesson',
          off: cs.settings.awardsOff,
          nameReview,
        })
      : null,
    customsBoard: cs.settings.scope.includes('L2') ? boardFrom(list) : null,
  };
}

/** 방 전체에 보내는 학급 상태(교사 전용 필드 — 막은 이름 키·추가 금칙어 — 를 뺌) */
export function publicClass(cs: ClassState): PublicClass {
  const { bannedNameKeys: _b, settings, ...rest } = cs;
  const { extraBannedWords: _w, ...pubSettings } = settings;
  void _b;
  void _w;
  return { ...rest, settings: pubSettings };
}

/** 스냅숏 → 방 전체에 보낼 내용 */
export function publicPayload(snap: HostSnapshot): PublicPayload {
  return { class: publicClass(snap.class), public: aggregate(snap.class, snap.players, { playUnit: snap.meta.playUnit }) };
}
