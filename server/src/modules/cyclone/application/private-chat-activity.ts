import type { CycloneExecutionSnapshot } from '../domain/operation-snapshot.js';
import { boundedActivityEvent } from './bounded-activity-event.js';

export type PrivateChatKind = 'seat' | 'chair';

export interface PrivateChatActivitySnapshot {
  operationId: string;
  runId: string;
  phase: 'seat-chat' | 'chair-chat';
  message: string;
  running: boolean;
  latestSeq: number;
  truncated: boolean;
  events: Array<{ seq: number; event: Record<string, unknown> }>;
}

interface StoredActivity extends Omit<PrivateChatActivitySnapshot, 'truncated'> {
  finishedAt?: number;
  contentTruncated?: boolean;
}

export interface PrivateChatActivityHandle {
  emit(event: Record<string, unknown>): void;
  finish(): void;
}

export class CyclonePrivateChatActivity {
  private readonly byTarget = new Map<string, StoredActivity>();
  private readonly maxEvents: number;
  private readonly retentionMs: number;

  constructor(options: { maxEvents?: number; retentionMs?: number } = {}) {
    this.maxEvents = options.maxEvents ?? 2_000;
    this.retentionMs = options.retentionMs ?? 60_000;
  }

  begin(execution: CycloneExecutionSnapshot, message: string): PrivateChatActivityHandle {
    const kind = privateKind(execution);
    const key = targetKey(execution.workshopId, kind, execution.targetId);
    const item: StoredActivity = {
      operationId: execution.operationId, runId: execution.runId,
      phase: execution.phase as StoredActivity['phase'], message,
      running: true, latestSeq: 0, events: [],
    };
    this.byTarget.set(key, item);
    this.sweep();
    return {
      emit: event => {
        if (!item.running || this.byTarget.get(key) !== item) return;
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

  read(workshopId: string, kind: PrivateChatKind, targetId: string, since = 0): PrivateChatActivitySnapshot | null {
    const key = targetKey(workshopId, kind, targetId);
    const item = this.byTarget.get(key);
    if (!item) return null;
    if (!item.running && Date.now() - (item.finishedAt ?? 0) > this.retentionMs) {
      this.byTarget.delete(key);
      return null;
    }
    const firstSeq = item.events[0]?.seq ?? item.latestSeq + 1;
    return {
      operationId: item.operationId, runId: item.runId, phase: item.phase,
      message: item.message, running: item.running, latestSeq: item.latestSeq,
      truncated: since < firstSeq - 1 || !!item.contentTruncated,
      events: item.events.filter(entry => entry.seq > since).slice(0, 128),
    };
  }

  private sweep(): void {
    for (const [key, item] of this.byTarget) {
      if (!item.running && Date.now() - (item.finishedAt ?? 0) > this.retentionMs) {
        this.byTarget.delete(key);
      }
    }
  }
}

function privateKind(execution: CycloneExecutionSnapshot): PrivateChatKind {
  if (execution.phase === 'seat-chat' && execution.targetKind === 'seat') return 'seat';
  if (execution.phase === 'chair-chat' && execution.targetKind === 'room') return 'chair';
  throw new Error('Private chat activity requires a seat-chat or chair-chat execution');
}

function targetKey(workshopId: string, kind: PrivateChatKind, targetId: string): string {
  return `${workshopId}\0${kind}\0${targetId}`;
}
