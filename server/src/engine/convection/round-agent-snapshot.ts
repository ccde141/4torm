import { loadAgent, type LoadedAgent } from '../shared/agent-loader.js';

export type RoundAgentSnapshot = ReadonlyMap<string, LoadedAgent>;

export async function loadRoundAgents(
  dataDir: string,
  agentIds: readonly string[],
): Promise<RoundAgentSnapshot> {
  const uniqueIds = [...new Set(agentIds)];
  const loaded = await Promise.all(uniqueIds.map(id => loadRequiredAgent(dataDir, id)));
  return new Map(loaded.map(agent => [agent.id, agent]));
}

export async function loadRequiredAgent(
  dataDir: string,
  agentId: string,
): Promise<LoadedAgent> {
  const agent = await loadAgent(dataDir, agentId);
  if (!agent) throw new Error(`Agent 实体不存在：${agentId}`);
  return agent;
}

export function roundAgent(agents: RoundAgentSnapshot, agentId: string): LoadedAgent {
  const agent = agents.get(agentId);
  if (!agent) throw new Error(`本轮 Agent 快照缺失：${agentId}`);
  return agent;
}
