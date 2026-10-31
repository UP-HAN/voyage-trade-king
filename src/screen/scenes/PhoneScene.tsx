/**
 * (작업 172) L3-E5 '우리 반 스마트폰 결과 + 경제 게이지' 장면(PRD 4.4 L3-E5, 7.6 학급 활동, 교과서 p.106~107).
 *
 * - 스마트폰(앞 시간·두 시간 모두): 부품 6칸 막대(공개 상태 `phone` — 회사 이름·출석번호 없이 수만) →
 *   다 모였으면 간단한 조립 연출(CSS) "스마트폰 완성!" / 못 모였으면 "○○ 부품이 없어 스마트폰을 만들 수 없어요".
 * - 경제 게이지(뒤 시간·두 시간 모두): 3차시 학급 [수출] 판매액 평균 막대 + 4칸 문구(p.107).
 * - 라운드 중 해도 아래 작은 띠(`PhoneBand`)로 부품 진행을 보인다(라운드 2개 이상 판 — 프로젝트가 있을 때만).
 * 화려한 모션은 범위 밖(203). 시간 숫자는 쓰지 않는다(159).
 */
import { goodsById } from '../../data/goods';
import { econGaugeOf, lessonPartRulesOf } from '../../data/lessonParts';
import { ECON_GAUGE_STEPS, econGaugeLine, PHONE_TEXT } from '../../data/phone';
import type { ScreenData } from '../model';
import { Bar } from '../parts';
import type { SceneProps } from './types';

export const PHONE_RESULT_EVENT = 'L3-E5';

function missingText(d: Pick<ScreenData, 'pub'>): string {
  const phone = d.pub.phone;
  if (!phone) return '';
  if (phone.complete) return PHONE_TEXT.complete;
  const names = phone.parts.filter((p) => p.have < p.need).map((p) => goodsById[p.good]?.name ?? p.good);
  return PHONE_TEXT.missing(names.join(', '));
}

/** 경제 게이지 4칸 */
export function GaugeView({ d }: { d: Pick<ScreenData, 'pub'> }) {
  const g = d.pub.econGauge;
  if (!g) return null;
  const top = ECON_GAUGE_STEPS[ECON_GAUGE_STEPS.length - 1]!.min;
  return (
    <section class="scr-panel scr-gauge" data-testid="econ-gauge" data-step={g.step}>
      <h2 class="scr-gauge__h">우리나라 경제 게이지 · 교과서 107쪽</h2>
      <Bar label="우리 반 수출 평균" value={Math.round(g.avg)} max={Math.max(top, Math.round(g.avg))} suffix="만 원" testId="econ-gauge-bar" />
      <ol class="scr-gauge__steps">
        {ECON_GAUGE_STEPS.map((s, i) => (
          <li key={s.min} class={i < g.step ? 'is-on' : ''} data-testid="econ-gauge-step" data-on={i < g.step ? '1' : '0'}>
            <b>{s.min}만 원</b> {s.text}
          </li>
        ))}
      </ol>
      <p class="scr-lead" data-testid="econ-gauge-line">
        {econGaugeLine(g.avg)} — 수출이 늘어나면 산업이 성장하고, 일자리와 소득이 늘어요.
      </p>
    </section>
  );
}

/** 부품 6칸 막대 */
export function PartsView({ d }: { d: Pick<ScreenData, 'pub'> }) {
  const phone = d.pub.phone;
  if (!phone) return null;
  return (
    <section class="scr-panel scr-phone__parts" data-testid="phone-parts">
      {phone.parts.map((p) => (
        <Bar key={p.good} label={goodsById[p.good]?.name ?? p.good} value={Math.min(p.have, p.need)} max={Math.max(1, p.need)} suffix={`/${p.need}`} testId="phone-part-bar" />
      ))}
    </section>
  );
}

export function PhoneScene({ d }: SceneProps) {
  const gauge = econGaugeOf(lessonPartRulesOf(d.cls.settings));
  const phone = d.pub.phone;
  const showPhone = gauge !== 'stageEnd' && !!phone;
  return (
    <div class="scr-scene scr-phone" data-testid="scene-phone" data-complete={phone?.complete ? '1' : '0'} data-gauge={gauge}>
      <p class="scr-kicker">{showPhone ? '우리 반 스마트폰 · 교과서 106쪽' : '수출이 늘어나면 · 교과서 107쪽'}</p>
      <div class={`scr-phone__cols${showPhone && gauge !== 'none' ? ' is-two' : ''}`}>
      {showPhone && (
        <div class="scr-phone__left">
          <h1 class={`scr-h1 scr-phone__title${phone!.complete ? ' is-done' : ''}`} data-testid="phone-title">
            {missingText(d)}
          </h1>
          {phone!.complete && (
            <div class="scr-phone__build" aria-hidden="true" data-testid="phone-build">
              <span class="scr-phone__device">
                <span class="scr-phone__screen" />
              </span>
            </div>
          )}
          <PartsView d={d} />
          <p class="scr-lead" data-testid="phone-end">
            {PHONE_TEXT.end}
          </p>
        </div>
      )}
      {gauge !== 'none' && <GaugeView d={d} />}
      </div>
    </div>
  );
}

/** L3-E5가 열려 있는 동안(자동 장면, 일시정지·학습지 팝업이 아닐 때) — 사건 카드 대신 스마트폰·게이지 */
export function phonePicker(d: ScreenData): string | null {
  const ce = d.cls.currentEvent;
  if (d.cls.paused || d.cls.worksheet.current?.length) return null;
  return ce && !ce.closed && ce.id === PHONE_RESULT_EVENT ? 'phone' : null;
}

/** 라운드 중 해도 아래 작은 띠: 부품 6칸 진행(프로젝트가 있고 아직 결과 전) */
export function PhoneBand({ d }: { d: Pick<ScreenData, 'pub' | 'cls'> }) {
  const phone = d.pub.phone;
  if (!phone || d.cls.phase !== 'round') return null;
  return (
    <div class="scr-phone-band" data-testid="phone-band">
      <span class="scr-phone-band__k">{phone.complete ? PHONE_TEXT.complete : '우리 반 스마트폰'}</span>
      {phone.parts.map((p) => (
        <span key={p.good} class={`scr-phone-band__part${p.have >= p.need ? ' is-done' : ''}`}>
          {goodsById[p.good]?.name ?? p.good} {Math.min(p.have, p.need)}/{p.need}
        </span>
      ))}
    </div>
  );
}
