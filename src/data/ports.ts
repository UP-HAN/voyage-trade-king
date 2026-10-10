/**
 * 항구 12곳 (PRD 6.3.2).
 * - 좌표: 정거원통도법, viewBox 0 0 2700 1350, x = (lonE + 20) × 10, y = (70 − lat) × 10 (PRD 6.3.1).
 *   서경은 lonE = lon + 360. 표의 x·y는 육지 레이어와 겹쳐 보고 ±10 이내로 조정할 수 있다(작업 106).
 * - features 는 교과서 근거 문장만 쓴다(PRD 6.3.3).
 * - cheapReasons('이 나라가 싸게 파는 까닭', p.99 자연환경·자원·자본·기술)의 근거는 항구마다 cheapReasonsBasis 에 적었다
 *   (교과서가 직접 설명하면 쪽수, 아니면 gameRule: true).
 */
import type { CheapReason, LessonId, Port, PortId } from './types';

export const ports: readonly Port[] = [
  {
    id: 'BUS', name: '부산', country: '대한민국', lon: 129.2, lat: 34.9, x: 1492, y: 351, unlockLesson: 'L1',
    features: [
      { text: '우리나라는 다른 나라에서 수입한 자원으로 다양한 상품을 생산할 수 있는 기술이 발달했어요.', pages: [101] },
      { text: '부산항은 자동화 항만 시스템을 구축했어요.', pages: [107] },
    ],
    cheapReasons: ['tech'], cheapReasonsBasis: { gameRule: false, pages: [101], note: '다른 나라에서 수입한 자원으로 다양한 상품을 생산할 수 있는 기술이 발달했어요.' }, isWorldPort: false, sceneImage: 'ports/busan.png', isHome: true,
    gameRuleNote: '우리 회사 본사가 있는 항구예요. 공장(L2~)과 조선소(P1)가 있어요.',
  },
  {
    id: 'SHA', name: '상하이', country: '중국', lon: 122.2, lat: 31.0, x: 1422, y: 390, unlockLesson: 'L1',
    features: [{ text: '중국의 상하이는 세계적인 무역항을 갖춘 도시예요.', pages: [104] }],
    cheapReasons: ['resource'], cheapReasonsBasis: { gameRule: true, note: '상하이(중국)를 자원 아이콘으로 둔 것은 게임 설정이에요.' }, isWorldPort: true, sceneImage: 'ports/shanghai.png',
  },
  {
    id: 'YOK', name: '요코하마', country: '일본', lon: 139.9, lat: 34.9, x: 1599, y: 351, unlockLesson: 'L1',
    features: [{ text: '일본은 뛰어난 기술을 바탕으로 만든 로봇을 수출해요.', pages: [103] }],
    cheapReasons: ['tech'], cheapReasonsBasis: { gameRule: false, pages: [103], note: '뛰어난 기술을 바탕으로 생산한 물자를 수출하는 나라(일본 — 로봇)' }, isWorldPort: false, sceneImage: 'ports/yokohama.png',
  },
  {
    id: 'HCM', name: '호찌민', country: '베트남', lon: 107.2, lat: 10.2, x: 1272, y: 598, unlockLesson: 'L1',
    features: [
      { text: '베트남은 쌀을 많이 수출하는 나라예요.', pages: [103] },
      { text: '베트남으로 생산 시설을 옮기는 외국 기업이 늘어나고 있어요.', pages: [109] },
    ],
    cheapReasons: ['nature'], cheapReasonsBasis: { gameRule: true, note: '베트남을 자연환경 아이콘으로 둔 것은 게임 설정이에요(교과서는 쌀 수출국으로만 소개).' }, isWorldPort: false, sceneImage: 'ports/hochiminh.png',
  },
  {
    id: 'BKK', name: '방콕', country: '타이', lon: 100.6, lat: 12.6, x: 1206, y: 574, unlockLesson: 'L1',
    features: [{ text: '타이는 쌀을 많이 수출하는 나라예요.', pages: [103] }],
    cheapReasons: ['nature'], cheapReasonsBasis: { gameRule: true, note: '타이를 자연환경 아이콘으로 둔 것은 게임 설정이에요(교과서는 쌀 수출국으로만 소개).' }, isWorldPort: false, sceneImage: 'ports/bangkok.png',
  },
  {
    id: 'PHE', name: '포트헤들랜드', country: '오스트레일리아', lon: 118.6, lat: -19.6, x: 1386, y: 896, unlockLesson: 'L1',
    features: [{ text: '교실 의자는 오스트레일리아에서 캐낸 철로 만들기도 해요.', pages: [94] }],
    cheapReasons: ['resource'], cheapReasonsBasis: { gameRule: true, note: '오스트레일리아를 자원 아이콘으로 둔 것은 게임 설정이에요(교과서는 철을 캔 나라로만 소개).' }, isWorldPort: false, sceneImage: 'ports/porthedland.png',
  },
  {
    id: 'JKT', name: '자카르타', country: '인도네시아', lon: 106.8, lat: -5.8, x: 1268, y: 758, unlockLesson: 'L2',
    features: [
      { text: '인도네시아는 니켈, 주석 등 광물 매장량이 풍부한 나라예요.', pages: [106] },
      { text: '교실 출입문은 인도네시아에서 자란 나무로 만들기도 해요.', pages: [94] },
    ],
    cheapReasons: ['resource'], cheapReasonsBasis: { gameRule: false, pages: [106], note: '인도네시아는 니켈, 주석 등 광물 매장량이 풍부한 국가예요.' }, isWorldPort: false, sceneImage: 'ports/jakarta.png',
  },
  {
    id: 'DAM', name: '담맘', country: '사우디아라비아', lon: 50.6, lat: 26.6, x: 706, y: 434, unlockLesson: 'L2',
    features: [
      { text: '사우디아라비아는 원유를 가장 많이 수출하는 나라예요(대한 석유 협회, 2023.).', pages: [103] },
      { text: '플라스틱 책꽂이는 사우디아라비아에서 생산한 원유로 만들기도 해요.', pages: [94] },
    ],
    cheapReasons: ['resource'], cheapReasonsBasis: { gameRule: false, pages: [103], note: '풍부한 천연자원을 가진 나라는 천연자원을 수출해요(사우디아라비아 — 원유).' }, isWorldPort: false, sceneImage: 'ports/dammam.png',
  },
  {
    id: 'SIN', name: '싱가포르', country: '싱가포르', lon: 104.0, lat: 1.2, x: 1240, y: 688, unlockLesson: 'L2',
    features: [
      { text: '싱가포르는 유럽과 아시아를 잇는 항로에 자리 잡고 있어요.', pages: [104] },
      { text: '싱가포르에는 여러 나라에서 생산한 상품들이 모이고, 이 상품들을 필요한 나라에 다시 파는 형태의 무역이 발달했어요.', pages: [104] },
    ],
    // 싱가포르는 '싸게 만드는' 나라가 아니라 지리적 위치(p.104)로 무역이 발달한 곳이라 아이콘 없음
    cheapReasons: [], cheapReasonsBasis: { gameRule: false, pages: [104], note: '싱가포르는 지리적 위치를 이용해 무역이 발달한 나라라 아이콘이 없어요.' }, isWorldPort: false, sceneImage: 'ports/singapore.png',
    gameRuleNote: '게임 규칙: 싱가포르 항구는 관세가 없어요.',
  },
  {
    id: 'MUM', name: '뭄바이', country: '인도', lon: 71.5, lat: 18.8, x: 915, y: 512, unlockLesson: 'L2',
    features: [
      { text: '인도는 쌀을 가장 많이 수출하는 나라예요(미국 농무부, 2022.).', pages: [103] },
      { text: '우리나라 기업이 인도에 다리를 건설했어요.', pages: [107] },
    ],
    cheapReasons: ['nature'], cheapReasonsBasis: { gameRule: true, note: '인도를 자연환경 아이콘으로 둔 것은 게임 설정이에요(교과서는 쌀 수출국으로만 소개).' }, isWorldPort: false, sceneImage: 'ports/mumbai.png',
  },
  {
    id: 'ROT', name: '로테르담', country: '네덜란드', lon: 3.6, lat: 52.2, x: 236, y: 178, unlockLesson: 'L2',
    features: [{ text: '네덜란드의 로테르담은 세계적인 무역항을 갖춘 도시예요.', pages: [104] }],
    cheapReasons: ['tech'], cheapReasonsBasis: { gameRule: true, note: '네덜란드를 기술 아이콘으로 둔 것은 게임 설정이에요(교과서의 기술 수출 예는 독일 백신).' }, isWorldPort: true, sceneImage: 'ports/rotterdam.png',
    gameRuleNote: '게임 설정: 유럽 상품(독일 백신 등)을 이곳에서 거래해요.',
  },
  {
    id: 'LAX', name: '로스앤젤레스', country: '미국', lon: -118.5, lat: 33.5, x: 2615, y: 365, unlockLesson: 'L2',
    features: [
      { text: '미국의 로스앤젤레스는 세계적인 무역항을 갖춘 도시예요.', pages: [104] },
      { text: '우리나라는 미국에서 온라인 동영상 서비스를 수입해요.', pages: [103] },
      { text: '미국에서 만든 프로그램을 사용하는 태블릿도 있어요.', pages: [94] },
    ],
    cheapReasons: ['resource', 'tech'], cheapReasonsBasis: { gameRule: true, note: '미국을 자원·기술 아이콘으로 둔 것은 게임 설정이에요.' }, isWorldPort: true, sceneImage: 'ports/losangeles.png',
  },
];

