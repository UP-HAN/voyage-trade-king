# 인수인계서 (HANDOFF) — 대항해 무역왕

- 기준일: **2026-10-22 아침**(집 컴퓨터 → 학교 PC. 직전 인수인계는 10-21 21시 학교 PC → 집). 1~11장은 2026-10-20 기준이고, **오늘 바뀐 것과 할 일은 0장이 우선**이다.
- 읽는 사람: ① 이 프로젝트의 교사(주인) ② 새 컴퓨터의 Claude Code(오케스트레이터)
- 목적: 작업 환경을 다른 데스크톱으로 완전히 옮긴 뒤, 이 문서만 보고 같은 상태에서 바로 이어서 작업한다.
- **이 파일은 공개 저장소에 있다.** 비밀값, 서버 접속 정보, 개인 설정은 여기에 쓰지 않는다. 그런 것은 모두 **비공개 작업 저장소 `UP-HAN/voyage-trade-king-workspace`(비공개)의 `RESTORE.md`를 따른다.**

---

## 0. 지금 바로 (2026-10-22 아침 — 오전 배포까지 끝낸 상태, 공개수업 13:50 이후 이어서)

### 0.1 어디에 무엇이 있나
| 무엇 | 위치 | 상태 |
|---|---|---|
| **운영 사이트** | `https://lab.ches.es.kr/voyage/` = 가지 `wip/2026-10-21-school` 커밋 `46865b1`(작업 159~169 포함). 서버 release `20261021-220145`(UTC, = 10-22 07:01 KST), 이전 release `20261021-164617`(첫 배포 ad7a1e5) | **두 번째 배포 완료**(게임 화면만, 중계 서버·nginx·다른 앱 안 건드림) |
| 되돌리기 | `ssh ras-server "sudo ln -sfn /var/www/voyage/releases/20261021-164617 /var/www/voyage/current"` (어제 18:24 버전으로는 `…/20261021-092438`) | 필요할 때만 |
| **이어서 할 코드** | 공개 저장소 가지 **`wip/2026-10-21-school`**(HEAD = 이 HANDOFF 커밋). `main`은 옛 상태(a7d7804, 어제 배포본)라 **아직 wip를 main에 병합하지 않았다** — 공개수업 뒤 교사와 정한다 | |
| 작업 기록·영상·보고서 | 비공개 저장소 `UP-HAN/voyage-trade-king-workspace`의 `RESTORE.md` **0절**대로 덮어쓰기 | |
| 학교 PC 시작 프롬프트 | `.orch/reports/학교PC-시작프롬프트.md`(비공개 저장소에도 있음) | |

> 배포는 **ras-server와 같은 서버**(교사의 다른 앱 ras·class·kart 있음 — 절대 건드리지 않는다). 게임 화면만 올릴 때: **깨끗한 `git worktree`에서** `npm ci` → `npm run build` → `cd dist && tar -czf ../web.tgz .` → `scp web.tgz tmp/deploy/redeploy-web-only.sh ras-server:/tmp/` → `ssh ras-server "bash /tmp/redeploy-web-only.sh"`(작업 폴더에서 바로 빌드하면 다른 담당의 미커밋 변경이 섞인다 — 10-22 새벽에 이 방식을 썼다). 한글 경로 때문에 worktree는 `%TEMP%`처럼 한글 없는 곳에 만든다. **Claude의 ssh 실행 명령이 자동 권한 검사에 거절될 수 있다**(10-22 첫 시도 거절, 두 번째 허용 — 일정하지 않음). 거절되면 scp까지 하고 교사가 위 `ssh` 한 줄을 직접 실행한다. **수업 시간(평일 08:30~16:30)에는 배포하지 않는다.** 배포 뒤 교사 화면부터 `Ctrl+F5`, **방은 새로 만든다**(옛 방은 옛 순서가 저장돼 있음).

### 0.2 10-22 새벽에 한 일 (작업 번호는 `.orch/tasks/<번호>-…/result.md`)
| 작업 | 내용 |
|---|---|
| 159 | 학생·TV 화면에서 남은 시간 숫자 숨김(교사 화면만 보임, "예정보다 n분 느려요"), 자유 항해에서 돈 < 운항비여도 출발(후불, 정산 때 모자라면 대출) |
| 160 · 160b | 2차시 갈매기 힌트 편지 8문항(L2-G1~G8). 임무(수입→생산→수출)에서 **2분 막힌 학생에게 갈매기 힌트 카드**(2분 뒤 첫 힌트, 2분 더 뒤 둘째 힌트=항구 이름까지, 상황당 2개·임무당 5개, 상수 `src/data/stuckHints.ts`) |
| 161 · 161b | **되팔기**: 산 항구에서 산 값의 80%(`RESELL_RATE`, `src/data/market.ts`), [모두] 버튼, 못 파는 카드에 '사 주는 항구' 힌트, '배가 꽉 차요' 안내 |
| 162 | **시간이 지나도 판이 저절로 끝나지 않음**: 교사 시계 '추천 시간 mm:ss 남음 → +mm:ss 지남', 판은 교사 [마무리로]·[수업 끝내기]로만 끝남(정산 먼저) |
| (슬라이드) | TV 개념 슬라이드는 **눌러야 넘어감**(클릭·←/→·◀▶) |
| (⑤ TV) | 학습지 ⑤ 쓰는 동안 TV는 세관 게시판을 그대로 보이고 아래에 '잠깐! ⑤' 띠 |
| (멈춤 TV) | [잠깐 멈춤] 중 TV에 설명할 내용(슬라이드·사건 카드·세관 게시판·학습지)이 있으면 그 장면 유지, 없으면 '선생님을 보세요'(`src/screen/index.tsx` `PAUSE_EXPLAIN_SCENES`) |
| 165 | **학습지 ⑥ 게임하면서 동시 작성**: 2차시 앞 시간 25분 = 라운드 1·2·3 → 세관 게시판(712초) → ⑤(892초) → 라운드 4·5 → ⑥ 마무리 팝업(1380초) → 끝(1500초). ⑤ 뒤 첫 라운드에 '잠깐! 학습지 ⑥' 하단 카드, 맨 끝 ⑥ 팝업에 "아직 못 쓴 친구들은 남은 문제를 다 풀어보아요…" 한 줄 |
| 167 · 168 | **싱가포르·수출국 4유형을 늦게**: 앞 시간(15차시)은 둘 다 없음(싱가포르 끝까지 잠김, 해도에 회색 점), 뒤 시간(16차시)은 싱가포르 처음부터 열림 + 4유형 임무는 라운드 3 시작, 두 시간 모두는 ⑥ 팝업 닫힘 때 열림. 편지: 앞 시간·두 시간 모두는 L2-03·06·07·08 제외. 수입→생산→수출 임무는 라운드 1 |
| 169 | **교사 시범 화면 `#/demo`**: 수업 방과 분리된 연습 판(시범무역·800만 원·부산·원유 2상자, 앞 시간 설정), 멈춤·사건·학습지가 안 뜸, [처음부터 다시], 교사 시작 화면·대시보드 [TV 화면 ▾]의 [시범 화면 열기] |
| 학습지 ⑤ 표현 | "교과서 그림" → "교과서 100쪽의 수입품·수출품"(TV 세관 문구·교사 발문·PRD) |
| 영상 | 선생님용 설명 v2·학생용 설명 v2(검증 후 자막 수정·재렌더)·**1차시 복습 모션그래픽 2:34**(`media/out/`) — 교사 확인 완료("영상은 끝") |
| 기타 | 퀴즈 카트 문제 30개 xlsx(`.orch/reports/퀴즈카트_1-2차시_복습_30문제_수정3.xlsx`), 오늘 순서 해설 docx(`.orch/reports/오늘순서-해설-1-2차시-수정.docx`, 165 이전 시간표 — 교사가 "오늘 순서는 내가 바꿔서 이해했으니 안 바꿔도 된다" 했다가 다시 "해 줘"라고 함 → **165·167 이후 시간표로 한 번 더 고쳐야 하면 `build.js`(임시 폴더에 있었음)를 다시 만들어야 함**), 가상 수업 리허설 보고(`.orch/reports/2026-10-21-가상수업-리허설-보고.md`, 리허설 도구에 말썽 학생 모드·측정 추가, `REHEARSAL_CHAOS=1 npm run rehearsal -- --scenario f --speed 2`) |

