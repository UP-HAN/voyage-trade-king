/**
 * 결정 카드 선택지의 좋은 점 / 걱정되는 점 / 비용(작업 111, PRD 8.3 S13).
 * 값은 지금 시장 시세(103 `portPrice`)와 운항비(`voyageCostFor`)에서 계산한다 — [게임 설정] 값이라 교과서 문장이 아니다.
 * L2~L4 결정(115~117)은 사건 ID별 함수를 이 표에 더하면 된다.
 */
import { portPrice, voyageCostFor, type PublicClass } from '../../core';
import type { OptionFacts } from '../../ui/cards';
import { classForPredict, playerForPredict, type MeView } from '../predict';
import { formatMoney } from '../text';

type FactsFn = (cls: PublicClass, me: MeView) => OptionFacts;

const price = (cls: PublicClass, port: 'BUS' | 'SHA'): string => {
  const p = portPrice(classForPredict(cls), port, 'graphite');
  return p.buy !== null ? `1상자 ${formatMoney(p.buy)}` : '시장에서 확인해요';
};

export const OPTION_FACTS: Readonly<Record<string, FactsFn>> = {
  'L1-E7': (cls, me) => {
    const cs = classForPredict(cls);
    const shaCost = me.game.port === 'SHA' ? 0 : voyageCostFor(cs, playerForPredict(me), me.game.port, 'SHA');
    return {
      SHA: {
        good: '흑연 값이 싸요',
        worry: me.game.port === 'SHA' ? '이미 상하이에 있어요' : '상하이까지 배를 몰고 가야 해요',
        cost: `${price(cls, 'SHA')}${shaCost ? ` + 운항비 ${formatMoney(shaCost)}` : ''}`,
      },
      BUS: {
        good: '가까운 부산에서 살 수 있어요',
        worry: '값이 비싸요',
        cost: price(cls, 'BUS'),
      },
      none: {
        good: '돈을 다른 상품에 쓸 수 있어요',
        worry: '흑연으로 이익을 낼 기회는 없어요',
        cost: '0원',
      },
    };
  },
};

export function optionFacts(id: string, cls: PublicClass, me: MeView): OptionFacts | undefined {
  const fn = OPTION_FACTS[id];
  if (!fn) return undefined;
  try {
    return fn(cls, me);
  } catch {
    return undefined;
  }
}
