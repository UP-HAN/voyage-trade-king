# shared/

브라우저(웹앱)와 중계 서버(Node)가 **함께** import 하는 코드. (PRD 10.2)

- DOM 전용 API(`window`, `document`)와 Node 전용 API(`node:*`, `process`)를 쓰지 않는다.
- 웹앱에서는 `@shared/*` 별칭으로 import 한다: `import { PROTOCOL_VERSION } from '@shared/protocol';`
- 중계 서버(`server/src/`)에서는 **상대 경로 + `.js` 확장자**로 import 한다: `import { PROTOCOL_VERSION } from '../../shared/protocol.js';`
  (서버는 `tsc`로만 빌드하는데, `tsc`는 경로 별칭을 바꿔 쓰지 않아 Node 실행 시 `@shared/*`를 찾지 못한다.)
- 같은 이유로 `shared/` 안의 파일끼리도 상대 경로 + `.js` 확장자로 import 한다(`./relay-core.js`). Vite·Vitest는 이를 `.ts`로 찾아 준다.
- 예정 파일: `protocol.ts`(메시지 타입·버전·오류 코드), `relay-core.ts`(방 라우팅 순수 로직).
