/**
 * 설정(판 중) — 작업 109, PRD 7.5 '설정(판 중)' v0.3.1:
 * 라운드 길이, 순위 공개 N·자산 탭, 상별 수상 인원, "다 썼어요" 대기 시간, 진행 방식, (P1 회색) 공용 화면 예보·이름 확인 후 공개·추가 금칙어,
 * [연결 테스트], [결과 파일 저장], [판 옮기기 파일 저장], [판 끝내기·방 닫기](두 번 확인). 이름 표시 방식·이름 받지 않기는 v0.3.1에서 삭제.
 */
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import type { ClassSettings, TopN } from '../core';
import { leaderboardRules } from '../data/awards';
import { roundLength, worksheetWaitSecOptions } from '../data/schedule';
import { ConnectionTest } from '../ui/common/ConnectionTest';
import type { TeacherActions } from './actions';
import type { TeacherGame } from './game';
import { Modal } from './ui';

export interface SettingsModalProps {
  game: TeacherGame;
  actions: TeacherActions;
  onClose: () => void;
  onSaveResult: () => void;
  onSaveMove: () => void;
  onEnd: () => void;
}

function Row({ label, children, off }: { label: string; children: ComponentChildren; off?: boolean }) {
  return (
    <div class={`t-field${off ? ' t-field--off' : ''}`}>
      <span class="t-field__label">
        {label}
        {off && <span class="t-soon">곧 열려요</span>}
      </span>
      <div class="t-seg">{children}</div>
    </div>
  );
}

export function SettingsModal({ game, actions, onClose, onSaveResult, onSaveMove, onEnd }: SettingsModalProps) {
  const s = game.class.settings;
  const [conn, setConn] = useState(false);
  const upd = (patch: Partial<ClassSettings>) => actions.dispatch({ type: 'updateSettings', settings: patch });
  const roundOptions: number[] = [];
  for (let sec = roundLength.teacherMinMinutes * 60; sec <= roundLength.teacherMaxMinutes * 60; sec += 30) roundOptions.push(sec);
  const pick = <T,>(cur: T, v: T, label: string, on: () => void, testId?: string) => (
    <button key={label} type="button" class="t-seg__btn" aria-pressed={cur === v} data-testid={testId} onClick={on}>
      {label}
    </button>
  );
  return (
    <Modal title="설정" onClose={onClose} testId="settings-modal" wide>
      <div class="t-settings">
        <Row label="라운드 길이">
          {roundOptions.map((sec) =>
            pick(s.roundSec, sec, `${sec % 60 ? (sec / 60).toFixed(1) : sec / 60}분`, () => actions.dispatch({ type: 'setRoundSec', sec })),
          )}
        </Row>
        <Row label="순위 공개">
          {leaderboardRules.topNOptions.map((n) => pick(s.leaderboardTopN, n as TopN, n === 0 ? '안 보임' : `상위 ${n}`, () => upd({ leaderboardTopN: n as TopN })))}
        </Row>
        <Row label="최종 자산 탭">
          {pick(s.assetBoard, true, '보임', () => upd({ assetBoard: true }))}
          {pick(s.assetBoard, false, '숨김', () => upd({ assetBoard: false }))}
        </Row>
        <Row label="상별 수상 인원">{([1, 2, 3] as const).map((k) => pick(s.awardsPerPrize, k, `${k}명`, () => upd({ awardsPerPrize: k })))}</Row>
        <Row label="'다 썼어요' 대기 시간">
          {worksheetWaitSecOptions.map((w) => pick(s.worksheetWaitSec, w, `${w}초`, () => upd({ worksheetWaitSec: w })))}
        </Row>
        <Row label="진행 방식">
          {pick(game.class.schedule.mode, 'auto', '자동', () => actions.dispatch({ type: 'setProgressMode', mode: 'auto' }), 'mode-auto')}
          {pick(game.class.schedule.mode, 'manual', '수동', () => actions.dispatch({ type: 'setProgressMode', mode: 'manual' }), 'mode-manual')}
        </Row>
        <Row label="편지 배달">
          {pick(game.class.letters.enabled, true, '켜기', () => actions.dispatch({ type: 'toggleLetters', enabled: true }))}
          {pick(game.class.letters.enabled, false, '끄기', () => actions.dispatch({ type: 'toggleLetters', enabled: false }))}
        </Row>
        <Row label="공용 화면에 예보 보이기" off>
          <button type="button" class="t-seg__btn" disabled aria-pressed={s.showForecastOnScreen}>
            {s.showForecastOnScreen ? '보임' : '숨김'}
          </button>
        </Row>
        <Row label="회사 이름 확인 후 공개" off>
          <button type="button" class="t-seg__btn" disabled aria-pressed={s.nameReview}>
            {s.nameReview ? '켬' : '끔'}
          </button>
        </Row>
        <Row label="추가 금칙어" off>
          <input class="t-input" disabled placeholder="곧 열려요" />
        </Row>
        <div class="t-row t-settings__btns">
          <button type="button" class="btn btn--secondary" aria-expanded={conn} onClick={() => setConn((v) => !v)}>
            연결 테스트
          </button>
          <button type="button" class="btn btn--secondary" data-testid="btn-save-result" onClick={onSaveResult}>
            결과 파일 저장
          </button>
          <button type="button" class="btn btn--secondary" data-testid="btn-save-move" onClick={onSaveMove}>
            판 옮기기 파일 저장
          </button>
          <button type="button" class="btn t-btn--danger" data-testid="btn-end" onClick={onEnd}>
            판 끝내기·방 닫기
          </button>
        </div>
        {conn && <ConnectionTest />}
        <div class="t-modal__actions">
          <button type="button" class="btn btn--primary" data-testid="settings-close" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </Modal>
  );
}
