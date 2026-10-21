/**
 * (작업 145, PRD 7.3 v0.3.7·결정 36) [새 방 코드로 들어가기] — 판 끝내기 알림을 못 받아 옛 방 코드로 자동 재입장하며
 * 기다리는 기기가 직접 빠져나가 새 코드를 넣게 한다. 확인 창은 [계속 기다리기]에 기본 포커스.
 */
import { useState } from 'preact/hooks';
import { clearRoomFromUrl } from './EntryScreen';
import { ConfirmDialog } from './overlays';
import type { StudentStore } from './store';

export function RejoinEscapeButton({ store, label, testId, className }: { store: StudentStore; label: string; testId: string; className?: string }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <button type="button" class={`btn btn--secondary${className ? ` ${className}` : ''}`} data-testid={testId} onClick={() => setConfirm(true)}>
        {label}
      </button>
      {confirm && (
        <ConfirmDialog
          title="새 방 코드로 들어갈까요?"
          testId="rejoin-escape-confirm"
          body="선생님 화면의 새 방 코드를 넣는 화면으로 가요. 같은 방 코드를 다시 넣으면 원래 회사로 돌아가요."
          cancelLabel="계속 기다리기"
          okLabel="새 코드 넣기"
          focusCancel
          onCancel={() => setConfirm(false)}
          onOk={() => {
            setConfirm(false);
            clearRoomFromUrl();
            store.leaveForNewCode();
          }}
        />
      )}
    </>
  );
}
