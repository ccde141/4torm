import { loadAgent } from '../../../engine/shared/agent-loader.js';
import { compactMessages } from '../../../engine/shared/compaction/index.js';
import type { CycloneContextSummarizer, CycloneContextSummary, CycloneSummaryInput } from '../domain/context-summary.js';
import { buildCycloneCompactionContext } from '../runtime/compaction-context.js';

/** Domain services archive and lock; this adapter only selects and calls the summarizer. */
export class LlmCycloneContextSummarizer implements CycloneContextSummarizer {
  constructor(private readonly dataDir: string) {}

  async summarize(input: CycloneSummaryInput): Promise<CycloneContextSummary> {
    const agent = await loadAgent(this.dataDir, input.agentId);
    if (!agent?.model) throw new Error('压缩 Agent 不存在或未配置模型');
    const kind = input.kind || 'conversation';
    const summaryContext = await buildCycloneCompactionContext(this.dataDir, agent, input.target);
    const messages = input.messages.map(message => message.context ?? { role: 'user' as const,
      origin: message.origin, content: `[${message.role}] ${message.content}` });
    const plan = await compactMessages({ dataDir: this.dataDir,
      area: kind === 'meeting' && input.recentHumanTurns !== 4 ? 'cycloneMeeting' : 'cycloneConversation', kind,
      model: agent.model, chairModel: kind === 'meeting' ? agent.model : undefined,
      prompt: [agent.compactionPrompt, `当前场所：${input.subject}`].filter(Boolean).join('\n'),
      onNotice: input.onNotice,
      summaryContext,
      messages, protectedPrefixCount: 0, recentHumanTurns: input.recentHumanTurns,
      mode: 'full', reason: 'manual', signal: input.signal,
    });
    if (!plan) throw new Error('近期原文保护范围内没有更早的可压缩内容');
    return { summary: plan.summary, retainedIndexes: Array.from({ length: plan.tail.length },
      (_, index) => input.messages.length - plan.tail.length + index) };
  }
}
