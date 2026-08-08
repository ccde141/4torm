import { useEffect, useState } from 'react';
import { type TaskboardObservation } from './taskboard-observations';

export function useTaskboardObservations(
  scope: 'conversation' | 'cyclone', ownerId: string, enabled: boolean,
): TaskboardObservation[] {
  const [items, setItems] = useState<TaskboardObservation[]>([]);

  useEffect(() => {
    if (!ownerId) {
      setItems([]);
      return;
    }
    let disposed = false;
    let timer: number | undefined;
    let failureRetries = 3;
    const load = async () => {
      const query = new URLSearchParams({ scope, ownerId });
      const response = await fetch(`/api/tools/observations?${query}`);
      if (!response.ok) throw new Error(`observation polling failed: ${response.status}`);
      if (disposed) return false;
      const data = await response.json() as { items?: TaskboardObservation[] };
      const next = data.items || [];
      if (!disposed) setItems(next);
      return next.some(item => item.status === 'running' || item.status === 'waiting' || item.status === 'cancelling');
    };
    const poll = async () => {
      try {
        const hasActive = await load();
        failureRetries = 3;
        if (!disposed && (enabled || hasActive)) timer = window.setTimeout(() => { void poll(); }, 1_000);
      } catch {
        if (!disposed && (enabled || failureRetries-- > 0)) timer = window.setTimeout(() => { void poll(); }, 1_000);
      }
    };
    void poll();
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [scope, ownerId, enabled]);

  return items;
}
