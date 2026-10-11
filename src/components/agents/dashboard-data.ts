import type { Agent, DashboardStats } from '../../types';

interface DashboardDataDeps {
  getAgentsWithActivity(): Promise<{ agents: Agent[]; activityAvailable: boolean }>;
  getAllSessions(): Promise<unknown[]>;
  getOfflineAgentIds(agents: Agent[]): Promise<Set<string>>;
}

export interface DashboardSnapshot {
  agents: Agent[];
  activityAvailable: boolean;
  offlineIds: Set<string>;
  stats: DashboardStats;
}

export async function loadDashboardSnapshot(
  deps: DashboardDataDeps,
  onAgentsReady: (agents: Agent[], activityAvailable: boolean) => void = () => {},
): Promise<DashboardSnapshot> {
  const agentsPromise = deps.getAgentsWithActivity();
  const sessionsPromise = deps.getAllSessions();
  const { agents, activityAvailable } = await agentsPromise;
  onAgentsReady(agents, activityAvailable);
  const [sessions, offlineIds] = await Promise.all([
    sessionsPromise,
    deps.getOfflineAgentIds(agents),
  ]);
  const onlineAgents = agents.filter(agent => (
    activityAvailable && agent.status === 'idle' && !agent.busy && !offlineIds.has(agent.id)
  )).length;
  return {
    agents,
    activityAvailable,
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
