/**
 * 학습지 '항해 일지' "잠깐!" 팝업 W01~W20 (PRD 4.5, docs/worksheet.md 2장 대응표 — 작업 301 PASS).
 *
 * - 번호·ID·구간·문구(prompt)·쪽·helper 키는 docs/worksheet.md 2장 표를 그대로 옮겼다. 바꿀 때는 PRD 4.5,
 *   docs/worksheet.md, 이 파일을 함께 고친다(tests/data/worksheet.test.ts 가 문서 표와 1:1 대조).
 * - v0.3: afterEvent 가 'stageLastRound' 이면 그 구간 마지막 라운드 끝에 뜬다(④⑥⑦⑧⑪⑫, 확인 퀴즈가 들어가면 그 뒤).
 *   minutes = docs/worksheet.md 3장 칸별 시간, phase = 무역 시간 안('trade') / 마무리 단계('wrap', ⑯⑰⑱).
 *   stageEndFallback = 연결 사건이 빠지거나 짧아지면 그 구간 끝 모아 쓰기로 옮긴다.
 * - helper(게임 기록 도우미) 키의 표시 문구·계산은 worksheetHelpers.ts. ②⑫⑮⑲는 helper 없음.
 * - v0.3.4(PRD 4.3.3.1, docs/worksheet.md 2.2): `during` = 진행 중 필수 ★ 칸('지금 쓰기'). 이 필드가 있는 번호(③·⑭)만
 *   원천 체험 직후 40초 팝업으로 그 칸을 쓴다. `prompt`는 docs/worksheet.md 2.2 표를 그대로 옮겼다.
 */
import type { LessonId, WorksheetId, WorksheetPrompt } from './types';

