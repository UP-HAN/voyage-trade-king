/**
 * 잡지 표지 「이달의 기업」 (L4-E8, PRD 6.14.3, 교과서 p.112~113) — 작업 174.
 *
 * 교사가 마무리 카드에서 고른 방식(`wrap.magazineMode`, 무역 40분 미만이면 기본 종이 — 교사 확정 2026-10-30)에 따라:
 * - 종이: "교과서 112~113쪽과 학습지 ⑰에 써요" + 내 기록 도우미(수출액 1위 상품·주요 수출국 제안, 4차시 공장 결정 한 줄)만.
 * - 게임: 6칸(대표 상품·수출국은 수출 기록에서 자동 제안, 고칠 수 있음) + 배경 3종 + 미리보기(아래 '항해 기록' 띠) → [다 썼어요]
 *   → 응답 `{ fields, bg }`(다시 보낼 수 있음, 4·5번을 쓰면 사회적 책임 +10은 한 번만 — activities.ts).
 * PNG 저장·인쇄는 범위 밖(후속). 학생은 미리보기를 보고 학습지 ⑰에 옮겨 쓴다.
 */
import { useState } from 'preact/hooks';
import type { Action, PublicClass, PublicState, PublicWrap } from '../../core';
import { helperInputs } from '../../core/worksheet-helpers';
import { goodsById } from '../../data/goods';
import { magazineBackgrounds, magazineFields, magazinePaperText } from '../../data/magazine';
import { helperText, magazineSuggestion } from '../../data/worksheetHelpers';
import { worksheetById } from '../../data/worksheet';
import { img } from '../../ui/common/asset';
import { MagazineCoverCard } from '../../ui/cards/MagazineCoverCard';
import type { MeView } from '../predict';
import type { StudentActResult } from '../store';
import { revealedAwards, wrapItemOf } from './model';

export interface MagazineCoverProps {
  cls: PublicClass;
  pub: PublicState | null;
  me: MeView;
  wrap: PublicWrap | null;
  act: (action: Action) => StudentActResult;
}

function savedCover(me: MeView): { fields: string[]; bg: number } | null {
  const c = me.game.cover as { fields?: unknown; bg?: unknown } | null | undefined;
  if (!c || typeof c !== 'object' || !Array.isArray(c.fields) || me.game.responses['L4-E8'] === undefined) return null;
  const bg = Number(c.bg);
  return { fields: c.fields.map((f) => String(f ?? '')), bg: bg >= 1 && bg <= 3 ? bg : 1 };
}

/** 내 기록에서 고른 제안(대표 상품 이름·주요 수출국)과 공장 결정 한 줄 */
export function magazineHints(cls: PublicClass, me: MeView, pub: PublicState | null) {
  let good: string | null = null;
  let country: string | null = null;
  let draftLine = '';
  let factoryLine: string | null = null;
  try {
    const inputs = helperInputs({ cls: cls as never, player: me as never, pub: pub as never });
    if (inputs.magazineDraft) {
      const s = magazineSuggestion(inputs.magazineDraft);
      good = s.good ? (goodsById[s.good]?.name ?? null) : null;
      country = s.country;
    }
    draftLine = helperText('magazineDraft', inputs.magazineDraft);
    if (inputs.factoryDecision) factoryLine = helperText('factoryDecision', inputs.factoryDecision);
  } catch {
    // 도우미가 없어도 표지는 쓸 수 있다
  }
  return { good, country, draftLine, factoryLine };
}

