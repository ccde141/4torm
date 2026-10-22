import type { ConvectionRoundKind } from '../domain/session-snapshot.js';
import type { ConvectionStreamEvent } from '../execution/stream-events.js';

export type ConvectionConferenceEvent =
  | { type: 'session-changed'; sessionId: string }
  | { type: 'context-event'; sessionId: string; scope: 'public' | 'chair';
      event: import('../../../engine/shared/compaction/contracts.js').CompactionProgress }
  | { type: 'round-start'; sessionId: string; runId: string;
      round: ConvectionRoundKind; message: string }
  | { type: 'round-event'; sessionId: string; runId: string;
      round: ConvectionRoundKind; event: ConvectionStreamEvent }
  | { type: 'round-end'; sessionId: string; runId: string;
      round: ConvectionRoundKind; status: 'completed' | 'aborted' | 'failed'; error?: string };

type Listener = (event: ConvectionConferenceEvent) => void;

export class ConvectionConferenceFeed {
  private readonly listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  publish(event: ConvectionConferenceEvent): void {
    for (const listener of this.listeners) {
      try { listener(event); } catch { this.listeners.delete(listener); }
    }
  }

  listenerCount(): number { return this.listeners.size; }
}
