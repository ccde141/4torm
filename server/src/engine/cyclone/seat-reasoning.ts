import type { SeatContextMessage } from './types.js';

export function recordSeatAssistantResult(
  messages: SeatContextMessage[],
  content: string,
  reasoning: string,
): void {
  if (!content || content.startsWith('[中止]') || content.startsWith('[错误]')) return;

  let target = messages[messages.length - 1];
  if (target?.role !== 'assistant' || target.content !== content) {
    target = { role: 'assistant', content };
    messages.push(target);
  }
  if (reasoning) target.reasoning = reasoning;
}
