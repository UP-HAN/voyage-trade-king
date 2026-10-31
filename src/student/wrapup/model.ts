/**
 * 마무리 학생 화면 공통 계산(작업 174) — 순수 함수. WrapupView·Containers·Reflect·MagazineCover가 함께 쓴다.
 */
import type { MetricId } from '../../data/awards';
import { metrics as METRICS } from '../../data/awards';
import { eventsById } from '../../data/events';
import type { PublicClass, PublicState, PublicWrap, WrapItem } from '../../core';

/** 마무리 항목 하나(없으면 undefined) */
export function wrapItemOf(cls: PublicClass, id: string): WrapItem | undefined {
  return (cls.schedule.wrapup ?? []).find((w) => w.id === id);
}

/** 되돌아보기 문항(앞 n개) */
export function reflectQuestions(n: number): string[] {
  const all = eventsById['L4-E9']?.reflectQuestions ?? [];
  return all.slice(0, Math.max(0, Math.min(all.length, n)));
}

/** 이번 판 되돌아보기 문항: 항목에 문항 글이 있으면(4차시 앞 시간) 그것, 아니면 L4-E9 앞 n개 */
export function reflectQuestionsOf(item: WrapItem | undefined): string[] {
  if (item?.questionTexts?.length) return [...item.questionTexts];
  return reflectQuestions(item?.questions ?? 3);
}

/** 공개된 상(수상 회사가 있는 상, 발표 순서 앞에서부터 `awardsShown`개). 마무리 정보가 없으면(옛 상태) 전부 */
export function revealedAwards(pub: PublicState | null, wrap: PublicWrap | null | undefined) {
  const all = (pub?.awards ?? []).filter((a) => a.winners.length > 0);
  return wrap ? all.slice(0, Math.max(0, wrap.awardsShown)) : all;
}

/**
 * 결산 요약에서 숨길 지표: 차시 한 판(`hideFlatMetrics`)이면 사회적 책임·협력 가운데 **판에서 실제로 모든 회사 값이 같은 것**만
 * (공개 상태 `flatMetrics` — 시상의 hideFlatMetrics와 같은 계산). 옛 상태(값 없음)는 예전처럼 둘 다 숨김.
 */
export function hiddenSummaryMetrics(item: WrapItem | undefined, pub: PublicState | null): Set<MetricId> {
  if (item?.hideFlatMetrics !== true) return new Set();
  const flat = pub?.flatMetrics;
  return new Set(METRICS.filter((m) => m.mayBeFlat && (!flat || flat.includes(m.id))).map((m) => m.id));
}