### 0.3 검증 현황 — 반드시 읽을 것
- **통과(직접 확인)**: 깨끗한 사본(`git worktree`, HEAD `46865b1`)에서 `typecheck` 오류 0, `npm test` 1487 통과·4 건너뜀(교과서 원문 파일이 git에 없어서 — 원래 폴더에서는 1491 전부 통과), `check:data` 오류 0(경고 12 = L3·L4 TODO), `build`·`build:server` 통과. 배포 뒤 서버 파일에 새 문구가 들어 있고 `/health` 정상 확인.
- **담당 보고만 있음(통합 재검증 못 함)**: 작업 167·168·169의 e2e(lesson2-full 15·25·30분, student-port, teacher-first-time, round-start, screen, teacher-demo)는 각 구현 담당이 통과로 보고했다. **최종 통합 검증(170)은 Opus 주간 사용 한도(10-23 04:00 KST 초기화) 때문에 중간에 끊겼다**(`.orch/tasks/170-final-verify/`에 시작 흔적만). 작업 165까지는 통합 검증(166) PASS(조건부)를 받았고, 그 조건(⑤ TV CSS)은 커밋 `e3a39b0`로 반영했다.
- **알려진 실패(이번 변경과 무관)**: `worksheet-letters` B·C(작업 153 이후 낡은 기대값), `lesson1-full` E(학생 `.st-steps` 글자 17px → 18px 필요, 어제 배포분 149에서 생김), `lesson1-full` E 923줄 TV map 대기(환경 흔들림).
- **학교 PC에서 첫 일**: ① `npm install` → `npm run typecheck` → `npm test` ② e2e를 **한 번에 하나씩** 돌려 170 항목 확인: `e2e:l1`·`npx playwright test -c tests/screen/playwright.config.ts`·lesson2-full(`tests/e2e-preview.playwright.config.ts`)·teacher-demo(`tests/teacher-demo.playwright.config.ts`) ③ 실제 브라우저로 앞 시간 25분 판을 한 번 끝까지(교사·TV·학생 2명) ④ 필요하면 `npm run rehearsal -- --scenario f`.

### 0.4 교사 결정이 필요한 것 / 열린 질문
1. **뒤 시간(16차시) 임무 패널 '먼저 할 일' 문구**가 4유형 칸을 채우라고 하는데 4유형 임무는 라운드 3에야 시작 → 문구 조정(167 result.md 남은 위험).
2. 두 시간 모두 판은 ⑥ 뒤에 라운드가 없어 싱가포르·4유형은 '오늘 순서를 다 했어요' 뒤 자유 항해로만 가능 → 판 설정 부제에 "싱가포르·수출국 4유형은 ⑥ 뒤" 덧붙일지.
3. 15분 이하 앞 시간 판은 세관 게시판이 라운드 1 바로 뒤라 수출 기록이 빌 수 있음.
4. 서버 동시 방 상한 30 → 50(2GB 후, 6.4절). `wip/2026-10-21-school` → `main` 병합 시기.
5. 공략집 PDF(선생님·학생)는 10-19 판이라 낡음(특히 선생님 편 27쪽 "무역 시간이 끝나면 마무리가 저절로 시작돼요"는 162 이후 틀림). 학습지 PDF는 문구 확인 결과 문제 없음(빌드의 "PDF가 원본보다 오래됐어요" 경고는 거짓 경고).
6. 학습지 머리 규칙("[다 썼어요]는 위 문항만 써도 됨")과 ⑥의 "1·2·3번 모두" 불일치 — 교사 요구대로라 말로 안내.
7. 시범 판에는 실제 2차시 첫 임무 막대가 없음, 영상 속 화면에는 시간 숫자가 보임(수업 때 "영상 속 화면에는 시계가 보이지만 오늘은 안 나와요"라고 한마디).
8. 160 2단계(모든 학생에게 가는 갈매기 신문)는 **막힌 학생 힌트(160b)로 대체**했다 — 별도 신문이 더 필요한지 교사 확인. 교사 반응: 힌트 간격은 지금(2분)대로, 너무 많이 주지 않아도 됨, 막힌 학생은 교사가 직접 돕는다.

### 0.5 수업 운영 메모
- 공개수업 = 사회 15차시 = **2차시 '앞 시간'(교과서 100~102쪽) 25분 판**. 16차시 = 뒤 시간(103~104쪽, 수출국 4유형·싱가포르 중계). 40분 수업: 준비 5 + 무역 25 + 마무리 5 = 35분(PRD 4.3.6).
- 시연 순서: 교사 화면 `Ctrl+F5` → 판 설정에서 2차시·**앞 시간**·25분 → 새 방. 설명이 필요할 때는 [잠깐 멈춤] + TV 슬라이드 또는 [시범 화면 열기](멈춰도 시범 창은 안 멈춤).
- 학습지 쓰는 시간은 리허설로 측정하지 못했다(봇 설정이 만든 값이라 결론 못 냄) — 느린 학생은 교사가 라운드 중에 학생 표 '학습지' 열을 보며 돕고, 못 쓴 것은 마무리 '끝나고 쓰기'에서 이어 쓴다.
- 2차시 15차시 지도안 인포그래픽: `media/handout/인포그래픽지도안_15차시.pdf`(다른 세션 산출).

### 0.6 환경·권한 주의
- **Opus 주간 한도**: 이 계정은 10-22 새벽에 한도에 닿아 Opus 서브에이전트(planner·implementer·verifier·motion-designer)가 **10-23 04:00 KST까지** 실행되지 않는다. 학교 PC도 같은 계정이면 같은 한도다. 한도 중에는 메인 세션이 직접 작업하거나, 교사에게 먼저 알리고 서브에이전트에 `model: "sonnet"`을 지정한다(전역 규칙은 Opus 5.5 — 예외는 교사 확인 필요).
- **포트 8765는 AI 사무실(교사의 다른 도구)이 쓴다.** 작업 뷰어는 8766 등 다른 포트(`.claude/launch.json`). 테스트는 4319·5288·5199·4339 등.
- 한글 경로에서 `fs.rmSync`·`fs.cpSync` 금지(CLAUDE.md). 서버 접속·배포는 교사 승인 뒤에만, git push도 승인(이 프로젝트 규칙). ras·class·kart 등 다른 앱은 절대 건드리지 않는다.

### 0.7 다음에 할 일(추천 순서)
1. 공개수업(10-22 13:50) 반응·교사 피드백을 `.orch/reports/2026-10-22-공개수업-피드백.md`로 받아 정리 → 작업 번호 **171부터**(번호 170은 최종 통합 검증).
2. 위 0.3의 통합 검증 마무리, 0.4의 결정 반영.
3. 이전 백로그: 3·4차시(116~118), 공략집 PDF 다시 만들기(`npm run guide:build`, `scripts/guide/capture.ts`가 자유 항해 기본값에서 실패할 수 있음), 영상 화면의 시간 숫자 다시 찍기, 돈 격차 조정 사건(상위 '폭풍 경보'·하위 '구호 무역선', 151/153 result.md), 통합 검증 참고(교사 화면 띠, 자유 항해 판 학생 표 '출항 준비 0' 숨기기 등), `tests/tmp154/`·`tests/tmp169/` 정리.


---

## 1. 한눈에

| 항목 | 내용 |
|---|---|
| 무엇 | 초등 6학년 사회 「세계 속의 무역」(교과서 94~117쪽) 수업용 웹 게임 「대항해 무역왕」. 학생 한 명이 무역 회사 하나를 맡아 항구를 오가며 사고판다. 교사 PC가 대시보드(=게임 호스트), TV는 공용 화면 |
| 접속 | 학생은 크롬북·태블릿으로 **6자리 방 코드 + 출석번호 + 회사 이름**으로 입장(계정·실명 없음) |
| 운영 주소 | `https://lab.ches.es.kr/voyage` (정적 파일 + 저장 없는 WebSocket 중계 서버) |
| 공개 저장소 | https://github.com/UP-HAN/voyage-trade-king (2026-10-10 공개, CI = GitHub Actions) |
| 비공개 저장소 | `UP-HAN/voyage-trade-king-workspace` — 작업 기록(`.orch/`), 영상(`media/`), 전역 설정, 서버 전용 스크립트, 교과서 원문 등 |
| 기획 문서 버전 | `docs/PRD.md` **v0.3.6**(2026-10-18), `docs/worksheet.md` v1.2, `docs/teacher-setup.md` v0.3.4, `docs/server-setup.md` v0.3.2, `docs/art-style.md` v0.1.2 |
| 마지막 커밋 | `473319e` 2차시 판 완성: 부산 공장, 임무 3종, 싱가포르 중계, 세관 게시판, 학습지 ⑤~⑧ 연동, 2차시 항구·상품 그림 |

