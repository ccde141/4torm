import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resolveExecutionContext } from './execution-context.js';

async function createDataDir(registry: unknown): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-context-freeze-'));
  const dataDir = path.join(root, 'data');
  await fs.mkdir(path.join(dataDir, 'agents'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'agents', 'registry.json'), JSON.stringify(registry));
  return dataDir;
}

test('sandboxLevel 只接受 strict 和 unrestricted，其余值保持 relaxed', async () => {
  const dataDir = await createDataDir({
    strictAgent: { config: { sandboxLevel: 'strict' } },
    unrestrictedAgent: { config: { sandboxLevel: 'unrestricted' } },
    relaxedAgent: { config: { sandboxLevel: 'relaxed' } },
    invalidAgent: { config: { sandboxLevel: 'project' } },
  });

  assert.equal((await resolveExecutionContext(dataDir, 'strictAgent')).sandboxLevel, 'strict');
  assert.equal((await resolveExecutionContext(dataDir, 'unrestrictedAgent')).sandboxLevel, 'unrestricted');
  assert.equal((await resolveExecutionContext(dataDir, 'relaxedAgent')).sandboxLevel, 'relaxed');
  assert.equal((await resolveExecutionContext(dataDir, 'invalidAgent')).sandboxLevel, 'relaxed');
});

test('sandboxLevel override 只覆盖执行级别，不改变 workspace 解析', async () => {
  const dataDir = await createDataDir({
    agentA: { config: { workspace: 'workspaces/agent-a', sandboxLevel: 'strict' } },
  });

  const context = await resolveExecutionContext(dataDir, 'agentA', undefined, 'unrestricted');

  assert.equal(context.workspaceDir, path.resolve(dataDir, '..', 'workspaces/agent-a'));
  assert.equal(context.sandboxLevel, 'unrestricted');
});
