import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resolveExecutionContext } from './execution-context.js';

async function createDataDir(agentRegistry?: unknown): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-context-'));
  const dataDir = path.join(root, 'data');
  await fs.mkdir(path.join(dataDir, 'agents'), { recursive: true });
  if (agentRegistry !== undefined) {
    await fs.writeFile(
      path.join(dataDir, 'agents', 'registry.json'),
      JSON.stringify(agentRegistry),
    );
  }
  return dataDir;
}

test('无 agent 时使用项目根和 relaxed', async () => {
  const dataDir = await createDataDir();
  const context = await resolveExecutionContext(dataDir, '');

  assert.equal(context.workspaceDir, path.resolve(dataDir, '..'));
  assert.equal(context.projectDir, path.resolve(dataDir, '..'));
  assert.equal(context.sandboxLevel, 'relaxed');
});

test('agent 配置解析 workspace 和 sandboxLevel', async () => {
  const dataDir = await createDataDir({
    agentA: { config: { workspace: 'workspaces/agent-a', sandboxLevel: 'strict' } },
  });
  const context = await resolveExecutionContext(dataDir, 'agentA');

  assert.equal(
    context.workspaceDir,
    path.resolve(dataDir, '..', 'workspaces/agent-a'),
  );
  assert.equal(context.sandboxLevel, 'strict');
});

test('workspace override 保持项目根相对语义', async () => {
  const dataDir = await createDataDir();
  const context = await resolveExecutionContext(
    dataDir,
    '',
    'shared/workspace',
    'unrestricted',
  );

  assert.equal(
    context.workspaceDir,
    path.resolve(dataDir, '..', 'shared/workspace'),
  );
  assert.equal(context.sandboxLevel, 'unrestricted');
});

test('无效 agent 配置回退 relaxed', async () => {
  const dataDir = await createDataDir({
    agentA: { config: { workspace: 'workspaces/agent-a', sandboxLevel: 'invalid' } },
  });
  const context = await resolveExecutionContext(dataDir, 'agentA');

  assert.equal(context.sandboxLevel, 'relaxed');
});
