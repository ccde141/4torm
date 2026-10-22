import type { NodeSnapshot } from '../../../engine/tradewind/execution/node-runner.js';

interface Identity { workflowId: string; executionId: string; nodeId: string; limit: number }
interface PublicMessage { role: string; content: string; truncated?: true }

export function projectAgentNodeConversation(snapshot: NodeSnapshot, identity: Identity) {
  const visible = snapshot.messages.filter(message =>
    (message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string');
  const selected = visible.slice(-identity.limit);
  const perMessage = Math.min(4_000, Math.floor(4_500 / Math.max(1, selected.length)));
  const messages: PublicMessage[] = selected.map(message => {
    const truncated = message.content.length > perMessage;
    return { role: message.role, content: message.content.slice(0, perMessage),
      ...(truncated ? { truncated: true as const } : {}) };
  });
  const draft = snapshot.busy ? snapshot.roundLog
    .filter(event => event.type === 'token')
    .map(event => event.content).join('') : '';
  return {
    workflowId: identity.workflowId, executionId: identity.executionId, nodeId: identity.nodeId,
    messages, totalMessages: visible.length, hasEarlierMessages: visible.length > selected.length,
    busy: snapshot.busy, paused: Boolean(snapshot.paused), lastSeq: snapshot.lastSeq,
    ...(snapshot.pausedRunId ? { pausedRunId: snapshot.pausedRunId } : {}),
    currentReply: snapshot.busy && snapshot.runId ? {
      runId: snapshot.runId, source: snapshot.roundSource ?? null,
      content: draft.slice(-1_000), complete: false,
      ...(draft.length > 1_000 ? { truncated: true } : {}),
    } : null,
  };
}
