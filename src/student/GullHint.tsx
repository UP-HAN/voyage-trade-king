/**
 * (작업 160b, PRD 6.7.6 끝 문단) 막힌 학생 갈매기 힌트 카드 — 비모달.
 * 호스트가 내 상태 `game.gullHints`에 힌트 ID 를 더하면 마지막 힌트를 한 번 보여 준다. [알겠어요]로 닫고,
 * 하단 바 임무 줄의 "갈매기 힌트 다시 보기"로 다시 연다.
 * 카드는 화면 아래 왼쪽에 **흐름 안**(겹쳐 띄우지 않음)으로 놓아 하단 바·항구 거래 버튼을 가리지 않는다.
 */
import type { GullHintRecord } from '../core';
import { stuckHintText } from '../data/stuckHints';
import { banners, pageLabel } from '../data/text';
import { Img } from '../ui/common/Img';
import type { MeView } from './predict';

/** 마지막으로 받은 힌트(문구가 있는 것) */
export function lastGullHint(me: Pick<MeView, 'game'> | null | undefined): GullHintRecord | null {
  const list = me?.game.gullHints ?? [];
  for (let i = list.length - 1; i >= 0; i--) if (stuckHintText(list[i]!.id)) return list[i]!;
  return null;
}

export function GullHintCard({ id, onOk }: { id: string; onOk: () => void }) {
  const h = stuckHintText(id);
  if (!h) return null;
  const fake = h.tag === 'fakeNews';
  return (
    <aside class="st-gull" role="note" aria-live="polite" aria-label="갈매기 힌트" data-testid="gull-hint" data-hint={id}>
      <Img path="letters/seagull-land.png" alt="갈매기" fallbackLabel="갈매기" class="st-gull__face" width={44} height={44} />
      <div class="st-gull__body">
        <p class="st-gull__head">
          <b class="title-font">갈매기 힌트</b>
          {fake ? (
            <span class="st-gull__fake" data-testid="gull-hint-fake">
              {banners.fakeNews}
            </span>
          ) : (
            <span class="st-tag st-gull__rule" data-testid="gull-hint-rule">
              {banners.gameRule}
            </span>
          )}
          <span class="st-gull__pages" data-testid="gull-hint-pages">
            {pageLabel(h.pages)}
          </span>
        </p>
        <p class="st-gull__text" data-testid="gull-hint-text">
          {h.text}
        </p>
      </div>
      <button type="button" class="btn btn--primary st-gull__ok" data-testid="gull-hint-ok" onClick={onOk}>
        알겠어요
      </button>
    </aside>
  );
}

/** 하단 바 임무 줄 끝 "갈매기 힌트 다시 보기" */
export function GullHintAgain({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" class="link-small st-gull-again" data-testid="gull-hint-again" onClick={onClick}>
      갈매기 힌트 다시 보기
    </button>
  );
}
