/**
 * (작업 115) L2-E6 세관 게시판 장면(PRD 4.4 L2-E6, 교과서 p.100).
 *
 * 학급 전체가 부산에 들여온 상품([수입] 판매)과 다른 나라에 내보낸 상품([수출] 판매) 상자 수 순위(공개 상태 `customsBoard`,
 * 이름 없이 합계만) + 교과서 100쪽의 우리나라 주요 수입품·수출품을 나란히 보여 준다. 그림 없이 막대만(연출보다 흐름 우선).
 */
import { goodsById } from '../../data/goods';
import type { GoodId } from '../../data/types';
import type { ScreenData } from '../model';
import { Bar } from '../parts';
import type { SceneProps } from './types';

export const CUSTOMS_EVENT_ID = 'L2-E6';
/** 순위 줄 수 */
export const CUSTOMS_TOP = 5;

/** 교과서 p.100 우리나라 주요 수입품·수출품(도감 SUM-L2 첫 줄과 같은 낱말) */
export const TEXTBOOK_P100 = {
  imports: ['원유', '정밀 화학 원료', '천연가스', '석탄'],
  exports: ['반도체', '자동차', '무선 통신 기기', '석유 제품'],
} as const;

export interface CustomsRow {
  good: GoodId;
  label: string;
  value: number;
  /** 교과서 p.100 목록에도 있는 상품 */
  inBook: boolean;
}

export interface CustomsModel {
  imports: CustomsRow[];
  exports: CustomsRow[];
  /** 거래 기록이 하나도 없음 */
  empty: boolean;
}

function rows(c: Partial<Record<GoodId, number>> | undefined, book: readonly string[]): CustomsRow[] {
  return (Object.entries(c ?? {}) as [GoodId, number][])
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, CUSTOMS_TOP)
    .map(([good, value]) => {
      const label = goodsById[good]?.name ?? good;
      return { good, label, value, inBook: book.includes(label) };
    });
}

/** 공개 상태 → 세관 게시판 모델 */
export function customsModel(d: Pick<ScreenData, 'pub'>): CustomsModel {
  const b = d.pub.customsBoard ?? null;
  const imports = rows(b?.imports, TEXTBOOK_P100.imports);
  const exports = rows(b?.exports, TEXTBOOK_P100.exports);
  return { imports, exports, empty: imports.length === 0 && exports.length === 0 };
}

function Column({ title, list, book, testId }: { title: string; list: CustomsRow[]; book: readonly string[]; testId: string }) {
  const max = Math.max(1, ...list.map((r) => r.value));
  return (
    <section class="scr-panel scr-customs__col" data-testid={testId}>
      <h2 class="scr-customs__h">{title}</h2>
      {list.length ? (
        list.map((r, i) => <Bar key={r.good} label={`${i + 1}. ${r.label}${r.inBook ? ' ★' : ''}`} value={r.value} max={max} suffix="상자" testId={`${testId}-row`} />)
      ) : (
        <p class="scr-lead">아직 기록이 없어요</p>
      )}
      <p class="scr-customs__book" data-testid={`${testId}-book`}>
        교과서 100쪽: {book.join(', ')}
      </p>
    </section>
  );
}

export function CustomsScene({ d }: SceneProps) {
  const m = customsModel(d);
  return (
    <div class="scr-scene scr-customs" data-testid="scene-customs" data-empty={m.empty ? '1' : '0'}>
      <p class="scr-kicker">세관 게시판 · 교과서 100쪽과 비교해요</p>
      <h1 class="scr-h1">우리 반이 부산에 들여온 상품, 내보낸 상품</h1>
      <div class="scr-customs__cols">
        <Column title="부산에 들여온 상품(수입)" list={m.imports} book={TEXTBOOK_P100.imports} testId="customs-imports" />
        <Column title="다른 나라에 내보낸 상품(수출)" list={m.exports} book={TEXTBOOK_P100.exports} testId="customs-exports" />
      </div>
      <p class="scr-lead scr-customs__ask">★ = 교과서에도 나오는 상품 · 우리 반 게시판과 교과서 그림은 무엇이 닮았나요?</p>
    </div>
  );
}

/** 세관 게시판 사건이 열려 있는 동안(자동 장면, 일시정지·학습지 팝업이 아닐 때) — 사건 카드 대신 게시판 */
export function customsPicker(d: ScreenData): string | null {
  const ce = d.cls.currentEvent;
  if (d.cls.paused || d.cls.worksheet.current?.length) return null;
  return ce && !ce.closed && ce.id === CUSTOMS_EVENT_ID ? 'customs' : null;
}
