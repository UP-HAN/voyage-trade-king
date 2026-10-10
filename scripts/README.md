# scripts/

개발·검사·배포 보조 스크립트.
- `check-data.ts` — `npm run check:data` (데이터 쪽수·ID 검사, 작업 102가 채움)
- `run-ts.mjs` — TypeScript 스크립트를 Vite 모듈 러너로 실행(별칭 `@shared/*` 사용 가능, 추가 의존성 없음)
- `deploy.mjs` — 작업 128
- `build-land.ts` — 세계 육지 SVG 경로 생성(작업 106). `node scripts/run-ts.mjs scripts/build-land.ts [입력.geojson] [출력.ts]` → `src/data/world-land.ts`
- `data-src/ne_110m_land.geojson` — Natural Earth 1:110m Land 원본(퍼블릭 도메인, github.com/nvkelso/natural-earth-vector)
