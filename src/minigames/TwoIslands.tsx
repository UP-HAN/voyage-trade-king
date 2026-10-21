/**
 * 두 섬 이야기(L1-E5, PRD 6.12.2 v0.3.8, 교과서 p.98~99) — 화면 표기는 교과서처럼 ㉮ 나라·㉯ 나라. 수치는 [게임 설정].
 *
 * 작업 150(교사 1차시 수업 피드백): 슬라이더·숫자 맞추기를 없애고 **3장면·버튼 2번**으로 아주 쉽게.
 *   1. 혼자 살 때(5일:5일 결과만) → [잘하는 것을 많이 만들어 보기]
 *   2. 잘하는 것을 많이 만들기(㉮ 옷 8일·㉯ 쌀 10일, 막대가 0.3초 바뀜) → [옷 30벌 ↔ 쌀 20포대 바꾸기]
 *   3. 서로 바꾼 뒤(양쪽 화살표 + 혼자 살 때·바꾼 뒤 막대, 끝 문장 p.99) → [다 했어요]
 * [다 했어요]에서 지금과 같은 응답 `{ riceDays: { A: 2, B: 10 }, units: 10 }`을 보낸다 → core 판정 그대로 성공·보상.
 * 3장면에 들어서면 보낼 결과를 기억해 두어, 교사가 사건을 마감해 화면이 닫혀도 그때 보낸다(보상을 잃지 않게).
 * 짧은 형태(2.5분)와 전체 형태(6분)는 같은 3장면을 쓴다. [힌트]·[예시 따라 하기]·3분 기다림·[뒤로]는 없다.
 */
import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { twoIslands, type IslandId, type IslandStock } from '../data/twoIslands';
import { img, imgSrcSet } from '../ui/common/asset';
import { ClothesIcon, RiceIcon } from './icons';
import { ISLANDS, manwon, saveKey, twoIslandsScenes, type IslandPair } from './logic';
import { MinigameFrame, usePersisted, useResultSender } from './shared';
import type { MinigameGameProps } from './types';

type Scene = 1 | 2 | 3;

interface Saved {
  v: 2;
  scene: Scene;
  sent: boolean;
}

const SCENE_NAMES: Readonly<Record<Scene, string>> = { 1: '혼자 살 때', 2: '잘하는 것을 많이 만들기', 3: '서로 바꾸니' };
type Kind = 'rice' | 'clothes';
const KINDS: readonly Kind[] = ['rice', 'clothes'];
const UNIT: Readonly<Record<Kind, string>> = { rice: '포대', clothes: '벌' };
const NAME: Readonly<Record<Kind, string>> = { rice: '쌀', clothes: '옷' };

