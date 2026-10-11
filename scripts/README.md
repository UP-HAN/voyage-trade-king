# scripts/

개발·검사·배포 보조 스크립트.
- `check-data.ts` — `npm run check:data` (데이터 쪽수·ID 검사, 작업 102가 채움)
- `run-ts.mjs` — TypeScript 스크립트를 Vite 모듈 러너로 실행(별칭 `@shared/*` 사용 가능, 추가 의존성 없음)
- `deploy.mjs` — 작업 128
- `build-land.ts` — 세계 육지 SVG 경로 생성(작업 106). `node scripts/run-ts.mjs scripts/build-land.ts [입력.geojson] [출력.ts]` → `src/data/world-land.ts`
- `data-src/ne_110m_land.geojson` — Natural Earth 1:110m Land 원본(퍼블릭 도메인, github.com/nvkelso/natural-earth-vector)
- `guide/` — 공략집(작업 141) `npm run guide:build`: 빌드 → 실제 한 판 촬영(`capture.ts`, Playwright·로컬 중계 서버·봇 3명) → 빨간 상자 그리기(`annotate.mjs`) → 내용(`print/guide/content.mjs`)으로 HTML(`render.mjs`) → 검사 통과 때만 `print/dist/대항해무역왕_공략집_{선생님,학생}.pdf` 교체 → 다시 빌드(`dist/print/guide-*.pdf`, 교사 시작 화면 [공략집] 링크). 옵션 `--no-build`(이미 빌드됨), `--no-capture`(촬영 생략, 글만 고칠 때)
