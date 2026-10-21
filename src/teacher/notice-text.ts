/**
 * 교사 화면 알림·거절 코드 → 한글 문구(작업 132 — 114 검증 반영: 거절 코드가 영어 코드 그대로 보이던 것).
 * 코어(lesson·trade·host·schedule)와 세션이 교사 행동에 돌려주는 코드는 모두 여기에 문구가 있어야 한다
 * (tests/teacher/notice-text.test.ts 가 소스의 코드를 모아 대조). 화면에는 코드를 그대로 내지 않는다.
 */
import { appErrorToKorean } from '../sync/app-messages';

export const TEACHER_NOTICE_TEXT: Readonly<Record<string, string>> = {
  // 무역 시계·진행
  TRADE_STARTED: '무역이 이미 시작됐어요.',
  // (작업 162) 무역 끝은 선생님 [마무리로]로만 온다 — '시간이 끝났다'가 아니라 '무역이 끝났다'
  TRADE_ENDED: '무역이 끝났어요. 마무리 단계로 넘어가요.',
  // (작업 162) 추천 시간(T)을 처음 넘은 순간 한 번(토스트) — 판은 계속된다
  OVERTIME: '추천 시간이 지났어요. 판은 계속돼요 — 끝낼 때 [마무리로]를 누르세요.',
  NOT_STARTED: '무역을 시작한 뒤에 할 수 있어요.',
  ENDED: '판이 이미 끝났어요.',
  BAD_SEC: '그만큼은 바꿀 수 없어요(무역 시간 5~90분).',
  BAD_MINUTES: '무역 시간은 5~90분으로 정해요.',
  CANNOT_SHORTEN: '이미 지난 시간보다 앞당길 수 없어요.',
  ALREADY_PAUSED: '이미 멈춰 있어요.',
  NOT_PAUSED: '멈춰 있지 않아요.',
  BAD_MODE: '그 진행 방식은 고를 수 없어요.',
  PLAN_DONE: '계획한 활동이 모두 끝났어요.', // (작업 162) 보내는 곳 없음 — 문구만 남김
  // (작업 134) [지금 라운드 시작]
  PAUSED: '잠깐 멈춤 중이에요. [이어서 하기]를 먼저 눌러 주세요.',
  TIME_IS_UP: '추천 시간이 지났어요.', // (작업 162) 보내는 곳 없음 — 문구만 남김
  NO_NEXT_ROUND: '남은 라운드가 없어요.',
  ROUND_NOW_TIER1: '꼭 할 활동이 빠지게 돼요. 한 번 더 확인해요.',
  // 배치표 항목
  ALREADY_STARTED: '이미 시작한 활동이에요.',
  CANNOT_SKIP: '표지는 건너뛸 수 없어요.',
  NO_ITEM: '그 활동을 찾지 못했어요.',
  TIER1_CANNOT_DROP: '꼭 할 활동은 뺄 수 없어요. 짧게는 할 수 있어요.',
  NO_SHORT_FORM: '이 활동은 짧은 형태가 없어요.',
  BAD_FORM: '그 형태로는 바꿀 수 없어요.',
  CANNOT_FIRE_NOW: '지금은 시작할 수 없어요. 라운드가 끝나면 시작돼요.',
  REQUIRED_EVENT: '꼭 할 활동이에요. 정말 뺄지 한 번 더 확인해요.',
  // 구간·사건·라운드
  NOT_IN_SCOPE: '이번 판 범위에 없는 차시예요.',
  STAGE_ALREADY_STARTED: '이미 시작한 구간이에요.',
  STAGE_BACKWARD: '지난 구간으로는 돌아갈 수 없어요.',
  NO_EVENT: '그 활동을 찾지 못했어요.',
  NOT_FIRED: '아직 열지 않은 활동이라 다시 보낼 수 없어요.',
  NO_OPEN_EVENT: '지금 열려 있는 활동이 없어요.',
  NO_RESULT: '아직 보여 줄 결과가 없어요.',
  EVENT_OPEN: '활동 카드가 열려 있어요. 활동이 끝난 뒤에 해요.',
  ROUND_IN_PROGRESS: '라운드가 진행 중이에요. 라운드가 끝난 뒤에 해요.',
  NO_ROUND: '지금 진행 중인 라운드가 없어요.',
  // 학습지
  WORKSHEET_OPEN: '학습지 팝업이 떠 있어요. 학습지 시간이 끝난 뒤에 해요.',
  NO_WORKSHEET: '그 학습지 번호를 찾지 못했어요.',
  ALREADY_DONE: '이 학생은 그 학습지를 이미 다 썼어요.',
  // 편지
  LETTER_ARRIVES_WITH_ROUND: '편지는 라운드가 시작될 때 와요.',
  ALREADY_DELIVERED: '이미 도착한 편지는 건너뛸 수 없어요.',
  ALREADY_SKIPPED: '이미 건너뛴 편지예요.',
  // 학생·회사 이름
  NO_SEAT: '그 번호의 회사를 찾지 못했어요.',
  BAD_SEAT: '그 출석번호는 쓸 수 없어요(1~40).',
  SEAT_TAKEN: '그 번호에는 이미 회사가 있어요.',
  NAME_TAKEN: '이미 다른 회사가 쓰는 이름이에요.',
  NAME_FORMAT: '회사 이름은 2~10자(한글·영문·숫자)로 지어요.',
  BAD_NAME: '회사 이름으로 쓸 수 없는 말이 있어요.',
  BAD_NAME_WARNING: '회사 이름으로 쓰기 어려운 말이 있지만 바꿨어요.',
  NAME_BLOCKED: '막아 둔 회사 이름이에요. 학생이 새 이름을 지으면 허락할 수 있어요.',
  // 판 설정·저장
  BAD_SCOPE: '학습 범위를 다시 골라 주세요.',
  SCOPE_TOO_LONG: '범위를 줄이거나 시간을 늘려 주세요.',
  BAD_FILE: '결과 파일을 읽지 못했어요.',
  NO_SAVE: '이어서 할 판이 이 브라우저에 없어요.',
  NO_STORAGE: '이 브라우저에는 판을 저장할 수 없어요.',
  QUOTA: '브라우저 저장 공간이 모자라요.',
  VERSION: '다른 버전에서 만든 기록이라 열 수 없어요.',
  // 그 밖
  NOT_IMPLEMENTED: '아직 준비 중인 기능이에요.',
  HOST_ACTION: '지금은 할 수 없는 행동이에요.',
  BAD_ACTION: '지금은 할 수 없는 행동이에요.',
  ERROR: '문제가 생겼어요. 다시 해 보세요.',
};

