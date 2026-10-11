import type { TokenUsageProgress } from '../../../engine/tradewind/execution/token-usage.js';

interface Base {
  workflowId: string; executionId: string; nodeId: string; limit: number;
  round: number; phase: string; busy: boolean;
  tokenUsage?: TokenUsageProgress;
}

type Input = Base & (
  | { scope: 'public'; messages: Array<{ speaker: string; content: string; timestamp: number }>;
    streamingCurrent?: { speaker: string; content: string } | null }
  | { scope: 'chair'; messages: Array<{ role: string; content: string }>; streamingCurrent?: null }
);

export function projectAgentMeetingConversation(input: Input) {
  const visible = input.scope === 'chair'
    ? input.messages.filter(message => message.role === 'user' || message.role === 'assistant')
    : input.messages;
  const selected = visible.slice(-input.limit);
  const perMessage = Math.min(4_000, Math.floor(4_500 / Math.max(1, selected.length)));
  const messages = selected.map(message => ({
    ...(input.scope === 'chair' ? { role: (message as { role: string }).role }
      : { speaker: (message as { speaker: string }).speaker,
        timestamp: (message as { timestamp: number }).timestamp }),
    content: message.content.slice(0, perMessage),
    ...(message.content.length > perMessage ? { truncated: true } : {}),
  }));
  const streaming = input.scope === 'public' ? input.streamingCurrent : null;
  return {
    workflowId: input.workflowId, executionId: input.executionId, nodeId: input.nodeId,
    scope: input.scope, round: input.round, phase: input.phase, busy: input.busy,
    tokenUsage: input.tokenUsage,
    messages, totalMessages: visible.length, hasEarlierMessages: visible.length > selected.length,
    currentMessage: streaming ? {
      speaker: streaming.speaker, content: streaming.content.slice(-1_000), complete: false,
      ...(streaming.content.length > 1_000 ? { truncated: true } : {}),
    } : null,
  };
}
