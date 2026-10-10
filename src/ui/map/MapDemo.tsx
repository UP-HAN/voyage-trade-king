/**
 * 세계 해도 데모(개발 서버 전용) — `#/play?demo=map`.
 * 가짜 데이터: 항구 12곳, 배 30척(내 배 1 + 다른 회사 29). 다른 배는 공개 ID(pid)와 회사 이름으로만 만든다.
 * 주소 끝에 `&mode=screen`(공용 화면), `&lesson=L2` 를 붙여 볼 수 있다.
 */
import { useMemo, useState } from 'preact/hooks';
import { portLabel } from '../../data/ports';
import { LESSON_IDS, type LessonId, type PortId } from '../../data/types';
import { distanceSteps } from '../../data/routes';
import type { OtherShip } from './ships';
import { WorldMap, type RouteInfo } from './WorldMap';

const COLORS = ['#B5523B', '#3B6E8F', '#6C8F4E', '#D9A441', '#7A5C8E', '#2E7D8C'];
const EMBLEMS = ['anchor', 'compass', 'star', 'fish', 'wave', 'lighthouse'];
const NAMES = [
  '해오름무역', '푸른바다상사', '별빛해운', '돛단배상회', '등대물산', '바람길무역', '고래상단', '파도해운',
  '나침반상사', '은하무역', '초록섬상회', '무지개해운', '새벽별물산', '항구사랑무역', '둥근달상사', '갈매기해운',
  '모래성상회', '햇살무역', '구름다리상사', '조개껍데기물산', '반딧불해운', '산호초무역', '물결상회', '북극성상사',
  '해바라기무역', '종이배해운', '바다사자상단',
];
/** 항구별 다른 배 수(합 29). 부산 12척 → 8척 + "+4" */
const FLEET: Partial<Record<PortId, number>> = { BUS: 12, SHA: 5, YOK: 3, HCM: 3, BKK: 2, PHE: 2, SIN: 1, JKT: 1 };

function makePid(i: number): string {
  // 뜻 없는 6자(데모용 고정값)
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let n = (i + 7) * 2654435761;
  let s = '';
  for (let k = 0; k < 6; k++) {
    s += chars[n % chars.length];
    n = Math.floor(n / chars.length) + 17 * (k + 1);
  }
  return s;
}

export function demoShips(): OtherShip[] {
  const out: OtherShip[] = [];
  let i = 0;
  for (const [port, count] of Object.entries(FLEET) as [PortId, number][]) {
    for (let c = 0; c < count; c++, i++) {
      out.push({
        pid: makePid(i),
        port,
        color: COLORS[i % COLORS.length]!,
        emblem: EMBLEMS[(i * 5) % EMBLEMS.length]!,
        // 두 회사는 아직 이름을 짓는 중
        company: i === 3 || i === 17 ? null : NAMES[i % NAMES.length]!,
      });
    }
  }
  return out;
}

function readQuery(): URLSearchParams {
  const h = typeof location !== 'undefined' ? location.hash : '';
  return new URLSearchParams(h.includes('?') ? h.slice(h.indexOf('?') + 1) : '');
}

export default function MapDemo() {
  const q = readQuery();
  const [mode, setMode] = useState<'student' | 'screen'>(q.get('mode') === 'screen' ? 'screen' : 'student');
  const [lesson, setLesson] = useState<LessonId>((LESSON_IDS as readonly string[]).includes(q.get('lesson') ?? '') ? (q.get('lesson') as LessonId) : 'L1');
  const [dest, setDest] = useState<PortId | null>(null);
  const [route, setRoute] = useState<RouteInfo | null>(null);
  const ships = useMemo(demoShips, []);
  const myShip = { port: 'BUS' as PortId, color: '#B5523B', emblem: 'anchor' };

  return (
    <div class="map-demo" style={{ display: 'flex', flexDirection: 'column', height: '100dvh', color: '#EFE2BF' }}>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '6px 12px', flexWrap: 'wrap', fontSize: '18px' }}>
        <strong>해도 데모</strong>
        <label>
          화면{' '}
          <select value={mode} onChange={(e) => setMode((e.target as HTMLSelectElement).value as 'student' | 'screen')}>
            <option value="student">학생</option>
            <option value="screen">공용 화면</option>
          </select>
        </label>
        <label>
          구간{' '}
          <select value={lesson} onChange={(e) => setLesson((e.target as HTMLSelectElement).value as LessonId)}>
            {LESSON_IDS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <span data-testid="map-demo-dest">
          {dest ? `목적지: ${portLabel(dest)} · 거리 ${distanceSteps('BUS', dest)}단계 · 항로 점 ${route?.points.length ?? 0}개` : '항구를 눌러 목적지를 골라요'}
        </span>
      </div>
      <div style={{ flex: '1 1 auto', minHeight: 0 }}>
        <WorldMap
          key={mode}
          mode={mode}
          lesson={lesson}
          myShip={myShip}
          otherShips={ships}
          selectedDest={dest}
          onSelectPort={(p) => setDest((cur) => (cur === p || p === 'BUS' ? null : p))}
          highlightPorts={[{ port: 'BKK', kind: 'hot', label: '인기 상품' }, { port: 'SHA', kind: 'hot', label: '인기 상품' }]}
          onRouteChange={setRoute}
        />
      </div>
    </div>
  );
}