### 지금 상태 (2026-10-20)
- **1차시 판, 2차시 판: 완성, 서버에 배포됨.** 2차시 판(작업 115)은 검증 PASS(수정 1회), 가상 학생 25명 리허설(2차시 25분)에서 막힘 0·문제 0.
- **3·4차시 판과 '단원 전체 한 판': '준비 중'.** 판 설정 화면에서 고를 수 없게 막혀 있다. 기능 플래그는 `src/data/schedule.ts`의 `LESSON_READY = { L1: true, L2: true, L3: false, L4: false }`이다. 단원 한 판(`FULL_UNIT_READY`)은 네 값이 모두 true일 때만 열린다.
- **10월 22일(목) 공개수업 = 2차시 판.** 계획: 21일 교사가 실제 서버에서 직접 플레이한다 → 고칠 것이 나오면 21일 안에 수정·재배포한다.
  - 2차시는 무역 시간 **25분 이상**을 권한다(더 짧게 고르면 판 설정에 안내가 뜬다). 검증자는 자원 수입→생산→수출을 끝까지 경험하려면 30분을 권했다.
  - 2차시 판은 학생마다 **담맘에서 사 온 원유 2상자를 싣고 시작**한다(게임 설정). 공장 개장 카드 때 교사가 한마디 해 주면 좋다(문구 예시: `.orch/tasks/115-lesson2-factory-relay/review.md` 재검증 절, 비공개 저장소).
- 학습지 PDF, 공략집 PDF(선생님·학생), 지도안용 설명서 docx, 소개 영상 2편이 완성돼 있다(10장).

---

## 2. 새 컴퓨터 준비 체크리스트 (Windows 기준)

### 2.1 설치

| 할 일 | 버전·명령(예) | 쓰는 곳 |
|---|---|---|
| [ ] Node.js | **24**(`.nvmrc` = `24`, `package.json` engines `>=22.12.0`). npm은 Node에 포함. 서버의 중계 서버만 돌릴 때는 Node 20 이상 | 모든 개발 명령 |
| [ ] Git | `winget install Git.Git` (Git Bash 포함 — `codex.sh` 실행에 필요) | 저장소 |
| [ ] GitHub CLI | `winget install GitHub.cli` → `gh auth login`(UP-HAN 계정) | 공개·비공개 저장소 clone·push |
| [ ] Python 3 + 패키지 | `pip install pymupdf numpy scipy` | pymupdf = 학습지·공략집 PDF 글자 검사, numpy·scipy = 모션 도구(`beats.py`, `mix.py`) |
| [ ] ffmpeg | `winget install Gyan.FFmpeg` (사용자 PATH 등록 확인: `ffmpeg -version`) | 영상 렌더·검사 |
| [ ] Chrome | `winget install Google.Chrome` | 모션 렌더(puppeteer-core가 설치된 Chrome을 씀) |
| [ ] Playwright 브라우저 | 저장소에서 `npx playwright install chromium` | e2e, 리허설, 학습지·공략집 PDF, `size:report` |
| [ ] LibreOffice (선택) | `winget install TheDocumentFoundation.LibreOffice` | 지도안용 docx를 열어 확인·PDF 변환 |
| [ ] Codex CLI | 설치(예: `npm i -g @openai/codex`) 후 **로그인 필요**(`codex login`) | 이미지·영상 작업(`codex.sh`) |
| [ ] Claude Code | 데스크톱 앱 또는 CLI(공식 설치 안내 따름), 로그인 | 오케스트레이터 |

### 2.2 저장소 받기와 첫 확인

```bash
# 1) 공개 저장소
gh repo clone UP-HAN/voyage-trade-king "<작업 폴더>/대항해무역시대"
cd "<작업 폴더>/대항해무역시대"

# 2) 의존성 (웹앱 + server/ workspaces 한 번에)
npm install
npx playwright install chromium

# 3) 첫 확인
npm run typecheck        # 타입 검사(웹 + 서버)
npm run check:data       # 오류 0이면 됨(경고 12 = L3·L4 'TODO' 본문, 정상)
npm test                 # 2026-10-19 기준 83파일 1130개 통과
npm run build            # dist/ 생성
npm run build:server     # server/dist/ 생성
npm run dev              # http://localhost:5173/ — 교사 화면 #/teacher, 학생 #/play, TV #/screen
```

- [ ] `npm run dev`를 열고 `http://localhost:5173/?sync=local#/teacher`에서 판 설정까지 가 본다. 1차시·2차시는 고를 수 있고 3·4차시·단원 한 판은 "준비 중"이면 정상.
- [ ] 비공개 저장소에 교과서 원문(`docs/source/`)이 없으면 원문 대조 시험은 건너뛴다(공개 저장소 CI도 같은 방식). 복원하면 함께 돈다.

### 2.3 비공개 작업 저장소 복원
```bash
gh repo clone UP-HAN/voyage-trade-king-workspace "<작업 폴더>/voyage-trade-king-workspace"
```
- [ ] 그 저장소의 **`RESTORE.md`를 처음부터 끝까지 따른다.** 그 안에 다음이 있다.
  - 전역 설정 `~/.claude/` 복원: `CLAUDE.md`(오케스트레이션 규칙), `agents/`(planner·implementer·motion-designer·verifier), `orch/`(`codex.sh`, `codex-rules.md`, `brief-template.md`), `tools/motion/`(복원 뒤 그 폴더에서 `npm install` — puppeteer-core)
  - 프로젝트 비공개 파일을 이 저장소 폴더에 되돌려 놓기: `CLAUDE.md`, `.claude/launch.json`, `.orch/`, `media/`, `docs/source/`, 교과서 PDF, `deploy/install-lab-ches.sh`, `deploy/redeploy-lab-ches.sh` (모두 `.gitignore`에 있어 공개 저장소에는 없다)
  - 서버 접속(SSH 설정·키·서버 별칭), `~/.voyage-deploy.json`, git 사용자 설정
- [ ] 복원 확인: 저장소 루트에 `CLAUDE.md`, `.orch/STATUS.md`, `.orch/viewer.html`, `deploy/redeploy-lab-ches.sh`가 보인다.

### 2.4 꼭 알아야 할 환경 주의
- **한글·공백 경로 문제**: 이 폴더처럼 경로에 한글·공백이 있으면 **Node 24의 `fs.rmSync`, `fs.cpSync`가 오류 메시지 없이 프로세스를 죽인다**(0xC0000409, 작업 101에서 확인). 새 코드에서도 쓰지 말고 `fs.promises.rm`, `fs.copyFileSync`(+ 직접 순회)를 쓴다. `vite.config.ts`가 이 때문에 `emptyOutDir: false`로 하고 직접 지운다.
- **포트 8765 = 작업 뷰어 전용**(`.orch/viewer.html`). dev·preview·테스트 서버는 다른 포트를 쓰고 끝나면 정리한다. 테스트가 쓰는 포트: 4173(기본 e2e), 4319(e2e-preview), 5199·8799(teacher), 5288(screen), 5401·5402, 5173(dev).
- `npm run guide:build`는 촬영용 정적 서버를 `127.0.0.1:80`에 띄운다(실패하면 빈 포트로 바꾸고 경고). 80번을 다른 프로그램이 쓰고 있으면 화면 주소가 실제 주소처럼 보이지 않을 수 있다.
- `assets/images/`는 Codex 이미지 산출물이다. 코드 작업에서 옮기거나 고치지 않는다. 이름이 `_`로 시작하는 폴더(`_candidates`, `_check`)는 빌드에서 빠지고 저장소에도 올리지 않는다.
- **공개 저장소에서 `git add -A`를 하지 않는다.** `media/`(영상 작업 폴더)는 공개 저장소의 `.gitignore`에 `media/out/`만 들어 있어서, 통째로 더하면 영상 소스가 공개 저장소에 들어간다. 파일을 골라서 더한다.

