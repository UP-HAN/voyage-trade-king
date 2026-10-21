/**
 * 미니게임 결과 장면(작업 111이 자리를 만들고 작업 113이 채움 — PRD 6.12.1·6.12.2·7.6). 이름 없이 수만.
 *
 * - 벽란도 시장(L1-E1): "다 한 친구 n명" + 맞힌 카드 수 분포 막대(0~9장, 짧은 형태 0~5장).
 * - 두 섬 이야기(L1-E5): "성공 n명 / 참여 m명" + 성공한 친구들의 '두 섬 합계'(3단계) 평균 vs 1단계(5일:5일) 합계 막대.
 *
 * 자동 장면 고르기(`minigameResultPicker`, scenes/index.ts에서 `addScenePicker`로 등록):
 * 지금 사건이 L1-E1·L1-E5이고 일시정지·학습지·요약 표지·끝이 아닐 때,
 * - 열려 있는 동안: 한 명이라도 마치면 이 장면(그 전에는 사건 카드).
 * - 마감한 뒤: 기본 규칙이 결과 막대('bars')를 고르는 때(라운드 사이) 대신 이 장면.
 */
import { eventsById } from '../../data/events';
import { twoIslands } from '../../data/twoIslands';
import { liveItem, pickScene, type ScreenData } from '../model';
import { Bar } from '../parts';
import type { SceneProps } from './types';
import './minigame-result.css';

const MINIGAMES = new Set(['L1-E1', 'L1-E5']);

/** 자동 장면 고르기(공용 화면 '자동'일 때만 불림) */
export function minigameResultPicker(d: ScreenData, now: number): string | null {
  const { cls } = d;
  const ce = cls.currentEvent;
  if (!ce || !MINIGAMES.has(ce.id)) return null;
  if (cls.phase === 'ended' || cls.paused) return null;
  if (cls.worksheet.current && cls.worksheet.current.length) return null;
  if (liveItem(cls, (it) => it.kind === 'stageCover' && it.variant === 'summary')) return null;
  if (!ce.closed) return finishedCount(d, ce.id) > 0 ? 'minigameResult' : null;
  return pickScene(d, now) === 'bars' ? 'minigameResult' : null;
}

/** 마친 학생 수(L1-E1: 분포 합, L1-E5: 성공 수 — 두 섬은 성공해야 기록됨) */
export function finishedCount(d: ScreenData, id: string): number {
  if (id === 'L1-E1') return d.pub.byeokrando.reduce((a, n) => a + n, 0);
  if (id === 'L1-E5') return d.pub.twoIslands.total;
  return 0;
}

function isShort(d: ScreenData, id: string): boolean {
  const ce = d.cls.currentEvent;
  if (ce && ce.id === id) return ce.short === true;
  return d.cls.shortEvents.includes(id);
}

export interface ByeokrandoResultModel {
  done: number;
  maxCards: number;
  rows: { label: string; value: number }[];
  max: number;
}

export function byeokrandoResultModel(d: ScreenData): ByeokrandoResultModel {
  const short = isShort(d, 'L1-E1');
  const maxCards = short ? 5 : 9;
  const dist = d.pub.byeokrando;
  const rows = Array.from({ length: maxCards + 1 }, (_, i) => ({ label: `${i}장`, value: dist[i] ?? 0 }));
  const done = dist.reduce((a, n) => a + n, 0);
  return { done, maxCards, rows, max: Math.max(1, ...rows.map((r) => r.value)) };
}

export interface TwoIslandsResultModel {
  success: number;
  joined: number;
  base: { rice: number; clothes: number };
  avg: { rice: number; clothes: number } | null;
  max: number;
}

export function twoIslandsResultModel(d: ScreenData): TwoIslandsResultModel {
  const t = d.pub.twoIslands;
  const A = twoIslands.islands.A;
  const B = twoIslands.islands.B;
  const da = twoIslands.defaultRiceDays;
  const base = {
    rice: A.ricePerDay * da.A + B.ricePerDay * da.B,
    clothes: A.clothesPerDay * (twoIslands.days - da.A) + B.clothesPerDay * (twoIslands.days - da.B),
  };
  const avg = t.avgStage3 ?? null;
  const ev = d.pub.event && d.pub.event.id === 'L1-E5' ? d.pub.event : null;
  const joined = Math.max(ev?.total ?? d.pub.joinedCount, t.total);
  const max = Math.max(1, base.rice, base.clothes, avg?.rice ?? 0, avg?.clothes ?? 0);
  return { success: t.success, joined, base, avg, max };
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function MinigameResultScene({ d }: SceneProps) {
  const id = d.cls.currentEvent?.id ?? '';
  const title = eventsById[id]?.title ?? '미니게임';
  if (id === 'L1-E1') {
    const m = byeokrandoResultModel(d);
    return (
      <div class="scr-scene scr-bars" data-testid="scene-minigameResult" data-event={id} data-done={m.done}>
        <p class="scr-kicker">{title} 결과 · 교과서 p.95</p>
        <h1 class="scr-h1">맞힌 카드 수{isShort(d, id) ? ' (카드 5장)' : ''}</h1>
        <p class="scr-bars__count" data-testid="mg-result-count">
          다 한 친구 <b>{m.done}</b>명
        </p>
        <div class="scr-panel scr-mg__hist" data-testid="mg-result-bars" role="img" aria-label="맞힌 카드 수별 친구 수 막대">
          {m.rows.map((r) => (
            <div key={r.label} class="scr-mg__col" data-testid="mg-result-bar" data-value={r.value}>
              <span class="scr-mg__val">
                {r.value}
                <small>명</small>
              </span>
              <span class="scr-mg__track">
                <span class="scr-mg__fill" style={{ height: `${(r.value / m.max) * 100}%` }} />
              </span>
              <span class="scr-mg__label">{r.label}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (id === 'L1-E5') {
    const m = twoIslandsResultModel(d);
    return (
      <div class="scr-scene scr-bars" data-testid="scene-minigameResult" data-event={id} data-success={m.success} data-joined={m.joined}>
        <p class="scr-kicker">{title} 결과 · 교과서 p.98~99 · [게임 설정] 수치</p>
        <h1 class="scr-h1">두 나라 합계: 혼자 살 때 vs 바꾼 뒤</h1>
        <p class="scr-bars__count" data-testid="mg-result-count">
          성공 <b>{m.success}</b>명 / 참여 <b>{m.joined}</b>명
        </p>
        <div class="scr-panel scr-bars__list" data-testid="mg-result-bars">
          <Bar label="쌀 · 혼자 살 때(1단계)" value={m.base.rice} max={m.max} suffix="" testId="mg-result-bar" />
          {m.avg && <Bar label="쌀 · 바꾼 뒤(성공 평균)" value={Number(fmt(m.avg.rice))} max={m.max} suffix="" testId="mg-result-bar" />}
          <Bar label="옷 · 혼자 살 때(1단계)" value={m.base.clothes} max={m.max} suffix="" testId="mg-result-bar" />
          {m.avg && <Bar label="옷 · 바꾼 뒤(성공 평균)" value={Number(fmt(m.avg.clothes))} max={m.max} suffix="" testId="mg-result-bar" />}
        </div>
        {!m.avg && <p class="scr-lead">아직 성공한 친구가 없어요. 두 나라가 서로 바꾸면 어떻게 될까요?</p>}
      </div>
    );
  }
  return (
    <div class="scr-scene scr-bars" data-testid="scene-minigameResult">
      <p class="scr-lead">미니게임 결과를 모으고 있어요.</p>
    </div>
  );
}

export default MinigameResultScene;
