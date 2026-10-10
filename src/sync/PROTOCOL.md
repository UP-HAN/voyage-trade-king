# src/sync 프로토콜 — 세션 계층 (작업 124, PRD v0.3.2 기준)

층 구조

| 층 | 파일 | 하는 일 |
|---|---|---|
| 중계(서버 쪽) | `shared/relay-core.ts`, `server/` | 방 코드·연결·속도 제한. 메시지 **내용을 해석하지 않음** |
| 전송 | `adapter.ts`, `memory.ts`, `local.ts`, `relay.ts` | `HostTransport`/`PeerTransport` — 방 열기·입장·`host.to`/`host.all`/`peer.msg` 전달 |
| **세션(이 문서)** | `host-session.ts`, `peer-session.ts`, `app-messages.ts`, `company-name.ts`, `host-store.ts`, `peer-store.ts`, `screen-bridge.ts`, `throttle.ts` | 좌석(출석번호)·기기 토큰·재접속·행동 확정·상태 보내기·교사 브라우저 저장 |
| 게임 규칙 | `src/core`(작업 103) | 리듀서·predict. 세션은 **주입**받고 import하지 않는다 |

전송 메시지(겉봉 `{v:3, t, …}`)는 104의 `.orch/tasks/104-sync-adapter/result.md` 표가 기준이다. 아래는 그 안에 싣는 **앱 메시지**다.

---

## 1. 앱 메시지

모두 JSON 객체 `{ t: '<종류>', … }`. 타입은 `app-messages.ts`(`PeerToHost`, `HostToPeer`).

### 학생 → 호스트

| 경로 | t | 필드 | 뜻 |
|---|---|---|---|
| `peer.join {hello}` | (hello) | `seat`(1~40), `company`(회사 이름 입력값), `deviceToken`(32자 16진), `appVersion` | 입장 인사. 호스트가 판정(2장) |
| `peer.msg` | `hello` | 위와 같음 | 이미 연결이 들어와 있는 **손님 연결**(허락 대기·거절 뒤)이나 `hello.again`을 받은 연결이 다시 인사 |
| `peer.msg` | `act` | `seq`(1부터, 기기별 증가), `action` | 학생 행동. 호스트가 리듀서로 확정 |
| `peer.msg` | `rejoin.request` | — | 거절된 뒤 [다시 요청] |
| `peer.msg` | `name.set` | `companyName` | 준비 단계(`phase:'prep'`) 또는 이름이 막혔을 때(`nameStatus:'blocked'`)만 받음 |
| `peer.msg` | `sync` | — | 호스트가 돌아옴(`host.status online`) → 최신 상태 요청 |
| `peer.msg` | `state.need` | — | 공개 상태 변경분의 `base`가 맞지 않음 → 전체 요청 |

### 호스트 → 학생

