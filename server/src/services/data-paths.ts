import path from 'node:path';

export function agentRegistryFile(dataDir: string): string {
  return path.join(dataDir, 'agents', 'registry.json');
}

export function agentWorkspaceDir(dataDir: string, agentId: string): string {
  return path.join(dataDir, 'agents', agentId, '.workspace');
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

export function tideTasksFile(dataDir: string): string {
  return path.join(dataDir, 'tide', 'tasks.json');
}

export function tideRunsDir(dataDir: string, taskId?: string): string {
  return taskId
    ? path.join(dataDir, 'tide', 'runs', taskId)
    : path.join(dataDir, 'tide', 'runs');
}

export function cycloneRoot(dataDir: string, workshopId?: string): string {
  return workshopId
    ? path.join(dataDir, 'cyclone', workshopId)
    : path.join(dataDir, 'cyclone');
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