export const worksheet: readonly WorksheetPrompt[] = [
  {
    id: 'W01', no: 1, label: '①', lesson: 'L1', afterEvent: 'L1-E2',
    prompt: '벽란도에서 다른 나라 상인이 판 물건과 사 간 물건을 나눠 써요. 무역·수입·수출의 뜻도 빈칸에 채워요.',
    pages: [95, 96], pagesLabel: '교과서 95~96쪽', helper: 'byeokrandoResult', minutes: 2, phase: 'trade', stageEndFallback: true,
  },
  {
    id: 'W02', no: 2, label: '②', lesson: 'L1', afterEvent: 'L1-E4',
    prompt: '천연가스를 생산할 수 없거나 비행기를 만드는 기술이 없다면 어떤 문제가 생길지 써요.',
    pages: [97], pagesLabel: '교과서 97쪽', helper: null, minutes: 2, phase: 'trade', stageEndFallback: true,
  },
  {
    id: 'W03', no: 3, label: '③', lesson: 'L1', afterEvent: 'L1-E5',
    prompt: '㉮ 나라와 ㉯ 나라의 교환 전후 결과를 적고, 무역의 좋은 점을 한 문장으로 써요.',
    pages: [98, 99], pagesLabel: '교과서 98~99쪽', helper: 'twoIslandsResult', minutes: 2, phase: 'trade', stageEndFallback: true,
    during: { part: '2', prompt: '지금 써요! 두 나라가 잘 만드는 것을 바꾸었더니 무엇이 좋아졌는지 ③의 2번 칸에 한 문장으로 써요.', sec: 40 },
  },
  {
    id: 'W04', no: 4, label: '④', lesson: 'L1', afterEvent: 'stageLastRound',
    prompt: '흑연을 어디서 샀는지 적고, 우리나라가 흑연을 수입하는 까닭을 써요.',
    pages: [99], pagesLabel: '교과서 99쪽', helper: 'graphiteChoice', minutes: 2, phase: 'trade', stageEndFallback: true,
  },
  {
    id: 'W05', no: 5, label: '⑤', lesson: 'L2', afterEvent: 'L2-E6',
    prompt: '우리 반 세관 게시판과 교과서의 주요 수입품·수출품을 비교해 써요.',
    pages: [100], pagesLabel: '교과서 100쪽', helper: 'customsBoard', minutes: 2, phase: 'trade', stageEndFallback: true,
  },
  {
    id: 'W06', no: 6, label: '⑥', lesson: 'L2', afterEvent: 'stageLastRound',
    prompt: '우리 회사가 수입한 자원, 공장에서 만든 상품, 수출한 곳을 차례로 써요.',
    pages: [101, 104], pagesLabel: '교과서 101쪽, 104쪽', helper: 'importProduceExport', minutes: 2, phase: 'trade', stageEndFallback: true,
  },
  {
    id: 'W07', no: 7, label: '⑦', lesson: 'L2', afterEvent: 'stageLastRound',
    prompt: '수출국 4유형 표에 교과서 예와 내가 사고판 상품을 채워요.',
    pages: [103], pagesLabel: '교과서 103쪽', helper: 'exportTypes', minutes: 2, phase: 'trade', stageEndFallback: true,
  },
  {
    id: 'W08', no: 8, label: '⑧', lesson: 'L2', afterEvent: 'stageLastRound',
    prompt: '싱가포르에 큰 항구가 발달한 까닭과 그곳에서 발달한 무역의 모습을 써요.',
    pages: [104], pagesLabel: '교과서 104쪽', helper: 'relayTrade', minutes: 2, phase: 'trade', stageEndFallback: true,
  },
  {
    id: 'W09', no: 9, label: '⑨', lesson: 'L3', afterEvent: 'L3-E1',
    prompt: '기사에서 찾은, 한국과 인도네시아가 기대하는 이익을 각각 써요.',
    pages: [106], pagesLabel: '교과서 106쪽', helper: 'mineralCoopChoice', minutes: 2, phase: 'trade', stageEndFallback: true,
  },
  {
    id: 'W10', no: 10, label: '⑩', lesson: 'L3', afterEvent: 'L3-E5',
    prompt: '내가 맡은 스마트폰 부품과 가져온 곳을 적고, 빈칸을 채워요.',
    pages: [106], pagesLabel: '교과서 106쪽', helper: 'smartphonePart', minutes: 2, phase: 'trade', stageEndFallback: true,
  },
  {
    id: 'W11', no: 11, label: '⑪', lesson: 'L3', afterEvent: 'stageLastRound',
    prompt: '경쟁의 세 가지 모습을 표에 쓰고, 게임에서 내가 겪은 장면을 적어요.',
    pages: [107], pagesLabel: '교과서 107쪽', helper: 'competitionRecord', minutes: 2, phase: 'trade', stageEndFallback: true,
  },
  {
    id: 'W12', no: 12, label: '⑫', lesson: 'L3', afterEvent: 'stageLastRound',
    prompt: '수출이 늘어나면 생기는 변화를 순서대로 빈칸에 채워요.',
    pages: [107], pagesLabel: '교과서 107쪽', helper: null, minutes: 1, phase: 'trade', stageEndFallback: true,
  },
  {
    id: 'W13', no: 13, label: '⑬', lesson: 'L4', afterEvent: 'L4-E1',
    prompt: '우리 반 투표 결과와 1970년대 실제 결과를 비교하고, 수입의 좋은 점과 문제점을 써요.',
    pages: [108], pagesLabel: '교과서 108쪽', helper: 'voteResult1970', minutes: 2, phase: 'trade', stageEndFallback: true,
  },
  {
    id: 'W14', no: 14, label: '⑭', lesson: 'L4', afterEvent: 'L4-E3',
    prompt: '내 베트남 공장 결정과 그 까닭을 적고, 해외 생산의 문제점을 써요.',
    pages: [109], pagesLabel: '교과서 109쪽', helper: 'factoryDecision', minutes: 2, phase: 'trade', stageEndFallback: true,
    during: { part: '2', prompt: '지금 써요! 베트남 공장을 그렇게 결정한 까닭을 ⑭의 2번 칸에 한 줄로 써요.', sec: 40 },
  },
  {
    id: 'W15', no: 15, label: '⑮', lesson: 'L4', afterEvent: 'L4-E4',
    prompt: '관세사가 하는 일을 빈칸에 채워요.',
    pages: [110], pagesLabel: '교과서 110쪽', helper: null, minutes: 1, phase: 'trade', stageEndFallback: true,
  },
  {
    id: 'W16', no: 16, label: '⑯', lesson: 'L4', afterEvent: 'L4-E6',
    prompt: '컨테이너 OX 결과를 적고, 자기 평가 3문항에 별을 칠해요.',
    pages: [111], pagesLabel: '교과서 111쪽', helper: 'containerResult', minutes: 1, phase: 'wrap', stageEndFallback: false,
  },
  {
    id: 'W17', no: 17, label: '⑰', lesson: 'L4', afterEvent: 'L4-E8',
    prompt: '잡지 표지에 넣을 우리 회사 소개 원고 여섯 칸을 써요.',
    pages: [112, 113], pagesLabel: '교과서 112~113쪽', helper: 'magazineDraft', minutes: 8, phase: 'wrap', stageEndFallback: false,
  },
  {
    id: 'W18', no: 18, label: '⑱', lesson: 'L4', afterEvent: 'L4-E9',
    prompt: '항해를 되돌아보며 세 문항에 한 줄씩 답해요.',
    pages: [111, 115], pagesLabel: '교과서 111쪽, 115쪽', helper: 'voyageSummary', minutes: 2, phase: 'wrap', stageEndFallback: false,
  },
  {
    id: 'W19', no: 19, label: '⑲', lesson: 'optional', afterEvent: 'optional:classroomDetective',
    prompt: '교실 물건과 그 물건의 재료나 물건이 온 나라를 표에 써요.',
    pages: [94], pagesLabel: '교과서 94쪽', helper: null, minutes: 2, phase: 'trade', stageEndFallback: false,
  },
  {
    id: 'W20', no: 20, label: '⑳', lesson: 'optional', afterEvent: 'optional:expo',
    prompt: '우리 홍보관에서 소개한 상품과 박람회의 좋은 점을 써요.',
    pages: [105], pagesLabel: '교과서 105쪽', helper: 'expoEntry', minutes: 2, phase: 'trade', stageEndFallback: false,
  },
];