| 경로 | t | 필드 | 뜻 |
|---|---|---|---|
| `host.reject {reason}` | (거절) | `reason` 문자열(3장). `NAME_TAKEN:제안1,제안2` | 입장 거절(연결은 남아 다시 `join` 가능) |
| `host.to` | `admitted` | `seat`, `pid`, `companyName`, `mode: 'new'\|'same-device'\|'approved'`, `lastSeq`, `nameStatus` | 입장 확정. **출석번호가 담기는 메시지는 이것과 `seat.changed`뿐(본인에게만)**. `lastSeq` 다음 번호부터 행동을 보냄 |
| `host.to` | `hello.rejected` | `reason`, `suggestions?` | 손님 연결의 다시 인사가 거절됨 |
| `host.to` | `hello.again` | — | 호스트가 이 연결을 모름(호스트 새로 고침 직후 등) → `hello`를 다시 보내라. 호스트는 **옮겨진 연결**(장부 `movedPeerIds`, 최근 50개)에는 보내지 않고, 학생은 `moved`·`kicked`·`roomClosed`·`codeChanged`이거나 자동 재입장 대상이 아닌 `idle`(거절·허락 거부 뒤)이면 **무시**한다 — 학생이 요청하지 않은 재입장 요청이 생기지 않게 |
| `host.to` | `rejoin.pending` | — | 다른 기기 재입장 요청을 받음 → 교사 허락 대기 |
| `host.to` | `rejoin.denied` | — | 교사가 거절 |
| `host.to` | `ack` | `seq`, `ok`, `error?`, `version`(개인 상태 버전) | 행동 결과. 같은 `seq`가 다시 오면 **같은 ack**(최근 30개 기억) |
| `host.to` | `state.me` | `version`, `seq`(반영된 마지막 행동), `data` | 개인 상태 — **본인 연결로만** |
| `host.to`/`host.all` | `state.public` | `version`, `data` (전체) | 학급 공개 상태 전체 — 입장·이어하기·`state.need` 때 개인으로, 변경분이 더 크면 전체로 |
| `host.all` | `state.public` | `version`, `base`, `patch: {set, del}` | 공개 상태 최상위 키 변경분. `base`가 내 버전과 다르면 `state.need` |
| `host.to` | `moved` | — | 이 번호가 다른 기기로 옮겨짐 → 조작 막힘. 그 뒤 `act`는 `ack{ok:false, error:'MOVED'}` |
| `host.to` | `kicked` | — | 내보내짐(곧 `host.kick`으로 연결도 끊김) |
| `host.to` | `version.mismatch` | `hostVersion` | 앱 버전 다름 → "새로 고침해 주세요"(입장은 허용) |
| `host.to` | `name.blocked` | `reason:'teacher'` | 교사가 이름을 막음 → 새 이름 입력 창 |
| `host.to` | `name.result` | `ok`, `error?`, `suggestions?`, `companyName?` | `name.set` 결과(`NAME_LOCKED` = 무역 중이라 못 바꿈) |
| `host.to` | `name.changed` | `companyName` | 교사가 이름을 바꿈 → 기기 저장값 갱신 |
| `host.to` | `seat.changed` | `seat` | 교사가 번호를 바꿈 → 기기 저장값 갱신 |
| `host.all` | `code.changed` | `newCode` | 방 코드가 바뀜(대부분 학생에게는 닿지 않음 — 공용 화면이 크게 보여 줌, 5장) |
| `host.all` | `host.ending` | — | 판 끝 → 학생 기기는 24시간 보기 전용 뒤 삭제 |
| `host.to` | `multi` | `msgs: HostToPeer[]` | **묶음**: 같은 학생에게 같은 순간 생긴 메시지들(예: `state.me` + `ack`, `admitted` + `state.public` + `state.me`) |

### 보내기 속도·묶음

- 중계 서버는 연결당 **초당 20개(순간 40개)** 를 넘는 메시지를 버린다. 호스트는 모든 명령(`admit`·`reject`·`kick`·`host.to`·`host.all`)을 **보낼 함**(`HostOutbox`)에 순서대로 넣고 초당 18개(순간 36개)로 내보낸다.
- 같은 학생에게 가는 메시지가 아직 못 나갔으면 `multi` 하나로 묶고, 그 안의 옛 `state.me`는 새것으로 바꾼다(최신만 의미). 묶음 하나는 40,000자 이하.
- 학급 공개 상태는 **최대 1초에 1번**, 바뀌지 않았으면 보내지 않는다(`throttle.ts`).
- 30명 입장은 약 1.5초, 30명이 0.1초마다 행동해도 학생마다 묶음 하나씩 차례로 나간다(테스트 `session-join`).

## 2. 입장 판정 순서 (PRD 7.2, v0.3.1)

호스트가 `hello`를 받을 때마다(전송 `peer.hello` 또는 손님 연결의 `hello`):

