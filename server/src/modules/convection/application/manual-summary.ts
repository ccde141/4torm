import { compactMessages, splitCompactionMessages } from '../../../engine/shared/compaction/index.js';
import { saveSession, type ConvectionSessionData, type ConvectionMessage } from '../infrastructure/session-store.js';
import { loadAgent } from '../../../engine/shared/agent-loader.js';
import { convectionContext, convectionRecordText } from '../execution/compaction-context.js';
import { buildConvectionChairMessages } from '../execution/request-context.js';

export interface ConvectionSummary {
  summary: string;
  retained: ConvectionMessage[];
}

export function retainedConvectionMessages(messages: readonly ConvectionMessage[]): ConvectionMessage[] {
  const plan = splitCompactionMessages(convectionContext(messages), {
    mode: 'full', prefixRatio: 1, protectedPrefixCount: 0, recentHumanTurns: 3,
  });
  return plan ? messages.slice(messages.length - plan.tail.length) : [...messages];
}

export async function summarizeConvectionSession(
  dataDir: string,
  session: ConvectionSessionData,
  signal?: AbortSignal,
): Promise<ConvectionSummary> {
  const chair = await loadAgent(dataDir, session.chairAgentId);
  if (!chair) throw new Error('会长 Agent 不存在');
  const context = buildConvectionChairMessages(session, chair.name);
  const plan = await compactMessages({ dataDir, area: 'convection', model: chair.model,
    kind: 'meeting', chairModel: chair.model, prompt: chair.compactionPrompt, recentHumanTurns: 3,
    protectedPrefixCount: 0, scopeKey: `convection:${session.id}:public`,
    summaryContext: { messages: context.slice(0, 1) },
    messages: session.publicMessages.map(record => ({ role: 'user',
      origin: record.speaker === '人类' ? 'human' : 'framework',
      content: `[${record.speaker}] ${convectionRecordText(record)}`,
    })), mode: 'full', reason: 'manual', signal,
    onNotice: async notice => {
      session.compactionNotice = notice;
      await saveSession(dataDir, session);
    },
  });
  if (!plan) throw new Error('没有可压缩的会议记录');
  return { summary: plan.summary,
    retained: session.publicMessages.slice(plan.before.length - plan.tail.length) };
}