---

## 3. 폴더 구조와 역할

| 폴더 | 역할 | 저장소 |
|---|---|---|
| `src/main.tsx`, `src/route.ts` | 해시 라우터: `#/` 타이틀, `#/play` 학생, `#/teacher` 교사, `#/screen` TV | 공개 |
| `src/core/` | 규칙 엔진. `host.ts`의 `hostReduce`(호스트가 모든 회사 계산), `schedule.ts`의 `buildSchedule`(자동 배치), `trade.ts`, `voyage.ts`, `market.ts`, `progress.ts`(임무), `aggregate.ts`(세관 게시판 등 학급 집계), `worksheet-helpers.ts`, `clock.ts`, `scoring.ts` 등 | 공개 |
| `src/data/` | 게임 데이터: 상품·항구·항로·시장·레시피·사건(`events.ts`)·편지·학습지(`worksheet.ts`)·임무·도감·금칙어, `schedule.ts`(배치 상수와 **`LESSON_READY` 플래그**) | 공개 |
| `src/student/` | 학생 화면(입장, HUD, 해도, 항구·시장·공장 탭, 사건·학습지·편지 층, 도감, 항해 기록장) | 공개 |
| `src/teacher/` | 교사 화면(시작 화면, 판 설정, 대시보드, '지금 할 일' 카드 `now-card.ts`/`NowCard.tsx`, 학생 표, 학습지·공략집 PDF 메뉴) | 공개 |
| `src/screen/` | 공용 화면(TV) 장면들(`scenes/`), `model.ts` | 공개 |
| `src/sync/` | 전송 계층: memory/local/relay 어댑터, 호스트·학생 세션(`host-session.ts`, `peer-session.ts`), `screen-bridge.ts`, 회사 이름 검사 | 공개 |
| `src/ui/common/` | 공통 부품(이용 안내 하단 줄 `ServiceFooter`, 서버 방 수 표시, 이미지 `asset.ts`) | 공개 |
| `src/minigames/` | 벽란도 시장, 두 섬 이야기 | 공개 |
| `src/title/`, `src/config/`, `src/styles/` | 타이틀, 중계 주소 계산, 스타일·글꼴 | 공개 |
| `shared/` | 브라우저·중계 서버 공용(`protocol.ts`, `relay-core.ts` — 방 코드·격리·상한) | 공개 |
| `server/` | 저장 없는 WebSocket 중계 서버(Node, `ws` 하나), `/health`·`/notice`, 부하 테스트 `server/scripts/loadtest.ts` | 공개 |
| `scripts/` | 데이터 검사, 배포(`deploy.mjs`), 리허설, 학습지 PDF, 공략집(`guide/`), 이미지 사본 Vite 플러그인, 용량 보고 | 공개 |
| `tests/` | Vitest 단위·시뮬레이션 테스트, Playwright 설정들, 리허설 도구(`tests/rehearsal/`) | 공개 |
| `e2e/` | Playwright e2e 시나리오(`lesson1-full`, `lesson2-full`, `teacher-first-time` 등) | 공개 |
| `print/worksheet/` | 학습지 HTML·디자인 시스템(`DESIGN.md`) | 공개 |
| `print/guide/` | 공략집 글(`content.mjs`)·스타일 | 공개 |
| `print/dist/` | **완성 PDF**(학습지·공략집) — 빌드 때 `dist/print/`로 영문 이름 복사 | 공개 |
| `deploy/` | 서버 설치 틀(nginx 조각, systemd, pm2, env·공지·config 예시). `install-lab-ches.sh`, `redeploy-lab-ches.sh`는 이 서버 전용이라 **비공개** | 공개(전용 스크립트 2개 비공개) |
| `docs/` | 기획 문서(planner 소유), 지도안용 docx. `docs/source/`(교과서 원문)는 **비공개** | 공개(source 비공개) |
| `assets/images/` | Codex 생성 그림(**수정 금지**) | 공개 |
| `media/` | 소개 영상 작업(`media/video/{common,teacher,student}`)과 결과(`media/out/`) | **비공개 저장소** |
| `.orch/` | 오케스트레이션 기록(STATUS, PROGRESS, tasks/<id>/brief·result·review·feedback, viewer.html) | **비공개 저장소** |
| `tmp/`, `.cache/`, `dist/`, `.tmp-deploy/` | 리허설 보고서·검증 산출물, 이미지 사본 캐시, 빌드 결과, 배포 묶음 | 저장소 밖(다시 만들 수 있음. `tmp/` 보관 여부는 RESTORE.md) |

---

## 4. 자주 쓰는 명령

시간은 작업 기록에 실제로 남은 값이다. 기록이 없는 것은 "기록 없음"으로 적었다(컴퓨터 성능에 따라 다르다).

| 명령 | 하는 일 | 걸리는 시간 |
|---|---|---|
| `npm run dev` | 개발 서버 `http://localhost:5173/`. 기본 동기화 = `local`(같은 브라우저 여러 탭) | 몇 초 |
| `npm run build` | 타입 검사 + 웹앱 빌드 → `dist/`(그림 WebP·AVIF 사본, 학습지·공략집 PDF 복사 포함). 빌드본 기본 동기화 = `relay` | 기록 없음(그림 사본은 `.cache/images`에 캐시) |
| `npm run preview` | 빌드 결과 `http://localhost:4173/` | 몇 초 |
| `npm run build:server` | 중계 서버 → `server/dist/` | 짧음 |
| `npm test` | Vitest 단위 테스트 전부(웹·shared·server·스크립트) | 기록 없음 |
| `npm run test:sim` | `tests/sim` 시뮬레이션만 | 기록 없음 |
| `npm run typecheck` | 웹 + 서버 타입 검사 | 짧음 |
| `npm run check:data` | 게임 데이터 검사(쪽수·ID). 지금 오류 0·경고 12(L3·L4 TODO) | 짧음 |
| `npm run e2e` | Playwright 기본 설정(포트 4173, 빌드 후 preview) | lesson1-full 프로젝트만 약 8분 |
| `npm run e2e:l1` | 1차시 한 판 전체 e2e(`tests/lesson1-full.playwright.config.ts`) | 기록 없음 |
| `npm run e2e:all` | 4개 설정을 `&&`로 차례로: 기본 → `tests/e2e-preview.playwright.config.ts`(1차시 사건·미니게임·학습지·편지·항구·라운드 시작·처음 쓰는 교사·**2차시 15/25/30분**) → `tests/teacher/playwright.config.ts` → `tests/screen/playwright.config.ts` | e2e-preview만 약 16분. 전체는 수십 분. 앞 설정이 실패하면 뒤가 안 돈다 → 실패하면 설정별로 따로 돌린다 |
| `npm run rehearsal` | 가상 학생 25명(브라우저 4 + 봇 21) 리허설, 시나리오 **a~f 전부**. 결과 `tmp/rehearsal/<시각>/report.md`(맨 위 "막힘 n / 문제 n") | a~e 기준 약 14분(빌드 포함) |
| `npm run rehearsal -- --scenario f` | 하나만(쉼표로 여러 개). `--no-build`, `--realtime`(실제 시간, a ≈ 12분), `--break …`(탐지기 점검) | 기록 없음 |
| `npm run worksheet:pdf` | 학습지 PDF 다시 만들기(Playwright Chromium). 규칙 검사 통과 때만 `print/dist/` 교체 | 기록 없음 |
| `npm run guide:build` | 공략집 PDF: 빌드 → 실제 1차시 한 판 촬영 → 빨간 상자 → PDF → 검사 통과 때만 `print/dist/` 교체 → 다시 빌드. `--no-build`, `--no-capture`(글만 고칠 때) | 약 6분(촬영 약 3.6분) |
| `npm run size:report` | 빌드 2개 후 첫 화면 용량 측정(예산: 타이틀 1MB, 학생 해도까지 3MB, 교사 시작 화면까지 3MB) | 기록 없음 |
| `npm run loadtest` | 중계 서버 부하 테스트(`server/scripts/loadtest.ts`) | 기록 없음 |
| `npm run deploy` | 배포 **미리 보기(dry-run)** — 아무것도 바꾸지 않음. `--execute`, `--static-only`, `--relay-only`, `--pack-only`, `--force`, `--allow-school-hours`, `--help` | 미리 보기는 검사·빌드 시간만큼 |
| `npm run build:land` | 해도 육지 SVG 경로 다시 만들기(거의 안 씀) | — |

