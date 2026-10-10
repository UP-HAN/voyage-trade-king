/**
 * 학습지 "잠깐!" 팝업의 게임 기록 도우미(helper) 16종 (docs/worksheet.md 2.1).
 * 팝업 아래에 `[내 기록: …]` 한 줄로 보여 준다. 기록이 없으면 emptyText("아직 기록이 없어요" 등).
 *
 * 여기에는 **표시 문구를 만드는 순수 함수**와 그에 필요한 작은 계산(상위 2개 고르기, 1위 고르기 등)만 둔다.
 * 입력 기록(학생 결정·거래 로그·학급 집계)을 모으는 일은 core(작업 103)·학습지 팝업(작업 112)이 한다.
 * ★ = 작업 301이 새로 정의한 키 7개(customsBoard, relayTrade, mineralCoopChoice, competitionRecord,
 *     magazineDraft, voyageSummary, expoEntry).
 */
import { goodsById } from './goods';
import { portsById } from './ports';
import type { ExportTypeId, GoodId, HelperKey, PortId } from './types';

export const HELPER_EMPTY_TEXT = '아직 기록이 없어요';

// ─── 한국어 조사 ─────────────────────────────────────────────

/** 마지막 글자(괄호 안 설명은 무시)에 받침이 있는가 */
function hasFinalConsonant(word: string): boolean {
  const base = word.replace(/\([^)]*\)\s*$/, '').trim();
  const ch = base.charCodeAt(base.length - 1);
  if (ch >= 0xac00 && ch <= 0xd7a3) return (ch - 0xac00) % 28 !== 0;
  // 숫자·영문 끝: 받침 있는 것으로 읽히는 숫자(0,1,3,6,7,8)
  return /[013678]$/.test(base);
}

/** 을/를 */
export function eulReul(word: string): string {
  return `${word}${hasFinalConsonant(word) ? '을' : '를'}`;
}

/** 짧은 상품 이름(괄호 설명 제거) */
function goodName(id: GoodId): string {
  return goodsById[id].name.replace(/\([^)]*\)\s*$/, '').trim();
}

function portName(id: PortId): string {
  return portsById[id].name;
}

// ─── 작은 계산 ──────────────────────────────────────────────

/** 수량 표에서 큰 순서로 n개(같으면 goods.ts 순서). 0 이하는 뺀다 */
export function topGoods(counts: Partial<Record<GoodId, number>>, n: number): GoodId[] {
  const order = Object.keys(goodsById) as GoodId[];
  return order
    .filter((g) => (counts[g] ?? 0) > 0)
    .sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0) || order.indexOf(a) - order.indexOf(b))
    .slice(0, n);
}

/** 표에서 값이 가장 큰 키(같으면 먼저 나온 키). 모두 0 이하면 null */
export function argMax<K extends string>(values: Partial<Record<K, number>>, order: readonly K[]): K | null {
  let best: K | null = null;
  for (const k of order) {
    const v = values[k] ?? 0;
    if (v > 0 && (best === null || v > (values[best] ?? 0))) best = k;
  }
  return best;
}

// ─── 입력 기록 타입 ─────────────────────────────────────────

export interface IslandAmounts { rice: number; clothes: number }

export interface HelperInputs {
  byeokrandoResult: { correct: number; total: number };
  twoIslandsResult: { stage1: { A: IslandAmounts; B: IslandAmounts }; stage3: { A: IslandAmounts; B: IslandAmounts } | null };
  graphiteChoice: { choice: 'SHA' | 'BUS' | 'none' };
  /** L2-E6 학급 집계: 부산에 들여온(수입) / 내보낸(수출) 상자 수 */
  customsBoard: { imports: Partial<Record<GoodId, number>>; exports: Partial<Record<GoodId, number>> };
  /** L2-E3 임무 첫 완료 기록(없으면 null) */
  importProduceExport: { record: { importGood: GoodId; importPort: PortId; product: GoodId; exportPort: PortId } | null };
  /** L2-E4 임무: 유형별로 처음 사거나 판 상품 */
  exportTypes: { done: Partial<Record<ExportTypeId, GoodId>> };
  /** L2-E5 임무: 첫 [중계] 판매(싱가포르에서 산 상품을 다른 나라에 판매) */
  relayTrade: { record: { good: GoodId; toPort: PortId } | null };
  mineralCoopChoice: { joined: boolean };
  smartphonePart: { part: GoodId; fromPort: PortId | null; qty: number };
  competitionRecord: {
    /** 기술 연구비(만 원), 결정 안 했으면 null */
    research: number | null;
    gotAiChip: boolean;
    portVote: 'yes' | 'no' | null;
    classResult: 'yes' | 'no' | null;
  };
  voteResult1970: { myVote: 'tariff' | 'noTariff' | null; counts: { tariff: number; noTariff: number } };
  factoryDecision: { built: boolean; wage: 'fair' | 'low' | null; envFacility: boolean | null; reason?: string };
  containerResult: { correct: number; total: number; wrongNos: readonly number[] };
  /** 6.14.3 자동 제안: [수출] 도장 판매액 합계(상품별·항구별) */
  magazineDraft: { exportsByGood: Partial<Record<GoodId, number>>; exportsByPort: Partial<Record<PortId, number>> };
  voyageSummary: {
    bestTrade: { good: GoodId; port: PortId; profit: number } | null;
    visitedPorts: number;
    awards: readonly string[];
  };
  expoEntry: { good: GoodId; stamps: number };
}

