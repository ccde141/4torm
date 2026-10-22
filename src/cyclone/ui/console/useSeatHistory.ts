import { useCallback, useEffect, useRef, useState } from 'react';
import { subscribeCycloneChanges } from '../pages/cyclone-change-client';
import { readSeatHistory } from './workshop-console-client';
import type { SeatHistoryFilter, SeatHistoryPage } from './workshop-console-model';

/** Keep an expanded history stable while newer events arrive. */
export function useSeatHistory(workshopId: string, seatId: string, filter: SeatHistoryFilter) {
  const [page, setPage] = useState<SeatHistoryPage | null>(null);
  const [busy, setBusy] = useState<'read' | 'more' | null>('read');
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const refreshRef = useRef<() => void>(() => {});
  const moreRef = useRef<() => void>(() => {});
  const refresh = useCallback(() => refreshRef.current(), []);
  const loadMore = useCallback(() => moreRef.current(), []);

  useEffect(() => {
    let stopped = false;
    let expanded = false;
    let changed = false;
    let pending = false;
    let again = false;
    let request = 0;
    let current: SeatHistoryPage | null = null;
    let controller: AbortController | undefined;
    setPage(null); setStale(false); setError(''); setBusy('read');
    const read = async (cursor?: string, replace = false) => {
      if (stopped) return;
      if (pending && !replace) { if (!cursor) again = true; return; }
      controller?.abort(); controller = new AbortController();
      const signal = controller.signal;
      const generation = ++request;
      pending = true; setBusy(cursor ? 'more' : 'read');
      try {
        const next = await readSeatHistory(workshopId, seatId, filter, cursor, signal);
        if (stopped || generation !== request) return;
        if (cursor && current) {
          const existing = new Set(current.items.map(event => event.id));
          current = { ...next, items: [...current.items, ...next.items.filter(event => !existing.has(event.id))] };
          expanded = true;
        } else { current = next; expanded = false; }
        changed = false; setPage(current); setError(''); setStale(false);
      } catch (cause) {
        if (stopped || signal.aborted || generation !== request) return;
        setError(String((cause as Error).message || cause));
        if ((cause as { kind?: string }).kind === 'conflict') { changed = true; again = false; setStale(true); }
      } finally {
        if (!stopped && generation === request) {
          pending = false; setBusy(null);
          if (again) { again = false; if (expanded || changed) setStale(true); else void read(); }
        }
      }
    };
    const updated = () => {
      if (expanded || changed) setStale(true);
      else void read();
    };
    refreshRef.current = () => { again = false; void read(undefined, true); };
    moreRef.current = () => { if (current?.nextCursor) void read(current.nextCursor); };
    void read();
    const unsubscribe = subscribeCycloneChanges(event => {
      if (event.type === 'sync' || (event.type === 'change' && event.workshopId === workshopId)) updated();
    });
    const timer = window.setInterval(() => { if (!expanded && !changed) void read(); }, 15_000);
    return () => { stopped = true; controller?.abort(); unsubscribe(); window.clearInterval(timer); };
  }, [workshopId, seatId, filter]);

  return { page, busy, error, stale, refresh, loadMore };
}
