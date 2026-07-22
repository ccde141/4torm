import fs from 'node:fs/promises';
import path from 'node:path';
import { agentRegistryFile, agentWorkspaceDir } from './data-paths.js';

export type SandboxLevel = 'project' | 'unrestricted';
export type SandboxLevelInput = SandboxLevel | 'strict' | 'relaxed';

export interface ExecutionContext {
  dataDir: string;
  workspaceDir: string;
  projectDir: string;
  sandboxLevel: SandboxLevel;
}

interface AgentConfig {
  workspace: string;
  sandboxLevel: SandboxLevel;
}

export function normalizeSandboxLevel(value: unknown): SandboxLevel {
  return value === 'unrestricted' ? 'unrestricted' : 'project';
}

async function getAgentConfig(dataDir: string, agentId: string): Promise<AgentConfig> {
  const projectDir = path.resolve(dataDir, '..');
  let workspace = path.resolve(agentWorkspaceDir(dataDir, agentId));
  let sandboxLevel: SandboxLevel = 'project';

  try {
    const raw = await fs.readFile(agentRegistryFile(dataDir), 'utf-8');
    const registry = JSON.parse(raw) as Record<string, { config?: Record<string, unknown> }>;
    const config = registry[agentId]?.config;
    if (typeof config?.workspace === 'string' && config.workspace) {
      workspace = path.resolve(projectDir, config.workspace);
    }
    sandboxLevel = normalizeSandboxLevel(config?.sandboxLevel);
  } catch {
    // 使用默认工作区和项目级权限。
  }

  return { workspace, sandboxLevel };
}

export async function resolveExecutionContext(
  dataDir: string,
  agentId: string,
  workspaceDirOverride?: string,
  sandboxLevelOverride?: SandboxLevelInput,
): Promise<ExecutionContext> {
  let workspaceDir: string;
  let sandboxLevel: SandboxLevel = 'project';

  if (workspaceDirOverride) {
    workspaceDir = path.resolve(dataDir, '..', workspaceDirOverride);
    if (sandboxLevelOverride) {
      sandboxLevel = normalizeSandboxLevel(sandboxLevelOverride);
    } else if (agentId) {
      sandboxLevel = (await getAgentConfig(dataDir, agentId)).sandboxLevel;
    }
  } else if (agentId) {
    const config = await getAgentConfig(dataDir, agentId);
    workspaceDir = config.workspace;
    sandboxLevel = sandboxLevelOverride
      ? normalizeSandboxLevel(sandboxLevelOverride)
      : config.sandboxLevel;
  } else {
    workspaceDir = path.resolve(dataDir, '..');
    if (sandboxLevelOverride) sandboxLevel = normalizeSandboxLevel(sandboxLevelOverride);
  }

  return {
    dataDir,
    workspaceDir,
    projectDir: path.resolve(dataDir, '..'),
    sandboxLevel,
  };
}