```
hello 모양 오류(기기 토큰 없음)                    → BAD_HELLO
(0) 이 기기 토큰이 실패 제한 중                      → TOO_MANY_TRIES   (실패로 세지 않음)
(1) 기기 토큰이 내보내기 차단 목록                   → KICKED
(2) 기기 토큰이 어떤 좌석에 묶여 있음                → 그 좌석으로 자동 재입장 'same-device'
                                                     (입력한 번호·이름과 달라도 기기 토큰 우선)
    출석번호가 1~40 정수가 아님                      → BAD_HELLO
(3) 입력한 번호가 빈 좌석
      입장 마감                                     → LOCKED
      validateCompanyName 실패                       → NAME_FORMAT / BAD_NAME / NAME_TAKEN(+제안)
      통과                                          → 새 좌석, 기기 토큰 묶기, pid 발급 → 'new'
(4) 좌석에 회사가 있고 비교 키(nameKey)가 같음      → 손님 연결로 들임 + rejoin.pending
                                                     교사 화면 재접속 요청 {seat, 회사 이름, oldOnline}
                                                     (옛 기기가 접속 중이어도 요청은 받음)
      교사 [허락] approveRejoin → 토큰을 새 기기로, 옛 기기 moved, 새 기기 'approved'
      교사 [거절] denyRejoin   → rejoin.denied (손님 연결 유지, rejoin.request로 다시 요청 가능)
(5) 좌석에 다른 이름의 회사                         → SEAT_TAKEN (그 회사 이름은 보내지 않음)
                                                     교사 '입장 문제' {seat, attempts, lastAt, peerId}
                                                     (이름 없음, 기기 토큰은 교사 화면에 안 보임)
      교사 [이 기기를 7번 회사로 연결] bindDeviceToSeat(peerId, 7)
        → 옛 토큰 해제(옛 기기 moved), 이 기기 토큰을 7번에 묶음 → 학생이 다시 [입장]하면 (2)
```

- **앱 쪽 입장 실패 제한**: 같은 기기 토큰의 거절이 5분 안에 10번이 되면 1분 동안 그 기기의 모든 `hello`에 `TOO_MANY_TRIES`만 답한다(서버 쪽 제한은 IP 기준, 별개).
- **번호 + 이름 일치만으로 자동 복원은 하지 않는다**(옆 친구가 대신 들어가기 방지, PRD 7.3.1). 서버 재시작으로 코드가 바뀐 뒤에도 같은 규칙이다(2)(4).
- 입장 마감은 **세션에서만** 판정한다. 전송 계층 `setLocked`는 쓰지 않는다 — 서버는 잠긴 방의 모든 `peer.join`을 막아 재접속까지 막히기 때문.
- 손님 연결(4)은 전송 계층에서는 들어와 있으므로 공개 상태 브로드캐스트를 받는다(공용 화면과 같은 정보). 개인 상태·행동 처리는 없다.

## 3. 거절 사유·오류 코드 (사람 말 문구는 `appErrorToKorean`)

| 코드 | 언제 | 문구 |
|---|---|---|
| `NAME_TAKEN` | 같은 방에 비교 키가 같은 이름 | 이미 다른 회사가 쓰는 이름이에요. 다른 이름을 지어요. (제안 버튼 1~2개) |
| `BAD_NAME` | 금칙어·개인정보 형태·이 판에서 막힌 이름 | 회사 이름으로 쓸 수 없는 말이 있어요. 다른 이름을 지어요. (낱말은 보여 주지 않음) |
| `NAME_FORMAT` | 2~10자가 아님, 자모 단독·이모지·기호 | 회사 이름은 2~10자의 한글·영문·숫자로 지어요. … |
| `SEAT_TAKEN` | 번호에 다른 이름의 회사 | 이 번호는 이미 다른 회사가 쓰고 있어요. 번호를 확인하거나 선생님께 말해요. |
| `SEAT_ONLINE` | (v0.3.1부터 쓰지 않음 — 이름만 남김) | |
| `LOCKED` | 입장 마감 중 새 번호 | 지금은 새로 들어올 수 없어요. 선생님께 말해요. |
| `KICKED` | 내보낸 기기 | 이번 판에는 다시 들어올 수 없어요. 선생님께 말해요. |
| `TOO_MANY_TRIES` | 앱 쪽 입장 실패 제한 | 잠시 뒤에 다시 해 봐요. |
| `BAD_HELLO` | (124 추가) 인사 모양 오류·번호 범위 밖 | 출석번호(1~40)와 회사 이름을 다시 확인해요. |
| `REJOIN_DENIED` | (124 추가) 교사가 다른 기기 요청 거절 | 선생님이 이 기기로 들어오는 것을 허락하지 않았어요. 선생님께 말해요. |
| `MOVED` / `NOT_SEATED` | `ack` 오류 | 다른 기기로 옮겨졌어요. / 아직 회사에 들어가지 않았어요. |
| `NAME_LOCKED` | `name.result` 오류 | 무역이 시작된 뒤에는 선생님만 회사 이름을 바꿀 수 있어요. |
| `QUEUE_FULL` | 호스트 부재 중 21번째 행동 | 선생님 화면이 돌아오면 다시 해요. |
| `CODE_CHANGED` | 호스트가 새 코드를 알림(`code.changed`), 또는 같은 코드 재시도가 540초 지남 | 방 코드가 바뀌었어요. 선생님 화면(TV)의 새 코드를 입력해요. |
| 그 밖 | 전송 오류(`NO_ROOM` 등) | `shared/protocol.ts`의 `errorToKorean` |

