/**
 * 마무리 단계 공용 화면 장면(작업 174) — 공개 상태만, 이름 없이 수만(교사가 고른 표지만 회사 이름과 글).
 *
 * - 컨테이너 싣기(L4-E6, p.111): 열려 있는 동안 문장 8개(교과서 문장 그대로) + "다 실은 회사 n/m".
 *   교사가 [결과 보기]를 누르면(`wrap.containersResult`) 문장마다 O/X와 정답률 막대.
 * - 되돌아보기(L4-E9): 이번 판 문항(2 또는 3개)과 쓰는 곳 — 학생 글은 싣지 않는다.
 * - 잡지 표지 갤러리(L4-E8, p.112~113): 종이면 교과서·학습지 안내, 게임이면 "다 쓴 회사 n/m" + 교사가 고른 표지 하나를 크게.
 *   고르기 전에는 학생 글이 공개 상태에 없다(teacher/game.ts `wrapPublic`).
 */
import { containerSentences, containersGame } from '../../data/containers';
import { magazinePaperText } from '../../data/magazine';
import { worksheetById } from '../../data/worksheet';
import { MagazineCoverCard } from '../../ui/cards/MagazineCoverCard';
import { reflectQuestionsOf } from '../../student/wrapup/model';
import type { ScreenData } from '../model';
import type { SceneProps } from './types';
import './wrap-scenes.css';

/** 컨테이너 싣기 장면 자료 */
export function containersModel(d: ScreenData) {
  const c = d.pub.containers;
  const done = c?.done ?? 0;
  const total = c?.total ?? d.pub.joinedCount;
  const rows = containerSentences.map((s, i) => {
    const right = c?.right[i] ?? 0;
    return { no: s.no, text: s.text, correct: s.correct, right, pct: done ? Math.round((right / done) * 100) : 0 };
  });
  return { done, total, rows, result: !!d.wrap?.containersResult };
}

export function ContainersScene({ d }: SceneProps) {
  const m = containersModel(d);
  return (
    <div class="scr-scene scr-wz" data-testid="scene-containers" data-result={m.result ? '1' : '0'} data-done={m.done}>
      <p class="scr-kicker">
        {containersGame.title} · 교과서 p.111
      </p>
      <h1 class="scr-h1">{m.result ? '문장별 정답률' : containersGame.instruction}</h1>
      <p class="scr-wz__count" data-testid="containers-count">
        다 실은 회사 <b>{m.done}</b>/{m.total}
      </p>
      <ol class="scr-panel scr-wz__list" data-testid="containers-rows">
        {m.rows.map((r) => (
          <li key={r.no} class="scr-wz__row" data-testid="containers-row" data-no={r.no} data-pct={m.result ? r.pct : ''}>
            {m.result && (
              <span class={`scr-wz__ox ${r.correct ? 'scr-wz__ox--o' : 'scr-wz__ox--x'}`} aria-label={r.correct ? '옳은 문장' : '틀린 문장'}>
                {r.correct ? 'O' : 'X'}
              </span>
            )}
            <span class="scr-wz__text">
              {r.no}. {r.text}
            </span>
            {m.result && (
              <span class="scr-wz__bar" aria-label={`맞힌 회사 ${r.pct}%`}>
                <span class="scr-wz__track">
                  <span class="scr-wz__fill" style={{ width: `${r.pct}%` }} />
                </span>
                <b>{r.pct}%</b>
              </span>
            )}
          </li>
        ))}
      </ol>
      {!m.result && <p class="scr-small scr-wz__foot">옳은 문장만 트럭에 실어요. 알파벳 퍼즐은 교과서 111쪽에서 직접 해요.</p>}
    </div>
  );
}

export function ReflectScene({ d }: SceneProps) {
  const item = (d.cls.schedule.wrapup ?? []).find((w) => w.id === 'reflect');
  const qs = reflectQuestionsOf(item);
  const w18 = item?.worksheetIds.includes('W18') ? worksheetById.W18 : null;
  return (
    <div class="scr-scene scr-wz" data-testid="scene-reflect" data-questions={qs.length}>
      <p class="scr-kicker">되돌아보기</p>
      <h1 class="scr-h1">항해를 되돌아보며 한 줄씩 써요</h1>
      <ol class="scr-panel scr-wz__qs">
        {qs.map((q, i) => (
          <li key={i}>{q}</li>
        ))}
      </ol>
      <p class="scr-lead">{w18 ? `내 화면에 쓰고, 학습지 ${w18.label}(${w18.pagesLabel})에 옮겨 써요.` : '내 화면에 쓰고, 공책이나 선생님이 정한 곳에 옮겨 써요.'}</p>
    </div>
  );
}

export function GalleryScene({ d }: SceneProps) {
  const mode = d.wrap?.magazineMode ?? 'paper';
  const cover = mode === 'game' ? (d.wrap?.cover ?? null) : null;
  const c = d.pub.covers;
  if (mode === 'paper') {
    return (
      <div class="scr-scene scr-wz" data-testid="scene-gallery" data-mode="paper">
        <p class="scr-kicker">잡지 표지 「이달의 기업」 · 교과서 p.112~113</p>
        <h1 class="scr-h1">기업의 대표가 되어 우리 회사를 소개해요</h1>
        <p class="scr-panel scr-wz__paper">{magazinePaperText}</p>
      </div>
    );
  }
  if (!cover) {
    return (
      <div class="scr-scene scr-wz" data-testid="scene-gallery" data-mode="game" data-cover="">
        <p class="scr-kicker">잡지 표지 「이달의 기업」 · 교과서 p.112~113</p>
        <h1 class="scr-h1">우리 회사를 소개하는 잡지 표지를 만들어요</h1>
        <p class="scr-wz__count" data-testid="covers-count">
          다 쓴 회사 <b>{c?.done ?? 0}</b>/{c?.total ?? d.pub.joinedCount}
        </p>
        <p class="scr-lead">선생님이 고른 표지가 여기에 크게 나와요.</p>
      </div>
    );
  }
  return (
    <div class="scr-scene scr-wz scr-wz--gallery" data-testid="scene-gallery" data-mode="game" data-cover={cover.pid}>
      <div class="scr-wz__galleryside">
        <p class="scr-kicker">이달의 기업</p>
        <p class="scr-wz__count" data-testid="covers-count">
          다 쓴 회사 <b>{c?.done ?? 0}</b>/{c?.total ?? d.pub.joinedCount}
        </p>
      </div>
      <div class="scr-wz__cover">
        <MagazineCoverCard company={cover.company} flag={cover.flag} fields={cover.fields} bg={cover.bg} testId="gallery-cover" />
      </div>
    </div>
  );
}
