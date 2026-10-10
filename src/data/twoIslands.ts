/**
 * 두 섬 이야기 미니게임 (L1-E5, PRD 6.12.2, p.98~99) — 생산량·교환 비율은 [게임 설정].
 * 교과서의 ㉮·㉯ 나라 이야기(p.98)를 두 섬으로 옮겼다. 정답은 하나가 아니다.
 *
 * 1단계 "혼자 살기": 각 섬 10일을 쌀/옷에 나눔(1일 단위, 기본 5:5).
 * 2단계 "잘하는 것에 집중하기": 다시 나눔.
 * 3단계 "바꾸기": 옷 3 = 쌀 2 고정, 3상자(옷 3 ↔ 쌀 2) 단위. 목표: 두 섬 모두 1단계보다 쌀과 옷을 같거나 더 많이.
 */
export type IslandId = 'A' | 'B';

export const twoIslands = {
  title: '두 섬 이야기',
  scene: 'scenes/two-islands.png',
  islands: {
    A: { id: 'A', label: '㉮섬', ricePerDay: 6, clothesPerDay: 12 },
    B: { id: 'B', label: '㉯섬', ricePerDay: 5, clothesPerDay: 2 },
  },
  days: 10,
  /** 1단계 기본 배분(쌀에 쓰는 날) */
  defaultRiceDays: { A: 5, B: 5 },
  /** 교환: ㉮섬이 옷 clothes 를 주고 ㉯섬이 쌀 rice 를 준다(1단위) */
  exchange: { clothes: 3, rice: 2 },
  hint: '㉯섬은 쌀에, ㉮섬은 옷에 더 많은 날을 써 보세요.',
  /** 검산 예(PRD 6.12.2) */
  example: { riceDays: { A: 2, B: 10 }, units: 10 },
  endSentence: { text: '각 나라가 잘 만드는 것을 수출하고, 만들기 어려운 것을 수입하면 더 좋은 상품을 더 싸게 쓸 수 있어요.', pages: [99] },
  textbook: [
    { pages: [98], note: '㉮ 나라와 ㉯ 나라는 모두 쌀과 옷을 생산할 수 있습니다. ㉮ 나라는 ㉯ 나라보다 같은 시간과 비용을 들일 때 더 많은 양의 쌀과 옷을 생산할 수 있습니다.' },
    { pages: [99], note: '여러 나라가 각각 효율적으로 생산하는 상품을 수출하고, 효율적으로 생산하기 어려운 상품을 수입하면 더 우수한 품질의 상품을 저렴한 가격으로 사용할 수 있습니다.' },
  ],
  reward: { money: 50, dexCard: 'trade-benefit' },
  /** 이 시간(초) 안에 못 마치면 [힌트 보기 → 예시 따라 하기](보상 동일) */
  helpAfterSec: 180,
  gameRule: true,
} as const;

export interface IslandStock { rice: number; clothes: number }

/** 쌀에 riceDays 일을 쓴 섬의 생산량 */
export function produce(island: IslandId, riceDays: number): IslandStock {
  const s = twoIslands.islands[island];
  return { rice: s.ricePerDay * riceDays, clothes: s.clothesPerDay * (twoIslands.days - riceDays) };
}

/** 교환 units 단위 뒤 두 섬이 가진 양. 줄 수 있는 양이 모자라면 null */
export function afterExchange(a: IslandStock, b: IslandStock, units: number): { A: IslandStock; B: IslandStock } | null {
  const give = twoIslands.exchange.clothes * units;
  const get = twoIslands.exchange.rice * units;
  if (units < 0 || a.clothes < give || b.rice < get) return null;
  return {
    A: { rice: a.rice + get, clothes: a.clothes - give },
    B: { rice: b.rice - get, clothes: b.clothes + give },
  };
}

/** 두 섬 모두 기준(1단계)보다 쌀·옷이 같거나 많은가 */
export function isSuccess(result: { A: IslandStock; B: IslandStock }, base: { A: IslandStock; B: IslandStock }): boolean {
  return (['A', 'B'] as const).every((k) => result[k].rice >= base[k].rice && result[k].clothes >= base[k].clothes);
}
