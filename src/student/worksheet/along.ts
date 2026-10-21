/**
 * (작업 165, PRD 4.1.1) 학습지 ⑥ 게임하면서 함께 쓰기 — 학생 쪽 판정(순수 함수).
 * 공개 학급 상태(배치표 항목·설정·단계)만 읽는다. 새 공개 상태 필드는 없다.
 */
import type { PublicClass } from '../../core';
import { lessonPartRulesOf } from '../../data/lessonParts';

type AlongClass = Pick<PublicClass, 'settings' | 'schedule' | 'phase'>;

/** 이 판 배치표가 ⑤와 ⑥ 사이에 라운드를 두었는가(2차시 앞 시간·두 시간 모두, '활동마다 바로') */
export function alongPlanned(cls: Pick<AlongClass, 'settings' | 'schedule'> | null | undefined): boolean {
  if (!cls) return false;
  if (lessonPartRulesOf(cls.settings)?.customsBeforeLastRounds == null) return false;
  const items = cls.schedule?.items ?? [];
  const w5 = items.find((x) => x.id === 'ws:W05');
  const w6 = items.find((x) => x.id === 'ws:W06');
  if (!w5 || !w6) return false;
  // ⑤를 일찍 닫으면 다음 라운드가 ⑤ 예정 끝보다 앞으로 당겨진다 — 시작 시각만 비교
  return items.some((x) => x.kind === 'round' && x.at > w5.at && x.at < w6.at);
}

/** 안내 카드를 띄울 때: ⑤를 마쳤고(또는 건너뜀) ⑥은 아직, 라운드 중 */
export function alongCardOn(cls: AlongClass | null | undefined): boolean {
  if (!cls || cls.phase !== 'round' || !alongPlanned(cls)) return false;
  const items = cls.schedule.items;
  const s5 = items.find((x) => x.id === 'ws:W05')?.status;
  const s6 = items.find((x) => x.id === 'ws:W06')?.status;
  return (s5 === 'done' || s5 === 'skipped') && s6 === 'pending';
}
