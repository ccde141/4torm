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
    const load = async () => {
      const query = new URLSearchParams({ scope, ownerId });
      const response = await fetch(`/api/tools/observations?${query}`);
      if (!response.ok || disposed) return;
      const data = await response.json() as { items?: TaskboardObservation[] };
      if (!disposed) setItems(data.items || []);
    };
    void load();
    if (!enabled) return () => { disposed = true; };
    const timer = window.setInterval(() => { void load(); }, 1_000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [scope, ownerId, enabled]);

  return items;
}
