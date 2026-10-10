/**
 * "사용 중인 방 n/최대" 표시(PRD 7.5.1) + 가득 참·점검 안내 상자.
 * 배치: 타이틀(작업 131, poll 없음) · 교사 시작 화면·판 설정(작업 109, poll 있음).
 * 학생 화면(#/play)·공용 화면(#/screen)에는 두지 않는다.
 */
import type { CSSProperties } from 'preact';
import { useServerRooms, type RoomStatus, type RoomStatusKind } from './server-status';

export interface RoomCountProps {
  /** 내부 훅을 쓸 때 주기 읽기(기본 false) */
  poll?: boolean;
  size?: 'small' | 'normal';
  /** 상태를 밖에서 주면 그것을 그린다(109가 같은 상태로 [방 열기]를 끄도록) */
  status?: RoomStatus;
  /** [다시 확인]을 눌렀을 때(밖에서 status를 줄 때 함께 준다) */
  onRefresh?: () => void;
}

/** 상태 점 색(글자와 함께만 쓴다) */
export const ROOM_DOT: Record<Exclude<RoomStatusKind, 'local'>, string> = {
  loading: '#8A8A8A',
  ok: '#2E8B3E',
  busy: '#D9822B',
  full: '#C0392B',
  blocked: '#C0392B',
  unknown: '#8A8A8A',
};

/** 표시 문구(PRD 7.5.1 그대로). `local`은 빈 문자열 */
export function roomCountText(s: RoomStatus): string {
  const n = `${s.rooms ?? ''}/${s.maxRooms ?? ''}`;
  switch (s.kind) {
    case 'loading':
      return '사용 중인 방 확인 중…';
    case 'ok':
      return `사용 중인 방 ${n}`;
    case 'busy':
      return `사용 중인 방 ${n} · 붐벼요`;
    case 'full':
      return `사용 중인 방 ${n} · 가득 찼어요`;
    case 'blocked':
      return `사용 중인 방 ${n} · 점검 중이라 새 방을 열 수 없어요`;
    case 'unknown':
      return '사용 중인 방: 알 수 없음';
    default:
      return '';
  }
}

function Inner({ status, onRefresh, size }: { status: RoomStatus; onRefresh?: () => void; size: 'small' | 'normal' }) {
  if (status.kind === 'local') return null;
  const small = size === 'small';
  const wrap: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '8px',
    margin: 0,
    fontSize: small ? '16px' : '18px',
    lineHeight: 1.4,
    color: 'var(--ink, #2B2318)',
  };
  return (
    <p class="room-count" data-testid="room-count" data-kind={status.kind} aria-live="polite" style={wrap}>
      <span
        aria-hidden="true"
        style={{
          display: 'inline-block',
          width: '12px',
          height: '12px',
          borderRadius: '999px',
          background: ROOM_DOT[status.kind],
          border: '1px solid rgba(43,35,24,0.45)',
          flex: '0 0 auto',
        }}
      />
      <span data-testid="room-count-text">{roomCountText(status)}</span>
      {status.kind === 'unknown' && onRefresh && (
        <button
          type="button"
          class="link-small"
          data-testid="room-count-refresh"
          onClick={onRefresh}
          style={{ fontSize: '16px', minHeight: '48px', color: 'var(--ink, #2B2318)' }}
        >
          다시 확인
        </button>
      )}
    </p>
  );
}

function SelfLoading({ poll, size }: { poll: boolean; size: 'small' | 'normal' }) {
  const { status, refresh } = useServerRooms({ poll });
  return <Inner status={status} onRefresh={refresh} size={size} />;
}

export function RoomCount({ poll = false, size = 'normal', status, onRefresh }: RoomCountProps) {
  if (status) return <Inner status={status} onRefresh={onRefresh} size={size} />;
  return <SelfLoading poll={poll} size={size} />;
}

export const ROOM_FULL_TEXT =
  '지금 서버에 방이 가득 찼어요. 다른 선생님 수업이 끝나 방이 비면 버튼이 다시 켜져요. 오늘 수업은 교과서 활동으로 대신해도 좋아요.';
export const ROOM_BLOCKED_TEXT = '서버 점검 중이라 지금은 새 방을 열 수 없어요. 화면 맨 위 공지를 확인해 주세요.';

/** [방 열기] 아래 안내 상자 — `full`·`blocked`일 때만(작업 109가 배치) */
export function RoomFullNotice({ status }: { status: RoomStatus | null | undefined }) {
  if (!status || (status.kind !== 'full' && status.kind !== 'blocked')) return null;
  return (
    <div
      class="room-full-notice"
      data-testid="room-full-notice"
      data-kind={status.kind}
      role="status"
      style={{
        margin: '8px 0 0',
        padding: '12px 14px',
        border: '2px solid #C0392B',
        borderRadius: 'var(--radius, 10px)',
        background: '#FBEDE9',
        color: 'var(--ink, #2B2318)',
        fontSize: '18px',
        lineHeight: 1.5,
      }}
    >
      {status.kind === 'full' ? ROOM_FULL_TEXT : ROOM_BLOCKED_TEXT}
    </div>
  );
}

export default RoomCount;
