/**
 * 잡지 표지 「이달의 기업」 틀(작업 174, PRD 6.14.3, 교과서 p.113). 학생 미리보기와 공용 화면 갤러리가 함께 쓴다.
 *
 * - 크기는 부모 너비를 따르고(세로 = 너비 × 1.414, A4 세로), 글자는 컨테이너 단위(cqw)로 비례한다.
 * - 배경: `cover/bg-1~3.png`(없으면 같은 번호의 단색 — data/magazine.ts). 제목 "우리나라 대표 기업을 알아보는 / 이달의 기업"(p.113 문구).
 * - 회사 이름·깃발·(학생 화면이면) 선장 그림, 6칸 글, (학생 화면이면) 아래 '항해 기록' 띠(수출액·사고판 항구 — 개척 지표와 같은 값(작업 178)·받은 상).
 * - 공용 화면에는 교사가 고른 표지의 회사 이름·깃발·6칸 글·배경 번호만 온다(띠·선장 없음).
 */
import { useState } from 'preact/hooks';
import { magazineBackgrounds, magazineFields, magazineTitle } from '../../data/magazine';
import { img } from '../common/asset';
import { FlagIcon } from '../common/FlagIcon';
import './magazine.css';

export interface MagazineCoverCardProps {
  company: string | null;
  flag: { color: string; emblem: string };
  /** 6칸 글(빈 칸은 연한 안내 글) */
  fields: readonly string[];
  /** 배경 번호 1~3 */
  bg: number;
  /** 선장 그림(characters/captain-n) — 없으면 그리지 않음 */
  avatar?: string | null;
  /** 아래 '항해 기록' 띠(학생 화면만) */
  record?: { exports: number; ports: number; awards: readonly string[] } | null;
  /** 빈 칸에 칸 이름을 연하게 보일지(학생 미리보기) */
  hints?: boolean;
  testId?: string;
}

function Bg({ no }: { no: number }) {
  const def = magazineBackgrounds.find((b) => b.no === no) ?? magazineBackgrounds[0];
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <div class="mz-bg" style={{ background: def.color }} data-bg={def.no}>
      {failed !== def.image && <img class="mz-bg__img" src={img(def.image)} alt="" decoding="async" onError={() => setFailed(def.image)} />}
    </div>
  );
}

function Avatar({ path }: { path: string }) {
  const [gone, setGone] = useState(false);
  if (gone) return null;
  return <img class="mz-captain" src={img(`characters/${path}.png`)} alt="" decoding="async" onError={() => setGone(true)} />;
}

export function MagazineCoverCard({ company, flag, fields, bg, avatar, record, hints, testId }: MagazineCoverCardProps) {
  const f = (i: number) => (fields[i] ?? '').trim();
  const text = (i: number, cls: string) => {
    const v = f(i);
    if (!v && !hints) return null;
    return (
      <div class={`mz-field ${cls}${v ? '' : ' mz-field--empty'}`} data-field={i + 1}>
        <span class="mz-field__label">{magazineFields[i].short}</span>
        <span class="mz-field__text">{v || '…'}</span>
      </div>
    );
  };
  return (
    <div class="mz-wrap" data-testid={testId ?? 'magazine-cover'}>
      <article class="mz-cover" aria-label={`잡지 표지: ${magazineTitle.title} ${company ?? ''}`}>
        <Bg no={bg} />
        <header class="mz-head">
          <p class="mz-kicker">{magazineTitle.kicker}</p>
          <h3 class="mz-title title-font">{magazineTitle.title}</h3>
        </header>
        <div class="mz-company">
          <FlagIcon color={flag.color} emblem={flag.emblem} size={48} />
          <span class="mz-company__name title-font" data-testid="magazine-company">
            {company ?? '이름 짓는 중'}
          </span>
        </div>
        <div class="mz-main">
          {text(0, 'mz-field--hero')}
          {text(1, '')}
          {text(2, '')}
        </div>
        <div class="mz-side">
          {text(3, '')}
          {text(4, '')}
          {text(5, '')}
        </div>
        {avatar && <Avatar path={avatar} />}
        {record && (
          <footer class="mz-record" data-testid="magazine-record">
            <b>항해 기록</b>
            <span>수출액 {record.exports.toLocaleString('ko-KR')}만 원</span>
            <span>사고판 항구 {record.ports}곳</span>
            <span>받은 상 {record.awards.length ? record.awards.join(', ') : '—'}</span>
          </footer>
        )}
      </article>
    </div>
  );
}

export default MagazineCoverCard;
