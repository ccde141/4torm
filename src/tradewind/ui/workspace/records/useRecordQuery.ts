import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';

interface QueryState<T> { key: string; data?: T; loading: boolean; error: string }

/** 请求身份变更后立即遮蔽旧结果；卸载与慢请求不能把另一工作流写回来。 */
export function useRecordQuery<T>(key: string, load: () => Promise<T>, refreshKey: string | number = 0) {
  const [state, setState] = useState<QueryState<T>>({ key: '', loading: true, error: '' });
  useEffect(() => {
    let current = true;
    setState(previous => ({ key, loading: true, error: '',
      ...(previous.key === key ? { data: previous.data } : {}) }));
    void load().then(data => {
      if (current) setState({ key, data, loading: false, error: '' });
    }, error => {
      if (current) setState(previous => ({ key, loading: false,
        ...(previous.key === key ? { data: previous.data } : {}),
        error: error instanceof Error ? error.message : String(error) }));
    });
    return () => { current = false; };
  }, [key, load, refreshKey]);
  return state.key === key ? state : { key, loading: true, error: '', data: undefined };
}

export function useVisibleRecordRefresh(enabled: boolean, loading: boolean, advance: Dispatch<SetStateAction<number>>) {
  useEffect(() => {
    if (!enabled || loading) return;
    const timer = setInterval(() => {
      if (!document.hidden) advance(value => value + 1);
    }, 2000);
    return () => clearInterval(timer);
  }, [enabled, loading, advance]);
}