거절 사유는 전송 계층 `reason`(64자 이하 문자열 하나)에 실린다. `NAME_TAKEN`만 `NAME_TAKEN:제안1,제안2`(회사 이름에는 쉼표·쌍점을 쓸 수 없음). `encodeRejectReason`/`decodeRejectReason`.

## 4. 학생 식별 규칙 (PRD 7.3.1)

| 식별 수단 | 누가 만들고 어디에 | 쓰임 | 누가 보나 |
|---|---|---|---|
| 기기 토큰 | 학생 기기가 처음 한 번 128비트 무작위(`voyage.device`). 호스트는 좌석 ↔ 토큰을 세션 장부에 | **자동 재입장의 유일한 열쇠**(입장 판정 2) | 아무도(화면에 없음) |
| 출석번호 | 학생 입력(1~40) | 좌석 키(`s07`), 다른 기기 요청의 첫째 열쇠 | **교사 화면만**(+ 본인 기기). 공개 상태·공용 화면·다른 학생·서버 로그에 없음 |
| 회사 이름 | 학생 입력(6.1.1) | 표시 이름, 다른 기기 요청의 둘째 열쇠(번호와 **둘 다** 맞아야 요청 가능) | 모두 |
| 공개 ID `pid` | 호스트가 좌석마다 6자 영숫자 무작위(방 안 유일) | 공개 상태에서 회사를 가리킴 | 모두(뜻 없는 값) |

- 공개 상태를 보낼 때마다 `assertNoSeatInPublic`이 `seat`·`seats` 키를 재귀 검사한다. 있으면 개발 모드 콘솔 오류(키 경로만) + 키를 지우고 보냄. `strictPublic: true`(테스트)면 예외. 공용 화면 다리도 같은 검사.
- 세션 코드는 콘솔에 출석번호·회사 이름을 찍지 않는다(리듀서 오류도 종류 이름만).

## 5. 재접속·복구

