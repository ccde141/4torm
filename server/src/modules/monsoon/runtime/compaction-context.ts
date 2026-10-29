import { resolveNativeMode } from '../../../engine/shared/llm-bridge.js';
import { turnSpec } from '../application/chat-preparation.js';
import type { MonsoonCompactionContextBuilder } from '../application/compaction-service.js';
import { buildMonsoonInputPrompt } from './chat-context-adapter.js';

/** Human compaction reuses the same role/tool assembly as the next ordinary turn. */
export const buildMonsoonCompactionContext: MonsoonCompactionContextBuilder = async input => {
  if (!input.agent) return { messages: [{ role: 'system', content: input.session.systemPrompt }] };
  const native = (await resolveNativeMode(input.dataDir, input.model)).native;
  const spec = turnSpec(input.dataDir, input.session.id, input.agent, input.model, native);
  const built = await buildMonsoonInputPrompt({ dataDir: input.dataDir, agent: input.agent, spec, native,
    input: { sessionId: input.session.id, agentId: input.agent.id,
      messages: input.messages.map(message => ({ role: message.role, content: message.content })) } });
  return { messages: [{ role: 'system', content: built.systemPrompt }],
    ...(native ? { tools: built.toolDefs } : {}), historyToolTransport: native ? 'native' : 'text' };
};
