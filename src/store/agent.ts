import { getAllModels, getProviderForModel } from '../llm';
import type { Agent, AgentConfig } from '../types';
import { notifyAgentsChanged } from './agent-events';

const BASE = '/api/agents';
type AgentSurface = NonNullable<Agent['activeSurfaces']>[number];
type AgentActivities = Record<string, { busy: boolean; surfaces: AgentSurface[] }>;
const ACTIVITY_SURFACES = new Set(['conversation', 'convection', 'cyclone', 'tradewind', 'tide']);

async function readAgentActivities(): Promise<AgentActivities | null> {
  try {
    const response = await fetch('/api/collaboration/presence');
    if (!response.ok) return null;
    const value: unknown = await response.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const snapshot = value as { schemaVersion?: unknown; completeness?: unknown;
      observedAt?: unknown; agents?: unknown };
    if (snapshot.schemaVersion !== 1 || snapshot.completeness !== 'complete'
      || typeof snapshot.observedAt !== 'string'
      || !snapshot.agents || typeof snapshot.agents !== 'object'
      || Array.isArray(snapshot.agents)
      || Object.values(snapshot.agents).some(activity => !activity
        || typeof activity !== 'object' || Array.isArray(activity)
        || typeof (activity as { busy?: unknown }).busy !== 'boolean'
        || !Array.isArray((activity as { surfaces?: unknown }).surfaces)
        || !(activity as { surfaces: unknown[] }).surfaces.every(
          surface => typeof surface === 'string' && ACTIVITY_SURFACES.has(surface))
        || (activity as { busy: boolean; surfaces: unknown[] }).busy
          !== ((activity as { surfaces: unknown[] }).surfaces.length > 0))) return null;
    return snapshot.agents as AgentActivities;
  } catch {
    return null;
  }
}

export function mergeAgentActivities(agents: Agent[], activities: AgentActivities): Agent[] {
  return agents.map(agent => {
    const activity = activities[agent.id];
    return {
      ...agent,
      busy: activity?.busy ?? false,
      activeSurfaces: activity?.surfaces ?? [],
    };
  });
}

export async function getAgents(): Promise<Agent[]> {
  return (await getAgentsWithActivity()).agents;
}

export async function getAgentsWithActivity(): Promise<{
  agents: Agent[]; activityAvailable: boolean;
}> {
  const [agents, activities] = await Promise.all([
    request<Agent[]>(BASE), readAgentActivities(),
  ]);
  return {
    agents: (activities ? mergeAgentActivities(agents, activities) : agents)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    activityAvailable: activities !== null,
  };
}

export async function getAgent(id: string): Promise<Agent | null> {
  return (await getAgents()).find(agent => agent.id === id) ?? null;
}

export async function createAgent(params: {
  name: string;
  role: string;
  description: string;
  model?: string;
  config?: AgentConfig;
}): Promise<Agent> {
  const models = params.model ? [] : await getAllModels();
  const agent = await request<Agent>(BASE, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...params, model: params.model || models[0]?.key || '',
      config: params.config || {} }),
  });
  notifyAgentsChanged();
  return agent;
}

export async function updateAgent(id: string, patch: Partial<Agent>): Promise<void> {
  const payload = patchPayload(patch);
  await request(`${BASE}/${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  notifyAgentsChanged();
}

export async function updateAgentConfig(
  id: string,
  config: AgentConfig,
  model: string,
  patch: Partial<Agent> = {},
) {
  await request(`${BASE}/${encodeURIComponent(id)}/config`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config, model, patch: patchPayload(patch) }),
  });
  notifyAgentsChanged();
}

export async function deleteAgent(id: string): Promise<void> {
  await request(`${BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' });
  notifyAgentsChanged();
}

async function request<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(body.error || `Agent 请求失败（HTTP ${response.status}）`);
  return body as T;
}

function patchPayload(patch: Partial<Agent>): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...patch };
  for (const field of ['avatar'] as const) {
    if (Object.prototype.hasOwnProperty.call(patch, field) && patch[field] === undefined) {
      payload[field] = null;
    }
  }
  return payload;
}

export async function checkModelAvailable(modelKey: string): Promise<boolean> {
  if (!modelKey) return false;
  const provider = await getProviderForModel(modelKey);
  return !!provider;
}

/**
 * 批量检测 Agent 列表中哪些处于离线状态（模型不可用）。
 * 返回离线 Agent ID 集合。ChatPage / DashboardPage 共用此函数。
 */
export async function getOfflineAgentIds(agents: Agent[]): Promise<Set<string>> {
  const offline = new Set<string>();
  await Promise.all(agents.map(async a => {
    if (a.status === 'idle' || !a.status) {
      const available = a.model ? await checkModelAvailable(a.model) : false;
      if (!available) offline.add(a.id);
    }
  }));
  return offline;
}
