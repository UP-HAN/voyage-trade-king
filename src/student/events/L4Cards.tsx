/**
 * (작업 173) 4차시 학생 사건 카드 — 1970년대 철강 단계 카드(L4-E1), 호찌민 공장 결정 3단계(L4-E2), 근로 환경 보도·고치기(L4-E3).
 * 문구는 쉬운 말(초6), 학생 문구에 '선택'·차시 개발 표기를 쓰지 않는다. 다른 회사 이름은 어디에도 보이지 않는다.
 */
import type { ComponentChildren } from 'preact';
import { createContext } from 'preact';
import { useContext, useState } from 'preact/hooks';
import { VN_FACTORY, isBadChoice, parseVNDecision, vnFactoryOutcome, vnUpfrontCost, type VNDecision } from '../../core/factoryVN';
import { textbookArticles } from '../../data/text';
import { OTHER_FACTORY_STORY, VN_REPORT_TEXT, VN_STEPS, VN_TEXT } from '../../data/vnFactory';
import { linkPages, REASON_MAX } from '../../ui/cards';
import type { MeView } from '../predict';
import { ArticleRead } from './L3Cards';

/** (검증 반영) 방금 보낸 공장 결정·고치기를 호스트가 되돌린 오류 코드(EventLayer가 넣음) */
export const VNErrorContext = createContext<string | null>(null);

/** 쓸 수 있는 돈(자유 항해 = 자금 − 낼 운항비) */
export function spendableOf(me: MeView, free: boolean): number {
  return free ? me.game.money - (me.game.fareDue ?? 0) : me.game.money;
}

/** 내 공장 결정(응답 기록에서) */
export function myVNDecision(me: MeView): VNDecision | null {
  return parseVNDecision(me.game.responses['L4-E2']);
}

/** 정산 한 줄(정한 뒤) */
export function vnResultLines(d: VNDecision): { line: string; sub: string | null } {
  if (!d.build) return { line: VN_TEXT.notBuilt, sub: null };
  const o = vnFactoryOutcome(d);
  const profit = VN_FACTORY.wage[d.wage ?? 'fair'].profit;
  return { line: VN_TEXT.resultLine(profit, o.csr), sub: VN_TEXT.resultSub(o.money) };
}

function Facts({ good, worry, cost }: { good: string; worry: string; cost: string }) {
  return (
    <dl class="vc__opt-facts">
      <dt>좋은 점</dt>
      <dd>{good}</dd>
      <dt>걱정되는 점</dt>
      <dd>{worry}</dd>
      <dt>비용</dt>
      <dd>{cost}</dd>
    </dl>
  );
}

/** 다른 회사의 공장 이야기(읽기만, p.109) */
export function OtherFactoryStory({ children }: { children?: ComponentChildren }) {
  return (
    <section class="ev-vn-story" data-testid="vn-other-story">
      <h3 class="vc__reveal-title">{OTHER_FACTORY_STORY.title}</h3>
      {OTHER_FACTORY_STORY.lines.map((l, i) => (
        <p key={i} class="vc__p">
          {l}
        </p>
      ))}
      <span class="ev-summary__pages">{linkPages(OTHER_FACTORY_STORY.pages)}</span>
      {children}
    </section>
  );
}

/** 정한 뒤 결과(내 결정 + 정산 한 줄 + 짓지 않았으면 다른 회사 이야기) */
export function VNDecided({ d, children }: { d: VNDecision; children?: ComponentChildren }) {
  const r = vnResultLines(d);
  const label = (k: 'build' | 'wage' | 'env', id: string) => VN_STEPS.find((s) => s.key === k)!.options.find((o) => o.id === id)?.label ?? id;
  return (
    <div class="ev-vn-done" data-testid="vn-decided" data-build={d.build ? '1' : '0'}>
      <p class="vc__chosen-label">
        내가 정한 것: <b>{d.build ? `${label('build', 'yes')} · ${label('wage', d.wage ?? 'fair')} · 환경 설비 ${d.env === 'skip' ? '설치 안 함' : '설치'}` : label('build', 'no')}</b>
      </p>
      <p class="ev-vn-result" data-testid="vn-result-line">
        {r.line}
      </p>
      {r.sub && <p class="vc__p">{r.sub}</p>}
      {d.reason && <p class="vc__p">까닭: {d.reason}</p>}
      {!d.build && <OtherFactoryStory />}
      {children}
    </div>
  );
}

/**
 * 공장 결정 3단계 카드: ① 짓기 → ② 임금 → ③ 환경 설비 → ④ 까닭(쓰고 싶으면) → [이대로 정해요].
 * 짓지 않으면 바로 까닭 단계. 응답 { build, wage, env, reason } (core parseVNDecision).
 */
