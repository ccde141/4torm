import { compactMessages } from '../../../engine/shared/compaction/index.js';
import { saveSession, type ConvectionSessionData } from '../infrastructure/session-store.js';
import { loadAgent } from '../../../engine/shared/agent-loader.js';

export async function summarizeConvectionSession(
  dataDir: string,
  session: ConvectionSessionData,
  signal?: AbortSignal,
): Promise<string> {
  const chair = await loadAgent(dataDir, session.chairAgentId);
  if (!chair) throw new Error('会长 Agent 不存在');
  const plan = await compactMessages({ dataDir, area: 'convection', model: chair.model,
    kind: 'meeting', chairModel: chair.model, prompt: chair.compactionPrompt,
    protectedPrefixCount: 0, scopeKey: `convection:${session.id}:public`,
    messages: session.publicMessages.map(record => ({ role: 'user',
      content: `[${record.speaker}] ${record.content}`
        + (record.toolCalls?.length ? `\n工具事实：${JSON.stringify(record.toolCalls)}` : ''),
    })), mode: 'full', reason: 'manual', signal,
    onNotice: async notice => {
      session.compactionNotice = notice;
      await saveSession(dataDir, session);
    },
  });
  if (!plan) throw new Error('没有可压缩的会议记录');
  return plan.summary;
}
