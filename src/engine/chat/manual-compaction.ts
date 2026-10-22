import { errorMessage } from '../../api/error-contract';
import type { ChatSession } from '../../store/chat';
import { readMonsoonEvents, type MonsoonBrowserEvent } from './sse-events';

/** Summary chunks stay off the transcript; only a durable checkpoint replaces the visible history. */
export async function requestMonsoonCompaction(session: ChatSession, model: string, signal: AbortSignal,
  ports: { request: typeof fetch; onProgress(event: MonsoonBrowserEvent): void }): Promise<string> {
  const response = await ports.request('/api/conversation/compact', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
    body: JSON.stringify({ agentId: session.agentId, sessionId: session.id, model: model || session.model }),
  });
  if (!response.ok) throw new Error(errorMessage(await response.json().catch(() => ({})), response.statusText));
  let done = false;
  const notices: string[] = [];
  for await (const event of readMonsoonEvents(response.body)) {
    if (event.type.startsWith('compact-')) ports.onProgress(event);
    if (event.type === 'compaction-notice' && typeof event.message === 'string') notices.push(event.message);
    if (event.type === 'error') throw new Error(errorMessage(event, '压缩失败'));
    if (event.type === 'done') done = true;
  }
  if (!done) throw new Error('压缩连接在确认结果前中断');
  return notices.join('\n');
}

export function hasNewCompactionCheckpoint(before: ChatSession, after: ChatSession): boolean {
  return before.id === after.id && before.agentId === after.agentId && after.messages.some(message =>
    message.type === 'compact-marker' && !before.messages.some(original => original.id === message.id));
}
