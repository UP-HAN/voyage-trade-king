/**
 * 학습지 시간 장면(PRD 7.7, brief 3번·v0.3 5번): "잠깐! ③ 학습지를 써요" + 문구 + 쪽수 + 완료 막대 "18/27"(이름·출석번호 없이 수만).
 * 묶음 팝업이면 "잠깐! ①②③④ 학습지를 써요"(번호마다 한 줄). 마무리 단계 '끝나고 쓰기' 목록은 `AfterWorksheetList`.
 * (작업 112) 판 단위 꼬리표("차시 한 판 · L1" / "단원 한 판 · L3 구간")를 더했다. 장면은 `class.worksheet.current`를 그대로 따르므로
 * 라운드 중 예약(pending)은 라운드가 끝나 팝업이 뜰 때, [건너뛰기]·[모두 닫기]는 current가 비면 바로 다른 장면으로 바뀐다.
 */
import { playScopeTag, playUnitTag, worksheetStage } from '../../core/worksheet-helpers';
import type { WorksheetId } from '../../data/types';
import { afterWorksheets, hasAwardWinners, leaderboardOn, worksheetRows, type ScreenData, type WorksheetRow } from '../model';
import { ArtImg } from '../parts';
import type { SceneProps } from './types';

export function WorksheetScene({ d }: SceneProps) {
  const ids = d.cls.worksheet.current ?? [];
  // (작업 132) '지금 쓰기' ★ 칸 팝업이면 "잠깐! ③★ 지금 써요"
  const during = d.cls.worksheet.during === true;
  const rows = worksheetRows(d, ids, during);
  const labels = rows.map((r) => r.label).join('');
  // [다 썼어요]는 묶음 전체에 1번 → 묶음 안 번호 중 가장 적은 완료 수
  const done = rows.length ? Math.min(...rows.map((r) => r.done)) : 0;
  const total = d.pub.joinedCount;
  const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0;
  const tag = playUnitTag(d.playUnit, worksheetStage(ids as WorksheetId[], d.cls.stage));
  return (
    <div class="scr-scene scr-ws" data-testid="scene-worksheet" data-ids={ids.join(',')} data-during={during ? '1' : '0'}>
      <ArtImg path="letters/letter-paper.png" alt="" class="scr-ws__paper" />
      <p class="scr-kicker" data-testid="ws-tag">
        {tag}
      </p>
      <h1 class="scr-ws__title" data-testid="ws-title">
        <span class="scr-ws__wait">잠깐!</span> {labels} {during ? '지금 써요' : '학습지를 써요'}
      </h1>
      <ul class="scr-panel scr-ws__rows">
        {rows.map((r) => (
          <li key={r.id} data-testid="ws-row">
            <b class="scr-ws__no">{r.label}</b> {r.prompt} <small class="scr-pages">{r.pages}</small>
          </li>
        ))}
      </ul>
      <div class="scr-ws__done" data-testid="ws-done">
        <span class="scr-ws__done-k">다 쓴 회사</span>
        <span class="scr-bar__track scr-ws__track">
          <span class="scr-bar__fill" style={{ width: `${pct}%` }} />
        </span>
        <span class="scr-big" data-testid="ws-done-count">
          {done}/{total}
        </span>
      </div>
    </div>
  );
}

/** 마무리 단계: 오늘 끝나고 쓸 학습지 번호 목록(판 단위·차시와 함께 — d를 주면) */
export function AfterWorksheetList({ rows, d }: { rows: readonly WorksheetRow[]; d?: ScreenData }) {
  if (!rows.length) return null;
  return (
    <div class="scr-after" data-testid="after-worksheets">
      {d && (
        <span class="scr-after__k" data-testid="after-tag">
          {playScopeTag(d.playUnit, d.scope)}
        </span>
      )}
      <span class="scr-after__k">오늘 쓸 학습지</span>
      <span class="scr-after__nos" data-testid="after-nos">
        {rows.map((r) => r.label).join(' ')}
      </span>
    </div>
  );
}

/**
 * (작업 112) 마무리 단계에 수상 회사가 없어 시상 장면이 안 나오면(아무도 거래하지 않은 짧은 판 등) '끝나고 쓰기' 목록이
 * 공용 화면에서 사라지지 않게 따로 크게 보여 주는 장면. 시상 장면이 있으면 그 아래 목록으로 충분하다.
 */
export function AfterWorksheetScene({ d }: { d: ScreenData }) {
  const rows = afterWorksheets(d);
  return (
    <div class="scr-scene scr-ws" data-testid="scene-after-worksheets">
      <p class="scr-kicker" data-testid="after-tag">
        {playScopeTag(d.playUnit, d.scope)}
      </p>
      <h1 class="scr-ws__title" data-testid="after-worksheets">
        오늘 쓸 학습지: {rows.map((r) => r.label).join(' ')}
      </h1>
      <ul class="scr-panel scr-ws__rows">
        {rows.map((r) => (
          <li key={r.id} data-testid="ws-row">
            <b class="scr-ws__no">{r.label}</b> {r.prompt} <small class="scr-pages">{r.pages}</small>
          </li>
        ))}
      </ul>
      <p class="scr-lead">수업 뒤나 다음 시간에 써요. 학생 기기의 항해 기록장을 보면 게임 기록을 볼 수 있어요.</p>
    </div>
  );
}

/**
 * 마무리 단계 장면 우선순위(PRD 4.1.1·4.2.1 마무리 순서 "정산 → 결산·시상 → 되돌아보기 → 끝나고 쓰기", 7.6):
 * 시상(수상 회사 있음) > 결산 순위판(순위 공개 N>0) > '끝나고 쓰기' 장면. 즉 이 장면은 시상·순위판이 둘 다 없어
 * 기본 규칙이 빈 해도를 고를 때만 대신 나온다. 시상·순위판이 나올 때는 화면 아래 '끝나고 쓰기' 띠(AfterWorksheetBand)가 번호를 보인다.
 */
export function pickAfterWorksheetScene(d: ScreenData): string | null {
  if (d.cls.phase !== 'wrapup' || (d.cls.worksheet.current?.length ?? 0) > 0 || d.cls.paused) return null;
  if (!afterWorksheets(d).length || hasAwardWinners(d) || leaderboardOn(d)) return null;
  return 'afterWorksheet';
}

/** 마무리 단계의 다른 장면(순위판·해도 등) 아래 '끝나고 쓰기' 번호 띠 */
export function AfterWorksheetBand({ d, sceneId }: { d: ScreenData; sceneId: string }) {
  if (d.cls.phase !== 'wrapup' || ['awards', 'ended', 'afterWorksheet', 'worksheet', 'black', 'pause'].includes(sceneId)) return null;
  const rows = afterWorksheets(d);
  if (!rows.length) return null;
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: '2.5%', display: 'flex', justifyContent: 'center', pointerEvents: 'none', zIndex: 5 }} data-testid="after-band">
      <AfterWorksheetList rows={rows} d={d} />
    </div>
  );
}
