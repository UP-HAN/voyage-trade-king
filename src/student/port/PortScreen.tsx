/**
 * 항구 화면 S08 (PRD 6.3.3, 6.4.2, 6.5, 6.6, 8.1, 8.3) — 작업 108.
 *
 * 위: 항구 장면 띠(16:9 → 가로 띠로 잘라 보임, 없으면 해도 확대 + 이름 띠) + 오른쪽 위 이름표 "부산 (대한민국)" + 탭 [시장][이야기].
 *   (작업 115) 부산에 있고 공장이 열렸으면(2차시~) [공장] 탭: 레시피 3칸 카드(재료 → 공장 → 상품) + 첫 생산 때 p.101 순환 그림 카드.
 *   조선소 탭은 작업 119 자리(`FUTURE_TABS`).
 * 시장 탭: 팔기(내 화물칸·계약서 카드) → 사기(이 항구에서 싸게 살 수 있는 상품) → [이 항구가 사는 상품 보기].
 * 상품 카드 한 장의 숫자: 값 1개 + 수량(+ 작은 "산 값"). 계산은 103 `quote()`·`applyAction()`만 쓴다(`./market.ts`).
 *
 * 거래: 누르면 `tryPredict`로 결과 이벤트(도장·관세·이익)를 미리 얻고 `store.act`로 보낸다(호스트가 거절하면 저장소가 되돌림 + 토스트).
 * 연속 클릭: 107 `READY_TOGGLE_GUARD_MS`(500ms) 패턴 — 거래 직후 500ms 동안 사기·팔기 버튼 클릭 무시.
 * 연출 훅: 판매 → `fx.stamp(도장 요소, { kind })`(도장마다) → `fx.trade(결과 띠, { profit })`, 구매 → `fx.buy(카드, { good, qty })`.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Action, GameEvent, StampKind } from '../../core';
import { canTrade, cargoCapacity, cargoUsed } from '../../core';
import { conceptCards } from '../../data/dex';
import { goodsById, serviceRules } from '../../data/goods';
import { factoryCycleCard } from '../../data/recipes';
import { lessonPartRulesOf } from '../../data/lessonParts';
import { portsById } from '../../data/ports';
import { pageLabel } from '../../data/text';
import type { GoodId, PortId } from '../../data/types';
import { fx } from '../../ui/common/fx';
import { Stamp } from '../../ui/common/Stamp';
import { Term } from '../../ui/common/Term';
import { classForPredict, playerForPredict, tryPredict } from '../predict';
import type { StudentState, StudentStore } from '../store';
import { formatMoney } from '../text';
import {
  buyCards,
  firstStampConcept,
  limitSentence,
  NOT_TRADING_TEXT,
  overLimitNote,
  profitText,
  saleSummary,
  saleTariffLine,
  sellCards,
  tariffSubject,
  SINGAPORE_NOTE,
  tradeErrorText,
  wantedGoods,
  type BuyCard,
  type SaleSummary,
  type SellCard,
} from './market';
import { helperLine } from '../../core/worksheet-helpers';
import { factoryCards, factoryOpen, type FactoryCard } from './factory';
import { PortScene, PortStory } from './PortCard';
import { ContractIcon, FlameIcon, GoodIcon } from './PortIcons';
import './port.css';

/** 거래 버튼 연속 클릭 무시 시간(107 READY_TOGGLE_GUARD_MS와 같은 값·같은 판정) */
export const TRADE_GUARD_MS = 500;

/** 마지막 거래 뒤 guardMs가 지나야 true (GameScreen.toggleAllowed와 같은 판정 — 순환 import를 피해 여기 둠) */
export function tradeAllowed(lastAt: number | null, now: number, guardMs = TRADE_GUARD_MS): boolean {
  return lastAt === null || now - lastAt >= guardMs;
}

/** L2 이후 작업이 채울 탭(지금은 숨김) */
export const FUTURE_TABS = [
  { id: 'factory', label: '공장', task: '115' },
  { id: 'shipyard', label: '조선소', task: '119' },
] as const;

/** 판매 결과 띠가 보이는 시간 */
const RESULT_MS = 4500;