export function TwoIslands({ eventId, short, catchUp, player, act, onDone, alreadyDone }: MinigameGameProps) {
  const [s, set] = usePersisted<Saved>(saveKey(player.pid, eventId), 2, () => ({ v: 2, scene: 1, sent: false }));
  const sender = useResultSender(eventId, act, s.sent || alreadyDone);
  const [msg, setMsg] = useState<string | null>(null);
  const sc = twoIslandsScenes();

  // 3장면(바꾼 뒤)에 들어서면 보낼 결과를 기억(화면이 닫히면 그때 보냄). `example` 없이 배분·교환 그대로.
  useEffect(() => {
    sender.setPending(s.scene === 3 && !s.sent ? { riceDays: { ...sc.riceDays }, units: sc.units } : null);
  }, [s.scene, s.sent]);

  const kicker = (
    <>
      {catchUp ? '놓친 활동 · ' : '활동 · '}
      <span class="ti-pages">교과서 98~99쪽</span>
      {short && <span class="mg-tag" data-testid="minigame-short">짧게</span>}
    </>
  );
  const frame = (step: string, body: JSX.Element, extra?: JSX.Element) => (
    <MinigameFrame id={eventId} game="twoIslands" title={twoIslands.title} kicker={kicker} bg={img(twoIslands.scene)} bgSet={imgSrcSet(twoIslands.scene)} step={step} extra={extra}>
      {body}
    </MinigameFrame>
  );

  if (alreadyDone && s.scene !== 3) {
    return frame(
      'already',
      <div class="mg-body mg-center">
        <p class="mg-lead" data-testid="minigame-already">
          이미 ㉮ 나라와 ㉯ 나라 이야기를 마쳤어요.
        </p>
        <button type="button" class="btn btn--primary" data-testid="minigame-finish" onClick={onDone}>
          닫기
        </button>
      </div>,
    );
  }

  const go = (scene: Scene) => {
    if (!sender.guard()) return;
    set((x) => ({ ...x, scene }));
  };
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

  const scene = s.scene;
  const now: IslandPair = scene === 1 ? sc.alone : scene === 2 ? sc.focus : sc.traded;
  const days: Record<IslandId, number> = scene === 1 ? { ...twoIslands.defaultRiceDays } : { ...sc.riceDays };
  const max = Math.max(1, ...[sc.alone, sc.focus, sc.traded].flatMap((p) => ISLANDS.flatMap((k) => [p[k].rice, p[k].clothes])));

  const lead: Record<Scene, [string, string]> = {
    1: ['㉮ 나라와 ㉯ 나라는 10일 동안 쌀과 옷을 반씩(5일씩) 만들어요.', '㉮ 나라는 옷을, ㉯ 나라는 쌀을 상대적으로 더 잘 만들어요.'],
    2: ['㉮ 나라는 옷을 많이(8일), ㉯ 나라는 쌀만(10일) 만들었어요.', '그런데 ㉮는 쌀이, ㉯는 옷이 모자라요. 서로 바꿔 볼까요?'],
    3: ['두 나라 모두 혼자 살 때보다 쌀도 옷도 같거나 더 많아졌어요!', ''],
  };

  return frame(
    `scene${scene}`,
    <div class="mg-body ti-body" data-testid="ti-scene" data-scene={scene}>
      <h3 class="ti-scene__title title-font" data-testid="ti-scene-title">
        {scene}. {SCENE_NAMES[scene]}
      </h3>
      <p class="ti-lead" data-testid="ti-guide">
        {lead[scene][0]}
        {lead[scene][1] && (
          <>
            <br />
            {lead[scene][1]}
          </>
        )}
      </p>
      <div class={`ti-nations ti-nations--s${scene}`}>
        <NationCard id="A" scene={scene} riceDays={days.A} now={now.A} alone={sc.alone.A} max={max} />
        {scene === 3 && <TradeArrows clothes={sc.give.clothes} rice={sc.give.rice} />}
        <NationCard id="B" scene={scene} riceDays={days.B} now={now.B} alone={sc.alone.B} max={max} />
      </div>
      {scene === 3 && (
        <blockquote class="mg-quote mg-quote--end ti-end" data-testid="ti-end">
          {twoIslands.endSentence.text} <cite>교과서 {twoIslands.endSentence.pages.join('·')}쪽</cite>
        </blockquote>
      )}
      <div class="mg-foot">
        {scene === 3 && <span class="mg-reward ti-reward">보상: 도감 개념 카드 「무역의 좋은 점」, 자금 +{manwon(twoIslands.reward.money)}</span>}
        {msg && (
          <p class="mg-msg" role="alert">
            {msg}
          </p>
        )}
        {scene === 1 && (
          <button type="button" class="btn btn--primary btn--large ti-btn" data-testid="ti-focus" onClick={() => go(2)}>
            잘하는 것을 많이 만들어 보기
          </button>
        )}
        {scene === 2 && (
          <button type="button" class="btn btn--primary btn--large ti-btn" data-testid="ti-trade" onClick={() => go(3)}>
            옷 {sc.give.clothes}벌 ↔ 쌀 {sc.give.rice}포대 바꾸기
          </button>
        )}
        {scene === 3 && (
          <button type="button" class="btn btn--primary btn--large ti-btn" data-testid="ti-done" onClick={finish}>
            다 했어요
          </button>
        )}
      </div>
    </div>,
    <SceneSteps scene={scene} />,
  );
}

