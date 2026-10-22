import { createBackendEventSource } from '../../lib/backend-client';

export type TideChangeEvent = { type: 'change'; revision: number } & (
  | { scope: 'task'; agentId: string; taskId: string }
  | { scope: 'run'; agentId?: string; taskId: string; runId: string }
  | { scope: 'record'; taskId: string; runId?: string }
  | { scope: 'session'; agentId: string; sessionId: string; taskId?: string }
);
export type TideFeedEvent = TideChangeEvent | { type: 'sync' } | { type: 'disconnected' };
type Listener = (event: TideFeedEvent) => void;

const listeners = new Set<Listener>();
let source: EventSource | null = null;
let lastRevision = 0;

function publish(event: TideFeedEvent): void {
  for (const listener of listeners) listener(event);
}

function parseChange(value: unknown): TideChangeEvent | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (item.type !== 'change' || !Number.isSafeInteger(item.revision)
    || (item.revision as number) < 1) return null;
  if (item.scope === 'task') {
    if (typeof item.agentId !== 'string' || typeof item.taskId !== 'string') return null;
  } else if (item.scope === 'run') {
    if (typeof item.taskId !== 'string' || typeof item.runId !== 'string'
      || (item.agentId !== undefined && typeof item.agentId !== 'string')) return null;
  } else if (item.scope === 'record') {
    if (typeof item.taskId !== 'string'
      || (item.runId !== undefined && typeof item.runId !== 'string')) return null;
  } else if (item.scope === 'session') {
    if (typeof item.agentId !== 'string' || typeof item.sessionId !== 'string'
      || (item.taskId !== undefined && typeof item.taskId !== 'string')) return null;
  } else return null;
  return item as TideChangeEvent;
}

/** The event is only a hint; consumers reread durable task, run and session facts. */
export function subscribeTideChanges(listener: Listener): () => void {
  listeners.add(listener);
  if (!source) {
    source = createBackendEventSource('/api/tide/changes');
    source.onopen = () => { lastRevision = 0; publish({ type: 'sync' }); };
    source.onerror = () => publish({ type: 'disconnected' });
    source.onmessage = message => {
      try {
        const event = parseChange(JSON.parse(message.data));
        if (!event || event.revision <= lastRevision) return;
        if (lastRevision > 0 && event.revision > lastRevision + 1) publish({ type: 'sync' });
        lastRevision = event.revision;
        publish(event);
      } catch (cause) { console.error('[tide] 变更通知无效', cause); }
    };
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) { source?.close(); source = null; lastRevision = 0; }
  };
}
