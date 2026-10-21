import { createContext } from 'preact';
import { useContext, useEffect, useState } from 'preact/hooks';
import type { StudentState, StudentStore } from './store';

export const StoreContext = createContext<StudentStore | null>(null);

export function useStore(): StudentStore {
  const s = useContext(StoreContext);
  if (!s) throw new Error('StudentStore가 없어요');
  return s;
}

export function useStudentState(store: StudentStore): StudentState {
  const [st, setSt] = useState<StudentState>(() => store.getState());
  useEffect(() => store.subscribe(setSt), [store]);
  return st;
}

/** 1초마다 다시 그리기용 지금 시각(서버 시각) */
export function useServerNow(store: StudentStore, everyMs = 1000): number {
  const [now, setNow] = useState(() => store.serverNow());
  useEffect(() => {
    const id = setInterval(() => setNow(store.serverNow()), everyMs);
    return () => clearInterval(id);
  }, [store, everyMs]);
  return now;
}

/** (작업 145) 1초마다 다시 그리기용 기기 시각 — `hostOfflineSince`·`bootingSince`와 같은 시계 */
export function useDeviceNow(everyMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

/** sessionStorage에 기억하는 작은 화면 상태(새로 고침 후 같은 화면) */
export function useSessionValue<T extends string>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      return ((typeof sessionStorage !== 'undefined' && (sessionStorage.getItem(key) as T | null)) || initial) as T;
    } catch {
      return initial;
    }
  });
  const set = (n: T) => {
    setV(n);
    try {
      sessionStorage.setItem(key, n);
    } catch {
      /* 저장 못 해도 계속 */
    }
  };
  return [v, set];
}
