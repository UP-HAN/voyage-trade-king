/**
 * 작업 141 공략집 촬영 도구 — 화면 하나를 찍고, 눌러야 할 요소(빨간 상자)·보는 곳(파란 점선)의 위치와 화면 이름을 기록한다.
 *
 * - 위치는 요소의 `boundingBox()`(CSS px, 창 기준). 찍기 전·후 위치가 1.5px 넘게 다르면(움직이는 중) 다시 찍는다(최대 4번).
 * - 요소는 창 안에 완전히 들어와야 하고(아니면 오류), 빨간 상자 요소는 가운데 점이 다른 것에 가려 있지 않아야 한다(아니면 오류).
 * - 화면 이름: 버튼·링크는 보이는 글자(innerText 첫 줄), 입력 칸은 aria-label/placeholder/연결된 label 글자. `text`로 직접 줄 수도 있다.
 * - 기록은 `shots.json`(공략집 만들기 scripts/guide/build.mjs가 읽음), 그림은 `raw/<id>.png`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';

export type MarkKind = 'press' | 'look';
export interface MarkSpec {
  loc: Locator;
  kind?: MarkKind;
  /** 공략집에 쓸 이름(없으면 화면 글자) */
  text?: string;
  /** 가려짐 검사 생략(겹쳐 그린 장식이 있는 칸 등) */
  noCoverCheck?: boolean;
}
export interface MarkRecord {
  n: number;
  kind: MarkKind;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  text?: string;
  testId: string | null;
  /** 버튼·링크인가(공략집에서 [이름]으로 쓸지, ‘이름’으로 쓸지) */
  btn: boolean;
}
export interface ShotRecord {
  id: string;
  file: string;
  vw: number;
  vh: number;
  dsf: number;
  who: string;
  marks: MarkRecord[];
  /** 화면의 다른 버튼·입력 칸 위치(번호 동그라미가 가리지 않게 피하는 곳) */
  obstacles: [number, number, number, number][];
  at: string;
}

export class ShotBook {
  readonly records: ShotRecord[] = [];
  readonly rawDir: string;
  constructor(readonly outDir: string) {
    this.rawDir = join(outDir, 'raw');
    mkdirSync(this.rawDir, { recursive: true });
  }

  save(): void {
    writeFileSync(join(this.outDir, 'shots.json'), JSON.stringify({ made: new Date().toISOString(), shots: this.records }, null, 2));
  }

  /** 화면 하나 찍기. marks 순서대로 빨간 상자 1,2,3…, 파란 점선 A,B… */
  async shot(page: Page, id: string, who: string, marks: (Locator | MarkSpec)[] = [], o: { settleMs?: number } = {}): Promise<ShotRecord> {
    if (this.records.some((r) => r.id === id)) throw new Error(`같은 화면 이름 두 번: ${id}`);
    const specs: MarkSpec[] = marks.map((m) => ('loc' in m ? m : { loc: m }));
    for (const s of specs) {
      await s.loc.waitFor({ state: 'visible', timeout: 15_000 });
      await s.loc.scrollIntoViewIfNeeded().catch(() => undefined);
    }
    const vp = page.viewportSize()!;
    // 마우스는 창 오른쪽 아래 귀퉁이(눌렀던 버튼의 마우스 올림 모양이 남지 않게)
    await page.mouse.move(vp.width - 2, vp.height - 2).catch(() => undefined);
    await page.evaluate(() => document.fonts.ready).catch(() => undefined);
    await page.waitForTimeout(o.settleMs ?? 450);
    const dsf = await page.evaluate(() => window.devicePixelRatio);
    const file = join(this.rawDir, `${id}.png`);
    let boxes: { x: number; y: number; width: number; height: number }[] = [];
    for (let attempt = 0; ; attempt++) {
      const before = await Promise.all(specs.map((s) => s.loc.boundingBox()));
      await page.screenshot({ path: file });
      const after = await Promise.all(specs.map((s) => s.loc.boundingBox()));
      const moved = before.some((b, i) => {
        const a = after[i];
        if (!b || !a) return true;
        return Math.abs(a.x - b.x) > 1.5 || Math.abs(a.y - b.y) > 1.5 || Math.abs(a.width - b.width) > 1.5 || Math.abs(a.height - b.height) > 1.5;
      });
      if (!moved) {
        boxes = after as typeof boxes;
        break;
      }
      if (attempt >= 3) throw new Error(`${id}: 표시한 요소가 계속 움직여요`);
      await page.waitForTimeout(500);
    }
    const out: MarkRecord[] = [];
    let press = 0;
    let look = 0;
    for (let i = 0; i < specs.length; i++) {
      const s = specs[i]!;
      const b = boxes[i]!;
      const kind = s.kind ?? 'press';
      if (b.x < -0.5 || b.y < -0.5 || b.x + b.width > vp.width + 0.5 || b.y + b.height > vp.height + 0.5) {
        throw new Error(`${id}: ${i + 1}번째 표시가 창 밖에 있어요 (${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}×${Math.round(b.height)})`);
      }
      const info = await s.loc.evaluate((el: Element) => {
        const tid = el.getAttribute('data-testid');
        let label = '';
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
          const lab = el.id ? document.querySelector(`label[for="${el.id}"]`) : el.closest('label');
          label = el.getAttribute('aria-label') ?? (lab ? (lab as HTMLElement).innerText : '') ?? '';
          if (!label) label = el.getAttribute('placeholder') ?? '';
        } else label = (el as HTMLElement).innerText || el.getAttribute('aria-label') || '';
        const r = el.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        const covered = !!top && top !== el && !el.contains(top) && !top.contains(el);
        const btn = el.matches('button, a[href], [role="button"], summary, input[type="button"], input[type="submit"]');
        return { tid, label: label.trim(), covered, btn, top: top ? `${top.tagName}.${(top as HTMLElement).className}` : '' };
      });
      if (kind === 'press' && info.covered && !s.noCoverCheck) throw new Error(`${id}: ${i + 1}번째 버튼(${info.label})이 다른 것(${info.top})에 가려 있어요`);
      const n = kind === 'press' ? ++press : ++look;
      out.push({ n, kind, x: b.x, y: b.y, w: b.width, h: b.height, label: info.label, text: s.text, testId: info.tid, btn: info.btn });
    }
    const obstacles = await page.evaluate(() => {
      const out: [number, number, number, number][] = [];
      for (const el of document.querySelectorAll('button, a[href], input, select, textarea, [role="button"], summary, label')) {
        const r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
        out.push([Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]);
        if (out.length >= 600) break;
      }
      return out;
    });
    const rec: ShotRecord = { id, file: `raw/${id}.png`, vw: vp.width, vh: vp.height, dsf, who, marks: out, obstacles, at: new Date().toISOString() };
    this.records.push(rec);
    this.save();
    console.log(`[guide] 찍음 ${id} (${who}) ${out.map((m) => `${m.kind === 'press' ? m.n : String.fromCharCode(64 + m.n)}:${m.text ?? m.label.split('\n')[0]}`).join(' · ')}`);
    return rec;
  }
}
