import type { ChatMessage } from '../../types';

/** Bound mounted history without changing the complete session kept for saving and model context. */
export function historyWindow(messages: ChatMessage[], streaming: boolean, limit: number) {
  const visible = messages.filter((message, index) => message.humanInputs?.length
    || message.inputRecoveryError || message.toolCall || message.content.trim()
    || message.images?.length || message.reasoningContent || message.toolSteps?.length
    || (streaming && index === messages.length - 1));
  const hiddenCount = Math.max(0, visible.length - Math.max(1, limit));
  return { messages: visible.slice(hiddenCount), hiddenCount };
}
