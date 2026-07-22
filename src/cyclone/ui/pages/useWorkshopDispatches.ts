import { useCallback, useEffect, useRef, useState } from 'react';
import type { CycloneDispatch } from './dispatch-timeline';

export type DispatchAction = 'read' | 'include' | 'dismiss';

async function responseError(response: Response): Promise<Error> {
  const body = await response.json().catch(() => ({}));
  return new Error(body?.error || `派发请求失败（HTTP ${response.status}）`);
}

async function fetchWorkshopDispatches(workshopId: string): Promise<CycloneDispatch[]> {
  const response = await fetch(`/api/cyclone/workshop/${workshopId}/dispatches`);
  if (!response.ok) throw await responseError(response);
  return response.json();
}

export function useWorkshopDispatches(workshopId: string | null, enabled: boolean) {
  const [snapshot, setSnapshot] = useState<{ workshopId: string; items: CycloneDispatch[] } | null>(null);
  const requestSeq = useRef(0);
  const dispatches = enabled && snapshot?.workshopId === workshopId ? snapshot.items : [];

  const refresh = useCallback(async (): Promise<void> => {
    if (!workshopId || !enabled) return;
    const seq = ++requestSeq.current;
    const items = await fetchWorkshopDispatches(workshopId);
    if (requestSeq.current === seq) setSnapshot({ workshopId, items });
  }, [workshopId, enabled]);

  useEffect(() => {
    if (!workshopId || !enabled) return;
    let disposed = false;
    const poll = async () => {
      const seq = ++requestSeq.current;
      try {
        const items = await fetchWorkshopDispatches(workshopId);
        if (!disposed && requestSeq.current === seq) setSnapshot({ workshopId, items });
      } catch (error) {
        if (!disposed) console.error('[cyclone] 刷新异步派发失败', error);
      }
    };
    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, 2_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [workshopId, enabled]);

  const act = useCallback(async (
    roomId: string,
    dispatchId: string,
    action: DispatchAction,
  ): Promise<CycloneDispatch> => {
    if (!workshopId) throw new Error('未选择工作室');
    const response = await fetch(
      `/api/cyclone/workshop/${workshopId}/room/${roomId}/dispatches/${dispatchId}/${action}`,
      { method: 'POST' },
    );
    if (!response.ok) throw await responseError(response);
    const updated: CycloneDispatch = await response.json();
    requestSeq.current++;
    setSnapshot(current => current?.workshopId === workshopId
      ? { workshopId, items: current.items.map(item => item.id === updated.id ? updated : item) }
      : current);
    return updated;
  }, [workshopId]);

  return { dispatches, refresh, act };
}

export type WorkshopDispatches = ReturnType<typeof useWorkshopDispatches>;
