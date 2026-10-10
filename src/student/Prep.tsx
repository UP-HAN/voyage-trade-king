/**
 * 준비 단계(`phase:'prep'`, PRD 4.2.1·6.1·6.16.3).
 * - S04 회사 설립: 입장 때 정한 회사 이름을 크게 보여 주고(이름 입력 칸 없음, v0.3.1), 깃발 색 6·문양 6·선장 4를 고른다.
 *   준비 단계에서만 작은 [회사 이름 바꾸기](같은 검사 → name.set).
 * - 설립 뒤 대기 화면: 안내 항해사 + "선생님이 무역을 시작하면 항해가 열려요" + 항해 규칙 카드 4칸(역전 장치가 꺼진 판이면 2번 숨김).
 * 시작 자금은 호스트가 판 범위의 첫 구간 조건으로 정해 보낸다(학생 기기는 고르지 않음).
 */
import { useEffect, useState } from 'preact/hooks';
import { AVATARS, FLAG_COLORS, FLAG_EMBLEMS } from '../core';
import { ruleCards } from '../data/dex';
import { FlagIcon } from '../ui/common/FlagIcon';
import { Img } from '../ui/common/Img';
import { RuleArt } from './icons';
import { NameEditor } from './overlays';
import type { StudentState, StudentStore } from './store';

/** 이 판에서 보여 줄 항해 규칙 카드(역전 장치가 꺼지면 2번 숨김) */
export function visibleRuleCards(comeback: boolean) {
  return ruleCards.filter((c) => c.requires !== 'comeback' || comeback);
}

export function RuleCards({ comeback }: { comeback: boolean }) {
  return (
    <ol class="st-rules" data-testid="rule-cards">
      {visibleRuleCards(comeback).map((c) => (
        <li key={c.id} class="st-rule" data-rule={c.no}>
          <RuleArt no={c.no} />
          <span class="st-rule__no">규칙 {c.no}</span>
          <p>{c.text}</p>
          <span class="st-tag">게임 규칙</span>
        </li>
      ))}
    </ol>
  );
}

function CompanyNameBlock({ store, st, editable }: { store: StudentStore; st: StudentState; editable: boolean }) {
  const [editing, setEditing] = useState(false);
  const name = st.peer.companyName ?? st.peer.me?.company.name ?? '';
  // 이름이 바뀌면(호스트 확정) 입력 창을 닫는다
  useEffect(() => setEditing(false), [name]);
  return (
    <div class="st-found__name">
      <span class="st-found__name-label">우리 회사</span>
      <strong class="st-found__name-text title-font" data-testid="found-company-name">
        {name}
      </strong>
      {editable && !editing && (
        <button type="button" class="link-small" data-testid="found-rename" onClick={() => setEditing(true)}>
          회사 이름 바꾸기
        </button>
      )}
      {editing && <NameEditor store={store} initial={name} submitLabel="이 이름으로 바꾸기" onCancel={() => setEditing(false)} testId="rename" />}
    </div>
  );
}

