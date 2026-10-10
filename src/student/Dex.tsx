/**
 * S21 무역 도감(기본, PRD 6.13·6.16.3): 탭 5개(상품·항구·개념·수출국 4유형·항해 규칙), 모은 카드/전체 수,
 * 카드 상세에 교과서 문장 + 쪽수. 이미지가 없으면 이름 꼬리표(Img 대체 표시).
 * 모은 카드 판정은 내 상태 `metrics.dex`(상품 'good:x', 항구 'port:X', 개념·수출국 카드 ID) — 호스트가 정한다.
 */
import { useState } from 'preact/hooks';
import { conceptCards, exportTypeCards } from '../data/dex';
import { goods } from '../data/goods';
import { portLabel, ports } from '../data/ports';
import { Img } from '../ui/common/Img';
import { Modal } from './overlays';
import { RuleCards, visibleRuleCards } from './Prep';

export type DexTab = 'goods' | 'ports' | 'concepts' | 'exportTypes' | 'rules';

export interface DexCardView {
  id: string;
  title: string;
  text: string;
  pages: readonly number[];
  image?: string;
  sub?: string;
  examples?: readonly string[];
}

export function dexCards(tab: Exclude<DexTab, 'rules'>): DexCardView[] {
  switch (tab) {
    case 'goods':
      return goods.map((g) => ({ id: `good:${g.id}`, title: g.name, text: g.desc.text, pages: g.desc.pages, image: g.image, sub: g.category }));
    case 'ports':
      return ports.map((p) => ({
        id: `port:${p.id}`,
        title: portLabel(p.id),
        text: p.features.map((f) => f.text).join(' '),
        pages: [...new Set(p.features.flatMap((f) => [...f.pages]))],
        image: p.sceneImage,
      }));
    case 'concepts':
      return conceptCards.map((c) => ({ id: c.id, title: c.title, text: c.text, pages: c.pages, sub: c.unlock }));
    case 'exportTypes':
      return exportTypeCards.map((c) => ({ id: c.id, title: c.title, text: c.text, pages: c.pages, examples: c.examples }));
  }
}

const TABS: { id: DexTab; label: string }[] = [
  { id: 'goods', label: '상품' },
  { id: 'ports', label: '항구' },
  { id: 'concepts', label: '개념' },
  { id: 'exportTypes', label: '수출국 4유형' },
  { id: 'rules', label: '항해 규칙' },
];

export function pagesText(pages: readonly number[]): string {
  return pages.length ? `교과서 ${pages.join('·')}쪽` : '';
}

export function Dex({ collected, comeback, onClose }: { collected: readonly string[]; comeback: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<DexTab>('goods');
  const [open, setOpen] = useState<DexCardView | null>(null);
  const have = new Set(collected);
  const count = (t: DexTab) => {
    if (t === 'rules') {
      const n = visibleRuleCards(comeback).length;
      return `${n}/${n}`;
    }
    const all = dexCards(t);
    return `${all.filter((c) => have.has(c.id)).length}/${all.length}`;
  };

  return (
    <Modal title="무역 도감" onClose={onClose} testId="dex" wide>
      <div class="st-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            type="button"
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            class={`st-tab${tab === t.id ? ' is-on' : ''}`}
            data-testid={`dex-tab-${t.id}`}
            onClick={() => setTab(t.id)}
          >
            {t.label} <span class="st-tab__count">{count(t.id)}</span>
          </button>
        ))}
      </div>
      {tab === 'rules' ? (
        <RuleCards comeback={comeback} />
      ) : (
        <ul class="st-dex-grid" data-testid="dex-grid">
          {dexCards(tab).map((c) => {
            const got = have.has(c.id);
            return (
              <li key={c.id}>
                <button
                  type="button"
                  class={`st-dex-card${got ? '' : ' is-locked'}`}
                  disabled={!got}
                  data-card={c.id}
                  onClick={() => setOpen(c)}
                  aria-label={got ? `${c.title} 카드 보기` : `${c.title} — 아직 못 모았어요`}
                >
                  {c.image ? (
                    <Img path={c.image} alt="" fallbackLabel={c.title.slice(0, 1)} class="st-dex-card__img" width={72} height={72} loading="lazy" />
                  ) : (
                    <span class="st-dex-card__mark" aria-hidden="true">
                      {c.title.slice(0, 1)}
                    </span>
                  )}
                  <span class="st-dex-card__title">{c.title}</span>
                  {!got && <span class="st-dex-card__lock">아직 못 모았어요</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {open && (
        <Modal title={open.title} onClose={() => setOpen(null)} testId="dex-detail">
          {open.image && <Img path={open.image} alt={open.title} fallbackLabel={open.title} class="st-dex-detail__img" />}
          {open.sub && <p class="st-dex-detail__sub">{open.sub}</p>}
          <p>{open.text}</p>
          {open.examples && (
            <ul>
              {open.examples.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          <p class="st-dex-detail__pages">{pagesText(open.pages)}</p>
        </Modal>
      )}
    </Modal>
  );
}
