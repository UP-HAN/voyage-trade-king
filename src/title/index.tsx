import { useEffect, useState } from 'preact/hooks';
import { img, imgSrcSet } from '../ui/common/asset';
import { APP_VERSION, loadConfigJson, parseDisplayConfig, syncMode } from '../config/deploy';
import { NoticeBanner } from '../ui/common/NoticeBanner';
import { RoomCount } from '../ui/common/RoomCount';
import { ServiceFooter } from '../ui/common/ServiceFooter';
import { TitleLogbookButton } from '../student/logbook/TitleLogbook';

/** `config.json`의 `display.titleRoomCount`(v0.3.4 기본 false — `true`일 때만 보임, PRD 7.5.1). 읽기 전에는 null */
function useTitleRoomCountVisible(): boolean | null {
  const [show, setShow] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    loadConfigJson().then((raw) => {
      if (alive) setShow(parseDisplayConfig(raw).titleRoomCount === true);
    });
    return () => {
      alive = false;
    };
  }, []);
  return show;
}

const KEYART = 'title/keyart.png';

/**
 * (작업 133) 키아트: CSS 배경 대신 `<img>`(첫 화면에서 가장 먼저 받는 그림) — 960/1280/1920 사본 중 화면에 맞는 것, AVIF 먼저.
 * `object-fit: cover` + `object-position: 25% center` = 예전 `background-size: cover; background-position: 25% center`와 같은 모양
 * (1180×820 같은 4:3에 가까운 화면에서 왼쪽 인물 얼굴이 패널에 가리지 않게 — 101의 70% → 25%. 16:9 화면에서는 잘리지 않아 같다).
 * 그림을 못 읽으면 숨긴다(바탕색 그대로 — 예전 배경과 같음).
 */
function KeyArt() {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  const avif = imgSrcSet(KEYART, 'avif');
  return (
    <picture class="title-screen__art" aria-hidden="true">
      {avif && <source type="image/avif" srcset={avif} sizes="100vw" />}
      <img
        src={img(KEYART)}
        srcset={imgSrcSet(KEYART, 'webp')}
        sizes="100vw"
        alt=""
        fetchpriority="high"
        decoding="async"
        data-testid="title-keyart"
        onError={() => setFailed(true)}
      />
    </picture>
  );
}

/**
 * S01 타이틀(#/): 키아트 배경 + 코드 텍스트 제목 + [학생으로 참여] / [선생님으로 시작]
 * v0.3.2(작업 131): 맨 위 서버 공지 띠, [선생님으로 시작] 아래 "사용 중인 방 n/최대"(주기 읽기 없음), 맨 아래 이용 안내 한 줄.
 * v0.3.4(작업 132): "사용 중인 방"은 기본으로 숨김(학생도 거치는 화면 — `display.titleRoomCount: true`일 때만), 맨 아래 둘째 줄 저작권·문의.
 */
export default function Title() {
  const [showConn, setShowConn] = useState(false);
  const relay = syncMode() === 'relay';
  const showRooms = useTitleRoomCountVisible();
  return (
    <main
      class="title-screen"
      data-testid="route-title"
      style={{
        flexDirection: 'column',
        alignItems: 'stretch',
        padding: 0,
      }}
    >
      <KeyArt />
      {relay && <NoticeBanner fetchFrom={true} />}
      <div style={{ flex: '1 1 auto', display: 'flex', alignItems: 'center', padding: '3vh 5vw' }}>
        <div class="title-screen__panel">
          <h1 class="title-screen__name title-font">대항해 무역왕</h1>
          <p class="title-screen__sub">6학년 사회 · 세계 속의 무역</p>
          <div class="title-screen__actions">
            <a class="btn btn--primary btn--large" href="#/play">
              학생으로 참여
            </a>
            <div data-testid="title-teacher-col" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '6px' }}>
              <a class="btn btn--secondary" href="#/teacher">
                선생님으로 시작
              </a>
              {showRooms && <RoomCount poll={false} size="small" />}
            </div>
          </div>
          {/* 작업 112: 이 기기에 저장된 항해 기록장이 있을 때만(판이 끝난 뒤 24시간) */}
          <TitleLogbookButton />
          {/* 작업 105가 ConnectionTest 컴포넌트로 채운다 */}
          <button type="button" class="link-small" aria-expanded={showConn} onClick={() => setShowConn((v) => !v)}>
            연결 테스트
          </button>
          {showConn && (
            <p class="title-screen__conn" data-testid="connection-test-slot">
              연결 테스트는 준비 중이에요.
            </p>
          )}
        </div>
      </div>
      <p class="title-screen__version" style={{ position: 'static', alignSelf: 'flex-end', padding: '0 12px 2px' }}>
        v{APP_VERSION}
      </p>
      <ServiceFooter />
    </main>
  );
}
