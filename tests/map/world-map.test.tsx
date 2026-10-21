/**
 * WorldMap 렌더 검사(작업 106, v0.3.1): 가짜 DOM(tests/map/fake-dom.ts)에 그린 결과를 본다.
 * - 다른 학생 배는 pid 로만 구분되고 DOM 어디에도 seat(출석번호)가 없다.
 * - 배를 누르면 그 항구 회사 이름만(최대 8개 + 외 n개) 말풍선에 보인다. 공용 화면은 말풍선 없음.
 * - L1 에서 6곳만 활성, 내 배/다른 배 구분, 부채꼴 분산·"+n" 배지, 배 이미지가 없으면 실루엣.
 */
import { render, type VNode } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { WorldMap } from '../../src/ui/map/WorldMap';
import { bubbleContent, isPortOpen, layoutShips, MAX_SHIPS_PER_PORT, type OtherShip } from '../../src/ui/map/ships';
import { demoShips } from '../../src/ui/map/MapDemo';
import { PORT_IDS } from '../../src/data/ports';
import { installFakeDom, type FakeElement } from './fake-dom';

let dom: ReturnType<typeof installFakeDom>;
beforeEach(() => {
  dom = installFakeDom();
});
afterEach(() => {
  act(() => render(null, dom.root as unknown as Element));
  dom.restore();
});

function mount(el: VNode): FakeElement {
  act(() => render(el, dom.root as unknown as Element));
  return dom.root;
}

const ships: OtherShip[] = Array.from({ length: 12 }, (_, i) => ({
  pid: `p${String(i).padStart(2, '0')}xyz`,
  port: 'BUS' as const,
  color: '#3B6E8F',
  emblem: 'star',
  company: i === 5 ? null : `회사${i + 1}`,
}));
ships.push({ pid: 'q1abcd', port: 'SHA', color: '#6C8F4E', emblem: 'fish', company: '바다상회' });

describe('ships 배치(순수 함수)', () => {
  it('항구별로 pid 순 정렬, 8척까지 부채꼴 + 나머지는 "+n"', () => {
    const groups = layoutShips(ships.slice().reverse());
    const bus = groups.find((g) => g.port === 'BUS')!;
    expect(bus.shown).toHaveLength(MAX_SHIPS_PER_PORT);
    expect(bus.hidden).toBe(4);
    expect(bus.badge).not.toBeNull();
    expect(bus.shown.map((s) => s.ship.pid)).toEqual(ships.slice(0, 8).map((s) => s.pid));
    // 자리가 모두 다르다(겹침 분산)
    expect(new Set(bus.shown.map((s) => `${s.dx},${s.dy}`)).size).toBe(8);
    const sha = groups.find((g) => g.port === 'SHA')!;
    expect(sha.shown).toHaveLength(1);
    expect(sha.badge).toBeNull();
  });

  it('말풍선 내용: 회사 이름만, 이름 없으면 "이름 짓는 중", 8개 + 외 n개', () => {
    const c = bubbleContent(ships.filter((s) => s.port === 'BUS'));
    expect(c.names).toHaveLength(8);
    expect(c.names[5]).toBe('이름 짓는 중');
    expect(c.more).toBe(4);
  });

  it('L1 에서는 6곳만 열리고 L2 부터 12곳', () => {
    expect(PORT_IDS.filter((p) => isPortOpen(p, 'L1'))).toEqual(['BUS', 'SHA', 'YOK', 'HCM', 'BKK', 'PHE']);
    expect(PORT_IDS.filter((p) => isPortOpen(p, 'L2'))).toHaveLength(12);
    expect(PORT_IDS.filter((p) => isPortOpen(p, 'L4'))).toHaveLength(12);
  });

  it('데모 데이터: 다른 배 29척(+ 내 배 = 30척), pid 가 겹치지 않고 seat 같은 키가 없다', () => {
    const d = demoShips();
    expect(d).toHaveLength(29);
    expect(new Set(d.map((s) => s.pid)).size).toBe(29);
    for (const s of d) expect(Object.keys(s).sort()).toEqual(['color', 'company', 'emblem', 'pid', 'port']);
  });
});

