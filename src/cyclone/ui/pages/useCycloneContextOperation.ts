import { useEffect, useRef, useState } from 'react';
import { useLocale } from '../../../i18n/LocaleContext';
import type { CompactionActivity } from '../../../components/common/compaction-activity';

/** Navigation drops this view, not the admitted operation; explicit Stop cancels its request. */
export function useCycloneContextOperation(identity: string, reload: (notify?: boolean) => Promise<boolean>) {
  const { t } = useLocale();
  const current = useRef(identity); current.current = identity;
  const mounted = useRef(true);
  const request = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState<CompactionActivity>();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const clear = () => setActivity(undefined);
  const cancel = () => {
    request.current?.abort();
    setActivity(value => value ? { ...value, message: t('compaction.status.checkingStop') } : value);
  };
  async function run(operation: 'compact' | 'reset', invoke: (signal: AbortSignal) => Promise<unknown>): Promise<'completed' | 'stopped' | 'failed'> {
    if (request.current) return 'failed';
    const controller = new AbortController(); request.current = controller;
    const valid = () => mounted.current && current.current === identity && request.current === controller;
    const started: CompactionActivity = { id: `pending-${Date.now()}`, operation,
      phase: 'running', startedAt: Date.now(), updatedAt: Date.now() };
    setBusy(true); setActivity(started);
    try {
      await invoke(controller.signal);
      if (!valid()) return 'failed';
      await reload(true);
      if (valid()) setActivity({ ...started, phase: 'completed', updatedAt: Date.now() });
      return controller.signal.aborted ? 'stopped' : valid() ? 'completed' : 'failed';
    } catch (cause) {
      if (!valid()) return 'failed';
      // A disconnected response alone cannot tell whether the atomic commit won the race.
      const refreshed = await reload(true);
      if (!valid()) return 'failed';
      setActivity(controller.signal.aborted && refreshed ? undefined : { ...started, phase: 'failed', updatedAt: Date.now(),
        message: controller.signal.aborted ? t('compaction.status.unconfirmed')
          : cause instanceof Error ? cause.message : String(cause) });
      return controller.signal.aborted ? 'stopped' : 'failed';
    } finally {
      if (valid()) { setBusy(false); request.current = null; }
    }
  }
  return { busy, activity, run, cancel, clear };
}