export function FoundCompany({ store, st, onDone }: { store: StudentStore; st: StudentState; onDone?: () => void }) {
  const me = st.peer.me!;
  const [color, setColor] = useState(me.company.color);
  const [emblem, setEmblem] = useState(me.company.emblem);
  const [avatar, setAvatar] = useState(me.company.avatar);
  const prep = st.peer.public?.class?.phase === 'prep';
  const colorLabel = FLAG_COLORS.find((c) => c.id === color)?.label ?? '';
  const emblemLabel = FLAG_EMBLEMS.find((e) => e.id === emblem)?.label ?? '';

  const found = () => {
    const r = store.act({ type: 'foundCompany', color, emblem, avatar });
    if (r !== 'blocked' && r !== 'notIn') onDone?.();
  };

  return (
    <section class="st-found" data-testid="found-company">
      <div class="st-found__preview">
        <h1 class="title-font st-found__title">{me.company.founded ? '깃발·선장 다시 고르기' : '회사 세우기'}</h1>
        <CompanyNameBlock store={store} st={st} editable={prep} />
        <div class="st-found__flag">
          <FlagIcon color={color} emblem={emblem} size={160} label={`깃발 미리보기: ${colorLabel} ${emblemLabel}`} />
          <Img path={`characters/${avatar}.png`} alt="고른 선장" fallbackLabel="선장" class="st-found__avatar-big" width={150} height={150} />
        </div>
      </div>
      <div class="st-found__choices">
        <fieldset class="st-choice">
          <legend>깃발 색</legend>
          <div class="st-choice__row">
            {FLAG_COLORS.map((c) => (
              <button
                type="button"
                key={c.id}
                class={`st-swatch${color === c.id ? ' is-on' : ''}`}
                aria-pressed={color === c.id}
                data-testid={`found-color-${c.id}`}
                onClick={() => setColor(c.id)}
              >
                <span class="st-swatch__chip" style={{ background: c.hex }} />
                <span>{c.label}</span>
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset class="st-choice">
          <legend>깃발 문양</legend>
          <div class="st-choice__row">
            {FLAG_EMBLEMS.map((e) => (
              <button
                type="button"
                key={e.id}
                class={`st-swatch${emblem === e.id ? ' is-on' : ''}`}
                aria-pressed={emblem === e.id}
                data-testid={`found-emblem-${e.id}`}
                onClick={() => setEmblem(e.id)}
              >
                <FlagIcon color={color} emblem={e.id} size={36} />
                <span>{e.label}</span>
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset class="st-choice">
          <legend>선장</legend>
          <div class="st-choice__row">
            {AVATARS.map((a, i) => (
              <button
                type="button"
                key={a}
                class={`st-avatar${avatar === a ? ' is-on' : ''}`}
                aria-pressed={avatar === a}
                data-testid={`found-avatar-${a}`}
                onClick={() => setAvatar(a)}
              >
                {/* 600×900 전신 그림을 64칸에 통째로 줄이면 사람이 아주 작아져(특히 4번) 빈 칸처럼 보임 → 머리~허리를 잘라 크게(작업 108) */}
                <span class="st-avatar__crop">
                  <Img path={`characters/${a}.png`} alt={`선장 ${i + 1}`} fallbackLabel={`선장 ${i + 1}`} width={160} height={240} />
                </span>
              </button>
            ))}
          </div>
        </fieldset>
        <div class="st-row-btns">
          {me.company.founded && onDone && (
            <button type="button" class="btn btn--secondary" onClick={onDone}>
              그대로 두기
            </button>
          )}
          <button type="button" class="btn btn--primary btn--large" data-testid="found-submit" onClick={found}>
            {me.company.founded ? '이대로 바꾸기' : '회사 세우기'}
          </button>
        </div>
      </div>
    </section>
  );
}

export function PrepWait({ store, st, onEdit }: { store: StudentStore; st: StudentState; onEdit: () => void }) {
  const comeback = Boolean(st.peer.public?.class?.settings?.comeback);
  return (
    <section class="st-prep" data-testid="prep-wait">
      <div class="st-prep__guide">
        <Img path="characters/guide-hanbada.png" alt="안내 항해사" fallbackLabel="안내 항해사" class="st-prep__guide-img" width={180} height={240} />
        <div class="st-prep__bubble">
          <p class="st-prep__lead title-font">선생님이 무역을 시작하면 항해가 열려요</p>
          <p>그동안 항해 규칙을 읽어 봐요. 도감의 '항해 규칙' 탭에서 언제든 다시 볼 수 있어요.</p>
          <div class="st-row-btns">
            <button type="button" class="btn btn--secondary" data-testid="prep-edit" onClick={onEdit}>
              깃발·선장 다시 고르기
            </button>
          </div>
          <CompanyNameBlock store={store} st={st} editable />
        </div>
      </div>
      <h2 class="st-prep__rules-title title-font">항해 규칙</h2>
      <RuleCards comeback={comeback} />
    </section>
  );
}
