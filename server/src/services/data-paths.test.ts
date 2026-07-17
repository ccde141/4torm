import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  agentRegistryFile,
  agentRolePromptFile,
  agentSessionsDir,
  agentMemoryDir,
  agentSessionFile,
  agentTaskboardFile,
  agentTideSessionsDir,
  agentWorkspaceDir,
  convectionSessionFile,
  convectionSessionDir,
  convectionSessionIndexFile,
  convectionSessionWorkspace,
  convectionSessionsDir,
  cycloneRoot,
  mcpServersFile,
  providersFile,
  skillDir,
  skillsDir,
  skinDir,
  tideRunsDir,
  tideTasksFile,
  toolExecutorDir,
  toolRegistryFile,
  tradewindRunsDir,
  tradewindRunDir,
  tradewindWorkflowDir,
  tradewindWorkflowsDir,
} from './data-paths.js';

test('data paths keep current control-plane layout', () => {
  const dataDir = path.join('project', 'data');

  assert.equal(agentRegistryFile(dataDir), path.join(dataDir, 'agents', 'registry.json'));
  assert.equal(agentWorkspaceDir(dataDir, 'agent-a'), path.join(dataDir, 'agents', 'agent-a', '.workspace'));
  assert.equal(agentRolePromptFile(dataDir, 'agent-a'), path.join(dataDir, 'agents', 'agent-a', '.workspace', 'role-prompt.md'));
  assert.equal(toolRegistryFile(dataDir), path.join(dataDir, 'tools', 'registry.json'));
  assert.equal(toolExecutorDir(dataDir), path.join(dataDir, 'tools', 'executors'));
  assert.equal(skillDir(dataDir, 'demo'), path.join(dataDir, 'skills', 'demo'));
  assert.equal(mcpServersFile(dataDir), path.join(dataDir, 'mcp', 'servers.json'));
  assert.equal(providersFile(dataDir), path.join(dataDir, 'providers.json'));
  assert.equal(agentSessionsDir(dataDir, 'agent-a'), path.join(dataDir, 'agents', 'agent-a', 'sessions'));
  assert.equal(agentTideSessionsDir(dataDir, 'agent-a'), path.join(dataDir, 'agents', 'agent-a', 'sessions-tide'));
  assert.equal(agentSessionFile(dataDir, 'agent-a', 'session-1'), path.join(dataDir, 'agents', 'agent-a', 'sessions', 'session-1.json'));
  assert.equal(agentMemoryDir(dataDir, 'agent-a'), path.join(dataDir, 'agents', 'agent-a', 'memory'));
  assert.equal(agentTaskboardFile(dataDir, 'agent-a', 'session-1'), path.join(dataDir, 'agents', 'agent-a', 'sessions', 'session-1.taskboard.json'));
  assert.equal(skillsDir(dataDir), path.join(dataDir, 'skills'));
  assert.equal(skinDir(dataDir), path.join(dataDir, 'skin'));
  assert.equal(convectionSessionsDir(dataDir), path.join(dataDir, 'convection', 'sessions'));
  assert.equal(convectionSessionFile(dataDir, 'conv-1'), path.join(dataDir, 'convection', 'sessions', 'conv-1.json'));
  assert.equal(convectionSessionDir(dataDir, 'conv-1'), path.join(dataDir, 'convection', 'sessions', 'conv-1'));
  assert.equal(convectionSessionIndexFile(dataDir), path.join(dataDir, 'convection', 'sessions', '_index.json'));
  assert.equal(convectionSessionWorkspace(dataDir, 'conv-1'), path.join(dataDir, 'convection', 'sessions', 'conv-1', 'workspace'));
  assert.equal(tideTasksFile(dataDir), path.join(dataDir, 'tide', 'tasks.json'));
  assert.equal(tideRunsDir(dataDir), path.join(dataDir, 'tide', 'runs'));
  assert.equal(tideRunsDir(dataDir, 'task-1'), path.join(dataDir, 'tide', 'runs', 'task-1'));
  assert.equal(cycloneRoot(dataDir, 'workshop-1'), path.join(dataDir, 'cyclone', 'workshop-1'));
  assert.equal(tradewindWorkflowsDir(dataDir), path.join(dataDir, 'tradewind', 'workflows'));
  assert.equal(tradewindWorkflowDir(dataDir, 'wf-1'), path.join(dataDir, 'tradewind', 'workflows', 'wf-1'));
  assert.equal(tradewindRunsDir(dataDir), path.join(dataDir, 'tradewind', 'runs'));
  assert.equal(tradewindRunDir(dataDir, 'wf-1', 'run-1'), path.join(dataDir, 'tradewind', 'runs', 'wf-1', 'run-1'));
});
