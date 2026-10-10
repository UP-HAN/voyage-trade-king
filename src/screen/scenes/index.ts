/**
 * 장면 목록(작업 110). 장면 ID → 컴포넌트.
 *
 * 다른 작업이 장면을 더하거나 바꾸는 법(result.md 참고):
 * - 사건 카드 본구현(111): `registerScene('event', MyEventCard)` 또는 `EventScene.tsx`를 고친다.
 * - 학급 활동 장면(115~118): `SCENE_PICKERS`에 "이 상태면 이 장면" 함수를 더하고(`addScenePicker`), `registerScene('<새 ID>', 컴포넌트)`.
 *   고르기 함수는 '자동' 장면일 때만, 기본 규칙(`pickScene`)보다 먼저 불린다. null을 돌려주면 기본 규칙으로.
 */
import type { ComponentType } from 'preact';
import { resultShowing } from '../../core';
import type { ScreenData, SceneId } from '../model';
import { BarsScene } from './BarsScene';
import { CodeScene } from './CodeScene';
import { CoverScene, SummaryScene } from './CoverScene';
import { EventScene } from './EventScene';
import { LeaderboardScene } from './LeaderboardScene';
import { MapScene } from './MapScene';
import { MinigameResultScene, minigameResultPicker } from './MinigameResultScene';
import { AwardsScene, BlackScene, EndedScene, PauseScene, RulesScene } from './MiscScenes';
import type { SceneProps } from './types';
import { AfterWorksheetScene, pickAfterWorksheetScene, WorksheetScene } from './WorksheetScene';

export type { SceneProps } from './types';

const SCENES: Record<string, ComponentType<SceneProps>> = {
  code: CodeScene,
  rules: RulesScene,
  cover: CoverScene,
  summary: SummaryScene,
  event: EventScene,
  bars: BarsScene,
  map: MapScene,
  leaderboard: LeaderboardScene,
  worksheet: WorksheetScene,
  pause: PauseScene,
  awards: AwardsScene,
  ended: EndedScene,
  black: BlackScene,
} satisfies Record<SceneId, ComponentType<SceneProps>>;

// 작업 113이 채울 미니게임 결과 장면(자동 고르기 규칙은 113이 addScenePicker로 더함)
SCENES.minigameResult = MinigameResultScene;
// (작업 112) 마무리 단계 '끝나고 쓰기' 목록 장면(수상 회사가 없어 시상 장면이 안 나올 때)
SCENES.afterWorksheet = AfterWorksheetScene as ComponentType<SceneProps>;

/** 장면 컴포넌트 등록·교체 */
export function registerScene(id: string, comp: ComponentType<SceneProps>): void {
  SCENES[id] = comp;
}

export function sceneComponent(id: string): ComponentType<SceneProps> {
  return SCENES[id] ?? MapScene;
}

/** '자동' 장면 고르기 확장(115~118). 먼저 등록한 것부터, null이 아니면 그 장면 */
export type ScenePicker = (d: ScreenData, now: number) => string | null;
export const SCENE_PICKERS: ScenePicker[] = [];
export function addScenePicker(p: ScenePicker): void {
  SCENE_PICKERS.push(p);
}

// (작업 111) 마감한 확인 퀴즈·결정·투표의 결과를 보여 주는 동안(core `resultShowing`, 20초)은 사건 장면(정답률·분포 막대·해설)
addScenePicker((d, now) => (resultShowing(d.cls, now) ? 'event' : null));
// (작업 112) 마무리 + 끝나고 쓸 번호 + 수상 회사 없음 → '끝나고 쓰기' 장면
addScenePicker((d) => pickAfterWorksheetScene(d));

// (작업 113) 벽란도·두 섬 결과(이름 없는 막대): 열려 있는 동안 한 명이라도 마치면, 마감 뒤에는 결과 막대 대신
addScenePicker(minigameResultPicker);
