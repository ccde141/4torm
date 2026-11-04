import { useEffect, useRef, useState } from 'react';
import { listWorkRecords, type WorkRecordPage } from '../../api/work-records';
import type { MessageKey } from '../../i18n/locale';
import { mergeWorkRecords, workRecordError } from './work-record-view';

export function useWorkRecords(agentId: string) {
  const [filters, setFilters] = useState({ query: '', date: '' });
  const [refresh, setRefresh] = useState(0);
  const [page, setPage] = useState<WorkRecordPage>({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<MessageKey>();
  const controller = useRef<AbortController | null>(null);
  const fetching = useRef(false);
  const scope = { query: filters.query || undefined, date: filters.date || undefined };
  useEffect(() => {
    const request = new AbortController(); controller.current = request;
    fetching.current = true; setLoading(true); setError(undefined); setPage({ items: [], total: 0 });
    listWorkRecords(agentId, { query: filters.query || undefined, date: filters.date || undefined }, request.signal)
      .then(result => { if (!request.signal.aborted) setPage(result); })
      .catch(cause => { if (!request.signal.aborted) setError(workRecordError(cause)); })
      .finally(() => { if (!request.signal.aborted) { fetching.current = false; setLoading(false); } });
    return () => request.abort();
  }, [agentId, filters.query, filters.date, refresh]);
  async function more() {
    const request = controller.current;
    if (!request || request.signal.aborted || fetching.current || !page.nextCursor) return;
    fetching.current = true; setLoading(true); setError(undefined);
    try {
      const next = await listWorkRecords(agentId, { ...scope, cursor: page.nextCursor }, request.signal);
      if (!request.signal.aborted) setPage(previous => ({ ...next, items: mergeWorkRecords(previous.items, next.items) }));
    } catch (cause) { if (!request.signal.aborted) setError(workRecordError(cause)); }
    finally { if (!request.signal.aborted) { fetching.current = false; setLoading(false); } }
  }
  return { page, loading, error, filters, more,
    search: (query: string, date: string) => { setFilters({ query: query.trim(), date }); setRefresh(value => value + 1); },
    reload: () => setRefresh(value => value + 1) };
}
