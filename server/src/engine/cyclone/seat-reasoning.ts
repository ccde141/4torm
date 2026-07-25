import type { SeatContextMessage } from './types.js';

export function recordSeatAssistantResult(
  messages: SeatContextMessage[],
  content: string,
  reasoning: string,
  generatedContextStart = 0,
): void {
  if (!content || content.startsWith('[中止]') || content.startsWith('[错误]')) return;

  let target = messages[messages.length - 1];
  if (target?.role !== 'assistant' || target.content !== content) {
    target = { role: 'assistant', content };
    messages.push(target);
  }
  if (!reasoning) return;

  const claimedReasoningLength = messages.slice(generatedContextStart).reduce((total, message) => {
    if (message === target || message.role !== 'assistant') return total;
    return total + (message.reasoningContent?.length ?? 0);
  }, 0);
  const remainingReasoning = reasoning.slice(claimedReasoningLength);

  target.reasoning = reasoning;
  if (remainingReasoning) target.reasoningContent = remainingReasoning;
}