| 경우 | 처리 |
|---|---|
| ① 같은 기기 새로 고침·와이파이 끊김 | 학생: `peer-store`의 `{code, seat, companyName}` + 기기 토큰으로 `autoRejoin()`(연결이 돌아오면 0.3~1.5초 무작위 뒤 자동). 호스트: 판정 (2) → `same-device`, 호스트가 가진 개인 상태 전체를 다시 보냄. 끊긴 동안 행동은 최대 20개 모았다가 들어가면 차례로 보냄(호스트가 `seq`로 중복 거름) |
| ② 다른 기기로 바꿈 | 같은 번호 + 같은 회사 이름 → (4) 교사 허락. 이름을 잊었으면 (5) `SEAT_TAKEN` → 교사 [이 기기를 n번 회사로 연결] |
| ③ 호스트 부재(교사 PC 끊김) | 호스트: 연결이 끊기면(`reconnecting`/`offline`, 서버가 방을 지운 경우 포함) 끊긴 시각을 기록하고 **1초 틱을 멈춘다**(게임 시계 정지). 다시 붙으면(`resumed`·`reopened`·`newCode` 모두) 끊긴 시간이 5초 이상이면 리듀서에 `{type:'hostGap', gapMs: 실제 끊긴 시간}` 1번, `attach` 결과 `gapMs`에도 넣음. `getView().disconnectedAt`. 학생: `host.status false` → `hostOffline`(+`hostOfflineSince`, 15초 넘으면 화면이 띠). 행동은 20개까지 모음, 21번째는 `QUEUE_FULL` 안내. 호스트가 돌아오면 `sync` → 호스트가 최신 상태(모르는 연결이면 `hello.again`) → `in` + 모은 행동 차례로 |
| ④ 호스트 새로 고침·브라우저 재시작 | 새 `createHostSession` + 같은 저장소로 `resume()`: 저장 기록 → `resumeRoom(code, hostToken)` → 학생 연결(peerId)을 장부와 맞춰 공개 상태 전체 + 개인 상태를 다시 보냄, 모르는 연결엔 `hello.again`. `now − max(savedAt, 마지막 틱 시각) ≥ 5초`면 리듀서에 `{type:'hostGap', gapMs}`(끊긴 시간 일시정지 처리). 저장이 최대 1초 늦을 수 있어 그 사이 행동은 잃을 수 있음 |
| ⑤ 중계 서버 재시작 | 6장 |
| ⑥ 교사 PC 바꿈 | `exportMoveFile()` → 새 PC `importMoveFile(json)` → 저장 후 ④와 같이 `resumeRoom`(옛 호스트 연결은 서버가 `replaced`로 닫고, 옛 세션은 `status:'replaced'`로 멈춤) |
| ⑦ 서버가 방을 지움(무활동·빈 방 등) | 호스트 `onRoomClosed(reason≠closed/replaced)` → 같은 코드·토큰으로 다시 열기(서버의 확인된 재열기) |

## 6. 서버 재시작 처리

1. 서버가 사라지면 전송 계층이 다시 연결한다(`reconnecting` → `online`). 방은 서버 메모리에서 사라졌다.
2. 호스트 세션: 끊긴 동안 틱 정지(5장 ③). `online`이 되면 `resumeRoom` → `NO_ROOM` → `openRoom({wantCode: 같은 코드, hostToken})`.
   - 서버가 받아 주면(재시작 뒤 `RESUME_GRACE` 안) **같은 코드** → 학생 자동 재입장(5장 ①).
   - 막히면 서버가 **새 코드**를 준다 → 저장 키를 새 코드로 옮김(옛 키 삭제), `getView().codeChanged = {from, to}`, 공용 화면 다리에 `code.changed`(화면은 새 채널로 옮겨 새 코드를 크게 보여 줌), `code.changed` 브로드캐스트.
3. 학생 세션: 자동 재입장이 `NO_ROOM`·`HOST_OFFLINE`이면 **곧바로 codeChanged로 가지 않고 같은 코드로 계속 시도**한다(간격 2·4·8·15초, 이후 15초). 그동안 상태는 `hostOffline`("선생님 화면을 기다리고 있어요"), 행동은 20개까지 모아 둠. 기다리는 동안 서버가 방 밖 연결을 정리해(30초, `UNJOINED_TIMEOUT`) 끊겨도 계속 — RelayAdapter는 다음 `join` 때 다시 연결한다. 호스트가 같은 코드로 다시 열면 기기 토큰으로 (2) `same-device` — **학생 입력 없음**. `codeChanged`는 ① 호스트가 새 코드를 알렸을 때(`code.changed`) ② 첫 NO_ROOM부터 540초(`NO_ROOM_GIVE_UP_MS`, 서버 `RESUME_GRACE` 600초보다 짧게)가 지났을 때만. 기다리는 중에도 학생 화면에서 TV의 새 코드로 `join`할 수 있다(기기에 번호·회사 이름이 남아 있음). 토큰이 없는 기기는 (4) 교사 허락 — **자동 복원 없음**.
4. `TIMEOUT`·`RATE_LIMITED`는 1·2·4·8·15초 간격으로 다시 해 본다(상태 `reconnecting`). `OFFLINE`이면 연결이 돌아올 때까지 기다림.

## 7. 교사 행동 (호스트 세션 API)

세션이 직접 하는 일과 리듀서에 넘기는 입력을 나눠 적는다. 리듀서는 `{type:'teacher', action}`을 받아 게임 상태(회사 이름 표시 등)를 맞춘다.

