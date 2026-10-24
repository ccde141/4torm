import { loadAgent } from '../shared/agent-loader.js';
import { compactionPrompt, summarizeCompactionPrefix, type CompactionNotice,
  type CompactionStageProgress } from '../shared/compaction/index.js';

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
  scopeKey?: string;
  signal?: AbortSignal;
  onChunk?: (chunk: string) => void;
  onNotice?: (notice: CompactionNotice) => void | Promise<void>;
  onStageProgress?: (stage: CompactionStageProgress) => void | Promise<void>;
}): Promise<string> {
  const summary = await summarizeCompactionPrefix({ dataDir: params.dataDir,
    area: 'cycloneConversation', kind: 'conversation', model: params.fullModelKey,
    prompt: [params.compactionPrompt, params.subject].filter(Boolean).join('\n'), onNotice: params.onNotice,
    scopeKey: params.scopeKey, onStageProgress: params.onStageProgress },
  [{ role: 'user', content: params.summaryInput }], params.signal);
  params.onChunk?.(summary);
  return summary;
}