export interface PortScreenProps {
  store: StudentStore;
  st: StudentState;
  onBack: () => void;
}

type Tab = 'market' | 'factory' | 'story';

function Stepper({
  value,
  max,
  disabled,
  onChange,
  testId,
  unit,
}: {
  value: number;
  max: number;
  disabled: boolean;
  onChange: (n: number) => void;
  testId: string;
  unit: string;
}) {
  return (
    <span class="pt-stepper" data-testid={`${testId}-stepper`}>
      <button type="button" class="pt-stepper__btn" aria-label="하나 빼기" disabled={disabled || value <= 1} onClick={() => onChange(Math.max(1, value - 1))} data-testid={`${testId}-minus`}>
        −
      </button>
      <span class="pt-stepper__val" aria-live="polite" data-testid={`${testId}-qty`}>
        {value}
        <span class="pt-stepper__unit">{unit}</span>
      </span>
      <button type="button" class="pt-stepper__btn" aria-label="하나 더하기" disabled={disabled || value >= max} onClick={() => onChange(Math.min(max, value + 1))} data-testid={`${testId}-plus`}>
        +
      </button>
    </span>
  );
}

function ServiceMark() {
  return (
    <span class="pt-contract" title={serviceRules.tooltip} data-testid="service-mark">
      <ContractIcon />
      계약서 · 배에 싣지 않아요
    </span>
  );
}