export const worksheetById: Readonly<Record<WorksheetId, WorksheetPrompt>> = Object.fromEntries(
  worksheet.map((w) => [w.id, w]),
) as Record<WorksheetId, WorksheetPrompt>;

/** PRD 4.5 표의 번호·ID·구간·쪽(check:data·테스트 비교용 상수) */
export const PRD_WORKSHEET_TABLE: readonly { no: number; id: WorksheetId; lesson: LessonId | 'optional'; pages: readonly number[] }[] = [
  { no: 1, id: 'W01', lesson: 'L1', pages: [95, 96] },
  { no: 2, id: 'W02', lesson: 'L1', pages: [97] },
  { no: 3, id: 'W03', lesson: 'L1', pages: [98, 99] },
  { no: 4, id: 'W04', lesson: 'L1', pages: [99] },
  { no: 5, id: 'W05', lesson: 'L2', pages: [100] },
  { no: 6, id: 'W06', lesson: 'L2', pages: [101, 104] },
  { no: 7, id: 'W07', lesson: 'L2', pages: [103] },
  { no: 8, id: 'W08', lesson: 'L2', pages: [104] },
  { no: 9, id: 'W09', lesson: 'L3', pages: [106] },
  { no: 10, id: 'W10', lesson: 'L3', pages: [106] },
  { no: 11, id: 'W11', lesson: 'L3', pages: [107] },
  { no: 12, id: 'W12', lesson: 'L3', pages: [107] },
  { no: 13, id: 'W13', lesson: 'L4', pages: [108] },
  { no: 14, id: 'W14', lesson: 'L4', pages: [109] },
  { no: 15, id: 'W15', lesson: 'L4', pages: [110] },
  { no: 16, id: 'W16', lesson: 'L4', pages: [111] },
  { no: 17, id: 'W17', lesson: 'L4', pages: [112, 113] },
  { no: 18, id: 'W18', lesson: 'L4', pages: [111, 115] },
  { no: 19, id: 'W19', lesson: 'optional', pages: [94] },
  { no: 20, id: 'W20', lesson: 'optional', pages: [105] },
];

/** 진행 중 필수 번호('지금 쓰기' ★ 칸이 있는 번호, PRD 4.3.3.1) — 번호 순 */
export const duringWorksheetIds: readonly WorksheetId[] = worksheet.filter((w) => w.during).map((w) => w.id);

/** 지금 쓰기 칸 표시(학습지 ★ 꼬리표와 같은 글자 — docs/worksheet.md 1장) */
export const DURING_MARK = '★';

/** "③★" 같은 지금 쓰기 꼬리표 */
export function duringLabel(id: WorksheetId): string {
  return `${worksheetById[id]?.label ?? id}${DURING_MARK}`;
}

/** 그 구간의 학습지 번호(선택 활동 ⑲⑳ 제외) */
export function worksheetFor(lesson: LessonId): WorksheetPrompt[] {
  return worksheet.filter((w) => w.lesson === lesson);
}

/** 구간 끝 모아 쓰기 묶음 팝업 문구 "잠깐! ①②③④" */
export function bundleTitle(items: readonly WorksheetPrompt[]): string {
  return `잠깐! ${items.map((w) => w.label).join('')}`;
}
