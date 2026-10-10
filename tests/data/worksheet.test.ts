import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { worksheet } from '../../src/data/worksheet';
import { helperDefs, helperText, NEW_HELPER_KEYS } from '../../src/data/worksheetHelpers';
import type { HelperKey } from '../../src/data/types';

const root = process.cwd();
const WS_DOC = readFileSync(join(root, 'docs', 'worksheet.md'), 'utf8');
const PRD = readFileSync(join(root, 'docs', 'PRD.md'), 'utf8');
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';

/** docs/worksheet.md 2장 대응표 */
function docTable() {
  const start = WS_DOC.indexOf('## 2. 게임 팝업 대응표');
  const end = WS_DOC.indexOf('### 2.1');
  return WS_DOC.slice(start, end).split('\n')
    .filter((l) => new RegExp(`^\\| [${CIRCLED}] \\|`).test(l))
    .map((l) => {
      const [label, id, lesson, , prompt, helper, pages] = l.split('|').slice(1, -1).map((s) => s.trim());
      return { label, id, lesson: lesson === '선택' ? 'optional' : lesson, prompt, helper: helper === '—' ? null : helper, pages };
    });
}

/** PRD 4.5 표의 쪽 열 "p.95~96" / "p.111, 115" → 숫자 배열 */
function prdPages() {
  const start = PRD.indexOf('### 4.5');
  const end = PRD.indexOf('### 4.6');
  return PRD.slice(start, end).split('\n')
    .filter((l) => new RegExp(`^\\| [${CIRCLED}] \\| W\\d\\d`).test(l))
    .map((l) => {
      const c = l.split('|').slice(1, -1).map((s) => s.trim());
      const pagesCol = c[c.length - 1].replace(/p\./g, '');
      const pages = pagesCol.split(',').flatMap((part) => {
        const [a, b] = part.trim().split('~').map(Number);
        return b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [a];
      });
      return { id: c[1], lesson: c[2] === '선택' ? 'optional' : c[2], pages };
    });
}

describe('학습지 W01~W20', () => {
  it('docs/worksheet.md 2장 표와 번호·ID·구간·문구·helper·쪽이 1:1로 같다', () => {
    const rows = docTable();
    expect(rows).toHaveLength(20);
    rows.forEach((r, i) => {
      const w = worksheet[i];
      expect(w.label).toBe(r.label);
      expect(w.no).toBe(i + 1);
      expect(w.id).toBe(r.id);
      expect(w.lesson).toBe(r.lesson);
      expect(w.prompt).toBe(r.prompt);
      expect(w.helper).toBe(r.helper);
      expect(w.pagesLabel).toBe(r.pages);
    });
  });

  it('PRD 4.5 표와 번호·ID·구간·쪽이 같다', () => {
    const rows = prdPages();
    expect(rows).toHaveLength(20);
    rows.forEach((r, i) => {
      expect(worksheet[i].id).toBe(r.id);
      expect(worksheet[i].lesson).toBe(r.lesson);
      expect([...worksheet[i].pages]).toEqual(r.pages);
    });
  });

  it('v0.3 필드: minutes(docs/worksheet.md 3장)·phase·afterEvent', () => {
    const minutes = Object.fromEntries(worksheet.map((w) => [w.no, w.minutes]));
    for (const no of [12, 15, 16]) expect(minutes[no]).toBe(1);
    expect(minutes[17]).toBe(8);
    for (const no of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 18]) expect(minutes[no]).toBe(2);
    for (const w of worksheet) expect(w.phase).toBe([16, 17, 18].includes(w.no) ? 'wrap' : 'trade');
    for (const no of [4, 6, 7, 8, 11, 12]) expect(worksheet[no - 1].afterEvent).toBe('stageLastRound');
    expect(worksheet.filter((w) => w.helper === null).map((w) => w.no)).toEqual([2, 12, 15, 19]);
  });
});

