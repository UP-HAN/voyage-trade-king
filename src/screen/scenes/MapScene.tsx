/**
 * 해도 장면(PRD 7.6, brief 3번·v0.3 4번): `WorldMap mode='screen'` + 모든 회사의 배(공개 위치 `public.ships`, 깃발만),
 * 라운드 타이머(큰 숫자) + "출항 준비 21/27". 무역 남은 시간은 위쪽 시계 띠(TradeClockBar)가 보인다.
 */
import { useMemo } from 'preact/hooks';
import { flagHex } from '../../ui/common/FlagIcon';
import type { OtherShip } from '../../ui/map/ships';
import { WorldMap } from '../../ui/map/WorldMap';
import { mmss, roundRemainingSec } from '../model';
import type { SceneProps } from './types';

export function MapScene({ d, now }: SceneProps) {
  const { cls, pub } = d;
  const ships: OtherShip[] = useMemo(() => {
    const names = new Map(pub.companies.map((c) => [c.pid, c.name]));
    return pub.ships.map((s) => ({ pid: s.pid, port: s.port, color: flagHex(s.color), emblem: s.emblem, company: names.get(s.pid) ?? null }));
  }, [pub.ships, pub.companies]);
  const left = roundRemainingSec(cls, now);
  return (
    <div class="scr-scene scr-map" data-testid="scene-map">
      <WorldMap mode="screen" lesson={cls.stage} otherShips={ships} class="scr-map__map" />
      <div class="scr-map__hud">
        {left !== null ? (
          <p class="scr-map__round" data-testid="map-round">
            <span class="scr-map__k">라운드 {cls.round}</span>
            <span class="scr-big" data-testid="map-round-left">
              {mmss(left)}
            </span>
          </p>
        ) : (
          <p class="scr-map__round" data-testid="map-round">
            <span class="scr-map__k">{cls.round > 0 ? `라운드 ${cls.round} 끝` : '곧 첫 항해'}</span>
          </p>
        )}
        {cls.settings.voyageMode === 'free' ? (
          // (작업 151) 자유 항해: 출항 준비 대신 이번 라운드 항해 수
          <p class="scr-map__ready" data-testid="map-ready" data-mode="free">
            이번 라운드 항해 <b>{pub.sailsThisRound ?? 0}</b>번
          </p>
        ) : (
          <p class="scr-map__ready" data-testid="map-ready">
            출항 준비 <b>{pub.readyCount}</b>/{pub.joinedCount}
          </p>
        )}
      </div>
    </div>
  );
}
