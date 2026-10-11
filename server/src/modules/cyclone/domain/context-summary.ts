import type { CompactionNotice } from '../../../engine/shared/compaction/index.js';

export interface CycloneSummaryMessage {
  role: string;
  content: string;
}

export interface CycloneSummaryInput {
  agentId: string;
  subject: string;
  messages: CycloneSummaryMessage[];
  kind?: 'conversation' | 'meeting';
  onNotice?: (notice: CompactionNotice) => void | Promise<void>;
}

export interface CycloneContextSummarizer {
  summarize(input: CycloneSummaryInput): Promise<string>;
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
}>): CycloneSummaryMessage[] {
  return messages.map(message => ({
    role: message.role || (message.isHuman ? 'user' : message.speaker || 'assistant'),
    content: [message.rawContent || message.content || '',
      message.tool_calls ? `工具请求：${JSON.stringify(message.tool_calls)}` : '',
      message.toolCalls ? `工具事实：${JSON.stringify(message.toolCalls)}` : '',
      message.tools ? `工具事实：${JSON.stringify(message.tools)}` : '',
    ].filter(Boolean).join('\n'),
  })).filter(message => message.content.trim());
}
