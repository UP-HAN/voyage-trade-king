/**
 * (작업 172) 부산 [조립장] 화면 모델 — 순수 함수(PRD 6.12.3, 교과서 p.106).
 *
 * 부품 6종마다: 학급 필요·모인 수, 내가 가진 수, 지금 넣을 수 있는 최대 수, 우리 팀 부품인가, 1상자 보상, 못 넣는 까닭.
 * 넣기 규칙·검사는 core `applyAction({ type: 'depositPart' })`(core/phone.ts)가 한다. 여기서는 화면 숫자만.
 */
import type { ClassState, Player } from '../../core';
import { depositMax, heldQty, partReward, phoneOpen, studentPartLeft } from '../../core/phone';
import { goodsById } from '../../data/goods';
import { PHONE_PART_WHERE, PHONE_PARTS, PHONE_TEXT, phoneRules } from '../../data/phone';
import type { GoodId } from '../../data/types';

export interface AssemblyRow {
  good: GoodId;
  name: string;
  need: number;
  have: number;
  /** 배·계약에 가진 수 */
  held: number;
  /** 지금 넣을 수 있는 최대 수 */
  max: number;
  /** 우리 팀 부품 */
  mine: boolean;
  /** 1상자 보상(만 원) */
  reward: number;
  /** 넣을 수 없는 까닭(넣을 수 있으면 null) */
  reason: string | null;
  /** 구하는 곳 */
  where: string;
  service: boolean;
}

/** 조립장 탭을 보이는가: 학급 스마트폰 프로젝트가 있고 지금 부산 */
export function assemblyOpen(cs: Pick<ClassState, 'phone'>, p: Player): boolean {
  return !!cs.phone && p.game.port === phoneRules.port;
}

/** 부품 줄(우리 팀 부품이 맨 위) */
export function assemblyRows(cs: Pick<ClassState, 'phone'>, p: Player): AssemblyRow[] {
  const ph = cs.phone;
  if (!ph) return [];
  const team = p.game.phone?.team ?? null;
  const rows = PHONE_PARTS.map((good): AssemblyRow => {
    const x = ph.parts[good] ?? { need: 0, have: 0 };
    const held = heldQty(p, good);
    const max = depositMax(cs, p, good);
    let reason: string | null = null;
    if (!phoneOpen(cs)) reason = PHONE_TEXT.complete;
    else if (x.have >= x.need) reason = PHONE_TEXT.full;
    else if (studentPartLeft(p, good) <= 0) reason = `한 사람은 한 부품에 ${phoneRules.perStudentPart}상자까지 넣어요`;
    else if (held <= 0) reason = '아직 가진 것이 없어요';
    return {
      good,
      name: goodsById[good]?.name ?? good,
      need: x.need,
      have: x.have,
      held,
      max,
      mine: team === good,
      reward: partReward(good),
      reason,
      where: PHONE_PART_WHERE[good] ?? '',
      service: goodsById[good]?.form === 'service',
    };
  });
  return [...rows.filter((r) => r.mine), ...rows.filter((r) => !r.mine)];
}

/** 넣기 오류 문구 */
export function depositErrorText(code: string): string | null {
  switch (code) {
    case 'PART_FULL':
      return PHONE_TEXT.full;
    case 'PART_CAP':
      return `한 사람은 한 부품에 ${phoneRules.perStudentPart}상자까지 넣어요`;
    case 'PHONE_DONE':
      return PHONE_TEXT.complete;
    case 'NO_PROJECT':
      return '아직 스마트폰 프로젝트가 시작되지 않았어요';
    case 'NOT_A_PART':
      return '스마트폰 부품이 아니에요';
    default:
      return null;
  }
}
