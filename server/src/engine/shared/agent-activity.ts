import { randomUUID } from 'node:crypto';

export type AgentSurface = 'conversation' | 'convection' | 'cyclone' | 'tradewind' | 'tide';

export interface AgentActivitySnapshot {
  busy: boolean;
  surfaces: AgentSurface[];
}

interface ActivityEntry {
  agentId: string;
  surface: AgentSurface;
}

const activities = new Map<string, ActivityEntry>();

function snapshotFor(agentId: string): AgentActivitySnapshot {
  const surfaces = new Set<AgentSurface>();
  for (const entry of activities.values()) {
    if (entry.agentId === agentId) surfaces.add(entry.surface);
  }
  return { busy: surfaces.size > 0, surfaces: [...surfaces] };
}

export interface AgentActivityHandle {
  readonly agentId: string;
  readonly surface: AgentSurface;
  end(): void;
}

export function beginAgentActivity(agentId: string, surface: AgentSurface): AgentActivityHandle {
  const id = randomUUID();
  activities.set(id, { agentId, surface });
  let ended = false;
  return {
    agentId,
    surface,
    end() {
      if (ended) return;
      ended = true;
      activities.delete(id);
    },
  };
}

export async function withAgentActivity<T>(
  agentId: string,
  surface: AgentSurface,
  run: () => Promise<T>,
): Promise<T> {
  const activity = beginAgentActivity(agentId, surface);
  try {
    return await run();
  } finally {
    activity.end();
  }
}

export function getAgentActivity(agentId: string): AgentActivitySnapshot {
  return snapshotFor(agentId);
}

export function getAllAgentActivities(): Map<string, AgentActivitySnapshot> {
  const agentIds = new Set<string>();
  for (const entry of activities.values()) agentIds.add(entry.agentId);
  return new Map([...agentIds].map(id => [id, snapshotFor(id)]));
}

export function clearAgentActivities(): void {
  activities.clear();
}