리허설 시나리오:

| ID | 내용 |
|---|---|
| a | 차시 L1 10분 자동 |
| b | 차시 L1 25분 자동(일시정지·연장·라운드 끝·입장 마감) |
| c | 단원 한 판 25분 자동(사건 마감·다른 기기 허락) — '준비 중'이라 개발 열쇠 `localStorage['voyage.dev.fullUnit']='1'`로 교사 브라우저에서만 엶 |
| d | 차시 L1 15분 수동 진행([발동]) |
| e | 혼란 상황 L1 10분(교사 새로 고침·서버 재시작·늦은 입장·끊김) |
| f | 차시 2차시 25분 자동(늦은 입장·새로 고침·라운드 끝) |

- 운영 서버 점검용 `--target https://lab.ches.es.kr/voyage/ --scenario a`는 **교사 승인 범위에서만**, 시나리오 a만 된다.
- 주소 매개변수: `?sync=local`(서버 없이 여러 탭), `?sync=memory`(테스트용), `?relay=wss://…/ws`(중계 주소 지정).

---

## 5. 아키텍처 요약

- **호스트 권위**: 게임의 진짜 상태는 **교사 브라우저(호스트)**에만 있다. 학생 행동은 호스트로 가고, 호스트가 `src/core/host.ts`의 `hostReduce`로 모든 학생 회사를 계산해 공개 상태·개인 상태를 돌려보낸다. 학생 화면은 결과를 미리 보여 주고(predict) 호스트 응답(ack)으로 맞춘다.
- **중계 서버**(`server/`): 메시지를 전달만 하고 **아무것도 저장하지 않는다**(디스크·DB 없음, 방은 메모리에만). `/health`(방 수·상한·공지 단계), `/notice`(공지 파일), SIGHUP(`systemctl reload`)으로 공지만 다시 읽기.
- **방 코드**: 6자리. 방 격리·무작위 대입 방지·상한(`shared/relay-core.ts`). 같은 IP당 동시 방 10.
- **세션**: 학생 좌석 ↔ 기기 토큰(자동 재입장), 다른 기기는 교사 허락. 교사 브라우저 localStorage에 스냅숏을 두고 새로 고침·서버 재시작에서 복구. 기록은 24시간 뒤 자동 삭제.
- **식별**: 화면에 보이는 이름 = 회사 이름. **출석번호는 교사 화면에만**(공개 상태·TV에는 `pid`만).
- **공용 화면(TV)**: `#/screen`. 교사(호스트) 탭에서 연 창으로 `screen-bridge`를 통해 상태를 받는다. 방 코드·QR·사건 카드·해도·순위판·세관 게시판 등.
- **판 단위**: 방을 열 때 "차시마다 한 판"(1~4차시 중 하나) 또는 "단원 전체 한 판"을 고른다. 하루 한 판, 다음 날 이어 하지 않는다.
- **기능 플래그 `LESSON_READY`**(`src/data/schedule.ts`): 차시별 준비 여부. 지금 1·2차시만 true. 3·4차시를 완성하면 true로 바꾸고, 넷 다 true면 단원 한 판이 저절로 열린다.
- **자동 배치(schedule)**: 교사가 무역 시간 T(10/15/20/25/30/40분 등)를 고르면 `buildSchedule`이 구간·사건·라운드·"잠깐!" 학습지·편지를 배치한다(PRD 4장 — 채우는 순서 사다리, 라운드 최소 90초, 핵심 체험 = 두 섬·학급 스마트폰·벽란도). 기본 진행은 **거의 자동**(정해진 시각에 저절로 넘어감), 교사는 '지금 할 일' 카드의 큰 버튼과 [잠깐 멈춤]만 쓰면 된다.
- **학습지 팝업 ↔ 종이 번호 1:1**: 게임의 "잠깐! ③"은 종이 학습지 '항해 일지'의 ③과 번호·내용·쪽수가 같다(①~⑳ = W01~W20, `docs/worksheet.md` 2장 대응표). ③·⑭의 ★ 칸은 체험 직후 40초 '지금 쓰기'. 종이에만 있는 '항해 퀴즈'(②③④⑥⑩⑮)는 게임이 다루지 않는다.
- **그림**: 빌드 때 `assets/images/**.png`의 WebP·AVIF·크기별 사본을 만든다(`scripts/vite-image-variants`, 캐시 `.cache/images`). 목록에 없는 그림은 요청하지 않고 대체 표시로 간다.
- **배포 형태**: 상대 경로 빌드(`base: './'`) → 어느 하위 경로에서나 동작. nginx가 `/voyage/` 정적 파일을 주고 `/voyage/ws`·`/voyage/health`·`/voyage/notice`를 서버 안 `127.0.0.1:8787`의 중계 서버(systemd `voyage-relay`)로 넘긴다.

---

## 6. 배포·운영

### 6.1 운영 정보
| 항목 | 값 |
|---|---|
| 게임 주소 | `https://lab.ches.es.kr/voyage/` |
| 상태 확인 | `https://lab.ches.es.kr/voyage/health` (`rooms`/`maxRooms`/`acceptingNewRooms`/`notice` 등) |
| 서버 | 교사 개인 서버(AWS Lightsail 서울, nginx). 같은 서버에 교사의 다른 앱도 있다 — **건드리지 않는다** |
| 서버 사양 | **2GB로 변경(2026-10-19)**. 그 전에는 1GB(2026-10-09 점검 결과는 `docs/server-setup.md` 1.3.2) |
| 동시 방 상한 | **지금 30**(`MAX_ROOMS=30`, 결정 32 — 1GB 시절 값). **2GB가 됐으니 50으로 올릴지 교사 결정 대기**(9장 열린 질문) |
| 서버 위치 | 정적 `/var/www/voyage/{releases,current}`, 중계 `/opt/voyage-relay/{releases,current}`, 설정 `/etc/voyage-relay.env`, 공지 `/etc/voyage-relay.notice.json` |
| 정적 설정 | `/var/www/voyage/current/config.json` — `serverInfo`(운영자·문의·저장소 주소), `serviceNotice`, `display.titleRoomCount`. 비밀값 아님. 예시 `deploy/config.example.json`. 배포 때 이전 release에서 복사해 보존 |
| 접속 정보 | 서버 별칭·키·계정 = **비공개 저장소 RESTORE.md** |

### 6.2 지금 쓰는 배포 방법 (redeploy 스크립트)
1. **승인**: 서버 접속·배포는 **교사 승인 뒤에만**. **수업 시간(평일 08:30~16:30)에는 배포하지 않는다.**
2. 로컬 검사: `npm run check:data && npm test && npm run build && npm run build:server` (큰 변경이면 `npm run rehearsal`도).
3. 묶기(실제로 쓴 명령 — Git Bash, 프로젝트 폴더):
   ```bash
   mkdir -p tmp/deploy
   tar -czf tmp/deploy/relay.tgz -C server dist package.json
   tar -czf tmp/deploy/web.tgz -C dist .
   ```
4. 올리기: `scp tmp/deploy/relay.tgz tmp/deploy/web.tgz deploy/redeploy-lab-ches.sh <서버 별칭>:/tmp/` — config.json(문의·저장소 주소)을 바꿀 때만 `scp tmp/deploy/config.json <서버 별칭>:/tmp/voyage-config.json`도 (스크립트가 있으면 새 release에 넣는다). 서버 별칭은 RESTORE.md.
5. 실행: `ssh <서버 별칭> "bash /tmp/redeploy-lab-ches.sh"`
   - 게임 화면을 새 release로 바꾼다(config.json 보존).
   - **열린 방이 0일 때만** 중계 서버도 새 release로 바꾸고 재시작한다. 방이 있거나 상태를 못 읽으면 중계 서버는 그대로 둔다.
   - 새 중계 서버가 15초 안에 안 뜨면 둘 다 이전 release로 되돌린다.
   - nginx에 `.avif` 형식이 없으면 조각에 한 줄 넣고 `nginx -t` 통과 때만 reload.
   - 끝에 주소별 응답 코드·`/health`를 찍고, **되돌리기 명령을 출력**한다. release는 최근 5개만 남긴다.
