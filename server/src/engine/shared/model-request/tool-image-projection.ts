import type { ContextMessage, ProviderImage } from '../types.js';

export const MAX_MODEL_TOOL_IMAGES = 2;

/** Chat Completions images follow every result in the tool batch, without breaking pairing. */
export function projectChatToolImages(messages: ContextMessage[]): ContextMessage[] {
  const output: ContextMessage[] = [];
  let pending: ProviderImage[] = [];
  let sources: string[] = [];
  const flush = () => {
    if (pending.length) output.push({ role: 'user',
      content: `以下图片由工具返回（调用：${sources.join(', ')}），属于工具结果。`, images: pending });
    pending = [];
    sources = [];
  };
  for (const message of messages) {
    if (message.role !== 'tool') flush();
    if (message.role === 'tool' && message.images?.length) {
      const { images, ...rest } = message;
      pending.push(...images);
      sources.push(message.toolCallId ?? 'unknown');
      output.push(rest);
    } else output.push(message);
  }
  flush();
  return output;
}
