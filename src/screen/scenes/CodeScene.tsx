/**
 * 방 코드 장면(PRD 7.6, brief v0.3 2번·v0.3.1 2번): 키아트 배경 위 반투명 양피지 판, 6자리 방 코드(3+3) 초대형,
 * 짧은 주소 + QR(같은 주소 + `?room=코드#/play` — 학생 입장 화면의 방 코드 칸이 미리 채워짐), "들어온 회사 24개". 회사 이름 목록은 입장 순서대로 이름만(출석번호 없음).
 * (작업 133) 키아트 배경은 1920 사본(TV 1920×1080 기준) `image-set()`(AVIF → WebP).
 * 방 코드가 바뀌면(`changed`) 빨간 띠와 함께 새 코드를 크게 보인다.
 */
import { imgCss } from '../../ui/common/asset';
import { joinUrl, spacedCode } from '../model';
import { CompanyTag, QrCode } from '../parts';
import type { SceneProps } from './types';

const MAX_NAMES = 24;

export function CodeScene({ d, code, address, joinOrder, changed = false }: SceneProps & { changed?: boolean }) {
  // 공개 상태는 pid 순이다 → 이 화면이 처음 본 순서(joinOrder)대로 늘어놓는다(화면을 연 뒤 들어온 회사는 입장 순서)
  const rank = new Map((joinOrder ?? []).map((pid, i) => [pid, i]));
  const companies = [...d.pub.companies].sort((a, b) => (rank.get(a.pid) ?? 1e9) - (rank.get(b.pid) ?? 1e9));
  const names = companies.slice(0, MAX_NAMES);
  return (
    <div class="scr-scene scr-code" data-testid="scene-code" style={{ backgroundImage: imgCss('title/keyart.png', { maxWidth: 1920 }) }}>
      {changed && (
        <div class="scr-code__changed" role="alert" data-testid="code-changed">
          방 코드가 바뀌었어요! 새 코드로 다시 들어와요
        </div>
      )}
      <div class="scr-code__board">
        <div class="scr-code__main">
          <p class="scr-code__label">방 코드</p>
          <p class="scr-code__digits" data-testid="screen-room-code" data-code={code}>
            {spacedCode(code)}
          </p>
          <p class="scr-code__addr">
            <span class="scr-code__addr-k">주소</span> <b data-testid="screen-address">{address.display}</b>
          </p>
          <p class="scr-code__joined" data-testid="screen-joined">
            들어온 회사 <b>{d.pub.joinedCount}</b>개
          </p>
        </div>
        <div class="scr-code__qr">
          <QrCode text={joinUrl(address.url, code)} size={260} />
          <p class="scr-small">카메라로 찍어도 돼요</p>
        </div>
      </div>
      {names.length > 0 && (
        <ul class="scr-code__names" data-testid="screen-company-list" aria-label="들어온 회사">
          {names.map((c) => (
            <li key={c.pid}>
              <CompanyTag name={c.name} color={c.color} emblem={c.emblem} size={36} />
            </li>
          ))}
          {companies.length > MAX_NAMES && <li class="scr-small">외 {companies.length - MAX_NAMES}개</li>}
        </ul>
      )}
    </div>
  );
}
