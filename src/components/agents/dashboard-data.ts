import type { Agent, DashboardStats } from '../../types';

interface DashboardDataDeps {
  getAgents(): Promise<Agent[]>;
  getAllSessions(): Promise<unknown[]>;
  getOfflineAgentIds(agents: Agent[]): Promise<Set<string>>;
}

export interface DashboardSnapshot {
  agents: Agent[];
  offlineIds: Set<string>;
  stats: DashboardStats;
}

export async function loadDashboardSnapshot(
  deps: DashboardDataDeps,
  onAgentsReady: (agents: Agent[]) => void = () => {},
): Promise<DashboardSnapshot> {
  const agentsPromise = deps.getAgents();
  const sessionsPromise = deps.getAllSessions();
  const agents = await agentsPromise;
  onAgentsReady(agents);
  const [sessions, offlineIds] = await Promise.all([
    sessionsPromise,
    deps.getOfflineAgentIds(agents),
  ]);
  const onlineAgents = agents.filter(agent => (
    agent.status === 'idle' && !agent.busy && !offlineIds.has(agent.id)
  )).length;
  return {
    agents,
    offlineIds,
    stats: {
      totalAgents: agents.length,
      onlineAgents,
      totalSessions: sessions.length,
      activeSessions: sessions.length,
      avgResponseTime: 0,
      totalToolCalls: 0,
    },
  };
}
