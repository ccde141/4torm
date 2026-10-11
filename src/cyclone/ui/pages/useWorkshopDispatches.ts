import { useCallback, useEffect, useRef, useState } from 'react';
import type { CycloneDispatch } from './dispatch-timeline';
import {
  actOnDispatch,
  markSeatDispatchesRead,
  type DispatchAction,
} from './dispatch-client';
import { subscribeCycloneChanges } from './cyclone-change-client';

export type { DispatchAction } from './dispatch-client';

interface DispatchMessages {
  requestFailed: string;
  noWorkshop: string;
}

const defaultMessages: DispatchMessages = {
  requestFailed: '派发请求失败（HTTP {status}）',
  noWorkshop: '未选择工作室',
};

export async function readDispatchError(response: Response, fallback: string): Promise<Error> {
  const body = await response.json().catch(() => ({}));
  return new Error(body?.error || fallback);
}

const requestFallback = (template: string, status: number) => template.replace('{status}', String(status));

async function fetchWorkshopDispatches(workshopId: string, fallbackTemplate: string): Promise<CycloneDispatch[]> {
  const response = await fetch(`/api/cyclone/workshop/${workshopId}/dispatches`);
  if (!response.ok) throw await readDispatchError(response, requestFallback(fallbackTemplate, response.status));
  return response.json();
}

export function mergeDispatchReadReceipts(
  items: CycloneDispatch[], updated: CycloneDispatch[],
): CycloneDispatch[] {
  if (updated.length === 0) return items;
  const byId = new Map(updated.map(item => [item.id, item]));
  return items.map(item => byId.get(item.id) ?? item);
}

export function useWorkshopDispatches(
  workshopId: string | null,
  enabled: boolean,
  messages: DispatchMessages = defaultMessages,
) {
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const [snapshot, setSnapshot] = useState<{ workshopId: string; items: CycloneDispatch[] } | null>(null);
  const requestSeq = useRef(0);
  const dispatches = enabled && snapshot?.workshopId === workshopId ? snapshot.items : [];

  const refresh = useCallback(async (): Promise<void> => {
    if (!workshopId || !enabled) return;
    const seq = ++requestSeq.current;
    const items = await fetchWorkshopDispatches(workshopId, messagesRef.current.requestFailed);
    if (requestSeq.current === seq) setSnapshot({ workshopId, items });
  }, [workshopId, enabled]);

  useEffect(() => {
    if (!workshopId || !enabled) return;
    let disposed = false;
    const sequence = requestSeq;
    let timer: number | undefined;
    const poll = async () => {
      const seq = ++requestSeq.current;
      try {
        const items = await fetchWorkshopDispatches(workshopId, messagesRef.current.requestFailed);
        if (!disposed && requestSeq.current === seq) setSnapshot({ workshopId, items });
      } catch (error) {
        if (!disposed) console.error('[cyclone] 刷新异步派发失败', error);
      }
    };
    const fallback = async () => {
      await poll();
      if (!disposed) timer = window.setTimeout(fallback, 2_000);
    };
    void fallback();
    const unsubscribe = subscribeCycloneChanges(event => {
      if (event.type === 'sync' || (event.type === 'change'
        && event.workshopId === workshopId && event.scope === 'dispatch')) void poll();
    });
    return () => {
      disposed = true;
      sequence.current++;
      if (timer !== undefined) window.clearTimeout(timer);
      unsubscribe();
    };
  }, [workshopId, enabled]);

  const act = useCallback(async (
    roomId: string,
    dispatchId: string,
    action: DispatchAction,
  ): Promise<CycloneDispatch> => {
    if (!workshopId) throw new Error(messagesRef.current.noWorkshop);
    const updated = await actOnDispatch(workshopId, roomId, dispatchId, action);
    requestSeq.current++;
    setSnapshot(current => current?.workshopId === workshopId
      ? { workshopId, items: current.items.map(item => item.id === updated.id ? updated : item) }
      : current);
    return updated;
  }, [workshopId]);

  const markSeatRead = useCallback(async (seatId: string): Promise<CycloneDispatch[]> => {
    if (!workshopId) throw new Error(messagesRef.current.noWorkshop);
    const updated = await markSeatDispatchesRead(workshopId, seatId);
    requestSeq.current++;
    setSnapshot(current => current?.workshopId === workshopId
      ? { workshopId, items: mergeDispatchReadReceipts(current.items, updated) }
      : current);
    return updated;
  }, [workshopId]);

  return { dispatches, refresh, act, markSeatRead };
}

export type WorkshopDispatches = ReturnType<typeof useWorkshopDispatches>;
