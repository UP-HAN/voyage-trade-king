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
