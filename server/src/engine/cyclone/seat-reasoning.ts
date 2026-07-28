import type { SeatContextMessage } from './types.js';

export function recordSeatAssistantResult(
  messages: SeatContextMessage[],
  content: string,
  reasoning: string,
  generatedContextStart = 0,
): void {
  if (!content || content.startsWith('[中止]') || content.startsWith('[错误]')) return;

  const generatedMessages = messages.slice(generatedContextStart);
  const finalContent = unclaimedContent(content, generatedMessages);
  if (!finalContent && !reasoning) return;

  let target = messages[messages.length - 1];
  const targetAlreadyOwnsContent = target?.role === 'assistant' && target.content === content;
  if (!targetAlreadyOwnsContent && (target?.role !== 'assistant' || target.content !== finalContent)) {
    target = { role: 'assistant', content: finalContent };
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

function unclaimedContent(content: string, messages: SeatContextMessage[]): string {
  const claimed = messages
    .filter(message => message.role === 'assistant' && message.content.trim())
    .map(message => message.content)
    .join('\n\n');
  if (!claimed) return content;
  if (content === claimed) return '';
  const prefix = `${claimed}\n\n`;
  return content.startsWith(prefix) ? content.slice(prefix.length) : content;
}
