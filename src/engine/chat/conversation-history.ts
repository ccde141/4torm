import type { ChatMessage, NativeContextMessage } from '../../types';

export function buildConversationHistory(messages: ChatMessage[]): NativeContextMessage[] {
  return messages.flatMap(message => mapChatMessage(message));
}

function mapChatMessage(message: ChatMessage): NativeContextMessage[] {
  if (message.type === 'compact-marker') {
    return [{ role: 'system', content: `[历史上下文摘要]\n${message.content}` }];
  }
  if (message.role === 'user' || message.role === 'system') {
    return [{
      role: message.role, content: message.content,
      ...(message.role === 'user' && message.images?.length ? { images: message.images } : {}),
    }];
  }
  if (message.nativeContext?.length) return mapNativeAssistant(message);
  if (message.toolSteps?.length) return mapLegacyToolSteps(message);
  if (message.toolCall) return mapSingleToolCall(message);
  return [assistantMessage(message.content, message.reasoningContent)];
}

function mapSingleToolCall(message: ChatMessage): NativeContextMessage[] {
  const id = `${message.id}-single`;
  return [
    {
      role: 'assistant', content: '',
      toolCalls: [{
        id,
        name: message.toolCall!.toolName,
        arguments: JSON.stringify(message.toolCall!.params),
      }],
    },
    { role: 'tool', content: message.toolCall!.result ?? '', toolCallId: id },
  ];
}

function mapNativeAssistant(message: ChatMessage): NativeContextMessage[] {
  const nativeContext = message.nativeContext!.map(item => ({ ...item }));
  const claimed = nativeContext.reduce(
    (sum, item) => sum + (item.role === 'assistant' ? item.reasoningContent?.length ?? 0 : 0), 0,
  );
  const finalReasoning = message.reasoningContent?.slice(claimed);
  if (message.content.trim() || finalReasoning) {
    nativeContext.push(assistantMessage(message.content, finalReasoning));
  }
  return nativeContext;
}

function mapLegacyToolSteps(message: ChatMessage): NativeContextMessage[] {
  const output: NativeContextMessage[] = [];
  message.toolSteps!.forEach((step, index) => {
    const id = `${message.id}-ts${index}`;
    output.push({
      role: 'assistant', content: '',
      toolCalls: [{ id, name: step.tool, arguments: JSON.stringify(step.args) }],
    });
    output.push({ role: 'tool', content: step.result ?? '', toolCallId: id });
  });
  if (message.content.trim()) output.push(assistantMessage(message.content, message.reasoningContent));
  return output;
}

function assistantMessage(content: string, reasoningContent?: string): NativeContextMessage {
  return {
    role: 'assistant', content,
    ...(reasoningContent ? { reasoningContent } : {}),
  };
}
