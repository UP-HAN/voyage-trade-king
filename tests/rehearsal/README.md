# 리허설 도구 (작업 135) — 가상 학생 25명

큰 변경 뒤마다 한 명령으로 실제 교실 흐름을 처음부터 끝까지 돌려 **수업이 막히는 지점**을 찾는다.

```bash
npm run rehearsal                       # 빌드 → 로컬에서 시나리오 a~e
npm run rehearsal -- --scenario a       # 하나만(쉼표로 여러 개)
npm run rehearsal -- --no-build         # dist/·server/dist/가 최신이면 빌드 생략
npm run rehearsal -- --realtime --scenario a   # 실제 시간(배속 1)
npm run rehearsal -- --break no-actions,fake-money --scenario a   # 고장 플래그(탐지기 확인)
npm run rehearsal -- --target https://lab.ches.es.kr/voyage/ --scenario a   # 운영 점검 — 교사 승인 범위에서만
```

결과: `tmp/rehearsal/<시각>/report.md`(맨 위 "막힘 n / 문제 n"), `summary.json`, `shots/`.

## 구성
| 파일 | 하는 일 |
|---|---|
| `scripts/rehearsal.mjs` | 옵션 해석 → 빌드 → Playwright 실행 → 프로세스 정리 확인 |
| `rehearsal.spec.ts`, `playwright.config.ts` | 시나리오마다 테스트 하나(문제가 있어도 실패하지 않고 보고서에 모음) |
| `runner.ts` | 서버·교사·공용 화면·학생 25명을 띄우고 일정대로 조작, 막힘 탐지기 |
| `scenarios.ts` | 시나리오 a~e(무역 시간 비율로 적은 교사 조작·학생 무리 일정), 고장 플래그 |
| `student.ts` | 실제 학생 화면 브라우저 학생의 두뇌(testid·보이는 글자만 봄) |
| `bot-page.ts`, `bots.ts` | 가벼운 봇(실제 학생 코드 + 실제 중계 서버 연결) 페이지와 그 묶음·주입 |
| `detector.ts` | 문제 기록·판정 함수(단위 테스트 `detector.test.ts`) |
| `static.ts`, `env.ts` | 빌드본 사본을 `/voyage/`로 주는 정적 서버, 운영과 같은 중계 서버 환경 변수 |
| `report.ts` | report.md·summary.json |

- 학생 25명 = 브라우저 4(1~4번) + 봇 21(5~25번). 늦게 오는 학생·끊겼다 돌아오는 학생·새로 고침·이름 다시 짓기(같은 이름·금칙어)를 섞는다.
- 시간은 e2e 빨리 감기 시계(`e2e/support/fast-clock.ts`, 기본 8배). 서버는 실제 시간.
- 앱이 바뀌어도(예: 134 [지금 라운드 시작]) 버튼이 있으면 쓰고 없으면 건너뛴다.

## 분류 규칙(보완 1)
- **준비 중 기능(참고)**: 단원 한 판·L2~L4는 기능 플래그 `FULL_UNIT_READY=false`로 '준비 중'이다. 시나리오 c는 개발용 열쇠 `localStorage['voyage.dev.fullUnit']='1'`을 교사 브라우저에만 넣어 연다. 열쇠로도 안 열리면 c를 "건너뜀(준비 중 기능)"으로 남긴다(도구 오류·/health peers 문제로 치지 않음). c에서 L2~L4 사건 응답이 되돌려진 것(BAD_RESPONSE 등)과 없는 그림은 `[준비 중 기능]` 참고로 분리한다.
- **/health peers 25 미만**은 무역 시작까지 간 판에서만 문제로 본다.
- **가림 판정**: 사건·미니게임·학습지·일시정지·이름 막힘 층(`data-layer`), 편지 패널, 비차단 사건 패널에 가려 눌리지 않는 것은 정상 흐름이다. 학생 두뇌는 맨 위 층부터(학습지 → 따라잡기·사건 → …) 답하거나 [닫기]를 누르고, 할 일이 없으면 층 아래 버튼을 누르지 않고 기다린다(횟수는 `metrics.layerFirst`). 정상 층이 아닌 것에 가렸을 때만 `[참고] 학생 화면 [id] 조작이 여러 번 실패(정상 층이 아닌 것에 가림)`으로 남기고 맨 위 요소·스크린숏을 붙인다.

## 층·가림 탐지(수정 1)
- 학생 화면 맨 위 층을 공개 상태와 대조한다(`detector.ts` `layerLegit`): 사건·미니게임 층은 따라잡기·지금 미니게임·차단형 사건(진행·마감 결과)일 때만, 학습지 층은 학습지가 떠 있을 때만 정상. 맞지 않는 층이 30초(빠른 시계) 이어지면 [문제], 60초면 [막힘]. 화면 가운데 창(aria-modal)이 30초 넘게 안 닫히면 [막힘]. 정상 층에 같은 버튼이 10번 넘게 가리면 [문제].
- '할 수 있는 행동'은 보이고 **실제로 눌리는**(가운데 점 `elementFromPoint`가 자기·자손) 거래·출항 버튼만 센다. 핵심 버튼(항구 들어가기·출항 준비·항구 고르기·학습지 다 썼어요)이 정상 층이 아닌 것에 가려 실패하면 한 번이라도 [문제].
- 고장 플래그 `stuck-layer`(1번)·`stuck-modal`(2번)·`click-shield`(3번)·`bar-no-pointer`(4번)로 확인한다.
