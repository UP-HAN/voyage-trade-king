/**
 * 말썽꾸러기 학생(REHEARSAL_CHAOS=1이면 2·3·4번 브라우저 학생): 아무 버튼이나 마구 누르고, 더블클릭·연타, 칸에 이상한 글자,
 * Esc·뒤로 가기·새로 고침을 섞는다. 화면이 깨지거나 pageerror·console 오류가 나면 runner의 오류 수집이 보고서에 올린다.
 */
import type { Page } from '@playwright/test';

const WEIRD = ['', ' ', '<script>alert(1)</script>', '😀😀😀', 'ㅁㅁㅁㅁㅁㅁㅁㅁㅁㅁㅁㅁㅁㅁㅁㅁㅁㅁㅁㅁㅁㅁㅁㅁㅁㅁㅁㅁ', '-1', '99999999999', '０', 'a'.repeat(300), "'; DROP TABLE--"];

export interface ChaosStats { clicks: number; dbl: number; burst: number; typed: number; keys: number; reloads: number; backs: number; fails: number; sample: string[]; strays: number; home: string }
export const newChaosStats = (): ChaosStats => ({ clicks: 0, dbl: 0, burst: 0, typed: 0, keys: 0, reloads: 0, backs: 0, fails: 0, sample: [], strays: 0, home: '' });

export async function chaosAct(p: Page, rand: () => number, st: ChaosStats): Promise<string> {
  const what = await act(p, rand, st);
  // 아이가 앱 밖(빈 페이지·다른 화면)으로 나가 버리면 처음 받은 주소를 다시 열어 돌아온다(실제 학생도 그렇게 한다)
  try {
    const u = p.url();
    if (!st.home && /#\/play/.test(u)) st.home = u;
    if (st.home && (!/#\/play/.test(u) || u.startsWith('about:'))) {
      st.strays++;
      await p.goto(st.home, { timeout: 10_000 });
      return `${what} → 앱 밖으로 나가 주소 다시 열기`;
    }
  } catch { /* 다음 훑기에서 */ }
  return what;
}

async function act(p: Page, rand: () => number, st: ChaosStats): Promise<string> {
  const r = rand();
  const note = (s: string) => { if (st.sample.length < 25) st.sample.push(s); return s; };
  try {
    if (r < 0.02) { st.reloads++; await p.reload({ timeout: 8000 }); return note('새로 고침'); }
    if (r < 0.03) { st.backs++; await p.goBack({ timeout: 3000 }).catch(() => null); return note('뒤로 가기'); }
    if (r < 0.1) { st.keys++; const k = ['Escape', 'Enter', 'Tab', 'Space', 'ArrowDown', 'Backspace'][Math.floor(rand() * 6)]!; await p.keyboard.press(k); return note(`키 ${k}`); }
    const els = await p.evaluate(() => {
      const out: { i: number; t: string; x: number; y: number; input: boolean }[] = [];
      const q = document.querySelectorAll('button, [role="button"], a[href], input, textarea, select, [data-testid]');
      q.forEach((e, i) => {
        const b = (e as HTMLElement).getBoundingClientRect();
        if (b.width < 4 || b.height < 4 || b.bottom < 0 || b.right < 0 || b.top > innerHeight || b.left > innerWidth) return;
        const tag = e.tagName.toLowerCase();
        out.push({ i, t: (e.getAttribute('data-testid') || (e as HTMLElement).innerText || tag).trim().slice(0, 30), x: b.left + b.width / 2, y: b.top + b.height / 2, input: tag === 'input' || tag === 'textarea' });
      });
      return out;
    });
    if (!els.length) { await p.mouse.click(Math.floor(rand() * 600) + 20, Math.floor(rand() * 500) + 20); st.clicks++; return note('빈 화면 클릭'); }
    const e = els[Math.floor(rand() * els.length)]!;
    if (e.input && rand() < 0.7) {
      st.typed++;
      await p.mouse.click(e.x, e.y, { timeout: 2000 } as never).catch(() => undefined);
      await p.keyboard.press('Control+A');
      await p.keyboard.type(WEIRD[Math.floor(rand() * WEIRD.length)]!, { delay: 0 });
      return note(`입력 ${e.t}`);
    }
    const m = rand();
    if (m < 0.15) { st.dbl++; await p.mouse.dblclick(e.x, e.y); return note(`더블클릭 ${e.t}`); }
    if (m < 0.3) { st.burst++; for (let i = 0; i < 8; i++) await p.mouse.click(e.x, e.y); return note(`연타x8 ${e.t}`); }
    st.clicks++;
    await p.mouse.click(e.x, e.y);
    return note(`클릭 ${e.t}`);
  } catch (err) {
    st.fails++;
    return `실패 ${String(err).slice(0, 80)}`;
  }
}