export function MagazineCover({ cls, pub, me, wrap, act }: MagazineCoverProps) {
  const mode = wrap?.magazineMode ?? 'paper';
  const item = wrapItemOf(cls, 'magazine');
  const ws = item?.worksheetIds.includes('W17') ? worksheetById.W17 : null;
  const hints = magazineHints(cls, me, pub);
  const saved = savedCover(me);
  const [fields, setFields] = useState<string[]>(() => saved?.fields ?? [hints.good ?? '', '', hints.country ?? '', '', '', '']);
  const [bg, setBg] = useState<number>(saved?.bg ?? 1);
  const [sentText, setSentText] = useState<string | null>(saved ? JSON.stringify([saved.fields, saved.bg]) : null);
  const [broken, setBroken] = useState<Record<number, boolean>>({});

  if (mode === 'paper') {
    return (
      <section class="st-wrap__sec" data-testid="wrap-magazine" data-mode="paper">
        <h2 class="title-font">잡지 표지 「이달의 기업」</h2>
        <p class="st-wrap__lead">기업의 대표가 되어 우리 회사를 소개하는 잡지 표지를 만들어요.</p>
        <p class="wz-paper" data-testid="magazine-paper">
          {magazinePaperText}
        </p>
        <ul class="wz-hints" data-testid="magazine-hints">
          <li>[내 기록: {hints.draftLine}]</li>
          {hints.factoryLine && <li>[공장 결정: {hints.factoryLine}]</li>}
        </ul>
        <p class="st-wrap__where">칸 이름: {magazineFields.map((f) => f.label).join(' · ')}</p>
      </section>
    );
  }

  const dirty = sentText !== JSON.stringify([fields, bg]);
  const exportsV = me.game.metrics.exports ?? 0;
  const ports = me.game.metrics.visited?.length ?? 0;
  const myAwards = revealedAwards(pub, wrap).filter((a) => a.winners.some((w) => w.pid === me.pid)).map((a) => a.award);
  const submit = () => {
    const r = act({ type: 'respondEvent', eventId: 'L4-E8', response: { fields, bg } as never });
    if (r !== 'blocked') setSentText(JSON.stringify([fields, bg]));
  };
  return (
    <section class="st-wrap__sec wz-mag" data-testid="wrap-magazine" data-mode="game">
      <h2 class="title-font">잡지 표지 「이달의 기업」</h2>
      <p class="st-wrap__lead">기업의 대표가 되어 우리 회사를 소개하는 잡지 표지를 만들어요. (교과서 112~113쪽)</p>
      <div class="wz-mag__grid">
        <div class="wz-mag__form">
          {magazineFields.map((f, i) => (
            <label key={f.no} class="wz-q">
              <span class="wz-q__text">
                {f.no}. {f.label}
              </span>
              <input
                type="text"
                class="wz-input"
                data-testid="magazine-input"
                data-no={f.no}
                maxLength={f.max}
                value={fields[i] ?? ''}
                placeholder={f.placeholder}
                onInput={(e) => {
                  const v = [...(e.currentTarget as HTMLInputElement).value].slice(0, f.max).join('');
                  setFields((a) => a.map((x, j) => (j === i ? v : x)));
                }}
              />
              <small class="wz-count">
                {[...(fields[i] ?? '')].length}/{f.max}
                {i === 0 && hints.good ? ` · 수출액 1위 상품: ${hints.good}` : ''}
                {i === 2 && hints.country ? ` · 수출액 1위 나라: ${hints.country}` : ''}
              </small>
              {i === 4 && hints.factoryLine && (
                <small class="wz-ref" data-testid="magazine-factory-ref">
                  참고(내 공장 결정): {hints.factoryLine}
                </small>
              )}
            </label>
          ))}
          <fieldset class="wz-bgs">
            <legend>배경 고르기</legend>
            {magazineBackgrounds.map((b) => (
              <button
                key={b.no}
                type="button"
                class={`wz-bg${bg === b.no ? ' wz-bg--on' : ''}`}
                data-testid="magazine-bg"
                data-bg={b.no}
                aria-pressed={bg === b.no}
                aria-label={`배경 ${b.no}: ${b.label}`}
                style={{ background: b.color }}
                onClick={() => setBg(b.no)}
              >
                {!broken[b.no] && <img src={img(b.image)} alt="" decoding="async" onError={() => setBroken((x) => ({ ...x, [b.no]: true }))} />}
                <span>{b.label}</span>
              </button>
            ))}
          </fieldset>
        </div>
        <div class="wz-mag__preview" data-testid="magazine-preview">
          <MagazineCoverCard
            company={me.company.name}
            flag={{ color: me.company.color, emblem: me.company.emblem }}
            avatar={me.company.avatar || null}
            fields={fields}
            bg={bg}
            hints
            record={{ exports: Math.round(exportsV), ports, awards: myAwards }}
          />
        </div>
      </div>
      <div class="wz-actions">
        <button type="button" class="btn btn--primary btn--large" data-testid="magazine-submit" disabled={!dirty && sentText !== null} onClick={submit}>
          {sentText !== null && !dirty ? '보냈어요' : '다 썼어요'}
        </button>
      </div>
      {sentText !== null && !dirty && (
        <p class="st-wrap__where" data-testid="magazine-sent" role="status">
          선생님께 보냈어요. 선생님이 고른 표지는 공용 화면에 크게 나와요. 고쳐 쓰면 다시 보낼 수 있어요.
        </p>
      )}
      {ws && <p class="st-wrap__where">미리보기를 보고 학습지 {ws.label}({ws.pagesLabel})에 옮겨 써요.</p>}
    </section>
  );
}

export default MagazineCover;
