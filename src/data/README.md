# src/data/

교과서 문장·게임 데이터(작업 102). 규칙 엔진(core)과 화면은 이 데이터만 읽는다. 모든 교과서 문장 객체에 `pages`(94~117) 필수,
교과서에 없는 값은 `gameRule: true`, 지어낸 뉴스는 `fake: true`. `npm run check:data`가 검사한다.

| 파일 | 내용 |
|---|---|
| types.ts | 타입 정의 |
| goods.ts / ports.ts / market.ts | 상품 21종, 항구 12곳, 시장표·가격 배수·한도·관세 |
| routes.ts | 경유점 그래프(수에즈 경유), `shortestPath`, `distanceSteps`, `voyageCost` |
| recipes.ts / ships.ts | 공장 레시피 4종, 배 3종·긴급 대출 |
| lessons.ts / events.ts / missions.ts | 학습 구간 L1~L4·사건 큐, 사건(v0.3 배치 필드), 임무 |
| schedule.ts | 판 단위·차시 카드·마무리 구성표, 배치 상수, 줄이는 순서, 구간 시작 조건 |
| letters.ts / letterSchedule.ts / checkQuiz.ts | 편지 문제 은행(+common), 슬롯 순환 패턴·보상, 확인 퀴즈 |
| worksheet.ts / worksheetHelpers.ts | 학습지 W01~W20(docs/worksheet.md 2장), 기록 도우미 16종 |
| dex.ts | 개념 카드·수출국 4유형·교실 물건·항해 규칙 탭·앞 차시 요약 카드 |
| byeokrando.ts / twoIslands.ts / containers.ts | L1 미니게임 2종, p.111 컨테이너 OX·자기 평가 |
| awards.ts / text.ts | 지표·상, 공통 띠 문구·교과서 속 기사 원문 |

- `name-filter.ts`(회사 이름 금칙어)는 작업 124 소유, `world-land.ts`(육지 경로)는 작업 106 소유다. 둘 다 쪽수 검사 대상이 아니다.
- 새 데이터 파일을 만들면 `scripts/check-data.ts`의 `MODULES`에 등록한다(등록하지 않으면 경고).
