import { loadAgent } from '../../../engine/shared/agent-loader.js';
import { compactMessages } from '../../../engine/shared/compaction/index.js';
import type { CycloneContextSummarizer, CycloneSummaryInput } from '../domain/context-summary.js';

/** Domain services archive and lock; this adapter only selects and calls the summarizer. */
export class LlmCycloneContextSummarizer implements CycloneContextSummarizer {
  constructor(private readonly dataDir: string) {}

  async summarize(input: CycloneSummaryInput): Promise<string> {
    if (!input.messages.length) return '';
    const agent = await loadAgent(this.dataDir, input.agentId);
    if (!agent?.model) throw new Error('压缩 Agent 不存在或未配置模型');
    const kind = input.kind || 'conversation';
    const plan = await compactMessages({ dataDir: this.dataDir,
      area: kind === 'meeting' ? 'cycloneMeeting' : 'cycloneConversation', kind,
      model: agent.model, chairModel: kind === 'meeting' ? agent.model : undefined,
      prompt: [agent.compactionPrompt, `当前场所：${input.subject}`].filter(Boolean).join('\n'),
      messages: input.messages.map(message => ({ role: 'user',
        content: `[${message.role}] ${message.content}` })),
      protectedPrefixCount: 0, mode: 'full', reason: 'manual', onNotice: input.onNotice,
    });
    if (!plan?.summary) throw new Error('没有可压缩的完整会话内容');
    return plan.summary;
  }
}
