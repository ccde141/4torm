import { loadAgent } from '../shared/agent-loader.js';
import { compactionPrompt, summarizeCompactionPrefix, type CompactionNotice } from '../shared/compaction/index.js';
import type { CompactionRequestContext } from '../shared/compaction/contracts.js';
import type { ContextMessage } from '../shared/types.js';

export function buildSeatCompactionPrompt(subject: string, summaryInput: string): string {
  return compactionPrompt({ kind: 'conversation', area: 'cycloneConversation', prompt: subject })
    + '\n--- 待压缩上下文 ---\n' + summaryInput;
}

export async function resolveSeatCompactionModel(dataDir: string, agentId: string): Promise<string> {
  const agent = await loadAgent(dataDir, agentId);
  if (!agent?.model) throw new Error('摘要 Agent 不存在或未配置模型');
  return agent.model;
}

export async function generateSeatCompactionSummary(params: {
  dataDir: string;
  fullModelKey: string;
  subject: string;
  compactionPrompt?: string;
  summaryInput: string;
  messages: ContextMessage[];
  summaryContext?: CompactionRequestContext;
  signal?: AbortSignal;
  onChunk?: (chunk: string) => void;
  onNotice?: (notice: CompactionNotice) => void | Promise<void>;
}): Promise<string> {
  const summary = await summarizeCompactionPrefix({ dataDir: params.dataDir,
    area: 'cycloneConversation', kind: 'conversation', model: params.fullModelKey,
    summaryContext: params.summaryContext,
    prompt: [params.compactionPrompt, params.subject].filter(Boolean).join('\n'), onNotice: params.onNotice },
  params.messages, params.signal);
  params.onChunk?.(summary);
  return summary;
}
