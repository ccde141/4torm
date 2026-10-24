import { estimateCurrentInput, resolveNativeMode } from '../../../engine/shared/llm-bridge.js';
import type { CurrentInputEstimate } from '../../../engine/shared/model-request-usage.js';
import type { ConvectionSessionData } from '../infrastructure/session-store.js';
import { loadRequiredAgent } from './round-agent-snapshot.js';
import { buildAgentMessages } from './participant-context.js';
import { buildConvectionChairMessages } from './request-context.js';

export interface ConvectionCurrentInput {
  publicCurrentInput?: CurrentInputEstimate;
  chairCurrentInput?: CurrentInputEstimate;
}

/** Rebuild only effective model input. No runner, request observation or tool execution. */
export async function readConvectionCurrentInput(
  dataDir: string, session: ConvectionSessionData,
): Promise<ConvectionCurrentInput> {
  const [participants, chair] = await Promise.all([
    Promise.allSettled(session.participantAgentIds.map(async id => {
      const agent = await loadRequiredAgent(dataDir, id);
      const native = await resolveNativeMode(dataDir, agent.model)
        .then(decision => decision.native, () => false);
      const built = await buildAgentMessages(dataDir, session, agent, native);
      return estimateCurrentInput({ dataDir, fullModelKey: agent.model,
        messages: built.messages, options: { temperature: agent.temperature },
        ...(native ? { tools: built.toolDefs } : {}) });
    })),
    estimateChair(dataDir, session).catch(() => undefined),
  ]);
  const publicInput = participants.reduce<CurrentInputEstimate | undefined>((largest, result) =>
    result.status === 'fulfilled' && (!largest || result.value.tokens > largest.tokens)
      ? result.value : largest, undefined);
  return { ...(publicInput ? { publicCurrentInput: publicInput } : {}),
    ...(chair ? { chairCurrentInput: chair } : {}) };
}

async function estimateChair(dataDir: string, session: ConvectionSessionData) {
  const agent = await loadRequiredAgent(dataDir, session.chairAgentId);
  return estimateCurrentInput({ dataDir, fullModelKey: agent.model,
    messages: buildConvectionChairMessages(session, agent.name),
    options: { temperature: agent.temperature } });
}
