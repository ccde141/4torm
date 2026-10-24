import { loadAgent } from '../../../engine/shared/agent-loader.js';
import { estimateCurrentInput, resolveNativeMode } from '../../../engine/shared/llm-bridge.js';
import { prependSystemPrompt } from '../../../engine/conversation/context-messages.js';
import type { MonsoonSession } from '../domain/session.js';
import { MonsoonContextPort } from '../application/context-port.js';
import { projectMonsoonContext } from '../application/active-context.js';
import { turnSpec } from '../application/chat-preparation.js';
import { buildMonsoonInputPrompt } from './chat-context-adapter.js';

/** Estimate the active model context, not the display archive or a future user draft. */
export function createMonsoonInputPreview(dataDir: string) {
  const contexts = new MonsoonContextPort(dataDir);
  return async (session: MonsoonSession, overrideModel?: string) => {
    const model = overrideModel || session.model;
    // A genuinely new conversation may remain unmeasured; an emptied existing one still has a prompt.
    if (!session.messages.length && session.messageRevision <= 1 && !session.modelUsage && !session.tokenUsage) {
      return { ...session, currentInput: undefined };
    }
    const fallback = async () => {
      const currentInput = await estimateCurrentInput({ dataDir, fullModelKey: model,
        messages: prependSystemPrompt(session.systemPrompt, projectMonsoonContext(session)) });
      return { ...session, currentInput: { ...currentInput, basis: 'canonical' as const,
        contextRevision: session.messageRevision } };
    };
    const agent = await loadAgent(dataDir, session.agentId);
    if (!agent) return fallback();
    try {
      const effectiveModel = model || agent.model;
      const native = (await resolveNativeMode(dataDir, effectiveModel)).native;
      const history = await contexts.modelContext(session);
      const { systemPrompt, toolDefs } = await buildMonsoonInputPrompt({ dataDir, agent, native,
        spec: turnSpec(dataDir, session.id, agent, effectiveModel, native),
        input: { agentId: session.agentId, sessionId: session.id,
          messages: history.map(message => ({ role: message.role, content: message.content })) } });
      return { ...session, currentInput: { ...await estimateCurrentInput({ dataDir, fullModelKey: effectiveModel,
        messages: prependSystemPrompt(systemPrompt, history), ...(native ? { tools: toolDefs } : {}) }),
        contextRevision: session.messageRevision } };
    } catch {
      return fallback();
    }
  };
}
