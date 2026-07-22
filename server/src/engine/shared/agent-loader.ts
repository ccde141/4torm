/**
 * Agent 加载器 —— 在 Node 端读 4torm 的 Agent 实体配置
 *
 * 共享基础设施：信风 & 对流共用。
 * 直接 fs 读 data/agents/registry.json + data/agents/{id}/.workspace/role-prompt.md
 */

import fs from 'node:fs/promises';
import { agentRegistryFile, agentRolePromptFile } from '../../services/data-paths.js';
import { normalizeSandboxLevel, type SandboxLevel } from '../../services/execution-context.js';

export interface LoadedAgent {
  id: string;
  name: string;
  model: string;            // 形如 "pvd_xxx:model-name"
  rolePrompt: string;       // 来自 .workspace/role-prompt.md，可能为空
  temperature: number;
  tools: string[];
  toolMode: 'all' | 'selected';
  skills: string[];
  /** 工作区相对路径（项目根相对，缺省 `data/agents/{id}/.workspace/`） */
  workspace: string;
  /** 内置文件工具权限（缺省项目级） */
  sandboxLevel: SandboxLevel;
}

interface RegistryEntry {
  id?: string;
  name?: string;
  model?: string;
  status?: string;
  config?: {
    rolePrompt?: string;
    temperature?: number;
    tools?: unknown;
    toolMode?: string;
    skills?: unknown;
    workspace?: string;
    sandboxLevel?: string;
  };
}

async function readJsonSafe<T>(file: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(file, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function readTextSafe(file: string): Promise<string> {
  try { return (await fs.readFile(file, 'utf-8')).trim(); } catch { return ''; }
}

/**
 * 加载 Agent 实体；找不到返回 null。
 *
 * @param dataDir 4torm data 目录绝对路径
 * @param agentId Agent 实体 ID
 */
export async function loadAgent(dataDir: string, agentId: string): Promise<LoadedAgent | null> {
  const registry = await readJsonSafe<Record<string, RegistryEntry>>(
    agentRegistryFile(dataDir),
  );
  if (!registry) return null;

  const entry = registry[agentId];
  if (!entry || typeof entry !== 'object') return null;

  // role-prompt.md 是真理来源；registry 里的 config.rolePrompt 仅 UI 缓存
  const rolePrompt = await readTextSafe(
    agentRolePromptFile(dataDir, agentId),
  );

  const cfg = entry.config ?? {};
  const tools = Array.isArray(cfg.tools) ? cfg.tools.filter(t => typeof t === 'string') : [];
  const toolMode: 'all' | 'selected' = cfg.toolMode === 'selected'
    ? 'selected'
    : cfg.toolMode === 'all' || tools.length === 0 ? 'all' : 'selected';
  const sandboxLevel = normalizeSandboxLevel(cfg.sandboxLevel);

  return {
    id: agentId,
    name: typeof entry.name === 'string' ? entry.name : agentId,
    model: typeof entry.model === 'string' ? entry.model : '',
    rolePrompt,
    temperature: typeof cfg.temperature === 'number' ? cfg.temperature : 0.7,
    tools,
    toolMode,
    skills: Array.isArray(cfg.skills) ? cfg.skills.filter(s => typeof s === 'string') : [],
    workspace: typeof cfg.workspace === 'string' && cfg.workspace
      ? cfg.workspace
      : `data/agents/${agentId}/.workspace/`,
    sandboxLevel,
  };
}
