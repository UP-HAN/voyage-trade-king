/** 완료 조건 grep 검사: src/core 는 화면·네트워크·동기화와 분리, 실명·없어진 설정 없음, 편지 보상 하드코딩 없음 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = join(__dirname, '..', '..', 'src', 'core');
const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
const code = (f: string) =>
  readFileSync(join(dir, f), 'utf8')
    // 주석 제거(설명 문장에 나오는 낱말은 검사하지 않음)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('src/core 경계', () => {
  it.each(files)('%s: DOM·Preact·네트워크·src/sync 를 쓰지 않는다', (f) => {
    const src = code(f);
    expect(src).not.toMatch(/from\s+['"](preact|@preact|.*\/sync\b|.*\/sync\/|@shared)/);
    expect(src).not.toMatch(/\b(window|document|localStorage|sessionStorage|navigator)\./);
    expect(src).not.toMatch(/\b(WebSocket|BroadcastChannel|fetch|XMLHttpRequest)\b/);
    expect(src).not.toMatch(/Date\.now\(|Math\.random\(/);
  });

  it('없어진 이름 설정·실명 필드가 없다', () => {
    for (const f of files) {
      const raw = readFileSync(join(dir, f), 'utf8');
      expect(raw, f).not.toMatch(/nameDisplay|askName/);
    }
    const types = code('types.ts');
    const player = /export interface Player \{([\s\S]*?)\n\}/.exec(types)![1];
    expect(player).not.toMatch(/^\s*name\??:/m);
  });

  it('편지 보상 수치는 letterSchedule.ts 에서 온다(하드코딩 없음)', () => {
    const src = code('letters.ts');
    expect(src).toMatch(/letterRewards/);
    expect(src).not.toMatch(/\b30\b/);
    expect(src).not.toMatch(/'money',\s*'fastCustoms'/);
  });
});