/**
 * (작업 137 수정 1회차) core 배치 경고 문장(데이터용 말 'L1'·'구간')을 교사 화면 쉬운 말로 — 경고 문장은 core 것을 그대로 두고 보일 때만 바꾼다.
 * "L2 활동이 많아…" → "2차시 활동이 많아…", "구간 끝에 써요" → "차시 끝에 모아서 써요".
 */
export function teacherWarningText(w: string): string {
  return w
    .replace(/\bL([1-4])\b/g, '$1차시')
    .replace(/구간 끝에/g, '차시 끝에 모아서')
    .replace(/구간/g, '차시');
}

/** 화면에 띄우지 않는 알림(다른 곳에서 보여 주거나 정보용) */
export const SILENT_NOTICES: ReadonlySet<string> = new Set(['UPCOMING', 'WRAP_STEP', 'TIME_UP', 'NEEDS_CONFIRM']);

/**
 * 알림 코드 → 교사에게 보일 문구. 문구가 없으면 함께 온 한글 메시지, 그다음 앱 공통 문구, 끝으로 일반 문구.
 * 영어 코드는 화면에 내지 않는다.
 */
export function teacherNoticeText(code: string, message?: unknown): string {
  const known = TEACHER_NOTICE_TEXT[code];
  if (known) return known;
  if (typeof message === 'string' && message && !/^[A-Z0-9_]+$/.test(message)) return message;
  const app = code ? appErrorToKorean(code) : '';
  if (app && !/^[A-Z0-9_]+$/.test(app) && !app.includes(code)) return app;
  return '지금은 할 수 없어요. 잠시 뒤에 다시 해 보세요.';
}
