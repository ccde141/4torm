import type { CompactionNotice } from '../../../engine/shared/compaction/index.js';
import type { ContextMessage } from '../../../engine/shared/types.js';

export interface CycloneSummaryMessage {
  role: string;
  content: string;
  origin?: 'human' | 'framework';
  context?: ContextMessage;
}

export interface CycloneSummaryInput {
  agentId: string;
  subject: string;
  messages: CycloneSummaryMessage[];
  kind?: 'conversation' | 'meeting';
  recentHumanTurns?: 3 | 4;
  target?: { workshopId: string; kind: 'seat' | 'room' | 'chair'; id: string }
    | { workshopId: string; kind: 'supervisor' };
  signal?: AbortSignal;
  onNotice?: (notice: CompactionNotice) => void | Promise<void>;
}

export interface CycloneContextSummarizer {
  summarize(input: CycloneSummaryInput): Promise<CycloneContextSummary>;
}

export interface CycloneContextSummary {
  summary: string;
  retainedIndexes: number[];
}

export function retainedCycloneMessages<T>(messages: readonly T[], result: CycloneContextSummary): T[] {
  if (result.retainedIndexes.some((index, position) => !Number.isSafeInteger(index) || index < 0
    || index >= messages.length || (position > 0 && index <= result.retainedIndexes[position - 1]))) {
    throw new Error('压缩原文保留计划无效');
  }
  return result.retainedIndexes.map(index => messages[index]);
}

/** Public observations remain in the exact model context, never become private chat bubbles. */
export function retainedCyclonePrivateMessages<T>(messages: readonly T[], context: readonly ContextMessage[],
  result: CycloneContextSummary): T[] {
  retainedCycloneMessages(context, result);
  const retained = new Set(result.retainedIndexes);
  const selected: T[] = [];
  let cursor = context.length - 1;
  for (let index = messages.length - 1; index >= 0; index--) {
    const record = JSON.stringify(messages[index]);
    let match = cursor;
    while (match >= 0 && JSON.stringify(context[match]) !== record) match--;
    if (match < 0) continue;
    cursor = match;
    if (retained.has(cursor)) selected.unshift(messages[index]);
    cursor--;
  }
  return selected;
}

export function toCycloneSummaryMessages(messages: Array<{
  role?: string;
  speaker?: string;
  content?: string;
  isHuman?: boolean;
  tool_calls?: unknown;
  toolCalls?: unknown;
  tools?: unknown;
  rawContent?: string;
  origin?: 'human' | 'framework';
  toolCallId?: string;
  images?: ContextMessage['images'];
  toolImages?: ContextMessage['toolImages'];
  reasoningContent?: string;
}>): CycloneSummaryMessage[] {
  return messages.map(message => ({
    role: message.role || (message.isHuman ? 'user' : message.speaker || 'assistant'),
    origin: message.origin ?? (message.isHuman || message.role === 'user' || message.speaker === '人类' ? 'human' : 'framework'),
    content: [message.rawContent || message.content || '',
      message.tool_calls ? `工具请求：${JSON.stringify(message.tool_calls)}` : '',
      message.toolCalls ? `工具事实：${JSON.stringify(message.toolCalls)}` : '',
      message.tools ? `工具事实：${JSON.stringify(message.tools)}` : '',
    ].filter(Boolean).join('\n'),
    ...(['system', 'user', 'assistant', 'tool'].includes(message.role || '')
      ? { context: { ...message, role: message.role as ContextMessage['role'],
        content: message.content || '',
        toolCalls: Array.isArray(message.toolCalls) && message.toolCalls.every(call =>
          call && typeof call === 'object' && typeof call.id === 'string'
          && typeof call.name === 'string' && typeof call.arguments === 'string')
          ? message.toolCalls as ContextMessage['toolCalls'] : undefined } }
      : {}),
  }));
}
