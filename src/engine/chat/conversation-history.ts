import type { ChatMessage, NativeContextMessage } from '../../types';

export function buildConversationHistory(messages: ChatMessage[]): NativeContextMessage[] {
  return messages.flatMap(message => mapChatMessage(message));
}

function mapChatMessage(message: ChatMessage): NativeContextMessage[] {
  if (message.contextOmitted) return [];
  const mapped = mapMessageContent(message);
  if (!message.streamStopped) return mapped;
  return [...mapped, assistantMessage(
    '上一轮执行被人类停止。已返回的工具结果和已经产生的文件改动仍然有效；没有结果的步骤不得视为完成，以上记录不代表任务完成。请结合人类的新消息判断是否继续。',
  )];
}

function mapMessageContent(message: ChatMessage): NativeContextMessage[] {
  if (message.ask?.answered && typeof message.ask.reply === 'string') {
    return [assistantMessage(message.content), { role: 'user', content: message.ask.reply }];
  }
  if (message.contextExact && message.nativeContext) return message.nativeContext.map(item => ({ ...item }));
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
    { role: 'tool', content: toolResult(message.toolCall!), toolCallId: id },
  ];
}

function mapNativeAssistant(message: ChatMessage): NativeContextMessage[] {
  const nativeContext = message.nativeContext!.map(item => ({ ...item }));
  const finalContent = unclaimedContent(message.content, nativeContext);
  const claimed = nativeContext.reduce(
    (sum, item) => sum + (item.role === 'assistant' ? item.reasoningContent?.length ?? 0 : 0), 0,
  );
  const finalReasoning = message.reasoningContent?.slice(claimed);
  if (finalContent.trim() || finalReasoning) {
    nativeContext.push(assistantMessage(finalContent, finalReasoning));
  }
  return nativeContext;
}

function unclaimedContent(content: string, context: NativeContextMessage[]): string {
  const claimed = context
    .filter(item => item.role === 'assistant' && item.content.trim())
    .map(item => item.content)
    .join('\n\n');
  if (!claimed) return content;
  if (content === claimed) return '';
  const prefix = `${claimed}\n\n`;
  return content.startsWith(prefix) ? content.slice(prefix.length) : content;
}

function mapLegacyToolSteps(message: ChatMessage): NativeContextMessage[] {
  const output: NativeContextMessage[] = [];
  message.toolSteps!.forEach((step, index) => {
    const id = `${message.id}-ts${index}`;
    output.push({
      role: 'assistant', content: '',
      toolCalls: [{ id, name: step.tool, arguments: JSON.stringify(step.args) }],
    });
    output.push({ role: 'tool', content: toolResult(step), toolCallId: id });
  });
  if (message.content.trim()) output.push(assistantMessage(message.content, message.reasoningContent));
  return output;
}

function toolResult(step: { status: string; result?: string }): string {
  if ((step.status === 'pending' || step.status === 'running') && step.result === undefined) {
    return '工具执行被停止，没有返回结果；不要假定该操作成功。';
  }
  return step.result ?? '';
}

function assistantMessage(content: string, reasoningContent?: string): NativeContextMessage {
  return {
    role: 'assistant', content,
    ...(reasoningContent ? { reasoningContent } : {}),
  };
}