function SellCardView({
  c,
  qty,
  setQty,
  trading,
  onSell,
  onFocus,
}: {
  c: SellCard;
  qty: number;
  setQty: (n: number) => void;
  trading: boolean;
  onSell: (el: HTMLElement | null) => void;
  onFocus: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const q = Math.min(Math.max(1, qty), Math.max(1, c.max));
  const used = c.fullLimit > 0 ? Math.min(1, (c.fullLimit - c.fullLeft) / c.fullLimit) : 1;
  const preview = c.fullLimit > 0 ? Math.min(1, (c.fullLimit - c.fullLeft + q) / c.fullLimit) : 1;
  const over = c.reason ? null : overLimitNote(q, c.fullLeft);
  const unit = c.service ? '계약' : '상자';
  return (
    <div
      ref={ref}
      class={`pt-card pt-card--sell${c.service ? ' pt-card--service' : ''}${c.reason ? ' is-off' : ''}${c.hot ? ' is-hot' : ''}`}
      data-testid={`sell-card-${c.good}`}
      data-good={c.good}
      onPointerEnter={onFocus}
      onFocusCapture={onFocus}
    >
      <div class="pt-card__top">
        <GoodIcon good={c.good} />
        <div class="pt-card__title">
          <strong class="pt-card__name">{c.name}</strong>
          {c.tariffRate > 0 && (
            <span class="pt-card__tariff">
              <Stamp kind="tariff" rate={c.tariffRate} size="small" testId="tariff-badge" />
              <span class="st-tag pt-rule-tag" data-testid="tariff-rule-tag" title="관세율은 게임 설정이에요(교과서 108쪽은 관세의 뜻만 다뤄요)">
                게임 규칙
              </span>
            </span>
          )}
          {c.service && <ServiceMark />}
        </div>
      </div>
      {c.reason ? (
        <p class="pt-card__reason" data-testid="sell-reason">
          {c.reason}
        </p>
      ) : (
        <>
          <p class="pt-card__price" data-testid="sell-price">
            여기서 <b>{formatMoney(c.price ?? 0)}</b>
            {c.hot && (
              <span class="pt-hot" data-testid="hot-tag">
                <FlameIcon /> 비싸게 팔 수 있어요
              </span>
            )}
          </p>
          <div
            class={`pt-gauge${over ? ' is-over' : ''}`}
            role="meter"
            aria-valuemin={0}
            aria-valuemax={c.fullLimit}
            aria-valuenow={c.fullLimit - c.fullLeft}
            aria-label={limitSentence(c.name, c.fullLimit, c.service)}
            title={limitSentence(c.name, c.fullLimit, c.service)}
            data-testid="limit-gauge"
          >
            <span class="pt-gauge__preview" style={{ width: `${preview * 100}%` }} />
            <span class="pt-gauge__fill" style={{ width: `${used * 100}%` }} />
          </div>
          {over && (
            <p class="pt-card__over" data-testid="over-note">
              {over}
            </p>
          )}
        </>
      )}
      <p class="pt-card__cost">산 값 {c.boughtFor}</p>
      {!c.reason && (
        <div class="pt-card__act">
          <Stepper value={q} max={c.max} disabled={!trading} onChange={setQty} testId={`sell-${c.good}`} unit={unit} />
          <button type="button" class="btn btn--primary pt-card__btn" disabled={!trading} data-testid={`sell-${c.good}`} onClick={() => onSell(ref.current)}>
            팔기
          </button>
        </div>
      )}
    </div>
  );
}

const TAG_CLASS: Record<string, string> = { S: 'green', R: 'blue', domestic: 'gray' };

function BuyCardView({ c, qty, setQty, trading, onBuy }: { c: BuyCard; qty: number; setQty: (n: number) => void; trading: boolean; onBuy: (el: HTMLElement | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const q = Math.min(Math.max(1, qty), Math.max(1, c.max));
  return (
    <div ref={ref} class={`pt-card pt-card--buy${c.service ? ' pt-card--service' : ''}${c.max === 0 ? ' is-off' : ''}`} data-testid={`buy-card-${c.good}`} data-good={c.good}>
      <div class="pt-card__top">
        <GoodIcon good={c.good} />
        <div class="pt-card__title">
          <strong class="pt-card__name">{c.name}</strong>
          {c.label && (
            <span class={`pt-tag pt-tag--${TAG_CLASS[c.tag ?? ''] ?? 'green'}`} data-testid="buy-tag">
              {c.label}
            </span>
          )}
          {c.service && <ServiceMark />}
        </div>
      </div>
      <p class="pt-card__price" data-testid="buy-price">
        <b>{formatMoney(c.price)}</b>
      </p>
      {c.reason && (
        <p class="pt-card__reason" data-testid="buy-reason">
          {c.reason}
        </p>
      )}
      <div class="pt-card__act">
        <Stepper value={q} max={Math.max(1, c.max)} disabled={!trading || c.max === 0} onChange={setQty} testId={`buy-${c.good}`} unit={c.service ? '계약' : '상자'} />
        <button type="button" class="btn btn--primary pt-card__btn" disabled={!trading || c.max === 0} data-testid={`buy-${c.good}`} onClick={() => onBuy(ref.current)}>
          사기
        </button>
      </div>
    </div>
  );
}

/** 판매 결과 띠: 도장 + 관세 도장 + 이익 문구 */
function SaleResult({ sale, port, onDone }: { sale: SaleSummary & { id: number }; port: PortId; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && typeof el.querySelectorAll === 'function') {
      const stamps = Array.from(el.querySelectorAll<HTMLElement>('[data-stamp]'));
      void (async () => {
        for (const s of stamps) await fx.stamp(s, { kind: s.getAttribute('data-stamp') ?? '' });
        await fx.trade(el, { profit: sale.profit ?? 0 });
      })();
    }
    const t = setTimeout(onDone, RESULT_MS);
    return () => clearTimeout(t);
  }, [sale.id]);
  return (
    <div class="pt-result" ref={ref} role="status" aria-live="polite" data-testid="sale-result">
      {sale.stamps.map((k) => (
        <Stamp key={k} kind={k} size="large" animate testId={`result-stamp-${k}`} />
      ))}
      {sale.tariffRate > 0 && <Stamp kind="tariff" rate={sale.tariffRate} size="large" animate testId="result-stamp-tariff" />}
      {sale.profit !== null && (
        <span class={`pt-result__profit${sale.profit < 0 ? ' is-loss' : ''}`} data-testid="profit-text">
          {profitText(sale.profit)}
        </span>
      )}
      {sale.tariffAmount > 0 && (
        <span class="pt-result__sub" data-testid="sale-tariff-line">
          {saleTariffLine(port, sale.stamps, sale.tariffAmount)}. 위 돈은 관세를 내고 남은 돈이에요.{' '}
          <span class="st-tag pt-rule-tag">게임 규칙: 관세 {Math.round(sale.tariffRate * 100)}%</span>
        </span>
      )}
    </div>
  );
}

/** (작업 115) 공장 레시피 카드: 재료 → 공장 → 상품 3칸 컨베이어 */
function FactoryCardView({ c, qty, setQty, trading, onMake }: { c: FactoryCard; qty: number; setQty: (n: number) => void; trading: boolean; onMake: () => void }) {
  const q = Math.min(Math.max(1, qty), Math.max(1, c.max));
  const off = !trading || c.max === 0;
  return (
    <div class={`pt-card pt-fac${c.max === 0 ? ' is-off' : ''}`} data-testid={`recipe-${c.id}`} data-recipe={c.id} data-max={c.max}>
      <div class="pt-fac__belt">
        <div class="pt-fac__cell" data-testid="recipe-inputs">
          <span class="pt-fac__label">재료</span>
          {c.inputs.map((i) => (
            <span key={i.good} class={`pt-fac__in${i.have < i.need ? ' is-short' : ''}`} data-good={i.good}>
              <GoodIcon good={i.good} size={32} />
              <span>
                {i.name} {i.need}
                <small> (있음 {i.have})</small>
              </span>
            </span>
          ))}
        </div>
        <span class="pt-fac__arrow" aria-hidden="true">→</span>
        <div class="pt-fac__cell pt-fac__cell--mid">
          <span class="pt-fac__label">공장</span>
          <span class="pt-fac__fee">공장비 {formatMoney(c.fee)}</span>
        </div>
        <span class="pt-fac__arrow" aria-hidden="true">→</span>
        <div class="pt-fac__cell">
          <span class="pt-fac__label">상품</span>
          <span class="pt-fac__out">
            <GoodIcon good={c.id} size={40} />
            <strong>{c.name}</strong>
          </span>
        </div>
      </div>
      {c.reason && (
        <p class="pt-card__reason" data-testid="recipe-reason">
          {c.reason}
        </p>
      )}
      <div class="pt-card__act">
        <Stepper value={q} max={Math.max(1, c.max)} disabled={off} onChange={setQty} testId={`make-${c.id}`} unit="상자" />
        <button type="button" class="btn btn--primary pt-card__btn" disabled={off} data-testid={`make-${c.id}`} onClick={onMake}>
          만들기
        </button>
      </div>
    </div>
  );
}

/** (작업 115) 첫 생산 때 한 번: p.101 '천연자원 수입 → 상품 생산 → 상품 수출' 순환 그림 카드 */
function CycleCard({ onClose }: { onClose: () => void }) {
  const c = factoryCycleCard;
  return (
    <div class="pt-concept pt-cycle" role="dialog" aria-label={`개념 카드: ${c.title}`} data-testid="factory-cycle-card">
      <div class="pt-concept__head">
        <strong class="title-font">{c.title}</strong>
      </div>
      <ol class="pt-cycle__steps">
        {c.steps.map((st, i) => (
          <li key={st}>
            <span class="pt-cycle__no">{i + 1}</span> {st}
          </li>
        ))}
      </ol>
      <p>{c.text}</p>
      <p class="pt-pages">({pageLabel(c.pages)})</p>
      <button type="button" class="btn btn--secondary" data-testid="factory-cycle-ok" onClick={onClose}>
        알겠어요
      </button>
    </div>
  );
}

/** 첫 [수출]/[수입]/[중계] 도장 때 한 번 뜨는 작은 개념 카드 */
function ConceptPop({ cardId, stamp, onClose }: { cardId: string; stamp: StampKind; onClose: () => void }) {
  const card = conceptCards.find((c) => c.id === cardId);
  if (!card) return null;
  return (
    <div class="pt-concept" role="dialog" aria-label={`개념 카드: ${card.title}`} data-testid="concept-pop" data-card={cardId}>
      <div class="pt-concept__head">
        <Stamp kind={stamp} size="small" testId="concept-stamp" />
        <strong class="title-font">{card.title}</strong>
      </div>
      <p>{card.text}</p>
      <p class="pt-pages">({pageLabel(card.pages)}) · 도감에 모였어요</p>
      <button type="button" class="btn btn--secondary" data-testid="concept-ok" onClick={onClose}>
        알겠어요
      </button>
    </div>
  );
}

export function PortScreen({ store, st, onBack }: PortScreenProps) {
  const me = st.peer.me;
  const pub = st.peer.public;
  const [tab, setTab] = useState<Tab>('market');
  const [qty, setQtyMap] = useState<Partial<Record<string, number>>>({});
  const [focus, setFocus] = useState<GoodId | null>(null);
  const [showWanted, setShowWanted] = useState(false);
  const [sale, setSale] = useState<(SaleSummary & { id: number }) | null>(null);
  const [concept, setConcept] = useState<{ cardId: string; stamp: StampKind } | null>(null);
  const [cycle, setCycle] = useState(false);
  const lastTrade = useRef<number | null>(null);
  const seq = useRef(0);

  if (!me || !pub?.class) {
    return (
      <section class="pt" data-testid="port-screen">
        <p class="st-loading">항구 정보를 받는 중이에요…</p>
      </section>
    );
  }
  const cls = pub.class;
  const cs = classForPredict(cls);
  // (작업 154) 2차시 앞 시간 판: 싱가포르 중계 안내 줄·첫 [중계] 개념 카드를 숨긴다
  const hideRelay = !!lessonPartRulesOf(cls.settings)?.hideRelay;
  const player = playerForPredict(me);
  const port = portsById[me.game.port];
  const trading = canTrade(cs); // (작업 153 추가) 자유 항해 판은 라운드 사이에도
  const sells = sellCards(cs, player);
  const buys = buyCards(cs, player);
  const wanted = wantedGoods(cs, player);
  const free = Math.max(0, cargoCapacity(player) - cargoUsed(player));
  const qOf = (k: string) => qty[k] ?? 1;
  const setQ = (k: string, n: number) => setQtyMap({ ...qty, [k]: n });
  const hasFactory = factoryOpen(cs, player);
  const facCards = hasFactory ? factoryCards(cs, player) : [];
  const shownTab: Tab = tab === 'factory' && !hasFactory ? 'market' : tab;
  const focusCard = sells.find((c) => c.good === focus && !c.reason) ?? sells.find((c) => !c.reason) ?? null;

  /** 거래 보내기: 미리 계산으로 결과 이벤트를 얻고 보낸다. 보내졌으면 이벤트, 아니면 null */
  const send = (action: Action): GameEvent[] | null => {
    if (!trading) return null;
    const t = Date.now();
    if (!tradeAllowed(lastTrade.current, t)) return null;
    lastTrade.current = t;
    const pre = tryPredict(me, pub, action);
    if (!pre.ok) {
      store.toast(tradeErrorText(pre.code), 'warn');
      return null;
    }
    const r = store.act(action);
    if (r === 'blocked' || r === 'notIn' || r === 'queueFull') return null;
    return pre.events;
  };

  const doSell = (c: SellCard, el: HTMLElement | null) => {
    const n = Math.min(Math.max(1, qOf(`s:${c.good}`)), c.max);
    const events = send({ type: 'sell', good: c.good, qty: n });
    if (!events) return;
    const s = saleSummary(events);
    setSale({ ...s, id: ++seq.current });
    const first = firstStampConcept(player, s.stamps, { hideRelay });
    if (first) setConcept(first);
    setQ(`s:${c.good}`, 1);
    if (s.profit !== null) store.toast(profitText(s.profit), s.profit < 0 ? 'warn' : 'info');
    void el;
  };

  const doBuy = (c: BuyCard, el: HTMLElement | null) => {
    const n = Math.min(Math.max(1, qOf(`b:${c.good}`)), c.max);
    const events = send({ type: 'buy', good: c.good, qty: n });
    if (!events) return;
    setQ(`b:${c.good}`, 1);
    void fx.buy(el, { good: c.good, qty: n });
    store.toast(`${goodsById[c.good].name} ${n}${c.service ? '계약' : '상자'}를 샀어요`, 'info');
  };

  const doMake = (c: FactoryCard) => {
    const n = Math.min(Math.max(1, qOf(`m:${c.id}`)), c.max);
    const events = send({ type: 'produce', recipe: c.id, qty: n });
    if (!events) return;
    setQ(`m:${c.id}`, 1);
    if (events.some((e) => e.type === 'factoryCycleCard')) setCycle(true);
    store.toast(`${c.name} ${n}상자를 만들었어요. 다른 나라에 팔면 [수출]이에요`, 'info');
  };

  return (
    <section class="pt" data-testid="port-screen" data-port={port.id}>
      <header class="pt-head">
        <PortScene port={port.id} class="pt-scene--strip" showName={false} />
        <div class="pt-head__bar">
          <button type="button" class="btn btn--secondary pt-back" data-testid="port-back" onClick={onBack}>
            해도로 돌아가기
          </button>
          <div class="pt-tabs" role="tablist" aria-label="항구 메뉴">
            <button type="button" role="tab" aria-selected={shownTab === 'market'} class={`pt-tab${shownTab === 'market' ? ' is-on' : ''}`} data-testid="tab-market" onClick={() => setTab('market')}>
              시장
            </button>
            {/* (작업 115) 공장: 2차시부터, 부산에서만. 조선소(119) 자리 */}
            {hasFactory && (
              <button type="button" role="tab" aria-selected={shownTab === 'factory'} class={`pt-tab${shownTab === 'factory' ? ' is-on' : ''}`} data-testid="tab-factory" onClick={() => setTab('factory')}>
                공장
              </button>
            )}
            <button type="button" role="tab" aria-selected={shownTab === 'story'} class={`pt-tab${shownTab === 'story' ? ' is-on' : ''}`} data-testid="tab-story" onClick={() => setTab('story')}>
              이야기
            </button>
          </div>
        </div>
        <h1 class="pt-name title-font" data-testid="port-name">
          {port.name} ({port.country})
        </h1>
      </header>

      {!trading && (
        <p class="pt-notice" role="status" data-testid="not-trading">
          {NOT_TRADING_TEXT}
        </p>
      )}

      {shownTab === 'story' ? (
        <div class="pt-body pt-body--story">
          <PortStory port={port.id} />
        </div>
      ) : shownTab === 'factory' ? (
        <div class="pt-body" data-testid="factory">
          <section class="pt-sec" aria-labelledby="pt-fac-h">
            <div class="pt-sec__head">
              <h2 id="pt-fac-h" class="pt-sec__title title-font">
                부산 공장
              </h2>
              <span class="pt-sec__help">
                다른 나라에서 사 온 자원으로 상품을 만들어요. 만든 상품을 다른 나라에 팔면 <Term id="export" />이에요.
              </span>
              <span class="st-tag pt-rule-tag" title="공장비와 레시피는 게임 설정이에요(교과서 101쪽)">
                게임 규칙
              </span>
              <span class="pt-hold" data-testid="factory-hold">
                배 빈칸 {free} · 자금 {formatMoney(me.game.money)}
              </span>
            </div>
            <p class="pt-fac__record" data-testid="factory-record">
              <b>내 기록</b> {helperLine('importProduceExport', { cls: { votes: cls.votes }, player: me })}
            </p>
            {me.game.log.some((e) => e.ref === 'startCargo') && (
              <p class="pt-limit" data-testid="factory-start-cargo">
                <span class="st-tag pt-rule-tag">게임 규칙</span> 2차시는 담맘에서 사 온 원유 2상자를 싣고 시작해요. 바로 석유 제품을 만들어 다른 나라에 팔아 보세요.
              </p>
            )}
            <div class="pt-grid pt-grid--fac" data-testid="recipe-list">
              {facCards.map((c) => (
                <FactoryCardView key={c.id} c={c} qty={qOf(`m:${c.id}`)} setQty={(n) => setQ(`m:${c.id}`, n)} trading={trading} onMake={() => doMake(c)} />
              ))}
            </div>
            <p class="pt-limit" data-testid="factory-where">
              재료는 다른 나라 항구에서 사 와요: 원유(담맘·로스앤젤레스), 철광석(포트헤들랜드), 흑연(상하이), 니켈(자카르타), 정밀 화학 원료(요코하마·로테르담).
            </p>
          </section>
        </div>
      ) : (
        <div class="pt-body">
          <section class="pt-sec pt-sec--sell" aria-labelledby="pt-sell-h">
            <div class="pt-sec__head">
              <h2 id="pt-sell-h" class="pt-sec__title title-font">
                팔기
              </h2>
              <span class="pt-sec__help">
                우리 상품을 다른 나라에 팔면 <Term id="export" />, 다른 나라에서 사 온 상품을 우리나라(부산)에 팔면 <Term id="import" />이에요.
              </span>
              <span class="st-tag pt-rule-tag" title="값과 한도는 게임 설정이에요">
                게임 규칙
              </span>
            </div>
            {port.id === 'SIN' && !hideRelay && (
              <p class="pt-sec__note" data-testid="singapore-note">
                <span class="st-tag pt-rule-tag">게임 규칙</span> {SINGAPORE_NOTE.replace(/^게임 규칙: ?/, '')} (<Term id="relay" /> 무역항)
              </p>
            )}
            {sells.length === 0 ? (
              <p class="pt-empty" data-testid="sell-empty">
                배에 실은 상품이 없어요. 아래에서 사 보세요.
              </p>
            ) : (
              <div class="pt-grid" data-testid="sell-list">
                {sells.map((c) => (
                  <SellCardView
                    key={c.good}
                    c={c}
                    qty={qOf(`s:${c.good}`)}
                    setQty={(n) => setQ(`s:${c.good}`, n)}
                    trading={trading}
                    onSell={(el) => doSell(c, el)}
                    onFocus={() => setFocus(c.good)}
                  />
                ))}
              </div>
            )}
            {focusCard && (
              <p class="pt-limit" data-testid="limit-sentence">
                {limitSentence(focusCard.name, focusCard.fullLimit, focusCard.service)}. 넘게 팔면 값이 낮아져요.
                {sells.some((c) => c.tariffRate > 0) && (
                  <>
                    {' '}
                    <span data-testid="tariff-who">
                      {tariffSubject(port.id)} 다른 나라에서 들어오는 상품에 <Term id="tariff" up />를 매겨요.
                    </span>
                  </>
                )}
              </p>
            )}
          </section>

          <section class="pt-sec pt-sec--buy" aria-labelledby="pt-buy-h">
            <div class="pt-sec__head">
              <h2 id="pt-buy-h" class="pt-sec__title title-font">
                이 항구에서 싸게 살 수 있어요
              </h2>
              <span class="pt-sec__help">
                배에 싣는 <Term id="goodsMaterial" up />, 계약으로 사는 <Term id="service" up />
              </span>
              <span class="pt-hold" data-testid="hold-info">
                배 빈칸 {free} · 자금 {formatMoney(me.game.money)}
              </span>
            </div>
            {buys.length === 0 ? (
              <p class="pt-empty">이 항구에서 싸게 파는 상품이 없어요.</p>
            ) : (
              <div class="pt-grid" data-testid="buy-list">
                {buys.map((c) => (
                  <BuyCardView key={c.good} c={c} qty={qOf(`b:${c.good}`)} setQty={(n) => setQ(`b:${c.good}`, n)} trading={trading} onBuy={(el) => doBuy(c, el)} />
                ))}
              </div>
            )}
            <button type="button" class="link-small pt-wanted-btn" aria-expanded={showWanted} data-testid="wanted-toggle" onClick={() => setShowWanted(!showWanted)}>
              {showWanted ? '사는 상품 접기' : '이 항구가 사는 상품 보기'}
            </button>
            {showWanted && (
              <ul class="pt-wanted" data-testid="wanted-list">
                {wanted.map((w) => (
                  <li key={w.good} class={w.hot ? 'is-hot' : ''}>
                    {w.hot && <FlameIcon size={18} />}
                    {w.name}
                    {w.hot && <span class="st-sr"> (비싸게 사요)</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {sale && <SaleResult sale={sale} port={port.id} onDone={() => setSale(null)} />}
      {cycle && <CycleCard onClose={() => setCycle(false)} />}
      {concept && <ConceptPop cardId={concept.cardId} stamp={concept.stamp} onClose={() => setConcept(null)} />}
    </section>
  );
}

export default PortScreen;
