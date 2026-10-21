/**
 * 규칙 엔진 공개 API (작업 103). 화면·세션은 이 파일에서 가져온다.
 * src/core 는 DOM·Preact·네트워크·src/sync 를 import 하지 않는다(순수 함수).
 */
export * from './types';
export { hashString, mixSeed, mulberry32, roundRandom, seededShuffle, signedRandom } from './rng';
export {
  activeEffects, canTrade, clone, completedRound, createPlayer, defaultSettings, isEffectActive, isTrading, seatKey, stageRoundIndex,
  startSession, visibleGoods, type CreateSessionInput, type NewPlayerInput,
} from './state';
export {
  AVATAR_IDS, AVATARS, basicNameKey, basicNameValidator, basicNormalizeName, defaultFlag, FLAG_COLOR_IDS, FLAG_COLORS, FLAG_EMBLEM_IDS,
  FLAG_EMBLEMS, type NameCheckOptions, type NameCheckResult, type NameValidator,
} from './company';
export {
  CHIP_PENALTY_MULTIPLIER, isPortClosed, jitter, limitMultiplier, marketTag, marketView, portPrice, quote, tariffFor, tariffForLot,
  voyageCostFor, type PortPrice, type Quote, type QuoteTag,
} from './market';
export {
  applyAction, canTakeLoan, cargoCapacity, cargoUsed, fareDueOf, isFreeVoyage, predict, sailsThisRoundOf, spendable, stampFor,
  type ActionContext,
} from './rules';
export { arrive, resolveRounds } from './voyage';
export {
  applyTeacherAction, catchUpQueue, CLOCK_TEACHER_ACTIONS, EVENT_RESULT_SHOW_SEC, hasResultView, HOST_TEACHER_ACTIONS, isBlocking, resultShowing, type SideEffect, type TeacherResult,
} from './lesson';
export {
  assignDeliveredLetters, deliveredSlots, isSlotExpired, letterForSlot, letterSlots, mailbox, makeSlots, slotIndex, slotsArrivingAt, type LetterView,
} from './letters';
export {
  assetValue, awards, flatMetrics, hasCertificate, leaderboard, leapBase, leapRatio, metricValue, myRankIfTop, publicCompanyName,
  rankAll, recordBaseAsset, recordBaseAssets, type AwardOptions, type BoardOptions,
} from './scoring';
export { aggregate, publicClass, publicPayload, respondedTo, type AggregateOptions } from './aggregate';
export {
  applyVNDecision, applyVNImprove, applyVNReport, isBadChoice, parseVNDecision, VN_FACTORY, vnFactoryOutcome, type EnvChoice,
  type VNDecision, type Wage,
} from './factoryVN';
export { AUTO_PORT, canRespond, closeEventForAll, defaultOptionId, isNoResponse, TECH_RACE, VOTE_OPTIONS, voteCounts, voteResult } from './activities';
export {
  createHostReducer, createSessionReducer, hostReduce, playerView, toSessionOutputs, type HostHooks, type SessionLikeOutput,
} from './host';
export * as tradeClock from './clock';
export {
  autoRoundSec, blockingIn, buildSchedule, buildWrapup, costIn, expectedTime, extraPlacers, findItem, incidentFormula, inputFromClass,
  letterFormula, LINKED_EVENTS, normalizeInput, PREP_MINUTES, previewSchedule, RAISE_WARNING, fillForms, activityBudget, afterWorksheetsOf, reduceStageForBudget, reschedule, ScheduleError,
  stageActivities, toScheduleState, tradeWorksheets, tryBuildSchedule, worksheetPlacementOf,
  type ActivityStatus, type BankSize, type ExtraPlacer, type NormalizedInput, type PlacerContext, type RescheduleChange,
  type RescheduleResult, type RoundInfo, type Schedule, type ScheduleErrorCode, type ScheduleInput, type SchedulePreview,
  type StageSummary, type WorksheetWhere,
} from './schedule';
export {
  BASE_ASSET_RATIO, createTradeHooks, firstRoundPreview, itemFirers, lateness, nextRoundWait, POSTPONE_DEFAULT_SEC, roundNowPlan, TIME_UP_GRACE_SEC,
  tradeHooks, tradeRemaining, UPCOMING_SEC, type ItemFirer, type RoundNowBlock, type RoundNowPlan,
} from './trade';
