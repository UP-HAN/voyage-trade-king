/**
 * (작업 172) 3차시 학생 사건 카드 조각 — 광물 협력 기사(밑줄 → 결정), 기술 경쟁 결과 줄, 스마트폰 결과·경제 게이지, 부품 팀 안내.
 * 문구는 쉬운 말(초6). 화면에 '선택'·차시 개발 표기를 쓰지 않는다.
 */
import { useState } from 'preact/hooks';
import type { PublicClass, PublicState } from '../../core';
import { goodsById } from '../../data/goods';
import { econGaugeOf, lessonPartRulesOf } from '../../data/lessonParts';
import { econGaugeLine, PHONE_PART_WHERE, PHONE_TEXT } from '../../data/phone';
import { textbookArticles, type TextbookArticle } from '../../data/text';
import type { GoodId } from '../../data/types';
import { ArticleCard } from '../../ui/cards';
import type { MeView } from '../predict';

/** 기사 밑줄 단계(L3-E1 전체 형태): 문장을 눌러 밑줄 → [다 찾았어요] → 결정 카드. (작업 173) 4차시 베트남 기사(L4-E2)도 같은 틀 */
export function ArticleRead({ onDone, article = textbookArticles.mineralCoop, help = '두 나라가 기대하는 이익을 찾아 문장을 눌러 밑줄을 그어요.', doneLabel = '다 읽었어요 · 고르러 가기' }: { onDone: () => void; article?: TextbookArticle; help?: string; doneLabel?: string }) {
  const [marks, setMarks] = useState<string[]>([]);
  const [show, setShow] = useState(false);
  const toggle = (s: string) => setMarks((m) => (m.includes(s) ? m.filter((x) => x !== s) : [...m, s]));
  return (
    <ArticleCard article={article} underlined={marks} onToggle={toggle} showTargets={show} testId="article-card">
      <p class="vc__article-help" data-testid="article-help">
        {help}
      </p>
      <ul class="vc__targets">
        {article.underlineTargets.map((t) => (
          <li key={t.label}>{t.label}</li>
        ))}
      </ul>
      <div class="vc__foot">
        {!show && (
          <button type="button" class="btn btn--secondary" data-testid="article-show" onClick={() => setShow(true)}>
            찾을 문장 보기
          </button>
        )}
        <button type="button" class="btn btn--primary" data-testid="article-done" onClick={onDone}>
          {doneLabel}
        </button>
      </div>
    </ArticleCard>
  );
}

/** L3-E3 결과 한 줄(마감 뒤 — 응답에 won 이 남는다) */
export function techResultLine(me: MeView): { won: boolean; text: string; fake: boolean } | null {
  const r = me.game.responses['L3-E3'] as Record<string, unknown> | undefined;
  if (!r || typeof r !== 'object' || typeof r.won !== 'boolean') return null;
  if (r.won) return { won: true, text: 'AI 반도체를 만들 수 있게 됐어요(부산 [공장] · 반도체 2상자로 만들어요)', fake: false };
  return { won: false, text: '다른 나라도 품질 좋은 반도체를 내놓았어요 — 2라운드 동안 반도체 판매 값이 10% 내려요', fake: true };
}

/** 부품 이름 목록 "반도체, 흑연" */
export function partNames(goods: readonly GoodId[]): string {
  return goods.map((g) => goodsById[g]?.name ?? g).join(', ');
}

/** 스마트폰 결과 한 줄(공개 상태 phone) */
export function phoneResultText(phone: PublicState['phone'] | undefined | null): string {
  if (!phone) return '';
  if (phone.complete) return PHONE_TEXT.complete;
  const missing = phone.parts.filter((p) => p.have < p.need).map((p) => p.good);
  return PHONE_TEXT.missing(partNames(missing));
}

/** L3-E5 학생 카드: 스마트폰 결과(앞 시간·두 시간 모두) → 경제 게이지(뒤 시간·두 시간 모두) */
export function PhoneResultBody({ cls, pub }: { cls: PublicClass; pub: PublicState | null | undefined }) {
  const gauge = econGaugeOf(lessonPartRulesOf(cls.settings));
  const phone = pub?.phone;
  return (
    <div class="ev-phone" data-testid="phone-result">
      {phone && gauge !== 'stageEnd' && (
        <>
          <p class={`ev-phone__line${phone.complete ? ' is-done' : ''}`} data-testid="phone-result-line" data-complete={phone.complete ? '1' : '0'}>
            {phoneResultText(phone)}
          </p>
          <ul class="ev-phone__parts">
            {phone.parts.map((p) => (
              <li key={p.good} class={p.have >= p.need ? 'is-done' : ''}>
                {goodsById[p.good]?.name ?? p.good} {p.have}/{p.need}
              </li>
            ))}
          </ul>
          <p class="ev-phone__end">{PHONE_TEXT.end} (교과서 106쪽)</p>
        </>
      )}
      {gauge !== 'none' && pub?.econGauge && (
        <p class="ev-phone__gauge" data-testid="econ-gauge-line" data-step={pub.econGauge.step}>
          경제 게이지 · {econGaugeLine(pub.econGauge.avg)} (교과서 107쪽)
        </p>
      )}
    </div>
  );
}

/** (172 검증 반영) L3-E5 카드 띠의 교과서 쪽: 앞 시간(게이지 없음) 106, 뒤 시간(게이지만) 107, 그 밖 106~107 */
export function phoneResultPages(cls: Pick<PublicClass, 'settings'>): readonly number[] {
  const g = econGaugeOf(lessonPartRulesOf(cls.settings));
  return g === 'none' ? [106] : g === 'stageEnd' ? [107] : [106, 107];
}

/** 임무 패널: 우리 팀 부품 한 줄 */
export function PhoneTeamLine({ me }: { me: MeView }) {
  const team = me.game.phone?.team;
  if (!team) return null;
  return (
    <p class="ev-first__sub" data-testid="phone-team-line" data-team={team}>
      우리 팀 부품: <b>{goodsById[team]?.name ?? team}</b> · {PHONE_PART_WHERE[team] ?? ''} · 부산 [조립장]에 넣어요. 다른 팀 부품을 넣어 도와도 좋아요.
    </p>
  );
}
