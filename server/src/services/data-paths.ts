import { createHash } from 'node:crypto';
import path from 'node:path';

export function agentRegistryFile(dataDir: string): string {
  return path.join(dataDir, 'agents', 'registry.json');
}

export function agentWorkspaceDir(dataDir: string, agentId: string): string {
  return path.join(dataDir, 'agents', agentId, '.workspace');
}

export function resolveAgentWorkspaceDir(
  dataDir: string, agentId: string, configured?: string,
): string {
  const normalized = configured?.replaceAll('\\', '/').replace(/\/+$/, '');
  const defaultPath = `data/agents/${agentId}/.workspace`;
  return !configured || normalized === defaultPath
    ? path.resolve(agentWorkspaceDir(dataDir, agentId))
    : path.resolve(dataDir, '..', configured);
}

export function agentWorkspaceDisplayPath(
  projectRoot: string, dataDir: string, agentId: string, configured?: string,
): string {
  const workspace = resolveAgentWorkspaceDir(dataDir, agentId, configured);
  const relative = path.relative(projectRoot, workspace);
  const outside = relative === '..' || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative);
  return outside ? workspace : relative ? `./${relative.replaceAll('\\', '/')}` : '.';
}

export function agentAvatarFile(dataDir: string, agentId: string): string {
  return path.join(dataDir, 'agents', agentId, 'profile', 'avatar.webp');
}

export function agentRolePromptFile(dataDir: string, agentId: string): string {
  return path.join(agentWorkspaceDir(dataDir, agentId), 'role-prompt.md');
}

export function toolRegistryFile(dataDir: string): string {
  return path.join(dataDir, 'tools', 'registry.json');
}

export function toolExecutorDir(dataDir: string): string {
  return path.join(dataDir, 'tools', 'executors');
}

export function skillDir(dataDir: string, skillId: string): string {
  return path.join(dataDir, 'skills', skillId);
}

export function mcpServersFile(dataDir: string): string {
  return path.join(dataDir, 'mcp', 'servers.json');
}

export function providersFile(dataDir: string): string {
  return path.join(dataDir, 'providers.json');
}

export function agentSessionsDir(dataDir: string, agentId: string): string {
  return path.join(dataDir, 'agents', agentId, 'sessions');
}

export function agentTideSessionsDir(dataDir: string, agentId: string): string {
  return path.join(dataDir, 'agents', agentId, 'sessions-tide');
}

export function agentSessionFile(dataDir: string, agentId: string, sessionId: string): string {
  return path.join(agentSessionsDir(dataDir, agentId), `${sessionId}.json`);
}

export function agentMemoryDir(dataDir: string, agentId: string): string {
  return path.join(dataDir, 'agents', agentId, 'memory');
}

export function agentTaskboardFile(dataDir: string, agentId: string, sessionId: string): string {
  return path.join(agentSessionsDir(dataDir, agentId), `${sessionId}.taskboard.json`);
}

export function skillsDir(dataDir: string): string {
  return path.join(dataDir, 'skills');
}

export function skinDir(dataDir: string): string {
  return path.join(dataDir, 'skin');
}

export function convectionSessionsDir(dataDir: string): string {
  return path.join(dataDir, 'convection', 'sessions');
}

export function convectionSessionFile(dataDir: string, sessionId: string): string {
  return path.join(convectionSessionsDir(dataDir), `${sessionId}.json`);
}

export function convectionSessionDir(dataDir: string, sessionId: string): string {
  return path.join(convectionSessionsDir(dataDir), sessionId);
}

export function convectionSessionIndexFile(dataDir: string): string {
  return path.join(convectionSessionsDir(dataDir), '_index.json');
}

export function convectionSessionWorkspace(dataDir: string, sessionId: string): string {
  return path.join(convectionSessionDir(dataDir, sessionId), 'workspace');
}

export function convectionRunsDir(dataDir: string): string {
  return path.join(dataDir, 'convection', 'runs');
}

export function convectionRunFile(dataDir: string, sessionId: string, runId?: string): string {
  if (!runId) return path.join(convectionRunsDir(dataDir), `${sessionId}.json`);
  const name = createHash('sha256').update(sessionId).update('\0').update(runId).digest('hex');
  return path.join(convectionRunsDir(dataDir), `${name}.json`);
}

export function tideTasksFile(dataDir: string): string {
  return path.join(dataDir, 'tide', 'tasks.json');
}

export function tideRunsDir(dataDir: string, taskId?: string): string {
  return taskId
    ? path.join(dataDir, 'tide', 'runs', taskId)
    : path.join(dataDir, 'tide', 'runs');
}

export function tideRuntimeDir(dataDir: string): string {
  return path.join(dataDir, 'tide', 'runtime');
}

export function monsoonRunsDir(dataDir: string): string {
  return path.join(dataDir, 'monsoon', 'runs');
}

export function cycloneRoot(dataDir: string, workshopId?: string): string {
  return workshopId
    ? path.join(dataDir, 'cyclone', workshopId)
    : path.join(dataDir, 'cyclone');
}

export function cycloneRuntimeDir(dataDir: string): string {
  return path.join(dataDir, 'cyclone', 'runtime');
}

export function tradewindWorkflowsDir(dataDir: string): string {
  return path.join(dataDir, 'tradewind', 'workflows');
}

export function tradewindWorkflowDir(dataDir: string, workflowId: string): string {
  return path.join(tradewindWorkflowsDir(dataDir), workflowId);
}

export function tradewindRunsDir(dataDir: string): string {
  return path.join(dataDir, 'tradewind', 'runs');
}

export function tradewindRunDir(dataDir: string, workflowId: string, executionId: string): string {
  return path.join(tradewindRunsDir(dataDir), workflowId, executionId);
}
