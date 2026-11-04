import type { Agent, DashboardStats } from '../../types';

interface DashboardDataDeps {
  getAgentsWithActivity(): Promise<{ agents: Agent[]; activityAvailable: boolean }>;
  getAllSessions(): Promise<unknown[]>;
}

export interface DashboardSnapshot {
  agents: Agent[];
  activityAvailable: boolean;
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
  const sessions = await sessionsPromise;
  const onlineAgents = agents.filter(agent => (
    activityAvailable && !agent.busy
  )).length;
  return {
    agents,
    activityAvailable,
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
