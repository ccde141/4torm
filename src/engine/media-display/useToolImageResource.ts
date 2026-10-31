import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { inspectToolImageFailure, type ToolImageFailure } from './tool-image-failure';

interface Owner { url: string; active: boolean; attempt: number; live: boolean; request?: AbortController }
interface Outcome { owner: Owner; loaded?: boolean; failure?: ToolImageFailure | 'checking' }

/** Closing/hiding/changing an image cancels its status check and invalidates late load events. */
export function useToolImageResource(url: string, active: boolean) {
  const [attempt, setAttempt] = useState(0);
  const [outcome, setOutcome] = useState<Outcome>();
  const owner = useMemo<Owner>(() => ({ url, active, attempt, live: true }), [url, active, attempt]);
  const latest = useRef(owner);
  latest.current = owner;
  const current = useCallback(() => owner.active && latest.current === owner && owner.live, [owner]);
  const state = outcome?.owner === owner ? outcome : undefined;
  const onError = useCallback(() => {
    if (!current() || (owner.request && !owner.request.signal.aborted)) return;
    const controller = new AbortController();
    owner.request = controller;
    setOutcome({ owner, failure: 'checking' });
    const mayApply = () => current() && owner.request === controller && !controller.signal.aborted;
    void inspectToolImageFailure(owner.url, controller.signal).then(failure => {
      if (mayApply()) setOutcome({ owner, failure });
    }).catch(error => {
      if (mayApply()) { console.warn('[tool-image] 图片状态核对失败', error);
        setOutcome({ owner, failure: 'network' }); }
    });
  }, [owner, current]);
  useEffect(() => {
    owner.live = true;
    // StrictMode may replay setup after cancelling an early read-only status check.
    if (owner.request?.signal.aborted) onError();
    return () => { owner.live = false; owner.request?.abort(); };
  }, [owner, onError]);
  return { attempt, failure: state?.failure,
    phase: !active ? 'idle' : state?.failure ? 'error' : state?.loaded ? 'loaded' : 'loading',
    onLoad: () => { if (current()) setOutcome({ owner, loaded: true }); }, onError,
    retry: () => setAttempt(value => value + 1) };
}
