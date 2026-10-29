import type { ContextMessage, NativeToolCall } from '../../../engine/shared/types.js';
import { readToolImageRefs } from '../../../engine/shared/tool-media-store.js';
import type { MonsoonMessage, MonsoonSession } from '../domain/session.js';
import { persistMonsoonContext, readStoredMonsoonContext, textMonsoonContext,
  type StoredMonsoonContextMessage } from './context-images.js';

/** Display records remain intact. Only this projection decides what enters a model. */
export function activeMonsoonMessages(session: Pick<MonsoonSession, 'messages'>): MonsoonMessage[] {
  let start = -1;
  for (let index = session.messages.length - 1; index >= 0; index--) {
    if (session.messages[index]?.type === 'compact-marker') { start = index; break; }
  }
  return session.messages.slice(Math.max(0, start));
}

export function projectMonsoonContext(session: Pick<MonsoonSession, 'messages'>): ContextMessage[] {
  return textMonsoonContext(storedMonsoonContext(session));
}

export function storedMonsoonContext(session: Pick<MonsoonSession, 'messages'>): StoredMonsoonContextMessage[] {
  return activeMonsoonMessages(session).flatMap(projectMessage);
}

function projectMessage(message: MonsoonMessage): StoredMonsoonContextMessage[] {
  if (message.contextOmitted === true) return [];
  if (message.runCommitted === false && !message.content && !Array.isArray(message.toolSteps)) return [];
  let context: StoredMonsoonContextMessage[];
  if (isRecord(message.ask) && message.ask.answered === true && typeof message.ask.reply === 'string') {
    context = [{ role: 'assistant', content: message.content }, { role: 'user', content: message.ask.reply, origin: 'human' }];
  } else if (message.contextExact === true && Array.isArray(message.nativeContext)) {
    context = readStoredMonsoonContext(message.nativeContext);
  } else if (message.type === 'compact-marker') {
    context = [{ role: 'system', content: `[历史上下文摘要]\n${message.content}` }];
  } else if (message.role === 'assistant') {
    context = assistantContext(message);
  } else context = readStoredMonsoonContext([{ role: message.role, content: message.content,
    ...(message.role === 'user' ? { origin: message.origin === 'framework' ? 'framework' : 'human' } : {}),
    ...(Array.isArray(message.images) ? { images: message.images } : {}) }]);
  if (message.streamStopped === true) context.push({ role: 'assistant',
    content: '上一轮执行被人类停止。已返回的工具结果和已经产生的文件改动仍然有效；没有结果的步骤不得视为完成，以上记录不代表任务完成。请结合人类的新消息判断是否继续。' });
  return context;
}

function assistantContext(message: MonsoonMessage): StoredMonsoonContextMessage[] {
  if (Array.isArray(message.nativeContext) && message.nativeContext.length) {
    const context = readStoredMonsoonContext(message.nativeContext);
    const claimed = context.filter(item => item.role === 'assistant' && item.content.trim())
      .map(item => item.content).join('\n\n');
    const remaining = claimed && message.content.startsWith(`${claimed}\n\n`)
      ? message.content.slice(claimed.length + 2) : message.content === claimed ? '' : message.content;
    const claimedReasoning = context.reduce((sum, item) => sum
      + (item.role === 'assistant' ? item.reasoningContent?.length ?? 0 : 0), 0);
    const remainingReasoning = typeof message.reasoningContent === 'string'
      ? message.reasoningContent.slice(claimedReasoning) : undefined;
    if (remaining.trim() || remainingReasoning) context.push({ role: 'assistant', content: remaining,
      ...(remainingReasoning ? { reasoningContent: remainingReasoning } : {}) });
    return context;
  }
  const steps = Array.isArray(message.toolSteps) ? message.toolSteps
    : isRecord(message.toolCall) ? [{ ...message.toolCall, tool: message.toolCall.toolName,
      args: message.toolCall.params }] : [];
  const context = steps.flatMap((step, index) => projectTool(step, `${message.id}-tool-${index}`));
  if (message.content.trim() || !context.length) context.push({ role: 'assistant', content: message.content,
    ...(typeof message.reasoningContent === 'string' ? { reasoningContent: message.reasoningContent } : {}) });
  return persistMonsoonContext(context);
}

function projectTool(value: unknown, id: string): ContextMessage[] {
  if (!isRecord(value) || typeof value.tool !== 'string') throw new Error('会话工具记录无效');
  const call: NativeToolCall = { id, name: value.tool, arguments: JSON.stringify(value.args ?? {}) };
  const result = typeof value.result === 'string' ? value.result : '工具没有返回结果，不得假定成功。';
  return [{ role: 'assistant', content: '', toolCalls: [call] },
    { role: 'tool', content: result, toolCallId: id,
      ...(typeof value.ok === 'boolean' ? { toolOk: value.ok } : {}),
      ...(value.toolImages !== undefined ? { toolImages: readToolImageRefs(value.toolImages) } : {}) }];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
