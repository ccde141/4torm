import { streamUrl } from '../../../lib/apiBase';

export type CycloneChangeScope = 'workshop' | 'room' | 'bulletin' | 'activity' | 'dispatch';
export type CycloneChangeEvent = { type: 'change'; workshopId: string;
  scope: CycloneChangeScope; id?: string; revision: number };
export type CycloneFeedEvent = CycloneChangeEvent | { type: 'sync' } | { type: 'disconnected' };

type Listener = (event: CycloneFeedEvent) => void;
const listeners = new Set<Listener>();
let source: EventSource | null = null;

function publish(event: CycloneFeedEvent): void {
  for (const listener of listeners) listener(event);
}

function parseChange(value: unknown): CycloneChangeEvent | null {
  if (!value || typeof value !== 'object') return null;
  const event = value as Record<string, unknown>;
  const scopes: CycloneChangeScope[] = ['workshop', 'room', 'bulletin', 'activity', 'dispatch'];
  if (event.type !== 'change' || typeof event.workshopId !== 'string'
    || !scopes.includes(event.scope as CycloneChangeScope)
    || (event.id !== undefined && typeof event.id !== 'string')
    || !Number.isSafeInteger(event.revision)) return null;
  return event as CycloneChangeEvent;
}

/** One invalidation stream; every consumer then reads the existing authoritative port. */
export function subscribeCycloneChanges(listener: Listener): () => void {
  listeners.add(listener);
  if (!source) {
    source = new EventSource(streamUrl('/api/cyclone/changes'), { withCredentials: true });
    source.onopen = () => publish({ type: 'sync' });
    source.onerror = () => publish({ type: 'disconnected' });
    source.onmessage = message => {
      try {
        const change = parseChange(JSON.parse(message.data));
        if (change) publish(change);
      } catch (cause) { console.error('[cyclone] 变更通知无效', cause); }
    };
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) { source?.close(); source = null; }
  };
}
