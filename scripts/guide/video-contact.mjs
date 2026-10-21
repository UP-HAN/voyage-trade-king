// 작업 154 — 설명 영상 촬영 검수용 모아 보기. tmp/video/shots.json + raw/*.png → .orch/tasks/154-video-shots/contact/
//  - <id>.jpg      : 가로 640px JPG(q75) 원본 축소
//  - <id>.mark.jpg : 같은 크기에 빨간(press)/파란(look) 표시를 그린 사본(공략집 annotate.mjs 재사용)
//  - ws-W0n.jpg    : 학습지 쪽 그림 축소(있으면)
// 실행(프로젝트 루트): node scripts/guide/video-contact.mjs   (VIDEO_OUT으로 원본 폴더를 바꿀 수 있다)
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { annotate } from './annotate.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = process.env.VIDEO_OUT ?? join(ROOT, 'tmp', 'video');
const OUT = join(ROOT, '.orch', 'tasks', '154-video-shots', 'contact');
const W = 640;

mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (f.endsWith('.jpg')) await rm(join(OUT, f), { force: true });
const tmp = join(SRC, '_contact');
mkdirSync(tmp, { recursive: true });
const { shots } = JSON.parse(readFileSync(join(SRC, 'shots.json'), 'utf8'));
for (const s of shots) {
  const raw = join(SRC, s.file);
  if (!existsSync(raw)) continue;
  await sharp(raw).resize({ width: W }).jpeg({ quality: 75, mozjpeg: true }).toFile(join(OUT, `${s.id}.jpg`));
  const big = join(tmp, `${s.id}.png`);
  await annotate(raw, big, s);
  await sharp(big).resize({ width: W }).jpeg({ quality: 75, mozjpeg: true }).toFile(join(OUT, `${s.id}.mark.jpg`));
}
const ws = join(SRC, 'ws');
if (existsSync(ws)) for (const f of readdirSync(ws)) if (/^W0\d\.png$/.test(f)) await sharp(join(ws, f)).resize({ width: W }).jpeg({ quality: 75, mozjpeg: true }).toFile(join(OUT, `ws-${f.replace('.png', '.jpg')}`));
await rm(tmp, { recursive: true, force: true });
let total = 0;
for (const f of readdirSync(OUT)) total += statSync(join(OUT, f)).size;
console.log(`[contact] ${readdirSync(OUT).length}개, ${(total / 1024 / 1024).toFixed(2)} MB → ${OUT}`);