function SceneSteps({ scene }: { scene: Scene }) {
  return (
    <ol class="ti-steps" aria-label="장면">
      {([1, 2, 3] as const).map((n) => (
        <li key={n} class={`${scene === n ? 'is-current' : ''}${scene > n ? ' is-done' : ''}`} aria-current={scene === n ? 'step' : undefined}>
          {n}
        </li>
      ))}
    </ol>
  );
}

function NationCard({ id, scene, riceDays, now, alone, max }: { id: IslandId; scene: Scene; riceDays: number; now: IslandStock; alone: IslandStock; max: number }) {
  const isl = twoIslands.islands[id];
  const clothesDays = twoIslands.days - riceDays;
  const daysText = riceDays === 0 ? `옷만 ${clothesDays}일` : clothesDays === 0 ? `쌀만 ${riceDays}일` : `쌀 ${riceDays}일 · 옷 ${clothesDays}일`;
  return (
    <section class={`ti-nation ti-nation--${id}`} data-testid={`ti-nation-${id}`} data-rice={now.rice} data-clothes={now.clothes}>
      <header class="ti-nation__head">
        <h4 class="ti-nation__name title-font">{isl.label}</h4>
        <span class="ti-nation__days" data-testid={`ti-${id}-days`}>
          {daysText}
        </span>
      </header>
      {KINDS.map((k) => (
        <div class="ti-row" key={k}>
          <span class="ti-row__label">
            {k === 'rice' ? <RiceIcon size={28} /> : <ClothesIcon size={28} />}
            {NAME[k]}
          </span>
          <span class="ti-row__bars">
            {scene === 3 && <Bar key="before" kind={k} when="before" value={alone[k]} max={max} />}
            <Bar key="now" kind={k} when={scene === 3 ? 'after' : 'now'} value={now[k]} max={max} short={scene === 2 && now[k] < alone[k]} />
          </span>
        </div>
      ))}
    </section>
  );
}

function Bar({ kind, when, value, max, short }: { kind: Kind; when: 'now' | 'before' | 'after'; value: number; max: number; short?: boolean }) {
  const label = when === 'before' ? '혼자 살 때 ' : when === 'after' ? '바꾼 뒤 ' : '';
  return (
    <span class={`ti-bar ti-bar--${when}${short ? ' is-short' : ''}`} data-testid="ti-bar" data-kind={kind} data-when={when} data-value={value}>
      <span class="ti-bar__fill" style={{ width: `${(value / max) * 100}%` }} />
      <span class="ti-bar__val">
        {label}
        <b>{value}</b>
        {UNIT[kind]}
        {short && <em class="ti-bar__short"> 모자라요</em>}
      </span>
    </span>
  );
}

/** 3장면 가운데: 옷 → ㉯, 쌀 → ㉮ 양쪽 화살표(SVG) */
function TradeArrows({ clothes, rice }: { clothes: number; rice: number }) {
  const arrow = (dir: 'right' | 'left') => (
    <svg class={`ti-arrow ti-arrow--${dir}`} width="150" height="26" viewBox="0 0 150 26" aria-hidden="true" focusable="false">
      {dir === 'right' ? (
        <path d="M4 13H134M122 3l14 10-14 10" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" />
      ) : (
        <path d="M146 13H16M28 3L14 13l14 10" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" />
      )}
    </svg>
  );
  return (
    <div class="ti-arrows" data-testid="ti-arrows" role="img" aria-label={`㉮ 나라가 옷 ${clothes}벌을 ㉯ 나라에, ㉯ 나라가 쌀 ${rice}포대를 ㉮ 나라에 줘요`}>
      <p class="ti-arrows__item ti-arrows__item--clothes">
        <span class="ti-arrows__what">
          <ClothesIcon size={30} /> 옷 <b data-testid="ti-give-clothes">{clothes}</b>벌
        </span>
        {arrow('right')}
        <span class="ti-arrows__to">㉮ → ㉯</span>
      </p>
      <p class="ti-arrows__item ti-arrows__item--rice">
        <span class="ti-arrows__what">
          <RiceIcon size={30} /> 쌀 <b data-testid="ti-give-rice">{rice}</b>포대
        </span>
        {arrow('left')}
        <span class="ti-arrows__to">㉮ ← ㉯</span>
      </p>
    </div>
  );
}