export function VNFactoryCard({ panel, budget, onDecide, error }: { panel?: boolean; budget: number; onDecide: (d: VNDecision) => void; error?: string | null }) {
  const [build, setBuild] = useState<boolean | null>(null);
  const [wage, setWage] = useState<'fair' | 'low' | null>(null);
  const [env, setEnv] = useState<'install' | 'skip' | null>(null);
  const [reason, setReason] = useState('');
  const step = build === null ? 0 : !build ? 3 : wage === null ? 1 : env === null ? 2 : 3;
  const draft: VNDecision | null = build === null ? null : !build ? { build: false } : wage && env ? { build: true, wage, env } : null;
  const short = draft ? vnUpfrontCost(draft) > budget : false;
  const pickers = [
    (id: string) => setBuild(id === 'yes'),
    (id: string) => setWage(id as 'fair' | 'low'),
    (id: string) => setEnv(id as 'install' | 'skip'),
  ];
  const back = () => {
    if (step === 3 && build) setEnv(null);
    else if (step === 3) setBuild(null);
    else if (step === 2) setWage(null);
    else if (step === 1) setBuild(null);
  };
  return (
    <article class={`vc vc--student vc--article vc--vn${panel ? ' vc--panel' : ''}`} data-testid="vn-card" data-step={step}>
      <div class="vc__band vc__band--article" data-band="article">
        <span class="vc__band-text">{VN_TEXT.band}</span>
        <span class="vc__kind">결정</span>
        <span class="vc__band-pages">{linkPages([109])}</span>
      </div>
      <div class="vc__text">
        <h2 class="vc__title" data-testid="card-title">
          {VN_TEXT.title}
        </h2>
        <ol class="ev-vn-steps" aria-label="결정 단계">
          {['짓기', '임금', '환경 설비', '까닭'].map((t, i) => (
            <li key={t} class={i === step ? 'is-now' : i < step ? 'is-done' : ''}>
              {i + 1}. {t}
            </li>
          ))}
        </ol>
        {step < 3 ? (
          <>
            <p class="vc__ask" data-testid="vn-question">
              {VN_STEPS[step]!.question}
            </p>
            <div class="vc__options" role="radiogroup" aria-label={VN_STEPS[step]!.question} data-testid="vn-options">
              {VN_STEPS[step]!.options.map((o) => (
                <button key={o.id} type="button" role="radio" aria-checked={false} class="vc__opt" data-testid={`vn-${VN_STEPS[step]!.key}-${o.id}`} onClick={() => pickers[step]!(o.id)}>
                  <span class="vc__opt-label">{o.label}</span>
                  <Facts good={o.good} worry={o.worry} cost={o.cost} />
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            {draft && <VNSummary d={draft} />}
            <label class="vc__reason">
              <span>{VN_TEXT.reasonAsk}</span>
              <input
                type="text"
                maxLength={REASON_MAX}
                value={reason}
                placeholder={VN_TEXT.reasonHint}
                data-testid="vn-reason"
                onInput={(e) => setReason((e.currentTarget as HTMLInputElement).value.slice(0, REASON_MAX))}
              />
              <small class="vc__count">
                {reason.length}/{REASON_MAX} · {VN_TEXT.reasonHint}
              </small>
            </label>
            {short && (
              <p class="ev-vn-warn" role="alert" data-testid="vn-no-money">
                {VN_TEXT.noMoney}
              </p>
            )}
          </>
        )}
        {/* (검증 반영) 서버가 되돌린 결정(돈이 모자람 등) — 미리 막기와 실제 자금이 어긋날 때 */}
        {error && (
          <p class="ev-vn-warn" role="alert" data-testid="vn-error" data-error={error}>
            {error === 'NO_MONEY' ? VN_TEXT.noMoney : VN_TEXT.rejected}
          </p>
        )}
        <div class="vc__foot">
          {step > 0 && (
            <button type="button" class="btn btn--secondary" data-testid="vn-back" onClick={back}>
              {VN_TEXT.back}
            </button>
          )}
          {step === 3 && draft && (
            <button type="button" class="btn btn--primary vc__confirm" data-testid="vn-submit" disabled={short} onClick={() => onDecide({ ...draft, ...(reason.trim() ? { reason: reason.trim() } : {}) })}>
              {VN_TEXT.confirm}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function VNSummary({ d }: { d: VNDecision }) {
  if (!d.build) return <p class="vc__p" data-testid="vn-summary">공장을 짓지 않아요. 정하면 다른 회사의 공장 이야기를 읽어요.</p>;
  const o = vnFactoryOutcome(d);
  return (
    <p class="vc__p" data-testid="vn-summary">
      공장을 지어요 · {d.wage === 'low' ? '낮은 임금' : '정당한 임금'} · 환경 설비 {d.env === 'skip' ? '설치 안 함' : '설치'} → 사회적 책임 {o.csr >= 0 ? '+' : ''}
      {o.csr}
    </p>
  );
}

/** L4-E2 흐름: (전체 형태) 기사 밑줄 → 결정 3단계, (짧은 형태 패널) 기사 요약 → 결정 3단계. 정하면 정산 한 줄 */
export function VNFlow({ me, free, panel, onDecide, error, children }: { me: MeView; free: boolean; panel?: boolean; onDecide: (d: VNDecision) => void; error?: string | null; children?: ComponentChildren }) {
  const [read, setRead] = useState(false);
  const ctxErr = useContext(VNErrorContext);
  const err = error ?? ctxErr;
  const d = myVNDecision(me);
  if (d) return <VNDecided d={d}>{children}</VNDecided>;
  if (!read && !panel) {
    return (
      <ArticleRead
        article={textbookArticles.vietnamFactory}
        help={VN_TEXT.articleHelp}
        doneLabel={VN_TEXT.articleDone}
        onDone={() => setRead(true)}
      />
    );
  }
  if (!read && panel) {
    const a = textbookArticles.vietnamFactory;
    return (
      <section class="ev-vn-short" data-testid="vn-short-article">
        <p class="vc__reveal-title">{VN_TEXT.shortLead}</p>
        <ul class="vc__targets">
          {a.underlineTargets.map((t) => (
            <li key={t.label}>
              <b>{t.label}</b> — {t.sentence}
            </li>
          ))}
        </ul>
        <span class="ev-summary__pages">
          {a.source} ({a.date}) · {linkPages(a.pages)}
        </span>
        <div class="vc__foot">
          <button type="button" class="btn btn--primary" data-testid="article-done" onClick={() => setRead(true)}>
            {VN_TEXT.articleDone}
          </button>
        </div>
      </section>
    );
  }
  return <VNFactoryCard panel={panel} budget={spendableOf(me, free)} onDecide={onDecide} error={err} />;
}

/** L4-E3 보도 대상인가(낮은 임금 또는 설비 미설치를 고름) */
export function isReportTarget(me: MeView): boolean {
  const d = myVNDecision(me);
  return !!d && isBadChoice(d);
}

/** 고친 것 목록 */
export function improvedOf(me: MeView): string[] {
  const r = me.game.responses['L4-E3'] as Record<string, unknown> | undefined;
  return r && Array.isArray(r.improved) ? (r.improved as string[]) : [];
}

/** 아직 고칠 수 있는 것 */
export function fixable(me: MeView): ('wage' | 'env')[] {
  const d = myVNDecision(me);
  if (!d || !isBadChoice(d)) return [];
  const done = improvedOf(me);
  const out: ('wage' | 'env')[] = [];
  if (d.wage === 'low' && !done.includes('wage')) out.push('wage');
  if (d.env === 'skip' && !done.includes('env')) out.push('env');
  return out;
}

/**
 * L4-E3 패널: 보도 대상이면 우리 회사 보도 + 고치기 버튼(고칠 것만), 아니면 '다른 회사 공장 이야기'(읽기만).
 */
export function VNReportBody({ me, free, onImprove, error: errorProp }: { me: MeView; free: boolean; onImprove: (w: 'wage' | 'env') => void; error?: string | null }) {
  const ctxErr = useContext(VNErrorContext);
  const error = errorProp ?? ctxErr;
  const d = myVNDecision(me);
  if (!d || !isBadChoice(d)) {
    return (
      <div data-testid="vn-report-other">
        <OtherFactoryStory />
      </div>
    );
  }
  const left = fixable(me);
  const done = improvedOf(me);
  const budget = spendableOf(me, free);
  return (
    <section class="ev-vn-report" data-testid="vn-report-mine" data-left={left.join(',')}>
      <p class="vc__reveal-title">{VN_REPORT_TEXT.head}</p>
      {d.wage === 'low' && <p class="vc__p">{VN_REPORT_TEXT.wage}</p>}
      {d.env === 'skip' && <p class="vc__p">{VN_REPORT_TEXT.env}</p>}
      <p class="ev-vn-effect" data-testid="vn-report-effect">
        {VN_REPORT_TEXT.effect}
      </p>
      {left.length > 0 ? (
        <>
          <p class="vc__p">{VN_REPORT_TEXT.fixLead}</p>
          <div class="vc__vote-btns">
            {left.map((w) => (
              <button key={w} type="button" class="btn btn--primary" data-testid={`vn-fix-${w}`} disabled={budget < VN_FACTORY.improve.cost} onClick={() => onImprove(w)}>
                {w === 'wage' ? VN_REPORT_TEXT.fixWage : VN_REPORT_TEXT.fixEnv}
              </button>
            ))}
          </div>
          {done.length > 0 && <p class="vc__chosen">{VN_REPORT_TEXT.fixedOne}</p>}
          {(budget < VN_FACTORY.improve.cost || error === 'NO_MONEY') && (
            <p class="ev-vn-warn" data-testid="vn-fix-no-money">
              {VN_REPORT_TEXT.noMoney}
            </p>
          )}
          {error && error !== 'NO_MONEY' && (
            <p class="ev-vn-warn" role="alert" data-testid="vn-error" data-error={error}>
              {VN_TEXT.rejected}
            </p>
          )}
        </>
      ) : (
        <p class="vc__chosen" data-testid="vn-fixed-all">
          {VN_REPORT_TEXT.fixedAll}
        </p>
      )}
    </section>
  );
}
