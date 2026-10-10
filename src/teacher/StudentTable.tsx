/**
 * 학생 표(30명) — 교사 화면 전용(작업 109, PRD 7.5 v0.3.1). 출석번호 + 회사 이름(실명 열 없음).
 * 발표 모드·공용 화면에서는 렌더하지 않는다(Dashboard가 발표 모드면 이 컴포넌트를 그리지 않음).
 */
import { CheckIcon, DashIcon, Dot, DOT, FlagIcon } from './ui';
import {
  FILTERS,
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

export function StudentTable({ rows, filter, sort, onFilter, onSort, onOpen, selected }: StudentTableProps) {
  const counts = filterCounts(rows);
  const shown = sortRows(filterRows(rows, filter), sort);
  return (
    <section class="t-students" aria-label="학생 표" data-testid="student-table-wrap">
      <div class="t-students__bar">
        <span class="t-chip t-chip--sum" data-testid="summary-chip">
          {summaryText(rows)}
        </span>
        <div class="t-filters" role="group" aria-label="필터" data-testid="filters">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              class="t-chip"
              data-testid={`filter-${f.id}`}
              aria-pressed={filter === f.id}
              onClick={() => onFilter(f.id)}
            >
              {f.label}
              {f.id !== 'all' && <span class="t-chip__n">{counts[f.id]}</span>}
            </button>
          ))}
        </div>
        <label class="t-sort">
          정렬
          <select data-testid="sort" value={sort} onChange={(e) => onSort((e.currentTarget as HTMLSelectElement).value as SortId)}>
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div class="t-table-scroll">
        <table class="t-table" data-testid="student-table">
          <thead>
            <tr>
              <th scope="col">번호</th>
              <th scope="col">회사 이름</th>
              <th scope="col">접속</th>
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
                  {r.rejoinRequested && <span class="t-tag">재접속 요청</span>}
                </td>
                <td data-testid="cell-online">
                  <Dot color={r.online ? DOT.green : DOT.gray} label={r.online ? '접속' : '미접속'} />
                  <span class="t-small">{r.online ? '접속' : r.lastSeenAt ? hhmm(r.lastSeenAt) : '미접속'}</span>
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
                <td colSpan={9} class="t-empty">
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
