/**
 * 학생 표(30명) — 교사 화면 전용(작업 109, PRD 7.5 v0.3.1). 출석번호 + 회사 이름(실명 열 없음).
 * 발표 모드·공용 화면에서는 렌더하지 않는다(Dashboard가 발표 모드면 이 컴포넌트를 그리지 않음).
 */
import { useRef, useState } from 'preact/hooks';
import { CheckIcon, DashIcon, Dot, DOT, FlagIcon, useDismiss } from './ui';
import {
  FILTERS,
  MORE_FILTERS,
  SORTS,
  filterCounts,
  filterRows,
  moneyText,
  sortRows,
  summaryText,
  type FilterId,
  type SortId,
  type StudentRow,
} from './table';

function YesNo({ v }: { v: boolean | null }) {
  if (v === null) return <span class="t-na" aria-label="해당 없음">·</span>;
  return v ? <CheckIcon /> : <DashIcon />;
}

/** '지금 할 일' 칸(작업 148): 끝냈으면 체크 + 글자, 아직이면 글자만, 할 일 없으면 '·' */
function NowCell({ now }: { now: StudentRow['now'] }) {
  if (now.text === '·') return <span class="t-na" aria-label="해당 없음">·</span>;
  return (
    <>
      {now.done === true && <CheckIcon />}
      <span class="t-small">{now.text}</span>
    </>
  );
}

function hhmm(t: number): string {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export interface StudentTableProps {
  rows: StudentRow[];
  filter: FilterId;
  sort: SortId;
  onFilter: (f: FilterId) => void;
  onSort: (s: SortId) => void;
  onOpen: (seat: number) => void;
  selected: number | null;
}

const labelOf = (id: FilterId) => FILTERS.find((f) => f.id === id)?.label ?? id;

export function StudentTable({ rows, filter, sort, onFilter, onSort, onOpen, selected }: StudentTableProps) {
  const [more, setMore] = useState(false);
  const moreRef = useRef<HTMLSpanElement>(null);
  useDismiss(more, moreRef, () => setMore(false));
  const counts = filterCounts(rows);
  const shown = sortRows(filterRows(rows, filter), sort);
  const moreActive = MORE_FILTERS.includes(filter);
  const chip = (id: FilterId, n?: number) => (
    <button
      key={id}
      type="button"
      class={`t-chip${id === 'help' && (n ?? 0) > 0 ? ' t-chip--help' : ''}`}
      data-testid={`filter-${id}`}
      aria-pressed={filter === id}
      onClick={() => {
        onFilter(id);
        setMore(false);
      }}
    >
      {labelOf(id)}
      {n !== undefined && <span class="t-chip__n">{n}</span>}
    </button>
  );
  return (
    <section class="t-students" id="student-table" aria-label="학생 표" data-testid="student-table-wrap">
      <div class="t-students__bar">
        <span class="t-chip t-chip--sum" data-testid="summary-chip">
          {summaryText(rows)}
        </span>
        <div class="t-filters" role="group" aria-label="필터" data-testid="filters">
          {chip('all')}
          {chip('help', counts.help)}
          <span class="t-more" ref={moreRef}>
            <button type="button" class="t-chip" data-testid="filter-more" aria-expanded={more} aria-pressed={moreActive} onClick={() => setMore((v) => !v)}>
              {moreActive ? `더 보기: ${labelOf(filter)}` : '더 보기'} ▾
            </button>
            {more && (
              <div class="t-more__pop" data-testid="filter-more-list">
                <div class="t-more__chips">{MORE_FILTERS.map((id) => chip(id, counts[id]))}</div>
                <label class="t-sort">
                  정렬
                  <select data-testid="sort" value={sort} onChange={(e) => onSort((e.currentTarget as HTMLSelectElement).value as SortId)}>
                    {SORTS.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          </span>
        </div>
      </div>
      <div class="t-table-scroll">
        <table class="t-table" data-testid="student-table">
          <thead>
            <tr>
              <th scope="col">번호</th>
              <th scope="col">회사 이름</th>
              <th scope="col">들어옴</th>
              <th scope="col">지금 할 일</th>
              <th scope="col">항구</th>
              <th scope="col" class="t-num">자금(만 원)</th>
              <th scope="col">임무</th>
              <th scope="col">응답</th>
              <th scope="col">학습지</th>
              <th scope="col" class="t-num">편지</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.seat} data-testid="student-row" data-seat={r.seat} class={selected === r.seat ? 't-row--sel' : ''}>
                <td class="t-num" data-testid="cell-seat">
                  {r.seat}
                </td>
                <td>
                  <button type="button" class="t-rowbtn" data-testid="cell-company" onClick={() => onOpen(r.seat)}>
                    <FlagIcon color={r.flagColor} />
                    <span class={r.nameStatus === 'blocked' ? 't-blocked' : ''}>{r.companyName}</span>
                  </button>
                  {r.nameStatus === 'checkRealName' && <span class="t-tag t-tag--check">이름 확인</span>}
                  {r.nameStatus === 'blocked' && <span class="t-tag t-tag--blocked">이름 짓는 중</span>}
                  {r.rejoinRequested && <span class="t-tag">다시 들어오기 요청</span>}
                </td>
                <td data-testid="cell-online">
                  <Dot color={r.online ? DOT.green : DOT.gray} label={r.online ? '들어옴' : '안 들어옴'} />
                  <span class="t-small">{r.online ? '들어옴' : r.lastSeenAt ? `${hhmm(r.lastSeenAt)} 나감` : '안 들어옴'}</span>
                </td>
                <td data-testid="cell-now" data-v={r.now.done === null ? 'na' : r.now.done ? 'yes' : 'no'}>
                  <NowCell now={r.now} />
                </td>
                <td>
                  {r.portName}
                  {r.dest && <span class="t-small"> → {r.dest}</span>}
                </td>
                <td class="t-num">{moneyText(r.money)}</td>
                <td>
                  <span class="t-bar" aria-label={`임무 ${r.missionsDone}/${r.missionsTotal}`}>
                    <span class="t-bar__fill" style={{ width: `${r.missionsTotal ? (100 * r.missionsDone) / r.missionsTotal : 0}%` }} />
                  </span>
                  <span class="t-small">
                    {r.missionsDone}/{r.missionsTotal}
                  </span>
                </td>
                <td data-testid="cell-response" data-v={r.responded === null ? 'na' : r.responded ? 'yes' : 'no'}>
                  <YesNo v={r.responded} />
                </td>
                <td>
                  <YesNo v={r.worksheetDone} />
                </td>
                <td class="t-num">{r.lettersRight}</td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={10} class="t-empty">
                  {rows.length === 0 ? '아직 들어온 학생이 없어요.' : '이 조건에 맞는 학생이 없어요.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
