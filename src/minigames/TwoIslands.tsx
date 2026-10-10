/**
 * 두 섬 이야기(L1-E5, PRD 6.12.2, 교과서 p.98~99) — 개인 미니게임(작업 113). 수치는 [게임 설정].
 *
 * 1단계 "혼자 살기": 섬마다 10일을 쌀/옷에 나눔(1일 단위, 기본 5:5), 생산량 바로 표시.
 * 2단계 "잘하는 것에 집중하기": 다시 나눔 + [힌트].
 * 3단계 "바꾸기": 옷 3 = 쌀 2 고정, 3상자 단위(+3/−3 옷 보내기). 섬별 ✓/✗(글자 병기)를 바로 보여 준다.
 *   목표 = 두 섬 모두 1단계 기본(5일:5일)보다 쌀과 옷이 같거나 많기 + 교환 1단위 이상(core와 같은 규칙).
 * 성공 → 1단계 vs 3단계 막대그래프 + 끝 문장(p.99) → [마치기]에서 결과를 보낸다.
 * [예시 따라 하기]: 3분이 지나거나(짧은 형태·따라잡기·마감 뒤에는 처음부터) 보이고, 검산 예를 넣어 완료한다(보상 동일).
 * 짧은 형태: 1·2단계를 건너뛰고 1단계 기본값을 보여 준 뒤 3단계부터.
 */
import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { twoIslands, type IslandId, type IslandStock } from '../data/twoIslands';
import { img, imgSrcSet } from '../ui/common/asset';
import { CheckMark, ClothesIcon, RiceIcon } from './icons';
import {
  baseStocks,
  clampDays,
  exampleSetup,
  ISLANDS,
  judgeTwoIslands,
  manwon,
  maxUnits,
  produceBoth,
  saveKey,
  showExample,
  totals,
  type IslandJudge,
  type RiceDays,
} from './logic';
import { MinigameFrame, usePersisted, useResultSender } from './shared';
import type { MinigameGameProps } from './types';

type Stage = 1 | 2 | 3 | 'result';

interface Saved {
  v: 1;
  stage: Stage;
  s1: RiceDays;
  s2: RiceDays;
  units: number;
  hint: boolean;
  usedExample: boolean;
  /** 이 기기에서 처음 연 시각(3분 뒤 [예시 따라 하기]) */
  startedAt: number;
  /** 성공한 배분·교환(결과 그래프·보낼 값) */
  done: { riceDays: RiceDays; units: number; usedExample: boolean } | null;
  sent: boolean;
}

const STAGE_NAMES: Readonly<Record<1 | 2 | 3, string>> = { 1: '혼자 살기', 2: '잘하는 것에 집중하기', 3: '바꾸기' };