6. 확인: `/health` ok, 게임 주소에서 [연결 테스트], 필요하면 운영 리허설 `npm run rehearsal -- --target https://lab.ches.es.kr/voyage/ --scenario a`(승인 범위).

> 다른 방법: 공개 스크립트 `npm run deploy -- --execute`도 같은 구조(releases/current, 수업 시간 거부, 열린 방 있으면 중계 재시작 거부, 실패 시 되돌림)로 동작한다. 접속 정보 파일 `~/.voyage-deploy.json`이 필요하다(RESTORE.md). 지금까지 실제 운영 배포는 redeploy 스크립트로 했다.

### 6.3 롤백
- redeploy 스크립트가 마지막에 출력한 명령을 그대로 쓴다. 형태:
  - 게임 화면: `sudo ln -sfn <이전 release 경로> /var/www/voyage/current`
  - 중계 서버: `sudo ln -sfn <이전 release 경로> /opt/voyage-relay/current && sudo systemctl restart voyage-relay` (열린 방이 없을 때)
- 게임만 안 되면 `sudo systemctl stop voyage-relay` 후 조사. nginx 문제는 `docs/server-setup.md` 1.7 표.

### 6.4 상한 바꾸기·공지·점검
- 상한을 50으로 올릴 때(교사 결정 뒤): `/etc/voyage-relay.env`의 `MAX_ROOMS=50`, `MAX_CONN=2300`, `NODE_OPTIONS=--max-old-space-size=256`, systemd `MemoryMax=384M`(2GB 줄, `docs/server-setup.md` 1.3.1·`deploy/systemd/voyage-relay.service` 주석 표) → **열린 방이 0일 때** 재시작. 화면의 "사용 중인 방 n/상한"은 `/health`를 따라 저절로 바뀐다(재배포 불필요).
  - nginx 용량: `deploy/nginx/capacity.md` 기준은 `worker_connections 6144`·`worker_rlimit_nofile 12288`이다. 첫 설치 스크립트 주석에는 4096/8192로 넣었다고 되어 있다 → 50으로 올릴 때 지금 값을 확인하고 필요하면 별도 승인으로 올린다.
- 공지·점검 절차: `README.md` '공지·점검', `docs/server-setup.md` 2.4·2.5(공지 → 새 방 막기 → 방 0 → 재시작 → 공지 삭제).

---

## 7. 오케스트레이션 방식

### 7.1 역할
| 역할 | brief 담당 표기 | 누가 | 호출 |
|---|---|---|---|
| 기획(명세·작업 쪼개기) | `planner` | Opus | planner 서브에이전트 |
| 구현(코드·테스트) | `opus-impl` | Opus | implementer 서브에이전트 |
| 모션그래픽(코드 애니메이션, HTML→mp4) | `motion-designer` | Opus | motion-designer 서브에이전트 |
| 검증(review.md) | — | Opus | verifier 서브에이전트 |
| 일러스트 | `codex-image` | Codex | `bash ~/.claude/orch/codex.sh image <id>` |
| 영상 생성·편집 | `codex-video` | Codex | `bash ~/.claude/orch/codex.sh video <id>` |
| 이미지·영상 수정 | — | Codex(같은 세션) | `bash ~/.claude/orch/codex.sh fix <id>` |

- 메인 세션(Claude Code)은 오케스트레이터다. 규칙 전문은 전역 `~/.claude/CLAUDE.md`(비공개 저장소에서 복원).
- `codex.sh`는 **프로젝트 루트에서** Git Bash로 실행한다. 수 분 걸리므로 백그라운드로 돌린다. 결과는 `result.md` 먼저, 필요할 때만 `codex.log`.
- 알려진 문제: `codex.sh`의 `-o`가 Codex 상세 보고를 마지막 요약으로 덮을 수 있다 → codex.log에서 마지막 `+++ b/.orch/tasks/<id>/result.md` 아래 `+` 줄로 복원, feedback에 "최종 응답에 result.md 전체를 쓰라"를 넣는다.

### 7.2 표준 흐름
1. planner가 `docs/`에 명세, `.orch/tasks/<NNN-영문-설명>/brief.md`에 지시서(양식 `~/.claude/orch/brief-template.md`).
2. 담당에게 위임. 같은 파일을 건드리는 작업은 직렬, 아니면 병렬.
3. 끝난 작업마다 verifier가 `review.md`(PASS/FAIL).
4. FAIL이면 지적을 `feedback.md`로 옮겨 원래 담당에게 수정. **최대 3회**, 그래도 실패면 교사에게 보고.
5. 모두 PASS면 `.orch/STATUS.md` 갱신 → 교사에게 요약.

### 7.3 `.orch/` 규칙
- `STATUS.md`: 진행 현황 표(ID | 제목 | 담당 | 상태 | 비고)와 오케스트레이터 메모. `PROGRESS.md`: 지금 진행 중인 큰 목표(현재는 2차시 공개수업 준비) 한 화면 요약.
- `tasks/<id>/`: `brief.md`, `result.md`, `review.md`, `feedback.md`(+ Codex는 `codex.log`, `session.txt`, `final-message.md`).
- `.orch/`는 공개 저장소에 올리지 않는다(비공개 저장소로 동기화).

### 7.4 작업 뷰어
- `.claude/launch.json`의 `orch-viewer` 구성 = 저장소 루트에서 `python -m http.server 8765 --bind 127.0.0.1`.
- 브라우저: `http://127.0.0.1:8765/.orch/viewer.html` — '2차시 진행'(PROGRESS.md), '진행 현황'(STATUS.md), '전체 이미지', 작업별 result·review를 보여 준다. 20초마다 새로 고침.

### 7.5 자동 이어하기
- 사용량 한도(5시간)에 걸려도 이어 가도록 **세션 안 예약 작업(cron, 매시 17분 확인)**을 걸어 두었다. 이 예약은 그 세션에만 붙어 있으므로 **새 컴퓨터·새 세션에서는 다시 걸어야 한다**(교사가 원할 때).

### 7.6 리허설 규칙
- 큰 변경 뒤에는 `npm run rehearsal`로 가상 학생 25명 흐름을 끝까지 돌리고, 보고서 맨 위 "막힘 0 / 문제 0"을 확인한다. 2차시를 건드리면 최소 `--scenario f`, 1차시 회귀는 `a`.
- e2e는 동시에 다른 무거운 작업(영상 렌더 등)과 함께 돌리면 시간 초과로 흔들린다. 실패하면 설정별·단독으로 다시 돌려 앱 문제인지 가린다.
- 운영 서버 대상 리허설은 교사 승인 범위에서 시나리오 a만.

---

## 8. 교사 결정 기록 요약 (PRD 16.1, 날짜순)