describe('WorldMap 렌더(학생 모드)', () => {
  const myShip = { port: 'BUS' as const, color: '#B5523B', emblem: 'anchor' };

  it('DOM 에 seat 속성·글자가 없고 배는 data-pid 로 구분된다', () => {
    const root = mount(<WorldMap mode="student" lesson="L1" myShip={myShip} otherShips={ships} />);
    for (const el of root.all()) {
      for (const [name, value] of el.attributes) {
        expect(name.toLowerCase()).not.toContain('seat');
        expect(value.toLowerCase()).not.toContain('seat');
      }
    }
    expect(root.textContent.toLowerCase()).not.toContain('seat');
    expect(root.textContent).not.toContain('출석');
    const shipEls = root.find((e) => e.hasClass('wm-ship--other'));
    expect(shipEls).toHaveLength(9); // 부산 8 + 상하이 1
    expect(new Set(shipEls.map((e) => e.getAttribute('data-pid'))).size).toBe(9);
    const more = root.find((e) => e.hasClass('wm-fleet-more'));
    expect(more).toHaveLength(1);
    expect(more[0]!.textContent).toBe('+4');
  });

  it('배를 누르면 그 항구 회사 이름만 말풍선에 보인다', () => {
    const root = mount(<WorldMap mode="student" lesson="L1" myShip={myShip} otherShips={ships} />);
    expect(root.find((e) => e.hasClass('wm-bubble'))).toHaveLength(0);
    // 다른 배를 누르기 전에는 회사 이름이 화면에 없다
    expect(root.textContent).not.toContain('바다상회');
    const ship = root.find((e) => e.getAttribute('data-pid') === 'q1abcd')[0]!;
    act(() => {
      ship.dispatch('click');
    });
    let bubble = root.find((e) => e.hasClass('wm-bubble'));
    expect(bubble).toHaveLength(1);
    expect(bubble[0]!.find((e) => e.localName === 'li').map((e) => e.textContent)).toEqual(['바다상회']);

    const busShip = root.find((e) => e.getAttribute('data-pid') === 'p00xyz')[0]!;
    act(() => {
      busShip.dispatch('click');
    });
    bubble = root.find((e) => e.hasClass('wm-bubble'));
    expect(bubble[0]!.find((e) => e.localName === 'li').map((e) => e.textContent)).toEqual([
      '회사1', '회사2', '회사3', '회사4', '회사5', '이름 짓는 중', '회사7', '회사8',
    ]);
    // 말풍선 글자 = 회사 이름 + "외 4개" + 닫기(×)뿐 — pid·자금 없음
    const text = bubble[0]!.textContent;
    expect(text).toBe('회사1회사2회사3회사4회사5이름 짓는 중회사7회사8외 4개×');
  });

  it('L1 에서 열린 항구 6곳만 누를 수 있고, 잠긴 항구는 회색 점(자물쇠 없음)', () => {
    const root = mount(<WorldMap mode="student" lesson="L1" myShip={myShip} otherShips={[]} />);
    const portEls = root.find((e) => e.hasClass('wm-port'));
    expect(portEls).toHaveLength(12);
    const locked = portEls.filter((e) => e.hasClass('is-locked'));
    expect(locked.map((e) => e.getAttribute('data-port'))).toEqual(['JKT', 'DAM', 'SIN', 'MUM', 'ROT', 'LAX']);
    for (const el of locked) {
      expect(el.find((e) => e.hasClass('wm-port-dot'))).toHaveLength(1);
      expect(el.find((e) => e.hasClass('wm-port-hit'))[0]!.hasAttribute('disabled')).toBe(true);
    }
    const open = portEls.filter((e) => !e.hasClass('is-locked'));
    for (const el of open) expect(el.find((e) => e.hasClass('wm-port-hit'))[0]!.hasAttribute('disabled')).toBe(false);
  });

  it('(작업 167) openPorts를 주면 L2라도 목록에 없는 싱가포르는 잠김(회색 점·누를 수 없음·이름표 잠김), 주지 않으면 그대로', () => {
    const eleven = PORT_IDS.filter((x) => x !== 'SIN');
    let root = mount(<WorldMap mode="student" lesson="L2" myShip={myShip} otherShips={[]} openPorts={eleven} />);
    let portEls = root.find((e) => e.hasClass('wm-port'));
    const locked = portEls.filter((e) => e.hasClass('is-locked'));
    expect(locked.map((e) => e.getAttribute('data-port'))).toEqual(['SIN']);
    const hit = locked[0]!.find((e) => e.hasClass('wm-port-hit'))[0]!;
    expect(hit.hasAttribute('disabled')).toBe(true);
    expect(hit.getAttribute('aria-label')).toBe('싱가포르(싱가포르) — 아직 열리지 않은 항구');
    expect(root.find((e) => e.hasClass('wm-label-anchor') && e.hasClass('is-locked'))).toHaveLength(1);
    act(() => render(null, dom.root as unknown as Element));
    root = mount(<WorldMap mode="student" lesson="L2" myShip={myShip} otherShips={[]} openPorts={PORT_IDS} />);
    portEls = root.find((e) => e.hasClass('wm-port'));
    expect(portEls.filter((e) => e.hasClass('is-locked'))).toHaveLength(0);
    act(() => render(null, dom.root as unknown as Element));
    root = mount(<WorldMap mode="screen" lesson="L2" otherShips={[]} openPorts={eleven} />);
    expect(root.find((e) => e.hasClass('wm-port') && e.hasClass('is-locked')).map((e) => e.getAttribute('data-port'))).toEqual(['SIN']);
  });

  it('이름표는 "부산(대한민국)" 형식이다(국경선·지명 라벨 없음)', () => {
    const root = mount(<WorldMap mode="student" lesson="L2" />);
    const labels = root.find((e) => e.hasClass('wm-port-label')).map((e) => e.textContent);
    expect(labels).toContain('부산(대한민국)');
    expect(labels).toContain('로스앤젤레스(미국)');
    expect(labels).toHaveLength(12);
    for (const l of labels) expect(l).toMatch(/^[^()]+\([^()]+\)$/);
    // 지도 위 글자는 항구 이름표·버튼뿐
    expect(root.find((e) => e.localName === 'text')).toHaveLength(0);
  });

  it('항구를 누르면 onSelectPort, 목적지를 고르면 항로 점선을 그린다', () => {
    const picked: string[] = [];
    const routes: (string | null)[] = [];
    const root = mount(
      <WorldMap
        mode="student"
        lesson="L2"
        myShip={myShip}
        selectedDest="SIN"
        onSelectPort={(p) => picked.push(p)}
        onRouteChange={(r) => routes.push(r ? `${r.from}>${r.to}:${r.points.length}` : null)}
      />,
    );
    const yok = root.find((e) => e.hasClass('wm-port') && e.getAttribute('data-port') === 'YOK')[0]!;
    act(() => {
      yok.find((e) => e.hasClass('wm-port-hit'))[0]!.dispatch('click');
    });
    expect(picked).toEqual(['YOK']);
    const route = root.find((e) => e.hasClass('wm-route'));
    expect(route).toHaveLength(1);
    expect(route[0]!.getAttribute('data-from')).toBe('BUS');
    expect(route[0]!.getAttribute('data-to')).toBe('SIN');
    expect(route[0]!.getAttribute('d')!.startsWith('M')).toBe(true);
    expect(routes[0]).toMatch(/^BUS>SIN:\d+$/);
  });

  it('내 배는 크게 + 금색 테두리, 다른 배는 작게. 배 이미지가 없으면 SVG 실루엣', () => {
    const root = mount(<WorldMap mode="student" lesson="L1" myShip={myShip} otherShips={ships} />);
    const mine = root.find((e) => e.hasClass('wm-ship--mine'));
    expect(mine).toHaveLength(1);
    const mineSvg = mine[0]!.find((e) => e.localName === 'svg')[0]!;
    expect(mineSvg.getAttribute('width')).toBe('46');
    expect(mineSvg.find((e) => e.localName === 'circle' && e.getAttribute('stroke') === '#DCAA48')).toHaveLength(1);
    const other = root.find((e) => e.hasClass('wm-ship--other'))[0]!;
    expect(other.find((e) => e.localName === 'svg')[0]!.getAttribute('width')).toBe('26');
    // 노드 환경에는 Image 가 없어 '이미지 없음' → 실루엣(path)과 깃발만, <image> 없음
    expect(other.find((e) => e.localName === 'image')).toHaveLength(0);
    expect(other.find((e) => e.localName === 'path').length).toBeGreaterThanOrEqual(4);
  });
});

describe('WorldMap 렌더(공용 화면 모드)', () => {
  it('말풍선·확대 버튼이 없고 배는 누를 수 없다', () => {
    const root = mount(<WorldMap mode="screen" lesson="L2" otherShips={ships} />);
    expect(root.find((e) => e.hasClass('wm-controls'))).toHaveLength(0);
    const ship = root.find((e) => e.getAttribute('data-pid') === 'q1abcd')[0]!;
    expect(ship.hasAttribute('disabled')).toBe(true);
    act(() => {
      ship.dispatch('click');
    });
    expect(root.find((e) => e.hasClass('wm-bubble'))).toHaveLength(0);
    // 회사 이름은 공용 화면 지도에 나오지 않는다(배만)
    expect(root.textContent).not.toContain('바다상회');
  });
});

describe('src/ui/map 에 seat 식별자가 없다(grep)', () => {
  it('소스 파일 어디에도 seat 가 없다', () => {
    const dir = new URL('../../src/ui/map/', import.meta.url);
    for (const f of readdirSync(dir)) {
      const src = readFileSync(new URL(f, dir), 'utf8');
      expect(/seat/i.test(src), f).toBe(false);
    }
  });
});
