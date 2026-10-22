import type { SupervisorInformation, SupervisorMessage } from './supervisor-store.js';

function object(content: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(content);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
  } catch { return undefined; }
}

/** Only matching successful tool results can acknowledge an already-read receipt. */
export function hasSupervisorReceiptEvidence(messages: SupervisorMessage[], item: SupervisorInformation): boolean {
  if (item.sourceKind === 'seat') return false;
  const receipt = object(item.content);
  if (!receipt) return false;
  const calls = new Map(messages.flatMap(message => message.toolCalls?.map(call => [call.id, call.name] as const) ?? []));
  for (const [index, message] of messages.entries()) {
    let name: string | undefined;
    let result: Record<string, unknown> | undefined;
    if (message.role === 'tool' && message.toolOk !== false && message.toolCallId) {
      name = calls.get(message.toolCallId); result = object(message.content);
    } else if (message.role === 'user' && index > 0) {
      const previous = messages[index - 1];
      const call = previous.role === 'assistant' ? object(previous.content) : undefined;
      const envelope = object(message.content);
      if (call?.type === 'tool_call' && envelope?.type === 'tool_result'
        && call.name === envelope.name && envelope.ok === true && typeof envelope.content === 'string') {
        name = String(call.name); result = object(envelope.content);
      }
    }
    if (!result) continue;
    if (item.sourceKind === 'contact' && (name === 'contact' || name === 'contact_read')
      && result.contactId === item.sourceId && result.status === receipt.status
      && (result.reply ?? result.response) === receipt.response && result.error === receipt.error) return true;
    if (item.sourceKind !== 'dispatch' || name !== 'list_collaboration_dispatches' || !Array.isArray(result.items)) continue;
    const seen = result.items.find(value => value && typeof value === 'object' && value.id === item.sourceId);
    if (!seen || seen.status !== receipt.status) continue;
    const part = receipt.status === 'failed' ? 'error' : 'response';
    const content = receipt[part] ?? '';
    if (seen[part] === content && typeof content === 'string' && seen[`${part}Chars`] === content.length) return true;
  }
  return false;
}
