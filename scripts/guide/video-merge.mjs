// 작업 154 — 다른 빌드로 다시 찍은 화면 몇 장을 본 촬영 결과에 바꿔 넣는다.
// 예: 작업 158(두 섬 → ㉮ 나라와 ㉯ 나라) 뒤 빌드로 찍은 tmp/video-158의 두 나라 장면·학습지 ③을 tmp/video로.
// 실행(프로젝트 루트): node scripts/guide/video-merge.mjs <원본 폴더> <id> [id…]
//   예) node scripts/guide/video-merge.mjs tmp/video-158 a-s-ti-1 a-s-ti-2 a-s-ti-3 a-s-ws-W03 a-tv-ti-result
// 대상 폴더는 VIDEO_OUT(기본 tmp/video). 바꾼 기록에는 from(원본 폴더)이 붙는다.
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DST = process.env.VIDEO_OUT ?? join(ROOT, 'tmp', 'video');
const [srcArg, ...ids] = process.argv.slice(2);
if (!srcArg || !ids.length) throw new Error('사용법: node scripts/guide/video-merge.mjs <원본 폴더> <id> [id…]');
const SRC = resolve(ROOT, srcArg);
const src = JSON.parse(readFileSync(join(SRC, 'shots.json'), 'utf8'));
const dst = JSON.parse(readFileSync(join(DST, 'shots.json'), 'utf8'));
for (const id of ids) {
  const rec = src.shots.find((s) => s.id === id);
  if (!rec) {
    console.log(`없음: ${id}`);
    continue;
  }
  copyFileSync(join(SRC, rec.file), join(DST, rec.file));
  const out = { ...rec, from: srcArg.replace(/\\/g, '/') };
  const i = dst.shots.findIndex((s) => s.id === id);
  if (i >= 0) dst.shots[i] = out;
  else dst.shots.push(out);
  console.log(`바꿈: ${id}`);
}
dst.merged = [...new Set([...(dst.merged ?? []), ...ids.map((id) => `${id} ← ${srcArg}`)])];
writeFileSync(join(DST, 'shots.json'), JSON.stringify(dst, null, 2));