| API | 세션이 하는 일 | 리듀서에 넘기는 입력 |
|---|---|---|
| `setLocked(b)` | 장부 `locked`, 새 번호 입장 거절(LOCKED). 서버 잠금은 쓰지 않음 | `teacher {type:'lockJoin'}` / `{type:'unlockJoin'}` |
| `kick(seat)` | 토큰 차단, `kicked` 보내고 연결 끊기, 좌석 비우기, 그 좌석 요청 거절 | `teacher {type:'kick', seat}` |
| `approveRejoin(seat)` | 옛 기기 `moved`, 토큰 교체, 새 기기 `admitted 'approved'` + 상태, 다른 요청 거절 | `teacher {type:'approveRejoin', seat}` 뒤 `presence` |
| `denyRejoin(seat)` | `rejoin.denied` | (없음) |
| `renameCompany(seat, name)` | 길이·형식·중복 검사(금칙어는 `warning:'BAD_NAME'`만), 학생 `name.changed` | `teacher {type:'renameCompany', seat, name, nameKey}` |
| `blockCompanyName(seat)` | 비교 키를 이 판 `bannedNameKeys`에, `nameStatus:'blocked'`, 학생 `name.blocked` | `teacher {type:'blockCompanyName', seat}` (공개 상태에서 이름 `null` = "이름 짓는 중"은 리듀서가) |
| (학생) `name.set` | 준비 단계 또는 막힌 뒤만, 같은 검사, `name.result` | `act {seat, seq:0, action:{type:'setCompanyName', name, nameKey, nameStatus}}` (seq 0 = 세션이 만든 입력, ack 없음) |
| `reassignSeat(from, to)` | 빈 번호로 회사·토큰 옮김, 학생 `seat.changed` | `teacher {type:'reassignSeat', from, to}` |
| `bindDeviceToSeat(peerId, seat)` | '입장 문제'의 기기 토큰을 그 좌석에 묶음, 옛 기기 `moved` | `teacher {type:'bindDeviceToSeat', seat}` |
| `dispatchTeacher(action)` | 그대로 넘김(일시정지·사건·학습지 등 게임 행동) | `teacher {…action}` |
| `close()` | `host.ending`, 남은 메시지 보내고 `closeRoom`, 저장(24시간 뒤 삭제) | (없음 — 판 끝 단계는 리듀서 행동으로 먼저) |

## 8. 리듀서 계약

```ts
reducer(snapshot: G, input: SessionInput, now: number) => { snapshot: G; outputs: SessionOutput[] }
SessionInput =
  | { type: 'join'; seat; pid; companyName; nameKey; nameStatus }   // 새 좌석
  | { type: 'presence'; seat; online }                              // 접속·끊김
  | { type: 'act'; seat; seq; action }                              // 학생 행동(seq 0 = 세션이 만든 setCompanyName)
  | { type: 'teacher'; action: { type: string; … } }                // 7장
  | { type: 'tick' }                                                // 1초마다
  | { type: 'hostGap'; gapMs }                                      // 이어하기 때 끊긴 시간(5초 이상)
SessionOutput =
  | { type: 'public'; data? }        // 공개 상태가 바뀜 → 세션이 views.public(game)으로 다시 읽어 1초 묶음 전송
  | { type: 'me'; seat; data? }      // 그 학생 개인 상태(없으면 views.me)
  | { type: 'ack'; seat; seq; ok; error? }  // 없으면 ok
  | { type: 'teacher'; data }        // 교사 화면 전용(다음 사건 예고 등) → getView().teacher
views = { public(game), me(game, seat), screen?(game) }   // 입장·이어하기 때 전체를 보낼 때 씀
phaseOf(game) → 'prep' | … | 'ended'                       // 기본 game.class.phase
resultTable(game) → { playUnit, scope, metrics[{key,label}], rows[{seat, values, awards}] }
```

리듀서가 예외를 던지면 상태를 바꾸지 않고 그 행동은 `ack{ok:false, error:'ERROR'}`.
작업 103의 `hostReduce(HostSnapshot, HostInput)`를 쓸 때는 얇은 감싸개로 위 입력 이름을 맞춘다(통합 작업).

