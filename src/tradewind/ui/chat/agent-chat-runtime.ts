import { errorFromResponse } from '../../../api/error-contract';
import type { ChatMessage } from '../../../types';
import { requirePanelIdentity } from '../stream/panel-identity';
import type { ExecutionIdentity } from '../hooks/execution-visibility';
import type { ProviderUsage } from '../token-usage';

export interface NodeSnapshot<TEvent extends { type: string }> {
  messages: Array<{ role: string; content: string; reasoningContent?: string }>;
  roundLog: Array<TEvent & { seq?: number }>;
  busy: boolean;
  roundSource?: 'human' | 'envelope' | 'contact' | null;
  runId?: string;
  paused?: boolean;
  lastSeq: number;
  workflowId?: string;
  executionId?: string;
  tokenUsage?: { calls: number; latest: ProviderUsage | null };
  compactionNotice?: string;
}

type RoundSource = 'human' | 'envelope' | 'contact' | null;

export function roundSourceFromSnapshot(snapshot: {
  roundSource?: RoundSource;
  roundLog: ReadonlyArray<{ type: string; source?: unknown }>;
}): RoundSource {
  if (snapshot.roundSource !== undefined) return snapshot.roundSource;
  const source = snapshot.roundLog.find(event => event.type === 'user-message')?.source;
  return source === 'human' || source === 'envelope' || source === 'contact' ? source : null;
}

export async function readNodeSnapshot<TEvent extends { type: string }>(
  response: Response,
  identity?: ExecutionIdentity,
): Promise<NodeSnapshot<TEvent>> {
  if (!response.ok) throw await errorFromResponse(response);
  const value: unknown = await response.json();
  if (!value || typeof value !== 'object') throw new Error('信风节点快照格式无效');
  const snap = value as Partial<NodeSnapshot<TEvent>>;
  if (!Array.isArray(snap.messages) || !Array.isArray(snap.roundLog)
    || typeof snap.busy !== 'boolean' || !Number.isFinite(snap.lastSeq)) {
    throw new Error('信风节点快照格式无效');
  }
  return identity ? requirePanelIdentity(snap, identity) as NodeSnapshot<TEvent> : snap as NodeSnapshot<TEvent>;
}

export async function readNodeStatus(response: Response, identity: ExecutionIdentity): Promise<{ busy: boolean }> {
  if (!response.ok) throw await errorFromResponse(response);
  const value: unknown = await response.json();
  if (!value || typeof value !== 'object' || !('busy' in value) || typeof value.busy !== 'boolean') {
    throw new Error('信风节点状态格式无效');
  }
  return requirePanelIdentity(value as { busy: boolean; workflowId?: unknown; executionId?: unknown }, identity);
}

export function shouldReplaySnapshotRound<TEvent extends { type: string }>(
  snapshot: { busy: boolean; roundLog: TEvent[] },
): boolean {
  return snapshot.busy && snapshot.roundLog.length > 0
    && !snapshot.roundLog.some(event => event.type === 'answer' || event.type === 'done');
}

export function createSnapshotGate<T extends { seq?: number }>() {
  let generation = 0;
  let lastSeq = 0;
  let buffering = false;
  let pending: T[] = [];
  const accept = (events: T[]) => events.filter(event => {
    if (typeof event.seq !== 'number') return true;
    if (event.seq <= lastSeq) return false;
    lastSeq = event.seq;
    return true;
  });
  const release = () => {
    buffering = false;
    const events = pending;
    pending = [];
    return accept(events);
  };
  return {
    start() { buffering = true; pending = []; return ++generation; },
    receive(event: T) { if (buffering) { pending.push(event); return []; } return accept([event]); },
    finish(request: number, seq: number) {
      if (request !== generation) return null;
      lastSeq = seq;
      return release();
    },
    fail(request: number) { return request === generation ? release() : null; },
    disconnect() { generation++; return release(); },
  };
}

export function createStatusRequestGate() {
  let requestGeneration = 0;
  let eventVersion = 0;
  type Ticket = { requestGeneration: number; eventVersion: number };
  return {
    begin(): Ticket { return { requestGeneration: ++requestGeneration, eventVersion }; },
    advanceEvent() { eventVersion++; },
    shouldClearStreaming(ticket: Ticket, status: { busy: boolean }) {
      return ticket.requestGeneration === requestGeneration
        && ticket.eventVersion === eventVersion && status.busy === false;
    },
    cancel(ticket: Ticket) {
      if (ticket.requestGeneration === requestGeneration) requestGeneration++;
    },
  };
}

export function mergeDelegateChunks(messages: ChatMessage[], chunks: ReadonlyMap<string, string>): ChatMessage[] {
  const remaining = new Set(chunks.keys());
  const next = [...messages];
  let changed = false;
  for (let index = next.length - 1; index >= 0 && remaining.size > 0; index--) {
    const message = next[index];
    const delegateId = (message as ChatMessage & { _delegateId?: string })._delegateId;
    if (!delegateId || !remaining.has(delegateId)) continue;
    remaining.delete(delegateId);
    const chunk = chunks.get(delegateId);
    if (!chunk) continue;
    changed = true;
    next[index] = { ...message, content: (message.content || '') + chunk };
  }
  return changed ? next : messages;
}

export function createDelegateFrameBuffer(
  emit: (chunks: ReadonlyMap<string, string>) => void,
  requestFrame: (callback: () => void) => number,
  cancelFrame: (id: number) => void,
) {
  let pending = new Map<string, string>();
  let frame: number | null = null;
  const flush = () => {
    if (frame !== null) { cancelFrame(frame); frame = null; }
    if (pending.size === 0) return;
    const chunks = pending;
    pending = new Map();
    emit(chunks);
  };
  return {
    add(delegateId: string, content: string) {
      if (!content) return;
      pending.set(delegateId, (pending.get(delegateId) || '') + content);
      if (frame === null) frame = requestFrame(flush);
    },
    flush,
    dispose() {
      if (frame !== null) cancelFrame(frame);
      frame = null;
      pending.clear();
    },
  };
}
