import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale } from '../../../i18n/LocaleContext';
import { createLatestRequestGuard } from '../../../lib/latest-request';
import type { BulletinEntry } from './BulletinBoard';
import { readCycloneError } from './cyclone-page-model';
import { reconcileWorkshopSummary, type WorkshopSnapshot } from './workshop-summary-state';
import { subscribeCycloneChanges } from './cyclone-change-client';

const POLL_MS = 2_000;

/** One selected-workshop summary path for edits made by a person or an Agent. */
export function useWorkshopSummary(workshopId: string | null, active: boolean) {
  const { t } = useLocale();
  const tRef = useRef(t); tRef.current = t;
  const selectedRef = useRef(workshopId); selectedRef.current = workshopId;
  const guard = useRef(createLatestRequestGuard());
  const [snapshot, setSnapshot] = useState<WorkshopSnapshot | null>(null);
  const [error, setError] = useState('');

  const refresh = useCallback(async (id: string) => {
    const request = guard.current.begin();
    try {
      const response = await fetch(`/api/cyclone/workshop/${id}/summary`);
      if (!response.ok) throw new Error(await readCycloneError(response, tRef.current('cyclone.shell.loadWorkshopFailed')));
      const result = await response.json() as Omit<WorkshopSnapshot, 'workshopId' | 'bulletin'> & {
        bulletin?: { entries: BulletinEntry[] };
      };
      if (!request.isCurrent() || selectedRef.current !== id) return;
      const next: WorkshopSnapshot = {
        workshopId: id, seats: result.seats, rooms: result.rooms,
        chairAgentId: result.chairAgentId ?? null, bulletin: result.bulletin?.entries ?? [],
      };
      setSnapshot(current => reconcileWorkshopSummary(current, next));
      setError('');
    } catch (cause) {
      if (request.isCurrent() && selectedRef.current === id) {
        setError((cause as Error).message || tRef.current('cyclone.shell.loadWorkshopFailed'));
      }
    }
  }, []);

  useEffect(() => {
    guard.current.cancel();
    setSnapshot(null);
    setError('');
  }, [workshopId]);
  useEffect(() => {
    if (!active || !workshopId) { guard.current.cancel(); return; }
    let stopped = false;
    let timer: number | undefined;
    const poll = async () => {
      await refresh(workshopId);
      if (!stopped) timer = window.setTimeout(poll, POLL_MS);
    };
    void poll();
    const unsubscribe = subscribeCycloneChanges(event => {
      if (event.type === 'sync' || (event.type === 'change'
        && event.workshopId === workshopId && ['workshop', 'room', 'bulletin', 'activity'].includes(event.scope))) {
        void refresh(workshopId);
      }
    });
    return () => {
      stopped = true;
      unsubscribe();
      if (timer !== undefined) window.clearTimeout(timer);
      guard.current.cancel();
    };
  }, [active, refresh, workshopId]);

  const setBulletin = useCallback((sourceWorkshopId: string, entries: BulletinEntry[]) => {
    setSnapshot(current => current?.workshopId === sourceWorkshopId
      ? { ...current, bulletin: entries } : current);
  }, []);
  return {
    seats: snapshot?.seats ?? [], rooms: snapshot?.rooms ?? [],
    chairAgentId: snapshot?.chairAgentId ?? null, bulletin: snapshot?.bulletin ?? [],
    loadedWorkshopId: snapshot?.workshopId ?? null, error, refresh, setBulletin,
  };
}
