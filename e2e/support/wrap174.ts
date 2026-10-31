import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';

/**
 * (작업 174) 마무리 e2e 공통: 학생 마무리 행동(컨테이너 싣기 → 자기 평가, 되돌아보기 입력·복사·보내기, 잡지 표지 게임 쓰기),
 * TV 1920×1080 안 검사, 스크린숏(.orch/tasks/174-finale-ox-awards-cover/shots/). lesson4-full·unit-full이 함께 쓴다.
 */
export interface WrapSeen {
  cards: Set<string>;
  shots: Set<string>;
  helpers: Map<string, string>;
}
export const SHOTS174 = process.env.SHOT_DIR_174 ?? join(process.cwd(), '.orch', 'tasks', '174-finale-ox-awards-cover', 'shots');
export async function shot174(page: Page, name: string) {
  mkdirSync(SHOTS174, { recursive: true });
  await page.evaluate(() => document.fonts.ready).catch(() => undefined);
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(SHOTS174, name) });
}
/** 학생별 컨테이너 싣기(옳은 문장 = 1·5·7·8): 1번 전부 맞힘, 2번 하나 틀림, 3번 하나만 */
export const LOADS: Record<string, number[]> = { s1: [1, 5, 7, 8], s2: [1, 2, 5], s3: [7], s4: [1, 5, 7], s5: [5, 8] };

/** (작업 178) LOADS로 계산한 TV 문장별 정답률(%) — 학생 수가 바뀌어도 기대값이 맞게 */
export function expectedContainerPct(labels: readonly string[]): string {
  const correct = [1, 5, 7, 8];
  return [1, 2, 3, 4, 5, 6, 7, 8]
    .map((no) => Math.round((labels.filter((l) => (LOADS[l] ?? []).includes(no) === correct.includes(no)).length / labels.length) * 100))
    .join(',');
}
export const COVER_TEXT = (label: string) => [`${label}반도체`, `${label}작고 빨라요`, '베트남', `${label}환경을 지키는 기업`, `${label}정당한 임금을 줘요`, `${label}협력해요`];

/** (작업 174) 마무리 학생 화면: 컨테이너 싣기 → 자기 평가, 되돌아보기 입력·복사·보내기, 잡지 표지 게임 쓰기 */
export async function wrapTidy(s: Page, seen: WrapSeen, label: string, P: string) {
  const sec = s.getByTestId('wrap-containers');
  if (await sec.isVisible().catch(() => false)) {
    const step = await sec.getAttribute('data-step');
    if (step === 'load') {
      if (label === 's1' && !seen.shots.has('w-containers-load')) {
        seen.shots.add('w-containers-load');
        await shot174(s, `${P}-student-containers-load.png`);
      }
      for (const no of LOADS[label] ?? []) await s.locator(`[data-testid="container"][data-no="${no}"][data-where="yard"]`).click();
      await expect(s.getByTestId('containers-truck')).toHaveAttribute('data-count', String((LOADS[label] ?? []).length));
      if (label === 's1' && !seen.shots.has('w-containers-truck')) {
        seen.shots.add('w-containers-truck');
        await shot174(s, `${P}-student-containers-truck.png`);
      }
      await s.getByTestId('containers-submit').click();
      await expect(sec).toHaveAttribute('data-step', 'graded');
      seen.cards.add(`containers-score:${label}:${(await s.getByTestId('containers-score').innerText()).trim()}`);
      if (label === 's2') await shot174(s, `${P}-student-containers-graded.png`);
      await s.getByTestId('containers-next').click();
      await expect(sec).toHaveAttribute('data-step', 'self');
      const qs = await s.getByTestId('self-eval').count();
      for (let i = 0; i < qs; i++) await s.getByTestId('self-eval').nth(i).locator(`[data-star="${(i % 3) + 1}"]`).click();
      if (label === 's1') await shot174(s, `${P}-student-containers-self.png`);
      await s.getByTestId('containers-finish').click();
      await expect(s.getByTestId('containers-done')).toBeVisible();
      if (label === 's1') {
        seen.helpers.set(`${label}:containerResult`, (await s.getByTestId('containers-worksheet').innerText().catch(() => '')).trim());
        await shot174(s, `${P}-student-containers-done.png`);
      }
      seen.cards.add(`containers-done:${label}`);
    }
  }
  const rf = s.getByTestId('wrap-reflect');
  if ((await rf.isVisible().catch(() => false)) && !(await s.getByTestId('reflect-sent').isVisible().catch(() => false))) {
    const n = await s.getByTestId('reflect-input').count();
    seen.cards.add(`reflect-inputs:${n}`);
    for (let i = 0; i < n; i++) await s.getByTestId('reflect-input').nth(i).fill(`${label} ${i + 1}번 생각을 한 줄로 써요`);
    if (label === 's1') {
      await s.getByTestId('reflect-copy').click();
      await expect(s.getByTestId('reflect-copied').or(s.getByTestId('reflect-copy-box'))).toBeVisible();
      seen.cards.add('reflect-copy');
      seen.helpers.set('s1:voyageSummary', (await s.getByTestId('wrap-reflect-helper').innerText().catch(() => '')).trim());
      await shot174(s, `${P}-student-reflect.png`);
    }
    await s.getByTestId('reflect-submit').click();
    await expect(s.getByTestId('reflect-sent')).toBeVisible();
    seen.cards.add(`reflect-sent:${label}`);
  }
  const mg = s.getByTestId('wrap-magazine');
  if (await mg.isVisible().catch(() => false)) {
    const mode = await mg.getAttribute('data-mode');
    if (mode === 'paper' && !seen.cards.has(`magazine-paper:${label}`)) {
      seen.cards.add(`magazine-paper:${label}`);
      if (label === 's1') await shot174(s, `${P}-student-magazine-paper.png`);
    }
    if (mode === 'game' && !(await s.getByTestId('magazine-sent').isVisible().catch(() => false))) {
      const vals = COVER_TEXT(label);
      for (let i = 0; i < 6; i++) await s.locator(`[data-testid="magazine-input"][data-no="${i + 1}"]`).fill(vals[i]!);
      await s.locator(`[data-testid="magazine-bg"][data-bg="${label === 's1' ? 3 : 2}"]`).click();
      if (label === 's1') await shot174(s, `${P}-student-magazine-preview.png`);
      if (label === 's1') await s.getByTestId('magazine-preview').screenshot({ path: join(SHOTS174, `${P}-student-magazine-preview-card.png`) });
      await s.getByTestId('magazine-submit').click();
      await expect(s.getByTestId('magazine-sent')).toBeVisible();
      seen.cards.add(`magazine-sent:${label}`);
    }
  }
}