export const portsById: Readonly<Record<PortId, Port>> = Object.fromEntries(
  ports.map((p) => [p.id, p]),
) as Record<PortId, Port>;

export const PORT_IDS: readonly PortId[] = ports.map((p) => p.id);

/** 그 구간에 처음 열리는 항구 */
export function portsOpenedIn(lesson: LessonId): PortId[] {
  return ports.filter((p) => p.unlockLesson === lesson).map((p) => p.id);
}

/** '이 나라가 싸게 파는 까닭' 아이콘 이름(p.99) */
export const cheapReasonInfo: Readonly<Record<CheapReason, { label: string; pages: readonly number[] }>> = {
  nature: { label: '자연환경', pages: [99] },
  resource: { label: '자원', pages: [99] },
  capital: { label: '자본', pages: [99] },
  tech: { label: '기술', pages: [99] },
};

/** 표시 이름 "부산(대한민국)" */
export function portLabel(id: PortId): string {
  const p = portsById[id];
  return `${p.name}(${p.country})`;
}

/** 경도를 지도용 동경 값으로(서경 + 360) */
export function toLonE(lon: number): number {
  return lon < -20 ? lon + 360 : lon;
}

/** PRD 6.3.1 투영 */
export function project(lon: number, lat: number): { x: number; y: number } {
  return { x: (toLonE(lon) + 20) * 10, y: (70 - lat) * 10 };
}