| 날짜 | 결정 | 번호 |
|---|---|---|
| 2026-10-08 | 학생 1명 = 회사 1개(20~30명), 교사 PC 대시보드 + TV 공용 화면(전자칠판 없음), 방 코드 실시간 방이 기본, 순위 공개 상위 N명(0/3/4/5), 게임 이름 「대항해 무역왕」, 학습지 4차시 구조 + "잠깐!" 팝업 번호 1:1, 편지·갈매기 퀴즈 | 1~11, 추가 |
| 2026-10-08 | Firebase·DB 쓰지 않음 → 교사 서버 `lab.ches.es.kr/voyage` + 저장 없는 중계, 호스트 = 교사 브라우저, 6자리 방 코드, GitHub 공개(Pages 안 씀), 무역 시간 T를 교사가 정하고 자동 배치, 돌발 사건, 역전 장치 | 12~19 |
| 2026-10-08 | 역할 분담: 기획·코드·모션·검증 = Opus, 이미지·영상 = Codex | (STATUS) |
| 2026-10-09 | **판 단위**: 차시마다 한 판 / 단원 전체 한 판 — 둘 다 1등급, 방 만들 때 고름 | 20 |
| 2026-10-09 | 다른 교사에게 서버 공개(교사 커뮤니티), 입장 = 출석번호 + 회사 이름(실명 안 받음, 출석번호는 교사 화면에만) | 21, 22, 25 |
| 2026-10-09 | 코드 기본 동시 방 상한 50, IP당 10, "사용 중인 방 n/상한" 표시 | 23, 24 |
| 2026-10-09 | 짧은 판 = 체험 우선 + ③★·⑭★ '지금 쓰기'(40초), 핵심 체험 = 두 섬·학급 스마트폰·벽란도, 실명 같은 회사 이름은 경고만, 타이틀에서 방 수 숨김, 학습지 A4 단면(⑥ = p.101, 104) | 26~31 |
| 2026-10-10 | **lab.ches.es.kr 서버 상한 30**(그때 1GB). 코드 기본값 50은 유지 | 32 |
| 2026-10-10 | 교사 화면 = **'지금 할 일' 큰 카드**, 쉬운 말, 고급 기능은 접어 둠, 학습지 PDF를 교사 화면에서 바로 열기 | 33 |
| 2026-10-10 | 진행 기본 = **거의 자동**. 마무리는 **첫 항목만 자동**, 나머지는 [다음으로] | 34, 16.2-20 |
| 2026-10-10 | 교사용 예시 답 PDF도 서버에 함께 올림(링크는 교사 화면에만) | 16.2-21 |
| 2026-10-10 | **학습지 규칙**: 활동 1개 = A4 1쪽, 메모 칸 대신 종이 전용 '항해 퀴즈', 예전 '(선택)' 문항 → 모두 필수 **'체크!'**, 학생용에 **'선택' 낱말 금지**(⑲⑳ = '특별 항해') | worksheet v1.2 |
| 2026-10-10 | 리허설 도구(135)는 fix 1회 반영 상태로 마무리, 나머지는 실제 수업에서 확인 | (STATUS) |
| 2026-10-18 | **저작권 줄 `Copyright 2026. hanuipyo`**, **문의 = GitHub 저장소**(github.com/UP-HAN/voyage-trade-king, 글자만). SNS 아이디·이메일 표기는 어디에도 두지 않음 | 35 |
| 2026-10-19 | 2차시 판은 원유 2상자(담맘)를 싣고 시작(오케스트레이터 결정, 검증자 "수용 가능") | (115) |
| 2026-10-19 | 서버 2GB로 변경. 상한 50으로 올릴지는 대기 | (운영) |

라이선스(README): 코드 MIT © 2026 hanuipyo, 그림·문서·학습지 CC BY-NC 4.0, 글꼴 OFL 1.1.

---

## 9. 남은 일·백로그 (우선순위 순)

### 9.1 바로 (공개수업 10/22 전후)
1. **2차시 공개수업 지원**: 21일 교사 직접 플레이 → 고칠 것 수정 → 수업 시간 밖에 재배포(6.2). 수정 뒤 `npm run rehearsal -- --scenario f`(+ a)로 회귀 확인.
2. **교사 결정 대기**: 서버 동시 방 상한 30 → 50(2GB가 됐으므로). 정하면 6.4 절차.
3. 115 검증의 남은 참고(판정 영향 없음, 작게 고칠 거리):
   - 판 설정의 2차시 짧은 판 안내 문구가 처음 화물 도입 전 기준이라 낡음(`src/teacher/SetupScreen.tsx`).
   - 임무 1단계("…사서 부산에 가져와요 [수입]")가 생산 때에야 체크됨 → 처음 화물이 있으면 처음부터 체크하거나 문구 보강.
   - 1366×768 학생 화면에서 임무 패널의 처음 화물 안내가 스크롤 아래에 있음.
   - 아무것도 안 한 학생의 ⑥에도 "원유 수입(담맘) → 아직 생산 전"이 나옴.
   - 처음 화물 안내 한 줄을 공략집·교사 카드 팁에 넣기.

### 9.2 다음 큰 일: 3·4차시와 단원 한 판 (P1)
| ID | 내용 | 담당 | 선행 | 상태 |
|---|---|---|---|---|
| 116 | 3차시: 광물 협력, 학급 스마트폰 부품 팀·조립장, AI 기술 경쟁, 자동화 항만 투표, 경제 게이지, 투표 공통 UI | opus-impl | 115 | 대기 |
| 117 | 4차시: 1970 철강 투표·회상, 베트남 공장 결정, 관세사 직업 카드 | opus-impl | 116 | 대기 |
| 118 | 마무리: 컨테이너 OX·자기 평가, 결산·시상식, 잡지 표지, 되돌아보기 | opus-impl | 116 | 대기(117과 파일 분리 시 병렬) |
| 012 | 그림: 스마트폰 도면, 광물 협력, AI 경쟁, 자동화 항만, 베트남 공장, 1970년대 부산(세피아) | codex-image | 001 | 대기 |
| 013 | 그림: 차시 표지 4장, 잡지 표지 배경 3종, 컨테이너·트럭 | codex-image | 001 | 대기 |
- 116~118의 brief는 v0.3.1 시점에 쓴 것이다. 그 뒤 '지금 할 일' 카드(137), n차시 표기·`LESSON_READY`·처음 화물(115) 등이 생겼으므로 **시작 전에 planner가 brief를 현재 코드에 맞게 고친다**. 115 방식(차시 단독 판, 사건 본문 TODO 채우기, 공용 화면 장면, e2e `lessonN-full`, 리허설 시나리오 추가, 학습지 ⑨~⑱ 매칭 표)을 따른다.
- 3·4차시가 끝나면 `LESSON_READY`의 L3·L4를 true로 → 단원 한 판이 열린다(리허설 c를 개발 열쇠 없이 돌릴 수 있게 됨).
- `check:data` 경고 12(L3·L4 사건 본문 TODO)가 여기서 없어져야 한다. STATUS 메모: L4-E7(결산·시상)·L4-E9(되돌아보기) 본문과 PRD 6.14.4 되돌아보기 문항 데이터도 확인.

### 9.3 그 뒤 (P1~P2)
| ID | 내용 | 담당 | 상태 |
|---|---|---|---|
| 119 | 조선소(중형·대형 배 구입) | opus-impl | 대기 |
| 125 | 돌발 사건 엔진 | opus-impl | brief 작성됨 |
| 126 | 돌발 사건 화면 | opus-impl | brief 작성됨 |
| 127 | 역전 장치 | opus-impl | brief 작성됨 |
| 120 | 균형 시뮬레이션(1등 고정률 등) | opus-impl | brief 개정(v0.3.1) |
| 201·202 | 항해·입항 연출, 거래 피드백·갈매기 연출 | motion-designer | brief 작성됨(미실행) |
| 203·204 | 수업 연출, 타이틀 다듬기 | motion-designer | 대기 |
| 302 | 학습지 v0.3 사용법 보완(판 단위별 쓰는 법) | planner | brief 미작성 |
| 015 | 그림: 교실·박람회·인도 다리·깃발 문양·선장 5·6 등 | codex-image | 대기(P2) |
| 121 | 선택 활동 | opus-impl | 대기(P2) |
| 122 | 오프라인 대비 | opus-impl | 대기(P2) |
- 권장 순서(STATUS): 125 → 116 → (117 ∥ 118) → 119 → 126 → 127 → 120.

### 9.4 영상·공략집
- **소개 영상 재제작: 보류 — 2차시 공개수업 뒤 다시 결정.** 지금 선생님 영상에는 "지금은 1차시 게임이 열려 있고, 2~4차시는 준비 중이에요" 자막이 있어 2차시 공개 뒤로는 사실과 다르다. 학생 영상 다듬을 거리(줌 위쪽 잘림·동그라미 겹침)는 `.orch/tasks/143-video-student/review.md`.
- 공략집은 1차시 10분 판을 찍은 것이다(2차시 화면 없음). 2차시 내용을 넣으려면 `print/guide/content.mjs`와 `scripts/guide/capture.ts`를 늘린다.
- 영상 소재(`media/video/teacher/prepare.py`)는 `tmp/guide/raw/` 스크린숏을 쓴다. `tmp/`는 저장소 밖이므로, 없으면 `npm run guide:build`로 다시 찍어야 한다(좌표가 달라질 수 있음).
- 렌더 팁(142·143 결과): Chrome 렌더는 한 번에 하나만. 긴 영상은 조각 렌더(`media/video/common/render_seg.mjs`, `media/video/student/render-chunks.mjs`)가 안전하다.

