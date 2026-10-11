import type { CycloneExecutionSnapshot } from '../domain/operation-snapshot.js';
import { boundedActivityEvent } from './bounded-activity-event.js';

export interface RoomActivitySnapshot {
  operationId: string;
  runId: string;
  message: string;
  running: boolean;
  latestSeq: number;
  truncated: boolean;
  events: Array<{ seq: number; event: Record<string, unknown> }>;
}

interface StoredActivity extends Omit<RoomActivitySnapshot, 'truncated'> {
  finishedAt?: number;
  contentTruncated?: boolean;
}

export interface RoomActivityHandle {
  emit(event: Record<string, unknown>): void;
  finish(): void;
}

export class CycloneRoomActivity {
  private readonly byRoom = new Map<string, StoredActivity>();
  private readonly maxEvents: number;
  private readonly retentionMs: number;

  constructor(options: { maxEvents?: number; retentionMs?: number } = {}) {
    this.maxEvents = options.maxEvents ?? 2_000;
    this.retentionMs = options.retentionMs ?? 60_000;
  }

  begin(execution: CycloneExecutionSnapshot, message: string): RoomActivityHandle {
    const key = roomKey(execution.workshopId, execution.targetId);
    const item: StoredActivity = {
      operationId: execution.operationId, runId: execution.runId,
      message, running: true, latestSeq: 0, events: [],
    };
    this.byRoom.set(key, item);
    this.sweep();
    return {
      emit: event => {
        if (!item.running || this.byRoom.get(key) !== item) return;
        const bounded = boundedActivityEvent(event);
        item.events.push({ seq: ++item.latestSeq, event: bounded.event });
        if (bounded.truncated) item.contentTruncated = true;
        if (item.events.length > this.maxEvents) item.events.shift();
      },
      finish: () => {
        if (!item.running) return;
        item.running = false;
        item.finishedAt = Date.now();
      },
    };
  }

  read(workshopId: string, roomId: string, since = 0): RoomActivitySnapshot | null {
    const key = roomKey(workshopId, roomId);
    const item = this.byRoom.get(key);
    if (!item) return null;
    if (!item.running && Date.now() - (item.finishedAt ?? 0) > this.retentionMs) {
      this.byRoom.delete(key);
      return null;
    }
    const firstSeq = item.events[0]?.seq ?? item.latestSeq + 1;
    return {
      operationId: item.operationId, runId: item.runId,
      message: item.message, running: item.running, latestSeq: item.latestSeq,
      truncated: since < firstSeq - 1 || !!item.contentTruncated,
      events: item.events.filter(entry => entry.seq > since).slice(0, 128),
    };
  }

  private sweep(): void {
    for (const [key, item] of this.byRoom) {
      if (!item.running && Date.now() - (item.finishedAt ?? 0) > this.retentionMs) {
        this.byRoom.delete(key);
      }
    }
  }
}

function roomKey(workshopId: string, roomId: string): string {
  return `${workshopId}/${roomId}`;
}
