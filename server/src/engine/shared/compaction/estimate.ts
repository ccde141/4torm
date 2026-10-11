import type { ContextMessage } from '../types.js';

/** Fallback weights are calibrated by the latest provider input usage, never displayed as exact usage. */
export function estimateCompactionTokens(messages: readonly ContextMessage[]): number {
  return messages.reduce((total, message) => total + estimateMessageTokens(message), 0);
}

export function estimateMessageTokens(message: ContextMessage): number {
  const text = message.content + (message.reasoningContent ?? '')
    + (message.toolCalls ? JSON.stringify(message.toolCalls) : '')
    + (message.reasoningEnvelope ? JSON.stringify(message.reasoningEnvelope) : '');
  return estimateTextTokens(text) + 4 + (message.images?.length ?? 0) * 1_000;
}

export function estimateTextTokens(text: string): number {
  let latin = 0;
  let wide = 0;
  for (const char of text) {
    if (char.codePointAt(0)! > 0xff) wide++;
    else latin++;
  }
  return Math.ceil(latin / 4 + wide);
}

export function serializeCompactionMessages(messages: readonly ContextMessage[]): string {
  return messages.map(message => {
    const tools = message.toolCalls?.map(call =>
      `工具调用 ${call.id} ${call.name}: ${call.arguments}`).join('\n');
    const result = message.toolCallId ? ` 工具结果 ${message.toolCallId}` : '';
    const images = message.images?.map(image => `附件 ${image.id} ${image.name}`).join('\n');
    return `[${message.role}${result}]\n${message.content}`
      + (tools ? `\n${tools}` : '') + (images ? `\n${images}` : '');
  }).join('\n\n');
}
