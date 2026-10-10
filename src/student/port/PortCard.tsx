/**
 * 항구 카드 (PRD 6.3.3) — 작업 108.
 * 항구 장면 + 3줄 소개(데이터 `features`, 쪽수) + '이 나라가 싸게 파는 까닭' 아이콘(자연환경/자원/자본/기술, 글자 병기).
 * 처음 입항 때 자동으로(`portCard` 이벤트 → GameScreen), [이야기] 탭에서 다시 보기.
 * 장면 이미지가 없으면 해도 확대 + 이름 띠로 대체(`PortScene`).
 */
import { useState } from 'preact/hooks';
import { cheapReasonInfo, portsById } from '../../data/ports';
import { pageLabel } from '../../data/text';
import type { PortId } from '../../data/types';
import { img, imgCss, imgSrcSet } from '../../ui/common/asset';
import { Modal } from '../overlays';
import { ReasonIcon } from './PortIcons';

/** 해도 확대 대체 표시용 배경 위치(항구 좌표 → 바다 해도 이미지의 % 위치) */
export function chartPosition(port: PortId): string {
  const p = portsById[port];
  return `${((p.x / 2700) * 100).toFixed(1)}% ${((p.y / 1350) * 100).toFixed(1)}%`;
}

/** 항구 장면(16:9 이미지를 띠 모양으로 잘라 보임). 이미지가 없으면 해도 확대 + 이름 띠 */
export function PortScene({ port, class: className, showName }: { port: PortId; class?: string; showName?: boolean }) {
  const p = portsById[port];
  const [failed, setFailed] = useState(false);
  const label = `${p.name} (${p.country})`;
  if (failed) {
    return (
      <div
        class={`pt-scene pt-scene--fallback ${className ?? ''}`}
        data-testid="port-scene-fallback"
        role="img"
        aria-label={`${label} 해도`}
        // (작업 133) 해도 배경 조각은 1024 사본이면 충분하다(background-size 900% auto 라 그림 픽셀 수와 관계없이 같은 자리)
        style={{ backgroundImage: imgCss('map/world-sea-chart.png', { maxWidth: 1024 }), backgroundPosition: chartPosition(port) }}
      >
        {/* background-position % 는 그림의 같은 % 지점을 틀의 같은 % 지점에 맞춘다 → 항구 표식도 같은 % 자리 */}
        <span class="pt-scene__pin" aria-hidden="true" style={{ left: chartPosition(port).split(' ')[0], top: chartPosition(port).split(' ')[1] }} />
        {showName !== false && <span class="pt-scene__band title-font">{label}</span>}
      </div>
    );
  }
  return (
    <div class={`pt-scene ${className ?? ''}`}>
      <img
        class="pt-scene__img"
        src={img(p.sceneImage)}
        srcset={imgSrcSet(p.sceneImage)}
        sizes="100vw"
        alt={`${label} 항구 장면`}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        data-testid="port-scene-img"
      />
    </div>
  );
}

/** 항구 카드 본문(창·[이야기] 탭 공통) */
export function PortStory({ port }: { port: PortId }) {
  const p = portsById[port];
  const basis = p.cheapReasonsBasis;
  return (
    <div class="pt-story" data-testid="port-story">
      <ul class="pt-story__lines">
        {p.features.slice(0, 3).map((f, i) => (
          <li key={i}>
            {f.text} <span class="pt-pages">({pageLabel(f.pages)})</span>
          </li>
        ))}
      </ul>
      {p.gameRuleNote && (
        <p class="pt-story__rule">
          <span class="st-tag pt-rule-tag">게임 규칙</span> {p.gameRuleNote.replace(/^게임 (규칙|설정): ?/, '')}
        </p>
      )}
      <div class="pt-reasons">
        <h3 class="pt-reasons__title">
          이 나라가 싸게 파는 까닭 <span class="pt-pages">({pageLabel(cheapReasonInfo.nature.pages)})</span>
        </h3>
        {p.cheapReasons.length ? (
          <ul class="pt-reasons__list">
            {p.cheapReasons.map((r) => (
              <li key={r} class="pt-reason" data-reason={r}>
                <ReasonIcon reason={r} />
                <span>{cheapReasonInfo[r].label}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <p class="pt-reasons__note">
          {basis.note}{' '}
          {basis.gameRule ? <span class="st-tag pt-rule-tag">게임 규칙</span> : <span class="pt-pages">({pageLabel(basis.pages)})</span>}
        </p>
      </div>
    </div>
  );
}

/** 처음 입항 때 뜨는 항구 카드 창 */
export function PortCardModal({ port, onClose, soft }: { port: PortId; onClose: () => void; soft?: boolean }) {
  const p = portsById[port];
  return (
    <Modal title={`${p.name} (${p.country})`} onClose={onClose} testId="port-card" wide={!soft} soft={soft}>
      <PortScene port={port} class="pt-scene--card" showName={false} />
      <PortStory port={port} />
      <div class="st-row-btns">
        <button type="button" class="btn btn--primary" data-testid="port-card-ok" onClick={onClose}>
          시장 둘러보기
        </button>
      </div>
    </Modal>
  );
}
