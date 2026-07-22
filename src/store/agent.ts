import { readJson, writeJson, writeText, ensureDir, deleteFile } from '../api/storage';
import { getAllModels, getProviderForModel } from '../llm';
import type { Agent, AgentConfig } from '../types';
import { notifyAgentsChanged } from './agent-events';

const REGISTRY = 'agents/registry.json';
type AgentSurface = NonNullable<Agent['activeSurfaces']>[number];
type AgentActivities = Record<string, { busy: boolean; surfaces: AgentSurface[] }>;

function agentDir(id: string) { return `agents/${id}`; }
function workspaceDir(id: string) { return `${agentDir(id)}/.workspace`; }
function sessionsDir(id: string) { return `${agentDir(id)}/sessions`; }

/**
 * 始终从磁盘读取，避免与后端写入产生竞态。
 * 后端（信风/对流）会绕过前端直接修改 registry.json，
 * 任何形式的内存缓存都可能导致前端 patch 把后端写入覆盖掉。
 */
async function readRegistry(): Promise<Record<string, Agent>> {
  return (await readJson<Record<string, Agent>>(REGISTRY)) || {};
}

async function writeRegistry(data: Record<string, Agent>): Promise<void> {
  await writeJson(REGISTRY, data);
}

function nextId(): string {
  return `agent-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

async function readAgentActivities(): Promise<AgentActivities> {
  try {
    const response = await fetch('/api/agents/activity');
    if (!response.ok) return {};
    return await response.json() as AgentActivities;
  } catch {
    return {};
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
  const [all, activities] = await Promise.all([readRegistry(), readAgentActivities()]);
  return mergeAgentActivities(Object.values(all), activities)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getAgent(id: string): Promise<Agent | null> {
  const all = await readRegistry();
  return all[id] ?? null;
}

export async function createAgent(params: {
  name: string;
  role: string;
  description: string;
  model?: string;
  config?: AgentConfig;
  label?: string;
}): Promise<Agent> {
  const now = new Date().toISOString();
  const id = nextId();
  const models = await getAllModels();
  const agent: Agent = {
    id,
    name: params.name,
    role: params.role,
    description: params.description,
    status: 'idle',
    label: params.label,
    model: params.model || (models.length > 0 ? models[0].key : ''),
    config: {
      ...params.config,
      workspace: params.config?.workspace || `data/agents/${id}/.workspace/`,
    },
    createdAt: now,
    updatedAt: now,
    tasksCompleted: 0,
  };

  await ensureDir(workspaceDir(id));
  await ensureDir(sessionsDir(id));
  await writeJson(`${sessionsDir(id)}/_index.json`, []);

  if (params.config?.rolePrompt) {
    await writeText(`${workspaceDir(id)}/role-prompt.md`, params.config.rolePrompt);
  }
  await writeText(`${workspaceDir(id)}/MEMORY.md`, '');
  const configObj = {
    temperature: params.config?.temperature,
    tools: params.config?.tools || [],
    toolMode: params.config?.toolMode,
    skills: params.config?.skills || [],
    model: agent.model,
  };
  await writeJson(`${workspaceDir(id)}/config.json`, configObj);

  const all = await readRegistry();
  all[id] = agent;
  await writeRegistry(all);
  notifyAgentsChanged();
  return agent;
}

export async function updateAgent(id: string, patch: Partial<Agent>) {
  const all = await readRegistry();
  if (!all[id]) return;
  all[id] = { ...all[id], ...patch, updatedAt: new Date().toISOString() };
  await writeRegistry(all);
  notifyAgentsChanged();
}

export async function updateAgentConfig(id: string, config: AgentConfig, model: string) {
  const wd = workspaceDir(id);
  await ensureDir(wd);

  if (config.rolePrompt !== undefined) {
    await writeText(`${wd}/role-prompt.md`, config.rolePrompt || '');
  }

  const configObj = {
    temperature: config.temperature,
    tools: config.tools || [],
    toolMode: config.toolMode,
    skills: config.skills || [],
    model,
  };
  await writeJson(`${wd}/config.json`, configObj);

  await updateAgent(id, { config, model });
}

export async function deleteAgent(id: string) {
  const all = await readRegistry();
  delete all[id];
  await writeRegistry(all);
  await deleteFile(agentDir(id));
  notifyAgentsChanged();
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
