import { readJson, writeJson, writeText, ensureDir, deleteFile } from '../api/storage';
import { getAllModels, getProviderForModel } from '../llm';
import type { Agent, AgentConfig } from '../types';

const REGISTRY = 'agents/registry.json';

function agentDir(id: string) { return `agents/${id}`; }
function workspaceDir(id: string) { return `${agentDir(id)}/.workspace`; }
function sessionsDir(id: string) { return `${agentDir(id)}/sessions`; }

let cache: Record<string, Agent> | null = null;

async function loadCache(): Promise<Record<string, Agent>> {
  if (cache) return cache;
  cache = await readJson<Record<string, Agent>>(REGISTRY) || {};
  return cache;
}

async function saveCache(data: Record<string, Agent>) {
  cache = data;
  await writeJson(REGISTRY, data);
}

function nextId(): string {
  return `agent-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export async function getAgents(): Promise<Agent[]> {
  const all = await loadCache();
  return Object.values(all).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getAgent(id: string): Promise<Agent | null> {
  const all = await loadCache();
  return all[id] ?? null;
}

export async function createAgent(params: {
  name: string;
  role: string;
  description: string;
  model?: string;
  config?: AgentConfig;
  status?: string;
}): Promise<Agent> {
  const now = new Date().toISOString();
  const id = nextId();
  const models = await getAllModels();
  const agent: Agent = {
    id,
    name: params.name,
    role: params.role,
    description: params.description,
    status: params.status || 'idle',
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

  if (params.config?.rolePrompt) {
    await writeText(`${workspaceDir(id)}/role-prompt.md`, params.config.rolePrompt);
  }
  await writeText(`${workspaceDir(id)}/MEMORY.md`, '');
  const configObj = {
    temperature: params.config?.temperature,
    tools: params.config?.tools || [],
    skills: params.config?.skills || [],
    maxToolCalls: params.config?.maxToolCalls ?? 100,
    maxContextTokens: params.config?.maxContextTokens ?? 256000,
    model: agent.model,
  };
  await writeJson(`${workspaceDir(id)}/config.json`, configObj);

  const all = await loadCache();
  all[id] = agent;
  await saveCache(all);
  return agent;
}

export async function updateAgent(id: string, patch: Partial<Agent>) {
  const all = await loadCache();
  if (!all[id]) return;
  all[id] = { ...all[id], ...patch, updatedAt: new Date().toISOString() };
  await saveCache(all);
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
    skills: config.skills || [],
    maxToolCalls: config.maxToolCalls ?? 100,
    maxContextTokens: config.maxContextTokens ?? 256000,
    model,
  };
  await writeJson(`${wd}/config.json`, configObj);

  await updateAgent(id, { config, model });
}

export async function setAgentStatus(id: string, status: string) {
  await updateAgent(id, { status });
}

export async function deleteAgent(id: string) {
  const all = await loadCache();
  delete all[id];
  await saveCache(all);
  await deleteFile(agentDir(id));
}

export async function checkModelAvailable(modelKey: string): Promise<boolean> {
  if (!modelKey) return false;
  const provider = await getProviderForModel(modelKey);
  return !!provider;
}