describe('기록 도우미(helper) 16종 — docs/worksheet.md 2.1', () => {
  it('문서의 키 16개가 모두 정의되어 있고, 신규 7개가 표시되어 있다', () => {
    const start = WS_DOC.indexOf('### 2.1');
    const end = WS_DOC.indexOf('## 3.');
    const keys = WS_DOC.slice(start, end).split('\n').filter((l) => /^\| [a-zA-Z0-9]+ /.test(l)).map((l) => l.split('|')[1].trim().split(' ')[0]);
    expect(keys).toHaveLength(16);
    expect(Object.keys(helperDefs).sort()).toEqual([...keys].sort());
    expect([...NEW_HELPER_KEYS].sort()).toEqual(['competitionRecord', 'customsBoard', 'expoEntry', 'magazineDraft', 'mineralCoopChoice', 'relayTrade', 'voyageSummary']);
    for (const w of worksheet) if (w.helper) expect(helperDefs[w.helper as HelperKey]).toBeDefined();
  });

  it('신규 7개 키의 문구·계산이 문서 예시와 같다', () => {
    expect(helperText('customsBoard', { imports: { gas: 40, crude: 30, rice: 5 }, exports: { car: 50, chip: 20, phone: 3 } }))
      .toBe('우리 반이 부산에 많이 들여온 상품: 천연가스, 원유 / 많이 내보낸 상품: 자동차, 반도체');
    expect(helperText('relayTrade', { record: { good: 'clothes', toPort: 'JKT' } })).toBe('싱가포르에서 산 의류를 자카르타에 팔았어요 [중계]');
    expect(helperText('relayTrade', { record: null })).toBe('중계 기록이 없어요');
    expect(helperText('mineralCoopChoice', { joined: true })).toBe('광물 협력: 참여했어요');
    expect(helperText('mineralCoopChoice', { joined: false })).toBe('광물 협력: 참여하지 않았어요');
    expect(helperText('competitionRecord', { research: 200, gotAiChip: true, portVote: 'yes', classResult: 'yes' }))
      .toBe('기술 연구비: 200만 원(AI 반도체 얻음) · 항만 투표: 찬성(우리 반 결과: 찬성)');
    expect(helperText('magazineDraft', { exportsByGood: { car: 900, chip: 300 }, exportsByPort: { BKK: 700, SHA: 500 } }))
      .toBe('대표 상품 제안: 자동차 · 주요 수출국 제안: 타이');
    expect(helperText('voyageSummary', { bestTrade: { good: 'battery', port: 'ROT', profit: 230 }, visitedPorts: 9, awards: ['협력상'] }))
      .toBe('가장 많이 남긴 거래: 배터리를 로테르담에 팔아 +230만 원 · 방문 항구 9곳 · 받은 상: 협력상');
    expect(helperText('expoEntry', { good: 'battery', stamps: 5 })).toBe('출품: 배터리 · 받은 관심 도장 5개');
  });

  it('기존 키 문구', () => {
    expect(helperText('byeokrandoResult', { correct: 7, total: 9 })).toBe('벽란도 상인 카드 9장 중 7장 맞혔어요');
    expect(helperText('graphiteChoice', { choice: 'SHA' })).toBe('내 흑연 선택: 상하이에서 샀어요');
    expect(helperText('twoIslandsResult', { stage1: { A: { rice: 30, clothes: 60 }, B: { rice: 25, clothes: 10 } }, stage3: { A: { rice: 32, clothes: 66 }, B: { rice: 30, clothes: 30 } } }))
      .toContain('바꾼 뒤 ㉮ 쌀 32·옷 66 / ㉯ 쌀 30·옷 30');
    expect(helperText('importProduceExport', { record: { importGood: 'crude', importPort: 'DAM', product: 'oilp', exportPort: 'BKK' } }))
      .toBe('원유 수입(담맘) → 석유 제품 생산 → 방콕에 수출');
    expect(helperText('importProduceExport', { record: null })).toBe('아직 못 했어요');
    expect(helperText('exportTypes', { done: { 'export-agri': 'rice', 'export-resource': 'crude', 'export-tech': 'robot' } }))
      .toBe('농산물: 쌀 ✓ / 천연자원: 원유 ✓ / 기술: 로봇 ✓ / 문화: —');
    expect(helperText('smartphonePart', { part: 'nickel', fromPort: 'JKT', qty: 3 })).toBe('내 부품: 니켈(자카르타에서 가져옴) · 넣은 수량 3');
    expect(helperText('voteResult1970', { myVote: 'tariff', counts: { tariff: 18, noTariff: 9 } })).toBe('내 투표: 관세를 매겨요 · 우리 반 결과: 매김 18 / 안 매김 9');
    expect(helperText('factoryDecision', { built: true, wage: 'fair', envFacility: true })).toBe('공장: 지었어요 · 임금: 정당한 임금 · 환경 설비: 설치');
    expect(helperText('containerResult', { correct: 7, total: 8, wrongNos: [3] })).toBe('컨테이너 OX 8개 중 7개 맞혔어요 · 틀린 문장: 3번');
    expect(helperText('graphiteChoice', null)).toBe('아직 기록이 없어요');
  });
});
