import type { ChatSession } from '../../store/chat';
import type { ChatMessage } from '../../types';

interface SessionSignal { agentId: string; sessionId: string }

interface SnapshotPorts {
  load(sessionId: string, agentId: string): Promise<ChatSession | null>;
  currentMessages(): ChatMessage[];
  mayApply(): boolean;
  apply(messages: ChatMessage[]): void;
}

/** Keep one invalidation per session while a local stream owns its visible messages. */
export class SessionRefreshBuffer {
  private readonly pending = new Set<string>();

  note(sessionId: string, running: boolean): boolean {
    if (running) { this.pending.add(sessionId); return false; }
    this.pending.delete(sessionId);
    return true;
  }

  drain(sessionId: string, running: boolean): boolean {
    return !running && this.pending.delete(sessionId);
  }

  clear(): void { this.pending.clear(); }
}

/** Tide's session event is an invalidation hint; Monsoon rereads its own durable session. */
export function parseMonsoonSessionSignal(payload: string): SessionSignal | null {
  const value: unknown = JSON.parse(payload);
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (item.type !== 'change' || item.scope !== 'session') return null;
  if (typeof item.agentId !== 'string' || !item.agentId
    || typeof item.sessionId !== 'string' || !item.sessionId
    || !Number.isSafeInteger(item.revision) || Number(item.revision) < 1) {
    throw new Error('季风会话通知无效');
  }
  return { agentId: item.agentId, sessionId: item.sessionId };
}

export async function applyExternalSessionSnapshot(
  agentId: string, sessionId: string, ports: SnapshotPorts,
): Promise<void> {
  if (!ports.mayApply()) return;
  const before = ports.currentMessages();
  const session = await ports.load(sessionId, agentId);
  if (!session || !ports.mayApply() || ports.currentMessages() !== before) return;
  if (session.agentId !== agentId || session.id !== sessionId) {
    throw new Error('季风会话通知目标与读取结果不一致');
  }
  ports.apply(session.messages);
}