export interface HelperDef<K extends HelperKey> {
  key: K;
  /** 데이터 출처(docs/worksheet.md 2.1) */
  source: string;
  /** 관련 사건 ID */
  events: readonly string[];
  /** 기록이 없을 때 */
  emptyText: string;
  /** 301 신규 키 */
  isNew: boolean;
  /** 기록 → 한 줄 문구 */
  format: (input: HelperInputs[K]) => string;
}

const wageText = { fair: '정당한 임금', low: '낮은 임금' } as const;

export const helperDefs: { readonly [K in HelperKey]: HelperDef<K> } = {
  byeokrandoResult: {
    key: 'byeokrandoResult', source: 'L1-E1 첫 제출 결과', events: ['L1-E1'], emptyText: HELPER_EMPTY_TEXT, isNew: false,
    format: ({ correct, total }) => `벽란도 상인 카드 ${total}장 중 ${correct}장 맞혔어요`,
  },
  twoIslandsResult: {
    key: 'twoIslandsResult', source: 'L1-E5 1단계·3단계 결과', events: ['L1-E5'], emptyText: HELPER_EMPTY_TEXT, isNew: false,
    format: ({ stage1, stage3 }) => {
      const s = (v: { A: IslandAmounts; B: IslandAmounts }) =>
        `㉮ 쌀 ${v.A.rice}·옷 ${v.A.clothes} / ㉯ 쌀 ${v.B.rice}·옷 ${v.B.clothes}`;
      return stage3 ? `혼자 살 때 ${s(stage1)} → 바꾼 뒤 ${s(stage3)}` : `혼자 살 때 ${s(stage1)} (아직 바꾸지 않았어요)`;
    },
  },
  graphiteChoice: {
    key: 'graphiteChoice', source: 'L1-E7 결정', events: ['L1-E7'], emptyText: HELPER_EMPTY_TEXT, isNew: false,
    format: ({ choice }) =>
      choice === 'SHA' ? '내 흑연 선택: 상하이에서 샀어요' : choice === 'BUS' ? '내 흑연 선택: 부산(국내산)에서 샀어요' : '내 흑연 선택: 사지 않았어요',
  },
  customsBoard: {
    key: 'customsBoard', source: 'L2-E6 학급 집계', events: ['L2-E6'], emptyText: HELPER_EMPTY_TEXT, isNew: true,
    format: ({ imports, exports }) => {
      const list = (c: Partial<Record<GoodId, number>>) => topGoods(c, 2).map(goodName).join(', ') || '—';
      return `우리 반이 부산에 많이 들여온 상품: ${list(imports)} / 많이 내보낸 상품: ${list(exports)}`;
    },
  },
  importProduceExport: {
    key: 'importProduceExport', source: 'L2-E3 임무', events: ['L2-E3'], emptyText: '아직 못 했어요', isNew: false,
    format: ({ record }) =>
      record
        ? `${goodName(record.importGood)} 수입(${portName(record.importPort)}) → ${goodName(record.product)} 생산 → ${portName(record.exportPort)}에 수출`
        : '아직 못 했어요',
  },
  exportTypes: {
    key: 'exportTypes', source: 'L2-E4 임무', events: ['L2-E4'], emptyText: HELPER_EMPTY_TEXT, isNew: false,
    format: ({ done }) => {
      const rows: [ExportTypeId, string][] = [
        ['export-agri', '농산물'], ['export-resource', '천연자원'], ['export-tech', '기술'], ['export-culture', '문화'],
      ];
      return rows.map(([id, label]) => (done[id] ? `${label}: ${goodName(done[id]!)} ✓` : `${label}: —`)).join(' / ');
    },
  },
  relayTrade: {
    key: 'relayTrade', source: 'L2-E5 임무', events: ['L2-E5'], emptyText: '중계 기록이 없어요', isNew: true,
    format: ({ record }) =>
      record ? `싱가포르에서 산 ${eulReul(goodName(record.good))} ${portName(record.toPort)}에 팔았어요 [중계]` : '중계 기록이 없어요',
  },
  mineralCoopChoice: {
    key: 'mineralCoopChoice', source: 'L3-E1 결정', events: ['L3-E1'], emptyText: HELPER_EMPTY_TEXT, isNew: true,
    format: ({ joined }) => (joined ? '광물 협력: 참여했어요' : '광물 협력: 참여하지 않았어요'),
  },
  smartphonePart: {
    key: 'smartphonePart', source: 'L3-E2~E5', events: ['L3-E2', 'L3-E5'], emptyText: HELPER_EMPTY_TEXT, isNew: false,
    format: ({ part, fromPort, qty }) =>
      `내 부품: ${goodName(part)}${fromPort ? `(${portName(fromPort)}에서 가져옴)` : ''} · 넣은 수량 ${qty}`,
  },
  competitionRecord: {
    key: 'competitionRecord', source: 'L3-E3, L3-E4', events: ['L3-E3', 'L3-E4'], emptyText: HELPER_EMPTY_TEXT, isNew: true,
    format: ({ research, gotAiChip, portVote, classResult }) => {
      const parts: string[] = [];
      if (research !== null) parts.push(`기술 연구비: ${research}만 원${gotAiChip ? '(AI 반도체 얻음)' : ''}`);
      if (portVote !== null) {
        const v = (x: 'yes' | 'no') => (x === 'yes' ? '찬성' : '반대');
        parts.push(`항만 투표: ${v(portVote)}${classResult ? `(우리 반 결과: ${v(classResult)})` : ''}`);
      }
      return parts.length ? parts.join(' · ') : HELPER_EMPTY_TEXT;
    },
  },
  voteResult1970: {
    key: 'voteResult1970', source: 'L4-E1', events: ['L4-E1'], emptyText: HELPER_EMPTY_TEXT, isNew: false,
    format: ({ myVote, counts }) => {
      const mine = myVote === 'tariff' ? '관세를 매겨요' : myVote === 'noTariff' ? '관세를 매기지 않아요' : '투표하지 않았어요';
      return `내 투표: ${mine} · 우리 반 결과: 매김 ${counts.tariff} / 안 매김 ${counts.noTariff}`;
    },
  },
  factoryDecision: {
    key: 'factoryDecision', source: 'L4-E2~E3', events: ['L4-E2', 'L4-E3'], emptyText: HELPER_EMPTY_TEXT, isNew: false,
    format: ({ built, wage, envFacility, reason }) => {
      const parts = [built ? '공장: 지었어요' : '공장: 짓지 않았어요'];
      if (built && wage) parts.push(`임금: ${wageText[wage]}`);
      if (built && envFacility !== null) parts.push(`환경 설비: ${envFacility ? '설치' : '설치 안 함'}`);
      const base = parts.join(' · ');
      return reason && reason.trim() ? `${base} · 까닭: ${reason.trim()}` : base;
    },
  },
  containerResult: {
    key: 'containerResult', source: 'L4-E6', events: ['L4-E6'], emptyText: HELPER_EMPTY_TEXT, isNew: false,
    format: ({ correct, total, wrongNos }) =>
      `컨테이너 OX ${total}개 중 ${correct}개 맞혔어요${wrongNos.length ? ` · 틀린 문장: ${wrongNos.map((n) => `${n}번`).join(', ')}` : ''}`,
  },
  magazineDraft: {
    key: 'magazineDraft', source: '6.14.3 자동 제안(수출액 1위)', events: ['L4-E8'], emptyText: HELPER_EMPTY_TEXT, isNew: true,
    format: (input) => {
      const s = magazineSuggestion(input);
      if (!s.good && !s.country) return '아직 수출 기록이 없어요';
      return `대표 상품 제안: ${s.good ? goodName(s.good) : '—'} · 주요 수출국 제안: ${s.country ?? '—'}`;
    },
  },
  voyageSummary: {
    key: 'voyageSummary', source: '거래 기록·결산', events: ['L4-E7', 'L4-E9'], emptyText: HELPER_EMPTY_TEXT, isNew: true,
    format: ({ bestTrade, visitedPorts, awards }) => {
      const parts: string[] = [];
      if (bestTrade && bestTrade.profit > 0) {
        parts.push(`가장 많이 남긴 거래: ${eulReul(goodName(bestTrade.good))} ${portName(bestTrade.port)}에 팔아 +${bestTrade.profit}만 원`);
      }
      parts.push(`방문 항구 ${visitedPorts}곳`);
      parts.push(`받은 상: ${awards.length ? awards.join(', ') : '—'}`);
      return parts.join(' · ');
    },
  },
  expoEntry: {
    key: 'expoEntry', source: '선택 활동 박람회', events: [], emptyText: HELPER_EMPTY_TEXT, isNew: true,
    format: ({ good, stamps }) => `출품: ${goodName(good)} · 받은 관심 도장 ${stamps}개`,
  },
};

/** 잡지 표지 자동 제안(6.14.3): 수출액 1위 상품과 1위 항구의 나라 */
export function magazineSuggestion(input: HelperInputs['magazineDraft']): { good: GoodId | null; port: PortId | null; country: string | null } {
  const good = argMax(input.exportsByGood, Object.keys(goodsById) as GoodId[]);
  const port = argMax(input.exportsByPort, Object.keys(portsById) as PortId[]);
  return { good, port, country: port ? portsById[port].country : null };
}

/** 도우미 한 줄 만들기. 기록이 없으면(null/undefined) emptyText */
export function helperText<K extends HelperKey>(key: K, input: HelperInputs[K] | null | undefined): string {
  const def = helperDefs[key] as HelperDef<K>;
  return input == null ? def.emptyText : def.format(input);
}

/** 301이 새로 정의한 키 7개 */
export const NEW_HELPER_KEYS: readonly HelperKey[] = (Object.keys(helperDefs) as HelperKey[]).filter((k) => helperDefs[k].isNew);
