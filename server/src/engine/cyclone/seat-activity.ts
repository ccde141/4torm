/** In-memory live events for seat work started outside the seat chat endpoint. */

export type ExternalSeatActivityKind = 'contact' | 'join-summary';

export interface ExternalSeatActivityEvent {
  seq: number;
  event: Record<string, unknown>;
}

export interface ExternalSeatActivitySnapshot {
  id: string;
  kind: ExternalSeatActivityKind;
  label: string;
  running: boolean;
  startedAt: number;
  events: ExternalSeatActivityEvent[];
  latestSeq: number;
}

interface StoredActivity extends Omit<ExternalSeatActivitySnapshot, 'events' | 'latestSeq'> {
  seq: number;
  events: ExternalSeatActivityEvent[];
  finishedAt?: number;
}

const activities = new Map<string, StoredActivity>();
const MAX_EVENTS = 1_000;
const FINISHED_RETENTION_MS = 30_000;

function key(workshopId: string, seatId: string): string {
  return `${workshopId}/${seatId}`;
}

export interface ExternalSeatActivityHandle {
  emit(event: Record<string, unknown>): void;
  finish(): void;
}

export function beginExternalSeatActivity(
  workshopId: string,
  seatId: string,
  kind: ExternalSeatActivityKind,
  label: string,
): ExternalSeatActivityHandle {
  const activityKey = key(workshopId, seatId);
  const activity: StoredActivity = {
    id: `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    kind,
    label,
    running: true,
    startedAt: Date.now(),
    seq: 0,
    events: [],
  };
  activities.set(activityKey, activity);

  return {
    emit(event) {
      if (!activity.running) return;
      activity.seq += 1;
      activity.events.push({ seq: activity.seq, event });
      if (activity.events.length > MAX_EVENTS) activity.events.splice(0, activity.events.length - MAX_EVENTS);
    },
    finish() {
      if (!activity.running) return;
      activity.running = false;
      activity.finishedAt = Date.now();
    },
  };
}

export function readExternalSeatActivity(
  workshopId: string,
  seatId: string,
  since = 0,
): ExternalSeatActivitySnapshot | null {
  const activityKey = key(workshopId, seatId);
  const activity = activities.get(activityKey);
  if (!activity) return null;
  if (!activity.running && Date.now() - (activity.finishedAt || 0) > FINISHED_RETENTION_MS) {
    activities.delete(activityKey);
    return null;
  }
  return {
    id: activity.id,
    kind: activity.kind,
    label: activity.label,
    running: activity.running,
    startedAt: activity.startedAt,
    events: activity.events.filter(item => item.seq > since),
    latestSeq: activity.seq,
  };
}

export function clearExternalSeatActivities(): void {
  activities.clear();
}
