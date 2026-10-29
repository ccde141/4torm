import { loadAgent } from '../../../engine/shared/agent-loader.js';
import { estimateCurrentInput, resolveNativeMode } from '../../../engine/shared/llm-bridge.js';
import { prependSystemPrompt } from '../../../engine/conversation/context-messages.js';
import type { MonsoonSession } from '../domain/session.js';
import { MonsoonContextPort } from '../application/context-port.js';
import { projectMonsoonContext } from '../application/active-context.js';
import { turnSpec } from '../application/chat-preparation.js';
import { buildMonsoonInputPrompt } from './chat-context-adapter.js';
import { FileMonsoonTurnJournal } from '../infrastructure/turn-journal.js';
import type { ContextMessage } from '../../../engine/shared/types.js';

/** Estimate the active model context, not the display archive or a future user draft. */
export function createMonsoonInputPreview(dataDir: string,
  live?: (sessionId: string) => Promise<import('../../../engine/shared/model-request-usage.js').CurrentInputEstimate> | undefined) {
  const contexts = new MonsoonContextPort(dataDir);
  const journal = new FileMonsoonTurnJournal(dataDir);
  return async (session: MonsoonSession, overrideModel?: string) => {
    const model = overrideModel || session.model;
    const running = await live?.(session.id);
    if (running && running.model === model) return { ...session, currentInput: running };
    const estimateSession = await withPendingContext(session, journal);
    // A genuinely new conversation may remain unmeasured; an emptied existing one still has a prompt.
    if (!session.messages.length && session.messageRevision <= 1 && !session.modelUsage && !session.tokenUsage) {
      return { ...session, currentInput: undefined };
    }
    const fallback = async () => {
      const currentInput = await estimateCurrentInput({ dataDir, fullModelKey: model,
        messages: prependSystemPrompt(session.systemPrompt, projectMonsoonContext(estimateSession)) });
      return { ...session, currentInput: { ...currentInput, basis: 'canonical' as const,
        contextRevision: session.messageRevision } };
    };
    const agent = await loadAgent(dataDir, session.agentId);
    if (!agent) return fallback();
    try {
      const effectiveModel = model || agent.model;
      const native = (await resolveNativeMode(dataDir, effectiveModel)).native;
      const history = await contexts.modelContext(estimateSession);
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

/** A stopped/failed turn can have durable context before the display transcript absorbs it. */
async function withPendingContext(session: MonsoonSession, journal: FileMonsoonTurnJournal): Promise<MonsoonSession> {
  const pending = await journal.pending(session.agentId, session.id, session.messages, false);
  if (!pending.length) return session;
  const messages = [...session.messages];
  for (const run of pending) {
    const event = [...run.events].reverse().find(event => event.type === 'input-context');
    const checkpoint = event?.checkpoint as { context?: ContextMessage[] } | undefined;
    if (!checkpoint || !Array.isArray(checkpoint.context)) continue;
    const index = messages.findIndex(message => message.id === run.runId);
    const restored = { id: run.runId, role: 'assistant' as const, content: '', timestamp: session.updatedAt,
      runCommitted: true, contextExact: true, nativeContext: checkpoint.context };
    if (index >= 0) messages[index] = restored; else messages.push(restored);
  }
  return { ...session, messages };
}
