/**
 * 교사 시범 화면 라우트(#/demo) — 작업 169.
 *
 * 선생님이 TV로 띄워 부산 공장·항구·사고팔기를 보여 주는 연습 판. 실제 학생 화면(StudentShell)을 그대로 쓰고,
 * 판은 이 페이지 메모리 안에서만 돈다(world.ts). 수업 방의 [잠깐 멈춤]·사건·학습지와 상관없고, 방 코드 입력도 없다.
 * 맨 위 띠: '시범 화면 — 수업과 상관없어요' + [처음부터 다시](시범 판을 새로 만든다).
 */
import { useEffect, useState } from 'preact/hooks';
import { RotateNotice } from '../ui/common/RotateNotice';
import { StudentShell } from '../student/index';
import { FullMessage } from '../student/overlays';
import { createDemoWorld, type DemoWorld } from './world';
import './demo.css';

export function DemoBand({ onReset }: { onReset: () => void }) {
  return (
    <div class="demo-band" role="note" data-testid="demo-band">
      <b class="demo-band__title">시범 화면 — 수업과 상관없어요</b>
      <span class="demo-band__sub">여기서 한 거래는 저장되지 않아요</span>
      <button type="button" class="btn btn--secondary demo-band__reset" data-testid="demo-reset" onClick={onReset}>
        처음부터 다시
      </button>
    </div>
  );
}

/**
 * 시범 판을 새로 만들 때 이 창(탭)의 학생 화면 기억(sessionStorage `voyage.student.*` — 해도/항구 화면, 본 힌트)을 지운다.
 * [처음부터 다시] 뒤 해도에서 시작하게. 이 창 것만 지운다(localStorage·다른 탭과 상관없음).
 */
export function clearStudentViewMemory(storage: Pick<Storage, 'length' | 'key' | 'removeItem'> | null = typeof sessionStorage !== 'undefined' ? sessionStorage : null): void {
  if (!storage) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith('voyage.student.')) keys.push(k);
    }
    for (const k of keys) storage.removeItem(k);
  } catch {
    /* 못 지워도 시범 판은 새로 만든다 */
  }
}

export default function DemoApp() {
  const [gen, setGen] = useState(0);
  const [world, setWorld] = useState<DemoWorld | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setFailed(false);
    clearStudentViewMemory();
    const w = createDemoWorld();
    w.ready.then(
      () => alive && setWorld(w),
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
      setWorld(null);
      w.dispose();
    };
  }, [gen]);

  return (
    <div class="demo-app" data-testid="route-demo">
      <DemoBand onReset={() => setGen((g) => g + 1)} />
      <RotateNotice />
      {failed ? (
        <FullMessage title="시범 화면을 준비하지 못했어요" testId="demo-failed">
          <p>[처음부터 다시]를 누르거나 새로 고침해 주세요.</p>
        </FullMessage>
      ) : world ? (
        <StudentShell key={gen} store={world.store} />
      ) : (
        <p class="route-loading" data-testid="demo-loading">
          시범 판을 준비하는 중…
        </p>
      )}
    </div>
  );
}
