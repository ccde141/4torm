interface StoredToolCall {
  tool: string;
  args: Record<string, string>;
  result?: string;
}

interface StoredConvectionMessage {
  speaker: string;
  content: string;
  rawContent?: string;
  reasoning?: string;
  timestamp?: string | number;
  toolCalls?: StoredToolCall[];
}

export function restoreConvectionMessage(message: StoredConvectionMessage) {
  return {
    speaker: message.speaker,
    content: message.content,
    ...(message.rawContent ? { rawContent: message.rawContent } : {}),
    ...(message.reasoning ? { reasoning: message.reasoning } : {}),
    ...(message.timestamp !== undefined ? { timestamp: new Date(message.timestamp).toISOString() } : {}),
    ...(message.toolCalls ? {
      toolCalls: message.toolCalls.map(toolCall => ({ ...toolCall, status: 'done' as const })),
    } : {}),
  };
}
