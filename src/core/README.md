# src/core/

게임 규칙(순수 함수). DOM·Preact·네트워크·`src/sync`를 import 하지 않는다. 화면·세션은 `index.ts`에서 가져온다.

| 파일 | 내용 |
|---|---|
| `types.ts` | 상태 모델(PRD 10.3 v0.3.1): `SessionMeta`, `ClassState`, `ScheduleItem`, `Player`, `HostSnapshot`, `PublicState`, `Action`, `TeacherAction`, `HostInput`, `HostOutput`, `GameEvent` + `normalize*` 다시 내보내기 |
| `state.ts` | `startSession`(구간별 시작 조건), `createPlayer`, `normalizePlayer/Class/Snapshot`, 작은 도구 |
| `rng.ts` | 시드 난수 `mulberry32`, `roundRandom(seed, lesson, round, key)` |
| `market.ts` | `quote`·`portPrice`(학급 공통 가격 ±5%), 한도, 관세, 운항비, 막힌 항구 |
| `rules.ts` | 학생 행동 `applyAction` / `predict` (사기·팔기·도장·관세·목적지·준비·공장·회사 설립·이름·편지·확인 퀴즈·사건 응답·학습지·대출) |
| `voyage.ts` | `resolveRounds`(놓친 라운드까지, 멱등) |
| `lesson.ts` | 교사 행동 `applyTeacherAction`(구간·사건·라운드·일시정지·학습지·편지·설정·무역 끝), `catchUpQueue` |
| `letters.ts` | 편지 슬롯(배치표 letter 항목), 회전 출제 `letterForSlot`, 만료, 보상 |
| `activities.ts` | 사건 발동·응답·마감의 개인/학급 효과(벽란도·두 섬·흑연·기술 경쟁·투표·호찌민 공장·컨테이너·잡지 표지) |
| `progress.ts` | 도감 카드·임무 진행 |
| `scoring.ts` | 지표 8개, `leaderboard`, `awards`(hideFlatMetrics), `myRankIfTop`, 완주 증서, 도약 기준 자산 기록 |
| `aggregate.ts` | 학생 목록 → `PublicState`(출석번호·자금·명단 없음) |
| `factoryVN.ts` | 호찌민 공장 즉시 정산·보도·개선 |
| `company.ts` | 깃발 색·문양·아바타, 회사 이름 기본 검사(작업 124 함수 주입 자리) |
| `host.ts` | 호스트 리듀서 `hostReduce`, `createHostReducer`, 세션(124) 모양 어댑터 `createSessionReducer`. 훅 `onTick`·`onHostGap`·`onTeacherAction`(123) |
| `clock.ts` | (123) 무역 시계 순수 계산: `startTrade`·`pause`·`resume`·`extend`·`shorten`·`hostGap`·`elapsedSec`·`remaining`·`elapsedRatio` (index 에서는 `tradeClock.*`) |
| `schedule.ts` | (123) 자동 배치 `buildSchedule`/`tryBuildSchedule`, 다시 배치 `reschedule`, 미리보기 `previewSchedule`, 마무리 `buildWrapup`, 확장 지점 `extraPlacers` |
| `trade.ts` | (123) 리듀서 훅 `createTradeHooks(base)` — 틱 자동 진행·시간 끝·교사 시간 조작·hostGap. 대시보드 계산 `lateness`, `tradeRemaining`. 확장 지점 `itemFirers` |

앱(교사 화면)은 `createSessionReducer(createTradeHooks({ validateName: validateCompanyName }))`처럼 훅을 넣어 쓴다. 훅이 없으면 `startTrade` 등은 103처럼 `NOT_IMPLEMENTED`.
