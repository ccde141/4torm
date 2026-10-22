import { useCallback, useEffect, useRef, useState } from 'react';
import { subscribeCycloneChanges } from '../pages/cyclone-change-client';
import { readWorkshopConsole } from './workshop-console-client';
import type { WorkshopConsoleSnapshot } from './workshop-console-model';

/** One bounded summary read for the selected workshop; cards never fetch histories separately. */
export function useWorkshopConsole(workshopId: string, active: boolean) {
  const [snapshot, setSnapshot] = useState<WorkshopConsoleSnapshot | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const selected = useRef(workshopId); selected.current = workshopId;
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const refresh = useCallback(() => refreshRef.current(), []);

  useEffect(() => {
    let stopped = false;
    let pending = false;
    let again = false;
    let timer: number | undefined;
    const run = async (): Promise<void> => {
      if (stopped || !active) return;
      if (pending) { again = true; return; }
      pending = true;
      if (timer !== undefined) window.clearTimeout(timer);
      setRefreshing(true);
      try {
        const next = await readWorkshopConsole(workshopId);
        if (stopped || selected.current !== workshopId) return;
        setSnapshot(current => JSON.stringify(current) === JSON.stringify(next) ? current : next);
        setError('');
      } catch (cause) {
        if (!stopped && selected.current === workshopId) setError(String((cause as Error).message || cause));
      } finally {
        pending = false;
        if (!stopped && selected.current === workshopId) {
          setRefreshing(false);
          if (again) { again = false; void run(); }
          else timer = window.setTimeout(() => void run(), 5_000);
        }
      }
    };
    refreshRef.current = run;
    if (active) void run();
    const unsubscribe = active ? subscribeCycloneChanges(event => {
      if (event.type === 'sync' || (event.type === 'change' && event.workshopId === workshopId)) void run();
    }) : () => {};
    return () => {
      stopped = true;
      unsubscribe();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [active, workshopId]);

  return { snapshot: snapshot?.workshopId === workshopId ? snapshot : null, error, refreshing, refresh };
}
