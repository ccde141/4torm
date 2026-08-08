import type { SeatContextMessage } from './types.js';

export const CYCLONE_COMPACT_KEEP_TURNS = 3;
export const CYCLONE_COMPACT_MIN_TOKENS = 8_000;

export type SeatCompactionPlan = {
  ok: true;
  archivedMessages: SeatContextMessage[];
  keptMessages: SeatContextMessage[];
  summaryInput: string;
  estimatedTokens: number;
  keptTurnCount: number;
} | {
  ok: false;
  reason: 'below-threshold' | 'not-enough-turns' | 'nothing-to-compact';
  estimatedTokens: number;
  turnCount: number;
};

function estimateTextTokens(text: string): number {
  let total = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    const compactScript = (code >= 0x4E00 && code <= 0x9FFF)
      || (code >= 0x3040 && code <= 0x30FF)
      || (code >= 0xAC00 && code <= 0xD7AF);
    total += compactScript ? 0.6 : 0.3;
  }
  return Math.ceil(total);
}

function estimateMessageTokens(message: SeatContextMessage): number {
  const toolCalls = message.toolCalls ? JSON.stringify(message.toolCalls) : '';
  const reasoning = message.reasoningContent || message.reasoning || '';
  return estimateTextTokens(`${message.content || ''}${toolCalls}${reasoning}`);
}

function messageLabel(message: SeatContextMessage): string {
  if (message.role === 'user') return '用户';
  if (message.role === 'assistant') return '助手';
  if (message.role === 'tool') return `工具结果${message.toolCallId ? ` (${message.toolCallId})` : ''}`;
  return '系统上下文';
}

function serializeMessage(message: SeatContextMessage): string {
  const parts = [`${messageLabel(message)}: ${message.content || ''}`];
  for (const call of message.toolCalls || []) {
    parts.push(`工具调用 ${call.name} (${call.id}): ${call.arguments}`);
  }
  return parts.join('\n');
}

function userTurnStarts(messages: SeatContextMessage[]): number[] {
  const starts: number[] = [];
  messages.forEach((message, index) => {
    if (message.role === 'user') starts.push(index);
  });
  return starts;
}

/**
 * 按人类回合切分，而不是按原始消息条数切分。
 * assistant/tool/Ask 恢复都依附于最近一次 user 消息，避免压缩后留下断裂的工具链。
 */
export function planSeatCompaction(
  messages: SeatContextMessage[],
  promptTokens?: number,
): SeatCompactionPlan {
  const estimatedTokens = promptTokens && promptTokens > 0
    ? promptTokens
    : messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
  const starts = userTurnStarts(messages);
  if (estimatedTokens < CYCLONE_COMPACT_MIN_TOKENS) {
    return { ok: false, reason: 'below-threshold', estimatedTokens, turnCount: starts.length };
  }
  if (starts.length <= CYCLONE_COMPACT_KEEP_TURNS) {
    return { ok: false, reason: 'not-enough-turns', estimatedTokens, turnCount: starts.length };
  }

  const keepFrom = starts[starts.length - CYCLONE_COMPACT_KEEP_TURNS];
  const archivedMessages = messages.slice(0, keepFrom);
  const summaryInput = archivedMessages.map(serializeMessage).join('\n\n').trim();
  if (!summaryInput) {
    return { ok: false, reason: 'nothing-to-compact', estimatedTokens, turnCount: starts.length };
  }
  return {
    ok: true,
    archivedMessages,
    keptMessages: messages.slice(keepFrom),
    summaryInput,
    estimatedTokens,
    keptTurnCount: CYCLONE_COMPACT_KEEP_TURNS,
  };
}