/** (작업 174) TV 요소가 1080 안에 잘리지 않고 들어오는가 */
export async function inside1080(scr: Page, testId: string) {
  const els = scr.getByTestId(testId);
  const n = await els.count();
  for (let i = 0; i < n; i++) {
    const b = await els.nth(i).boundingBox();
    expect(b && b.y >= 0 && b.y + b.height <= 1080 && b.x >= 0 && b.x + b.width <= 1920, `TV ${testId}[${i}] 1920×1080 안 (${JSON.stringify(b)})`).toBe(true);
  }
}

/**
 * (작업 174) 마무리 한 걸음(교사 큰 버튼을 누르기 전): 학생 행동 → TV 장면 확인·스크린숏 → 필요하면 교사 고르기([게임에서 써요]·표지 고르기).
 * 'continue' = 교사가 무엇을 눌렀으니 큰 버튼은 다음 걸음에, 'press' = 이제 큰 버튼을 누른다.
 */
export async function wrapRound(o: { t: Page; scr: Page; students: Page[]; seen: WrapSeen; scenes: Set<string>; P: string; line: string; tick: (sec: number) => Promise<void> }): Promise<'continue' | 'press'> {
  const { t, scr, students, seen, scenes, P, line } = o;
  const s1 = students[0]!;
  const visible = (p: Page, id: string) => p.getByTestId(id).first().isVisible().catch(() => false);
  for (const [i, s] of students.entries()) await wrapTidy(s, seen, `s${i + 1}`, P);
  await o.tick(2);
  // (작업 178) '마지막 항해예요' 강조 줄이 보였는지(4차시 앞 시간 판에는 없어야)
  if (await s1.getByTestId('wrap-awards').isVisible().catch(() => false)) seen.cards.add(`half-cargo:${await s1.getByTestId('wrap-half-cargo').isVisible().catch(() => false)}`);
  const wrapScene = (await scr.getByTestId('route-screen').getAttribute('data-scene')) ?? '';
  scenes.add(wrapScene);
  if (wrapScene === 'containers') {
    const result = await scr.getByTestId('scene-containers').getAttribute('data-result');
    if (result === '0') {
      await expect(scr.getByTestId('containers-count')).toContainText(`${students.length}/${students.length}`);
      if (!seen.shots.has('w-tv-containers')) {
        seen.shots.add('w-tv-containers');
        await shot174(scr, `${P}-tv-containers.png`);
      }
    } else if (!seen.shots.has('w-tv-containers-result')) {
      seen.shots.add('w-tv-containers-result');
      await inside1080(scr, 'containers-row');
      seen.cards.add(`tv-containers-pct:${(await scr.locator('[data-testid="containers-row"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-pct')).join(',')))}`);
      await shot174(scr, `${P}-tv-containers-result.png`);
    }
  }
  if (wrapScene === 'awards') {
    const mode = (await scr.getByTestId('scene-awards').getAttribute('data-mode')) ?? '';
    const shown = (await scr.getByTestId('scene-awards').getAttribute('data-shown')) ?? '';
    const metric = (await scr.getByTestId('scene-awards').getAttribute('data-metric')) ?? '';
    seen.cards.add(`tv-award:${mode}:${shown}:${metric}`);
    if (!seen.shots.has(`w-tv-award-${mode}-${shown}`)) {
      seen.shots.add(`w-tv-award-${mode}-${shown}`);
      await inside1080(scr, 'award-card');
      await shot174(scr, `${P}-tv-awards-${mode}${shown ? `-${shown}` : ''}.png`);
    }
    // 학생 화면: 아직 공개 안 된 상은 보이지 않는다(공개된 수만큼만 목록)
    const listed = await s1.locator('[data-testid="wrap-award-list"] li').count();
    if (mode === 'intro') expect(listed, '시상 시작 전 학생 목록').toBe(0);
    if (mode === 'one') expect(listed, `공개 ${shown}개 = 학생 목록`).toBe(Number(shown));
    for (const [i, s] of students.entries()) {
      if ((await visible(s, 'wrap-my-awards')) && !seen.cards.has(`cheer:s${i + 1}`)) {
        seen.cards.add(`cheer:s${i + 1}`);
        await shot174(s, `${P}-student-cheer-s${i + 1}.png`);
      }
    }
    if (mode === 'list') {
      seen.cards.add('tv-award-list');
      if (await visible(s1, 'wrap-metrics')) {
        const ids = await s1.locator('[data-testid="wrap-metrics"] li').evaluateAll((els) => els.map((e) => e.getAttribute('data-metric') ?? ''));
        seen.cards.add(`metrics:${ids.join(',')}`);
      }
    }
  }
  if (wrapScene === 'reflect' && !seen.shots.has('w-tv-reflect')) {
    seen.shots.add('w-tv-reflect');
    await shot174(scr, `${P}-tv-reflect.png`);
  }
  if (wrapScene === 'gallery') {
    const mode = await scr.getByTestId('scene-gallery').getAttribute('data-mode');
    if (mode === 'paper' && !seen.shots.has('w-tv-gallery-paper')) {
      seen.shots.add('w-tv-gallery-paper');
      await shot174(scr, `${P}-tv-gallery-paper.png`);
      await shot174(t, `${P}-teacher-magazine.png`);
      // 종이로 한 번 본 뒤 [게임에서 써요]
      await t.getByTestId('now-magazine-game').click();
      await o.tick(2);
      return 'continue';
    }
    if (mode === 'game') {
      const tvText = await scr.evaluate(() => document.body.innerText);
      const cover = (await scr.getByTestId('scene-gallery').getAttribute('data-cover')) ?? '';
      if (!cover) {
        // 교사가 고르기 전: TV에 학생 글이 없다
        for (const l of ['s1', 's2', 's3']) for (const v of COVER_TEXT(l)) if (v !== '베트남') expect(tvText.includes(v), `고르기 전 TV에 학생 글 "${v}"`).toBe(false);
        if (seen.cards.has('magazine-sent:s3') && !seen.cards.has('cover-picked')) {
          await shot174(scr, `${P}-tv-gallery-before-pick.png`);
          seen.cards.add('cover-picked');
          await expect(t.getByTestId('cover-picker')).toBeVisible();
          await shot174(t, `${P}-teacher-cover-picker.png`);
          await t.locator('[data-testid="cover-row"][data-seat="1"] [data-testid="cover-pick"]').click();
          await o.tick(2);
          return 'continue';
        }
      } else if (!seen.shots.has('w-tv-gallery')) {
        seen.shots.add('w-tv-gallery');
        expect(tvText).toContain('s1반도체');
        expect(tvText).not.toContain('s2반도체');
        await inside1080(scr, 'gallery-cover');
        await shot174(scr, `${P}-tv-gallery.png`);
        seen.cards.add('tv-gallery');
      }
    }
  }
  if (!seen.shots.has(`w-teacher-${line}`)) {
    seen.shots.add(`w-teacher-${line}`);
    await shot174(t, `${P}-teacher-${line.replace(/[^가-힣A-Za-z0-9]+/g, '_').slice(0, 30)}.png`);
  }
  await t.bringToFront();
  return 'press';
}
