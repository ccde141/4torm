import { loadAgent } from '../../../engine/shared/agent-loader.js';
import { estimateCurrentInput } from '../../../engine/shared/llm-bridge.js';
import type { TideTask } from '../domain/task.js';
import { buildTideInputContext } from '../runtime/input-context.js';
import { activeTideContext } from './active-context.js';
import type { TideSession } from './session-types.js';
import type { SeasonSessionPort } from './season-session-port.js';

/** Source records and archive bills are untouched; estimate only the effective continuation. */
export async function currentTideInput(dataDir: string, session: TideSession,
  task?: TideTask, seasonSessions?: SeasonSessionPort) {
  const designated = task?.pushMode === 'designated' && seasonSessions
    ? await seasonSessions.read(session.agentId, session.id) : null;
  const history = designated && seasonSessions
    ? await seasonSessions.activeContext(designated) : activeTideContext(session.messages);
  const agent = await loadAgent(dataDir, session.agentId);
  if (!agent) return { ...await estimateCurrentInput({ dataDir, fullModelKey: session.model,
    messages: [{ role: 'system', content: session.systemPrompt }, ...history] }), basis: 'canonical' as const };
  const latestInput = [...history].reverse().find(message => message.role === 'user')?.content ?? '';
  try {
    const input = await buildTideInputContext(dataDir, agent, session.id,
      { userMessage: latestInput, selfLoop: task?.selfLoop });
    return estimateCurrentInput({ dataDir, fullModelKey: agent.model,
      messages: [{ role: 'system', content: input.systemPrompt }, ...history], tools: input.tools });
  } catch {
    return { ...await estimateCurrentInput({ dataDir, fullModelKey: agent.model,
      messages: [{ role: 'system', content: session.systemPrompt }, ...history] }), basis: 'canonical' as const };
  }
}
