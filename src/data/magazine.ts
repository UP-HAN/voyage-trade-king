/**
 * 잡지 표지 「이달의 기업」 (L4-E8, PRD 6.14.3, 교과서 p.112~113) — 작업 174.
 * 입력 칸 이름은 교과서 항목 그대로, 글자 수는 PRD 6.14.3(대표 상품·수출국은 짧은 이름이라 20자).
 * 그림(cover/bg-1~3.png)이 없으면 같은 번호의 단색 배경을 쓴다(아트 스타일 3.2 컨테이너 색에서).
 */
export interface MagazineField {
  /** 칸 번호(1~6, 응답 `fields[no-1]`) */
  no: number;
  /** 교과서 항목 이름(p.112~113) */
  label: string;
  /** 짧은 이름(교사 화면·미리보기 꼬리표) */
  short: string;
  max: number;
  placeholder: string;
}

export const magazineFields: readonly MagazineField[] = [
  { no: 1, label: '기업의 대표 상품', short: '대표 상품', max: 20, placeholder: '예: 반도체' },
  { no: 2, label: '상품의 특징', short: '상품의 특징', max: 30, placeholder: '예: 작고 빠르며 전기를 적게 써요' },
  { no: 3, label: '주요 수출국', short: '주요 수출국', max: 20, placeholder: '예: 베트남' },
  { no: 4, label: '사회적 책임을 다하는 기업으로서 달성하고 싶은 목표', short: '사회적 책임 목표', max: 40, placeholder: '예: 환경을 지키며 오래 성장하는 기업' },
  { no: 5, label: '근로자의 권리를 보호하려는 노력', short: '근로자를 위한 노력', max: 40, placeholder: '예: 일한 만큼 정당한 임금을 줘요' },
  { no: 6, label: '자랑하고 싶은 기업의 모습', short: '자랑하고 싶은 모습', max: 30, placeholder: '예: 여러 나라와 사이좋게 무역해요' },
];

/** 표지 제목(p.113 문구) */
export const magazineTitle = { kicker: '우리나라 대표 기업을 알아보는', title: '이달의 기업' } as const;

/** 배경 3종(그림 경로 + 그림이 없을 때 단색) */
export const magazineBackgrounds: readonly { no: number; image: string; color: string; label: string }[] = [
  { no: 1, image: 'cover/bg-1.png', color: '#F1DDB0', label: '노을 항구' },
  { no: 2, image: 'cover/bg-2.png', color: '#D6E6EE', label: '항만과 공장' },
  { no: 3, image: 'cover/bg-3.png', color: '#EFE4CC', label: '옛 항해 지도' },
];

/** 종이로 할 때 안내(교과서·학습지 번호) */
export const magazinePaperText = '교과서 112~113쪽과 학습지 ⑰에 잡지 표지를 써요.';
