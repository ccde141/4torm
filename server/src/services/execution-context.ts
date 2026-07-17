import fs from 'node:fs/promises';
import path from 'node:path';
import { agentRegistryFile, agentWorkspaceDir } from './data-paths.js';

export type SandboxLevel = 'strict' | 'relaxed' | 'unrestricted';

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

async function getAgentConfig(dataDir: string, agentId: string): Promise<AgentConfig> {
  const projectDir = path.resolve(dataDir, '..');
  let workspace = path.resolve(agentWorkspaceDir(dataDir, agentId));
  let sandboxLevel: SandboxLevel = 'relaxed';

  try {
    const raw = await fs.readFile(agentRegistryFile(dataDir), 'utf-8');
    const registry = JSON.parse(raw) as Record<string, { config?: Record<string, unknown> }>;
    const config = registry[agentId]?.config;
    if (typeof config?.workspace === 'string' && config.workspace) {
      workspace = path.resolve(projectDir, config.workspace);
    }
    if (config?.sandboxLevel === 'strict' || config?.sandboxLevel === 'unrestricted') {
      sandboxLevel = config.sandboxLevel;
    }
  } catch {
    // 使用默认工作区和 relaxed 沙箱。
  }

  return { workspace, sandboxLevel };
}

export async function resolveExecutionContext(
  dataDir: string,
  agentId: string,
  workspaceDirOverride?: string,
  sandboxLevelOverride?: SandboxLevel,
): Promise<ExecutionContext> {
  let workspaceDir: string;
  let sandboxLevel: SandboxLevel = 'relaxed';

  if (workspaceDirOverride) {
    workspaceDir = path.resolve(dataDir, '..', workspaceDirOverride);
    if (sandboxLevelOverride) {
      sandboxLevel = sandboxLevelOverride;
    } else if (agentId) {
      sandboxLevel = (await getAgentConfig(dataDir, agentId)).sandboxLevel;
    }
  } else if (agentId) {
    const config = await getAgentConfig(dataDir, agentId);
    workspaceDir = config.workspace;
    sandboxLevel = sandboxLevelOverride ?? config.sandboxLevel;
  } else {
    workspaceDir = path.resolve(dataDir, '..');
    if (sandboxLevelOverride) sandboxLevel = sandboxLevelOverride;
  }

  return {
    dataDir,
    workspaceDir,
    projectDir: path.resolve(dataDir, '..'),
    sandboxLevel,
  };
}