### 9.5 리허설 도구 한계 (135, 알려진 것)
- 화면 전체를 덮는 투명 층이 카드·결정 단계부터 덮으면 놓칠 수 있다(`hasTask`가 보이는지만 봄). 버튼 disabled 고정·클릭 삼킴·층 깜박임은 못 잡는다. 손볼 때: `hasTask`를 `elementFromPoint` 기준으로, "최근 60초 중 가려진 비율" 기준 추가.
- 빠른 시계(8배)에서 편지 버튼 클릭 실패 오탐이 있었다.
- 서버 재시작 직후 재접속이 몰리면 학생이 `RATE_LIMITED`에 걸릴 수 있다(시나리오 e) — 실제 교실에서 문제인지 검토 필요.

### 9.6 알려진 참고 사항 (진행을 막지 않음)
- 공략집 촬영 때 TV 연결 판정이 어긋난 적이 있다("TV 화면 창이 열려 있지 않아요") — 실제 앱에서 재현되는지 확인 필요.
- 마무리 '끝나고 쓰기' 학생 목록이 접힌 단추로만 보인다(WorksheetLayer AfterList).
- 공략집 JPEG 품질 88 → 75~80 검토(용량).
- 회사가 2~3개뿐이면 상 배분이 어색하다(무역왕상이 전원에게 먼저 감) — 상 배분 정책 검토.
- 방 가득 참(BUSY) 문구가 중계 코드·PRD·teacher-setup에서 서로 다르다 → 하나로 통일.
- `docs/teacher-setup.md` 0.1 3번은 "동시에 열 수 있는 방 50개"라고 쓰여 있지만 운영 서버는 30이다(화면 숫자는 `/health`를 따르므로 화면은 맞음). 상한 결정 뒤 문서를 맞춘다.
- 교사 화면이 1초마다 상태를 폴링한다(세션에 "뷰 변경 알림"을 넣으면 없앨 수 있음).
- 공용 화면 기기 시계가 크게 바뀌면 결과 장면이 1~2초 깜박일 수 있다.
- 크롬북 실기기 프레임 측정, 터치 끌기 직후 첫 탭 문제는 실제 기기에서 확인 필요.
- e2e `lesson1-full`은 부하가 있으면 시간 경합으로 가끔 실패한다(단독 재실행 시 통과).

### 9.7 PRD 16.2 남은 질문 (교사 답 대기)
1 성취기준 코드 확인 · 2 잡지 표지를 게임/종이 중 무엇으로 · 3 기존 버전에서 아쉬웠던 점 · 5 선장 아바타 4종이면 충분한지 · 9 저장소 공개 범위·라이선스(README에는 이미 MIT / CC BY-NC로 적혀 있음 — PRD 표만 정리 필요) · 10 상한(2GB 후 50) · 11 돌발 사건 기본 빈도·지진·화산 기본 켬 여부 · 14 이전 판 요약 불러오기 필요 여부 · 15 같은 학교 여러 반(IP당 방 10) 기본값 · 16 어느 커뮤니티에 공개할지, 공개 글 연결 방법 · 17 공개 `/health`의 운영 필드 노출 · 18 '지금 쓰기'의 대가 · 19 학습지 인쇄 장 수

---

## 10. 산출물 위치

| 산출물 | 위치 | 저장소 |
|---|---|---|
| 학습지 '항해 일지' 학생용(20쪽) | `print/dist/대항해무역왕_항해일지_학생용.pdf`, 장별 `print/dist/장별/{L1,L2,L3,L4-1,L4-2,선택활동}.pdf` | 공개 |
| 학습지 교사용 예시 답 | `print/dist/대항해무역왕_항해일지_교사용_예시답.pdf` | 공개 |
| 공략집 선생님 편(39쪽)·학생 편(46쪽) | `print/dist/대항해무역왕_공략집_선생님.pdf`, `print/dist/대항해무역왕_공략집_학생.pdf` | 공개 |
| 위 PDF의 서버 사본 | 빌드 때 `dist/print/`(영문 이름, 교사 화면 메뉴·[공략집] 링크) | 빌드 결과 |
| 지도안용 게임 설명서 | `docs/대항해무역왕_게임설명서_지도안용.docx` | 공개 |
| 선생님용 소개 영상(4:01) | `media/out/대항해무역왕_소개영상_선생님.mp4`(+ `_썸네일.png`) | 비공개 저장소 또는 OneDrive(RESTORE.md) |
| 학생용 안내 영상(3:00) | `media/out/대항해무역왕_안내영상_학생.mp4`(+ `_썸네일.png`) | 비공개 저장소 또는 OneDrive(RESTORE.md) |
| 영상 소스 | `media/video/{common,teacher,student}/` | 비공개 저장소 |
| 생성 그림 | `assets/images/` | 공개 |
| 리허설·검증 보고서 | `tmp/rehearsal/<시각>/`, `tmp/verify*/` | 저장소 밖 |

영상 음악: Kevin MacLeod(incompetech.com), CC BY 4.0 — 선생님 편 "Wholesome", 학생 편 "Island Meet and Greet"(엔딩에 출처 표기).

---

## 11. 새 Claude 세션 시작 프롬프트 (붙여 넣기용)

### 11.0 (2026-10-21 밤) 집에서 이어갈 때 — 이것을 붙여 넣는다
```
이 저장소는 「대항해 무역왕」(초6 사회 무역 수업용 웹 게임)이야. 오늘(10-21) 학교 PC에서 작업하다 퇴근해서 집에서 이어 가. 내일 10-22 13:50에 2차시 공개수업(교과서 100~102쪽, 2차시 '앞 시간')이 있어.
1) HANDOFF.md 0장을 먼저 끝까지 읽고, 비공개 저장소 UP-HAN/voyage-trade-king-workspace의 RESTORE.md 0절대로 이 컴퓨터를 맞췄는지 확인해 줘(공개 저장소는 wip/2026-10-21-school 가지, .orch·.claude·CLAUDE.md·media·tmp/video·tmp/deploy 덮어쓰기). 안 됐으면 해 줘(git pull·복사까지는 해도 돼).
2) npm install, npm run typecheck, npm test를 돌려 0.3에 적힌 상태(실패 2개)와 같은지 알려 줘.
3) 그다음 0.4 순서대로 진행해: 159 마무리 → 전체 검증 → (내 승인 받고) 게임 화면만 배포. 오늘 피드백 원문은 .orch/reports/2026-10-21-교사-수업-피드백.md, 오늘 순서 해설 조사는 .orch/reports/2026-10-21-오늘순서-해설-조사.md에 있어.
너는 오케스트레이터이고 이 프로젝트는 CLAUDE.md와 .claude/orch-rules.md의 방식(planner → implementer → verifier, .orch/tasks/<id>/)을 따른다. 쉬운 한국어로 보고해. 서버 접속·배포·git push는 내 승인 없이 하지 마. 배포 서버는 ras-server와 같은 서버라 ras·class·kart 등 다른 앱은 절대 건드리지 마.
```

### 11.1 (2026-10-20) 처음 옮겨 올 때

```
이 저장소는 「대항해 무역왕」(초6 사회 무역 수업용 웹 게임)이고, 다른 컴퓨터에서 옮겨 왔어. 먼저 HANDOFF.md를 끝까지 읽고, 비공개 작업 저장소 UP-HAN/voyage-trade-king-workspace의 RESTORE.md대로 복원이 끝났는지(~/.claude 설정, CLAUDE.md, .orch/, media/, deploy 전용 스크립트) 확인해 줘. 그다음 npm install, npx playwright install chromium, npm run typecheck, npm test, npm run check:data, npm run build를 돌려 결과를 짧게 알려 주고, .orch/STATUS.md와 .orch/PROGRESS.md를 읽어 지금 할 일을 정리해 줘. 너는 오케스트레이터이고 역할 분담·표준 흐름은 ~/.claude/CLAUDE.md를 따른다. 서버 접속·배포·git push는 내 승인 없이 하지 마. 작업 뷰어는 포트 8765(.claude/launch.json의 orch-viewer)로 띄워 주고, 자동 이어하기 예약(매시 17분 확인)은 내가 원한다고 할 때만 다시 걸어 줘.
```
