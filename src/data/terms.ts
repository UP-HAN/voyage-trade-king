/**
 * 용어 풀이 사전 (PRD 8.1-4: 처음 나오는 한자어 용어는 밑줄 + 탭하면 교과서 풀이·쪽수) — 작업 108.
 * 풀이는 교과서 문장(본문·날개 풀이)에 근거하고 모든 항목에 쪽수를 단다(PRD 2장 1번).
 * 화면 부품: `src/ui/common/Term.tsx`.
 */
import type { PageList } from './types';

export type TermId = 'tariff' | 'relay' | 'goodsMaterial' | 'service' | 'export' | 'import' | 'trade';

export interface TermDef {
  id: TermId;
  /** 화면에 밑줄로 보이는 낱말 */
  word: string;
  /** 교과서 풀이 */
  text: string;
  pages: PageList;
}

export const terms: readonly TermDef[] = [
  {
    id: 'trade', word: '무역', pages: [96],
    text: '나라와 나라 사이에 물자나 서비스를 사고팔거나 교환하는 일을 무역이라고 해요.',
  },
  {
    id: 'export', word: '수출', pages: [96],
    text: '다른 나라에 물자나 서비스를 파는 것을 수출이라고 해요.',
  },
  {
    id: 'import', word: '수입', pages: [96],
    text: '다른 나라에서 물자나 서비스를 사 오는 것을 수입이라고 해요.',
  },
  {
    id: 'goodsMaterial', word: '물자', pages: [96],
    text: '물자는 어떤 활동에 필요한 물건이나 물건을 만드는 데 필요한 원료예요.',
  },
  {
    id: 'service', word: '서비스', pages: [96, 103],
    text: '나라 사이에는 물자뿐 아니라 서비스도 사고팔아요. 우리나라는 미국에서 온라인 동영상 서비스를 수입해요.',
  },
  {
    id: 'relay', word: '중계', pages: [104],
    text: '싱가포르에는 여러 나라에서 생산한 상품들이 모이고, 이 상품들을 필요한 나라에 다시 파는 형태의 무역이 발달했어요.',
  },
  {
    id: 'tariff', word: '관세', pages: [108],
    text: '관세는 다른 나라에서 수입하는 상품에 부과하는 세금이에요.',
  },
];

export const termsById: Readonly<Record<TermId, TermDef>> = Object.fromEntries(terms.map((t) => [t.id, t])) as Record<TermId, TermDef>;