## 8.5 상한

- 교사 '입장 문제' 목록 최대 50개(`JOIN_PROBLEM_MAX`, 오래된 것부터 버림).
- 손님 연결(허락 대기·거절 뒤) 최대 20개(`GUEST_MAX`) — 넘으면 가장 오래된 손님에게 `hello.rejected {reason:'TOO_MANY_TRIES'}` 뒤 연결 끊기(학생 화면은 '내보내짐'이 아니라 거절로 보임).
- 학생 쪽: `state.me`가 먼저 와서 지운 행동에 뒤늦게 거절 ack가 와도 되돌림 알림을 한다(순서에 기대지 않음).

## 9. 저장 키·만료

| 어디 | 키 | 내용 | 지우는 때 |
|---|---|---|---|
| 교사 localStorage | `voyage.host.<code>` | `StoredHost {v:3, kind:'voyage-host', code, hostToken, savedAt, endedAt, session(세션 장부: 좌석·토큰·pid·회사 이름·차단·막힌 이름·입장 문제·ack), game(리듀서 스냅숏)}` — 1초 묶음 저장, 2MB(UTF-8) 넘으면 `compact`(기본: `game.players.*` 아래 `log` 배열 앞쪽 절반 자르기, 최소 10개 남김) 되풀이 | `endedAt + 24시간`, 또는 마지막 저장 + 24시간(끝나지 않은 판), 열 때마다 `purgeExpired()` |
| 교사 localStorage | `voyage.host.last` | 마지막 판 코드 | 그 판 기록과 함께 |
| 교사 localStorage | `voyage.hosttick.<code>` | 마지막 틱 시각(숫자 하나, 1초마다). 출력 없는 틱에는 판 전체를 저장하지 않으므로, 새로 고침 복구 때 끊긴 시간 = 지금 − max(savedAt, 이 값) | 그 판 기록과 함께, 기록 없는 틱 키는 `purgeExpired` 때 |
| 학생 localStorage | `voyage.device` | 기기 토큰(32자 16진) | 아래 기록이 만료될 때 함께 |
| 학생 localStorage | `voyage.peer` | `{code, seat, companyName, pid, nameStatus, lastMe(보기용), logbook(항해 기록장 = state.me의 logbook), endedAt, savedAt}` | `endedAt + 24시간` 또는 `savedAt + 24시간`. `moved`·`kicked`면 방 정보 즉시 삭제(토큰은 남김) |
| 로컬 모드 `?as=` 탭 | sessionStorage 같은 키 | 탭마다 다른 학생 | 탭 닫으면 |
| 판 옮기기 파일 | (파일) | `{kind:'voyage-move', v:3, warning, exportedAt, record: StoredHost}` — hostToken 포함 경고 | 교사 |
| 결과 파일 | (파일) | JSON + CSV(UTF-8 BOM, CRLF). 열 = **출석번호, 회사 이름, 판 단위, 차시(범위), 지표들, 상**(실명 열 없음). `=+-@`로 시작하는 값은 앞에 `'` | 교사 |

저장이 실패하면(저장 공간 부족·차단) `getView().storageError = 'QUOTA' | 'NO_STORAGE'`(109가 띠로 알림), 다시 성공하면 null.

판 전체 상태는 **교사 localStorage에만** 있다. 서버는 저장하지 않고, 학생 기기는 자기 회사 상태와 항해 기록장만 둔다.

## 10. 공용 화면 다리 (`screen-bridge.ts`)

- 채널 `BroadcastChannel('voyage-screen-<code>')`. 메시지: `hello`(화면 → 호스트, 최신 1번 요청), `state {src, version, publicState, classView}`, `code.changed {newCode}`(화면이 새 채널로 옮김), `closed`.
- 호스트 세션에 `screenFactory: (code) => createScreenPublisher(code)`를 주면 공개 상태를 보낼 때마다 함께 보내고, 코드가 바뀌면 새로 만든다.
- 공개 상태 외 정보(학생 자금·명단·출석번호·재접속 요청·교사 설정)는 보내지 않는다. `seat`·`seats` 키는 검사해 지움.
