import { useEffect, useState } from 'react';
import { emptyWorkshopOperations, readWorkshopOperations,
  type WorkshopOperationStatus } from './workshop-operation-status';
import { subscribeCycloneChanges } from './cyclone-change-client';

export interface WorkshopOperationUncertainty {
  seats: ReadonlySet<string>;
  rooms: ReadonlySet<string>;
}

export interface WorkshopOperationView {
  operations: WorkshopOperationStatus;
  uncertain: WorkshopOperationUncertainty;
  error: string;
}

interface ScopedView extends WorkshopOperationView {
  workshopId: string;
}

const emptyUncertainty = (): WorkshopOperationUncertainty => ({ seats: new Set(), rooms: new Set() });
const emptyView = (): WorkshopOperationView => ({
  operations: emptyWorkshopOperations(), uncertain: emptyUncertainty(), error: '',
});

export function successfulWorkshopOperationView(
  workshopId: string, operations: WorkshopOperationStatus,
): ScopedView {
  return { workshopId, operations, uncertain: emptyUncertainty(), error: '' };
}

export function failedWorkshopOperationView(
  previous: ScopedView | null, workshopId: string, cause: unknown,
): ScopedView {
  const prior = previous?.workshopId === workshopId ? previous : null;
  const seats = new Set(prior?.uncertain.seats);
  const rooms = new Set(prior?.uncertain.rooms);
  for (const [id, item] of prior?.operations.seats ?? []) {
    if (isActive(item.status)) seats.add(id);
  }
  for (const [id, item] of prior?.operations.rooms ?? []) {
    if (isActive(item.status)) rooms.add(id);
  }
  return { workshopId, operations: emptyWorkshopOperations(),
    uncertain: { seats, rooms },
    error: cause instanceof Error && cause.message ? cause.message : '工作室运行状态读取失败',
  };
}

function isActive(status: string): boolean {
  return status === 'queued' || status === 'running' || status === 'waiting';
}

/** Observe the same Cyclone operation facts used by the central status UI. */
export function useWorkshopOperationStatus(
  workshopId: string | null, enabled: boolean,
): WorkshopOperationView {
  const [scoped, setScoped] = useState<ScopedView | null>(null);

  useEffect(() => {
    if (!enabled || !workshopId) { setScoped(null); return; }
    let stopped = false;
    let timer: number | undefined;
    let polling = false;
    let queued = false;
    const poll = async () => {
      if (polling) { queued = true; return; }
      polling = true;
      let delay = 2_000;
      try {
        const operations = await readWorkshopOperations(workshopId);
        if (stopped) return;
        const active = [...operations.seats.values(), ...operations.rooms.values()]
          .some(item => item.status === 'running' || item.status === 'queued');
        delay = active ? 1_000 : 2_000;
        setScoped(successfulWorkshopOperationView(workshopId, operations));
      } catch (cause) {
        if (stopped) return;
        console.error('[cyclone] 读取工作室中心运行状态失败', cause);
        setScoped(current => failedWorkshopOperationView(current, workshopId, cause));
      } finally {
        polling = false;
        if (!stopped) {
          timer = window.setTimeout(poll, queued ? 0 : delay);
          queued = false;
        }
      }
    };
    void poll();
    const unsubscribe = subscribeCycloneChanges(event => {
      if (event.type !== 'sync' && !(event.type === 'change'
        && event.workshopId === workshopId)) return;
      if (timer !== undefined) window.clearTimeout(timer);
      void poll();
    });
    return () => {
      stopped = true;
      unsubscribe();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [enabled, workshopId]);

  return enabled && scoped?.workshopId === workshopId ? scoped : emptyView();
}
