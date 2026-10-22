import { backendFetch } from '../../lib/backend-client';
import type { ChatMessage, NativeContextMessage } from '../../types';

type Receipt = Omit<NonNullable<ChatMessage['humanInputs']>[number], 'state'>;
type Checkpoint = { context: NativeContextMessage[]; includedIds: string[]; closed: boolean };
export type InputEvent =
  | { type: 'input-ready'; runId: string }
  | { type: 'input-received'; receipt: Receipt }
  | { type: 'input-context'; runId: string; checkpoint: Checkpoint }
  | { type: 'input-closed'; runId: string; retained: Receipt[] }
  | { type: 'input-skipped'; tool: string; reason: string };

export function applyInputEvent(messages: ChatMessage[], id: string, event: InputEvent): ChatMessage[] {
  return messages.map(message => {
    if (message.id !== id || !message.inputRunId) return message;
    const runId = event.type === 'input-received' ? event.receipt.runId
      : event.type === 'input-skipped' ? message.inputRunId : event.runId;
    if (runId !== message.inputRunId) return message;
    if (event.type === 'input-ready') return { ...message, inputReady: true };
    if (event.type === 'input-skipped') return { ...message,
      inputSkipped: [...(message.inputSkipped ?? []), `${event.tool}: ${event.reason}`] };
    if (event.type === 'input-context') {
      return updateStates({ ...message, nativeContext: event.checkpoint.context, contextExact: true,
        inputIncludedIds: event.checkpoint.includedIds, inputClosed: event.checkpoint.closed });
    }
    const receipts = event.type === 'input-received' ? [event.receipt] : event.retained;
    const entries = new Map((message.humanInputs ?? []).map(input => [input.id, input]));
    for (const receipt of receipts) {
      if (!entries.has(receipt.id)) entries.set(receipt.id, { ...receipt, state: 'received' });
    }
    return updateStates({ ...message, humanInputs: [...entries.values()].sort((a, b) => a.sequence - b.sequence),
      ...(event.type === 'input-closed' ? { inputReady: false, inputClosed: true } : {}) });
  });
}

function updateStates(message: ChatMessage): ChatMessage {
  return { ...message, humanInputs: message.humanInputs?.map(input => ({ ...input,
    state: message.inputIncludedIds?.includes(input.id) ? 'included'
      : message.inputClosed ? 'retained' : 'received',
  })) };
}

export function editInputAnswer(message: ChatMessage, content: string): ChatMessage {
  if (!message.contextExact) return { ...message, content };
  const context = [...(message.nativeContext ?? [])];
  const last = context.at(-1);
  if (last?.role === 'assistant' && !last.toolCalls?.length) {
    context[context.length - 1] = { ...last, content };
  } else context.push({ role: 'assistant', content });
  return { ...message, content, nativeContext: context, inputClosed: true, inputReady: false };
}

/** Read-only recovery. An interrupted run is never restarted by loading its history. */
export async function recoverInputMessages(messages: ChatMessage[], agentId: string, sessionId: string,
  request: typeof fetch = backendFetch): Promise<ChatMessage[]> {
  let result = messages;
  for (const message of messages) {
    if (!message.inputRunId || message.inputClosed) continue;
    try {
      const query = new URLSearchParams({ agentId, sessionId, runId: message.inputRunId });
      const response = await request(`/api/conversation/input?${query}`);
      if (!response.ok) throw new Error(`Input recovery HTTP ${response.status}`);
      const journal = await response.json();
      if (!Array.isArray(journal.entries)) throw new Error('Invalid input journal');
      for (const receipt of journal.entries) result = applyInputEvent(result, message.id, { type: 'input-received', receipt });
      if (journal.checkpoint) result = applyInputEvent(result, message.id,
        { type: 'input-context', runId: message.inputRunId, checkpoint: journal.checkpoint });
      if (!journal.active) result = applyInputEvent(result, message.id,
        { type: 'input-closed', runId: message.inputRunId, retained: journal.entries });
    } catch (error) {
      result = result.map(item => item.id === message.id ? { ...item, inputRecoveryError: String(error) } : item);
    }
  }
  return result;
}
