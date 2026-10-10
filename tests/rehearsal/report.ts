/**
 * 작업 135 리허설 — 보고서(report.md + summary.json). 오케스트레이터가 맨 위 한 줄("막힘 0 / 문제 n")만 봐도 되게 쓴다.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { KIND_LABEL, type Problem, type Severity } from './detector';

export interface ScenarioResult {
  id: string;
  title: string;
  target: string;
  speed: number;
  breaks: string[];
  /** 끝까지 돌았는가(도구가 멈추지 않았는가) */
  finished: boolean;
  /** 무역 시작 → 무역 끝(빠른 시계 초), 끝나지 않았으면 null */
  tradeSec: number | null;
  allowedSec: number | null;
  realSec: number;
  problems: Problem[];
  steps: string[];
  metrics: Record<string, unknown>;
  error?: string;
  /** 준비 중 기능 등으로 건너뜀(도구 오류 아님) */
  skipped?: string;
}

const SEV_ORDER: Severity[] = ['막힘', '문제', '혼란', '참고'];

export function countBy(results: ScenarioResult[]) {
  const all = results.flatMap((r) => r.problems);
  const n = (s: Severity) => all.filter((p) => p.severity === s).length;
  return { 막힘: n('막힘'), 문제: n('문제'), 혼란: n('혼란'), 참고: n('참고'), 준비중: all.filter((p) => p.kind === 'preview').length };
}

export function writeReport(dir: string, o: { startedAt: string; target: string; scenarios: string[]; results: ScenarioResult[]; health: { maxPeers: number; maxConns: number; maxMemMB: number }; cleanup?: Record<string, unknown> }) {
  const c = countBy(o.results);
  const problemsTotal = c.문제 + c.혼란;
  const lines: string[] = [];
  lines.push(`# 리허설 보고서 — ${o.startedAt}`);
  lines.push('');
  lines.push(`**막힘 ${c.막힘} / 문제 ${problemsTotal}** (문제 ${c.문제} · 혼란 ${c.혼란}, 참고 ${c.참고}${c.준비중 ? ` — 그중 준비 중 기능 ${c.준비중}` : ''}) · 대상 ${o.target} · 시나리오 ${o.scenarios.join(', ')} · 최대 접속 학생(peers) ${o.health.maxPeers}`);
  lines.push('');
  lines.push('| 시나리오 | 결과 | 막힘 | 문제 | 혼란 | 무역 시간(빠른 시계) | 실제 걸린 시간 | 비고 |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const r of o.results) {
    const k = (s: Severity) => r.problems.filter((p) => p.severity === s).length;
    const ok = r.skipped ? `건너뜀(${r.skipped})` : r.finished && k('막힘') === 0 && k('문제') === 0 ? (k('혼란') ? '통과(혼란 있음)' : '통과') : r.finished ? '문제 있음' : '중단';
    const trade = r.tradeSec === null ? '끝나지 않음' : `${Math.floor(r.tradeSec / 60)}분 ${Math.round(r.tradeSec % 60)}초 (허용 ${r.allowedSec ? Math.round(r.allowedSec / 60) : '?'}분)`;
    lines.push(`| ${r.id}. ${r.title} | ${ok} | ${k('막힘')} | ${k('문제')} | ${k('혼란')} | ${trade} | ${Math.round(r.realSec)}초 | ${[r.breaks.length ? `고장 플래그: ${r.breaks.join(',')}` : '', r.error ? `도구 오류: ${r.error.slice(0, 80)}` : '', typeof r.metrics.preview === 'string' ? `준비 중 기능: ${r.metrics.preview.slice(0, 90)}` : ''].filter(Boolean).join(' ')} |`);
  }
  lines.push('');
  lines.push('## 문제 목록');
  lines.push('');
  const all = o.results.flatMap((r) => r.problems).sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity));
  if (all.length === 0) lines.push('없음.');
  let i = 0;
  for (const p of all) {
    i++;
    lines.push(`### ${i}. [${p.severity}] ${p.title} — 시나리오 ${p.scenario}${p.count > 1 ? ` (×${p.count})` : ''}`);
    lines.push('');
    lines.push(`- 탐지 항목: ${KIND_LABEL[p.kind]}`);
    lines.push(`- 처음 발견: ${p.at}${p.who.length ? ` · 대상: ${p.who.slice(0, 12).join(', ')}${p.who.length > 12 ? ` 외 ${p.who.length - 12}` : ''}` : ''}`);
    lines.push(`- 내용: ${p.detail}`);
    if (p.steps.length) {
      lines.push('- 재현 단계(직전 진행):');
      for (const s of p.steps) lines.push(`  1. ${s}`);
    }
    if (p.shots.length) lines.push(`- 스크린숏: ${p.shots.map((s) => `[${s}](${s})`).join(' · ')}`);
    if (p.logs.length) {
      lines.push('- 관련 로그:');
      lines.push('  ```');
      for (const l of p.logs.slice(0, 12)) lines.push(`  ${l.slice(0, 300)}`);
      lines.push('  ```');
    }
    lines.push('');
  }
  lines.push('## 시나리오별 기록');
  lines.push('');
  for (const r of o.results) {
    lines.push(`### ${r.id}. ${r.title}`);
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify(r.metrics, null, 1).slice(0, 6000));
    lines.push('```');
    lines.push('<details><summary>진행 기록</summary>');
    lines.push('');
    for (const s of r.steps) lines.push(`- ${s}`);
    lines.push('');
    lines.push('</details>');
    lines.push('');
  }
  if (o.cleanup) {
    lines.push('## 정리 확인');
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify(o.cleanup, null, 1));
    lines.push('```');
  }
  writeFileSync(join(dir, 'report.md'), lines.join('\n'), 'utf8');
  const summary = {
    startedAt: o.startedAt,
    target: o.target,
    scenarios: o.scenarios,
    blockers: c.막힘,
    problems: problemsTotal,
    counts: c,
    health: o.health,
    results: o.results.map((r) => ({
      id: r.id,
      title: r.title,
      finished: r.finished,
      tradeSec: r.tradeSec,
      allowedSec: r.allowedSec,
      realSec: Math.round(r.realSec),
      breaks: r.breaks,
      error: r.error ?? null,
      skipped: r.skipped ?? null,
      problems: r.problems.map((p) => ({ severity: p.severity, kind: p.kind, title: p.title, detail: p.detail, at: p.at, count: p.count, who: p.who, shots: p.shots })),
    })),
    cleanup: o.cleanup ?? null,
  };
  writeFileSync(join(dir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  return summary;
}