export function TwoIslands({ eventId, short, catchUp, closed, player, act, onDone, alreadyDone }: MinigameGameProps) {
  const def = { ...twoIslands.defaultRiceDays };
  const [s, set] = usePersisted<Saved>(saveKey(player.pid, eventId), 1, () => ({
    v: 1,
    stage: short ? 3 : 1,
    s1: { ...def },
    s2: { ...def },
    units: 0,
    hint: false,
    usedExample: false,
    startedAt: Date.now(),
    done: null,
    sent: false,
  }));
  const sender = useResultSender(eventId, act, s.sent || alreadyDone);
  const [now, setNow] = useState(() => Date.now());
  const [msg, setMsg] = useState<string | null>(null);
  const exampleOn = showExample({ short, catchUp, closed, startedAt: s.startedAt, now });

  useEffect(() => {
    if (exampleOn) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [exampleOn]);

  // 성공했으면 보낼 결과를 기억(화면이 닫히면 그때 보냄)
  useEffect(() => {
    const d = s.done;
    sender.setPending(d && !s.sent ? (d.usedExample ? { example: true, riceDays: d.riceDays, units: d.units } : { riceDays: d.riceDays, units: d.units }) : null);
  }, [s.done, s.sent]);

  const kicker = (
    <>
      {catchUp ? '놓친 활동 · ' : '활동 · '}㉮·㉯ 나라 이야기(교과서 p.98~99) <span class="mg-rule-inline">[게임 설정] 수치</span>
      {short && <span class="mg-tag" data-testid="minigame-short">짧게</span>}
    </>
  );
  const frame = (step: string, body: JSX.Element, extra?: JSX.Element) => (
    <MinigameFrame id={eventId} game="twoIslands" title={twoIslands.title} kicker={kicker} bg={img(twoIslands.scene)} bgSet={imgSrcSet(twoIslands.scene)} step={step} extra={extra}>
      {body}
    </MinigameFrame>
  );

  if (alreadyDone && !s.done) {
    return frame(
      'already',
      <div class="mg-body mg-center">
        <p class="mg-lead" data-testid="minigame-already">
          이미 두 섬의 교환에 성공했어요.
        </p>
        <button type="button" class="btn btn--primary" data-testid="minigame-finish" onClick={onDone}>
          닫기
        </button>
      </div>,
    );
  }

  const goStage = (stage: Stage) => {
    if (!sender.guard()) return;
    set((x) => ({ ...x, stage, ...(stage === 2 && x.stage === 1 ? { s2: { ...x.s1 } } : {}), units: stage === 3 ? Math.min(x.units, maxUnits(x.s2)) : x.units }));
  };
  const useExample = () => {
    if (!sender.guard()) return;
    const ex = exampleSetup();
    set((x) => ({ ...x, stage: 'result', s2: ex.riceDays, units: ex.units, usedExample: true, done: { riceDays: ex.riceDays, units: ex.units, usedExample: true } }));
  };
  const exampleBtn = exampleOn && (
    <button type="button" class="btn btn--secondary" data-testid="ti-example" onClick={useExample} title="㉯ 쌀 10일, ㉮ 쌀 2일·옷 8일, 옷 30과 쌀 20을 바꾸기">
      예시 따라 하기
    </button>
  );
  const steps = <StageSteps stage={s.stage} short={short} />;

  // ── 결과 ──
  if (s.stage === 'result' && s.done) {
    const base = baseStocks();
    const j = judgeTwoIslands(s.done.riceDays, s.done.units);
    const finish = () => {
      const r = sender.send();
      if (r === 'guard') return;
      if (r === 'fail') {
        setMsg('보내지 못했어요. 연결을 확인하고 다시 눌러요.');
        return;
      }
      set((x) => ({ ...x, sent: true }));
      onDone();
    };
    return frame(
      'result',
      <div class="mg-body">
        <p class="mg-score" data-testid="ti-success">
          <CheckMark ok size={30} /> <b>성공!</b> 두 섬 모두 혼자 살 때보다 쌀과 옷을 같거나 더 많이 가졌어요.
          {s.done.usedExample && <span class="mg-rule"> (예시를 따라 했어요)</span>}
        </p>
        <ResultChart base={base} after={j.after} />
        <p class="ti-sum" data-testid="ti-sum">
          두 섬 합계: 쌀 <b>{totals(base).rice}</b> → <b>{totals(j.after).rice}</b>, 옷 <b>{totals(base).clothes}</b> → <b>{totals(j.after).clothes}</b>
        </p>
        <blockquote class="mg-quote mg-quote--end" data-testid="ti-end">
          {twoIslands.endSentence.text} <cite>교과서 p.{twoIslands.endSentence.pages.join('·')}</cite>
        </blockquote>
        <div class="mg-foot">
          <span class="mg-reward">보상: 도감 개념 카드 「무역의 좋은 점」, 자금 +{manwon(twoIslands.reward.money)}</span>
          {msg && (
            <p class="mg-msg" role="alert">
              {msg}
            </p>
          )}
          <button type="button" class="btn btn--primary btn--large" data-testid="minigame-finish" onClick={finish}>
            마치기
          </button>
        </div>
      </div>,
      steps,
    );
  }

  // ── 1·2단계: 나누기 ──
  if (s.stage === 1 || s.stage === 2) {
    const key = s.stage === 1 ? 's1' : 's2';
    const rd = s[key];
    const setDays = (k: IslandId, n: number) => set((x) => ({ ...x, [key]: { ...x[key], [k]: clampDays(n) } }));
    const p = produceBoth(rd);
    const sum = totals(p);
    return frame(
      `stage${s.stage}`,
      <div class="mg-body">
        <p class="mg-lead" data-testid="ti-guide">
          {s.stage === 1
            ? '두 섬은 서로 바꾸지 않고 혼자 살아요. 섬마다 10일을 쌀과 옷 만들기에 나눠 보세요.'
            : '이번에는 각 섬이 더 잘 만드는 것에 날을 더 써 보세요. 다음 단계에서 서로 바꿀 거예요.'}
        </p>
        <div class="ti-islands">
          {ISLANDS.map((k) => (
            <IslandCard key={k} id={k} days={rd[k]} onDays={(n) => setDays(k, n)} />
          ))}
        </div>
        <p class="ti-sum" data-testid="ti-sum">
          두 섬 합계: <RiceIcon size={26} /> 쌀 <b class="mg-num">{sum.rice}</b> · <ClothesIcon size={26} /> 옷 <b class="mg-num">{sum.clothes}</b>
          {s.stage === 2 && (
            <span class="ti-sum__cmp">
              {' '}
              (1단계 기본 5일:5일 — 쌀 {totals(baseStocks()).rice} · 옷 {totals(baseStocks()).clothes})
            </span>
          )}
        </p>
        {s.stage === 2 && s.hint && (
          <p class="ti-hint" data-testid="ti-hint-text">
            힌트: {twoIslands.hint}
          </p>
        )}
        <div class="mg-foot">
          {exampleBtn}
          {s.stage === 2 && !s.hint && (
            <button
              type="button"
              class="btn btn--secondary"
              data-testid="ti-hint"
              onClick={() => {
                if (sender.guard()) set((x) => ({ ...x, hint: true }));
              }}
            >
              힌트
            </button>
          )}
          {s.stage === 2 && (
            <button type="button" class="btn btn--secondary" data-testid="ti-back" onClick={() => goStage(1)}>
              이전
            </button>
          )}
          <button type="button" class="btn btn--primary btn--large" data-testid="ti-next" onClick={() => goStage(s.stage === 1 ? 2 : 3)}>
            다음
          </button>
        </div>
      </div>,
      steps,
    );
  }

  // ── 3단계: 바꾸기 ──
  const rd = s.s2;
  const j = judgeTwoIslands(rd, s.units);
  const max = maxUnits(rd);
  const setDays = (k: IslandId, n: number) =>
    set((x) => {
      const s2 = { ...x.s2, [k]: clampDays(n) };
      return { ...x, s2, units: Math.min(x.units, maxUnits(s2)) };
    });
  const setUnits = (u: number) => set((x) => ({ ...x, units: Math.max(0, Math.min(maxUnits(x.s2), u)) }));
  const complete = () => {
    if (!j.success || !sender.guard()) return;
    set((x) => ({ ...x, stage: 'result', done: { riceDays: { ...x.s2 }, units: j.units, usedExample: false } }));
  };
  const base = baseStocks();
  return frame(
    'stage3',
    <div class="mg-body">
      <p class="mg-lead" data-testid="ti-guide">
        {short && (
          <>
            혼자 살 때(1단계, 5일:5일) ㉮섬은 쌀 {base.A.rice}·옷 {base.A.clothes}, ㉯섬은 쌀 {base.B.rice}·옷 {base.B.clothes}을 가져요.{' '}
          </>
        )}
        ㉮섬이 옷을 보내고 ㉯섬이 쌀을 보내요. 두 섬 모두 1단계보다 쌀과 옷이 같거나 많아지게 만들어 보세요.
      </p>
      <div class="ti-islands ti-islands--trade">
        <IslandCard id="A" days={rd.A} onDays={(n) => setDays('A', n)} judge={j} compact />
        <TradeBox units={j.units} max={max} onUnits={setUnits} />
        <IslandCard id="B" days={rd.B} onDays={(n) => setDays('B', n)} judge={j} compact />
      </div>
      <div class="mg-foot">
        <span class={`ti-status ${j.success ? 'is-ok' : ''}`} data-testid="ti-status" data-success={j.success ? '1' : '0'} aria-live="polite">
          {j.success ? '두 섬 모두 목표를 이뤘어요!' : j.units === 0 ? '아직 바꾸지 않았어요. 옷을 보내 보세요.' : '아직 목표에 못 미친 섬이 있어요.'}
        </span>
        {exampleBtn}
        {!short && (
          <button type="button" class="btn btn--secondary" data-testid="ti-back" onClick={() => goStage(2)}>
            이전
          </button>
        )}
        <button type="button" class="btn btn--primary btn--large" data-testid="ti-complete" disabled={!j.success} onClick={complete}>
          바꾸기 완료
        </button>
      </div>
    </div>,
    steps,
  );
}

function StageSteps({ stage, short }: { stage: Stage; short: boolean }) {
  const cur = stage === 'result' ? 4 : stage;
  return (
    <ol class="ti-steps" aria-label="단계">
      {([1, 2, 3] as const).map((n) => (
        <li key={n} class={`${cur === n ? 'is-current' : ''}${cur > n ? ' is-done' : ''}${short && n < 3 ? ' is-skipped' : ''}`} aria-current={cur === n ? 'step' : undefined}>
          {n}단계 {STAGE_NAMES[n]}
        </li>
      ))}
    </ol>
  );
}

function Amount({ kind, n, big }: { kind: 'rice' | 'clothes'; n: number; big?: boolean }) {
  return (
    <span class={`ti-amt ti-amt--${kind}${big ? ' ti-amt--big' : ''}`}>
      {kind === 'rice' ? <RiceIcon size={big ? 30 : 24} /> : <ClothesIcon size={big ? 30 : 24} />}
      {kind === 'rice' ? '쌀' : '옷'} <b class="mg-num">{n}</b>
    </span>
  );
}

function IslandCard({ id, days, onDays, judge, compact }: { id: IslandId; days: number; onDays: (n: number) => void; judge?: IslandJudge; compact?: boolean }) {
  const isl = twoIslands.islands[id];
  const made = produceBoth({ A: id === 'A' ? days : 0, B: id === 'B' ? days : 0 })[id];
  const base = baseStocks()[id];
  return (
    <section class={`ti-island ti-island--${id}${compact ? ' ti-island--compact' : ''}`} data-testid={`ti-island-${id}`} data-rice-days={days}>
      <header class="ti-island__head">
        <h3 class="ti-island__name title-font">{isl.label}</h3>
        <span class="ti-island__rate">
          하루 일하면 쌀 {isl.ricePerDay} 또는 옷 {isl.clothesPerDay}
        </span>
      </header>
      <div class="ti-days">
        <button type="button" class="btn btn--secondary ti-days__btn" data-testid={`ti-${id}-rice-minus`} aria-label={`${isl.label} 쌀 하루 줄이기`} disabled={days <= 0} onClick={() => onDays(days - 1)}>
          −
        </button>
        <label class="ti-days__slider">
          <span class="ti-days__text">
            쌀 <b>{days}</b>일 · 옷 <b>{twoIslands.days - days}</b>일
          </span>
          <input
            type="range"
            min={0}
            max={twoIslands.days}
            step={1}
            value={days}
            data-testid={`ti-${id}-slider`}
            aria-label={`${isl.label} 쌀 만드는 날`}
            onInput={(e) => onDays(Number((e.currentTarget as HTMLInputElement).value))}
          />
        </label>
        <button
          type="button"
          class="btn btn--secondary ti-days__btn"
          data-testid={`ti-${id}-rice-plus`}
          aria-label={`${isl.label} 쌀 하루 늘리기`}
          disabled={days >= twoIslands.days}
          onClick={() => onDays(days + 1)}
        >
          +
        </button>
      </div>
      <p class="ti-made" data-testid={`ti-${id}-made`} data-rice={made.rice} data-clothes={made.clothes}>
        <span class="ti-made__label">만든 양</span>
        <Amount kind="rice" n={made.rice} big={!judge} />
        <Amount kind="clothes" n={made.clothes} big={!judge} />
      </p>
      {judge && (
        <>
          <p class="ti-after" data-testid={`ti-${id}-after`} data-rice={judge.after[id].rice} data-clothes={judge.after[id].clothes}>
            <span class="ti-made__label">바꾼 뒤</span>
            <Amount kind="rice" n={judge.after[id].rice} big />
            <Amount kind="clothes" n={judge.after[id].clothes} big />
          </p>
          <p class="ti-goal">
            목표(1단계): 쌀 {base.rice} · 옷 {base.clothes} 이상
          </p>
          <p class={`ti-judge ${judge.ok[id] ? 'is-ok' : 'is-no'}`} data-testid={`ti-${id}-judge`} data-ok={judge.ok[id] ? '1' : '0'}>
            <CheckMark ok={judge.ok[id]} />
            {judge.ok[id] ? '목표 달성' : !judge.traded ? '아직 바꾸지 않았어요' : lackText(judge.short[id])}
          </p>
        </>
      )}
    </section>
  );
}

function lackText(l: IslandStock): string {
  const parts: string[] = [];
  if (l.rice > 0) parts.push(`쌀 ${l.rice}`);
  if (l.clothes > 0) parts.push(`옷 ${l.clothes}`);
  return `아직 — ${parts.join(', ')} 모자라요`;
}

function TradeBox({ units, max, onUnits }: { units: number; max: number; onUnits: (u: number) => void }) {
  const ex = twoIslands.exchange;
  return (
    <section class="ti-trade" data-testid="ti-trade" data-units={units}>
      <p class="ti-trade__rate">
        바꾸는 비율 <b>옷 {ex.clothes} = 쌀 {ex.rice}</b> <span class="mg-rule-inline">[게임 설정]</span>
      </p>
      <p class="ti-trade__row">
        ㉮섬 → ㉯섬 <ClothesIcon size={26} /> 옷 <b class="mg-num" data-testid="ti-give-clothes">{units * ex.clothes}</b>
      </p>
      <p class="ti-trade__row">
        ㉯섬 → ㉮섬 <RiceIcon size={26} /> 쌀 <b class="mg-num" data-testid="ti-give-rice">{units * ex.rice}</b>
      </p>
      <div class="ti-trade__btns">
        <button type="button" class="btn btn--secondary" data-testid="ti-units-minus" disabled={units <= 0} onClick={() => onUnits(units - 1)}>
          −{ex.clothes} 옷
        </button>
        <button type="button" class="btn btn--primary" data-testid="ti-units-plus" disabled={units >= max} onClick={() => onUnits(units + 1)}>
          +{ex.clothes} 옷 보내기
        </button>
      </div>
      <p class="ti-trade__note">
        {units}번 바꿨어요{max > 0 ? ` (이 배분으로는 최대 ${max}번)` : ' — 보낼 옷이나 쌀이 없어요'}
      </p>
    </section>
  );
}

function ResultChart({ base, after }: { base: Record<IslandId, IslandStock>; after: Record<IslandId, IslandStock> }) {
  const max = Math.max(1, ...ISLANDS.flatMap((k) => [base[k].rice, base[k].clothes, after[k].rice, after[k].clothes]));
  const row = (k: IslandId, kind: 'rice' | 'clothes') => (
    <div class="ti-chart__group" key={`${k}-${kind}`}>
      <span class="ti-chart__label">
        {twoIslands.islands[k].label} {kind === 'rice' ? <RiceIcon size={22} /> : <ClothesIcon size={22} />}
        {kind === 'rice' ? '쌀' : '옷'}
      </span>
      <span class="ti-chart__bars">
        <span class="ti-bar ti-bar--s1" data-testid="ti-bar-s1" data-value={base[k][kind]}>
          <span class="ti-bar__fill" style={{ width: `${(base[k][kind] / max) * 100}%` }} />
          <span class="ti-bar__val">1단계 {base[k][kind]}</span>
        </span>
        <span class="ti-bar ti-bar--s3" data-testid="ti-bar-s3" data-value={after[k][kind]}>
          <span class="ti-bar__fill" style={{ width: `${(after[k][kind] / max) * 100}%` }} />
          <span class="ti-bar__val">3단계 {after[k][kind]}</span>
        </span>
      </span>
    </div>
  );
  return (
    <div class="ti-chart" data-testid="ti-chart" role="img" aria-label="1단계(혼자 살기)와 3단계(바꾸기) 비교 막대그래프">
      {ISLANDS.map((k) => (
        <div class="ti-chart__island" key={k}>
          {row(k, 'rice')}
          {row(k, 'clothes')}
        </div>
      ))}
      <p class="ti-chart__legend">
        <span class="ti-key ti-key--s1" /> 1단계 혼자 살기(5일:5일) <span class="ti-key ti-key--s3" /> 3단계 바꾼 뒤
      </p>
    </div>
  );
}
